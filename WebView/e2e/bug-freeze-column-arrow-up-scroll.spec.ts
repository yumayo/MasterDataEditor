import { test, expect } from './fixtures/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

function createFileSystem(): MockFileSystem {
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
            frozenColumnCount: 1,
        }),
        'data/item.csv': rows.join('\n'),
    };
}

test.describe('固定列セルの上矢印スクロール', () => {
    test('画面外の固定列セルから上へ移動してもスクロール量が1行分に収まる', async ({ page }) => {
        await page.setViewportSize({ width: 640, height: 480 });
        await installMockApiAsync(page, createFileSystem());
        await page.goto('/');

        await page.locator('#explorer .explorer-file').getByText('item', { exact: true }).click();
        const table = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="item"] .editor-table');
        await expect(table).toBeVisible();

        const fixedCell = table.locator(
            '.editor-table-detached-row-header-layer .editor-table-detached-row[data-row-index="48"] .editor-table-cell[data-col="0"]',
        );
        await expect(fixedCell).toBeVisible();
        await fixedCell.click();

        const scrollContainer = page.locator('.editor-left-pane .editor-table-main-viewport');
        await scrollContainer.evaluate((element) => { element.scrollTop = element.scrollHeight; });
        await page.waitForTimeout(100);

        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(100);
        const afterFirstArrow = await scrollContainer.evaluate((element) => element.scrollTop);

        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(100);
        const afterSecondArrow = await scrollContainer.evaluate((element) => element.scrollTop);

        const metrics = await page.evaluate(() => {
            const row = document.querySelector('.editor-left-pane .editor-table-grid .editor-table-row:not(.editor-table-column-header-row):not(.editor-table-empty-row)') as HTMLElement | null;
            const focusedCell = document.querySelector('.editor-left-pane .editor-table-detached-row-header-layer .editor-table-cell-focused') as HTMLElement | null;
            const container = document.querySelector('.editor-left-pane .editor-table-main-viewport') as HTMLElement | null;
            if (row === null || focusedCell === null || container === null) return null;
            const focusedRect = focusedCell.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            return {
                rowHeight: row.getBoundingClientRect().height,
                focusedTop: focusedRect.top,
                visibleTop: containerRect.top,
            };
        });

        expect(metrics).not.toBeNull();
        const secondDelta = afterFirstArrow - afterSecondArrow;
        expect(Math.abs(secondDelta - metrics!.rowHeight)).toBeLessThanOrEqual(1);
        expect(Math.abs(metrics!.focusedTop - metrics!.visibleTop)).toBeLessThanOrEqual(1);
    });
});
