import {test, expect} from './fixtures/test';
import {installMockApiAsync, type MockFileSystem} from './fixtures/mock-api';
import type {Locator, Page} from '@playwright/test';

const BLAME_DATA = {
    'data/commented.csv': [
        {lineNumber: 2, author: 'Alice', date: '2026-03-01', commitHash: 'aaa1111', commitMessage: 'initial'},
        {lineNumber: 3, author: 'Bob', date: '2026-03-02', commitHash: 'bbb2222', commitMessage: 'update'},
    ],
};

function createCommentedFileSystem(): MockFileSystem {
    return {
        'schema/commented.json': JSON.stringify({
            header: [
                {key: 0, name: 'id', type: 'int', comment: 'ID', width: 96},
                {key: 1, name: 'name', type: 'string', comment: '名前', width: 160},
                {key: 2, name: 'value', type: 'int', comment: '値', width: 120},
            ],
            primary_key: ['id'],
        }),
        'data/commented.csv': [
            'id,name,value',
            '1,item_a,100',
            '2,item_b,200',
        ].join('\n'),
        'user:bookmarks.json': '[]',
        'plugins/.gitkeep': '',
    };
}

async function installBlameMockAsync(page: Page): Promise<void> {
    await page.addInitScript((data) => {
        (window as unknown as {__mockGitBlame: typeof BLAME_DATA}).__mockGitBlame = data;
    }, BLAME_DATA);
}

async function showBlameAsync(page: Page, table: Locator): Promise<void> {
    const rowHeader = table.locator('.editor-table-detached-row-header-layer .editor-table-row-header').first();
    const box = await rowHeader.boundingBox();
    if (box === null) throw new Error('row header box not found');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, {button: 'right'});
    const menu = page.locator('.context-menu.visible');
    await expect(menu).toBeVisible();
    await menu.locator('.context-menu-item', {hasText: '変更履歴を表示'}).click();
    await expect(table.locator('.editor-table-detached-corner-layer .blame-column-header')).toBeVisible();
}

test.describe('blame column header border height', () => {
    test('コメント付きヘッダーでblame表示後もヘッダー境界線の高さが縮まらない', async ({page}) => {
        await installBlameMockAsync(page);
        await installMockApiAsync(page, createCommentedFileSystem());
        await page.goto('/');
        await page.locator('#explorer').getByText('commented', {exact: true}).click();

        const table = page.locator('.editor-left-pane .editor-table');
        await expect(table).toBeVisible();
        await showBlameAsync(page, table);

        const metrics = await page.evaluate(() => {
            const tableElement = document.querySelector<HTMLElement>('.editor-left-pane .editor-table');
            if (tableElement === null) throw new Error('table not found');
            const dataHeader = tableElement.querySelector<HTMLElement>('.editor-table-detached-column-header-layer .editor-table-column-header[data-col="0"]');
            const blameHeader = tableElement.querySelector<HTMLElement>('.editor-table-detached-corner-layer .blame-column-header');
            if (dataHeader === null || blameHeader === null) throw new Error('header cells not found');
            const lineHeights = Array.from(tableElement.querySelectorAll<HTMLElement>(
                '.editor-table-detached-corner-layer .editor-table-grid-line-vertical,' +
                '.editor-table-detached-column-header-layer .editor-table-grid-line-vertical',
            )).map(line => Number.parseFloat(line.style.height));
            return {
                dataHeaderHeight: dataHeader.getBoundingClientRect().height,
                blameHeaderHeight: blameHeader.getBoundingClientRect().height,
                lineHeights,
            };
        });

        expect(metrics.dataHeaderHeight).toBe(40);
        expect(metrics.blameHeaderHeight).toBe(40);
        expect(metrics.lineHeights.length).toBeGreaterThan(0);
        for (const height of metrics.lineHeights) {
            expect(height).toBeGreaterThanOrEqual(39);
        }
    });
});
