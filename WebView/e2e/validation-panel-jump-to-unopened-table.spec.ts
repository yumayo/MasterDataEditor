import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// バリデーションパネル: 未開テーブルへのエラージャンプ
//
// 機能概要:
//   エラーパネルのエラー項目をクリックしたとき、該当テーブルのタブが
//   まだ開かれていない場合に、テーブルを新規に開いてエラーセルに
//   フォーカスする機能のテスト。
//
// テストケース:
//   1. テーブルを開いてFKエラーを発生させ、タブを閉じた後に
//      エラー項目をクリックすると、テーブルが新規に開かれる
//   2. 新規に開かれたテーブルのエラーセルにフォーカスが移動する
// =============================================================================

// =============================================================================
// フィクスチャ生成ヘルパー
// =============================================================================

/**
 * FK参照切れジャンプテスト用のファイルシステムを生成する
 *
 * category テーブル: id=1（weapon）, id=2（armor）
 * product テーブル: category_id が category.id を参照する
 * product の1行目は category_id=999（存在しない値）で初期状態からFK参照切れ
 */
function createFileSystem(): MockFileSystem {
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
        // category_id=999 は category.id に存在しないためFK参照切れが発生する
        "data/product.csv": [
            "id,category_id,name",
            "1,999,broken_sword",
            "2,2,shield",
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
 * バリデーションパネルのエラーアイテムを返す
 */
function getValidationPanelItems(page: Page): Locator {
    return page.locator('.validation-panel .validation-panel-item');
}

/**
 * ステータスバーのエラーバッジを返す
 */
function getStatusBarBadge(page: Page): Locator {
    return page.locator('.status-bar-badge');
}

/**
 * ステータスバーのバッジをクリックしてバリデーションパネルを開く
 */
async function openValidationPanelAsync(page: Page): Promise<void> {
    await getStatusBarBadge(page).click();
}

// =============================================================================
// テスト: タブが閉じられた後にエラー項目クリックでテーブルが再度開かれる
// =============================================================================

test.describe('バリデーションパネル: 未開テーブルへのエラージャンプ', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createFileSystem());
        await page.goto('/');
    });

    test(
        'テーブルのタブを閉じた後にエラー項目をクリックすると、テーブルが新規に開かれる',
        async ({ page }) => {
            // 1. category テーブルを開く（FK参照先テーブル）
            await openTableAsync(page, 'category');

            // 2. product テーブルを開く（FK参照元テーブル、初期データに category_id=999 でFK参照切れ）
            await openTableAsync(page, 'product');

            // 3. バリデーションパネルを開いてFK参照切れエラーが検出されていることを確認する
            await openValidationPanelAsync(page);
            const items = getValidationPanelItems(page);
            const productFkError = items.filter({ hasText: 'product' });
            await expect(productFkError.first()).toBeVisible();

            // 4. product タブの閉じるボタンをクリックしてタブを閉じる
            //    tabStates から product が除去され、タブが消える
            const productTabButton = page.locator('.tab-button').filter({ hasText: 'product' }).first();
            await productTabButton.locator('.tab-button-close').click();

            // 5. product タブが閉じられたことを確認する
            //    （category タブに切り替わっているはず）
            const productTabWrapper = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="product"]`);
            await expect(productTabWrapper).toHaveCount(0);

            // 6. パネルに残っている product テーブルのFK参照切れエラー項目をクリックする
            //    navigateToTableCell() によりタブが新規作成される
            await productFkError.first().click();

            // 7. product テーブルのタブが新しく開かれることを検証する
            const reopenedProductTable = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="product"] .editor-table`);
            await expect(reopenedProductTable).toBeVisible({ timeout: 5000 });

            // 8. product タブのタブボタンがアクティブであることを確認する
            const activeTabButton = page.locator('.tab-button.tab-button-active');
            await expect(activeTabButton).toHaveText(/product/);
        },
    );

    test(
        'テーブルのタブを閉じた後にエラー項目をクリックすると、エラーセルにフォーカスが移動する',
        async ({ page }) => {
            // 1. category テーブルを開く（FK参照先テーブル）
            await openTableAsync(page, 'category');

            // 2. product テーブルを開く（FK参照元テーブル、初期データに category_id=999 でFK参照切れ）
            await openTableAsync(page, 'product');

            // 3. バリデーションパネルを開いてFK参照切れエラーが検出されていることを確認する
            await openValidationPanelAsync(page);
            const items = getValidationPanelItems(page);
            const productFkError = items.filter({ hasText: 'product' });
            await expect(productFkError.first()).toBeVisible();

            // 4. product タブの閉じるボタンをクリックしてタブを閉じる
            const productTabButton = page.locator('.tab-button').filter({ hasText: 'product' }).first();
            await productTabButton.locator('.tab-button-close').click();

            // 5. product タブが閉じられたことを確認する
            const productTabWrapper = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="product"]`);
            await expect(productTabWrapper).toHaveCount(0);

            // 6. パネルに残っている product テーブルのFK参照切れエラー項目をクリックする
            await productFkError.first().click();

            // 7. product テーブルが新規に開かれることを待つ
            const reopenedProductTable = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="product"] .editor-table`);
            await expect(reopenedProductTable).toBeVisible({ timeout: 5000 });

            // 8. FK参照切れエラーのセル（category_id列=colIndex 1、1行目=rowIndex 0）に
            //    フォーカスが移動していることを検証する。
            //    フォーカスセルは editor-table-cell-focused クラスで特定できる。
            const focusedCell = reopenedProductTable.locator('.editor-table-cell-focused');
            await expect(focusedCell).toBeVisible({ timeout: 5000 });

            // 9. フォーカスされたセルの値が FK参照切れの値（999）であることを検証する
            //    これにより正しいセルにフォーカスが当たっていることを確認できる
            await expect(focusedCell).toHaveText('999');
        },
    );
});
