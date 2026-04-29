import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// 起動時全テーブルバリデーションスキャン機能のテスト
//
// 機能概要:
//   アプリケーション起動時にバックグラウンドで全テーブルを走査し、
//   タブを開かなくてもバリデーションエラー（PK重複・FK参照切れ・型不一致）を
//   PROBLEMSパネルとステータスバーバッジに表示する。
//
// テストケース一覧:
//   1. 起動後、タブを一つも開かずにステータスバーのエラーバッジにエラー件数が表示される
//   2. PROBLEMSパネルを開くとエラー項目が表示されている
//   3. 複数テーブルにまたがるエラーが横断的に検出される
//   4. タブ未オープンでも動的参照のFK切れを検出する
// =============================================================================

// =============================================================================
// フィクスチャ生成ヘルパー
// =============================================================================

/**
 * 起動時バリデーションテスト用のファイルシステムを生成する
 *
 * product テーブル: id=1 が2行存在するPK重複あり（2件のPK重複エラーが検出されるべき）
 * enemy テーブル: id=3 が2行存在するPK重複あり（2件のPK重複エラーが検出されるべき）
 *
 * 合計4件のPK重複エラーが、タブを開かずとも起動直後に検出される想定
 */
function createInitialScanFileSystem(): MockFileSystem {
    return {
        "schema/product.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
            ],
            primary_key: ["id"],
        }),
        "data/product.csv": [
            "id,name",
            "1,sword",
            "1,shield",
            "2,potion",
        ].join("\n"),
        "schema/enemy.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                { key: 2, name: "hp", type: "int" },
            ],
            primary_key: ["id"],
        }),
        "data/enemy.csv": [
            "id,name,hp",
            "1,goblin,100",
            "2,dragon,500",
            "3,slime,50",
            "3,orc,200",
        ].join("\n"),
    };
}

/**
 * 動的参照を含む起動時バリデーションテスト用のファイルシステムを生成する。
 *
 * shop_product.record_id は table_id の値から参照先テーブルを解決する。
 * table_id=2 は item.id を指すが、record_id=999 は item に存在しないため
 * タブ未オープンでもFK切れ1件として検出されるべき。
 */
function createInitialDynamicReferenceScanFileSystem(): MockFileSystem {
    return {
        "schema/table.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "master", type: "string" },
                { key: 2, name: "column", type: "string" },
            ],
            primary_key: ["id"],
        }),
        "data/table.csv": [
            "id,master,column",
            "1,chara,id",
            "2,item,id",
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
            "1,sword",
            "2,shield",
        ].join("\n"),
        "schema/shop_product.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "table_id", type: "int", reference: "table.id" },
                {
                    key: 2,
                    name: "record_id",
                    type: "int",
                    reference: {
                        sourceTable: "table",
                        sourceMatchColumn: "id",
                        sourceMatchValue: "table_id",
                        destTable: "master",
                        destColumn: "column",
                    },
                },
            ],
            primary_key: ["id"],
        }),
        "data/shop_product.csv": [
            "id,table_id,record_id",
            "1,2,999",
        ].join("\n"),
    };
}

// =============================================================================
// テストヘルパー関数
// =============================================================================

/**
 * ステータスバーのエラーバッジを返す
 */
function getStatusBarBadge(page: Page): Locator {
    return page.locator('.status-bar-badge');
}

/**
 * バリデーションパネルのエラーアイテムを返す
 */
function getValidationPanelItems(page: Page): Locator {
    return page.locator('.validation-panel .validation-panel-item');
}

/**
 * ステータスバーのバッジをクリックしてPROBLEMSパネルを開く
 */
async function openValidationPanelAsync(page: Page): Promise<void> {
    await getStatusBarBadge(page).click();
}

// =============================================================================
// テストケース1: 起動後、タブを一つも開かずにステータスバーにエラー件数が表示される
// =============================================================================

test.describe('起動時全テーブルバリデーション: ステータスバーのエラーバッジ', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createInitialScanFileSystem());
        await page.goto('/');
    });

    test(
        'タブを一つも開かずに、ステータスバーのエラーバッジにPK重複エラーの件数が表示される',
        async ({ page }) => {
            const badge = getStatusBarBadge(page);

            // ステータスバーが表示されていることを確認する
            await expect(badge).toBeVisible();

            // タブを一切開かずに、エラー件数が0より大きいことを確認する
            // product テーブルのPK重複2件 + enemy テーブルのPK重複2件 = 合計4件
            // 初期スキャンが完了するまで待機する（バックグラウンド処理のため非同期）
            await expect(badge.locator('.status-bar-badge-count')).not.toHaveText('0', { timeout: 10000 });

            // 正確な件数を確認する: product(id=1が2行→2件) + enemy(id=3が2行→2件) = 4件
            await expect(badge.locator('.status-bar-badge-count')).toHaveText('4', { timeout: 10000 });
        },
    );
});

// =============================================================================
// テストケース2: PROBLEMSパネルを開くとエラー項目が表示されている
// =============================================================================

test.describe('起動時全テーブルバリデーション: PROBLEMSパネルのエラー表示', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createInitialScanFileSystem());
        await page.goto('/');
    });

    test(
        'タブを開かずにPROBLEMSパネルを開くと、全テーブルのPK重複エラーが表示されている',
        async ({ page }) => {
            const badge = getStatusBarBadge(page);

            // 初期スキャンの完了を待機する
            await expect(badge.locator('.status-bar-badge-count')).not.toHaveText('0', { timeout: 10000 });

            // PROBLEMSパネルを開く
            await openValidationPanelAsync(page);

            // バリデーションパネルにエラー項目が表示されていることを確認する
            const items = getValidationPanelItems(page);
            await expect(items).not.toHaveCount(0);

            // product テーブルのPK重複エラーが表示されている
            const productErrors = items.filter({ hasText: 'product' });
            await expect(productErrors.first()).toBeVisible();

            // enemy テーブルのPK重複エラーが表示されている
            const enemyErrors = items.filter({ hasText: 'enemy' });
            await expect(enemyErrors.first()).toBeVisible();

            // 合計4件のエラー項目が表示されている
            await expect(items).toHaveCount(4);
        },
    );
});

// =============================================================================
// テストケース3: 複数テーブルにまたがるエラーが横断的に検出される
// =============================================================================

test.describe('起動時全テーブルバリデーション: テーブル横断的なエラー検出', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createInitialScanFileSystem());
        await page.goto('/');
    });

    test(
        'PROBLEMSパネルに product と enemy 両方のグループヘッダーが表示される',
        async ({ page }) => {
            const badge = getStatusBarBadge(page);

            // 初期スキャンの完了を待機する
            await expect(badge.locator('.status-bar-badge-count')).not.toHaveText('0', { timeout: 10000 });

            // PROBLEMSパネルを開く
            await openValidationPanelAsync(page);

            // テーブルごとのグループヘッダーが表示されていることを確認する
            const groupHeaders = page.locator('.validation-panel .validation-panel-group-header');
            await expect(groupHeaders).toHaveCount(2);

            // product グループと enemy グループが存在する
            const productGroup = groupHeaders.filter({ hasText: 'product' });
            await expect(productGroup).toBeVisible();
            const enemyGroup = groupHeaders.filter({ hasText: 'enemy' });
            await expect(enemyGroup).toBeVisible();
        },
    );
});

// =============================================================================
// テストケース4: タブ未オープンでも動的参照のFK切れを検出する
// =============================================================================

test.describe('起動時全テーブルバリデーション: 動的参照', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createInitialDynamicReferenceScanFileSystem());
        await page.goto('/');
    });

    test(
        'タブを一つも開かずに、動的参照のFK切れがPROBLEMSパネルに表示される',
        async ({ page }) => {
            const badge = getStatusBarBadge(page);

            await expect(badge.locator('.status-bar-badge-count')).toHaveText('1', { timeout: 10000 });

            await openValidationPanelAsync(page);

            const items = getValidationPanelItems(page);
            await expect(items).toHaveCount(1);
            await expect(items.first()).toContainText('shop_product');
            await expect(items.first()).toContainText('record_id');
            await expect(items.first()).toContainText('item.id');
        },
    );
});
