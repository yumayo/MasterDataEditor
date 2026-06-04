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
    borderRightWidth: string;
    borderBottomWidth: string;
    boxShadow: string;
    beforeContent: string;
    afterContent: string;
    backgroundSize: string;
    className: string;
    maxHeight: string;
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
            borderRightWidth: style.borderRightWidth,
            borderBottomWidth: style.borderBottomWidth,
            boxShadow: style.boxShadow,
            beforeContent: getComputedStyle(rowHeader, '::before').content,
            afterContent: getComputedStyle(rowHeader, '::after').content,
            backgroundSize: style.backgroundSize,
            className: rowHeader.className,
            maxHeight: style.maxHeight,
            rectHeight: rowHeader.getBoundingClientRect().height,
        };
    });
}

test.describe('Chrome zoom 200% row header border', () => {
    test.use({viewport: {width: 640, height: 360}, deviceScaleFactor: 2});

    test('行ヘッダーセルはborderを持たずshadowや疑似要素を使わない', async ({page, mockFileSystem}) => {
        await prepareTableAsync(page);

        const style = await getRowHeaderGridLineStyleAsync(page);
        expect(style.devicePixelRatio).toBe(2);
        expect(style.borderRightWidth).toBe('0px');
        expect(style.borderBottomWidth).toBe('0px');
        expect(style.boxShadow).toBe('none');
        expect(style.beforeContent).toBe('none');
        expect(style.afterContent).toBe('none');
        expect(style.backgroundSize).toBe('100% 100%');
        expect(style.className).toContain('selected-row-end');
        expect(style.maxHeight).toBe('20px');
        expect(style.rectHeight).toBe(20);
    });
});

test.describe('Chrome zoom 300% row header border', () => {
    test.use({viewport: {width: 427, height: 240}, deviceScaleFactor: 3});

    test('行ヘッダーセルはborderを持たずshadowや疑似要素を使わない', async ({page, mockFileSystem}) => {
        await prepareTableAsync(page);

        const style = await getRowHeaderGridLineStyleAsync(page);
        expect(style.devicePixelRatio).toBe(3);
        expect(style.borderRightWidth).toBe('0px');
        expect(style.borderBottomWidth).toBe('0px');
        expect(style.boxShadow).toBe('none');
        expect(style.beforeContent).toBe('none');
        expect(style.afterContent).toBe('none');
        expect(style.backgroundSize).toBe('100% 100%');
        expect(style.className).toContain('selected-row-end');
        expect(style.maxHeight).toBe('20px');
        expect(style.rectHeight).toBe(20);
    });
});
