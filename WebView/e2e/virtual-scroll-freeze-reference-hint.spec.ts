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
    return table.locator(`.editor-table-row-header[data-row-index="${dataRowIndex}"]`).evaluate((headerElement) => {
        const rowElement = headerElement.parentElement as HTMLElement | null;
        if (rowElement === null) throw new Error('行要素が見つかりません');
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
    });
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

        const scrollContainer = page.locator('.editor-left-pane');
        await scrollContainer.evaluate((element) => {
            element.scrollTop = 90 * 21;
        });
        await expect.poll(async () => getMaxVisibleRowIndexAsync(table)).toBeGreaterThan(80);

        await expect(getFrozenRowLocator(page, table, 0).locator('.cell-reverse-reference-hint')).toHaveText('name_1');
        await expect(getFrozenRowLocator(page, table, 1).locator('.cell-reverse-reference-hint')).toHaveText('name_2');
    });

    test('deep scroll and row insert keep visible reverse reference hints aligned', async ({ page }) => {
        await installMockApiAsync(page, createFileSystem(150));
        await page.goto('/');

        const table = await openTableAsync(page, 'chara');
        const scrollContainer = page.locator('.editor-left-pane');
        await scrollContainer.evaluate((element) => {
            element.scrollTop = 90 * 21;
        });
        await expect.poll(async () => getMaxVisibleRowIndexAsync(table)).toBeGreaterThan(80);

        const rowHeader = table.locator('.editor-table-row-header[data-row-index="90"]').first();
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
