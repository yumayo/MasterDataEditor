import { Page, Locator } from '@playwright/test';
import { test, expect } from './fixtures/test';
import { installMockApiAsync, MockFileSystem, readMockFileAsync } from './fixtures/mock-api';

function createDateTimeInputFileSystem(): MockFileSystem {
    return {
        'schema/event.json': JSON.stringify({
            description: '日時入力テスト',
            primary_key: ['id'],
            header: [
                { key: 0, name: 'id', type: 'int' },
                { key: 1, name: 'start_at', type: 'datetime' },
                { key: 2, name: 'name', type: 'string' },
            ],
        }),
        'data/event.csv': [
            'id,start_at,name',
            '1,2026-05-10 12:30:45,alpha',
            '2,2026-02-30 00:00:00,beta',
        ].join('\n'),
    };
}

async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    await page.locator('#explorer').getByText(tableName, { exact: true }).click();
    const table = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="${tableName}"] .editor-table`);
    await expect(table).toBeVisible();
    return table;
}

function getDataCell(table: Locator, rowIndex: number, colIndex: number): Locator {
    const row = table.locator('.editor-table-row').nth(rowIndex);
    return row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
}

test.describe('datetime型セル入力', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createDateTimeInputFileSystem());
        await page.goto('/');
    });

    test('datetime型セルは通常のテキストフィールドで日時を設定できる', async ({ page }) => {
        const table = await openTableAsync(page, 'event');
        const cell = getDataCell(table, 0, 1);

        await cell.dblclick();

        const input = page.locator('.grid-textfield-active');
        await expect(input).toBeVisible();
        await expect(page.locator('.grid-date-time-picker-active')).toHaveCount(0);

        await page.keyboard.press('Control+a');
        await page.keyboard.insertText('2026-05-15 13:40:55');
        await page.keyboard.press('Enter');

        await expect(cell).toContainText('2026-05-15 13:40:55');

        await page.keyboard.press('Control+s');
        await expect.poll(async () => await readMockFileAsync(page, 'data/event.csv')).toContain('1,2026-05-15 13:40:55,alpha');
    });

    test('datetime型の不正な日時は型不一致として表示され、修正すると解消する', async ({ page }) => {
        const table = await openTableAsync(page, 'event');
        const invalidCell = getDataCell(table, 1, 1);

        await expect(invalidCell).toHaveClass(/cell-error/, { timeout: 10000 });

        await invalidCell.dblclick();
        const input = page.locator('.grid-textfield-active');
        await expect(input).toBeVisible();
        await page.keyboard.press('Control+a');
        await page.keyboard.insertText('2026-02-28 00:00:00');
        await page.keyboard.press('Enter');

        await expect(invalidCell).not.toHaveClass(/cell-error/);
    });

    test('テーブル定義エディタでdatetime型列を作成できる', async ({ page }) => {
        await page.locator('.explorer-add-table-button').click();
        await expect(page.locator('.table-definition-editor')).toBeVisible();

        await page.locator('.table-definition-name-input').fill('schedule');

        const firstRow = page.locator('.table-definition-column-row').nth(0);
        await firstRow.locator('.column-name-input').fill('id');
        await firstRow.locator('.column-type-select').selectOption('int');
        await firstRow.locator('.column-pk-checkbox').check();

        await page.locator('.table-definition-add-column-button').click();
        const secondRow = page.locator('.table-definition-column-row').nth(1);
        await secondRow.locator('.column-name-input').fill('start_at');
        await secondRow.locator('.column-type-select').selectOption('datetime');

        await page.locator('.table-definition-save-button').click();
        await expect(page.locator('.tab-button', { hasText: '新しいテーブル' })).toHaveCount(0);

        const schemaJson = await readMockFileAsync(page, 'schema/schedule.json');
        const schema = JSON.parse(schemaJson);
        expect(schema.header).toEqual([
            { key: 0, name: 'id', type: 'int' },
            { key: 1, name: 'start_at', type: 'datetime' },
        ]);
    });
});
