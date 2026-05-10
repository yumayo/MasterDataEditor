import { test, expect } from './fixtures/test';
import { createDefaultFileSystem, installMockApiAsync } from './fixtures/mock-api';

test.describe('ステータスバー起動時描画', () => {
    test('設定読み込み完了前にステータスバーがダークテーマ背景で表示されること', async ({ page }) => {
        const fs = createDefaultFileSystem();
        await installMockApiAsync(page, fs);
        await page.addInitScript(() => {
            type WebView = { postMessage(message: string | object): void };
            type ChromeWindow = Window & {
                chrome?: { webview: WebView };
                __statusBarStartupSettingsReadBlocked?: boolean;
                __statusBarStartupSettingsReadReleased?: boolean;
            };
            let wrapped = false;

            function wrapPostMessage(): void {
                const chromeWindow = window as ChromeWindow;
                const webview = chromeWindow.chrome?.webview;
                if (wrapped || webview === undefined) return;
                wrapped = true;

                const originalPostMessage = webview.postMessage.bind(webview);
                webview.postMessage = (message: string | object): void => {
                    const raw = typeof message === 'string' ? message : JSON.stringify(message);
                    try {
                        const request = JSON.parse(raw) as { type?: string; filename?: string };
                        if (request.type === 'read_file_request' && request.filename === 'userdata/settings.json') {
                            chromeWindow.__statusBarStartupSettingsReadBlocked = true;
                            window.setTimeout(() => {
                                chromeWindow.__statusBarStartupSettingsReadReleased = true;
                                originalPostMessage(message);
                            }, 1000);
                            return;
                        }
                    } catch {
                        // JSON ではないメッセージは通常通り流す
                    }
                    originalPostMessage(message);
                };
            }

            wrapPostMessage();
            if (!wrapped) {
                const chromeWindow = window as ChromeWindow;
                let chromeValue = chromeWindow.chrome;
                Object.defineProperty(window, 'chrome', {
                    configurable: true,
                    get: () => chromeValue,
                    set: (value: ChromeWindow['chrome']) => {
                        chromeValue = value;
                        wrapPostMessage();
                    },
                });
            }
        });

        await page.goto('/', { waitUntil: 'domcontentloaded' });

        await page.waitForFunction(() => {
            const testWindow = window as Window & {
                __statusBarStartupSettingsReadBlocked?: boolean;
                __statusBarStartupSettingsReadReleased?: boolean;
            };
            return testWindow.__statusBarStartupSettingsReadBlocked === true
                && testWindow.__statusBarStartupSettingsReadReleased !== true;
        });
        await expect(page.locator('body')).toHaveAttribute('data-theme', 'dark');

        const bodyBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        expect(bodyBackground).toBe('rgb(33, 37, 43)');

        const statusBar = page.locator('.status-bar');
        await expect(statusBar).toBeVisible();
        const statusBarBackground = await statusBar.evaluate(
            (element) => getComputedStyle(element).backgroundColor,
        );
        expect(statusBarBackground).toBe(bodyBackground);
    });
});
