import {test, expect} from './fixtures/test';
import type {Page} from '@playwright/test';
import {installMockApiAsync, readMockFileAsync, type MockFileSystem} from './fixtures/mock-api';

const UI_STATE_FILE = 'user:ui-state.json';

function createSchema(): string {
    return JSON.stringify({
        header: [
            {key: 0, name: 'id', type: 'int'},
            {key: 1, name: 'name', type: 'string'},
        ],
        primary_key: ['id'],
    });
}

function createCsv(prefix: string): string {
    return [
        'id,name',
        `1,${prefix}_a`,
        `2,${prefix}_b`,
    ].join('\n');
}

function createFileSystem(): MockFileSystem {
    const fs: MockFileSystem = {
        'user:bookmarks.json': '[]',
        'plugins/.gitkeep': '',
    };
    for (const tableName of ['item', 'enemy', 'quest']) {
        fs[`schema/${tableName}.json`] = createSchema();
        fs[`data/${tableName}.csv`] = createCsv(tableName);
    }
    return fs;
}

async function openTableAsync(page: Page, tableName: string): Promise<void> {
    await page.locator('#explorer .explorer-file').getByText(tableName, {exact: true}).click();
    await expect(page.locator(`.tab-wrapper[data-tab-name="${tableName}"] .editor-table`)).toBeVisible();
}

async function getTabNamesAsync(page: Page): Promise<string[]> {
    return page.locator('.tab-button .tab-button-name').evaluateAll(elements =>
        elements.map(element => element.textContent ?? ''),
    );
}

test.describe('tab pinning', () => {
    test('pinning a tab keeps it at the start and persists pinned state', async ({page}) => {
        await installMockApiAsync(page, createFileSystem());
        await page.goto('/');

        await openTableAsync(page, 'item');
        await openTableAsync(page, 'enemy');
        await openTableAsync(page, 'quest');
        expect(await getTabNamesAsync(page)).toEqual(['item', 'enemy', 'quest']);

        await page.locator('.tab-button[title="enemy"]').click({button: 'right'});
        await page.locator('.context-menu-item', {hasText: 'タブを固定'}).click();

        await expect(page.locator('.tab-button[title="enemy"]')).toHaveClass(/tab-button-pinned/);
        await expect(page.locator('.tab-button[title="enemy"] .tab-button-pin-indicator')).toBeVisible();
        expect(await getTabNamesAsync(page)).toEqual(['enemy', 'item', 'quest']);

        await page.waitForFunction((path) => {
            const raw = (window as unknown as {__mockFs: Record<string, string>}).__mockFs[path];
            if (typeof raw !== 'string') return false;
            const parsed = JSON.parse(raw) as {
                tabs?: {open?: Array<{name?: string; pinned?: boolean}>};
            };
            const enemyTab = parsed.tabs?.open?.find(tab => tab.name === 'enemy');
            return enemyTab?.pinned === true;
        }, UI_STATE_FILE, {timeout: 5000});

        const raw = await readMockFileAsync(page, UI_STATE_FILE);
        const state = JSON.parse(raw) as {
            tabs: {open: Array<{name: string; pinned: boolean}>};
        };
        expect(state.tabs.open.map(tab => ({name: tab.name, pinned: tab.pinned}))).toEqual([
            {name: 'enemy', pinned: true},
            {name: 'item', pinned: false},
            {name: 'quest', pinned: false},
        ]);
    });

    test('pinned tabs are restored from UI state before normal tabs', async ({page}) => {
        const fs = createFileSystem();
        fs[UI_STATE_FILE] = JSON.stringify({
            tabs: {
                open: [
                    {name: 'item', description: null, pinned: false, diff: null},
                    {name: 'enemy', description: null, pinned: true, diff: null},
                    {name: 'quest', description: null, pinned: false, diff: null},
                ],
                active: 'quest',
                scroll: {scrollLeft: 0, scrollTop: 0},
            },
        });
        await installMockApiAsync(page, fs);
        await page.goto('/');

        await expect(page.locator('.tab-button')).toHaveCount(3);
        await expect(page.locator('.tab-button[title="enemy"]')).toHaveClass(/tab-button-pinned/);
        await expect(page.locator('.tab-button-active')).toContainText('quest');
        expect(await getTabNamesAsync(page)).toEqual(['enemy', 'item', 'quest']);

        await page.locator('.tab-button[title="enemy"]').click({button: 'right'});
        await page.locator('.context-menu-item', {hasText: 'タブの固定を解除'}).click();
        await expect(page.locator('.tab-button[title="enemy"]')).not.toHaveClass(/tab-button-pinned/);
    });
});
