import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, readMockFileAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// ソート・フィルター永続化テスト
//
// 機能概要:
//   ソート・フィルターの状態をスキーマJSON（schema/{テーブル名}.json）に永続化する。
//   ソート変更時・フィルター変更時に saveSchemaDataAsync() 経由で即座に保存する。
//   テーブル再オープン時にスキーマから読み込み、ソート・フィルター状態を復元する。
//   存在しない列名は無視する。値が空の場合はフィールド省略する。
//
// テストケース一覧:
//   1. ソート適用後にスキーマに sortKeys が保存される
//   2. ソート解除後にスキーマから sortKeys が消える
//   3. sortKeys がスキーマにあるテーブルを開くとソートが復元される
//   4. フィルター適用後にスキーマに filters が保存される
//   5. フィルター解除後にスキーマから filters が消える
//   6. filters がスキーマにあるテーブルを開くとフィルターが復元される
//   7. 存在しない列名の sortKeys は無視されて復元される
//   8. 存在しない列名の filters は無視されて復元される
//   9. ソートとフィルターが同時にスキーマに保存される
//  10. ソートとフィルターが同時に復元される
// =============================================================================

// =============================================================================
// フィクスチャ生成ヘルパー
// =============================================================================

/**
 * ソート永続化テスト用のファイルシステムを生成する。
 *
 * テーブル構成:
 *   item: id（int）, name（string）, value（int）
 *
 * 初期データはバラバラな順序で格納し、ソートの動作確認に使う。
 */
function createPersistenceTestFileSystem(): MockFileSystem {
    return {
        "schema/item.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                { key: 2, name: "value", type: "int" },
            ],
            primary_key: ["id"],
        }),
        "data/item.csv": [
            "id,name,value",
            "2,beta,200",
            "10,alpha,900",
            "1,alpha,100",
        ].join("\n"),
    };
}

/**
 * ソートキーが事前設定済みのスキーマを持つファイルシステムを生成する。
 * テーブル再オープン時のソート復元を検証するため。
 */
function createPreSortedTestFileSystem(): MockFileSystem {
    return {
        "schema/item.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                { key: 2, name: "value", type: "int" },
            ],
            primary_key: ["id"],
            sortKeys: [
                { columnName: "id", direction: "asc" },
            ],
        }),
        "data/item.csv": [
            "id,name,value",
            "2,beta,200",
            "10,alpha,900",
            "1,alpha,100",
        ].join("\n"),
    };
}

/**
 * フィルターが事前設定済みのスキーマを持つファイルシステムを生成する。
 * テーブル再オープン時のフィルター復元を検証するため。
 */
function createPreFilteredTestFileSystem(): MockFileSystem {
    return {
        "schema/item.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                { key: 2, name: "value", type: "int" },
            ],
            primary_key: ["id"],
            filters: {
                name: ["alpha"],
            },
        }),
        "data/item.csv": [
            "id,name,value",
            "2,beta,200",
            "10,alpha,900",
            "1,alpha,100",
        ].join("\n"),
    };
}

/**
 * 存在しない列名を含むソートキー付きスキーマのファイルシステムを生成する。
 * 存在しない列名が無視されることを検証するため。
 */
function createInvalidColumnSortTestFileSystem(): MockFileSystem {
    return {
        "schema/item.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                { key: 2, name: "value", type: "int" },
            ],
            primary_key: ["id"],
            sortKeys: [
                { columnName: "nonexistent_column", direction: "asc" },
                { columnName: "id", direction: "desc" },
            ],
        }),
        "data/item.csv": [
            "id,name,value",
            "2,beta,200",
            "10,alpha,900",
            "1,alpha,100",
        ].join("\n"),
    };
}

/**
 * 存在しない列名を含むフィルター付きスキーマのファイルシステムを生成する。
 */
function createInvalidColumnFilterTestFileSystem(): MockFileSystem {
    return {
        "schema/item.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                { key: 2, name: "value", type: "int" },
            ],
            primary_key: ["id"],
            filters: {
                nonexistent_column: ["X"],
                name: ["alpha"],
            },
        }),
        "data/item.csv": [
            "id,name,value",
            "2,beta,200",
            "10,alpha,900",
            "1,alpha,100",
        ].join("\n"),
    };
}

/**
 * ソートとフィルターが両方事前設定済みのスキーマを持つファイルシステムを生成する。
 */
function createPreSortedAndFilteredTestFileSystem(): MockFileSystem {
    return {
        "schema/item.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                { key: 2, name: "value", type: "int" },
            ],
            primary_key: ["id"],
            sortKeys: [
                { columnName: "value", direction: "asc" },
            ],
            filters: {
                name: ["alpha"],
            },
        }),
        "data/item.csv": [
            "id,name,value",
            "2,beta,200",
            "10,alpha,900",
            "1,alpha,100",
        ].join("\n"),
    };
}

// =============================================================================
// テストユーティリティ
// =============================================================================

/**
 * テーブルを開いて左ペインの Locator を返す。
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
    const table = page.locator('.editor-left-pane .editor-table');
    await expect(table).toBeVisible();
    return table;
}

/**
 * テーブルのデータ行（バッファ空行を除く）の指定列のテキスト一覧を取得する。
 * colIndex: 0始まり（行ヘッダーを除く）
 */
async function getColumnValuesAsync(table: Locator, colIndex: number): Promise<string[]> {
    const dataRows = table.locator('.editor-table-row:not(.editor-table-empty-row)');
    const count = await dataRows.count();
    const values: string[] = [];
    for (let i = 1; i < count; i++) {
        const row = dataRows.nth(i);
        const cell = row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
        values.push(await cell.innerText());
    }
    return values;
}

/**
 * テーブルの表示行（バッファ空行・非表示行を除く）の指定列のテキスト一覧を取得する。
 * colIndex: 0始まり（行ヘッダーを除く）
 */
async function getVisibleColumnValuesAsync(table: Locator, colIndex: number): Promise<string[]> {
    const dataRows = table.locator('.editor-table-row:not(.editor-table-empty-row)');
    const count = await dataRows.count();
    const values: string[] = [];
    for (let i = 1; i < count; i++) {
        const row = dataRows.nth(i);
        const isVisible = await row.isVisible();
        if (!isVisible) continue;
        const cell = row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
        values.push(await cell.innerText());
    }
    return values;
}

/**
 * 指定した列ヘッダーのソートインジケーターをクリックする。
 * colIndex: 0始まり（行ヘッダー列を除く）
 */
async function clickSortIndicatorAsync(table: Locator, colIndex: number): Promise<void> {
    const headerRow = table.locator('.editor-table-column-header-row');
    const headerCell = headerRow.locator('.editor-table-column-header').nth(colIndex);
    const sortIndicator = headerCell.locator('.sort-indicator');
    await sortIndicator.click();
}

/**
 * 指定した列ヘッダーのフィルターアイコンをクリックしてドロップダウンを開く。
 * colIndex: 0始まり（行ヘッダー列を除く）
 */
async function clickFilterIconAsync(table: Locator, colIndex: number): Promise<void> {
    const headerRow = table.locator('.editor-table-column-header-row');
    const headerCell = headerRow.locator('.editor-table-column-header').nth(colIndex);
    const filterIcon = headerCell.locator('.filter-icon');
    await filterIcon.click();
}

/**
 * フィルタードロップダウン内の指定ラベルの項目のチェック状態を変更する。
 */
async function setFilterItemCheckedAsync(page: Page, label: string, checked: boolean): Promise<void> {
    const dropdown = page.locator('.filter-dropdown.visible');
    const item = dropdown.locator('.filter-item').filter({ hasText: label });
    const checkbox = item.locator('input[type="checkbox"]');
    const currentChecked = await checkbox.isChecked();
    if (currentChecked !== checked) {
        await checkbox.click();
    }
}

/**
 * フィルタードロップダウンの適用ボタンをクリックしてフィルターを適用する。
 */
async function applyFilterAsync(page: Page): Promise<void> {
    const dropdown = page.locator('.filter-dropdown.visible');
    await dropdown.locator('.filter-apply').click();
}

// =============================================================================
// テストケース
// =============================================================================

test.describe('ソート・フィルター永続化', () => {
    test.describe('ソートの永続化', () => {
        test.beforeEach(async ({ page }) => {
            const fs = createPersistenceTestFileSystem();
            await installMockApiAsync(page, fs);
            await page.goto('/');
        });

        test(
            'ソート適用後にスキーマに sortKeys が保存される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');

                // id列（colIndex=0）を昇順ソート
                await clickSortIndicatorAsync(table, 0);

                // saveSchemaDataAsync は fire-and-forget のため poll で待機する
                await expect.poll(async () => {
                    const text = await readMockFileAsync(page, 'schema/item.json');
                    const schema = JSON.parse(text);
                    return schema.sortKeys;
                }).toEqual([
                    { columnName: "id", direction: "asc" },
                ]);
            },
        );

        test(
            'ソート方向変更後にスキーマの sortKeys が更新される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');

                // 1回目: 昇順
                await clickSortIndicatorAsync(table, 0);
                // 2回目: 降順
                await clickSortIndicatorAsync(table, 0);

                await expect.poll(async () => {
                    const text = await readMockFileAsync(page, 'schema/item.json');
                    const schema = JSON.parse(text);
                    return schema.sortKeys;
                }).toEqual([
                    { columnName: "id", direction: "desc" },
                ]);
            },
        );

        test(
            'ソート解除後にスキーマから sortKeys が消える',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');

                // 昇順→降順→解除
                await clickSortIndicatorAsync(table, 0);
                await clickSortIndicatorAsync(table, 0);
                await clickSortIndicatorAsync(table, 0);

                // sortKeys フィールドが除去されていることを確認
                await expect.poll(async () => {
                    const text = await readMockFileAsync(page, 'schema/item.json');
                    const schema = JSON.parse(text);
                    return schema.sortKeys;
                }).toBeUndefined();
            },
        );

        test(
            '複数列ソートがスキーマに正しく保存される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');

                // name列（colIndex=1）を1番目に昇順ソート
                await clickSortIndicatorAsync(table, 1);
                // value列（colIndex=2）を2番目に昇順ソート
                await clickSortIndicatorAsync(table, 2);

                await expect.poll(async () => {
                    const text = await readMockFileAsync(page, 'schema/item.json');
                    const schema = JSON.parse(text);
                    return schema.sortKeys;
                }).toEqual([
                    { columnName: "name", direction: "asc" },
                    { columnName: "value", direction: "asc" },
                ]);
            },
        );
    });

    test.describe('ソートの復元', () => {
        test(
            'sortKeys がスキーマにあるテーブルを開くとソートが復元される',
            async ({ page }) => {
                const fs = createPreSortedTestFileSystem();
                await installMockApiAsync(page, fs);
                await page.goto('/');

                const table = await openTableAsync(page, 'item');

                // スキーマに id 昇順ソートが設定されているため、開いた時点で 1, 2, 10 の順になる
                const values = await getColumnValuesAsync(table, 0);
                expect(values).toEqual(['1', '2', '10']);
            },
        );

        test(
            'ソート復元後にソートインジケーターが正しく表示される',
            async ({ page }) => {
                const fs = createPreSortedTestFileSystem();
                await installMockApiAsync(page, fs);
                await page.goto('/');

                const table = await openTableAsync(page, 'item');

                // id列ヘッダーに sort-asc クラスが付与されている
                const headerRow = table.locator('.editor-table-column-header-row');
                const idHeader = headerRow.locator('.editor-table-column-header').first();
                await expect(idHeader).toHaveClass(/sort-asc/);
            },
        );

        test(
            '存在しない列名の sortKeys は無視され、有効な列のみソートが復元される',
            async ({ page }) => {
                const fs = createInvalidColumnSortTestFileSystem();
                await installMockApiAsync(page, fs);
                await page.goto('/');

                const table = await openTableAsync(page, 'item');

                // nonexistent_column は無視され、id 降順のみ適用される: 10, 2, 1
                const values = await getColumnValuesAsync(table, 0);
                expect(values).toEqual(['10', '2', '1']);
            },
        );
    });

    test.describe('フィルターの永続化', () => {
        test.beforeEach(async ({ page }) => {
            const fs = createPersistenceTestFileSystem();
            await installMockApiAsync(page, fs);
            await page.goto('/');
        });

        test(
            'フィルター適用後にスキーマに filters が保存される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');

                // name列（colIndex=1）のフィルターを開く
                await clickFilterIconAsync(table, 1);
                // "beta" のチェックを外す（"alpha" のみ残す）
                await setFilterItemCheckedAsync(page, 'beta', false);
                await applyFilterAsync(page);

                // saveSchemaDataAsync は fire-and-forget のため poll で待機する
                await expect.poll(async () => {
                    const text = await readMockFileAsync(page, 'schema/item.json');
                    const schema = JSON.parse(text);
                    return schema.filters;
                }).toEqual({
                    name: ["alpha"],
                });
            },
        );

        test(
            'フィルター解除後にスキーマから filters が消える',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');

                // フィルター適用
                await clickFilterIconAsync(table, 1);
                await setFilterItemCheckedAsync(page, 'beta', false);
                await applyFilterAsync(page);

                // 保存されたことを確認
                await expect.poll(async () => {
                    const text = await readMockFileAsync(page, 'schema/item.json');
                    return JSON.parse(text).filters;
                }).toEqual({ name: ["alpha"] });

                // フィルター解除（クリアボタン）
                await clickFilterIconAsync(table, 1);
                const dropdown = page.locator('.filter-dropdown.visible');
                await dropdown.locator('.filter-clear').click();

                // filters フィールドが除去されていることを確認
                await expect.poll(async () => {
                    const text = await readMockFileAsync(page, 'schema/item.json');
                    return JSON.parse(text).filters;
                }).toBeUndefined();
            },
        );
    });

    test.describe('フィルターの復元', () => {
        test(
            'filters がスキーマにあるテーブルを開くとフィルターが復元される',
            async ({ page }) => {
                const fs = createPreFilteredTestFileSystem();
                await installMockApiAsync(page, fs);
                await page.goto('/');

                const table = await openTableAsync(page, 'item');

                // スキーマに name=["alpha"] フィルターが設定されているため、alpha行のみ表示される
                const values = await getVisibleColumnValuesAsync(table, 1);
                expect(values).toEqual(['alpha', 'alpha']);
            },
        );

        test(
            'フィルター復元後にヘッダーに .filter-active クラスが付与される',
            async ({ page }) => {
                const fs = createPreFilteredTestFileSystem();
                await installMockApiAsync(page, fs);
                await page.goto('/');

                const table = await openTableAsync(page, 'item');

                // name列ヘッダーに filter-active クラスが付与されている
                const headerRow = table.locator('.editor-table-column-header-row');
                const nameHeader = headerRow.locator('.editor-table-column-header').nth(1);
                await expect(nameHeader).toHaveClass(/filter-active/);
            },
        );

        test(
            'フィルター復元後に行数カウンターが正しく表示される',
            async ({ page }) => {
                const fs = createPreFilteredTestFileSystem();
                await installMockApiAsync(page, fs);
                await page.goto('/');

                await openTableAsync(page, 'item');

                // 行数カウンターに「2 / 3 行」相当の表示が出る
                const rowCount = page.locator('.filter-row-count');
                await expect(rowCount).toBeVisible();
                await expect(rowCount).toContainText('2');
                await expect(rowCount).toContainText('3');
            },
        );

        test(
            '存在しない列名の filters は無視され、有効な列のみフィルターが復元される',
            async ({ page }) => {
                const fs = createInvalidColumnFilterTestFileSystem();
                await installMockApiAsync(page, fs);
                await page.goto('/');

                const table = await openTableAsync(page, 'item');

                // nonexistent_column は無視され、name=["alpha"] のフィルターのみ適用される
                const values = await getVisibleColumnValuesAsync(table, 1);
                expect(values).toEqual(['alpha', 'alpha']);
            },
        );
    });

    test.describe('ソートとフィルターの同時永続化', () => {
        test(
            'ソートとフィルターが同時にスキーマに保存される',
            async ({ page }) => {
                const fs = createPersistenceTestFileSystem();
                await installMockApiAsync(page, fs);
                await page.goto('/');

                const table = await openTableAsync(page, 'item');

                // ソート適用: id列を昇順
                await clickSortIndicatorAsync(table, 0);

                // フィルター適用: name列で "alpha" のみ
                await clickFilterIconAsync(table, 1);
                await setFilterItemCheckedAsync(page, 'beta', false);
                await applyFilterAsync(page);

                // 両方がスキーマに保存されていることを確認
                await expect.poll(async () => {
                    const text = await readMockFileAsync(page, 'schema/item.json');
                    const schema = JSON.parse(text);
                    return { sortKeys: schema.sortKeys, filters: schema.filters };
                }).toEqual({
                    sortKeys: [{ columnName: "id", direction: "asc" }],
                    filters: { name: ["alpha"] },
                });
            },
        );

        test(
            'ソートとフィルターが同時に復元される',
            async ({ page }) => {
                const fs = createPreSortedAndFilteredTestFileSystem();
                await installMockApiAsync(page, fs);
                await page.goto('/');

                const table = await openTableAsync(page, 'item');

                // ソート: value昇順、フィルター: name=["alpha"] のみ
                // alpha行は id=10(value=900) と id=1(value=100)
                // value昇順でフィルター適用なので: 100, 900 の順
                const values = await getVisibleColumnValuesAsync(table, 2);
                expect(values).toEqual(['100', '900']);

                // name列は alpha のみ
                const names = await getVisibleColumnValuesAsync(table, 1);
                expect(names).toEqual(['alpha', 'alpha']);
            },
        );
    });
});
