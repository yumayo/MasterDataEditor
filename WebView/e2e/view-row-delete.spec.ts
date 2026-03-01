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
 * セルの値を編集する
 * ダブルクリックで編集モードに入り、全選択→新しい値を入力→Enterで確定
 */
async function editCellAsync(page: Page, table: Locator, rowIndex: number, colIndex: number, newValue: string): Promise<void> {
    const cell = getDataCell(table, rowIndex, colIndex);
    await cell.dblclick();
    const editField = page.locator('.grid-textfield-active');
    await expect(editField).toBeVisible();
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText(newValue);
    await page.keyboard.press('Enter');
}

/**
 * 行ヘッダーを右クリックしてコンテキストメニューを開く
 * rowIndex: 0始まり（データ行のみ、ヘッダー行を除く）
 */
async function rightClickRowHeaderAsync(table: Locator, rowIndex: number): Promise<void> {
    const header = table.locator('.editor-table-row-header').nth(rowIndex);
    await header.click({ button: 'right' });
}

/**
 * コンテキストメニューの項目をクリックする
 */
async function clickContextMenuItemAsync(page: Page, label: string): Promise<void> {
    const menu = page.locator('.context-menu.visible');
    await expect(menu).toBeVisible();
    await menu.locator('.context-menu-item', { hasText: label }).click();
}

/**
 * テーブルの最初のデータセルをクリックしてキーボードイベントのフォーカスを確保する
 */
async function clickFirstCellAsync(table: Locator): Promise<void> {
    const selector = '.editor-table-row:nth-child(2) .editor-table-cell:nth-child(2)';
    await table.locator(selector).click();
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
// ビュータブでの行削除テスト
// -------------------------------------------------------
test.describe('ビュータブでの行削除', () => {

    test('パディング行を削除して保存するとCSVから削除されること', async ({ page }) => {
        await installMockApiAsync(page, createViewShopFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_shop');

        // 初期状態の確認: 4ビュー行（リーダー+パディング2+リーダー）
        // ビュー列: shop.id(0), shop.name(1), shop_product.id(2), shop_product.product_name(3)
        await expect(getDataCell(table, 0, 0)).toHaveText(/1/);
        await expect(getDataCell(table, 0, 1)).toHaveText('武器屋');
        await expect(getDataCell(table, 0, 3)).toHaveText('鋭い剣');
        await expect(getDataCell(table, 1, 3)).toHaveText('頑丈な盾');
        await expect(getDataCell(table, 2, 3)).toHaveText('尖ったかま');
        await expect(getDataCell(table, 3, 0)).toHaveText('2');
        await expect(getDataCell(table, 3, 3)).toHaveText('回復薬');

        // shop_product.id=3（尖ったかま、row 2パディング行）を右クリックで行削除
        await rightClickRowHeaderAsync(table, 2);
        await clickContextMenuItemAsync(page, '行を削除');

        // 削除後: 3ビュー行になる
        // row 0: 1, 武器屋, 1, 鋭い剣
        // row 1: [pad], [pad], 2, 頑丈な盾
        // row 2: 2, 道具屋, 4, 回復薬
        await expect(getDataCell(table, 0, 3)).toHaveText('鋭い剣');
        await expect(getDataCell(table, 1, 3)).toHaveText('頑丈な盾');
        await expect(getDataCell(table, 2, 3)).toHaveText('回復薬');

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
        expect(shopProductCsv).toContain('4,2,回復薬');

        // shopテーブルは変更されていないこと
        const shopCsv = await readMockFileAsync(page, 'data/shop.csv');
        expect(shopCsv).toContain('1,武器屋');
        expect(shopCsv).toContain('2,道具屋');
    });

    test('パディング行削除後にセル編集しても正しい行が更新されること', async ({ page }) => {
        await installMockApiAsync(page, createViewShopFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_shop');

        // 初期状態確認
        await expect(getDataCell(table, 2, 3)).toHaveText('尖ったかま');

        // shop_product.id=3（尖ったかま、row 2）を削除
        await rightClickRowHeaderAsync(table, 2);
        await clickContextMenuItemAsync(page, '行を削除');

        // 削除後のrow 2は道具屋のリーダー行になっている
        await expect(getDataCell(table, 2, 0)).toHaveText('2');
        await expect(getDataCell(table, 2, 3)).toHaveText('回復薬');

        // 削除後のrow 1（頑丈な盾のパディング行）のproduct_nameを編集
        await editCellAsync(page, table, 1, 3, '壊れた盾');

        // 編集が正しい行（shop_product.id=2）に反映されていること
        await expect(getDataCell(table, 1, 3)).toHaveText('壊れた盾');

        // 他の行が壊れていないこと
        await expect(getDataCell(table, 0, 3)).toHaveText('鋭い剣');
        await expect(getDataCell(table, 2, 3)).toHaveText('回復薬');

        // 保存して検証
        await clickFirstCellAsync(table);
        await page.keyboard.press('Control+s');
        await page.waitForTimeout(500);

        const shopProductCsv = await readMockFileAsync(page, 'data/shop_product.csv');
        // shop_product.id=2のproduct_nameが「壊れた盾」に更新されていること
        expect(shopProductCsv).toContain('壊れた盾');
        // shop_product.id=1は変更されていないこと
        expect(shopProductCsv).toContain('1,1,鋭い剣');
        // shop_product.id=3は削除されていること
        expect(shopProductCsv).not.toContain('尖ったかま');
    });

    test('パディング行削除のUndoで元の行数に復元されること', async ({ page }) => {
        await installMockApiAsync(page, createViewShopFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_shop');

        // 初期状態: 4ビュー行
        await expect(getDataCell(table, 2, 3)).toHaveText('尖ったかま');

        // shop_product.id=3（尖ったかま、row 2）を削除
        await rightClickRowHeaderAsync(table, 2);
        await clickContextMenuItemAsync(page, '行を削除');

        // 削除後: 3ビュー行
        await expect(getDataCell(table, 2, 3)).toHaveText('回復薬');

        // フォーカスを確保してUndo
        await clickFirstCellAsync(table);
        await page.keyboard.press('Control+z');

        // Undo後: 元の4ビュー行に復元
        await expect(getDataCell(table, 0, 3)).toHaveText('鋭い剣');
        await expect(getDataCell(table, 1, 3)).toHaveText('頑丈な盾');
        await expect(getDataCell(table, 2, 3)).toHaveText('尖ったかま');
        await expect(getDataCell(table, 3, 3)).toHaveText('回復薬');

        // shop_product.id=3の全セル値が復元されていること
        await expect(getDataCell(table, 2, 2)).toHaveText('3');
    });

    test('パディング行削除のUndo後にRedoで再削除されること', async ({ page }) => {
        await installMockApiAsync(page, createViewShopFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_shop');

        // shop_product.id=3（尖ったかま、row 2）を削除
        await rightClickRowHeaderAsync(table, 2);
        await clickContextMenuItemAsync(page, '行を削除');

        // 削除後: 3ビュー行
        await expect(getDataCell(table, 2, 3)).toHaveText('回復薬');

        // Undo: 4ビュー行に復元
        await clickFirstCellAsync(table);
        await page.keyboard.press('Control+z');
        await expect(getDataCell(table, 2, 3)).toHaveText('尖ったかま');
        await expect(getDataCell(table, 3, 3)).toHaveText('回復薬');

        // Redo: 再び3ビュー行に
        await page.keyboard.press('Control+y');
        await expect(getDataCell(table, 0, 3)).toHaveText('鋭い剣');
        await expect(getDataCell(table, 1, 3)).toHaveText('頑丈な盾');
        await expect(getDataCell(table, 2, 3)).toHaveText('回復薬');
        // 尖ったかまの行が再び消えていること（row 2は回復薬であり、尖ったかまではない）
        await expect(getDataCell(table, 2, 0)).toHaveText('2');
    });

    test('リーダー行を削除するとベーステーブルと結合テーブルの両方からCSV行が削除されること', async ({ page }) => {
        await installMockApiAsync(page, createViewShopFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_shop');

        // 初期状態確認
        await expect(getDataCell(table, 3, 0)).toHaveText('2');
        await expect(getDataCell(table, 3, 1)).toHaveText('道具屋');
        await expect(getDataCell(table, 3, 3)).toHaveText('回復薬');

        // shop.id=2（道具屋、row 3リーダー行）を削除
        await rightClickRowHeaderAsync(table, 3);
        await clickContextMenuItemAsync(page, '行を削除');

        // 削除後: 3ビュー行（武器屋の1:3展開のみ）
        // row 0: 1, 武器屋, 1, 鋭い剣
        // row 1: [pad], [pad], 2, 頑丈な盾
        // row 2: [pad], [pad], 3, 尖ったかま
        await expect(getDataCell(table, 0, 0)).toHaveText(/1/);
        await expect(getDataCell(table, 0, 1)).toHaveText('武器屋');
        await expect(getDataCell(table, 0, 3)).toHaveText('鋭い剣');
        await expect(getDataCell(table, 1, 3)).toHaveText('頑丈な盾');
        await expect(getDataCell(table, 2, 3)).toHaveText('尖ったかま');
        // row 3は空行（データなし）
        await expect(getDataCell(table, 3, 0)).toHaveText('');

        // 保存して両方のCSVを検証
        await clickFirstCellAsync(table);
        await page.keyboard.press('Control+s');
        await page.waitForTimeout(500);

        // shop.csvからid=2（道具屋）が削除されていること
        const shopCsv = await readMockFileAsync(page, 'data/shop.csv');
        const shopLines = shopCsv.split('\n').filter((l: string) => l.trim() !== '');
        expect(shopLines.length).toBe(2); // ヘッダー + 1データ行
        expect(shopCsv).toContain('1,武器屋');
        expect(shopCsv).not.toContain('道具屋');

        // shop_product.csvからshop_id=2の行（id=4,回復薬）が削除されていること
        const shopProductCsv = await readMockFileAsync(page, 'data/shop_product.csv');
        const productLines = shopProductCsv.split('\n').filter((l: string) => l.trim() !== '');
        expect(productLines.length).toBe(4); // ヘッダー + 3データ行（id=1,2,3のみ）
        expect(shopProductCsv).toContain('1,1,鋭い剣');
        expect(shopProductCsv).toContain('2,1,頑丈な盾');
        expect(shopProductCsv).toContain('3,1,尖ったかま');
        expect(shopProductCsv).not.toContain('回復薬');
    });
});
