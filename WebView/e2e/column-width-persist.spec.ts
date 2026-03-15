import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import {
    installMockApiAsync,
    readMockFileAsync,
    MockFileSystem,
} from './fixtures/mock-api';

/** カラム名自動計算で使用される最小列幅(px) */
const MIN_COLUMN_WIDTH_PX = 50;

/**
 * Explorerでテーブルを開き、
 * アクティブなタブのEditorTableを返す
 */
async function openTableAsync(
    page: Page,
    tableName: string,
): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer
        .getByText(tableName, { exact: true })
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
 * 列ヘッダーセルの幅をpx数値で取得する
 */
async function getColumnWidthPxAsync(
    table: Locator,
    colIndex: number,
): Promise<number> {
    const header = getColumnHeader(table, colIndex);
    const widthStr = await header.evaluate(
        (el) => getComputedStyle(el).width
    );
    return parseFloat(widthStr);
}

/**
 * テストデータ: widthフィールドなし（後方互換性テスト用）
 */
function createFileSystemWithoutWidth(): MockFileSystem {
    return {
        "schema/item.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                { key: 2, name: "value", type: "int" },
            ],
            primary_key: "id",
        }),
        "data/item.csv": [
            "id,name,value",
            "1,sword,100",
            "2,shield,200",
        ].join("\n"),
    };
}

/**
 * テストデータ: widthフィールドあり
 */
function createFileSystemWithWidth(): MockFileSystem {
    return {
        "schema/item.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int", width: 150 },
                { key: 1, name: "name", type: "string", width: 250 },
                { key: 2, name: "value", type: "int" },
            ],
            primary_key: "id",
        }),
        "data/item.csv": [
            "id,name,value",
            "1,sword,100",
            "2,shield,200",
        ].join("\n"),
    };
}

/**
 * テストデータ: 長いカラム名を含む（自動幅計算テスト用）
 */
function createFileSystemWithLongColumnName(): MockFileSystem {
    return {
        "schema/item.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "description_text_long_name", type: "string" },
            ],
            primary_key: "id",
        }),
        "data/item.csv": [
            "id,description_text_long_name",
            "1,hello",
            "2,world",
        ].join("\n"),
    };
}

// -------------------------------------------------------
// 列幅スキーマJSON永続化テスト
// -------------------------------------------------------
test.describe(
    '列幅のスキーマJSON永続化',
    () => {
        test(
            'widthフィールドがないスキーマでは'
            + 'カラム名に応じた幅で表示されること',
            async ({ page }) => {
                await installMockApiAsync(
                    page,
                    createFileSystemWithoutWidth()
                );
                await page.goto('/');

                const table = await openTableAsync(
                    page, 'item'
                );

                // 全列がMIN_COLUMN_WIDTH_PX以上であること
                const columnNames = ['id', 'name', 'value'];
                for (let i = 0; i < columnNames.length; i++) {
                    const widthPx = await getColumnWidthPxAsync(table, i);
                    expect(widthPx).toBeGreaterThanOrEqual(MIN_COLUMN_WIDTH_PX);
                }

                // カラム名に応じた幅であること（固定100pxではない）
                // 短いカラム名(id等)はMIN_COLUMN_WIDTH_PXに近い値になるはず
                const idWidth = await getColumnWidthPxAsync(table, 0);
                expect(idWidth).toBeLessThan(100);

                // name列はid列以上の幅を持つこと（nameの方が文字数が多い）
                const nameWidth = await getColumnWidthPxAsync(table, 1);
                expect(nameWidth).toBeGreaterThanOrEqual(idWidth);
            },
        );

        test(
            'widthフィールドがあるスキーマで'
            + '保存済み幅が適用されること',
            async ({ page }) => {
                await installMockApiAsync(
                    page,
                    createFileSystemWithWidth()
                );
                await page.goto('/');

                const table = await openTableAsync(
                    page, 'item'
                );

                // id列: 150px（スキーマ指定値が優先される）
                await expect(
                    getColumnHeader(table, 0)
                ).toHaveCSS('width', '150px');

                // name列: 250px（スキーマ指定値が優先される）
                await expect(
                    getColumnHeader(table, 1)
                ).toHaveCSS('width', '250px');

                // value列: widthなしのためカラム名に応じた自動計算値
                // 短いカラム名なのでMIN_COLUMN_WIDTH_PX付近になるはず（100pxではない）
                const valueWidth = await getColumnWidthPxAsync(table, 2);
                expect(valueWidth).toBeGreaterThanOrEqual(MIN_COLUMN_WIDTH_PX);
                expect(valueWidth).toBeLessThan(100);
            },
        );

        test(
            'Ctrl+Sでスキーマに列幅が保存されること',
            async ({ page }) => {
                await installMockApiAsync(
                    page,
                    createFileSystemWithWidth()
                );
                await page.goto('/');

                await openTableAsync(page, 'item');

                // Ctrl+Sで保存
                await page.keyboard.press('Control+s');
                await page.waitForTimeout(500);

                // スキーマJSONの内容を検証
                const schemaJson = await readMockFileAsync(
                    page, 'schema/item.json'
                );
                const schema = JSON.parse(schemaJson);

                // 保存された幅が整数で含まれること
                expect(schema.header[0].width).toBe(150);
                expect(schema.header[1].width).toBe(250);
                // widthなし列はカラム名に応じた計算値が保存される（100ではない）
                expect(schema.header[2].width).toBeGreaterThanOrEqual(MIN_COLUMN_WIDTH_PX);
                expect(schema.header[2].width).toBeLessThan(100);
            },
        );

        test(
            '保存時にスキーマの既存フィールドが'
            + '失われないこと',
            async ({ page }) => {
                await installMockApiAsync(
                    page,
                    createFileSystemWithWidth()
                );
                await page.goto('/');

                await openTableAsync(page, 'item');

                // Ctrl+Sで保存
                await page.keyboard.press('Control+s');
                await page.waitForTimeout(500);

                // スキーマJSONの内容を検証
                const schemaJson = await readMockFileAsync(
                    page, 'schema/item.json'
                );
                const schema = JSON.parse(schemaJson);

                // primary_keyが保持されること
                expect(schema.primary_key).toBe('id');
                // headerの各フィールドが保持されること
                expect(schema.header[0].name).toBe('id');
                expect(schema.header[0].type).toBe('int');
                expect(schema.header[1].name).toBe('name');
                expect(schema.header[1].type).toBe(
                    'string'
                );
            },
        );

        test(
            'カラム名が長い列は幅が広くなること',
            async ({ page }) => {
                await installMockApiAsync(
                    page,
                    createFileSystemWithLongColumnName()
                );
                await page.goto('/');

                const table = await openTableAsync(
                    page, 'item'
                );

                // 短いカラム名(id)の幅
                const idWidth = await getColumnWidthPxAsync(table, 0);
                // 長いカラム名(description_text_long_name)の幅
                const longNameWidth = await getColumnWidthPxAsync(table, 1);

                // 長いカラム名の列はid列より広いこと
                expect(longNameWidth).toBeGreaterThan(idWidth);
                // 長いカラム名の列はMIN_COLUMN_WIDTH_PXより十分大きいこと
                expect(longNameWidth).toBeGreaterThan(MIN_COLUMN_WIDTH_PX);
            },
        );
    },
);
