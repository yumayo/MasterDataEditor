import { test, expect } from './fixtures/test';

// =============================================================================
// FEAT_0045: システムエラー通知ポップアップ
// ISSUE_0079: 右下の通知アイコンはステータスバーに統合して
//
// 機能概要:
//   window.notification.show(message) でトーストポップアップを右下に表示する。
//   最大3つまでスタック可能で、4つ目を追加すると最も古いものが消える。
//   右下のベルマークアイコンをクリックすると過去の全通知を一覧表示する。
//   ベルマークはステータスバー（画面最下部22px）右端に統合する。
//
// テスト対象:
//   WebView/src/notification.ts — NotificationToast クラス
//   WebView/src/status-bar.ts  — StatusBar クラス
//   WebView/src/notification.css — スタイル
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

    test('ベルマークアイコンがステータスバー内に表示されている', async ({ page, mockFileSystem }) => {
        // .notification-bell が .status-bar の子孫として存在すること
        const bell = page.locator('.status-bar .notification-bell');
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
        await page.locator('.status-bar .notification-bell').click();

        // .notification-history パネルが表示されること
        const history = page.locator('.notification-history');
        await expect(history).toBeVisible();

        // 過去のすべての通知メッセージが含まれること
        await expect(history).toContainText('履歴メッセージA');
        await expect(history).toContainText('履歴メッセージB');
        await expect(history).toContainText('履歴メッセージC');

        // 履歴パネルがステータスバーの上方に展開されること
        // ステータスバーの top 座標よりも履歴パネルの top 座標が小さい（上にある）こと
        const historyBox = await history.boundingBox();
        const statusBar = page.locator('.status-bar');
        const statusBarBox = await statusBar.boundingBox();
        expect(historyBox).not.toBeNull();
        expect(statusBarBox).not.toBeNull();
        // historyBox と statusBarBox が非 null であることを型アサートして比較する
        // Playwright の boundingBox() は { x, y, width, height } を返す（top/left ではない）
        expect((historyBox as NonNullable<typeof historyBox>).y).toBeLessThan(
            (statusBarBox as NonNullable<typeof statusBarBox>).y
        );
    });

    test('通知コンテナはbody直下に存在しない（ステータスバーに統合済み）', async ({ page, mockFileSystem }) => {
        // body の直下に .notification-container が存在しないこと
        // 統合後は StatusBar 内に配置されるため body > .notification-container は消える
        const containerDirectUnderBody = page.locator('body > .notification-container');
        await expect(containerDirectUnderBody).toHaveCount(0);
    });

    test('トーストエリアがステータスバーの上方に表示される', async ({ page, mockFileSystem }) => {
        // トーストを1件表示する
        await page.evaluate(() => {
            (window as unknown as Record<string, unknown>)['notification'].show('位置確認トースト');
        });

        // .notification-toast-area が表示されていること
        const toastArea = page.locator('.notification-toast-area');
        await expect(toastArea).toBeVisible();

        // トーストエリアの位置がステータスバーの上にあること
        // toastArea の bottom がステータスバーの top 以下であること
        const toastAreaBox = await toastArea.boundingBox();
        const statusBar = page.locator('.status-bar');
        const statusBarBox = await statusBar.boundingBox();
        expect(toastAreaBox).not.toBeNull();
        expect(statusBarBox).not.toBeNull();
        // toastArea の bottom（y + height）がステータスバーの y 以下であること
        // border-top 1px のサブピクセル誤差を許容するため 2px のマージンを設ける
        const toastAreaBottom = (toastAreaBox as NonNullable<typeof toastAreaBox>).y
            + (toastAreaBox as NonNullable<typeof toastAreaBox>).height;
        const statusBarTop = (statusBarBox as NonNullable<typeof statusBarBox>).y;
        expect(toastAreaBottom).toBeLessThanOrEqual(statusBarTop + 2);
    });
});
