import { test, expect } from './fixtures/test';
import type { Page } from '@playwright/test';
import { installMockApiAsync, type MockFileSystem } from './fixtures/mock-api';

function createScrollableFileSystem(rowCount: number): MockFileSystem {
    const rows = ['id,name,value'];
    for (let i = 1; i <= rowCount; i++) {
        rows.push(`${i},item_${i},${i * 10}`);
    }
    return {
        'schema/item.json': JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int' },
                { key: 1, name: 'name', type: 'string' },
                { key: 2, name: 'value', type: 'int' },
            ],
            primary_key: ['id'],
        }),
        'data/item.csv': rows.join('\n'),
        'user:bookmarks.json': '[]',
        'plugins/.gitkeep': '',
    };
}

async function openTableAsync(page: Page, tableName: string) {
    await page.locator('#explorer .explorer-file-name', { hasText: tableName }).click();
    const table = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="${tableName}"] .editor-table`);
    await expect(table).toBeVisible();
    return table;
}

async function waitForFramesAsync(page: Page, frameCount: number = 2): Promise<void> {
    await page.evaluate(async (count) => {
        for (let i = 0; i < count; i++) {
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        }
    }, frameCount);
}

async function clickDataCellAsync(page: Page, logicalRow: number, dataColumn: number): Promise<void> {
    await page.locator(
        `.editor-left-pane .editor-table-grid .editor-table-row[data-row-index="${logicalRow - 1}"] .editor-table-cell[data-col="${dataColumn}"]`
    ).click();
}

async function getBottomVisibleWritableRowAsync(page: Page): Promise<number> {
    return page.evaluate(() => {
        const viewport = document.querySelector<HTMLElement>('.editor-left-pane .editor-table-main-viewport');
        const activeTable = (window as unknown as {
            editor?: {
                activeEditorTable: {
                    getLogicalRowCount(): number;
                } | false;
            };
        }).editor?.activeEditorTable;
        if (viewport === null) throw new Error('main viewport が見つかりません');
        if (activeTable === undefined || activeTable === false) throw new Error('activeEditorTable が見つかりません');

        const viewportRect = viewport.getBoundingClientRect();
        const maxWritableLogicalRow = activeTable.getLogicalRowCount() - 2;
        const rows = Array.from(document.querySelectorAll<HTMLElement>(
            '.editor-left-pane .editor-table-grid .editor-table-row[data-row-index]'
        ));
        const visibleRows = rows
            .map((row) => {
                const rowIndexText = row.dataset.rowIndex;
                const dataRowIndex = rowIndexText === undefined ? Number.NaN : Number(rowIndexText);
                const logicalRow = dataRowIndex + 1;
                const rect = row.getBoundingClientRect();
                return { logicalRow, top: rect.top, bottom: rect.bottom };
            })
            .filter(row =>
                Number.isFinite(row.logicalRow)
                && row.logicalRow + 1 <= maxWritableLogicalRow
                && row.top >= viewportRect.top
                && row.bottom <= viewportRect.bottom - 4
            );

        const target = visibleRows[visibleRows.length - 1];
        if (target === undefined) throw new Error('下端付近の書き込み可能行が見つかりません');
        return target.logicalRow;
    });
}

async function selectTwoRowNameRangeAsync(page: Page, startLogicalRow: number): Promise<void> {
    await page.evaluate((row) => {
        const activeTable = (window as unknown as {
            editor?: {
                activeEditorTable: {
                    dataColumnOffset(): number;
                    focusTable(): void;
                    getSelection(): {
                        setRange(startRow: number, startColumn: number, endRow: number, endColumn: number): void;
                        move(row: number, column: number): void;
                    };
                } | false;
            };
        }).editor?.activeEditorTable;
        if (activeTable === undefined || activeTable === false) throw new Error('activeEditorTable が見つかりません');
        const nameColumn = activeTable.dataColumnOffset() + 1;
        const selection = activeTable.getSelection();
        selection.setRange(row, nameColumn, row + 1, nameColumn);
        selection.move(row, nameColumn);
        activeTable.focusTable();
    }, startLogicalRow);
}

async function readNameCellsAsync(page: Page, startLogicalRow: number): Promise<[string, string]> {
    return page.evaluate((row) => {
        const activeTable = (window as unknown as {
            editor?: {
                activeEditorTable: {
                    dataColumnOffset(): number;
                    getCellValueAt(row: number, column: number): string;
                } | false;
            };
        }).editor?.activeEditorTable;
        if (activeTable === undefined || activeTable === false) throw new Error('activeEditorTable が見つかりません');
        const nameColumn = activeTable.dataColumnOffset() + 1;
        return [
            activeTable.getCellValueAt(row, nameColumn),
            activeTable.getCellValueAt(row + 1, nameColumn),
        ] as [string, string];
    }, startLogicalRow);
}

test.describe('BottomPanel tabs', () => {
    test('clicking the active panel tab keeps the bottom panel open', async ({ page, mockFileSystem }) => {
        const bottomPanel = page.locator('.bottom-panel');
        const problemsTab = page.locator('.bottom-panel-tab', { hasText: 'PROBLEMS' });
        const debugTab = page.locator('.bottom-panel-tab', { hasText: 'DEBUG CONSOLE' });

        await page.locator('.status-bar-badge').click();
        await expect(bottomPanel).toBeVisible();
        await expect(problemsTab).toHaveClass(/bottom-panel-tab-active/);
        await expect(page.locator('.validation-panel')).toBeVisible();

        await problemsTab.click();
        await expect(bottomPanel).toBeVisible();
        await expect(problemsTab).toHaveClass(/bottom-panel-tab-active/);
        await expect(page.locator('.validation-panel')).toBeVisible();

        await debugTab.click();
        await expect(bottomPanel).toBeVisible();
        await expect(debugTab).toHaveClass(/bottom-panel-tab-active/);
        await expect(page.locator('.debug-console')).toBeVisible();

        await debugTab.click();
        await expect(bottomPanel).toBeVisible();
        await expect(debugTab).toHaveClass(/bottom-panel-tab-active/);
        await expect(page.locator('.debug-console')).toBeVisible();
    });

    test('bottom panel表示中も画面下端付近の範囲選択へペーストできる', async ({ page }) => {
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        await installMockApiAsync(page, createScrollableFileSystem(160));
        await page.goto('/');

        await openTableAsync(page, 'item');
        await page.evaluate(async () => {
            const activeTable = (window as unknown as {
                editor?: {
                    activeEditorTable: {
                        dataColumnOffset(): number;
                        focusTable(): void;
                        getSelection(): {
                            setCopyRange(range: { startRow: number; startColumn: number; endRow: number; endColumn: number }): void;
                        };
                    } | false;
                };
            }).editor?.activeEditorTable;
            if (activeTable === undefined || activeTable === false) throw new Error('activeEditorTable が見つかりません');
            const nameColumn = activeTable.dataColumnOffset() + 1;
            activeTable.getSelection().setCopyRange({ startRow: 1, startColumn: nameColumn, endRow: 1, endColumn: nameColumn });
            await navigator.clipboard.writeText('item_1');
            activeTable.focusTable();
        });
        await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('item_1');

        const viewportHeightBefore = await page.locator('.editor-left-pane .editor-table-main-viewport')
            .evaluate(element => element.clientHeight);
        await page.locator('.status-bar-badge').click();
        const bottomPanel = page.locator('.bottom-panel');
        await expect(bottomPanel).toBeVisible();
        await page.locator('.bottom-panel-tab', { hasText: 'DEBUG CONSOLE' }).click();
        await waitForFramesAsync(page);

        const viewportHeightAfter = await page.locator('.editor-left-pane .editor-table-main-viewport')
            .evaluate(element => element.clientHeight);
        expect(viewportHeightAfter).toBeLessThan(viewportHeightBefore);

        await page.evaluate(() => {
            const activeTable = (window as unknown as {
                editor?: {
                    activeEditorTable: {
                        getScrollMetrics(): { scrollHeight: number; clientHeight: number };
                        restoreScrollPosition(scrollTop: number, scrollLeft: number): void;
                    } | false;
                };
            }).editor?.activeEditorTable;
            if (activeTable === undefined || activeTable === false) throw new Error('activeEditorTable が見つかりません');
            const metrics = activeTable.getScrollMetrics();
            activeTable.restoreScrollPosition(metrics.scrollHeight - metrics.clientHeight, 0);
        });
        await waitForFramesAsync(page);

        const targetRow = await getBottomVisibleWritableRowAsync(page);
        await clickDataCellAsync(page, targetRow, 1);
        await selectTwoRowNameRangeAsync(page, targetRow);
        await expect(page.locator('.grid-textfield')).toBeFocused();
        await page.evaluate(() => {
            const activeElement = document.activeElement;
            if (!(activeElement instanceof HTMLElement)) throw new Error('activeElement がありません');
            const data = new DataTransfer();
            data.setData('text/plain', 'item_1');
            const event = new Event('paste', {
                bubbles: true,
                cancelable: true,
            }) as ClipboardEvent;
            Object.defineProperty(event, 'clipboardData', { value: data });
            activeElement.dispatchEvent(event);
        });

        await expect.poll(() => readNameCellsAsync(page, targetRow)).toEqual(['item_1', 'item_1']);
    });
});
