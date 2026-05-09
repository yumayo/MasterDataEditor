import { test, expect } from './fixtures/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

function createFileSystem(): MockFileSystem {
    const schema = JSON.stringify({
        header: [
            { key: 0, name: 'id', type: 'int' },
            { key: 1, name: 'name', type: 'string' },
        ],
        primary_key: ['id'],
    });

    return {
        'schema/weapon.json': schema,
        'schema/enemy.json': schema,
        'data/weapon.csv': ['id,name', '1,Sword'].join('\n'),
        'data/enemy.csv': ['id,name', '1,Slime'].join('\n'),
        'userdata/bookmarks.json': '[]',
        'plugins/.gitkeep': '',
    };
}

test.describe('読み込み中タブの重複生成', () => {
    test('同じタブを読み込み完了前に再クリックしても tab-wrapper は重複せず、最後に選んだタブだけ表示される', async ({ page }) => {
        await installMockApiAsync(page, createFileSystem());
        await page.goto('/');

        const weaponFile = page.locator('#explorer .explorer-file').getByText('weapon', { exact: true });
        const enemyFile = page.locator('#explorer .explorer-file').getByText('enemy', { exact: true });
        await expect(weaponFile).toBeVisible();
        await expect(enemyFile).toBeVisible();

        await page.evaluate(() => {
            type WebviewApi = {
                postMessage(message: string | object): void;
            };
            type TestWindow = Window & {
                chrome: { webview: WebviewApi };
                __invalidateFileCacheEntry(filename: string): void;
            };

            const testWindow = window as TestWindow;
            testWindow.__invalidateFileCacheEntry('schema/weapon.json');

            const originalPostMessage = testWindow.chrome.webview.postMessage.bind(testWindow.chrome.webview);
            testWindow.chrome.webview.postMessage = (message: string | object): void => {
                const raw = typeof message === 'string' ? message : JSON.stringify(message);
                let delayMs = 0;
                try {
                    const request = JSON.parse(raw) as { type?: string; filename?: string };
                    if (request.type === 'read_file_request' && request.filename === 'schema/weapon.json') {
                        delayMs = 200;
                    }
                } catch {
                    // JSONでないメッセージはそのまま流す
                }
                window.setTimeout(() => { originalPostMessage(message); }, delayMs);
            };
        });

        await weaponFile.click();
        await weaponFile.click();
        await enemyFile.click();

        await expect(page.locator('.editor-left-pane .tab-wrapper[data-tab-name="enemy"]')).toBeVisible();
        await page.waitForTimeout(300);

        await expect(page.locator('.editor-left-pane .tab-wrapper[data-tab-name="weapon"]')).toHaveCount(1);
        const visibleWrapperNames = await page.locator('.editor-left-pane .tab-wrapper').evaluateAll((elements) => {
            return elements
                .filter(element => window.getComputedStyle(element).display !== 'none')
                .map(element => element.getAttribute('data-tab-name') ?? '');
        });
        expect(visibleWrapperNames).toEqual(['enemy']);

        await page.locator('.tab-button').getByText('weapon', { exact: true }).click();
        await expect(page.locator('.editor-left-pane .tab-wrapper[data-tab-name="weapon"]')).toBeVisible();
    });
});
