import { test, expect } from '@playwright/test';
import { Page, Locator } from '@playwright/test';
import {
    installMockApiAsync,
    readMockFileAsync,
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
 * テストデータ:
 * chara: id, name, skill_id
 * skill: id, value
 * view_chara: charaベース、skillをJOIN済み
 *
 * ビュー列: chara.id(0), chara.name(1), chara.skill_id(2), skill.value(3)
 */
function createFileSystemWithJoin(): MockFileSystem {
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
                { tableName: "chara", columnName: "name", width: 200 },
                { tableName: "chara", columnName: "skill_id", width: 120 },
                { tableName: "skill", columnName: "value", width: 150 },
            ],
        }),
    };
}

/**
 * テストデータ: JOINなしのビュー（コンテキストメニューからJOIN→解除のフローテスト用）
 */
function createFileSystemWithoutJoin(): MockFileSystem {
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
// JOIN解除テスト
// -------------------------------------------------------
test.describe('JOIN解除', () => {

    test('JOIN済みビューのコンテキストメニューに「JOINを解除」が表示されること', async ({ page }) => {
        await installMockApiAsync(page, createFileSystemWithJoin());
        await page.goto('/');
        const table = await openViewAsync(page, 'view_chara');

        // 列ヘッダーを右クリック
        const header = getColumnHeader(table, 0);
        await header.click({ button: 'right' });

        // コンテキストメニューに「JOINを解除: skill」が表示されること
        const menu = page.locator('.context-menu.visible');
        await expect(menu).toBeVisible();
        await expect(menu.getByText('JOINを解除: skill')).toBeVisible();
    });

    test('JOINなしビューのコンテキストメニューに「JOINを解除」が表示されないこと', async ({ page }) => {
        await installMockApiAsync(page, createFileSystemWithoutJoin());
        await page.goto('/');
        const table = await openViewAsync(page, 'view_chara');

        // 列ヘッダーを右クリック
        const header = getColumnHeader(table, 0);
        await header.click({ button: 'right' });

        // コンテキストメニューが表示されること
        const menu = page.locator('.context-menu.visible');
        await expect(menu).toBeVisible();

        // 「JOINを解除」が表示されないこと
        await expect(menu.getByText('JOINを解除')).toHaveCount(0);
    });

    test('「JOINを解除」でJOIN列がビューから消えること', async ({ page }) => {
        await installMockApiAsync(page, createFileSystemWithJoin());
        await page.goto('/');
        const table = await openViewAsync(page, 'view_chara');

        // 初期状態: 4列（chara.id, chara.name, chara.skill_id, skill.value）
        const headerRow = table.locator('.editor-table-column-header-row');
        await expect(headerRow.locator('.editor-table-column-header')).toHaveCount(4);
        await expect(getColumnHeader(table, 3)).toHaveText(/skill\.value/);

        // 列ヘッダーを右クリック → 「JOINを解除: skill」をクリック
        const header = getColumnHeader(table, 0);
        await header.click({ button: 'right' });
        const menu = page.locator('.context-menu');
        await menu.getByText('JOINを解除: skill').click();

        // rebuildViewTabによるDOM再構築完了を待機
        // JOIN解除後は3列（chara.id, chara.name, chara.skill_id）
        await expect(headerRow.locator('.editor-table-column-header')).toHaveCount(3);
        await expect(getColumnHeader(table, 0)).toHaveText('id');
        await expect(getColumnHeader(table, 1)).toHaveText('name');
        await expect(getColumnHeader(table, 2)).toHaveText('skill_id');

        // データも正しく表示されること
        await expect(getDataCell(table, 0, 0)).toHaveText('1');
        await expect(getDataCell(table, 0, 1)).toHaveText('hero');
        await expect(getDataCell(table, 0, 2)).toHaveText('1');
    });

    test('JOIN解除後に再度JOINできること', async ({ page }) => {
        await installMockApiAsync(page, createFileSystemWithJoin());
        await page.goto('/');
        const table = await openViewAsync(page, 'view_chara');

        // JOINを解除
        const header = getColumnHeader(table, 0);
        await header.click({ button: 'right' });
        const menu = page.locator('.context-menu');
        await menu.getByText('JOINを解除: skill').click();

        // 再構築完了を待機（3列になること）
        const headerRow = table.locator('.editor-table-column-header-row');
        await expect(headerRow.locator('.editor-table-column-header')).toHaveCount(3);

        // 再度コンテキストメニューを開く
        const headerAfter = getColumnHeader(table, 2);
        await headerAfter.click({ button: 'right' });

        // JOINメニューが表示されること（解除されたのでskillが再JOINの候補として表示される）
        const menuAfter = page.locator('.context-menu.visible');
        await expect(menuAfter).toBeVisible();
        await expect(menuAfter.getByText('Join: skill (via skill_id)')).toBeVisible();

        // 「JOINを解除」が表示されないこと（JOINがない状態）
        await expect(menuAfter.getByText('JOINを解除')).toHaveCount(0);
    });

    test('JOIN解除後の保存でビュー定義からJOINが消えること', async ({ page }) => {
        await installMockApiAsync(page, createFileSystemWithJoin());
        await page.goto('/');
        const table = await openViewAsync(page, 'view_chara');

        // JOINを解除
        const header = getColumnHeader(table, 0);
        await header.click({ button: 'right' });
        const menu = page.locator('.context-menu');
        await menu.getByText('JOINを解除: skill').click();

        // 再構築完了を待機
        const headerRow = table.locator('.editor-table-column-header-row');
        await expect(headerRow.locator('.editor-table-column-header')).toHaveCount(3);

        // Ctrl+Sで保存
        await page.keyboard.press('Control+s');
        await page.waitForTimeout(500);

        // ビュー定義JSONを検証
        const viewJson = await readMockFileAsync(page, 'view/view_chara.json');
        const viewDef = JSON.parse(viewJson);

        // joinsが空であること
        expect(viewDef.joins).toEqual([]);

        // columnsにskillテーブルの列が含まれないこと
        const skillColumns = viewDef.columns.filter(
            (c: { tableName: string }) => c.tableName === 'skill'
        );
        expect(skillColumns.length).toBe(0);
    });
});
