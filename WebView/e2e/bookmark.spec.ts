import {test, expect} from './fixtures/test';
import {Page, Locator} from '@playwright/test';
import {installMockApiAsync, MockFileSystem, readMockFileAsync} from './fixtures/mock-api';
import {getDataCell} from './fixtures/test-utils';

const BOOKMARKS_FILE = 'user:bookmarks.json';

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
                {key: 0, name: "id", type: "int", comment: "アイテムID"},
                {key: 1, name: "name", type: "string", comment: "アイテム名"},
                {key: 2, name: "value", type: "int", comment: "効果値"},
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
    // .explorer-file-name に限定する（ブックマークパネルの .bookmark-group-header との重複を避ける）
    const explorer = page.locator('#explorer');
    await explorer.locator('.explorer-file-name', {hasText: tableName}).click();
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

/**
 * 指定セルをクリックしてフォーカスを合わせる
 */
async function selectCellAsync(page: Page, table: Locator, rowIndex: number, colIndex: number): Promise<void> {
    const cell = getDataCell(table, rowIndex, colIndex);
    await cell.click();
}

/**
 * persistAsync() はfire-and-forgetで呼ばれるため、テスト側で書き込み完了を待つ必要がある。
 * __mockFs の bookmarks.json を監視して期待件数になるまでポーリングする。
 */
async function waitForBookmarkCountAsync(page: Page, expectedCount: number): Promise<void> {
    await page.waitForFunction(
        ({count, path}: {count: number; path: string}) => {
            const raw = (window as unknown as { __mockFs: { [key: string]: string } }).__mockFs[path];
            if (raw === undefined) return count === 0;
            try {
                const arr = JSON.parse(raw) as unknown[];
                return arr.length === count;
            } catch {
                return false;
            }
        },
        {count: expectedCount, path: BOOKMARKS_FILE},
        {timeout: 5000}
    );
}

/**
 * 永続化テスト用のファイルシステムを生成する
 * bookmarks.json を含む初期状態を作る
 */
function createBookmarkTestFileSystemWithPersistence(bookmarks: object[]): MockFileSystem {
    const base = createBookmarkTestFileSystem();
    base[BOOKMARKS_FILE] = JSON.stringify(bookmarks);
    return base;
}

function createCompositeBookmarkTestFileSystem(): MockFileSystem {
    return {
        "schema/shop_product.json": JSON.stringify({
            header: [
                {key: 0, name: "shop_id", type: "int", comment: "ショップID"},
                {key: 1, name: "product_id", type: "int", comment: "商品ID"},
                {key: 2, name: "name", type: "string", comment: "商品名"},
            ],
            primary_key: ["shop_id", "product_id"],
        }),
        "data/shop_product.csv": [
            "shop_id,product_id,name",
            "1,10,Sword",
            "1,20,Shield",
            "2,10,Potion",
        ].join("\n"),
    };
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
        // エントリに PK値 "1" が data-pk-value 属性として保持されていること
        await expect(entries.first()).toHaveAttribute('data-pk-value', '1');
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
        // PK列（id列 = colIndex 0）にセレクションが当たっていること（sel-top クラスを持つセルが存在する）
        const selectionCell = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="item"] .sel-top');
        await expect(selectionCell.first()).toBeVisible();
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

    test('テーブルグループを折り畳み・展開できる', async ({page}) => {
        const table = await openTableAsync(page, 'item');
        await rightClickCellAsync(page, table, 0, 1);
        await clickContextMenuItemAsync(page, 'ブックマークに追加');
        await rightClickCellAsync(page, table, 1, 1);
        await clickContextMenuItemAsync(page, 'ブックマークに追加');

        await openBookmarkPanelAsync(page);
        const group = page.locator('.bookmark-group', {has: page.locator('.bookmark-group-header', {hasText: 'item'})});
        const header = group.locator('.bookmark-group-header');
        const items = group.locator('.bookmark-group-items');
        await expect(header).toHaveAttribute('aria-expanded', 'true');
        await expect(items).toHaveAttribute('aria-hidden', 'false');
        await expect(group.locator('.bookmark-entry').first()).toBeVisible();

        await header.click();
        await expect(header).toHaveAttribute('aria-expanded', 'false');
        await expect(items).toHaveAttribute('aria-hidden', 'true');
        await expect(group.locator('.bookmark-entry').first()).not.toBeVisible();

        await header.click();
        await expect(header).toHaveAttribute('aria-expanded', 'true');
        await expect(items).toHaveAttribute('aria-hidden', 'false');
        await expect(group.locator('.bookmark-entry').first()).toBeVisible();
    });

    test('ブックマークエントリにフォーム風の列情報と値が表示される', async ({page}) => {
        const table = await openTableAsync(page, 'item');
        await rightClickCellAsync(page, table, 0, 1);
        await clickContextMenuItemAsync(page, 'ブックマークに追加');

        await openBookmarkPanelAsync(page);
        const entry = getBookmarkEntries(page).first();
        await expect(entry.locator('.bookmark-entry-field-label')).toHaveText('name');
        await expect(entry.locator('.bookmark-entry-field-comment')).toHaveText('アイテム名');
        await expect(entry.locator('.bookmark-entry-field-chip--type')).toHaveText('string');
        await expect(entry.locator('.bookmark-entry-field-value')).toHaveText('Sword');
        await expect(entry.locator('.bookmark-entry-location-chip--pk')).toHaveText('PK id=1');
        await expect(entry.locator('.bookmark-entry-location-chip--column')).toHaveCount(0);
    });

    test('削除ボタン表示時にエントリ幅が変わらない', async ({page}) => {
        const table = await openTableAsync(page, 'item');
        await rightClickCellAsync(page, table, 0, 1);
        await clickContextMenuItemAsync(page, 'ブックマークに追加');

        await openBookmarkPanelAsync(page);
        const entry = getBookmarkEntries(page).first();
        const widthBefore = await entry.evaluate(el => (el as HTMLElement).offsetWidth);
        await entry.hover();
        await expect(entry.locator('.bookmark-entry-delete')).toBeVisible();
        const widthAfter = await entry.evaluate(el => (el as HTMLElement).offsetWidth);
        expect(widthAfter).toBe(widthBefore);
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

// =========================================================================
// 複合主キーブックマーク
// =========================================================================
test.describe('複合主キーブックマーク', () => {
    test.beforeEach(async ({page}) => {
        const fs = createCompositeBookmarkTestFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test('複合主キーの全構成列を行キーにして表示とジャンプができる', async ({page}) => {
        const table = await openTableAsync(page, 'shop_product');
        await rightClickCellAsync(page, table, 0, 2);
        await clickContextMenuItemAsync(page, 'ブックマークに追加');
        await rightClickCellAsync(page, table, 1, 2);
        await clickContextMenuItemAsync(page, 'ブックマークに追加');

        await openBookmarkPanelAsync(page);
        const entries = getBookmarkEntries(page);
        await expect(entries).toHaveCount(2);
        await expect(entries.nth(0)).toHaveAttribute('data-pk-value', '1\t10');
        await expect(entries.nth(1)).toHaveAttribute('data-pk-value', '1\t20');

        const firstPkChips = entries.nth(0).locator('.bookmark-entry-location-chip--pk');
        await expect(firstPkChips).toHaveCount(2);
        await expect(firstPkChips.nth(0)).toHaveText('PK shop_id=1');
        await expect(firstPkChips.nth(1)).toHaveText('PK product_id=10');
        await expect(entries.nth(0).locator('.bookmark-entry-location-chip--column')).toHaveCount(0);

        await entries.nth(1).click();
        const focusedCell = table.locator('.editor-table-cell-focused');
        await expect(focusedCell).toHaveText('Shield');
    });
});

// =========================================================================
// セルレベルブックマーク
// =========================================================================
test.describe('セルレベルブックマーク', () => {
    test.beforeEach(async ({page}) => {
        const fs = createBookmarkTestFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test('同じ行の異なる列を個別にブックマークできる', async ({page}) => {
        // item テーブルを開く
        const table = await openTableAsync(page, 'item');
        // 1行目の name 列（colIndex=1）をブックマーク追加
        await rightClickCellAsync(page, table, 0, 1);
        await clickContextMenuItemAsync(page, 'ブックマークに追加');
        // 同じ1行目の value 列（colIndex=2）をブックマーク追加
        await rightClickCellAsync(page, table, 0, 2);
        await clickContextMenuItemAsync(page, 'ブックマークに追加');
        // ブックマークパネルを開いてエントリが2件表示されること（同一行でも列が違えば別エントリ）
        await openBookmarkPanelAsync(page);
        const entries = getBookmarkEntries(page);
        await expect(entries).toHaveCount(2);
    });

    test('エントリの表示形式が「列名: ラベル（主キー名=値）」である', async ({page}) => {
        // item テーブルを開いて1行目の name 列（値: Sword, PK: 1）をブックマーク追加
        const table = await openTableAsync(page, 'item');
        await rightClickCellAsync(page, table, 0, 1);
        await clickContextMenuItemAsync(page, 'ブックマークに追加');
        // ブックマークパネルを開く
        await openBookmarkPanelAsync(page);
        const entries = getBookmarkEntries(page);
        await expect(entries).toHaveCount(1);
        // エントリのテキストに「name: Sword (id=1)」が含まれること
        await expect(entries.first()).toHaveText(/name:\s*Sword\s*\(id=1\)/);
    });

    test('ブックマーク済みセルの右クリックで解除メニューが表示され、別列は追加メニューが表示される', async ({page}) => {
        // item テーブルを開いて1行目の name 列をブックマーク
        const table = await openTableAsync(page, 'item');
        await rightClickCellAsync(page, table, 0, 1);
        await clickContextMenuItemAsync(page, 'ブックマークに追加');
        // 同じセル（name列）を右クリック → 解除メニューが表示される
        await rightClickCellAsync(page, table, 0, 1);
        const menu1 = page.locator('.context-menu.visible');
        await expect(menu1.locator('.context-menu-item', {hasText: 'ブックマークを解除'})).toBeVisible();
        // メニューを閉じる
        await page.keyboard.press('Escape');
        // 同じ行の value 列（colIndex=2）を右クリック → 追加メニューが表示される（列が異なるため未ブックマーク）
        await rightClickCellAsync(page, table, 0, 2);
        const menu2 = page.locator('.context-menu.visible');
        await expect(menu2.locator('.context-menu-item', {hasText: 'ブックマークに追加'})).toBeVisible();
    });

    test('エントリクリックで該当テーブルの該当セルにジャンプする', async ({page}) => {
        // item テーブルを開いて2行目（id=2）の value 列（colIndex=2, 値=200）をブックマーク追加
        const table = await openTableAsync(page, 'item');
        await rightClickCellAsync(page, table, 1, 2);
        await clickContextMenuItemAsync(page, 'ブックマークに追加');
        // enemy テーブルを開いてアクティブタブを切り替える
        await openTableAsync(page, 'enemy');
        // ブックマークパネルを開いてエントリをクリック
        await openBookmarkPanelAsync(page);
        const entries = getBookmarkEntries(page);
        await entries.first().click();
        // item テーブルがアクティブになること
        const itemTable = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="item"] .editor-table');
        await expect(itemTable).toBeVisible();
        // セレクションが value 列（colIndex=2）の2行目（rowIndex=1）に当たっていること
        // sel-top クラスを持つセルが存在することで選択状態を検証する
        const selectionCell = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="item"] .sel-top');
        await expect(selectionCell.first()).toBeVisible();
    });
});

// =========================================================================
// 永続化（bookmarks.json）
// =========================================================================
test.describe('ブックマーク永続化', () => {
    test('ブックマーク追加後にbookmarks.jsonが保存される', async ({page}) => {
        const fs = createBookmarkTestFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
        // item テーブルを開いて1行目の name 列をブックマーク追加
        const table = await openTableAsync(page, 'item');
        await rightClickCellAsync(page, table, 0, 1);
        await clickContextMenuItemAsync(page, 'ブックマークに追加');
        // persistAsync() の完了を待つ
        await waitForBookmarkCountAsync(page, 1);
        // user:bookmarks.json がモックファイルシステムに書き込まれていること
        const json = await readMockFileAsync(page, BOOKMARKS_FILE);
        expect(json).not.toContain('\r');
        expect(json.endsWith('\n')).toBe(true);
        expect(json).toContain('\n        "tableName": "item"');
        const bookmarks = JSON.parse(json) as object[];
        expect(bookmarks).toHaveLength(1);
        // 保存形式の検証: tableName, rowKey, columnName, label, createdAt が含まれること
        const entry = bookmarks[0] as Record<string, unknown>;
        expect(entry).toHaveProperty('tableName', 'item');
        expect(entry).toHaveProperty('rowKey', '1');
        expect(entry).toHaveProperty('columnName', 'name');
        expect(entry).toHaveProperty('label', 'Sword');
        expect(entry).toHaveProperty('createdAt');
    });

    test('複数ブックマーク追加でbookmarks.jsonに全エントリが保存される', async ({page}) => {
        const fs = createBookmarkTestFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
        // item テーブルの1行目 name 列をブックマーク
        const itemTable = await openTableAsync(page, 'item');
        await rightClickCellAsync(page, itemTable, 0, 1);
        await clickContextMenuItemAsync(page, 'ブックマークに追加');
        // item テーブルの2行目 value 列をブックマーク
        await rightClickCellAsync(page, itemTable, 1, 2);
        await clickContextMenuItemAsync(page, 'ブックマークに追加');
        // persistAsync() はfire-and-forgetのため書き込み完了を待つ
        await waitForBookmarkCountAsync(page, 2);
        // bookmarks.json に2件保存されていること
        const json = await readMockFileAsync(page, BOOKMARKS_FILE);
        const bookmarks = JSON.parse(json) as object[];
        expect(bookmarks).toHaveLength(2);
    });

    test('アプリ起動時にbookmarks.jsonが存在すれば読み込みパネルに復元される', async ({page}) => {
        // bookmarks.json に1件のブックマークを事前設定した状態で起動する
        const savedBookmarks = [{
            tableName: 'item',
            rowKey: '2',
            columnName: 'name',
            label: 'Shield',
            createdAt: '2026-01-01T00:00:00.000Z',
        }];
        const fs = createBookmarkTestFileSystemWithPersistence(savedBookmarks);
        await installMockApiAsync(page, fs);
        await page.goto('/');
        // ブックマークパネルを開いてエントリが1件復元されていること
        await openBookmarkPanelAsync(page);
        const entries = getBookmarkEntries(page);
        await expect(entries).toHaveCount(1);
        // 復元されたエントリの内容が正しいこと
        await expect(entries.first()).toHaveText(/name:\s*Shield\s*\(id=2\)/);
    });

    test('ブックマーク削除後にbookmarks.jsonから該当エントリが除去される', async ({page}) => {
        const fs = createBookmarkTestFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
        // item テーブルを開いて1行目と2行目をブックマーク追加
        const table = await openTableAsync(page, 'item');
        await rightClickCellAsync(page, table, 0, 1);
        await clickContextMenuItemAsync(page, 'ブックマークに追加');
        await rightClickCellAsync(page, table, 1, 1);
        await clickContextMenuItemAsync(page, 'ブックマークに追加');
        // persistAsync() はfire-and-forgetのため書き込み完了を待つ
        await waitForBookmarkCountAsync(page, 2);
        // 2件保存されていることを確認
        const json1 = await readMockFileAsync(page, BOOKMARKS_FILE);
        expect(JSON.parse(json1)).toHaveLength(2);
        // ブックマークパネルを開いて最初のエントリを x ボタンで削除
        await openBookmarkPanelAsync(page);
        const entries = getBookmarkEntries(page);
        await entries.first().hover();
        await entries.first().locator('.bookmark-entry-delete').click();
        // persistAsync() はfire-and-forgetのため書き込み完了を待つ
        await waitForBookmarkCountAsync(page, 1);
        // bookmarks.json が1件に減っていること
        const json2 = await readMockFileAsync(page, BOOKMARKS_FILE);
        const remaining = JSON.parse(json2) as object[];
        expect(remaining).toHaveLength(1);
    });
});

// =========================================================================
// 視覚マーク（data-bookmarked属性）
// =========================================================================
test.describe('ブックマーク視覚マーク', () => {
    test.beforeEach(async ({page}) => {
        const fs = createBookmarkTestFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test('ブックマーク済みセルにdata-bookmarked属性が付与される', async ({page}) => {
        // item テーブルを開いて1行目の name 列をブックマーク追加
        const table = await openTableAsync(page, 'item');
        await rightClickCellAsync(page, table, 0, 1);
        await clickContextMenuItemAsync(page, 'ブックマークに追加');
        // 該当セルに data-bookmarked 属性が付与されていること
        const cell = getDataCell(table, 0, 1);
        await expect(cell).toHaveAttribute('data-bookmarked', '');
    });

    test('ブックマーク削除後にdata-bookmarked属性が除去される', async ({page}) => {
        // item テーブルを開いて1行目の name 列をブックマーク追加
        const table = await openTableAsync(page, 'item');
        await rightClickCellAsync(page, table, 0, 1);
        await clickContextMenuItemAsync(page, 'ブックマークに追加');
        // data-bookmarked が付いていることを確認
        const cell = getDataCell(table, 0, 1);
        await expect(cell).toHaveAttribute('data-bookmarked', '');
        // 同じセルを右クリックして解除
        await rightClickCellAsync(page, table, 0, 1);
        await clickContextMenuItemAsync(page, 'ブックマークを解除');
        // data-bookmarked 属性が除去されていること
        await expect(cell).not.toHaveAttribute('data-bookmarked');
    });

    test('タブ切替後もブックマーク済みセルのマークが維持される', async ({page}) => {
        // item テーブルを開いて1行目の name 列をブックマーク追加
        const itemTable = await openTableAsync(page, 'item');
        await rightClickCellAsync(page, itemTable, 0, 1);
        await clickContextMenuItemAsync(page, 'ブックマークに追加');
        // enemy テーブルに切り替える
        await openTableAsync(page, 'enemy');
        // item テーブルに戻る
        const returnedTable = await openTableAsync(page, 'item');
        // data-bookmarked 属性が維持されていること
        const cell = getDataCell(returnedTable, 0, 1);
        await expect(cell).toHaveAttribute('data-bookmarked', '');
    });

    test('テーブル初回表示時にbookmarks.jsonのブックマークマークが描画されている', async ({page}) => {
        // bookmarks.json に2件のセルブックマークを事前設定した状態で起動する
        const savedBookmarks = [
            {tableName: 'item', rowKey: '1', columnName: 'name', label: 'Sword', createdAt: '2026-01-01T00:00:00.000Z'},
            {tableName: 'item', rowKey: '2', columnName: 'value', label: '200', createdAt: '2026-01-01T00:00:00.000Z'},
        ];
        const fs = createBookmarkTestFileSystemWithPersistence(savedBookmarks);
        await installMockApiAsync(page, fs);
        await page.goto('/');
        // item テーブルを初回オープンする
        const table = await openTableAsync(page, 'item');
        // 1行目(rowIndex=0) name列(colIndex=1) に data-bookmarked 属性が付与されていること
        const cell1 = getDataCell(table, 0, 1);
        await expect(cell1).toHaveAttribute('data-bookmarked', '');
        // 2行目(rowIndex=1) value列(colIndex=2) に data-bookmarked 属性が付与されていること
        const cell2 = getDataCell(table, 1, 2);
        await expect(cell2).toHaveAttribute('data-bookmarked', '');
        // ブックマークされていないセルには data-bookmarked 属性がないこと
        const cell3 = getDataCell(table, 0, 0);
        await expect(cell3).not.toHaveAttribute('data-bookmarked');
    });
});

// =========================================================================
// Ctrl+D ショートカット
// =========================================================================
test.describe('Ctrl+D ブックマークショートカット', () => {
    test.beforeEach(async ({page}) => {
        const fs = createBookmarkTestFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test('セル選択状態でCtrl+Dを押すとブックマークが追加される', async ({page}) => {
        // item テーブルを開いて1行目の name 列をクリックして選択
        const table = await openTableAsync(page, 'item');
        await selectCellAsync(page, table, 0, 1);
        // Ctrl+D を押す
        await page.keyboard.press('Control+d');
        // ブックマークパネルを開いてエントリが1件追加されていること
        await openBookmarkPanelAsync(page);
        const entries = getBookmarkEntries(page);
        await expect(entries).toHaveCount(1);
    });

    test('ブックマーク済みセル選択状態でCtrl+Dを押すとブックマークが解除される（トグル動作）', async ({page}) => {
        // item テーブルを開いて1行目の name 列をクリックして選択
        const table = await openTableAsync(page, 'item');
        await selectCellAsync(page, table, 0, 1);
        // Ctrl+D で追加
        await page.keyboard.press('Control+d');
        // ブックマークパネルでエントリ1件を確認
        await openBookmarkPanelAsync(page);
        const entries = getBookmarkEntries(page);
        await expect(entries).toHaveCount(1);
        // アクティビティバーの files アイコンをクリックしてサイドバーを戻す（ブックマークパネルを閉じる）
        await page.locator('.activity-bar-item[data-panel="files"]').click();
        // 同じセルを再度クリックして Ctrl+D で解除
        await selectCellAsync(page, table, 0, 1);
        await page.keyboard.press('Control+d');
        // ブックマークパネルを開いてエントリが0件であること
        await openBookmarkPanelAsync(page);
        await expect(entries).toHaveCount(0);
    });

    test('Ctrl+Dでブックマーク追加するとdata-bookmarked属性が付与される', async ({page}) => {
        // item テーブルを開いて1行目の name 列をクリックして選択
        const table = await openTableAsync(page, 'item');
        await selectCellAsync(page, table, 0, 1);
        // Ctrl+D を押す
        await page.keyboard.press('Control+d');
        // 該当セルに data-bookmarked 属性が付与されていること
        const cell = getDataCell(table, 0, 1);
        await expect(cell).toHaveAttribute('data-bookmarked', '');
    });
});

// =========================================================================
// コマンドパレット @bookmark プレフィクス
// =========================================================================
test.describe('コマンドパレット @bookmark プレフィクス', () => {
    test.beforeEach(async ({page}) => {
        const fs = createBookmarkTestFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test('@bookmarkと入力するとブックマーク一覧が表示される', async ({page}) => {
        // item テーブルを開いて2件ブックマーク追加
        const table = await openTableAsync(page, 'item');
        await rightClickCellAsync(page, table, 0, 1);
        await clickContextMenuItemAsync(page, 'ブックマークに追加');
        await rightClickCellAsync(page, table, 1, 1);
        await clickContextMenuItemAsync(page, 'ブックマークに追加');
        // Ctrl+P でコマンドパレットを開く
        await page.keyboard.press('Control+p');
        const paletteInput = page.locator('.command-palette-input');
        await expect(paletteInput).toBeVisible();
        // @bookmark と入力する
        await paletteInput.fill('@bookmark');
        // 候補リストにブックマーク一覧が表示されること（2件）
        const items = page.locator('.command-palette-item');
        await expect(items).toHaveCount(2);
    });

    test('@bookmark候補をクリックすると該当セルにジャンプする', async ({page}) => {
        // item テーブルを開いて2行目の name 列（id=2, Shield）をブックマーク追加
        const table = await openTableAsync(page, 'item');
        await rightClickCellAsync(page, table, 1, 1);
        await clickContextMenuItemAsync(page, 'ブックマークに追加');
        // enemy テーブルを開いてアクティブタブを切り替える
        await openTableAsync(page, 'enemy');
        // Ctrl+P でコマンドパレットを開き @bookmark と入力
        await page.keyboard.press('Control+p');
        const paletteInput = page.locator('.command-palette-input');
        await paletteInput.fill('@bookmark');
        // 候補リストの最初のアイテムをクリック
        const items = page.locator('.command-palette-item');
        await expect(items).toHaveCount(1);
        await items.first().click();
        // item テーブルがアクティブになりセレクションが表示されること
        const itemTable = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="item"] .editor-table');
        await expect(itemTable).toBeVisible();
        const selectionCell = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="item"] .sel-top');
        await expect(selectionCell.first()).toBeVisible();
    });

    test('ブックマークが0件のとき@bookmarkで空メッセージが表示される', async ({page}) => {
        // ブックマークを追加せずにコマンドパレットを開く
        await page.locator('body').click({position: {x: 1, y: 1}});
        await page.keyboard.press('Control+p');
        const paletteInput = page.locator('.command-palette-input');
        await paletteInput.fill('@bookmark');
        // 候補リストが空であること（空メッセージまたは候補0件）
        const items = page.locator('.command-palette-item');
        await expect(items).toHaveCount(0);
        // 「該当する項目がありません」等の空メッセージが表示されること
        const emptyMessage = page.locator('.command-palette-empty');
        await expect(emptyMessage).toBeVisible();
    });
});
