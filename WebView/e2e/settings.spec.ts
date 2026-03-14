import { test, expect } from './fixtures/test';

// =============================================================================
// 設定画面（ライトテーマ対応）テスト
//
// 実装すべき機能:
//   1. アクティビティバー下部に歯車アイコン（.activity-bar-settings）を配置する
//   2. 歯車クリックで「設定」タブをタブバーに開く
//   3. 設定画面にライト/ダークの2択プルダウン（select.settings-theme-select）を表示する
//   4. プルダウン変更時に body[data-theme] が即時更新される
//   5. テーマ変更時に設定タブの dirty マーク（.tab-button-dirty-visible）が表示される
//   6. Ctrl+S で保存後に dirty マークが消え、localStorage に永続化される
//   7. ページリロード後もテーマが維持される
//
// RED状態の理由:
//   - .activity-bar-settings 要素がプロダクションコードに存在しない
//   - 「設定」タブ・.settings-panel・select.settings-theme-select が存在しない
//   - テーマ変更の body[data-theme] 更新ロジックが存在しない
//   - Ctrl+S による localStorage 永続化が存在しない
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
        '設定タブ内にテーマ選択のプルダウン（select.settings-theme-select）が表示されること',
        async ({ page, mockFileSystem }) => {
            // 歯車ボタンをクリックして設定タブを開く
            const settingsButton = page.locator('.activity-bar-settings');
            await settingsButton.click();

            // 設定パネル内のテーマ選択プルダウンが表示されることを確認する
            // プロダクションコードに .settings-panel と select.settings-theme-select が存在しないため失敗（RED）
            const themeSelect = page.locator('.settings-panel select.settings-theme-select');
            await expect(themeSelect).toBeVisible();

            // 「light」「dark」の2つの選択肢が存在することを確認する
            await expect(themeSelect.locator('option[value="light"]')).toHaveCount(1);
            await expect(themeSelect.locator('option[value="dark"]')).toHaveCount(1);
        },
    );

    // ---------------------------------------------------------------------------
    // テスト4: プルダウンでライト選択時にテーマが即時反映されること
    // ---------------------------------------------------------------------------
    test(
        'プルダウンで「light」を選択すると body の data-theme 属性が即時 light になること',
        async ({ page, mockFileSystem }) => {
            // 初期状態が dark テーマであることを確認する
            await expect(page.locator('body')).toHaveAttribute('data-theme', 'dark');

            // 歯車ボタンをクリックして設定タブを開く
            const settingsButton = page.locator('.activity-bar-settings');
            await settingsButton.click();

            // テーマプルダウンで「light」を選択する
            // プロダクションコードに即時プレビューのロジックが存在しないため失敗（RED）
            const themeSelect = page.locator('.settings-panel select.settings-theme-select');
            await themeSelect.selectOption('light');

            // body の data-theme 属性が「light」になることを確認する
            await expect(page.locator('body')).toHaveAttribute('data-theme', 'light');
        },
    );

    // ---------------------------------------------------------------------------
    // テスト5: テーマ変更時にタブに dirty マークが表示されること
    // ---------------------------------------------------------------------------
    test(
        'テーマを変更すると設定タブに dirty マーク（.tab-button-dirty-visible）が表示されること',
        async ({ page, mockFileSystem }) => {
            // 歯車ボタンをクリックして設定タブを開く
            const settingsButton = page.locator('.activity-bar-settings');
            await settingsButton.click();

            // 変更前は dirty マークが付いていないことを確認する
            const settingsTabButton = page.locator('.tab-button').filter({ hasText: '設定' });
            await expect(settingsTabButton).toBeVisible();
            const dirtyIndicator = settingsTabButton.locator('.tab-button-dirty');
            await expect(dirtyIndicator).not.toHaveClass(/tab-button-dirty-visible/);

            // テーマプルダウンで「light」を選択してテーマを変更する
            const themeSelect = page.locator('.settings-panel select.settings-theme-select');
            await themeSelect.selectOption('light');

            // テーマ変更後に設定タブの dirty マークが表示されることを確認する
            // プロダクションコードに dirty マーク更新ロジックが存在しないため失敗（RED）
            await expect(dirtyIndicator).toHaveClass(/tab-button-dirty-visible/);
        },
    );

    // ---------------------------------------------------------------------------
    // テスト6: Ctrl+S でテーマ設定が保存されること
    // ---------------------------------------------------------------------------
    test(
        'Ctrl+S で保存後に dirty マークが消えること',
        async ({ page, mockFileSystem }) => {
            // 歯車ボタンをクリックして設定タブを開く
            const settingsButton = page.locator('.activity-bar-settings');
            await settingsButton.click();

            // テーマを変更して dirty 状態にする
            const themeSelect = page.locator('.settings-panel select.settings-theme-select');
            await themeSelect.selectOption('light');

            // dirty マークが表示されることを確認する（前提確認）
            const settingsTabButton = page.locator('.tab-button').filter({ hasText: '設定' });
            const dirtyIndicator = settingsTabButton.locator('.tab-button-dirty');
            await expect(dirtyIndicator).toHaveClass(/tab-button-dirty-visible/);

            // 設定パネルにフォーカスを当てた状態で Ctrl+S を押す
            // ネイティブ <select> にフォーカスがあると Chromium が keydown イベントを生成しないため、
            // 設定タブボタンをクリックしてフォーカスを <select> から外す
            await settingsTabButton.click();
            await page.keyboard.press('Control+s');

            // Ctrl+S 後に dirty マークが消えることを確認する
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

            // テーマを「light」に変更する
            const themeSelect = page.locator('.settings-panel select.settings-theme-select');
            await themeSelect.selectOption('light');

            // Ctrl+S で保存する（localStorage への永続化）
            // ネイティブ <select> にフォーカスがあると Chromium が keydown イベントを生成しないため、
            // 設定タブボタンをクリックしてフォーカスを <select> から外す
            const settingsTabButton = page.locator('.tab-button').filter({ hasText: '設定' });
            await settingsTabButton.click();
            await page.keyboard.press('Control+s');

            // dirty マークが消えるまで待機する（保存完了の確認）
            const dirtyIndicator = settingsTabButton.locator('.tab-button-dirty');
            await expect(dirtyIndicator).not.toHaveClass(/tab-button-dirty-visible/);

            // ページをリロードする
            await page.reload();

            // リロード後もライトテーマが維持されることを確認する
            // プロダクションコードにリロード時の localStorage 読み込みロジックが存在しないため失敗（RED）
            await expect(page.locator('body')).toHaveAttribute('data-theme', 'light');
        },
    );

    // ---------------------------------------------------------------------------
    // テスト8: 設定タブを閉じて再度開いた場合にテーマプルダウンが正しく動作すること
    // ---------------------------------------------------------------------------
    test(
        '設定タブを閉じて再度開いた場合にテーマプルダウンが正しく動作すること',
        async ({ page, mockFileSystem }) => {
            const settingsButton = page.locator('.activity-bar-settings');
            const settingsTabButton = page.locator('.tab-button').filter({ hasText: '設定' });

            // 歯車ボタンをクリックして設定タブを開く
            await settingsButton.click();

            // テーマを「light」に変更する
            const themeSelect = page.locator('.settings-panel select.settings-theme-select');
            await themeSelect.selectOption('light');

            // Ctrl+S で保存する
            // ネイティブ <select> にフォーカスがあると Chromium が keydown イベントを生成しないため、
            // 設定タブボタンをクリックしてフォーカスを <select> から外す
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

            // 再オープン後のタブのプルダウンが「light」であることを確認する（savedTheme から正しく初期化される）
            await expect(page.locator('.settings-panel select.settings-theme-select')).toHaveValue('light');

            // テーマを「dark」に変更する
            await page.locator('.settings-panel select.settings-theme-select').selectOption('dark');

            // dirty マークが表示されることを確認する
            const newDirtyIndicator = page.locator('.tab-button').filter({ hasText: '設定' }).locator('.tab-button-dirty');
            await expect(newDirtyIndicator).toHaveClass(/tab-button-dirty-visible/);
        },
    );
});
