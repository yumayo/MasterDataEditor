import {test, expect} from './fixtures/test';
import {Page, Locator} from '@playwright/test';
import {installMockApiAsync, MockFileSystem} from './fixtures/mock-api';
import {getDataCell} from './fixtures/test-utils';

/**
 * ブックマークテスト用のファイルシステムを生成する
 *
 * テーブル構成:
 *   item: id, name, value (アイテムテーブル)
 *   enemy: id, ja (敵テーブル — 複数テーブルグルーピングの検証用)
 */
function createBookmarkTestFileSystem(): MockFileSystem {
    return {
        "schema/item.json": JSON.stringify({
            header: [
                {key: 0, name: "id", type: "int"},
                {key: 1, name: "name", type: "string"},
                {key: 2, name: "value", type: "int"},
            ],
            primary_key: ["id"],
        }),
        "data/item.csv": [
            "id,name,value",
            "1,Sword,100",
            "2,Shield,200",
            "3,Potion,300",
        ].join("\n"),
        "schema/enemy.json": JSON.stringify({
            header: [
                {key: 0, name: "id", type: "int"},
                {key: 1, name: "ja", type: "string"},
            ],
            primary_key: ["id"],
        }),
        "data/enemy.csv": [
            "id,ja",
            "1,スライム",
            "2,ドラゴン",
        ].join("\n"),
    };
}

/**
 * テーブルを開いてエディターテーブルが表示されるまで待機する
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
    const table = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="${tableName}"] .editor-table`);
    await expect(table).toBeVisible();
    return table;
}

/**
 * アクティビティバーの bookmarks アイコンをクリックしてブックマークパネルを開く
 */
async function openBookmarkPanelAsync(page: Page): Promise<void> {
    await page.locator('.activity-bar-item[data-panel="bookmarks"]').click();
}

/**
 * ブックマークパネルのエントリ一覧を取得する
 */
function getBookmarkEntries(page: Page): Locator {
    return page.locator('.bookmark-entry');
}

/**
 * ブックマークパネルのグループ（テーブル名ヘッダー）一覧を取得する
 */
function getBookmarkGroups(page: Page): Locator {
    return page.locator('.bookmark-group');
}

/**
 * 指定セルを右クリックしてコンテキストメニューを表示する
 */
async function rightClickCellAsync(page: Page, table: Locator, rowIndex: number, colIndex: number): Promise<void> {
    const cell = getDataCell(table, rowIndex, colIndex);
    await cell.click({button: 'right'});
}

/**
 * 表示中のコンテキストメニューから指定ラベルの項目をクリックする
 */
async function clickContextMenuItemAsync(page: Page, label: string): Promise<void> {
    const menu = page.locator('.context-menu.visible');
    await menu.locator('.context-menu-item', {hasText: label}).click();
}

test.describe('ブックマーク機能', () => {
    test.beforeEach(async ({page}) => {
        const fs = createBookmarkTestFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test('アクティビティバーにbookmarksアイコンが表示される', async ({page}) => {
        // bookmarks アイコンが存在すること
        const bookmarkIcon = page.locator('.activity-bar-item[data-panel="bookmarks"]');
        await expect(bookmarkIcon).toBeVisible();
        // SEARCH と SOURCE CONTROL の間に配置されていることを検証する
        // アクティビティバー内のアイテム順序を確認（files, references, search, bookmarks, sourceControl）
        const items = page.locator('.activity-bar .activity-bar-item:not(.activity-bar-settings)');
        const panelNames: string[] = [];
        const count = await items.count();
        for (let i = 0; i < count; i++) {
            const panel = await items.nth(i).getAttribute('data-panel');
            if (panel) panelNames.push(panel);
        }
        const bookmarkIndex = panelNames.indexOf('bookmarks');
        const searchIndex = panelNames.indexOf('search');
        const sourceControlIndex = panelNames.indexOf('sourceControl');
        expect(bookmarkIndex).toBeGreaterThan(searchIndex);
        expect(bookmarkIndex).toBeLessThan(sourceControlIndex);
    });

    test('bookmarksアイコンクリックでブックマークパネルが表示される', async ({page}) => {
        await openBookmarkPanelAsync(page);
        // ブックマークパネルがアクティブ状態で表示されること
        const bookmarkPanel = page.locator('.bookmark-panel.sidebar-panel-active');
        await expect(bookmarkPanel).toBeVisible();
        // ヘッダーに "BOOKMARKS" が表示されること
        const header = bookmarkPanel.locator('.sidebar-panel-header');
        await expect(header).toHaveText('BOOKMARKS');
    });

    test('セル右クリックでブックマーク追加メニューが表示される', async ({page}) => {
        // item テーブルを開く
        const table = await openTableAsync(page, 'item');
        // name 列（colIndex=1）のセルを右クリック（逆参照なし・非PKセルでもメニューが出る）
        await rightClickCellAsync(page, table, 0, 1);
        // コンテキストメニューに「ブックマークに追加」が表示されること
        const menu = page.locator('.context-menu.visible');
        await expect(menu).toBeVisible();
        const bookmarkItem = menu.locator('.context-menu-item', {hasText: 'ブックマークに追加'});
        await expect(bookmarkItem).toBeVisible();
    });

    test('ブックマーク追加後にパネルにエントリが表示される', async ({page}) => {
        // item テーブルを開いて1行目を右クリック→ブックマーク追加
        const table = await openTableAsync(page, 'item');
        await rightClickCellAsync(page, table, 0, 1);
        await clickContextMenuItemAsync(page, 'ブックマークに追加');
        // ブックマークパネルを開く
        await openBookmarkPanelAsync(page);
        // エントリが1件表示されること
        const entries = getBookmarkEntries(page);
        await expect(entries).toHaveCount(1);
        // エントリにPK値 "1" が表示されること
        const pkElement = entries.first().locator('.bookmark-entry-pk');
        await expect(pkElement).toHaveText('1');
        // エントリに表示列の値 "Sword" が表示されること（name列の値）
        const displayValue = entries.first().locator('.bookmark-entry-display');
        await expect(displayValue).toHaveText('Sword');
    });

    test('ブックマーク済みの行で右クリックすると解除メニューが表示される', async ({page}) => {
        // item テーブルを開いて1行目をブックマークに追加
        const table = await openTableAsync(page, 'item');
        await rightClickCellAsync(page, table, 0, 1);
        await clickContextMenuItemAsync(page, 'ブックマークに追加');
        // 同じ行の別セルを右クリック（同一PK行なので「ブックマークを解除」が表示される）
        await rightClickCellAsync(page, table, 0, 0);
        const menu = page.locator('.context-menu.visible');
        await expect(menu).toBeVisible();
        const removeItem = menu.locator('.context-menu-item', {hasText: 'ブックマークを解除'});
        await expect(removeItem).toBeVisible();
        // 「ブックマークに追加」は表示されないこと
        const addItem = menu.locator('.context-menu-item', {hasText: 'ブックマークに追加'});
        await expect(addItem).toHaveCount(0);
    });

    test('ブックマーク解除でエントリが削除される', async ({page}) => {
        // item テーブルを開いて1行目をブックマーク追加→解除
        const table = await openTableAsync(page, 'item');
        await rightClickCellAsync(page, table, 0, 1);
        await clickContextMenuItemAsync(page, 'ブックマークに追加');
        // 同じ行を右クリックして解除
        await rightClickCellAsync(page, table, 0, 0);
        await clickContextMenuItemAsync(page, 'ブックマークを解除');
        // ブックマークパネルを開いてエントリが0件であること
        await openBookmarkPanelAsync(page);
        const entries = getBookmarkEntries(page);
        await expect(entries).toHaveCount(0);
    });

    test('エントリのxボタンクリックでブックマークが削除される', async ({page}) => {
        // item テーブルを開いて1行目をブックマーク追加
        const table = await openTableAsync(page, 'item');
        await rightClickCellAsync(page, table, 0, 1);
        await clickContextMenuItemAsync(page, 'ブックマークに追加');
        // ブックマークパネルを開く
        await openBookmarkPanelAsync(page);
        const entries = getBookmarkEntries(page);
        await expect(entries).toHaveCount(1);
        // エントリをホバーして x 削除ボタンを表示し、クリックする
        await entries.first().hover();
        const deleteButton = entries.first().locator('.bookmark-entry-delete');
        await deleteButton.click();
        // エントリが0件になること
        await expect(entries).toHaveCount(0);
    });

    test('エントリクリックで該当テーブル・行にジャンプする', async ({page}) => {
        // item テーブルを開いて2行目（id=2, Shield）をブックマーク追加
        const table = await openTableAsync(page, 'item');
        await rightClickCellAsync(page, table, 1, 1);
        await clickContextMenuItemAsync(page, 'ブックマークに追加');
        // 別テーブル (enemy) を開いてアクティブタブを切り替える
        await openTableAsync(page, 'enemy');
        // ブックマークパネルを開いてエントリをクリック
        await openBookmarkPanelAsync(page);
        const entries = getBookmarkEntries(page);
        await entries.first().click();
        // item テーブルが再度アクティブになること
        const itemTable = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="item"] .editor-table');
        await expect(itemTable).toBeVisible();
        // PK列（id列 = colIndex 0）にセレクションが当たっていること
        const selection = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="item"] .selection');
        await expect(selection).toBeVisible();
    });

    test('テーブル名でグルーピング表示される', async ({page}) => {
        // item テーブルの1行目をブックマーク
        const itemTable = await openTableAsync(page, 'item');
        await rightClickCellAsync(page, itemTable, 0, 1);
        await clickContextMenuItemAsync(page, 'ブックマークに追加');
        // enemy テーブルの1行目をブックマーク
        const enemyTable = await openTableAsync(page, 'enemy');
        await rightClickCellAsync(page, enemyTable, 0, 1);
        await clickContextMenuItemAsync(page, 'ブックマークに追加');
        // ブックマークパネルを開く
        await openBookmarkPanelAsync(page);
        // テーブル名でグルーピングされていること（2グループ: item, enemy）
        const groups = getBookmarkGroups(page);
        await expect(groups).toHaveCount(2);
        // 各グループのヘッダーにテーブル名が表示されること
        const groupNames: string[] = [];
        const groupCount = await groups.count();
        for (let i = 0; i < groupCount; i++) {
            const name = await groups.nth(i).locator('.bookmark-group-header').textContent();
            if (name) groupNames.push(name.trim());
        }
        expect(groupNames).toContain('item');
        expect(groupNames).toContain('enemy');
    });

    test('グループ内のブックマークが全削除されるとグループも消える', async ({page}) => {
        // item テーブルの1行目をブックマーク
        const itemTable = await openTableAsync(page, 'item');
        await rightClickCellAsync(page, itemTable, 0, 1);
        await clickContextMenuItemAsync(page, 'ブックマークに追加');
        // enemy テーブルの1行目をブックマーク
        const enemyTable = await openTableAsync(page, 'enemy');
        await rightClickCellAsync(page, enemyTable, 0, 1);
        await clickContextMenuItemAsync(page, 'ブックマークに追加');
        // ブックマークパネルを開いて2グループ存在することを確認
        await openBookmarkPanelAsync(page);
        const groups = getBookmarkGroups(page);
        await expect(groups).toHaveCount(2);
        // enemy グループ内のエントリを x ボタンで削除
        const enemyGroup = page.locator('.bookmark-group', {has: page.locator('.bookmark-group-header', {hasText: 'enemy'})});
        await enemyGroup.locator('.bookmark-entry').first().hover();
        const enemyDeleteButton = enemyGroup.locator('.bookmark-entry-delete').first();
        await enemyDeleteButton.click();
        // enemy グループが消えて1グループのみになること
        await expect(groups).toHaveCount(1);
        // 残りのグループは item であること
        const remainingHeader = groups.first().locator('.bookmark-group-header');
        await expect(remainingHeader).toHaveText('item');
    });
});
