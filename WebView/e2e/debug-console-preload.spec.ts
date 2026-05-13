import { test, expect } from './fixtures/test';
import { installMockApiAsync, type MockFileSystem } from './fixtures/mock-api';

function createTallApiDetailFileSystem(): MockFileSystem {
    const rows = Array.from({ length: 180 }, (_, index) => {
        const id = index + 1;
        return `${id},name_${id}_${'x'.repeat(80)},${id * 10}`;
    });
    return {
        'schema/large.json': JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int' },
                { key: 1, name: 'name', type: 'string' },
                { key: 2, name: 'value', type: 'int' },
            ],
            primary_key: ['id'],
        }),
        'data/large.csv': [
            'id,name,value',
            ...rows,
        ].join('\n'),
        'user:bookmarks.json': '[]',
        'plugins/.gitkeep': '',
    };
}

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

        await expect(debugConsole.locator('.debug-console-row .debug-console-col-label', { hasText: 'find_files (schema)' }).first()).toBeVisible();
        await expect(debugConsole.locator('.debug-console-row .debug-console-col-label', { hasText: 'find_files (data)' }).first()).toBeVisible();
        await expect(debugConsole.locator('.debug-console-row .debug-console-col-label', { hasText: 'read_file (schema/test.json)' }).first()).toBeVisible();
        await expect(debugConsole.locator('.debug-console-row .debug-console-col-label', { hasText: 'read_file (data/test.csv)' }).first()).toBeVisible();
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
        const preloadErrorRows = debugConsole.locator('.debug-console-row.debug-console-row-error .debug-console-col-label', { hasText: /^(find_files|read_file)( \(.+\))?$/ });
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
        await expect(findFilesRow).toHaveClass(/debug-console-row-selected/);
        const selectedBackgroundColor = await page.evaluate(() => {
            const color = getComputedStyle(document.body).getPropertyValue('--panel-item-selected-bg').trim();
            const element = document.createElement('div');
            element.style.backgroundColor = color;
            document.body.appendChild(element);
            const normalized = getComputedStyle(element).backgroundColor;
            element.remove();
            return normalized;
        });
        await expect(findFilesRow).toHaveCSS('background-color', selectedBackgroundColor);

        await expect(page.locator('.tab-button', { hasText: 'API 詳細' })).toBeVisible();
        const detailTab = page.locator('.debug-api-detail-tab');
        await expect(detailTab).toBeVisible();
        await expect(detailTab.locator('.debug-api-detail-pre').first()).toHaveCSS('overflow-y', 'scroll');
        const lineNumbers = detailTab.locator('.debug-api-detail-line-numbers');
        await expect(lineNumbers).toHaveCount(2);
        await expect(lineNumbers.first()).toHaveCSS('text-align', 'right');
        await expect(lineNumbers.nth(1)).toHaveCSS('text-align', 'right');
        const lineNumberMetrics = await detailTab.evaluate(() => {
            return Array.from(document.querySelectorAll<HTMLElement>('.debug-api-detail-section')).map(section => {
                const numbers = section.querySelector<HTMLElement>('.debug-api-detail-line-numbers');
                const code = section.querySelector<HTMLElement>('.debug-api-detail-code');
                if (numbers === null || code === null) throw new Error('API詳細の行番号要素が見つかりません');
                return {
                    firstLineNumber: numbers.textContent?.split('\n')[0],
                    lineNumberCount: numbers.textContent?.split('\n').length,
                    codeLineCount: code.textContent?.split('\n').length,
                };
            });
        });
        expect(lineNumberMetrics).toHaveLength(2);
        for (const metric of lineNumberMetrics) {
            expect(metric.firstLineNumber).toBe('1');
            expect(metric.lineNumberCount).toBe(metric.codeLineCount);
        }
        await expect(detailTab).toContainText('find_files_request');
        await expect(detailTab).toContainText('find_files_response');
        await expect(detailTab).toContainText('"success": true');

        const writeFileRow = debugConsole.locator('.debug-console-row', {
            has: page.locator('.debug-console-col-label', { hasText: 'write_file (user:ui-state.json)' }),
        }).first();
        await expect(writeFileRow).toBeVisible();
        await writeFileRow.click();
        await expect(findFilesRow).not.toHaveClass(/debug-console-row-selected/);
        await expect(writeFileRow).toHaveClass(/debug-console-row-selected/);
        await expect(writeFileRow).toHaveCSS('background-color', selectedBackgroundColor);
        await expect(detailTab).toContainText('"data": {');
        await expect(detailTab).toContainText('"bottomPanel": {');
    });

    test('キャッシュヒット行クリックでリクエストとレスポンスを一時タブで確認できる', async ({ page, mockFileSystem }) => {
        await page.locator('.status-bar-badge').click();
        await page.locator('.bottom-panel-tab', { hasText: 'DEBUG CONSOLE' }).click();

        const debugConsole = page.locator('.debug-console');
        await expect(debugConsole).toBeVisible();

        const cacheRow = debugConsole.locator('.debug-console-row', {
            has: page.locator('.debug-console-col-label', { hasText: 'find_files (schema) (cache)' }),
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

    test('API詳細のrequest/responseはそれぞれ独立して縦スクロールできる', async ({ page }) => {
        await installMockApiAsync(page, createTallApiDetailFileSystem());
        await page.goto('/');
        await page.waitForFunction(() => Boolean((window as unknown as { __editorApiBridge?: unknown }).__editorApiBridge));

        await page.evaluate(() => {
            const webview = (window as unknown as { chrome: { webview: { postMessage(message: string): void } } }).chrome.webview;
            const extraLines = Array.from({ length: 160 }, (_, index) => ({
                line: index + 1,
                text: 'request debug payload ' + 'x'.repeat(100),
            }));
            webview.postMessage(JSON.stringify({
                type: 'editor_api_request',
                requestId: 'scroll-detail-1',
                method: 'data.readTableDataAsync',
                params: {
                    tableName: 'large',
                    extraLines,
                },
            }));
        });

        await page.locator('.status-bar-badge').click();
        await page.locator('.bottom-panel-tab', { hasText: 'DEBUG CONSOLE' }).click();

        const debugConsole = page.locator('.debug-console');
        await expect(debugConsole).toBeVisible();

        const mcpRow = debugConsole.locator('.debug-console-row', {
            has: page.locator('.debug-console-col-label', { hasText: '[MCP] data.readTableDataAsync' }),
        }).last();
        await expect(mcpRow).toBeVisible();
        await mcpRow.click();

        const detailTab = page.locator('.debug-api-detail-tab');
        await expect(detailTab).toBeVisible();
        const preBlocks = detailTab.locator('.debug-api-detail-pre');
        await expect(preBlocks).toHaveCount(2);
        await expect(preBlocks.first()).toHaveCSS('overflow-y', 'scroll');
        await expect(preBlocks.nth(1)).toHaveCSS('overflow-y', 'scroll');

        const metrics = await detailTab.evaluate(() => {
            const preElements = Array.from(document.querySelectorAll<HTMLElement>('.debug-api-detail-tab .debug-api-detail-pre'));
            const lineNumberElements = Array.from(document.querySelectorAll<HTMLElement>('.debug-api-detail-tab .debug-api-detail-line-numbers'));
            const codeElements = Array.from(document.querySelectorAll<HTMLElement>('.debug-api-detail-tab .debug-api-detail-code'));
            const outer = document.querySelector<HTMLElement>('.editor-left-pane');
            if (preElements.length !== 2 || lineNumberElements.length !== 2 || codeElements.length !== 2 || outer === null) throw new Error('API詳細のスクロール要素が見つかりません');
            return {
                requestCanScroll: preElements[0].scrollHeight > preElements[0].clientHeight,
                responseCanScroll: preElements[1].scrollHeight > preElements[1].clientHeight,
                requestLineNumbersFillContent: lineNumberElements[0].offsetHeight >= codeElements[0].offsetHeight,
                responseLineNumbersFillContent: lineNumberElements[1].offsetHeight >= codeElements[1].offsetHeight,
                outerOverflow: outer.scrollHeight - outer.clientHeight,
            };
        });
        expect(metrics.requestCanScroll).toBe(true);
        expect(metrics.responseCanScroll).toBe(true);
        expect(metrics.requestLineNumbersFillContent).toBe(true);
        expect(metrics.responseLineNumbersFillContent).toBe(true);
        expect(metrics.outerOverflow).toBeLessThanOrEqual(1);

        const scrollState = await detailTab.evaluate(() => {
            const [requestPre, responsePre] = Array.from(document.querySelectorAll<HTMLElement>('.debug-api-detail-tab .debug-api-detail-pre'));
            const outer = document.querySelector<HTMLElement>('.editor-left-pane');
            if (requestPre === undefined || responsePre === undefined || outer === null) throw new Error('API詳細のスクロール要素が見つかりません');

            requestPre.scrollTop = 0;
            responsePre.scrollTop = 0;
            outer.scrollTop = 0;

            requestPre.scrollTop = 120;
            const afterRequestScroll = {
                requestTop: requestPre.scrollTop,
                responseTop: responsePre.scrollTop,
                outerTop: outer.scrollTop,
            };

            responsePre.scrollTop = 180;
            return {
                afterRequestScroll,
                requestTopAfterResponseScroll: requestPre.scrollTop,
                responseTopAfterResponseScroll: responsePre.scrollTop,
                outerTopAfterResponseScroll: outer.scrollTop,
            };
        });
        expect(scrollState.afterRequestScroll.requestTop).toBeGreaterThan(0);
        expect(scrollState.afterRequestScroll.responseTop).toBe(0);
        expect(scrollState.afterRequestScroll.outerTop).toBe(0);
        expect(scrollState.responseTopAfterResponseScroll).toBeGreaterThan(0);
        expect(scrollState.requestTopAfterResponseScroll).toBe(scrollState.afterRequestScroll.requestTop);
        expect(scrollState.outerTopAfterResponseScroll).toBe(0);
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
