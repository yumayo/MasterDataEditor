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
 * データ行の数を返す（列ヘッダー行を除く）
 */
async function getDataRowCountAsync(table: Locator): Promise<number> {
    const allRows = table.locator('.editor-table-row');
    const total = await allRows.count();
    // 先頭行は列ヘッダーなので除外
    return total - 1;
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
// ビュータブでの行挿入テスト
// -------------------------------------------------------
test.describe('ビュータブでの行挿入', () => {

    test('行挿入→PK設定→セル編集→保存で新規行がCSVに含まれること', async ({ page }) => {
        await installMockApiAsync(page, createViewShopFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_shop');

        // 初期状態の確認
        // ビュー列: shop.id(0), shop.name(1), shop_product.id(2), shop_product.product_name(3)
        await expect(getDataCell(table, 0, 0)).toHaveText(/1/);
        await expect(getDataCell(table, 0, 1)).toHaveText('武器屋');
        await expect(getDataCell(table, 3, 0)).toHaveText('2');
        await expect(getDataCell(table, 3, 1)).toHaveText('道具屋');

        // 初期行数を取得（JOINにより展開されるため絶対値はハードコードしない）
        const initialRowCount = await getDataRowCountAsync(table);

        // 行2（尖ったかま、パディング行）の下に行を挿入
        await rightClickRowHeaderAsync(table, 2);
        await clickContextMenuItemAsync(page, '下に行を挿入');

        // 挿入後: 初期行数 + 1 になる
        const afterInsertRowCount = await getDataRowCountAsync(table);
        expect(afterInsertRowCount).toBe(initialRowCount + 1);

        // 挿入された行のPK列（shop.id、column 0）に新しいPK値を入力
        // 挿入行はrow 3の位置（元のrow 3=道具屋リーダーはrow 4に移動）
        await editCellAsync(page, table, 3, 0, '999');

        // Name列（shop.name、column 1）に値を入力
        await editCellAsync(page, table, 3, 1, 'テスト店');

        // 保存（Ctrl+S）
        await clickFirstCellAsync(table);
        await page.keyboard.press('Control+s');
        await page.waitForTimeout(500);

        // shop.csvの内容を検証: PK "999" の行が含まれること
        const shopCsv = await readMockFileAsync(page, 'data/shop.csv');
        const shopLines = shopCsv.split('\n').filter((l: string) => l.trim() !== '');
        // ヘッダー + 3データ行（id=1,2,999）= 4行
        expect(shopLines.length).toBe(4);
        expect(shopCsv).toContain('1,武器屋');
        expect(shopCsv).toContain('2,道具屋');
        expect(shopCsv).toContain('999,テスト店');
    });

    test('行挿入→セル編集→PK設定→保存でPK設定前の編集もStore行に含まれること', async ({ page }) => {
        await installMockApiAsync(page, createViewShopFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_shop');

        // 初期状態確認
        await expect(getDataCell(table, 3, 0)).toHaveText('2');
        await expect(getDataCell(table, 3, 1)).toHaveText('道具屋');

        // 初期行数を取得（JOINにより展開されるため絶対値はハードコードしない）
        const initialRowCount = await getDataRowCountAsync(table);

        // 道具屋リーダー行（row 3）の下に行を挿入
        await rightClickRowHeaderAsync(table, 3);
        await clickContextMenuItemAsync(page, '下に行を挿入');

        // 挿入後: 初期行数 + 1 になる
        const afterInsertRowCount = await getDataRowCountAsync(table);
        expect(afterInsertRowCount).toBe(initialRowCount + 1);

        // 先にName列（column 1）に値を入力（PKより先に編集）
        await editCellAsync(page, table, 4, 1, '秘密の店');

        // その後PK列（column 0）に値を入力
        await editCellAsync(page, table, 4, 0, '888');

        // 保存（Ctrl+S）
        await clickFirstCellAsync(table);
        await page.keyboard.press('Control+s');
        await page.waitForTimeout(500);

        // shop.csvの内容を検証: PK "888" の行が含まれ、Name列の値も含まれること
        const shopCsv = await readMockFileAsync(page, 'data/shop.csv');
        const shopLines = shopCsv.split('\n').filter((l: string) => l.trim() !== '');
        expect(shopLines.length).toBe(4); // ヘッダー + 3データ行
        expect(shopCsv).toContain('1,武器屋');
        expect(shopCsv).toContain('2,道具屋');
        // PK設定前に入力したName列の値が正しくCSVに含まれること
        expect(shopCsv).toContain('888,秘密の店');
    });

    test('行挿入のUndo/Redoが正しく動くこと', async ({ page }) => {
        await installMockApiAsync(page, createViewShopFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_shop');

        // 初期行数を取得（JOINにより展開されるため絶対値はハードコードしない）
        const initialRowCount = await getDataRowCountAsync(table);

        // 行2（尖ったかま）の下に行を挿入
        await rightClickRowHeaderAsync(table, 2);
        await clickContextMenuItemAsync(page, '下に行を挿入');

        // 挿入後: 初期行数 + 1 になる
        const afterInsertRowCount = await getDataRowCountAsync(table);
        expect(afterInsertRowCount).toBe(initialRowCount + 1);

        // フォーカスを確保してUndo
        await clickFirstCellAsync(table);
        await page.keyboard.press('Control+z');

        // Undo後: 元の初期行数に復元
        const afterUndoRowCount = await getDataRowCountAsync(table);
        expect(afterUndoRowCount).toBe(initialRowCount);

        // 元のデータが復元されていること
        await expect(getDataCell(table, 0, 0)).toHaveText(/1/);
        await expect(getDataCell(table, 0, 1)).toHaveText('武器屋');
        await expect(getDataCell(table, 2, 3)).toHaveText('尖ったかま');
        await expect(getDataCell(table, 3, 0)).toHaveText('2');
        await expect(getDataCell(table, 3, 1)).toHaveText('道具屋');

        // Redo
        await page.keyboard.press('Control+y');

        // Redo後: 再び初期行数 + 1 になる
        const afterRedoRowCount = await getDataRowCountAsync(table);
        expect(afterRedoRowCount).toBe(initialRowCount + 1);
    });

    test('PK設定後のUndoでStore行が除去されること', async ({ page }) => {
        await installMockApiAsync(page, createViewShopFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_shop');

        // 初期状態確認
        await expect(getDataCell(table, 3, 0)).toHaveText('2');

        // 道具屋リーダー行（row 3）の下に行を挿入
        await rightClickRowHeaderAsync(table, 3);
        await clickContextMenuItemAsync(page, '下に行を挿入');

        // 挿入された行のPK列に値を入力
        await editCellAsync(page, table, 4, 0, '999');

        // PK列に "999" が入力されたことを確認
        await expect(getDataCell(table, 4, 0)).toHaveText('999');

        // --- まず保存してPK "999" の行がCSVに含まれることを検証 ---
        // （現状のプロダクションコードでは行挿入時にStoreに行が追加されないためREDになる）
        await clickFirstCellAsync(table);
        await page.keyboard.press('Control+s');
        await page.waitForTimeout(500);

        const shopCsvBeforeUndo = await readMockFileAsync(page, 'data/shop.csv');
        // PK設定済みの挿入行がStoreに反映されてCSVに含まれるはず
        expect(shopCsvBeforeUndo).toContain('999');

        // --- Undo（PK編集をUndo → PKが空に戻る） ---
        await clickFirstCellAsync(table);
        await page.keyboard.press('Control+z');

        // PK列が空に戻ったことを確認
        await expect(getDataCell(table, 4, 0)).toHaveText('');

        // 再度保存してPK "999" がCSVから消えていることを検証
        await page.keyboard.press('Control+s');
        await page.waitForTimeout(500);

        const shopCsvAfterUndo = await readMockFileAsync(page, 'data/shop.csv');
        const shopLines = shopCsvAfterUndo.split('\n').filter((l: string) => l.trim() !== '');
        // ヘッダー + 2データ行（元のid=1,2のみ）= 3行
        expect(shopLines.length).toBe(3);
        expect(shopCsvAfterUndo).toContain('1,武器屋');
        expect(shopCsvAfterUndo).toContain('2,道具屋');
        expect(shopCsvAfterUndo).not.toContain('999');
    });
});
