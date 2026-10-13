import {test, expect} from './fixtures/test';
import type {Page} from '@playwright/test';
import {createDefaultFileSystem, installMockApiAsync, readMockFileAsync} from './fixtures/mock-api';
import {dispatchTerminalEventAsync, holdAiTerminalStatusAsync, installAiTerminalMockAsync, readTerminalRequestsAsync} from './fixtures/mock-terminal';

const AI_ROW = '.settings-label[data-setting-key="aiTool"]';

async function selectAiToolAsync(page: Page, tool: 'claude' | 'codex'): Promise<void> {
    await page.locator(`${AI_ROW} .settings-dropdown-trigger`).click();
    await page.locator(`${AI_ROW} .settings-dropdown-item[data-value="${tool}"]`).click();
}

async function readSettingsFileAsync(page: Page, path: string): Promise<Record<string, unknown> | null> {
    const raw = await readMockFileAsync(page, path);
    return typeof raw === 'string' ? JSON.parse(raw) as Record<string, unknown> : null;
}

test.describe('AIコンテナのツール設定', () => {
    test('既定はClaudeでキーボードからCodexを選択し保存と再読み込みで維持する', async ({page}) => {
        await installMockApiAsync(page, createDefaultFileSystem());
        await installAiTerminalMockAsync(page, {installed: true, statusDelayMs: 0, startError: null, startDelayMs: 0});
        await page.goto('/');
        await page.locator('.activity-bar-settings').click();
        const row = page.locator(AI_ROW);
        const trigger = row.locator('.settings-dropdown-trigger');
        await expect(trigger).toContainText('Claude');
        await expect(trigger).toHaveAccessibleName('使用するAI: Claude');
        await expect(page.locator('.settings-section[data-section-name="AIコンテナ"]')).toContainText('次回');
        await page.locator('.status-bar-ai').click();
        await expect.poll(() => readTerminalRequestsAsync(page, 'terminal_ai_start_request')).toHaveLength(1);
        const [initial] = await readTerminalRequestsAsync(page, 'terminal_ai_start_request');
        expect(initial.tool).toBe('claude');
        await trigger.focus();
        await page.keyboard.press('ArrowDown');
        await expect(row.locator('.settings-dropdown-item[data-value="claude"]')).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(row.locator('.settings-dropdown-item[data-value="codex"]')).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(trigger).toContainText('Codex');
        await expect(trigger).toHaveAccessibleName('使用するAI: Codex');
        await expect.poll(() => readSettingsFileAsync(page, '.masterdataeditor/settings.json')).toEqual({aiTool: 'codex'});
        await page.reload();
        await page.locator('.activity-bar-settings').click();
        await expect(page.locator(`${AI_ROW} .settings-dropdown-trigger`)).toContainText('Codex');
        await expect(page.locator(`${AI_ROW} .settings-dropdown-trigger`)).toHaveAccessibleName('使用するAI: Codex');
        await expect(page.locator(`${AI_ROW} .settings-reset-setting-button`)).toBeEnabled();
    });

    test('Userの明示ClaudeはWorkspaceのCodexより優先し解除とUndoRedoで継承状態を復元する', async ({page}) => {
        const fs = createDefaultFileSystem();
        fs['.masterdataeditor/settings.json'] = JSON.stringify({aiTool: 'codex'});
        await installMockApiAsync(page, fs);
        await installAiTerminalMockAsync(page, {installed: true, statusDelayMs: 0, startError: null, startDelayMs: 0});
        await page.goto('/');
        await page.locator('.activity-bar-settings').click();
        await page.locator('.settings-scope-tab[data-scope="user"]').click();
        await expect(page.locator(`${AI_ROW} .settings-dropdown-trigger`)).toContainText('Codex');
        await expect(page.locator(`${AI_ROW} .settings-dropdown-trigger`)).toHaveAccessibleName('使用するAI: Codex');
        const reset = page.locator(`${AI_ROW} .settings-reset-setting-button`);
        await expect(reset).toHaveText('設定を解除');
        await expect(reset).toBeDisabled();
        await selectAiToolAsync(page, 'claude');
        await expect.poll(() => readSettingsFileAsync(page, 'user:settings.json')).toEqual({aiTool: 'claude'});
        await expect(reset).toBeEnabled();
        await page.reload();
        await page.locator('.activity-bar-settings').click();
        await expect(page.locator('.settings-scope-tab[data-scope="user"]')).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator(`${AI_ROW} .settings-dropdown-trigger`)).toContainText('Claude');
        await expect(page.locator(`${AI_ROW} .settings-dropdown-trigger`)).toHaveAccessibleName('使用するAI: Claude');
        await page.locator('.status-bar-ai').click();
        await expect.poll(() => readTerminalRequestsAsync(page, 'terminal_ai_start_request')).toHaveLength(1);
        const [claude] = await readTerminalRequestsAsync(page, 'terminal_ai_start_request');
        expect(claude.tool).toBe('claude');
        await reset.click();
        await expect.poll(() => readSettingsFileAsync(page, 'user:settings.json')).toEqual({});
        await expect(page.locator(`${AI_ROW} .settings-dropdown-trigger`)).toContainText('Codex');
        await expect(page.locator(`${AI_ROW} .settings-dropdown-trigger`)).toHaveAccessibleName('使用するAI: Codex');
        await page.locator(`${AI_ROW} .settings-dropdown-trigger`).focus();
        await page.keyboard.press('Control+z');
        await expect.poll(() => readSettingsFileAsync(page, 'user:settings.json')).toEqual({aiTool: 'claude'});
        await expect(page.locator(`${AI_ROW} .settings-dropdown-trigger`)).toContainText('Claude');
        await expect(page.locator(`${AI_ROW} .settings-dropdown-trigger`)).toHaveAccessibleName('使用するAI: Claude');
        await page.keyboard.press('Control+y');
        await expect.poll(() => readSettingsFileAsync(page, 'user:settings.json')).toEqual({});
        await expect(page.locator(`${AI_ROW} .settings-dropdown-trigger`)).toContainText('Codex');
        await expect(page.locator(`${AI_ROW} .settings-dropdown-trigger`)).toHaveAccessibleName('使用するAI: Codex');
        await dispatchTerminalEventAsync(page, {type: 'terminal_exit', sessionId: claude.sessionId, exitCode: 0});
        await page.locator('.status-bar-ai').click();
        await expect.poll(() => readTerminalRequestsAsync(page, 'terminal_ai_start_request')).toHaveLength(2);
        const requests = await readTerminalRequestsAsync(page, 'terminal_ai_start_request');
        expect(requests[1].tool).toBe('codex');
        await expect(page.locator('.ai-terminal-location')).toContainText('Codex');
        expect(await readSettingsFileAsync(page, '.masterdataeditor/settings.json')).toEqual({aiTool: 'codex'});
    });

    test('実行中の選択変更は現在のAIを維持し終了後の次回起動だけCodexへ切り替える', async ({page}) => {
        await installMockApiAsync(page, createDefaultFileSystem());
        await installAiTerminalMockAsync(page, {installed: true, statusDelayMs: 0, startError: null, startDelayMs: 0});
        await page.goto('/');
        await page.locator('.status-bar-ai').click();
        await expect(page.locator('.ai-terminal-panel').getByRole('status')).toHaveText('実行中');
        const [running] = await readTerminalRequestsAsync(page, 'terminal_ai_start_request');
        await page.locator('.activity-bar-settings').click();
        await selectAiToolAsync(page, 'codex');
        await expect.poll(() => readSettingsFileAsync(page, '.masterdataeditor/settings.json')).toEqual({aiTool: 'codex'});
        expect(await readTerminalRequestsAsync(page, 'terminal_ai_start_request')).toHaveLength(1);
        expect(await readTerminalRequestsAsync(page, 'terminal_close_request')).toHaveLength(0);
        await expect(page.locator('.ai-terminal-location')).toContainText('Claude');
        await dispatchTerminalEventAsync(page, {type: 'terminal_output', sessionId: running.sessionId, data: 'CLAUDE_STILL_RUNNING\r\n'});
        await expect(page.locator('.ai-terminal-panel .xterm-rows')).toContainText('CLAUDE_STILL_RUNNING');
        await dispatchTerminalEventAsync(page, {type: 'terminal_exit', sessionId: running.sessionId, exitCode: 0});
        await page.locator('.status-bar-ai').click();
        await expect.poll(() => readTerminalRequestsAsync(page, 'terminal_ai_start_request')).toHaveLength(2);
        const requests = await readTerminalRequestsAsync(page, 'terminal_ai_start_request');
        expect(requests[1].tool).toBe('codex');
        expect(requests[1].sessionId).not.toBe(running.sessionId);
        await expect(page.locator('.ai-terminal-location')).toContainText('Codex');
        expect(await readTerminalRequestsAsync(page, 'terminal_ai_install_request')).toHaveLength(0);
    });

    test('導入確認後に設定したCodexをインストール操作で取得し送信する', async ({page}) => {
        await installMockApiAsync(page, createDefaultFileSystem());
        await installAiTerminalMockAsync(page, {installed: false, statusDelayMs: 0, startError: null, startDelayMs: 0});
        await page.goto('/');
        await page.locator('.status-bar-ai').click();
        await expect(page.getByRole('button', {name: 'AIをインストール', exact: true})).toBeVisible();
        await page.locator('.activity-bar-settings').click();
        await selectAiToolAsync(page, 'codex');
        await page.getByRole('button', {name: 'AIをインストール', exact: true}).click();
        await expect.poll(() => readTerminalRequestsAsync(page, 'terminal_ai_install_request')).toHaveLength(1);
        const [install] = await readTerminalRequestsAsync(page, 'terminal_ai_install_request');
        expect(install.tool).toBe('codex');
        expect(install).not.toHaveProperty('workspace');
        expect(install).not.toHaveProperty('command');
        await expect(page.locator('.ai-terminal-location')).toContainText('Codex');
    });

    test('導入確認待ちに設定を変えても開始時のツールを維持し次の起動から反映する', async ({page}) => {
        await installMockApiAsync(page, createDefaultFileSystem());
        await installAiTerminalMockAsync(page, {installed: true, statusDelayMs: 0, startError: null, startDelayMs: 0});
        await page.goto('/');
        await holdAiTerminalStatusAsync(page, true);
        await page.locator('.activity-bar-settings').click();
        await page.locator('.status-bar-ai').click();
        await expect(page.locator('.ai-terminal-panel').getByRole('status')).toContainText('確認中');
        await selectAiToolAsync(page, 'codex');
        await expect.poll(() => readSettingsFileAsync(page, '.masterdataeditor/settings.json')).toEqual({aiTool: 'codex'});
        expect(await readTerminalRequestsAsync(page, 'terminal_ai_start_request')).toHaveLength(0);
        await holdAiTerminalStatusAsync(page, false);
        await expect.poll(() => readTerminalRequestsAsync(page, 'terminal_ai_start_request')).toHaveLength(1);
        const [start] = await readTerminalRequestsAsync(page, 'terminal_ai_start_request');
        expect(start.tool).toBe('claude');
        await expect(page.locator('.ai-terminal-location')).toContainText('Claude');
        await dispatchTerminalEventAsync(page, {type: 'terminal_exit', sessionId: start.sessionId, exitCode: 0});
        await page.locator('.status-bar-ai').click();
        await expect.poll(() => readTerminalRequestsAsync(page, 'terminal_ai_start_request')).toHaveLength(2);
        const requests = await readTerminalRequestsAsync(page, 'terminal_ai_start_request');
        expect(requests[1].tool).toBe('codex');
        await expect(page.locator('.ai-terminal-location')).toContainText('Codex');
    });

    test('AI設定の保存失敗はToastと元の例外スタックで通知する', async ({page}) => {
        await installMockApiAsync(page, createDefaultFileSystem());
        await page.goto('/');
        await page.locator('.activity-bar-settings').click();
        const originalStack = await page.evaluate(() => {
            const webview = (window as unknown as {chrome: {webview: {postMessage(message: string | object): void}}}).chrome.webview;
            const original = webview.postMessage.bind(webview);
            const error = new Error('AI設定の保存に失敗しました');
            if (typeof error.stack !== 'string') throw new Error('テスト例外のスタックがありません');
            webview.postMessage = (message: string | object): void => {
                const request = (typeof message === 'string' ? JSON.parse(message) : message) as {type: string; filename: string};
                if (request.type === 'write_file_request' && request.filename === '.masterdataeditor/settings.json') {
                    webview.postMessage = original;
                    throw error;
                }
                original(message);
            };
            return error.stack;
        });
        await selectAiToolAsync(page, 'codex');
        await expect(page.locator('.notification-toast-error')).toHaveText('AI設定の保存に失敗しました');
        const notification = page.locator('.debug-console-row-error', {has: page.locator('.debug-console-col-label', {hasText: 'AI設定の保存に失敗しました'})});
        await expect(notification).toHaveCount(1);
        await page.locator('.status-bar-badge').click();
        await page.locator('.bottom-panel-tab', {hasText: 'DEBUG CONSOLE'}).click();
        await notification.click();
        await expect(page.locator('.debug-api-detail-stack-trace .debug-api-detail-code')).toHaveText(originalStack);
    });

    test('800pxのライトテーマでサイドバーを閉じてAI候補と解除説明を表示する', async ({page}) => {
        await page.setViewportSize({width: 800, height: 700});
        const fs = createDefaultFileSystem();
        fs['.masterdataeditor/settings.json'] = JSON.stringify({theme: 'light', aiTool: 'claude'});
        await installMockApiAsync(page, fs);
        await page.goto('/');
        await expect(page.locator('body')).toHaveAttribute('data-theme', 'light');
        await page.locator('.activity-bar-item[data-panel="files"]').click();
        await expect(page.locator('#explorer')).toHaveClass(/sidebar-collapsed/);
        await page.locator('.activity-bar-settings').click();
        const section = page.locator('.settings-section[data-section-name="AIコンテナ"]');
        const trigger = section.getByRole('button', {name: '使用するAI: Claude', exact: true});
        await trigger.click();
        await expect(trigger).toHaveAttribute('aria-expanded', 'true');
        const choices = section.getByRole('listbox', {name: '使用するAI', exact: true});
        await expect(choices.getByRole('option', {name: 'Claude', exact: true})).toBeInViewport();
        await expect(choices.getByRole('option', {name: 'Claude', exact: true})).toHaveAttribute('aria-selected', 'true');
        await expect(choices.getByRole('option', {name: 'Codex', exact: true})).toBeInViewport();
        await expect(choices.getByRole('option', {name: 'Codex', exact: true})).toHaveAttribute('aria-selected', 'false');
        await expect(section.getByRole('button', {name: '設定を解除', exact: true})).toBeEnabled();
        await expect(section.getByRole('button', {name: '設定を解除', exact: true})).toBeInViewport();
        await expect(section.locator('.settings-description')).toContainText('次回のAI起動から適用');
        await expect(section.locator('.settings-description')).toBeInViewport();
    });
});
