import { test, expect } from '@playwright/test';
import { Page, Locator } from '@playwright/test';
import {
    installMockApiAsync,
    readMockFileAsync,
    MockFileSystem,
} from './fixtures/mock-api';

/**
 * Explorerでテーブルを開き、アクティブなタブのEditorTableを返す
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
 * 行ヘッダーを右クリックしてコンテキストメニューを開く
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
 * shop: id=1,name=WeaponShop / id=2,name=ArmorShop
 * shop_product: id=1,shop_id=1,product=Sword / id=2,shop_id=1,product=Shield / id=3,shop_id=2,product=Helmet
 *
 * view_shop: shopベース、shop_productをshop.id → shop_product.shop_idでJOIN
 *
 * 期待されるビュー表示（shop_idは非表示）:
 * | shop.id | shop.name  | shop_product.id | shop_product.product |
 * |    1    | WeaponShop |       1         |       Sword          |  ← リーダー行
 * |  [pad]  |   [pad]    |       2         |       Shield         |  ← パディング行
 * |    2    | ArmorShop  |       3         |       Helmet         |  ← リーダー行
 */
function createFileSystem(): MockFileSystem {
    return {
        "schema/shop.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
            ],
            primary_key: "id",
        }),
        "data/shop.csv": ["id,name", "1,WeaponShop", "2,ArmorShop"].join("\n"),
        "schema/shop_product.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "shop_id", type: "int" },
                { key: 2, name: "product", type: "string" },
            ],
            primary_key: "id",
        }),
        "data/shop_product.csv": ["id,shop_id,product", "1,1,Sword", "2,1,Shield", "3,2,Helmet"].join("\n"),
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
test.describe(
    'ビュータブでの行削除',
    () => {
        test(
            'パディング行を削除して保存するとCSVデータが正しく更新されること',
            async ({ page }) => {
                await installMockApiAsync(page, createFileSystem());
                await page.goto('/');

                const table = await openTableAsync(page, 'view_shop');

                // 初期状態確認
                // row0: shop.id=1, shop.name=WeaponShop, sp.id=1, sp.product=Sword
                // row1: [pad], [pad], sp.id=2, sp.product=Shield
                // row2: shop.id=2, shop.name=ArmorShop, sp.id=3, sp.product=Helmet
                await expect(getDataCell(table, 0, 0)).toHaveText('1');
                await expect(getDataCell(table, 0, 3)).toHaveText('Sword');
                await expect(getDataCell(table, 1, 3)).toHaveText('Shield');
                await expect(getDataCell(table, 2, 0)).toHaveText('2');
                await expect(getDataCell(table, 2, 3)).toHaveText('Helmet');

                // パディング行（row1: sp.id=2, Shield）を削除
                await rightClickRowHeaderAsync(table, 1);
                await clickContextMenuItemAsync(page, '行を削除');

                // 削除後: 2行になるはず
                // row0: shop.id=1, WeaponShop, sp.id=1, Sword
                // row1: shop.id=2, ArmorShop, sp.id=3, Helmet
                await expect(getDataCell(table, 0, 0)).toHaveText('1');
                await expect(getDataCell(table, 0, 3)).toHaveText('Sword');
                await expect(getDataCell(table, 1, 0)).toHaveText('2');
                await expect(getDataCell(table, 1, 3)).toHaveText('Helmet');

                // 保存
                await clickFirstCellAsync(table);
                await page.keyboard.press('Control+s');
                await page.waitForTimeout(500);

                // shop_product.csvを検証: id=2の行が削除されていること
                const spCsv = await readMockFileAsync(page, 'data/shop_product.csv');
                expect(spCsv).toContain('1,1,Sword');
                expect(spCsv).not.toContain('2,1,Shield');
                expect(spCsv).toContain('3,2,Helmet');

                // shop.csvは変更されていないこと
                const shopCsv = await readMockFileAsync(page, 'data/shop.csv');
                expect(shopCsv).toContain('1,WeaponShop');
                expect(shopCsv).toContain('2,ArmorShop');
            },
        );

        test(
            'パディング行削除後にセル編集が正しいメタデータを参照すること',
            async ({ page }) => {
                await installMockApiAsync(page, createFileSystem());
                await page.goto('/');

                const table = await openTableAsync(page, 'view_shop');

                // パディング行（row1: sp.id=2, Shield）を削除
                await rightClickRowHeaderAsync(table, 1);
                await clickContextMenuItemAsync(page, '行を削除');

                // 削除後のrow1（元row2: shop.id=2, ArmorShop, sp.id=3, Helmet）の
                // shop_product.product列を編集
                const cell = getDataCell(table, 1, 3);
                await cell.dblclick();
                const editField = page.locator('.grid-textfield-active');
                await expect(editField).toBeVisible();
                await page.keyboard.press('Control+a');
                await page.keyboard.insertText('Boots');
                await page.keyboard.press('Enter');

                // 編集値が反映されること
                await expect(getDataCell(table, 1, 3)).toHaveText('Boots');

                // row0の値は変わっていないこと
                await expect(getDataCell(table, 0, 3)).toHaveText('Sword');
            },
        );

        test(
            'パディング行の削除をUndoで元に戻せること',
            async ({ page }) => {
                await installMockApiAsync(page, createFileSystem());
                await page.goto('/');

                const table = await openTableAsync(page, 'view_shop');

                // 初期状態確認
                await expect(getDataCell(table, 1, 3)).toHaveText('Shield');

                // パディング行（row1）を削除
                await rightClickRowHeaderAsync(table, 1);
                await clickContextMenuItemAsync(page, '行を削除');

                // 削除後は2行
                await expect(getDataCell(table, 0, 3)).toHaveText('Sword');
                await expect(getDataCell(table, 1, 3)).toHaveText('Helmet');

                // Undo
                await clickFirstCellAsync(table);
                await page.keyboard.press('Control+z');

                // 3行に復元される
                await expect(getDataCell(table, 0, 3)).toHaveText('Sword');
                await expect(getDataCell(table, 1, 3)).toHaveText('Shield');
                await expect(getDataCell(table, 2, 3)).toHaveText('Helmet');
            },
        );

        test(
            'パディング行の削除のUndoをRedoで再実行できること',
            async ({ page }) => {
                await installMockApiAsync(page, createFileSystem());
                await page.goto('/');

                const table = await openTableAsync(page, 'view_shop');

                // パディング行（row1）を削除
                await rightClickRowHeaderAsync(table, 1);
                await clickContextMenuItemAsync(page, '行を削除');

                // Undo
                await clickFirstCellAsync(table);
                await page.keyboard.press('Control+z');

                // 3行に復元
                await expect(getDataCell(table, 1, 3)).toHaveText('Shield');

                // Redo
                await page.keyboard.press('Control+y');

                // 再び2行になる
                await expect(getDataCell(table, 0, 3)).toHaveText('Sword');
                await expect(getDataCell(table, 1, 3)).toHaveText('Helmet');
            },
        );

        test(
            'リーダー行（ベーステーブル行）のみの行も削除できること',
            async ({ page }) => {
                await installMockApiAsync(page, createFileSystem());
                await page.goto('/');

                const table = await openTableAsync(page, 'view_shop');

                // リーダー行（row2: shop.id=2, ArmorShop, sp.id=3, Helmet）を削除
                await rightClickRowHeaderAsync(table, 2);
                await clickContextMenuItemAsync(page, '行を削除');

                // 2行になるはず（shop.id=1のグループ）
                await expect(getDataCell(table, 0, 0)).toHaveText('1');
                await expect(getDataCell(table, 0, 3)).toHaveText('Sword');
                await expect(getDataCell(table, 1, 3)).toHaveText('Shield');

                // 保存
                await clickFirstCellAsync(table);
                await page.keyboard.press('Control+s');
                await page.waitForTimeout(500);

                // shop_product.csvを検証: id=3の行が削除されていること
                const spCsv = await readMockFileAsync(page, 'data/shop_product.csv');
                expect(spCsv).toContain('1,1,Sword');
                expect(spCsv).toContain('2,1,Shield');
                expect(spCsv).not.toContain('3,2,Helmet');

                // shop.csvを検証: id=2が削除されていること
                const shopCsv = await readMockFileAsync(page, 'data/shop.csv');
                expect(shopCsv).toContain('1,WeaponShop');
                expect(shopCsv).not.toContain('2,ArmorShop');
            },
        );
    },
);
