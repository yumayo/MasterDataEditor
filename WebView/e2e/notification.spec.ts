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
async function showNotificationAsync(page: Page, message: string): Promise<void> {
    await page.evaluate((msg) => {
        const n = (window as unknown as Record<string, { show(m: string): void }>)['notification'];
        n.show(msg);
    }, message);
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
