import { test, expect } from './fixtures/test';

// =============================================================================
// 設定画面（ライトテーマ対応）テスト
//
// 検証する機能:
//   1. アクティビティバー下部に歯車アイコン（.activity-bar-settings）を配置する
//   2. 歯車クリックで「設定」タブをタブバーに開く
//   3. 設定画面にライト/ダークの2択カスタムドロップダウンを表示する
//   4. ドロップダウン変更時に body[data-theme] が即時更新される
//   5. テーマ変更時に自動保存されるため dirty マークが表示されない
//   6. Ctrl+S は冪等に動作する（自動保存済みでもエラーにならない）
//   7. Ctrl+S 経由での保存後リロードでテーマが維持される
//   8. テーマ変更のみ（Ctrl+S なし）でリロード後もテーマが維持される（自動保存）
//   9. 設定タブを閉じて再度開いた場合にテーマドロップダウンが正しく動作する
// =============================================================================

// =============================================================================
// テスト本体
// =============================================================================

test.describe('設定画面', () => {

    // ---------------------------------------------------------------------------
    // テスト1: 歯車アイコンが表示されること
    // ---------------------------------------------------------------------------
    test(
        'アクティビティバー下部に歯車アイコン（.activity-bar-settings）が存在すること',
        async ({ page, mockFileSystem }) => {
            // アクティビティバーに歯車ボタンが存在することを確認する
            // プロダクションコードに .activity-bar-settings 要素が存在しないため失敗（RED）
            const settingsButton = page.locator('.activity-bar-settings');
            await expect(settingsButton).toBeVisible();
        },
    );

    // ---------------------------------------------------------------------------
    // テスト2: 歯車クリックで設定タブが開くこと
    // ---------------------------------------------------------------------------
    test(
        '歯車クリックでタブバーに「設定」タブが表示されること',
        async ({ page, mockFileSystem }) => {
            // 歯車ボタンをクリックする
            const settingsButton = page.locator('.activity-bar-settings');
            await settingsButton.click();

            // タブバーに「設定」タブボタンが表示されることを確認する
            // プロダクションコードに設定タブの生成ロジックが存在しないため失敗（RED）
            const settingsTab = page.locator('.tab-button').filter({ hasText: '設定' });
            await expect(settingsTab).toBeVisible();
        },
    );

    // ---------------------------------------------------------------------------
    // テスト3: 設定画面にテーマプルダウンが表示されること
    // ---------------------------------------------------------------------------
    test(
        '設定タブ内にテーマ選択のカスタムドロップダウンが表示されること',
        async ({ page, mockFileSystem }) => {
            // 歯車ボタンをクリックして設定タブを開く
            const settingsButton = page.locator('.activity-bar-settings');
            await settingsButton.click();

            // 設定パネル内のカスタムドロップダウントリガーが表示されることを確認する
            const trigger = page.locator('.settings-panel .settings-dropdown-trigger');
            await expect(trigger).toBeVisible();

            // 「light」「dark」の2つの選択肢が存在することを確認する
            await expect(page.locator('.settings-panel .settings-dropdown-item[data-value="light"]')).toHaveCount(1);
            await expect(page.locator('.settings-panel .settings-dropdown-item[data-value="dark"]')).toHaveCount(1);
        },
    );

    // ---------------------------------------------------------------------------
    // テスト4: プルダウンでライト選択時にテーマが即時反映されること
    // ---------------------------------------------------------------------------
    test(
        'ドロップダウンで「light」を選択すると body の data-theme 属性が即時 light になること',
        async ({ page, mockFileSystem }) => {
            // 初期状態が dark テーマであることを確認する
            await expect(page.locator('body')).toHaveAttribute('data-theme', 'dark');

            // 歯車ボタンをクリックして設定タブを開く
            const settingsButton = page.locator('.activity-bar-settings');
            await settingsButton.click();

            // カスタムドロップダウンで「ライト」を選択する
            const trigger = page.locator('.settings-panel .settings-dropdown-trigger');
            await trigger.click();
            await page.locator('.settings-dropdown-item[data-value="light"]').click();

            // body の data-theme 属性が「light」になることを確認する
            await expect(page.locator('body')).toHaveAttribute('data-theme', 'light');
        },
    );

    // ---------------------------------------------------------------------------
    // テスト5: テーマ変更時に自動保存されるため dirty マークが表示されないこと
    // ---------------------------------------------------------------------------
    test(
        'テーマを変更しても自動保存されるため dirty マークが表示されないこと',
        async ({ page, mockFileSystem }) => {
            // 歯車ボタンをクリックして設定タブを開く
            const settingsButton = page.locator('.activity-bar-settings');
            await settingsButton.click();

            // 変更前は dirty マークが付いていないことを確認する
            const settingsTabButton = page.locator('.tab-button').filter({ hasText: '設定' });
            await expect(settingsTabButton).toBeVisible();
            const dirtyIndicator = settingsTabButton.locator('.tab-button-dirty');
            await expect(dirtyIndicator).not.toHaveClass(/tab-button-dirty-visible/);

            // カスタムドロップダウンで「ライト」を選択してテーマを変更する
            const trigger = page.locator('.settings-panel .settings-dropdown-trigger');
            await trigger.click();
            await page.locator('.settings-dropdown-item[data-value="light"]').click();

            // 自動保存により dirty マークが表示されないことを確認する
            await expect(dirtyIndicator).not.toHaveClass(/tab-button-dirty-visible/);
        },
    );

    // ---------------------------------------------------------------------------
    // テスト6: Ctrl+S が冪等に動作すること（自動保存済みでもエラーにならない）
    // ---------------------------------------------------------------------------
    test(
        'テーマ変更後に Ctrl+S を押しても dirty マークが表示されないこと（冪等性）',
        async ({ page, mockFileSystem }) => {
            // 歯車ボタンをクリックして設定タブを開く
            const settingsButton = page.locator('.activity-bar-settings');
            await settingsButton.click();

            // カスタムドロップダウンでテーマを変更する（自動保存される）
            const trigger = page.locator('.settings-panel .settings-dropdown-trigger');
            await trigger.click();
            await page.locator('.settings-dropdown-item[data-value="light"]').click();

            // 自動保存により dirty マークが表示されていないことを確認する
            const settingsTabButton = page.locator('.tab-button').filter({ hasText: '設定' });
            const dirtyIndicator = settingsTabButton.locator('.tab-button-dirty');
            await expect(dirtyIndicator).not.toHaveClass(/tab-button-dirty-visible/);

            // Ctrl+S を押しても問題なく動作することを確認する（冪等性）
            await settingsTabButton.click();
            await page.keyboard.press('Control+s');

            // Ctrl+S 後も dirty マークが表示されないことを確認する
            await expect(dirtyIndicator).not.toHaveClass(/tab-button-dirty-visible/);
        },
    );

    // ---------------------------------------------------------------------------
    // テスト7: 保存後リロードでテーマが維持されること
    // ---------------------------------------------------------------------------
    test(
        '保存後リロードでライトテーマが維持されること',
        async ({ page, mockFileSystem }) => {
            // 歯車ボタンをクリックして設定タブを開く
            const settingsButton = page.locator('.activity-bar-settings');
            await settingsButton.click();

            // カスタムドロップダウンでテーマを「ライト」に変更する
            const trigger = page.locator('.settings-panel .settings-dropdown-trigger');
            await trigger.click();
            await page.locator('.settings-dropdown-item[data-value="light"]').click();

            // Ctrl+S で保存する（localStorage への永続化）
            const settingsTabButton = page.locator('.tab-button').filter({ hasText: '設定' });
            await settingsTabButton.click();
            await page.keyboard.press('Control+s');

            // dirty マークが消えるまで待機する（保存完了の確認）
            const dirtyIndicator = settingsTabButton.locator('.tab-button-dirty');
            await expect(dirtyIndicator).not.toHaveClass(/tab-button-dirty-visible/);

            // ページをリロードする
            await page.reload();

            // リロード後もライトテーマが維持されることを確認する
            await expect(page.locator('body')).toHaveAttribute('data-theme', 'light');
        },
    );

    // ---------------------------------------------------------------------------
    // テスト8: テーマ変更のみ（Ctrl+S なし）でリロード後もテーマが維持されること
    // ---------------------------------------------------------------------------
    test(
        'テーマを変更すると自動的に保存され、リロード後もテーマが維持されること',
        async ({ page, mockFileSystem }) => {
            // 歯車ボタンをクリックして設定タブを開く
            const settingsButton = page.locator('.activity-bar-settings');
            await settingsButton.click();

            // カスタムドロップダウンでテーマを「ライト」に変更する（Ctrl+S は押さない）
            const trigger = page.locator('.settings-panel .settings-dropdown-trigger');
            await trigger.click();
            await page.locator('.settings-dropdown-item[data-value="light"]').click();

            // dirty マークが表示されないことを確認する（自動保存済み）
            const settingsTabButton = page.locator('.tab-button').filter({ hasText: '設定' });
            const dirtyIndicator = settingsTabButton.locator('.tab-button-dirty');
            await expect(dirtyIndicator).not.toHaveClass(/tab-button-dirty-visible/);

            // ページをリロードする
            await page.reload();

            // リロード後もライトテーマが維持されることを確認する（自動保存されたため）
            await expect(page.locator('body')).toHaveAttribute('data-theme', 'light');
        },
    );

    // ---------------------------------------------------------------------------
    // テスト9: 設定タブを閉じて再度開いた場合にテーマプルダウンが正しく動作すること
    // ---------------------------------------------------------------------------
    test(
        '設定タブを閉じて再度開いた場合にテーマドロップダウンが正しく動作すること',
        async ({ page, mockFileSystem }) => {
            const settingsButton = page.locator('.activity-bar-settings');
            const settingsTabButton = page.locator('.tab-button').filter({ hasText: '設定' });

            // 歯車ボタンをクリックして設定タブを開く
            await settingsButton.click();

            // カスタムドロップダウンでテーマを「ライト」に変更する
            const trigger = page.locator('.settings-panel .settings-dropdown-trigger');
            await trigger.click();
            await page.locator('.settings-dropdown-item[data-value="light"]').click();

            // Ctrl+S で保存する
            await settingsTabButton.click();
            await page.keyboard.press('Control+s');

            // dirty マークが消えるまで待機する（保存完了の確認）
            const dirtyIndicator = settingsTabButton.locator('.tab-button-dirty');
            await expect(dirtyIndicator).not.toHaveClass(/tab-button-dirty-visible/);

            // 設定タブを閉じる（タブの×ボタンをクリック）
            const closeButton = settingsTabButton.locator('.tab-button-close');
            await closeButton.click();

            // 設定タブが閉じられたことを確認する
            await expect(settingsTabButton).not.toBeVisible();

            // 歯車ボタンを再度クリックして設定タブを開く
            await settingsButton.click();

            // 再オープン後のドロップダウントリガーが「ライト」表示であることを確認する（localStorage から正しく初期化される）
            const reopenedTrigger = page.locator('.settings-panel .settings-dropdown-trigger');
            await expect(reopenedTrigger).toHaveText(/ライト/);

            // カスタムドロップダウンでテーマを「ダーク」に変更する（自動保存される）
            await reopenedTrigger.click();
            await page.locator('.settings-dropdown-item[data-value="dark"]').click();

            // 自動保存により dirty マークが表示されないことを確認する
            const newDirtyIndicator = page.locator('.tab-button').filter({ hasText: '設定' }).locator('.tab-button-dirty');
            await expect(newDirtyIndicator).not.toHaveClass(/tab-button-dirty-visible/);
        },
    );
});
