import {Page} from '@playwright/test';
import {test, expect} from './fixtures/test';
import {createDefaultFileSystem, installMockApiAsync, readMockFileAsync} from './fixtures/mock-api';

const UI_STATE_FILE = 'user:ui-state.json';

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

function createWideSchema(columnCount: number): string {
    return JSON.stringify({
        header: Array.from({length: columnCount}, (_, index) => ({
            key: index,
            name: index === 0 ? 'id' : `column_${index}`,
            type: index === 0 ? 'int' : 'string',
        })),
        primary_key: ['id'],
    });
}

function createWideCsv(rowCount: number, columnCount: number): string {
    const header = Array.from({length: columnCount}, (_, index) => index === 0 ? 'id' : `column_${index}`);
    const rows = [header.join(',')];
    for (let row = 1; row <= rowCount; row++) {
        rows.push(Array.from({length: columnCount}, (_, col) => col === 0 ? String(row) : `r${row}_c${col}`).join(','));
    }
    return rows.join('\n');
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
                tabs?: {open?: Array<{name?: string; description?: string | null; diff?: unknown}>; active?: string | null; scroll?: {scrollLeft?: number; scrollTop?: number}};
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

test.describe('UI状態のUserスコープ永続化', () => {
    test('サイドバー・ボトムパネル・アクティビティバー・表示タブがUserスコープへ保存される', async ({page, mockFileSystem}) => {
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
            tabs: {
                open: Array<{
                    name: string;
                    description: string | null;
                    diff: unknown;
                    scroll?: {scrollLeft: number; scrollTop: number} | null;
                    editorTable?: unknown;
                }>;
                active: string | null;
                scroll: {scrollLeft: number; scrollTop: number};
            };
        };
        expect(state.sidebar.activePanel).toBe('bookmarks');
        expect(state.sidebar.width).toBeGreaterThanOrEqual(360);
        expect(state.bottomPanel.visible).toBe(true);
        expect(state.bottomPanel.activeTab).toBe('debug');
        expect(state.bottomPanel.height).toBeGreaterThan(300);
        expect(state.tabs.scroll).toMatchObject({scrollLeft: expect.any(Number), scrollTop: expect.any(Number)});
        const testTab = state.tabs.open.find(tab => tab.name === 'test');
        expect(testTab).toMatchObject({
            name: 'test',
            description: null,
            diff: null,
            scroll: {scrollLeft: expect.any(Number), scrollTop: expect.any(Number)},
            editorTable: {
                scroll: {scrollLeft: expect.any(Number), scrollTop: expect.any(Number)},
                relationsPanelVisible: false,
                formPanel: null,
                selection: {
                    focus: {row: 1, column: 1},
                    range: {startRow: 1, startColumn: 1, endRow: 1, endColumn: 1},
                },
            },
        });
        expect(state.tabs.active).toBe('test');
    });

    test('Userスコープのui-state.jsonが存在すれば起動時にUI状態が復元される', async ({page}) => {
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

    test('ui-stateのEditorTable状態から参照パネルと選択セルが復元される', async ({page}) => {
        const fs = createDefaultFileSystem();
        fs[UI_STATE_FILE] = JSON.stringify({
            tabs: {
                open: [{
                    name: 'test',
                    description: null,
                    diff: null,
                    scroll: {scrollLeft: 0, scrollTop: 0},
                    editorTable: {
                        scroll: {scrollLeft: 0, scrollTop: 0},
                        relationsPanelVisible: true,
                        formPanel: null,
                        selection: {
                            focus: {row: 2, column: 2},
                            range: {startRow: 2, startColumn: 2, endRow: 2, endColumn: 2},
                        },
                    },
                }],
                active: 'test',
                scroll: {scrollLeft: 0, scrollTop: 0},
            },
        });
        await installMockApiAsync(page, fs);
        await page.goto('/');

        await expect(page.locator('.relations-panel')).toBeVisible();
        await expect(page.locator('#toolbar .toolbar-button-relations-toggle')).toHaveClass(/toolbar-button-relations-active/);
        const focused = page.locator('.editor-left-pane .editor-table-row[data-row-index="1"] .editor-table-cell[data-col="1"]');
        await expect(focused).toHaveClass(/editor-table-cell-focused/);
    });

    test('EditorTableのスクロール・フォームビュー・選択セルがUserスコープへ保存され起動時に復元される', async ({page}) => {
        const fs = createDefaultFileSystem();
        fs['schema/test.json'] = createWideSchema(18);
        fs['data/test.csv'] = createWideCsv(80, 18);
        await installMockApiAsync(page, fs);
        await page.goto('/');

        await openTestTableAsync(page);
        const viewport = page.locator('.editor-left-pane .editor-table-main-viewport');
        await viewport.evaluate((element) => {
            element.scrollTop = 900;
            element.scrollLeft = 320;
        });
        await page.waitForFunction(() => {
            const element = document.querySelector('.editor-left-pane .editor-table-main-viewport') as HTMLElement | null;
            return element !== null && element.scrollTop >= 800 && element.scrollLeft >= 200;
        });

        const targetCell = page.locator('.editor-left-pane .editor-table-row[data-row-index="30"] .editor-table-cell[data-col="5"]');
        await expect(targetCell).toBeVisible();
        await targetCell.click();
        await page.locator('#toolbar .toolbar-button-form-toggle').click();
        await expect(page.locator('.form-panel')).toBeVisible();

        await page.waitForFunction((path) => {
            const raw = (window as unknown as {__mockFs: Record<string, string>}).__mockFs[path];
            if (typeof raw !== 'string') return false;
            const parsed = JSON.parse(raw) as {
                tabs?: {
                    open?: Array<{
                        name?: string;
                        scroll?: {scrollLeft?: number; scrollTop?: number} | null;
                        editorTable?: {
                            scroll?: {scrollLeft?: number; scrollTop?: number};
                            relationsPanelVisible?: boolean;
                            formPanel?: {navStack?: Array<{tableName?: string; pkValue?: string}>} | null;
                            selection?: {focus?: {row?: number; column?: number}; range?: {startRow?: number; startColumn?: number; endRow?: number; endColumn?: number}};
                        } | null;
                    }>;
                };
            };
            const tab = parsed.tabs?.open?.find(item => item.name === 'test');
            return tab?.scroll?.scrollTop !== undefined
                && tab.scroll.scrollTop > 0
                && tab.scroll.scrollLeft !== undefined
                && tab.scroll.scrollLeft > 0
                && tab.editorTable?.scroll?.scrollTop !== undefined
                && tab.editorTable.scroll.scrollTop > 0
                && tab.editorTable.scroll.scrollLeft !== undefined
                && tab.editorTable.scroll.scrollLeft > 0
                && tab.editorTable.relationsPanelVisible === false
                && tab.editorTable.formPanel?.navStack?.[0]?.tableName === 'test'
                && tab.editorTable.formPanel.navStack[0].pkValue === '31'
                && tab.editorTable.selection?.focus?.row === 31
                && tab.editorTable.selection.focus.column === 6;
        }, UI_STATE_FILE, {timeout: 5000});

        const savedRaw = await readMockFileAsync(page, UI_STATE_FILE);
        const restoredFs = createDefaultFileSystem();
        restoredFs['schema/test.json'] = createWideSchema(18);
        restoredFs['data/test.csv'] = createWideCsv(80, 18);
        restoredFs[UI_STATE_FILE] = savedRaw;

        const secondPage = await page.context().newPage();
        await installMockApiAsync(secondPage, restoredFs);
        await secondPage.goto('/');

        await expect(secondPage.locator('.form-panel')).toBeVisible();
        await expect(secondPage.locator('.form-panel-field[data-column-name="id"] .form-panel-field-input')).toHaveValue('31');
        await secondPage.waitForFunction(() => {
            const element = document.querySelector('.editor-left-pane .editor-table-main-viewport') as HTMLElement | null;
            return element !== null && element.scrollTop > 0 && element.scrollLeft > 0;
        });
        const focusedInfo = await secondPage.evaluate(() => {
            const cell = document.querySelector('.editor-left-pane .editor-table-cell-focused') as HTMLElement | null;
            const row = cell?.closest('.editor-table-row') as HTMLElement | null;
            return {
                rowIndex: row?.dataset.rowIndex ?? null,
                col: cell?.dataset.col ?? null,
            };
        });
        expect(focusedInfo).toEqual({rowIndex: '30', col: '5'});
        await secondPage.close();
    });

    test('EditorTableの横スクロールがフォームビューなしでも起動時に復元される', async ({page}) => {
        const fs = createDefaultFileSystem();
        fs['schema/test.json'] = createWideSchema(24);
        fs['data/test.csv'] = createWideCsv(40, 24);
        await installMockApiAsync(page, fs);
        await page.goto('/');

        await openTestTableAsync(page);
        const viewport = page.locator('.editor-left-pane .editor-table-main-viewport');
        await viewport.evaluate((element) => {
            element.scrollLeft = 520;
            element.dispatchEvent(new Event('scroll'));
        });
        await page.waitForFunction(() => {
            const element = document.querySelector('.editor-left-pane .editor-table-main-viewport') as HTMLElement | null;
            return element !== null && element.scrollLeft >= 300;
        });
        await page.waitForFunction((path) => {
            const raw = (window as unknown as {__mockFs: Record<string, string>}).__mockFs[path];
            if (typeof raw !== 'string') return false;
            const parsed = JSON.parse(raw) as {tabs?: {open?: Array<{name?: string; editorTable?: {scroll?: {scrollLeft?: number}} | null}>}};
            const tab = parsed.tabs?.open?.find(item => item.name === 'test');
            return typeof tab?.editorTable?.scroll?.scrollLeft === 'number' && tab.editorTable.scroll.scrollLeft >= 300;
        }, UI_STATE_FILE, {timeout: 5000});

        const savedRaw = await readMockFileAsync(page, UI_STATE_FILE);
        const saved = JSON.parse(savedRaw) as {tabs: {open: Array<{name: string; editorTable: {scroll: {scrollLeft: number}} | null}>}};
        const savedScrollLeft = saved.tabs.open.find(tab => tab.name === 'test')?.editorTable?.scroll.scrollLeft ?? 0;

        const restoredFs = createDefaultFileSystem();
        restoredFs['schema/test.json'] = createWideSchema(24);
        restoredFs['data/test.csv'] = createWideCsv(40, 24);
        restoredFs[UI_STATE_FILE] = savedRaw;

        const secondPage = await page.context().newPage();
        await installMockApiAsync(secondPage, restoredFs);
        await secondPage.goto('/');

        await expect(secondPage.locator('.tab-button-active')).toHaveText(/test/);
        await expect(secondPage.locator('.form-panel')).toHaveCount(0);
        await secondPage.waitForFunction((expected) => {
            const element = document.querySelector('.editor-left-pane .editor-table-main-viewport') as HTMLElement | null;
            return element !== null && element.scrollLeft >= expected - 2;
        }, savedScrollLeft, {timeout: 5000});
        await secondPage.close();
    });

    test('フォームビューを閉じた状態がUserスコープへ保存され起動時に再表示されない', async ({page}) => {
        const fs = createDefaultFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        await openTestTableAsync(page);
        const toggleButton = page.locator('#toolbar .toolbar-button-form-toggle');
        await toggleButton.click();
        await expect(page.locator('.form-panel')).toBeVisible();
        await page.waitForFunction((path) => {
            const raw = (window as unknown as {__mockFs: Record<string, string>}).__mockFs[path];
            if (typeof raw !== 'string') return false;
            const parsed = JSON.parse(raw) as {tabs?: {open?: Array<{name?: string; editorTable?: {formPanel?: unknown} | null}>}};
            const tab = parsed.tabs?.open?.find(item => item.name === 'test');
            return tab?.editorTable?.formPanel !== null && tab?.editorTable?.formPanel !== undefined;
        }, UI_STATE_FILE, {timeout: 5000});

        await toggleButton.click();
        await expect(page.locator('.form-panel')).toHaveCount(0);
        await page.waitForFunction((path) => {
            const raw = (window as unknown as {__mockFs: Record<string, string>}).__mockFs[path];
            if (typeof raw !== 'string') return false;
            const parsed = JSON.parse(raw) as {tabs?: {open?: Array<{name?: string; editorTable?: {formPanel?: unknown} | null}>}};
            const tab = parsed.tabs?.open?.find(item => item.name === 'test');
            return tab?.editorTable?.formPanel === null;
        }, UI_STATE_FILE, {timeout: 5000});

        const savedRaw = await readMockFileAsync(page, UI_STATE_FILE);
        const secondPage = await page.context().newPage();
        const restoredFs = createDefaultFileSystem();
        restoredFs[UI_STATE_FILE] = savedRaw;
        await installMockApiAsync(secondPage, restoredFs);
        await secondPage.goto('/');

        await expect(secondPage.locator('.tab-button-active')).toHaveText(/test/);
        await expect(secondPage.locator('.form-panel')).toHaveCount(0);
        await expect(secondPage.locator('#toolbar .toolbar-button-form-toggle')).not.toHaveClass(/toolbar-button-form-active/);
        await secondPage.close();
    });

    test('tab-button-descriptionがUserスコープへ保存され、起動時はタブレイアウトだけ先に復元される', async ({page}) => {
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
        expect(saved.tabs.open.find(tab => tab.name === 'test')).toMatchObject({name: 'test', description: 'Test table description', diff: null});

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
