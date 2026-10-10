import {test, expect} from './fixtures/test';
import {createDefaultFileSystem, installMockApiAsync} from './fixtures/mock-api';

test('設定の信頼操作はネイティブ確認だけを要求しクライアントで信頼や保存設定を変更しない', async ({page}) => {
    await installMockApiAsync(page, createDefaultFileSystem(), false);
    await page.goto('/');
    await page.locator('.activity-bar-settings').click();
    const status = page.locator('.settings-workspace-trust-status');
    await expect(status).toContainText('制限モード');
    const openButton = page.getByRole('button', {name: '信頼設定を開く', exact: true});
    await openButton.click();
    await expect.poll(() => page.evaluate(() => (window as unknown as {__mockWorkspaceTrustSettingsRequests: unknown[]}).__mockWorkspaceTrustSettingsRequests)).toEqual([
        {type: 'workspace_trust_settings_request', requestId: expect.any(String)},
    ]);
    await expect(openButton).toBeEnabled();
    await expect(status).toContainText('制限モード');

    // 確認要求が成功しても許可通知がなければターミナルは起動できない。
    await page.locator('.status-bar-terminal').click();
    await expect(page.getByRole('button', {name: 'ターミナルを開始', exact: true})).toBeDisabled();
    const requests = await page.evaluate(() => {
        const mock = window as unknown as {
            __mockApiRequests: string[];
            __mockApiRequestDetails: Array<{type: string; filename: string | null}>;
        };
        return {
            terminalStarts: mock.__mockApiRequests.filter(type => type === 'terminal_start_request'),
            settingsWrites: mock.__mockApiRequestDetails.filter(request => request.type === 'write_file_request' && (request.filename === 'settings.json' || request.filename === '.masterdataeditor/settings.json')),
        };
    });
    expect(requests).toEqual({terminalStarts: [], settingsWrites: []});
});

test('設定の信頼状態はネイティブ通知と設定タブの開き直しに追従する', async ({page}) => {
    await installMockApiAsync(page, createDefaultFileSystem(), true);
    await page.goto('/');
    await page.locator('.activity-bar-settings').click();
    const status = page.locator('.settings-workspace-trust-status');
    await expect(status).toContainText('信頼済み');
    await page.evaluate(() => (window as unknown as {__changeWorkspaceTrustForTest(value: boolean): void}).__changeWorkspaceTrustForTest(false));
    await expect(status).toContainText('制限モード');
    await page.locator('.settings-scope-tab[data-scope="user"]').click();
    await expect(status).toContainText('制限モード');
    await page.evaluate(() => (window as unknown as {__changeWorkspaceTrustForTest(value: boolean): void}).__changeWorkspaceTrustForTest(true));
    await expect(status).toContainText('信頼済み');

    await page.locator('.tab-button').filter({hasText: '設定'}).locator('.tab-button-close').click();
    await expect(status).toHaveCount(0);
    await page.evaluate(() => (window as unknown as {__changeWorkspaceTrustForTest(value: boolean): void}).__changeWorkspaceTrustForTest(false));
    await page.locator('.activity-bar-settings').click();
    await expect(status).toContainText('制限モード');
    await expect(page.getByRole('button', {name: '信頼設定を開く', exact: true})).toBeEnabled();
});
