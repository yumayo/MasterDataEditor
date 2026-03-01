import { test, expect } from '@playwright/test';
import { Page, Locator } from '@playwright/test';
import {
    installMockApiAsync,
    readMockFileAsync,
    MockFileSystem,
} from './fixtures/mock-api';

/**
 * Explorerでビューテーブルを開き、アクティブなタブのEditorTableを返す
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    if (tableName.startsWith('view_')) {
        await explorer.locator('[data-panel="views"]').click();
    } else {
        await explorer.locator('[data-panel="files"]').click();
    }
    await explorer.getByText(tableName, { exact: true }).click();
    const table = page.locator('.tab-wrapper:not([style*="display: none"]) .editor-table');
    await expect(table).toBeVisible();
    return table;
}

/**
 * 指定した行・列のデータセルを返す
 * rowIndex: 0始まり（ヘッダー行を除く）, colIndex: 0始まり（行ヘッダーを除く）
 */
function getDataCell(table: Locator, rowIndex: number, colIndex: number): Locator {
    const row = table.locator('.editor-table-row').nth(rowIndex + 1);
    return row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
}

/**
 * セルをクリックして選択状態にする
 */
async function selectCellAsync(table: Locator, rowIndex: number, colIndex: number): Promise<void> {
    const cell = getDataCell(table, rowIndex, colIndex);
    await cell.click();
}

/**
 * テーブルの最初のデータセルをクリックしてキーボードイベントのフォーカスを確保する
 */
async function clickFirstCellAsync(table: Locator): Promise<void> {
    const selector = '.editor-table-row:nth-child(2) .editor-table-cell:nth-child(2)';
    await table.locator(selector).click();
}

/**
 * 指定セルをDeleteキーで空にする
 * セルをクリックして選択し、Deleteキーを押す
 */
async function clearCellWithDeleteAsync(page: Page, table: Locator, rowIndex: number, colIndex: number): Promise<void> {
    await selectCellAsync(table, rowIndex, colIndex);
    await page.keyboard.press('Delete');
}

/**
 * 指定セルをBackspaceキーで空にする
 * セルをクリックして選択し、Backspaceキーを押す
 */
async function clearCellWithBackspaceAsync(page: Page, table: Locator, rowIndex: number, colIndex: number): Promise<void> {
    await selectCellAsync(table, rowIndex, colIndex);
    await page.keyboard.press('Backspace');
}

/**
 * テストデータ:
 * shop: id=1(武器屋), id=2(道具屋)
 * shop_product: id=1(shop_id=1,鋭い剣), id=2(shop_id=1,頑丈な盾), id=3(shop_id=1,尖ったかま), id=4(shop_id=2,回復薬)
 *
 * view_shop: shopベース、shop_productをshop.id → shop_product.shop_idでJOIN
 *
 * 期待されるビュー表示（shop_idは非表示）:
 * | shop.id | shop.name | shop_product.id | shop_product.product_name |
 * |    1    |   武器屋  |       1         |       鋭い剣              |  ← リーダー行 (row 0)
 * | [pad]   |   [pad]   |       2         |       頑丈な盾            |  ← パディング (row 1)
 * | [pad]   |   [pad]   |       3         |       尖ったかま          |  ← パディング (row 2)
 * |    2    |   道具屋  |       4         |       回復薬              |  ← リーダー行 (row 3)
 *
 * JOINされた列（shop_product側）: カラム2（shop_product.id）, カラム3（shop_product.product_name）
 * ベーステーブル列（shop側）: カラム0（shop.id）, カラム1（shop.name）
 */
function createViewShopFileSystem(): MockFileSystem {
    return {
        "schema/shop.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
            ],
            primary_key: "id",
        }),
        "data/shop.csv": ["id,name", "1,武器屋", "2,道具屋"].join("\n"),
        "schema/shop_product.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "shop_id", type: "int" },
                { key: 2, name: "product_name", type: "string" },
            ],
            primary_key: "id",
        }),
        "data/shop_product.csv": ["id,shop_id,product_name", "1,1,鋭い剣", "2,1,頑丈な盾", "3,1,尖ったかま", "4,2,回復薬"].join("\n"),
        "view/view_shop.json": JSON.stringify({
            name: "view_shop",
            baseTable: "shop",
            joins: [{
                sourceColumn: "id",
                targetTable: "shop_product",
                targetColumn: "shop_id",
                insertAfterViewColumnIndex: 1,
                sourceTable: "",
            }],
        }),
    };
}

// -------------------------------------------------------
// JOINされた列のセルクリアによる行削除テスト
// -------------------------------------------------------
test.describe('JOINされた列のセルクリアによる行削除', () => {

    test('パディング行のJOIN列をすべてDeleteキーで空にして保存するとCSVから行が削除されること', async ({ page }) => {
        await installMockApiAsync(page, createViewShopFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_shop');

        // 初期状態の確認: 4ビュー行
        // ビュー列: shop.id(0), shop.name(1), shop_product.id(2), shop_product.product_name(3)
        await expect(getDataCell(table, 0, 0)).toHaveText(/1/);
        await expect(getDataCell(table, 0, 1)).toHaveText('武器屋');
        await expect(getDataCell(table, 0, 3)).toHaveText('鋭い剣');
        await expect(getDataCell(table, 1, 3)).toHaveText('頑丈な盾');
        await expect(getDataCell(table, 2, 3)).toHaveText('尖ったかま');
        await expect(getDataCell(table, 3, 0)).toHaveText('2');
        await expect(getDataCell(table, 3, 3)).toHaveText('回復薬');

        // パディング行（row 2、尖ったかま）のJOIN列をDeleteキーで空にする
        // カラム2（shop_product.id）を空にする
        await clearCellWithDeleteAsync(page, table, 2, 2);
        await expect(getDataCell(table, 2, 2)).toHaveText('');
        // カラム3（shop_product.product_name）を空にする
        await clearCellWithDeleteAsync(page, table, 2, 3);
        await expect(getDataCell(table, 2, 3)).toHaveText('');

        // 保存（Ctrl+S）
        await clickFirstCellAsync(table);
        await page.keyboard.press('Control+s');
        await page.waitForTimeout(500);

        // shop_product.csvの内容を検証: id=3の行（尖ったかま）が完全に削除されていること
        const shopProductCsv = await readMockFileAsync(page, 'data/shop_product.csv');
        const lines = shopProductCsv.split('\n').filter((l: string) => l.trim() !== '');
        // ヘッダー + 3データ行（id=1,2,4）= 4行
        expect(lines.length).toBe(4);
        expect(shopProductCsv).toContain('1,1,鋭い剣');
        expect(shopProductCsv).toContain('2,1,頑丈な盾');
        expect(shopProductCsv).not.toContain('尖ったかま');
        expect(shopProductCsv).not.toContain('3,1,');
        expect(shopProductCsv).toContain('4,2,回復薬');

        // shopテーブルは変更なし
        const shopCsv = await readMockFileAsync(page, 'data/shop.csv');
        expect(shopCsv).toContain('1,武器屋');
        expect(shopCsv).toContain('2,道具屋');
    });

    test('パディング行のJOIN列をすべてBackspaceで空にして保存するとCSVから行が削除されること', async ({ page }) => {
        await installMockApiAsync(page, createViewShopFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_shop');

        // 初期状態の確認
        await expect(getDataCell(table, 2, 2)).toHaveText('3');
        await expect(getDataCell(table, 2, 3)).toHaveText('尖ったかま');

        // パディング行（row 2、尖ったかま）のJOIN列をBackspaceキーで空にする
        // カラム2（shop_product.id）を空にする
        await clearCellWithBackspaceAsync(page, table, 2, 2);
        await expect(getDataCell(table, 2, 2)).toHaveText('');
        // カラム3（shop_product.product_name）を空にする
        await clearCellWithBackspaceAsync(page, table, 2, 3);
        await expect(getDataCell(table, 2, 3)).toHaveText('');

        // 保存（Ctrl+S）
        await clickFirstCellAsync(table);
        await page.keyboard.press('Control+s');
        await page.waitForTimeout(500);

        // shop_product.csvの内容を検証: id=3の行が完全に削除されていること
        const shopProductCsv = await readMockFileAsync(page, 'data/shop_product.csv');
        const lines = shopProductCsv.split('\n').filter((l: string) => l.trim() !== '');
        // ヘッダー + 3データ行（id=1,2,4）= 4行
        expect(lines.length).toBe(4);
        expect(shopProductCsv).toContain('1,1,鋭い剣');
        expect(shopProductCsv).toContain('2,1,頑丈な盾');
        expect(shopProductCsv).not.toContain('尖ったかま');
        expect(shopProductCsv).not.toContain('3,1,');
        expect(shopProductCsv).toContain('4,2,回復薬');

        // shopテーブルは変更なし
        const shopCsv = await readMockFileAsync(page, 'data/shop.csv');
        expect(shopCsv).toContain('1,武器屋');
        expect(shopCsv).toContain('2,道具屋');
    });

    test('複数のパディング行のJOIN列を空にして保存すると両方ともCSVから削除されること', async ({ page }) => {
        await installMockApiAsync(page, createViewShopFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_shop');

        // 初期状態の確認
        await expect(getDataCell(table, 1, 2)).toHaveText('2');
        await expect(getDataCell(table, 1, 3)).toHaveText('頑丈な盾');
        await expect(getDataCell(table, 2, 2)).toHaveText('3');
        await expect(getDataCell(table, 2, 3)).toHaveText('尖ったかま');

        // パディング行（row 1、頑丈な盾）のJOIN列を空にする
        await clearCellWithDeleteAsync(page, table, 1, 2);
        await expect(getDataCell(table, 1, 2)).toHaveText('');
        await clearCellWithDeleteAsync(page, table, 1, 3);
        await expect(getDataCell(table, 1, 3)).toHaveText('');

        // パディング行（row 2、尖ったかま）のJOIN列を空にする
        await clearCellWithDeleteAsync(page, table, 2, 2);
        await expect(getDataCell(table, 2, 2)).toHaveText('');
        await clearCellWithDeleteAsync(page, table, 2, 3);
        await expect(getDataCell(table, 2, 3)).toHaveText('');

        // 保存（Ctrl+S）
        await clickFirstCellAsync(table);
        await page.keyboard.press('Control+s');
        await page.waitForTimeout(500);

        // shop_product.csvの内容を検証: id=2とid=3の行が完全に削除されていること
        const shopProductCsv = await readMockFileAsync(page, 'data/shop_product.csv');
        const lines = shopProductCsv.split('\n').filter((l: string) => l.trim() !== '');
        // ヘッダー + 2データ行（id=1,4）= 3行
        expect(lines.length).toBe(3);
        expect(shopProductCsv).toContain('1,1,鋭い剣');
        expect(shopProductCsv).not.toContain('頑丈な盾');
        expect(shopProductCsv).not.toContain('尖ったかま');
        expect(shopProductCsv).toContain('4,2,回復薬');

        // shopテーブルは変更なし
        const shopCsv = await readMockFileAsync(page, 'data/shop.csv');
        expect(shopCsv).toContain('1,武器屋');
        expect(shopCsv).toContain('2,道具屋');
    });

    test('JOINされた列を空にした後のUndoで元に戻ること', async ({ page }) => {
        await installMockApiAsync(page, createViewShopFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_shop');

        // 初期状態の確認
        await expect(getDataCell(table, 2, 2)).toHaveText('3');
        await expect(getDataCell(table, 2, 3)).toHaveText('尖ったかま');

        // パディング行（row 2、尖ったかま）のJOIN列を空にする
        await clearCellWithDeleteAsync(page, table, 2, 2);
        await expect(getDataCell(table, 2, 2)).toHaveText('');
        await clearCellWithDeleteAsync(page, table, 2, 3);
        await expect(getDataCell(table, 2, 3)).toHaveText('');

        // Undo（product_nameのクリアを戻す）
        await clickFirstCellAsync(table);
        await page.keyboard.press('Control+z');
        await expect(getDataCell(table, 2, 3)).toHaveText('尖ったかま');

        // Undo（idのクリアを戻す）
        await page.keyboard.press('Control+z');
        await expect(getDataCell(table, 2, 2)).toHaveText('3');

        // 両方のセルが完全に元に戻っていること
        await expect(getDataCell(table, 2, 2)).toHaveText('3');
        await expect(getDataCell(table, 2, 3)).toHaveText('尖ったかま');

        // この状態で保存するとCSVは元のまま（4行全て残る）
        await clickFirstCellAsync(table);
        await page.keyboard.press('Control+s');
        await page.waitForTimeout(500);

        const shopProductCsv = await readMockFileAsync(page, 'data/shop_product.csv');
        const lines = shopProductCsv.split('\n').filter((l: string) => l.trim() !== '');
        // ヘッダー + 4データ行 = 5行
        expect(lines.length).toBe(5);
        expect(shopProductCsv).toContain('1,1,鋭い剣');
        expect(shopProductCsv).toContain('2,1,頑丈な盾');
        expect(shopProductCsv).toContain('3,1,尖ったかま');
        expect(shopProductCsv).toContain('4,2,回復薬');
    });

    test('JOINされた列を部分的に空にした場合は行は削除されないこと', async ({ page }) => {
        await installMockApiAsync(page, createViewShopFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_shop');

        // 初期状態の確認
        await expect(getDataCell(table, 2, 2)).toHaveText('3');
        await expect(getDataCell(table, 2, 3)).toHaveText('尖ったかま');

        // パディング行（row 2、尖ったかま）のJOIN列の一部だけ空にする
        // カラム3（product_name）のみ空にし、カラム2（id）は残す
        await clearCellWithDeleteAsync(page, table, 2, 3);
        await expect(getDataCell(table, 2, 3)).toHaveText('');
        // カラム2（id）は値が残っている
        await expect(getDataCell(table, 2, 2)).toHaveText('3');

        // 保存（Ctrl+S）
        await clickFirstCellAsync(table);
        await page.keyboard.press('Control+s');
        await page.waitForTimeout(500);

        // shop_product.csvの内容を検証: id=3の行は削除されず、product_nameが空で残ること
        const shopProductCsv = await readMockFileAsync(page, 'data/shop_product.csv');
        const lines = shopProductCsv.split('\n').filter((l: string) => l.trim() !== '');
        // ヘッダー + 4データ行 = 5行（行は削除されていない）
        expect(lines.length).toBe(5);
        expect(shopProductCsv).toContain('1,1,鋭い剣');
        expect(shopProductCsv).toContain('2,1,頑丈な盾');
        // id=3の行は残っているが、product_nameが空
        expect(shopProductCsv).toContain('3,1,');
        expect(shopProductCsv).not.toContain('尖ったかま');
        expect(shopProductCsv).toContain('4,2,回復薬');
    });
});
