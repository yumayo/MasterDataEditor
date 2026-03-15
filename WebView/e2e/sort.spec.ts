import { test, expect } from '@playwright/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// ソート機能のテスト
//
// 機能概要:
//   列ヘッダーのソートインジケーター（.sort-indicator）をクリックすることで
//   テーブルの表示順をソートできる。
//   ソートはView変換のみ（storeRowIndicesの並び替え）でストア順序は変えない。
//   Undo/Redo対象外。バッファ行は末尾固定。ミニテーブルには適用しない。
//   複数列ソート対応（先にソートした列が高い優先度（先勝ちルール））。
//   サイクル: 昇順 → 降順 → 解除。
//
// テストケース一覧:
//   1. 列ヘッダーにソートボタンが表示される
//   2. ソートボタンクリックで昇順ソートされる
//   3. 昇順状態でクリックすると降順ソートになる
//   4. 降順状態でクリックするとソート解除される
//   5. ソート解除で元のデータ順序が完全に復元される
//   6. 数値列のソートが正しく動作する（文字列比較ではなく数値比較）
//   7. 複数列ソート: 先にソートした列が最高優先度になる（先勝ちルール）
//   8. ソート中の優先度番号表示
//   9. 先勝ちルール: 再クリックで優先度が変わらない
//  10. ソート優先度の繰り上がり（中間列解除で後続繰り上がり）
//  11. ミニテーブルにはソートボタンが表示されない
// =============================================================================

// =============================================================================
// フィクスチャ生成ヘルパー
// =============================================================================

/**
 * ソートテスト用のファイルシステムを生成する。
 *
 * テーブル構成:
 *   item: id（int）, name（string）, value（int）
 *
 * 初期データは意図的にバラバラな順序で格納する。
 * 数値ソートの確認のため id 列の値は 2, 10, 1 の順（文字列比較では "1", "10", "2" になる）。
 * 複数列ソートのため name 列に重複値を含む。
 */
function createSortTestFileSystem(): MockFileSystem {
    return {
        "schema/item.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                { key: 2, name: "value", type: "int" },
            ],
            primary_key: "id",
        }),
        // 意図的にバラバラな順序: id=2, id=10, id=1
        // name には重複あり（"alpha" が2行存在）
        "data/item.csv": [
            "id,name,value",
            "2,beta,200",
            "10,alpha,900",
            "1,alpha,100",
        ].join("\n"),
    };
}

/**
 * 複数列ソートテスト用のファイルシステムを生成する。
 *
 * テーブル構成:
 *   product: id（int）, category（string）, price（int）
 *
 * category に同一値が複数存在し、category ソート後に price でセカンダリソートが確認できる。
 */
function createMultiSortTestFileSystem(): MockFileSystem {
    return {
        "schema/product.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "category", type: "string" },
                { key: 2, name: "price", type: "int" },
            ],
            primary_key: "id",
        }),
        // category重複あり: A=3行（price: 300,100,200）, B=2行（price: 150,250）
        "data/product.csv": [
            "id,category,price",
            "1,A,300",
            "2,B,150",
            "3,A,100",
            "4,B,250",
            "5,A,200",
        ].join("\n"),
    };
}

/**
 * リレーションパネルのミニテーブルテスト用のファイルシステムを生成する。
 *
 * テーブル構成:
 *   enemy: id, ja（敵名テーブル）
 *   quest: id, name, enemy_id（クエスト。enemy.idをFKとして参照）
 *
 * quest の行を選択すると RelationsPanel に N:1 として enemy のミニテーブルが表示される。
 */
function createMiniTableSortTestFileSystem(): MockFileSystem {
    return {
        "schema/enemy.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "ja", type: "string" },
            ],
            primary_key: "id",
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
            primary_key: "id",
        }),
        "data/quest.csv": [
            "id,name,enemy_id",
            "1,first_quest,1",
            "2,second_quest,2",
        ].join("\n"),
    };
}

// =============================================================================
// テストユーティリティ
// =============================================================================

/**
 * テーブルを開いてLocatorを返す
 * RelationsPanelにもミニEditorTableが表示される可能性があるため左ペインに限定する
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
    const table = page.locator('.editor-left-pane .editor-table');
    await expect(table).toBeVisible();
    return table;
}

/**
 * 指定した行ヘッダーをクリックして行を選択する
 * rowIndex: 0始まり（ヘッダー行を除く）
 */
async function selectRowAsync(table: Locator, rowIndex: number): Promise<void> {
    const header = table.locator('.editor-table-row-header').nth(rowIndex);
    await header.click();
}

/**
 * テーブルのデータ行（バッファ空行を除く）の指定列のテキスト一覧を取得する
 * colIndex: 0始まり（行ヘッダーを除く）
 */
async function getColumnValuesAsync(table: Locator, colIndex: number): Promise<string[]> {
    // バッファ空行（editor-table-empty-row）を除くデータ行のみ対象
    const dataRows = table.locator('.editor-table-row:not(.editor-table-empty-row)');
    const count = await dataRows.count();
    const values: string[] = [];
    // nth(0) はヘッダー行（editor-table-column-header-row）なのでスキップ
    for (let i = 1; i < count; i++) {
        const row = dataRows.nth(i);
        const cell = row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
        values.push(await cell.innerText());
    }
    return values;
}

/**
 * 指定した列ヘッダーのソートインジケーターをクリックする
 * colIndex: 0始まり（行ヘッダー列を除く）
 */
async function clickSortIndicatorAsync(table: Locator, colIndex: number): Promise<void> {
    const headerRow = table.locator('.editor-table-column-header-row');
    // 0番目は行ヘッダー（角セル）なので colIndex+1 番目が対象列
    const headerCell = headerRow.locator('.editor-table-column-header').nth(colIndex);
    const sortIndicator = headerCell.locator('.sort-indicator');
    await sortIndicator.click();
}

/**
 * リレーションパネルのコンテンツが表示されるまで待機する
 */
async function waitForRelationsPanelContentAsync(page: Page): Promise<void> {
    const content = page.locator('.relations-panel-content');
    await expect(content).toBeVisible();
}

// =============================================================================
// テストケース
// =============================================================================

test.describe('ソート機能', () => {
    test.describe('基本的なソート動作', () => {
        test.beforeEach(async ({ page }) => {
            const fs = createSortTestFileSystem();
            await installMockApiAsync(page, fs);
            await page.goto('/');
        });

        test(
            '列ヘッダーにソートインジケーターが表示される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');

                // 各列ヘッダーに .sort-indicator 要素が存在する
                const headerRow = table.locator('.editor-table-column-header-row');
                const headerCells = headerRow.locator('.editor-table-column-header');
                const count = await headerCells.count();
                expect(count).toBeGreaterThan(0);

                // 各列ヘッダーに .sort-indicator が存在する
                for (let i = 0; i < count; i++) {
                    const headerCell = headerCells.nth(i);
                    const sortIndicator = headerCell.locator('.sort-indicator');
                    await expect(sortIndicator).toBeAttached();
                }
            },
        );

        test(
            'ソートインジケーターに昇順・降順のアイコンが含まれる',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');

                // 最初のデータ列ヘッダー（id列）を検査
                const headerRow = table.locator('.editor-table-column-header-row');
                const headerCell = headerRow.locator('.editor-table-column-header').first();
                const sortIndicator = headerCell.locator('.sort-indicator');
                await expect(sortIndicator).toBeAttached();

                // ▲（昇順）と▼（降順）のアイコン要素が含まれていること
                const ascIcon = sortIndicator.locator('.sort-icon-asc');
                const descIcon = sortIndicator.locator('.sort-icon-desc');
                await expect(ascIcon).toBeAttached();
                await expect(descIcon).toBeAttached();
            },
        );

        test(
            'ソートインジケータークリックで昇順ソートされる',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');

                // クリック前: id列は 2, 10, 1 の順
                const before = await getColumnValuesAsync(table, 0);
                expect(before).toEqual(['2', '10', '1']);

                // id列ヘッダーのソートインジケーターをクリック（1回目: 昇順）
                await clickSortIndicatorAsync(table, 0);

                // 昇順ソート後: 1, 2, 10 の順
                const after = await getColumnValuesAsync(table, 0);
                expect(after).toEqual(['1', '2', '10']);
            },
        );

        test(
            'ソートインジケーターに昇順アクティブクラスが付与される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');

                // id列ヘッダーのソートインジケーターをクリック（1回目: 昇順）
                await clickSortIndicatorAsync(table, 0);

                // ヘッダーセルまたはインジケーターに .sort-asc クラスが付く
                const headerRow = table.locator('.editor-table-column-header-row');
                const headerCell = headerRow.locator('.editor-table-column-header').first();
                await expect(headerCell).toHaveClass(/sort-asc/);
            },
        );

        test(
            '昇順状態で再クリックすると降順ソートになる',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');

                // 1回目クリック: 昇順
                await clickSortIndicatorAsync(table, 0);
                const afterAsc = await getColumnValuesAsync(table, 0);
                expect(afterAsc).toEqual(['1', '2', '10']);

                // 2回目クリック: 降順
                await clickSortIndicatorAsync(table, 0);
                const afterDesc = await getColumnValuesAsync(table, 0);
                expect(afterDesc).toEqual(['10', '2', '1']);
            },
        );

        test(
            '降順状態でソートインジケーターに降順アクティブクラスが付与される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');

                // 1回目: 昇順
                await clickSortIndicatorAsync(table, 0);
                // 2回目: 降順
                await clickSortIndicatorAsync(table, 0);

                // ヘッダーセルに .sort-desc クラスが付く
                const headerRow = table.locator('.editor-table-column-header-row');
                const headerCell = headerRow.locator('.editor-table-column-header').first();
                await expect(headerCell).toHaveClass(/sort-desc/);
            },
        );

        test(
            '降順状態で再クリックするとソートが解除される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');

                // 1回目: 昇順
                await clickSortIndicatorAsync(table, 0);
                // 2回目: 降順
                await clickSortIndicatorAsync(table, 0);
                // 3回目: 解除
                await clickSortIndicatorAsync(table, 0);

                // 元の順序に戻る: 2, 10, 1
                const afterClear = await getColumnValuesAsync(table, 0);
                expect(afterClear).toEqual(['2', '10', '1']);
            },
        );

        test(
            'ソート解除後にアクティブクラスが外れる',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');

                // 1回目: 昇順
                await clickSortIndicatorAsync(table, 0);
                // 2回目: 降順
                await clickSortIndicatorAsync(table, 0);
                // 3回目: 解除
                await clickSortIndicatorAsync(table, 0);

                // .sort-asc / .sort-desc クラスが外れていること
                const headerRow = table.locator('.editor-table-column-header-row');
                const headerCell = headerRow.locator('.editor-table-column-header').first();
                await expect(headerCell).not.toHaveClass(/sort-asc/);
                await expect(headerCell).not.toHaveClass(/sort-desc/);
            },
        );

        test(
            'ソート解除でバラバラな初期順序が完全に復元される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');

                // 元の順序確認: 2, 10, 1
                const original = await getColumnValuesAsync(table, 0);
                expect(original).toEqual(['2', '10', '1']);

                // 昇順 → 降順 → 解除
                await clickSortIndicatorAsync(table, 0);
                await clickSortIndicatorAsync(table, 0);
                await clickSortIndicatorAsync(table, 0);

                // 元の順序に完全復元: 2, 10, 1
                const restored = await getColumnValuesAsync(table, 0);
                expect(restored).toEqual(['2', '10', '1']);
            },
        );

        test(
            '数値列のソートが数値比較で正しく動作する',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');

                // 昇順クリック: 数値として 1, 2, 10 の順（文字列比較なら 1, 10, 2 になる）
                await clickSortIndicatorAsync(table, 0);
                const ascValues = await getColumnValuesAsync(table, 0);
                expect(ascValues).toEqual(['1', '2', '10']);

                // 降順: 10, 2, 1
                await clickSortIndicatorAsync(table, 0);
                const descValues = await getColumnValuesAsync(table, 0);
                expect(descValues).toEqual(['10', '2', '1']);
            },
        );
    });

    test.describe('複数列ソート', () => {
        test.beforeEach(async ({ page }) => {
            const fs = createMultiSortTestFileSystem();
            await installMockApiAsync(page, fs);
            await page.goto('/');
        });

        test(
            '最初にソートした列が最高優先度になる（先勝ちルール）',
            async ({ page }) => {
                const table = await openTableAsync(page, 'product');

                // category列（colIndex=1）を先にソート → category が1番目の優先度
                await clickSortIndicatorAsync(table, 1);
                // price列（colIndex=2）を後にソート → price が2番目の優先度
                await clickSortIndicatorAsync(table, 2);

                // category列（1番目優先）昇順ソート: A,A,A,B,B の順
                // 同じcategory内はprice昇順（2番目優先）: A→100,200,300 / B→150,250
                // id列の値: (A,100)→id=3, (A,200)→id=5, (A,300)→id=1, (B,150)→id=2, (B,250)→id=4
                const categories = await getColumnValuesAsync(table, 1);
                expect(categories).toEqual(['A', 'A', 'A', 'B', 'B']);

                const prices = await getColumnValuesAsync(table, 2);
                expect(prices).toEqual(['100', '200', '300', '150', '250']);
            },
        );

        test(
            '複数列ソート時に優先度番号が表示される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'product');

                // price列（colIndex=2）を1番目にソート
                await clickSortIndicatorAsync(table, 2);
                // category列（colIndex=1）を2番目にソート
                await clickSortIndicatorAsync(table, 1);

                const headerRow = table.locator('.editor-table-column-header-row');

                // price列ヘッダーに優先度番号 "1" が表示される（先にソートしたので1番目の優先度）
                const priceHeader = headerRow.locator('.editor-table-column-header').nth(2);
                const priceIndicator = priceHeader.locator('.sort-indicator');
                await expect(priceIndicator).toContainText('1');

                // category列ヘッダーに優先度番号 "2" が表示される（後にソートしたので2番目の優先度）
                const categoryHeader = headerRow.locator('.editor-table-column-header').nth(1);
                const categoryIndicator = categoryHeader.locator('.sort-indicator');
                await expect(categoryIndicator).toContainText('2');
            },
        );

        test(
            '先勝ちルール: 再クリックで優先度が変わらない',
            async ({ page }) => {
                const table = await openTableAsync(page, 'product');

                // price列（colIndex=2）を1番目にソート → price が最高優先度
                await clickSortIndicatorAsync(table, 2);
                // category列（colIndex=1）を2番目にソート → category が2番目の優先度
                await clickSortIndicatorAsync(table, 1);

                // price を再クリック（昇順→降順）→ 優先度は変わらず price が1番目
                await clickSortIndicatorAsync(table, 2);

                const headerRow = table.locator('.editor-table-column-header-row');

                // price列は再クリック後も優先度番号 "1" のまま変わらない
                const priceHeader = headerRow.locator('.editor-table-column-header').nth(2);
                const priceIndicator = priceHeader.locator('.sort-indicator');
                await expect(priceIndicator).toContainText('1');

                // category列は依然として優先度番号 "2"
                const categoryHeader = headerRow.locator('.editor-table-column-header').nth(1);
                const categoryIndicator = categoryHeader.locator('.sort-indicator');
                await expect(categoryIndicator).toContainText('2');
            },
        );

        test(
            '中間列のソートを解除すると後続列の優先度が繰り上がる',
            async ({ page }) => {
                const table = await openTableAsync(page, 'product');

                // id列（colIndex=0）を1番目、category列（colIndex=1）を2番目、price列（colIndex=2）を3番目にソート
                await clickSortIndicatorAsync(table, 0);
                await clickSortIndicatorAsync(table, 1);
                await clickSortIndicatorAsync(table, 2);

                // category列（2番目優先度）のソートを解除（先勝ちルールでは位置移動なし: 2回クリック: 昇順→降順→解除）
                await clickSortIndicatorAsync(table, 1);
                await clickSortIndicatorAsync(table, 1);

                const headerRow = table.locator('.editor-table-column-header-row');

                // id列が1番目の優先度（変わらず）
                const idHeader = headerRow.locator('.editor-table-column-header').nth(0);
                const idIndicator = idHeader.locator('.sort-indicator');
                await expect(idIndicator).toContainText('1');

                // price列が2番目に繰り上がる（元は3番目）
                const priceHeader = headerRow.locator('.editor-table-column-header').nth(2);
                const priceIndicator = priceHeader.locator('.sort-indicator');
                await expect(priceIndicator).toContainText('2');

                // category列のインジケーターはアクティブでない（解除済み）
                const categoryHeader = headerRow.locator('.editor-table-column-header').nth(1);
                await expect(categoryHeader).not.toHaveClass(/sort-asc/);
                await expect(categoryHeader).not.toHaveClass(/sort-desc/);
            },
        );
    });

    test.describe('ミニテーブルへの非適用', () => {
        test.beforeEach(async ({ page }) => {
            const fs = createMiniTableSortTestFileSystem();
            await installMockApiAsync(page, fs);
            await page.goto('/');
        });

        test(
            'ミニテーブルの列ヘッダーにはソートインジケーターが表示されない',
            async ({ page }) => {
                // quest テーブルを開いて0行目を選択 → RelationsPanel に enemy ミニテーブル表示
                const mainTable = await openTableAsync(page, 'quest');
                await selectRowAsync(mainTable, 0);
                await waitForRelationsPanelContentAsync(page);

                const miniTable = page.locator('.relations-panel .editor-table').first();
                await expect(miniTable).toBeVisible();

                // ミニテーブルのデータセルが構築されるまで待機
                const dataCells = miniTable.locator('.editor-table-cell:not(.editor-table-row-header):not(.editor-table-column-header)');
                await expect(dataCells.first()).toBeVisible();

                // ミニテーブルの列ヘッダーには .sort-indicator が存在しないこと
                const miniHeaderRow = miniTable.locator('.editor-table-column-header-row');
                await expect(miniHeaderRow).toBeVisible();
                const miniHeaderCells = miniHeaderRow.locator('.editor-table-column-header');
                const miniHeaderCount = await miniHeaderCells.count();
                expect(miniHeaderCount).toBeGreaterThan(0);

                for (let i = 0; i < miniHeaderCount; i++) {
                    const headerCell = miniHeaderCells.nth(i);
                    const sortIndicator = headerCell.locator('.sort-indicator');
                    // ミニテーブルにはソートインジケーターがないこと
                    await expect(sortIndicator).not.toBeAttached();
                }
            },
        );
    });
});
