import {test, expect} from './fixtures/test';

test(
    '固定列境界はセルborderやshadowを使わない',
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

        const boundaryCell = table.locator(
            '.freeze-column-border:not(.editor-table-column-header):not(.editor-table-row-header)',
        ).first();
        await expect(boundaryCell).toBeVisible();
        await expect.poll(
            () => boundaryCell.evaluate((element) => getComputedStyle(element).borderRightWidth)
        ).toBe('0px');
        await expect.poll(
            () => boundaryCell.evaluate((element) => getComputedStyle(element).boxShadow)
        ).toBe('none');
    },
);

test(
    '固定行境界はセルborderやshadowを使わない',
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

        const boundaryCell = table.locator(
            '.freeze-row-border .editor-table-cell:not(.editor-table-row-header):not(.editor-table-column-header)',
        ).first();
        await expect(boundaryCell).toBeVisible();
        await expect.poll(
            () => boundaryCell.evaluate((element) => getComputedStyle(element).borderBottomWidth)
        ).toBe('0px');
        await expect.poll(
            () => boundaryCell.evaluate((element) => getComputedStyle(element).boxShadow)
        ).toBe('none');
    },
);
