import {test, expect} from './fixtures/test';

test(
    '選択枠に隣接する通常グリッド線は透明化される',
    async ({page, mockFileSystem}) => {
        await page.locator('#explorer').getByText('test', {exact: true}).click();
        const table = page.locator('.editor-left-pane .editor-table');
        await expect(table).toBeVisible();

        const secondRowFirstCell = table.locator(
            '.editor-table-grid .editor-table-row[data-row-index="1"] .editor-table-cell[data-col="0"]'
        );
        await secondRowFirstCell.click();

        const selectedRowHeader = table.locator(
            '.editor-table-grid .editor-table-row[data-row-index="1"] .editor-table-row-header'
        );
        await expect(selectedRowHeader).toHaveClass(/sel-adj-right/);
        await expect.poll(
            () => selectedRowHeader.evaluate((element) => getComputedStyle(element).borderRightColor)
        ).toBe('rgba(0, 0, 0, 0)');
        await expect.poll(
            () => selectedRowHeader.evaluate((element) =>
                getComputedStyle(element).getPropertyValue('--editor-table-grid-right-color').trim()
            )
        ).toBe('transparent');

        const cellAboveSelection = table.locator(
            '.editor-table-grid .editor-table-row[data-row-index="0"] .editor-table-cell[data-col="0"]'
        );
        await expect(cellAboveSelection).toHaveClass(/sel-adj-bottom/);
        await expect.poll(
            () => cellAboveSelection.evaluate((element) => getComputedStyle(element).borderBottomColor)
        ).toBe('rgba(0, 0, 0, 0)');
        await expect.poll(
            () => cellAboveSelection.evaluate((element) =>
                getComputedStyle(element).getPropertyValue('--editor-table-grid-bottom-color').trim()
            )
        ).toBe('transparent');

        const detachedSelectedRowHeader = table.locator(
            '.editor-table-detached-row-header-layer .editor-table-detached-row[data-row-index="1"] .editor-table-row-header'
        );
        await expect(detachedSelectedRowHeader).toHaveClass(/selected/);
        await expect(detachedSelectedRowHeader).toHaveClass(/selected-row-end/);
        await expect.poll(
            () => detachedSelectedRowHeader.evaluate((element) => getComputedStyle(element).backgroundSize)
        ).toContain('calc(100% - 1px)');
        await expect.poll(
            () => detachedSelectedRowHeader.evaluate((element) => getComputedStyle(element).backgroundOrigin)
        ).toBe('border-box');
        await expect.poll(
            () => detachedSelectedRowHeader.evaluate((element) =>
                getComputedStyle(element).getPropertyValue('--editor-table-grid-bottom-color').trim()
            )
        ).toBe('transparent');
        await expect.poll(
            () => detachedSelectedRowHeader.evaluate((element) =>
                getComputedStyle(element).getPropertyValue('--editor-table-grid-right-color').trim()
            )
        ).toBe('transparent');
        await expect.poll(
            () => detachedSelectedRowHeader.evaluate((element) => getComputedStyle(element, '::before').width)
        ).toBe('1px');
        await expect.poll(
            () => detachedSelectedRowHeader.evaluate((element) => getComputedStyle(element, '::after').height)
        ).toBe('1px');
        await expect.poll(
            () => detachedSelectedRowHeader.evaluate((element) => element.getBoundingClientRect().height)
        ).toBe(21);

        const detachedSelectedColumnHeader = table.locator(
            '.editor-table-detached-column-header-layer .editor-table-column-header[data-col="0"]'
        );
        await expect(detachedSelectedColumnHeader).toHaveClass(/selected/);
        await expect(detachedSelectedColumnHeader).toHaveClass(/selected-column-end/);
        await expect.poll(
            () => detachedSelectedColumnHeader.evaluate((element) => getComputedStyle(element).backgroundSize)
        ).toContain('calc(100% - 1px)');
        await expect.poll(
            () => detachedSelectedColumnHeader.evaluate((element) =>
                getComputedStyle(element).getPropertyValue('--editor-table-grid-bottom-color').trim()
            )
        ).toBe('transparent');
        await expect.poll(
            () => detachedSelectedColumnHeader.evaluate((element) =>
                getComputedStyle(element).getPropertyValue('--editor-table-grid-right-color').trim()
            )
        ).toBe('transparent');
        await expect.poll(
            () => detachedSelectedColumnHeader.evaluate((element) => getComputedStyle(element, '::before').width)
        ).toBe('1px');
        await expect.poll(
            () => detachedSelectedColumnHeader.evaluate((element) => getComputedStyle(element, '::after').height)
        ).toBe('1px');
    },
);
