import {test, expect} from './fixtures/test';
import type {Page} from '@playwright/test';
import {createDefaultFileSystem, installMockApiAsync, type MockFileSystem} from './fixtures/mock-api';

type BranchKind = 'local' | 'remote';

interface MockBranch {
    name: string;
    ref: string;
    kind: BranchKind;
}

type BranchFileStatus = 'A' | 'M' | 'D';

interface MockBranchCompareFile {
    path: string;
    tableName: string;
    status: BranchFileStatus;
}

interface MockBranchCompareResult {
    leftCommit: string;
    rightCommit: string;
    files: MockBranchCompareFile[];
}

const LEFT_SHA = '1111111';
const RIGHT_SHA = '2222222';
const LEFT_REF = 'refs/heads/main';
const RIGHT_REF = 'refs/heads/feature/orders';
const UI_STATE_FILE = 'user:ui-state.json';

const BRANCHES: MockBranch[] = [
    {name: 'main', ref: LEFT_REF, kind: 'local'},
    {name: 'feature/orders', ref: RIGHT_REF, kind: 'local'},
    {name: 'origin/main', ref: 'refs/remotes/origin/main', kind: 'remote'},
    {name: 'origin/release', ref: 'refs/remotes/origin/release', kind: 'remote'},
];

const COMPARE_RESULT: MockBranchCompareResult = {
    leftCommit: LEFT_SHA,
    rightCommit: RIGHT_SHA,
    files: [
        {path: 'data/modified.csv', tableName: 'modified', status: 'M'},
        {path: 'data/added.csv', tableName: 'added', status: 'A'},
        {path: 'data/deleted.csv', tableName: 'deleted', status: 'D'},
    ],
};

const SCHEMA = JSON.stringify({
    header: [
        {key: 0, name: 'id', type: 'int'},
        {key: 1, name: 'name', type: 'string'},
        {key: 2, name: 'value', type: 'int'},
    ],
    primary_key: ['id'],
});

const STRING_PRIMARY_KEY_SCHEMA = JSON.stringify({
    header: [
        {key: 0, name: 'id', type: 'int'},
        {key: 1, name: 'name', type: 'string'},
        {key: 2, name: 'value', type: 'int'},
    ],
    primary_key: 'id',
});

const COMMIT_FILES: Record<string, Record<string, string>> = {
    [LEFT_SHA]: {
        'schema/modified.json': SCHEMA,
        'schema/deleted.json': SCHEMA,
        'data/modified.csv': 'id,name,value\n1,before,100',
        'data/deleted.csv': 'id,name,value\n1,deleted-only,900',
    },
    [RIGHT_SHA]: {
        'schema/modified.json': SCHEMA,
        'schema/added.json': SCHEMA,
        'data/modified.csv': 'id,name,value\n1,after,150',
        'data/added.csv': 'id,name,value\n1,added-only,500',
    },
    '3333333': {
        'schema/modified.json': SCHEMA,
        'data/modified.csv': 'id,name,value\n1,release,200',
    },
};

function createBranchCompareFileSystem(): MockFileSystem {
    return {
        ...createDefaultFileSystem(),
        'schema/modified.json': SCHEMA,
        'schema/added.json': SCHEMA,
        'schema/deleted.json': SCHEMA,
        // 起動時preload用。ブランチ差分そのものはCOMMIT_FILESから取得する。
        'data/modified.csv': COMMIT_FILES[RIGHT_SHA]['data/modified.csv'],
        'data/added.csv': COMMIT_FILES[RIGHT_SHA]['data/added.csv'],
        'data/deleted.csv': COMMIT_FILES[LEFT_SHA]['data/deleted.csv'],
    };
}

async function installBranchComparePageAsync(
    page: Page,
    compareResult: MockBranchCompareResult,
    compareError: string | null,
): Promise<void> {
    await page.addInitScript((args: {
        branches: MockBranch[];
        compareResult: MockBranchCompareResult;
        compareError: string | null;
        commitFiles: Record<string, Record<string, string>>;
    }) => {
        const mockWindow = window as unknown as {
            __mockGitBranches: MockBranch[];
            __mockGitBranchListError: string | null;
            __mockGitBranchListDelayMs: number;
            __mockGitBranchCompare: MockBranchCompareResult;
            __mockGitBranchCompareError: string | null;
            __mockGitBranchCompareDelayMs: number;
            __mockGitCommitFiles: Record<string, Record<string, string>>;
            __mockGitShowAtCommitDelays: Record<string, number>;
            __mockGitStatus: {changes: Array<{path: string; tableName: string; isNew: boolean}>; staged: Array<{path: string; tableName: string; isNew: boolean}>};
            __mockGitHeadFiles: Record<string, string>;
        };
        mockWindow.__mockGitBranches = args.branches;
        mockWindow.__mockGitBranchListError = null;
        mockWindow.__mockGitBranchListDelayMs = 0;
        mockWindow.__mockGitBranchCompare = args.compareResult;
        mockWindow.__mockGitBranchCompareError = args.compareError;
        mockWindow.__mockGitBranchCompareDelayMs = 0;
        const schemaOverride = sessionStorage.getItem('__branchCompareSchemaOverride');
        if (schemaOverride !== null) {
            for (const files of Object.values(args.commitFiles)) {
                for (const path of Object.keys(files)) {
                    if (path.startsWith('schema/')) files[path] = schemaOverride;
                }
            }
        }
        mockWindow.__mockGitCommitFiles = args.commitFiles;
        mockWindow.__mockGitShowAtCommitDelays = {};
        mockWindow.__mockGitStatus = {changes: [{path: 'data/modified.csv', tableName: 'modified', isNew: false}], staged: []};
        mockWindow.__mockGitHeadFiles = {'data/modified.csv': args.commitFiles['1111111']['data/modified.csv']};
    }, {branches: BRANCHES, compareResult, compareError, commitFiles: COMMIT_FILES});
    await installMockApiAsync(page, createBranchCompareFileSystem());
    await page.goto('/');
}

async function openBranchComparePanelAsync(page: Page): Promise<void> {
    await page.locator('.activity-bar-item[data-panel="branchCompare"]').click();
    await expect(page.locator('.branch-compare-panel')).toBeVisible();
}

async function delayDiffWorkerMessagesAsync(page: Page, delayMs: number): Promise<void> {
    await page.evaluate((workerDelayMs: number) => {
        type WorkerMessageHandler = (this: Worker, event: MessageEvent<unknown>) => unknown;
        const NativeWorker = window.Worker;
        window.Worker = new Proxy(NativeWorker, {
            construct(Target, args) {
                const worker = Reflect.construct(Target, args) as Worker;
                let messageHandler: WorkerMessageHandler | null = null;
                Object.defineProperty(worker, 'onmessage', {
                    configurable: true,
                    get: () => messageHandler,
                    set: (value: unknown) => {
                        messageHandler = typeof value === 'function' ? value as WorkerMessageHandler : null;
                    },
                });
                worker.addEventListener('message', (event: MessageEvent<unknown>) => {
                    const handler = messageHandler;
                    if (handler === null) return;
                    window.setTimeout(() => { handler.call(worker, event); }, workerDelayMs);
                });
                return worker;
            },
        });
    }, delayMs);
}

async function selectBranchByMouseAsync(page: Page, inputSelector: string, ref: string): Promise<void> {
    const input = page.locator(inputSelector);
    await input.focus();
    const option = page.locator(`.branch-compare-suggestion[data-ref="${ref}"]`);
    await expect(option).toBeVisible();
    await option.click();
}

async function selectDefaultBranchesAndCompareAsync(page: Page): Promise<void> {
    await selectBranchByMouseAsync(page, '.branch-compare-base-input', LEFT_REF);
    await selectBranchByMouseAsync(page, '.branch-compare-target-input', RIGHT_REF);
    const compareButton = page.locator('.branch-compare-button');
    await expect(compareButton).toBeEnabled();
    await compareButton.click();
    await expect(page.locator('.branch-compare-file-item')).toHaveCount(3);
}

test.describe('ブランチ比較パネル', () => {
    test.beforeEach(async ({page}) => {
        await installBranchComparePageAsync(page, COMPARE_RESULT, null);
    });

    test('アクティビティーバーの新アイコンから比較元・比較先の2入力を持つパネルを開ける', async ({page}) => {
        const activityItem = page.locator('.activity-bar-item[data-panel="branchCompare"]');
        await expect(activityItem).toBeVisible();

        await activityItem.click();

        const panel = page.locator('.branch-compare-panel');
        await expect(panel).toBeVisible();
        await expect(panel.locator('.sidebar-panel-header')).toHaveText('BRANCH COMPARE');
        await expect(panel.locator('.branch-compare-base-input')).toHaveAttribute('placeholder', '比較元ブランチ');
        await expect(panel.locator('.branch-compare-target-input')).toHaveAttribute('placeholder', '比較先ブランチ');
        await expect(panel.locator('.branch-compare-button')).toHaveText('比較');
    });

    test('全アクティビティー項目を支援技術とキーボードで操作できactive状態を通知する', async ({page}) => {
        const activityItems = page.locator('.activity-bar-item');
        await expect(activityItems).toHaveCount(10);
        for (const item of await activityItems.all()) {
            await expect(item).toHaveAttribute('role', 'button');
            await expect(item).toHaveAttribute('tabindex', '0');
            await expect(item).toHaveAttribute('aria-label', /.+/);
            await expect(item).toHaveAttribute('title', /.+/);
            await expect(item).toHaveAttribute('aria-pressed', /^(true|false)$/);
        }

        const branchCompareItem = page.locator('.activity-bar-item[data-panel="branchCompare"]');
        await expect(branchCompareItem).toHaveAttribute('aria-label', 'ブランチ比較');
        await expect(branchCompareItem).toHaveAttribute('title', 'ブランチ比較');
        await branchCompareItem.focus();
        await branchCompareItem.press('Enter');
        await expect(page.locator('.branch-compare-panel')).toBeVisible();
        await expect(branchCompareItem).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('.activity-bar-item[data-panel="files"]')).toHaveAttribute('aria-pressed', 'false');

        const historyItem = page.locator('.activity-bar-item[data-panel="history"]');
        await historyItem.focus();
        await historyItem.press('Space');
        await expect(page.locator('.timeline-panel')).toBeVisible();
        await expect(historyItem).toHaveAttribute('aria-pressed', 'true');
        await expect(branchCompareItem).toHaveAttribute('aria-pressed', 'false');
    });

    test('比較元と比較先に常設ラベルがあり候補のloading・0件・errorを通知する', async ({page}) => {
        await page.evaluate(() => {
            const mockWindow = window as unknown as {__mockGitBranchListDelayMs: number};
            mockWindow.__mockGitBranchListDelayMs = 120;
        });
        await openBranchComparePanelAsync(page);
        const baseInput = page.locator('.branch-compare-base-input');
        const targetInput = page.locator('.branch-compare-target-input');
        await expect(page.locator('label[for="branch-compare-base-input"]')).toHaveText('比較元');
        await expect(page.locator('label[for="branch-compare-target-input"]')).toHaveText('比較先');
        await expect(baseInput).toHaveAttribute('id', 'branch-compare-base-input');
        await expect(targetInput).toHaveAttribute('id', 'branch-compare-target-input');

        await baseInput.focus();
        const candidateStatus = page.locator('.branch-compare-suggestion-empty');
        await expect(candidateStatus).toHaveAttribute('role', 'status');
        await expect(candidateStatus).toHaveAttribute('aria-live', 'polite');
        await expect(candidateStatus).toHaveText('読み込み中…');
        await expect(page.locator('.branch-compare-suggestion')).toHaveCount(4);

        await baseInput.fill('該当しない名前');
        await expect(candidateStatus).toHaveAttribute('role', 'status');
        await expect(candidateStatus).toHaveAttribute('aria-live', 'polite');
        await expect(candidateStatus).toHaveText('該当するブランチがありません');

        await page.locator('[data-panel="files"]').click();
        await page.evaluate(() => {
            const mockWindow = window as unknown as {
                __mockGitBranchListDelayMs: number;
                __mockGitBranchListError: string | null;
            };
            mockWindow.__mockGitBranchListDelayMs = 0;
            mockWindow.__mockGitBranchListError = 'branch list failed';
        });
        await openBranchComparePanelAsync(page);
        await baseInput.focus();
        await expect(candidateStatus).toHaveAttribute('role', 'status');
        await expect(candidateStatus).toHaveAttribute('aria-live', 'polite');
        await expect(candidateStatus).toHaveText('ブランチ候補を取得できませんでした');
    });

    test('最小幅でも長いブランチ名とファイルpathの完全値を確認でき選択を明示する', async ({page}) => {
        const longBaseName = 'feature/very-long-common-prefix/source-branch';
        const longTargetName = 'origin/feature/very-long-common-prefix/target-branch';
        const longBaseRef = 'refs/heads/' + longBaseName;
        const longTargetRef = 'refs/remotes/' + longTargetName;
        const longPath = 'data/deeply/nested/directory/very_long_master_data_filename.csv';
        await page.evaluate(({baseName, targetName, baseRef, targetRef, filePath, leftSha, rightSha}) => {
            const mockWindow = window as unknown as {
                __mockGitBranches: MockBranch[];
                __mockGitBranchCompare: MockBranchCompareResult;
                __mockGitCommitFiles: Record<string, Record<string, string>>;
            };
            mockWindow.__mockGitBranches = [
                {name: baseName, ref: baseRef, kind: 'local'},
                {name: targetName, ref: targetRef, kind: 'remote'},
            ];
            mockWindow.__mockGitBranchCompare = {
                leftCommit: leftSha,
                rightCommit: rightSha,
                files: [{path: filePath, tableName: 'very_long_master_data_filename', status: 'M'}],
            };
            const schemaPath = 'schema/very_long_master_data_filename.json';
            mockWindow.__mockGitCommitFiles[leftSha][schemaPath] = mockWindow.__mockGitCommitFiles[leftSha]['schema/modified.json'];
            mockWindow.__mockGitCommitFiles[rightSha][schemaPath] = mockWindow.__mockGitCommitFiles[rightSha]['schema/modified.json'];
            mockWindow.__mockGitCommitFiles[leftSha][filePath] = 'id,name,value\n1,before,100';
            mockWindow.__mockGitCommitFiles[rightSha][filePath] = 'id,name,value\n1,after,150';
        }, {
            baseName: longBaseName,
            targetName: longTargetName,
            baseRef: longBaseRef,
            targetRef: longTargetRef,
            filePath: longPath,
            leftSha: LEFT_SHA,
            rightSha: RIGHT_SHA,
        });

        const explorer = page.locator('#explorer');
        const explorerBeforeBox = await explorer.boundingBox();
        const resizeHandleBox = await page.locator('.explorer > .resize-handle[data-direction="horizontal"]').boundingBox();
        if (explorerBeforeBox === null || resizeHandleBox === null) throw new Error('sidebar resize geometry not available');
        expect(explorerBeforeBox.width).toBeCloseTo(300, 0);
        const resizeStartX = resizeHandleBox.x + resizeHandleBox.width / 2;
        const resizeStartY = resizeHandleBox.y + resizeHandleBox.height / 2;
        await page.mouse.move(resizeStartX, resizeStartY);
        await page.mouse.down();
        await page.mouse.move(resizeStartX - 100, resizeStartY, {steps: 5});
        await page.mouse.up();

        const explorerBox = await explorer.boundingBox();
        const tabBox = await page.locator('#tab').boundingBox();
        const editorBox = await page.locator('#editor').boundingBox();
        if (explorerBox === null || tabBox === null || editorBox === null) throw new Error('resized layout geometry not available');
        expect(explorerBox.width).toBeCloseTo(200, 0);
        const explorerRight = explorerBox.x + explorerBox.width;
        expect(tabBox.x).toBeCloseTo(explorerRight, 0);
        expect(editorBox.x).toBeCloseTo(explorerRight, 0);

        await openBranchComparePanelAsync(page);
        const baseInput = page.locator('.branch-compare-base-input');
        await baseInput.focus();
        const baseOption = page.locator(`.branch-compare-suggestion[data-ref="${longBaseRef}"]`);
        await expect(baseOption).toHaveAttribute('title', longBaseName);
        await expect(baseOption).toHaveAttribute('aria-label', new RegExp(longBaseName));
        const popupBox = await page.locator('.branch-compare-suggestions').boundingBox();
        const sidebarBox = await page.locator('.sidebar-content').boundingBox();
        expect(popupBox).not.toBeNull();
        expect(sidebarBox).not.toBeNull();
        if (popupBox === null || sidebarBox === null) throw new Error('branch compare popup geometry not available');
        expect(popupBox.x + popupBox.width).toBeLessThanOrEqual(sidebarBox.x + sidebarBox.width);
        expect(await baseOption.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
        await baseOption.click();
        await expect(baseInput).toHaveAttribute('title', longBaseName);

        await selectBranchByMouseAsync(page, '.branch-compare-target-input', longTargetRef);
        await expect(page.locator('.branch-compare-target-input')).toHaveAttribute('title', longTargetName);
        await page.locator('.branch-compare-button').click();
        const fileItem = page.locator('.branch-compare-file-item');
        await expect(fileItem).toHaveAttribute('title', longPath);
        await expect(fileItem).toHaveAttribute('aria-label', new RegExp(longPath));
        expect(await fileItem.locator('.branch-compare-file-name').evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
        await fileItem.click();
        await expect(fileItem).toHaveAttribute('aria-current', 'true');
        const activeAccent = await fileItem.evaluate(element => getComputedStyle(element).boxShadow);
        expect(activeAccent).toContain('rgb(0, 122, 204)');
        expect(activeAccent).toContain('inset');
    });

    test('各入力のフォーカスと絞り込みで先頭候補をactiveにする', async ({page}) => {
        await openBranchComparePanelAsync(page);

        const baseInput = page.locator('.branch-compare-base-input');
        await baseInput.focus();
        const suggestions = page.locator('.branch-compare-suggestions');
        await expect(suggestions).toBeVisible();
        await expect(suggestions.locator('.branch-compare-suggestion-group[data-kind="local"]')).toContainText('main');
        await expect(suggestions.locator('.branch-compare-suggestion-group[data-kind="local"]')).toContainText('feature/orders');
        await expect(suggestions.locator('.branch-compare-suggestion-group[data-kind="remote"]')).toContainText('origin/main');
        await expect(suggestions.locator('.branch-compare-suggestion-group[data-kind="remote"]')).toContainText('origin/release');
        let firstOption = suggestions.locator('.branch-compare-suggestion').first();
        await expect(firstOption).toHaveText('main');
        await expect(firstOption).toHaveClass(/selected/);
        await expect(firstOption).toHaveAttribute('aria-selected', 'true');
        await expect(baseInput).toHaveAttribute('aria-activedescendant', 'branch-compare-suggestion-0');

        await baseInput.fill('feature');
        await expect(suggestions.locator('.branch-compare-suggestion')).toHaveCount(1);
        firstOption = suggestions.locator('.branch-compare-suggestion').first();
        await expect(firstOption).toHaveText('feature/orders');
        await expect(firstOption).toHaveClass(/selected/);
        await expect(firstOption).toHaveAttribute('aria-selected', 'true');
        await expect(baseInput).toHaveAttribute('aria-activedescendant', 'branch-compare-suggestion-0');

        const targetInput = page.locator('.branch-compare-target-input');
        await targetInput.focus();
        await expect(suggestions).toBeVisible();
        firstOption = suggestions.locator('.branch-compare-suggestion').first();
        await expect(firstOption).toHaveText('main');
        await expect(firstOption).toHaveClass(/selected/);
        await expect(firstOption).toHaveAttribute('aria-selected', 'true');
        await expect(targetInput).toHaveAttribute('aria-activedescendant', 'branch-compare-suggestion-0');
        await targetInput.fill('release');
        await expect(suggestions.locator('.branch-compare-suggestion')).toHaveCount(1);
        firstOption = suggestions.locator('.branch-compare-suggestion').first();
        await expect(firstOption).toHaveText('origin/release');
        await expect(firstOption).toHaveClass(/selected/);
        await expect(firstOption).toHaveAttribute('aria-selected', 'true');
        await expect(targetInput).toHaveAttribute('aria-activedescendant', 'branch-compare-suggestion-0');
    });

    test('Tabでactive候補を確定して比較元から比較先、比較ボタンへフォーカスを進める', async ({page}) => {
        await openBranchComparePanelAsync(page);

        const baseInput = page.locator('.branch-compare-base-input');
        const targetInput = page.locator('.branch-compare-target-input');
        const compareButton = page.locator('.branch-compare-button');
        const suggestions = page.locator('.branch-compare-suggestions');

        await baseInput.focus();
        await expect(suggestions.locator('.branch-compare-suggestion').first()).toHaveClass(/selected/);
        await baseInput.press('Tab');
        await expect(baseInput).toHaveValue('main');
        await expect(baseInput).toHaveAttribute('data-selected-ref', LEFT_REF);
        await expect(targetInput).toBeFocused();

        await targetInput.fill('feature');
        await expect(suggestions.locator('.branch-compare-suggestion').first()).toHaveClass(/selected/);
        await targetInput.press('Tab');
        await expect(targetInput).toHaveValue('feature/orders');
        await expect(targetInput).toHaveAttribute('data-selected-ref', RIGHT_REF);
        await expect(compareButton).toBeEnabled();
        await expect(compareButton).toBeFocused();
        await expect(suggestions).toBeHidden();
    });

    test('Shift+Tabと候補0件のTabは未確定のまま通常のフォーカス移動をする', async ({page}) => {
        await openBranchComparePanelAsync(page);

        const baseInput = page.locator('.branch-compare-base-input');
        const targetInput = page.locator('.branch-compare-target-input');
        const suggestions = page.locator('.branch-compare-suggestions');

        await targetInput.fill('feature');
        await expect(suggestions.locator('.branch-compare-suggestion').first()).toHaveClass(/selected/);
        await targetInput.press('Shift+Tab');
        await expect(baseInput).toBeFocused();
        await expect(targetInput).toHaveValue('feature');
        await expect(targetInput).not.toHaveAttribute('data-selected-ref', /.+/);

        await baseInput.fill('該当しないブランチ');
        await expect(suggestions.locator('.branch-compare-suggestion')).toHaveCount(0);
        await expect(baseInput).not.toHaveAttribute('aria-activedescendant', /.+/);
        await baseInput.press('Tab');
        await expect(targetInput).toBeFocused();
        await expect(baseInput).toHaveValue('該当しないブランチ');
        await expect(baseInput).not.toHaveAttribute('data-selected-ref', /.+/);
    });

    test('候補をマウスまたは先頭active候補から下キーとEnterで選択できる', async ({page}) => {
        await openBranchComparePanelAsync(page);

        await selectBranchByMouseAsync(page, '.branch-compare-base-input', LEFT_REF);
        await expect(page.locator('.branch-compare-base-input')).toHaveValue('main');

        const targetInput = page.locator('.branch-compare-target-input');
        await targetInput.focus();
        const suggestions = page.locator('.branch-compare-suggestions');
        await expect(suggestions).toBeVisible();
        await expect(suggestions.locator('.branch-compare-suggestion').first()).toHaveText('main');
        await expect(suggestions.locator('.branch-compare-suggestion').first()).toHaveClass(/selected/);
        await targetInput.press('ArrowDown');
        await expect(suggestions.locator('.branch-compare-suggestion.selected')).toHaveText('feature/orders');
        await targetInput.press('Enter');
        await expect(targetInput).toHaveValue('feature/orders');
        await expect(targetInput).toHaveAttribute('data-selected-ref', RIGHT_REF);
        await expect(suggestions).not.toBeVisible();
        await expect(page.locator('.branch-compare-button')).toBeEnabled();
    });

    test('未確定・同一ブランチ・選択後に手入力で変更した状態では比較ボタンが無効になる', async ({page}) => {
        await openBranchComparePanelAsync(page);
        const compareButton = page.locator('.branch-compare-button');
        await expect(compareButton).toBeDisabled();

        await selectBranchByMouseAsync(page, '.branch-compare-base-input', LEFT_REF);
        await expect(compareButton).toBeDisabled();
        await selectBranchByMouseAsync(page, '.branch-compare-target-input', LEFT_REF);
        await expect(compareButton).toBeDisabled();

        const targetInput = page.locator('.branch-compare-target-input');
        await targetInput.fill('手入力だけの未確定ref');
        await expect(compareButton).toBeDisabled();
    });

    test('比較後にA・M・D一覧を表示し、追加は緑背景、削除は赤背景になる', async ({page}) => {
        await openBranchComparePanelAsync(page);
        await selectDefaultBranchesAndCompareAsync(page);

        const modified = page.locator('.branch-compare-file-item[data-status="M"]');
        const added = page.locator('.branch-compare-file-item[data-status="A"]');
        const deleted = page.locator('.branch-compare-file-item[data-status="D"]');
        await expect(modified).toContainText('modified');
        await expect(added).toContainText('added');
        await expect(deleted).toContainText('deleted');
        await expect(added.locator('.branch-compare-file-status')).toHaveText('A');
        await expect(deleted.locator('.branch-compare-file-status')).toHaveText('D');
        await expect(added).toHaveCSS('background-color', 'rgba(81, 184, 81, 0.2)');
        await expect(deleted).toHaveCSS('background-color', 'rgba(240, 50, 50, 0.2)');

        const compareRequest = await page.evaluate(() => {
            const details = (window as unknown as {__mockApiRequestDetails: Array<Record<string, string | null>>}).__mockApiRequestDetails;
            return details.find(detail => detail.type === 'git_branch_compare_request');
        });
        expect(compareRequest).toMatchObject({leftRef: LEFT_REF, rightRef: RIGHT_REF});
    });

    test('M・A・Dクリックで固定SHAの読み取り専用差分を開く', async ({page}) => {
        await openBranchComparePanelAsync(page);
        await selectDefaultBranchesAndCompareAsync(page);

        await page.locator('.branch-compare-file-item[data-status="M"]').click();
        let diffTab = page.locator('.diff-tab:visible');
        await expect(diffTab.locator('.diff-pane-left')).toContainText('before');
        await expect(diffTab.locator('.diff-pane-right')).toContainText('after');
        await expect(diffTab.locator('.diff-pane-label-left')).toContainText('main');
        await expect(diffTab.locator('.diff-pane-label-right')).toContainText('feature/orders');
        await expect(diffTab.locator('.diff-cell-deleted').first()).toBeVisible();
        await expect(diffTab.locator('.diff-cell-added').first()).toBeVisible();

        await page.locator('.branch-compare-file-item[data-status="A"]').click();
        diffTab = page.locator('.diff-tab:visible');
        await expect(diffTab.locator('.diff-pane-left')).not.toContainText('added-only');
        await expect(diffTab.locator('.diff-pane-right')).toContainText('added-only');
        await expect(diffTab.locator('.diff-pane-right .diff-cell-added').first()).toBeVisible();

        await page.locator('.branch-compare-file-item[data-status="D"]').click();
        diffTab = page.locator('.diff-tab:visible');
        await expect(diffTab.locator('.diff-pane-left')).toContainText('deleted-only');
        await expect(diffTab.locator('.diff-pane-right')).not.toContainText('deleted-only');
        await expect(diffTab.locator('.diff-pane-left .diff-row-deleted, .diff-pane-left .diff-cell-deleted').first()).toBeVisible();

        // ブランチ比較差分は左右とも読み取り専用。
        await diffTab.locator('.diff-pane-right .editor-table-cell').last().dblclick();
        await expect(page.locator('.grid-textfield-active')).not.toBeVisible();

        // 一覧取得後のファイル表示はref名を再解決せず、比較結果に含まれる固定SHAだけを使う。
        const showCommits = await page.evaluate(() => {
            const details = (window as unknown as {
                __mockApiRequestDetails: Array<{type: string; commit: string | null}>;
            }).__mockApiRequestDetails;
            return details
                .filter(detail => detail.type === 'git_show_at_commit_request')
                .map(detail => detail.commit);
        });
        expect(showCommits.length).toBeGreaterThan(0);
        expect(new Set(showCommits)).toEqual(new Set([LEFT_SHA, RIGHT_SHA]));
        expect(showCommits).not.toContain('main');
        expect(showCommits).not.toContain('feature/orders');
        expect(showCommits).not.toContain(LEFT_REF);
        expect(showCommits).not.toContain(RIGHT_REF);
    });

    test('ファイル差分の読み込み中はステータスと予約空白を表示せずaria-busyだけを更新する', async ({page}) => {
        await openBranchComparePanelAsync(page);
        await selectDefaultBranchesAndCompareAsync(page);
        await page.evaluate(() => {
            const mockWindow = window as unknown as {__mockGitShowAtCommitDelays: Record<string, number>};
            mockWindow.__mockGitShowAtCommitDelays = {
                '1111111:schema/modified.json': 1000,
                '2222222:schema/modified.json': 1000,
                '1111111:data/modified.csv': 1000,
                '2222222:data/modified.csv': 1000,
            };
        });

        const results = page.locator('.branch-compare-results');
        const status = page.locator('.branch-compare-status');

        await page.locator('.branch-compare-file-item[data-status="M"]').click();
        await expect(results).toHaveAttribute('aria-busy', 'true');
        const [loadingText, loadingHidden, loadingOffsetHeight, loadingDisplay, loadingTextCount] = await Promise.all([
            status.textContent(),
            status.isHidden(),
            status.evaluate(element => element.offsetHeight),
            status.evaluate(element => getComputedStyle(element).display),
            page.getByText('差分を読み込み中…', {exact: true}).count(),
        ]);
        expect(loadingText).toBe('');
        expect(loadingHidden).toBe(true);
        expect(loadingOffsetHeight).toBe(0);
        expect(loadingDisplay).not.toBe('none');
        expect(loadingTextCount).toBe(0);

        await expect(page.locator('.diff-tab:visible .diff-pane-right')).toContainText('after');
        await expect(results).toHaveAttribute('aria-busy', 'false');
        await expect(status).toHaveText('');
        await expect(status).toBeHidden();
        expect(await status.evaluate(element => element.offsetHeight)).toBe(0);
        expect(await status.evaluate(element => getComputedStyle(element).display)).not.toBe('none');
    });

    test('比較後に入力または候補を変更すると旧一覧を破棄して古いSHAを開けない', async ({page}) => {
        await openBranchComparePanelAsync(page);
        await selectDefaultBranchesAndCompareAsync(page);

        await page.locator('.branch-compare-target-input').fill('release');
        await expect(page.locator('.branch-compare-file-item')).toHaveCount(0);
        await expect(page.locator('.branch-compare-button')).toBeDisabled();

        await selectBranchByMouseAsync(page, '.branch-compare-target-input', 'refs/remotes/origin/release');
        await expect(page.locator('.branch-compare-file-item')).toHaveCount(0);
        await expect(page.locator('.branch-compare-button')).toBeEnabled();
    });

    test('遅い旧ファイル取得より後のクリックを優先して旧タブと旧エラーを表示しない', async ({page}) => {
        await openBranchComparePanelAsync(page);
        await selectDefaultBranchesAndCompareAsync(page);
        await page.evaluate(() => {
            const mockWindow = window as unknown as {
                __mockGitShowAtCommitDelays: Record<string, number>;
                __mockGitCommitFiles: Record<string, Record<string, string>>;
            };
            mockWindow.__mockGitShowAtCommitDelays = {
                '1111111:schema/modified.json': 150,
                '2222222:schema/modified.json': 150,
                '1111111:data/modified.csv': 150,
                '2222222:data/modified.csv': 150,
            };
            delete mockWindow.__mockGitCommitFiles['1111111']['data/modified.csv'];
        });

        await page.locator('.branch-compare-file-item[data-status="M"]').click();
        await page.locator('.branch-compare-file-item[data-status="A"]').click();
        await expect(page.locator('.diff-tab:visible .diff-pane-right')).toContainText('added-only');
        await page.waitForTimeout(250);
        await expect(page.locator('.diff-tab:visible .diff-pane-right')).toContainText('added-only');
        await expect(page.locator('.branch-compare-error')).toBeHidden();
        await expect(page.locator('.tab-button', {hasText: 'modified (main ↔ feature/orders)'})).toHaveCount(0);
    });

    test('ファイル取得中に再比較した場合は新しい比較結果の固定SHAだけを表示する', async ({page}) => {
        await openBranchComparePanelAsync(page);
        await selectDefaultBranchesAndCompareAsync(page);
        await page.evaluate(() => {
            const mockWindow = window as unknown as {
                __mockGitShowAtCommitDelays: Record<string, number>;
                __mockGitBranchCompare: MockBranchCompareResult;
            };
            mockWindow.__mockGitShowAtCommitDelays = {
                '1111111:schema/modified.json': 120,
                '2222222:schema/modified.json': 120,
                '1111111:data/modified.csv': 120,
                '2222222:data/modified.csv': 120,
            };
            mockWindow.__mockGitBranchCompare = {
                leftCommit: '1111111',
                rightCommit: '3333333',
                files: [{path: 'data/modified.csv', tableName: 'modified', status: 'M'}],
            };
        });

        await page.locator('.branch-compare-file-item[data-status="M"]').click();
        await page.locator('.branch-compare-target-input').fill('release');
        await selectBranchByMouseAsync(page, '.branch-compare-target-input', 'refs/remotes/origin/release');
        await page.locator('.branch-compare-button').click();
        await page.locator('.branch-compare-file-item[data-status="M"]').click();
        await expect(page.locator('.diff-tab:visible .diff-pane-right')).toContainText('release');
        await page.waitForTimeout(200);
        await expect(page.locator('.diff-tab:visible .diff-pane-right')).toContainText('release');
        await expect(page.locator('.tab-button', {hasText: 'modified (main ↔ feature/orders)'})).toHaveCount(0);
    });

    test('パネルを開き直すとブランチ候補を再取得する', async ({page}) => {
        await openBranchComparePanelAsync(page);
        await page.locator('.branch-compare-base-input').focus();
        await expect(page.locator('.branch-compare-suggestion')).toContainText(['main', 'feature/orders', 'origin/main', 'origin/release']);

        await page.locator('[data-panel="files"]').click();
        await page.evaluate(() => {
            const mockWindow = window as unknown as {__mockGitBranches: MockBranch[]};
            mockWindow.__mockGitBranches = [{name: 'new-branch', ref: 'refs/heads/new-branch', kind: 'local'}];
        });
        await openBranchComparePanelAsync(page);
        await page.locator('.branch-compare-base-input').focus();
        await expect(page.locator('.branch-compare-suggestion')).toHaveCount(1);
        await expect(page.locator('.branch-compare-suggestion')).toHaveText('new-branch');
    });

    test('取得中に開き直したブランチ候補は最新表示の要求だけを採用する', async ({page}) => {
        await page.evaluate(() => {
            const mockWindow = window as unknown as {
                __mockGitBranches: MockBranch[];
                __mockGitBranchListDelayMs: number;
            };
            mockWindow.__mockGitBranches = [{name: 'old-branch', ref: 'refs/heads/old-branch', kind: 'local'}];
            mockWindow.__mockGitBranchListDelayMs = 150;
        });
        await openBranchComparePanelAsync(page);
        await page.locator('[data-panel="files"]').click();
        await page.evaluate(() => {
            const mockWindow = window as unknown as {
                __mockGitBranches: MockBranch[];
                __mockGitBranchListDelayMs: number;
            };
            mockWindow.__mockGitBranches = [{name: 'new-branch', ref: 'refs/heads/new-branch', kind: 'local'}];
            mockWindow.__mockGitBranchListDelayMs = 0;
        });

        await openBranchComparePanelAsync(page);
        await page.locator('.branch-compare-base-input').focus();
        await expect(page.locator('.branch-compare-suggestion')).toHaveText('new-branch');
        await page.waitForTimeout(200);
        await expect(page.locator('.branch-compare-suggestion')).toHaveText('new-branch');
    });

    test('フォーカスを外した後に遅い候補取得が完了しても候補を再表示しない', async ({page}) => {
        await page.evaluate(() => {
            const mockWindow = window as unknown as {__mockGitBranchListDelayMs: number};
            mockWindow.__mockGitBranchListDelayMs = 120;
        });
        await openBranchComparePanelAsync(page);
        const input = page.locator('.branch-compare-base-input');
        const suggestions = page.locator('.branch-compare-suggestions');
        await input.focus();
        await page.locator('.sidebar-panel-header').filter({hasText: 'BRANCH COMPARE'}).click();
        await expect(suggestions).toBeHidden();
        await page.waitForTimeout(180);
        await expect(suggestions).toBeHidden();
        await expect(input).toHaveAttribute('aria-expanded', 'false');
        await expect(input).not.toHaveAttribute('aria-activedescendant', /.+/);
    });

    test('候補更新で選択refが消えた場合は進行中の旧比較結果を表示しない', async ({page}) => {
        await openBranchComparePanelAsync(page);
        await selectBranchByMouseAsync(page, '.branch-compare-base-input', LEFT_REF);
        await selectBranchByMouseAsync(page, '.branch-compare-target-input', RIGHT_REF);
        await page.evaluate(() => {
            const mockWindow = window as unknown as {__mockGitBranchCompareDelayMs: number};
            mockWindow.__mockGitBranchCompareDelayMs = 150;
        });
        await page.locator('.branch-compare-button').click();
        await page.locator('[data-panel="files"]').click();
        await page.evaluate((leftRef: string) => {
            const mockWindow = window as unknown as {__mockGitBranches: MockBranch[]};
            mockWindow.__mockGitBranches = [{name: 'main', ref: leftRef, kind: 'local'}];
        }, LEFT_REF);
        await openBranchComparePanelAsync(page);

        await page.waitForTimeout(220);
        await expect(page.locator('.branch-compare-file-item')).toHaveCount(0);
        await expect(page.locator('.branch-compare-button')).toBeDisabled();
        await expect(page.locator('.branch-compare-target-input')).not.toHaveAttribute('data-selected-ref', /.+/);
        await expect(page.locator('.branch-compare-results')).toHaveAttribute('aria-busy', 'false');
    });

    test('比較中の候補取得失敗は比較busyを解除せず比較成功後に古いerrorを残さない', async ({page}) => {
        await openBranchComparePanelAsync(page);
        await selectBranchByMouseAsync(page, '.branch-compare-base-input', LEFT_REF);
        await selectBranchByMouseAsync(page, '.branch-compare-target-input', RIGHT_REF);
        await page.evaluate(() => {
            const mockWindow = window as unknown as {__mockGitBranchCompareDelayMs: number};
            mockWindow.__mockGitBranchCompareDelayMs = 150;
        });
        await page.locator('.branch-compare-button').click();
        await page.locator('[data-panel="files"]').click();
        await page.evaluate(() => {
            const mockWindow = window as unknown as {__mockGitBranchListError: string | null};
            mockWindow.__mockGitBranchListError = 'branch list failed';
        });
        await openBranchComparePanelAsync(page);

        await expect(page.locator('.branch-compare-panel')).toHaveClass(/branch-compare-busy/);
        await expect(page.locator('.branch-compare-base-input')).toBeDisabled();
        await expect(page.locator('.branch-compare-target-input')).toBeDisabled();
        await expect(page.locator('.branch-compare-results')).toHaveAttribute('aria-busy', 'true');
        await expect(page.locator('.branch-compare-file-item')).toHaveCount(3);
        await expect(page.locator('.branch-compare-panel')).not.toHaveClass(/branch-compare-busy/);
        await expect(page.locator('.branch-compare-error')).toBeHidden();
    });

    test('source controlと異なるブランチ比較の同一table差分が内部状態を共有せず共存する', async ({page}) => {
        await page.locator('[data-panel="sourceControl"]').click();
        await page.locator('.source-control-changes-section .source-control-file-item').first().click();
        await expect(page.locator('.diff-tab:visible .diff-pane-right')).toContainText('after');

        await openBranchComparePanelAsync(page);
        await selectDefaultBranchesAndCompareAsync(page);
        await page.locator('.branch-compare-file-item[data-status="M"]').click();
        await expect(page.locator('.tab-button.tab-button-active', {hasText: '差分: modified (main ↔ feature/orders)'})).toBeVisible();
        await expect(page.locator('.diff-tab:visible .diff-pane-right')).toContainText('after');

        await page.evaluate(() => {
            const mockWindow = window as unknown as {__mockGitBranchCompare: MockBranchCompareResult};
            mockWindow.__mockGitBranchCompare = {
                leftCommit: '1111111',
                rightCommit: '3333333',
                files: [{path: 'data/modified.csv', tableName: 'modified', status: 'M'}],
            };
        });
        await page.locator('.branch-compare-target-input').fill('release');
        await selectBranchByMouseAsync(page, '.branch-compare-target-input', 'refs/remotes/origin/release');
        await page.locator('.branch-compare-button').click();
        await page.locator('.branch-compare-file-item[data-status="M"]').click();
        await expect(page.locator('.diff-tab:visible .diff-pane-right')).toContainText('release');
        await expect(page.locator('.tab-button', {hasText: '差分: modified'})).toHaveCount(3);
    });

    test('ブランチ比較差分を固定SHAとstatus付きでui-stateへ保存する', async ({page}) => {
        await openBranchComparePanelAsync(page);
        await selectDefaultBranchesAndCompareAsync(page);
        await page.locator('.branch-compare-file-item[data-status="M"]').click();
        await expect(page.locator('.diff-tab:visible')).toBeVisible();

        await page.waitForFunction((path) => {
            const raw = (window as unknown as {__mockFs: Record<string, string>}).__mockFs[path];
            if (typeof raw !== 'string') return false;
            const parsed = JSON.parse(raw) as {tabs: {open: Array<{diff: Record<string, unknown> | null}>}};
            return parsed.tabs.open.some(tab => tab.diff?.kind === 'branchCompare'
                && tab.diff.leftCommit === '1111111'
                && tab.diff.rightCommit === '2222222'
                && tab.diff.fileStatus === 'M');
        }, UI_STATE_FILE);
    });

    test('左右ブランチのprimary_keyが異なる場合は誤った行差分を開かず明示エラーにする', async ({page}) => {
        await openBranchComparePanelAsync(page);
        await selectDefaultBranchesAndCompareAsync(page);
        await page.evaluate(() => {
            const mockWindow = window as unknown as {__mockGitCommitFiles: Record<string, Record<string, string>>};
            mockWindow.__mockGitCommitFiles['2222222']['schema/modified.json'] = JSON.stringify({
                header: [
                    {key: 0, name: 'id', type: 'int'},
                    {key: 1, name: 'name', type: 'string'},
                    {key: 2, name: 'value', type: 'int'},
                ],
                primary_key: ['name'],
            });
        });

        await page.locator('.branch-compare-file-item[data-status="M"]').click();
        await expect(page.locator('.branch-compare-error')).toContainText('primary_keyが異なるため比較できません');
        await expect(page.locator('.tab-button', {hasText: 'modified (main ↔ feature/orders)'})).toHaveCount(0);
    });

    test('primary_keyが文字列形式でもM・A・D差分を開いて固定SHAから復元できる', async ({page}) => {
        await page.evaluate((schemaJson: string) => {
            const mockWindow = window as unknown as {__mockGitCommitFiles: Record<string, Record<string, string>>};
            for (const files of Object.values(mockWindow.__mockGitCommitFiles)) {
                for (const path of Object.keys(files)) {
                    if (path.startsWith('schema/')) files[path] = schemaJson;
                }
            }
            sessionStorage.setItem('__branchCompareSchemaOverride', schemaJson);
        }, STRING_PRIMARY_KEY_SCHEMA);
        await openBranchComparePanelAsync(page);
        await selectDefaultBranchesAndCompareAsync(page);

        await page.locator('.branch-compare-file-item[data-status="A"]').click();
        await expect(page.locator('.diff-tab:visible .diff-pane-right')).toContainText('added-only');
        await page.locator('.branch-compare-file-item[data-status="D"]').click();
        await expect(page.locator('.diff-tab:visible .diff-pane-left')).toContainText('deleted-only');
        await page.locator('.branch-compare-file-item[data-status="M"]').click();
        await expect(page.locator('.diff-tab:visible .diff-pane-left')).toContainText('before');
        await expect(page.locator('.diff-tab:visible .diff-pane-right')).toContainText('after');
        await page.waitForFunction((path) => {
            const raw = (window as unknown as {__mockFs: Record<string, string>}).__mockFs[path];
            if (typeof raw !== 'string') return false;
            const parsed = JSON.parse(raw) as {tabs: {open: Array<{diff: Record<string, unknown> | null}>}};
            return parsed.tabs.open.some(tab => tab.diff?.kind === 'branchCompare' && tab.diff.fileStatus === 'M');
        }, UI_STATE_FILE);

        await page.reload();
        await expect(page.locator('.tab-button.tab-button-active', {hasText: '差分: modified (main ↔ feature/orders)'})).toBeVisible();
        await expect(page.locator('.diff-tab:visible .diff-pane-left')).toContainText('before');
        await expect(page.locator('.diff-tab:visible .diff-pane-right')).toContainText('after');
    });

    test('パネルを離れた後は遅いファイル取得で差分タブを開かずbusyと選択を残さない', async ({page}) => {
        await openBranchComparePanelAsync(page);
        await selectDefaultBranchesAndCompareAsync(page);
        await page.evaluate(() => {
            const mockWindow = window as unknown as {__mockGitShowAtCommitDelays: Record<string, number>};
            mockWindow.__mockGitShowAtCommitDelays = {
                '1111111:schema/modified.json': 120,
                '2222222:schema/modified.json': 120,
                '1111111:data/modified.csv': 120,
                '2222222:data/modified.csv': 120,
            };
        });
        await page.locator('.branch-compare-file-item[data-status="M"]').click();
        await page.locator('[data-panel="sourceControl"]').click();
        await page.waitForTimeout(180);
        await expect(page.locator('.tab-button', {hasText: 'modified (main ↔ feature/orders)'})).toHaveCount(0);

        await openBranchComparePanelAsync(page);
        await expect(page.locator('.branch-compare-results')).toHaveAttribute('aria-busy', 'false');
        await expect(page.locator('.branch-compare-file-item-active')).toHaveCount(0);
        await expect(page.locator('.branch-compare-status')).toHaveText('');
    });

    test('既存同名差分の再取得を中断した場合は更新前の差分タブを表示する', async ({page}) => {
        await openBranchComparePanelAsync(page);
        await selectDefaultBranchesAndCompareAsync(page);
        await page.locator('.branch-compare-file-item[data-status="M"]').click();
        await expect(page.locator('.tab-button.tab-button-active', {hasText: '差分: modified (main ↔ feature/orders)'})).toBeVisible();
        await expect(page.locator('.diff-tab:visible .diff-pane-right')).toContainText('after');
        await page.evaluate(() => {
            const mockWindow = window as unknown as {
                __mockGitCommitFiles: Record<string, Record<string, string>>;
                __mockGitShowAtCommitDelays: Record<string, number>;
            };
            mockWindow.__mockGitCommitFiles['2222222']['data/modified.csv'] = 'id,name,value\n1,replacement,999';
            mockWindow.__mockGitShowAtCommitDelays = {
                '2222222:data/modified.csv': 120,
            };
        });

        await page.locator('.branch-compare-file-item[data-status="M"]').click();
        await page.locator('[data-panel="sourceControl"]').click();
        await page.waitForTimeout(180);
        await expect(page.locator('.tab-button', {hasText: '差分: modified (main ↔ feature/orders)'})).toHaveCount(1);
        await expect(page.locator('.diff-tab:visible .diff-pane-right')).toContainText('after');
        await expect(page.locator('.diff-tab:visible .diff-pane-right')).not.toContainText('replacement');
    });

    test('worker中の同名差分再読込を中断し現在タブのままなら旧差分を復元する', async ({page}) => {
        await openBranchComparePanelAsync(page);
        await selectDefaultBranchesAndCompareAsync(page);
        await page.locator('.branch-compare-file-item[data-status="M"]').click();
        const branchTab = page.locator('.tab-button', {hasText: '差分: modified (main ↔ feature/orders)'});
        await expect(branchTab).toHaveClass(/tab-button-active/);
        await expect(page.locator('.diff-tab:visible .diff-pane-right')).toContainText('after');
        await delayDiffWorkerMessagesAsync(page, 150);
        await page.evaluate(() => {
            const mockWindow = window as unknown as {__mockGitCommitFiles: Record<string, Record<string, string>>};
            mockWindow.__mockGitCommitFiles['2222222']['data/modified.csv'] = 'id,name,value\n1,replacement,999';
        });

        await page.locator('.branch-compare-file-item[data-status="M"]').click();
        await expect(page.locator('.tab-wrapper-loading:visible')).toBeVisible();
        await page.locator('.branch-compare-target-input').fill('changed');
        await expect(page.locator('.tab-wrapper-loading:visible')).toHaveCount(0);
        await expect(branchTab).toHaveClass(/tab-button-active/);
        await expect(page.locator('.diff-tab:visible .diff-pane-right')).toContainText('after');
        await expect(page.locator('.diff-tab:visible .diff-pane-right')).not.toContainText('replacement');
    });

    test('worker中の同名差分再読込を中断し別タブへ移動済みならフォーカスを奪わない', async ({page}) => {
        await page.locator('[data-panel="sourceControl"]').click();
        await page.locator('.source-control-changes-section .source-control-file-item').first().click();
        const sourceControlTab = page.locator('.tab-button[title="差分: modified"]');
        await expect(sourceControlTab).toHaveClass(/tab-button-active/);

        await openBranchComparePanelAsync(page);
        await selectDefaultBranchesAndCompareAsync(page);
        await page.locator('.branch-compare-file-item[data-status="M"]').click();
        const branchTab = page.locator('.tab-button', {hasText: '差分: modified (main ↔ feature/orders)'});
        await expect(branchTab).toHaveClass(/tab-button-active/);
        await delayDiffWorkerMessagesAsync(page, 150);
        await page.evaluate(() => {
            const mockWindow = window as unknown as {__mockGitCommitFiles: Record<string, Record<string, string>>};
            mockWindow.__mockGitCommitFiles['2222222']['data/modified.csv'] = 'id,name,value\n1,replacement,999';
        });

        await page.locator('.branch-compare-file-item[data-status="M"]').click();
        await expect(page.locator('.tab-wrapper-loading:visible')).toBeVisible();
        await sourceControlTab.click();
        await page.locator('.branch-compare-target-input').fill('changed');
        await expect(page.locator('.tab-wrapper-loading:visible')).toHaveCount(0);
        await expect(sourceControlTab).toHaveClass(/tab-button-active/);
        await expect(branchTab).not.toHaveClass(/tab-button-active/);
        await expect(page.locator('.diff-tab:visible')).toHaveCount(1);
    });

    test('comboboxの展開状態と候補位置をフォーカス・0件・Escape・blur・パネル非表示で正規化する', async ({page}) => {
        await openBranchComparePanelAsync(page);
        const baseInput = page.locator('.branch-compare-base-input');
        const targetInput = page.locator('.branch-compare-target-input');
        const suggestions = page.locator('.branch-compare-suggestions');

        await baseInput.focus();
        await expect(baseInput).toHaveAttribute('aria-expanded', 'true');
        await expect(targetInput).toHaveAttribute('aria-expanded', 'false');
        const baseBox = await baseInput.boundingBox();
        const suggestionsBox = await suggestions.boundingBox();
        expect(baseBox).not.toBeNull();
        expect(suggestionsBox).not.toBeNull();
        expect(suggestionsBox!.y).toBeGreaterThanOrEqual(baseBox!.y + baseBox!.height);

        await baseInput.press('ArrowDown');
        await expect(baseInput).toHaveAttribute('aria-activedescendant', /branch-compare-suggestion-/);
        await baseInput.fill('該当なし');
        await expect(baseInput).not.toHaveAttribute('aria-activedescendant', /.+/);
        await baseInput.press('Escape');
        await expect(suggestions).toBeHidden();
        await expect(baseInput).toHaveAttribute('aria-expanded', 'false');

        await targetInput.focus();
        await expect(baseInput).toHaveAttribute('aria-expanded', 'false');
        await expect(targetInput).toHaveAttribute('aria-expanded', 'true');
        await page.locator('.sidebar-panel-header').filter({hasText: 'BRANCH COMPARE'}).click();
        await expect(suggestions).toBeHidden();
        await expect(targetInput).toHaveAttribute('aria-expanded', 'false');

        await targetInput.focus();
        await page.locator('[data-panel="files"]').click();
        await page.locator('[data-panel="branchCompare"]').click();
        await expect(suggestions).toBeHidden();
        await expect(baseInput).toHaveAttribute('aria-expanded', 'false');
        await expect(targetInput).toHaveAttribute('aria-expanded', 'false');
    });
});

test.describe('ブランチ比較の空状態・エラー状態', () => {
    test('差分が0件なら空状態メッセージを表示する', async ({page}) => {
        await installBranchComparePageAsync(page, {
            leftCommit: LEFT_SHA,
            rightCommit: RIGHT_SHA,
            files: [],
        }, null);
        await openBranchComparePanelAsync(page);
        await selectBranchByMouseAsync(page, '.branch-compare-base-input', LEFT_REF);
        await selectBranchByMouseAsync(page, '.branch-compare-target-input', RIGHT_REF);
        await page.locator('.branch-compare-button').click();

        await expect(page.locator('.branch-compare-empty-message')).toHaveText('変更されたファイルはありません');
        await expect(page.locator('.branch-compare-file-item')).toHaveCount(0);
    });

    test('比較APIが失敗したらパネル内にエラーを表示する', async ({page}) => {
        await installBranchComparePageAsync(page, COMPARE_RESULT, 'fatal: unknown revision');
        await openBranchComparePanelAsync(page);
        await selectBranchByMouseAsync(page, '.branch-compare-base-input', LEFT_REF);
        await selectBranchByMouseAsync(page, '.branch-compare-target-input', RIGHT_REF);
        await page.locator('.branch-compare-button').click();

        await expect(page.locator('.branch-compare-error')).toContainText('fatal: unknown revision');
        await expect(page.locator('.branch-compare-file-item')).toHaveCount(0);
    });
});
