import { test, expect } from './fixtures/test';

// =============================================================================
// BUG: 初回起動時の preload API通信が DEBUG CONSOLE に記録されない
//
// 現状の問題:
//   main.ts で preloadAllFilesAsync() が BackgroundTaskTracker の設定より先に
//   実行されるため、起動時の find_files / read_file 呼び出しが
//   DebugConsole に記録されない。
//
// 期待動作:
//   DebugConsole と BackgroundTaskTracker の生成を preloadAllFilesAsync() の
//   前に移動し、起動時の全API通信が DEBUG CONSOLE に記録されること。
//
// テスト対象:
//   WebView/src/app/main.ts — 初期化順序
//   WebView/src/panels/debug-console.ts — DebugConsole
//   WebView/src/app/background-task-tracker.ts — BackgroundTaskTracker
// =============================================================================

test.describe('DEBUG CONSOLE preload記録', () => {

    test('初回起動時のpreload API通信がDEBUG CONSOLEに記録されている', async ({ page, mockFileSystem }) => {
        // BottomPanel はデフォルトで非表示のため、"DEBUG CONSOLE" タブボタンをクリックして開く。
        // BottomPanel のタブボタンは .bottom-panel-tab というクラスで、テキスト "DEBUG CONSOLE" を持つ。
        // ただし BottomPanel 自体が display:none のため、まず表示させる必要がある。
        // StatusBar のエラーバッジをクリックして PROBLEMS タブで BottomPanel を表示し、
        // その後 "DEBUG CONSOLE" タブに切り替える。
        const errorBadge = page.locator('.status-bar-badge');
        await errorBadge.click();

        // BottomPanel が表示されたことを確認する
        const bottomPanel = page.locator('.bottom-panel');
        await expect(bottomPanel).toBeVisible();

        // "DEBUG CONSOLE" タブをクリックして切り替える
        const debugTab = page.locator('.bottom-panel-tab', { hasText: 'DEBUG CONSOLE' });
        await debugTab.click();

        // DEBUG CONSOLE パネルが表示されていることを確認する
        const debugConsole = page.locator('.debug-console');
        await expect(debugConsole).toBeVisible();

        // preload 時のAPI通信ログが記録されていることを検証する。
        // デフォルトファイルシステム（schema/test.json, data/test.csv）の場合、
        // preloadAllFilesAsync() は以下の4回のAPI呼び出しを行う:
        //   1. find_files (schema)
        //   2. find_files (data)
        //   3. read_file (schema/test.json)
        //   4. read_file (data/test.csv)
        // これらが .debug-console-row として記録されていなければならない。
        const rows = debugConsole.locator('.debug-console-row');
        const rowCount = await rows.count();
        expect(rowCount, 'preload時のAPI通信ログが1件以上記録されていること').toBeGreaterThanOrEqual(4);

        // find_files ラベルを持つエントリが存在すること
        const findFilesLabels = debugConsole.locator('.debug-console-row .debug-console-col-label', { hasText: 'find_files' });
        await expect(findFilesLabels.first()).toBeVisible();
        const findFilesCount = await findFilesLabels.count();
        expect(findFilesCount, 'find_files のAPI呼び出しが2回記録されていること').toBeGreaterThanOrEqual(2);

        // read_file ラベルを持つエントリが存在すること
        const readFileLabels = debugConsole.locator('.debug-console-row .debug-console-col-label', { hasText: 'read_file' });
        await expect(readFileLabels.first()).toBeVisible();
        const readFileCount = await readFileLabels.count();
        expect(readFileCount, 'read_file のAPI呼び出しが2回以上記録されていること').toBeGreaterThanOrEqual(2);
    });

    test('preload時のAPI通信はすべて成功ステータスで記録されている', async ({ page, mockFileSystem }) => {
        // BottomPanel を開いて DEBUG CONSOLE タブに切り替える
        await page.locator('.status-bar-badge').click();
        await page.locator('.bottom-panel-tab', { hasText: 'DEBUG CONSOLE' }).click();

        const debugConsole = page.locator('.debug-console');
        await expect(debugConsole).toBeVisible();

        // preload 時のエントリがすべて成功であることを確認する。
        // 成功行は debug-console-row-success クラスを持つ。
        const successRows = debugConsole.locator('.debug-console-row.debug-console-row-success');
        const successCount = await successRows.count();
        expect(successCount, 'preload時の全API通信が成功ステータスであること').toBeGreaterThanOrEqual(4);

        // preload 由来のエントリ（find_files, read_file）にエラーがないことを確認する。
        // git_status 等の preload 以外のAPI呼び出しはテスト環境でエラーになり得るため除外する。
        const preloadErrorRows = debugConsole.locator('.debug-console-row.debug-console-row-error .debug-console-col-label', { hasText: /^(find_files|read_file)$/ });
        const preloadErrorCount = await preloadErrorRows.count();
        expect(preloadErrorCount, 'preload API通信にエラーステータスのエントリがないこと').toBe(0);
    });

    test('API通信行クリックでリクエストとレスポンスを一時タブで確認できる', async ({ page, mockFileSystem }) => {
        await page.locator('.status-bar-badge').click();
        await page.locator('.bottom-panel-tab', { hasText: 'DEBUG CONSOLE' }).click();

        const debugConsole = page.locator('.debug-console');
        await expect(debugConsole).toBeVisible();

        const findFilesRow = debugConsole.locator('.debug-console-row', {
            has: page.locator('.debug-console-col-label', { hasText: 'find_files' }),
        }).first();
        await expect(findFilesRow.locator('.debug-console-detail-button')).toHaveCount(0);
        await findFilesRow.click();

        await expect(page.locator('.tab-button', { hasText: 'API 詳細' })).toBeVisible();
        const detailTab = page.locator('.debug-api-detail-tab');
        await expect(detailTab).toBeVisible();
        await expect(detailTab.locator('.debug-api-detail-pre').first()).toHaveCSS('overflow-y', 'scroll');
        await expect(detailTab).toContainText('find_files_request');
        await expect(detailTab).toContainText('find_files_response');
        await expect(detailTab).toContainText('"success": true');

        const writeFileRow = debugConsole.locator('.debug-console-row', {
            has: page.locator('.debug-console-col-label', { hasText: 'write_file' }),
        }).first();
        await expect(writeFileRow).toBeVisible();
        await writeFileRow.click();
        await expect(detailTab).toContainText('"data": {');
        await expect(detailTab).toContainText('"bottomPanel": {');
    });

    test('キャッシュヒット行クリックでリクエストとレスポンスを一時タブで確認できる', async ({ page, mockFileSystem }) => {
        await page.locator('.status-bar-badge').click();
        await page.locator('.bottom-panel-tab', { hasText: 'DEBUG CONSOLE' }).click();

        const debugConsole = page.locator('.debug-console');
        await expect(debugConsole).toBeVisible();

        const cacheRow = debugConsole.locator('.debug-console-row', {
            has: page.locator('.debug-console-col-label', { hasText: 'find_files (cache)' }),
        }).first();
        await expect(cacheRow).toBeVisible();
        await expect(cacheRow.locator('.debug-console-detail-button')).toHaveCount(0);
        await cacheRow.click();

        const detailTab = page.locator('.debug-api-detail-tab');
        await expect(detailTab).toBeVisible();
        await expect(detailTab).toContainText('find_files_request');
        await expect(detailTab).toContainText('"directory": "schema"');
        await expect(detailTab).toContainText('find_files_response');
        await expect(detailTab).toContainText('"cache": true');
        await expect(detailTab).toContainText('"success": true');
    });

    test('validate (engine) 行クリックでリクエストとレスポンスを確認でき、詳細ボタンがない', async ({ page, mockFileSystem }) => {
        await page.locator('.status-bar-badge').click();
        await page.locator('.bottom-panel-tab', { hasText: 'DEBUG CONSOLE' }).click();

        const debugConsole = page.locator('.debug-console');
        await expect(debugConsole).toBeVisible();

        await page.waitForFunction(() => {
            const rows = document.querySelectorAll('.debug-console .debug-console-row');
            const buttons = document.querySelectorAll('.debug-console .debug-console-row .debug-console-detail-button');
            return rows.length > 0 && buttons.length === 0;
        });

        const engineRow = debugConsole.locator('.debug-console-row', {
            has: page.locator('.debug-console-col-label', { hasText: 'validate (engine)' }),
        }).last();
        await expect(engineRow).toBeVisible();
        await engineRow.click();

        const detailTab = page.locator('.debug-api-detail-tab');
        await expect(detailTab).toBeVisible();
        await expect(detailTab).toContainText('validate_engine_request');
        await expect(detailTab).toContainText('"tableData": {');
        await expect(detailTab).toContainText('validate_engine_response');
        await expect(detailTab).toContainText('"success": true');
    });
});
