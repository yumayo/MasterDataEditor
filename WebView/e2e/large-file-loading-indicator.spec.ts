import {test, expect} from './fixtures/test';
import {installMockApiAsync, type MockFileSystem} from './fixtures/mock-api';

function createLargeFileLoadingFs(): MockFileSystem {
    return {
        'schema/large.json': JSON.stringify({
            header: [
                {key: 0, name: 'id', type: 'int'},
                {key: 1, name: 'name', type: 'string'},
            ],
            primary_key: ['id'],
        }),
        'data/large.csv': ['id,name', '1,Sword', '2,Shield'].join('\n'),
        '.masterdataeditor/settings.json': JSON.stringify({
            largeFileEagerDataPreloadBytes: 0,
        }),
        'user:bookmarks.json': '[]',
        'plugins/.gitkeep': '',
    };
}

test('巨大ファイルも起動時にInMemoryへ常駐し、開く時にCSVを再読込しない', async ({page}) => {
    await installMockApiAsync(page, createLargeFileLoadingFs());
    await page.goto('/');

    const largeFile = page.locator('#explorer .explorer-file').getByText('large', {exact: true});
    await expect(largeFile).toBeVisible();

    const getLargeCsvReadCount = () => page.evaluate(() => {
        type RequestDetail = { type: string; filename?: string };
        const details = (window as unknown as {__mockApiRequestDetails: RequestDetail[]}).__mockApiRequestDetails;
        return details.filter(detail => detail.type === 'read_file_request' && detail.filename === 'data/large.csv').length;
    });

    await expect.poll(getLargeCsvReadCount).toBeGreaterThan(0);
    const beforeOpenReadCount = await getLargeCsvReadCount();

    await largeFile.click();

    const wrapper = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="large"]');
    await expect(wrapper.locator('.editor-table')).toBeVisible();
    await expect(wrapper.locator('.editor-table-loading-indicator')).toHaveCount(0);
    await expect.poll(getLargeCsvReadCount).toBe(beforeOpenReadCount);
});
