import {writeFileSync, mkdirSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test, expect} from './fixtures/test';
import {createDefaultFileSystem, installMockApiAsync} from './fixtures/mock-api';

const attack = `
let parentAccess = false;
let nativeAccess = false;
try { parentAccess = Boolean(parent.document.body); } catch {}
try { nativeAccess = Boolean(window.chrome && window.chrome.webview); } catch {}
if (nativeAccess) window.chrome.webview.postMessage({type: 'terminal_start_request', requestId: 'attack', sessionId: 'attack', cols: 80, rows: 24});
window.masterDataEditor.registerViewPlugin({
    id: 'attack', apiVersion: 2, title: '隔離の確認',
    render(container) {
        container.dataset.parentAccess = String(parentAccess);
        container.dataset.nativeAccess = String(nativeAccess);
        container.textContent = 'プラグイン内の表示';
    }
});`;

test('未信頼フォルダーでは起動時も再読み込みでもViewコードを実行しない', async ({page}) => {
    const fs = createDefaultFileSystem();
    fs['plugins/views/attack.js'] = attack;
    await installMockApiAsync(page, fs, false);
    await page.goto('/');
    await page.locator('.activity-bar-item[data-panel="views"]').click();
    await expect(page.locator('.view-plugin-empty')).toContainText('信頼');
    await page.locator('.view-plugin-reload-button').click();
    await expect(page.locator('.view-plugin-item')).toHaveCount(0);
    const requests = await page.evaluate(() => (window as unknown as {__mockApiRequests: string[]}).__mockApiRequests);
    expect(requests).not.toContain('terminal_start_request');
});

test('信頼済みでもViewプラグインは親DOMとネイティブAPIから隔離する', async ({page}) => {
    const fs = createDefaultFileSystem();
    fs['plugins/views/attack.js'] = attack;
    await installMockApiAsync(page, fs, true);
    await page.goto('/');
    await page.locator('.activity-bar-item[data-panel="views"]').click();
    await page.locator('.view-plugin-item[data-plugin-id="attack"]').click();
    const frame = page.locator('.view-plugin-tab-root iframe');
    await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
    const root = frame.contentFrame().locator('.view-plugin-sandbox-root');
    await expect(root).toHaveText('プラグイン内の表示');
    await expect(root).toHaveAttribute('data-parent-access', 'false');
    await expect(root).toHaveAttribute('data-native-access', 'false');
    const requests = await page.evaluate(() => (window as unknown as {__mockApiRequests: string[]}).__mockApiRequests);
    expect(requests).not.toContain('terminal_start_request');
});


test('信頼を解除するとViewを停止し、再信頼後に再び開ける', async ({page}) => {
    const fs = createDefaultFileSystem();
    fs['plugins/views/attack.js'] = attack;
    await installMockApiAsync(page, fs, true);
    await page.goto('/');
    await page.locator('.activity-bar-item[data-panel="views"]').click();
    await page.locator('.view-plugin-item[data-plugin-id="attack"]').click();
    await expect(page.locator('.view-plugin-tab-root iframe').contentFrame().locator('.view-plugin-sandbox-root')).toBeVisible();
    await page.evaluate(() => (window as unknown as {__changeWorkspaceTrustForTest(value: boolean): void}).__changeWorkspaceTrustForTest(false));
    await expect(page.locator('.view-plugin-sandbox-frame')).toHaveCount(0);
    await expect(page.locator('.view-plugin-empty')).toContainText('信頼');
    await page.evaluate(() => (window as unknown as {__changeWorkspaceTrustForTest(value: boolean): void}).__changeWorkspaceTrustForTest(true));
    await page.locator('.view-plugin-item[data-plugin-id="attack"]').click();
    await expect(page.locator('.view-plugin-tab-root iframe').contentFrame().locator('.view-plugin-sandbox-root')).toBeVisible();
});

test('未信頼時は検証プラグインも実行しない', async ({page}) => {
    const fs = createDefaultFileSystem();
    fs['plugins/security.js'] = "assert(false, 'UNTRUSTED_PLUGIN_EXECUTED');";
    await installMockApiAsync(page, fs, false);
    await page.goto('/');
    await expect(page.locator('.activity-bar-item[data-panel="views"]')).toBeVisible();
    const errors = await page.evaluate(async () => (window as unknown as {editorApi: {data: {getValidationErrorsAsync(): Promise<Array<{message: string}>>}}}).editorApi.data.getValidationErrorsAsync());
    expect(errors.some(error => error.message.includes('UNTRUSTED_PLUGIN_EXECUTED'))).toBe(false);
    await page.evaluate(() => (window as unknown as {__changeWorkspaceTrustForTest(value: boolean): void}).__changeWorkspaceTrustForTest(true));
    await expect.poll(async () => page.evaluate(async () => (window as unknown as {editorApi: {data: {getValidationErrorsAsync(): Promise<Array<{message: string}>>}}}).editorApi.data.getValidationErrorsAsync())).toEqual(expect.arrayContaining([expect.objectContaining({message: expect.stringContaining('UNTRUSTED_PLUGIN_EXECUTED')})]));
});

test('未信頼時はターミナルの開始要求を送信しない', async ({page}) => {
    await installMockApiAsync(page, createDefaultFileSystem(), false);
    await page.goto('/');
    await page.locator('.status-bar-terminal').click();
    await expect(page.locator('.terminal-panel')).toContainText('制限モード');
    await expect(page.getByRole('button', {name: 'ターミナルを開始', exact: true})).toBeDisabled();
    const requests = await page.evaluate(() => (window as unknown as {__mockApiRequests: string[]}).__mockApiRequests);
    expect(requests).not.toContain('terminal_start_request');
});


test('隔離Viewの配色が明暗テーマに追従する', async ({page}) => {
    const evidenceDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../.CONTEXT/dump/workspace-security');
    mkdirSync(evidenceDir, {recursive: true});
    const fs = createDefaultFileSystem();
    fs['plugins/views/attack.js'] = attack;
    await installMockApiAsync(page, fs, true);
    await page.goto('/');
    await page.locator('.activity-bar-item[data-panel="views"]').click();
    await page.locator('.view-plugin-item[data-plugin-id="attack"]').click();
    const frame = page.locator('.view-plugin-tab-root iframe');
    const body = frame.contentFrame().locator('body');
    const wrapperHeight = await page.locator('.view-plugin-tab-wrapper').evaluate(element => element.getBoundingClientRect().height);
    await expect.poll(() => frame.evaluate(element => element.getBoundingClientRect().height)).toBeCloseTo(wrapperHeight, 0);
    for (const theme of ['light', 'dark']) {
        await page.evaluate(value => { document.body.dataset.theme = value; }, theme);
        const expected = await page.locator('body').evaluate(element => ({background: getComputedStyle(element).getPropertyValue('--background-color').trim(), color: getComputedStyle(element).getPropertyValue('--font-color').trim()}));
        await expect.poll(() => body.evaluate(element => getComputedStyle(element).getPropertyValue('--background-color').trim())).toBe(expected.background);
        await expect.poll(() => body.evaluate(element => getComputedStyle(element).getPropertyValue('--font-color').trim())).toBe(expected.color);
        await page.screenshot({path: resolve(evidenceDir, 'view-' + theme + '.png'), fullPage: true});
        writeFileSync(resolve(evidenceDir, 'view-' + theme + '.html'), await body.evaluate(element => element.ownerDocument.documentElement.outerHTML), 'utf8');
    }
});


test('起動時の古い信頼応答が途中の信頼解除を巻き戻さない', async ({page}) => {
    const fs = createDefaultFileSystem();
    fs['plugins/views/attack.js'] = attack;
    await installMockApiAsync(page, fs, true, 500);
    await page.goto('/');
    await page.waitForFunction(() => (window as unknown as {__mockApiRequests: string[]}).__mockApiRequests.includes('workspace_trust_request'));
    await page.evaluate(() => (window as unknown as {__changeWorkspaceTrustForTest(value: boolean): void}).__changeWorkspaceTrustForTest(false));
    await page.locator('.activity-bar-item[data-panel="views"]').click();
    await expect(page.locator('.view-plugin-empty')).toContainText('信頼');
    await expect(page.locator('.view-plugin-item')).toHaveCount(0);
});
