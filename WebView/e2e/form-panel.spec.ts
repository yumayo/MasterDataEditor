import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';
import { enableRelationsPanelAsync } from './fixtures/test-utils';

// =============================================================================
// FEAT_0043: フォームビューテスト
//
// 機能概要:
//   PKセルを右クリック → コンテキストメニューの「フォームビューを表示」をクリック
//   → 右ペインにフォームビューが表示される。
//   フォームビューは選択行の全列を key:value 形式で縦表示し、右上ツールバーのトグルで閉じる。
//
// テーブル構成:
//   enemy: id(PK), ja(string) — 敵マスタ
//   quest: id(PK), name(string), enemy_id(FK→enemy.id) — クエスト
//   item:  id(PK), name(string), quest_id(FK→quest.id) — アイテム（逆参照テスト用）
//
//   quest.id は item.quest_id から逆参照されるため、questのPKセル右クリックで
//   contextmenu イベントが発火し「フォームビューを表示」メニューが表示される。
// =============================================================================

/**
 * フォームビューテスト用ファイルシステムを生成する
 *
 * enemy → quest → item の3段リレーション。
 * item.quest_id が quest.id を参照するため、
 * quest の PK セル（id 列）は逆参照エントリを持つ。
 */
function createFormPanelTestFileSystem(): MockFileSystem {
    return {
        "schema/enemy.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "ja", type: "string" },
            ],
            primary_key: ["id"],
        }),
        "data/enemy.csv": [
            "id,ja",
            "1,スライム",
            "2,ドラゴン",
        ].join("\n"),
        "schema/weapon.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
            ],
            primary_key: ["id"],
        }),
        "data/weapon.csv": [
            "id",
            "10",
            "20",
        ].join("\n"),
        "schema/weapon_name.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int", reference: "weapon.id" },
                { key: 1, name: "ja", type: "string" },
            ],
            primary_key: ["id"],
        }),
        "data/weapon_name.csv": [
            "id,ja",
            "10,剣",
            "20,盾",
        ].join("\n"),
        "schema/quest.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                { key: 2, name: "enemy_id", type: "int", reference: "enemy.id" },
                { key: 3, name: "weapon_id", type: "int", reference: "weapon.id" },
            ],
            primary_key: ["id"],
        }),
        "data/quest.csv": [
            "id,name,enemy_id,weapon_id",
            "1,first_quest,1,10",
            "2,second_quest,2,20",
        ].join("\n"),
        // item テーブルは quest.id を FK として参照する（quest の逆参照エントリを生成するため）
        "schema/item.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                { key: 2, name: "quest_id", type: "int", reference: "quest.id" },
            ],
            primary_key: ["id"],
        }),
        "data/item.csv": [
            "id,name,quest_id",
            "1,sword,1",
            "2,shield,1",
            "3,potion,2",
        ].join("\n"),
    };
}

function createSlowValidationFormPanelTestFileSystem(): MockFileSystem {
    return {
        ...createFormPanelTestFileSystem(),
        "plugins/slow-form-validation.js": [
            "const end = Date.now() + 700;",
            "while (Date.now() < end) {}",
        ].join("\n"),
    };
}

function createShopProductFormPanelTestFileSystem(): MockFileSystem {
    return {
        "schema/table.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "enum", type: "enum" },
                { key: 2, name: "comment", type: "string" },
                { key: 3, name: "master", type: "string" },
                { key: 4, name: "column", type: "string" },
            ],
            primary_key: ["id"],
        }),
        "data/table.csv": [
            "id,enum,comment,master,column",
            "1,chara,キャラ,chara,id",
            "2,item,アイテム,item,id",
        ].join("\n"),
        "schema/chara.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
            ],
            primary_key: ["id"],
        }),
        "data/chara.csv": [
            "id",
            "14",
        ].join("\n"),
        "schema/chara_name.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int", reference: "chara.id" },
                { key: 1, name: "ja", type: "string" },
            ],
            primary_key: ["id"],
        }),
        "data/chara_name.csv": [
            "id,ja",
            "14,ネイト",
        ].join("\n"),
        "schema/item.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
            ],
            primary_key: ["id"],
        }),
        "data/item.csv": [
            "id",
            "3",
        ].join("\n"),
        "schema/item_name.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int", reference: "item.id" },
                { key: 1, name: "ja", type: "string" },
            ],
            primary_key: ["id"],
        }),
        "data/item_name.csv": [
            "id,ja",
            "3,神聖な弓",
        ].join("\n"),
        "schema/shop_product.json": JSON.stringify({
            header: [
                { key: 0, name: "group_id", type: "int", comment: "グループID" },
                { key: 1, name: "table_id", type: "int", comment: "テーブルID", reference: "table.id" },
                {
                    key: 2,
                    name: "record_id",
                    type: "int",
                    comment: "レコードID",
                    reference: {
                        sourceTable: "table",
                        sourceMatchColumn: "id",
                        sourceMatchValue: "table_id",
                        destTable: "master",
                        destColumn: "column",
                    },
                },
                { key: 3, name: "price", type: "int", comment: "販売価格" },
                { key: 4, name: "sort_order", type: "int", comment: "表示順" },
            ],
            primary_key: ["group_id", "table_id", "record_id"],
        }),
        "data/shop_product.csv": [
            "group_id,table_id,record_id,price,sort_order",
            "9,1,14,1090,15",
            "9,2,3,8677,7",
        ].join("\n"),
        "schema/shop.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                { key: 2, name: "shop_product_group_id", type: "int", reference: "shop_product.group_id" },
            ],
            primary_key: ["id"],
        }),
        "data/shop.csv": [
            "id,name,shop_product_group_id",
            "1,WeaponShop,9",
        ].join("\n"),
    };
}

/**
 * エクスプローラーからテーブルを開き、左ペインの EditorTable Locator を返す
 * タブ名で絞り込むことで strict mode violation を回避する
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
    const table = page.locator(
        `.editor-left-pane .tab-wrapper[data-tab-name="${tableName}"] .editor-table`,
    );
    await expect(table).toBeVisible();
    return table;
}

/**
 * 指定行のPKセル（最初のデータセル＝id列）を右クリックしてコンテキストメニューを開く
 * rowIndex: 0始まり（ヘッダー行を除く）
 */
async function rightClickPkCellAsync(table: Locator, rowIndex: number): Promise<void> {
    // データ行は .editor-table-row の nth(rowIndex + 1)（0番目はヘッダー行）
    const row = table.locator('.editor-table-row').nth(rowIndex);
    // PK列は行ヘッダーを除く最初のデータセル（id列）
    const pkCell = row.locator('.editor-table-cell:not(.editor-table-row-header)').first();
    await pkCell.click({ button: 'right' });
}

/**
 * 指定行・列のデータセルを返す
 * rowIndex: 0始まり、colIndex: 0始まり（行ヘッダーを除く）
 */
function getDataCell(table: Locator, rowIndex: number, colIndex: number): Locator {
    const row = table.locator('.editor-table-row').nth(rowIndex);
    return row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
}

// =============================================================================
// テストスイート
// =============================================================================

test.describe('フォームビュー（FEAT_0043）', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createFormPanelTestFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
        await enableRelationsPanelAsync(page);
    });

    test('右上ツールバーにフォームビューのトグルアイコンが表示されること', async ({ page }) => {
        const toggleButton = page.locator('#toolbar .toolbar-button-form-toggle');
        await expect(toggleButton).toBeVisible();
    });

    test('フォームビューのトグルアイコンで現在選択行のフォームを開閉できること', async ({ page }) => {
        await openTableAsync(page, 'quest');

        const toggleButton = page.locator('#toolbar .toolbar-button-form-toggle');
        await toggleButton.click();

        const formPanel = page.locator('.form-panel');
        await expect(formPanel).toBeVisible();
        await expect(formPanel.locator('.form-panel-title-table')).toHaveText('quest');
        await expect(formPanel.locator('.form-panel-title-pk')).toHaveText('1');
        await expect(toggleButton).toHaveClass(/toolbar-button-form-active/);

        await toggleButton.click();
        await expect(formPanel).not.toBeVisible();
        await expect(toggleButton).not.toHaveClass(/toolbar-button-form-active/);
    });

    test('フォームビュー表示中に選択行を変えるとフォーム内容も追従すること', async ({ page }) => {
        const table = await openTableAsync(page, 'quest');

        const toggleButton = page.locator('#toolbar .toolbar-button-form-toggle');
        await toggleButton.click();

        const formPanel = page.locator('.form-panel');
        await expect(formPanel).toBeVisible();
        await expect(formPanel.locator('.form-panel-title-pk')).toHaveText('1');

        await table.locator('.editor-table-row-header').nth(1).click();

        await expect(formPanel.locator('.form-panel-title-pk')).toHaveText('2');
        await expect(formPanel.locator('.form-panel-field[data-column-name="name"] .form-panel-field-input')).toHaveValue('second_quest');
    });

    test('フォームビューの表示状態がタブごとに保持され、復帰時に再表示されること', async ({ page }) => {
        await openTableAsync(page, 'quest');

        const toggleButton = page.locator('#toolbar .toolbar-button-form-toggle');
        await toggleButton.click();

        const formPanel = page.locator('.form-panel');
        await expect(formPanel).toBeVisible();
        await expect(formPanel.locator('.form-panel-title-table')).toHaveText('quest');
        await expect(formPanel.locator('.form-panel-title-pk')).toHaveText('1');

        await openTableAsync(page, 'enemy');
        await expect(formPanel).not.toBeVisible();
        await expect(toggleButton).not.toHaveClass(/toolbar-button-form-active/);

        await page.locator('.tab-button').filter({ has: page.locator('.tab-button-name', { hasText: 'quest' }) }).click();
        await expect(formPanel).toBeVisible();
        await expect(formPanel.locator('.form-panel-title-table')).toHaveText('quest');
        await expect(formPanel.locator('.form-panel-title-pk')).toHaveText('1');
        await expect(toggleButton).toHaveClass(/toolbar-button-form-active/);

        await toggleButton.click();
        await expect(formPanel).not.toBeVisible();

        await page.locator('.tab-button').filter({ has: page.locator('.tab-button-name', { hasText: 'enemy' }) }).click();
        await page.locator('.tab-button').filter({ has: page.locator('.tab-button-name', { hasText: 'quest' }) }).click();
        await expect(formPanel).not.toBeVisible();
        await expect(toggleButton).not.toHaveClass(/toolbar-button-form-active/);
    });

    test('ブラウザ履歴でタブ移動してもフォームビューの表示状態が復元されること', async ({ page }) => {
        await openTableAsync(page, 'quest');

        const toggleButton = page.locator('#toolbar .toolbar-button-form-toggle');
        await toggleButton.click();

        const formPanel = page.locator('.form-panel');
        await expect(formPanel).toBeVisible();
        await expect(formPanel.locator('.form-panel-title-table')).toHaveText('quest');

        await openTableAsync(page, 'enemy');
        await page.locator('.tab-button').filter({ has: page.locator('.tab-button-name', { hasText: 'quest' }) }).click();
        await expect(formPanel).toBeVisible();

        await page.goBack();
        await expect(page.locator('.tab-button-active .tab-button-name')).toHaveText('enemy');
        await expect(formPanel).not.toBeVisible();

        await page.goForward();
        await expect(page.locator('.tab-button-active .tab-button-name')).toHaveText('quest');
        await expect(formPanel).toBeVisible();
        await expect(formPanel.locator('.form-panel-title-table')).toHaveText('quest');
        await expect(toggleButton).toHaveClass(/toolbar-button-form-active/);
    });

    // -------------------------------------------------------------------------
    // テスト1: PKセル右クリックで「フォームビューを表示」メニューが表示されること
    // -------------------------------------------------------------------------
    test('PKセルを右クリックするとコンテキストメニューに「フォームビューを表示」が表示されること', async ({ page }) => {
        // quest テーブルを開く（item が quest_id で参照しているため逆参照エントリが存在する）
        const table = await openTableAsync(page, 'quest');

        // 1行目（id=1）の PK セルを右クリックしてコンテキストメニューを開く
        await rightClickPkCellAsync(table, 0);

        // コンテキストメニューが表示されること
        const menu = page.locator('.context-menu.visible');
        await expect(menu).toBeVisible();

        // 「フォームビューを表示」メニュー項目が存在すること
        const formViewItem = menu.locator('.context-menu-item', { hasText: 'フォームビューを表示' });
        await expect(formViewItem).toBeVisible();
    });

    // -------------------------------------------------------------------------
    // テスト2: フォームビューを表示すると右ペインに key:value フォームが表示されること
    // -------------------------------------------------------------------------
    test('「フォームビューを表示」をクリックすると右ペインにフォームパネルが表示されること', async ({ page }) => {
        const table = await openTableAsync(page, 'quest');

        // PK セルを右クリック → 「フォームビューを表示」をクリック
        await rightClickPkCellAsync(table, 0);
        const menu = page.locator('.context-menu.visible');
        await expect(menu).toBeVisible();
        await menu.locator('.context-menu-item', { hasText: 'フォームビューを表示' }).click();

        // 右ペインに .form-panel が表示されること
        const formPanel = page.locator('.form-panel');
        await expect(formPanel).toBeVisible();
        await expect(page.locator('#toolbar .toolbar-button-form-toggle')).toHaveClass(/toolbar-button-form-active/);
        await expect(page.locator('.relations-panel')).not.toBeVisible();
        await expect(page.locator('#toolbar .toolbar-button-relations-toggle')).not.toHaveClass(/toolbar-button-relations-active/);
        await expect(formPanel.locator('.form-panel-header')).toHaveCount(0);
        await expect(formPanel.locator('.form-panel-close')).toHaveCount(0);

        // .form-panel-field 要素が存在すること（各列がフィールドとして表示される）
        const fields = formPanel.locator('.form-panel-field');
        await expect(fields.first()).toBeVisible();

        // quest テーブルの各列名（id, name, enemy_id）がラベルとして表示されること
        const labelId = formPanel.locator('.form-panel-field-label').filter({ hasText: /^id$/ });
        await expect(labelId).toBeVisible();
        const labelName = formPanel.locator('.form-panel-field-label').filter({ hasText: /^name$/ });
        await expect(labelName).toBeVisible();
        const labelEnemyId = formPanel.locator('.form-panel-field-label').filter({ hasText: /^enemy_id$/ });
        await expect(labelEnemyId).toBeVisible();

        // 1行目（id=1, name=first_quest, enemy_id=1）の値が表示されること
        const valueId = formPanel.locator('.form-panel-field-value', { hasText: '1' }).first();
        await expect(valueId).toBeVisible();
        const valueName = formPanel.locator('.form-panel-field-value', { hasText: 'first_quest' });
        await expect(valueName).toBeVisible();
    });

    test('フォームビューはエディター全体ではなく右ペイン内に表示されること', async ({ page }) => {
        const table = await openTableAsync(page, 'quest');

        await rightClickPkCellAsync(table, 0);
        const menu = page.locator('.context-menu.visible');
        await expect(menu).toBeVisible();
        await menu.locator('.context-menu-item', { hasText: 'フォームビューを表示' }).click();

        const formPanel = page.locator('.form-panel');
        await expect(formPanel).toBeVisible();

        const isInRightSlot = await formPanel.evaluate(el => el.parentElement?.classList.contains('editor-right-slot') ?? false);
        expect(isInRightSlot).toBe(true);

        const formBox = await formPanel.boundingBox();
        const rightSlotBox = await page.locator('.editor-right-slot').boundingBox();
        const leftSlotBox = await page.locator('.editor-left-slot').boundingBox();
        expect(formBox).not.toBeNull();
        expect(rightSlotBox).not.toBeNull();
        expect(leftSlotBox).not.toBeNull();
        expect(formBox!.x).toBeGreaterThanOrEqual(rightSlotBox!.x - 1);
        expect(formBox!.x + formBox!.width).toBeLessThanOrEqual(rightSlotBox!.x + rightSlotBox!.width + 1);
        expect(formBox!.x).toBeGreaterThanOrEqual(leftSlotBox!.x + leftSlotBox!.width - 1);
    });

    // -------------------------------------------------------------------------
    // テスト（ISSUE_0141）: RelationsPanel非表示時でもフォームビューが表示されること
    // -------------------------------------------------------------------------
    test('ISSUE_0141: RelationsPanel非表示時でもフォームビューが表示され、閉じると非表示状態に戻ること', async ({ page }) => {
        const table = await openTableAsync(page, 'quest');

        // RelationsPanel を非表示にする
        const toggleButton = page.locator('#toolbar .toolbar-button-relations-toggle');
        await toggleButton.click();
        await expect(toggleButton).not.toHaveClass(/toolbar-button-relations-active/);
        await expect(page.locator('.relations-panel')).not.toBeVisible();
        const rightSlot = page.locator('.editor-right-slot');
        await expect(rightSlot).not.toBeVisible();

        // PK セルを右クリック → 「フォームビューを表示」をクリック
        await rightClickPkCellAsync(table, 0);
        const menu = page.locator('.context-menu.visible');
        await expect(menu).toBeVisible();
        await menu.locator('.context-menu-item', { hasText: 'フォームビューを表示' }).click();

        // FormPanel 表示中だけ右スロットが表示され、フォームビューが見えること
        await expect(rightSlot).toBeVisible();
        const formPanel = page.locator('.form-panel');
        await expect(formPanel).toBeVisible();
        await expect(page.locator('.relations-panel')).not.toBeVisible();
        await expect(toggleButton).not.toHaveClass(/toolbar-button-relations-active/);

        // ツールバーのトグルで閉じると FormPanel は消え、RelationsPanel の非表示状態が復元されること
        await page.locator('#toolbar .toolbar-button-form-toggle').click();
        await expect(formPanel).not.toBeVisible();
        await expect(page.locator('.relations-panel')).not.toBeVisible();
        await expect(rightSlot).not.toBeVisible();
        await expect(toggleButton).not.toHaveClass(/toolbar-button-relations-active/);
    });

    // -------------------------------------------------------------------------
    // テスト（BUG_0027）: フォームビューのz-indexが200であること
    // -------------------------------------------------------------------------
    test('BUG_0027: フォームビューのz-indexが200であること', async ({ page }) => {
        const table = await openTableAsync(page, 'quest');
        await rightClickPkCellAsync(table, 0);
        const menu = page.locator('.context-menu.visible');
        await expect(menu).toBeVisible();
        await menu.locator('.context-menu-item', { hasText: 'フォームビューを表示' }).click();

        const formPanel = page.locator('.form-panel');
        await expect(formPanel).toBeVisible();

        // .form-panel の computedStyle.zIndex が '200' であること（現在は '10' なのでRED）
        const zIndex = await formPanel.evaluate(el => getComputedStyle(el).zIndex);
        expect(zIndex).toBe('200');
    });

    // -------------------------------------------------------------------------
    // テスト（BUG_0027）: z-index値がCSS変数（--z-index-*）で一元管理されていること
    // -------------------------------------------------------------------------
    test('BUG_0027: CSS変数--z-index-form-panelが:rootに定義され値が200であること', async ({ page }) => {
        // :root の computedStyle から --z-index-form-panel が定義されているか検証
        // 現在CSS変数が存在しないためRED
        const value = await page.evaluate(() => {
            return getComputedStyle(document.documentElement).getPropertyValue('--z-index-form-panel').trim();
        });
        expect(value).toBe('200');
    });

    // -------------------------------------------------------------------------
    // テスト3: フォームビューのトグルボタンで閉じること
    // -------------------------------------------------------------------------
    test('フォームビューのトグルボタンをクリックするとフォームビューだけが閉じること', async ({ page }) => {
        const table = await openTableAsync(page, 'quest');

        // フォームビューを表示する
        await rightClickPkCellAsync(table, 0);
        const menu = page.locator('.context-menu.visible');
        await expect(menu).toBeVisible();
        await menu.locator('.context-menu-item', { hasText: 'フォームビューを表示' }).click();

        // フォームビューが表示されていること
        const formPanel = page.locator('.form-panel');
        await expect(formPanel).toBeVisible();

        await expect(formPanel.locator('.form-panel-header')).toHaveCount(0);
        await expect(formPanel.locator('.form-panel-close')).toHaveCount(0);

        await page.locator('#toolbar .toolbar-button-form-toggle').click();

        // フォームパネルが非表示になること
        await expect(formPanel).not.toBeVisible();
        await expect(page.locator('#toolbar .toolbar-button-form-toggle')).not.toHaveClass(/toolbar-button-form-active/);

        // フォームビュー表示時に閉じたRelationsPanelは再表示しないこと
        const relationsPanel = page.locator('.relations-panel');
        await expect(relationsPanel).not.toBeVisible();
        await expect(page.locator('#toolbar .toolbar-button-relations-toggle')).not.toHaveClass(/toolbar-button-relations-active/);
    });

    test('フォーム入力がEditorTableに反映されること', async ({ page }) => {
        const table = await openTableAsync(page, 'quest');
        await rightClickPkCellAsync(table, 0);
        const menu = page.locator('.context-menu.visible');
        await menu.locator('.context-menu-item', { hasText: 'フォームビューを表示' }).click();

        const formPanel = page.locator('.form-panel');
        await expect(formPanel).toBeVisible();
        const nameInput = formPanel.locator('.form-panel-field[data-column-name="name"] .form-panel-field-input');
        await expect(nameInput).toBeVisible();

        await nameInput.fill('edited_quest');

        await expect(getDataCell(table, 0, 1)).toContainText('edited_quest');
    });

    test('フォーム入力後のバリデーション結果がフォーム内にも表示されること', async ({ page }) => {
        const table = await openTableAsync(page, 'quest');
        await rightClickPkCellAsync(table, 0);
        const menu = page.locator('.context-menu.visible');
        await menu.locator('.context-menu-item', { hasText: 'フォームビューを表示' }).click();

        const formPanel = page.locator('.form-panel');
        const enemyInput = formPanel.locator('.form-panel-field[data-column-name="enemy_id"] .form-panel-field-input');
        await expect(enemyInput).toBeVisible();

        await enemyInput.fill('abc');

        const enemyField = formPanel.locator('.form-panel-field[data-column-name="enemy_id"]');
        await expect(enemyField).toHaveClass(/form-panel-field--invalid/);
        await expect(enemyField.locator('.form-panel-field-error').filter({ hasText: '型 int' })).toBeVisible();
        await expect(formPanel.locator('.form-panel-validation')).toHaveCount(0);
        await expect(formPanel).not.toContainText('バリデーションOK');
        await expect(getDataCell(table, 0, 2)).toHaveClass(/cell-error/);
    });

    test('参照先と参照元が一覧で表示され、深さインジケーターが表示されないこと', async ({ page }) => {
        const table = await openTableAsync(page, 'quest');
        await rightClickPkCellAsync(table, 0);
        const menu = page.locator('.context-menu.visible');
        await menu.locator('.context-menu-item', { hasText: 'フォームビューを表示' }).click();

        const formPanel = page.locator('.form-panel');
        await expect(formPanel.locator('.form-panel-references')).toBeVisible();
        await expect(formPanel.locator('.form-panel-references')).toContainText('参照先: enemy_id');
        await expect(formPanel.locator('.form-panel-references')).toContainText('スライム');
        await expect(formPanel.locator('.form-panel-references')).toContainText('参照元: item');
        await expect(formPanel.locator('.form-panel-depth-bar')).toHaveCount(0);
    });

    test('参照アイテムをクリックするとフォーム内に子フォームとして展開されること', async ({ page }) => {
        const table = await openTableAsync(page, 'quest');
        await rightClickPkCellAsync(table, 0);
        const menu = page.locator('.context-menu.visible');
        await menu.locator('.context-menu-item', { hasText: 'フォームビューを表示' }).click();

        const formPanel = page.locator('.form-panel');
        const enemySection = formPanel.locator('.form-panel-section', { hasText: '参照先: enemy_id' });
        const enemyRef = enemySection.locator('.form-panel-ref-item--clickable', { hasText: 'スライム' }).first();
        await expect(enemyRef).toBeVisible();
        await enemyRef.click();

        await expect(formPanel.locator('.form-panel-node--root > .form-panel-title .form-panel-title-table')).toHaveText('quest');
        await expect(formPanel.locator('.form-panel-child-host .form-panel-title-table')).toHaveText('enemy');
        await expect(formPanel.locator('.form-panel-child-host .form-panel-field[data-column-name="ja"] .form-panel-field-input')).toHaveValue('スライム');
        await expect(enemyRef).toHaveAttribute('aria-expanded', 'true');
    });

    test('1:1の参照元は子フォーム内に自動で添付されること', async ({ page }) => {
        const table = await openTableAsync(page, 'quest');
        await rightClickPkCellAsync(table, 0);
        const menu = page.locator('.context-menu.visible');
        await menu.locator('.context-menu-item', { hasText: 'フォームビューを表示' }).click();

        const formPanel = page.locator('.form-panel');
        const weaponSection = formPanel.locator('.form-panel-node--root .form-panel-section', { hasText: '参照先: weapon_id' });
        const weaponRef = weaponSection.locator('.form-panel-ref-item--clickable').first();
        await expect(weaponRef).toBeVisible();
        await weaponRef.click();

        const weaponNode = formPanel.locator('.form-panel-child-host .form-panel-node', { hasText: 'weapon' }).first();
        await expect(weaponNode.locator(':scope > .form-panel-title .form-panel-title-table')).toHaveText('weapon');
        await expect(weaponNode.locator(':scope > .form-panel-attachments')).toBeVisible();
        await expect(weaponNode.locator(':scope > .form-panel-attachments .form-panel-attached-section', { hasText: '参照元: weapon_name' })).toBeVisible();
        await expect(weaponNode.locator(':scope > .form-panel-attachments .form-panel-title-table')).toHaveText('weapon_name');
        await expect(weaponNode.locator(':scope > .form-panel-attachments .form-panel-field[data-column-name="ja"] .form-panel-field-input')).toHaveValue('剣');
        await expect(weaponNode.locator(':scope > .form-panel-references .form-panel-section', { hasText: '参照元: weapon_name' })).toHaveCount(0);
        await expect(formPanel.locator('.form-panel-node--root > .form-panel-title .form-panel-title-table')).toHaveText('quest');
    });

    test('参照列の入力開始時にEditorTable共通ドロップダウンで候補を選択して反映できること', async ({ page }) => {
        const table = await openTableAsync(page, 'quest');
        await rightClickPkCellAsync(table, 0);
        const menu = page.locator('.context-menu.visible');
        await menu.locator('.context-menu-item', { hasText: 'フォームビューを表示' }).click();

        const formPanel = page.locator('.form-panel');
        const enemyField = formPanel.locator('.form-panel-field[data-column-name="enemy_id"]');
        const enemyInput = enemyField.locator('.form-panel-field-input');
        await expect(enemyField.locator('.form-panel-field-reference-select')).toHaveCount(0);

        await enemyInput.fill('2');
        const dropdown = formPanel.locator('.grid-dropdown-list');
        await expect(dropdown).toBeVisible();
        await expect(dropdown).toContainText('2');
        await expect(dropdown).toContainText('ドラゴン');

        await dropdown.locator('.grid-dropdown-item', { hasText: 'ドラゴン' }).click();

        await expect(enemyInput).toHaveValue('2');
        await expect(getDataCell(table, 0, 2)).toContainText('2');
        await expect(formPanel.locator('.form-panel-references')).toContainText('ドラゴン');
        await expect(formPanel.locator('.form-panel-field-reference-select')).toHaveCount(0);
    });

    test('参照列の候補表示名はEditorTableと同じ二段以上先の参照ヒントを使うこと', async ({ page }) => {
        const table = await openTableAsync(page, 'quest');
        await rightClickPkCellAsync(table, 0);
        const menu = page.locator('.context-menu.visible');
        await menu.locator('.context-menu-item', { hasText: 'フォームビューを表示' }).click();

        const formPanel = page.locator('.form-panel');
        const weaponField = formPanel.locator('.form-panel-field[data-column-name="weapon_id"]');
        const weaponInput = weaponField.locator('.form-panel-field-input');

        await weaponInput.fill('20');
        const dropdown = formPanel.locator('.grid-dropdown-list');
        await expect(dropdown).toBeVisible();
        await expect(dropdown).toContainText('20');
        await expect(dropdown).toContainText('盾');

        await dropdown.locator('.grid-dropdown-item', { hasText: '盾' }).click();

        await expect(weaponInput).toHaveValue('20');
        await expect(getDataCell(table, 0, 3)).toContainText('20');
    });
});

test.describe('フォームビューの参照行見出し', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createShopProductFormPanelTestFileSystem());
        await page.goto('/');
        await enableRelationsPanelAsync(page);
    });

    test('表示列がない参照行は動的参照先の商品種別と表示名を見出しにすること', async ({ page }) => {
        await openTableAsync(page, 'shop');

        const toggleButton = page.locator('#toolbar .toolbar-button-form-toggle');
        await toggleButton.click();

        const formPanel = page.locator('.form-panel');
        const productSection = formPanel.locator('.form-panel-section', { hasText: '参照先: shop_product_group_id' });
        await expect(productSection).toBeVisible();

        const charaProduct = productSection.locator('.form-panel-ref-item', { hasText: 'キャラ: ネイト' });
        await expect(charaProduct).toBeVisible();
        await expect(charaProduct).toContainText('shop_product.group_id=9, table_id=1, record_id=14');
        await expect(charaProduct).toContainText('販売価格=1090');
        await expect(charaProduct).toContainText('表示順=15');

        const itemProduct = productSection.locator('.form-panel-ref-item', { hasText: 'アイテム: 神聖な弓' });
        await expect(itemProduct).toBeVisible();
        await expect(itemProduct).toContainText('販売価格=8677');
    });
});

test.describe('フォームビューの表示タイミング', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createSlowValidationFormPanelTestFileSystem());
        await page.goto('/');
        await enableRelationsPanelAsync(page);
    });

    test('バリデーション完了前にフォームビューを可視化しないこと', async ({ page }) => {
        const table = await openTableAsync(page, 'quest');
        await rightClickPkCellAsync(table, 0);
        const menu = page.locator('.context-menu.visible');
        await expect(menu).toBeVisible();
        await menu.locator('.context-menu-item', { hasText: 'フォームビューを表示' }).click();

        const formPanel = page.locator('.form-panel');
        await expect(formPanel).not.toBeVisible({ timeout: 100 });
        await expect(formPanel).toBeVisible({ timeout: 5000 });
        await expect(formPanel.locator('.form-panel-title-table')).toHaveText('quest');
        await expect(formPanel.locator('.form-panel-references')).toContainText('参照先: enemy_id');
    });
});
