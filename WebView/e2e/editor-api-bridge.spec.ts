import { test, expect } from './fixtures/test';
import type { Page, Locator } from '@playwright/test';

// =============================================================================
// ヘルパー関数
// =============================================================================

/** エクスプローラーからテーブルを開き、左ペインの EditorTable を返す */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
    const table = page.locator('.editor-left-pane .editor-table');
    await expect(table).toBeVisible();
    return table;
}

/** ブリッジの dispose() を呼び出してリスナーを解除する */
async function disposeBridgeAsync(page: Page): Promise<void> {
    await page.evaluate(() => {
        (window as unknown as { __editorApiBridge: { dispose(): void } }).__editorApiBridge.dispose();
    });
}

/**
 * ブリッジ経由でリクエストを送信し、レスポンスを受け取る。
 * タイムアウト内にレスポンスが来なければ null を返す。
 */
async function sendBridgeRequestAsync(
    page: Page,
    requestId: string,
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
): Promise<Record<string, unknown> | null> {
    return page.evaluate(({ requestId, method, params, timeoutMs }) => {
        return new Promise<Record<string, unknown> | null>((resolve) => {
            let resolved = false;
            const handler = (event: MessageEvent) => {
                let data: Record<string, unknown>;
                try {
                    data = JSON.parse(event.data as string) as Record<string, unknown>;
                } catch {
                    return;
                }
                if (data['type'] !== 'editor_api_response') return;
                if (data['requestId'] !== requestId) return;
                resolved = true;
                window.chrome.webview.removeEventListener('message', handler);
                resolve(data);
            };
            window.chrome.webview.addEventListener('message', handler);
            // ブリッジにリクエストを送信する
            window.chrome.webview.postMessage(JSON.stringify({
                type: 'editor_api_request',
                requestId,
                method,
                params,
            }));
            // タイムアウト: レスポンスが来なければ null を返す
            setTimeout(() => {
                if (!resolved) {
                    window.chrome.webview.removeEventListener('message', handler);
                    resolve(null);
                }
            }, timeoutMs);
        });
    }, { requestId, method, params, timeoutMs });
}

// =============================================================================
// EditorApiBridge ライフサイクル管理
// =============================================================================

test.describe('EditorApiBridge ライフサイクル', () => {
    test('dispose 後はメッセージが処理されない', async ({ mockFileSystem, page }) => {
        // テーブルを開いてストアにデータを登録する
        await openTableAsync(page, 'test');

        // dispose 前: ブリッジ経由でリクエストが処理されることを確認する
        const beforeDispose = await sendBridgeRequestAsync(
            page, 'before-dispose-1', 'data.getTableNames', {}, 3000,
        );
        expect(beforeDispose).not.toBeNull();
        expect((beforeDispose as Record<string, unknown>)['success']).toBe(true);

        // ブリッジの dispose() を呼び出してリスナーを解除する
        await disposeBridgeAsync(page);

        // dispose 後: リクエストを送信してもレスポンスが返らないことを確認する
        const afterDispose = await sendBridgeRequestAsync(
            page, 'after-dispose-1', 'data.getTableNames', {}, 1000,
        );
        expect(afterDispose).toBeNull();
    });

    test('dispose を2回呼ぶとエラーがスローされる', async ({ mockFileSystem, page }) => {
        // ブリッジはコンストラクタでリスナー登録済み。1回目の dispose は成功する。
        await disposeBridgeAsync(page);

        // 2回目の dispose がエラーをスローすることを検証する
        const threw = await page.evaluate(() => {
            try {
                (window as unknown as { __editorApiBridge: { dispose(): void } }).__editorApiBridge.dispose();
                return false;
            } catch {
                return true;
            }
        });
        expect(threw).toBe(true);
    });
});
