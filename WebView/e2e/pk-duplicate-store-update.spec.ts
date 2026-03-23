import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem, readMockFileAsync } from './fixtures/mock-api';
import { expectCsvAsync, enableRelationsPanelAsync } from './fixtures/test-utils';

// =============================================================================
// PK重複時のストア更新バグ検証
//
// 根本原因:
//   EditorTable.updateCellValueAt() は store.updateCellValue()（PKベース検索）を使って
//   ストアを更新していた。PKが重複している場合、最初にヒットした行（index=0）が
//   常に更新され、ユーザーが編集した実際の行（index=N）は更新されなかった。
//
// 修正内容:
//   EditorTable に storeRowIndices: number[] フィールドを追加し、
//   updateCellValueAt() を store.updateCellValueByRowIndex()（インデックスベース）に変更した。
//   ・通常テーブル: storeRowIndices[i] = i（DOM行i+1 → ストア行i）
//   ・ミニテーブル: filteredRows 作成時にストアの全行から該当インデックスを記録
//
// 修正後の状態:
//   テスト1: PK重複テーブルで2行目を編集 → 2行目のみ更新され1行目は変化しない
//   テスト2: 1:NミニテーブルでPK重複子テーブルの2行目を編集 → 2行目のみ更新される
// =============================================================================

// =============================================================================
// テスト1: 通常テーブルでPK重複時に正しい行が更新されること
//
// テーブル構成:
//   item: id, name（id列がPK。id=1の行が2行）
//
// 手順:
//   1. itemテーブルを開く（id=1が2行あることを確認）
//   2. 2行目のnameセルを編集して "item_b_edited" に変更する
//   3. Ctrl+Sで保存する
//   4. 保存されたCSVの2行目が "1,item_b_edited" であることを検証する（1行目は変化しない）
//
// バグ修正前: updateCellValue はPK値='1'で最初にヒットした1行目（id=1,name=item_a）を
//   更新するため、CSVの1行目が変化して2行目は変化しない → このアサーションが失敗してRED
// バグ修正後: storeRowIndices[1] = 1 によりインデックスベースで2行目を更新するため GREEN
// =============================================================================

/**
 * PK重複テーブルのファイルシステムを生成する
 *
 * item テーブル:
 *   id=1の行が2行あり（PK重複）。
 *   通常のEditorTableでの編集時にPKベース検索が誤った行を更新するバグを再現するためのデータ。
 */
function createPkDuplicateFileSystem(): MockFileSystem {
    return {
        "schema/item.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
            ],
            primary_key: ["id"],
        }),
        // id=1 が2行あるPK重複データ（コピペで発生しやすいシナリオ）
        "data/item.csv": [
            "id,name",
            "1,item_a",
            "1,item_b",
            "2,item_c",
        ].join("\n"),
    };
}

/**
 * テーブルを開いてLocatorを返す
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
    const table = page.locator('.editor-left-pane .editor-table');
    await expect(table).toBeVisible();
    return table;
}

/**
 * 指定行・列のデータセルをダブルクリックして新しい値を入力しEnterで確定する
 *
 * rowIndex: 0始まり（ヘッダー行を除く）
 * colIndex: 0始まり（行ヘッダーを除く）
 */
async function editCellAsync(table: Locator, page: Page, rowIndex: number, colIndex: number, newValue: string): Promise<void> {
    // .editor-table-row は nth(0) がヘッダー行なので、データ行は nth(rowIndex + 1)
    const row = table.locator('.editor-table-row').nth(rowIndex + 1);
    const cell = row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
    await expect(cell).toBeVisible();
    await cell.dblclick();

    // テキストフィールドはEditorTableのDOM要素の外（wrapperElement直下）に配置されるため
    // table.locator()ではなくpage.locator()で検索する
    const editField = page.locator('.grid-textfield-active');
    await expect(editField).toBeVisible();

    // 既存内容を全選択してから新しい値を入力する
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText(newValue);
    await page.keyboard.press('Enter');
}

test.describe('PK重複時のストア更新バグ', () => {
    test.describe('テスト1: 通常テーブルでPK重複時に正しい行が更新されること', () => {
        test.beforeEach(async ({ page }) => {
            const fs = createPkDuplicateFileSystem();
            await installMockApiAsync(page, fs);
            await page.goto('/');
            await enableRelationsPanelAsync(page);
        });

        test(
            'PK重複テーブルで2行目のセルを編集すると、ストアの2行目（1行目ではなく）が更新されること',
            async ({ page }) => {
                // item テーブルを開く（id=1が2行あるPK重複データ）
                const table = await openTableAsync(page, 'item');

                // 1行目（id=1, name=item_a）が表示されていることを確認する
                const firstDataCell = table.locator('.editor-table-row').nth(1)
                    .locator('.editor-table-cell:not(.editor-table-row-header)').nth(1);
                await expect(firstDataCell).toHaveText('item_a');

                // 2行目（id=1, name=item_b）のname列を "item_b_edited" に変更する
                // PK値は1行目と同じ "1" だが、2行目を編集しているのでストアの行インデックス=1が更新されるべき
                await editCellAsync(table, page, 1, 1, 'item_b_edited');

                // Ctrl+S で保存する
                await table.click();
                await page.keyboard.press('Control+s');
                // 保存処理は fire-and-forget の非同期処理のため、完了を待機する
                await page.waitForTimeout(500);

                // 保存されたCSVを検証する
                // バグ修正前: PKベースで最初の行（id=1）を更新するため、
                //   1行目が "1,item_b_edited" になり 2行目は "1,item_b" のまま変わらない
                //   → expect(csv.body[1][1]).toBe('item_b_edited') が失敗してRED
                // バグ修正後: インデックスベースで行インデックス=1を更新するため、
                //   2行目が "1,item_b_edited" になる → GREEN
                await expectCsvAsync(page, 'data/item.csv', `
                    id, name
                    1,  item_a
                    1,  item_b_edited
                    2,  item_c
                `);
            },
        );

        test(
            'PK重複テーブルで2行目を編集しても1行目は変更されないこと',
            async ({ page }) => {
                // item テーブルを開く
                const table = await openTableAsync(page, 'item');

                // 2行目（id=1, name=item_b）のname列を変更する
                await editCellAsync(table, page, 1, 1, 'item_b_edited');

                // Ctrl+S で保存する
                await table.click();
                await page.keyboard.press('Control+s');
                // 保存処理は fire-and-forget の非同期処理のため、完了を待機する
                await page.waitForTimeout(500);

                // 1行目（item_a）が変化していないことを確認する
                // バグ修正前: PKベースで最初にヒットした1行目（item_a）が "item_b_edited" に
                //   書き換えられてしまう → expect(csv.body[0][1]).toBe('item_a') が失敗してRED
                // バグ修正後: インデックスベースで正確に2行目のみ更新するため1行目は変化しない → GREEN
                const csv = await readMockFileAsync(page, 'data/item.csv');
                const lines = csv.split('\n').filter((l: string) => l.trim() !== '');
                // lines[0] はヘッダー行
                // lines[1] は1行目データ: "1,item_a" のまま変化しないこと
                expect(lines[1], '1行目（item_a）がPK重複による誤り更新で書き換えられた').toBe('1,item_a');
            },
        );
    });
});

// =============================================================================
// テスト2: 1:NミニテーブルでPK重複時に正しい行が更新されること
//
// テーブル構成:
//   enemy: id, ja（親テーブル。id列がPK）
//   skill: id, enemy_id, name（子テーブル。enemy.idをFKとして参照。enemy_id=1の行が2行あるが
//          skillのPK(id列)は一意なので1:Nフィルタリングは機能する。
//          ただしenemyのミニテーブルでのstoreRowIndices未対応が問題となる）
//
// より直接的な1:N + PK重複シナリオ:
//   skill テーブルの PK（id列）も重複させてミニテーブルでの編集バグを確認する。
//
// 手順:
//   1. enemy テーブルを開いて1行目（id=1）を選択する
//   2. RelationsPanel に skill の1:N ミニテーブルが表示される（enemy_id=1の2行）
//   3. ミニテーブルの2行目（id=1, enemy_id=1, name=fireball）を編集して "fireball_edited" にする
//   4. ミニテーブル内で Ctrl+S で保存する（ミニテーブルのCtrl+Sはstore経由で保存する）
//
// ミニテーブルのPK重複シナリオ（storeRowIndices が必要な理由）:
//   skill の id=1 が2行ある場合、ミニテーブルでフィルタされた2行目（ストアインデックス=1）を
//   編集しても、updateCellValue はid='1'で最初の行（ストアインデックス=0）を更新してしまう。
//   → storeRowIndices により filteredRows[i] がストアの何行目かを記録することで解決する。
// =============================================================================

/**
 * 1:NミニテーブルでPK重複テスト用のファイルシステムを生成する
 *
 * テーブル構成:
 *   enemy: id, ja（親テーブル。enemy.id を基準に 1:N）
 *   skill: id, enemy_id, name（子テーブル。enemy.idをFKとして参照）
 *     - id=1 が2行あるPK重複（id=1,enemy_id=1,name=slash と id=1,enemy_id=1,name=fireball）
 *     - id=2 の行は別（id=2,enemy_id=1,name=thunder）
 *
 * enemy id=1 を選択 → RelationsPanelに skill のenemyid=1の3行がミニテーブル表示される。
 * ミニテーブルの2行目（id=1,name=fireball）を編集することでPK重複バグを再現する。
 */
function createMiniTablePkDuplicateFileSystem(): MockFileSystem {
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
        "schema/skill.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "enemy_id", type: "int", reference: "enemy.id" },
                { key: 2, name: "name", type: "string" },
            ],
            primary_key: ["id"],
        }),
        // skill の id=1 が2行（PK重複）。コピペで発生しやすいシナリオ。
        // enemy_id=1 の行が3件: id=1(slash), id=1(fireball), id=2(thunder)
        "data/skill.csv": [
            "id,enemy_id,name",
            "1,1,slash",
            "1,1,fireball",
            "2,1,thunder",
        ].join("\n"),
    };
}

/**
 * 左ペインのテーブルを開き、タブ名で絞り込んだ Locator を返す
 */
async function openTableByTabAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
    const table = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="${tableName}"] .editor-table`);
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
 * RelationsPanelの指定テーブルセクションのミニEditorTableを返す
 */
async function getMiniTableAsync(page: Page, childTableName: string): Promise<Locator> {
    const section = page.locator('.relations-table-section').filter({
        has: page.locator('.relations-table-title').getByText(childTableName, { exact: true }),
    });
    await expect(section).toBeVisible();
    const miniTable = section.locator('.editor-table');
    await expect(miniTable).toBeVisible();
    return miniTable;
}

/**
 * ミニテーブルの指定行・列のデータセルをダブルクリックして新しい値を入力しEnterで確定する
 *
 * rowIndex: 0始まり（ヘッダー行を除く）
 * ミニテーブルは FK列（enemy_id）が hiddenColumns で削除されるため、
 * visible な列だけを対象にするセレクタを使用する
 */
async function editMiniTableCellAsync(
    miniTable: Locator,
    page: Page,
    rowIndex: number,
    colIndex: number,
    newValue: string,
): Promise<void> {
    // visible なデータセルを絞り込む（行ヘッダー・列ヘッダー・コーナー・非表示列を除く）
    const visibleDataCells = miniTable.locator(
        '.editor-table-row',
    ).nth(rowIndex + 1).locator(
        '.editor-table-cell:not(.editor-table-row-header):not([style*="display: none"])',
    );
    const cell = visibleDataCells.nth(colIndex);
    await expect(cell).toBeVisible();
    await cell.dblclick();

    // ミニテーブルのテキストフィールドもRelationsPanelのwrapperElement（innerWrapper）に配置されるため
    // miniTable.locator()ではなくpage.locator('.relations-panel ...')で検索する
    const editField = page.locator('.relations-panel .grid-textfield-active, .relations-panel input').first();
    await expect(editField).toBeVisible();

    await page.keyboard.press('Control+a');
    await page.keyboard.insertText(newValue);
    await page.keyboard.press('Enter');
}

test.describe('テスト2: 1:NミニテーブルでPK重複時に正しいストア行が更新されること', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createMiniTablePkDuplicateFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
        await enableRelationsPanelAsync(page);
    });

    test(
        '1:Nミニテーブルで2行目（PK重複=id=1）のセルを編集すると、ストアの2行目が更新されること',
        async ({ page }) => {
            // enemy テーブルを開いて1行目（id=1, スライム）を選択する
            const mainTable = await openTableByTabAsync(page, 'enemy');
            await selectRowAsync(mainTable, 0);

            // RelationsPanelに skill の1:N ミニテーブルが表示されるまで待機する
            const miniTable = await getMiniTableAsync(page, 'skill');

            // ミニテーブルに3行（slash, fireball, thunder）が表示されるまで待機する
            // ヘッダー行(1) + データ行(3) + バッファ行(1) = 5行
            const allRows = miniTable.locator('.editor-table-row');
            await expect(allRows).toHaveCount(5);

            // 2行目（id=1, name=fireball）のname列を "fireball_edited" に変更する
            // ストアのインデックス=1（0始まり）に相当する行を編集している
            // PK値='1'は1行目と同じなので、PKベース検索では1行目が更新されるバグが発生する
            // colIndex=2: id(0), enemy_id(1), name(2) — FK列は非表示でないため全列可視
            await editMiniTableCellAsync(miniTable, page, 1, 2, 'fireball_edited');

            // ミニテーブルのCtrl+SはisMiniTableInstance()で拒否されるため、
            // エクスプローラーからskillタブを開いてCtrl+Sで保存する。
            // ストアは共有されているためミニテーブルの編集がタブに反映され、
            // タブからの保存でCSVに書き出される。
            const skillTable = await openTableByTabAsync(page, 'skill');
            await skillTable.click();
            await page.keyboard.press('Control+s');
            // 保存処理は fire-and-forget の非同期処理のため、完了を待機する
            await page.waitForTimeout(500);

            // 保存されたCSVを検証する
            // バグ修正前: PKベース検索で最初の id=1 の行（slash）が "fireball_edited" に
            //   書き換えられてしまい、2行目（fireball）は変化しない
            //   → lines[2] が "1,1,fireball_edited" でないため失敗してRED
            // バグ修正後: storeRowIndices によりインデックスベースで正確に2行目（fireball）を
            //   更新するため lines[2] が "1,1,fireball_edited" になる → GREEN
            await expectCsvAsync(page, 'data/skill.csv', `
                id, enemy_id, name
                1,  1,        slash
                1,  1,        fireball_edited
                2,  1,        thunder
            `);
        },
    );

    test(
        '1:NミニテーブルでPK重複の2行目を編集しても1行目（同じPK）は変更されないこと',
        async ({ page }) => {
            // enemy テーブルを開いて1行目を選択する
            const mainTable = await openTableByTabAsync(page, 'enemy');
            await selectRowAsync(mainTable, 0);

            const miniTable = await getMiniTableAsync(page, 'skill');

            // ミニテーブルに3行表示されるまで待機する（ヘッダー行 + 3データ行 + バッファ行(1) = 5行）
            await expect(miniTable.locator('.editor-table-row')).toHaveCount(5);

            // 2行目（id=1, name=fireball）のname列を変更する
            // colIndex=2: id(0), enemy_id(1), name(2) — FK列は非表示でないため全列可視
            await editMiniTableCellAsync(miniTable, page, 1, 2, 'fireball_edited');

            // ミニテーブルのCtrl+SはisMiniTableInstance()で拒否されるため、
            // エクスプローラーからskillタブを開いてCtrl+Sで保存する
            const skillTable = await openTableByTabAsync(page, 'skill');
            await skillTable.click();
            await page.keyboard.press('Control+s');
            // 保存処理は fire-and-forget の非同期処理のため、完了を待機する
            await page.waitForTimeout(500);

            // 1行目（id=1, name=slash）が変化していないことを確認する
            // バグ修正前: PKベースで1行目（slash）が "fireball_edited" に書き換えられる
            //   → lines[1] が "1,1,slash" でないため失敗してRED
            // バグ修正後: インデックスベースで2行目のみ更新するため1行目は変化しない → GREEN
            const csv = await readMockFileAsync(page, 'data/skill.csv');
            const lines = csv.split('\n').filter((l: string) => l.trim() !== '');
            // lines[0] はヘッダー行
            // lines[1] は1行目データ: "1,1,slash" のまま変化しないこと
            expect(lines[1], '1行目（slash）がPK重複による誤り更新で書き換えられた').toBe('1,1,slash');
        },
    );
});
