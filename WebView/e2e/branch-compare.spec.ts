import {test, expect} from './fixtures/test';
import type {Page} from '@playwright/test';
import {createDefaultFileSystem, installMockApiAsync, readMockFileAsync, type MockFileSystem} from './fixtures/mock-api';

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

interface StoredBranchCompareState {
    baseRef: string | null;
    targetRef: string | null;
    compared: boolean;
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
            __mockGitCellBlame: Record<string, Record<string, object[]>>;
            __mockGitCellDeletions: Record<string, Record<string, object[]>>;
        };
        const branchesOverride = sessionStorage.getItem('__branchCompareBranchesOverride');
        mockWindow.__mockGitBranches = branchesOverride === null ? args.branches : JSON.parse(branchesOverride) as MockBranch[];
        mockWindow.__mockGitBranchListError = null;
        mockWindow.__mockGitBranchListDelayMs = 0;
        const compareOverride = sessionStorage.getItem('__branchCompareResultOverride');
        mockWindow.__mockGitBranchCompare = compareOverride === null ? args.compareResult : JSON.parse(compareOverride) as MockBranchCompareResult;
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
        mockWindow.__mockGitCellBlame = Object.fromEntries(Object.entries(args.commitFiles).map(([commit, files]) => [commit,
            Object.fromEntries(Object.entries(files).filter(([path]) => path.endsWith('.csv')).map(([path, csv]) => [path,
                csv.split('\n').slice(1).flatMap((_, index) => csv.split('\n')[0].split(',').map(columnName => ({lineNumber: index + 2, columnName, author: commit === '1111111' ? '比較元担当' : columnName === 'name' ? '名前担当' : '数値担当', date: '2026-09-05', commitHash: commit, commitMessage: 'テーブル更新'}))),
            ])),
        ]));
        mockWindow.__mockGitCellDeletions = {'1111111:2222222': {
            'data/deleted.csv': ['id', 'name', 'value'].map(columnName => ({lineNumber: 2, columnName, author: '削除担当', date: '2026-09-05', commitHash: '2222222', commitMessage: 'ファイルを削除'})),
        }};
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
        const mockWindow = window as unknown as {__delayedDiffWorkerMessageCount: number};
        mockWindow.__delayedDiffWorkerMessageCount = 0;
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
                    mockWindow.__delayedDiffWorkerMessageCount++;
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

async function expectSavedBranchCompareAsync(page: Page, expected: StoredBranchCompareState): Promise<void> {
    await expect.poll(async () => {
        const raw = await readMockFileAsync(page, UI_STATE_FILE);
        if (typeof raw !== 'string') return null;
        const state = JSON.parse(raw) as {sidebar: {branchCompare?: StoredBranchCompareState}};
        return state.sidebar.branchCompare;
    }).toEqual(expected);
}

async function getHoverTextBoundsAsync(page: Page, text: string): Promise<{x: number; y: number; width: number; height: number}> {
    return page.locator('.branch-compare-cell-tooltip:visible').evaluate((element, selectedText) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
            const start = (node.textContent ?? '').indexOf(selectedText);
            if (start < 0) continue;
            const range = document.createRange();
            range.setStart(node, start);
            range.setEnd(node, start + selectedText.length);
            const rect = range.getBoundingClientRect();
            return {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
        }
        throw new Error('ホバー内の対象テキストがありません: ' + selectedText);
    }, text);
}

test.describe('リビジョン比較パネル', () => {
    test.beforeEach(async ({page}) => {
        await installBranchComparePageAsync(page, COMPARE_RESULT, null);
    });

    test('テーブル名の部分一致で絞り込み、該当なし表示と解除ができ差分の選択を維持する', async ({page}) => {
        await openBranchComparePanelAsync(page);
        await selectDefaultBranchesAndCompareAsync(page);
        const panel = page.locator('.branch-compare-panel');
        const filterInput = panel.getByRole('textbox', {name: 'テーブル名でフィルタ', exact: true});
        const visibleNames = panel.locator('.branch-compare-file-item:visible .branch-compare-file-name');
        const emptyMessage = panel.locator('.branch-compare-empty-message');
        const clearButton = panel.getByRole('button', {name: 'テーブル名フィルタをクリア', exact: true});
        await expect(clearButton).toBeHidden();

        await filterInput.fill('  DIF  ');
        await expect(clearButton).toBeVisible();
        await expect(visibleNames).toHaveText(['modified']);
        await panel.locator('.branch-compare-file-item:visible').click();
        await expect(page.locator('.diff-tab:visible')).toHaveCount(1);

        await filterInput.fill('data/');
        await expect(visibleNames).toHaveCount(0);
        await expect(emptyMessage).toHaveText('該当するテーブルはありません');
        await expect(emptyMessage).toBeVisible();
        await expect(page.locator('.diff-tab:visible')).toHaveCount(1);

        await filterInput.fill('  ');
        await expect(visibleNames).toHaveText(['modified', 'added', 'deleted']);
        await expect(emptyMessage).toBeHidden();
        await filterInput.fill('DIF');
        await clearButton.click();
        await expect(filterInput).toHaveValue('');
        await expect(filterInput).toBeFocused();
        await expect(clearButton).toBeHidden();
        await expect(visibleNames).toHaveText(['modified', 'added', 'deleted']);
        await expect(visibleNames.locator('.search-highlight')).toHaveCount(0);
        await expect(panel.locator('.branch-compare-file-item-active .branch-compare-file-name')).toHaveText('modified');
        expect(await page.evaluate(() => (window as unknown as {__mockApiRequests: string[]}).__mockApiRequests.filter(type => type === 'git_branch_compare_request'))).toHaveLength(1);
    });

    test('比較前のテーブル名フィルタを結果と再比較にも適用し、差分なしと区別する', async ({page}) => {
        await openBranchComparePanelAsync(page);
        const panel = page.locator('.branch-compare-panel');
        const filterInput = panel.getByRole('textbox', {name: 'テーブル名でフィルタ', exact: true});
        const visibleNames = panel.locator('.branch-compare-file-item:visible .branch-compare-file-name');
        await filterInput.fill('ADD');
        await expect(panel.locator('.branch-compare-empty-message:visible')).toHaveCount(0);
        await selectDefaultBranchesAndCompareAsync(page);
        await expect(visibleNames).toHaveText(['added']);

        await panel.getByRole('button', {name: '入れ替え', exact: true}).click();
        await expect(panel.locator('.branch-compare-file-item')).toHaveCount(0);
        await expect(filterInput).toHaveValue('ADD');
        await panel.locator('.branch-compare-button').click();
        await expect(visibleNames).toHaveText(['added']);

        await page.evaluate(() => {
            (window as unknown as {__mockGitBranchCompare: MockBranchCompareResult}).__mockGitBranchCompare.files = [];
        });
        await panel.locator('.branch-compare-button').click();
        await expect(panel.locator('.branch-compare-empty-message:visible')).toHaveText('変更されたファイルはありません');
        await filterInput.fill('modified');
        await expect(panel.locator('.branch-compare-empty-message:visible')).toHaveText('変更されたファイルはありません');
    });

    test('テーブル一覧だけをスクロールしても比較条件と比較ボタンを操作できる', async ({page}) => {
        await page.setViewportSize({width: 1280, height: 640});
        const files: MockBranchCompareFile[] = Array.from({length: 80}, (_, index) => ({
            path: `data/table_${String(index).padStart(2, '0')}.csv`,
            tableName: `table_${String(index).padStart(2, '0')}`,
            status: 'M',
        }));
        await page.evaluate(compareFiles => {
            const mockWindow = window as unknown as {__mockGitBranchCompare: MockBranchCompareResult};
            mockWindow.__mockGitBranchCompare.files = compareFiles;
        }, files);
        await openBranchComparePanelAsync(page);
        await selectBranchByMouseAsync(page, '.branch-compare-base-input', LEFT_REF);
        await selectBranchByMouseAsync(page, '.branch-compare-target-input', RIGHT_REF);
        const panel = page.locator('.branch-compare-panel');
        const compareButton = panel.locator('.branch-compare-button');
        await compareButton.click();
        await expect(panel.locator('.branch-compare-file-item')).toHaveCount(80);

        const controls = panel.locator('.branch-compare-controls');
        const controlsTop = await controls.evaluate(element => element.getBoundingClientRect().top);
        const results = panel.locator('.branch-compare-results');
        await panel.locator('.branch-compare-file-item').first().hover();
        await page.mouse.wheel(0, 10000);
        await expect.poll(() => results.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
        await expect(panel.locator('.branch-compare-file-item').last()).toBeInViewport();
        expect(await controls.evaluate(element => element.getBoundingClientRect().top)).toBe(controlsTop);
        await expect(compareButton).toBeInViewport();
        await expect(panel.locator('.branch-compare-base-input')).toBeInViewport();
        const filterInput = panel.getByRole('textbox', {name: 'テーブル名でフィルタ', exact: true});
        await expect(filterInput).toBeInViewport();
        const swapBounds = await panel.locator('.branch-compare-swap-button').boundingBox();
        const compareBounds = await compareButton.boundingBox();
        const filterBounds = await filterInput.boundingBox();
        expect(swapBounds).not.toBeNull();
        expect(compareBounds).not.toBeNull();
        expect(filterBounds).not.toBeNull();
        expect(swapBounds!.y).toBe(compareBounds!.y);
        expect(swapBounds!.height).toBe(compareBounds!.height);
        expect(swapBounds!.x + swapBounds!.width).toBeLessThan(compareBounds!.x);
        expect(filterBounds!.y).toBeGreaterThan(compareBounds!.y + compareBounds!.height);
        expect(await panel.evaluate(element => element.scrollTop)).toBe(0);

        // 一覧末尾にいても固定欄から条件を変更し、再比較できる。
        await panel.getByRole('button', {name: '入れ替え', exact: true}).click();
        await expect(panel.locator('.branch-compare-base-input')).toHaveValue('feature/orders');
        await expect(panel.locator('.branch-compare-target-input')).toHaveValue('main');
        await compareButton.click();
        await expect(panel.locator('.branch-compare-file-item')).toHaveCount(80);
        await panel.locator('.branch-compare-file-item').first().hover();
        await page.mouse.wheel(0, 10000);
        await expect(panel.locator('.branch-compare-file-item').last()).toBeInViewport();
    });

    test('アクティブな一時差分タブを同じ位置で再利用し古い差分を破棄する', async ({page}) => {
        await page.locator('[data-panel="sourceControl"]').click();
        await page.locator('.source-control-changes-section .source-control-file-item').first().click();
        const sourceTab = page.locator('.tab-button[title="差分: modified"]');
        await expect(sourceTab).toHaveClass(/tab-button-active/);
        await expect(sourceTab).not.toHaveClass(/tab-button-preview/);
        await openBranchComparePanelAsync(page);
        await selectDefaultBranchesAndCompareAsync(page);
        await page.locator('.branch-compare-file-item[data-status="M"]').click();
        const modifiedTab = page.locator('.tab-button[title="差分: modified (main ↔ feature/orders)"]');
        await expect(modifiedTab).toHaveClass(/tab-button-preview/);
        await expect(modifiedTab.locator('.tab-button-name')).toHaveCSS('font-style', 'italic');
        await expect(page.locator('.diff-tab:visible .diff-pane-right')).toContainText('after');

        // 一時タブの右側に実テーブルを置き、入れ替え後もタブ順が変わらないことを確認する。
        await page.locator('.branch-compare-file-item[data-status="A"]').hover();
        await page.locator('.branch-compare-file-item[data-status="A"] .branch-compare-open-file').click();
        await expect(page.locator('.tab-button[title="added"]')).toHaveClass(/tab-button-active/);
        await modifiedTab.click();
        for (const [status, tableName, value, pane] of [['A', 'added', 'added-only', 'right'], ['D', 'deleted', 'deleted-only', 'left']] as const) {
            await page.locator(`.branch-compare-file-item[data-status="${status}"]`).click();
            await expect(page.locator(`.diff-tab:visible .diff-pane-${pane}`)).toContainText(value);
            await expect(page.locator('.tab-button .tab-button-name')).toHaveText([
                '差分: modified', `差分: ${tableName} (main ↔ feature/orders)`, 'added',
            ]);
            await expect(page.locator('.tab-button-preview')).toHaveCount(1);
            await expect(page.locator('.diff-tab')).toHaveCount(2);
        }
        await expect(modifiedTab).toHaveCount(0);
    });

    test('通常タブを経由して比較を開いても既存の一時タブを再利用する', async ({page}) => {
        await openBranchComparePanelAsync(page);
        await selectDefaultBranchesAndCompareAsync(page);
        const modifiedFile = page.locator('.branch-compare-file-item[data-status="M"]');
        await modifiedFile.click();
        const modifiedTab = page.locator('.tab-button[title="差分: modified (main ↔ feature/orders)"]');
        await expect(page.locator('.diff-tab:visible')).toBeVisible();
        await modifiedTab.locator('.tab-button-name').dblclick();
        await expect(modifiedTab).not.toHaveClass(/tab-button-preview/);
        await expect(modifiedTab.locator('.tab-button-name')).toHaveCSS('font-style', 'normal');
        await expect(modifiedTab).not.toHaveClass(/tab-button-pinned/);
        await page.locator('.branch-compare-file-item[data-status="A"]').click();
        await expect(page.locator('.diff-tab:visible')).toContainText('added-only');

        // 開いている通常タブへの再選択では重複も一時タブへの降格も起きない。
        await modifiedFile.click();
        await expect(modifiedTab).toHaveClass(/tab-button-active/);
        await expect(page.locator('.diff-tab:visible')).toContainText('after');
        await expect(modifiedTab).not.toHaveClass(/tab-button-preview/);
        await expect(page.locator('.tab-button')).toHaveCount(2);
        await page.locator('.branch-compare-file-item[data-status="D"]').click();
        await expect(page.locator('.diff-tab:visible')).toContainText('deleted-only');
        await expect(page.locator('.tab-button .tab-button-name')).toHaveText([
            '差分: modified (main ↔ feature/orders)', '差分: deleted (main ↔ feature/orders)',
        ]);
        await expect(page.locator('.tab-button-preview')).toHaveCount(1);
        await expect(page.locator('.diff-tab')).toHaveCount(2);

        await page.locator('.tab-button-active .tab-button-close').click();
        await expect(page.locator('.tab-button')).toHaveCount(1);
        await expect(page.locator('.diff-tab:visible')).toContainText('after');
    });

    test('一時差分から実テーブルを経由して別の比較を開くと元の一時タブの位置を再利用する', async ({page}) => {
        await openBranchComparePanelAsync(page);
        await selectDefaultBranchesAndCompareAsync(page);
        await page.locator('.branch-compare-file-item[data-status="M"]').click();
        await expect(page.locator('.diff-tab:visible')).toContainText('after');
        const addedFile = page.locator('.branch-compare-file-item[data-status="A"]');
        await addedFile.hover();
        await addedFile.locator('.branch-compare-open-file').click();
        await expect(page.locator('.tab-wrapper[data-tab-name="added"] .editor-table')).toBeVisible();
        await expect(page.locator('.tab-button[title="added"]')).toHaveClass(/tab-button-active/);

        await page.locator('.branch-compare-file-item[data-status="D"]').click();
        await expect(page.locator('.diff-tab:visible')).toContainText('deleted-only');
        await expect(page.locator('.tab-button .tab-button-name')).toHaveText([
            '差分: deleted (main ↔ feature/orders)', 'added',
        ]);
        await expect(page.locator('.tab-button-preview')).toHaveCount(1);
        await expect(page.locator('.diff-tab')).toHaveCount(1);

        await page.locator('.tab-button[title="added"]').click();
        await expect(page.locator('.tab-wrapper[data-tab-name="added"] .editor-table')).toBeVisible();
    });

    test('非アクティブな一時タブの入れ替え準備中にタブを移動すると表示を奪わない', async ({page}) => {
        await openBranchComparePanelAsync(page);
        await selectDefaultBranchesAndCompareAsync(page);
        await page.locator('.branch-compare-file-item[data-status="M"]').click();
        await expect(page.locator('.diff-tab:visible')).toContainText('after');
        const modifiedTab = page.locator('.tab-button[title="差分: modified (main ↔ feature/orders)"]');
        await modifiedTab.locator('.tab-button-name').dblclick();
        await page.locator('.branch-compare-file-item[data-status="A"]').click();
        await expect(page.locator('.diff-tab:visible')).toContainText('added-only');
        await modifiedTab.click();
        await expect(page.locator('.diff-tab:visible')).toContainText('after');

        await delayDiffWorkerMessagesAsync(page, 500);
        await page.locator('.branch-compare-file-item[data-status="D"]').click();
        await page.waitForFunction(() => (window as unknown as {__delayedDiffWorkerMessageCount: number}).__delayedDiffWorkerMessageCount > 0);
        await page.locator('.tab-button[title="差分: added (main ↔ feature/orders)"]').click();
        await expect(page.locator('.branch-compare-results')).toHaveAttribute('aria-busy', 'false');
        await expect(page.locator('.diff-tab:visible')).toContainText('added-only');
        await expect(page.locator('.tab-button .tab-button-name')).toHaveText([
            '差分: modified (main ↔ feature/orders)', '差分: added (main ↔ feature/orders)',
        ]);
        await expect(page.locator('.tab-button-preview')).toHaveCount(1);
    });

    test('通常化した差分と一時差分を復元して一時タブだけを再利用する', async ({page}) => {
        await openBranchComparePanelAsync(page);
        await selectDefaultBranchesAndCompareAsync(page);
        await page.locator('.branch-compare-file-item[data-status="M"]').click();
        await expect(page.locator('.diff-tab:visible')).toBeVisible();
        await page.locator('.tab-button-active .tab-button-name').dblclick();
        await page.locator('.branch-compare-file-item[data-status="A"]').click();
        await expect(page.locator('.diff-tab:visible')).toContainText('added-only');
        await expect.poll(async () => {
            const raw = await readMockFileAsync(page, UI_STATE_FILE);
            if (typeof raw !== 'string') return [];
            const state = JSON.parse(raw);
            return state.tabs.open.map((tab: {preview?: boolean}) => tab.preview === true);
        }).toEqual([false, true]);

        await page.reload();
        await expect(page.locator('.diff-tab:visible')).toContainText('added-only');
        await expect(page.locator('.tab-button-active')).toHaveClass(/tab-button-preview/);
        await expect(page.locator('.tab-button[title="差分: modified (main ↔ feature/orders)"]')).not.toHaveClass(/tab-button-preview/);
        await expect(page.locator('.branch-compare-file-item')).toHaveCount(3);
        await page.locator('.tab-button[title="差分: modified (main ↔ feature/orders)"]').click();
        await expect(page.locator('.diff-tab:visible')).toContainText('after');
        await page.locator('.branch-compare-file-item[data-status="D"]').click();
        await expect(page.locator('.diff-tab:visible')).toContainText('deleted-only');
        await expect(page.locator('.tab-button .tab-button-name')).toHaveText([
            '差分: modified (main ↔ feature/orders)', '差分: deleted (main ↔ feature/orders)',
        ]);
    });

    test('一時差分タブをピン留めすると通常化し別テーブルで上書きしない', async ({page}) => {
        await openBranchComparePanelAsync(page);
        await selectDefaultBranchesAndCompareAsync(page);
        await page.locator('.branch-compare-file-item[data-status="M"]').click();
        await expect(page.locator('.diff-tab:visible')).toBeVisible();
        const modifiedTab = page.locator('.tab-button-active');
        await modifiedTab.click({button: 'right'});
        await page.locator('.context-menu-item', {hasText: 'タブを固定'}).click();
        await expect(modifiedTab).toHaveClass(/tab-button-pinned/);
        await expect(modifiedTab).not.toHaveClass(/tab-button-preview/);
        await page.locator('.branch-compare-file-item[data-status="A"]').click();
        await expect(page.locator('.diff-tab:visible')).toContainText('added-only');
        await expect(page.locator('.tab-button')).toHaveCount(2);
        await expect(page.locator('.tab-button-pinned')).toContainText('差分: modified');
    });

    test('別テーブルの読み込み失敗時は元の一時差分タブを残す', async ({page}) => {
        await openBranchComparePanelAsync(page);
        await selectDefaultBranchesAndCompareAsync(page);
        await page.locator('.branch-compare-file-item[data-status="M"]').click();
        await expect(page.locator('.diff-tab:visible')).toContainText('after');
        await page.evaluate(() => {
            const files = (window as unknown as {__mockGitCommitFiles: Record<string, Record<string, string>>}).__mockGitCommitFiles;
            files['2222222']['schema/added.json'] = '{}';
        });
        await page.locator('.branch-compare-file-item[data-status="A"]').click();
        await expect(page.locator('.notification-toast-error')).toContainText('スキーマが不正です');
        await expect(page.locator('.tab-button')).toHaveCount(1);
        await expect(page.locator('.tab-button-active')).toHaveClass(/tab-button-preview/);
        await expect(page.locator('.diff-tab:visible')).toContainText('after');
    });

    test('一時タブ入れ替えのworkerをキャンセルすると元の差分を残し連続選択では最後の差分だけ開く', async ({page}) => {
        await openBranchComparePanelAsync(page);
        await selectDefaultBranchesAndCompareAsync(page);
        await page.locator('.branch-compare-file-item[data-status="M"]').click();
        await expect(page.locator('.diff-tab:visible')).toContainText('after');
        await delayDiffWorkerMessagesAsync(page, 500);
        await page.locator('.branch-compare-file-item[data-status="A"]').click();
        await page.waitForFunction(() => (window as unknown as {__delayedDiffWorkerMessageCount: number}).__delayedDiffWorkerMessageCount > 0);
        await page.locator('.branch-compare-target-input').fill('changed');
        await page.waitForTimeout(600);
        await expect(page.locator('.tab-button')).toHaveCount(1);
        await expect(page.locator('.diff-tab:visible')).toContainText('after');

        await page.locator('.branch-compare-target-input').fill('');
        await selectDefaultBranchesAndCompareAsync(page);
        await page.locator('.branch-compare-file-item[data-status="A"]').click();
        await page.waitForFunction(() => (window as unknown as {__delayedDiffWorkerMessageCount: number}).__delayedDiffWorkerMessageCount > 1);
        await page.locator('.branch-compare-file-item[data-status="D"]').click();
        await expect(page.locator('.diff-tab:visible')).toContainText('deleted-only');
        await expect(page.locator('.tab-button')).toHaveCount(1);
        await expect(page.locator('.diff-tab')).toHaveCount(1);
    });

    test('入れ替え準備中にダブルクリックした一時タブは破棄しない', async ({page}) => {
        await openBranchComparePanelAsync(page);
        await selectDefaultBranchesAndCompareAsync(page);
        await page.locator('.branch-compare-file-item[data-status="M"]').click();
        await expect(page.locator('.diff-tab:visible')).toContainText('after');
        await delayDiffWorkerMessagesAsync(page, 500);
        await page.locator('.branch-compare-file-item[data-status="A"]').click();
        await page.waitForFunction(() => (window as unknown as {__delayedDiffWorkerMessageCount: number}).__delayedDiffWorkerMessageCount > 0);
        await page.locator('.tab-button-active .tab-button-name').dblclick();
        await expect(page.locator('.diff-tab:visible')).toContainText('added-only');
        await expect(page.locator('.tab-button')).toHaveCount(2);
        await expect(page.locator('.tab-button-preview')).toHaveCount(1);
        await expect(page.locator('.tab-button[title="差分: modified (main ↔ feature/orders)"]')).not.toHaveClass(/tab-button-preview/);
    });

    test('テーブル内検索は左右の固定リビジョンを検索し現在ファイルのキャッシュと混同しない', async ({page}) => {
        await page.evaluate(() => {
            const files = (window as unknown as {__mockGitCommitFiles: Record<string, Record<string, string>>}).__mockGitCommitFiles;
            files['2222222']['data/modified.csv'] = 'id,name,value\n1,revision-only,150';
        });
        await openBranchComparePanelAsync(page);
        await selectDefaultBranchesAndCompareAsync(page);
        await page.locator('.branch-compare-file-item[data-status="M"]').click();
        const diff = page.locator('.diff-tab:visible');
        const left = diff.locator('.diff-pane-left');
        const right = diff.locator('.diff-pane-right');
        const input = diff.locator('.editor-table-find-input');
        const count = diff.locator('.editor-table-find-count');
        for (const [pane, ownValue, otherValue] of [[left, 'before', 'revision-only'], [right, 'revision-only', 'before']] as const) {
            await pane.locator('.editor-table-cell').filter({hasText: new RegExp(`^${ownValue}$`)}).click();
            await page.keyboard.press('Control+f');
            await expect(pane.locator('.editor-table-find-input')).toBeFocused();
            await input.fill(ownValue);
            await expect(count).toHaveText('1/1');
            const match = pane.locator('.editor-table-cell-find-current');
            await expect(match).toHaveText(ownValue);
            await expect(match).toHaveCSS('background-color', 'rgba(255, 193, 7, 0.38)');
            await expect(diff.locator('.editor-table-cell-find-match')).toHaveCount(1);
            await expect.poll(() => pane.locator('canvas.scrollbar-marker-track').evaluate((canvas: HTMLCanvasElement) => {
                const context = canvas.getContext('2d')!;
                const pixels = context.getImageData(Math.floor(canvas.width / 2), 0, 1, canvas.height).data;
                for (let i = 0; i < pixels.length; i += 4) {
                    if (pixels[i] > 240 && pixels[i + 1] > 180 && pixels[i + 1] < 205 && pixels[i + 2] < 20) return true;
                }
                return false;
            })).toBe(true);
            await input.fill(otherValue);
            await expect(count).toHaveText('0/0');
            await input.fill('after');
            await expect(count).toHaveText('0/0');
            await input.fill(ownValue);
            await expect(count).toHaveText('1/1');
        }
        await page.keyboard.press('Escape');
        await expect(diff.locator('.editor-table-find-bar')).not.toBeVisible();
        await expect(diff.locator('.editor-table-cell-find-match')).toHaveCount(0);
        await page.keyboard.press('Delete');
        await page.keyboard.press('Control+s');
        await expect(right.locator('.editor-table-cell').filter({hasText: /^revision-only$/})).toBeVisible();
        expect(await readMockFileAsync(page, 'data/modified.csv')).toBe(COMMIT_FILES[RIGHT_SHA]['data/modified.csv']);
    });

    test('テーブル内検索で画面外の結果へ前後移動し位置合わせ用の空行を除外する', async ({page}) => {
        await page.evaluate(() => {
            const files = (window as unknown as {__mockGitCommitFiles: Record<string, Record<string, string>>}).__mockGitCommitFiles;
            const rows = Array.from({length: 400}, (_, i) => `${i + 1},${i === 299 || i === 389 ? 'Needle' : 'row'},100`);
            files['1111111']['data/modified.csv'] = 'id,name,value\n' + rows.join('\n');
            files['2222222']['data/modified.csv'] = 'id,name,value\n' + rows.filter((_, i) => i !== 0).join('\n') + '\n401,,200';
        });
        await openBranchComparePanelAsync(page);
        await selectDefaultBranchesAndCompareAsync(page);
        await page.locator('.branch-compare-file-item[data-status="M"]').click();
        const diff = page.locator('.diff-tab:visible');
        const left = diff.locator('.diff-pane-left');
        const right = diff.locator('.diff-pane-right');
        await expect(left.locator('.editor-table-cell').filter({hasText: /^Needle$/})).toHaveCount(0);
        await left.locator('.editor-table-cell').filter({hasText: /^row$/}).first().click();
        await page.keyboard.press('Control+f');
        const input = diff.locator('.editor-table-find-input');
        const count = diff.locator('.editor-table-find-count');
        await input.fill('Needle');
        await expect(count).toHaveText('1/2');
        await expect(left.locator('.editor-table-cell-find-current')).toBeInViewport();
        await expect(left.locator('.editor-table-cell-find-current').locator('..')).toHaveAttribute('data-row-index', '299');
        await input.press('Enter');
        await expect(count).toHaveText('2/2');
        await expect(left.locator('.editor-table-cell-find-current')).toBeInViewport();
        await expect(left.locator('.editor-table-cell-find-current').locator('..')).toHaveAttribute('data-row-index', '389');
        await input.press('Shift+Enter');
        await expect(count).toHaveText('1/2');
        await expect(left.locator('.editor-table-cell-find-current').locator('..')).toHaveAttribute('data-row-index', '299');
        // 左の追加行用空白と、右の削除行用空白は除外し、実データの空セルだけに一致する。
        await diff.getByTitle('正規表現', {exact: true}).click();
        await input.fill('^$');
        await expect(count).toHaveText('0/0');
        await right.locator('.editor-table-cell').filter({hasText: /^Needle$/}).first().click();
        await expect(diff.locator('.editor-table-find-bar')).toHaveCount(0);
        await page.keyboard.press('Control+f');
        await expect(count).toHaveText('1/1');
        await expect(right.locator('.editor-table-cell-find-current')).toBeInViewport();
        await expect(right.locator('.editor-table-cell-find-current').locator('..')).not.toHaveClass(/diff-row-empty/);
    });

    test('テーブル内検索の列名オプションと差分切替・終了時の後片付けが機能する', async ({page}) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await openBranchComparePanelAsync(page);
        await selectDefaultBranchesAndCompareAsync(page);
        await page.locator('.branch-compare-file-item[data-status="M"]').click();
        const diff = page.locator('.diff-tab:visible');
        await diff.locator('.diff-pane-left .editor-table-cell').filter({hasText: /^before$/}).click();
        await page.keyboard.press('Control+f');
        const input = diff.locator('.editor-table-find-input');
        await input.fill('name');
        await expect(diff.locator('.editor-table-find-count')).toHaveText('1/1');
        await expect(diff.locator('.diff-pane-left .editor-table-column-header-find-match:visible').first()).toContainText('name');
        await expect(diff.locator('.diff-pane-right .editor-table-column-header-find-match')).toHaveCount(0);
        await diff.getByTitle('列名と列の説明を検索対象に含める').click();
        await expect(diff.locator('.editor-table-find-count')).toHaveText('0/0');
        await input.fill('before');
        await expect(diff.locator('.editor-table-find-count')).toHaveText('1/1');
        await page.locator('.branch-compare-file-item[data-status="D"]').click();
        await expect(page.locator('.editor-table-find-bar-visible')).toHaveCount(0);
        await expect(page.locator('.editor-table-cell-find-match')).toHaveCount(0);
        await diff.locator('.diff-pane-left .editor-table-cell').filter({hasText: /^deleted-only$/}).click();
        await page.keyboard.press('Control+f');
        await input.fill('deleted-only');
        await expect(diff.locator('.editor-table-find-count')).toHaveText('1/1');
        await expect(diff.locator('.editor-table-cell-find-current')).toHaveCSS('background-color', 'rgba(255, 193, 7, 0.38)');
        // 検索待機中にタブを閉じても、解除済みのストアやDOMを参照しない。
        await input.fill('another');
        await page.locator('.tab-button-active .tab-button-close').click();
        await expect(page.locator('.editor-table-find-bar')).toHaveCount(0);
        await expect(page.locator('.editor-table-cell-find-match')).toHaveCount(0);
        expect(errors).toEqual([]);
    });

    test('左側はファイル一覧だけを表示し、変更者を左右の差分セルホバーで確認できる', async ({page}) => {
        await openBranchComparePanelAsync(page);
        await selectDefaultBranchesAndCompareAsync(page);
        await page.locator('.branch-compare-file-item[data-status="M"]').click();
        await expect(page.locator('.diff-tab:visible')).toBeVisible();
        await expect(page.locator('.branch-compare-file-item')).toHaveCount(3);
        await expect(page.locator('.branch-compare-cell-item, .branch-compare-cells')).toHaveCount(0);
        for (const [side, value] of [['left', 'before'], ['right', 'after']]) {
            const gridCell = page.locator(`.diff-tab:visible .diff-pane-${side} .editor-table-cell`).filter({hasText: new RegExp(`^${value}$`)});
            await gridCell.hover();
            await expect(page.locator('.branch-compare-cell-tooltip:visible')).toHaveAttribute('role', 'tooltip');
            await expect(page.locator('.branch-compare-cell-tooltip:visible')).toHaveText(/比較先の最終変更者: 名前担当/);
            await expect(gridCell).not.toHaveAttribute('title', /変更者|担当/);
        }
        await expect(page.locator('.branch-compare-panel')).not.toContainText('名前担当');
        await expect(page.getByRole('button', {name: /変更者リスト/})).toHaveCount(0);
        await expect(page.locator('.branch-compare-author-list')).toHaveCount(0);
        await expect(page.locator('.tab-button', {hasText: '変更者リスト'})).toHaveCount(0);
        const requests = await page.evaluate(() => (window as unknown as {__mockGitCellBlameRequests: unknown[]}).__mockGitCellBlameRequests);
        expect(requests).toEqual([expect.objectContaining({filename: 'data/modified.csv', commit: RIGHT_SHA, primaryKey: ['id'], cells: [{lineNumber: 2, columnName: 'name'}, {lineNumber: 2, columnName: 'value'}]})]);
    });

    test('変更者ホバーへマウスを移して保持し、選択した文字をコピーして離れると閉じる', async ({page}) => {
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        await openBranchComparePanelAsync(page);
        await selectDefaultBranchesAndCompareAsync(page);
        await page.locator('.branch-compare-file-item[data-status="M"]').click();
        const right = page.locator('.diff-tab:visible .diff-pane-right');
        const nameCell = right.locator('.editor-table-cell').filter({hasText: /^after$/});
        // グリッドの選択状態を作り、コピーの横取りも検出する。
        await nameCell.click();
        await nameCell.hover();
        const popup = page.locator('.branch-compare-cell-tooltip:visible');
        await expect(popup).toContainText('名前担当');
        const borderColor = await popup.evaluate(element => getComputedStyle(element).borderColor);
        const popupBounds = await popup.boundingBox();
        if (popupBounds === null) throw new Error('変更者ホバーが表示されていません');
        await page.mouse.move(popupBounds.x + 10, popupBounds.y + 10, {steps: 12});
        await page.waitForTimeout(700);
        await expect(popup).toBeVisible();
        const textBounds = await getHoverTextBoundsAsync(page, '名前担当');
        await page.mouse.move(textBounds.x + 0.5, textBounds.y + textBounds.height / 2);
        await page.mouse.down();
        await page.mouse.move(textBounds.x + textBounds.width - 0.5, textBounds.y + textBounds.height / 2, {steps: 8});
        await page.mouse.up();
        await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('名前担当');
        await expect(popup).toBeFocused();
        await expect(popup).toHaveCSS('outline-style', 'none');
        await expect(popup).toHaveCSS('border-color', borderColor);
        await page.evaluate(() => navigator.clipboard.writeText('before-copy'));
        await page.keyboard.press('Control+c');
        await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('名前担当');
        await expect(popup).toBeVisible();
        await page.locator('.branch-compare-panel .sidebar-panel-header').hover();
        await expect(popup).toHaveCount(0);
        const valueCell = right.locator('.editor-table-cell').filter({hasText: /^150$/});
        await valueCell.hover();
        await expect(popup).toContainText('数値担当');
        await expect(popup).not.toContainText('名前担当');
        await page.locator('.branch-compare-panel .sidebar-panel-header').hover();
        await expect(popup).toHaveCount(0);
        await valueCell.click();
        await page.keyboard.press('Control+c');
        await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('150');
    });

    test('短いホバーでは表示せず、隣の変更セルを横切って本文に入っても内容と位置を維持する', async ({page}) => {
        await page.evaluate(() => {
            const mock = window as unknown as {__mockGitCommitFiles: Record<string, Record<string, string>>};
            mock.__mockGitCommitFiles['1111111']['data/modified.csv'] += '\n2,next-before,200';
            mock.__mockGitCommitFiles['2222222']['data/modified.csv'] += '\n2,next-after,250';
        });
        await openBranchComparePanelAsync(page);
        await selectDefaultBranchesAndCompareAsync(page);
        await page.locator('.branch-compare-file-item[data-status="M"]').click();
        const right = page.locator('.diff-tab:visible .diff-pane-right');
        const nameCell = right.locator('.editor-table-cell').filter({hasText: /^after$/});
        const popup = page.locator('.branch-compare-cell-tooltip:visible');
        await nameCell.hover();
        await page.waitForTimeout(100);
        expect(await popup.count()).toBe(0);
        await page.locator('.branch-compare-panel .sidebar-panel-header').hover();
        await page.waitForTimeout(600);
        await expect(popup).toHaveCount(0);

        await nameCell.hover();
        await expect(popup).toContainText('名前担当');
        const beforeText = await popup.textContent();
        const beforeBounds = await popup.boundingBox();
        const cellBounds = await nameCell.boundingBox();
        if (beforeBounds === null || cellBounds === null) throw new Error('セルまたはホバーが表示されていません');
        // セルとホバーの6pxの余白には、次の行の変更セルがある。
        const gap = {x: cellBounds.x + 10, y: cellBounds.y + cellBounds.height + 3};
        expect(await page.evaluate(point => document.elementFromPoint(point.x, point.y)?.closest('.editor-table-cell')?.textContent, gap)).toBe('next-after');
        await page.mouse.move(gap.x, gap.y);
        await page.mouse.move(beforeBounds.x + 10, beforeBounds.y + 10);
        await page.waitForTimeout(700);
        await expect(popup).toHaveText(beforeText!);
        expect(await popup.boundingBox()).toEqual(beforeBounds);
        await expect(nameCell).toHaveAttribute('aria-describedby', await popup.getAttribute('id') as string);

        // 次のセルに留まる場合は待ち時間の後にそのセルの履歴へ切り替わる。
        const valueCell = right.locator('.editor-table-cell').filter({hasText: /^150$/});
        await valueCell.hover();
        expect(await popup.textContent()).toBe(beforeText);
        await expect(popup).toContainText('数値担当');
    });

    for (const action of ['タブ切替', 'タブを閉じる', '差分スクロール'] as const) {
        test(`変更者ホバー上にカーソルがあっても${action}で表示を片付ける`, async ({page}) => {
            await page.evaluate(() => {
                const mock = window as unknown as {__mockGitCommitFiles: Record<string, Record<string, string>>; __mockGitCellBlameDelayMs: number};
                const rows = Array.from({length: 200}, (_, index) => `${index + 2},unchanged,100`).join('\n');
                mock.__mockGitCommitFiles['1111111']['data/modified.csv'] += '\n' + rows;
                mock.__mockGitCommitFiles['2222222']['data/modified.csv'] += '\n' + rows;
                mock.__mockGitCellBlameDelayMs = 1000;
            });
            await openBranchComparePanelAsync(page);
            await selectDefaultBranchesAndCompareAsync(page);
            await page.locator('.branch-compare-file-item[data-status="A"]').click();
            const otherTab = page.locator('.tab-button', {hasText: '差分: added (main ↔ feature/orders)'});
            await expect(otherTab).toBeVisible();
            await otherTab.locator('.tab-button-name').dblclick();
            await page.locator('.branch-compare-file-item[data-status="M"]').click();
            const right = page.locator('.diff-tab:visible .diff-pane-right');
            await right.locator('.editor-table-cell').filter({hasText: /^after$/}).hover();
            const popup = page.locator('.branch-compare-cell-tooltip:visible');
            await expect(popup).toContainText('変更者を取得中');
            await popup.hover();
            // マウスを外さず操作し、単なるmouseleaveで閉じていないことを確かめる。
            if (action === 'タブ切替') await otherTab.evaluate(element => (element as HTMLElement).click());
            else if (action === 'タブを閉じる') await page.locator('.tab-button-active .tab-button-close').evaluate(element => (element as HTMLElement).click());
            else await right.evaluate(element => { element.scrollTop = 240; });
            await expect(popup).toHaveCount(0);
            await page.waitForTimeout(1300);
            await expect(popup).toHaveCount(0);
        });
    }

    test('長い変更履歴も画面内で折り返し、ホバー内をスクロールして最後まで読める', async ({page}) => {
        await page.setViewportSize({width: 1000, height: 500});
        await page.evaluate(() => {
            const entries = (window as unknown as {__mockGitCellBlame: Record<string, Record<string, Array<{commitMessage: string}>>>}).__mockGitCellBlame['2222222']['data/modified.csv'];
            for (const entry of entries) entry.commitMessage = '長い履歴' + 'x'.repeat(600) + '\n' + Array.from({length: 40}, (_, index) => `変更理由 ${index + 1}`).join('\n') + '\n最終行の説明';
        });
        await openBranchComparePanelAsync(page);
        await selectDefaultBranchesAndCompareAsync(page);
        await page.locator('.branch-compare-file-item[data-status="M"]').click();
        await page.locator('.diff-tab:visible .diff-pane-right .editor-table-cell').filter({hasText: /^after$/}).hover();
        const popup = page.locator('.branch-compare-cell-tooltip:visible');
        await expect(popup).toContainText('最終行の説明');
        const bounds = await popup.boundingBox();
        if (bounds === null) throw new Error('変更者ホバーが表示されていません');
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.y).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(1000);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(500);
        expect(await popup.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
        expect(await popup.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
        await popup.hover();
        await page.mouse.wheel(0, 10000);
        await expect.poll(() => popup.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
        const lastLine = await getHoverTextBoundsAsync(page, '最終行の説明');
        expect(lastLine.y).toBeGreaterThanOrEqual(bounds.y);
        expect(lastLine.y + lastLine.height).toBeLessThanOrEqual(bounds.y + bounds.height);
        await expect(popup).toBeVisible();
    });

    for (const delayed of [false, true]) {
        test(delayed ? 'bool変更セル内のSVGへ移動しても遅れて届いた変更者を表示する' : 'bool変更セルのSVGを直接ホバーして変更者を確認できる', async ({page}) => {
            await page.evaluate(delayMs => {
                const mock = window as unknown as {
                    __mockGitCommitFiles: Record<string, Record<string, string>>;
                    __mockGitCellBlameDelayMs: number;
                };
                const schema = JSON.stringify({header: [{key: 0, name: 'id', type: 'int'}, {key: 1, name: 'name', type: 'string'}, {key: 2, name: 'value', type: 'bool'}], primary_key: ['id']});
                for (const commit of ['1111111', '2222222']) mock.__mockGitCommitFiles[commit]['schema/modified.json'] = schema;
                mock.__mockGitCommitFiles['1111111']['data/modified.csv'] = 'id,name,value\n1,same,0';
                mock.__mockGitCommitFiles['2222222']['data/modified.csv'] = 'id,name,value\n1,same,1';
                mock.__mockGitCellBlameDelayMs = delayMs;
            }, delayed ? 2000 : 0);
            await openBranchComparePanelAsync(page);
            await selectDefaultBranchesAndCompareAsync(page);
            await page.locator('.branch-compare-file-item[data-status="M"]').click();
            const gridCell = page.locator('.diff-tab:visible .diff-pane-right .editor-table-cell[data-col="2"][data-raw-value="1"]');
            const checkPath = gridCell.locator('.cell-bool-check path');
            await expect(checkPath).toBeVisible();
            if (delayed) {
                // セルの余白からSVGへ移動し、セル内のmouseout後も履歴到着を待てることを確認する。
                await gridCell.hover({position: {x: 2, y: 2}});
                await expect(page.locator('.branch-compare-cell-tooltip:visible')).toHaveText(/変更者を取得中/);
            }
            await checkPath.hover();
            if (delayed) await page.locator('.branch-compare-cell-tooltip:visible').hover();
            await expect(page.locator('.branch-compare-cell-tooltip:visible')).toHaveText(/比較先の最終変更者: 数値担当/);
        });
    }

    test('追加・削除で表示行がずれても元CSVに対応する変更者をセルホバーで確認できる', async ({page}) => {
        await page.evaluate(() => {
            const mock = window as unknown as {
                __mockGitCommitFiles: Record<string, Record<string, string>>;
                __mockGitCellBlame: Record<string, Record<string, object[]>>;
                __mockGitCellDeletions: Record<string, Record<string, object[]>>;
            };
            mock.__mockGitCommitFiles['1111111']['data/modified.csv'] = 'id,name,value\n1,removed,10\n3,before,30';
            mock.__mockGitCommitFiles['2222222']['data/modified.csv'] = 'id,name,value\n3,after,35\n2,inserted,20';
            mock.__mockGitCellBlame['1111111']['data/modified.csv'] = ['id', 'name', 'value'].map(columnName => ({lineNumber: 2, columnName, author: '削除前の編集者', date: '', commitHash: '1111111', commitMessage: ''}));
            mock.__mockGitCellDeletions['1111111:2222222']['data/modified.csv'] = ['id', 'name', 'value'].map(columnName => ({lineNumber: 2, columnName, author: '削除行の担当', date: '2026-09-05', commitHash: 'ddddddd', commitMessage: '不要行を削除'}));
            mock.__mockGitCellBlame['2222222']['data/modified.csv'] = [2, 3].flatMap(lineNumber => ['id', 'name', 'value'].map(columnName => ({lineNumber, columnName, author: lineNumber === 2 ? '更新行の担当' : '追加行の担当', date: '', commitHash: '2222222', commitMessage: ''})));
        });
        await openBranchComparePanelAsync(page);
        await selectDefaultBranchesAndCompareAsync(page);
        await page.locator('.branch-compare-file-item[data-status="M"]').click();
        const removed = page.locator('.diff-tab:visible .diff-pane-left .editor-table-cell').filter({hasText: /^removed$/});
        await removed.hover();
        await expect(page.locator('.branch-compare-cell-tooltip:visible')).toHaveText('1L:name（元CSV 2行）\n削除した人: 削除行の担当\n2026-09-05\nddddddd\n不要行を削除');
        const inserted = page.locator('.diff-tab:visible .diff-pane-right .editor-table-cell').filter({hasText: /^inserted$/});
        await inserted.hover();
        await expect(page.locator('.branch-compare-cell-tooltip:visible')).toHaveText(/2L:name（元CSV 3行）[\s\S]*追加行の担当/);
        // ホバーが覆う隣接セルへ移るときは、いったん外側へ出て表示を閉じる。
        await page.locator('.branch-compare-panel .sidebar-panel-header').hover();
        await expect(page.locator('.branch-compare-cell-tooltip:visible')).toHaveCount(0);
        const modified = page.locator('.diff-tab:visible .diff-pane-right .editor-table-cell').filter({hasText: /^after$/});
        await modified.hover();
        await expect(page.locator('.branch-compare-cell-tooltip:visible')).toHaveText(/3L:name（元CSV 2行）[\s\S]*更新行の担当/);
        const requests = await page.evaluate(() => (window as unknown as {__mockGitCellBlameRequests: unknown[]}).__mockGitCellBlameRequests);
        expect(requests).toContainEqual(expect.objectContaining({filename: 'data/modified.csv', commit: LEFT_SHA, deletionTargetCommit: RIGHT_SHA, primaryKey: ['id'], cells: ['id', 'name', 'value'].map(columnName => ({lineNumber: 2, columnName}))}));
    });

    test('ファイル全体を削除した人を削除セルのホバーで確認できる', async ({page}) => {
        await openBranchComparePanelAsync(page);
        await selectDefaultBranchesAndCompareAsync(page);
        await page.locator('.branch-compare-file-item[data-status="D"]').click();
        const cell = page.locator('.diff-tab:visible .diff-pane-left .editor-table-cell').filter({hasText: /^deleted-only$/});
        await cell.hover();
        await expect(page.locator('.branch-compare-cell-tooltip:visible')).toHaveText(/削除した人: 削除担当/);
        await expect(page.locator('.branch-compare-cell-item')).toHaveCount(0);
    });

    test('巨大差分の仮想スクロール外のセルでも履歴を特定できないことをホバーで確認できる', async ({page}) => {
        await page.evaluate(() => {
            const mock = window as unknown as {
                __mockGitCommitFiles: Record<string, Record<string, string>>;
                __mockGitCellBlame?: unknown;
            };
            delete mock.__mockGitCellBlame;
            const rows = Array.from({length: 50001}, (_, index) => `${index + 1},row-${index + 1},100`);
            mock.__mockGitCommitFiles['1111111']['data/modified.csv'] = 'id,name,value\n' + rows.join('\n');
            rows[50000] = '50001,last-changed,999';
            mock.__mockGitCommitFiles['2222222']['data/modified.csv'] = 'id,name,value\n' + rows.join('\n');
        });
        await openBranchComparePanelAsync(page);
        await selectDefaultBranchesAndCompareAsync(page);
        await page.locator('.branch-compare-file-item[data-status="M"]').click();
        const right = page.locator('.diff-tab:visible .diff-pane-right');
        await expect(right).toBeVisible();
        await right.evaluate(pane => { pane.scrollTop = Number.MAX_SAFE_INTEGER; });
        const cell = right.locator('.editor-table-cell').filter({hasText: /^last-changed$/});
        await expect(cell).toBeVisible();
        await cell.hover();
        await expect(page.locator('.branch-compare-cell-tooltip:visible')).toHaveText(/50001L:name[\s\S]*履歴から特定できませんでした/);
    });

    test('10万行超の差分でも末尾の変更セルを元CSV行付きでホバー表示する', async ({page}) => {
        await page.evaluate(() => {
            const mock = window as unknown as {
                __mockGitBranchCompare: MockBranchCompareResult;
                __mockGitCommitFiles: Record<string, Record<string, string>>;
                __mockGitCellBlame: Record<string, Record<string, object[]>>;
            };
            mock.__mockGitBranchCompare.files = [mock.__mockGitBranchCompare.files[0]];
            const rows = Array.from({length: 100001}, (_, index) => `${index + 1},row-${index + 1},100`);
            mock.__mockGitCommitFiles['1111111']['data/modified.csv'] = 'id,name,value\n' + rows.join('\n');
            rows[100000] = '100001,last-changed,999';
            mock.__mockGitCommitFiles['2222222']['data/modified.csv'] = 'id,name,value\n' + rows.join('\n');
            mock.__mockGitCellBlame['2222222']['data/modified.csv'] = ['name', 'value'].map(columnName => ({lineNumber: 100002, columnName, author: '末尾担当', date: '2026-09-05', commitHash: '2222222', commitMessage: '末尾更新'}));
        });
        await openBranchComparePanelAsync(page);
        await selectBranchByMouseAsync(page, '.branch-compare-base-input', LEFT_REF);
        await selectBranchByMouseAsync(page, '.branch-compare-target-input', RIGHT_REF);
        await page.locator('.branch-compare-button').click();
        await expect(page.locator('.branch-compare-file-item')).toHaveCount(1);
        await page.locator('.branch-compare-file-item[data-status="M"]').click();
        const right = page.locator('.diff-tab:visible .diff-pane-right');
        await expect(right).toBeVisible();
        await right.evaluate(pane => { pane.scrollTop = Number.MAX_SAFE_INTEGER; });
        for (const [column, value] of [['name', 'last-changed'], ['value', '999']]) {
            const cell = right.locator('.editor-table-cell').filter({hasText: new RegExp(`^${value}$`)});
            await expect(cell).toBeVisible();
            await cell.hover();
            await expect(page.locator('.branch-compare-cell-tooltip:visible')).toHaveText(`100001L:${column}（元CSV 100002行）\n比較先の最終変更者: 末尾担当\n2026-09-05\n2222222\n末尾更新`);
        }
    });

    test('アクティビティーバーの新アイコンから比較元・比較先の2入力を持つパネルを開ける', async ({page}) => {
        const activityItem = page.locator('.activity-bar-item[data-panel="branchCompare"]');
        await expect(activityItem).toBeVisible();

        await activityItem.click();

        const panel = page.locator('.branch-compare-panel');
        await expect(panel).toBeVisible();
        await expect(panel.locator('.sidebar-panel-header')).toHaveText('REVISION COMPARE');
        await expect(panel.locator('.branch-compare-base-input')).toHaveAttribute('placeholder', 'ブランチ / コミットID');
        await expect(panel.locator('.branch-compare-target-input')).toHaveAttribute('placeholder', 'ブランチ / コミットID');
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
        await expect(branchCompareItem).toHaveAttribute('aria-label', 'リビジョン比較');
        await expect(branchCompareItem).toHaveAttribute('title', 'リビジョン比較');
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
        await expect(page.locator('.notification-toast-error')).toHaveText('branch list failed');
        await expect(page.locator('.branch-compare-suggestions')).toBeHidden();
        await expect(baseInput).toHaveAttribute('aria-expanded', 'false');
    });

    test('比較元と比較先のラベルでは入力が反応せず入力枠のクリックで候補を開く', async ({page}) => {
        await openBranchComparePanelAsync(page);
        const inputs = page.locator('.branch-compare-controls').getByRole('combobox');
        const suggestions = page.locator('.branch-compare-suggestions');
        for (const inputId of ['branch-compare-base-input', 'branch-compare-target-input']) {
            await page.locator(`label[for="${inputId}"]`).click();
            for (const input of await inputs.all()) {
                await expect(input).not.toBeFocused();
                await expect(input).toHaveAttribute('aria-expanded', 'false');
            }
            await expect(suggestions).toBeHidden();
            const input = page.locator(`#${inputId}`);
            await input.click();
            await expect(input).toBeFocused();
            await expect(input).toHaveAttribute('aria-expanded', 'true');
            await expect(suggestions).toBeVisible();
            await page.locator('.branch-compare-panel .sidebar-panel-header').click();
        }
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
        const actionBounds = await page.locator('.branch-compare-actions').evaluate(element => ({left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right, top: element.getBoundingClientRect().top}));
        for (const selector of ['.branch-compare-export-filter-label', '.branch-compare-swap-button', '.branch-compare-button']) {
            const bounds = await page.locator(selector).evaluate(element => ({left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right, top: element.getBoundingClientRect().top}));
            expect(bounds.left).toBeGreaterThanOrEqual(actionBounds.left);
            expect(bounds.right).toBeLessThanOrEqual(actionBounds.right);
            expect(bounds.top).toBe(actionBounds.top);
        }
        await page.locator('.branch-compare-button').click();
        const fileItem = page.locator('.branch-compare-file-item');
        await expect(fileItem).toHaveAttribute('title', longPath);
        await expect(fileItem).toHaveAttribute('aria-label', new RegExp(longPath));
        expect(await fileItem.locator('.branch-compare-file-name').evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
        await fileItem.click();
        await expect(fileItem).toHaveAttribute('aria-current', 'true');
        await expect(fileItem).toHaveCSS('outline-style', 'solid');
        await expect(fileItem).toHaveCSS('box-shadow', 'none');
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

    test('Tabでactive候補を確定して比較元から比較先、出力時刻、入れ替え、比較、フィルタへフォーカスを進める', async ({page}) => {
        await openBranchComparePanelAsync(page);

        const baseInput = page.locator('.branch-compare-base-input');
        const targetInput = page.locator('.branch-compare-target-input');
        const exportFilterToggle = page.getByRole('checkbox', {name: '出力時刻でフィルタ'});
        const swapButton = page.getByRole('button', {name: '入れ替え', exact: true});
        const compareButton = page.locator('.branch-compare-button');
        const suggestions = page.locator('.branch-compare-suggestions');

        await baseInput.focus();
        await expect(suggestions.locator('.branch-compare-suggestion').first()).toHaveClass(/selected/);
        await baseInput.press('Tab');
        await expect(baseInput).toHaveValue('main');
        await expect(baseInput).toHaveAttribute('data-selected-ref', LEFT_REF);
        await expect(targetInput).toBeFocused();
        await expect(baseInput).toHaveAttribute('aria-expanded', 'false');

        await targetInput.fill('feature');
        await expect(suggestions.locator('.branch-compare-suggestion').first()).toHaveClass(/selected/);
        await targetInput.press('Tab');
        await expect(targetInput).toHaveValue('feature/orders');
        await expect(targetInput).toHaveAttribute('data-selected-ref', RIGHT_REF);
        await expect(compareButton).toBeEnabled();
        await expect(exportFilterToggle).toBeFocused();
        await expect(suggestions).toBeHidden();
        await exportFilterToggle.press('Tab');
        await expect(swapButton).toBeFocused();
        await swapButton.press('Tab');
        await expect(compareButton).toBeFocused();
        await compareButton.press('Tab');
        await expect(page.getByRole('textbox', {name: 'テーブル名でフィルタ', exact: true})).toBeFocused();
    });

    test('Shift+Tabと候補0件のTabは未確定のまま通常のフォーカス移動をする', async ({page}) => {
        await openBranchComparePanelAsync(page);

        const baseInput = page.locator('.branch-compare-base-input');
        const targetInput = page.locator('.branch-compare-target-input');
        const exportFilterToggle = page.getByRole('checkbox', {name: '出力時刻でフィルタ'});
        const suggestions = page.locator('.branch-compare-suggestions');

        await targetInput.fill('feature');
        await expect(suggestions.locator('.branch-compare-suggestion').first()).toHaveClass(/selected/);
        await targetInput.press('Shift+Tab');
        await expect(baseInput).toBeFocused();
        await expect(targetInput).toHaveAttribute('aria-expanded', 'false');
        await expect(targetInput).toHaveValue('feature');
        await expect(targetInput).not.toHaveAttribute('data-selected-ref', /.+/);

        await baseInput.fill('該当しないブランチ');
        await expect(suggestions.locator('.branch-compare-suggestion')).toHaveCount(0);
        await expect(baseInput).not.toHaveAttribute('aria-activedescendant', /.+/);
        await baseInput.press('Tab');
        await expect(targetInput).toBeFocused();
        await expect(baseInput).toHaveValue('該当しないブランチ');
        await expect(baseInput).not.toHaveAttribute('data-selected-ref', /.+/);

        await targetInput.fill('該当しない比較先');
        await targetInput.press('Tab');
        await expect(exportFilterToggle).toBeFocused();
        await expect(suggestions).toBeHidden();
        await exportFilterToggle.press('Shift+Tab');
        await expect(targetInput).toBeFocused();
        await expect(targetInput).toHaveValue('該当しない比較先');
        await expect(targetInput).not.toHaveAttribute('data-selected-ref', /.+/);
    });

    test('小さい画面でも多数の候補をマウスと下キー・Enterで選択し比較操作を画面内に保つ', async ({page}) => {
        await page.evaluate(branches => {
            const mockWindow = window as unknown as {__mockGitBranches: MockBranch[]};
            const additionalBranches: MockBranch[] = Array.from({length: 18}, (_, index) => ({
                name: `work_${index}`, ref: `refs/heads/work_${index}`, kind: 'local',
            }));
            mockWindow.__mockGitBranches = [branches[0], ...additionalBranches, branches[1]];
        }, BRANCHES);
        await openBranchComparePanelAsync(page);
        const panel = page.locator('.branch-compare-panel');
        const baseInput = panel.locator('.branch-compare-base-input');
        const targetInput = panel.locator('.branch-compare-target-input');
        const compareButton = panel.locator('.branch-compare-button');
        const suggestions = panel.locator('.branch-compare-suggestions');

        for (const height of [450, 400]) {
            await page.setViewportSize({width: 1280, height});
            await baseInput.focus();
            await expect(suggestions.locator('.branch-compare-suggestion')).toHaveCount(20);
            const panelBounds = await panel.evaluate(element => ({top: element.getBoundingClientRect().top, bottom: element.getBoundingClientRect().bottom}));
            for (const control of [baseInput, targetInput, panel.locator('.branch-compare-swap-button'), compareButton, panel.locator('.branch-compare-filter-input')]) {
                const bounds = await control.evaluate(element => ({top: element.getBoundingClientRect().top, bottom: element.getBoundingClientRect().bottom}));
                expect(bounds.top).toBeGreaterThanOrEqual(panelBounds.top);
                expect(bounds.bottom).toBeLessThanOrEqual(panelBounds.bottom);
            }
        }
        await selectBranchByMouseAsync(page, '.branch-compare-base-input', LEFT_REF);
        await expect(baseInput).toHaveValue('main');

        await targetInput.focus();
        await expect(suggestions).toBeVisible();
        await expect(suggestions.locator('.branch-compare-suggestion').first()).toHaveText('main');
        await expect(suggestions.locator('.branch-compare-suggestion').first()).toHaveClass(/selected/);
        for (let index = 0; index < 19; index++) await targetInput.press('ArrowDown');
        const selectedOption = suggestions.locator('.branch-compare-suggestion.selected');
        await expect(selectedOption).toHaveText('feature/orders');
        await expect(selectedOption).toBeInViewport({ratio: 1});
        expect(await suggestions.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
        await targetInput.press('Enter');
        await expect(targetInput).toHaveValue('feature/orders');
        await expect(targetInput).toHaveAttribute('data-selected-ref', RIGHT_REF);
        await expect(suggestions).not.toBeVisible();
        await expect(compareButton).toBeEnabled();
        await compareButton.click();
        await expect(panel.locator('.branch-compare-file-item')).toHaveCount(3);
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

    test('ブランチ名やrefが完全一致しても候補を開いたまま確定しTabで別候補に変えず比較できる', async ({page}) => {
        await page.evaluate(() => {
            (window as unknown as {__mockGitBranches: MockBranch[]}).__mockGitBranches.unshift({name: 'main-backup', ref: 'refs/heads/main-backup', kind: 'local'});
        });
        await openBranchComparePanelAsync(page);
        const baseInput = page.locator('.branch-compare-base-input');
        const targetInput = page.locator('.branch-compare-target-input');
        const compareButton = page.locator('.branch-compare-button');
        const suggestions = page.locator('.branch-compare-suggestions');
        await baseInput.fill('main');
        await expect(baseInput).toHaveAttribute('data-selected-ref', LEFT_REF);
        await expect(baseInput).toHaveAttribute('aria-expanded', 'true');
        await expect(suggestions.locator(`.branch-compare-suggestion[data-ref="${LEFT_REF}"]`)).toBeVisible();
        await expect(suggestions.locator('.branch-compare-suggestion.selected')).toHaveAttribute('data-ref', LEFT_REF);
        await baseInput.press('Tab');
        await expect(baseInput).toHaveValue('main');
        await expect(baseInput).toHaveAttribute('data-selected-ref', LEFT_REF);
        await expect(targetInput).toBeFocused();
        await targetInput.fill('feature/orders');
        await expect(targetInput).toBeFocused();
        await expect(targetInput).toHaveAttribute('aria-expanded', 'true');
        await expect(suggestions.locator(`.branch-compare-suggestion[data-ref="${RIGHT_REF}"]`)).toBeVisible();
        await expect(compareButton).toBeEnabled();
        await compareButton.click();
        await expect(page.locator('.branch-compare-file-item')).toHaveCount(3);

        await targetInput.fill('main');
        await expect(compareButton).toBeDisabled();
        await targetInput.fill('feature');
        await expect(compareButton).toBeDisabled();
        await targetInput.fill('Feature/orders');
        await expect(compareButton).toBeDisabled();
        await targetInput.fill('origin/main');
        await expect(targetInput).toHaveAttribute('data-selected-ref', 'refs/remotes/origin/main');
        await expect(suggestions.locator('.branch-compare-suggestion[data-ref="refs/remotes/origin/main"]')).toBeVisible();
        await expect(compareButton).toBeEnabled();
        await targetInput.fill(RIGHT_REF);
        await expect(targetInput).toHaveAttribute('data-selected-ref', RIGHT_REF);
        await expect(targetInput).toHaveAttribute('aria-expanded', 'true');
        await expect(suggestions.locator(`.branch-compare-suggestion[data-ref="${RIGHT_REF}"]`)).toBeVisible();
        await expect(compareButton).toBeEnabled();
    });

    test('候補取得前に入力した完全一致のブランチ名も取得完了時に候補を開いたまま確定する', async ({page}) => {
        await page.evaluate(() => {
            (window as unknown as {__mockGitBranchListDelayMs: number}).__mockGitBranchListDelayMs = 1000;
        });
        await openBranchComparePanelAsync(page);
        await page.locator('.branch-compare-base-input').fill('main');
        await page.locator('.branch-compare-target-input').fill('feature/orders');
        await expect(page.locator('.branch-compare-button')).toBeDisabled();
        await expect(page.locator('.branch-compare-button')).toBeEnabled();
        await expect(page.locator('.branch-compare-target-input')).toBeFocused();
        await expect(page.locator('.branch-compare-target-input')).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator(`.branch-compare-suggestion[data-ref="${RIGHT_REF}"]`)).toBeVisible();
    });

    test('コミットIDの短縮形と完全形を直接入力して差分を開き再起動後も復元できる', async ({page}) => {
        await openBranchComparePanelAsync(page);
        const baseInput = page.locator('.branch-compare-base-input');
        const targetInput = page.locator('.branch-compare-target-input');
        const fullCommit = 'abcdef0123456789abcdef0123456789abcdef01';
        await baseInput.fill(LEFT_SHA);
        await targetInput.fill('  ' + fullCommit.toUpperCase() + '  ');
        await expect(targetInput).toHaveAttribute('data-selected-ref', fullCommit);
        await expect(page.locator('.branch-compare-suggestion-empty')).toHaveText('コミットIDで比較します');
        await page.locator('.branch-compare-button').click();
        await expect(page.locator('.branch-compare-file-item')).toHaveCount(3);
        await page.locator('.branch-compare-file-item[data-status="M"]').click();
        await expect(page.locator('.diff-tab:visible')).toContainText('before');
        await expect(page.locator('.diff-tab:visible')).toContainText('after');
        const requests = await page.evaluate(() => (window as unknown as {__mockApiRequestDetails: Array<Record<string, string>>}).__mockApiRequestDetails);
        expect(requests.filter(request => request.type === 'git_branch_compare_request')).toMatchObject([{leftRef: LEFT_SHA, rightRef: fullCommit}]);
        expect(requests.filter(request => request.type === 'git_show_at_commit_request').map(request => request.commit)).toEqual(expect.arrayContaining([LEFT_SHA, RIGHT_SHA]));
        await expectSavedBranchCompareAsync(page, {baseRef: LEFT_SHA, targetRef: fullCommit, compared: true});
        await page.reload();
        await expect(baseInput).toHaveValue(LEFT_SHA);
        await expect(targetInput).toHaveValue(fullCommit);
        await expect(page.locator('.branch-compare-file-item')).toHaveCount(3);
        await page.locator('[data-panel="files"]').click();
        await openBranchComparePanelAsync(page);
        await expect(targetInput).toHaveValue(fullCommit);
        await expectSavedBranchCompareAsync(page, {baseRef: LEFT_SHA, targetRef: fullCommit, compared: true});
    });

    test('ブランチとコミットIDを混在させ入れ替えて比較できる', async ({page}) => {
        await openBranchComparePanelAsync(page);
        await selectBranchByMouseAsync(page, '.branch-compare-base-input', LEFT_REF);
        await page.locator('.branch-compare-target-input').fill(RIGHT_SHA);
        await page.locator('.branch-compare-button').click();
        await expect(page.locator('.branch-compare-file-item')).toHaveCount(3);
        await page.getByRole('button', {name: '入れ替え', exact: true}).click();
        await expect(page.locator('.branch-compare-base-input')).toHaveValue(RIGHT_SHA);
        await expect(page.locator('.branch-compare-target-input')).toHaveValue('main');
        await expect(page.locator('.branch-compare-file-item')).toHaveCount(0);
        await page.locator('.branch-compare-button').click();
        await expectSavedBranchCompareAsync(page, {baseRef: RIGHT_SHA, targetRef: LEFT_REF, compared: true});
        const requests = await page.evaluate(() => (window as unknown as {__mockApiRequestDetails: Array<Record<string, string>>}).__mockApiRequestDetails);
        expect(requests.filter(request => request.type === 'git_branch_compare_request')).toMatchObject([
            {leftRef: LEFT_REF, rightRef: RIGHT_SHA}, {leftRef: RIGHT_SHA, rightRef: LEFT_REF},
        ]);
        await page.reload();
        await expect(page.locator('.branch-compare-base-input')).toHaveValue(RIGHT_SHA);
        await expect(page.locator('.branch-compare-target-input')).toHaveValue('main');
        await expect(page.locator('.branch-compare-file-item')).toHaveCount(3);
    });

    test('コミットIDの入力がTabやEnterで部分一致したブランチへ変わらず明示選択はできる', async ({page}) => {
        await page.evaluate(() => {
            (window as unknown as {__mockGitBranches: MockBranch[]}).__mockGitBranches.push(
                {name: 'fix/abcdef0', ref: 'refs/heads/fix/abcdef0', kind: 'local'},
                {name: 'deadbeef', ref: 'refs/heads/deadbeef', kind: 'local'},
            );
        });
        await openBranchComparePanelAsync(page);
        const input = page.locator('.branch-compare-base-input');
        await input.fill('abcdef0');
        await expect(page.locator('.branch-compare-suggestion')).toHaveCount(1);
        await expect(page.locator('.branch-compare-suggestion.selected')).toHaveCount(0);
        await input.press('Enter');
        await expect(input).toHaveAttribute('data-selected-ref', 'abcdef0');
        await input.press('Tab');
        await expect(input).toHaveValue('abcdef0');
        await input.focus();
        await input.press('ArrowDown');
        await input.press('Enter');
        await expect(input).toHaveAttribute('data-selected-ref', 'refs/heads/fix/abcdef0');
        await input.fill('deadbeef');
        await expect(input).toHaveAttribute('data-selected-ref', 'refs/heads/deadbeef');
    });

    test('コミットIDの形式を検証し同一IDの大文字小文字違いでは比較しない', async ({page}) => {
        await openBranchComparePanelAsync(page);
        await page.locator('.branch-compare-base-input').fill('abcdef0');
        const target = page.locator('.branch-compare-target-input');
        const button = page.locator('.branch-compare-button');
        for (const invalid of ['', 'abc', 'g123456', 'a'.repeat(65), '--help', 'HEAD~1', 'ABCDEF0']) {
            await target.fill(invalid);
            await expect(button).toBeDisabled();
        }
        for (const commit of ['1234', 'b'.repeat(40), 'c'.repeat(64)]) {
            await target.fill(commit);
            await expect(button).toBeEnabled();
            await expectSavedBranchCompareAsync(page, {baseRef: 'abcdef0', targetRef: commit, compared: false});
        }
    });

    test('ブランチ候補の取得に失敗してもコミットID同士は比較できる', async ({page}) => {
        await page.evaluate(() => {
            (window as unknown as {__mockGitBranchListError: string | null}).__mockGitBranchListError = 'branch list failed';
        });
        await openBranchComparePanelAsync(page);
        await expect(page.locator('.notification-toast-error')).toHaveText('branch list failed');
        await page.locator('.branch-compare-base-input').fill(LEFT_SHA);
        await page.locator('.branch-compare-target-input').fill(RIGHT_SHA);
        await page.locator('.branch-compare-button').click();
        await expect(page.locator('.branch-compare-file-item')).toHaveCount(3);
    });

    test('存在しないコミットIDのエラー後に入力を修正して再比較できる', async ({page}) => {
        await openBranchComparePanelAsync(page);
        await page.evaluate(() => {
            (window as unknown as {__mockGitBranchCompareError: string | null}).__mockGitBranchCompareError = '比較先のコミットを特定できません';
        });
        await page.locator('.branch-compare-base-input').fill(LEFT_SHA);
        await page.locator('.branch-compare-target-input').fill('deadbeef');
        await page.locator('.branch-compare-button').click();
        await expect(page.locator('.notification-toast-error')).toHaveText('比較先のコミットを特定できません');
        await expect(page.locator('.branch-compare-file-item')).toHaveCount(0);
        await expectSavedBranchCompareAsync(page, {baseRef: LEFT_SHA, targetRef: 'deadbeef', compared: false});
        await page.evaluate(() => {
            (window as unknown as {__mockGitBranchCompareError: string | null}).__mockGitBranchCompareError = null;
        });
        await page.locator('.branch-compare-target-input').fill(RIGHT_SHA);
        await page.locator('.branch-compare-button').click();
        await expect(page.locator('.branch-compare-file-item')).toHaveCount(3);
    });

    test('入れ替えで旧結果を破棄して選択を保存し反転したrefで比較でき比較中は入れ替えを無効にする', async ({page}) => {
        await openBranchComparePanelAsync(page);
        await selectDefaultBranchesAndCompareAsync(page);
        const baseInput = page.locator('.branch-compare-base-input');
        const targetInput = page.locator('.branch-compare-target-input');
        const compareButton = page.locator('.branch-compare-button');
        const swapButton = page.getByRole('button', {name: '入れ替え', exact: true});
        await swapButton.click();
        await expect(baseInput).toHaveValue('feature/orders');
        await expect(baseInput).toHaveAttribute('title', 'feature/orders');
        await expect(baseInput).toHaveAttribute('data-selected-ref', RIGHT_REF);
        await expect(targetInput).toHaveValue('main');
        await expect(targetInput).toHaveAttribute('title', 'main');
        await expect(targetInput).toHaveAttribute('data-selected-ref', LEFT_REF);
        await expect(page.locator('.branch-compare-file-item')).toHaveCount(0);
        await expect(page.locator('.branch-compare-suggestions')).toBeHidden();
        await expect(compareButton).toBeEnabled();
        await expectSavedBranchCompareAsync(page, {baseRef: RIGHT_REF, targetRef: LEFT_REF, compared: false});
        expect(await page.evaluate(() => (window as unknown as {__mockApiRequests: string[]}).__mockApiRequests.filter(type => type === 'git_branch_compare_request'))).toHaveLength(1);

        await page.evaluate(() => {
            (window as unknown as {__mockGitBranchCompareDelayMs: number}).__mockGitBranchCompareDelayMs = 1000;
        });
        await compareButton.click();
        await expect(swapButton).toBeDisabled();
        await expect(baseInput).toBeDisabled();
        await expect(targetInput).toBeDisabled();
        await expect(page.locator('.branch-compare-file-item')).toHaveCount(3);
        await expect(swapButton).toBeEnabled();
        await expectSavedBranchCompareAsync(page, {baseRef: RIGHT_REF, targetRef: LEFT_REF, compared: true});
        const compareRequests = await page.evaluate(() => {
            const details = (window as unknown as {__mockApiRequestDetails: Array<Record<string, string | null>>}).__mockApiRequestDetails;
            return details.filter(detail => detail.type === 'git_branch_compare_request');
        });
        expect(compareRequests).toMatchObject([{leftRef: LEFT_REF, rightRef: RIGHT_REF}, {leftRef: RIGHT_REF, rightRef: LEFT_REF}]);
    });

    test('未確定の入力や片側が空でも入れ替えて確定refを対応する入力へ移す', async ({page}) => {
        await openBranchComparePanelAsync(page);
        await selectBranchByMouseAsync(page, '.branch-compare-base-input', LEFT_REF);
        const baseInput = page.locator('.branch-compare-base-input');
        const targetInput = page.locator('.branch-compare-target-input');
        const compareButton = page.locator('.branch-compare-button');
        const swapButton = page.getByRole('button', {name: '入れ替え', exact: true});
        await targetInput.fill('feature');
        await swapButton.click();
        await expect(baseInput).toHaveValue('feature');
        await expect(baseInput).toHaveAttribute('title', 'feature');
        await expect(baseInput).not.toHaveAttribute('data-selected-ref', /.+/);
        await expect(targetInput).toHaveValue('main');
        await expect(targetInput).toHaveAttribute('title', 'main');
        await expect(targetInput).toHaveAttribute('data-selected-ref', LEFT_REF);
        await expect(compareButton).toBeDisabled();
        await expectSavedBranchCompareAsync(page, {baseRef: null, targetRef: LEFT_REF, compared: false});

        await baseInput.fill('');
        await swapButton.click();
        await expect(baseInput).toHaveValue('main');
        await expect(baseInput).toHaveAttribute('data-selected-ref', LEFT_REF);
        await expect(targetInput).toHaveValue('');
        await expect(targetInput).not.toHaveAttribute('data-selected-ref', /.+/);
        await expect(compareButton).toBeDisabled();
        await expectSavedBranchCompareAsync(page, {baseRef: LEFT_REF, targetRef: null, compared: false});
    });

    test('localとremoteの表示名が重複する場合は完全一致しても明示選択が必要', async ({page}) => {
        await page.evaluate(() => {
            (window as unknown as {__mockGitBranches: MockBranch[]}).__mockGitBranches.push({
                name: 'origin/main', ref: 'refs/heads/origin/main', kind: 'local',
            });
        });
        await openBranchComparePanelAsync(page);
        await page.locator('.branch-compare-base-input').fill('main');
        await page.locator('.branch-compare-target-input').fill('origin/main');
        await expect(page.locator('.branch-compare-button')).toBeDisabled();
        await selectBranchByMouseAsync(page, '.branch-compare-target-input', 'refs/remotes/origin/main');
        await expect(page.locator('.branch-compare-button')).toBeEnabled();
    });

    test('比較後にA・M・D一覧を表示し追加は緑文字・削除は赤文字になる', async ({page}) => {
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
        for (const selector of ['.branch-compare-file-name', '.branch-compare-file-status']) {
            await expect(added.locator(selector)).toHaveCSS('color', 'rgb(129, 184, 139)');
            await expect(deleted.locator(selector)).toHaveCSS('color', 'rgb(255, 120, 120)');
        }
        await page.evaluate(() => { document.body.setAttribute('data-theme', 'light'); });
        for (const selector of ['.branch-compare-file-name', '.branch-compare-file-status']) {
            await expect(added.locator(selector)).toHaveCSS('color', 'rgb(34, 134, 58)');
            await expect(deleted.locator(selector)).toHaveCSS('color', 'rgb(198, 40, 40)');
        }
        await page.evaluate(() => { document.body.setAttribute('data-theme', 'dark'); });

        const compareRequest = await page.evaluate(() => {
            const details = (window as unknown as {__mockApiRequestDetails: Array<Record<string, string | null>>}).__mockApiRequestDetails;
            return details.find(detail => detail.type === 'git_branch_compare_request');
        });
        expect(compareRequest).toMatchObject({leftRef: LEFT_REF, rightRef: RIGHT_REF});
    });

    test('ファイル行の余白・文字サイズ・背景色・hover・選択表示がEXPLORERと一致する', async ({page}) => {
        const explorerFile = page.locator('.explorer-file').filter({has: page.getByText('modified', {exact: true})});
        const rowProperties = ['display', 'flex-direction', 'padding', 'height', 'background-color', 'background-image', 'outline', 'outline-offset', 'box-shadow'];
        const textProperties = ['font-size', 'font-weight', 'line-height'];
        const styles = (element: Element, properties: string[]) => {
            const computed = getComputedStyle(element);
            return properties.map(property => computed.getPropertyValue(property));
        };
        const normalStyle = await explorerFile.evaluate(styles, rowProperties);
        const textStyle = await explorerFile.locator('.explorer-file-name').evaluate(styles, textProperties);
        await explorerFile.hover();
        const hoverStyle = await explorerFile.evaluate(styles, rowProperties);
        await explorerFile.click();
        await expect(explorerFile).toHaveClass(/explorer-file-active/);
        const activeStyle = await explorerFile.evaluate(styles, rowProperties);

        await openBranchComparePanelAsync(page);
        await selectDefaultBranchesAndCompareAsync(page);
        for (const status of ['M', 'A', 'D']) {
            const item = page.locator(`.branch-compare-file-item[data-status="${status}"]`);
            const openFileButton = item.getByRole('button', {name: /の実テーブルを開く/, includeHidden: true});
            await expect(openFileButton).toBeHidden();
            expect(await item.evaluate(styles, rowProperties)).toEqual(normalStyle);
            expect(await item.locator('.branch-compare-file-name').evaluate(styles, textProperties)).toEqual(textStyle);
            const textColor = await item.locator('.branch-compare-file-name').evaluate(element => getComputedStyle(element).color);
            await item.hover();
            await expect(openFileButton).toBeVisible();
            const buttonBox = await openFileButton.boundingBox();
            const statusBox = await item.locator('.branch-compare-file-status').boundingBox();
            expect(buttonBox!.x + buttonBox!.width).toBeLessThan(statusBox!.x);
            expect(await item.evaluate(styles, rowProperties)).toEqual(hoverStyle);
            await expect(item.locator('.branch-compare-file-name')).toHaveCSS('color', textColor);
            await expect(item.locator('.branch-compare-file-status')).toHaveCSS('color', textColor);
            await item.click();
            // 選択表示は読み込み完了後のアクティブな差分タブに同期される。
            await expect(page.locator('.branch-compare-results')).toHaveAttribute('aria-busy', 'false');
            await expect(item).toHaveAttribute('aria-current', 'true');
            expect(await item.evaluate(styles, rowProperties)).toEqual(activeStyle);
            await expect(item.locator('.branch-compare-file-name')).toHaveCSS('color', textColor);
            await expect(item.locator('.branch-compare-file-status')).toHaveCSS('color', textColor);
        }
        await page.locator('.branch-compare-button').hover();
        await expect(page.locator('.branch-compare-open-file:visible')).toHaveCount(0);
    });

    for (const file of COMPARE_RESULT.files) {
        test(`${file.status}行のファイルアイコンで比較コミットではなく実テーブルを開く`, async ({page}) => {
            await openBranchComparePanelAsync(page);
            await selectDefaultBranchesAndCompareAsync(page);
            const item = page.locator(`.branch-compare-file-item[data-status="${file.status}"]`);
            await item.hover();
            const button = item.getByRole('button', {name: file.tableName + 'の実テーブルを開く'});
            // 子ボタンのEnterが親の差分表示へ伝播しないことも確認する。
            if (file.status === 'A') await button.press('Enter');
            else await button.click();
            await expect(page.locator(`.tab-wrapper[data-tab-name="${file.tableName}"] .editor-table`)).toBeVisible();
            await expect(page.locator('.tab-button-active .tab-button-name')).toHaveText(file.tableName);
            await expect(page.locator('.diff-tab')).toHaveCount(0);
            const commitReads = await page.evaluate(() => {
                const requests = (window as unknown as {__mockApiRequests: string[]}).__mockApiRequests;
                return requests.filter(type => type === 'git_show_at_commit_request');
            });
            expect(commitReads).toEqual([]);
        });
    }

    test('差分読み込み中でもファイルアイコンで実テーブルを開き、後から差分へ戻らない', async ({page}) => {
        await openBranchComparePanelAsync(page);
        await selectDefaultBranchesAndCompareAsync(page);
        await delayDiffWorkerMessagesAsync(page, 500);
        const item = page.locator('.branch-compare-file-item[data-status="M"]');
        await item.click();
        await expect(page.locator('.branch-compare-results')).toHaveAttribute('aria-busy', 'true');
        await item.getByRole('button', {name: 'modifiedの実テーブルを開く'}).click();
        await expect(page.locator('.tab-wrapper[data-tab-name="modified"] .editor-table')).toBeVisible();
        await page.waitForTimeout(600);
        await expect(page.locator('.tab-button-active .tab-button-name')).toHaveText('modified');
        await expect(page.locator('.diff-tab')).toHaveCount(0);
        await expect(page.locator('.branch-compare-results')).toHaveAttribute('aria-busy', 'false');
    });

    test('比較状態をファイルへ保存し再起動時はブランチの最新差分を自動で復元する', async ({page}) => {
        await openBranchComparePanelAsync(page);
        await selectDefaultBranchesAndCompareAsync(page);
        await expectSavedBranchCompareAsync(page, {baseRef: LEFT_REF, targetRef: RIGHT_REF, compared: true});
        await page.evaluate(() => {
            sessionStorage.setItem('__branchCompareResultOverride', JSON.stringify({
                leftCommit: '1111111', rightCommit: '3333333',
                files: [{path: 'data/modified.csv', tableName: 'modified', status: 'M'}],
            }));
        });
        await page.reload();
        await expect(page.locator('.branch-compare-panel')).toBeVisible();
        await expect(page.locator('.branch-compare-base-input')).toHaveValue('main');
        await expect(page.locator('.branch-compare-target-input')).toHaveValue('feature/orders');
        const file = page.locator('.branch-compare-file-item');
        await expect(file).toHaveCount(1);
        await file.click();
        await expect(page.locator('.diff-tab:visible')).toContainText('release');
        await expectSavedBranchCompareAsync(page, {baseRef: LEFT_REF, targetRef: RIGHT_REF, compared: true});
    });

    test('別パネルで終了した場合も起動時に比較を復元する', async ({page}) => {
        await openBranchComparePanelAsync(page);
        await selectDefaultBranchesAndCompareAsync(page);
        await page.locator('[data-panel="files"]').click();
        await expectSavedBranchCompareAsync(page, {baseRef: LEFT_REF, targetRef: RIGHT_REF, compared: true});
        await expect.poll(async () => JSON.parse(await readMockFileAsync(page, UI_STATE_FILE)).sidebar.activePanel).toBe('files');
        await page.reload();
        await expect(page.locator('.branch-compare-panel')).toBeHidden();
        await expect(page.locator('.branch-compare-file-item')).toHaveCount(3);
        await openBranchComparePanelAsync(page);
        await expect(page.locator('.branch-compare-base-input')).toHaveValue('main');
        await expect(page.locator('.branch-compare-target-input')).toHaveValue('feature/orders');
    });

    for (const missingRef of [LEFT_REF, RIGHT_REF]) {
        test(`起動時に削除済みのブランチを復元せず比較もしない: ${missingRef}`, async ({page}) => {
            await openBranchComparePanelAsync(page);
            await selectDefaultBranchesAndCompareAsync(page);
            await expectSavedBranchCompareAsync(page, {baseRef: LEFT_REF, targetRef: RIGHT_REF, compared: true});
            await page.evaluate((ref: string) => {
                const mockWindow = window as unknown as {__mockGitBranches: MockBranch[]};
                sessionStorage.setItem('__branchCompareBranchesOverride', JSON.stringify(mockWindow.__mockGitBranches.filter(branch => branch.ref !== ref)));
            }, missingRef);
            await page.reload();
            const missingInput = page.locator(missingRef === LEFT_REF ? '.branch-compare-base-input' : '.branch-compare-target-input');
            const remainingInput = page.locator(missingRef === LEFT_REF ? '.branch-compare-target-input' : '.branch-compare-base-input');
            await expect(missingInput).toHaveValue('');
            await expect(missingInput).not.toHaveAttribute('data-selected-ref', /.+/);
            await expect(remainingInput).toHaveValue(missingRef === LEFT_REF ? 'feature/orders' : 'main');
            await expect(page.locator('.branch-compare-button')).toBeDisabled();
            await expect(page.locator('.branch-compare-file-item')).toHaveCount(0);
            await expectSavedBranchCompareAsync(page, {
                baseRef: missingRef === LEFT_REF ? null : LEFT_REF,
                targetRef: missingRef === RIGHT_REF ? null : RIGHT_REF,
                compared: false,
            });
            const requests = await page.evaluate(() => (window as unknown as {__mockApiRequests: string[]}).__mockApiRequests);
            expect(requests).not.toContain('git_branch_compare_request');
        });
    }

    test('比較前の選択は復元し、入力変更で破棄した比較結果は復元しない', async ({page}) => {
        await openBranchComparePanelAsync(page);
        await selectDefaultBranchesAndCompareAsync(page);
        await page.locator('.branch-compare-target-input').fill('origin/release');
        const state = {baseRef: LEFT_REF, targetRef: 'refs/remotes/origin/release', compared: false};
        await expectSavedBranchCompareAsync(page, state);
        await page.reload();
        await expect(page.locator('.branch-compare-base-input')).toHaveValue('main');
        await expect(page.locator('.branch-compare-target-input')).toHaveValue('origin/release');
        await expect(page.locator('.branch-compare-button')).toBeEnabled();
        await expect(page.locator('.branch-compare-file-item')).toHaveCount(0);
        await expectSavedBranchCompareAsync(page, state);
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

        // リビジョン比較差分は左右とも読み取り専用。
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
        await expect(page.locator('.notification-toast-error')).toHaveCount(0);
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
        await page.locator('.sidebar-panel-header').filter({hasText: 'REVISION COMPARE'}).click();
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

    test('比較中の候補取得失敗はトーストで通知し比較busyを維持する', async ({page}) => {
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
        await expect(page.locator('.notification-toast-error')).toHaveText('branch list failed');
        await expect(page.locator('.branch-compare-panel [role="alert"]')).toHaveCount(0);
    });

    test('source controlと異なるリビジョン比較の同一table差分が内部状態を共有せず共存する', async ({page}) => {
        await page.locator('[data-panel="sourceControl"]').click();
        await page.locator('.source-control-changes-section .source-control-file-item').first().click();
        await expect(page.locator('.diff-tab:visible .diff-pane-right')).toContainText('after');

        await openBranchComparePanelAsync(page);
        await selectDefaultBranchesAndCompareAsync(page);
        await page.locator('.branch-compare-file-item[data-status="M"]').click();
        await expect(page.locator('.tab-button.tab-button-active', {hasText: '差分: modified (main ↔ feature/orders)'})).toBeVisible();
        await expect(page.locator('.diff-tab:visible .diff-pane-right')).toContainText('after');
        await page.locator('.tab-button-active .tab-button-name').dblclick();

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

    test('リビジョン比較差分を固定SHAとstatus付きでui-stateへ保存する', async ({page}) => {
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
        await expect(page.locator('.notification-toast-error')).toContainText('primary_keyが異なるため比較できません');
        await expect(page.locator('.branch-compare-panel [role="alert"]')).toHaveCount(0);
        await expect(page.locator('.tab-button', {hasText: 'modified (main ↔ feature/orders)'})).toHaveCount(0);
    });

    for (const [commit, side] of [[LEFT_SHA, '比較元'], [RIGHT_SHA, '比較先']]) {
        test(`${side}ブランチの不正スキーマはパネル内に表示せず共通通知とログへ記録する`, async ({page}) => {
            await openBranchComparePanelAsync(page);
            await selectDefaultBranchesAndCompareAsync(page);
            await page.evaluate(sha => {
                const mockWindow = window as unknown as {__mockGitCommitFiles: Record<string, Record<string, string>>};
                mockWindow.__mockGitCommitFiles[sha]['schema/modified.json'] = '{}';
            }, commit);
            await page.locator('.branch-compare-file-item[data-status="M"]').click();
            const message = side + 'のスキーマが不正です';
            await expect(page.locator('.notification-toast-error')).toHaveText(message);
            await expect(page.locator('.debug-console-row-error', {hasText: message})).toBeAttached();
            await expect(page.locator('.branch-compare-panel')).not.toContainText(message);
            await expect(page.locator('.branch-compare-results')).toHaveAttribute('aria-busy', 'false');
            await page.locator('.status-bar-badge').click();
            await page.locator('.bottom-panel-tab', {hasText: 'DEBUG CONSOLE'}).click();
            await page.locator('.debug-console-row-error', {hasText: message}).click();
            const stackCode = page.locator('.debug-api-detail-stack-trace .debug-api-detail-code');
            await expect(stackCode).toContainText(message);
            await expect(stackCode).toContainText('normalizeBranchCompareSchema');
        });
    }

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
        await page.locator('.sidebar-panel-header').filter({hasText: 'REVISION COMPARE'}).click();
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

test.describe('リビジョン比較の空状態・エラー状態', () => {
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

    test('比較APIが失敗したら右下の共通エラー通知を表示する', async ({page}) => {
        await installBranchComparePageAsync(page, COMPARE_RESULT, 'fatal: unknown revision');
        await openBranchComparePanelAsync(page);
        await selectBranchByMouseAsync(page, '.branch-compare-base-input', LEFT_REF);
        await selectBranchByMouseAsync(page, '.branch-compare-target-input', RIGHT_REF);
        await page.locator('.branch-compare-button').click();

        await expect(page.locator('.notification-toast-error')).toContainText('fatal: unknown revision');
        await expect(page.locator('.branch-compare-panel [role="alert"]')).toHaveCount(0);
        await expect(page.locator('.branch-compare-file-item')).toHaveCount(0);
    });
});
