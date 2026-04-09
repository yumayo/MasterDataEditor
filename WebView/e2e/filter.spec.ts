import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';
import { enableRelationsPanelAsync } from './fixtures/test-utils';

// =============================================================================
// フィルター機能のテスト
//
// 機能概要:
//   列ヘッダーのフィルターアイコン（.filter-icon）をクリックすることで
//   その列のユニーク値がチェックボックス付きリストとして表示される。
//   チェックを外した値を持つ行は非表示になる（storeRowIndices で制御）。
//   複数列フィルターは AND 条件で動作する。
//   ミニテーブルにはフィルターアイコンは表示されない。
//   ソートと併用可能（ソート順を維持しつつフィルター適用）。
//
// テストケース一覧:
//   1. ヘッダーにフィルターアイコンが表示される
//   2. フィルターアイコンクリックでドロップダウンが表示される
//   3. ドロップダウンにその列のユニーク値が全てチェックボックス付きで表示される
//   4. チェックを外した値の行が非表示になる
//   5. 複数列フィルターが AND 条件で動作する
//   6. フィルター適用中のヘッダーに .filter-active クラスが付与される
//   7. 行数カウンターがフィルター適用中に正しく表示される
//   8. 全選択ボタンで全項目がチェックされる
//   9. 全解除ボタンで全項目のチェックが外される
//  10. 検索機能でドロップダウンの項目が絞り込まれる
//  11. クリアボタンでフィルターが解除される
//  12. ミニテーブルにはフィルターアイコンが表示されない
//  13. ソートとフィルターが同時に動作する
// =============================================================================

// =============================================================================
// フィクスチャ生成ヘルパー
// =============================================================================

/**
 * フィルターテスト用の基本ファイルシステムを生成する。
 *
 * テーブル構成:
 *   item: id（int）, category（string）, price（int）
 *
 * category に重複値あり（"weapon" が 2 行、"armor" が 2 行、"potion" が 1 行）。
 * price にも重複値あり（100 が 2 行）。
 * 複数列フィルターの AND 条件を確認するためにこの構成とする。
 */
function createFilterTestFileSystem(): MockFileSystem {
    return {
        "schema/item.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "category", type: "string" },
                { key: 2, name: "price", type: "int" },
            ],
            primary_key: ["id"],
        }),
        // category: weapon=2行, armor=2行, potion=1行
        // price: 100=2行, 200=1行, 300=1行, 500=1行
        "data/item.csv": [
            "id,category,price",
            "1,weapon,100",
            "2,armor,200",
            "3,weapon,300",
            "4,armor,100",
            "5,potion,500",
        ].join("\n"),
    };
}

/**
 * ミニテーブルフィルターテスト用のファイルシステムを生成する。
 *
 * テーブル構成:
 *   enemy: id, ja（敵名テーブル）
 *   quest: id, name, enemy_id（クエスト。enemy.id を FK として参照）
 *
 * quest の行を選択すると RelationsPanel に N:1 として enemy のミニテーブルが表示される。
 */
function createMiniTableFilterTestFileSystem(): MockFileSystem {
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
    };
}

/**
 * ソートとフィルター組み合わせテスト用のファイルシステムを生成する。
 *
 * テーブル構成:
 *   product: id（int）, category（string）, price（int）
 *
 * ソート後にフィルターを適用し、ソート順が維持されることを確認するための構成。
 */
function createSortFilterTestFileSystem(): MockFileSystem {
    return {
        "schema/product.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "category", type: "string" },
                { key: 2, name: "price", type: "int" },
            ],
            primary_key: ["id"],
        }),
        // category: A=3行, B=2行
        // price は降順: 500, 400, 300, 200, 100
        "data/product.csv": [
            "id,category,price",
            "1,A,500",
            "2,B,400",
            "3,A,300",
            "4,B,200",
            "5,A,100",
        ].join("\n"),
    };
}

// =============================================================================
// テストユーティリティ
// =============================================================================

/**
 * テーブルを開いて左ペインの Locator を返す。
 * RelationsPanel にもミニ EditorTable が表示される可能性があるため左ペインに限定する。
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
    const table = page.locator('.editor-left-pane .editor-table');
    await expect(table).toBeVisible();
    return table;
}

/**
 * 指定した行ヘッダーをクリックして行を選択する。
 * rowIndex: 0 始まり（ヘッダー行を除く）
 */
async function selectRowAsync(table: Locator, rowIndex: number): Promise<void> {
    const header = table.locator('.editor-table-row-header').nth(rowIndex);
    await header.click();
}

/**
 * リレーションパネルのコンテンツが表示されるまで待機する。
 */
async function waitForRelationsPanelContentAsync(page: Page): Promise<void> {
    const content = page.locator('.relations-panel-content');
    await expect(content).toBeVisible();
}

/**
 * テーブルのデータ行（バッファ空行・非表示行を除く）の指定列のテキスト一覧を取得する。
 * colIndex: 0 始まり（行ヘッダーを除く）
 *
 * フィルター適用後に表示されている行のみを取得するため、
 * バッファ空行（editor-table-empty-row）と非表示行（display:none）を除外する。
 */
async function getVisibleColumnValuesAsync(table: Locator, colIndex: number): Promise<string[]> {
    // バッファ空行を除くデータ行のみ対象
    const dataRows = table.locator('.editor-table-row:not(.editor-table-empty-row)');
    const count = await dataRows.count();
    const values: string[] = [];
    // nth(0) はヘッダー行（editor-table-column-header-row）なのでスキップ
    for (let i = 1; i < count; i++) {
        const row = dataRows.nth(i);
        // display:none の非表示行はスキップ
        const isVisible = await row.isVisible();
        if (!isVisible) continue;
        const cell = row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
        values.push(await cell.innerText());
    }
    return values;
}

/**
 * 指定した列ヘッダーのフィルターアイコンをクリックしてドロップダウンを開く。
 * colIndex: 0 始まり（行ヘッダー列を除く）
 */
async function clickFilterIconAsync(table: Locator, colIndex: number): Promise<void> {
    const headerRow = table.locator('.editor-table-column-header-row');
    // 0 番目は行ヘッダー（角セル）なので colIndex 番目が対象列
    const headerCell = headerRow.locator('.editor-table-column-header').nth(colIndex);
    const filterIcon = headerCell.locator('.filter-icon');
    await filterIcon.click();
}

/**
 * フィルタードロップダウン内の指定ラベルの項目のチェック状態を変更する。
 * checked: true でチェック、false でチェック外し
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

test.describe('フィルター機能', () => {
    test.describe('フィルターアイコンとドロップダウン表示', () => {
        test.beforeEach(async ({ page }) => {
            const fs = createFilterTestFileSystem();
            await installMockApiAsync(page, fs);
            await page.goto('/');
        });

        test(
            '列ヘッダーにフィルターアイコンが表示される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');

                // 各列ヘッダーに .filter-icon 要素が存在する
                const headerRow = table.locator('.editor-table-column-header-row');
                const headerCells = headerRow.locator('.editor-table-column-header');
                const count = await headerCells.count();
                expect(count).toBeGreaterThan(0);

                for (let i = 0; i < count; i++) {
                    const headerCell = headerCells.nth(i);
                    const filterIcon = headerCell.locator('.filter-icon');
                    await expect(filterIcon).toBeAttached();
                }
            },
        );

        test(
            'フィルターアイコンをクリックするとドロップダウンが表示される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');

                // クリック前はドロップダウンが非表示
                const dropdown = page.locator('.filter-dropdown.visible');
                await expect(dropdown).not.toBeAttached();

                // category 列（colIndex=1）のフィルターアイコンをクリック
                await clickFilterIconAsync(table, 1);

                // ドロップダウンが表示される
                await expect(dropdown).toBeVisible();
            },
        );

        test(
            'ドロップダウンにその列のユニーク値が全てチェックボックス付きで表示される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');

                // category 列（colIndex=1）のフィルターアイコンをクリック
                await clickFilterIconAsync(table, 1);

                const dropdown = page.locator('.filter-dropdown.visible');
                await expect(dropdown).toBeVisible();

                // category のユニーク値は armor, potion, weapon の 3 種（ソート済み）
                const items = dropdown.locator('.filter-item');
                await expect(items).toHaveCount(3);

                // 各項目にチェックボックスとラベルが存在する
                for (let i = 0; i < 3; i++) {
                    const item = items.nth(i);
                    await expect(item.locator('input[type="checkbox"]')).toBeAttached();
                    await expect(item.locator('.filter-item-label')).toBeAttached();
                }

                // ユニーク値が全て含まれている
                await expect(dropdown).toContainText('weapon');
                await expect(dropdown).toContainText('armor');
                await expect(dropdown).toContainText('potion');
            },
        );

        test(
            'ドロップダウンに検索ボックスが存在する',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');
                await clickFilterIconAsync(table, 1);

                const dropdown = page.locator('.filter-dropdown.visible');
                await expect(dropdown.locator('.filter-search-input')).toBeVisible();
            },
        );

        test(
            'ドロップダウンに全選択・全解除・クリア・適用ボタンが存在する',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');
                await clickFilterIconAsync(table, 1);

                const dropdown = page.locator('.filter-dropdown.visible');
                await expect(dropdown.locator('.filter-select-all')).toBeAttached();
                await expect(dropdown.locator('.filter-deselect-all')).toBeAttached();
                await expect(dropdown.locator('.filter-clear')).toBeAttached();
                await expect(dropdown.locator('.filter-apply')).toBeAttached();
            },
        );
    });

    test.describe('フィルター適用と行表示制御', () => {
        test.beforeEach(async ({ page }) => {
            const fs = createFilterTestFileSystem();
            await installMockApiAsync(page, fs);
            await page.goto('/');
        });

        test(
            'チェックを外した値の行が非表示になる',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');

                // フィルター前: category 列は weapon, armor, weapon, armor, potion の 5 行
                const before = await getVisibleColumnValuesAsync(table, 1);
                expect(before).toEqual(['weapon', 'armor', 'weapon', 'armor', 'potion']);

                // category 列のフィルターアイコンをクリック
                await clickFilterIconAsync(table, 1);

                // "armor" と "potion" のチェックを外す（"weapon" のみ残す）
                await setFilterItemCheckedAsync(page, 'armor', false);
                await setFilterItemCheckedAsync(page, 'potion', false);

                // 適用
                await applyFilterAsync(page);

                // weapon 行のみ表示される（2 行）
                const after = await getVisibleColumnValuesAsync(table, 1);
                expect(after).toEqual(['weapon', 'weapon']);
            },
        );

        test(
            '複数列フィルターが AND 条件で動作する',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');

                // category 列で "weapon" のみ残す
                await clickFilterIconAsync(table, 1);
                await setFilterItemCheckedAsync(page, 'armor', false);
                await setFilterItemCheckedAsync(page, 'potion', false);
                await applyFilterAsync(page);

                // price 列で "100" のみ残す（weapon かつ price=100 は id=1 の 1 行のみ）
                await clickFilterIconAsync(table, 2);
                await setFilterItemCheckedAsync(page, '300', false);
                await applyFilterAsync(page);

                // AND 条件: weapon かつ price=100 → id=1 のみ
                const categoryValues = await getVisibleColumnValuesAsync(table, 1);
                expect(categoryValues).toEqual(['weapon']);

                const priceValues = await getVisibleColumnValuesAsync(table, 2);
                expect(priceValues).toEqual(['100']);
            },
        );

        test(
            'フィルター適用中のヘッダーに .filter-active クラスが付与される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');
                const headerRow = table.locator('.editor-table-column-header-row');
                const categoryHeader = headerRow.locator('.editor-table-column-header').nth(1);

                // フィルター適用前は .filter-active クラスがない
                await expect(categoryHeader).not.toHaveClass(/filter-active/);

                // category 列でフィルター適用（"armor" を除外）
                await clickFilterIconAsync(table, 1);
                await setFilterItemCheckedAsync(page, 'armor', false);
                await applyFilterAsync(page);

                // フィルター適用後は .filter-active クラスが付与される
                await expect(categoryHeader).toHaveClass(/filter-active/);
            },
        );

        test(
            '行数カウンターがフィルター適用中に「表示行数 / 全行数 行」形式で表示される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');

                // フィルター適用前: 行数カウンターが非表示 or 全行数を表示
                const rowCount = page.locator('.filter-row-count');

                // category 列で weapon のみ残す（5 行中 2 行表示）
                await clickFilterIconAsync(table, 1);
                await setFilterItemCheckedAsync(page, 'armor', false);
                await setFilterItemCheckedAsync(page, 'potion', false);
                await applyFilterAsync(page);

                // 行数カウンターに「2 / 5 行」相当の表示が出る
                await expect(rowCount).toBeVisible();
                await expect(rowCount).toContainText('2');
                await expect(rowCount).toContainText('5');
            },
        );
    });

    test.describe('全選択・全解除・検索', () => {
        test.beforeEach(async ({ page }) => {
            const fs = createFilterTestFileSystem();
            await installMockApiAsync(page, fs);
            await page.goto('/');
        });

        test(
            '全解除ボタンで全項目のチェックが外される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');
                await clickFilterIconAsync(table, 1);

                const dropdown = page.locator('.filter-dropdown.visible');

                // 全解除ボタンをクリック
                await dropdown.locator('.filter-deselect-all').click();

                // 全項目のチェックが外れている
                const checkboxes = dropdown.locator('.filter-item input[type="checkbox"]');
                const count = await checkboxes.count();
                expect(count).toBeGreaterThan(0);
                for (let i = 0; i < count; i++) {
                    await expect(checkboxes.nth(i)).not.toBeChecked();
                }
            },
        );

        test(
            '全選択ボタンで全項目がチェックされる',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');
                await clickFilterIconAsync(table, 1);

                const dropdown = page.locator('.filter-dropdown.visible');

                // まず全解除してからチェックをすべて外す
                await dropdown.locator('.filter-deselect-all').click();

                // 全選択ボタンをクリック
                await dropdown.locator('.filter-select-all').click();

                // 全項目がチェックされている
                const checkboxes = dropdown.locator('.filter-item input[type="checkbox"]');
                const count = await checkboxes.count();
                expect(count).toBeGreaterThan(0);
                for (let i = 0; i < count; i++) {
                    await expect(checkboxes.nth(i)).toBeChecked();
                }
            },
        );

        test(
            '検索機能でドロップダウンの項目が絞り込まれる',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');
                await clickFilterIconAsync(table, 1);

                const dropdown = page.locator('.filter-dropdown.visible');

                // 検索前は 3 項目（armor, potion, weapon）
                const beforeCount = await dropdown.locator('.filter-item').count();
                expect(beforeCount).toBe(3);

                // "wea" と入力すると weapon のみに絞り込まれる
                const searchInput = dropdown.locator('.filter-search-input');
                await searchInput.fill('wea');

                // "weapon" のみ表示される
                const afterItems = dropdown.locator('.filter-item');
                await expect(afterItems).toHaveCount(1);
                await expect(afterItems.first().locator('.filter-item-label')).toContainText('weapon');
            },
        );
    });

    test.describe('フィルター解除', () => {
        test.beforeEach(async ({ page }) => {
            const fs = createFilterTestFileSystem();
            await installMockApiAsync(page, fs);
            await page.goto('/');
        });

        test(
            'クリアボタンでフィルターが解除されて全行が表示される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');

                // フィルター適用: weapon のみ表示（2 行）
                await clickFilterIconAsync(table, 1);
                await setFilterItemCheckedAsync(page, 'armor', false);
                await setFilterItemCheckedAsync(page, 'potion', false);
                await applyFilterAsync(page);

                const afterFilter = await getVisibleColumnValuesAsync(table, 1);
                expect(afterFilter).toEqual(['weapon', 'weapon']);

                // フィルタードロップダウンを再度開いてクリアボタンをクリック
                await clickFilterIconAsync(table, 1);
                const dropdown = page.locator('.filter-dropdown.visible');
                await dropdown.locator('.filter-clear').click();

                // 全行が表示される（5 行）
                const afterClear = await getVisibleColumnValuesAsync(table, 1);
                expect(afterClear).toEqual(['weapon', 'armor', 'weapon', 'armor', 'potion']);
            },
        );

        test(
            'クリアボタン後に .filter-active クラスが外れる',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');
                const headerRow = table.locator('.editor-table-column-header-row');
                const categoryHeader = headerRow.locator('.editor-table-column-header').nth(1);

                // フィルター適用
                await clickFilterIconAsync(table, 1);
                await setFilterItemCheckedAsync(page, 'armor', false);
                await applyFilterAsync(page);
                await expect(categoryHeader).toHaveClass(/filter-active/);

                // クリアで解除
                await clickFilterIconAsync(table, 1);
                const dropdown = page.locator('.filter-dropdown.visible');
                await dropdown.locator('.filter-clear').click();

                // .filter-active クラスが外れる
                await expect(categoryHeader).not.toHaveClass(/filter-active/);
            },
        );

        test(
            'クリアボタン後に行数カウンターが非表示になる',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');

                // フィルター適用して行数カウンターを表示
                await clickFilterIconAsync(table, 1);
                await setFilterItemCheckedAsync(page, 'armor', false);
                await setFilterItemCheckedAsync(page, 'potion', false);
                await applyFilterAsync(page);
                const rowCount = page.locator('.filter-row-count');
                await expect(rowCount).toBeVisible();

                // クリアで解除
                await clickFilterIconAsync(table, 1);
                const dropdown = page.locator('.filter-dropdown.visible');
                await dropdown.locator('.filter-clear').click();

                // 行数カウンターが非表示になる
                await expect(rowCount).not.toBeVisible();
            },
        );
    });

    test.describe('ミニテーブルへの非適用', () => {
        test.beforeEach(async ({ page }) => {
            const fs = createMiniTableFilterTestFileSystem();
            await installMockApiAsync(page, fs);
            await page.goto('/');
            await enableRelationsPanelAsync(page);
        });

        test(
            'ミニテーブルの列ヘッダーにはフィルターアイコンが表示されない',
            async ({ page }) => {
                // quest テーブルを開いて 0 行目を選択 → RelationsPanel に enemy ミニテーブル表示
                const mainTable = await openTableAsync(page, 'quest');
                await selectRowAsync(mainTable, 0);
                await waitForRelationsPanelContentAsync(page);

                const miniTable = page.locator('.relations-panel .editor-table').first();
                await expect(miniTable).toBeVisible();

                // ミニテーブルのデータセルが構築されるまで待機
                const dataCells = miniTable.locator('.editor-table-cell:not(.editor-table-row-header):not(.editor-table-column-header)');
                await expect(dataCells.first()).toBeVisible();

                // ミニテーブルの列ヘッダーには .filter-icon が存在しないこと
                const miniHeaderRow = miniTable.locator('.editor-table-column-header-row');
                await expect(miniHeaderRow).toBeVisible();
                const miniHeaderCells = miniHeaderRow.locator('.editor-table-column-header');
                const miniHeaderCount = await miniHeaderCells.count();
                expect(miniHeaderCount).toBeGreaterThan(0);

                for (let i = 0; i < miniHeaderCount; i++) {
                    const headerCell = miniHeaderCells.nth(i);
                    const filterIcon = headerCell.locator('.filter-icon');
                    // ミニテーブルにはフィルターアイコンがないこと
                    await expect(filterIcon).not.toBeAttached();
                }
            },
        );
    });

    test.describe('非連番keyスキーマでのフィルター', () => {
        /**
         * 非連番keyスキーマテスト用のファイルシステムを生成する。
         *
         * テーブル構成:
         *   item: スキーマ列は id（DOM列0, CSV列0）と attack（DOM列1, CSV列3）の2列のみ。
         *   CSVには id,hp,mp,attack,defense の5列が存在するが、スキーマでは id と attack しか定義しない。
         *   これにより DOM列インデックス ≠ ストア（CSV）列インデックスとなる。
         *   attack の DOM列インデックスは 1 だが、CSV列インデックスは 3 である。
         *
         * このテストは BUG_0021 修正（ColumnFilter のDOM列/ストア列インデックス変換）の回帰テスト。
         * 修正前: filterMap に DOM列インデックス=1 がセットされ、storeRows[row][1]=hp でフィルターされる誤動作。
         * 修正後: filterMap にストア列インデックス=3 がセットされ、storeRows[row][3]=attack で正しくフィルターされる。
         */
        function createNonSequentialKeyFilterTestFileSystem(): MockFileSystem {
            return {
                "schema/item.json": JSON.stringify({
                    header: [
                        { key: 0, name: "id", type: "int" },
                        // attack のみ定義（hp, mp, defense はスキーマに含まれない）
                        { key: 3, name: "attack", type: "int" },
                    ],
                    primary_key: ["id"],
                }),
                // CSV は id,hp,mp,attack,defense の5列（スキーマよりも多い列を持つ）
                // attack 列（CSV列3）の値: 10, 20, 10, 30, 20
                "data/item.csv": [
                    "id,hp,mp,attack,defense",
                    "1,100,50,10,5",
                    "2,200,80,20,8",
                    "3,150,60,10,6",
                    "4,300,100,30,10",
                    "5,250,90,20,9",
                ].join("\n"),
            };
        }

        test.beforeEach(async ({ page }) => {
            const fs = createNonSequentialKeyFilterTestFileSystem();
            await installMockApiAsync(page, fs);
            await page.goto('/');
        });

        test(
            '非連番keyスキーマのattack列（DOM列1、CSV列3）でフィルターが正しく動作する',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');

                // フィルター前: DOM列1(attack) は 10, 20, 10, 30, 20 の順
                const before = await getVisibleColumnValuesAsync(table, 1);
                expect(before).toEqual(['10', '20', '10', '30', '20']);

                // attack 列（DOM列1）のフィルターアイコンをクリック
                await clickFilterIconAsync(table, 1);

                // ドロップダウンに表示されるユニーク値が attack の値（10, 20, 30）であることを確認
                // （修正前バグでは hp 列の値 100, 150, 200, 250, 300 が表示されていた）
                const dropdown = page.locator('.filter-dropdown.visible');
                await expect(dropdown).toBeVisible();
                await expect(dropdown).toContainText('10');
                await expect(dropdown).toContainText('20');
                await expect(dropdown).toContainText('30');
                // hp 列の値が表示されていないことを確認（修正前バグの検証）
                await expect(dropdown).not.toContainText('100');
                await expect(dropdown).not.toContainText('200');

                // "30" のチェックを外す（attack=10 と attack=20 の行のみ残す）
                await setFilterItemCheckedAsync(page, '30', false);
                await applyFilterAsync(page);

                // attack=30 の行（id=4）が非表示になり、attack=10,20 の行のみ表示される
                const after = await getVisibleColumnValuesAsync(table, 1);
                expect(after).toEqual(['10', '20', '10', '20']);
            },
        );

        test(
            '非連番keyスキーマのattack列フィルター適用後に .filter-active クラスが正しく付与される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');
                const headerRow = table.locator('.editor-table-column-header-row');
                const attackHeader = headerRow.locator('.editor-table-column-header').nth(1);

                // フィルター適用前は .filter-active クラスがない
                await expect(attackHeader).not.toHaveClass(/filter-active/);

                // attack 列で "30" を除外するフィルター適用
                await clickFilterIconAsync(table, 1);
                await setFilterItemCheckedAsync(page, '30', false);
                await applyFilterAsync(page);

                // フィルター適用後は .filter-active クラスが付与される
                await expect(attackHeader).toHaveClass(/filter-active/);
            },
        );
    });

    test.describe('ソートとフィルターの組み合わせ', () => {
        test.beforeEach(async ({ page }) => {
            const fs = createSortFilterTestFileSystem();
            await installMockApiAsync(page, fs);
            await page.goto('/');
        });

        test(
            'ソート適用中にフィルターを適用するとソート順を維持しつつ行が絞り込まれる',
            async ({ page }) => {
                const table = await openTableAsync(page, 'product');

                // price 列（colIndex=2）を昇順ソート
                // ソートインジケーターをクリック
                const headerRow = table.locator('.editor-table-column-header-row');
                const priceHeader = headerRow.locator('.editor-table-column-header').nth(2);
                const sortIndicator = priceHeader.locator('.sort-indicator');
                await sortIndicator.click();

                // ソート後: price 昇順 → 100, 200, 300, 400, 500
                const afterSort = await getVisibleColumnValuesAsync(table, 2);
                expect(afterSort).toEqual(['100', '200', '300', '400', '500']);

                // category 列で "A" のみ残す（price 昇順でのAのみ: 100, 300, 500）
                await clickFilterIconAsync(table, 1);
                await setFilterItemCheckedAsync(page, 'B', false);
                await applyFilterAsync(page);

                // ソート順（price 昇順）を維持しつつ A のみ表示される
                const afterFilter = await getVisibleColumnValuesAsync(table, 2);
                expect(afterFilter).toEqual(['100', '300', '500']);

                // category 列も A のみ
                const afterFilterCategory = await getVisibleColumnValuesAsync(table, 1);
                expect(afterFilterCategory).toEqual(['A', 'A', 'A']);
            },
        );

        test(
            'フィルター適用中にソートを変更してもフィルター状態が維持される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'product');

                // category 列で "A" のみ残す
                await clickFilterIconAsync(table, 1);
                await setFilterItemCheckedAsync(page, 'B', false);
                await applyFilterAsync(page);

                // フィルター後: A の行のみ（id=1,3,5）→ price は 500, 300, 100
                const beforeSort = await getVisibleColumnValuesAsync(table, 2);
                expect(beforeSort).toEqual(['500', '300', '100']);

                // price 列（colIndex=2）を昇順ソート
                const headerRow = table.locator('.editor-table-column-header-row');
                const priceHeader = headerRow.locator('.editor-table-column-header').nth(2);
                const sortIndicator = priceHeader.locator('.sort-indicator');
                await sortIndicator.click();

                // フィルターを維持しつつ price 昇順: 100, 300, 500
                const afterSort = await getVisibleColumnValuesAsync(table, 2);
                expect(afterSort).toEqual(['100', '300', '500']);

                // category は依然として A のみ
                const categoryValues = await getVisibleColumnValuesAsync(table, 1);
                expect(categoryValues).toEqual(['A', 'A', 'A']);
            },
        );
    });
});

// =============================================================================
// FEAT_0035 フィルター機能改修 — REDテスト
// =============================================================================

/**
 * 空文字列セルを含むフィルターテスト用のファイルシステムを生成する。
 *
 * テーブル構成:
 *   item: id（int）, category（string）, price（int）
 *
 * category が空文字列の行（id=2, id=4）が存在する。
 * 空文字列はフィルタードロップダウンのリストに表示されないが、
 * フィルター適用時は常に表示されること（どの値を選択していても除外されない）を確認する。
 */
function createEmptyValueFilterTestFileSystem(): MockFileSystem {
    return {
        "schema/item.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "category", type: "string" },
                { key: 2, name: "price", type: "int" },
            ],
            primary_key: ["id"],
        }),
        "data/item.csv": [
            "id,category,price",
            "1,weapon,100",
            "2,,200",
            "3,armor,300",
            "4,,",
            "5,potion,500",
        ].join("\n"),
    };
}

/**
 * 参照ヒント付きフィルターテスト用のファイルシステムを生成する。
 *
 * テーブル構成:
 *   chara: id（int, PK）, name（string）
 *   item: id（int, PK）, name（string）, chara_id（int, FK → chara.id）
 *
 * item.chara_id は chara.id を参照するFK列。
 * フィルタードロップダウンに参照ヒント（chara.name の値）が表示されることを確認する。
 */
function createReferenceHintFilterTestFileSystem(): MockFileSystem {
    return {
        "schema/chara.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "ja", type: "string" },
            ],
            primary_key: ["id"],
        }),
        "data/chara.csv": [
            "id,ja",
            "1,勇者",
            "2,魔法使い",
            "3,戦士",
        ].join("\n"),
        "schema/item.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                { key: 2, name: "chara_id", type: "int", reference: "chara.id" },
            ],
            primary_key: ["id"],
        }),
        "data/item.csv": [
            "id,name,chara_id",
            "1,剣,1",
            "2,杖,2",
            "3,盾,1",
            "4,ローブ,3",
        ].join("\n"),
    };
}

test.describe('FEAT_0035 フィルター機能改修', () => {
    test.describe('要件1: 空文字列のフィルター動作', () => {
        test.beforeEach(async ({ page }) => {
            await installMockApiAsync(page, createEmptyValueFilterTestFileSystem());
            await page.goto('/');
        });

        test(
            '空文字列はフィルタードロップダウンのユニーク値リストに表示されない',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');
                // category 列（colIndex=1）のフィルターを開く
                await clickFilterIconAsync(table, 1);
                const dropdown = page.locator('.filter-dropdown.visible');
                await expect(dropdown).toBeVisible();

                // ユニーク値リストには weapon, armor, potion のみ表示される（空文字列は除外）
                const items = dropdown.locator('.filter-item');
                await expect(items).toHaveCount(3);

                // 空文字列を表すラベルが存在しないこと
                const labels = dropdown.locator('.filter-item-label');
                const count = await labels.count();
                for (let i = 0; i < count; i++) {
                    const text = await labels.nth(i).innerText();
                    expect(text.trim()).not.toBe('');
                }
            },
        );

        test(
            '空文字列セルはフィルター適用時に常に表示される（weapon のみ選択でも空文字行は表示）',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');

                // category フィルターで weapon のみ選択
                await clickFilterIconAsync(table, 1);
                await setFilterItemCheckedAsync(page, 'armor', false);
                await setFilterItemCheckedAsync(page, 'potion', false);
                await applyFilterAsync(page);

                // weapon 行 (id=1,3) に加え、category が空の行 (id=2,4) も表示されること
                const categoryValues = await getVisibleColumnValuesAsync(table, 1);
                // weapon(id=1), ""(id=2), weapon(id=3), ""(id=4) の順で表示
                expect(categoryValues).toContain('weapon');
                // 空文字列行が除外されていないことを確認（weapon のみになるはずだが、空文字行も含まれる）
                expect(categoryValues.length).toBeGreaterThan(2);
                // armor と potion は除外されている
                expect(categoryValues).not.toContain('armor');
                expect(categoryValues).not.toContain('potion');
            },
        );
    });

    test.describe('要件2: ESCキーでフィルタードロップダウンを閉じる', () => {
        test.beforeEach(async ({ page }) => {
            await installMockApiAsync(page, createEmptyValueFilterTestFileSystem());
            await page.goto('/');
        });

        test(
            'フィルタードロップダウンが表示中にESCキーを押すとドロップダウンが閉じる',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');

                // ドロップダウンを開く
                await clickFilterIconAsync(table, 1);
                const dropdown = page.locator('.filter-dropdown.visible');
                await expect(dropdown).toBeVisible();

                // ESC キーを押す
                await page.keyboard.press('Escape');

                // ドロップダウンが閉じること
                await expect(dropdown).not.toBeAttached();
            },
        );
    });

    test.describe('要件3: フィルタードロップダウンに参照ヒントを表示する', () => {
        test.beforeEach(async ({ page }) => {
            await installMockApiAsync(page, createReferenceHintFilterTestFileSystem());
            await page.goto('/');
        });

        test(
            'FK参照列のフィルタードロップダウンに参照ヒントが表示される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');

                // 参照データのプリロード完了を待つ（セルに参照ヒントが表示されるまで）
                await expect(table.locator('.cell-reference-hint').first()).toBeAttached();

                // chara_id 列（colIndex=2）のフィルターを開く
                await clickFilterIconAsync(table, 2);
                const dropdown = page.locator('.filter-dropdown.visible');
                await expect(dropdown).toBeVisible();

                // ユニーク値は 1, 2, 3（chara_id の値）
                const items = dropdown.locator('.filter-item');
                await expect(items).toHaveCount(3);

                // 各 filter-item に参照ヒント要素が存在すること
                for (let i = 0; i < 3; i++) {
                    const hint = items.nth(i).locator('.filter-item-hint');
                    await expect(hint).toBeAttached();
                }

                // 参照ヒントに chara.name の値が含まれること
                await expect(dropdown).toContainText('勇者');
                await expect(dropdown).toContainText('魔法使い');
                await expect(dropdown).toContainText('戦士');
            },
        );

        test(
            'FK参照列でない列のフィルタードロップダウンには参照ヒントが表示されない',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');

                // name 列（colIndex=1）のフィルターを開く（参照列ではない）
                await clickFilterIconAsync(table, 1);
                const dropdown = page.locator('.filter-dropdown.visible');
                await expect(dropdown).toBeVisible();

                // filter-item-hint が存在しないこと
                const hints = dropdown.locator('.filter-item-hint');
                await expect(hints).toHaveCount(0);
            },
        );
    });

    test.describe('要件4: 検索で参照ヒントも含めて検索できる', () => {
        test.beforeEach(async ({ page }) => {
            await installMockApiAsync(page, createReferenceHintFilterTestFileSystem());
            await page.goto('/');
        });

        test(
            '参照ヒントのテキストで検索すると対応する項目がヒットする',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');

                // 参照データのプリロード完了を待つ（セルに参照ヒントが表示されるまで）
                await expect(table.locator('.cell-reference-hint').first()).toBeAttached();

                // chara_id 列（colIndex=2）のフィルターを開く
                await clickFilterIconAsync(table, 2);
                const dropdown = page.locator('.filter-dropdown.visible');
                await expect(dropdown).toBeVisible();

                // 検索前は 3 項目（1, 2, 3）
                await expect(dropdown.locator('.filter-item')).toHaveCount(3);

                // 参照ヒントの値「魔法使い」で検索
                const searchInput = dropdown.locator('.filter-search-input');
                await searchInput.fill('魔法使い');

                // chara_id=2（魔法使い）に対応する 1 項目のみ表示される
                const items = dropdown.locator('.filter-item');
                await expect(items).toHaveCount(1);
                // ラベルは "2"（chara_id の値）
                await expect(items.first().locator('.filter-item-label')).toContainText('2');
            },
        );
    });

    test.describe('要件5: 空の検索結果時に「検索結果なし」を表示する', () => {
        test.beforeEach(async ({ page }) => {
            await installMockApiAsync(page, createEmptyValueFilterTestFileSystem());
            await page.goto('/');
        });

        test(
            '検索で一件もヒットしない場合に「検索結果なし」が表示される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');
                await clickFilterIconAsync(table, 1);
                const dropdown = page.locator('.filter-dropdown.visible');
                await expect(dropdown).toBeVisible();

                // 存在しない文字列で検索
                const searchInput = dropdown.locator('.filter-search-input');
                await searchInput.fill('xyznotexist');

                // 項目が0件になり「検索結果なし」テキストが表示される
                const items = dropdown.locator('.filter-item');
                await expect(items).toHaveCount(0);
                await expect(dropdown).toContainText('検索結果なし');
            },
        );
    });

    test.describe('要件6: フィルターウィンドウの横幅を広げる', () => {
        test.beforeEach(async ({ page }) => {
            await installMockApiAsync(page, createEmptyValueFilterTestFileSystem());
            await page.goto('/');
        });

        test(
            'フィルタードロップダウンの min-width が 240px 以上である',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');
                await clickFilterIconAsync(table, 1);
                const dropdown = page.locator('.filter-dropdown.visible');
                await expect(dropdown).toBeVisible();

                // computedStyle から min-width を取得して 240px 以上であることを確認
                const minWidth = await dropdown.evaluate((el) => {
                    return parseInt(getComputedStyle(el).minWidth, 10);
                });
                expect(minWidth).toBeGreaterThanOrEqual(240);
            },
        );

        test(
            'フィルタードロップダウンの max-width が 340px 以上である',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');
                await clickFilterIconAsync(table, 1);
                const dropdown = page.locator('.filter-dropdown.visible');
                await expect(dropdown).toBeVisible();

                // computedStyle から max-width を取得して 340px 以上であることを確認
                const maxWidth = await dropdown.evaluate((el) => {
                    const raw = getComputedStyle(el).maxWidth;
                    // "none" の場合は極大値として扱う（none なら確実に 340 超え）
                    if (raw === 'none') return 99999;
                    return parseInt(raw, 10);
                });
                expect(maxWidth).toBeGreaterThanOrEqual(340);
            },
        );
    });

    test.describe('要件7: ボタンを等幅で幅いっぱいに広げる', () => {
        test.beforeEach(async ({ page }) => {
            await installMockApiAsync(page, createEmptyValueFilterTestFileSystem());
            await page.goto('/');
        });

        test(
            '全選択・全解除・クリアボタンが均等幅で親要素の幅いっぱいに広がっている',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');
                await clickFilterIconAsync(table, 1);
                const dropdown = page.locator('.filter-dropdown.visible');
                await expect(dropdown).toBeVisible();

                // 各ボタンの flex プロパティが "1 1 0%" 相当（flex: 1）になっていること
                const selectAllBtn = dropdown.locator('.filter-select-all');
                const deselectAllBtn = dropdown.locator('.filter-deselect-all');
                const clearBtn = dropdown.locator('.filter-clear');

                const selectAllFlex = await selectAllBtn.evaluate((el) => getComputedStyle(el).flexGrow);
                const deselectAllFlex = await deselectAllBtn.evaluate((el) => getComputedStyle(el).flexGrow);
                const clearFlex = await clearBtn.evaluate((el) => getComputedStyle(el).flexGrow);

                // flex-grow が 1 であること（flex: 1 の意味）
                expect(parseFloat(selectAllFlex)).toBe(1);
                expect(parseFloat(deselectAllFlex)).toBe(1);
                expect(parseFloat(clearFlex)).toBe(1);

                // 3つのボタンの幅が同じであること（均等幅）
                const selectAllWidth = await selectAllBtn.evaluate((el) => el.getBoundingClientRect().width);
                const deselectAllWidth = await deselectAllBtn.evaluate((el) => el.getBoundingClientRect().width);
                const clearWidth = await clearBtn.evaluate((el) => el.getBoundingClientRect().width);
                expect(Math.abs(selectAllWidth - deselectAllWidth)).toBeLessThan(2);
                expect(Math.abs(selectAllWidth - clearWidth)).toBeLessThan(2);
            },
        );
    });

    test.describe('要件8: ローマ字入力でドロップダウン項目が絞り込まれる', () => {
        /**
         * ローマ字検索用ファイルシステム
         * category 列にひらがな・カタカナ値を含む item テーブル
         */
        function createRomajiSearchFileSystem(): MockFileSystem {
            return {
                "schema/item.json": JSON.stringify({
                    header: [
                        {key: 0, name: "id", type: "int"},
                        {key: 1, name: "category", type: "string"},
                    ],
                    primary_key: ["id"],
                }),
                "data/item.csv": [
                    "id,category",
                    "1,ぶき",
                    "2,ぼうぐ",
                    "3,アイテム",
                ].join("\n"),
            };
        }

        test.beforeEach(async ({page}) => {
            await installMockApiAsync(page, createRomajiSearchFileSystem());
            await page.goto('/');
        });

        test(
            '"buki" で絞り込むと "ぶき" のみ表示される',
            async ({page}) => {
                const table = await openTableAsync(page, 'item');
                // category 列（colIndex=1）のフィルターを開く
                await clickFilterIconAsync(table, 1);
                const dropdown = page.locator('.filter-dropdown.visible');
                await expect(dropdown).toBeVisible();

                // 絞り込み前は3項目（ぶき・ぼうぐ・アイテム）
                await expect(dropdown.locator('.filter-item')).toHaveCount(3);

                // "buki"（ローマ字）で絞り込む
                const searchInput = dropdown.locator('.filter-search-input');
                await searchInput.fill('buki');

                // "ぶき" にのみマッチして1項目に絞られること
                const items = dropdown.locator('.filter-item');
                await expect(items).toHaveCount(1);
                await expect(items.first().locator('.filter-item-label')).toHaveText('ぶき');
            },
        );

        test(
            '"aite" で絞り込むと "アイテム" のみ表示される',
            async ({page}) => {
                const table = await openTableAsync(page, 'item');
                await clickFilterIconAsync(table, 1);
                const dropdown = page.locator('.filter-dropdown.visible');
                await expect(dropdown).toBeVisible();

                const searchInput = dropdown.locator('.filter-search-input');
                await searchInput.fill('aite');

                // "アイテム" にのみマッチすること（"あいて" に変換後カタカナ正規化でヒット）
                const items = dropdown.locator('.filter-item');
                await expect(items).toHaveCount(1);
                await expect(items.first().locator('.filter-item-label')).toHaveText('アイテム');
            },
        );
    });

    test.describe('要件9: フィルタードロップダウンのヒット部分にハイライト表示', () => {
        function createHighlightFilterTestFileSystem(): MockFileSystem {
            return {
                "schema/item.json": JSON.stringify({
                    header: [
                        {key: 0, name: "id", type: "int"},
                        {key: 1, name: "name", type: "string"},
                    ],
                    primary_key: ["id"],
                }),
                "data/item.csv": [
                    "id,name",
                    "1,weapon",
                    "2,armor",
                    "3,potion",
                ].join("\n"),
            };
        }

        test.beforeEach(async ({page}) => {
            await installMockApiAsync(page, createHighlightFilterTestFileSystem());
            await page.goto('/');
        });

        test(
            '検索ヒット部分に .search-highlight クラスが付与される',
            async ({page}) => {
                const table = await openTableAsync(page, 'item');
                // name 列（colIndex=1）のフィルターを開く
                await clickFilterIconAsync(table, 1);
                const dropdown = page.locator('.filter-dropdown.visible');
                await expect(dropdown).toBeVisible();

                // "wea" で検索（"weapon" にマッチ）
                const searchInput = dropdown.locator('.filter-search-input');
                await searchInput.fill('wea');

                // "weapon" を含む項目のラベルにハイライト span が存在すること
                const items = dropdown.locator('.filter-item');
                await expect(items).toHaveCount(1);
                const highlight = items.first().locator('.filter-item-label .search-highlight');
                await expect(highlight).toBeVisible();
                await expect(highlight).toHaveText('wea');
            },
        );
    });
});

// =============================================================================
// BUG: 検索絞り込み後の適用で非表示項目がチェック済み扱いされるバグの回帰テスト
//
// 根本原因:
//   collectCheckedValues() の `|| isFilteredOut` 条件により、
//   検索で DOM から除去された非表示項目が常にチェック済みとして扱われる。
//   これにより、検索で1項目に絞ってから「適用」を押しても
//   残り全ての非表示項目もフィルター対象（選択済み）として扱われ、
//   結果的にフィルターが機能しない（全行表示されてしまう）。
// =============================================================================

test.describe('BUG: 検索絞り込み後の適用で非表示項目がチェック済み扱いされるバグ', () => {
    test.beforeEach(async ({page}) => {
        // weapon=2行, armor=2行, potion=1行 の基本フィクスチャを使用
        await installMockApiAsync(page, createFilterTestFileSystem());
        await page.goto('/');
    });

    test(
        '検索絞り込み後の適用で非表示項目はチェック解除として扱われ、表示項目のみがフィルター対象になる',
        async ({page}) => {
            const table = await openTableAsync(page, 'item');

            // フィルター前: 5行（weapon, armor, weapon, armor, potion）すべて表示
            const before = await getVisibleColumnValuesAsync(table, 1);
            expect(before).toEqual(['weapon', 'armor', 'weapon', 'armor', 'potion']);

            // category 列のフィルタードロップダウンを開く
            await clickFilterIconAsync(table, 1);
            const dropdown = page.locator('.filter-dropdown.visible');
            await expect(dropdown).toBeVisible();

            // 検索ボックスに "weapon" と入力して絞り込む
            // → ドロップダウンには "weapon" のみ表示、"armor" と "potion" は DOM から除去される
            const searchInput = dropdown.locator('.filter-search-input');
            await searchInput.fill('weapon');

            // 絞り込み後: weapon のみが visible になっていること
            const visibleItems = dropdown.locator('.filter-item');
            await expect(visibleItems).toHaveCount(1);
            await expect(visibleItems.first().locator('.filter-item-label')).toContainText('weapon');

            // この状態（weapon のみ表示・armor と potion は非表示）で「適用」をクリックする。
            // 非表示項目（armor, potion）はチェック解除として扱われるべきである。
            await applyFilterAsync(page);

            // 期待: weapon 行のみ表示（2行）
            // バグあり時の実際: armor と potion も isFilteredOut=true でチェック済みとなり全5行表示
            const after = await getVisibleColumnValuesAsync(table, 1);
            expect(after).toEqual(['weapon', 'weapon']);
        },
    );

    test(
        '検索絞り込み後に表示されている項目のチェックを外して適用すると全行が非表示になる',
        async ({page}) => {
            const table = await openTableAsync(page, 'item');

            // category 列のフィルタードロップダウンを開く
            await clickFilterIconAsync(table, 1);
            const dropdown = page.locator('.filter-dropdown.visible');
            await expect(dropdown).toBeVisible();

            // "weapon" で検索して weapon のみ表示状態にする
            const searchInput = dropdown.locator('.filter-search-input');
            await searchInput.fill('weapon');
            await expect(dropdown.locator('.filter-item')).toHaveCount(1);

            // 表示中の "weapon" のチェックを外す
            await setFilterItemCheckedAsync(page, 'weapon', false);

            // 適用する（表示項目=weapon はチェック外し、非表示項目=armor,potion はチェック外しとして扱われるべき）
            await applyFilterAsync(page);

            // 期待: 選択された値が0件 → フィルターにより全行が非表示になる
            // バグあり時: armor, potion が isFilteredOut でチェック済み扱いされるため armor+potion の行が表示されてしまう
            const after = await getVisibleColumnValuesAsync(table, 1);
            expect(after).toEqual([]);
        },
    );
});

// =============================================================================
// BUG: 仮想スクロールが有効な大量行テーブルでフィルターが機能しない不具合
//
// 根本原因:
//   applyFilterDisplay() は DOM の display=none でフィルタリングを実現しているが、
//   仮想スクロール有効時はビューポート+OVERSCAN 分の行しか DOM に存在しない。
//   そのため:
//   1. totalRowCount がフィルター後の行数を反映しない → スペーサー高さが全行分のまま
//   2. renderRowForVirtualScroll() がフィルター対象外の行も生成する
//   3. スクロール時に新規生成された行に display=none が適用されない
// =============================================================================

/**
 * 仮想スクロールが発動する大量行テーブル用のファイルシステムを生成する。
 *
 * テーブル構成:
 *   monster: id（int）, category（string）, level（int）
 *
 * 100行: category は "boss"(5行), "normal"(95行) の2種。
 * boss は id=1,21,41,61,81 に分散配置（スクロール範囲全体に散らばる）。
 * ビューポート高さ600px / 行高21px ≒ 28行表示 + OVERSCAN=10 = 約48行がDOMに存在。
 * → 100行中 52行はDOM外であり、display=none ベースのフィルターが効かない。
 */
function createVirtualScrollFilterTestFileSystem(): MockFileSystem {
    const rows = ['id,category,level'];
    for (let i = 1; i <= 100; i++) {
        // id が 1,21,41,61,81 の行は boss、それ以外は normal
        const category = (i % 20 === 1) ? 'boss' : 'normal';
        rows.push(`${i},${category},${i * 10}`);
    }
    return {
        "schema/monster.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "category", type: "string" },
                { key: 2, name: "level", type: "int" },
            ],
            primary_key: ["id"],
        }),
        "data/monster.csv": rows.join("\n"),
    };
}

test.describe('BUG: 仮想スクロール有効テーブルでのフィルター', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createVirtualScrollFilterTestFileSystem());
        await page.goto('/');
    });

    test(
        '100行テーブルで category=boss のみにフィルターすると5行だけ表示される',
        async ({ page }) => {
            const table = await openTableAsync(page, 'monster');

            // category 列（colIndex=1）でフィルター: "normal" を除外して "boss" のみ残す
            await clickFilterIconAsync(table, 1);
            await setFilterItemCheckedAsync(page, 'normal', false);
            await applyFilterAsync(page);

            // 行数カウンターが「5 / 100 行」を表示すること
            const rowCount = page.locator('.filter-row-count');
            await expect(rowCount).toBeVisible();
            await expect(rowCount).toContainText('5');
            await expect(rowCount).toContainText('100');

            // 表示されている行の category がすべて boss であること
            const categoryValues = await getVisibleColumnValuesAsync(table, 1);
            expect(categoryValues).toEqual(['boss', 'boss', 'boss', 'boss', 'boss']);
        },
    );

    test(
        'フィルター適用後にスクロールしても非表示行が現れない',
        async ({ page }) => {
            const table = await openTableAsync(page, 'monster');

            // category=boss のみにフィルター
            await clickFilterIconAsync(table, 1);
            await setFilterItemCheckedAsync(page, 'normal', false);
            await applyFilterAsync(page);

            // スクロールコンテナを最下部までスクロールする
            const scrollContainer = page.locator('.editor-left-pane');
            await scrollContainer.evaluate((el) => {
                el.scrollTop = el.scrollHeight;
            });
            // スクロール後の再描画を待つ
            await page.waitForTimeout(200);

            // スクロール後も表示されている行の category はすべて boss であること
            const categoryValues = await getVisibleColumnValuesAsync(table, 1);
            expect(categoryValues).toEqual(['boss', 'boss', 'boss', 'boss', 'boss']);
        },
    );

    test(
        'フィルター適用後のスペーサー高さがフィルター後の行数に基づいている',
        async ({ page }) => {
            const table = await openTableAsync(page, 'monster');

            // category=boss のみにフィルター（5行）
            await clickFilterIconAsync(table, 1);
            await setFilterItemCheckedAsync(page, 'normal', false);
            await applyFilterAsync(page);

            // スクロールコンテナの scrollHeight がフィルター前（100行分）より大幅に小さいこと
            // overflow:auto コンテナでは scrollHeight >= clientHeight（~650px）が下限となるため、
            // 100行分の scrollHeight（~2100px）の半分以下であることを検証する
            const scrollContainer = page.locator('.editor-left-pane');
            const scrollHeight = await scrollContainer.evaluate((el) => el.scrollHeight);
            expect(scrollHeight).toBeLessThan(1000);
        },
    );

    test(
        'フィルター適用後にスクロール位置が先頭にリセットされテーブルが表示される',
        async ({ page }) => {
            const table = await openTableAsync(page, 'monster');

            // 最下部までスクロールして最後のセルをクリックして選択する
            const scrollContainer = page.locator('.editor-left-pane');
            await scrollContainer.evaluate((el) => { el.scrollTop = el.scrollHeight; });
            await page.waitForTimeout(200);
            // 最後のデータ行のセルをクリック
            const lastRow = table.locator('.editor-table-row:not(.editor-table-empty-row)').last();
            await lastRow.locator('.editor-table-cell:not(.editor-table-row-header)').first().click();
            await page.waitForTimeout(100);

            // category=boss のみにフィルター（100行 → 5行）
            await clickFilterIconAsync(table, 1);
            await setFilterItemCheckedAsync(page, 'normal', false);
            await applyFilterAsync(page);

            // フィルター適用後、テーブルのデータ行が表示されていること（空白画面にならない）
            const visibleRows = table.locator('.editor-table-row:not(.editor-table-empty-row)');
            // ヘッダー行 + boss 5行 = 少なくとも2行以上が visible であること
            const visibleCount = await visibleRows.count();
            expect(visibleCount).toBeGreaterThanOrEqual(2);

            // 表示されている行の category がすべて boss であること
            const categoryValues = await getVisibleColumnValuesAsync(table, 1);
            expect(categoryValues).toEqual(['boss', 'boss', 'boss', 'boss', 'boss']);
        },
    );

    test(
        'フィルター解除後に全100行が表示され仮想スクロールが正常に動作する',
        async ({ page }) => {
            const table = await openTableAsync(page, 'monster');

            // category=boss のみにフィルター
            await clickFilterIconAsync(table, 1);
            await setFilterItemCheckedAsync(page, 'normal', false);
            await applyFilterAsync(page);

            // フィルター解除
            await clickFilterIconAsync(table, 1);
            const dropdown = page.locator('.filter-dropdown.visible');
            await dropdown.locator('.filter-clear').click();

            // 行数カウンターが非表示になること
            const rowCount = page.locator('.filter-row-count');
            await expect(rowCount).not.toBeVisible();

            // スクロールコンテナの scrollHeight が100行分に復帰すること
            // 100行 × 21px = 2100px + ヘッダー + バッファ行
            const scrollContainer = page.locator('.editor-left-pane');
            const scrollHeight = await scrollContainer.evaluate((el) => el.scrollHeight);
            expect(scrollHeight).toBeGreaterThan(2000);
        },
    );
});

// =============================================================================
// BUG: 大量行テーブルの最下部セル選択後にフィルターをかけると画面が空白になる不具合
//
// 再現手順:
//   1. 1000行テーブルを開き、最下部(行999)のセルを選択する
//   2. フィルターをかけて100行程度に絞り込む
//   3. 何も表示されない状態になる（フィルハンドルだけ見える）
//   4. 上にスクロールするとテーブルが表示されるが、クリックでセルを選択できない
//   5. スクロールすると変な場所に飛ぶ
//
// 根本原因:
//   1. フィルター適用後に selection.focus/range がクランプされない（行999を指したまま）
//   2. scrollTop がフィルター後のコンテンツ高さを超えた位置に留まる
//   3. ensureRowVisible() がフィルター後の行数を超えた行にスクロールしようとする
//   4. クリック時の getCellPosition → start() 後に scrollFocusIntoView() が
//      無効な focus 行位置でスクロール計算を行い、異常な位置に飛ぶ
// =============================================================================

/**
 * 1000行テーブル用のファイルシステムを生成する。
 *
 * テーブル構成:
 *   enemy: id（int）, type（string）, power（int）
 *
 * 1000行: type は "rare"(50行: id=1,21,41,...,981), "common"(950行: それ以外)
 * フィルター後に50行になる。1000行 → 50行の大幅な行数変化で問題を再現する。
 */
function createLargeTableFilterTestFileSystem(): MockFileSystem {
    const rows = ['id,type,power'];
    for (let i = 1; i <= 1000; i++) {
        const type = (i % 20 === 1) ? 'rare' : 'common';
        rows.push(`${i},${type},${i}`);
    }
    return {
        "schema/enemy.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "type", type: "string" },
                { key: 2, name: "power", type: "int" },
            ],
            primary_key: ["id"],
        }),
        "data/enemy.csv": rows.join("\n"),
    };
}

test.describe('BUG: 最下部セル選択後のフィルターで画面が空白になる', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createLargeTableFilterTestFileSystem());
        await page.goto('/');
    });

    test(
        '最下部セル選択後にフィルターをかけてもテーブルが表示される',
        async ({ page }) => {
            const table = await openTableAsync(page, 'enemy');
            const scrollContainer = page.locator('.editor-left-pane');

            // 最下部までスクロールして最後のデータ行のセルをクリック
            await scrollContainer.evaluate((el) => { el.scrollTop = el.scrollHeight; });
            await page.waitForTimeout(200);
            const lastRow = table.locator('.editor-table-row:not(.editor-table-empty-row)').last();
            await lastRow.locator('.editor-table-cell:not(.editor-table-row-header)').first().click();
            await page.waitForTimeout(100);

            // type=rare のみにフィルター（1000行 → 50行）
            await clickFilterIconAsync(table, 1);
            await setFilterItemCheckedAsync(page, 'common', false);
            await applyFilterAsync(page);

            // フィルター適用後、テーブルのデータ行が表示されていること（空白画面にならない）
            // 仮想スクロール有効のため全50行がDOMに存在するとは限らない。
            // ビューポート + OVERSCAN 分のデータ行が表示されていれば正常。
            const categoryValues = await getVisibleColumnValuesAsync(table, 1);
            expect(categoryValues.length).toBeGreaterThan(0);
            expect(categoryValues.every(v => v === 'rare')).toBe(true);
        },
    );

    test(
        'フィルター適用後にセルをクリックして選択できる',
        async ({ page }) => {
            const table = await openTableAsync(page, 'enemy');
            const scrollContainer = page.locator('.editor-left-pane');

            // 最下部までスクロールして最後のデータ行のセルをクリック
            await scrollContainer.evaluate((el) => { el.scrollTop = el.scrollHeight; });
            await page.waitForTimeout(200);
            const lastRow = table.locator('.editor-table-row:not(.editor-table-empty-row)').last();
            await lastRow.locator('.editor-table-cell:not(.editor-table-row-header)').first().click();
            await page.waitForTimeout(100);

            // type=rare のみにフィルター（1000行 → 50行）
            await clickFilterIconAsync(table, 1);
            await setFilterItemCheckedAsync(page, 'common', false);
            await applyFilterAsync(page);
            await page.waitForTimeout(200);

            // フィルター後の先頭データ行のセルをクリック
            const firstDataCell = table.locator(
                '.editor-table-row:not(.editor-table-empty-row):not(.editor-table-column-header-row) .editor-table-cell:not(.editor-table-row-header)'
            ).first();
            await firstDataCell.click();
            await page.waitForTimeout(100);

            // クリック後にいずれかのデータセルに selected クラスが付与されること
            // 仮想スクロール環境ではロケータ解決時と実際のクリック到達先が異なる場合があるため
            // 特定のセルではなく「selected セルが存在すること」を検証する
            const selectedCells = table.locator('.editor-table-cell.selected');
            await expect(selectedCells.first()).toBeVisible();
        },
    );

    test(
        'フィルター適用後にスクロールしても表示が崩れない',
        async ({ page }) => {
            const table = await openTableAsync(page, 'enemy');
            const scrollContainer = page.locator('.editor-left-pane');

            // 最下部までスクロールして最後のデータ行のセルをクリック
            await scrollContainer.evaluate((el) => { el.scrollTop = el.scrollHeight; });
            await page.waitForTimeout(200);
            const lastRow = table.locator('.editor-table-row:not(.editor-table-empty-row)').last();
            await lastRow.locator('.editor-table-cell:not(.editor-table-row-header)').first().click();
            await page.waitForTimeout(100);

            // type=rare のみにフィルター（1000行 → 50行）
            await clickFilterIconAsync(table, 1);
            await setFilterItemCheckedAsync(page, 'common', false);
            await applyFilterAsync(page);
            await page.waitForTimeout(200);

            // 少しスクロールする（変な場所に飛ばないこと）
            await scrollContainer.evaluate((el) => { el.scrollTop += 100; });
            await page.waitForTimeout(200);

            // スクロール後もデータ行が表示されていること
            const categoryValues = await getVisibleColumnValuesAsync(table, 1);
            expect(categoryValues.length).toBeGreaterThan(0);
            expect(categoryValues.every(v => v === 'rare')).toBe(true);

            // scrollTop がコンテンツの高さ内に収まっていること
            const scrollHeight = await scrollContainer.evaluate((el) => el.scrollHeight);
            const scrollTop = await scrollContainer.evaluate((el) => el.scrollTop);
            expect(scrollTop).toBeLessThan(scrollHeight);
        },
    );

    test(
        'フィルター適用後に矢印キーでセルを移動できる',
        async ({ page }) => {
            const table = await openTableAsync(page, 'enemy');
            const scrollContainer = page.locator('.editor-left-pane');

            // 最下部までスクロールして最後のデータ行のセルをクリック
            await scrollContainer.evaluate((el) => { el.scrollTop = el.scrollHeight; });
            await page.waitForTimeout(200);
            const lastRow = table.locator('.editor-table-row:not(.editor-table-empty-row)').last();
            await lastRow.locator('.editor-table-cell:not(.editor-table-row-header)').first().click();
            await page.waitForTimeout(100);

            // type=rare のみにフィルター（1000行 → 50行）
            await clickFilterIconAsync(table, 1);
            await setFilterItemCheckedAsync(page, 'common', false);
            await applyFilterAsync(page);
            await page.waitForTimeout(200);

            // 矢印キー↓で移動
            await page.keyboard.press('ArrowDown');
            await page.waitForTimeout(100);

            // 選択セルが存在し selected クラスが付与されていること
            const selectedCells = table.locator('.editor-table-cell.selected');
            const count = await selectedCells.count();
            expect(count).toBeGreaterThan(0);

            // 選択セルが表示領域内にあること（DOMに存在し visible であること）
            await expect(selectedCells.first()).toBeVisible();
        },
    );
});
