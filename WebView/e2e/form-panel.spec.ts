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
//   フォームビューは選択行の全列を key:value 形式で縦表示し、右上の ✕ ボタンで閉じる。
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
        "schema/quest.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                { key: 2, name: "enemy_id", type: "int", reference: "enemy.id" },
            ],
            primary_key: ["id"],
        }),
        "data/quest.csv": [
            "id,name,enemy_id",
            "1,first_quest,1",
            "2,second_quest,2",
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

        // 閉じると FormPanel は消え、RelationsPanel の非表示状態が復元されること
        await formPanel.locator('.form-panel-close').click();
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
    // テスト3: フォームビューの ✕ ボタンで閉じて RelationsPanel に戻ること
    // -------------------------------------------------------------------------
    test('フォームビューの ✕ ボタンをクリックすると RelationsPanel に戻ること', async ({ page }) => {
        const table = await openTableAsync(page, 'quest');

        // フォームビューを表示する
        await rightClickPkCellAsync(table, 0);
        const menu = page.locator('.context-menu.visible');
        await expect(menu).toBeVisible();
        await menu.locator('.context-menu-item', { hasText: 'フォームビューを表示' }).click();

        // フォームビューが表示されていること
        const formPanel = page.locator('.form-panel');
        await expect(formPanel).toBeVisible();

        // .form-panel-close ボタン（SVG ✕）が存在すること
        const closeButton = formPanel.locator('.form-panel-close');
        await expect(closeButton).toBeVisible();

        // ✕ ボタンをクリックする
        await closeButton.click();

        // フォームパネルが非表示になること
        await expect(formPanel).not.toBeVisible();

        // RelationsPanel が再び表示されること
        const relationsPanel = page.locator('.relations-panel');
        await expect(relationsPanel).toBeVisible();
    });
});
