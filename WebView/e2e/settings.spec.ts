import { Page } from '@playwright/test';
import { test, expect } from './fixtures/test';
import { createDefaultFileSystem, installMockApiAsync, readMockFileAsync } from './fixtures/mock-api';

const SETTINGS_FILE = '.masterdataeditor/settings.json';
const USER_SETTINGS_FILE = 'user:settings.json';
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

async function selectSettingsScopeAsync(page: Page, scope: 'user' | 'workspace'): Promise<void> {
    const tab = page.locator(`.settings-scope-tab[data-scope="${scope}"]`);
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
}

function createDescribedTestFileSystem() {
    const fs = createDefaultFileSystem();
    const schema = JSON.parse(fs['schema/test.json']) as Record<string, unknown>;
    schema.description = 'テスト説明\nsecond line';
    fs['schema/test.json'] = JSON.stringify(schema);
    return fs;
}

async function setExportValidationDateTimeAsync(page: Page, value: string): Promise<void> {
    const input = page.locator('.settings-export-validation-datetime-input');
    await input.fill(value);
    await input.blur();
}

async function setExportValidationColumnNamesAsync(page: Page, beginColumnName: string, endColumnName: string): Promise<void> {
    const beginInput = page.locator('.settings-export-begin-date-column-input');
    const endInput = page.locator('.settings-export-end-date-column-input');
    await beginInput.fill(beginColumnName);
    await beginInput.blur();
    await endInput.fill(endColumnName);
    await endInput.blur();
}

async function waitForSettingsThemeAsync(page: Page, expectedTheme: 'dark' | 'light'): Promise<void> {
    await waitForSettingsThemeAtPathAsync(page, SETTINGS_FILE, expectedTheme);
}

async function waitForSettingsThemeAtPathAsync(page: Page, settingsFile: string, expectedTheme: 'dark' | 'light'): Promise<void> {
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
        { path: settingsFile, theme: expectedTheme },
        { timeout: 5000 },
    );
}

async function waitForSettingsExportValidationDateTimeAsync(page: Page, expectedValue: string): Promise<void> {
    await page.waitForFunction(
        ({ path, value }) => {
            const raw = (window as unknown as { __mockFs: Record<string, string> }).__mockFs[path];
            if (typeof raw !== 'string') return false;
            try {
                const parsed = JSON.parse(raw) as { exportValidationDateTime?: string };
                return parsed.exportValidationDateTime === value;
            } catch {
                return false;
            }
        },
        { path: SETTINGS_FILE, value: expectedValue },
        { timeout: 5000 },
    );
}

async function waitForSettingsExportValidationColumnNamesAsync(page: Page, expectedBeginColumnName: string, expectedEndColumnName: string): Promise<void> {
    await page.waitForFunction(
        ({ path, beginColumnName, endColumnName }) => {
            const raw = (window as unknown as { __mockFs: Record<string, string> }).__mockFs[path];
            if (typeof raw !== 'string') return false;
            try {
                const parsed = JSON.parse(raw) as { exportBeginDateColumnName?: string; exportEndDateColumnName?: string };
                return parsed.exportBeginDateColumnName === beginColumnName
                    && parsed.exportEndDateColumnName === endColumnName;
            } catch {
                return false;
            }
        },
        { path: SETTINGS_FILE, beginColumnName: expectedBeginColumnName, endColumnName: expectedEndColumnName },
        { timeout: 5000 },
    );
}

async function waitForSettingsKeyAbsentAsync(page: Page, settingsFile: string, key: string): Promise<void> {
    await page.waitForFunction(
        ({ path, settingKey }) => {
            const raw = (window as unknown as { __mockFs: Record<string, string> }).__mockFs[path];
            if (typeof raw !== 'string') return false;
            try {
                const parsed = JSON.parse(raw) as Record<string, unknown>;
                return !Object.prototype.hasOwnProperty.call(parsed, settingKey);
            } catch {
                return false;
            }
        },
        { path: settingsFile, settingKey: key },
        { timeout: 5000 },
    );
}

async function waitForSettingsJsonAsync(page: Page, settingsFile: string, expected: Record<string, unknown>): Promise<void> {
    await page.waitForFunction(
        ({ path, expectedJson }) => {
            const raw = (window as unknown as { __mockFs: Record<string, string> }).__mockFs[path];
            if (typeof raw !== 'string') return false;
            try {
                return JSON.stringify(JSON.parse(raw) as Record<string, unknown>) === expectedJson;
            } catch {
                return false;
            }
        },
        { path: settingsFile, expectedJson: JSON.stringify(expected) },
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
//   7. テーマ変更時に .masterdataeditor/settings.json へ保存される
//   8. 起動時に .masterdataeditor/settings.json からテーマを読み込む
//   9. 設定タブを閉じて再度開いた場合にテーマドロップダウンが正しく動作する
//   10. reload 後も .masterdataeditor/settings.json からテーマが維持される
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

    test(
        '設定セクションの見出しクリックでグループを折り畳み・展開できること',
        async ({ page, mockFileSystem }) => {
            await openSettingsTabAsync(page);

            const header = page.locator('.settings-section-header').filter({ hasText: '出力フィルター' });
            const input = page.locator('.settings-export-validation-datetime-input');

            await expect(header).toHaveAttribute('aria-expanded', 'true');
            await expect(input).toBeVisible();

            await header.click();
            await expect(header).toHaveAttribute('aria-expanded', 'false');
            await expect(input).toBeHidden();

            await header.click();
            await expect(header).toHaveAttribute('aria-expanded', 'true');
            await expect(input).toBeVisible();
        },
    );

    test(
        '巨大ファイルしきい値を設定画面で変更して保存できること',
        async ({ page, mockFileSystem }) => {
            await openSettingsTabAsync(page);

            await expect(page.locator('.settings-section-header').filter({ hasText: '巨大ファイル' })).toBeVisible();
            await expect(page.locator('.settings-large-file-eager-data-preload-bytes-input')).toHaveValue('1048576');

            const validationRowsInput = page.locator('.settings-large-file-automatic-validation-rows-input');
            const validationRowsLabel = page.locator('.settings-label[data-setting-key="largeFileAutomaticValidationRows"]');
            await expect(validationRowsInput).toHaveAttribute('type', 'number');
            await expect(validationRowsInput).toHaveValue('100000');
            await expect(validationRowsLabel).toHaveAttribute('data-default-different', 'false');

            await validationRowsInput.fill('12345');
            await validationRowsInput.blur();

            await waitForSettingsJsonAsync(page, SETTINGS_FILE, {
                largeFileAutomaticValidationRows: 12345,
            });
            await expect(validationRowsLabel).toHaveAttribute('data-default-different', 'true');
        },
    );

    test(
        '設定画面でUserとWorkspaceの設定スコープを切り替えられること',
        async ({ page, mockFileSystem }) => {
            await openSettingsTabAsync(page);

            const workspaceTab = page.locator('.settings-scope-tab[data-scope="workspace"]');
            const userTab = page.locator('.settings-scope-tab[data-scope="user"]');
            await expect(workspaceTab).toBeVisible();
            await expect(userTab).toBeVisible();
            await expect(workspaceTab).toHaveAttribute('aria-selected', 'true');

            await selectSettingsScopeAsync(page, 'user');
            await selectThemeAsync(page, 'light');
            await waitForSettingsThemeAtPathAsync(page, USER_SETTINGS_FILE, 'light');

            await expect(page.locator('body')).toHaveAttribute('data-theme', 'light');
        },
    );

    test(
        '実効設定ではUser設定がWorkspace設定より優先され、フォームの未設定キーはデフォルト値を表示すること',
        async ({ page }) => {
            const fs = createDefaultFileSystem();
            fs[SETTINGS_FILE] = JSON.stringify({
                theme: 'dark',
                tabWrapEnabled: true,
                exportValidationDateTime: '2026-05-10 12:00:00',
            });
            fs[USER_SETTINGS_FILE] = JSON.stringify({ theme: 'light' });
            await installMockApiAsync(page, fs);
            await page.goto('/');

            await expect(page.locator('body')).toHaveAttribute('data-theme', 'light');
            await expect.poll(async () => page.evaluate(() => (
                getComputedStyle(document.documentElement).getPropertyValue('--tab-wrap-enabled').trim()
            ))).toBe('1');
            await openSettingsTabAsync(page);
            await expect(page.locator('.settings-scope-tab[data-scope="user"]')).toHaveAttribute('aria-selected', 'true');
            await expect(page.locator('.settings-panel .settings-dropdown-trigger')).toHaveText(/ライト/);
            await expect(page.locator('.settings-tab-wrap-checkbox')).not.toBeChecked();
            await expect(page.locator('.settings-export-validation-datetime-input')).toHaveValue('');
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
    // テスト7: テーマ変更時に .masterdataeditor/settings.json へ保存されること
    // ---------------------------------------------------------------------------
    test(
        'テーマ変更時に.masterdataeditor/settings.jsonへ現在のテーマが保存されること',
        async ({ page, mockFileSystem }) => {
            await openSettingsTabAsync(page);
            await selectThemeAsync(page, 'light');
            await waitForSettingsThemeAsync(page, 'light');

            await expect(page.locator('body')).toHaveAttribute('data-theme', 'light');
            const settingsJson = await readMockFileAsync(page, SETTINGS_FILE);
            expect(settingsJson).not.toContain('\r');
            expect(settingsJson.endsWith('\n')).toBe(true);
            expect(settingsJson).toContain('\n    "theme": "light"');
            expect(JSON.parse(settingsJson)).toEqual({
                theme: 'light',
            });
        },
    );

    test(
        'デフォルトと異なる設定項目の左にマークが表示されること',
        async ({ page, mockFileSystem }) => {
            await openSettingsTabAsync(page);

            const themeLabel = page.locator('.settings-label[data-setting-key="theme"]');
            const tabWrapLabel = page.locator('.settings-label[data-setting-key="tabWrapEnabled"]');
            await expect(themeLabel).toHaveAttribute('data-default-different', 'false');
            await expect(tabWrapLabel).toHaveAttribute('data-default-different', 'false');

            await selectThemeAsync(page, 'light');
            await expect(themeLabel).toHaveAttribute('data-default-different', 'true');
            await expect(tabWrapLabel).toHaveAttribute('data-default-different', 'false');

            await selectThemeAsync(page, 'dark');
            await expect(themeLabel).toHaveAttribute('data-default-different', 'false');
            await waitForSettingsKeyAbsentAsync(page, SETTINGS_FILE, 'theme');
            expect(JSON.parse(await readMockFileAsync(page, SETTINGS_FILE))).toEqual({});
        },
    );

    test(
        '固定タブの行分け設定を保存して即時反映できること',
        async ({ page, mockFileSystem }) => {
            await openSettingsTabAsync(page);

            const checkbox = page.locator('.settings-tab-separate-pinned-rows-checkbox');
            const label = page.locator('.settings-label[data-setting-key="tabSeparatePinnedRowsEnabled"]');
            await expect(checkbox).toBeVisible();
            await expect(checkbox).not.toBeChecked();
            await expect(label).toHaveAttribute('data-default-different', 'false');

            await checkbox.click();

            await waitForSettingsJsonAsync(page, SETTINGS_FILE, {
                tabSeparatePinnedRowsEnabled: true,
            });
            await expect(label).toHaveAttribute('data-default-different', 'true');
            await expect.poll(async () => page.evaluate(() => (
                getComputedStyle(document.documentElement).getPropertyValue('--tab-separate-pinned-rows-enabled').trim()
            ))).toBe('1');
        },
    );

    test(
        '説明非表示設定を保存してExplorerとタブのdescriptionを即時に隠し、タブ高さを小さくできること',
        async ({ page }) => {
            const fs = createDescribedTestFileSystem();
            await installMockApiAsync(page, fs);
            await page.goto('/');

            const explorerFile = page.locator('.explorer-file').filter({
                has: page.locator('.explorer-file-name', { hasText: 'test' }),
            }).first();
            const explorerDescription = explorerFile.locator('.explorer-file-description');
            await expect(explorerDescription).toBeVisible();
            await expect(explorerDescription).toHaveText('テスト説明');

            await explorerFile.click();
            const tabButton = page.locator('.tab-button').filter({
                has: page.locator('.tab-button-name', { hasText: 'test' }),
            }).first();
            const tabDescription = tabButton.locator('.tab-button-description');
            await expect(tabDescription).toBeVisible();
            await expect(tabDescription).toHaveText('テスト説明');
            const defaultTabMetrics = await page.evaluate(() => {
                const tab = document.querySelector('.tab') as HTMLElement;
                return {
                    rowHeight: getComputedStyle(document.documentElement).getPropertyValue('--tab-row-height').trim(),
                    tabHeight: tab.getBoundingClientRect().height,
                };
            });
            expect(defaultTabMetrics.rowHeight).toBe('48px');
            expect(defaultTabMetrics.tabHeight).toBeGreaterThanOrEqual(47);

            await openSettingsTabAsync(page);
            const explorerCheckbox = page.locator('.settings-explorer-file-description-hidden-checkbox');
            const tabCheckbox = page.locator('.settings-tab-button-description-hidden-checkbox');
            await expect(explorerCheckbox).not.toBeChecked();
            await expect(tabCheckbox).not.toBeChecked();

            await explorerCheckbox.click();
            await tabCheckbox.click();

            await waitForSettingsJsonAsync(page, SETTINGS_FILE, {
                explorerFileDescriptionHidden: true,
                tabButtonDescriptionHidden: true,
            });
            await expect(page.locator('body')).toHaveAttribute('data-explorer-file-description-hidden', 'true');
            await expect(page.locator('body')).toHaveAttribute('data-tab-button-description-hidden', 'true');
            await expect(explorerDescription).toBeHidden();
            await expect(tabDescription).toBeHidden();
            await expect.poll(async () => page.evaluate(() => {
                const tab = document.querySelector('.tab') as HTMLElement;
                return {
                    rowHeight: getComputedStyle(document.documentElement).getPropertyValue('--tab-row-height').trim(),
                    tabHeight: Math.round(tab.getBoundingClientRect().height),
                };
            })).toEqual({
                rowHeight: '32px',
                tabHeight: 32,
            });
        },
    );

    test(
        '各設定行のデフォルトボタンで個別に初期値へ戻せること',
        async ({ page, mockFileSystem }) => {
            await openSettingsTabAsync(page);

            const themeResetButton = page.locator('.settings-reset-setting-button[data-setting-key="theme"]');
            const dateTimeResetButton = page.locator('.settings-reset-setting-button[data-setting-key="exportValidationDateTime"]');
            const beginColumnResetButton = page.locator('.settings-reset-setting-button[data-setting-key="exportBeginDateColumnName"]');
            const endColumnResetButton = page.locator('.settings-reset-setting-button[data-setting-key="exportEndDateColumnName"]');
            await expect(themeResetButton).toBeVisible();
            await expect(themeResetButton).toBeDisabled();
            await expect(dateTimeResetButton).toBeDisabled();

            await selectThemeAsync(page, 'light');
            await setExportValidationDateTimeAsync(page, '2026-05-10 12:30:45');
            await setExportValidationColumnNamesAsync(page, 'start_at', 'finish_at');
            await waitForSettingsJsonAsync(page, SETTINGS_FILE, {
                theme: 'light',
                exportValidationDateTime: '2026-05-10 12:30:45',
                exportBeginDateColumnName: 'start_at',
                exportEndDateColumnName: 'finish_at',
            });
            await expect(themeResetButton).toBeEnabled();
            await expect(dateTimeResetButton).toBeEnabled();
            await expect(beginColumnResetButton).toBeEnabled();
            await expect(endColumnResetButton).toBeEnabled();

            await themeResetButton.click();

            await waitForSettingsJsonAsync(page, SETTINGS_FILE, {
                exportValidationDateTime: '2026-05-10 12:30:45',
                exportBeginDateColumnName: 'start_at',
                exportEndDateColumnName: 'finish_at',
            });
            await expect(page.locator('body')).toHaveAttribute('data-theme', 'dark');
            await expect(page.locator('.settings-panel .settings-dropdown-trigger')).toHaveText(/ダーク/);
            await expect(page.locator('.settings-export-validation-datetime-input')).toHaveValue('2026-05-10 12:30:45');
            await expect(themeResetButton).toBeDisabled();
            await expect(dateTimeResetButton).toBeEnabled();

            await beginColumnResetButton.click();

            await waitForSettingsJsonAsync(page, SETTINGS_FILE, {
                exportValidationDateTime: '2026-05-10 12:30:45',
                exportEndDateColumnName: 'finish_at',
            });
            await expect(page.locator('.settings-export-begin-date-column-input')).toHaveValue('export_begin_date');
            await expect(page.locator('.settings-export-end-date-column-input')).toHaveValue('finish_at');
            await expect(beginColumnResetButton).toBeDisabled();
            await expect(endColumnResetButton).toBeEnabled();

            await endColumnResetButton.click();
            await waitForSettingsJsonAsync(page, SETTINGS_FILE, {
                exportValidationDateTime: '2026-05-10 12:30:45',
            });
            await expect(page.locator('.settings-export-end-date-column-input')).toHaveValue('export_end_date');

            await dateTimeResetButton.click();
            await waitForSettingsJsonAsync(page, SETTINGS_FILE, {});
            await expect(page.locator('.settings-export-validation-datetime-input')).toHaveValue('');
            await expect(page.locator('.settings-export-begin-date-column-input')).toHaveValue('export_begin_date');
            await expect(page.locator('.settings-export-end-date-column-input')).toHaveValue('export_end_date');
            await expect(dateTimeResetButton).toBeDisabled();
        },
    );

    test(
        'Ctrl+ZとCtrl+Yで設定変更をUndo/Redoできること',
        async ({ page, mockFileSystem }) => {
            await openSettingsTabAsync(page);

            await selectThemeAsync(page, 'light');
            await page.locator('.settings-export-begin-date-column-input').fill('start_at');
            await page.locator('.settings-export-begin-date-column-input').blur();
            await waitForSettingsJsonAsync(page, SETTINGS_FILE, {
                theme: 'light',
                exportBeginDateColumnName: 'start_at',
            });

            await page.keyboard.press('Control+Z');
            await waitForSettingsJsonAsync(page, SETTINGS_FILE, {
                theme: 'light',
            });
            await expect(page.locator('body')).toHaveAttribute('data-theme', 'light');
            await expect(page.locator('.settings-export-begin-date-column-input')).toHaveValue('export_begin_date');

            await page.keyboard.press('Control+Z');
            await waitForSettingsJsonAsync(page, SETTINGS_FILE, {});
            await expect(page.locator('body')).toHaveAttribute('data-theme', 'dark');
            await expect(page.locator('.settings-panel .settings-dropdown-trigger')).toHaveText(/ダーク/);

            await page.keyboard.press('Control+Y');
            await waitForSettingsJsonAsync(page, SETTINGS_FILE, {
                theme: 'light',
            });
            await expect(page.locator('body')).toHaveAttribute('data-theme', 'light');

            await page.keyboard.press('Control+Y');
            await waitForSettingsJsonAsync(page, SETTINGS_FILE, {
                theme: 'light',
                exportBeginDateColumnName: 'start_at',
            });
            await expect(page.locator('.settings-export-begin-date-column-input')).toHaveValue('start_at');
        },
    );

    test(
        '保存済みJSON内のデフォルト値キーは保存時に削除され、未設定項目はデフォルト値で表示されること',
        async ({ page }) => {
            const fs = createDefaultFileSystem();
            fs[SETTINGS_FILE] = JSON.stringify({
                theme: 'dark',
                tabWrapEnabled: false,
                exportBeginDateColumnName: 'export_begin_date',
                exportEndDateColumnName: 'finish_at',
            });
            await installMockApiAsync(page, fs);
            await page.goto('/');
            await openSettingsTabAsync(page);

            await expect(page.locator('.settings-panel .settings-dropdown-trigger')).toHaveText(/ダーク/);
            await expect(page.locator('.settings-tab-wrap-checkbox')).not.toBeChecked();
            await expect(page.locator('.settings-export-begin-date-column-input')).toHaveValue('export_begin_date');
            await expect(page.locator('.settings-export-end-date-column-input')).toHaveValue('finish_at');

            const settingsTabButton = page.locator('.tab-button').filter({ hasText: '設定' });
            await settingsTabButton.click();
            await page.keyboard.press('Control+s');

            await page.waitForFunction(
                ({ path }) => {
                    const raw = (window as unknown as { __mockFs: Record<string, string> }).__mockFs[path];
                    if (typeof raw !== 'string') return false;
                    try {
                        const parsed = JSON.parse(raw) as Record<string, unknown>;
                        return Object.keys(parsed).length === 1
                            && parsed.exportEndDateColumnName === 'finish_at';
                    } catch {
                        return false;
                    }
                },
                { path: SETTINGS_FILE },
                { timeout: 5000 },
            );
        },
    );

    // ---------------------------------------------------------------------------
    // テスト8: 起動時に .masterdataeditor/settings.json からテーマが読み込まれること
    // ---------------------------------------------------------------------------
    test(
        '起動時に.masterdataeditor/settings.jsonが存在すればそのテーマが適用されること',
        async ({ page }) => {
            const fs = createDefaultFileSystem();
            fs[SETTINGS_FILE] = JSON.stringify({ theme: 'light', tabWrapEnabled: false });
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
    // テスト10: reload 後も .masterdataeditor/settings.json からテーマが維持されること
    // ---------------------------------------------------------------------------
    test(
        'テーマ変更後にlocalStorageを空にしてreloadしても.masterdataeditor/settings.jsonからテーマが復元されること',
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
            }, { path: SETTINGS_FILE, data: JSON.stringify({ theme: 'light', tabWrapEnabled: false }) });
            await waitForSettingsThemeAsync(page, 'light');

            await page.evaluate((storageKey: string) => {
                localStorage.removeItem(storageKey);
            }, THEME_STORAGE_KEY);

            await page.reload();

            await expect(page.locator('body')).toHaveAttribute('data-theme', 'light');
        },
    );

    test(
        '出力フィルター時刻を変更すると.masterdataeditor/settings.jsonへ保存されること',
        async ({ page, mockFileSystem }) => {
            await openSettingsTabAsync(page);

            const input = page.locator('.settings-export-validation-datetime-input');
            await expect(input).toBeVisible();

            await setExportValidationDateTimeAsync(page, '2026-05-10 12:30:45');
            await waitForSettingsExportValidationDateTimeAsync(page, '2026-05-10 12:30:45');

            const settingsJson = await readMockFileAsync(page, SETTINGS_FILE);
            expect(JSON.parse(settingsJson)).toEqual({
                exportValidationDateTime: '2026-05-10 12:30:45',
            });
        },
    );

    test(
        '出力フィルター時刻は秒入力付きの自作カレンダーで指定できること',
        async ({ page, mockFileSystem }) => {
            await openSettingsTabAsync(page);

            const picker = page.locator('.settings-export-validation-date-time-picker');
            const input = picker.locator('.settings-export-validation-datetime-input');
            await expect(input).toBeVisible();
            await expect(input).toHaveAttribute('type', 'text');

            await setExportValidationDateTimeAsync(page, '2026-05-10 12:30:45');
            await picker.locator('.date-time-picker-toggle').click();
            const popover = picker.locator('.date-time-picker-popover');
            await expect(popover).toBeVisible();
            await expect(popover.locator('.date-time-picker-day')).toHaveCount(42);
            const secondInput = popover.locator('.date-time-picker-second-input');
            await expect(secondInput).toBeVisible();
            await expect(secondInput).toHaveAttribute('type', 'text');
            await expect(secondInput).toHaveValue('45');
            await expect(popover.locator('.date-time-picker-apply')).toHaveCount(0);

            await secondInput.fill('46');
            await waitForSettingsExportValidationDateTimeAsync(page, '2026-05-10 12:30:46');
        },
    );

    test(
        '出力フィルター時刻は数字入力中に区切り記号を自動挿入すること',
        async ({ page, mockFileSystem }) => {
            await openSettingsTabAsync(page);

            const input = page.locator('.settings-export-validation-datetime-input');
            await input.fill('');
            await input.focus();
            await page.keyboard.type('20260510123445');

            await expect(input).toHaveValue('2026-05-10 12:34:45');
            await input.blur();
            await waitForSettingsExportValidationDateTimeAsync(page, '2026-05-10 12:34:45');
        },
    );

    test(
        '出力フィルター時刻は途中入力で後続の桁をずらさず上書きすること',
        async ({ page, mockFileSystem }) => {
            await openSettingsTabAsync(page);

            const input = page.locator('.settings-export-validation-datetime-input');
            await setExportValidationDateTimeAsync(page, '2026-05-10 12:34:45');
            await input.focus();
            await input.evaluate((element) => {
                const textInput = element as HTMLInputElement;
                textInput.setSelectionRange(5, 5);
            });
            await page.keyboard.type('11');

            await expect(input).toHaveValue('2026-11-10 12:34:45');
            await input.blur();
            await waitForSettingsExportValidationDateTimeAsync(page, '2026-11-10 12:34:45');
        },
    );

    test(
        '出力フィルター時刻は日付末尾のカーソル位置で空白を補完すること',
        async ({ page, mockFileSystem }) => {
            await openSettingsTabAsync(page);

            const input = page.locator('.settings-export-validation-datetime-input');
            await input.focus();
            await input.evaluate((element) => {
                const textInput = element as HTMLInputElement;
                textInput.value = '2026-05-10';
                textInput.setSelectionRange(10, 10);
            });
            await page.keyboard.press('ArrowRight');

            await expect(input).toHaveValue('2026-05-10 ');
            await expect(input).toHaveJSProperty('selectionStart', 11);
        },
    );

    test(
        '出力フィルター時刻はありえない月を入力できないこと',
        async ({ page, mockFileSystem }) => {
            await openSettingsTabAsync(page);

            const input = page.locator('.settings-export-validation-datetime-input');
            await input.fill('');
            await input.focus();
            await page.keyboard.type('2026');
            await expect(input).toHaveValue('2026-');

            await page.keyboard.type('3');
            await expect(input).toHaveValue('2026-');

            await page.keyboard.type('0');
            await expect(input).toHaveValue('2026-0');
        },
    );

    test(
        'export期間列名を変更すると.masterdataeditor/settings.jsonへ保存されること',
        async ({ page, mockFileSystem }) => {
            await openSettingsTabAsync(page);

            const beginInput = page.locator('.settings-export-begin-date-column-input');
            const endInput = page.locator('.settings-export-end-date-column-input');
            await expect(beginInput).toBeVisible();
            await expect(endInput).toBeVisible();
            await expect(beginInput).toHaveValue('export_begin_date');
            await expect(endInput).toHaveValue('export_end_date');

            await setExportValidationColumnNamesAsync(page, 'start_at', 'finish_at');
            await waitForSettingsExportValidationColumnNamesAsync(page, 'start_at', 'finish_at');

            const settingsJson = await readMockFileAsync(page, SETTINGS_FILE);
            expect(JSON.parse(settingsJson)).toEqual({
                exportBeginDateColumnName: 'start_at',
                exportEndDateColumnName: 'finish_at',
            });
        },
    );

    test(
        '変更したexport期間列名だけが.masterdataeditor/settings.jsonへ保存されること',
        async ({ page, mockFileSystem }) => {
            await openSettingsTabAsync(page);

            const beginInput = page.locator('.settings-export-begin-date-column-input');
            const beginLabel = page.locator('.settings-label[data-setting-key="exportBeginDateColumnName"]');
            const endLabel = page.locator('.settings-label[data-setting-key="exportEndDateColumnName"]');

            await beginInput.fill('start_at');
            await beginInput.blur();

            await page.waitForFunction(
                ({ path }) => {
                    const raw = (window as unknown as { __mockFs: Record<string, string> }).__mockFs[path];
                    if (typeof raw !== 'string') return false;
                    try {
                        const parsed = JSON.parse(raw) as Record<string, unknown>;
                        return parsed.exportBeginDateColumnName === 'start_at'
                            && !Object.prototype.hasOwnProperty.call(parsed, 'exportEndDateColumnName');
                    } catch {
                        return false;
                    }
                },
                { path: SETTINGS_FILE },
                { timeout: 5000 },
            );

            await expect(beginLabel).toHaveAttribute('data-default-different', 'true');
            await expect(endLabel).toHaveAttribute('data-default-different', 'false');
            expect(JSON.parse(await readMockFileAsync(page, SETTINGS_FILE))).toEqual({
                exportBeginDateColumnName: 'start_at',
            });
        },
    );
});
