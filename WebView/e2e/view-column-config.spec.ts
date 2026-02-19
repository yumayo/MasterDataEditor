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
async function openViewAsync(
    page: Page,
    viewName: string,
): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.locator('[data-panel="views"]').click();
    await explorer
        .getByText(viewName, { exact: true })
        .click();
    const table = page.locator(
        '.tab-wrapper'
        + ':not([style*="display: none"])'
        + ' .editor-table'
    );
    await expect(table).toBeVisible();
    return table;
}

/**
 * 指定した列ヘッダーセルを返す
 * colIndex: 0始まり（行ヘッダーを除く）
 */
function getColumnHeader(
    table: Locator,
    colIndex: number,
): Locator {
    const headerRow = table.locator(
        '.editor-table-column-header-row'
    );
    return headerRow
        .locator('.editor-table-column-header')
        .nth(colIndex);
}

/**
 * 指定した行・列のデータセルを返す
 * rowIndex: 0始まり（ヘッダー行を除く）
 * colIndex: 0始まり（行ヘッダーを除く）
 */
function getDataCell(
    table: Locator,
    rowIndex: number,
    colIndex: number,
): Locator {
    const row = table
        .locator('.editor-table-row')
        .nth(rowIndex + 1);
    return row
        .locator(
            '.editor-table-cell'
            + ':not(.editor-table-row-header)'
        )
        .nth(colIndex);
}

/**
 * テストデータ: columnsフィールド付きのビュー定義
 * chara: id, name, skill_id
 * skill: id, value
 * view_chara: charaベース、skillをJOIN、columnsで列幅を指定
 */
function createFileSystemWithColumns(): MockFileSystem {
    return {
        "schema/chara.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                { key: 2, name: "skill_id", type: "int", reference: "skill.id" },
            ],
            primary_key: "id",
        }),
        "data/chara.csv": [
            "id,name,skill_id",
            "1,hero,1",
            "2,mage,2",
        ].join("\n"),
        "schema/skill.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "value", type: "int" },
            ],
            primary_key: "id",
        }),
        "data/skill.csv": [
            "id,value",
            "1,100",
            "2,200",
        ].join("\n"),
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
 * テストデータ: columnsなし（後方互換性テスト用）
 */
function createFileSystemWithoutColumns(): MockFileSystem {
    return {
        "schema/chara.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "skill_id", type: "int", reference: "skill.id" },
            ],
            primary_key: "id",
        }),
        "data/chara.csv": [
            "id,skill_id",
            "1,1",
            "2,2",
        ].join("\n"),
        "schema/skill.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "value", type: "int" },
            ],
            primary_key: "id",
        }),
        "data/skill.csv": [
            "id,value",
            "1,100",
            "2,200",
        ].join("\n"),
        "view/view_chara.json": JSON.stringify({
            name: "view_chara",
            baseTable: "chara",
            joins: [{
                sourceColumn: "skill_id",
                targetTable: "skill",
                targetColumn: "id",
                insertAfterViewColumnIndex: 1,
            }],
        }),
    };
}

/**
 * テストデータ: 非表示列を含むビュー定義
 */
function createFileSystemWithHiddenColumn(): MockFileSystem {
    return {
        "schema/chara.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                { key: 2, name: "skill_id", type: "int", reference: "skill.id" },
            ],
            primary_key: "id",
        }),
        "data/chara.csv": [
            "id,name,skill_id",
            "1,hero,1",
            "2,mage,2",
        ].join("\n"),
        "schema/skill.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "value", type: "int" },
            ],
            primary_key: "id",
        }),
        "data/skill.csv": [
            "id,value",
            "1,100",
            "2,200",
        ].join("\n"),
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

// -------------------------------------------------------
// ビュー列幅の永続化テスト
// -------------------------------------------------------
test.describe('ビュー列幅の永続化', () => {
    test(
        'columnsフィールドの幅がビューの列に適用されること',
        async ({ page }) => {
            await installMockApiAsync(
                page, createFileSystemWithColumns()
            );
            await page.goto('/');

            const table = await openViewAsync(
                page, 'view_chara'
            );

            // ビュー列: chara.id(80), chara.name(200), chara.skill_id(120), skill.value(150)
            await expect(getColumnHeader(table, 0)).toHaveCSS('width', '80px');
            await expect(getColumnHeader(table, 1)).toHaveCSS('width', '200px');
            await expect(getColumnHeader(table, 2)).toHaveCSS('width', '120px');
            await expect(getColumnHeader(table, 3)).toHaveCSS('width', '150px');
        },
    );

    test(
        'columnsフィールドなしでもデフォルト幅で正常表示されること',
        async ({ page }) => {
            await installMockApiAsync(
                page, createFileSystemWithoutColumns()
            );
            await page.goto('/');

            const table = await openViewAsync(
                page, 'view_chara'
            );

            // 全列がデフォルト幅（100px）で表示される
            const headerRow = table.locator(
                '.editor-table-column-header-row'
            );
            const columnHeaders = headerRow.locator(
                '.editor-table-column-header'
            );
            const count = await columnHeaders.count();
            for (let i = 0; i < count; i++) {
                await expect(columnHeaders.nth(i)).toHaveCSS('width', '100px');
            }
        },
    );

    test(
        'Ctrl+Sでビュー定義にcolumnsが保存されること',
        async ({ page }) => {
            await installMockApiAsync(
                page, createFileSystemWithColumns()
            );
            await page.goto('/');

            await openViewAsync(page, 'view_chara');

            // Ctrl+Sで保存
            await page.keyboard.press('Control+s');
            await page.waitForTimeout(500);

            // ビュー定義JSONの内容を検証
            const viewJson = await readMockFileAsync(
                page, 'view/view_chara.json'
            );
            const viewDef = JSON.parse(viewJson);

            // columnsフィールドが存在すること
            expect(viewDef.columns).toBeDefined();
            expect(viewDef.columns.length).toBeGreaterThan(0);

            // 各列の幅が保存されていること
            const idCol = viewDef.columns.find(
                (c: { tableName: string; columnName: string }) =>
                    c.tableName === 'chara' && c.columnName === 'id'
            );
            expect(idCol).toBeDefined();
            expect(idCol.width).toBe(80);

            const nameCol = viewDef.columns.find(
                (c: { tableName: string; columnName: string }) =>
                    c.tableName === 'chara' && c.columnName === 'name'
            );
            expect(nameCol).toBeDefined();
            expect(nameCol.width).toBe(200);
        },
    );
});

// -------------------------------------------------------
// ビュー列非表示テスト
// -------------------------------------------------------
test.describe('ビュー列非表示', () => {
    test(
        'hidden:trueの列がビューに表示されないこと',
        async ({ page }) => {
            await installMockApiAsync(
                page, createFileSystemWithHiddenColumn()
            );
            await page.goto('/');

            const table = await openViewAsync(
                page, 'view_chara'
            );

            // name列が非表示のため、ビュー列は3列のみ:
            // chara.id, chara.skill_id, skill.value
            const headerRow = table.locator(
                '.editor-table-column-header-row'
            );
            const columnHeaders = headerRow.locator(
                '.editor-table-column-header'
            );
            await expect(columnHeaders).toHaveCount(3);

            // ヘッダーにnameが含まれないこと
            await expect(columnHeaders.nth(0)).toHaveText('id');
            await expect(columnHeaders.nth(1)).toHaveText('skill_id');
            await expect(columnHeaders.nth(2)).toHaveText(/skill\.value/);
        },
    );

    test(
        '列ヘッダー右クリックで「列を非表示」メニューが表示されること',
        async ({ page }) => {
            await installMockApiAsync(
                page, createFileSystemWithColumns()
            );
            await page.goto('/');

            const table = await openViewAsync(
                page, 'view_chara'
            );

            // id列ヘッダーを右クリック
            const header = getColumnHeader(table, 0);
            await header.click({ button: 'right' });

            // コンテキストメニューに「列を非表示」があること
            const menu = page.locator('.context-menu.visible');
            await expect(menu).toBeVisible();
            await expect(menu.getByText('列を非表示')).toBeVisible();
        },
    );

    test(
        '「列を非表示」でDOMから列が消えること',
        async ({ page }) => {
            await installMockApiAsync(
                page, createFileSystemWithColumns()
            );
            await page.goto('/');

            const table = await openViewAsync(
                page, 'view_chara'
            );

            // 初期状態: 4列
            const headerRow = table.locator(
                '.editor-table-column-header-row'
            );
            await expect(
                headerRow.locator('.editor-table-column-header')
            ).toHaveCount(4);

            // name列（index=1）ヘッダーを右クリック
            const nameHeader = getColumnHeader(table, 1);
            await nameHeader.click({ button: 'right' });

            // 「列を非表示」をクリック
            const menu = page.locator('.context-menu');
            await menu.getByText('列を非表示').click();

            // 列が3列になること
            await expect(
                headerRow.locator('.editor-table-column-header')
            ).toHaveCount(3);

            // name列が消えていること
            await expect(getColumnHeader(table, 0)).toHaveText('id');
            await expect(getColumnHeader(table, 1)).toHaveText('skill_id');
        },
    );

    test(
        '列非表示のUndo/Redoが正しく動作すること',
        async ({ page }) => {
            await installMockApiAsync(
                page, createFileSystemWithColumns()
            );
            await page.goto('/');

            const table = await openViewAsync(
                page, 'view_chara'
            );

            const headerRow = table.locator(
                '.editor-table-column-header-row'
            );

            // name列を非表示にする
            const nameHeader = getColumnHeader(table, 1);
            await nameHeader.click({ button: 'right' });
            const menu = page.locator('.context-menu');
            await menu.getByText('列を非表示').click();

            // 3列になること
            await expect(
                headerRow.locator('.editor-table-column-header')
            ).toHaveCount(3);

            // Undo: 4列に復元
            await page.keyboard.press('Control+z');
            await expect(
                headerRow.locator('.editor-table-column-header')
            ).toHaveCount(4);
            await expect(getColumnHeader(table, 1)).toHaveText('name');

            // Redo: 再度3列
            await page.keyboard.press('Control+y');
            await expect(
                headerRow.locator('.editor-table-column-header')
            ).toHaveCount(3);
        },
    );

    test(
        '非表示列情報がJSON保存に反映されること',
        async ({ page }) => {
            await installMockApiAsync(
                page, createFileSystemWithHiddenColumn()
            );
            await page.goto('/');

            await openViewAsync(page, 'view_chara');

            // Ctrl+Sで保存
            await page.keyboard.press('Control+s');
            await page.waitForTimeout(500);

            // ビュー定義を検証
            const viewJson = await readMockFileAsync(
                page, 'view/view_chara.json'
            );
            const viewDef = JSON.parse(viewJson);

            // name列がhidden:trueで保存されていること
            const nameCol = viewDef.columns.find(
                (c: { tableName: string; columnName: string }) =>
                    c.tableName === 'chara' && c.columnName === 'name'
            );
            expect(nameCol).toBeDefined();
            expect(nameCol.hidden).toBe(true);
        },
    );

    test(
        '非表示列を含むビューの保存でデータが正しく分離されること',
        async ({ page }) => {
            await installMockApiAsync(
                page, createFileSystemWithHiddenColumn()
            );
            await page.goto('/');

            await openViewAsync(page, 'view_chara');

            // Ctrl+Sで保存
            await page.keyboard.press('Control+s');
            await page.waitForTimeout(500);

            // chara.csvの内容を検証（name列のデータも正しく保存されること）
            const charaCsv = await readMockFileAsync(
                page, 'data/chara.csv'
            );
            expect(charaCsv).toContain('hero');
            expect(charaCsv).toContain('mage');
        },
    );
});
