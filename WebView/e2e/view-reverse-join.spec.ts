import { test, expect } from '@playwright/test';
import { Page, Locator } from '@playwright/test';
import {
    installMockApiAsync,
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
 * 指定した列ヘッダーセルを返す
 * colIndex: 0始まり（行ヘッダーを除く）
 */
function getColumnHeader(table: Locator, colIndex: number): Locator {
    const headerRow = table.locator('.editor-table-column-header-row');
    return headerRow.locator('.editor-table-column-header').nth(colIndex);
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
 * テストデータ:
 * weapon: id=1,name=Sword / id=2,name=Shield
 * weapon_name: id=1,weapon_id=1,lang=ja,text=剣 / id=2,weapon_id=1,lang=en,text=Sword / id=3,weapon_id=2,lang=ja,text=盾
 *
 * weapon_nameのweapon_idがweapon.idを参照（逆参照: 子テーブルが親テーブルを参照している）
 * weaponベースのビュー view_weapon にはJOIN定義なし（逆参照JOINをコンテキストメニューから実行するテスト）
 *
 * 逆参照JOIN後の期待されるビュー表示:
 * insertAfterViewColumnIndex=0 → weapon.id(列0)の直後に子テーブル列が挿入される
 * weapon_name.weapon_id はJOINキーのため非表示
 *
 * | weapon.id | weapon_name.id | weapon_name.lang | weapon_name.text | weapon.name |
 * |     1     |       1        |       ja         |       剣         |    Sword    |  ← リーダー行（1:2）
 * |   [pad]   |       2        |       en         |      Sword       |   [pad]     |  ← パディング
 * |     2     |       3        |       ja         |       盾         |   Shield    |  ← 1:1
 */
function createReverseJoinFileSystem(): MockFileSystem {
    return {
        "schema/weapon.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
            ],
            primary_key: "id",
        }),
        "data/weapon.csv": ["id,name", "1,Sword", "2,Shield"].join("\n"),
        "schema/weapon_name.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "weapon_id", type: "int", reference: "weapon.id" },
                { key: 2, name: "lang", type: "string" },
                { key: 3, name: "text", type: "string" },
            ],
            primary_key: "id",
        }),
        "data/weapon_name.csv": ["id,weapon_id,lang,text", "1,1,ja,剣", "2,1,en,Sword", "3,2,ja,盾"].join("\n"),
        "view/view_weapon.json": JSON.stringify({
            name: "view_weapon",
            baseTable: "weapon",
            joins: [],
        }),
    };
}

// -------------------------------------------------------
// 逆参照JOINのテスト
// -------------------------------------------------------
test.describe('逆参照JOIN（子テーブルからのJOIN）', () => {

    test('逆参照JOIN対象がコンテキストメニューに表示されること', async ({ page }) => {
        await installMockApiAsync(page, createReverseJoinFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_weapon');

        // 列ヘッダーを右クリックしてコンテキストメニューを表示
        const header = getColumnHeader(table, 0);
        await header.click({ button: 'right' });

        // コンテキストメニューが表示されること
        const menu = page.locator('.context-menu.visible');
        await expect(menu).toBeVisible();

        // 逆参照JOINメニュー項目が表示されること
        // weapon_nameテーブルがweapon_id列でweapon.idを参照しているため、逆参照JOINが可能
        await expect(menu.getByText('Join: weapon_name (reverse: weapon_id)')).toBeVisible();
    });

    test('逆参照JOINの実行で1:N展開が正しく行われること', async ({ page }) => {
        await installMockApiAsync(page, createReverseJoinFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_weapon');

        // 列ヘッダーを右クリック → 逆参照JOINメニュー項目をクリック
        const header = getColumnHeader(table, 0);
        await header.click({ button: 'right' });
        const menu = page.locator('.context-menu');
        await menu.getByText('Join: weapon_name (reverse: weapon_id)').click();

        // JOIN後のビュー列: weapon.id(0), weapon_name.id(1), weapon_name.lang(2), weapon_name.text(3), weapon.name(4)
        // ※weapon_name.weapon_idはJOINキーのため非表示
        // ※insertAfterViewColumnIndex=0 → weapon.id直後に子テーブル列が挿入される

        // 行0: weapon.id=1, weapon_name.id=1, ja, 剣, Sword（リーダー行）
        await expect(getDataCell(table, 0, 0)).toHaveText(/1/);
        await expect(getDataCell(table, 0, 1)).toHaveText('1');
        await expect(getDataCell(table, 0, 2)).toHaveText('ja');
        await expect(getDataCell(table, 0, 3)).toHaveText('剣');
        await expect(getDataCell(table, 0, 4)).toHaveText('Sword');

        // 行1: [pad], weapon_name.id=2, en, Sword, [pad]（パディング行）
        await expect(getDataCell(table, 1, 1)).toHaveText('2');
        await expect(getDataCell(table, 1, 2)).toHaveText('en');
        await expect(getDataCell(table, 1, 3)).toHaveText('Sword');

        // 行2: weapon.id=2, weapon_name.id=3, ja, 盾, Shield
        await expect(getDataCell(table, 2, 0)).toHaveText(/2/);
        await expect(getDataCell(table, 2, 1)).toHaveText('3');
        await expect(getDataCell(table, 2, 2)).toHaveText('ja');
        await expect(getDataCell(table, 2, 3)).toHaveText('盾');
        await expect(getDataCell(table, 2, 4)).toHaveText('Shield');

        // 行3以降はデータが存在しないこと（データ行は3行で終了）
        await expect(getDataCell(table, 3, 0)).toHaveText('');
    });

    test('JOIN済みテーブルはメニューから除外されること', async ({ page }) => {
        await installMockApiAsync(page, createReverseJoinFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_weapon');

        // 逆参照JOINを実行
        const header = getColumnHeader(table, 0);
        await header.click({ button: 'right' });
        const menu = page.locator('.context-menu');
        await menu.getByText('Join: weapon_name (reverse: weapon_id)').click();

        // JOIN完了を待機（1:N展開後の特定セル値で確認 — rebuildViewTabによるDOM再構築を確実に待つ）
        await expect(getDataCell(table, 0, 3)).toHaveText('剣');

        // 再度コンテキストメニューを表示
        const headerAfterJoin = getColumnHeader(table, 0);
        await headerAfterJoin.click({ button: 'right' });

        // コンテキストメニューが表示されること
        const menuAfterJoin = page.locator('.context-menu.visible');
        await expect(menuAfterJoin).toBeVisible();

        // weapon_nameの逆参照JOIN項目が表示されないこと
        await expect(menuAfterJoin.getByText('Join: weapon_name (reverse: weapon_id)')).toHaveCount(0);
    });
});
