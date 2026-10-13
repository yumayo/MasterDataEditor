import {test, expect} from './fixtures/test';
import {createDefaultFileSystem, installMockApiAsync} from './fixtures/mock-api';
import {clearTerminalStartErrorAsync, dispatchTerminalEventAsync, installAiTerminalMockAsync, readTerminalRequestsAsync} from './fixtures/mock-terminal';

test.describe('AI専用ターミナル', () => {
    test('ステータスバーのAIから領域を確保し導入確認後にインストールを選べる', async ({page}) => {
        await installMockApiAsync(page, createDefaultFileSystem());
        await installAiTerminalMockAsync(page, {installed: false, statusDelayMs: 1000, startError: null, startDelayMs: 600});
        await page.goto('/');
        await expect(page.locator('.status-bar-ai + .status-bar-terminal')).toBeVisible();
        await page.locator('.status-bar-ai').click();
        const panel = page.locator('.ai-terminal-panel');
        await expect(panel).toBeVisible();
        await expect(panel.getByRole('status')).toContainText('確認中');
        await expect(page.locator('.bottom-panel-tab')).toHaveText(['PROBLEMS', 'DEBUG CONSOLE', 'AI', 'TERMINAL']);
        await page.locator('.bottom-panel-tab', {hasText: /^AI$/}).click();
        await expect(panel.getByRole('button', {name: 'AIをインストール', exact: true})).toBeVisible();
        await expect(panel.getByRole('status')).toContainText('未インストール');
        await expect(panel).toContainText('C:\\作業 workspace');
        expect(await readTerminalRequestsAsync(page, 'terminal_ai_status_request')).toHaveLength(1);
        expect(await readTerminalRequestsAsync(page, 'terminal_ai_install_request')).toHaveLength(0);
        expect(await readTerminalRequestsAsync(page, 'terminal_ai_start_request')).toHaveLength(0);
        await panel.getByRole('button', {name: 'AIをインストール', exact: true}).click();
        await page.locator('.bottom-panel-tab', {hasText: /^AI$/}).click();
        await expect.poll(() => readTerminalRequestsAsync(page, 'terminal_ai_install_request')).toHaveLength(1);
        await expect(panel.getByRole('status')).toContainText('実行中');
        const [start] = await readTerminalRequestsAsync(page, 'terminal_ai_install_request');
        expect(start).not.toHaveProperty('cwd');
        expect(start).not.toHaveProperty('workspace');
        expect(start).not.toHaveProperty('command');
        await dispatchTerminalEventAsync(page, {type: 'terminal_output', sessionId: start.sessionId, data: 'Cloning into ai-container...\r\nClaude ready\r\n'});
        await expect(panel.locator('.xterm-rows')).toContainText('Claude ready');
        await expect(panel.locator('.xterm-helper-textarea')).toBeFocused();
    });

    test('導入済みなら自動起動し通常端末と入出力と履歴を分離して保持する', async ({page}) => {
        await installMockApiAsync(page, createDefaultFileSystem());
        await installAiTerminalMockAsync(page, {installed: true, statusDelayMs: 0, startError: null, startDelayMs: 0});
        await page.goto('/');
        await page.locator('.activity-bar-settings').click();
        const setting = page.locator('.settings-export-begin-date-column-input');
        await setting.fill('start_at');
        await setting.blur();
        await expect.poll(() => page.evaluate(() => (window as unknown as {__mockFs: Record<string, string>}).__mockFs['.masterdataeditor/settings.json'])).toContain('start_at');
        const saved = await page.evaluate(() => (window as unknown as {__mockFs: Record<string, string>}).__mockFs['.masterdataeditor/settings.json']);
        await page.locator('.status-bar-ai').click();
        await expect.poll(() => readTerminalRequestsAsync(page, 'terminal_ai_start_request')).toHaveLength(1);
        const [ai] = await readTerminalRequestsAsync(page, 'terminal_ai_start_request');
        await expect(page.locator('.ai-terminal-panel').getByRole('status')).toHaveText('実行中');
        await page.keyboard.press('Control+s');
        await page.keyboard.press('Control+z');
        await expect(setting).toHaveValue('start_at');
        expect(await page.evaluate(() => (window as unknown as {__mockFs: Record<string, string>}).__mockFs['.masterdataeditor/settings.json'])).toBe(saved);
        await dispatchTerminalEventAsync(page, {type: 'terminal_output', sessionId: ai.sessionId, data: 'AI history\r\n'});
        await page.locator('.status-bar-terminal').click();
        await expect.poll(() => readTerminalRequestsAsync(page, 'terminal_start_request')).toHaveLength(1);
        const [shell] = await readTerminalRequestsAsync(page, 'terminal_start_request');
        expect(shell.sessionId).not.toBe(ai.sessionId);
        await dispatchTerminalEventAsync(page, {type: 'terminal_output', sessionId: shell.sessionId, data: 'Shell history\r\n'});
        await dispatchTerminalEventAsync(page, {type: 'terminal_output', sessionId: ai.sessionId, data: 'AI background\r\n'});
        await expect(page.locator('.terminal-panel .xterm-rows')).toContainText('Shell history');
        await expect(page.locator('.terminal-panel .xterm-rows')).not.toContainText('AI history');
        await page.locator('.bottom-panel-tab', {hasText: /^AI$/}).click();
        await expect(page.locator('.ai-terminal-panel .xterm-rows')).toContainText('AI background');
        await expect(page.locator('.ai-terminal-panel .xterm-rows')).toContainText('AI history');
        await expect(page.locator('.ai-terminal-panel .xterm-rows')).not.toContainText('Shell history');
        await page.getByRole('button', {name: 'パネルを閉じる', exact: true}).click();
        await page.locator('.status-bar-ai').click();
        expect(await readTerminalRequestsAsync(page, 'terminal_ai_start_request')).toHaveLength(1);
        expect(await readTerminalRequestsAsync(page, 'terminal_ai_install_request')).toHaveLength(0);
        expect(await readTerminalRequestsAsync(page, 'terminal_close_request')).toHaveLength(0);
        const inputs = await readTerminalRequestsAsync(page, 'terminal_input_request');
        expect(inputs.filter(request => request.sessionId === ai.sessionId).map(request => request.data).join('')).toBe('\u0013\u001a');
        await expect(page.locator('.ai-terminal-panel .xterm-helper-textarea')).toBeFocused();
    });

    test('起動例外は元のスタックを通知し再試行で導入済み環境を再利用する', async ({page}) => {
        await installMockApiAsync(page, createDefaultFileSystem());
        await installAiTerminalMockAsync(page, {installed: true, statusDelayMs: 0, startError: 'AIを起動できません', startDelayMs: 0});
        await page.goto('/');
        await page.locator('.status-bar-ai').click();
        await expect(page.locator('.notification-toast-error')).toContainText('AIを起動できません');
        await expect(page.locator('.ai-terminal-panel')).not.toContainText('AIを起動できません');
        await page.locator('.bottom-panel-tab', {hasText: 'DEBUG CONSOLE'}).click();
        await page.locator('.debug-console-row-error', {hasText: 'AIを起動できません'}).click();
        await expect(page.locator('.debug-api-detail-stack-trace .debug-api-detail-code')).toHaveText('at MockTerminal.Start()');
        await clearTerminalStartErrorAsync(page);
        await page.locator('.bottom-panel-tab', {hasText: /^AI$/}).click();
        await page.getByRole('button', {name: 'AIを再起動', exact: true}).click();
        await expect.poll(() => readTerminalRequestsAsync(page, 'terminal_ai_start_request')).toHaveLength(2);
        await expect(page.locator('.ai-terminal-panel').getByRole('status')).toHaveText('実行中');
        expect(await readTerminalRequestsAsync(page, 'terminal_ai_install_request')).toHaveLength(0);
    });

    test('インストール中の非ゼロ終了を通知し再試行時に状態を再確認する', async ({page}) => {
        await installMockApiAsync(page, createDefaultFileSystem());
        await installAiTerminalMockAsync(page, {installed: false, statusDelayMs: 0, startError: null, startDelayMs: 0});
        await page.goto('/');
        await page.locator('.status-bar-ai').click();
        await page.getByRole('button', {name: 'AIをインストール', exact: true}).click();
        await expect(page.locator('.ai-terminal-panel').getByRole('status')).toHaveText('実行中');
        const [install] = await readTerminalRequestsAsync(page, 'terminal_ai_install_request');
        await dispatchTerminalEventAsync(page, {type: 'terminal_output', sessionId: install.sessionId, data: 'start-wsl-containers.ps1 failed\r\n'});
        await dispatchTerminalEventAsync(page, {type: 'terminal_exit', sessionId: install.sessionId, exitCode: 7});
        await expect(page.locator('.notification-toast-error')).toContainText('7');
        await expect(page.locator('.ai-terminal-panel').getByRole('status')).toContainText('7');
        await page.getByRole('button', {name: 'AIを再起動', exact: true}).click();
        await expect.poll(() => readTerminalRequestsAsync(page, 'terminal_ai_status_request')).toHaveLength(2);
        await expect.poll(() => readTerminalRequestsAsync(page, 'terminal_ai_start_request')).toHaveLength(1);
        expect(await readTerminalRequestsAsync(page, 'terminal_ai_install_request')).toHaveLength(1);
    });

    test('保存されたAI表示は復元のみ行い明示操作まで確認も起動も行わない', async ({page}) => {
        const fs = createDefaultFileSystem();
        fs['user:ui-state.json'] = JSON.stringify({bottomPanel: {visible: true, height: 360, activeTab: 'ai'}});
        await installMockApiAsync(page, fs);
        await installAiTerminalMockAsync(page, {installed: true, statusDelayMs: 0, startError: null, startDelayMs: 0});
        await page.goto('/');
        await expect(page.locator('.bottom-panel-tab', {hasText: /^AI$/})).toHaveClass(/bottom-panel-tab-active/);
        await expect(page.locator('.ai-terminal-panel')).toBeVisible();
        expect(await readTerminalRequestsAsync(page, 'terminal_ai_status_request')).toHaveLength(0);
        expect(await readTerminalRequestsAsync(page, 'terminal_ai_start_request')).toHaveLength(0);
        await page.getByRole('button', {name: 'AIを開始', exact: true}).click();
        await expect.poll(() => readTerminalRequestsAsync(page, 'terminal_ai_start_request')).toHaveLength(1);
    });

    for (const scenario of [{width: 400, theme: 'light', collapseSidebar: true}, {width: 800, theme: 'dark', collapseSidebar: false}]) {
        test(`未インストール画面を${scenario.width}pxの${scenario.theme}テーマ${scenario.collapseSidebar ? 'でサイドバーを閉じて' : 'で'}操作できる`, async ({page}) => {
            await page.setViewportSize({width: scenario.width, height: 600});
            await installMockApiAsync(page, createDefaultFileSystem());
            await installAiTerminalMockAsync(page, {installed: false, statusDelayMs: 0, startError: null, startDelayMs: 0});
            await page.goto('/');
            await expect(page.locator('.status-bar-ai')).toBeInViewport();
            await expect(page.locator('.status-bar-terminal')).toBeInViewport();
            if (scenario.collapseSidebar) {
                await page.locator('.activity-bar-item[data-panel="files"]').click();
                await expect(page.locator('#explorer')).toHaveClass(/sidebar-collapsed/);
            }
            await page.locator('.status-bar-ai').click();
            await page.evaluate(theme => document.body.setAttribute('data-theme', theme), scenario.theme);
            await expect(page.locator('body')).toHaveAttribute('data-theme', scenario.theme);
            const install = page.getByRole('button', {name: 'AIをインストール', exact: true});
            await expect(install).toBeVisible();
            await expect(page.locator('.ai-terminal-panel .xterm')).toBeVisible();
            const ai = await page.locator('.status-bar-ai').boundingBox();
            const terminal = await page.locator('.status-bar-terminal').boundingBox();
            const button = await install.boundingBox();
            const panel = await page.locator('.ai-terminal-panel').boundingBox();
            if (ai === null || terminal === null || button === null || panel === null) throw new Error('AI の操作領域がありません');
            expect(ai.x).toBeGreaterThanOrEqual(0);
            expect(ai.x + ai.width).toBeLessThanOrEqual(terminal.x);
            expect(terminal.x + terminal.width).toBeLessThanOrEqual(scenario.width);
            expect(button.x).toBeGreaterThanOrEqual(panel.x);
            expect(button.x + button.width).toBeLessThanOrEqual(Math.min(panel.x + panel.width, scenario.width));
            expect(button.y).toBeGreaterThanOrEqual(panel.y);
            expect(button.y + button.height).toBeLessThanOrEqual(panel.y + panel.height);
        });
    }

    test('通常幅のlightテーマでAIの出力と操作を表示できる', async ({page}) => {
        await page.setViewportSize({width: 1280, height: 720});
        await installMockApiAsync(page, createDefaultFileSystem());
        await installAiTerminalMockAsync(page, {installed: true, statusDelayMs: 0, startError: null, startDelayMs: 0});
        await page.goto('/');
        await page.locator('.status-bar-ai').click();
        await page.evaluate(() => document.body.setAttribute('data-theme', 'light'));
        await expect(page.locator('.ai-terminal-panel').getByRole('status')).toHaveText('実行中');
        const [ai] = await readTerminalRequestsAsync(page, 'terminal_ai_start_request');
        await dispatchTerminalEventAsync(page, {type: 'terminal_output', sessionId: ai.sessionId, data: 'Claude ready\r\n日本語の出力を確認\r\n'});
        await expect(page.locator('.ai-terminal-panel .xterm-rows')).toContainText('日本語の出力を確認');
        await expect(page.getByRole('button', {name: 'AIを終了', exact: true})).toBeVisible();
        await expect(page.locator('body')).toHaveAttribute('data-theme', 'light');
    });

    for (const installed of [false, true]) {
        test(`導入状態の確認待ち中に設定へ戻ったフォーカスを${installed ? '導入済み' : '未導入'}の応答後も維持する`, async ({page}) => {
            await installMockApiAsync(page, createDefaultFileSystem());
            await installAiTerminalMockAsync(page, {installed, statusDelayMs: 1500, startError: null, startDelayMs: 0});
            await page.goto('/');
            await page.locator('.activity-bar-settings').click();
            const setting = page.locator('.settings-export-begin-date-column-input');
            await page.locator('.status-bar-ai').click();
            await expect(page.locator('.ai-terminal-panel').getByRole('status')).toContainText('確認中');
            await setting.fill('user_is_typing');
            await expect(setting).toBeFocused();
            await expect(page.locator('.ai-terminal-panel').getByRole('status')).toHaveText(installed ? '実行中' : '未インストール');
            await expect(setting).toBeFocused();
            await expect(setting).toHaveValue('user_is_typing');
        });
    }

    test('信頼がない作業フォルダーではAIの確認とインストールと起動を禁止する', async ({page}) => {
        await installMockApiAsync(page, createDefaultFileSystem(), false);
        await installAiTerminalMockAsync(page, {installed: false, statusDelayMs: 0, startError: null, startDelayMs: 0});
        await page.goto('/');
        await page.locator('.status-bar-ai').click();
        await expect(page.locator('.ai-terminal-panel').getByRole('status')).toContainText('制限モード');
        await expect(page.getByRole('button', {name: 'AIを開始', exact: true})).toBeDisabled();
        for (const type of ['terminal_ai_status_request', 'terminal_ai_install_request', 'terminal_ai_start_request']) expect(await readTerminalRequestsAsync(page, type)).toHaveLength(0);
    });

    test('ページ離脱ではAIと通常端末の両方を回収する', async ({page}) => {
        await installMockApiAsync(page, createDefaultFileSystem());
        await installAiTerminalMockAsync(page, {installed: true, statusDelayMs: 0, startError: null, startDelayMs: 0});
        await page.goto('/');
        await page.locator('.status-bar-ai').click();
        await expect(page.locator('.ai-terminal-panel').getByRole('status')).toHaveText('実行中');
        await page.locator('.status-bar-terminal').click();
        await expect(page.locator('.terminal-status')).toHaveText('実行中');
        const [ai] = await readTerminalRequestsAsync(page, 'terminal_ai_start_request');
        const [shell] = await readTerminalRequestsAsync(page, 'terminal_start_request');
        await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
        const closes = await readTerminalRequestsAsync(page, 'terminal_close_request');
        expect(closes.map(request => request.sessionId).sort()).toEqual([ai.sessionId, shell.sessionId].sort());
    });
});
