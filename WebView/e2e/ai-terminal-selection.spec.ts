import {test, expect} from './fixtures/test';
import type {Page} from '@playwright/test';
import {createDefaultFileSystem, installMockApiAsync} from './fixtures/mock-api';
import {dispatchTerminalEventAsync, installAiTerminalMockAsync, readTerminalRequestsAsync} from './fixtures/mock-terminal';

type TerminalKind = 'ai' | 'terminal';

async function openTerminalAsync(page: Page, kind: TerminalKind): Promise<string> {
    await installMockApiAsync(page, createDefaultFileSystem());
    await installAiTerminalMockAsync(page, {installed: true, statusDelayMs: 0, startError: null, startDelayMs: 0});
    await page.goto('/');
    await page.locator(`.status-bar-${kind}`).click();
    await expect(page.locator(kind === 'ai' ? '.ai-terminal-status' : '.terminal-status')).toHaveText('実行中');
    const [request] = await readTerminalRequestsAsync(page, kind === 'ai' ? 'terminal_ai_start_request' : 'terminal_start_request');
    return request.sessionId;
}

async function writeOutputAsync(page: Page, sessionId: string, data: string): Promise<void> {
    const outputId = `selection-${crypto.randomUUID()}`;
    await dispatchTerminalEventAsync(page, {type: 'terminal_output', sessionId, outputId, data});
    await expect.poll(async () => (await readTerminalRequestsAsync(page, 'terminal_output_ack')).some(request => request.outputId === outputId)).toBe(true);
}

async function readInputAsync(page: Page): Promise<string> {
    return (await readTerminalRequestsAsync(page, 'terminal_input_request')).map(request => request.data).join('');
}

async function selectionCoordinatesAsync(page: Page, kind: TerminalKind): Promise<{start: {x: number; y: number}; end: {x: number; y: number}}> {
    const rows = page.locator(`${kind === 'ai' ? '.ai-terminal-panel' : '.terminal-panel'} .xterm-rows > div`);
    const first = await rows.nth(0).boundingBox();
    const second = await rows.nth(1).boundingBox();
    if (first === null || second === null) throw new Error('端末の選択対象行が表示されていません');
    return {start: {x: first.x + 1, y: first.y + first.height / 2}, end: {x: second.x + second.width / 2, y: second.y + second.height / 2}};
}

async function selectAndCopyAsync(page: Page, kind: TerminalKind, end: {x: number; y: number}, expectedText: string): Promise<void> {
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, {steps: 30});
    await page.mouse.up();
    // コピー前の小さなマウス移動でも、ANY追跡の報告によって選択を消さない。
    await page.mouse.move(end.x - 20, end.y);
    const selection = page.locator(`${kind === 'ai' ? '.ai-terminal-panel' : '.terminal-panel'} .xterm-selection > div`);
    await expect(selection.first()).toBeVisible();
    await page.keyboard.press('Control+c');
    await expect.poll(() => page.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, '\n'))).toBe(expectedText);
}

test.describe('AI端末のマウス選択とコピー', () => {
    // OSクリップボードを使うケース同士が上書きし合わないよう、このグループは順に実行する。
    test.describe.configure({mode: 'default'});
    test.use({permissions: ['clipboard-read', 'clipboard-write']});

    for (const mode of [9, 1000, 1002, 1003]) {
        test(`マウス追跡${mode}でも修飾キーなしで日本語の複数行をローカル選択してコピーする`, async ({page}) => {
            const sessionId = await openTerminalAsync(page, 'ai');
            await writeOutputAsync(page, sessionId, 'AIからの回答\r\n日本語をコピー\r\n');
            const {start, end} = await selectionCoordinatesAsync(page, 'ai');
            // モード有効化前に始点へ移し、ホバー報告と選択ドラッグの報告を区別する。
            await page.mouse.move(start.x, start.y);
            await writeOutputAsync(page, sessionId, `\u001b[?${mode};1006h`);
            await selectAndCopyAsync(page, 'ai', end, 'AIからの回答\n日本語をコピー');
            expect(await readTerminalRequestsAsync(page, 'terminal_input_request')).toHaveLength(0);
            await expect(page.locator('.ai-terminal-panel')).toBeVisible();
        });
    }

    for (const edge of ['右端', '下端']) {
        test(`ANY追跡で選択後に文字領域外の${edge}へ移動しても選択とコピーを維持する`, async ({page}) => {
            const sessionId = await openTerminalAsync(page, 'ai');
            await writeOutputAsync(page, sessionId, 'AIからの回答\r\n日本語をコピー\r\n');
            const {start, end} = await selectionCoordinatesAsync(page, 'ai');
            await page.mouse.move(start.x, start.y);
            await writeOutputAsync(page, sessionId, '\u001b[?1003;1006h');
            await selectAndCopyAsync(page, 'ai', end, 'AIからの回答\n日本語をコピー');
            const terminal = await page.locator('.ai-terminal-panel .xterm').boundingBox();
            const screen = await page.locator('.ai-terminal-panel .xterm-screen').boundingBox();
            if (terminal === null || screen === null) throw new Error('端末または文字領域が表示されていません');
            const point = edge === '右端'
                ? {x: (screen.x + screen.width + terminal.x + terminal.width) / 2, y: start.y}
                : {x: end.x, y: (screen.y + screen.height + terminal.y + terminal.height) / 2};
            // 実際に文字領域の外、かつANY追跡のイベントを受ける端末ルート内を通す。
            expect(await page.evaluate(({x, y}) => {
                const target = document.elementFromPoint(x, y);
                return target !== null && target.closest('.ai-terminal-panel .xterm') !== null && target.closest('.xterm-screen') === null;
            }, point)).toBe(true);
            await page.mouse.move(point.x, point.y);
            await expect(page.locator('.ai-terminal-panel .xterm-selection > div').first()).toBeVisible();
            await page.keyboard.press('Control+c');
            await expect.poll(() => page.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, '\n'))).toBe('AIからの回答\n日本語をコピー');
            expect(await readTerminalRequestsAsync(page, 'terminal_input_request')).toHaveLength(0);
        });
    }

    test('マウス追跡中に二度目の左ドラッグで以前の選択を置き換えられる', async ({page}) => {
        const sessionId = await openTerminalAsync(page, 'ai');
        await writeOutputAsync(page, sessionId, 'AIからの回答\r\n日本語をコピー\r\n');
        const {start, end} = await selectionCoordinatesAsync(page, 'ai');
        await page.mouse.move(start.x, start.y);
        await writeOutputAsync(page, sessionId, '\u001b[?1003;1006h');
        await selectAndCopyAsync(page, 'ai', end, 'AIからの回答\n日本語をコピー');
        await page.mouse.move(start.x, end.y);
        await selectAndCopyAsync(page, 'ai', end, '日本語をコピー');
        expect(await readTerminalRequestsAsync(page, 'terminal_input_request')).toHaveLength(0);
    });

    test('マウス追跡中の選択あり右クリックでもコピー対象を保持する', async ({page}) => {
        const sessionId = await openTerminalAsync(page, 'ai');
        await writeOutputAsync(page, sessionId, 'AIからの回答\r\n日本語をコピー\r\n');
        const {start, end} = await selectionCoordinatesAsync(page, 'ai');
        await page.mouse.move(start.x, start.y);
        await writeOutputAsync(page, sessionId, '\u001b[?1003;1006h');
        await selectAndCopyAsync(page, 'ai', end, 'AIからの回答\n日本語をコピー');
        await page.mouse.click(end.x, end.y, {button: 'right'});
        await expect(page.locator('.ai-terminal-panel .xterm-selection > div').first()).toBeVisible();
        // xtermがネイティブメニューのコピー先に置く文字列も空になっていないことを確認する。
        await expect(page.locator('.ai-terminal-panel .xterm-helper-textarea')).toHaveValue('AIからの回答\n日本語をコピー');
        expect(await readTerminalRequestsAsync(page, 'terminal_input_request')).toHaveLength(0);
    });

    test('マウス追跡中でも選択がなければCtrl+CをAIの中断として送信する', async ({page}) => {
        const sessionId = await openTerminalAsync(page, 'ai');
        await writeOutputAsync(page, sessionId, '\u001b[?1002;1006hAI待機中\r\n');
        await page.keyboard.press('Control+c');
        await expect.poll(() => readInputAsync(page)).toBe('\u0003');
        await expect(page.locator('.ai-terminal-panel')).toBeVisible();
    });

    test('通常端末も日本語の複数行を選択してCtrl+Cでコピーする', async ({page}) => {
        const sessionId = await openTerminalAsync(page, 'terminal');
        await writeOutputAsync(page, sessionId, 'AIからの回答\r\n日本語をコピー\r\n');
        const {start, end} = await selectionCoordinatesAsync(page, 'terminal');
        await page.mouse.move(start.x, start.y);
        await selectAndCopyAsync(page, 'terminal', end, 'AIからの回答\n日本語をコピー');
        expect(await readTerminalRequestsAsync(page, 'terminal_input_request')).toHaveLength(0);
    });

    test('分割された複合CSIの代替画面とbracketed pasteを選択操作後も維持する', async ({page}) => {
        const sessionId = await openTerminalAsync(page, 'ai');
        await writeOutputAsync(page, sessionId, '通常画面の履歴\r\n');
        const {start, end} = await selectionCoordinatesAsync(page, 'ai');
        await page.mouse.move(start.x, start.y);
        await writeOutputAsync(page, sessionId, '\u001b[?1002;1006;10');
        await writeOutputAsync(page, sessionId, '49;2004h\u001b[HAIからの回答\r\n日本語をコピー\r\n');
        const rows = page.locator('.ai-terminal-panel .xterm-rows');
        await expect(rows).not.toContainText('通常画面の履歴');
        await selectAndCopyAsync(page, 'ai', end, 'AIからの回答\n日本語をコピー');
        expect(await readTerminalRequestsAsync(page, 'terminal_input_request')).toHaveLength(0);
        await page.locator('.ai-terminal-panel .xterm-helper-textarea').evaluate(element => {
            const clipboardData = new DataTransfer();
            clipboardData.setData('text/plain', '貼り付け');
            element.dispatchEvent(new ClipboardEvent('paste', {clipboardData, bubbles: true, cancelable: true}));
        });
        await expect.poll(() => readInputAsync(page)).toBe('\u001b[200~貼り付け\u001b[201~');
        await writeOutputAsync(page, sessionId, '\u001b[?1049l');
        await expect(rows).toContainText('通常画面の履歴');
        await expect(rows).not.toContainText('AIからの回答');
    });

    test('AIのホイール操作はTUIへ送信してスクロールを維持する', async ({page}) => {
        const sessionId = await openTerminalAsync(page, 'ai');
        await writeOutputAsync(page, sessionId, 'スクロール対象\r\n');
        const {start} = await selectionCoordinatesAsync(page, 'ai');
        await page.mouse.move(start.x, start.y);
        await writeOutputAsync(page, sessionId, '\u001b[?1002;1006h');
        await page.mouse.wheel(0, 120);
        await expect.poll(() => readInputAsync(page)).toMatch(/^\u001b\[<65;\d+;\d+M/);
    });

    test('通常端末ではTUIが要求した左マウス入力を従来どおり送信する', async ({page}) => {
        const sessionId = await openTerminalAsync(page, 'terminal');
        await writeOutputAsync(page, sessionId, '通常端末のTUI\r\n');
        const {start} = await selectionCoordinatesAsync(page, 'terminal');
        await page.mouse.move(start.x, start.y);
        await writeOutputAsync(page, sessionId, '\u001b[?1002;1006h');
        await page.mouse.down();
        await page.mouse.up();
        await expect.poll(() => readInputAsync(page)).toMatch(/^\u001b\[<0;\d+;\d+M\u001b\[<0;\d+;\d+m$/);
    });
});
