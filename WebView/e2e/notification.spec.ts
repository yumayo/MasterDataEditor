import { test, expect } from './fixtures/test';

// =============================================================================
// FEAT_0045: システムエラー通知ポップアップ
//
// 機能概要:
//   window.notification.show(message) でトーストポップアップを右下に表示する。
//   最大3つまでスタック可能で、4つ目を追加すると最も古いものが消える。
//   右下のベルマークアイコンをクリックすると過去の全通知を一覧表示する。
//
// テスト対象:
//   WebView/src/notification.ts — Notification クラス
//   WebView/src/notification.css — スタイル
//
// 現在 Notification クラスは未実装のため、すべて RED
// =============================================================================

test.describe('Notification', () => {
    test('エラー通知を表示するとトーストポップアップが右下に表示される', async ({ page, mockFileSystem }) => {
        // window.notification.show() でトーストを表示する
        await page.evaluate(() => {
            (window as unknown as Record<string, unknown>)['notification'].show('テストエラー');
        });

        // .notification-toast 要素が表示されること
        const toast = page.locator('.notification-toast').first();
        await expect(toast).toBeVisible();

        // テキストに「テストエラー」が含まれること
        await expect(toast).toContainText('テストエラー');
    });

    test('通知は最大3つまでスタックし4つ目を追加すると最も古いものが消える', async ({ page, mockFileSystem }) => {
        // 4回 show() を呼び出す
        await page.evaluate(() => {
            const notification = (window as unknown as Record<string, unknown>)['notification'];
            (notification as { show(msg: string): void }).show('通知1');
            (notification as { show(msg: string): void }).show('通知2');
            (notification as { show(msg: string): void }).show('通知3');
            (notification as { show(msg: string): void }).show('通知4');
        });

        // .notification-toast が3つ以下であること（最大スタック数を超えないこと）
        const toasts = page.locator('.notification-toast');
        const count = await toasts.count();
        expect(count).toBeLessThanOrEqual(3);

        // 最も古い「通知1」は消えていること
        await expect(page.locator('.notification-toast', { hasText: '通知1' })).toHaveCount(0);

        // 最新の「通知4」は存在すること
        await expect(page.locator('.notification-toast', { hasText: '通知4' })).toHaveCount(1);
    });

    test('ベルマークアイコンが右下に表示されている', async ({ page, mockFileSystem }) => {
        // .notification-bell 要素が存在すること
        const bell = page.locator('.notification-bell');
        await expect(bell).toBeVisible();

        // SVG要素を含むこと
        const svg = bell.locator('svg');
        await expect(svg).toBeAttached();
    });

    test('ベルマークをクリックすると過去の全通知が表示される', async ({ page, mockFileSystem }) => {
        // 複数回 show() を呼び出す
        await page.evaluate(() => {
            const notification = (window as unknown as Record<string, unknown>)['notification'];
            (notification as { show(msg: string): void }).show('履歴メッセージA');
            (notification as { show(msg: string): void }).show('履歴メッセージB');
            (notification as { show(msg: string): void }).show('履歴メッセージC');
        });

        // ベルマークをクリックする
        await page.locator('.notification-bell').click();

        // .notification-history パネルが表示されること
        const history = page.locator('.notification-history');
        await expect(history).toBeVisible();

        // 過去のすべての通知メッセージが含まれること
        await expect(history).toContainText('履歴メッセージA');
        await expect(history).toContainText('履歴メッセージB');
        await expect(history).toContainText('履歴メッセージC');
    });
});
