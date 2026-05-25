import { test, expect } from './fixtures/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

function createFileSystem(useFreeze = true): MockFileSystem {
    const rows = ['id,name,value_1,value_2,value_3'];
    for (let i = 1; i <= 1000; i++) {
        rows.push(`${i},name_${i},v1_${i},v2_${i},v3_${i}`);
    }
    return {
        'schema/item.json': JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int' },
                { key: 1, name: 'name', type: 'string' },
                { key: 2, name: 'value_1', type: 'string' },
                { key: 3, name: 'value_2', type: 'string' },
                { key: 4, name: 'value_3', type: 'string' },
            ],
            primary_key: ['id'],
            ...(useFreeze ? { frozenRowCount: 1, frozenColumnCount: 1 } : {}),
        }),
        'data/item.csv': rows.join('\n'),
    };
}

test.describe('バッファ空行からの上矢印スクロール', () => {
    test('100行以上のテーブル最下部の空行セルから上矢印を押しても縦スクロール位置が変動しない', async ({ page }) => {
        await page.setViewportSize({ width: 640, height: 480 });
        await installMockApiAsync(page, createFileSystem());
        await page.goto('/');

        await page.locator('#explorer .explorer-file').getByText('item', { exact: true }).click();
        const table = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="item"] .editor-table');
        await expect(table).toBeVisible();

        const scrollContainer = page.locator('.editor-left-pane .editor-table-main-viewport');
        await scrollContainer.evaluate((element) => { element.scrollTop = element.scrollHeight; });
        await page.waitForTimeout(100);

        const emptyRowCell = table.locator('.editor-table-grid .editor-table-empty-row .editor-table-cell[data-col="2"]');
        await expect(emptyRowCell).toBeVisible();
        await emptyRowCell.click();
        await page.waitForTimeout(50);

        const before = await scrollContainer.evaluate((element) => element.scrollTop);
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(100);

        const metrics = await page.evaluate(() => {
            const container = document.querySelector('.editor-left-pane .editor-table-main-viewport') as HTMLElement | null;
            const focusedCell = document.querySelector('.editor-left-pane .editor-table-grid .editor-table-cell-focused') as HTMLElement | null;
            if (container === null || focusedCell === null) return null;
            const containerRect = container.getBoundingClientRect();
            const focusedRect = focusedCell.getBoundingClientRect();
            const row = focusedCell.closest('.editor-table-row') as HTMLElement | null;
            return {
                scrollTop: container.scrollTop,
                rowIndex: row?.dataset.rowIndex ?? null,
                focusedTop: focusedRect.top,
                focusedBottom: focusedRect.bottom,
                visibleTop: containerRect.top,
                visibleBottom: containerRect.bottom,
            };
        });
        expect(metrics).not.toBeNull();
        expect(metrics!.rowIndex).toBe('999');
        expect(metrics!.focusedTop).toBeGreaterThanOrEqual(metrics!.visibleTop);
        expect(metrics!.focusedBottom).toBeLessThanOrEqual(metrics!.visibleBottom);
        expect(metrics!.scrollTop).toBe(before);
    });
});
