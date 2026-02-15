import { test, expect } from '@playwright/test';
import { Page, Locator } from '@playwright/test';
import {
    installMockApiAsync,
    readMockFileAsync,
    MockFileSystem,
} from './fixtures/mock-api';

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

// -------------------------------------------------------
// 列幅スキーマJSON永続化テスト
// -------------------------------------------------------
test.describe(
    '列幅のスキーマJSON永続化',
    () => {
        test(
            'widthフィールドがないスキーマでも'
            + 'デフォルト幅で正常表示されること',
            async ({ page }) => {
                await installMockApiAsync(
                    page,
                    createFileSystemWithoutWidth()
                );
                await page.goto('/');

                const table = await openTableAsync(
                    page, 'item'
                );

                // 全列がデフォルト幅（100px）で表示される
                for (let i = 0; i < 3; i++) {
                    const header = getColumnHeader(
                        table, i
                    );
                    await expect(header).toHaveCSS(
                        'width', '100px'
                    );
                }
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

                // id列: 150px
                await expect(
                    getColumnHeader(table, 0)
                ).toHaveCSS('width', '150px');

                // name列: 250px
                await expect(
                    getColumnHeader(table, 1)
                ).toHaveCSS('width', '250px');

                // value列: widthなしのためデフォルト100px
                await expect(
                    getColumnHeader(table, 2)
                ).toHaveCSS('width', '100px');
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

                const table = await openTableAsync(
                    page, 'item'
                );

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
                // デフォルト幅の列にもwidthが保存される
                expect(schema.header[2].width).toBe(100);
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
    },
);
