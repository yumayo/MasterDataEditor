import { test, expect } from './fixtures/test';
import type { Page } from '@playwright/test';

// =============================================================================
// FEAT_0045: システムエラー通知
// FEAT_0045b: NotificationToast メッセージバー化
//
// 機能概要:
//   window.notification.show(message) でステータスバー内の
//   .notification-message に最新メッセージを表示する。
//   show() 呼び出し時に DEBUG CONSOLE にもエントリを追加する。
//   旧仕様のベルマーク・履歴パネル・トーストポップアップは廃止。
//
// テスト対象:
//   WebView/src/notification.ts — NotificationToast クラス
//   WebView/src/status-bar.ts  — StatusBar クラス
//   WebView/src/debug-console.ts — DebugConsole クラス
//   WebView/src/notification.css — スタイル
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
    // ステータスバーのメッセージ欄
    // -------------------------------------------------------------------------

    test('show()を呼ぶとステータスバーのメッセージ欄にテキストが表示される', async ({ page, mockFileSystem }) => {
        await showNotificationAsync(page, 'ステータスバーメッセージ');

        // .status-bar 内の .notification-message 要素にテキストが反映されること
        const messageElement = page.locator('.status-bar .notification-message');
        await expect(messageElement).toBeVisible();
        await expect(messageElement).toHaveText('ステータスバーメッセージ');
    });

    test('複数回show()を呼ぶと最後のメッセージで上書きされる', async ({ page, mockFileSystem }) => {
        await showNotificationAsync(page, '最初のメッセージ');
        await showNotificationAsync(page, '2番目のメッセージ');
        await showNotificationAsync(page, '最後のメッセージ');

        // .notification-message には最後のメッセージだけが表示されること
        const messageElement = page.locator('.status-bar .notification-message');
        await expect(messageElement).toHaveText('最後のメッセージ');
        // 過去のメッセージは含まれないこと
        await expect(messageElement).not.toContainText('最初のメッセージ');
        await expect(messageElement).not.toContainText('2番目のメッセージ');
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
    // 新仕様: ベルマーク・履歴パネルの廃止
    // -------------------------------------------------------------------------

    test('ベルマーク要素が存在しないこと', async ({ page, mockFileSystem }) => {
        // .notification-bell 要素がDOM上に存在しないこと
        await expect(page.locator('.notification-bell')).toHaveCount(0);
    });

    test('履歴パネル要素が存在しないこと', async ({ page, mockFileSystem }) => {
        // .notification-history 要素がDOM上に存在しないこと
        await expect(page.locator('.notification-history')).toHaveCount(0);
    });

    test('トースト要素が存在しないこと', async ({ page, mockFileSystem }) => {
        await showNotificationAsync(page, 'トースト非存在確認');
        await expect(page.locator('.notification-toast')).toHaveCount(0);
        await expect(page.locator('.notification-toast-area')).toHaveCount(0);
    });
});
