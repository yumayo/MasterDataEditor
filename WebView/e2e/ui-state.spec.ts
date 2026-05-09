import {Page} from '@playwright/test';
import {test, expect} from './fixtures/test';
import {createDefaultFileSystem, installMockApiAsync, readMockFileAsync} from './fixtures/mock-api';

const UI_STATE_FILE = 'userdata/ui-state.json';

function createSchema(description?: string): string {
    return JSON.stringify({
        ...(description !== undefined ? {description} : {}),
        header: [
            { key: 0, name: "id", type: "int" },
            { key: 1, name: "name", type: "string" },
            { key: 2, name: "value", type: "int" },
        ],
        primary_key: ["id"],
    });
}

function createCsv(prefix: string): string {
    return [
        "id,name,value",
        `1,${prefix}_a,100`,
        `2,${prefix}_b,200`,
    ].join("\n");
}

async function openTestTableAsync(page: Page): Promise<void> {
    await page.locator('#explorer .explorer-file').getByText('test', {exact: true}).click();
    await expect(page.locator('.tab-button-active')).toHaveText(/test/);
}

async function dragLocatorAsync(page: Page, locatorSelector: string, deltaX: number, deltaY: number): Promise<void> {
    const box = await page.locator(locatorSelector).boundingBox();
    if (box === null) throw new Error(`drag target not found: ${locatorSelector}`);
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + deltaX, startY + deltaY);
    await page.mouse.up();
}

async function waitForSavedUiStateAsync(page: Page): Promise<void> {
    await page.waitForFunction((path) => {
        const raw = (window as unknown as {__mockFs: Record<string, string>}).__mockFs[path];
        if (typeof raw !== 'string') return false;
        try {
            const parsed = JSON.parse(raw) as {
                sidebar?: {width?: number; activePanel?: string};
                bottomPanel?: {visible?: boolean; height?: number; activeTab?: string};
                tabs?: {open?: Array<{name?: string; description?: string | null; diff?: unknown}>; active?: string | null};
            };
            return parsed.sidebar?.activePanel === 'bookmarks'
                && typeof parsed.sidebar.width === 'number'
                && parsed.sidebar.width >= 360
                && parsed.bottomPanel?.visible === true
                && parsed.bottomPanel.activeTab === 'debug'
                && typeof parsed.bottomPanel.height === 'number'
                && parsed.bottomPanel.height > 300
                && Array.isArray(parsed.tabs?.open)
                && parsed.tabs.open.some(tab => tab.name === 'test')
                && parsed.tabs.active === 'test';
        } catch {
            return false;
        }
    }, UI_STATE_FILE, {timeout: 5000});
}

test.describe('UI状態のuserdata永続化', () => {
    test('サイドバー・ボトムパネル・アクティビティバー・表示タブがuserdataへ保存される', async ({page, mockFileSystem}) => {
        await openTestTableAsync(page);

        await page.locator('.activity-bar-item[data-panel="bookmarks"]').click();
        await dragLocatorAsync(page, '.explorer > .resize-handle[data-direction="horizontal"]', 90, 0);

        await page.locator('.status-bar-badge').click();
        await page.locator('.bottom-panel-tab', {hasText: 'DEBUG CONSOLE'}).click();
        await dragLocatorAsync(page, '.bottom-panel > .resize-handle[data-direction="vertical"]', 0, -70);

        await waitForSavedUiStateAsync(page);

        const raw = await readMockFileAsync(page, UI_STATE_FILE);
        expect(raw).not.toContain('\r');
        expect(raw.endsWith('\n')).toBe(true);
        expect(raw).toContain('\n    "sidebar": {');
        const state = JSON.parse(raw) as {
            sidebar: {width: number; activePanel: string};
            bottomPanel: {visible: boolean; height: number; activeTab: string};
            tabs: {open: Array<{name: string; description: string | null; diff: unknown}>; active: string | null};
        };
        expect(state.sidebar.activePanel).toBe('bookmarks');
        expect(state.sidebar.width).toBeGreaterThanOrEqual(360);
        expect(state.bottomPanel.visible).toBe(true);
        expect(state.bottomPanel.activeTab).toBe('debug');
        expect(state.bottomPanel.height).toBeGreaterThan(300);
        expect(state.tabs.open).toContainEqual({name: 'test', description: null, diff: null});
        expect(state.tabs.active).toBe('test');
    });

    test('userdata/ui-state.jsonが存在すれば起動時にUI状態が復元される', async ({page}) => {
        const fs = createDefaultFileSystem();
        fs[UI_STATE_FILE] = JSON.stringify({
            sidebar: {width: 420, activePanel: 'bookmarks'},
            bottomPanel: {visible: true, height: 360, activeTab: 'debug'},
            tabs: {open: [{name: 'test', description: null, diff: null}], active: 'test'},
        });
        await installMockApiAsync(page, fs);
        await page.goto('/');

        await expect(page.locator('.activity-bar-item[data-panel="bookmarks"]')).toHaveClass(/activity-bar-item-active/);
        await expect(page.locator('.bookmark-panel')).toBeVisible();
        const explorerBox = await page.locator('#explorer').boundingBox();
        expect(explorerBox!.width).toBeCloseTo(420, -1);

        const bottomPanel = page.locator('.bottom-panel');
        await expect(bottomPanel).toBeVisible();
        const bottomBox = await bottomPanel.boundingBox();
        expect(bottomBox!.height).toBeCloseTo(360, -1);
        await expect(page.locator('.bottom-panel-tab', {hasText: 'DEBUG CONSOLE'})).toHaveClass(/bottom-panel-tab-active/);

        await expect(page.locator('.tab-button-active')).toHaveText(/test/);
        await expect(page.locator('.editor-table')).toBeVisible();
    });

    test('tab-button-descriptionがuserdataへ保存され、起動時はタブレイアウトだけ先に復元される', async ({page}) => {
        const fs = createDefaultFileSystem();
        fs['schema/test.json'] = createSchema('Test table description\nsecond line');
        fs['schema/other.json'] = createSchema('Other table description');
        fs['data/other.csv'] = createCsv('other');

        await installMockApiAsync(page, fs);
        await page.goto('/');

        await openTestTableAsync(page);
        await page.waitForFunction((path) => {
            const raw = (window as unknown as {__mockFs: Record<string, string>}).__mockFs[path];
            if (typeof raw !== 'string') return false;
            const parsed = JSON.parse(raw) as {tabs?: {open?: Array<{name?: string; description?: string | null; diff?: unknown}>}};
            return parsed.tabs?.open?.some(tab => tab.name === 'test' && tab.description === 'Test table description') === true;
        }, UI_STATE_FILE);

        const savedRaw = await readMockFileAsync(page, UI_STATE_FILE);
        const saved = JSON.parse(savedRaw) as {tabs: {open: Array<{name: string; description: string | null; diff: unknown}>}};
        expect(saved.tabs.open).toContainEqual({name: 'test', description: 'Test table description', diff: null});

        const restoredFs = createDefaultFileSystem();
        restoredFs['schema/test.json'] = createSchema('Test table description\nsecond line');
        restoredFs['schema/other.json'] = createSchema('Other table description');
        restoredFs['data/other.csv'] = createCsv('other');
        restoredFs[UI_STATE_FILE] = JSON.stringify({
            tabs: {
                open: [
                    {name: 'test', description: 'Test table description', diff: null},
                    {name: 'other', description: 'Other table description', diff: null},
                ],
                active: 'test',
            },
        });

        await page.context().clearCookies();
        const secondPage = await page.context().newPage();
        await installMockApiAsync(secondPage, restoredFs);
        await secondPage.goto('/');

        await expect(secondPage.locator('.tab-button')).toHaveCount(2);
        await expect(secondPage.locator('.tab-button', {hasText: 'Test table description'})).toBeVisible();
        await expect(secondPage.locator('.tab-button', {hasText: 'Other table description'})).toBeVisible();
        await expect(secondPage.locator('.tab-wrapper[data-tab-name="test"] .editor-table')).toBeVisible();
        await expect(secondPage.locator('.tab-wrapper[data-tab-name="other"]')).toHaveCount(0);

        await secondPage.locator('.tab-button', {hasText: 'other'}).click();
        await expect(secondPage.locator('.tab-wrapper[data-tab-name="other"] .editor-table')).toBeVisible();
        await secondPage.close();
    });

    test('Git差分タブは起動時にボタンだけ復元され、クリック時に差分ビューを読み込む', async ({page}) => {
        const currentCsv = [
            "id,name,value",
            "1,item_changed,100",
            "2,item_b,200",
        ].join("\n");
        const headCsv = [
            "id,name,value",
            "1,item_original,100",
            "2,item_b,200",
        ].join("\n");
        await page.addInitScript((args: {headCsv: string}) => {
            (window as unknown as { __mockGitStatus: object }).__mockGitStatus = {
                changes: [{ path: 'data/test.csv', tableName: 'test', isNew: false }],
                staged: [],
            };
            (window as unknown as { __mockGitHeadFiles: Record<string, string> }).__mockGitHeadFiles = {
                'data/test.csv': args.headCsv,
            };
        }, {headCsv});

        const fs = createDefaultFileSystem();
        fs['data/test.csv'] = currentCsv;
        fs[UI_STATE_FILE] = JSON.stringify({
            tabs: {
                open: [
                    {name: 'test', description: null, diff: null},
                    {
                        name: '差分: test',
                        description: null,
                        diff: {tableName: 'test', gitPath: 'data/test.csv', isStaged: false, isNew: false},
                    },
                ],
                active: 'test',
            },
        });

        await installMockApiAsync(page, fs);
        await page.goto('/');

        await expect(page.locator('.tab-button[title="test"]')).toBeVisible();
        await expect(page.locator('.tab-button[title="差分: test"]')).toBeVisible();
        await expect(page.locator('.tab-wrapper[data-tab-name="test"] .editor-table')).toBeVisible();
        await expect(page.locator('.diff-tab')).toHaveCount(0);

        await page.locator('.tab-button[title="差分: test"]').click();
        await expect(page.locator('.diff-tab')).toBeVisible();
        await expect(page.locator('.diff-pane-left .editor-table')).toContainText('item_original');
        await expect(page.locator('.diff-pane-right .editor-table')).toContainText('item_changed');
    });
});
