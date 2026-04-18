import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, readMockFileAsync, MockFileSystem } from './fixtures/mock-api';
import { enableRelationsPanelAsync } from './fixtures/test-utils';

// =============================================================================
// フリーズペイン（行/列の固定）のテスト
//
// 機能概要:
//   列ヘッダー右クリック → 「先頭からこの列まで固定 (N列)」で列を固定。
//   行ヘッダー右クリック → 「この行まで固定」で行を固定。
//   固定されたセルは position: sticky + 動的 left/top 値が設定される。
//   最後の固定列/行には影クラス（freeze-column-border / freeze-row-border）が付与される。
//   ミニテーブルではフリーズメニューを表示しない。
//
// テストケース一覧:
//   1. 列ヘッダー右クリックで「先頭からこの列まで固定」メニューが表示される
//   2. 列を固定するとstickyスタイルが適用される
//   3. 固定列の右端に影が表示される
//   4. 固定列を解除するとstickyスタイルが解除される
//   5. 行ヘッダー右クリックで「この行まで固定」メニューが表示される
//   6. 行を固定するとstickyスタイルが適用される
//   7. 固定行の行ヘッダーにposition:stickyが適用される
//   8. 固定行のデータセルに不透明な背景色が設定される
//   9. 固定列のデータセルに不透明な背景色が設定される
// =============================================================================

// =============================================================================
// フィクスチャ生成ヘルパー
// =============================================================================

/**
 * フリーズペインテスト用のファイルシステムを生成する。
 *
 * テーブル構成:
 *   freeze_test: id, name, hp, atk, def, spd, luk, element, skill, desc（10列）
 *
 * 列固定・行固定の検証には十分な列数・行数が必要。
 */
function createFreezeTestFileSystem(): MockFileSystem {
    return {
        "schema/freeze_test.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                { key: 2, name: "hp", type: "int" },
                { key: 3, name: "atk", type: "int" },
                { key: 4, name: "def", type: "int" },
                { key: 5, name: "spd", type: "int" },
                { key: 6, name: "luk", type: "int" },
                { key: 7, name: "element", type: "string" },
                { key: 8, name: "skill", type: "string" },
                { key: 9, name: "desc", type: "string" },
            ],
            primary_key: ["id"],
        }),
        "data/freeze_test.csv": [
            "id,name,hp,atk,def,spd,luk,element,skill,desc",
            "1,Slime,100,10,5,3,1,Water,Splash,A basic enemy",
            "2,Dragon,9999,500,300,100,50,Fire,Inferno,A powerful dragon",
            "3,Goblin,200,30,15,20,5,Earth,Strike,A small goblin",
        ].join("\n"),
    };
}

/**
 * ミニテーブルのフリーズメニュー非表示テスト用のファイルシステムを生成する。
 *
 * テーブル構成:
 *   enemy: id, ja（敵名テーブル）
 *   quest: id, name, enemy_id（クエスト。enemy.idをFKとして参照）
 *
 * quest の行を選択すると RelationsPanel に N:1 として enemy のミニテーブルが表示される。
 */
function createMiniTableFreezeTestFileSystem(): MockFileSystem {
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
            "1,Slime",
            "2,Dragon",
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
 * 行固定と列固定の同時利用を検証する大規模テーブル用のファイルシステムを生成する。
 *
 * 1000行かつ横スクロールが必要な列数を持つため、仮想スクロールによる再描画後も
 * 固定列が維持されるかを確認できる。
 */
function createCombinedFreezeTestFileSystem(): MockFileSystem {
    const rows: string[] = ['id,name,value_1,value_2,value_3,value_4,value_5,value_6'];
    for (let i = 1; i <= 1000; i++) {
        rows.push([
            `${i}`,
            `name_${i}`,
            `v1_${i}`,
            `v2_${i}`,
            `v3_${i}`,
            `v4_${i}`,
            `v5_${i}`,
            `v6_${i}`,
        ].join(','));
    }

    return {
        "schema/freeze_combo.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                { key: 2, name: "value_1", type: "string" },
                { key: 3, name: "value_2", type: "string" },
                { key: 4, name: "value_3", type: "string" },
                { key: 5, name: "value_4", type: "string" },
                { key: 6, name: "value_5", type: "string" },
                { key: 7, name: "value_6", type: "string" },
            ],
            primary_key: ["id"],
        }),
        "data/freeze_combo.csv": rows.join("\n"),
    };
}

/**
 * fill-handle の重なり順検証用ファイルシステム。
 * 先頭1行・先頭1列を固定した状態で開き、選択セルに応じて
 * fill-handle の z-index が動的に切り替わることを検証する。
 */
function createFillHandleZIndexTestFileSystem(): MockFileSystem {
    return {
        "schema/fill_handle_z_index_test.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                { key: 2, name: "hp", type: "int" },
                { key: 3, name: "atk", type: "int" },
            ],
            primary_key: ["id"],
            frozenRowCount: 1,
            frozenColumnCount: 1,
        }),
        "data/fill_handle_z_index_test.csv": [
            "id,name,hp,atk",
            "1,Slime,100,10",
            "2,Dragon,9999,500",
            "3,Goblin,200,30",
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
 * 列ヘッダーを右クリックしてコンテキストメニューを開く
 * colIndex: 0始まり（行ヘッダーを除くデータ列）
 */
async function rightClickColumnHeaderAsync(table: Locator, colIndex: number): Promise<void> {
    const header = table.locator('.editor-table-column-header').nth(colIndex);
    await header.click({ button: 'right' });
}

/**
 * 行ヘッダーを右クリックしてコンテキストメニューを開く
 * rowIndex: 0始まり（ヘッダー行を除くデータ行）
 */
async function rightClickRowHeaderAsync(table: Locator, rowIndex: number): Promise<void> {
    const header = table.locator('.editor-table-row-header').nth(rowIndex);
    await header.click({ button: 'right' });
}

/**
 * コンテキストメニューから指定ラベルの項目をクリックする
 */
async function clickContextMenuItemAsync(page: Page, label: string): Promise<void> {
    const menu = page.locator('.context-menu.visible');
    await expect(menu).toBeVisible();
    await menu.locator('.context-menu-item', { hasText: label }).click();
}

async function clickDataCellAsync(table: Locator, rowIndex: number, columnIndex: number): Promise<void> {
    const row = table.locator('.editor-table-row:not(.editor-table-column-header-row):not(.editor-table-empty-row)').nth(rowIndex);
    const cell = row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(columnIndex);
    await cell.click();
}

async function getComputedZIndexAsync(page: Page, selector: string): Promise<number> {
    return await page.evaluate((targetSelector) => {
        const element = document.querySelector(targetSelector);
        if (!(element instanceof HTMLElement)) {
            throw new Error(`要素が見つかりません: ${targetSelector}`);
        }
        return parseInt(window.getComputedStyle(element).zIndex, 10);
    }, selector);
}

async function getRootCssZIndexVarAsync(page: Page, cssVariableName: string): Promise<number> {
    return await page.evaluate((targetVariableName) => {
        const value = window.getComputedStyle(document.documentElement).getPropertyValue(targetVariableName).trim();
        return parseInt(value, 10);
    }, cssVariableName);
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
 * リレーションパネルのコンテンツが表示されるまで待機する
 */
async function waitForRelationsPanelContentAsync(page: Page): Promise<void> {
    const content = page.locator('.relations-panel-content');
    await expect(content).toBeVisible();
}

/**
 * 指定列のデータセル（全データ行）の computed style を取得する
 * colIndex: 0始まり（行ヘッダーを除くデータ列）
 * 戻り値: 各行の { position, left } オブジェクト配列
 */
async function getColumnCellStylesAsync(
    table: Locator, colIndex: number,
): Promise<Array<{ position: string; left: string }>> {
    // ヘッダー行を含む全行（バッファ空行除外）からデータセルのスタイルを取得
    const dataRows = table.locator('.editor-table-row:not(.editor-table-empty-row)');
    const count = await dataRows.count();
    const styles: Array<{ position: string; left: string }> = [];
    // nth(0) はヘッダー行なのでスキップ
    for (let i = 1; i < count; i++) {
        const row = dataRows.nth(i);
        const cell = row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
        const style = await cell.evaluate((el) => {
            const cs = window.getComputedStyle(el);
            return { position: cs.position, left: cs.left };
        });
        styles.push(style);
    }
    return styles;
}

/**
 * 指定行の table-row の computed style を取得する（行固定は行単位で sticky を適用する）
 * rowIndex: 0始まり（ヘッダー行を除くデータ行）
 * 戻り値: { position, top } オブジェクト
 */
async function getRowStyleAsync(
    table: Locator, rowIndex: number,
): Promise<{ position: string; top: string }> {
    const row = table.locator('.editor-table-row:not(.editor-table-empty-row)').nth(rowIndex + 1);
    return row.evaluate((el) => {
        const cs = window.getComputedStyle(el);
        return { position: cs.position, top: cs.top };
    });
}

/**
 * 指定行の行ヘッダーの computed style を取得する
 * rowIndex: 0始まり（ヘッダー行を除くデータ行）
 * 戻り値: { position, top, zIndex }
 */
async function getRowHeaderStyleAsync(
    table: Locator, rowIndex: number,
): Promise<{ position: string; top: string; zIndex: string }> {
    const row = table.locator('.editor-table-row:not(.editor-table-empty-row)').nth(rowIndex + 1);
    const header = row.locator('.editor-table-row-header');
    return header.evaluate((el) => {
        const cs = window.getComputedStyle(el);
        return { position: cs.position, top: cs.top, zIndex: cs.zIndex };
    });
}

/**
 * 指定セルの computed background-color を取得する
 * 透明（rgba(0,0,0,0)）でないことの検証に使う
 */
async function getCellBackgroundColorAsync(cell: Locator): Promise<string> {
    return cell.evaluate((el) => window.getComputedStyle(el).backgroundColor);
}

/**
 * 指定セルの sticky 関連スタイルを取得する
 */
async function getCellStickyStyleAsync(cell: Locator): Promise<{ position: string; left: string; top: string }> {
    return cell.evaluate((el) => {
        const cs = window.getComputedStyle(el);
        return { position: cs.position, left: cs.left, top: cs.top };
    });
}

// =============================================================================
// テストケース
// =============================================================================

test.describe('フリーズペイン', () => {
    test.describe('列の固定', () => {
        test.beforeEach(async ({ page }) => {
            const fs = createFreezeTestFileSystem();
            await installMockApiAsync(page, fs);
            await page.goto('/');
        });

        test(
            '列ヘッダー右クリックで「先頭からこの列まで固定」メニューが表示される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'freeze_test');

                // "atk"列（インデックス3）を右クリック
                await rightClickColumnHeaderAsync(table, 3);

                // コンテキストメニューが表示される
                const menu = page.locator('.context-menu.visible');
                await expect(menu).toBeVisible();

                // 「先頭からこの列まで固定 (4列)」メニューが存在する
                // id, name, hp, atk の4列を固定する
                const freezeItem = menu.locator('.context-menu-item', { hasText: '先頭からこの列まで固定' });
                await expect(freezeItem).toBeVisible();
                await expect(freezeItem).toContainText('4列');
            },
        );

        test(
            '列を固定するとstickyスタイルが適用される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'freeze_test');

                // "name"列（インデックス1）を右クリックして固定
                // id, name の2列が固定される
                await rightClickColumnHeaderAsync(table, 1);
                await clickContextMenuItemAsync(page, '先頭からこの列まで固定');

                // 固定列（id: colIndex=0）のデータセルが sticky になっている
                const idStyles = await getColumnCellStylesAsync(table, 0);
                for (const style of idStyles) {
                    expect(style.position).toBe('sticky');
                }

                // 固定列（name: colIndex=1）のデータセルも sticky になっている
                const nameStyles = await getColumnCellStylesAsync(table, 1);
                for (const style of nameStyles) {
                    expect(style.position).toBe('sticky');
                }

                // id列の left 値は行ヘッダーの実占有幅（padding+border含む）であること
                // getBoundingClientRect で取得するため 40px より大きい
                for (const style of idStyles) {
                    const leftPx = parseInt(style.left);
                    expect(leftPx).toBeGreaterThan(40);
                }

                // name列の left 値は行ヘッダー幅 + id列の幅 であること（id列より大きい）
                for (const style of nameStyles) {
                    const leftPx = parseInt(style.left);
                    expect(leftPx).toBeGreaterThan(parseInt(idStyles[0].left));
                }

                // 非固定列（hp: colIndex=2）は sticky でないこと
                const hpStyles = await getColumnCellStylesAsync(table, 2);
                for (const style of hpStyles) {
                    expect(style.position).not.toBe('sticky');
                }
            },
        );

        test(
            '固定列の右端に影が表示される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'freeze_test');

                // "name"列（インデックス1）まで固定（id, name の2列）
                await rightClickColumnHeaderAsync(table, 1);
                await clickContextMenuItemAsync(page, '先頭からこの列まで固定');

                // 最後の固定列（name）のヘッダーに freeze-column-border クラスが付与される
                const nameHeader = table.locator('.editor-table-column-header').nth(1);
                await expect(nameHeader).toHaveClass(/freeze-column-border/);

                // 最初の固定列（id）には freeze-column-border が付与されない
                const idHeader = table.locator('.editor-table-column-header').nth(0);
                await expect(idHeader).not.toHaveClass(/freeze-column-border/);

                // 非固定列（hp）にも freeze-column-border が付与されない
                const hpHeader = table.locator('.editor-table-column-header').nth(2);
                await expect(hpHeader).not.toHaveClass(/freeze-column-border/);
            },
        );

        test(
            '固定列を解除するとstickyスタイルが解除される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'freeze_test');

                // まず列を固定する
                await rightClickColumnHeaderAsync(table, 1);
                await clickContextMenuItemAsync(page, '先頭からこの列まで固定');

                // 固定されていることを確認
                const beforeStyles = await getColumnCellStylesAsync(table, 0);
                for (const style of beforeStyles) {
                    expect(style.position).toBe('sticky');
                }

                // 列ヘッダーを右クリックして「列の固定を解除」を選択
                await rightClickColumnHeaderAsync(table, 0);
                const menu = page.locator('.context-menu.visible');
                await expect(menu).toBeVisible();
                await clickContextMenuItemAsync(page, '列の固定を解除');

                // 固定が解除され sticky でなくなること
                const afterStyles = await getColumnCellStylesAsync(table, 0);
                for (const style of afterStyles) {
                    expect(style.position).not.toBe('sticky');
                }

                // freeze-column-border クラスも除去されていること
                const nameHeader = table.locator('.editor-table-column-header').nth(1);
                await expect(nameHeader).not.toHaveClass(/freeze-column-border/);
            },
        );
    });

    test.describe('fill-handle の重なり順', () => {
        test.beforeEach(async ({ page }) => {
            const fs = createFillHandleZIndexTestFileSystem();
            await installMockApiAsync(page, fs);
            await page.goto('/');
        });

        test('選択セルの固定状態に応じて fill-handle の z-index が切り替わる', async ({ page }) => {
            const table = await openTableAsync(page, 'fill_handle_z_index_test');
            const freezeColumnZIndex = await getRootCssZIndexVarAsync(page, '--z-index-freeze-column');
            const freezeRowZIndex = await getRootCssZIndexVarAsync(page, '--z-index-freeze-row');

            // 通常セル選択時は固定行・固定列より下に留まり、背後に隠れる必要がある。
            await clickDataCellAsync(table, 1, 1);
            const normalCellHandleZIndex = await getComputedZIndexAsync(page, '.fill-handle');
            expect(normalCellHandleZIndex).toBeLessThan(freezeColumnZIndex);
            expect(normalCellHandleZIndex).toBeLessThan(freezeRowZIndex);

            // 固定列セル選択時は固定列セルの 1 つ上に出す。
            await clickDataCellAsync(table, 1, 0);
            const frozenColumnHandleZIndex = await getComputedZIndexAsync(page, '.fill-handle');
            expect(frozenColumnHandleZIndex).toBe(freezeColumnZIndex + 1);

            // 固定行セル選択時は固定行セルの 1 つ上に出す。
            await clickDataCellAsync(table, 0, 1);
            const frozenRowHandleZIndex = await getComputedZIndexAsync(page, '.fill-handle');
            expect(frozenRowHandleZIndex).toBe(freezeRowZIndex + 1);
        });
    });

    test.describe('行の固定', () => {
        test.beforeEach(async ({ page }) => {
            const fs = createFreezeTestFileSystem();
            await installMockApiAsync(page, fs);
            await page.goto('/');
        });

        test(
            '行ヘッダー右クリックで「この行まで固定」メニューが表示される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'freeze_test');

                // 2行目（rowIndex=1、Dragonの行）を右クリック
                await rightClickRowHeaderAsync(table, 1);

                // コンテキストメニューが表示される
                const menu = page.locator('.context-menu.visible');
                await expect(menu).toBeVisible();

                // 「この行まで固定」メニューが存在する
                const freezeItem = menu.locator('.context-menu-item', { hasText: 'この行まで固定' });
                await expect(freezeItem).toBeVisible();
            },
        );

        test(
            '行を固定するとstickyスタイルが適用される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'freeze_test');

                // 1行目（rowIndex=0、Slimeの行）を右クリックして固定
                await rightClickRowHeaderAsync(table, 0);
                await clickContextMenuItemAsync(page, 'この行まで固定');

                // 固定行（rowIndex=0）の table-row が sticky になっている
                const rowStyle = await getRowStyleAsync(table, 0);
                expect(rowStyle.position).toBe('sticky');

                // top 値はヘッダー行の高さ分のオフセットがある（0pxより大きい）
                const topPx = parseInt(rowStyle.top);
                expect(topPx).toBeGreaterThan(0);

                // 非固定行（rowIndex=1）の table-row は sticky でないこと
                const nonFrozenStyle = await getRowStyleAsync(table, 1);
                expect(nonFrozenStyle.position).not.toBe('sticky');

                // 最後の固定行の table-row に freeze-row-border クラスが付与される
                const frozenRow = table.locator('.editor-table-row:not(.editor-table-empty-row)').nth(1);
                await expect(frozenRow).toHaveClass(/freeze-row-border/);
            },
        );

        test(
            '列固定のあとに行固定しても固定列のstickyスタイルが維持される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'freeze_test');

                // まず "name" 列まで固定して id / name の2列を固定する
                await rightClickColumnHeaderAsync(table, 1);
                await clickContextMenuItemAsync(page, '先頭からこの列まで固定');

                // 行固定前は固定列セルが sticky であることを前提確認する
                const idStylesBeforeFreezeRow = await getColumnCellStylesAsync(table, 0);
                for (const style of idStylesBeforeFreezeRow) {
                    expect(style.position).toBe('sticky');
                }
                const nameStylesBeforeFreezeRow = await getColumnCellStylesAsync(table, 1);
                for (const style of nameStylesBeforeFreezeRow) {
                    expect(style.position).toBe('sticky');
                }

                // 続けて 1 行目を固定する
                await rightClickRowHeaderAsync(table, 0);
                await clickContextMenuItemAsync(page, 'この行まで固定');

                // 行固定自体は適用されていることを先に確認する
                const frozenRowStyle = await getRowStyleAsync(table, 0);
                expect(frozenRowStyle.position).toBe('sticky');

                // 行固定後も id / name 列のデータセルは sticky のまま維持されるべき
                const idStylesAfterFreezeRow = await getColumnCellStylesAsync(table, 0);
                for (const style of idStylesAfterFreezeRow) {
                    expect(style.position).toBe('sticky');
                }
                const nameStylesAfterFreezeRow = await getColumnCellStylesAsync(table, 1);
                for (const style of nameStylesAfterFreezeRow) {
                    expect(style.position).toBe('sticky');
                }
            },
        );

        test(
            '固定行の行ヘッダーにfreeze-row-borderとz-indexが適用される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'freeze_test');

                // 1行目（rowIndex=0、Slimeの行）を右クリックして固定
                await rightClickRowHeaderAsync(table, 0);
                await clickContextMenuItemAsync(page, 'この行まで固定');

                // 固定行の table-row が sticky であること
                const rowStyle = await getRowStyleAsync(table, 0);
                expect(rowStyle.position).toBe('sticky');
                const topPx = parseInt(rowStyle.top);
                expect(topPx).toBeGreaterThan(0);

                // 固定行の行ヘッダーに freeze-corner レベルの z-index が設定されていること
                const headerStyle = await getRowHeaderStyleAsync(table, 0);
                const zIndex = parseInt(headerStyle.zIndex);
                expect(zIndex).toBeGreaterThan(0);
            },
        );
    });

    test.describe('固定セルの背景色', () => {
        test.beforeEach(async ({ page }) => {
            const fs = createFreezeTestFileSystem();
            await installMockApiAsync(page, fs);
            await page.goto('/');
        });

        test(
            '固定行のデータセルに不透明な背景色が設定される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'freeze_test');

                // 1行目を固定
                await rightClickRowHeaderAsync(table, 0);
                await clickContextMenuItemAsync(page, 'この行まで固定');

                // 固定行のデータセルの背景色が透明（rgba(0, 0, 0, 0)）でないこと
                const row = table.locator('.editor-table-row:not(.editor-table-empty-row)').nth(1);
                const cells = row.locator('.editor-table-cell:not(.editor-table-row-header)');
                const count = await cells.count();
                for (let i = 0; i < count; i++) {
                    const bgColor = await getCellBackgroundColorAsync(cells.nth(i));
                    expect(bgColor).not.toBe('rgba(0, 0, 0, 0)');
                }
            },
        );

        test(
            '固定列のデータセルに不透明な背景色が設定される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'freeze_test');

                // "name"列（インデックス1）まで固定（id, name の2列）
                await rightClickColumnHeaderAsync(table, 1);
                await clickContextMenuItemAsync(page, '先頭からこの列まで固定');

                // 固定列のデータセル（1行目）の背景色が透明でないこと
                const dataRows = table.locator('.editor-table-row:not(.editor-table-empty-row)');
                const count = await dataRows.count();
                // ヘッダー行(nth(0))は既に背景色を持つのでスキップ、データ行のみチェック
                for (let rowIdx = 1; rowIdx < count; rowIdx++) {
                    const row = dataRows.nth(rowIdx);
                    // 固定列（id: colIndex=0, name: colIndex=1）のセル
                    for (let colIdx = 0; colIdx < 2; colIdx++) {
                        const cell = row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIdx);
                        const bgColor = await getCellBackgroundColorAsync(cell);
                        expect(bgColor).not.toBe('rgba(0, 0, 0, 0)');
                    }
                }

                // 非固定列（hp: colIndex=2）の背景色は透明のまま
                const firstDataRow = dataRows.nth(1);
                const nonFrozenCell = firstDataRow.locator('.editor-table-cell:not(.editor-table-row-header)').nth(2);
                const nonFrozenBg = await getCellBackgroundColorAsync(nonFrozenCell);
                expect(nonFrozenBg).toBe('rgba(0, 0, 0, 0)');
            },
        );
    });

    test.describe('行と列の同時固定', () => {
        test.beforeEach(async ({ page }) => {
            const fs = createCombinedFreezeTestFileSystem();
            await installMockApiAsync(page, fs);
            await page.goto('/');
        });

        test(
            '列固定後に行固定して大きくスクロールしても固定列が維持される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'freeze_combo');

                // id, name の2列を固定する
                await rightClickColumnHeaderAsync(table, 1);
                await clickContextMenuItemAsync(page, '先頭からこの列まで固定');

                // 1行目を固定する
                await rightClickRowHeaderAsync(table, 0);
                await clickContextMenuItemAsync(page, 'この行まで固定');

                // 固定行はDOMに残り続けること
                const frozenRow = table.locator('.editor-table-row:not(.editor-table-empty-row)')
                    .filter({ has: page.locator('.editor-table-row-header[data-row-index="0"]') });
                await expect(frozenRow).toHaveCount(1);
                const frozenRowStyle = await frozenRow.first().evaluate((el) => {
                    const cs = window.getComputedStyle(el);
                    return { position: cs.position, top: cs.top };
                });
                expect(frozenRowStyle.position).toBe('sticky');
                expect(parseInt(frozenRowStyle.top)).toBeGreaterThan(0);

                // 仮想スクロールで通常行が再描画される位置までスクロールする
                const scrollContainer = page.locator('.editor-left-pane');
                await scrollContainer.evaluate((el) => {
                    el.scrollTop = 500 * 21;
                    el.scrollLeft = 600;
                });

                // スクロール後に表示された通常行でも固定列が sticky のまま維持されること
                const scrolledRow = table.locator('.editor-table-row:not(.editor-table-empty-row)')
                    .filter({ has: page.locator('.editor-table-row-header[data-row-index="500"]') });
                await expect(scrolledRow).toHaveCount(1);

                const idCellStyle = await getCellStickyStyleAsync(
                    scrolledRow.first().locator('.editor-table-cell:not(.editor-table-row-header)').nth(0),
                );
                expect(idCellStyle.position).toBe('sticky');
                expect(parseInt(idCellStyle.left)).toBeGreaterThan(40);

                const nameCellStyle = await getCellStickyStyleAsync(
                    scrolledRow.first().locator('.editor-table-cell:not(.editor-table-row-header)').nth(1),
                );
                expect(nameCellStyle.position).toBe('sticky');
                expect(parseInt(nameCellStyle.left)).toBeGreaterThan(parseInt(idCellStyle.left));
            },
        );
    });

    test.describe('固定状態の永続化', () => {
        test.beforeEach(async ({ page }) => {
            const fs = createFreezeTestFileSystem();
            await installMockApiAsync(page, fs);
            await page.goto('/');
        });

        test(
            '列を固定するとスキーマに frozenColumnCount が保存される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'freeze_test');

                // "name"列（インデックス1）を右クリックして固定（id, name の2列固定）
                await rightClickColumnHeaderAsync(table, 1);
                await clickContextMenuItemAsync(page, '先頭からこの列まで固定');

                // saveFreezeStateAsync は fire-and-forget のため非同期書き込み完了を poll で待機する
                await expect.poll(async () => {
                    const text = await readMockFileAsync(page, 'schema/freeze_test.json');
                    return JSON.parse(text).frozenColumnCount;
                }).toBe(2);
            },
        );

        test(
            '列の固定を解除するとスキーマから frozenColumnCount が消える',
            async ({ page }) => {
                const table = await openTableAsync(page, 'freeze_test');

                // まず列を固定する
                await rightClickColumnHeaderAsync(table, 1);
                await clickContextMenuItemAsync(page, '先頭からこの列まで固定');

                // 固定が保存されていることを確認（saveFreezeStateAsync は fire-and-forget のため poll で待機）
                await expect.poll(async () => {
                    const text = await readMockFileAsync(page, 'schema/freeze_test.json');
                    return JSON.parse(text).frozenColumnCount;
                }).toBe(2);

                // 列の固定を解除する
                await rightClickColumnHeaderAsync(table, 0);
                await clickContextMenuItemAsync(page, '列の固定を解除');

                // frozenColumnCount フィールドが除去されていることを確認（saveFreezeStateAsync は非同期のため poll で待機）
                await expect.poll(async () => {
                    const text = await readMockFileAsync(page, 'schema/freeze_test.json');
                    return JSON.parse(text).frozenColumnCount;
                }).toBeUndefined();
            },
        );

        test(
            '行を固定するとスキーマに frozenRowCount が保存される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'freeze_test');

                // 1行目（rowIndex=0、Slimeの行）を右クリックして固定
                await rightClickRowHeaderAsync(table, 0);
                await clickContextMenuItemAsync(page, 'この行まで固定');

                // saveFreezeStateAsync は fire-and-forget のため非同期書き込み完了を poll で待機する
                await expect.poll(async () => {
                    const text = await readMockFileAsync(page, 'schema/freeze_test.json');
                    return JSON.parse(text).frozenRowCount;
                }).toBe(1);
            },
        );

        test(
            '行の固定を解除するとスキーマから frozenRowCount が消える',
            async ({ page }) => {
                const table = await openTableAsync(page, 'freeze_test');

                // まず行を固定する
                await rightClickRowHeaderAsync(table, 0);
                await clickContextMenuItemAsync(page, 'この行まで固定');

                // 固定が保存されていることを確認（saveFreezeStateAsync は fire-and-forget のため poll で待機）
                await expect.poll(async () => {
                    const text = await readMockFileAsync(page, 'schema/freeze_test.json');
                    return JSON.parse(text).frozenRowCount;
                }).toBe(1);

                // 行の固定を解除する
                await rightClickRowHeaderAsync(table, 0);
                await clickContextMenuItemAsync(page, '行の固定を解除');

                // frozenRowCount フィールドが除去されていることを確認（saveFreezeStateAsync は非同期のため poll で待機）
                await expect.poll(async () => {
                    const text = await readMockFileAsync(page, 'schema/freeze_test.json');
                    return JSON.parse(text).frozenRowCount;
                }).toBeUndefined();
            },
        );

        test(
            'frozenColumnCount がスキーマにあるテーブルを開くと列固定が復元される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'freeze_test');

                // 列を固定してスキーマに保存
                await rightClickColumnHeaderAsync(table, 1);
                await clickContextMenuItemAsync(page, '先頭からこの列まで固定');

                // saveFreezeStateAsync の非同期書き込み完了を待機してからタブを閉じる
                await expect.poll(async () => {
                    const text = await readMockFileAsync(page, 'schema/freeze_test.json');
                    return JSON.parse(text).frozenColumnCount;
                }).toBe(2);

                // タブを閉じる（タブの×ボタン）
                const tabButton = page.locator('.tab-button', { hasText: 'freeze_test' });
                const closeButton = tabButton.locator('.tab-button-close');
                await closeButton.click();

                // テーブルを再度開く
                const reopenedTable = await openTableAsync(page, 'freeze_test');

                // 固定列（id: colIndex=0）のデータセルが sticky になっている
                const idStyles = await getColumnCellStylesAsync(reopenedTable, 0);
                for (const style of idStyles) {
                    expect(style.position).toBe('sticky');
                }

                // 固定列（name: colIndex=1）のデータセルも sticky になっている
                const nameStyles = await getColumnCellStylesAsync(reopenedTable, 1);
                for (const style of nameStyles) {
                    expect(style.position).toBe('sticky');
                }

                // 非固定列（hp: colIndex=2）は sticky でないこと
                const hpStyles = await getColumnCellStylesAsync(reopenedTable, 2);
                for (const style of hpStyles) {
                    expect(style.position).not.toBe('sticky');
                }
            },
        );

        test(
            'frozenRowCount がスキーマにあるテーブルを開くと行固定が復元される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'freeze_test');

                // 行を固定してスキーマに保存
                await rightClickRowHeaderAsync(table, 0);
                await clickContextMenuItemAsync(page, 'この行まで固定');

                // saveFreezeStateAsync の非同期書き込み完了を待機してからタブを閉じる
                await expect.poll(async () => {
                    const text = await readMockFileAsync(page, 'schema/freeze_test.json');
                    return JSON.parse(text).frozenRowCount;
                }).toBe(1);

                // タブを閉じる
                const tabButton = page.locator('.tab-button', { hasText: 'freeze_test' });
                const closeButton = tabButton.locator('.tab-button-close');
                await closeButton.click();

                // テーブルを再度開く
                const reopenedTable = await openTableAsync(page, 'freeze_test');

                // 固定行（rowIndex=0）の table-row が sticky になっている
                const rowStyle = await getRowStyleAsync(reopenedTable, 0);
                expect(rowStyle.position).toBe('sticky');

                // 非固定行（rowIndex=1）の table-row は sticky でないこと
                const nonFrozenStyle = await getRowStyleAsync(reopenedTable, 1);
                expect(nonFrozenStyle.position).not.toBe('sticky');
            },
        );

        test(
            '行固定と列固定を保存したテーブルを開き直してスクロールしても固定列が維持される',
            async ({ page }) => {
                const fs = createCombinedFreezeTestFileSystem();
                await installMockApiAsync(page, fs);
                await page.goto('/');

                const table = await openTableAsync(page, 'freeze_combo');

                await rightClickColumnHeaderAsync(table, 1);
                await clickContextMenuItemAsync(page, '先頭からこの列まで固定');
                await rightClickRowHeaderAsync(table, 0);
                await clickContextMenuItemAsync(page, 'この行まで固定');

                await expect.poll(async () => {
                    const text = await readMockFileAsync(page, 'schema/freeze_combo.json');
                    const json = JSON.parse(text);
                    return { frozenColumnCount: json.frozenColumnCount, frozenRowCount: json.frozenRowCount };
                }).toEqual({ frozenColumnCount: 2, frozenRowCount: 1 });

                const tabButton = page.locator('.tab-button', { hasText: 'freeze_combo' });
                await tabButton.locator('.tab-button-close').click();

                const reopenedTable = await openTableAsync(page, 'freeze_combo');
                const scrollContainer = page.locator('.editor-left-pane');
                await scrollContainer.evaluate((el) => {
                    el.scrollTop = 500 * 21;
                    el.scrollLeft = 600;
                });

                const frozenRow = reopenedTable.locator('.editor-table-row:not(.editor-table-empty-row)')
                    .filter({ has: page.locator('.editor-table-row-header[data-row-index="0"]') });
                await expect(frozenRow).toHaveCount(1);
                const frozenRowStyle = await frozenRow.first().evaluate((el) => {
                    const cs = window.getComputedStyle(el);
                    return { position: cs.position, top: cs.top };
                });
                expect(frozenRowStyle.position).toBe('sticky');
                expect(parseInt(frozenRowStyle.top)).toBeGreaterThan(0);

                const scrolledRow = reopenedTable.locator('.editor-table-row:not(.editor-table-empty-row)')
                    .filter({ has: page.locator('.editor-table-row-header[data-row-index="500"]') });
                await expect(scrolledRow).toHaveCount(1);

                const idCellStyle = await getCellStickyStyleAsync(
                    scrolledRow.first().locator('.editor-table-cell:not(.editor-table-row-header)').nth(0),
                );
                expect(idCellStyle.position).toBe('sticky');
                expect(parseInt(idCellStyle.left)).toBeGreaterThan(40);

                const nameCellStyle = await getCellStickyStyleAsync(
                    scrolledRow.first().locator('.editor-table-cell:not(.editor-table-row-header)').nth(1),
                );
                expect(nameCellStyle.position).toBe('sticky');
                expect(parseInt(nameCellStyle.left)).toBeGreaterThan(parseInt(idCellStyle.left));
            },
        );
    });

    test.describe('ミニテーブルでの無効化', () => {
        test.beforeEach(async ({ page }) => {
            const fs = createMiniTableFreezeTestFileSystem();
            await installMockApiAsync(page, fs);
            await page.goto('/');
            await enableRelationsPanelAsync(page);
        });

        test(
            'ミニテーブルの列ヘッダー右クリックでフリーズメニューが表示されない',
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

                // ミニテーブルの列ヘッダーを右クリック
                const header = miniTable.locator('.editor-table-column-header').first();
                await header.click({ button: 'right' });

                // コンテキストメニューは表示されるが、フリーズメニュー項目は含まれないこと
                const menu = page.locator('.context-menu.visible');
                await expect(menu).toBeVisible();
                const freezeItem = menu.locator('.context-menu-item', { hasText: '固定' });
                await expect(freezeItem).toHaveCount(0);
            },
        );
    });
});
