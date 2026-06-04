import {test, expect} from './fixtures/test';

test(
    '選択overlayは隣接セルにborderを付与しない',
    async ({page, mockFileSystem}) => {
        await page.locator('#explorer').getByText('test', {exact: true}).click();
        const table = page.locator('.editor-left-pane .editor-table');
        await expect(table).toBeVisible();

        const secondRowFirstCell = table.locator(
            '.editor-table-grid .editor-table-row[data-row-index="1"] .editor-table-cell[data-col="0"]',
        );
        await secondRowFirstCell.click();

        await expect(page.locator('.selection-overlay-border')).toHaveCount(1);
        await expect(table.locator('.sel-adj-right')).toHaveCount(0);
        await expect(table.locator('.sel-adj-bottom')).toHaveCount(0);

        const cellAboveSelection = table.locator(
            '.editor-table-grid .editor-table-row[data-row-index="0"] .editor-table-cell[data-col="0"]',
        );
        await expect(cellAboveSelection).not.toHaveClass(/sel-adj-bottom/);
        await expect.poll(
            () => cellAboveSelection.evaluate((element) => getComputedStyle(element).borderBottomWidth),
        ).toBe('0px');

        const selectedRowHeader = table.locator(
            '.editor-table-grid .editor-table-row[data-row-index="1"] .editor-table-row-header',
        );
        await expect(selectedRowHeader).not.toHaveClass(/sel-adj-right/);
        await expect.poll(
            () => selectedRowHeader.evaluate((element) => getComputedStyle(element).borderRightWidth),
        ).toBe('0px');
    },
);
