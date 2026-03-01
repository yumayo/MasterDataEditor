import { test, expect } from '@playwright/test';
import { Page, Locator } from '@playwright/test';
import {
    installMockApiAsync,
    MockFileSystem,
} from './fixtures/mock-api';

/**
 * Explorerでビューを開き、アクティブなタブのEditorTableを返す
 */
async function openViewAsync(page: Page, viewName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.locator('[data-panel="views"]').click();
    await explorer.getByText(viewName, { exact: true }).click();
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
 * 指定タブのdirtyインジケータを返す
 */
function getDirtyIndicator(page: Page, tabName: string): Locator {
    const tabButton = page.locator('.tab-button', { hasText: tabName });
    return tabButton.locator('.tab-button-dirty');
}

/**
 * テストデータ: 逆参照JOIN用
 * weapon: id=1,name=Sword / id=2,name=Shield
 * weapon_name: id=1,weapon_id=1,lang=ja,text=剣 / id=2,weapon_id=1,lang=en,text=Sword / id=3,weapon_id=2,lang=ja,text=盾
 * view_weapon: weaponベース、JOIN定義なし
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
 * テストデータ: 非表示列を含むビュー定義（再表示テスト用）
 * chara: id, name, skill_id
 * skill: id, value
 * view_chara: charaベース、skillをJOIN、name列がhidden:true
 */
function createHiddenColumnFileSystem(): MockFileSystem {
    return {
        "schema/chara.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                { key: 2, name: "skill_id", type: "int", reference: "skill.id" },
            ],
            primary_key: "id",
        }),
        "data/chara.csv": ["id,name,skill_id", "1,hero,1", "2,mage,2"].join("\n"),
        "schema/skill.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "value", type: "int" },
            ],
            primary_key: "id",
        }),
        "data/skill.csv": ["id,value", "1,100", "2,200"].join("\n"),
        "view/view_chara.json": JSON.stringify({
            name: "view_chara",
            baseTable: "chara",
            joins: [{
                sourceColumn: "skill_id",
                targetTable: "skill",
                targetColumn: "id",
                insertAfterViewColumnIndex: 2,
            }],
            columns: [
                { tableName: "chara", columnName: "id", width: 80 },
                { tableName: "chara", columnName: "name", width: 200, hidden: true },
                { tableName: "chara", columnName: "skill_id", width: 120 },
                { tableName: "skill", columnName: "value", width: 150 },
            ],
        }),
    };
}

/**
 * テストデータ: 順参照JOIN用（dirtyマーク動作の確認用）
 * chara: id, name, skill_id
 * skill: id, value
 * view_chara: charaベース、JOINなし（順参照JOINをコンテキストメニューから実行）
 */
function createForwardJoinFileSystem(): MockFileSystem {
    return {
        "schema/chara.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                { key: 2, name: "skill_id", type: "int", reference: "skill.id" },
            ],
            primary_key: "id",
        }),
        "data/chara.csv": ["id,name,skill_id", "1,hero,1", "2,mage,2"].join("\n"),
        "schema/skill.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "value", type: "int" },
            ],
            primary_key: "id",
        }),
        "data/skill.csv": ["id,value", "1,100", "2,200"].join("\n"),
        "view/view_chara.json": JSON.stringify({
            name: "view_chara",
            baseTable: "chara",
            joins: [],
        }),
    };
}

// -------------------------------------------------------
// ビュー再構築時のdirtyマークテスト
// -------------------------------------------------------
test.describe('ビュー再構築時のdirtyマーク', () => {

    test('逆参照JOIN後にdirtyマークが表示されること', async ({ page }) => {
        await installMockApiAsync(page, createReverseJoinFileSystem());
        await page.goto('/');
        const table = await openViewAsync(page, 'view_weapon');

        // 初期状態ではdirtyマークが非表示であること
        const dirty = getDirtyIndicator(page, 'view:view_weapon');
        await expect(dirty).not.toHaveClass(/tab-button-dirty-visible/);

        // 逆参照JOINを実行
        const header = getColumnHeader(table, 0);
        await header.click({ button: 'right' });
        const menu = page.locator('.context-menu');
        await menu.getByText('Join: weapon_name (reverse: weapon_id)').click();

        // rebuildViewTab完了を待機（weapon_name.text列の値で確認）
        await expect(getDataCell(table, 0, 3)).toHaveText('剣');

        // dirtyマークが表示されること
        const dirtyAfterJoin = getDirtyIndicator(page, 'view:view_weapon');
        await expect(dirtyAfterJoin).toHaveClass(/tab-button-dirty-visible/);
    });

    test('非表示列の再表示後にdirtyマークが表示されること', async ({ page }) => {
        await installMockApiAsync(page, createHiddenColumnFileSystem());
        await page.goto('/');
        const table = await openViewAsync(page, 'view_chara');

        // 初期状態ではdirtyマークが非表示であること
        const dirty = getDirtyIndicator(page, 'view:view_chara');
        await expect(dirty).not.toHaveClass(/tab-button-dirty-visible/);

        // 列ヘッダーを右クリックして非表示列の再表示メニューを表示
        const header = getColumnHeader(table, 0);
        await header.click({ button: 'right' });
        const menu = page.locator('.context-menu');
        await menu.getByText('表示: chara.name').click();

        // rebuildViewTab完了を待機（name列が表示されること）
        const headerRow = table.locator('.editor-table-column-header-row');
        await expect(headerRow.locator('.editor-table-column-header')).toHaveCount(4);

        // dirtyマークが表示されること
        const dirtyAfterShow = getDirtyIndicator(page, 'view:view_chara');
        await expect(dirtyAfterShow).toHaveClass(/tab-button-dirty-visible/);
    });

    test('逆参照JOIN後にCtrl+Sで保存するとdirtyマークが消えること', async ({ page }) => {
        await installMockApiAsync(page, createReverseJoinFileSystem());
        await page.goto('/');
        const table = await openViewAsync(page, 'view_weapon');

        // 逆参照JOINを実行
        const header = getColumnHeader(table, 0);
        await header.click({ button: 'right' });
        const menu = page.locator('.context-menu');
        await menu.getByText('Join: weapon_name (reverse: weapon_id)').click();
        await expect(getDataCell(table, 0, 3)).toHaveText('剣');

        // dirtyマークが表示されていること
        const dirty = getDirtyIndicator(page, 'view:view_weapon');
        await expect(dirty).toHaveClass(/tab-button-dirty-visible/);

        // Ctrl+Sで保存
        await page.keyboard.press('Control+s');
        await page.waitForTimeout(500);

        // dirtyマークが消えること
        await expect(dirty).not.toHaveClass(/tab-button-dirty-visible/);
    });

    test('順参照JOINでもdirtyマークが表示されること（既存動作の確認）', async ({ page }) => {
        await installMockApiAsync(page, createForwardJoinFileSystem());
        await page.goto('/');
        const table = await openViewAsync(page, 'view_chara');

        // 初期状態ではdirtyマークが非表示であること
        const dirty = getDirtyIndicator(page, 'view:view_chara');
        await expect(dirty).not.toHaveClass(/tab-button-dirty-visible/);

        // 順参照JOINを実行（skill_id列のヘッダーを右クリック）
        const header = getColumnHeader(table, 2);
        await header.click({ button: 'right' });
        const menu = page.locator('.context-menu');
        await menu.getByText('Join: skill').click();

        // JOIN完了を待機（skill.value列の値で確認）
        await expect(getDataCell(table, 0, 3)).toHaveText('100');

        // dirtyマークが表示されること
        await expect(dirty).toHaveClass(/tab-button-dirty-visible/);
    });
});
