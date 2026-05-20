import {test, expect} from './fixtures/test';
import type {Page} from '@playwright/test';

async function prepareTableAsync(page: Page): Promise<void> {
    await page.locator('#explorer').getByText('test', {exact: true}).click();
    await expect(page.locator('.editor-left-pane .editor-table')).toBeVisible();
    await page
        .locator(
            '.editor-left-pane .editor-table-detached-row-header-layer .editor-table-detached-row[data-row-index="2"] .editor-table-row-header',
        )
        .click();
}

async function getRowHeaderGridLineStyleAsync(page: Page): Promise<{
    devicePixelRatio: number;
    gridLineWidth: string;
    borderRightWidth: string;
    borderRightColor: string;
    borderBottomWidth: string;
    borderBottomColor: string;
    boxShadow: string;
    backgroundSize: string;
    className: string;
    gridLineScale: string;
    beforeWidth: string;
    beforeTransform: string;
    afterHeight: string;
    afterTransform: string;
    rectHeight: number;
}> {
    return page.evaluate(() => {
        const rowHeader = document.querySelector<HTMLElement>(
            '.editor-left-pane .editor-table-detached-row-header-layer .editor-table-detached-row[data-row-index="2"] .editor-table-row-header',
        );
        if (rowHeader === null) throw new Error('rowHeader not found');

        const style = getComputedStyle(rowHeader);
        return {
            devicePixelRatio: window.devicePixelRatio,
            gridLineWidth: style.getPropertyValue('--editor-table-grid-line-width').trim(),
            borderRightWidth: style.borderRightWidth,
            borderRightColor: style.borderRightColor,
            borderBottomWidth: style.borderBottomWidth,
            borderBottomColor: style.borderBottomColor,
            boxShadow: style.boxShadow,
            backgroundSize: style.backgroundSize,
            className: rowHeader.className,
            gridLineScale: style.getPropertyValue('--editor-table-grid-line-scale').trim(),
            beforeWidth: getComputedStyle(rowHeader, '::before').width,
            beforeTransform: getComputedStyle(rowHeader, '::before').transform,
            afterHeight: getComputedStyle(rowHeader, '::after').height,
            afterTransform: getComputedStyle(rowHeader, '::after').transform,
            rectHeight: rowHeader.getBoundingClientRect().height,
        };
    });
}

test.describe('Chrome zoom 200% row header grid line', () => {
    test.use({viewport: {width: 640, height: 360}, deviceScaleFactor: 2});

    test('行ヘッダー罫線はborderではなく0.5px shadowで描画する', async ({page, mockFileSystem}) => {
        await prepareTableAsync(page);

        const style = await getRowHeaderGridLineStyleAsync(page);
        expect(style.devicePixelRatio).toBe(2);
        expect(style.gridLineWidth).toBe('.5px');
        expect(style.borderRightWidth).toBe('1px');
        expect(style.borderBottomWidth).toBe('1px');
        expect(style.borderRightColor).toBe('rgba(0, 0, 0, 0)');
        expect(style.borderBottomColor).toBe('rgba(0, 0, 0, 0)');
        expect(style.boxShadow).toContain('inset');
        expect(style.boxShadow).toContain('0.5px');
        expect(style.backgroundSize).toContain('calc(100% - 1px)');
        expect(style.className).toContain('selected-row-end');
        expect(Number(style.gridLineScale)).toBeCloseTo(0.5);
        expect(style.beforeWidth).toBe('1px');
        expect(style.beforeTransform).toBe('matrix(0.5, 0, 0, 1, 0, 0)');
        expect(style.afterHeight).toBe('1px');
        expect(style.afterTransform).toBe('matrix(1, 0, 0, 0.5, 0, 0)');
        expect(style.rectHeight).toBe(21);
    });
});

test.describe('Chrome zoom 300% row header grid line', () => {
    test.use({viewport: {width: 427, height: 240}, deviceScaleFactor: 3});

    test('行ヘッダー罫線はborderではなく1/3px shadowで描画する', async ({page, mockFileSystem}) => {
        await prepareTableAsync(page);

        const style = await getRowHeaderGridLineStyleAsync(page);
        expect(style.devicePixelRatio).toBe(3);
        expect(style.gridLineWidth).toBe('.3333333px');
        expect(style.borderRightWidth).toBe('1px');
        expect(style.borderBottomWidth).toBe('1px');
        expect(style.borderRightColor).toBe('rgba(0, 0, 0, 0)');
        expect(style.borderBottomColor).toBe('rgba(0, 0, 0, 0)');
        expect(style.boxShadow).toContain('inset');
        expect(style.boxShadow).toContain('0.333');
        expect(style.backgroundSize).toContain('calc(100% - 1px)');
        expect(style.className).toContain('selected-row-end');
        expect(Number(style.gridLineScale)).toBeCloseTo(0.3333333);
        expect(style.beforeWidth).toBe('1px');
        expect(style.beforeTransform).toBe('matrix(0.333333, 0, 0, 1, 0, 0)');
        expect(style.afterHeight).toBe('1px');
        expect(style.afterTransform).toBe('matrix(1, 0, 0, 0.333333, 0, 0)');
        expect(style.rectHeight).toBe(21);
    });
});
