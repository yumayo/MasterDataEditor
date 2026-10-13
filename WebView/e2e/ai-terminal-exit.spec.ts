import {test, expect} from './fixtures/test';
import type {Page} from '@playwright/test';
import {createDefaultFileSystem, installMockApiAsync} from './fixtures/mock-api';
import {configureTerminalCloseExitAsync, configureTerminalCloseOrderAsync, dispatchTerminalEventAsync, installAiTerminalMockAsync, readTerminalRequestsAsync} from './fixtures/mock-terminal';

async function openAiAsync(page: Page): Promise<string> {
    await installMockApiAsync(page, createDefaultFileSystem());
    await installAiTerminalMockAsync(page, {installed: true, statusDelayMs: 0, startError: null, startDelayMs: 0});
    await page.goto('/');
    await page.locator('.status-bar-ai').click();
    await expect(page.locator('.ai-terminal-panel').getByRole('status')).toHaveText('実行中');
    const [request] = await readTerminalRequestsAsync(page, 'terminal_ai_start_request');
    return request.sessionId;
}

async function readSavedBottomPanelAsync(page: Page): Promise<{visible: boolean; activeTab: string; height: number} | null> {
    return page.evaluate(() => {
        const value = (window as unknown as {__mockFs: Record<string, string>}).__mockFs['user:ui-state.json'];
        if (typeof value !== 'string') return null;
        return (JSON.parse(value) as {bottomPanel: {visible: boolean; activeTab: string; height: number}}).bottomPanel;
    });
}

test.describe('AI端末の終了', () => {
    for (const exitCode of [0, 130, -1073741510]) {
        test(`Ctrl+Cだけでは継続し実際の終了コード${exitCode}でAI領域を閉じる`, async ({page}) => {
            const sessionId = await openAiAsync(page);
            await page.keyboard.press('Control+c');
            await expect.poll(async () => (await readTerminalRequestsAsync(page, 'terminal_input_request')).map(request => request.data).join('')).toBe('\u0003');
            await expect(page.locator('.ai-terminal-panel')).toBeVisible();
            await dispatchTerminalEventAsync(page, {type: 'terminal_output', sessionId, data: 'AIはまだ動作中です\r\n'});
            await expect(page.locator('.ai-terminal-panel .xterm-rows')).toContainText('AIはまだ動作中です');
            expect(await readTerminalRequestsAsync(page, 'terminal_close_request')).toHaveLength(0);
            await dispatchTerminalEventAsync(page, {type: 'terminal_exit', sessionId, exitCode});
            await expect(page.locator('.bottom-panel')).toBeHidden();
            await expect(page.locator('.notification-toast-error')).toHaveCount(0);
            await expect.poll(() => readSavedBottomPanelAsync(page)).toEqual({visible: false, activeTab: 'ai', height: expect.any(Number)});
            const saved = await readSavedBottomPanelAsync(page);
            if (saved === null) throw new Error('パネルの表示状態が保存されていません');
            expect(saved.height).toBeGreaterThan(0);
        });
    }

    test('AI終了後の再選択は新しいセッションを開始し遅延した旧通知を無視する', async ({page}) => {
        const previousSessionId = await openAiAsync(page);
        await dispatchTerminalEventAsync(page, {type: 'terminal_exit', sessionId: previousSessionId, exitCode: 0});
        await expect(page.locator('.bottom-panel')).toBeHidden();
        await page.locator('.status-bar-ai').click();
        await expect.poll(() => readTerminalRequestsAsync(page, 'terminal_ai_start_request')).toHaveLength(2);
        const requests = await readTerminalRequestsAsync(page, 'terminal_ai_start_request');
        const sessionId = requests[1].sessionId;
        expect(sessionId).not.toBe(previousSessionId);
        await expect(page.locator('.ai-terminal-panel').getByRole('status')).toHaveText('実行中');
        await dispatchTerminalEventAsync(page, {type: 'terminal_exit', sessionId: previousSessionId, exitCode: 7});
        await dispatchTerminalEventAsync(page, {type: 'terminal_output', sessionId: previousSessionId, data: 'STALE\r\n'});
        await dispatchTerminalEventAsync(page, {type: 'terminal_output', sessionId, data: 'RESTARTED\r\n'});
        await expect(page.locator('.ai-terminal-panel .xterm-rows')).toContainText('RESTARTED');
        await expect(page.locator('.ai-terminal-panel .xterm-rows')).not.toContainText('STALE');
        await expect(page.locator('.bottom-panel')).toBeVisible();
        await expect(page.locator('.notification-toast-error')).toHaveCount(0);
        await expect(page.locator('.ai-terminal-panel .xterm-helper-textarea')).toBeFocused();
    });

    for (const exitBeforeResponse of [false, true]) {
        test(`明示終了で${exitBeforeResponse ? '終了通知' : 'close応答'}が先に届いてもAI領域を閉じ再起動できる`, async ({page}) => {
            const previousSessionId = await openAiAsync(page);
            await configureTerminalCloseExitAsync(page, 7);
            await configureTerminalCloseOrderAsync(page, exitBeforeResponse);
            await page.getByRole('button', {name: 'AIを終了', exact: true}).click();
            await expect(page.locator('.bottom-panel')).toBeHidden();
            await expect(page.locator('.status-bar-ai')).toBeFocused();
            await expect(page.locator('.notification-toast-error')).toHaveCount(0);
            await page.locator('.status-bar-ai').click();
            await expect.poll(() => readTerminalRequestsAsync(page, 'terminal_ai_start_request')).toHaveLength(2);
            await expect(page.locator('.ai-terminal-panel').getByRole('status')).toHaveText('実行中');
            await dispatchTerminalEventAsync(page, {type: 'terminal_exit', sessionId: previousSessionId, exitCode: 7});
            await expect(page.locator('.bottom-panel')).toBeVisible();
            await expect(page.locator('.notification-toast-error')).toHaveCount(0);
        });
    }

    test('AIが他タブや非表示中に終了しても表示と保存した高さを変更しない', async ({page}) => {
        const sessionId = await openAiAsync(page);
        await page.locator('.status-bar-terminal').click();
        await expect(page.locator('.terminal-status')).toHaveText('実行中');
        await expect.poll(() => readSavedBottomPanelAsync(page)).toMatchObject({visible: true, activeTab: 'terminal'});
        const before = await readSavedBottomPanelAsync(page);
        await page.clock.install();
        await dispatchTerminalEventAsync(page, {type: 'terminal_exit', sessionId, exitCode: 0});
        await expect(page.locator('.terminal-panel')).toBeVisible();
        await expect(page.locator('.terminal-panel .xterm-helper-textarea')).toBeFocused();
        await page.clock.runFor(200);
        expect(await readSavedBottomPanelAsync(page)).toEqual(before);
        await page.locator('.status-bar-ai').click();
        await expect.poll(() => readTerminalRequestsAsync(page, 'terminal_ai_start_request')).toHaveLength(2);
        const requests = await readTerminalRequestsAsync(page, 'terminal_ai_start_request');
        await expect(page.locator('.ai-terminal-panel').getByRole('status')).toHaveText('実行中');
        await page.getByRole('button', {name: 'パネルを閉じる', exact: true}).click();
        await expect.poll(() => readSavedBottomPanelAsync(page)).toMatchObject({visible: false, activeTab: 'ai'});
        const hidden = await readSavedBottomPanelAsync(page);
        if (hidden === null) throw new Error('パネルの非表示状態が保存されていません');
        expect(hidden.height).toBeGreaterThan(0);
        await dispatchTerminalEventAsync(page, {type: 'terminal_exit', sessionId: requests[1].sessionId, exitCode: 130});
        await expect(page.locator('.bottom-panel')).toBeHidden();
        await page.clock.runFor(200);
        expect(await readSavedBottomPanelAsync(page)).toEqual(hidden);
        await expect(page.locator('.notification-toast-error')).toHaveCount(0);
    });

    test('AI表示中に設定へ戻った入力フォーカスを終了後も奪わない', async ({page}) => {
        const sessionId = await openAiAsync(page);
        await page.locator('.activity-bar-settings').click();
        const setting = page.locator('.settings-export-begin-date-column-input');
        await setting.fill('user_is_typing');
        await dispatchTerminalEventAsync(page, {type: 'terminal_exit', sessionId, exitCode: 0});
        await expect(page.locator('.bottom-panel')).toBeHidden();
        await expect(setting).toBeFocused();
        await expect(setting).toHaveValue('user_is_typing');
    });
});
