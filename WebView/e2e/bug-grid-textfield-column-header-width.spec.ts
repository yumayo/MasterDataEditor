import { test, expect } from './fixtures/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

function createGridTextFieldWidthFileSystem(): MockFileSystem {
    return {
        'schema/textfield_width.json': JSON.stringify({
            primary_key: ['id'],
            header: [
                { key: 0, name: 'id', type: 'int', width: 50 },
                { key: 1, name: 'name', type: 'string', width: 50 },
                { key: 2, name: 'note', type: 'string', width: 50 },
            ],
        }),
        'data/textfield_width.csv': [
            'id,name,note',
            '1,A,short',
        ].join('\n'),
    };
}

test.describe('grid-textfield width', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createGridTextFieldWidthFileSystem());
        await page.goto('/');
    });

    test('列ヘッダーの実描画幅で広がったセル幅以上になること', async ({ page }) => {
        await page.locator('#explorer').getByText('textfield_width', { exact: true }).click();

        const table = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="textfield_width"] .editor-table');
        await expect(table).toBeVisible();

        const cell = table
            .locator('.editor-table-row')
            .nth(0)
            .locator('.editor-table-cell:not(.editor-table-row-header)')
            .nth(1);
        await expect(cell).toBeVisible();

        const cellWidth = await cell.evaluate((el: Element) => el.getBoundingClientRect().width);
        expect(cellWidth).toBeGreaterThan(50);

        await cell.dblclick();

        const textField = page.locator('.grid-textfield-active');
        await expect(textField).toBeVisible();

        const textFieldWidth = await textField.evaluate((el: Element) => el.getBoundingClientRect().width);
        expect(textFieldWidth).toBeGreaterThanOrEqual(cellWidth - 0.5);
    });
});
