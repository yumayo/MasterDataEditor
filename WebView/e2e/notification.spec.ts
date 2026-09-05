import { test, expect } from './fixtures/test';
import type { Page } from '@playwright/test';

// =============================================================================
// FEAT_0045: システムエラー通知ポップアップ
//
// 機能概要:
//   window.notification.show(message) でトーストポップアップを右下に表示する。
//   最大3つまでスタック可能で、4つ目を追加すると最も古いものが消える。
//   show() 呼び出し時に DEBUG CONSOLE にもエントリを追加する。
//   旧仕様のベルマーク・履歴パネル・メッセージ欄は廃止。
//
// テスト対象:
//   WebView/src/ui/notification.ts — NotificationToast クラス
//   WebView/src/ui/status-bar.ts  — StatusBar クラス
//   WebView/src/panels/debug-console.ts — DebugConsole クラス
//   WebView/src/ui/notification.css — スタイル
// =============================================================================

/** window.notification.show() を呼び出すヘルパー */
async function showNotificationAsync(page: Page, message: string, status?: 'success' | 'error'): Promise<void> {
    await page.evaluate(({msg, nextStatus}) => {
        const n = (window as unknown as Record<string, { show(m: string, s?: 'success' | 'error'): void }>)['notification'];
        n.show(msg, nextStatus);
    }, {msg: message, nextStatus: status});
}

test.describe('Notification', () => {

    // -------------------------------------------------------------------------
    // 既存仕様の維持: トーストポップアップ
    // -------------------------------------------------------------------------

    test('エラー通知を表示するとトーストポップアップが表示される', async ({ page, mockFileSystem }) => {
        await showNotificationAsync(page, 'テストエラー');

        // .notification-toast 要素が表示されること
        const toast = page.locator('.notification-toast').first();
        await expect(toast).toBeVisible();
        await expect(toast).toContainText('テストエラー');
    });

    test('通知は最大3つまでスタックし4つ目を追加すると最古が消える', async ({ page, mockFileSystem }) => {
        await showNotificationAsync(page, '通知1');
        await showNotificationAsync(page, '通知2');
        await showNotificationAsync(page, '通知3');
        await showNotificationAsync(page, '通知4');

        // .notification-toast が3つ以下であること
        const toasts = page.locator('.notification-toast');
        const count = await toasts.count();
        expect(count).toBeLessThanOrEqual(3);

        // 最古の「通知1」は消えていること
        await expect(page.locator('.notification-toast', { hasText: '通知1' })).toHaveCount(0);
        // 最新の「通知4」は存在すること
        await expect(page.locator('.notification-toast', { hasText: '通知4' })).toHaveCount(1);
    });

    test('トーストエリアがステータスバーの上方に表示される', async ({ page, mockFileSystem }) => {
        await showNotificationAsync(page, '位置確認トースト');

        const toastArea = page.locator('.notification-toast-area');
        await expect(toastArea).toBeVisible();

        // トーストエリアの bottom がステータスバーの top 以下であること
        const toastAreaBox = await toastArea.boundingBox();
        const statusBarBox = await page.locator('.status-bar').boundingBox();
        expect(toastAreaBox).not.toBeNull();
        expect(statusBarBox).not.toBeNull();
        const toastAreaBottom = (toastAreaBox as NonNullable<typeof toastAreaBox>).y
            + (toastAreaBox as NonNullable<typeof toastAreaBox>).height;
        const statusBarTop = (statusBarBox as NonNullable<typeof statusBarBox>).y;
        // border-top 1px のサブピクセル誤差を許容するため 2px のマージンを設ける
        expect(toastAreaBottom).toBeLessThanOrEqual(statusBarTop + 2);
    });

    test('バックグラウンド処理インジケーター表示時もトーストの右端位置がずれない', async ({ page, mockFileSystem }) => {
        await showNotificationAsync(page, '右端固定トースト');

        const toast = page.locator('.notification-toast', { hasText: '右端固定トースト' });
        await expect(toast).toBeVisible();
        const beforeBox = await toast.boundingBox();
        expect(beforeBox).not.toBeNull();

        await page.evaluate(() => {
            const indicator = document.querySelector<HTMLElement>('.status-bar-background-indicator');
            const count = document.querySelector<HTMLElement>('.status-bar-background-count');
            if (indicator === null || count === null) throw new Error('バックグラウンド処理インジケーターが見つかりません');
            count.textContent = '1';
            indicator.style.display = '';
        });
        await expect(page.locator('.status-bar-background-indicator')).toBeVisible();

        const afterBox = await toast.boundingBox();
        expect(afterBox).not.toBeNull();
        const beforeRight = (beforeBox as NonNullable<typeof beforeBox>).x + (beforeBox as NonNullable<typeof beforeBox>).width;
        const afterRight = (afterBox as NonNullable<typeof afterBox>).x + (afterBox as NonNullable<typeof afterBox>).width;
        expect(Math.abs(afterRight - beforeRight)).toBeLessThanOrEqual(1);
    });

    // -------------------------------------------------------------------------
    // 新仕様: DEBUG CONSOLE への記録
    // -------------------------------------------------------------------------

    test('show()を呼ぶとDEBUG CONSOLEにエントリが追加される', async ({ page, mockFileSystem }) => {
        await showNotificationAsync(page, 'デバッグログ確認');

        // バックグラウンドバリデーション等で後続エントリが追加される可能性があるため、
        // 「最後のエントリ」ではなく「指定テキストを含むエントリ」で特定する
        const logEntry = page.locator('.debug-console-list .debug-console-row', {
            has: page.locator('.debug-console-col-label', { hasText: 'デバッグログ確認' }),
        });
        await expect(logEntry).toBeAttached();

        // 結果列に「✗」（エラー扱い）が表示されること
        const statusCell = logEntry.locator('.debug-console-col-status');
        await expect(statusCell).toHaveText('✗');

        // 呼び出し元列に呼び出し元ファイル情報が表示されること
        const callerCell = logEntry.locator('.debug-console-col-caller');
        await expect(callerCell).not.toHaveText('');
    });

    test('success指定の通知はDEBUG CONSOLEで成功扱いになる', async ({ page, mockFileSystem }) => {
        await showNotificationAsync(page, '保存完了通知', 'success');

        const toast = page.locator('.notification-toast', { hasText: '保存完了通知' });
        await expect(toast).toHaveClass(/notification-toast-success/);

        const logEntry = page.locator('.debug-console-list .debug-console-row', {
            has: page.locator('.debug-console-col-label', { hasText: '保存完了通知' }),
        });
        await expect(logEntry).toHaveClass(/debug-console-row-success/);
        await expect(logEntry.locator('.debug-console-col-status')).toHaveText('✓');
    });

    for (const displayMessage of [null, '読み込みに失敗しました']) {
        test(`非同期例外の発生位置を記録する（${displayMessage === null ? '元のメッセージ' : '表示文言を指定'}）`, async ({page, mockFileSystem}) => {
            const originalStack = await page.evaluate(async message => {
                const notification = (window as unknown as {
                    notification: {showError(error: unknown, message?: string): void};
                }).notification;
                // 通知するコードと異なるファイル名から実際に例外を発生させる。
                const failAsync = new Function('return Promise.resolve().then(() => { throw new Error("発生位置の確認"); });\n//# sourceURL=notification-origin.ts');
                try {
                    await failAsync();
                } catch (error: unknown) {
                    if (message === null) notification.showError(error);
                    else notification.showError(error, message);
                    return error instanceof Error ? error.stack ?? '' : '';
                }
                throw new Error('例外が発生しませんでした');
            }, displayMessage);
            const message = displayMessage ?? '発生位置の確認';
            await expect(page.locator('.notification-toast-error')).toHaveText(message);
            const logEntry = page.locator('.debug-console-row-error', {hasText: message});
            await expect(logEntry).toHaveCount(1);
            await expect(logEntry.locator('.debug-console-col-caller')).toHaveText('notification-origin.ts:3');
            await page.locator('.status-bar-badge').click();
            await page.locator('.bottom-panel-tab', {hasText: 'DEBUG CONSOLE'}).click();
            await logEntry.click();
            const stackSection = page.locator('.debug-api-detail-stack-trace');
            await expect(stackSection).toBeVisible();
            await expect(stackSection.locator('.debug-api-detail-section-title')).toHaveText('Stack Trace');
            expect(await stackSection.locator('.debug-api-detail-code').textContent()).toBe(originalStack);
            await expect(stackSection.locator('.debug-api-detail-pre')).toHaveCSS('overflow-y', 'scroll');

            // 詳細タブを再利用して成功通知を開いた際に、直前のスタックを残さない。
            await showNotificationAsync(page, '成功通知へ切り替え', 'success');
            await page.locator('.debug-console-row-success', {hasText: '成功通知へ切り替え'}).click();
            await expect(stackSection).toHaveCount(0);
            await expect(page.locator('.debug-api-detail-code')).toHaveCount(2);
        });
    }

    for (const kind of ['文字列', 'スタックなしのError']) {
        test(`発生位置を取得できない例外に通知位置を表示しない（${kind}）`, async ({page, mockFileSystem}) => {
            await page.evaluate(errorKind => {
                const notification = (window as unknown as {
                    notification: {showError(error: unknown): void};
                }).notification;
                const error = new Error('発生位置が不明なエラー');
                delete error.stack;
                notification.showError(errorKind === '文字列' ? error.message : error);
            }, kind);
            await expect(page.locator('.notification-toast-error')).toHaveText('発生位置が不明なエラー');
            const logEntry = page.locator('.debug-console-row-error', {hasText: '発生位置が不明なエラー'});
            await expect(logEntry).toHaveCount(1);
            await expect(logEntry.locator('.debug-console-col-caller')).toHaveText('');
            await page.locator('.status-bar-badge').click();
            await page.locator('.bottom-panel-tab', {hasText: 'DEBUG CONSOLE'}).click();
            await logEntry.click();
            await expect(page.locator('.debug-api-detail-stack-trace')).toHaveCount(0);
        });
    }

    test('その場で検出したエラー通知も検出時のスタックを詳細表示できる', async ({page, mockFileSystem}) => {
        await page.evaluate(() => {
            const notification = (window as unknown as {
                notification: {show(message: string, status: 'error'): void};
            }).notification;
            new Function('notification', 'notification.show("直接通知のスタック確認", "error");\n//# sourceURL=notification-detection.ts')(notification);
        });
        await page.locator('.status-bar-badge').click();
        await page.locator('.bottom-panel-tab', {hasText: 'DEBUG CONSOLE'}).click();
        await page.locator('.debug-console-row-error', {hasText: '直接通知のスタック確認'}).click();
        const stackCode = page.locator('.debug-api-detail-stack-trace .debug-api-detail-code');
        await expect(stackCode).toContainText('直接通知のスタック確認');
        await expect(stackCode).toContainText('notification-detection.ts:3');
    });

    // -------------------------------------------------------------------------
    // 廃止済み要素の非存在確認
    // -------------------------------------------------------------------------

    test('ベルマーク要素が存在しないこと', async ({ page, mockFileSystem }) => {
        // .notification-bell 要素がDOM上に存在しないこと
        await expect(page.locator('.notification-bell')).toHaveCount(0);
    });

    test('履歴パネル要素が存在しないこと', async ({ page, mockFileSystem }) => {
        // .notification-history 要素がDOM上に存在しないこと
        await expect(page.locator('.notification-history')).toHaveCount(0);
    });
});
