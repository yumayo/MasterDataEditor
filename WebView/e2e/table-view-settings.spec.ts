import { test, expect } from './fixtures/test';
import type { Locator, Page } from '@playwright/test';
import { installMockApiAsync, readMockFileAsync, type MockFileSystem } from './fixtures/mock-api';

const VIEW_SETTINGS_FILE = 'user:table-view-settings.json';
const EMPTY_SETTINGS = { frozenRightColumnCount: 0, frozenColumnCount: 0, frozenRowCount: 0, sortKeys: [], filters: {} };
const LEGACY_SETTINGS = {
    frozenColumnCount: 2,
    frozenRowCount: 1,
    sortKeys: [{ columnName: 'id', direction: 'asc' }],
    filters: { name: ['alpha'] },
};

function createFileSystem(legacySettings: boolean): MockFileSystem {
    const schema = JSON.stringify({
        header: [{ key: 0, name: 'id', type: 'int' }, { key: 1, name: 'name', type: 'string' }, { key: 2, name: 'value', type: 'int' }],
        primary_key: ['id'],
        description: '表示設定の保存で変更してはいけない定義',
        ...(legacySettings ? LEGACY_SETTINGS : {}),
    }, null, 2);
    const csv = 'id,name,value\n2,beta,200\n10,alpha,900\n1,alpha,100';
    return { 'schema/item.json': schema, 'data/item.csv': csv, 'schema/other.json': schema, 'data/other.csv': csv };
}

async function openTableAsync(page: Page, name: string): Promise<Locator> {
    await page.locator('#explorer').getByText(name, { exact: true }).click();
    const table = activeTable(page);
    await expect(table).toBeVisible();
    return table;
}

function activeTable(page: Page): Locator {
    return page.locator('.editor-left-pane .editor-table:visible');
}

/** タブ状態の遅延保存が完了してから再読込し、自動復元されたテーブルを検証する。 */
async function reloadWithStoredTabAsync(page: Page, tableName: string): Promise<void> {
    await expect.poll(async () => {
        const text = await readMockFileAsync(page, 'user:ui-state.json');
        if (typeof text !== 'string') return false;
        const state = JSON.parse(text) as { tabs: { open: { name: string }[]; active: string | null } };
        return state.tabs.active === tableName && state.tabs.open.some(tab => tab.name === tableName);
    }).toBe(true);
    await page.reload();
    await expect(activeTable(page)).toBeVisible();
}

function columnHeader(table: Locator, index: number): Locator {
    return table.locator(`.editor-table-column-header[data-column-index="${index}"]:visible`).first();
}

async function contextActionAsync(page: Page, target: Locator, label: string): Promise<void> {
    await target.click({ button: 'right' });
    await page.locator('.context-menu.visible .context-menu-item').filter({ hasText: label }).click();
}

async function filterAlphaAsync(page: Page, table: Locator): Promise<void> {
    await columnHeader(table, 1).locator('.filter-icon').click();
    const dropdown = page.locator('.filter-dropdown.visible');
    await dropdown.locator('.filter-item').filter({ hasText: 'beta' }).locator('input[type="checkbox"]').uncheck();
    await dropdown.locator('.filter-apply').click();
}

async function readSettingsAsync(page: Page): Promise<unknown> {
    const text = await readMockFileAsync(page, VIEW_SETTINGS_FILE);
    return typeof text === 'string' ? JSON.parse(text) : null;
}

/** 指定した表示設定I/Oを一度だけ失敗させ、その後の要求は通常どおり処理する。 */
async function failNextSettingsRequestAsync(page: Page, requestType: 'read_file_request' | 'write_file_request'): Promise<void> {
    await page.evaluate((type) => {
        const webview = (window as unknown as { chrome: { webview: { postMessage(message: string | object): void } } }).chrome.webview;
        const original = webview.postMessage.bind(webview);
        webview.postMessage = (message: string | object): void => {
            const request = (typeof message === 'string' ? JSON.parse(message) : message) as { type: string; filename: string; scope: string };
            if (request.type === type && request.filename === 'table-view-settings.json' && request.scope === 'user') {
                webview.postMessage = original;
                throw new Error('表示設定I/Oの一時的な失敗');
            }
            original(message);
        };
    }, requestType);
}

async function expectSchemaUnchangedAsync(page: Page, fs: MockFileSystem): Promise<void> {
    expect(await readMockFileAsync(page, 'schema/item.json')).toBe(fs['schema/item.json']);
    const writes = await page.evaluate(() => {
        const mockWindow = window as unknown as { __mockApiRequestDetails: { type: string; filename: string | null; scope: string | null }[] };
        return mockWindow.__mockApiRequestDetails.filter(request => request.type === 'write_file_request' && request.filename?.startsWith('schema/'));
    });
    expect(writes).toEqual([]);
}

async function expectRestoredAsync(table: Locator): Promise<void> {
    await expect(columnHeader(table, 0)).toHaveClass(/sort-asc/);
    await expect(columnHeader(table, 1)).toHaveClass(/freeze-column-border/);
    await expect(table.locator('.editor-table-row.freeze-row-border')).toHaveCount(1);
    const rows = table.locator('.editor-table-row:not(.editor-table-empty-row):not([style*="display: none"])');
    await expect(rows).toHaveCount(2);
    const ids = await rows.evaluateAll(elements => elements.map(row => row.querySelector('.editor-table-cell:not(.editor-table-row-header)')?.textContent));
    expect(ids).toEqual(['1', '10']);
}

test.describe('テーブル表示設定のユーザーデータ保存', () => {
    test('表示操作とCtrl+Sはユーザーデータへ保存し、再オープンと再読込で復元する', async ({ page }) => {
        const fs = createFileSystem(false);
        await installMockApiAsync(page, fs);
        await page.goto('/');
        const table = await openTableAsync(page, 'item');
        await columnHeader(table, 0).locator('.sort-indicator').click();
        await filterAlphaAsync(page, table);
        await contextActionAsync(page, columnHeader(table, 1), '先頭からこの列まで固定');
        await contextActionAsync(page, table.locator('.editor-table-detached-row-header-layer .editor-table-row-header:visible').first(), 'この行まで固定');

        await expect.poll(() => readSettingsAsync(page)).toEqual({ tables: { item: {...LEGACY_SETTINGS, frozenRightColumnCount: 0} } });
        await page.keyboard.press('Control+s');
        await expect.poll(async () => page.evaluate(() => {
            const requests = (window as unknown as { __mockApiRequestDetails: { type: string; filename: string | null }[] }).__mockApiRequestDetails;
            return requests.some(request => request.type === 'write_file_request' && request.filename === 'data/item.csv');
        })).toBe(true);
        await expectSchemaUnchangedAsync(page, fs);

        await page.locator('.tab-button').filter({ hasText: 'item' }).locator('.tab-button-close').click();
        await expectRestoredAsync(await openTableAsync(page, 'item'));
        await reloadWithStoredTabAsync(page, 'item');
        await expectRestoredAsync(activeTable(page));
        await expectSchemaUnchangedAsync(page, fs);
    });

    test('既存スキーマの表示設定を初回だけ移行し、スキーマ原文は変更しない', async ({ page }) => {
        const fs = createFileSystem(true);
        await installMockApiAsync(page, fs);
        await page.goto('/');
        await expectRestoredAsync(await openTableAsync(page, 'item'));
        await expect.poll(() => readSettingsAsync(page)).toEqual({ tables: { item: {...LEGACY_SETTINGS, frozenRightColumnCount: 0} } });
        await expectSchemaUnchangedAsync(page, fs);
    });

    test('表示設定の一時的な読込失敗後も別テーブルで再試行でき、既存設定を上書きしない', async ({ page }) => {
        const fs = createFileSystem(false);
        fs[VIEW_SETTINGS_FILE] = JSON.stringify({ tables: { item: LEGACY_SETTINGS, other: LEGACY_SETTINGS } });
        await installMockApiAsync(page, fs);
        await page.goto('/');
        await failNextSettingsRequestAsync(page, 'read_file_request');
        await page.locator('#explorer').getByText('item', { exact: true }).click();
        await expect(page.locator('.notification-toast-error')).toHaveText('テーブルの読み込みに失敗しました');
        expect(await readMockFileAsync(page, VIEW_SETTINGS_FILE)).toBe(fs[VIEW_SETTINGS_FILE]);

        await expectRestoredAsync(await openTableAsync(page, 'other'));
        expect(await readMockFileAsync(page, VIEW_SETTINGS_FILE)).toBe(fs[VIEW_SETTINGS_FILE]);
        await expectSchemaUnchangedAsync(page, fs);
    });

    test('初回移行の保存失敗を通知してテーブルを開き、Ctrl+Sで移行を再試行できる', async ({ page }) => {
        const fs = createFileSystem(true);
        await installMockApiAsync(page, fs);
        await page.goto('/');
        await failNextSettingsRequestAsync(page, 'write_file_request');
        await expectRestoredAsync(await openTableAsync(page, 'item'));
        await expect(page.locator('.notification-toast-error')).toHaveText('テーブル表示設定の移行に失敗しました');
        expect(await readSettingsAsync(page)).toBeNull();
        await expectSchemaUnchangedAsync(page, fs);

        await page.keyboard.press('Control+s');
        await expect.poll(() => readSettingsAsync(page)).toEqual({ tables: { item: {...LEGACY_SETTINGS, frozenRightColumnCount: 0} } });
        await expectSchemaUnchangedAsync(page, fs);
    });

    test('ユーザーデータの空設定が既存スキーマより優先され、解除状態が復活しない', async ({ page }) => {
        const fs = createFileSystem(true);
        fs[VIEW_SETTINGS_FILE] = JSON.stringify({ tables: { item: EMPTY_SETTINGS } });
        await installMockApiAsync(page, fs);
        await page.goto('/');
        for (let attempt = 0; attempt < 2; attempt++) {
            const table = attempt === 0 ? await openTableAsync(page, 'item') : activeTable(page);
            await expect(columnHeader(table, 0)).not.toHaveClass(/sort-asc|sort-desc/);
            await expect(columnHeader(table, 1)).not.toHaveClass(/freeze-column-border/);
            await expect(table.locator('.editor-table-row.freeze-row-border')).toHaveCount(0);
            await expect(table.locator('.editor-table-row:not(.editor-table-empty-row):visible')).toHaveCount(3);
            expect(await readSettingsAsync(page)).toEqual({ tables: { item: EMPTY_SETTINGS } });
            await expectSchemaUnchangedAsync(page, fs);
            if (attempt === 0) await reloadWithStoredTabAsync(page, 'item');
        }
    });

    for (const setting of ['sortKeys', 'filters', 'frozenColumnCount', 'frozenRowCount'] as const) {
        const supportsHistory = setting === 'sortKeys' || setting === 'filters';
        test(`${setting}の${supportsHistory ? 'Undo・Redo・解除' : '適用・解除'}をユーザーデータに保存する`, async ({ page }) => {
            const fs = createFileSystem(false);
            await installMockApiAsync(page, fs);
            await page.goto('/');
            const table = await openTableAsync(page, 'item');
            if (setting === 'sortKeys') await columnHeader(table, 0).locator('.sort-indicator').click();
            if (setting === 'filters') await filterAlphaAsync(page, table);
            if (setting === 'frozenColumnCount') await contextActionAsync(page, columnHeader(table, 1), '先頭からこの列まで固定');
            if (setting === 'frozenRowCount') await contextActionAsync(page, table.locator('.editor-table-detached-row-header-layer .editor-table-row-header:visible').first(), 'この行まで固定');
            const applied = { ...EMPTY_SETTINGS, [setting]: LEGACY_SETTINGS[setting] };
            await expect.poll(() => readSettingsAsync(page)).toEqual({ tables: { item: applied } });
            if (supportsHistory) {
                await page.keyboard.press('Control+z');
                await expect.poll(() => readSettingsAsync(page)).toEqual({ tables: { item: EMPTY_SETTINGS } });
                await page.keyboard.press('Control+y');
                await expect.poll(() => readSettingsAsync(page)).toEqual({ tables: { item: applied } });
            }

            if (setting === 'sortKeys') {
                await columnHeader(table, 0).locator('.sort-indicator').click();
                await columnHeader(table, 0).locator('.sort-indicator').click();
            }
            if (setting === 'filters') {
                await columnHeader(table, 1).locator('.filter-icon').click();
                await page.locator('.filter-dropdown.visible .filter-clear').click();
            }
            if (setting === 'frozenColumnCount') await contextActionAsync(page, columnHeader(table, 0), '列の固定を解除');
            if (setting === 'frozenRowCount') await contextActionAsync(page, table.locator('.editor-table-detached-frozen-corner-layer .editor-table-row-header:visible').first(), '行の固定を解除');
            await expect.poll(() => readSettingsAsync(page)).toEqual({ tables: { item: EMPTY_SETTINGS } });
            await expectSchemaUnchangedAsync(page, fs);
            if (!supportsHistory) {
                await reloadWithStoredTabAsync(page, 'item');
                const restored = activeTable(page);
                await expect(columnHeader(restored, 1)).not.toHaveClass(/freeze-column-border/);
                await expect(restored.locator('.editor-table-row.freeze-row-border')).toHaveCount(0);
                expect(await readSettingsAsync(page)).toEqual({ tables: { item: EMPTY_SETTINGS } });
            }
        });
    }

    test('保存中に別テーブルを変更しても両方の設定と未表示テーブルの設定を保持する', async ({ page }) => {
        const fs = createFileSystem(false);
        fs[VIEW_SETTINGS_FILE] = JSON.stringify({ tables: { unopened: LEGACY_SETTINGS } });
        await installMockApiAsync(page, fs);
        await page.goto('/');
        await openTableAsync(page, 'other');
        const table = await openTableAsync(page, 'item');
        // 最初の保存要求を保留し、別テーブルの変更が重なる状況を再現する。
        await page.evaluate(() => {
            const testWindow = window as unknown as { chrome: { webview: { postMessage(message: string | object): void } }; __releaseViewSettingsWrite: () => void; __viewSettingsWriteHeld: boolean };
            const original = testWindow.chrome.webview.postMessage.bind(testWindow.chrome.webview);
            testWindow.__viewSettingsWriteHeld = false;
            testWindow.chrome.webview.postMessage = (message: string | object): void => {
                const request = (typeof message === 'string' ? JSON.parse(message) : message) as { type: string; filename: string; scope: string };
                if (!testWindow.__viewSettingsWriteHeld && request.type === 'write_file_request' && request.filename === 'table-view-settings.json' && request.scope === 'user') {
                    testWindow.__viewSettingsWriteHeld = true;
                    testWindow.__releaseViewSettingsWrite = (): void => {
                        testWindow.chrome.webview.postMessage = original;
                        original(message);
                    };
                    return;
                }
                original(message);
            };
        });
        await columnHeader(table, 0).locator('.sort-indicator').click();
        await expect.poll(() => page.evaluate(() => (window as unknown as { __viewSettingsWriteHeld: boolean }).__viewSettingsWriteHeld)).toBe(true);
        const other = await openTableAsync(page, 'other');
        await filterAlphaAsync(page, other);
        await page.evaluate(() => (window as unknown as { __releaseViewSettingsWrite: () => void }).__releaseViewSettingsWrite());
        await expect.poll(() => readSettingsAsync(page)).toEqual({ tables: {
            unopened: {...LEGACY_SETTINGS, frozenRightColumnCount: 0},
            item: { ...EMPTY_SETTINGS, sortKeys: LEGACY_SETTINGS.sortKeys },
            other: { ...EMPTY_SETTINGS, filters: LEGACY_SETTINGS.filters },
        } });
        expect(await readMockFileAsync(page, 'schema/other.json')).toBe(fs['schema/other.json']);
        await expectSchemaUnchangedAsync(page, fs);
    });
});
