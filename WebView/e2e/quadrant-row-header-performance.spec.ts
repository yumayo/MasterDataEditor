import { test, expect } from './fixtures/test';
import type { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

function generateCsv(rowCount: number): string {
    const rows = ['id,name,value'];
    for (let i = 1; i <= rowCount; i++) {
        rows.push(`${i},name_${i},${(i * 7) % 100}`);
    }
    return rows.join('\n');
}

function createFileSystem(): MockFileSystem {
    return {
        'schema/big_table.json': JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int' },
                { key: 1, name: 'name', type: 'string' },
                { key: 2, name: 'value', type: 'int' },
            ],
            primary_key: ['id'],
            frozenRowCount: 2,
            frozenColumnCount: 1,
        }),
        'data/big_table.csv': generateCsv(1000),
    };
}

function createTwoFrozenColumnFileSystem(): MockFileSystem {
    return {
        'schema/big_table.json': JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int' },
                { key: 1, name: 'name', type: 'string' },
                { key: 2, name: 'value', type: 'int' },
            ],
            primary_key: ['id'],
            frozenRowCount: 2,
            frozenColumnCount: 2,
        }),
        'data/big_table.csv': generateCsv(1000),
    };
}

async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
    const table = page.locator('.editor-left-pane .editor-table');
    await expect(table).toBeVisible();
    return table;
}

async function getTableScrollContainerAsync(page: Page): Promise<Locator> {
    const mainViewport = page.locator('.editor-left-pane .editor-table-main-viewport');
    if (await mainViewport.count() !== 1) throw new Error('main viewport が見つかりません');
    return mainViewport;
}

async function getRenderedRowStepPxAsync(page: Page): Promise<number> {
    return await page.evaluate(() => {
        const renderedRows = Array.from(document.querySelectorAll('.editor-left-pane .editor-table-grid .editor-table-row[data-row-index]'));
        if (renderedRows.length < 2) throw new Error('行高測定に必要な data row が不足しています');
        const firstRow = renderedRows[0] as HTMLElement;
        const secondRow = renderedRows[1] as HTMLElement;
        return secondRow.offsetTop - firstRow.offsetTop;
    });
}

test.describe('quadrant 行ヘッダーのパフォーマンス', () => {
    test('表示レンジが重なっているスクロールでは detached row を再利用する', async ({ page }) => {
        await page.setViewportSize({ width: 960, height: 640 });
        await installMockApiAsync(page, createFileSystem());
        await page.goto('/');

        await openTableAsync(page, 'big_table');
        const rowStepPx = await getRenderedRowStepPxAsync(page);
        const snapshot = await page.evaluate(() => {
            type QuadrantPerfWindow = Window & typeof globalThis & {
                __trackedQuadrantDetachedRow: HTMLElement | null;
            };
            const perfWindow = window as QuadrantPerfWindow;
            const detachedRows = Array.from(document.querySelectorAll('.editor-left-pane .editor-table-detached-row-header-layer .editor-table-detached-row[data-row-index]'));
            if (detachedRows.length < 8) throw new Error('追跡に必要な detached row 数が不足しています');
            const firstDetachedRow = detachedRows[0] as HTMLElement;
            const targetDetachedRow = detachedRows[Math.floor(detachedRows.length * 0.75)] as HTMLElement;
            const firstRowIndexText = firstDetachedRow.dataset.rowIndex;
            const targetRowIndexText = targetDetachedRow.dataset.rowIndex;
            if (firstRowIndexText === undefined || targetRowIndexText === undefined) {
                throw new Error('追跡対象 detached row に rowIndex がありません');
            }
            perfWindow.__trackedQuadrantDetachedRow = targetDetachedRow;
            return { firstRowIndex: Number(firstRowIndexText), targetRowIndex: Number(targetRowIndexText) };
        });

        const scrollContainer = await getTableScrollContainerAsync(page);
        await scrollContainer.evaluate((element, scrollTop) => {
            element.scrollTop = scrollTop;
            element.scrollLeft = 140;
        }, rowStepPx * 45);

        await expect.poll(async () => {
            return await page.evaluate(() => {
                const firstDetachedRow = document.querySelector('.editor-left-pane .editor-table-detached-row-header-layer .editor-table-detached-row[data-row-index]');
                if (!(firstDetachedRow instanceof HTMLElement)) return -1;
                const rowIndexText = firstDetachedRow.dataset.rowIndex;
                if (rowIndexText === undefined) return -1;
                return Number(rowIndexText);
            });
        }).toBeGreaterThan(snapshot.firstRowIndex);

        await expect.poll(async () => {
            return await page.evaluate((targetRowIndex) => {
                type QuadrantPerfWindow = Window & typeof globalThis & {
                    __trackedQuadrantDetachedRow: HTMLElement | null;
                };
                const perfWindow = window as QuadrantPerfWindow;
                if (perfWindow.__trackedQuadrantDetachedRow === null) throw new Error('追跡対象 detached row がありません');
                const currentRow = document.querySelector(`.editor-left-pane .editor-table-detached-row-header-layer .editor-table-detached-row[data-row-index="${targetRowIndex}"]`);
                return perfWindow.__trackedQuadrantDetachedRow === currentRow;
            }, snapshot.targetRowIndex);
        }).toBe(true);
    });

    test('スクロール後に非固定行の固定列セルを編集しても左ペイン clone が同期される', async ({ page }) => {
        await page.setViewportSize({ width: 960, height: 640 });
        await installMockApiAsync(page, createTwoFrozenColumnFileSystem());
        await page.goto('/');

        const table = await openTableAsync(page, 'big_table');
        const rowStepPx = await getRenderedRowStepPxAsync(page);
        const scrollContainer = await getTableScrollContainerAsync(page);
        await scrollContainer.evaluate((element, scrollTop) => {
            element.scrollTop = scrollTop;
            element.scrollLeft = 140;
        }, rowStepPx * 45);

        await expect.poll(async () => {
            return await page.evaluate(() => {
                const firstDetachedRow = document.querySelector('.editor-left-pane .editor-table-detached-row-header-layer .editor-table-detached-row[data-row-index]');
                if (!(firstDetachedRow instanceof HTMLElement)) return -1;
                const rowIndexText = firstDetachedRow.dataset.rowIndex;
                if (rowIndexText === undefined) return -1;
                return Number(rowIndexText);
            });
        }).toBeGreaterThan(2);

        const resolvedTargetRowIndex = await page.evaluate(() => {
            const detachedRows = Array.from(document.querySelectorAll('.editor-left-pane .editor-table-detached-row-header-layer .editor-table-detached-row[data-row-index]'));
            if (detachedRows.length < 3) throw new Error('編集対象の detached row 数が不足しています');
            const targetDetachedRow = detachedRows[2] as HTMLElement;
            const rowIndexText = targetDetachedRow.dataset.rowIndex;
            if (rowIndexText === undefined) throw new Error('編集対象 detached row に rowIndex がありません');
            return Number(rowIndexText);
        });
        const domRowIndex = resolvedTargetRowIndex + 1;
        const oldValue = `name_${resolvedTargetRowIndex + 1}`;
        const newValue = `edited_name_${resolvedTargetRowIndex + 1}`;
        const sourceCell = table.locator(`.editor-table-grid .editor-table-row[data-row-index="${resolvedTargetRowIndex}"] .editor-table-cell[data-col="1"]`);
        const detachedCell = table.locator(
            `.editor-table-detached-row-header-layer .editor-table-detached-row[data-row-index="${resolvedTargetRowIndex}"] .editor-table-cell[data-col="1"]`
        );

        await expect(sourceCell).toBeVisible();
        await expect(detachedCell).toBeVisible();
        await page.evaluate(({ row, oldValueArg, newValueArg }) => {
            type EditorWindow = Window & typeof globalThis & {
                editor: {
                    activeEditorTable: {
                        dataColumnOffset(): number;
                        applyCellChanges(changes: Array<{ row: number; column: number; oldValue: string; newValue: string }>): void;
                    } | false;
                };
            };
            const editorTable = (window as EditorWindow).editor.activeEditorTable;
            if (editorTable === false) throw new Error('activeEditorTable が見つかりません');
            editorTable.applyCellChanges([{ row, column: editorTable.dataColumnOffset() + 1, oldValue: oldValueArg, newValue: newValueArg }]);
        }, { row: domRowIndex, oldValueArg: oldValue, newValueArg: newValue });

        await expect(sourceCell).toContainText(newValue);
        await expect(detachedCell).toContainText(newValue);

        await page.evaluate(({ row, oldValueArg, newValueArg }) => {
            type EditorWindow = Window & typeof globalThis & {
                editor: {
                    activeEditorTable: {
                        dataColumnOffset(): number;
                        replayCellChanges(changes: Array<{ row: number; column: number; oldValue: string; newValue: string }>): void;
                    } | false;
                };
            };
            const editorTable = (window as EditorWindow).editor.activeEditorTable;
            if (editorTable === false) throw new Error('activeEditorTable が見つかりません');
            editorTable.replayCellChanges([{ row, column: editorTable.dataColumnOffset() + 1, oldValue: newValueArg, newValue: oldValueArg }]);
        }, { row: domRowIndex, oldValueArg: oldValue, newValueArg: newValue });
        await expect(sourceCell).toContainText(oldValue);
        await expect(detachedCell).toContainText(oldValue);

        await page.evaluate(({ row, oldValueArg, newValueArg }) => {
            type EditorWindow = Window & typeof globalThis & {
                editor: {
                    activeEditorTable: {
                        dataColumnOffset(): number;
                        replayCellChanges(changes: Array<{ row: number; column: number; oldValue: string; newValue: string }>): void;
                    } | false;
                };
            };
            const editorTable = (window as EditorWindow).editor.activeEditorTable;
            if (editorTable === false) throw new Error('activeEditorTable が見つかりません');
            editorTable.replayCellChanges([{ row, column: editorTable.dataColumnOffset() + 1, oldValue: oldValueArg, newValue: newValueArg }]);
        }, { row: domRowIndex, oldValueArg: oldValue, newValueArg: newValue });
        await expect(sourceCell).toContainText(newValue);
        await expect(detachedCell).toContainText(newValue);
    });
});
