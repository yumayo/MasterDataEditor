import {test, expect} from './fixtures/test';
import {installMockApiAsync, type MockFileSystem} from './fixtures/mock-api';

function createLargeTableFs(rowCount: number): MockFileSystem {
    const rows = ['id,name'];
    for (let id = 1; id <= rowCount; id++) {
        rows.push(`${id},name_${id}`);
    }
    return {
        'schema/large.json': JSON.stringify({
            header: [
                {key: 0, name: 'id', type: 'int', width: 80},
                {key: 1, name: 'name', type: 'string', width: 140},
            ],
            primary_key: ['id'],
        }),
        'data/large.csv': rows.join('\n'),
        'user:bookmarks.json': '[]',
        'plugins/.gitkeep': '',
    };
}

test('detached row header width grows for large row counts', async ({page}) => {
    await installMockApiAsync(page, createLargeTableFs(100000));
    await page.goto('/');
    await page.locator('#explorer').getByText('large', {exact: true}).click();

    const table = page.locator('.editor-left-pane .editor-table');
    await expect(table).toBeVisible();
    await expect(table.locator('.editor-table-detached-row-header-layer .editor-table-row-header').first()).toBeVisible();

    const metrics = await page.evaluate(() => {
        const root = document.querySelector<HTMLElement>('.editor-left-pane .editor-table');
        if (root === null) throw new Error('editor table not found');
        const rowHeader = root.querySelector<HTMLElement>('.editor-table-detached-row-header-layer .editor-table-row-header');
        const detachedRow = root.querySelector<HTMLElement>('.editor-table-detached-row-header-layer .editor-table-detached-row');
        const cornerCell = root.querySelector<HTMLElement>('.editor-table-detached-corner-layer .editor-table-corner-cell');
        if (rowHeader === null || detachedRow === null || cornerCell === null) {
            throw new Error('detached header elements not found');
        }
        return {
            cssWidth: getComputedStyle(root).getPropertyValue('--editor-table-row-header-width').trim(),
            rowHeaderWidth: rowHeader.getBoundingClientRect().width,
            detachedRowWidth: detachedRow.getBoundingClientRect().width,
            cornerWidth: cornerCell.getBoundingClientRect().width,
        };
    });

    expect(parseFloat(metrics.cssWidth)).toBeGreaterThan(40);
    expect(metrics.rowHeaderWidth).toBeGreaterThan(60);
    expect(Math.abs(metrics.rowHeaderWidth - metrics.cornerWidth)).toBeLessThan(1);
    expect(metrics.detachedRowWidth).toBeGreaterThanOrEqual(metrics.rowHeaderWidth);
});
