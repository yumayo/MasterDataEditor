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

/**
 * 逆参照テーブルの列名にreferenceDisplayColumnPriority（"ja"）を含むフィクスチャ
 *
 * weapon: id=1,name=Sword / id=2,name=Shield
 * weapon_name: id=1,weapon_id=1,lang=en,ja=剣 / id=2,weapon_id=1,lang=fr,ja=Sword / id=3,weapon_id=2,lang=en,ja=盾
 *
 * weapon_nameのweapon_idがweapon.idを参照（逆参照）
 * 逆参照JOIN後のビュー表示:
 * | weapon.id | weapon_name.id | weapon_name.lang | weapon_name.ja | weapon.name |
 * |     1     |       1        |       en         |      剣        |    Sword    |  リーダー行（1:2）
 * |   [pad]   |       2        |       fr         |     Sword      |   [pad]     |  パディング
 * |     2     |       3        |       en         |      盾        |   Shield    |  1:1
 *
 * ja列はreferenceDisplayColumnPriorityに含まれるため、
 * 編集時にReferenceDataCache.updateDisplayTextが呼ばれ、
 * 逆参照テーブルがキャッシュ未登録であるバグが再現する
 */
function createReverseJoinWithDisplayColumnFileSystem(): MockFileSystem {
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
                { key: 3, name: "ja", type: "string" },
            ],
            primary_key: "id",
        }),
        "data/weapon_name.csv": ["id,weapon_id,lang,ja", "1,1,en,剣", "2,1,fr,Sword", "3,2,en,盾"].join("\n"),
        "view/view_weapon.json": JSON.stringify({
            name: "view_weapon",
            baseTable: "weapon",
            joins: [],
        }),
    };
}

/**
 * 逆参照JOINを実行し、JOIN完了まで待機する
 * 列ヘッダーを右クリック → 逆参照JOINメニューをクリック → セル値で完了を確認
 */
async function executeReverseJoinAsync(page: Page, table: Locator): Promise<void> {
    const header = getColumnHeader(table, 0);
    await header.click({ button: 'right' });
    const menu = page.locator('.context-menu');
    await menu.getByText('Join: weapon_name (reverse: weapon_id)').click();
    // rebuildViewTabによるDOM再構築完了を待機（weapon_name.ja列の値で確認）
    await expect(getDataCell(table, 0, 3)).toHaveText('剣');
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

// -------------------------------------------------------
// 逆参照JOINされた表示列の編集テスト
// -------------------------------------------------------
test.describe('逆参照JOINされた表示列の編集', () => {

    test('逆参照JOINされた列（表示列）を編集してもエラーが発生しないこと', async ({ page }) => {
        await installMockApiAsync(page, createReverseJoinWithDisplayColumnFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_weapon');

        // 逆参照JOINを実行し完了を待機
        await executeReverseJoinAsync(page, table);

        // pageerrorイベントでブラウザ側のJavaScriptエラーをキャッチする
        const errors: Error[] = [];
        page.on('pageerror', (error) => {
            errors.push(error);
        });

        // JOIN後のビュー列: weapon.id(0), weapon_name.id(1), weapon_name.lang(2), weapon_name.ja(3), weapon.name(4)
        // weapon_name.ja列（colIndex=3）はreferenceDisplayColumnPriorityに含まれる表示列
        // この列を編集するとReferenceDataCache.updateDisplayTextが呼ばれ、
        // 逆参照テーブル（weapon_name）がキャッシュ未登録のためエラーがスローされるバグの再現
        await editCellAsync(page, table, 0, 3, '刀');

        // 編集操作後にエラーが非同期で到達するのを待つ
        await page.waitForTimeout(300);

        // JavaScriptエラーが発生していないこと（バグ修正前は「キャッシュにテーブルが存在しません」がスローされる）
        expect(errors.length).toBe(0);

        // 編集後のセルに新しい値が表示されていること
        await expect(getDataCell(table, 0, 3)).toHaveText('刀');
    });
});
