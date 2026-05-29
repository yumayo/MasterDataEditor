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
            largeFileEagerValidationCsvBytes: 0,
        }),
        'user:bookmarks.json': '[]',
        'plugins/.gitkeep': '',
    };
}

test('巨大ファイルを開く間はeditor-table上部に読み込みインジケーターを表示する', async ({page}) => {
    await installMockApiAsync(page, createLargeFileLoadingFs());
    await page.goto('/');

    const largeFile = page.locator('#explorer .explorer-file').getByText('large', {exact: true});
    await expect(largeFile).toBeVisible();

    await page.evaluate(() => {
        type WebviewApi = {
            postMessage(message: string | object): void;
        };
        type TestWindow = Window & {
            chrome: { webview: WebviewApi };
        };

        const testWindow = window as TestWindow;
        const originalPostMessage = testWindow.chrome.webview.postMessage.bind(testWindow.chrome.webview);
        testWindow.chrome.webview.postMessage = (message: string | object): void => {
            const raw = typeof message === 'string' ? message : JSON.stringify(message);
            let delayMs = 0;
            try {
                const request = JSON.parse(raw) as { type?: string; filename?: string };
                if (request.type === 'read_file_request' && request.filename === 'data/large.csv') {
                    delayMs = 250;
                }
            } catch {
                // JSONでないメッセージはそのまま流す
            }
            window.setTimeout(() => { originalPostMessage(message); }, delayMs);
        };
    });

    await largeFile.click();

    const wrapper = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="large"]');
    const indicator = wrapper.locator('.editor-table-loading-indicator');
    await expect(indicator).toBeVisible();
    await expect(indicator).toContainText('読み込み中: large');

    await expect(wrapper.locator('.editor-table')).toBeVisible();
    await expect(indicator).toHaveCount(0);
});
