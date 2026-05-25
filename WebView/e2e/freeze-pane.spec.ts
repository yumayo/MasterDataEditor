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
//   固定されたセル/行は detached layer + transform でスクロール量を相殺して表示する。
//   最後の固定列/行には影クラス（freeze-column-border / freeze-row-border）が付与される。
//   ミニテーブルではフリーズメニューを表示しない。
//
// テストケース一覧:
//   1. 列ヘッダー右クリックで「先頭からこの列まで固定」メニューが表示される
//   2. 列を固定するとスクロールしても列位置が維持される
//   3. 固定列の右端に影が表示される
//   4. 固定列を解除すると位置固定が解除される
//   5. 行ヘッダー右クリックで「この行まで固定」メニューが表示される
//   6. 行を固定するとスクロールしても行位置が維持される
//   7. 固定行の行ヘッダーに固定用レイヤーが適用される
//   8. 固定行のデータセルに不透明な背景色が設定される
//   9. 固定列のデータセルに不透明な背景色が設定される
//   10. 4領域構成で固定行上をドラッグしても選択終端行が下へずれない
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

function createFrozenDropdownTestFileSystem(): MockFileSystem {
    return {
        "schema/category.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
            ],
            primary_key: ["id"],
        }),
        "data/category.csv": [
            "id,name",
            "1,weapon",
            "2,armor",
        ].join("\n"),
        "schema/frozen_dropdown_test.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "category_id", type: "int", reference: "category.id" },
                { key: 2, name: "name", type: "string" },
            ],
            primary_key: ["id"],
            frozenRowCount: 1,
            frozenColumnCount: 2,
        }),
        "data/frozen_dropdown_test.csv": [
            "id,category_id,name",
            "1,1,sword",
            "2,2,shield",
        ].join("\n"),
    };
}

/**
 * 多数の固定行を持つテーブルの描画回帰検証用ファイルシステム。
 * fixed row の背景プレートと本文セルの重なり順が崩れると、
 * 固定領域が空白化したり下層の通常行が透けたりする。
 */
function createFreezeVisualRegressionFileSystem(): MockFileSystem {
    const rows: string[] = ['id,recover_stamina,recover_hp,attack,defence,speed,skill_id,selling_price'];
    for (let i = 1; i <= 80; i++) {
        rows.push([
            `${i}`,
            `${(i * 3) % 17 + 1}`,
            `${(i * 7) % 19 + 1}`,
            `${(i * 5) % 20 + 1}`,
            `${(i * 11) % 15 + 1}`,
            `${(i * 13) % 12 + 1}`,
            `${(i * 17) % 100 + 1}`,
            `${(i * 379) % 5000 + 50}`,
        ].join(','));
    }

    return {
        "schema/freeze_visual_regression.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int", comment: "ID", width: 199 },
                { key: 1, name: "recover_stamina", type: "int", comment: "スタミナ回復量", width: 100 },
                { key: 2, name: "recover_hp", type: "int", comment: "HP回復量", width: 100 },
                { key: 3, name: "attack", type: "int", comment: "攻撃力", width: 100 },
                { key: 4, name: "defence", type: "int", comment: "防御力", width: 100 },
                { key: 5, name: "speed", type: "int", comment: "速度", width: 100 },
                { key: 6, name: "skill_id", type: "int", comment: "スキルID", width: 100 },
                { key: 7, name: "selling_price", type: "int", comment: "売却価格", width: 100 },
            ],
            primary_key: ["id"],
            frozenRowCount: 12,
        }),
        "data/freeze_visual_regression.csv": rows.join("\n"),
    };
}

/**
 * コメント付きヘッダー + 固定行 + 固定列の縦位置整合回帰検証用ファイルシステム。
 * 4領域化で左側ペインの開始位置が列ヘッダー高さぶんずれると、
 * 同じ行でも固定列セルと通常セルの Y 座標が一致しなくなる。
 */
function createQuadrantHeaderOffsetRegressionFileSystem(): MockFileSystem {
    const rows: string[] = ['id,recover_stamina,recover_hp,attack,defence,speed,skill_id,selling_price'];
    for (let i = 1; i <= 80; i++) {
        rows.push([
            `${i}`,
            `${(i * 3) % 17 + 1}`,
            `${(i * 7) % 19 + 1}`,
            `${(i * 5) % 20 + 1}`,
            `${(i * 11) % 15 + 1}`,
            `${(i * 13) % 12 + 1}`,
            `${(i * 17) % 100 + 1}`,
            `${(i * 379) % 5000 + 50}`,
        ].join(','));
    }

    return {
        "schema/quadrant_header_offset.json": JSON.stringify({
            description: "キャラマスター",
            header: [
                { key: 0, name: "id", type: "int", comment: "ID", width: 173 },
                { key: 1, name: "recover_stamina", type: "int", comment: "スタミナ回復量", width: 100 },
                { key: 2, name: "recover_hp", type: "int", comment: "HP回復量", width: 100 },
                { key: 3, name: "attack", type: "int", comment: "攻撃力", width: 100 },
                { key: 4, name: "defence", type: "int", comment: "防御力", width: 100 },
                { key: 5, name: "speed", type: "int", comment: "速度", width: 100 },
                { key: 6, name: "skill_id", type: "int", comment: "スキルID", width: 100 },
                { key: 7, name: "selling_price", type: "int", comment: "売却価格", width: 100 },
            ],
            primary_key: ["id"],
            frozenRowCount: 12,
            frozenColumnCount: 2,
        }),
        "data/quadrant_header_offset.csv": rows.join("\n"),
    };
}

/**
 * 先頭の文字列列を固定したときの水平境界回帰検証用ファイルシステム。
 * 行ヘッダー幅が固定列境界に加算されていないと、最初の非固定列（id）が左へ食い込む。
 */
function createFrozenNameColumnAlignmentFileSystem(): MockFileSystem {
    return {
        "schema/frozen_name_column_alignment.json": JSON.stringify({
            description: "キャラマスター",
            header: [
                { key: 0, name: "chara", type: "string", comment: "キャラマスター", width: 200 },
                { key: 1, name: "id", type: "int", comment: "ID", width: 100 },
                { key: 2, name: "recover_hp", type: "int", comment: "HP回復量", width: 100 },
                { key: 3, name: "attack", type: "int", comment: "攻撃力", width: 100 },
                { key: 4, name: "defence", type: "int", comment: "防御力", width: 100 },
                { key: 5, name: "speed", type: "int", comment: "速度", width: 100 },
                { key: 6, name: "skill_id", type: "int", comment: "スキルID", width: 100 },
                { key: 7, name: "selling_price", type: "int", comment: "売却価格", width: 100 },
            ],
            primary_key: ["id"],
            frozenRowCount: 12,
            frozenColumnCount: 1,
        }),
        "data/frozen_name_column_alignment.csv": [
            "chara,id,recover_hp,attack,defence,speed,skill_id,selling_price",
            "アリス,1,8,6,12,2,18,429",
            "ボブ,2,15,11,8,3,35,808",
            "キャロル,3,3,16,4,4,52,1187",
            "デイビッド,4,10,1,15,5,69,1566",
            "エヴァ,5,17,6,11,6,86,1945",
            "フランク,6,5,11,7,7,3,2324",
            "グレース,7,12,16,3,8,20,2703",
            "ヘンリー,8,19,1,14,9,37,3082",
            "アイビー,9,7,6,10,10,54,3461",
            "ジャック,10,14,11,6,11,71,3840",
            "ケイト,11,2,16,2,12,88,4219",
            "ルナ,12,9,1,13,1,5,4598",
            "マヤ,13,6,16,6,9,22,977",
            "ネイト,14,9,4,11,5,39,1356",
            "オリビア,15,12,11,16,1,56,1735",
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

async function getTableScrollContainerAsync(page: Page): Promise<Locator> {
    const mainViewport = page.locator('.editor-left-pane .editor-table-main-viewport');
    if (await mainViewport.count() > 0) {
        return mainViewport;
    }
    return page.locator('.editor-left-pane');
}

/**
 * 列ヘッダーを右クリックしてコンテキストメニューを開く
 * colIndex: 0始まり（行ヘッダーを除くデータ列）
 */
async function rightClickColumnHeaderAsync(table: Locator, colIndex: number): Promise<void> {
    const header = getVisibleColumnHeaderLocator(table, colIndex);
    await header.click({ button: 'right' });
}

/**
 * 行ヘッダーを右クリックしてコンテキストメニューを開く
 * rowIndex: 0始まり（ヘッダー行を除くデータ行）
 */
async function rightClickRowHeaderAsync(table: Locator, rowIndex: number): Promise<void> {
    const header = table.locator('.editor-table-detached-row-header-layer .editor-table-row-header').nth(rowIndex);
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
    const detachedCell = table.locator([
        `.editor-table-detached-frozen-corner-layer .editor-table-detached-row[data-row-index="${rowIndex}"] .editor-table-cell[data-col="${columnIndex}"]`,
        `.editor-table-detached-frozen-row-layer .editor-table-detached-row[data-row-index="${rowIndex}"] .editor-table-cell[data-col="${columnIndex}"]`,
        `.editor-table-detached-row-header-layer .editor-table-detached-row[data-row-index="${rowIndex}"] .editor-table-cell[data-col="${columnIndex}"]`,
    ].join(',')).first();
    if (await detachedCell.count() > 0) {
        await detachedCell.click();
        return;
    }
    const row = table.locator('.editor-table-row:not(.editor-table-column-header-row):not(.editor-table-empty-row)').nth(rowIndex);
    const cell = row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(columnIndex);
    await cell.click();
}

function getVisibleColumnHeaderLocator(table: Locator, columnIndex: number): Locator {
    return table.locator([
        `.editor-table-pane-top-left .editor-table-column-header[data-column-index="${columnIndex}"]`,
        `.editor-table-pane-top-right .editor-table-column-header[data-column-index="${columnIndex}"]`,
        `.editor-table-detached-column-header-layer .editor-table-column-header[data-column-index="${columnIndex}"]`,
    ].join(',')).first();
}

async function getColumnHeaderTextCenterOffsetAsync(header: Locator): Promise<number> {
    return await header.evaluate((element) => {
        const nameElement = element.querySelector('.column-header-name');
        const commentElement = element.querySelector('.column-header-comment');
        if (!(nameElement instanceof HTMLElement) || !(commentElement instanceof HTMLElement)) {
            throw new Error('comment付き列ヘッダーの name/comment 要素が見つかりません');
        }
        const headerRect = element.getBoundingClientRect();
        const nameRect = nameElement.getBoundingClientRect();
        const commentRect = commentElement.getBoundingClientRect();
        const textCenter = (Math.min(nameRect.top, commentRect.top) + Math.max(nameRect.bottom, commentRect.bottom)) / 2;
        const headerCenter = (headerRect.top + headerRect.bottom) / 2;
        return Math.abs(textCenter - headerCenter);
    });
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
    const header = table.locator('.editor-table-detached-row-header-layer .editor-table-row-header').nth(rowIndex);
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
 * 指定列のデータセル（全データ行）の computed style とビューポート座標を取得する
 * colIndex: 0始まり（行ヘッダーを除くデータ列）
 * 戻り値: 各行の { position, transform, viewportLeft } オブジェクト配列
 */
async function getColumnCellStylesAsync(
    table: Locator, colIndex: number,
): Promise<Array<{ position: string; transform: string; viewportLeft: number }>> {
    return table.evaluate((tableElement, targetColumnIndex) => {
        const dataRows = Array.from(tableElement.querySelectorAll<HTMLElement>('.editor-table-row:not(.editor-table-column-header-row):not(.editor-table-empty-row)'));
        return dataRows.map((rowElement) => {
            const rowHeader = rowElement.querySelector<HTMLElement>('.editor-table-row-header');
            const rowIndexText = rowHeader?.dataset.rowIndex ?? '';
            const detachedCell =
                tableElement.querySelector<HTMLElement>(`.editor-table-detached-frozen-corner-layer .editor-table-detached-row[data-row-index="${rowIndexText}"] .editor-table-cell[data-col="${targetColumnIndex}"]`)
                ?? tableElement.querySelector<HTMLElement>(`.editor-table-detached-row-header-layer .editor-table-detached-row[data-row-index="${rowIndexText}"] .editor-table-cell[data-col="${targetColumnIndex}"]`);
            const sourceCell = rowElement.querySelectorAll<HTMLElement>('.editor-table-cell:not(.editor-table-row-header)')[targetColumnIndex];
            const targetCell = detachedCell ?? sourceCell;
            if (!(targetCell instanceof HTMLElement)) throw new Error(`列セルが見つかりません: rowIndex=${rowIndexText}, colIndex=${targetColumnIndex}`);
            const cs = window.getComputedStyle(targetCell);
            return { position: cs.position, transform: cs.transform, viewportLeft: targetCell.getBoundingClientRect().left };
        });
    }, colIndex);
}

/**
 * 指定行の固定本文セルの computed style とビューポート座標を取得する
 * rowIndex: 0始まり（ヘッダー行を除くデータ行）
 * 戻り値: { position, transform, viewportTop } オブジェクト
 */
async function getRowStyleAsync(
    table: Locator, rowIndex: number,
): Promise<{ position: string; transform: string; viewportTop: number }> {
    return table.evaluate((tableElement, targetRowIndex) => {
        const detachedRow = tableElement.querySelector<HTMLElement>(`.editor-table-detached-frozen-row-layer .editor-table-detached-row[data-row-index="${targetRowIndex}"]`);
        if (detachedRow instanceof HTMLElement) {
            const firstDataCell = detachedRow.querySelector<HTMLElement>('.editor-table-cell');
            if (!(firstDataCell instanceof HTMLElement)) throw new Error('固定行の分離本文セルが見つかりません');
            const rowStyle = window.getComputedStyle(detachedRow);
            const cellStyle = window.getComputedStyle(firstDataCell);
            return { position: rowStyle.position, transform: cellStyle.transform, viewportTop: firstDataCell.getBoundingClientRect().top };
        }
        const sourceRow = tableElement.querySelectorAll<HTMLElement>('.editor-table-row:not(.editor-table-column-header-row):not(.editor-table-empty-row)')[targetRowIndex];
        if (!(sourceRow instanceof HTMLElement)) throw new Error(`固定行が見つかりません: rowIndex=${targetRowIndex}`);
        const firstDataCell = sourceRow.querySelector<HTMLElement>('.editor-table-cell:not(.editor-table-row-header)');
        if (!(firstDataCell instanceof HTMLElement)) throw new Error('固定行の本文セルが見つかりません');
        const rowStyle = window.getComputedStyle(sourceRow);
        const cellStyle = window.getComputedStyle(firstDataCell);
        return { position: rowStyle.position, transform: cellStyle.transform, viewportTop: firstDataCell.getBoundingClientRect().top };
    }, rowIndex);
}

/**
 * 指定行の分離行ヘッダーの computed style を取得する
 * rowIndex: 0始まり（ヘッダー行を除くデータ行）
 * 戻り値: { position, transform, zIndex }
 */
async function getRowHeaderStyleAsync(
    table: Locator, rowIndex: number,
): Promise<{ position: string; transform: string; zIndex: string }> {
    return table.evaluate((tableElement, targetRowIndex) => {
        const header =
            tableElement.querySelector<HTMLElement>(`.editor-table-detached-frozen-corner-layer .editor-table-detached-row[data-row-index="${targetRowIndex}"] .editor-table-row-header`)
            ?? tableElement.querySelector<HTMLElement>(`.editor-table-detached-row-header-layer .editor-table-detached-row[data-row-index="${targetRowIndex}"] .editor-table-row-header`);
        if (!(header instanceof HTMLElement)) throw new Error(`行ヘッダーが見つかりません: rowIndex=${targetRowIndex}`);
        const cellStyle = window.getComputedStyle(header);
        const layerStyle = window.getComputedStyle((header.closest('.editor-table-detached-layer') as HTMLElement) ?? header);
        return {
            position: cellStyle.position,
            transform: cellStyle.transform,
            zIndex: cellStyle.zIndex === 'auto' ? layerStyle.zIndex : cellStyle.zIndex,
        };
    }, rowIndex);
}

/**
 * 指定セルの computed background-color を取得する
 * 透明（rgba(0,0,0,0)）でないことの検証に使う
 */
async function getCellBackgroundColorAsync(cell: Locator): Promise<string> {
    return cell.evaluate((el) => window.getComputedStyle(el).backgroundColor);
}

/**
 * 指定セルの固定関連スタイルを取得する
 */
async function getCellFreezeStyleAsync(cell: Locator): Promise<{ position: string; transform: string; viewportLeft: number; viewportTop: number }> {
    return cell.evaluate((el) => {
        const tableElement = el.closest('.editor-table');
        const rowElement = el.parentElement;
        const rowHeader = rowElement?.querySelector<HTMLElement>('.editor-table-row-header');
        const rowIndexText = rowHeader?.dataset.rowIndex ?? '';
        const columnIndexText = el.dataset.col ?? '';
        const detachedCell =
            tableElement?.querySelector<HTMLElement>(`.editor-table-detached-frozen-corner-layer .editor-table-detached-row[data-row-index="${rowIndexText}"] .editor-table-cell[data-col="${columnIndexText}"]`)
            ?? tableElement?.querySelector<HTMLElement>(`.editor-table-detached-row-header-layer .editor-table-detached-row[data-row-index="${rowIndexText}"] .editor-table-cell[data-col="${columnIndexText}"]`);
        const targetCell = detachedCell ?? el;
        if (!(targetCell instanceof HTMLElement)) throw new Error('固定セルが見つかりません');
        const cs = window.getComputedStyle(targetCell);
        const rect = targetCell.getBoundingClientRect();
        return { position: cs.position, transform: cs.transform, viewportLeft: rect.left, viewportTop: rect.top };
    });
}

async function getVisibleCellRectAsync(
    table: Locator, rowIndex: number, columnIndex: number,
): Promise<{ top: number; left: number; width: number; height: number }> {
    return table.evaluate((tableElement, target) => {
        const detachedSelectors = [
            `.editor-table-detached-frozen-corner-layer .editor-table-detached-row[data-row-index="${target.rowIndex}"] .editor-table-cell[data-col="${target.columnIndex}"]`,
            `.editor-table-detached-frozen-row-layer .editor-table-detached-row[data-row-index="${target.rowIndex}"] .editor-table-cell[data-col="${target.columnIndex}"]`,
            `.editor-table-detached-row-header-layer .editor-table-detached-row[data-row-index="${target.rowIndex}"] .editor-table-cell[data-col="${target.columnIndex}"]`,
        ];
        for (const selector of detachedSelectors) {
            const detachedCell = tableElement.querySelector<HTMLElement>(selector);
            if (detachedCell instanceof HTMLElement) {
                const rect = detachedCell.getBoundingClientRect();
                return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
            }
        }

        const rows = Array.from(tableElement.querySelectorAll<HTMLElement>('.editor-table-row:not(.editor-table-column-header-row):not(.editor-table-empty-row)'));
        const sourceRow = rows.find((rowElement) => rowElement.querySelector<HTMLElement>('.editor-table-row-header')?.dataset.rowIndex === String(target.rowIndex));
        if (!(sourceRow instanceof HTMLElement)) {
            throw new Error(`行が見つかりません: rowIndex=${target.rowIndex}`);
        }
        const sourceCell = sourceRow.querySelectorAll<HTMLElement>('.editor-table-cell:not(.editor-table-row-header)')[target.columnIndex];
        if (!(sourceCell instanceof HTMLElement)) {
            throw new Error(`セルが見つかりません: rowIndex=${target.rowIndex}, columnIndex=${target.columnIndex}`);
        }
        const rect = sourceCell.getBoundingClientRect();
        return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
    }, { rowIndex, columnIndex });
}

async function dragSelectionAsync(
    page: Page, table: Locator, startRowIndex: number, startColumnIndex: number, endRowIndex: number, endColumnIndex: number,
): Promise<void> {
    const startRect = await getVisibleCellRectAsync(table, startRowIndex, startColumnIndex);
    const endRect = await getVisibleCellRectAsync(table, endRowIndex, endColumnIndex);

    await page.mouse.move(
        startRect.left + startRect.width / 2,
        startRect.top + startRect.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
        endRect.left + endRect.width / 2,
        endRect.top + endRect.height / 2,
        { steps: 8 },
    );
    await page.mouse.up();
}

async function getActiveSelectionRangeAsync(page: Page): Promise<{
    startRow: number;
    startColumn: number;
    endRow: number;
    endColumn: number;
} | null> {
    return await page.evaluate(() => {
        type CellRangeForTest = {
            startRow: number;
            startColumn: number;
            endRow: number;
            endColumn: number;
        };
        type ActiveEditorTableForTest = {
            selection: {
                getSelectionRange(): CellRangeForTest;
            };
            dataColumnOffset(): number;
        };

        const editor = (window as unknown as { editor?: { activeEditorTable: ActiveEditorTableForTest | false } }).editor;
        if (!editor || editor.activeEditorTable === false) return null;

        const activeEditorTable = editor.activeEditorTable;
        const range = activeEditorTable.selection.getSelectionRange();
        const dataColumnOffset = activeEditorTable.dataColumnOffset();
        return {
            startRow: range.startRow - 1,
            startColumn: range.startColumn - dataColumnOffset,
            endRow: range.endRow - 1,
            endColumn: range.endColumn - dataColumnOffset,
        };
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
            '列を固定すると横スクロールしても固定列の位置が維持される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'freeze_test');

                // "name"列（インデックス1）を右クリックして固定
                // id, name の2列が固定される
                await rightClickColumnHeaderAsync(table, 1);
                await clickContextMenuItemAsync(page, '先頭からこの列まで固定');

                const initialIdStyles = await getColumnCellStylesAsync(table, 0);
                const initialNameStyles = await getColumnCellStylesAsync(table, 1);
                const initialHpStyles = await getColumnCellStylesAsync(table, 2);

                const scrollContainer = await getTableScrollContainerAsync(page);
                await scrollContainer.evaluate((el) => { el.scrollLeft = 220; });
                await page.waitForTimeout(100);

                const scrolledIdStyles = await getColumnCellStylesAsync(table, 0);
                const scrolledNameStyles = await getColumnCellStylesAsync(table, 1);
                const scrolledHpStyles = await getColumnCellStylesAsync(table, 2);

                for (let i = 0; i < scrolledIdStyles.length; i++) {
                    expect(Math.abs(scrolledIdStyles[i].viewportLeft - initialIdStyles[i].viewportLeft)).toBeLessThanOrEqual(2);
                }
                for (let i = 0; i < scrolledNameStyles.length; i++) {
                    expect(Math.abs(scrolledNameStyles[i].viewportLeft - initialNameStyles[i].viewportLeft)).toBeLessThanOrEqual(2);
                    expect(scrolledNameStyles[i].viewportLeft).toBeGreaterThan(scrolledIdStyles[i].viewportLeft);
                }
                for (let i = 0; i < scrolledHpStyles.length; i++) {
                    expect(scrolledHpStyles[i].viewportLeft).toBeLessThan(initialHpStyles[i].viewportLeft - 100);
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
                const nameHeader = getVisibleColumnHeaderLocator(table, 1);
                await expect(nameHeader).toHaveClass(/freeze-column-border/);

                // 最初の固定列（id）には freeze-column-border が付与されない
                const idHeader = getVisibleColumnHeaderLocator(table, 0);
                await expect(idHeader).not.toHaveClass(/freeze-column-border/);

                // 非固定列（hp）にも freeze-column-border が付与されない
                const hpHeader = getVisibleColumnHeaderLocator(table, 2);
                await expect(hpHeader).not.toHaveClass(/freeze-column-border/);
            },
        );

        test(
            '固定列を解除すると横スクロール時に通常列として流れる',
            async ({ page }) => {
                const table = await openTableAsync(page, 'freeze_test');

                // まず列を固定する
                await rightClickColumnHeaderAsync(table, 1);
                await clickContextMenuItemAsync(page, '先頭からこの列まで固定');

                const scrollContainer = await getTableScrollContainerAsync(page);
                await scrollContainer.evaluate((el) => { el.scrollLeft = 220; });
                await page.waitForTimeout(100);

                const beforeStyles = await getColumnCellStylesAsync(table, 0);
                for (const style of beforeStyles) expect(style.viewportLeft).toBeGreaterThanOrEqual(0);

                // 列ヘッダーを右クリックして「列の固定を解除」を選択
                await rightClickColumnHeaderAsync(table, 0);
                const menu = page.locator('.context-menu.visible');
                await expect(menu).toBeVisible();
                await clickContextMenuItemAsync(page, '列の固定を解除');

                // 固定が解除され、同じ scrollLeft では左へ流れること
                const afterStyles = await getColumnCellStylesAsync(table, 0);
                for (let i = 0; i < afterStyles.length; i++) {
                    expect(afterStyles[i].viewportLeft).toBeLessThan(beforeStyles[i].viewportLeft - 100);
                }

                // freeze-column-border クラスも除去されていること
                const nameHeader = getVisibleColumnHeaderLocator(table, 1);
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
            '行を固定すると縦スクロールしても固定行の位置が維持される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'freeze_test');

                // 1行目（rowIndex=0、Slimeの行）を右クリックして固定
                await rightClickRowHeaderAsync(table, 0);
                await clickContextMenuItemAsync(page, 'この行まで固定');

                const initialFrozenRowStyle = await getRowStyleAsync(table, 0);

                const scrollContainer = await getTableScrollContainerAsync(page);
                await scrollContainer.evaluate((el) => { el.scrollTop = 140; });
                await page.waitForTimeout(100);

                const frozenRowStyle = await getRowStyleAsync(table, 0);
                expect(Math.abs(frozenRowStyle.viewportTop - initialFrozenRowStyle.viewportTop)).toBeLessThanOrEqual(2);

                // 最後の固定行の table-row に freeze-row-border クラスが付与される
                const frozenRow = table.locator(
                    '.editor-table-grid .editor-table-row:not(.editor-table-empty-row):has(.editor-table-row-header[data-row-index="0"])',
                );
                await expect(frozenRow).toHaveClass(/freeze-row-border/);
            },
        );

        test(
            '行を固定するとスクロール時の透け防止用背景プレートが生成される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'freeze_test');

                await rightClickRowHeaderAsync(table, 0);
                await clickContextMenuItemAsync(page, 'この行まで固定');

                const backgroundPlate = table.locator('.editor-table-detached-frozen-row-background-layer .editor-table-detached-frozen-row-background').first();
                await expect(backgroundPlate).toBeVisible();

                const initialPlate = await backgroundPlate.evaluate((element) => {
                    const style = window.getComputedStyle(element);
                    return { backgroundColor: style.backgroundColor, top: element.getBoundingClientRect().top };
                });
                expect(initialPlate.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');

                const scrollContainer = await getTableScrollContainerAsync(page);
                await scrollContainer.evaluate((element) => { element.scrollTop = 140; });
                await page.waitForTimeout(100);

                const scrolledPlate = await backgroundPlate.evaluate((element) => {
                    return { top: element.getBoundingClientRect().top };
                });
                expect(Math.abs(scrolledPlate.top - initialPlate.top)).toBeLessThanOrEqual(2);
            },
        );

        test(
            '多数の固定行をスクロールしても固定領域の本文が空白化・透過しない',
            async ({ page }) => {
                const fs = createFreezeVisualRegressionFileSystem();
                await installMockApiAsync(page, fs);
                await page.goto('/');

                const table = await openTableAsync(page, 'freeze_visual_regression');
                const scrollContainer = await getTableScrollContainerAsync(page);
                await scrollContainer.evaluate((element) => { element.scrollTop = 40 * 21; });
                await page.waitForTimeout(100);

                await expect(table.locator('.editor-table-row.freeze-row')).toHaveCount(12);

                const detachedFrozenRows = table.locator('.editor-table-detached-frozen-row-layer .editor-table-detached-row');
                await expect(detachedFrozenRows).toHaveCount(12);

                const lastFrozenRow = table.locator('.editor-table-row.freeze-row').nth(11);
                const firstDataCell = lastFrozenRow.locator('.editor-table-cell:not(.editor-table-row-header)').nth(0);
                const lastDataCell = lastFrozenRow.locator('.editor-table-cell:not(.editor-table-row-header)').nth(7);
                const detachedLastFrozenRow = detachedFrozenRows.nth(11);
                const detachedFirstDataCell = detachedLastFrozenRow.locator('.editor-table-cell').nth(0);
                const detachedLastDataCell = detachedLastFrozenRow.locator('.editor-table-cell').nth(7);
                const firstExpectedText = ((await firstDataCell.textContent()) ?? '').trim();
                const lastExpectedText = ((await lastDataCell.textContent()) ?? '').trim();

                await expect(detachedFirstDataCell).toHaveText(firstExpectedText);
                await expect(detachedLastDataCell).toHaveText(lastExpectedText);

                const backgroundPlate = table.locator('.editor-table-detached-frozen-row-background[data-row-index="11"]');
                await expect(backgroundPlate).toBeVisible();
            },
        );

        test(
            '列固定のあとに行固定しても固定列の位置補正が維持される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'freeze_test');

                // まず "name" 列まで固定して id / name の2列を固定する
                await rightClickColumnHeaderAsync(table, 1);
                await clickContextMenuItemAsync(page, '先頭からこの列まで固定');

                const initialIdStyles = await getColumnCellStylesAsync(table, 0);
                const initialNameStyles = await getColumnCellStylesAsync(table, 1);

                // 続けて 1 行目を固定する
                await rightClickRowHeaderAsync(table, 0);
                await clickContextMenuItemAsync(page, 'この行まで固定');

                const scrollContainer = await getTableScrollContainerAsync(page);
                await scrollContainer.evaluate((el) => {
                    el.scrollTop = 120;
                    el.scrollLeft = 220;
                });
                await page.waitForTimeout(100);

                const frozenRowStyle = await getRowStyleAsync(table, 0);

                const idStylesAfterFreezeRow = await getColumnCellStylesAsync(table, 0);
                for (let i = 0; i < idStylesAfterFreezeRow.length; i++) {
                    expect(Math.abs(idStylesAfterFreezeRow[i].viewportLeft - initialIdStyles[i].viewportLeft)).toBeLessThanOrEqual(2);
                }
                const nameStylesAfterFreezeRow = await getColumnCellStylesAsync(table, 1);
                for (let i = 0; i < nameStylesAfterFreezeRow.length; i++) {
                    expect(Math.abs(nameStylesAfterFreezeRow[i].viewportLeft - initialNameStyles[i].viewportLeft)).toBeLessThanOrEqual(2);
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

                const rowStyle = await getRowStyleAsync(table, 0);

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
                const row = table.locator('.editor-table-detached-frozen-row-layer .editor-table-detached-row[data-row-index="0"]');
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
            'コメント付きヘッダーでも固定列の非固定行がヘッダー高さぶん上にずれない',
            async ({ page }) => {
                const fs = createQuadrantHeaderOffsetRegressionFileSystem();
                await installMockApiAsync(page, fs);
                await page.goto('/');

                const table = await openTableAsync(page, 'quadrant_header_offset');

                const firstFrozenRowFixedCellRect = await getVisibleCellRectAsync(table, 0, 1);
                const firstFrozenRowMainCellRect = await getVisibleCellRectAsync(table, 0, 2);
                expect(Math.abs(firstFrozenRowFixedCellRect.top - firstFrozenRowMainCellRect.top)).toBeLessThanOrEqual(1);

                const firstScrollableRowFixedCellRect = await getVisibleCellRectAsync(table, 12, 1);
                const firstScrollableRowMainCellRect = await getVisibleCellRectAsync(table, 12, 2);
                expect(Math.abs(firstScrollableRowFixedCellRect.top - firstScrollableRowMainCellRect.top)).toBeLessThanOrEqual(1);
            },
        );

        test(
            'コメント付き固定列ヘッダーのname/commentが縦中央に配置される',
            async ({ page }) => {
                const fs = createQuadrantHeaderOffsetRegressionFileSystem();
                await installMockApiAsync(page, fs);
                await page.goto('/');

                const table = await openTableAsync(page, 'quadrant_header_offset');

                const fixedHeader = getVisibleColumnHeaderLocator(table, 1);
                const normalHeader = getVisibleColumnHeaderLocator(table, 2);
                expect(await getColumnHeaderTextCenterOffsetAsync(fixedHeader)).toBeLessThanOrEqual(1);
                expect(await getColumnHeaderTextCenterOffsetAsync(normalHeader)).toBeLessThanOrEqual(1);
            },
        );

        test(
            '先頭固定列の右端に最初の非固定列が連続して接続される',
            async ({ page }) => {
                const fs = createFrozenNameColumnAlignmentFileSystem();
                await installMockApiAsync(page, fs);
                await page.goto('/');

                const table = await openTableAsync(page, 'frozen_name_column_alignment');

                const lastFrozenHeader = getVisibleColumnHeaderLocator(table, 0);
                const firstNonFrozenHeader = getVisibleColumnHeaderLocator(table, 1);
                const lastFrozenHeaderBox = await lastFrozenHeader.boundingBox();
                const firstNonFrozenHeaderBox = await firstNonFrozenHeader.boundingBox();
                if (lastFrozenHeaderBox === null || firstNonFrozenHeaderBox === null) {
                    throw new Error('列ヘッダーの境界矩形が取得できません');
                }
                expect(Math.abs(lastFrozenHeaderBox.x + lastFrozenHeaderBox.width - firstNonFrozenHeaderBox.x)).toBeLessThanOrEqual(1);

                const frozenCellRect = await getVisibleCellRectAsync(table, 12, 0);
                const nonFrozenCellRect = await getVisibleCellRectAsync(table, 12, 1);
                expect(Math.abs(frozenCellRect.left + frozenCellRect.width - nonFrozenCellRect.left)).toBeLessThanOrEqual(1);
            },
        );

        test(
            'ズームアウト後も固定列セルと通常セルの位置と幅が一致する',
            async ({ page }) => {
                const fs = createQuadrantHeaderOffsetRegressionFileSystem();
                await installMockApiAsync(page, fs);
                await page.goto('/');

                const table = await openTableAsync(page, 'quadrant_header_offset');

                await page.evaluate(() => {
                    document.documentElement.style.zoom = '0.75';
                });
                await page.waitForTimeout(50);

                const lastFrozenHeader = getVisibleColumnHeaderLocator(table, 1);
                const firstNonFrozenHeader = getVisibleColumnHeaderLocator(table, 2);
                const lastFrozenHeaderBox = await lastFrozenHeader.boundingBox();
                const firstNonFrozenHeaderBox = await firstNonFrozenHeader.boundingBox();
                if (lastFrozenHeaderBox === null || firstNonFrozenHeaderBox === null) {
                    throw new Error('列ヘッダーの境界矩形が取得できません');
                }
                expect(Math.abs(lastFrozenHeaderBox.x + lastFrozenHeaderBox.width - firstNonFrozenHeaderBox.x)).toBeLessThanOrEqual(1);

                for (const rowIndex of [12, 24, 40]) {
                    const fixedCellRect = await getVisibleCellRectAsync(table, rowIndex, 1);
                    const normalCellRect = await getVisibleCellRectAsync(table, rowIndex, 2);
                    expect(Math.abs(fixedCellRect.top - normalCellRect.top)).toBeLessThanOrEqual(1);
                    expect(Math.abs(fixedCellRect.height - normalCellRect.height)).toBeLessThanOrEqual(1);
                }
            },
        );

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

                const initialFrozenRowStyle = await getRowStyleAsync(table, 0);

                const frozenRow = table.locator('.editor-table-row:not(.editor-table-empty-row)')
                    .filter({ has: page.locator('.editor-table-row-header[data-row-index="0"]') });
                await expect(frozenRow).toHaveCount(1);

                // 仮想スクロールで通常行が再描画される位置までスクロールする
                const scrollContainer = await getTableScrollContainerAsync(page);
                await scrollContainer.evaluate((el) => {
                    el.scrollTop = 500 * 21;
                    el.scrollLeft = 600;
                });
                await page.waitForTimeout(150);

                const frozenRowStyle = await getRowStyleAsync(table, 0);
                expect(Math.abs(frozenRowStyle.viewportTop - initialFrozenRowStyle.viewportTop)).toBeLessThanOrEqual(2);

                const scrolledRow = table.locator('.editor-table-row:not(.editor-table-empty-row)')
                    .filter({ has: page.locator('.editor-table-row-header[data-row-index="500"]') });
                await expect(scrolledRow).toHaveCount(1);

                const idCellStyle = await getCellFreezeStyleAsync(
                    scrolledRow.first().locator('.editor-table-cell:not(.editor-table-row-header)').nth(0),
                );
                expect(idCellStyle.viewportLeft).toBeGreaterThanOrEqual(0);

                const nameCellStyle = await getCellFreezeStyleAsync(
                    scrolledRow.first().locator('.editor-table-cell:not(.editor-table-row-header)').nth(1),
                );
                expect(nameCellStyle.viewportLeft).toBeGreaterThan(idCellStyle.viewportLeft);
            },
        );

        test(
            '4領域構成で右下だけが実スクロールし、右上と左下が同期する',
            async ({ page }) => {
                await page.setViewportSize({ width: 640, height: 480 });
                const table = await openTableAsync(page, 'freeze_combo');

                await rightClickColumnHeaderAsync(table, 1);
                await clickContextMenuItemAsync(page, '先頭からこの列まで固定');
                await rightClickRowHeaderAsync(table, 1);
                await clickContextMenuItemAsync(page, 'この行まで固定');

                const topLeftPane = table.locator('.editor-table-pane-top-left');
                const topRightPane = table.locator('.editor-table-pane-top-right');
                const bottomLeftPane = table.locator('.editor-table-pane-bottom-left');
                const bottomRightPane = table.locator('.editor-table-pane-bottom-right');
                const mainViewport = table.locator('.editor-table-main-viewport');
                const topViewport = table.locator('.editor-table-top-viewport');
                const leftViewport = table.locator('.editor-table-left-viewport');

                await expect(topLeftPane).toBeVisible();
                await expect(topRightPane).toBeVisible();
                await expect(bottomLeftPane).toBeVisible();
                await expect(bottomRightPane).toBeVisible();
                await expect(mainViewport).toBeVisible();
                await expect(topViewport).toBeVisible();
                await expect(leftViewport).toBeVisible();

                await page.evaluate(() => {
                    const main = document.querySelector('.editor-left-pane .editor-table-main-viewport');
                    const editor = (window as unknown as { editor?: { activeEditorTable: { refreshDetachedHeaderLayout(): void } | false } }).editor;
                    if (!(main instanceof HTMLElement)) throw new Error('main viewport が見つかりません');
                    // Playwright の overlay scrollbar では幅差が 0px になるため、
                    // 右下ビューポートに擬似ガターを与えてクラシックスクロールバー環境のずれを再現する。
                    main.style.boxSizing = 'border-box';
                    main.style.borderRight = '13px solid transparent';
                    main.style.borderBottom = '11px solid transparent';
                    if (!editor || editor.activeEditorTable === false) throw new Error('activeEditorTable が見つかりません');
                    editor.activeEditorTable.refreshDetachedHeaderLayout();
                });
                await page.waitForTimeout(50);

                const initial = await page.evaluate(() => {
                    const main = document.querySelector('.editor-left-pane .editor-table-main-viewport');
                    const top = document.querySelector('.editor-left-pane .editor-table-top-viewport');
                    const left = document.querySelector('.editor-left-pane .editor-table-left-viewport');
                    const rootScroll = document.querySelector('.editor-left-pane');
                    const topLeftCell = document.querySelector('.editor-left-pane .editor-table-pane-top-left .editor-table-cell');
                    if (!(main instanceof HTMLElement)) throw new Error('main viewport が見つかりません');
                    if (!(top instanceof HTMLElement)) throw new Error('top viewport が見つかりません');
                    if (!(left instanceof HTMLElement)) throw new Error('left viewport が見つかりません');
                    if (!(rootScroll instanceof HTMLElement)) throw new Error('editor-left-pane が見つかりません');
                    if (!(topLeftCell instanceof HTMLElement)) throw new Error('top-left cell が見つかりません');
                    const mainStyle = window.getComputedStyle(main);
                    const topStyle = window.getComputedStyle(top);
                    const leftStyle = window.getComputedStyle(left);
                    return {
                        mainOverflowX: mainStyle.overflowX,
                        mainOverflowY: mainStyle.overflowY,
                        topOverflowX: topStyle.overflowX,
                        topOverflowY: topStyle.overflowY,
                        leftOverflowX: leftStyle.overflowX,
                        leftOverflowY: leftStyle.overflowY,
                        mainClientWidth: main.clientWidth,
                        mainClientHeight: main.clientHeight,
                        topViewportWidth: Math.round(top.getBoundingClientRect().width),
                        leftViewportHeight: Math.round(left.getBoundingClientRect().height),
                        mainScrollbarWidth: main.offsetWidth - main.clientWidth,
                        mainScrollbarHeight: main.offsetHeight - main.clientHeight,
                        rootScrollTop: rootScroll.scrollTop,
                        rootScrollLeft: rootScroll.scrollLeft,
                        topLeftTop: topLeftCell.getBoundingClientRect().top,
                        topLeftLeft: topLeftCell.getBoundingClientRect().left,
                    };
                });
                expect(['auto', 'scroll']).toContain(initial.mainOverflowX);
                expect(['auto', 'scroll']).toContain(initial.mainOverflowY);
                expect(initial.topOverflowX).toBe('clip');
                expect(initial.topOverflowY).toBe('clip');
                expect(initial.leftOverflowX).toBe('clip');
                expect(initial.leftOverflowY).toBe('clip');
                expect(initial.mainScrollbarWidth).toBeGreaterThan(0);
                expect(initial.mainScrollbarHeight).toBeGreaterThan(0);
                expect(Math.abs(initial.topViewportWidth - initial.mainClientWidth)).toBeLessThanOrEqual(1);
                expect(Math.abs(initial.leftViewportHeight - initial.mainClientHeight)).toBeLessThanOrEqual(1);
                expect(initial.rootScrollTop).toBe(0);
                expect(initial.rootScrollLeft).toBe(0);

                const topRightBox = await topRightPane.boundingBox();
                if (topRightBox === null) throw new Error('topRightPane の座標が取得できません');
                await page.mouse.move(
                    topRightBox.x + (topRightBox.width / 2),
                    topRightBox.y + Math.max(4, topRightBox.height / 2),
                );
                await page.mouse.wheel(0, 240);
                await page.waitForTimeout(100);

                const wheelScrolled = await page.evaluate(() => {
                    const main = document.querySelector('.editor-left-pane .editor-table-main-viewport');
                    const topLeftCell = document.querySelector('.editor-left-pane .editor-table-pane-top-left .editor-table-cell');
                    if (!(main instanceof HTMLElement)) throw new Error('main viewport が見つかりません');
                    if (!(topLeftCell instanceof HTMLElement)) throw new Error('top-left cell が見つかりません');
                    return {
                        mainScrollTop: main.scrollTop,
                        mainScrollLeft: main.scrollLeft,
                        topLeftTop: topLeftCell.getBoundingClientRect().top,
                        topLeftLeft: topLeftCell.getBoundingClientRect().left,
                    };
                });
                expect(wheelScrolled.mainScrollTop).toBeGreaterThan(0);
                expect(Math.abs(wheelScrolled.topLeftTop - initial.topLeftTop)).toBeLessThanOrEqual(1);
                expect(Math.abs(wheelScrolled.topLeftLeft - initial.topLeftLeft)).toBeLessThanOrEqual(1);

                await mainViewport.evaluate((element) => {
                    element.scrollTop = 500 * 21;
                    element.scrollLeft = 600;
                });
                await page.waitForTimeout(150);

                const scrolled = await page.evaluate(() => {
                    const main = document.querySelector('.editor-left-pane .editor-table-main-viewport');
                    const top = document.querySelector('.editor-left-pane .editor-table-top-viewport');
                    const left = document.querySelector('.editor-left-pane .editor-table-left-viewport');
                    const rootScroll = document.querySelector('.editor-left-pane');
                    const topLeftCell = document.querySelector('.editor-left-pane .editor-table-pane-top-left .editor-table-cell');
                    if (!(main instanceof HTMLElement)) throw new Error('main viewport が見つかりません');
                    if (!(top instanceof HTMLElement)) throw new Error('top viewport が見つかりません');
                    if (!(left instanceof HTMLElement)) throw new Error('left viewport が見つかりません');
                    if (!(rootScroll instanceof HTMLElement)) throw new Error('editor-left-pane が見つかりません');
                    if (!(topLeftCell instanceof HTMLElement)) throw new Error('top-left cell が見つかりません');
                    return {
                        mainScrollTop: main.scrollTop,
                        mainScrollLeft: main.scrollLeft,
                        topScrollLeft: top.scrollLeft,
                        leftScrollTop: left.scrollTop,
                        mainClientWidth: main.clientWidth,
                        mainClientHeight: main.clientHeight,
                        topViewportWidth: Math.round(top.getBoundingClientRect().width),
                        leftViewportHeight: Math.round(left.getBoundingClientRect().height),
                        rootScrollTop: rootScroll.scrollTop,
                        rootScrollLeft: rootScroll.scrollLeft,
                        topLeftTop: topLeftCell.getBoundingClientRect().top,
                        topLeftLeft: topLeftCell.getBoundingClientRect().left,
                    };
                });

                expect(scrolled.mainScrollTop).toBeGreaterThan(0);
                expect(scrolled.mainScrollLeft).toBeGreaterThan(0);
                expect(scrolled.topScrollLeft).toBe(0);
                expect(scrolled.leftScrollTop).toBe(0);
                expect(Math.abs(scrolled.topViewportWidth - scrolled.mainClientWidth)).toBeLessThanOrEqual(1);
                expect(Math.abs(scrolled.leftViewportHeight - scrolled.mainClientHeight)).toBeLessThanOrEqual(1);
                expect(Math.abs(scrolled.topLeftTop - initial.topLeftTop)).toBeLessThanOrEqual(1);
                expect(Math.abs(scrolled.topLeftLeft - initial.topLeftLeft)).toBeLessThanOrEqual(1);

                const aligned = await page.evaluate(() => {
                    const headerCell = document.querySelector('.editor-left-pane .editor-table-pane-top-right .editor-table-column-header[data-col="2"]');
                    const bodyRow = document.querySelector('.editor-left-pane .editor-table-grid .editor-table-row[data-row-index="500"]');
                    const bodyCell = document.querySelector('.editor-left-pane .editor-table-grid .editor-table-row[data-row-index="500"] .editor-table-cell[data-col="2"]');
                    const detachedRow = document.querySelector('.editor-left-pane .editor-table-detached-row-header-layer .editor-table-detached-row[data-row-index="500"]');
                    if (!(headerCell instanceof HTMLElement)) throw new Error('header cell が見つかりません');
                    if (!(bodyRow instanceof HTMLElement)) throw new Error('body row が見つかりません');
                    if (!(bodyCell instanceof HTMLElement)) throw new Error('body cell が見つかりません');
                    if (!(detachedRow instanceof HTMLElement)) throw new Error('detached row が見つかりません');
                    return {
                        headerLeft: headerCell.getBoundingClientRect().left,
                        bodyCellLeft: bodyCell.getBoundingClientRect().left,
                        detachedRowTop: detachedRow.getBoundingClientRect().top,
                        bodyRowTop: bodyRow.getBoundingClientRect().top,
                    };
                });
                expect(Math.abs(aligned.headerLeft - aligned.bodyCellLeft)).toBeLessThanOrEqual(1);
                expect(Math.abs(aligned.detachedRowTop - aligned.bodyRowTop)).toBeLessThanOrEqual(1);
            },
        );

        test(
            '固定セルをダブルクリックするとテキストフィールドが表示される',
            async ({ page }) => {
                const fs = createFillHandleZIndexTestFileSystem();
                await installMockApiAsync(page, fs);
                await page.goto('/');

                const table = await openTableAsync(page, 'fill_handle_z_index_test');
                const fixedCell = table.locator(
                    '.editor-table-detached-frozen-corner-layer .editor-table-detached-row[data-row-index="0"] .editor-table-cell[data-col="0"]',
                );
                await expect(fixedCell).toBeVisible();

                await fixedCell.dblclick();

                const editField = page.locator('.grid-textfield-active');
                await expect(editField).toBeVisible();
                await expect(editField).toHaveText('1');
            },
        );

        test(
            '固定セルのプルダウン表示中に他のセルをクリックするとプルダウンが閉じる',
            async ({ page }) => {
                const fs = createFrozenDropdownTestFileSystem();
                await installMockApiAsync(page, fs);
                await page.goto('/');

                const table = await openTableAsync(page, 'frozen_dropdown_test');
                const fixedDropdownCell = table.locator(
                    '.editor-table-detached-frozen-corner-layer .editor-table-detached-row[data-row-index="0"] .editor-table-cell[data-col="1"]',
                );
                await expect(fixedDropdownCell).toBeVisible();

                await fixedDropdownCell.dblclick();

                const dropdownList = page.locator('.grid-dropdown.visible .grid-dropdown-list');
                await expect(dropdownList).toBeVisible();
                await expect(dropdownList.locator('.grid-dropdown-item').first()).toBeVisible();

                const otherCell = table.locator(
                    '.editor-table-detached-frozen-corner-layer .editor-table-detached-row[data-row-index="0"] .editor-table-cell[data-col="0"]',
                );
                await otherCell.click();

                await expect(page.locator('.grid-dropdown.visible')).toHaveCount(0);
            },
        );

        test(
            '固定行/固定列の罫線が未選択状態でも分離レイヤーに描画される',
            async ({ page }) => {
                await page.setViewportSize({ width: 640, height: 480 });
                const table = await openTableAsync(page, 'freeze_combo');

                await rightClickColumnHeaderAsync(table, 1);
                await clickContextMenuItemAsync(page, '先頭からこの列まで固定');
                await rightClickRowHeaderAsync(table, 1);
                await clickContextMenuItemAsync(page, 'この行まで固定');

                const styles = await page.evaluate(() => {
                    const root = document.querySelector('.editor-left-pane .editor-table');
                    if (!(root instanceof HTMLElement)) throw new Error('editor table が見つかりません');

                    const frozenRowCell = root.querySelector(
                        '.editor-table-detached-frozen-row-layer .editor-table-detached-row[data-row-index="0"] .editor-table-cell[data-col="2"]',
                    );
                    const frozenColumnCell = root.querySelector(
                        '.editor-table-detached-row-header-layer .editor-table-detached-row[data-row-index="2"] .editor-table-cell[data-col="1"]',
                    );
                    const lastFrozenColumn = root.querySelector(
                        '.editor-table-pane-top-left .editor-table-column-header.freeze-column-border',
                    );
                    const lastFrozenRow = root.querySelector(
                        '.editor-table-detached-frozen-row-layer .editor-table-detached-row.freeze-row-border',
                    );
                    const topLeftPane = root.querySelector('.editor-table-pane-top-left');
                    const topRightPane = root.querySelector('.editor-table-pane-top-right');

                    if (!(frozenRowCell instanceof HTMLElement)) throw new Error('固定行セルが見つかりません');
                    if (!(frozenColumnCell instanceof HTMLElement)) throw new Error('固定列セルが見つかりません');
                    if (!(lastFrozenColumn instanceof HTMLElement)) throw new Error('固定列境界が見つかりません');
                    if (!(lastFrozenRow instanceof HTMLElement)) throw new Error('固定行境界が見つかりません');
                    if (!(topLeftPane instanceof HTMLElement)) throw new Error('左上ペインが見つかりません');
                    if (!(topRightPane instanceof HTMLElement)) throw new Error('右上ペインが見つかりません');

                    const frozenRowCellStyle = window.getComputedStyle(frozenRowCell);
                    const frozenColumnCellStyle = window.getComputedStyle(frozenColumnCell);
                    const lastFrozenColumnStyle = window.getComputedStyle(lastFrozenColumn);
                    const lastFrozenRowCell = lastFrozenRow.querySelector('.editor-table-cell');
                    if (!(lastFrozenRowCell instanceof HTMLElement)) throw new Error('固定行境界セルが見つかりません');
                    const lastFrozenRowCellStyle = window.getComputedStyle(lastFrozenRowCell);
                    const columnShadowStyle = window.getComputedStyle(topLeftPane, '::after');
                    const rowShadowStyle = window.getComputedStyle(topRightPane, '::before');

                    return {
                        frozenRowCell: {
                            borderBottomStyle: frozenRowCellStyle.borderBottomStyle,
                            borderBottomWidth: frozenRowCellStyle.borderBottomWidth,
                        },
                        frozenColumnCell: {
                            borderBottomStyle: frozenColumnCellStyle.borderBottomStyle,
                            borderBottomWidth: frozenColumnCellStyle.borderBottomWidth,
                        },
                        lastFrozenColumn: {
                            borderRightStyle: lastFrozenColumnStyle.borderRightStyle,
                            borderRightWidth: lastFrozenColumnStyle.borderRightWidth,
                            boxShadow: lastFrozenColumnStyle.boxShadow,
                        },
                        lastFrozenRowCell: {
                            borderBottomStyle: lastFrozenRowCellStyle.borderBottomStyle,
                            borderBottomWidth: lastFrozenRowCellStyle.borderBottomWidth,
                            boxShadow: lastFrozenRowCellStyle.boxShadow,
                        },
                        columnPaneShadow: {
                            width: columnShadowStyle.width,
                            backgroundImage: columnShadowStyle.backgroundImage,
                        },
                        rowPaneShadow: {
                            height: rowShadowStyle.height,
                            backgroundImage: rowShadowStyle.backgroundImage,
                        },
                    };
                });

                expect(styles.frozenRowCell.borderBottomStyle).toBe('solid');
                expect(styles.frozenRowCell.borderBottomWidth).toBe('1px');
                expect(styles.frozenColumnCell.borderBottomStyle).toBe('solid');
                expect(styles.frozenColumnCell.borderBottomWidth).toBe('1px');
                expect(styles.lastFrozenColumn.borderRightStyle).toBe('solid');
                expect(styles.lastFrozenColumn.borderRightWidth).toBe('1px');
                expect(styles.lastFrozenColumn.boxShadow).toBe('none');
                expect(styles.lastFrozenRowCell.borderBottomStyle).toBe('solid');
                expect(styles.lastFrozenRowCell.borderBottomWidth).toBe('1px');
                expect(styles.lastFrozenRowCell.boxShadow).toBe('none');
                expect(['0px', 'auto']).toContain(styles.columnPaneShadow.width);
                expect(styles.columnPaneShadow.backgroundImage).toBe('none');
                expect(['0px', 'auto']).toContain(styles.rowPaneShadow.height);
                expect(styles.rowPaneShadow.backgroundImage).toBe('none');
            },
        );

        test(
            '10行固定の4領域構成で rowIndex 0 から 3 へドラッグしても最後の選択行は 3 のまま',
            async ({ page }) => {
                await page.setViewportSize({ width: 900, height: 480 });
                const table = await openTableAsync(page, 'freeze_combo');

                // 4領域構成を作るために先頭2列と先頭10行を固定する
                await rightClickColumnHeaderAsync(table, 1);
                await clickContextMenuItemAsync(page, '先頭からこの列まで固定');
                await rightClickRowHeaderAsync(table, 9);
                await clickContextMenuItemAsync(page, 'この行まで固定');

                await expect(table.locator('.editor-table-pane-top-left')).toBeVisible();
                await expect(table.locator('.editor-table-pane-top-right')).toBeVisible();
                await expect(table.locator('.editor-table-pane-bottom-left')).toBeVisible();
                await expect(table.locator('.editor-table-pane-bottom-right')).toBeVisible();

                // 固定行レイヤー上の通常データ列をドラッグし、終了行がそのまま選択終端になることを検証する
                await dragSelectionAsync(page, table, 0, 2, 3, 2);

                const selectionRange = await getActiveSelectionRangeAsync(page);
                expect(selectionRange).not.toBeNull();
                if (selectionRange === null) {
                    throw new Error('選択範囲が取得できません');
                }

                expect(selectionRange.startRow).toBe(0);
                expect(
                    selectionRange.endRow,
                    '10行固定で rowIndex 0 -> 3 をドラッグしたのに最後の選択行が固定領域ぶん下へずれている'
                ).toBe(3);
            },
        );

        test(
            '10行固定の4領域構成で固定行から非固定行へドラッグしても最後の選択行が境界でずれない',
            async ({ page }) => {
                await page.setViewportSize({ width: 900, height: 480 });
                const table = await openTableAsync(page, 'freeze_combo');

                await rightClickColumnHeaderAsync(table, 1);
                await clickContextMenuItemAsync(page, '先頭からこの列まで固定');
                await rightClickRowHeaderAsync(table, 9);
                await clickContextMenuItemAsync(page, 'この行まで固定');

                // 固定領域から非固定領域へ跨いでドラッグしても、境界をまたいだ先の論理行がそのまま選択終端になること
                await dragSelectionAsync(page, table, 0, 2, 12, 2);

                const selectionRange = await getActiveSelectionRangeAsync(page);
                expect(selectionRange).not.toBeNull();
                if (selectionRange === null) {
                    throw new Error('選択範囲が取得できません');
                }

                expect(selectionRange.startRow).toBe(0);
                expect(
                    selectionRange.endRow,
                    '10行固定で rowIndex 0 -> 12 をドラッグしたのに固定境界をまたいだ先で選択終端がずれている'
                ).toBe(12);
            },
        );

        test(
            '矢印キーで最初のスクロール対象セルへ移動しても選択セルが固定領域に隠れない',
            async ({ page }) => {
                await page.setViewportSize({ width: 640, height: 480 });
                const table = await openTableAsync(page, 'freeze_combo');
                await rightClickColumnHeaderAsync(table, 0);
                await clickContextMenuItemAsync(page, '先頭からこの列まで固定');
                await rightClickRowHeaderAsync(table, 0);
                await clickContextMenuItemAsync(page, 'この行まで固定');

                const scrollContainer = await getTableScrollContainerAsync(page);
                await scrollContainer.evaluate((element) => {
                    element.scrollTop = 10;
                    element.scrollLeft = 60;
                });
                await page.waitForTimeout(100);

                const scrollPosition = await scrollContainer.evaluate((element) => {
                    return { top: element.scrollTop, left: element.scrollLeft };
                });
                expect(scrollPosition.top).toBeGreaterThan(0);
                expect(scrollPosition.left).toBeGreaterThan(0);

                await clickDataCellAsync(table, 3, 3);
                await page.keyboard.press('ArrowUp');
                await page.keyboard.press('ArrowUp');
                await page.keyboard.press('ArrowLeft');
                await page.keyboard.press('ArrowLeft');

                await expect.poll(async () => {
                    return await page.evaluate(() => {
                        const focusedCell = document.querySelector('.editor-left-pane .editor-table-cell-focused');
                        const frozenRow = document.querySelector('.editor-left-pane .editor-table-detached-frozen-row-layer .editor-table-detached-row.freeze-row-border')
                            ?? document.querySelector('.editor-left-pane .editor-table-detached-frozen-corner-layer .editor-table-detached-row.freeze-row-border');
                        const frozenColumn = document.querySelector('.editor-left-pane .editor-table-pane-top-left .editor-table-column-header.freeze-column-border')
                            ?? document.querySelector('.editor-left-pane .editor-table-pane-top-right .editor-table-column-header.freeze-column-border');
                        if (!(focusedCell instanceof HTMLElement)) {
                            throw new Error('focusedCell が見つかりません');
                        }
                        if (!(frozenRow instanceof HTMLElement)) {
                            throw new Error('frozenRow が見つかりません');
                        }
                        if (!(frozenColumn instanceof HTMLElement)) {
                            throw new Error('frozenColumn が見つかりません');
                        }

                        const focusedRect = focusedCell.getBoundingClientRect();
                        const frozenRowRect = frozenRow.getBoundingClientRect();
                        const frozenColumnRect = frozenColumn.getBoundingClientRect();
                        return {
                            value: focusedCell.textContent?.trim() ?? '',
                            topVisible: focusedRect.top >= frozenRowRect.bottom,
                            leftVisible: focusedRect.left >= frozenColumnRect.right,
                        };
                    });
                }).toEqual({ value: 'name_2', topVisible: true, leftVisible: true });
            },
        );

        test(
            '仮想スクロールで本文行が入れ替わっても固定ヘッダーと固定行レイヤーを再構築しない',
            async ({ page }) => {
                await page.setViewportSize({ width: 960, height: 640 });
                const table = await openTableAsync(page, 'freeze_combo');
                await rightClickColumnHeaderAsync(table, 1);
                await clickContextMenuItemAsync(page, '先頭からこの列まで固定');
                await rightClickRowHeaderAsync(table, 0);
                await clickContextMenuItemAsync(page, 'この行まで固定');

                await page.evaluate(() => {
                    type FreezePerfCounters = {
                        columnHeaderLayerRebuilds: number;
                        cornerLayerRebuilds: number;
                        frozenRowLayerRebuilds: number;
                        frozenCornerLayerRebuilds: number;
                        headerCloneCount: number;
                        frozenRowCloneCount: number;
                        freezeClassRemovals: number;
                    };
                    type FreezePerfWindow = Window & typeof globalThis & {
                        __freezePerfPatched: boolean;
                        __freezePerfCounters: FreezePerfCounters | null;
                    };
                    const perfWindow = window as unknown as FreezePerfWindow;
                    perfWindow.__freezePerfPatched = perfWindow.__freezePerfPatched === true;
                    perfWindow.__freezePerfCounters = null;
                    perfWindow.__freezePerfCounters = {
                        columnHeaderLayerRebuilds: 0,
                        cornerLayerRebuilds: 0,
                        frozenRowLayerRebuilds: 0,
                        frozenCornerLayerRebuilds: 0,
                        headerCloneCount: 0,
                        frozenRowCloneCount: 0,
                        freezeClassRemovals: 0,
                    };
                    if (perfWindow.__freezePerfPatched) return;

                    const originalReplaceChildren = Element.prototype.replaceChildren;
                    Element.prototype.replaceChildren = function (...nodes: (Node | string)[]): void {
                        const counters = perfWindow.__freezePerfCounters;
                        if (counters !== undefined && this instanceof HTMLElement) {
                            if (this.classList.contains('editor-table-detached-column-header-layer')) counters.columnHeaderLayerRebuilds += 1;
                            if (this.classList.contains('editor-table-detached-corner-layer')) counters.cornerLayerRebuilds += 1;
                            if (this.classList.contains('editor-table-detached-frozen-row-layer')) counters.frozenRowLayerRebuilds += 1;
                            if (this.classList.contains('editor-table-detached-frozen-corner-layer')) counters.frozenCornerLayerRebuilds += 1;
                        }
                        originalReplaceChildren.apply(this, nodes);
                    };

                    const originalCloneNode = Node.prototype.cloneNode;
                    Node.prototype.cloneNode = function (subtree?: boolean): Node {
                        const counters = perfWindow.__freezePerfCounters;
                        if (counters !== undefined && this instanceof HTMLElement) {
                            const parent = this.parentElement;
                            if (parent instanceof HTMLElement && parent.classList.contains('editor-table-column-header-row')) {
                                counters.headerCloneCount += 1;
                            }
                            if (parent instanceof HTMLElement && parent.classList.contains('freeze-row')) {
                                counters.frozenRowCloneCount += 1;
                            }
                        }
                        return originalCloneNode.call(this, subtree === true);
                    };

                    const classListDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'classList');
                    if (classListDescriptor === undefined || classListDescriptor.get === undefined) {
                        throw new Error('Element.prototype.classList getter が取得できません');
                    }
                    Object.defineProperty(Element.prototype, 'classList', {
                        configurable: true,
                        enumerable: classListDescriptor.enumerable ?? false,
                        get(): DOMTokenList {
                            const tokenList = classListDescriptor.get!.call(this);
                            (tokenList as DOMTokenList & { __freezePerfOwnerElement?: Element }).__freezePerfOwnerElement = this;
                            return tokenList;
                        },
                    });

                    const originalClassListRemove = DOMTokenList.prototype.remove;
                    DOMTokenList.prototype.remove = function (...tokens: string[]): void {
                        const counters = perfWindow.__freezePerfCounters;
                        const ownerElement = (this as DOMTokenList & { __freezePerfOwnerElement?: Element }).__freezePerfOwnerElement;
                        if (counters !== undefined && ownerElement instanceof HTMLElement) {
                            const isFreezeClassRemoval = tokens.some((token) =>
                                token === 'freeze-row' || token === 'freeze-row-border' || token === 'freeze-column-border' || token === 'freeze-cell'
                            );
                            if (isFreezeClassRemoval && ownerElement.closest('.editor-left-pane .editor-table') !== null) {
                                counters.freezeClassRemovals += 1;
                            }
                        }
                        originalClassListRemove.apply(this, tokens);
                    };

                    perfWindow.__freezePerfPatched = true;
                });

                const initialFirstVisibleRowHeaderText = await table.locator('.editor-table-detached-row-header-layer .editor-table-row-header').first().textContent();
                expect(Number((initialFirstVisibleRowHeaderText ?? '').trim())).toBe(2);

                const scrollContainer = await getTableScrollContainerAsync(page);
                await scrollContainer.evaluate((element) => {
                    element.scrollTop = 500 * 21;
                    element.scrollLeft = 320;
                });

                await expect.poll(async () => {
                    const text = await table.locator('.editor-table-detached-row-header-layer .editor-table-row-header').first().textContent();
                    return Number((text ?? '').trim());
                }).toBeGreaterThan(100);

                const detachedViewportSync = await page.evaluate(() => {
                    const detachedRow = document.querySelector('.editor-left-pane .editor-table-detached-row-header-layer .editor-table-detached-row');
                    if (!(detachedRow instanceof HTMLElement)) throw new Error('detached row が見つかりません');
                    const rowIndexText = detachedRow.getAttribute('data-row-index');
                    if (rowIndexText === null) throw new Error('detached row の data-row-index がありません');
                    const sourceRowHeader = document.querySelector(
                        `.editor-left-pane .editor-table-grid .editor-table-row-header[data-row-index="${rowIndexText}"]`
                    );
                    const sourceRow = sourceRowHeader?.closest('.editor-table-row') ?? null;
                    if (!(sourceRow instanceof HTMLElement)) throw new Error('source row が見つかりません');
                    const readCells = (row: HTMLElement): string[] =>
                        Array.from(row.children).slice(0, 3).map((cell) => {
                            if (!(cell instanceof HTMLElement)) throw new Error('cell が HTMLElement ではありません');
                            return cell.innerHTML.trim();
                        });
                    return { detached: readCells(detachedRow), source: readCells(sourceRow) };
                });
                expect(detachedViewportSync.detached).toEqual(detachedViewportSync.source);

                const counters = await page.evaluate(() => {
                    type FreezePerfCounters = {
                        columnHeaderLayerRebuilds: number;
                        cornerLayerRebuilds: number;
                        frozenRowLayerRebuilds: number;
                        frozenCornerLayerRebuilds: number;
                        headerCloneCount: number;
                        frozenRowCloneCount: number;
                        freezeClassRemovals: number;
                    };
                    type FreezePerfWindow = Window & typeof globalThis & {
                        __freezePerfCounters: FreezePerfCounters | null;
                    };
                    const perfWindow = window as unknown as FreezePerfWindow;
                    if (perfWindow.__freezePerfCounters === null) {
                        throw new Error('freeze perf counters が見つかりません');
                    }
                    return perfWindow.__freezePerfCounters;
                });

                expect(counters.columnHeaderLayerRebuilds).toBe(0);
                expect(counters.cornerLayerRebuilds).toBe(0);
                expect(counters.frozenRowLayerRebuilds).toBe(0);
                expect(counters.frozenCornerLayerRebuilds).toBe(0);
                expect(counters.headerCloneCount).toBe(0);
                expect(counters.frozenRowCloneCount).toBe(0);
                expect(counters.freezeClassRemovals).toBe(0);
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
                const initialIdStyles = await getColumnCellStylesAsync(reopenedTable, 0);
                const initialHpStyles = await getColumnCellStylesAsync(reopenedTable, 2);
                const scrollContainer = await getTableScrollContainerAsync(page);
                await scrollContainer.evaluate((el) => { el.scrollLeft = 220; });
                await page.waitForTimeout(100);
                const idStyles = await getColumnCellStylesAsync(reopenedTable, 0);
                const hpStyles = await getColumnCellStylesAsync(reopenedTable, 2);
                for (let i = 0; i < idStyles.length; i++) {
                    expect(Math.abs(idStyles[i].viewportLeft - initialIdStyles[i].viewportLeft)).toBeLessThanOrEqual(2);
                }
                for (let i = 0; i < hpStyles.length; i++) {
                    expect(hpStyles[i].viewportLeft).toBeLessThan(initialHpStyles[i].viewportLeft - 100);
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
                const initialRowStyle = await getRowStyleAsync(reopenedTable, 0);
                const scrollContainer = await getTableScrollContainerAsync(page);
                await scrollContainer.evaluate((el) => { el.scrollTop = 140; });
                await page.waitForTimeout(100);
                const rowStyle = await getRowStyleAsync(reopenedTable, 0);
                expect(Math.abs(rowStyle.viewportTop - initialRowStyle.viewportTop)).toBeLessThanOrEqual(2);
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
                const initialFrozenRowStyle = await getRowStyleAsync(reopenedTable, 0);
                const scrollContainer = await getTableScrollContainerAsync(page);
                await scrollContainer.evaluate((el) => {
                    el.scrollTop = 500 * 21;
                    el.scrollLeft = 600;
                });
                await page.waitForTimeout(150);

                const frozenRow = reopenedTable.locator('.editor-table-row:not(.editor-table-empty-row)')
                    .filter({ has: page.locator('.editor-table-row-header[data-row-index="0"]') });
                await expect(frozenRow).toHaveCount(1);
                const frozenRowStyle = await getRowStyleAsync(reopenedTable, 0);
                expect(Math.abs(frozenRowStyle.viewportTop - initialFrozenRowStyle.viewportTop)).toBeLessThanOrEqual(2);

                const scrolledRow = reopenedTable.locator('.editor-table-row:not(.editor-table-empty-row)')
                    .filter({ has: page.locator('.editor-table-row-header[data-row-index="500"]') });
                await expect(scrolledRow).toHaveCount(1);

                const idCellStyle = await getCellFreezeStyleAsync(
                    scrolledRow.first().locator('.editor-table-cell:not(.editor-table-row-header)').nth(0),
                );
                expect(idCellStyle.viewportLeft).toBeGreaterThanOrEqual(0);

                const nameCellStyle = await getCellFreezeStyleAsync(
                    scrolledRow.first().locator('.editor-table-cell:not(.editor-table-row-header)').nth(1),
                );
                expect(nameCellStyle.viewportLeft).toBeGreaterThan(idCellStyle.viewportLeft);
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
                const header = miniTable.locator('.editor-table-detached-column-header-layer .editor-table-column-header').nth(1);
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
