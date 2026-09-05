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
    test('apiVersionを省略したバージョン1プラグインを引き続き実行できる', async ({page}) => {
        await installMockApiAsync(page, createViewPluginFileSystem());
        await page.goto('/');

        await openViewPluginPanelAsync(page);
        await page.locator('.view-plugin-item[data-plugin-id="legacy"]').click();

        await expect(page.locator('.tab-button-active .tab-button-name')).toHaveText('View: Legacy View');
        const viewRoot = page.locator('.view-plugin-tab-root[data-view-plugin-id="legacy"]');
        await expect(viewRoot.locator('.legacy-count')).toHaveText('3');
        await expect(viewRoot).toHaveAttribute('data-internal-emit-type', 'function');
    });

    test('一覧からViewタブを開き、内部APIでテーブルを読み書きできる', async ({page}) => {
        await installMockApiAsync(page, createViewPluginFileSystem());
        await page.goto('/');

        await openViewPluginPanelAsync(page);
        const item = page.locator('.view-plugin-item[data-plugin-id="summary"]');
        await expect(item).toBeVisible();
        await expect(item.locator('.view-plugin-item-title')).toHaveText('Summary View');
        await expect.poll(() => page.evaluate(() => {
            return (window as unknown as {masterDataEditor: {apiVersion: number}}).masterDataEditor.apiVersion;
        })).toBe(2);

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
        const viewRoot = page.locator('.view-plugin-tab-root[data-view-plugin-id="summary"]');
        await expect(viewRoot.locator('.summary-count')).toHaveText('3');
        await expect(viewRoot).toHaveAttribute('data-internal-emit-type', 'undefined');

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
        const viewRoot = page.locator('.view-plugin-tab-root[data-view-plugin-id="summary"]');
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
        const viewRoot = page.locator('.view-plugin-tab-root[data-view-plugin-id="summary"]');
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
        const viewRoot = page.locator('.view-plugin-tab-root[data-view-plugin-id="summary"]');
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
        const viewRoot = page.locator('.view-plugin-tab-root[data-view-plugin-id="summary"]');
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
        await expect(page.locator('.view-plugin-tab-root[data-view-plugin-id="summary"] .summary-count')).toHaveText('3');
        await waitForSavedViewTabAsync(page);

        const savedRaw = await readMockFileAsync(page, UI_STATE_FILE);
        const restoredFs = createViewPluginFileSystem();
        restoredFs[UI_STATE_FILE] = savedRaw;

        const secondPage = await page.context().newPage();
        await installMockApiAsync(secondPage, restoredFs);
        await secondPage.goto('/');

        await expect(secondPage.locator('.tab-button-active .tab-button-name')).toHaveText('View: Summary View');
        await expect(secondPage.locator('.view-plugin-tab-root[data-view-plugin-id="summary"] .summary-count')).toHaveText('3');
        await secondPage.close();
    });
});
