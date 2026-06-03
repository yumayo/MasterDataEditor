import { test, expect } from './fixtures/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

function generateCsv(rowCount: number): string {
    const rows = ['id,name,value'];
    for (let i = 1; i <= rowCount; i++) {
        rows.push(`${i},item_${i},${i * 10}`);
    }
    return rows.join('\n');
}

function createFileSystem(): MockFileSystem {
    return {
        'schema/item.json': JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int' },
                { key: 1, name: 'name', type: 'string' },
                { key: 2, name: 'value', type: 'int' },
            ],
            primary_key: ['id'],
        }),
        'data/item.csv': generateCsv(1000),
    };
}

test.describe('バーチャルスクロール selection 追従', () => {
    test('selection overlayの外枠はセルのborder-boxと一致する', async ({ page }) => {
        const fs = createFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        await page.locator('#explorer .explorer-file').getByText('item', { exact: true }).click();
        const table = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="item"] .editor-table');
        await expect(table).toBeVisible();

        const cell = table.locator('.editor-table-grid .editor-table-row[data-row-index="0"] .editor-table-cell[data-col="0"]');
        await cell.click();
        await expect(page.locator('.selection-overlay-border')).toHaveCount(1);

        const geometry = await page.evaluate(() => {
            const cell = document.querySelector<HTMLElement>(
                '.editor-left-pane .tab-wrapper[data-tab-name="item"] .editor-table-grid .editor-table-row[data-row-index="0"] .editor-table-cell[data-col="0"]',
            );
            const border = document.querySelector<HTMLElement>('.selection-overlay-border');
            if (cell === null) throw new Error('cell not found');
            if (border === null) throw new Error('selection overlay not found');
            const cellRect = cell.getBoundingClientRect();
            const borderRect = border.getBoundingClientRect();
            return {
                cellWidth: cellRect.width,
                cellHeight: cellRect.height,
                borderWidth: borderRect.width,
                borderHeight: borderRect.height,
            };
        });

        expect(Math.abs(geometry.borderWidth - geometry.cellWidth), JSON.stringify(geometry)).toBeLessThanOrEqual(0.01);
        expect(Math.abs(geometry.borderHeight - geometry.cellHeight), JSON.stringify(geometry)).toBeLessThanOrEqual(0.01);
    });

    test('selection overlayの背景は外枠より右下にはみ出さない', async ({ page }) => {
        const fs = createFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        await page.locator('#explorer .explorer-file').getByText('item', { exact: true }).click();
        const table = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="item"] .editor-table');
        await expect(table).toBeVisible();

        const firstCell = table.locator('.editor-table-grid .editor-table-row[data-row-index="0"] .editor-table-cell[data-col="0"]');
        const secondColumnCell = table.locator('.editor-table-grid .editor-table-row[data-row-index="0"] .editor-table-cell[data-col="1"]');
        await firstCell.click();
        await secondColumnCell.click({ modifiers: ['Shift'] });
        await expect(page.locator('.selection-overlay-bg')).not.toHaveCount(0);

        const geometry = await page.evaluate(() => {
            const border = document.querySelector<HTMLElement>('.selection-overlay-border');
            const backgrounds = Array.from(document.querySelectorAll<HTMLElement>('.selection-overlay-bg'));
            if (border === null) throw new Error('selection overlay not found');
            if (backgrounds.length === 0) throw new Error('selection background not found');
            const borderRect = border.getBoundingClientRect();
            const bgRects = backgrounds.map((element) => element.getBoundingClientRect());
            return {
                borderRight: borderRect.right,
                borderBottom: borderRect.bottom,
                maxBgRight: Math.max(...bgRects.map((rect) => rect.right)),
                maxBgBottom: Math.max(...bgRects.map((rect) => rect.bottom)),
            };
        });

        expect(geometry.maxBgRight, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.borderRight + 0.01);
        expect(geometry.maxBgBottom, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.borderBottom + 0.01);
    });

    test('selection overlayは列ヘッダーより背面に配置される', async ({ page }) => {
        const fs = createFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        await page.locator('#explorer .explorer-file').getByText('item', { exact: true }).click();
        const table = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="item"] .editor-table');
        await expect(table).toBeVisible();

        const firstCell = table.locator('.editor-table-grid .editor-table-row[data-row-index="0"] .editor-table-cell[data-col="0"]');
        const secondColumnCell = table.locator('.editor-table-grid .editor-table-row[data-row-index="0"] .editor-table-cell[data-col="1"]');
        await firstCell.click();
        await secondColumnCell.click({ modifiers: ['Shift'] });

        const zIndexes = await page.evaluate(() => {
            const overlay = document.querySelector<HTMLElement>('.selection-overlay');
            const headerLayer = document.querySelector<HTMLElement>('.editor-table-detached-column-header-layer');
            if (overlay === null) throw new Error('selection overlay not found');
            if (headerLayer === null) throw new Error('column header layer not found');
            return {
                overlay: Number(getComputedStyle(overlay).zIndex),
                headerLayer: Number(getComputedStyle(headerLayer).zIndex),
            };
        });

        expect(zIndexes.overlay, JSON.stringify(zIndexes)).toBeLessThan(zIndexes.headerLayer);
    });

    test('仮想スクロール領域の微小スクロールでもselection overlayがピクセル単位で追従する', async ({ page }) => {
        const fs = createFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        await page.locator('#explorer .explorer-file').getByText('item', { exact: true }).click();
        const table = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="item"] .editor-table');
        await expect(table).toBeVisible();

        const selectedDataRowIndex = await page.evaluate(() => {
            const editor = (window as unknown as {
                editor?: { activeEditorTable: {
                    getSelection(): {
                        start(row: number, column: number): void;
                        end(): void;
                    };
                } | false };
            }).editor;
            if (!editor || editor.activeEditorTable === false) throw new Error('activeEditorTable not found');

            const viewport = document.querySelector<HTMLElement>(
                '.editor-left-pane .tab-wrapper[data-tab-name="item"] .editor-table-main-viewport',
            );
            if (viewport === null) throw new Error('viewport not found');
            viewport.scrollTop = 8200;
            viewport.dispatchEvent(new Event('scroll'));

            const viewportRect = viewport.getBoundingClientRect();
            const rows = Array.from(document.querySelectorAll<HTMLElement>(
                '.editor-left-pane .tab-wrapper[data-tab-name="item"] .editor-table-grid .editor-table-row[data-row-index]',
            ));
            const row = rows.find((candidate) => {
                const rect = candidate.getBoundingClientRect();
                return rect.top > viewportRect.top + 120 && rect.bottom < viewportRect.bottom - 120;
            });
            if (row === undefined) throw new Error('visible virtual row not found');
            const rowIndexText = row.dataset.rowIndex;
            if (rowIndexText === undefined) throw new Error('rowIndex not found');
            const dataRowIndex = Number(rowIndexText);

            editor.activeEditorTable.getSelection().start(dataRowIndex + 1, 2);
            editor.activeEditorTable.getSelection().end();
            return dataRowIndex;
        });
        await expect(page.locator('.selection-overlay-border')).toHaveCount(1);

        const movement = await page.evaluate(async (selectedDataRowIndex) => {
            const viewport = document.querySelector<HTMLElement>(
                '.editor-left-pane .tab-wrapper[data-tab-name="item"] .editor-table-main-viewport',
            );
            const leftPane = document.querySelector<HTMLElement>('.editor-left-pane');
            const wrapper = document.querySelector<HTMLElement>('.editor-left-pane .tab-wrapper[data-tab-name="item"]');
            const border = document.querySelector<HTMLElement>('.selection-overlay-border');
            const cell = document.querySelector<HTMLElement>(
                `.editor-left-pane .tab-wrapper[data-tab-name="item"] .editor-table-grid .editor-table-row[data-row-index="${selectedDataRowIndex}"] .editor-table-cell[data-col="1"]`,
            );
            if (viewport === null) throw new Error('viewport not found');
            if (leftPane === null) throw new Error('leftPane not found');
            if (wrapper === null) throw new Error('wrapper not found');
            if (border === null) throw new Error('selection overlay not found');
            if (cell === null) throw new Error('target cell not found');

            const beforeBorderTop = border.getBoundingClientRect().top;
            const beforeCellTop = cell.getBoundingClientRect().top;
            const beforeWrapperTop = wrapper.getBoundingClientRect().top;
            viewport.scrollTop += 7;
            viewport.dispatchEvent(new Event('scroll'));

            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

            const afterBorder = document.querySelector<HTMLElement>('.selection-overlay-border');
            if (afterBorder === null) throw new Error('selection overlay after scroll not found');
            const afterBorderTop = afterBorder.getBoundingClientRect().top;
            const afterCellTop = cell.getBoundingClientRect().top;
            const afterWrapperTop = wrapper.getBoundingClientRect().top;

            return {
                selectedDataRowIndex,
                beforeBorderTop,
                beforeCellTop,
                beforeWrapperTop,
                afterBorderTop,
                afterCellTop,
                afterWrapperTop,
                leftPaneScrollTop: leftPane.scrollTop,
                viewportScrollTop: viewport.scrollTop,
                borderStyleTop: afterBorder.style.top,
                borderDelta: afterBorderTop - beforeBorderTop,
                cellDelta: afterCellTop - beforeCellTop,
                borderCellGap: afterBorderTop - afterCellTop,
            };
        }, selectedDataRowIndex);

        expect(movement.cellDelta, 'セル自体が7px前後スクロール移動していること').toBeLessThan(-5);
        expect(Math.abs(movement.borderDelta - movement.cellDelta), `selectionの移動量がセルと一致すること: ${JSON.stringify(movement)}`).toBeLessThanOrEqual(1);
        expect(Math.abs(movement.borderCellGap), `selectionとセルのtop座標が揃っていること: ${JSON.stringify(movement)}`).toBeLessThanOrEqual(1);
    });
});
