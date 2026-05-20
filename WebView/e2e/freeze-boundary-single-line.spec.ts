import {test, expect} from './fixtures/test';

test(
    '固定列境界は通常borderとshadowを二重描画しない',
    async ({page, mockFileSystem}) => {
        await page.locator('#explorer').getByText('test', {exact: true}).click();
        const table = page.locator('.editor-left-pane .editor-table');
        await expect(table).toBeVisible();

        await page.evaluate(() => {
            const editor = (window as unknown as {
                editor?: {activeEditorTable: {freezeColumns(count: number): void} | false};
            }).editor;
            if (!editor || editor.activeEditorTable === false) throw new Error('activeEditorTable not found');
            editor.activeEditorTable.freezeColumns(1);
        });

        const boundaryCell = table.locator('.freeze-column-border').first();
        await expect(boundaryCell).toBeVisible();
        await expect.poll(
            () => boundaryCell.evaluate((element) => getComputedStyle(element).borderRightColor)
        ).toBe('rgba(0, 0, 0, 0)');
        await expect.poll(
            () => boundaryCell.evaluate((element) => getComputedStyle(element).boxShadow)
        ).toContain('inset');
    },
);

test(
    '固定行境界は通常borderとshadowを二重描画しない',
    async ({page, mockFileSystem}) => {
        await page.locator('#explorer').getByText('test', {exact: true}).click();
        const table = page.locator('.editor-left-pane .editor-table');
        await expect(table).toBeVisible();

        await page.evaluate(() => {
            const editor = (window as unknown as {
                editor?: {activeEditorTable: {freezeRows(count: number): void} | false};
            }).editor;
            if (!editor || editor.activeEditorTable === false) throw new Error('activeEditorTable not found');
            editor.activeEditorTable.freezeRows(1);
        });

        const boundaryRow = table.locator('.freeze-row-border').first();
        await expect(boundaryRow).toBeVisible();
        const boundaryCell = boundaryRow.locator('.editor-table-cell').first();
        await expect.poll(
            () => boundaryCell.evaluate((element) => getComputedStyle(element).borderBottomColor)
        ).toBe('rgba(0, 0, 0, 0)');
        await expect.poll(
            () => boundaryCell.evaluate((element) => getComputedStyle(element).boxShadow)
        ).toContain('inset');
    },
);
