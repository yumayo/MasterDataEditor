import {test, expect} from './fixtures/test';
import type {Page} from '@playwright/test';
import {installMockApiAsync, readMockFileAsync, type MockFileSystem} from './fixtures/mock-api';

const UI_STATE_FILE = 'user:ui-state.json';

function createViewPluginFileSystem(): MockFileSystem {
    return {
        "schema/test.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                { key: 2, name: "value", type: "int" },
            ],
            primary_key: ["id"],
        }),
        "data/test.csv": [
            "id,name,value",
            "1,item_a,100",
            "2,item_b,200",
            "3,item_c,300",
        ].join("\n"),
        "schema/other.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "value", type: "int" },
            ],
            primary_key: ["id"],
        }),
        "data/other.csv": [
            "id,value",
            "1,10",
        ].join("\n"),
        "plugins/views/summary.js": [
            "window.masterDataEditor.registerViewPlugin({",
            "  id: 'summary',",
            "  apiVersion: 2,",
            "  title: 'Summary View',",
            "  description: 'Counts rows and edits test data',",
            "  async render(container, api) {",
            "    container.dataset.internalEmitType = typeof api.editor.emitTableOpened;",
            "    const editSession = api.view.createEditSession();",
            "    api.view.onSave(() => {",
            "      container.dataset.saved = 'yes';",
            "    });",
            "    const records = await api.tables.get('test').readRecordsAsync();",
            "    const otherRecords = await api.tables.get('other').readRecordsAsync();",
            "    const count = document.createElement('div');",
            "    count.className = 'summary-count';",
            "    count.textContent = String(records ? records.length : 0);",
            "    const dirtyButton = document.createElement('button');",
            "    dirtyButton.className = 'summary-dirty';",
            "    dirtyButton.textContent = 'dirty';",
            "    dirtyButton.addEventListener('click', () => {",
            "      container.dataset.saved = 'no';",
            "      api.view.setDirty(true);",
            "    });",
            "    const button = document.createElement('button');",
            "    button.className = 'summary-edit';",
            "    button.textContent = 'edit';",
            "    button.addEventListener('click', async () => {",
            "      const updated = records ? await editSession.updateRecordAsync(records[0].ref, {value: '999'}) : false;",
            "      if (updated) {",
            "        container.dataset.saved = 'no';",
            "      }",
            "    });",
            "    const stableRefButton = document.createElement('button');",
            "    stableRefButton.className = 'summary-edit-stable-ref';",
            "    stableRefButton.textContent = 'edit stable ref';",
            "    stableRefButton.addEventListener('click', async () => {",
            "      const updated = records ? await editSession.updateRecordAsync(records[1].ref, {value: '777'}) : false;",
            "      container.dataset.stableRefUpdated = updated ? 'yes' : 'no';",
            "    });",
            "    const multipleButton = document.createElement('button');",
            "    multipleButton.className = 'summary-edit-multiple';",
            "    multipleButton.textContent = 'edit multiple tables';",
            "    multipleButton.addEventListener('click', async () => {",
            "      const updated = records && otherRecords ? await Promise.all([",
            "        editSession.updateRecordAsync(records[0].ref, {value: '555'}),",
            "        editSession.updateRecordAsync(otherRecords[0].ref, {value: '888'}),",
            "      ]) : [false];",
            "      container.dataset.multipleUpdated = updated.every(Boolean) ? 'yes' : 'no';",
            "    });",
            "    const notifyButton = document.createElement('button');",
            "    notifyButton.className = 'summary-notify';",
            "    notifyButton.textContent = 'notify';",
            "    notifyButton.addEventListener('click', () => {",
            "      api.notification.show('plugin success notification', 'success');",
            "    });",
            "    const openButton = document.createElement('button');",
            "    openButton.className = 'summary-open-table';",
            "    openButton.textContent = 'open table';",
            "    openButton.addEventListener('click', async () => {",
            "      const opened = await api.edit.openTableAsync('test');",
            "      container.dataset.opened = opened ? 'yes' : 'no';",
            "    });",
            "    container.append(count, dirtyButton, button, stableRefButton, multipleButton, notifyButton, openButton);",
            "    return {dispose: () => editSession.dispose()};",
            "  }",
            "});",
        ].join("\n"),
        "plugins/views/legacy.js": [
            "window.masterDataEditor.registerViewPlugin({",
            "  id: 'legacy',",
            "  title: 'Legacy View',",
            "  async render(container, api) {",
            "    container.dataset.internalEmitType = typeof api.editor.emitTableOpened;",
            "    const data = await api.data.readTableDataAsync('test');",
            "    const marker = document.createElement('div');",
            "    marker.className = 'legacy-count';",
            "    marker.textContent = String(data ? data.rows.length : 0);",
            "    container.appendChild(marker);",
            "  }",
            "});",
        ].join("\n"),
        "user:bookmarks.json": "[]",
    };
}

/** 通信が終わっても render 自体が完了しない状態を、ユーザー操作で決着させる。 */
function createPendingViewPlugin(id: string, title: string): string {
    return `window.masterDataEditor.registerViewPlugin({
        id: ${JSON.stringify(id)}, apiVersion: 2, title: ${JSON.stringify(title)},
        async render(container) {
            const state = document.createElement('div');
            state.className = 'plugin-loading-state';
            state.textContent = '読み込み待機中';
            const complete = document.createElement('button');
            complete.className = 'plugin-complete-loading';
            complete.textContent = '読み込みを完了';
            const fail = document.createElement('button');
            fail.className = 'plugin-fail-loading';
            fail.textContent = '読み込みを失敗';
            container.append(state, complete, fail);
            await new Promise((resolve, reject) => {
                complete.addEventListener('click', () => resolve(), {once: true});
                fail.addEventListener('click', function failPluginLoading() { reject(new Error('PLUGIN_RENDER_FAILED')); }, {once: true});
            });
            state.textContent = '読み込み完了';
        }
    });`;
}

async function openPendingViewPluginAsync(page: Page): Promise<void> {
    const fs = createViewPluginFileSystem();
    fs['plugins/views/summary.js'] = createPendingViewPlugin('summary', 'Summary View');
    fs['plugins/views/legacy.js'] = createPendingViewPlugin('legacy', 'Legacy View');
    await installMockApiAsync(page, fs, true);
    await page.goto('/');
    await openViewPluginPanelAsync(page);
    await page.locator('.view-plugin-item[data-plugin-id="summary"]').click();
    await expect(page.frameLocator('.view-plugin-tab-root[data-view-plugin-id="summary"] iframe').locator('.plugin-loading-state')).toHaveText('読み込み待機中');
}

async function openViewPluginPanelAsync(page: Page): Promise<void> {
    await page.locator('.activity-bar-item[data-panel="views"]').click();
    await expect(page.locator('.view-plugin-panel')).toBeVisible();
}

async function waitForSavedViewTabAsync(page: Page): Promise<void> {
    await page.waitForFunction((path) => {
        const raw = (window as unknown as {__mockFs: Record<string, string>}).__mockFs[path];
        if (typeof raw !== 'string') return false;
        try {
            const parsed = JSON.parse(raw) as {
                tabs?: {
                    open?: Array<{
                        name?: string;
                        diff?: unknown;
                        view?: {pluginId?: string} | null;
                        editorTable?: unknown;
                    }>;
                    active?: string | null;
                };
            };
            const tab = parsed.tabs?.open?.find(item => item.name === 'View: Summary View');
            return parsed.tabs?.active === 'View: Summary View'
                && tab?.diff === null
                && tab?.view?.pluginId === 'summary'
                && tab?.editorTable === null;
        } catch {
            return false;
        }
    }, UI_STATE_FILE, {timeout: 5000});
}

test.describe('Viewプラグイン', () => {
    test('プラグインの読み込み中は右下にバックグラウンドの進行と名前を表示する', async ({page}) => {
        await openPendingViewPluginAsync(page);

        const indicator = page.getByRole('button', {name: '実行中のバックグラウンド処理'});
        await expect(indicator).toBeVisible();
        await expect(indicator.locator('.status-bar-background-spinner')).toBeVisible();
        await expect(indicator.locator('.status-bar-background-count')).toHaveText('1');
        await indicator.click();
        await expect(page.locator('.status-bar-background-popover')).toBeVisible();
        await expect(page.locator('.status-bar-background-popover-item')).toHaveText(['プラグイン読み込み中: Summary View']);
        // 待機中のまま終え、autoDump に右下のスピナーとタスク名の見た目を残す。
    });

    test('プラグインの読み込みが完了するとバックグラウンドの進行が消える', async ({page}) => {
        await openPendingViewPluginAsync(page);
        const indicator = page.locator('.status-bar-background-indicator');
        await expect(indicator).toBeVisible();
        await indicator.click();
        await expect(page.locator('.status-bar-background-popover-item')).toHaveText(['プラグイン読み込み中: Summary View']);

        const view = page.frameLocator('.view-plugin-tab-root[data-view-plugin-id="summary"] iframe');
        await view.locator('.plugin-complete-loading').click();

        await expect(view.locator('.plugin-loading-state')).toHaveText('読み込み完了');
        await expect(indicator).toBeHidden();
        await expect(page.locator('.status-bar-background-popover')).toBeHidden();
        await expect(page.locator('.status-bar-background-popover-item')).toHaveCount(0);
    });

    test('プラグインの読み込みに失敗するとエラー通知を出してバックグラウンドの進行を終了する', async ({page}) => {
        await openPendingViewPluginAsync(page);
        const indicator = page.locator('.status-bar-background-indicator');
        await expect(indicator).toBeVisible();
        await expect(indicator.locator('.status-bar-background-count')).toHaveText('1');

        await page.frameLocator('.view-plugin-tab-root[data-view-plugin-id="summary"] iframe').locator('.plugin-fail-loading').click();

        await expect(page.locator('.notification-toast-error')).toContainText('Viewプラグインの実行に失敗しました');
        await expect(page.locator('.view-plugin-tab-root[data-view-plugin-id="summary"] iframe')).toHaveCount(0);
        await expect(indicator).toBeHidden();
        await expect(page.locator('.status-bar-background-popover-item')).toHaveCount(0);

        const errorEntry = page.locator('.debug-console-row-error', {has: page.locator('.debug-console-col-label', {hasText: /^Viewプラグインの実行に失敗しました$/})});
        await expect(errorEntry).toHaveCount(1);
        await page.locator('.status-bar-badge').click();
        await page.locator('.bottom-panel-tab', {hasText: 'DEBUG CONSOLE'}).click();
        await errorEntry.click();
        const stack = page.locator('.debug-api-detail-stack-trace .debug-api-detail-code');
        await expect(stack).toContainText('Error: PLUGIN_RENDER_FAILED');
        await expect(stack).toContainText('failPluginLoading');
        await expect(page.locator('.debug-console-row-error', {has: page.locator('.debug-console-col-label', {hasText: /^プラグイン読み込み中: Summary View$/})})).toHaveCount(0);
    });

    test('読み込み中のViewを閉じて開き直しても別Viewのバックグラウンド処理を維持する', async ({page}) => {
        await openPendingViewPluginAsync(page);
        await page.locator('.view-plugin-item[data-plugin-id="legacy"]').click();
        const legacy = page.frameLocator('.view-plugin-tab-root[data-view-plugin-id="legacy"] iframe');
        await expect(legacy.locator('.plugin-loading-state')).toHaveText('読み込み待機中');
        const indicator = page.locator('.status-bar-background-indicator');
        await expect(indicator.locator('.status-bar-background-count')).toHaveText('2');
        await indicator.click();
        await expect(page.locator('.status-bar-background-popover-item')).toHaveText(['プラグイン読み込み中: Summary View', 'プラグイン読み込み中: Legacy View']);

        await page.locator('.tab-button').filter({has: page.locator('.tab-button-name', {hasText: /^View: Summary View$/})}).locator('.tab-button-close').click();
        await expect(page.locator('.view-plugin-tab-root[data-view-plugin-id="summary"]')).toHaveCount(0);
        await expect(indicator).toBeVisible();
        await expect(indicator.locator('.status-bar-background-count')).toHaveText('1');
        await expect(page.locator('.status-bar-background-popover-item')).toHaveText(['プラグイン読み込み中: Legacy View']);

        await page.locator('.view-plugin-item[data-plugin-id="summary"]').click();
        const summary = page.frameLocator('.view-plugin-tab-root[data-view-plugin-id="summary"] iframe');
        await expect(summary.locator('.plugin-loading-state')).toHaveText('読み込み待機中');
        await expect(indicator.locator('.status-bar-background-count')).toHaveText('2');
        await summary.locator('.plugin-complete-loading').click();
        await expect(summary.locator('.plugin-loading-state')).toHaveText('読み込み完了');
        await expect(indicator).toBeVisible();
        await expect(indicator.locator('.status-bar-background-count')).toHaveText('1');
        await expect(page.locator('.status-bar-background-popover-item')).toHaveText(['プラグイン読み込み中: Legacy View']);

        await page.locator('.view-plugin-item[data-plugin-id="legacy"]').click();
        await legacy.locator('.plugin-complete-loading').click();
        await expect(legacy.locator('.plugin-loading-state')).toHaveText('読み込み完了');
        await expect(indicator).toBeHidden();
        await expect(page.locator('.status-bar-background-popover-item')).toHaveCount(0);
    });

    for (const unavailable of ['削除済み', '登録失敗']) {
        test('保存済みのアクティブViewが' + unavailable + 'なら起動時に通常テーブルを表示する', async ({page}) => {
            const fs = createViewPluginFileSystem();
            if (unavailable === '削除済み') delete fs['plugins/views/summary.js'];
            else fs['plugins/views/summary.js'] = "throw new Error('VIEW_REGISTRATION_FAILED');";
            fs[UI_STATE_FILE] = JSON.stringify({
                tabs: {
                    open: [
                        {name: 'test', description: null, diff: null, view: null},
                        {name: 'View: Summary View', description: null, diff: null, view: {pluginId: 'summary'}},
                    ],
                    active: 'View: Summary View',
                },
            });
            await installMockApiAsync(page, fs, true);
            await page.goto('/');

            await expect(page.locator('.tab-button-name', {hasText: /^View: Summary View$/})).toHaveCount(0);
            await expect(page.locator('.tab-button-active .tab-button-name')).toHaveText('test');
            await expect(page.locator('.editor-left-pane .tab-wrapper[data-tab-name="test"] .editor-table')).toBeVisible();
        });
    }

    test('未信頼中に開いた復元Viewタブを信頼後に一覧から再び開くと描画する', async ({page}) => {
        const fs = createViewPluginFileSystem();
        fs[UI_STATE_FILE] = JSON.stringify({
            tabs: {
                open: [
                    {name: 'test', description: null, diff: null, view: null},
                    {name: 'View: Summary View', description: null, diff: null, view: {pluginId: 'summary'}},
                ],
                active: 'test',
            },
        });
        await installMockApiAsync(page, fs, false);
        await page.goto('/');
        await expect(page.locator('.tab-button-active .tab-button-name')).toHaveText('test');

        await page.locator('.tab-button').filter({has: page.locator('.tab-button-name', {hasText: /^View: Summary View$/})}).click();
        await expect(page.locator('.tab-button-active .tab-button-name')).toHaveText('View: Summary View');
        await expect(page.locator('.view-plugin-sandbox-frame')).toHaveCount(0);

        await page.evaluate(() => (window as unknown as {__changeWorkspaceTrustForTest(value: boolean): void}).__changeWorkspaceTrustForTest(true));
        await openViewPluginPanelAsync(page);
        await page.locator('.view-plugin-item[data-plugin-id="summary"]').click();

        const viewFrame = page.locator('.view-plugin-tab-root[data-view-plugin-id="summary"] iframe');
        await expect(viewFrame).toHaveAttribute('sandbox', 'allow-scripts');
        await expect(viewFrame.contentFrame().locator('.summary-count')).toHaveText('3');
        await expect(page.locator('.tab-button-name', {hasText: /^View: Summary View$/})).toHaveCount(1);
    });

    test('信頼済み通知を再度受けても開いているViewを描画する', async ({page}) => {
        await installMockApiAsync(page, createViewPluginFileSystem(), true);
        await page.goto('/');
        await openViewPluginPanelAsync(page);
        const item = page.locator('.view-plugin-item[data-plugin-id="summary"]');
        await item.click();
        const viewFrame = page.locator('.view-plugin-tab-root[data-view-plugin-id="summary"] iframe');
        await expect(viewFrame.contentFrame().locator('.summary-count')).toHaveText('3');

        await page.evaluate(() => (window as unknown as {__changeWorkspaceTrustForTest(value: boolean): void}).__changeWorkspaceTrustForTest(true));
        await expect(item).toBeVisible();

        await expect(page.locator('.tab-button-active .tab-button-name')).toHaveText('View: Summary View');
        await expect(viewFrame.contentFrame().locator('.summary-count')).toHaveText('3');
        await expect(viewFrame).toHaveAttribute('sandbox', 'allow-scripts');
    });

    test('apiVersionを省略したバージョン1プラグインを引き続き実行できる', async ({page}) => {
        await installMockApiAsync(page, createViewPluginFileSystem());
        await page.goto('/');

        await openViewPluginPanelAsync(page);
        await page.locator('.view-plugin-item[data-plugin-id="legacy"]').click();

        await expect(page.locator('.tab-button-active .tab-button-name')).toHaveText('View: Legacy View');
        const viewRoot = page.frameLocator('.view-plugin-tab-root[data-view-plugin-id="legacy"] iframe').locator('.view-plugin-sandbox-root');
        await expect(viewRoot.locator('.legacy-count')).toHaveText('3');
        await expect(viewRoot).toHaveAttribute('data-internal-emit-type', 'undefined');
        expect(await viewRoot.evaluate(element => (element.ownerDocument.defaultView as unknown as {masterDataEditor: {apiVersion: number}}).masterDataEditor.apiVersion)).toBe(2);
    });

    test('一覧からViewタブを開き、内部APIでテーブルを読み書きできる', async ({page}) => {
        await installMockApiAsync(page, createViewPluginFileSystem());
        await page.goto('/');

        await openViewPluginPanelAsync(page);
        const item = page.locator('.view-plugin-item[data-plugin-id="summary"]');
        await expect(item).toBeVisible();
        await expect(item.locator('.view-plugin-item-title')).toHaveText('Summary View');

        await item.click();
        await expect(item).toHaveClass(/view-plugin-item-active/);
        const selectedBackground = await item.evaluate((element) => {
            const probe = document.createElement('div');
            probe.style.backgroundColor = 'var(--panel-item-selected-bg)';
            element.appendChild(probe);
            const value = getComputedStyle(probe).backgroundColor;
            probe.remove();
            return value;
        });
        await expect(item).toHaveCSS('background-color', selectedBackground);
        await expect(page.locator('.tab-button-active .tab-button-name')).toHaveText('View: Summary View');
        const viewRoot = page.frameLocator('.view-plugin-tab-root[data-view-plugin-id="summary"] iframe').locator('.view-plugin-sandbox-root');
        await expect(viewRoot.locator('.summary-count')).toHaveText('3');
        await expect(viewRoot).toHaveAttribute('data-internal-emit-type', 'undefined');
        expect(await viewRoot.evaluate(element => (element.ownerDocument.defaultView as unknown as {masterDataEditor: {apiVersion: number}}).masterDataEditor.apiVersion)).toBe(2);

        await page.locator('.tab-button-active').click({button: 'right'});
        const contextMenu = page.locator('.context-menu.visible');
        await expect(contextMenu.locator('.context-menu-item', {hasText: 'タブを固定'})).toBeVisible();
        await expect(contextMenu.locator('.context-menu-item', {hasText: 'テーブル定義を編集'})).toHaveCount(0);
        await expect(contextMenu.locator('.context-menu-item', {hasText: 'バージョン比較...'})).toHaveCount(0);
        await page.keyboard.press('Escape');

        await viewRoot.locator('.summary-dirty').click();
        await expect(page.locator('.tab-button-active .tab-button-dirty-visible')).toHaveCount(1);
        await page.keyboard.press('Control+S');
        await expect(viewRoot).toHaveAttribute('data-saved', 'yes');
        await expect(page.locator('.tab-button-active .tab-button-dirty-visible')).toHaveCount(0);

        await viewRoot.locator('.summary-notify').click();
        const notificationEntry = page.locator('.debug-console-list .debug-console-row', {
            has: page.locator('.debug-console-col-label', { hasText: 'plugin success notification' }),
        });
        await expect(notificationEntry).toHaveClass(/debug-console-row-success/);

        await viewRoot.locator('.summary-edit').click();
        await expect(page.locator('.tab-button-active .tab-button-name')).toHaveText('View: Summary View');

        await expect.poll(async () => {
            return page.evaluate(() => {
                return (window as unknown as { editorApi: { data: { getCellValue: (tableName: string, row: number, column: number) => string | null } } })
                    .editorApi.data.getCellValue('test', 0, 2);
            });
        }).toBe('999');

        await expect(page.locator('.tab-button-active .tab-button-dirty-visible')).toHaveCount(1);
        await page.keyboard.press('Control+S');
        await expect(viewRoot).toHaveAttribute('data-saved', 'yes');
        await expect(page.locator('.tab-button-active .tab-button-dirty-visible')).toHaveCount(0);
    });

    test('行の挿入後もレコードの行参照から同じ行を更新できる', async ({page}) => {
        await installMockApiAsync(page, createViewPluginFileSystem());
        await page.goto('/');

        await openViewPluginPanelAsync(page);
        await page.locator('.view-plugin-item[data-plugin-id="summary"]').click();
        const viewRoot = page.frameLocator('.view-plugin-tab-root[data-view-plugin-id="summary"] iframe').locator('.view-plugin-sandbox-root');
        await expect(viewRoot.locator('.summary-count')).toHaveText('3');

        await viewRoot.locator('.summary-open-table').click();
        await expect(page.locator('.tab-button-active .tab-button-name')).toHaveText('test');
        await expect(page.locator('.editor-left-pane .tab-wrapper[data-tab-name="test"] .editor-table')).toBeVisible();
        const inserted = await page.evaluate(() => {
            return (window as unknown as {editorApi: {edit: {insertRow: (tableName: string, rowIndex: number) => boolean}}})
                .editorApi.edit.insertRow('test', 0);
        });
        expect(inserted).toBe(true);
        await page.evaluate(() => { history.back(); });
        await expect(page.locator('.tab-button-active .tab-button-name')).toHaveText('View: Summary View');

        await viewRoot.locator('.summary-edit-stable-ref').click();
        await expect(viewRoot).toHaveAttribute('data-stable-ref-updated', 'yes');
        await expect.poll(() => page.evaluate(() => {
            return (window as unknown as {editorApi: {data: {getCellValue: (tableName: string, row: number, column: number) => string | null}}})
                .editorApi.data.getCellValue('test', 2, 2);
        })).toBe('777');
    });

    test('編集セッションが複数テーブルのdirty状態と保存を管理する', async ({page}) => {
        await installMockApiAsync(page, createViewPluginFileSystem());
        await page.goto('/');

        await openViewPluginPanelAsync(page);
        await page.locator('.view-plugin-item[data-plugin-id="summary"]').click();
        const viewRoot = page.frameLocator('.view-plugin-tab-root[data-view-plugin-id="summary"] iframe').locator('.view-plugin-sandbox-root');
        await expect(viewRoot.locator('.summary-count')).toHaveText('3');

        await viewRoot.locator('.summary-edit-multiple').click();
        await expect(viewRoot).toHaveAttribute('data-multiple-updated', 'yes');
        await expect(page.locator('.tab-button-active .tab-button-dirty-visible')).toHaveCount(1);
        await page.keyboard.press('Control+S');
        await expect(page.locator('.tab-button-active .tab-button-dirty-visible')).toHaveCount(0);

        await expect.poll(async () => readMockFileAsync(page, 'data/test.csv')).toContain('1,item_a,555');
        await expect.poll(async () => readMockFileAsync(page, 'data/other.csv')).toContain('1,888');
    });

    test('未対応のAPIバージョンを要求するプラグインは登録しない', async ({page}) => {
        const fs = createViewPluginFileSystem();
        fs['plugins/views/future.js'] = [
            "window.masterDataEditor.registerViewPlugin({",
            "  id: 'future',",
            "  apiVersion: 3,",
            "  render() {},",
            "});",
        ].join('\n');
        await installMockApiAsync(page, fs);
        await page.goto('/');

        await openViewPluginPanelAsync(page);
        await expect(page.locator('.view-plugin-item[data-plugin-id="future"]')).toHaveCount(0);
        await expect(page.locator('.debug-console-list')).toContainText('APIバージョン 3 には対応していません');
    });

    test('Viewタブから開いた既存テーブルを戻る後にもう一度開ける', async ({page}) => {
        await installMockApiAsync(page, createViewPluginFileSystem());
        await page.goto('/');

        await openViewPluginPanelAsync(page);
        await page.locator('.view-plugin-item[data-plugin-id="summary"]').click();
        await expect(page.locator('.tab-button-active .tab-button-name')).toHaveText('View: Summary View');
        const viewRoot = page.frameLocator('.view-plugin-tab-root[data-view-plugin-id="summary"] iframe').locator('.view-plugin-sandbox-root');
        const openButton = viewRoot.locator('.summary-open-table');

        await openButton.click();
        await expect(page.locator('.tab-button-active .tab-button-name')).toHaveText('test');
        await expect(page.locator('.editor-left-pane .tab-wrapper[data-tab-name="test"] .editor-table')).toBeVisible();

        await page.evaluate(() => { history.back(); });
        await expect(page.locator('.tab-button-active .tab-button-name')).toHaveText('View: Summary View');
        await expect(viewRoot).toBeVisible();

        await openButton.click();
        await expect(page.locator('.tab-button-active .tab-button-name')).toHaveText('test');
        await expect(page.locator('.editor-left-pane .tab-wrapper[data-tab-name="test"] .editor-table')).toBeVisible();
    });

    test('Viewプラグインを再読み込みして開いているViewタブを再マウントできる', async ({page}) => {
        await installMockApiAsync(page, createViewPluginFileSystem());
        await page.goto('/');

        await openViewPluginPanelAsync(page);
        await page.locator('.view-plugin-item[data-plugin-id="summary"]').click();
        const viewRoot = page.frameLocator('.view-plugin-tab-root[data-view-plugin-id="summary"] iframe').locator('.view-plugin-sandbox-root');
        await expect(viewRoot.locator('.summary-count')).toHaveText('3');

        const reloadedPlugin = [
            "window.masterDataEditor.registerViewPlugin({",
            "  id: 'summary',",
            "  title: 'Summary View',",
            "  description: 'Reloaded plugin',",
            "  render(container) {",
            "    const marker = document.createElement('div');",
            "    marker.className = 'summary-count';",
            "    marker.textContent = 'reloaded';",
            "    container.appendChild(marker);",
            "  }",
            "});",
        ].join("\n");
        await page.evaluate((code) => {
            (window as unknown as {__mockFs: Record<string, string>}).__mockFs['plugins/views/summary.js'] = code;
        }, reloadedPlugin);

        await page.locator('.view-plugin-reload-button').click();
        await expect(viewRoot.locator('.summary-count')).toHaveText('reloaded');
        await expect(page.locator('.view-plugin-item[data-plugin-id="summary"] .view-plugin-item-description')).toHaveText('Reloaded plugin');
    });

    test('ui-stateからViewタブを復元して起動時に表示する', async ({page}) => {
        await installMockApiAsync(page, createViewPluginFileSystem());
        await page.goto('/');

        await openViewPluginPanelAsync(page);
        await page.locator('.view-plugin-item[data-plugin-id="summary"]').click();
        await expect(page.locator('.tab-button-active .tab-button-name')).toHaveText('View: Summary View');
        await expect(page.frameLocator('.view-plugin-tab-root[data-view-plugin-id="summary"] iframe').locator('.summary-count')).toHaveText('3');
        await waitForSavedViewTabAsync(page);

        const savedRaw = await readMockFileAsync(page, UI_STATE_FILE);
        const restoredFs = createViewPluginFileSystem();
        restoredFs[UI_STATE_FILE] = savedRaw;

        const secondPage = await page.context().newPage();
        await installMockApiAsync(secondPage, restoredFs);
        await secondPage.goto('/');

        await expect(secondPage.locator('.tab-button-active .tab-button-name')).toHaveText('View: Summary View');
        await expect(secondPage.frameLocator('.view-plugin-tab-root[data-view-plugin-id="summary"] iframe').locator('.summary-count')).toHaveText('3');
        await secondPage.close();
    });
});
