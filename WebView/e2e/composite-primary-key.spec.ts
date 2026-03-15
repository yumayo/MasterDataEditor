import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// 複合主キー対応のテスト（REDテスト）
//
// 機能概要:
//   現在の実装は `primary_key: "id"` の単一PKのみ対応している。
//   複合主キー（`primary_key: ["shop_id", "product_id"]` のような配列形式）を
//   スキーマで定義した場合、現行の validatePkDuplicates() は
//   config.primaryKeyColumnName（固定文字列 "id"）でPK列を探して -1 になり、
//   バリデーションがスキップされる。そのため cell-pk-duplicate が付与されない。
//
// テストが RED になる理由:
//   スキーマパーサー（EditorTableData.parse）が primary_key 配列を考慮しないため、
//   validatePkDuplicates() が複合PKの重複を検出できない。
//
// テストケース一覧:
//   1. 複合主キーの重複検出（両方のPK構成列のセルに cell-pk-duplicate が付与される）
//   2. 複合主キーの重複解消（cell-pk-duplicate が除去される）
//   3. 複合主キーで空値は重複チェック対象外
//   4. 初期表示で複合主キー重複が検出される
//   5. 単一主キーとの後方互換性（既存の string 形式でも正常動作する）
// =============================================================================

// =============================================================================
// フィクスチャ生成ヘルパー
// =============================================================================

/**
 * 複合主キー（shop_id, product_id）を持つ shop_product テーブルのファイルシステムを生成する。
 * 初期データは重複なし（(1,101), (1,102), (2,101)）。
 */
function createShopProductFileSystem(): MockFileSystem {
    return {
        "schema/shop_product.json": JSON.stringify({
            header: [
                { key: 0, name: "shop_id", type: "int" },
                { key: 1, name: "product_id", type: "int" },
                { key: 2, name: "price", type: "int" },
            ],
            primary_key: ["shop_id", "product_id"],
        }),
        "data/shop_product.csv": [
            "shop_id,product_id,price",
            "1,101,500",
            "1,102,300",
            "2,101,480",
        ].join("\n"),
    };
}

/**
 * 初期データから複合主キーの重複がある shop_product テーブルのファイルシステムを生成する。
 * テストケース4（初期表示で重複検出）用。
 * 1行目と2行目が (shop_id=1, product_id=101) で重複している。
 */
function createInitialDuplicateShopProductFileSystem(): MockFileSystem {
    return {
        "schema/shop_product.json": JSON.stringify({
            header: [
                { key: 0, name: "shop_id", type: "int" },
                { key: 1, name: "product_id", type: "int" },
                { key: 2, name: "price", type: "int" },
            ],
            primary_key: ["shop_id", "product_id"],
        }),
        // (1,101) が1行目と2行目で重複している
        "data/shop_product.csv": [
            "shop_id,product_id,price",
            "1,101,500",
            "1,101,300",
            "2,101,480",
        ].join("\n"),
    };
}

/**
 * 単一主キー（id 列）を持つアイテムテーブルのファイルシステムを生成する。
 * テストケース5（後方互換性）用。
 */
function createSinglePkItemFileSystem(): MockFileSystem {
    return {
        "schema/item.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
            ],
            primary_key: "id",
        }),
        "data/item.csv": [
            "id,name",
            "1,sword",
            "2,shield",
            "3,potion",
        ].join("\n"),
    };
}

// =============================================================================
// テストヘルパー関数
// =============================================================================

/**
 * エクスプローラーからテーブルを開き、タブ名で絞り込んだ EditorTable の Locator を返す
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
    const table = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="${tableName}"] .editor-table`);
    await expect(table).toBeVisible();
    return table;
}

/**
 * 指定行・列のデータセルをダブルクリックして新しい値を入力しEnterで確定する。
 * rowIndex: 0始まり（ヘッダー行を除く）、colIndex: 0始まり（行ヘッダーを除く）
 */
async function editCellAsync(
    table: Locator,
    page: Page,
    rowIndex: number,
    colIndex: number,
    newValue: string,
): Promise<void> {
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

/**
 * 指定行の指定列インデックスのデータセルを返す。
 * rowIndex: 0始まり（ヘッダー行を除く）、colIndex: 0始まり（行ヘッダーを除く）
 */
function getDataCell(table: Locator, rowIndex: number, colIndex: number): Locator {
    const row = table.locator('.editor-table-row').nth(rowIndex + 1);
    return row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
}

// =============================================================================
// テストケース1: 複合主キーの重複検出
// =============================================================================

test.describe('テストケース1: 複合主キーの重複検出', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createShopProductFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        '3行目のshop_idを1に変更すると(1,101)が重複し、1行目と3行目の両PK構成列に cell-pk-duplicate が付与される',
        async ({ page }) => {
            const table = await openTableAsync(page, 'shop_product');

            // 初期状態: 重複なし。全PK構成列に cell-pk-duplicate クラスがないことを確認する
            const row1ShopId = getDataCell(table, 0, 0);  // 1行目 shop_id=1
            const row1ProductId = getDataCell(table, 0, 1); // 1行目 product_id=101
            const row2ShopId = getDataCell(table, 1, 0);  // 2行目 shop_id=1
            const row2ProductId = getDataCell(table, 1, 1); // 2行目 product_id=102
            const row3ShopId = getDataCell(table, 2, 0);  // 3行目 shop_id=2（変更前）
            const row3ProductId = getDataCell(table, 2, 1); // 3行目 product_id=101
            await expect(row1ShopId).not.toHaveClass(/cell-pk-duplicate/);
            await expect(row1ProductId).not.toHaveClass(/cell-pk-duplicate/);
            await expect(row2ShopId).not.toHaveClass(/cell-pk-duplicate/);
            await expect(row2ProductId).not.toHaveClass(/cell-pk-duplicate/);
            await expect(row3ShopId).not.toHaveClass(/cell-pk-duplicate/);
            await expect(row3ProductId).not.toHaveClass(/cell-pk-duplicate/);

            // 3行目の shop_id（=2）を 1 に変更して (1,101) の重複を発生させる
            await editCellAsync(table, page, 2, 0, '1');

            // 1行目と3行目の shop_id・product_id 両セルに cell-pk-duplicate が付与されることを確認する
            // 現行実装は config.primaryKeyColumnName（="id"）の単一PKしか検出しないため RED
            await expect(row1ShopId).toHaveClass(/cell-pk-duplicate/);
            await expect(row1ProductId).toHaveClass(/cell-pk-duplicate/);
            await expect(row3ShopId).toHaveClass(/cell-pk-duplicate/);
            await expect(row3ProductId).toHaveClass(/cell-pk-duplicate/);

            // 2行目は (1,102) で重複していないため cell-pk-duplicate が付与されないことを確認する
            // (shop_id=1 が1行目と一致するが、product_id=102 は一致しないため重複ではない)
            await expect(row2ShopId).not.toHaveClass(/cell-pk-duplicate/);
            await expect(row2ProductId).not.toHaveClass(/cell-pk-duplicate/);
        },
    );
});

// =============================================================================
// テストケース2: 複合主キーの重複解消
// =============================================================================

test.describe('テストケース2: 複合主キーの重複解消', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createShopProductFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        '重複状態から shop_id を別の値に変更すると cell-pk-duplicate が除去される',
        async ({ page }) => {
            const table = await openTableAsync(page, 'shop_product');

            // まず重複を発生させる: 3行目の shop_id を 1 に変更して (1,101) を重複させる
            await editCellAsync(table, page, 2, 0, '1');

            const row1ShopId = getDataCell(table, 0, 0);
            const row1ProductId = getDataCell(table, 0, 1);
            const row3ShopId = getDataCell(table, 2, 0);
            const row3ProductId = getDataCell(table, 2, 1);

            // 重複状態を確認する（テストケース1と同様にREDとなる想定だが、
            // 重複解消の確認のため重複が発生していることを前提として進める）
            await expect(row1ShopId).toHaveClass(/cell-pk-duplicate/);
            await expect(row1ProductId).toHaveClass(/cell-pk-duplicate/);
            await expect(row3ShopId).toHaveClass(/cell-pk-duplicate/);
            await expect(row3ProductId).toHaveClass(/cell-pk-duplicate/);

            // 重複を解消する: 3行目の shop_id をユニークな値 3 に変更する → (3,101) で一意
            await editCellAsync(table, page, 2, 0, '3');

            // cell-pk-duplicate クラスがすべてのセルから除去されることを確認する
            // 現行実装は複合PKを認識しないため、除去も正しく動作しない → RED
            await expect(row1ShopId).not.toHaveClass(/cell-pk-duplicate/);
            await expect(row1ProductId).not.toHaveClass(/cell-pk-duplicate/);
            await expect(row3ShopId).not.toHaveClass(/cell-pk-duplicate/);
            await expect(row3ProductId).not.toHaveClass(/cell-pk-duplicate/);
        },
    );
});

// =============================================================================
// テストケース3: 複合主キーで空値は重複チェック対象外
// =============================================================================

test.describe('テストケース3: 複合主キーで空値は重複チェック対象外', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createShopProductFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        '複合PKの構成列のいずれかが空文字の場合、その行は重複チェック対象外となり cell-pk-duplicate が付与されない',
        async ({ page }) => {
            const table = await openTableAsync(page, 'shop_product');

            // 1行目の shop_id を空文字に変更する → (,101) は重複チェック対象外
            await editCellAsync(table, page, 0, 0, '');

            // 3行目の shop_id を空文字に変更する → (,101) は重複チェック対象外
            // 複数行でPK構成列が空でも重複判定しない
            await editCellAsync(table, page, 2, 0, '');

            const row1ShopId = getDataCell(table, 0, 0);
            const row1ProductId = getDataCell(table, 0, 1);
            const row3ShopId = getDataCell(table, 2, 0);
            const row3ProductId = getDataCell(table, 2, 1);

            // 空値を持つ行には cell-pk-duplicate が付与されないことを確認する
            // 複合PKの構成列が1つでも空であれば、その行全体を重複チェック対象外とする
            // 現行実装では複合PKを認識しないためこのテストは別の理由でREDになる想定
            await expect(row1ShopId).not.toHaveClass(/cell-pk-duplicate/);
            await expect(row1ProductId).not.toHaveClass(/cell-pk-duplicate/);
            await expect(row3ShopId).not.toHaveClass(/cell-pk-duplicate/);
            await expect(row3ProductId).not.toHaveClass(/cell-pk-duplicate/);
        },
    );
});

// =============================================================================
// テストケース4: 初期表示で複合主キー重複が検出される
// =============================================================================

test.describe('テストケース4: 初期表示で複合主キー重複が検出される', () => {
    test.beforeEach(async ({ page }) => {
        // 初期データに複合PKの重複がある状態でテーブルを開く
        const fs = createInitialDuplicateShopProductFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        'テーブルを開いた時点で複合PK重複行の両PK構成列に cell-pk-duplicate が付与される',
        async ({ page }) => {
            const table = await openTableAsync(page, 'shop_product');

            // 初期データ: (1,101) が1行目と2行目で重複している
            const row1ShopId = getDataCell(table, 0, 0);
            const row1ProductId = getDataCell(table, 0, 1);
            const row2ShopId = getDataCell(table, 1, 0);
            const row2ProductId = getDataCell(table, 1, 1);
            const row3ShopId = getDataCell(table, 2, 0);
            const row3ProductId = getDataCell(table, 2, 1);

            // テーブルオープン直後に複合PK重複の両行・両列に cell-pk-duplicate が付与されることを確認する
            // 現行実装は config.primaryKeyColumnName（="id"）列が存在しないテーブルでは
            // validatePkDuplicates() が早期リターンするため RED
            await expect(row1ShopId).toHaveClass(/cell-pk-duplicate/);
            await expect(row1ProductId).toHaveClass(/cell-pk-duplicate/);
            await expect(row2ShopId).toHaveClass(/cell-pk-duplicate/);
            await expect(row2ProductId).toHaveClass(/cell-pk-duplicate/);

            // 3行目は (2,101) で重複していないため cell-pk-duplicate が付与されないことを確認する
            await expect(row3ShopId).not.toHaveClass(/cell-pk-duplicate/);
            await expect(row3ProductId).not.toHaveClass(/cell-pk-duplicate/);
        },
    );
});

// =============================================================================
// テストケース5: 単一主キーとの後方互換性
// =============================================================================

test.describe('テストケース5: 単一主キーとの後方互換性', () => {
    test.beforeEach(async ({ page }) => {
        // 既存の string 形式 primary_key: "id" のテーブルを使う
        const fs = createSinglePkItemFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        '既存の primary_key: "id" 形式のテーブルが正常に開け、単一PK重複も正しく検出される',
        async ({ page }) => {
            const table = await openTableAsync(page, 'item');

            // 初期状態: id=1,2,3 で重複なし
            const row1PkCell = getDataCell(table, 0, 0);
            const row2PkCell = getDataCell(table, 1, 0);
            await expect(row1PkCell).not.toHaveClass(/cell-pk-duplicate/);
            await expect(row2PkCell).not.toHaveClass(/cell-pk-duplicate/);

            // 2行目の id を 1 に変更して単一PK重複を発生させる
            await editCellAsync(table, page, 1, 0, '1');

            // 両方の id セルに cell-pk-duplicate が付与されることを確認する
            // 単一PK対応は現行実装で既に動作しているため GREEN
            await expect(row1PkCell).toHaveClass(/cell-pk-duplicate/);
            await expect(row2PkCell).toHaveClass(/cell-pk-duplicate/);

            // 3行目（id=3）には cell-pk-duplicate が付与されないことを確認する
            const row3PkCell = getDataCell(table, 2, 0);
            await expect(row3PkCell).not.toHaveClass(/cell-pk-duplicate/);
        },
    );
});
