import { Page } from '@playwright/test';
import { test, expect } from './fixtures/test';
import { createDefaultFileSystem, installMockApiAsync, readMockFileAsync } from './fixtures/mock-api';

const THEME_FILE = 'userdata/theme.json';
const THEME_STORAGE_KEY = 'master-data-editor-theme';

async function openSettingsTabAsync(page: Page): Promise<void> {
    await page.locator('.activity-bar-settings').click();
    await expect(page.locator('.tab-button').filter({ hasText: '設定' })).toBeVisible();
}

async function selectThemeAsync(page: Page, theme: 'dark' | 'light'): Promise<void> {
    const trigger = page.locator('.settings-panel .settings-dropdown-trigger');
    await trigger.click();
    await page.locator(`.settings-dropdown-item[data-value="${theme}"]`).click();
}

async function waitForThemeFileAsync(page: Page, expectedTheme: 'dark' | 'light'): Promise<void> {
    await page.waitForFunction(
        ({ path, theme }) => {
            const raw = (window as unknown as { __mockFs: Record<string, string> }).__mockFs[path];
            if (typeof raw !== 'string') {
                return false;
            }
            try {
                const parsed = JSON.parse(raw) as { theme?: string };
                return parsed.theme === theme;
            } catch {
                return false;
            }
        },
        { path: THEME_FILE, theme: expectedTheme },
        { timeout: 5000 },
    );
}

// =============================================================================
// 設定画面（テーマ設定）テスト
//
// 検証する機能:
//   1. アクティビティバー下部に歯車アイコン（.activity-bar-settings）を配置する
//   2. 歯車クリックで「設定」タブをタブバーに開く
//   3. 設定画面にライト/ダークの2択カスタムドロップダウンを表示する
//   4. ドロップダウン変更時に body[data-theme] が即時更新される
//   5. テーマ変更時に自動保存されるため dirty マークが表示されない
//   6. Ctrl+S は冪等に動作する（自動保存済みでもエラーにならない）
//   7. テーマ変更時に userdata/theme.json へ保存される
//   8. 起動時に userdata/theme.json からテーマを読み込む
//   9. 設定タブを閉じて再度開いた場合にテーマドロップダウンが正しく動作する
//   10. reload 後も userdata/theme.json からテーマが維持される
// =============================================================================

test.describe('設定画面', () => {

    // ---------------------------------------------------------------------------
    // テスト1: 歯車アイコンが表示されること
    // ---------------------------------------------------------------------------
    test(
        'アクティビティバー下部に歯車アイコン（.activity-bar-settings）が存在すること',
        async ({ page, mockFileSystem }) => {
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
            await openSettingsTabAsync(page);
        },
    );

    // ---------------------------------------------------------------------------
    // テスト3: 設定画面にテーマプルダウンが表示されること
    // ---------------------------------------------------------------------------
    test(
        '設定タブ内にテーマ選択のカスタムドロップダウンが表示されること',
        async ({ page, mockFileSystem }) => {
            await openSettingsTabAsync(page);

            const trigger = page.locator('.settings-panel .settings-dropdown-trigger');
            await expect(trigger).toBeVisible();
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
            await expect(page.locator('body')).toHaveAttribute('data-theme', 'dark');
            await openSettingsTabAsync(page);
            await selectThemeAsync(page, 'light');
            await expect(page.locator('body')).toHaveAttribute('data-theme', 'light');
        },
    );

    // ---------------------------------------------------------------------------
    // テスト5: テーマ変更時に自動保存されるため dirty マークが表示されないこと
    // ---------------------------------------------------------------------------
    test(
        'テーマを変更しても自動保存されるため dirty マークが表示されないこと',
        async ({ page, mockFileSystem }) => {
            await openSettingsTabAsync(page);

            const settingsTabButton = page.locator('.tab-button').filter({ hasText: '設定' });
            await expect(settingsTabButton).toBeVisible();
            const dirtyIndicator = settingsTabButton.locator('.tab-button-dirty');
            await expect(dirtyIndicator).not.toHaveClass(/tab-button-dirty-visible/);

            await selectThemeAsync(page, 'light');
            await expect(dirtyIndicator).not.toHaveClass(/tab-button-dirty-visible/);
        },
    );

    // ---------------------------------------------------------------------------
    // テスト6: Ctrl+S が冪等に動作すること（自動保存済みでもエラーにならない）
    // ---------------------------------------------------------------------------
    test(
        'テーマ変更後に Ctrl+S を押しても dirty マークが表示されないこと（冪等性）',
        async ({ page, mockFileSystem }) => {
            await openSettingsTabAsync(page);
            await selectThemeAsync(page, 'light');

            const settingsTabButton = page.locator('.tab-button').filter({ hasText: '設定' });
            const dirtyIndicator = settingsTabButton.locator('.tab-button-dirty');
            await expect(dirtyIndicator).not.toHaveClass(/tab-button-dirty-visible/);

            await settingsTabButton.click();
            await page.keyboard.press('Control+s');
            await expect(dirtyIndicator).not.toHaveClass(/tab-button-dirty-visible/);
        },
    );

    // ---------------------------------------------------------------------------
    // テスト7: テーマ変更時に userdata/theme.json へ保存されること
    // ---------------------------------------------------------------------------
    test(
        'テーマ変更時にuserdata/theme.jsonへ現在のテーマが保存されること',
        async ({ page, mockFileSystem }) => {
            await openSettingsTabAsync(page);
            await selectThemeAsync(page, 'light');
            await waitForThemeFileAsync(page, 'light');

            await expect(page.locator('body')).toHaveAttribute('data-theme', 'light');
            const themeJson = await readMockFileAsync(page, THEME_FILE);
            expect(JSON.parse(themeJson)).toEqual({ theme: 'light' });
        },
    );

    // ---------------------------------------------------------------------------
    // テスト8: 起動時に userdata/theme.json からテーマが読み込まれること
    // ---------------------------------------------------------------------------
    test(
        '起動時にuserdata/theme.jsonが存在すればそのテーマが適用されること',
        async ({ page }) => {
            const fs = createDefaultFileSystem();
            fs[THEME_FILE] = JSON.stringify({ theme: 'light' });
            await installMockApiAsync(page, fs);
            await page.goto('/');

            await expect(page.locator('body')).toHaveAttribute('data-theme', 'light');
        },
    );

    // ---------------------------------------------------------------------------
    // テスト9: 設定タブを閉じて再度開いた場合にテーマドロップダウンが正しく動作すること
    // ---------------------------------------------------------------------------
    test(
        '設定タブを閉じて再度開いた場合にテーマドロップダウンが正しく動作すること',
        async ({ page, mockFileSystem }) => {
            const settingsButton = page.locator('.activity-bar-settings');
            const settingsTabButton = page.locator('.tab-button').filter({ hasText: '設定' });

            await settingsButton.click();
            await selectThemeAsync(page, 'light');

            await settingsTabButton.click();
            await page.keyboard.press('Control+s');

            const dirtyIndicator = settingsTabButton.locator('.tab-button-dirty');
            await expect(dirtyIndicator).not.toHaveClass(/tab-button-dirty-visible/);

            const closeButton = settingsTabButton.locator('.tab-button-close');
            await closeButton.click();
            await expect(settingsTabButton).not.toBeVisible();

            await settingsButton.click();

            const reopenedTrigger = page.locator('.settings-panel .settings-dropdown-trigger');
            await expect(reopenedTrigger).toHaveText(/ライト/);

            await selectThemeAsync(page, 'dark');

            const newDirtyIndicator = page.locator('.tab-button').filter({ hasText: '設定' }).locator('.tab-button-dirty');
            await expect(newDirtyIndicator).not.toHaveClass(/tab-button-dirty-visible/);
        },
    );

    // ---------------------------------------------------------------------------
    // テスト10: reload 後も userdata/theme.json からテーマが維持されること
    // ---------------------------------------------------------------------------
    test(
        'テーマ変更後にlocalStorageを空にしてreloadしてもuserdata/theme.jsonからテーマが復元されること',
        async ({ page, mockFileSystem }) => {
            await openSettingsTabAsync(page);
            await selectThemeAsync(page, 'light');
            await page.evaluate(({ path, data }) => {
                const webview = (window as unknown as {
                    chrome: { webview: { postMessage: (message: string) => void } };
                }).chrome.webview;
                webview.postMessage(JSON.stringify({
                    type: 'write_file_request',
                    filename: path,
                    data,
                }));
            }, { path: THEME_FILE, data: JSON.stringify({ theme: 'light' }) });
            await waitForThemeFileAsync(page, 'light');

            await page.evaluate((storageKey: string) => {
                localStorage.removeItem(storageKey);
            }, THEME_STORAGE_KEY);

            await page.reload();

            await expect(page.locator('body')).toHaveAttribute('data-theme', 'light');
        },
    );
});
