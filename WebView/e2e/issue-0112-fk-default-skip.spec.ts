import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// ISSUE-0112: FK検証でデフォルト値をスキップする
//
// 機能概要:
//   ゲームのマスターデータではFK列に「参照なし」を意味するデフォルト値（例: int型で 0）が
//   頻繁に使われる。型ごとのデフォルト値やスキーマで明示指定されたデフォルト値は
//   FK参照切れエラーの検証対象から除外する。
//
// デフォルト値の決定ルール:
//   1. スキーマに "default" フィールドが指定されている → String(default) と一致でスキップ
//   2. スキーマに "default" なし → 型デフォルト（int: "0", string: "", bool: "false"）と一致でスキップ
//   3. 空文字 → 従来通りスキップ（未入力扱い）
//
// テストケース一覧:
//   1. int型FK列にデフォルト値 0 を入力 → FK参照切れエラーにならない
//   2. int型FK列の空セル → FK参照切れエラーにならない（現行動作維持）
//   3. スキーマで "default": 999 と明示した列に 999 → エラーにならない
//   4. デフォルト値以外の不正値（参照先に存在しない値） → エラーになる
//   5. 動的参照（DynamicReference）でもデフォルト値スキップが機能する
// =============================================================================

// =============================================================================
// フィクスチャ生成ヘルパー
// =============================================================================

/**
 * int型FK列のデフォルト値(0)スキップテスト用ファイルシステム。
 * category テーブル: id=1,2（参照先に 0 は存在しない）
 * product テーブル: category_id が category.id を参照する int型FK列
 * スキーマに default 指定なし → 型デフォルト(int → "0") が適用される
 */
function createIntDefaultFileSystem(): MockFileSystem {
    return {
        "schema/category.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
            ],
            primary_key: ["id"],
        }),
        "data/category.csv": [
            "id,name",
            "1,weapon",
            "2,armor",
        ].join("\n"),
        "schema/product.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "category_id", type: "int", reference: "category.id" },
                { key: 2, name: "name", type: "string" },
            ],
            primary_key: ["id"],
        }),
        "data/product.csv": [
            "id,category_id,name",
            "1,1,sword",
            "2,2,shield",
        ].join("\n"),
    };
}

/**
 * スキーマ明示 default=999 テスト用ファイルシステム。
 * category テーブル: id=1,2（参照先に 999 は存在しない）
 * product テーブル: category_id の default が 999 に設定されている
 */
function createExplicitDefaultFileSystem(): MockFileSystem {
    return {
        "schema/category.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
            ],
            primary_key: ["id"],
        }),
        "data/category.csv": [
            "id,name",
            "1,weapon",
            "2,armor",
        ].join("\n"),
        "schema/product.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "category_id", type: "int", reference: "category.id", default: 999 },
                { key: 2, name: "name", type: "string" },
            ],
            primary_key: ["id"],
        }),
        "data/product.csv": [
            "id,category_id,name",
            "1,1,sword",
            "2,2,shield",
        ].join("\n"),
    };
}

/**
 * 動的参照のデフォルト値スキップテスト用ファイルシステム。
 * table テーブル: id=1(chara), id=2(item)
 * chara テーブル: id=1,2,3
 * item テーブル: id=1,2
 * quest テーブル: reward_table_id → table.id, reward_record_id → 動的参照
 *   reward_record_id は int型で default 指定なし → 型デフォルト "0" が適用される
 */
function createDynamicRefDefaultFileSystem(): MockFileSystem {
    return {
        "schema/table.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "enum", type: "string" },
                { key: 2, name: "comment", type: "string" },
                { key: 3, name: "master", type: "string" },
            ],
            primary_key: ["id"],
        }),
        "data/table.csv": [
            "id,enum,comment,master",
            "1,chara,キャラ,chara",
            "2,item,アイテム,item",
        ].join("\n"),
        "schema/chara.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
            ],
            primary_key: ["id"],
        }),
        "data/chara.csv": [
            "id,name",
            "1,うーぱー",
            "2,ひつじ",
            "3,まんぼう",
        ].join("\n"),
        "schema/item.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
            ],
            primary_key: ["id"],
        }),
        "data/item.csv": [
            "id,name",
            "1,ポーション",
            "2,エリクサー",
        ].join("\n"),
        "schema/quest.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "reward_table_id", type: "int", reference: "table.id" },
                { key: 2, name: "reward_record_id", type: "int", reference: { sourceTable: "table", sourceMatchColumn: "id", sourceMatchValue: "reward_table_id", destTable: "master", destColumn: "id" } },
            ],
            primary_key: ["id"],
        }),
        "data/quest.csv": [
            "id,reward_table_id,reward_record_id",
            "1,1,3",
            "2,2,1",
        ].join("\n"),
    };
}

// =============================================================================
// テストヘルパー関数
// =============================================================================

/** エクスプローラーからテーブルを開き、タブ名で絞り込んだ EditorTable の Locator を返す */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
    const table = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="${tableName}"] .editor-table`);
    await expect(table).toBeVisible();
    return table;
}

/** 指定行・列のデータセルをダブルクリックして新しい値を入力しEnterで確定する */
async function editCellAsync(table: Locator, page: Page, rowIndex: number, colIndex: number, newValue: string): Promise<void> {
    const row = table.locator('.editor-table-row').nth(rowIndex + 1);
    const cell = row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
    await expect(cell).toBeVisible();
    await cell.dblclick();
    const editField = page.locator('.grid-textfield-active');
    await expect(editField).toBeVisible();
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText(newValue);
    await page.keyboard.press('Enter');
}

/** バリデーションパネルのエラーアイテムを返す */
function getValidationPanelItems(page: Page): Locator {
    return page.locator('.validation-panel .validation-panel-item');
}

/** FK切れエラーアイテムのみを返す */
function getFkBrokenItems(page: Page): Locator {
    return page.locator('.validation-panel .validation-panel-item').filter({
        has: page.locator('.validation-panel-item-kind-fk'),
    });
}

/** ステータスバーのバッジをクリックしてバリデーションパネルを開く */
async function openValidationPanelAsync(page: Page): Promise<void> {
    await page.locator('.status-bar-badge').click();
}

// =============================================================================
// テストケース1: int型FK列にデフォルト値 0 を入力 → FK参照切れエラーにならない
// =============================================================================

test.describe('テストケース1: int型FK列のデフォルト値0はFK検証をスキップする', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createIntDefaultFileSystem());
        await page.goto('/');
    });

    test('category_id に 0 を入力してもFK参照切れエラーにならない', async ({ page }) => {
        const table = await openTableAsync(page, 'product');

        // 初期状態: エラーなし
        await expect(getValidationPanelItems(page)).toHaveCount(0);

        // 1行目の category_id (colIndex=1) を "0" に変更する
        await editCellAsync(table, page, 0, 1, '0');

        // パネルを開いてFK切れエラーが出ていないことを確認する
        await openValidationPanelAsync(page);
        await expect(getFkBrokenItems(page)).toHaveCount(0);
    });
});

// =============================================================================
// テストケース2: int型FK列の空セル → FK参照切れエラーにならない（現行動作維持）
// =============================================================================

test.describe('テストケース2: int型FK列の空セルはFK検証をスキップする（現行維持）', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createIntDefaultFileSystem());
        await page.goto('/');
    });

    test('category_id を空にしてもFK参照切れエラーにならない', async ({ page }) => {
        const table = await openTableAsync(page, 'product');

        // 初期状態: エラーなし
        await expect(getValidationPanelItems(page)).toHaveCount(0);

        // 1行目の category_id (colIndex=1) を空にする
        await editCellAsync(table, page, 0, 1, '');

        // パネルを開いてFK切れエラーが出ていないことを確認する
        await openValidationPanelAsync(page);
        await expect(getFkBrokenItems(page)).toHaveCount(0);
    });
});

// =============================================================================
// テストケース3: スキーマで "default": 999 と明示した列に 999 → エラーにならない
// =============================================================================

test.describe('テストケース3: スキーマ明示 default=999 はFK検証をスキップする', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createExplicitDefaultFileSystem());
        await page.goto('/');
    });

    test('category_id に 999 を入力してもFK参照切れエラーにならない', async ({ page }) => {
        const table = await openTableAsync(page, 'product');

        // 初期状態: エラーなし
        await expect(getValidationPanelItems(page)).toHaveCount(0);

        // 1行目の category_id (colIndex=1) を "999" に変更する
        await editCellAsync(table, page, 0, 1, '999');

        // パネルを開いてFK切れエラーが出ていないことを確認する
        await openValidationPanelAsync(page);
        await expect(getFkBrokenItems(page)).toHaveCount(0);
    });

    test('明示 default=999 でも、それ以外の不正値はエラーになる', async ({ page }) => {
        const table = await openTableAsync(page, 'product');

        // 初期状態: エラーなし
        await expect(getValidationPanelItems(page)).toHaveCount(0);

        // 1行目の category_id (colIndex=1) を "888" に変更する（888は参照先にもdefaultにも存在しない）
        await editCellAsync(table, page, 0, 1, '888');

        // パネルを開いてFK切れエラーが1件出ることを確認する
        await openValidationPanelAsync(page);
        await expect(getFkBrokenItems(page)).toHaveCount(1);
    });
});

// =============================================================================
// テストケース4: デフォルト値以外の不正値 → エラーになる
// =============================================================================

test.describe('テストケース4: デフォルト値以外の不正値はFK参照切れエラーになる', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createIntDefaultFileSystem());
        await page.goto('/');
    });

    test('参照先に存在しない値 777 を入力するとFK参照切れエラーになる', async ({ page }) => {
        const table = await openTableAsync(page, 'product');

        // 初期状態: エラーなし
        await expect(getValidationPanelItems(page)).toHaveCount(0);

        // 1行目の category_id (colIndex=1) を "777" に変更する
        await editCellAsync(table, page, 0, 1, '777');

        // パネルを開いてFK切れエラーが1件出ることを確認する
        await openValidationPanelAsync(page);
        await expect(getFkBrokenItems(page)).toHaveCount(1);
    });
});

// =============================================================================
// テストケース5: 動的参照でもデフォルト値スキップが機能する
// =============================================================================

test.describe('テストケース5: 動的参照でもデフォルト値0はFK検証をスキップする', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createDynamicRefDefaultFileSystem());
        await page.goto('/');
    });

    test('動的参照FK列に 0 を入力してもFK参照切れエラーにならない', async ({ page }) => {
        // quest テーブルを開く
        const table = await openTableAsync(page, 'quest');

        // 初期状態: エラーなし
        await expect(getValidationPanelItems(page)).toHaveCount(0);

        // 1行目の reward_record_id (colIndex=2) を "0" に変更する
        await editCellAsync(table, page, 0, 2, '0');

        // パネルを開いてFK切れエラーが出ていないことを確認する
        await openValidationPanelAsync(page);
        await expect(getFkBrokenItems(page)).toHaveCount(0);
    });
});
