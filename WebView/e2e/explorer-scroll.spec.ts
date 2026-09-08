import {test, expect} from './fixtures/test';
import {installMockApiAsync, type MockFileSystem} from './fixtures/mock-api';

test('エクスプローラーは一覧だけをスクロールし、固定の検索欄で絞り込める', async ({page}) => {
    await page.setViewportSize({width: 1280, height: 640});
    const fileSystem: MockFileSystem = {'user:bookmarks.json': '[]', 'plugins/.gitkeep': ''};
    for (let index = 0; index < 80; index++) {
        const tableName = `table_${String(index).padStart(2, '0')}`;
        fileSystem[`schema/${tableName}.json`] = JSON.stringify({
            description: `テーブル ${index}`,
            header: [{key: 0, name: 'id', type: 'int'}],
            primary_key: ['id'],
        });
        fileSystem[`data/${tableName}.csv`] = 'id\n1';
    }
    await installMockApiAsync(page, fileSystem);
    await page.goto('/');

    const explorer = page.locator('#explorer');
    const input = explorer.locator('.explorer-filter-input');
    const files = explorer.locator('.explorer-file');
    await expect(files).toHaveCount(80);
    const inputTop = await input.evaluate(element => element.getBoundingClientRect().top);
    await files.first().hover();
    await page.mouse.wheel(0, 10000);
    await expect(files.last()).toBeInViewport();
    await expect(input).toBeInViewport();
    expect(await input.evaluate(element => element.getBoundingClientRect().top)).toBe(inputTop);
    expect(await explorer.locator('.sidebar-content').evaluate(element => element.scrollTop)).toBe(0);

    await input.fill('table_79');
    await expect(explorer.locator('.explorer-file:visible')).toHaveCount(1);
    await expect(explorer.locator('.explorer-file:visible')).toContainText('table_79');
    await explorer.locator('.explorer-filter-clear').click();
    await expect(input).toBeFocused();
    await expect(explorer.locator('.explorer-file:visible')).toHaveCount(80);
    await files.first().hover();
    await page.mouse.wheel(0, 10000);
    await expect(files.last()).toBeInViewport();
    await expect(input).toBeInViewport();
});
