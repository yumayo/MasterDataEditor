import { test, expect } from './fixtures/test';
import { installMockApiAsync, createDefaultFileSystem } from './fixtures/mock-api';

// =============================================================================
// ファイルウォッチャー バッジ表示テスト — ISSUE_0090
//
// C# の FileSystemWatcher がファイル変更を検知すると、WebView に file_changed
// メッセージが送信される。WebView 側はこれを受けて gitStatusAsync() を呼び出し、
// アクティビティバーのソース管理アイコンにバッジ（変更ファイル数）を表示する。
//
// 検証項目:
//   1. file_changed 通知を受信するとバッジが表示される
//   2. 変更ファイル数が 0 の場合はバッジが非表示になる
//   3. changes と staged の合計がバッジに表示される
//   4. アプリ起動時にも初期バッジが表示される
// =============================================================================

/** ソース管理ボタンのセレクタ */
const SOURCE_CONTROL_BUTTON = '.activity-bar-item[data-panel="sourceControl"]';
/** バッジ要素のセレクタ */
const BADGE_SELECTOR = '.activity-bar-badge';

// ---------- テスト1: file_changed 通知でバッジ表示 ----------

test.describe('ファイルウォッチャー バッジ表示', () => {
    test('file_changed 通知を受信するとソース管理アイコンにバッジが表示される', async ({ page }) => {
        // changes 3件の git status を設定
        await page.addInitScript(() => {
            (window as unknown as { __mockGitStatus: object }).__mockGitStatus = {
                changes: [
                    { path: 'data/enemy.csv', tableName: 'enemy', isNew: false },
                    { path: 'data/item.csv', tableName: 'item', isNew: false },
                    { path: 'data/skill.csv', tableName: 'skill', isNew: false },
                ],
                staged: [],
            };
        });

        await installMockApiAsync(page, createDefaultFileSystem());
        await page.goto('/');

        // file_changed メッセージを送信
        await page.evaluate(() => {
            window.chrome.webview.postMessage(JSON.stringify({ type: 'file_changed' }));
        });

        // バッジが表示され、数値が '3' であることを検証
        const badge = page.locator(`${SOURCE_CONTROL_BUTTON} ${BADGE_SELECTOR}`);
        await expect(badge).toBeVisible();
        await expect(badge).toHaveText('3');
    });

    // ---------- テスト2: 変更ファイル数 0 でバッジ非表示 ----------

    test('変更ファイル数が 0 の場合はバッジが非表示になる', async ({ page }) => {
        // 空の git status を設定
        await page.addInitScript(() => {
            (window as unknown as { __mockGitStatus: object }).__mockGitStatus = {
                changes: [],
                staged: [],
            };
        });

        await installMockApiAsync(page, createDefaultFileSystem());
        await page.goto('/');

        // file_changed メッセージを送信
        await page.evaluate(() => {
            window.chrome.webview.postMessage(JSON.stringify({ type: 'file_changed' }));
        });

        // バッジが存在しないことを検証（短い待機後に確認）
        const badge = page.locator(`${SOURCE_CONTROL_BUTTON} ${BADGE_SELECTOR}`);
        await expect(badge).toHaveCount(0);
    });

    // ---------- テスト3: changes + staged の合計がバッジに表示される ----------

    test('changes と staged の合計がバッジに表示される', async ({ page }) => {
        // changes 2件 + staged 1件 = 合計3件
        await page.addInitScript(() => {
            (window as unknown as { __mockGitStatus: object }).__mockGitStatus = {
                changes: [
                    { path: 'data/enemy.csv', tableName: 'enemy', isNew: false },
                    { path: 'data/item.csv', tableName: 'item', isNew: false },
                ],
                staged: [
                    { path: 'data/skill.csv', tableName: 'skill', isNew: false },
                ],
            };
        });

        await installMockApiAsync(page, createDefaultFileSystem());
        await page.goto('/');

        // file_changed メッセージを送信
        await page.evaluate(() => {
            window.chrome.webview.postMessage(JSON.stringify({ type: 'file_changed' }));
        });

        // バッジが合計数 '3' を表示することを検証
        const badge = page.locator(`${SOURCE_CONTROL_BUTTON} ${BADGE_SELECTOR}`);
        await expect(badge).toBeVisible();
        await expect(badge).toHaveText('3');
    });

    // ---------- テスト4: アプリ起動時の初期バッジ表示 ----------

    test('アプリ起動時にも初期バッジが表示される', async ({ page }) => {
        // changes 2件を設定した状態でページロード
        await page.addInitScript(() => {
            (window as unknown as { __mockGitStatus: object }).__mockGitStatus = {
                changes: [
                    { path: 'data/enemy.csv', tableName: 'enemy', isNew: false },
                    { path: 'data/item.csv', tableName: 'item', isNew: false },
                ],
                staged: [],
            };
        });

        await installMockApiAsync(page, createDefaultFileSystem());
        await page.goto('/');

        // ページロード完了後、バッジが '2' と表示されることを検証
        const badge = page.locator(`${SOURCE_CONTROL_BUTTON} ${BADGE_SELECTOR}`);
        await expect(badge).toBeVisible();
        await expect(badge).toHaveText('2');
    });
});
