import {test, expect} from './fixtures/test';
import type {Page} from '@playwright/test';
import {installMockApiAsync, createDefaultFileSystem, type MockFileSystem} from './fixtures/mock-api';

function createThreeTableFileSystem(): MockFileSystem {
    const fs: MockFileSystem = {
        'user:bookmarks.json': '[]',
        'plugins/.gitkeep': '',
    };
    const schema = JSON.stringify({
        header: [
            {key: 0, name: 'id', type: 'int'},
            {key: 1, name: 'name', type: 'string'},
        ],
        primary_key: ['id'],
    });
    const csv = ['id,name', '1,row_a'].join('\n');
    for (const name of ['table_a', 'table_b', 'table_c']) {
        fs[`schema/${name}.json`] = schema;
        fs[`data/${name}.csv`] = csv;
    }
    return fs;
}

async function openTablesAsync(page: Page, names: string[]): Promise<void> {
    for (const name of names) {
        await page.locator('#explorer').getByText(name, {exact: true}).click();
        await expect(page.locator(`.tab-wrapper[data-tab-name="${name}"] .editor-table`)).toBeVisible();
    }
}

async function getBoxAsync(page: Page, selector: string): Promise<{x: number; y: number; width: number; height: number}> {
    const box = await page.locator(selector).boundingBox();
    if (box === null) throw new Error(`要素の位置を取得できません: ${selector}`);
    return box;
}

async function expectSingleTabBoundaryAsync(page: Page, targetName: string, side: 'left' | 'right'): Promise<void> {
    await expect(page.locator(`.tab-button[title="${targetName}"]`)).toHaveClass(
        new RegExp(`tab-button-drop-${side}`),
    );
    await expect(page.locator('.tab-button-drop-left')).toHaveCount(side === 'left' ? 1 : 0);
    await expect(page.locator('.tab-button-drop-right')).toHaveCount(side === 'right' ? 1 : 0);
}

async function expectNoTabBoundaryAsync(page: Page): Promise<void> {
    await expect(page.locator('.tab-button-drop-right')).toHaveCount(0);
    await expect(page.locator('.tab-button-drop-left')).toHaveCount(0);
}

async function expectActivityBoundaryAsync(page: Page, targetPanel: string, side: 'before' | 'after'): Promise<void> {
    await expect(page.locator(`.activity-bar-item[data-panel="${targetPanel}"]`)).toHaveClass(
        new RegExp(`activity-bar-item-drop-${side}`),
    );
    await expect(page.locator('.activity-bar-item-drop-before')).toHaveCount(side === 'before' ? 1 : 0);
    await expect(page.locator('.activity-bar-item-drop-after')).toHaveCount(side === 'after' ? 1 : 0);
}

async function expectNoActivityBoundaryAsync(page: Page): Promise<void> {
    await expect(page.locator('.activity-bar-item-drop-after')).toHaveCount(0);
    await expect(page.locator('.activity-bar-item-drop-before')).toHaveCount(0);
}

test.describe('ドラッグ挿入境界', () => {
    test('タブの挿入位置は対象タブの左右半分で表示される', async ({page}) => {
        await installMockApiAsync(page, createThreeTableFileSystem());
        await page.goto('/');
        await openTablesAsync(page, ['table_a', 'table_b', 'table_c']);

        const source = await getBoxAsync(page, '.tab-button[title="table_c"]');
        const tabA = await getBoxAsync(page, '.tab-button[title="table_a"]');
        const tabB = await getBoxAsync(page, '.tab-button[title="table_b"]');
        const y = tabA.y + tabA.height / 2;

        await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
        await page.mouse.down();
        await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2 + 8);
        await expectNoTabBoundaryAsync(page);

        await page.mouse.move(tabA.x + tabA.width * 0.75, y);
        await expectSingleTabBoundaryAsync(page, 'table_a', 'right');

        await page.mouse.move(tabB.x + tabB.width * 0.25, y);
        await expectSingleTabBoundaryAsync(page, 'table_b', 'left');

        await page.mouse.up();
        await expect(page.locator('.tab-button .tab-button-name')).toHaveText(['table_a', 'table_c', 'table_b']);
    });

    test('アクティビティバーの挿入位置は対象アイコンの上下半分で表示される', async ({page}) => {
        await installMockApiAsync(page, createDefaultFileSystem());
        await page.goto('/');

        const source = await getBoxAsync(page, '.activity-bar-item[data-panel="search"]');
        const files = await getBoxAsync(page, '.activity-bar-item[data-panel="files"]');
        const references = await getBoxAsync(page, '.activity-bar-item[data-panel="references"]');
        const x = files.x + files.width / 2;

        await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
        await page.mouse.down();
        await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2 + 8);
        await expectNoActivityBoundaryAsync(page);

        await page.mouse.move(x, files.y + files.height * 0.75);
        await expectActivityBoundaryAsync(page, 'files', 'after');

        await page.mouse.move(x, references.y + references.height * 0.25);
        await expectActivityBoundaryAsync(page, 'references', 'before');

        await page.mouse.up();
        const order = await page.locator('.activity-bar .activity-bar-item:not(.activity-bar-settings)').evaluateAll(nodes => {
            return nodes.map(node => (node as HTMLElement).dataset.panel ?? '');
        });
        expect(order).toEqual(['files', 'search', 'references', 'bookmarks', 'calendar', 'views', 'sourceControl', 'history']);
    });
});
