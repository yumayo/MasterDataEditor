import { test, expect } from './fixtures/test';
import type { Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// バーチャルスクロール 列選択テスト
//
// 100行テーブルで列ヘッダーをクリックしたとき、仮想スクロールで表示されていない行も含め
// 全行が選択されることを検証する。
// =============================================================================

function generateCsv(rowCount: number): string {
    const rows = ['id,name,value'];
    for (let i = 1; i <= rowCount; i++) {
        rows.push(`${i},name_${i},${i * 10}`);
    }
    return rows.join('\n');
}

function createFileSystem(rowCount: number = 100): MockFileSystem {
    return {
        'schema/item.json': JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int' },
                { key: 1, name: 'name', type: 'string' },
                { key: 2, name: 'value', type: 'int' },
            ],
            primary_key: ['id'],
        }),
        'data/item.csv': generateCsv(rowCount),
    };
}

test.describe('バーチャルスクロール列選択', () => {
    test('列ヘッダークリックで全100行が選択される', async ({ page }) => {
        const fs = createFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        await page.locator('#explorer .explorer-file').getByText('item', { exact: true }).click();
        const table = page.locator('.editor-left-pane .editor-table').first();
        await expect(table).toBeVisible();

        // name列のヘッダーをクリックして列選択する
        const nameHeader = table.locator('.editor-table-column-header-row .editor-table-column-header').nth(1); // nth(0)=id, nth(1)=name
        await nameHeader.click();

        // 選択範囲を取得する（ブラウザ側で selection.getSelectionRange() を呼ぶ）
        const selectionRange = await page.evaluate(() => {
            // EditorTable のインスタンスから Selection を取得する
            const tableEl = document.querySelector('.editor-left-pane .editor-table') as HTMLElement;
            if (!tableEl) return null;
            // data-tab-name 属性からテーブル名を取得し、グローバルに公開された selection にアクセスする
            // テストでは EditorTable の内部に直接アクセスできないため、
            // DOM上の選択クラスから選択範囲を推定する
            const rows = tableEl.querySelectorAll('.editor-table-row:not(.editor-table-column-header-row)');
            let firstSelectedRow = -1;
            let lastSelectedRow = -1;
            let selectedRowCount = 0;
            rows.forEach((row, index) => {
                const header = row.querySelector('.editor-table-row-header');
                if (header && header.classList.contains('selected')) {
                    if (firstSelectedRow === -1) firstSelectedRow = index;
                    lastSelectedRow = index;
                    selectedRowCount++;
                }
            });
            return { firstSelectedRow, lastSelectedRow, selectedRowCount, totalDomRows: rows.length };
        });

        console.log('列選択結果:', JSON.stringify(selectionRange));

        // DOM上に表示されている行のうち、全行のヘッダーが選択状態であること
        expect(selectionRange).not.toBeNull();
        if (selectionRange) {
            expect(selectionRange.firstSelectedRow, '先頭行が選択されていない').toBe(0);
            // DOM上の全行（バッファ行含む）のヘッダーが選択状態であること
            expect(selectionRange.selectedRowCount, 'DOM上の全行が選択されていない').toBe(selectionRange.totalDomRows);
        }

        // スクロールして末尾付近を表示した後も、行ヘッダーが選択状態であること
        const scrollContainer = page.locator('.editor-left-pane');
        await scrollContainer.evaluate((el) => { el.scrollTop = 80 * 20; });
        await page.waitForTimeout(300);

        const afterScrollSelection = await page.evaluate(() => {
            const tableEl = document.querySelector('.editor-left-pane .editor-table') as HTMLElement;
            if (!tableEl) return null;
            const rows = tableEl.querySelectorAll('.editor-table-row:not(.editor-table-column-header-row):not(.editor-table-empty-row)');
            let selectedCount = 0;
            let totalCount = 0;
            rows.forEach((row) => {
                totalCount++;
                const header = row.querySelector('.editor-table-row-header');
                if (header && header.classList.contains('selected')) {
                    selectedCount++;
                }
            });
            return { selectedCount, totalCount };
        });

        console.log('スクロール後の列選択:', JSON.stringify(afterScrollSelection));

        // スクロール後もDOM上の全データ行が選択状態
        expect(afterScrollSelection).not.toBeNull();
        if (afterScrollSelection) {
            expect(afterScrollSelection.selectedCount, 'スクロール後にDOM上の全行が選択されていない').toBe(afterScrollSelection.totalCount);
        }
    });

    test('列選択後にDeleteキーで全行の該当列が空になる', async ({ page }) => {
        const fs = createFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        await page.locator('#explorer .explorer-file').getByText('item', { exact: true }).click();
        const table = page.locator('.editor-left-pane .editor-table').first();
        await expect(table).toBeVisible();

        // value列のヘッダーをクリックして列選択
        const valueHeader = table.locator('.editor-table-column-header-row .editor-table-column-header').nth(2); // nth(2)=value
        await valueHeader.click();

        // Deleteキーで列の値を消去
        await page.keyboard.press('Delete');

        // スクロールして末尾付近の値も空になっていることを確認
        const scrollContainer = page.locator('.editor-left-pane');
        await scrollContainer.evaluate((el) => { el.scrollTop = 85 * 20; });
        await page.waitForTimeout(300);

        // 表示中のvalue列の値を取得
        const values = await table.evaluate((tableEl) => {
            const rows = tableEl.querySelectorAll('.editor-table-row:not(.editor-table-column-header-row):not(.editor-table-empty-row)');
            const vals: string[] = [];
            rows.forEach((row) => {
                // value列は4番目のセル（行ヘッダー + id + name + value）
                const cell = row.children[3] as HTMLElement;
                if (cell) vals.push(cell.textContent?.trim() ?? '');
            });
            return vals;
        });

        console.log('Delete後のvalue列(末尾付近):', JSON.stringify(values));

        // 全セルが空であるべき
        for (let i = 0; i < values.length; i++) {
            expect(values[i], `行${i}のvalue列が空でない: "${values[i]}"`).toBe('');
        }
    });

    test('巨大テーブルの列選択スクロールで選択再適用が総行数に比例しない', async ({ page }) => {
        await page.setViewportSize({ width: 960, height: 640 });
        const fs = createFileSystem(5000);
        await installMockApiAsync(page, fs);
        await page.goto('/');

        await page.locator('#explorer .explorer-file').getByText('item', { exact: true }).click();
        const table = page.locator('.editor-left-pane .editor-table').first();
        await expect(table).toBeVisible();

        const valueHeader = table.locator('.editor-table-column-header-row .editor-table-column-header').nth(2);
        await valueHeader.click();

        const counters = await page.evaluate(async () => {
            const editor = (window as unknown as {
                editor?: {
                    activeEditorTable: {
                        getSelection(): { end(): void };
                        getCellOrNull(row: number, column: number): HTMLElement | null;
                        getRowElement(row: number): HTMLElement | null;
                    } | false;
                };
            }).editor;
            if (!editor || editor.activeEditorTable === false) throw new Error('activeEditorTable not found');

            const table = editor.activeEditorTable;
            table.getSelection().end();

            const counts = { cell: 0, row: 0 };
            const originalGetCellOrNull = table.getCellOrNull;
            const originalGetRowElement = table.getRowElement;
            table.getCellOrNull = function (this: unknown, row: number, column: number): HTMLElement | null {
                counts.cell++;
                return originalGetCellOrNull.call(this, row, column);
            };
            table.getRowElement = function (this: unknown, row: number): HTMLElement | null {
                counts.row++;
                return originalGetRowElement.call(this, row);
            };

            const viewport = document.querySelector<HTMLElement>('.editor-left-pane .editor-table-main-viewport');
            if (viewport === null) throw new Error('main viewport not found');
            viewport.scrollTop = 3200;
            viewport.dispatchEvent(new Event('scroll'));
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

            table.getCellOrNull = originalGetCellOrNull;
            table.getRowElement = originalGetRowElement;
            return counts;
        });

        expect(counters.cell, JSON.stringify(counters)).toBeLessThan(1000);
        expect(counters.row, JSON.stringify(counters)).toBeLessThan(3000);
    });
});
