import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';
import { enableRelationsPanelAsync } from './fixtures/test-utils';

// =============================================================================
// 参照データ読み込み失敗時の NotificationToast 通知テスト
//
// テストデータ:
//   category テーブル: スキーマのみ定義し、CSVデータは用意しない
//   product テーブル: category_id が category.id を FK 参照する
//   → product テーブルを開くと参照先 category の読み込みに失敗する
//
// 期待動作:
//   参照データの読み込みに失敗した場合、NotificationToast にエラー通知が表示される
// =============================================================================

/**
 * 参照先CSVが存在しないファイルシステムを生成する
 *
 * category のスキーマは存在するがCSVが存在しない。
 * product は category.id を FK 参照しているため、
 * テーブルを開くと参照データの読み込みが失敗する。
 */
function createFileSystemWithMissingReferenceCsv(): MockFileSystem {
    return {
        "schema/category.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
            ],
            primary_key: ["id"],
        }),
        // data/category.csv は意図的に登録しない（読み込み時にエラーが発生する）
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
        ].join("\n"),
    };
}

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

test.describe('参照データ読み込みエラーの通知', () => {
    test('参照データの読み込みに失敗した場合、NotificationToast にエラーが通知される', async ({ page }) => {
        // 参照先CSVが存在しないファイルシステムをインストールする
        const fs = createFileSystemWithMissingReferenceCsv();
        await installMockApiAsync(page, fs);
        await page.goto('/');
        await enableRelationsPanelAsync(page);

        // product テーブルを開く（category.id を FK 参照している）
        await openTableAsync(page, 'product');

        // 参照データの読み込みは非同期で行われるため、トーストの出現を待つ
        const toast = page.locator('.notification-toast').first();
        await expect(toast).toBeVisible({ timeout: 5000 });
        await expect(toast).toContainText('失敗');
    });
});
