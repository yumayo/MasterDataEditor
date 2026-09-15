import {test, expect} from './fixtures/test';
import type {Page} from '@playwright/test';
import {installMockApiAsync, readMockFileAsync, type MockFileSystem} from './fixtures/mock-api';

function createFileSystem(): MockFileSystem {
    const fs: MockFileSystem = {'user:bookmarks.json': '[]', 'plugins/.gitkeep': ''};
    for (const name of ['item', 'enemy', 'quest', 'kept']) {
        fs[`schema/${name}.json`] = JSON.stringify({
            header: [{key: 0, name: 'id', type: 'int'}, {key: 1, name: 'name', type: 'string'}],
            primary_key: ['id'],
        });
        fs[`data/${name}.csv`] = `id,name\n1,${name}`;
    }
    return fs;
}

async function openTableAsync(page: Page, name: string): Promise<void> {
    await page.locator('#explorer .explorer-file').getByText(name, {exact: true}).click();
    await expect(page.locator(`.tab-wrapper[data-tab-name="${name}"] .editor-table`)).toBeVisible();
}

async function editTableAsync(page: Page, name: string): Promise<void> {
    const table = page.locator(`.tab-wrapper[data-tab-name="${name}"] .editor-table`);
    await table.locator('.editor-table-row').first().locator('.editor-table-cell:not(.editor-table-row-header)').nth(1).dblclick();
    await expect(page.locator('.grid-textfield-active')).toBeVisible();
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText(`${name}_edited`);
    await page.keyboard.press('Enter');
    await expect(page.locator(`.tab-button[title="${name}"] .tab-button-dirty`)).toHaveClass(/tab-button-dirty-visible/);
}

async function selectTabMenuAsync(page: Page, name: string, label: string): Promise<void> {
    await page.locator(`.tab-button[title="${name}"]`).click({button: 'right'});
    await page.locator('.context-menu.visible').getByText(label, {exact: true}).click();
}

test.describe('タブの右クリックメニューから閉じる', () => {
    test.beforeEach(async ({page}) => {
        await installMockApiAsync(page, createFileSystem());
        await page.goto('/');
    });

    test('固定された非アクティブなタブを個別に閉じても表示中のタブは変わらない', async ({page}) => {
        await openTableAsync(page, 'item');
        await selectTabMenuAsync(page, 'item', 'タブを固定');
        await openTableAsync(page, 'enemy');

        await selectTabMenuAsync(page, 'item', 'タブを閉じる');

        await expect(page.locator('.tab-button .tab-button-name')).toHaveText(['enemy']);
        await expect(page.locator('.tab-button-active')).toHaveAttribute('title', 'enemy');
        await expect(page.locator('.tab-wrapper[data-tab-name="enemy"] .editor-table')).toBeVisible();
        await expect(page.locator('.close-confirm-overlay')).toHaveCount(0);
        await expect(page.locator('.context-menu.visible')).toHaveCount(0);
    });

    test('他のタブを閉じると右クリックしたタブと未保存の固定タブが残り設定タブは閉じる', async ({page}) => {
        await openTableAsync(page, 'item');
        await editTableAsync(page, 'item');
        await selectTabMenuAsync(page, 'item', 'タブを固定');
        await openTableAsync(page, 'enemy');
        await openTableAsync(page, 'quest');
        await page.locator('.activity-bar-settings').click();
        await expect(page.locator('.settings-panel')).toBeVisible();

        await selectTabMenuAsync(page, 'enemy', '他のタブを閉じる');

        await expect(page.locator('.tab-button .tab-button-name')).toHaveText(['item', 'enemy']);
        await expect(page.locator('.close-confirm-overlay')).toHaveCount(0);
        await expect(page.locator('.tab-button[title="item"]')).toHaveClass(/tab-button-pinned/);
        await expect(page.locator('.tab-button[title="item"] .tab-button-dirty')).toHaveClass(/tab-button-dirty-visible/);
        await expect(page.locator('.tab-button-active')).toHaveAttribute('title', 'enemy');
        await expect(page.locator('.tab-wrapper[data-tab-name="enemy"] .editor-table')).toBeVisible();
        await expect(page.locator('.settings-tab-wrapper')).toHaveCount(0);
        await expect(async () => {
            const state = JSON.parse(await readMockFileAsync(page, 'user:ui-state.json')) as {tabs: {open: {name: string}[]}};
            expect(state.tabs.open.map(tab => tab.name)).toEqual(['item', 'enemy']);
        }).toPass({timeout: 5000});

        await page.locator('.tab-button[title="item"]').click();
        await expect(page.locator('.tab-wrapper[data-tab-name="item"] .editor-table')).toContainText('item_edited');
        await page.locator('.activity-bar-settings').click();
        await expect(page.locator('.settings-panel')).toBeVisible();
    });

    test('固定タブから他のタブを閉じても別の固定タブを残す', async ({page}) => {
        for (const name of ['item', 'enemy', 'quest']) {
            await openTableAsync(page, name);
            if (name !== 'quest') await selectTabMenuAsync(page, name, 'タブを固定');
        }

        await selectTabMenuAsync(page, 'enemy', '他のタブを閉じる');

        await expect(page.locator('.tab-button .tab-button-name')).toHaveText(['item', 'enemy']);
        await expect(page.locator('.tab-button-pinned')).toHaveCount(2);
        await expect(page.locator('.close-confirm-overlay')).toHaveCount(0);
    });

    test('設定タブのメニューから他のタブと設定タブ自身を閉じられる', async ({page}) => {
        await openTableAsync(page, 'item');
        await page.locator('.activity-bar-settings').click();
        await expect(page.locator('.settings-panel')).toBeVisible();

        await selectTabMenuAsync(page, '設定', '他のタブを閉じる');
        await expect(page.locator('.tab-button .tab-button-name')).toHaveText(['設定']);
        await expect(page.locator('.settings-panel')).toBeVisible();

        await selectTabMenuAsync(page, '設定', 'タブを閉じる');
        await expect(page.locator('.tab-button')).toHaveCount(0);
        await expect(page.locator('.settings-tab-wrapper')).toHaveCount(0);
    });

    test('タブが一つの場合に他のタブを閉じてもそのタブは残る', async ({page}) => {
        await openTableAsync(page, 'item');
        await selectTabMenuAsync(page, 'item', '他のタブを閉じる');

        await expect(page.locator('.tab-button .tab-button-name')).toHaveText(['item']);
        await expect(page.locator('.tab-wrapper[data-tab-name="item"] .editor-table')).toBeVisible();
        await page.locator('.tab-button[title="item"]').click({button: 'right'});
        await expect(page.locator('.context-menu.visible .context-menu-item')).toHaveText([
            'タブを閉じる', '他のタブを閉じる', 'タブを固定', 'テーブル定義を編集', 'バージョン比較...',
        ]);
    });

    test('API詳細の一時タブでも閉じるメニューを使える', async ({page}) => {
        await openTableAsync(page, 'item');
        await page.locator('.status-bar-badge').click();
        await page.locator('.bottom-panel-tab', {hasText: 'DEBUG CONSOLE'}).click();
        await page.locator('.debug-console-row').filter({has: page.locator('.debug-console-col-label', {hasText: 'find_files'})}).first().click();
        await expect(page.locator('.debug-api-detail-tab')).toBeVisible();

        await selectTabMenuAsync(page, 'API 詳細', '他のタブを閉じる');
        await expect(page.locator('.tab-button .tab-button-name')).toHaveText(['API 詳細']);
        await expect(page.locator('.debug-api-detail-tab')).toBeVisible();

        await page.locator('.tab-button[title="API 詳細"]').click({button: 'right'});
        await expect(page.locator('.context-menu.visible .context-menu-item')).toHaveText(['タブを閉じる', '他のタブを閉じる']);
        await page.locator('.context-menu.visible').getByText('タブを閉じる', {exact: true}).click();
        await expect(page.locator('.tab-button')).toHaveCount(0);
        await expect(page.locator('.debug-api-detail-tab')).toHaveCount(0);
    });

    test('未保存のタブを閉じると確認できキャンセルした変更は保持される', async ({page}) => {
        await openTableAsync(page, 'item');
        await editTableAsync(page, 'item');

        await selectTabMenuAsync(page, 'item', 'タブを閉じる');
        await expect(page.locator('.close-confirm-message')).toContainText('「item」');
        await page.locator('.close-confirm-button-cancel').click();
        await expect(page.locator('.tab-wrapper[data-tab-name="item"] .editor-table')).toContainText('item_edited');

        await selectTabMenuAsync(page, 'item', 'タブを閉じる');
        await page.locator('.close-confirm-button-close').click();
        await expect(page.locator('.tab-button')).toHaveCount(0);
        await expect(page.locator('.close-confirm-overlay')).toHaveCount(0);
        expect(await readMockFileAsync(page, 'data/item.csv')).toBe('id,name\n1,item');
    });

    test('複数の未保存タブを順に確認し保存済みタブも閉じて対象タブの編集は保持する', async ({page}) => {
        for (const name of ['item', 'enemy', 'quest', 'kept']) {
            await openTableAsync(page, name);
            if (name !== 'quest') await editTableAsync(page, name);
        }

        await selectTabMenuAsync(page, 'kept', '他のタブを閉じる');
        await expect(page.locator('.close-confirm-overlay')).toHaveCount(1);
        await expect(page.locator('.close-confirm-message')).toContainText('「item」');
        await page.locator('.close-confirm-button-close').click();
        await expect(page.locator('.tab-button[title="item"]')).toHaveCount(0);
        await expect(page.locator('.close-confirm-overlay')).toHaveCount(1);
        await expect(page.locator('.close-confirm-message')).toContainText('「enemy」');
        await page.locator('.close-confirm-button-close').click();

        await expect(page.locator('.tab-button .tab-button-name')).toHaveText(['kept']);
        await expect(page.locator('.close-confirm-overlay')).toHaveCount(0);
        await expect(page.locator('.tab-wrapper[data-tab-name="kept"] .editor-table')).toContainText('kept_edited');
        await expect(page.locator('.tab-button[title="kept"] .tab-button-dirty')).toHaveClass(/tab-button-dirty-visible/);
    });

    for (const cancelMethod of ['ボタン', 'Escape', '背景']) {
        test(`一括クローズの確認を${cancelMethod}でキャンセルすると残りのタブを閉じない`, async ({page}) => {
            for (const name of ['item', 'enemy', 'quest', 'kept']) {
                await openTableAsync(page, name);
                if (name === 'item' || name === 'enemy') await editTableAsync(page, name);
            }

            await selectTabMenuAsync(page, 'kept', '他のタブを閉じる');
            await page.locator('.close-confirm-button-close').click();
            await expect(page.locator('.close-confirm-message')).toContainText('「enemy」');
            if (cancelMethod === 'ボタン') await page.locator('.close-confirm-button-cancel').click();
            else if (cancelMethod === 'Escape') await page.keyboard.press('Escape');
            else await page.locator('.close-confirm-overlay').click({position: {x: 5, y: 5}});

            await expect(page.locator('.close-confirm-overlay')).toHaveCount(0);
            await expect(page.locator('.tab-button .tab-button-name')).toHaveText(['enemy', 'quest', 'kept']);
            await page.locator('.tab-button[title="enemy"]').click();
            await expect(page.locator('.tab-wrapper[data-tab-name="enemy"] .editor-table')).toContainText('enemy_edited');

            // 別の閉じ操作を行っても、キャンセルした一括処理が再開しない。
            await selectTabMenuAsync(page, 'quest', 'タブを閉じる');
            await expect(page.locator('.tab-button .tab-button-name')).toHaveText(['enemy', 'kept']);
        });
    }
});
