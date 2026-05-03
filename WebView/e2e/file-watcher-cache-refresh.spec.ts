import { test, expect } from './fixtures/test';
import type { Locator, Page } from '@playwright/test';
import { createDefaultFileSystem, installMockApiAsync } from './fixtures/mock-api';

async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    await page.locator('#explorer').getByText(tableName, { exact: true }).click();
    const table = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="${tableName}"] .editor-table`);
    await expect(table).toBeVisible();
    return table;
}

async function closeTableAsync(page: Page, tableName: string): Promise<void> {
    const tabButton = page.locator('.tab-button').filter({ hasText: tableName }).first();
    await expect(tabButton).toBeVisible();
    await tabButton.locator('.tab-button-close').click();
    await expect(page.locator('.tab-button').filter({ hasText: tableName })).toHaveCount(0);
}

function getColumnHeaders(table: Locator): Locator {
    return table.locator('.editor-table-detached-column-header-layer .editor-table-column-header');
}

function getDataCell(table: Locator, rowIndex: number, colIndex: number): Locator {
    const row = table.locator('.editor-table-grid .editor-table-row:not(.editor-table-column-header-row):not(.editor-table-empty-row)').nth(rowIndex);
    return row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
}

test.describe('ファイルウォッチャー後のタブ再オープン', () => {
    test('外部変更通知後にタブを開き直すとスキーマとCSVのキャッシュを更新する', async ({ page }) => {
        await installMockApiAsync(page, createDefaultFileSystem());
        await page.goto('/');

        // 起動時バリデーションの常駐ストア登録が完了する時間を確保する。
        await page.waitForTimeout(50);

        const firstTable = await openTableAsync(page, 'test');
        await expect(getColumnHeaders(firstTable)).toHaveCount(3);
        await closeTableAsync(page, 'test');

        const updatedSchema = JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int' },
                { key: 1, name: 'name', type: 'string' },
                { key: 2, name: 'value', type: 'int' },
                { key: 3, name: 'extra', type: 'string' },
            ],
            primary_key: ['id'],
        });
        const updatedCsv = [
            'id,name,value,extra',
            '1,item_a,100,alpha',
            '2,item_b,200,beta',
            '3,item_c,300,gamma',
        ].join('\n');

        await page.evaluate(({ schema, csv }) => {
            const fs = (window as unknown as { __mockFs: Record<string, string> }).__mockFs;
            fs['schema/test.json'] = schema;
            fs['data/test.csv'] = csv;
            window.chrome.webview.postMessage(JSON.stringify({ type: 'file_changed' }));
        }, { schema: updatedSchema, csv: updatedCsv });
        await page.waitForTimeout(50);

        const reopenedTable = await openTableAsync(page, 'test');
        const headers = getColumnHeaders(reopenedTable);
        await expect(headers).toHaveCount(4);
        await expect(headers.nth(3)).toContainText('extra');
        await expect(getDataCell(reopenedTable, 0, 3)).toHaveText('alpha');
    });
});
