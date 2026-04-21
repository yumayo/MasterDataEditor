import { test, expect } from './fixtures/test';
import type { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

function generateCharaCsv(rowCount: number): string {
    const rows = ['id'];
    for (let i = 1; i <= rowCount; i++) {
        rows.push(String(i));
    }
    return rows.join('\n');
}

function generateCharaNameCsv(rowCount: number): string {
    const rows = ['id,ja'];
    for (let i = 1; i <= rowCount; i++) {
        rows.push(`${i},name_${i}`);
    }
    return rows.join('\n');
}

function createFileSystem(rowCount: number): MockFileSystem {
    return {
        'schema/chara.json': JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int' },
            ],
            primary_key: ['id'],
            frozenRowCount: 2,
        }),
        'data/chara.csv': generateCharaCsv(rowCount),
        'schema/chara_name.json': JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int', reference: 'chara.id' },
                { key: 1, name: 'ja', type: 'string' },
            ],
            primary_key: ['id'],
        }),
        'data/chara_name.csv': generateCharaNameCsv(rowCount),
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

async function getVisibleRowHeaderAsync(table: Locator, dataRowIndex: number): Promise<Locator> {
    const detachedRowHeader = table.locator(`.editor-table-detached-row-header-layer .editor-table-row-header[data-row-index="${dataRowIndex}"]`);
    if (await detachedRowHeader.count() > 0) {
        return detachedRowHeader.first();
    }
    return table.locator(`.editor-table-row-header[data-row-index="${dataRowIndex}"]`).first();
}

async function clickContextMenuItemAsync(page: Page, label: string): Promise<void> {
    const menu = page.locator('.context-menu.visible');
    await expect(menu).toBeVisible();
    await menu.locator('.context-menu-item', { hasText: label }).click();
}

function getFrozenRowLocator(page: Page, table: Locator, dataRowIndex: number): Locator {
    return table.locator('.editor-table-row:not(.editor-table-column-header-row):not(.editor-table-empty-row)').filter({
        has: page.locator(`.editor-table-row-header[data-row-index="${dataRowIndex}"]`),
    }).first();
}

async function getRowInfoByIndexAsync(table: Locator, dataRowIndex: number): Promise<{ idText: string; hintText: string | null; }> {
    return table.evaluate((tableElement, targetRowIndex) => {
        const rowElement =
            tableElement.querySelector<HTMLElement>(`.editor-table-grid .editor-table-row[data-row-index="${targetRowIndex}"]`)
            ?? tableElement.querySelector<HTMLElement>(`.editor-table-row[data-row-index="${targetRowIndex}"]`);
        if (!(rowElement instanceof HTMLElement)) throw new Error(`行要素が見つかりません: rowIndex=${targetRowIndex}`);
        const firstDataCell = rowElement.querySelector('.editor-table-cell:not(.editor-table-row-header)') as HTMLElement | null;
        if (firstDataCell === null) throw new Error('データセルが見つかりません');
        let idText = '';
        for (const node of Array.from(firstDataCell.childNodes)) {
            if (node.nodeType !== Node.TEXT_NODE || node.textContent === null) continue;
            const candidate = node.textContent.trim();
            if (candidate !== '') {
                idText = candidate;
                break;
            }
        }
        const hint = firstDataCell.querySelector('.cell-reverse-reference-hint') as HTMLElement | null;
        return {
            idText,
            hintText: hint === null ? null : hint.textContent,
        };
    }, dataRowIndex);
}

async function getMaxVisibleRowIndexAsync(table: Locator): Promise<number> {
    return table.locator('.editor-table-row:not(.editor-table-column-header-row):not(.editor-table-empty-row) .editor-table-row-header')
        .evaluateAll((elements) => {
            let maxRowIndex = -1;
            for (const element of elements) {
                const rowIndexText = (element as HTMLElement).getAttribute('data-row-index');
                const rowIndex = rowIndexText === null ? -1 : Number(rowIndexText);
                if (rowIndex > maxRowIndex) {
                    maxRowIndex = rowIndex;
                }
            }
            return maxRowIndex;
        });
}

async function beginFrozenRowCellMutationTrackingAsync(page: Page, dataRowIndex: number): Promise<void> {
    await page.evaluate((targetRowIndex) => {
        const trackerWindow = window as unknown as Record<string, unknown> & {
            __frozenRowCellMutationCount: number | null;
            __frozenRowCellMutationObservers: MutationObserver[] | null;
        };
        if (!('__frozenRowCellMutationCount' in trackerWindow)) trackerWindow.__frozenRowCellMutationCount = null;
        if (!('__frozenRowCellMutationObservers' in trackerWindow)) trackerWindow.__frozenRowCellMutationObservers = null;
        if (trackerWindow.__frozenRowCellMutationObservers !== null) {
            for (const observer of trackerWindow.__frozenRowCellMutationObservers) {
                observer.disconnect();
            }
        }
        const rowHeader = document.querySelector<HTMLElement>(
            `.editor-left-pane .editor-table .editor-table-row:not(.editor-table-column-header-row):not(.editor-table-empty-row) .editor-table-row-header[data-row-index="${targetRowIndex}"]`
        );
        if (!(rowHeader instanceof HTMLElement) || !(rowHeader.parentElement instanceof HTMLElement)) {
            throw new Error(`監視対象の固定行が見つかりません: rowIndex=${targetRowIndex}`);
        }
        const sourceCell = rowHeader.parentElement.querySelector<HTMLElement>('.editor-table-cell:not(.editor-table-row-header)');
        if (!(sourceCell instanceof HTMLElement)) {
            throw new Error(`監視対象のsourceセルが見つかりません: rowIndex=${targetRowIndex}`);
        }
        const detachedCell = document.querySelector<HTMLElement>(
            `.editor-left-pane .editor-table .editor-table-detached-frozen-row-layer .editor-table-detached-row[data-row-index="${targetRowIndex}"] .editor-table-cell:not(.editor-table-row-header)`
        );
        if (!(detachedCell instanceof HTMLElement)) {
            throw new Error(`監視対象のdetachedセルが見つかりません: rowIndex=${targetRowIndex}`);
        }
        const handleMutations = (records: MutationRecord[]) => {
            if (trackerWindow.__frozenRowCellMutationCount === null) throw new Error('固定行mutationカウンタが初期化されていません');
            trackerWindow.__frozenRowCellMutationCount += records.length;
        };
        trackerWindow.__frozenRowCellMutationCount = 0;
        trackerWindow.__frozenRowCellMutationObservers = [
            new MutationObserver(handleMutations),
            new MutationObserver(handleMutations),
        ];
        trackerWindow.__frozenRowCellMutationObservers[0].observe(sourceCell, { childList: true, subtree: true, characterData: true });
        trackerWindow.__frozenRowCellMutationObservers[1].observe(detachedCell, { childList: true, subtree: true, characterData: true });
    }, dataRowIndex);
}

async function getFrozenRowCellMutationCountAsync(page: Page): Promise<number> {
    return page.evaluate(() => {
        const trackerWindow = window as unknown as Record<string, unknown> & { __frozenRowCellMutationCount: number | null };
        if (!('__frozenRowCellMutationCount' in trackerWindow)) throw new Error('固定行mutationカウンタが初期化されていません');
        if (trackerWindow.__frozenRowCellMutationCount === null) throw new Error('固定行mutationカウンタが初期化されていません');
        return trackerWindow.__frozenRowCellMutationCount;
    });
}

test.describe('virtual scroll freeze reference hint', () => {
    test('fixed reverse reference hints keep the same value after deep scroll', async ({ page }) => {
        await installMockApiAsync(page, createFileSystem(150));
        await page.goto('/');

        const table = await openTableAsync(page, 'chara');
        const frozenRow0 = getFrozenRowLocator(page, table, 0);
        const frozenRow1 = getFrozenRowLocator(page, table, 1);
        const hint0 = frozenRow0.locator('.cell-reverse-reference-hint');
        const hint1 = frozenRow1.locator('.cell-reverse-reference-hint');

        await expect(hint0).toBeVisible();
        await expect(hint0).toHaveText('name_1');
        await expect(hint1).toBeVisible();
        await expect(hint1).toHaveText('name_2');

        const scrollContainer = await getTableScrollContainerAsync(page);
        await scrollContainer.evaluate((element) => {
            element.scrollTop = 2500;
        });
        await expect.poll(async () => getMaxVisibleRowIndexAsync(table)).toBeGreaterThan(80);

        await expect(getFrozenRowLocator(page, table, 0).locator('.cell-reverse-reference-hint')).toHaveText('name_1');
        await expect(getFrozenRowLocator(page, table, 1).locator('.cell-reverse-reference-hint')).toHaveText('name_2');
    });

    test('表示レンジ更新時も不変の固定行セルは参照ヒントDOMを書き換えない', async ({ page }) => {
        await installMockApiAsync(page, createFileSystem(150));
        await page.goto('/');

        const table = await openTableAsync(page, 'chara');
        await expect(getFrozenRowLocator(page, table, 0).locator('.cell-reverse-reference-hint')).toHaveText('name_1');
        const scrollContainer = await getTableScrollContainerAsync(page);
        await scrollContainer.evaluate((element) => {
            element.scrollTop = 2500;
        });
        await expect.poll(async () => getMaxVisibleRowIndexAsync(table)).toBeGreaterThan(80);
        await page.waitForTimeout(100);

        await beginFrozenRowCellMutationTrackingAsync(page, 0);

        await scrollContainer.evaluate((element) => {
            element.scrollTop = 3200;
        });
        await expect.poll(async () => getMaxVisibleRowIndexAsync(table)).toBeGreaterThan(100);
        await page.waitForTimeout(50);

        await expect.poll(async () => getFrozenRowCellMutationCountAsync(page)).toBe(0);
        await expect(getFrozenRowLocator(page, table, 0).locator('.cell-reverse-reference-hint')).toHaveText('name_1');
    });

    test('deep scroll and row insert keep visible reverse reference hints aligned', async ({ page }) => {
        await installMockApiAsync(page, createFileSystem(150));
        await page.goto('/');

        const table = await openTableAsync(page, 'chara');
        const scrollContainer = await getTableScrollContainerAsync(page);
        await scrollContainer.evaluate((element) => {
            element.scrollTop = 2500;
        });
        await expect.poll(async () => getMaxVisibleRowIndexAsync(table)).toBeGreaterThan(80);

        const rowHeader = await getVisibleRowHeaderAsync(table, 90);
        await rowHeader.click({ button: 'right' });
        await clickContextMenuItemAsync(page, '上に行を挿入');

        await expect(getFrozenRowLocator(page, table, 0).locator('.cell-reverse-reference-hint')).toHaveText('name_1');
        await expect(getFrozenRowLocator(page, table, 1).locator('.cell-reverse-reference-hint')).toHaveText('name_2');

        await expect.poll(async () => {
            const insertedRow = await getRowInfoByIndexAsync(table, 90);
            const shiftedRow = await getRowInfoByIndexAsync(table, 91);
            return insertedRow.idText === ''
                && insertedRow.hintText === null
                && shiftedRow.idText === '91'
                && shiftedRow.hintText === 'name_91';
        }).toBe(true);
    });
});
