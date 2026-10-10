import {test, expect} from './fixtures/test';
import type {Page} from '@playwright/test';
import {createDefaultFileSystem, installMockApiAsync} from './fixtures/mock-api';
import {clearTerminalStartErrorAsync, configureTerminalCloseExitAsync, dispatchTerminalEventAsync, installTerminalMockAsync, readTerminalRequestsAsync} from './fixtures/mock-terminal';

async function openTerminalAsync(page: Page): Promise<string> {
    await installMockApiAsync(page, createDefaultFileSystem());
    await installTerminalMockAsync(page, {startError: null, startDelayMs: 0});
    await page.goto('/');
    await page.locator('.status-bar-terminal').click();
    await expect.poll(() => readTerminalRequestsAsync(page, 'terminal_start_request')).toHaveLength(1);
    await expect(page.locator('.terminal-status')).toContainText('実行中');
    await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
    const [request] = await readTerminalRequestsAsync(page, 'terminal_start_request');
    return request.sessionId;
}

async function readTerminalInputAsync(page: Page): Promise<string> {
    const requests = await readTerminalRequestsAsync(page, 'terminal_input_request');
    return requests.map(request => request.data).join('');
}

test.describe('ターミナル', () => {
    test('明示操作でターミナルを開くとPowerShellを一度起動して入力へフォーカスする', async ({page}) => {
        await installMockApiAsync(page, createDefaultFileSystem());
        await installTerminalMockAsync(page, {startError: null, startDelayMs: 0});
        await page.goto('/');
        await expect(page.locator('#explorer .explorer-file-name', {hasText: 'test'})).toBeVisible();
        expect(await readTerminalRequestsAsync(page, 'terminal_start_request')).toHaveLength(0);

        await page.locator('.status-bar-terminal').click();

        await expect(page.locator('.bottom-panel-tab', {hasText: 'TERMINAL'})).toHaveClass(/bottom-panel-tab-active/);
        await expect(page.locator('.terminal-panel .xterm')).toBeVisible();
        await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
        await expect.poll(() => readTerminalRequestsAsync(page, 'terminal_start_request')).toHaveLength(1);
        const [request] = await readTerminalRequestsAsync(page, 'terminal_start_request');
        expect(request.sessionId).toEqual(expect.any(String));
        expect(request.sessionId.length).toBeGreaterThan(0);
        expect(request.cols).toBeGreaterThan(0);
        expect(request.rows).toBeGreaterThan(0);
        await page.locator('.bottom-panel-tab', {hasText: 'TERMINAL'}).click();
        expect(await readTerminalRequestsAsync(page, 'terminal_start_request')).toHaveLength(1);
    });

    test('ANSI色と日本語を描画してキー入力と日本語貼付けを同じセッションへ送る', async ({page}) => {
        const sessionId = await openTerminalAsync(page);
        await dispatchTerminalEventAsync(page, {type: 'terminal_output', sessionId, data: '\u001b[31mRED\u001b[0m 日本語の出力\r\nPS> '});
        const rows = page.locator('.terminal-panel .xterm-rows');
        await expect(rows).toContainText('RED 日本語の出力');
        await expect(rows.locator('.xterm-fg-1').first()).toBeVisible();

        await page.keyboard.type('echo hello');
        await page.keyboard.press('Enter');
        await page.locator('.xterm-helper-textarea').evaluate(element => {
            const clipboardData = new DataTransfer();
            clipboardData.setData('text/plain', '日本語');
            element.dispatchEvent(new ClipboardEvent('paste', {clipboardData, bubbles: true, cancelable: true}));
        });
        await expect.poll(() => readTerminalInputAsync(page)).toBe('echo hello\r日本語');
        const requests = await readTerminalRequestsAsync(page, 'terminal_input_request');
        expect(requests.every(request => request.sessionId === sessionId)).toBe(true);
    });

    test('端末出力を描画後に確認応答し非表示中も同じセッションへ返す', async ({page}) => {
        const sessionId = await openTerminalAsync(page);
        await dispatchTerminalEventAsync(page, {type: 'terminal_output', sessionId, outputId: 'output-1', data: '受信確認\r\n'});
        await expect.poll(() => readTerminalRequestsAsync(page, 'terminal_output_ack')).toEqual([{type: 'terminal_output_ack', sessionId, outputId: 'output-1'}]);
        await expect(page.locator('.xterm-rows')).toContainText('受信確認');
        await page.getByRole('button', {name: 'パネルを閉じる', exact: true}).click();
        await dispatchTerminalEventAsync(page, {type: 'terminal_output', sessionId, outputId: 'output-2', data: '非表示中の受信確認\r\n'});
        await expect.poll(() => readTerminalRequestsAsync(page, 'terminal_output_ack')).toEqual([
            {type: 'terminal_output_ack', sessionId, outputId: 'output-1'},
            {type: 'terminal_output_ack', sessionId, outputId: 'output-2'},
        ]);
        await page.locator('.status-bar-terminal').click();
        await expect(page.locator('.xterm-rows')).toContainText('非表示中の受信確認');
    });

    test('終了応答より後から届く実際の終了コードを表示する', async ({page}) => {
        await openTerminalAsync(page);
        await configureTerminalCloseExitAsync(page, 7);
        await page.getByRole('button', {name: 'ターミナルを終了', exact: true}).click();
        await expect(page.locator('.terminal-status')).toHaveText('終了（コード 7）');
        await expect(page.getByRole('button', {name: 'ターミナルを再起動', exact: true})).toBeVisible();
        await page.keyboard.type('not-sent');
        expect(await readTerminalInputAsync(page)).toBe('');
    });

    test('描画の確認応答に失敗したら通知してセッションを終了する', async ({page}) => {
        const sessionId = await openTerminalAsync(page);
        await page.evaluate(() => {
            const postMessage = window.chrome.webview.postMessage.bind(window.chrome.webview);
            window.chrome.webview.postMessage = message => {
                const payload = JSON.parse(message) as {type: string};
                if (payload.type === 'terminal_output_ack') throw new Error('端末出力の確認応答を送信できません');
                postMessage(message);
            };
        });
        await dispatchTerminalEventAsync(page, {type: 'terminal_output', sessionId, outputId: 'output-failed', data: '受信済み\r\n'});
        await expect(page.locator('.notification-toast-error')).toContainText('端末出力の確認応答を送信できません');
        await expect.poll(() => readTerminalRequestsAsync(page, 'terminal_close_request')).toHaveLength(1);
        const [close] = await readTerminalRequestsAsync(page, 'terminal_close_request');
        expect(close.sessionId).toBe(sessionId);
        await expect(page.getByRole('button', {name: 'ターミナルを再起動', exact: true})).toBeVisible();
    });

    test('パネルを閉じて再表示してもシェルと非表示中の出力を保持する', async ({page}) => {
        const sessionId = await openTerminalAsync(page);
        await page.getByRole('button', {name: 'パネルを閉じる', exact: true}).click();
        await expect(page.locator('.bottom-panel')).toBeHidden();
        expect(await readTerminalRequestsAsync(page, 'terminal_close_request')).toHaveLength(0);
        await dispatchTerminalEventAsync(page, {type: 'terminal_output', sessionId, data: 'バックグラウンド完了\r\n'});

        await page.keyboard.press('Control+Backquote');
        await expect(page.locator('.terminal-panel')).toBeVisible();
        await expect(page.locator('.xterm-rows')).toContainText('バックグラウンド完了');
        await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
        expect(await readTerminalRequestsAsync(page, 'terminal_start_request')).toHaveLength(1);
        await page.locator('.bottom-panel-tab', {hasText: 'PROBLEMS'}).click();
        await expect(page.locator('.xterm-helper-textarea')).not.toBeFocused();
        await page.locator('.bottom-panel-tab', {hasText: 'TERMINAL'}).click();
        await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
        await page.keyboard.press('Control+Backquote');
        await expect(page.locator('.bottom-panel')).toBeHidden();
        expect(await readTerminalRequestsAsync(page, 'terminal_close_request')).toHaveLength(0);
    });

    test('グリッドからショートカットで開閉すると元の入力へフォーカスを戻す', async ({page}) => {
        await installMockApiAsync(page, createDefaultFileSystem());
        await installTerminalMockAsync(page, {startError: null, startDelayMs: 0});
        await page.goto('/');
        await page.locator('#explorer .explorer-file-name', {hasText: 'test'}).click();
        await page.locator('.editor-left-pane .editor-table-row[data-row-index="0"] .editor-table-cell[data-col="1"]').click();
        await expect(page.locator('.grid-textfield')).toBeFocused();
        await page.keyboard.press('Control+Backquote');
        await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
        await page.keyboard.press('Control+Backquote');
        await expect(page.locator('.bottom-panel')).toBeHidden();
        await expect(page.locator('.grid-textfield')).toBeFocused();
    });

    test('明示終了後に別セッションで再起動し旧セッションの出力と終了通知を無視する', async ({page}) => {
        const previousSessionId = await openTerminalAsync(page);
        await page.getByRole('button', {name: 'ターミナルを終了', exact: true}).click();
        await expect.poll(() => readTerminalRequestsAsync(page, 'terminal_close_request')).toHaveLength(1);
        await expect(page.locator('.terminal-status')).toContainText('終了');
        await page.getByRole('button', {name: 'ターミナルを再起動', exact: true}).click();
        await expect.poll(() => readTerminalRequestsAsync(page, 'terminal_start_request')).toHaveLength(2);
        const requests = await readTerminalRequestsAsync(page, 'terminal_start_request');
        const sessionId = requests[1].sessionId;
        expect(sessionId).not.toBe(previousSessionId);
        await dispatchTerminalEventAsync(page, {type: 'terminal_output', sessionId: previousSessionId, data: 'STALE_OUTPUT\r\n'});
        await dispatchTerminalEventAsync(page, {type: 'terminal_exit', sessionId: previousSessionId, exitCode: 123});
        await dispatchTerminalEventAsync(page, {type: 'terminal_output', sessionId, data: 'CURRENT_OUTPUT\r\n'});
        await expect(page.locator('.xterm-rows')).toContainText('CURRENT_OUTPUT');
        await expect(page.locator('.xterm-rows')).not.toContainText('STALE_OUTPUT');
        await expect(page.locator('.terminal-status')).toContainText('実行中');
        await page.keyboard.type('x');
        await expect.poll(() => readTerminalInputAsync(page)).toBe('x');
    });

    test('起動失敗は汎用通知に表示して再試行で起動できる', async ({page}) => {
        await installMockApiAsync(page, createDefaultFileSystem());
        await installTerminalMockAsync(page, {startError: 'ConPTYを開始できません', startDelayMs: 0});
        await page.goto('/');
        await page.locator('.status-bar-terminal').click();
        await expect(page.locator('.notification-toast-error')).toContainText('ConPTYを開始できません');
        await expect(page.locator('.terminal-panel')).not.toContainText('ConPTYを開始できません');
        await page.locator('.bottom-panel-tab', {hasText: 'DEBUG CONSOLE'}).click();
        await page.locator('.debug-console-row-error', {hasText: 'ConPTYを開始できません'}).click();
        await expect(page.locator('.debug-api-detail-stack-trace .debug-api-detail-code')).toHaveText('at MockTerminal.Start()');
        await page.locator('.bottom-panel-tab', {hasText: 'TERMINAL'}).click();
        await clearTerminalStartErrorAsync(page);
        await page.getByRole('button', {name: 'ターミナルを再起動', exact: true}).click();
        await expect.poll(() => readTerminalRequestsAsync(page, 'terminal_start_request')).toHaveLength(2);
        await expect(page.locator('.terminal-status')).toContainText('実行中');
        await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
    });

    test('パネルの高さとウィンドウ幅の変更を行列数としてC#に通知する', async ({page}) => {
        await openTerminalAsync(page);
        const [start] = await readTerminalRequestsAsync(page, 'terminal_start_request');
        const handle = await page.locator('.bottom-panel > .resize-handle').boundingBox();
        if (handle === null) throw new Error('リサイズハンドルがありません');
        await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
        await page.mouse.down();
        await page.mouse.move(handle.x + handle.width / 2, handle.y - 120, {steps: 5});
        await page.mouse.up();
        await expect.poll(async () => {
            const requests = await readTerminalRequestsAsync(page, 'terminal_resize_request');
            return requests.some(request => typeof request.rows === 'number' && typeof start.rows === 'number' && request.rows > start.rows);
        }).toBe(true);
        await page.setViewportSize({width: 1000, height: 720});
        await expect.poll(async () => {
            const requests = await readTerminalRequestsAsync(page, 'terminal_resize_request');
            return requests.some(request => typeof request.cols === 'number' && typeof start.cols === 'number' && request.cols < start.cols);
        }).toBe(true);
        const requests = await readTerminalRequestsAsync(page, 'terminal_resize_request');
        expect(requests.every(request => request.sessionId === start.sessionId && Number(request.cols) > 0 && Number(request.rows) > 0)).toBe(true);
    });

    test('ターミナルの制御キーはエディタの保存検索コマンドを起動しない', async ({page}) => {
        await openTerminalAsync(page);
        for (const key of ['c', 's', 'f', 'h', 'p', 'z']) await page.keyboard.press(`Control+${key}`);
        await expect.poll(() => readTerminalInputAsync(page)).toBe('\u0003\u0013\u0006\u0008\u0010\u001a');
        await expect(page.locator('.command-palette-overlay')).not.toHaveClass(/visible/);
        await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
        const workspaceWrites = await page.evaluate(() => {
            const requests = (window as unknown as {__mockApiRequestDetails: Array<{type: string; scope: string | null}>}).__mockApiRequestDetails;
            return requests.filter(request => request.type === 'write_file_request' && request.scope !== 'user');
        });
        expect(workspaceWrites).toHaveLength(0);
    });

    test('設定タブが表示中でも端末のCtrl+ZとCtrl+Sで設定を変更保存しない', async ({page}) => {
        await openTerminalAsync(page);
        await page.locator('.activity-bar-settings').click();
        const setting = page.locator('.settings-export-begin-date-column-input');
        await setting.fill('start_at');
        await setting.blur();
        await expect.poll(() => page.evaluate(() => {
            const fs = (window as unknown as {__mockFs: Record<string, string>}).__mockFs;
            return fs['.masterdataeditor/settings.json'];
        })).toContain('start_at');
        const savedBefore = await page.evaluate(() => (window as unknown as {__mockFs: Record<string, string>}).__mockFs['.masterdataeditor/settings.json']);
        await page.locator('.bottom-panel-tab', {hasText: 'TERMINAL'}).click();
        await page.keyboard.press('Control+z');
        await page.keyboard.press('Control+s');
        await expect.poll(() => readTerminalInputAsync(page)).toBe('\u001a\u0013');
        await expect(setting).toHaveValue('start_at');
        expect(await page.evaluate(() => (window as unknown as {__mockFs: Record<string, string>}).__mockFs['.masterdataeditor/settings.json'])).toBe(savedBefore);
    });

    test('起動中の再選択では重複起動せず端末の自動応答をシェルへ返す', async ({page}) => {
        await installMockApiAsync(page, createDefaultFileSystem());
        await installTerminalMockAsync(page, {startError: null, startDelayMs: 1500});
        await page.goto('/');
        await page.locator('.status-bar-terminal').click();
        await expect(page.locator('.terminal-status')).toContainText('起動中');
        await expect.poll(() => readTerminalRequestsAsync(page, 'terminal_start_request')).toHaveLength(1);
        const [request] = await readTerminalRequestsAsync(page, 'terminal_start_request');
        await page.locator('.bottom-panel-tab', {hasText: 'TERMINAL'}).click();
        await page.keyboard.type('must-not-run');
        await dispatchTerminalEventAsync(page, {type: 'terminal_output', sessionId: request.sessionId, data: '\u001b[6n'});
        await expect.poll(() => readTerminalInputAsync(page)).toMatch(/^\u001b\[\d+;\d+R$/);
        await expect(page.locator('.terminal-status')).toContainText('実行中');
        expect(await readTerminalRequestsAsync(page, 'terminal_start_request')).toHaveLength(1);
    });

    test('シェルが自然終了したら出力と終了コードを残し入力を送らない', async ({page}) => {
        const sessionId = await openTerminalAsync(page);
        await dispatchTerminalEventAsync(page, {type: 'terminal_output', sessionId, data: '実行が完了しました\r\n'});
        await dispatchTerminalEventAsync(page, {type: 'terminal_exit', sessionId, exitCode: 7});
        await expect(page.locator('.terminal-status')).toContainText('7');
        await expect(page.locator('.xterm-rows')).toContainText('実行が完了しました');
        await page.keyboard.type('not-sent');
        expect(await readTerminalInputAsync(page)).toBe('');
        await expect(page.getByRole('button', {name: 'ターミナルを再起動', exact: true})).toBeVisible();
        expect(await readTerminalRequestsAsync(page, 'terminal_close_request')).toHaveLength(0);
    });

    test('大きい貼付けはサロゲートペアを壊さず上限内に分割して送信する', async ({page}) => {
        await openTerminalAsync(page);
        const pasted = 'a'.repeat(16383) + '😀' + '日本語'.repeat(6000);
        await page.locator('.xterm-helper-textarea').evaluate((element, value) => {
            const clipboardData = new DataTransfer();
            clipboardData.setData('text/plain', value);
            element.dispatchEvent(new ClipboardEvent('paste', {clipboardData, bubbles: true, cancelable: true}));
        }, pasted);
        await expect.poll(() => readTerminalInputAsync(page)).toBe(pasted);
        const requests = await readTerminalRequestsAsync(page, 'terminal_input_request');
        expect(requests.length).toBeGreaterThan(1);
        for (const request of requests) {
            expect(typeof request.data).toBe('string');
            const data = request.data as string;
            expect(data.length).toBeLessThanOrEqual(16384);
            expect(data.isWellFormed()).toBe(true);
        }
    });

    test('起動タイムアウトではセッションを回収して遅延成功を無視する', async ({page}) => {
        await installMockApiAsync(page, createDefaultFileSystem());
        await installTerminalMockAsync(page, {startError: null, startDelayMs: 20000});
        await page.goto('/');
        await expect(page.locator('#explorer .explorer-file-name', {hasText: 'test'})).toBeVisible();
        await page.clock.install();
        await page.locator('.status-bar-terminal').click();
        await page.clock.runFor(10);
        const [request] = await readTerminalRequestsAsync(page, 'terminal_start_request');
        await page.clock.fastForward(10000);
        await page.clock.runFor(10);
        await expect(page.locator('.notification-toast-error')).toContainText('タイムアウト');
        const closes = await readTerminalRequestsAsync(page, 'terminal_close_request');
        expect(closes).toHaveLength(1);
        expect(closes[0].sessionId).toBe(request.sessionId);
        await page.clock.fastForward(11000);
        await expect(page.getByRole('button', {name: 'ターミナルを再起動', exact: true})).toBeVisible();
        await expect(page.locator('.terminal-status')).not.toContainText('実行中');
        expect(await readTerminalRequestsAsync(page, 'terminal_start_request')).toHaveLength(1);
    });

    test('保存されたターミナル表示を復元してもユーザーの開始操作まで起動しない', async ({page}) => {
        const fs = createDefaultFileSystem();
        fs['user:ui-state.json'] = JSON.stringify({bottomPanel: {visible: true, height: 360, activeTab: 'terminal'}});
        await installMockApiAsync(page, fs);
        await installTerminalMockAsync(page, {startError: null, startDelayMs: 0});
        await page.goto('/');
        await expect(page.locator('#explorer .explorer-file-name', {hasText: 'test'})).toBeVisible();
        await expect(page.locator('.bottom-panel-tab', {hasText: 'TERMINAL'})).toHaveClass(/bottom-panel-tab-active/);
        expect(await readTerminalRequestsAsync(page, 'terminal_start_request')).toHaveLength(0);
        await page.getByRole('button', {name: 'ターミナルを開始', exact: true}).click();
        await expect.poll(() => readTerminalRequestsAsync(page, 'terminal_start_request')).toHaveLength(1);
        await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
    });

    test('テーマ変更時にターミナル背景と通常文字の色が追従する', async ({page}) => {
        const sessionId = await openTerminalAsync(page);
        await page.evaluate(() => document.body.setAttribute('data-theme', 'dark'));
        await dispatchTerminalEventAsync(page, {type: 'terminal_output', sessionId, data: 'テーマ確認\r\n'});
        const xterm = page.locator('.terminal-panel .xterm');
        await expect(page.locator('.xterm-rows')).toContainText('テーマ確認');
        const darkColor = await xterm.evaluate(element => ({background: getComputedStyle(element).backgroundColor, foreground: getComputedStyle(element).color}));
        const viewport = page.locator('.terminal-panel .xterm-viewport');
        await expect(viewport).toHaveCSS('background-color', darkColor.background);
        await page.evaluate(() => document.body.removeAttribute('data-theme'));
        await expect.poll(() => xterm.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(darkColor.background);
        await expect.poll(() => xterm.evaluate(element => getComputedStyle(element).color)).not.toBe(darkColor.foreground);
        await expect(viewport).toHaveCSS('background-color', await xterm.evaluate(element => getComputedStyle(element).backgroundColor));
    });
});
