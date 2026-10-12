import {test, expect} from './fixtures/test';
import type {Locator, Page} from '@playwright/test';
import {createDefaultFileSystem, installMockApiAsync} from './fixtures/mock-api';
import {installTerminalMockAsync, readTerminalRequestsAsync} from './fixtures/mock-terminal';

async function openTerminalWithViewAsync(page: Page): Promise<void> {
    await page.setViewportSize({width: 1280, height: 900});
    const fs = createDefaultFileSystem();
    fs['plugins/views/resize-test.js'] = `window.masterDataEditor.registerViewPlugin({
        id: 'resize-test', apiVersion: 2, title: 'Resize Test View',
        render(container) {
            const marker = document.createElement('h2');
            marker.textContent = 'ターミナルの上にある View';
            container.appendChild(marker);
        }
    });`;
    fs['user:ui-state.json'] = JSON.stringify({bottomPanel: {visible: false, height: 240, activeTab: 'terminal'}});
    await installMockApiAsync(page, fs, true);
    await installTerminalMockAsync(page, {startError: null, startDelayMs: 0});
    await page.goto('/');
    await page.locator('.activity-bar-item[data-panel="views"]').click();
    await page.locator('.view-plugin-item[data-plugin-id="resize-test"]').click();
    await expect(page.frameLocator('.view-plugin-tab-root[data-view-plugin-id="resize-test"] iframe').getByRole('heading', {name: 'ターミナルの上にある View'})).toBeVisible();
    await page.locator('.status-bar-terminal').click();
    await expect(page.locator('.terminal-status')).toContainText('実行中');
    await expect.poll(() => readTerminalRequestsAsync(page, 'terminal_start_request')).toHaveLength(1);
}

async function readHeightAsync(panel: Locator): Promise<number> {
    return panel.evaluate(element => element.getBoundingClientRect().height);
}

async function readHandleCenterAsync(page: Page): Promise<{x: number; y: number}> {
    const box = await page.locator('.bottom-panel > .resize-handle').boundingBox();
    if (box === null) throw new Error('ターミナルのリサイズハンドルがありません');
    return {x: box.x + box.width / 2, y: box.y + box.height / 2};
}

test.describe('ターミナルの高さドラッグ', () => {
    test('Viewのiframeを一度に越えて上下へ動かしても高さが追従し解放後は停止する', async ({page}) => {
        await openTerminalWithViewAsync(page);
        const panel = page.locator('.bottom-panel');
        const initialHeight = await readHeightAsync(panel);
        const start = await readHandleCenterAsync(page);
        // 小刻みな移動ではハンドル自身が追いつくため、iframe内へ一度に移動する。
        expect(await page.evaluate(({x, y}) => {
            const target = document.elementFromPoint(x, y - 120);
            return target === null ? null : target.tagName;
        }, start)).toBe('IFRAME');
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(start.x, start.y - 120);
        await expect.poll(() => readHeightAsync(panel)).toBe(initialHeight + 120);
        await page.mouse.move(start.x, start.y - 180);
        await expect.poll(() => readHeightAsync(panel)).toBe(initialHeight + 180);
        await page.mouse.move(start.x, start.y - 80);
        await expect.poll(() => readHeightAsync(panel)).toBe(initialHeight + 80);
        await page.mouse.up();

        await page.mouse.move(start.x, start.y + 40);
        await expect.poll(() => readHeightAsync(panel)).toBe(initialHeight + 80);
        await expect(page.locator('body')).not.toHaveCSS('cursor', 'row-resize');
        await expect(page.locator('body')).not.toHaveCSS('user-select', 'none');

        const next = await readHandleCenterAsync(page);
        await page.mouse.move(next.x, next.y);
        await page.mouse.down();
        await page.mouse.move(next.x, next.y - 60);
        await page.mouse.up();
        await expect.poll(() => readHeightAsync(panel)).toBe(initialHeight + 140);
        expect(await readTerminalRequestsAsync(page, 'terminal_start_request')).toHaveLength(1);
        expect(await readTerminalRequestsAsync(page, 'terminal_close_request')).toHaveLength(0);
    });

    test('Viewの上でボタンを離した後に戻っても押下状態が残らず再ドラッグできる', async ({page}) => {
        await openTerminalWithViewAsync(page);
        const panel = page.locator('.bottom-panel');
        const start = await readHandleCenterAsync(page);
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(start.x, start.y - 120);
        await page.mouse.up();
        const releasedHeight = await readHeightAsync(panel);

        // mouseupをiframe内で取り逃した場合、親documentへ戻るだけで高さが変わる。
        await page.mouse.move(start.x, start.y + 40);
        await expect.poll(() => readHeightAsync(panel)).toBe(releasedHeight);
        await expect(page.locator('body')).not.toHaveCSS('cursor', 'row-resize');
        const next = await readHandleCenterAsync(page);
        await page.mouse.move(next.x, next.y);
        await page.mouse.down();
        await page.mouse.move(next.x, next.y - 60);
        await page.mouse.up();
        await expect.poll(() => readHeightAsync(panel)).toBe(releasedHeight + 60);
    });

    test('ウィンドウがフォーカスを失ったらドラッグを終了して次の操作を受け付ける', async ({page}) => {
        await openTerminalWithViewAsync(page);
        const panel = page.locator('.bottom-panel');
        const start = await readHandleCenterAsync(page);
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(start.x, start.y + 30);
        const heightBeforeBlur = await readHeightAsync(panel);
        // 外部ウィンドウへ切り替わったときに親windowが受け取る終端通知を再現する。
        await page.evaluate(() => window.dispatchEvent(new Event('blur')));
        await page.mouse.move(start.x, start.y + 80);
        await expect.poll(() => readHeightAsync(panel)).toBe(heightBeforeBlur);
        await page.mouse.up();
        await expect(page.locator('body')).not.toHaveCSS('cursor', 'row-resize');
        await expect(page.locator('body')).not.toHaveCSS('user-select', 'none');

        const next = await readHandleCenterAsync(page);
        await page.mouse.move(next.x, next.y);
        await page.mouse.down();
        await page.mouse.move(next.x, next.y - 60);
        await page.mouse.up();
        await expect.poll(() => readHeightAsync(panel)).toBe(heightBeforeBlur + 60);
    });

    test('右ボタンの押下では高さのドラッグを開始しない', async ({page}) => {
        await openTerminalWithViewAsync(page);
        const panel = page.locator('.bottom-panel');
        const initialHeight = await readHeightAsync(panel);
        const start = await readHandleCenterAsync(page);
        await page.mouse.move(start.x, start.y);
        await page.mouse.down({button: 'right'});
        await page.mouse.move(start.x, start.y + 60);
        await page.mouse.up({button: 'right'});
        await expect.poll(() => readHeightAsync(panel)).toBe(initialHeight);
        await expect(page.locator('body')).not.toHaveCSS('cursor', 'row-resize');
    });
});
