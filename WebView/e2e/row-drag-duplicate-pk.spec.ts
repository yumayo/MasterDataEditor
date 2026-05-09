import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem, readMockFileAsync } from './fixtures/mock-api';

function createDuplicatePkFileSystem(): MockFileSystem {
    return {
        'schema/item.json': JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int' },
                { key: 1, name: 'name', type: 'string' },
                { key: 2, name: 'value', type: 'int' },
            ],
            primary_key: ['id'],
        }),
        'data/item.csv': [
            'id,name,value',
            '1,item_a,100',
            '1,item_b,200',
            '2,item_c,300',
            '3,item_d,400',
        ].join('\n'),
        'userdata/bookmarks.json': '[]',
        'plugins/.gitkeep': '',
    };
}

async function openTableAsync(page: Page): Promise<Locator> {
    await page.locator('#explorer').getByText('item', { exact: true }).click();
    const table = page.locator('.editor-left-pane .editor-table');
    await expect(table).toBeVisible();
    return table;
}

async function selectRowAsync(table: Locator, rowIndex: number): Promise<void> {
    await table.locator('.editor-table-row-header').nth(rowIndex).click();
}

async function dragRowAsync(table: Locator, fromRowIndex: number, toRowIndex: number): Promise<void> {
    const fromHeader = table.locator('.editor-table-row-header').nth(fromRowIndex);
    const fromBox = await fromHeader.boundingBox();
    if (!fromBox) throw new Error('fromHeader bounding box is null');

    const toHeader = table.locator('.editor-table-row-header').nth(toRowIndex);
    const toBox = await toHeader.boundingBox();
    if (!toBox) throw new Error('toHeader bounding box is null');

    const page = fromHeader.page();
    await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2 - 6);
    await page.mouse.move(toBox.x + toBox.width / 2, toBox.y + 2);
    await page.mouse.up();
}

async function getVisibleRowsAsync(table: Locator): Promise<string[][]> {
    const rows = table.locator('.editor-table-row:not(.editor-table-empty-row)');
    const count = await rows.count();
    const result: string[][] = [];
    for (let i = 0; i < count; i++) {
        const cells = rows.nth(i).locator('.editor-table-cell:not(.editor-table-row-header)');
        result.push([
            await cells.nth(0).innerText(),
            await cells.nth(1).innerText(),
            await cells.nth(2).innerText(),
        ]);
    }
    return result;
}

async function saveAsync(page: Page, table: Locator): Promise<void> {
    await table.locator('.editor-table-row:not(.editor-table-empty-row)').first()
        .locator('.editor-table-cell:not(.editor-table-row-header)').first()
        .click();
    await page.keyboard.press('Control+s');
    await expect(page.locator('.tab-button', { hasText: 'item' }).locator('.tab-button-dirty'))
        .not.toHaveClass(/tab-button-dirty-visible/);
}

test.describe('PK重複テーブルの行ドラッグ保存', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createDuplicatePkFileSystem());
        await page.goto('/');
    });

    test('PK重複行を含むテーブルで行移動後に保存しても行数と順序が一致する', async ({ page }) => {
        const table = await openTableAsync(page);

        await selectRowAsync(table, 1);
        await dragRowAsync(table, 1, 3);

        const editorRows = await getVisibleRowsAsync(table);
        expect(editorRows).toEqual([
            ['1', 'item_a', '100'],
            ['2', 'item_c', '300'],
            ['1', 'item_b', '200'],
            ['3', 'item_d', '400'],
        ]);

        await saveAsync(page, table);

        const csv = await readMockFileAsync(page, 'data/item.csv');
        const lines = csv.split('\n').filter(line => line.trim() !== '');
        expect(lines).toEqual([
            'id,name,value',
            '1,item_a,100',
            '2,item_c,300',
            '1,item_b,200',
            '3,item_d,400',
        ]);
    });
});
