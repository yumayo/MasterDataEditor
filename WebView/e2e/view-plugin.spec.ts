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
        "plugins/views/summary.js": [
            "window.masterDataEditor.registerViewPlugin({",
            "  id: 'summary',",
            "  title: 'Summary View',",
            "  description: 'Counts rows and edits test data',",
            "  async render(container, api) {",
            "    let tableTouched = false;",
            "    api.view.onSave(async () => {",
            "      container.dataset.saved = 'yes';",
            "      if (!tableTouched) return true;",
            "      return api.edit.saveTableAsync('test');",
            "    });",
            "    const data = await api.data.readTableDataAsync('test');",
            "    const count = document.createElement('div');",
            "    count.className = 'summary-count';",
            "    count.textContent = String(data ? data.rows.length : 0);",
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
            "      const updated = await api.edit.setCellValueAsync('test', 0, 2, '999');",
            "      if (updated) {",
            "        tableTouched = true;",
            "        container.dataset.saved = 'no';",
            "        api.view.setDirty(true);",
            "      }",
            "    });",
            "    const notifyButton = document.createElement('button');",
            "    notifyButton.className = 'summary-notify';",
            "    notifyButton.textContent = 'notify';",
            "    notifyButton.addEventListener('click', () => {",
            "      api.notification.show('plugin success notification', 'success');",
            "    });",
            "    container.append(count, dirtyButton, button, notifyButton);",
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
        const viewRoot = page.locator('.view-plugin-tab-root[data-view-plugin-id="summary"]');
        await expect(viewRoot.locator('.summary-count')).toHaveText('3');

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
