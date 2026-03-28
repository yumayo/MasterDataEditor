import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';
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
 * 指定行の全データセルの computed style を取得する
 * rowIndex: 0始まり（ヘッダー行を除くデータ行）
 * 戻り値: 各セルの { position, top } オブジェクト配列
 */
async function getRowCellStylesAsync(
    table: Locator, rowIndex: number,
): Promise<Array<{ position: string; top: string }>> {
    const row = table.locator('.editor-table-row:not(.editor-table-empty-row)').nth(rowIndex + 1);
    const cells = row.locator('.editor-table-cell:not(.editor-table-row-header)');
    const count = await cells.count();
    const styles: Array<{ position: string; top: string }> = [];
    for (let i = 0; i < count; i++) {
        const style = await cells.nth(i).evaluate((el) => {
            const cs = window.getComputedStyle(el);
            return { position: cs.position, top: cs.top };
        });
        styles.push(style);
    }
    return styles;
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

                // id列の left 値は行ヘッダー幅（40px）であること
                for (const style of idStyles) {
                    expect(style.left).toBe('40px');
                }

                // name列の left 値は行ヘッダー幅(40px) + id列の幅 であること（40pxより大きい）
                for (const style of nameStyles) {
                    const leftPx = parseInt(style.left);
                    expect(leftPx).toBeGreaterThan(40);
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

                // 固定行（rowIndex=0）のデータセルが sticky になっている
                const rowStyles = await getRowCellStylesAsync(table, 0);
                for (const style of rowStyles) {
                    expect(style.position).toBe('sticky');
                }

                // top 値はヘッダー行の高さ分のオフセットがある（0pxより大きい）
                for (const style of rowStyles) {
                    const topPx = parseInt(style.top);
                    expect(topPx).toBeGreaterThan(0);
                }

                // 非固定行（rowIndex=1）は sticky でないこと
                const nonFrozenStyles = await getRowCellStylesAsync(table, 1);
                for (const style of nonFrozenStyles) {
                    expect(style.position).not.toBe('sticky');
                }

                // 最後の固定行に freeze-row-border クラスが付与される
                const frozenRow = table.locator('.editor-table-row:not(.editor-table-empty-row)').nth(1);
                const frozenRowHeader = frozenRow.locator('.editor-table-row-header');
                await expect(frozenRowHeader).toHaveClass(/freeze-row-border/);
            },
        );

        test(
            '固定行の行ヘッダーにposition:stickyが適用される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'freeze_test');

                // 1行目（rowIndex=0、Slimeの行）を右クリックして固定
                await rightClickRowHeaderAsync(table, 0);
                await clickContextMenuItemAsync(page, 'この行まで固定');

                // 固定行の行ヘッダーが sticky であること（縦スクロール固定のため）
                const headerStyle = await getRowHeaderStyleAsync(table, 0);
                expect(headerStyle.position).toBe('sticky');

                // top 値がヘッダー行の高さ分のオフセットを持つ（0pxより大きい）
                const topPx = parseInt(headerStyle.top);
                expect(topPx).toBeGreaterThan(0);
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
