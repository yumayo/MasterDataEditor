import {Page} from '@playwright/test';
import {test, expect} from './fixtures/test';
import {createDefaultFileSystem, installMockApiAsync, readMockFileAsync} from './fixtures/mock-api';

const UI_STATE_FILE = 'userdata/ui-state.json';

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
                tabs?: {open?: string[]; active?: string | null};
            };
            return parsed.sidebar?.activePanel === 'bookmarks'
                && typeof parsed.sidebar.width === 'number'
                && parsed.sidebar.width >= 360
                && parsed.bottomPanel?.visible === true
                && parsed.bottomPanel.activeTab === 'debug'
                && typeof parsed.bottomPanel.height === 'number'
                && parsed.bottomPanel.height > 300
                && Array.isArray(parsed.tabs?.open)
                && parsed.tabs.open.includes('test')
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
        const state = JSON.parse(raw) as {
            sidebar: {width: number; activePanel: string};
            bottomPanel: {visible: boolean; height: number; activeTab: string};
            tabs: {open: string[]; active: string | null};
        };
        expect(state.sidebar.activePanel).toBe('bookmarks');
        expect(state.sidebar.width).toBeGreaterThanOrEqual(360);
        expect(state.bottomPanel.visible).toBe(true);
        expect(state.bottomPanel.activeTab).toBe('debug');
        expect(state.bottomPanel.height).toBeGreaterThan(300);
        expect(state.tabs.open).toContain('test');
        expect(state.tabs.active).toBe('test');
    });

    test('userdata/ui-state.jsonが存在すれば起動時にUI状態が復元される', async ({page}) => {
        const fs = createDefaultFileSystem();
        fs[UI_STATE_FILE] = JSON.stringify({
            sidebar: {width: 420, activePanel: 'bookmarks'},
            bottomPanel: {visible: true, height: 360, activeTab: 'debug'},
            tabs: {open: ['test'], active: 'test'},
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
});
