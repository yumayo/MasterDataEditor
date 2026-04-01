import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';
import { enableRelationsPanelAsync } from './fixtures/test-utils';

// =============================================================================
// ミニEditorTableでマウスドラッグによる範囲選択の動作検証
//
// 根本原因（修正済み）:
//   Tab.createMiniEditorTable()（tab.ts 753行目付近）で
//   editorTable.activate() が呼ばれていないため、
//   SelectionDragController の mousemove/mouseup リスナーが window に登録されず、
//   ドラッグ選択が機能しない。
//
// 期待動作:
//   セルA上で mousedown → セルB上へ mousemove → mouseup の操作で、
//   選択範囲が複数セルに拡張されること。
//
// バグ修正前: editorTable.activate() が呼ばれない → SelectionDragController が
//   window の mousemove/mouseup を受け取れない → 選択範囲が1セルのまま → このテストが失敗
// バグ修正後: editorTable.activate() が呼ばれる → ドラッグ選択が機能する → このテストが成功
// =============================================================================

/**
 * ミニテーブルドラッグ選択テスト用のファイルシステムを生成する
 *
 * テーブル構成:
 *   enemy: id, ja, en（敵名テーブル。3列あり）
 *   quest: id, name, enemy_id（クエスト。enemy.idをFKとして参照）
 *
 * quest の行を選択すると RelationsPanel に N:1 として enemy のミニEditorTable が表示される。
 * N:1の場合、すべての列（id, ja, en）が表示される。
 * これによりドラッグで横方向の複数列選択を検証できる。
 *
 * reference: "enemy.id" にする理由:
 *   resolveRowsByFkValue() は columnName（"id"）で enemy テーブルの行を検索する。
 *   "enemy.id" ならPKルックアップで fkValue="1" → enemy.id=1 の行が1件正しく返る。
 */
function createDragSelectionTestFileSystem(): MockFileSystem {
    return {
        "schema/enemy.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "ja", type: "string" },
                { key: 2, name: "en", type: "string" },
            ],
            primary_key: ["id"],
        }),
        "data/enemy.csv": [
            "id,ja,en",
            "1,スライム,Slime",
            "2,ドラゴン,Dragon",
        ].join("\n"),
        "schema/quest.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                // enemy.id を FK として参照する（RelationsPanel は columnName="id" で PKルックアップ）
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

/** ドラッグ操作の結果として返す情報 */
type DragResult = {
    startBox: { x: number; y: number; width: number; height: number };
    selectionEl: Locator;
};

/**
 * ミニEditorTable上でセルAからセルBへドラッグ操作を実行し、結果情報を返す。
 * - quest テーブルを開いて0行目を選択し、RelationsPanel の enemy ミニテーブルを表示する
 * - visible なデータセルが2件以上あることを確認する
 * - startCell → endCell へ mousedown/move/up でドラッグする
 */
async function performDragOnMiniTableAsync(page: Page): Promise<DragResult> {
    const mainTable = await openTableAsync(page, 'quest');
    await selectRowAsync(mainTable, 0);
    await waitForRelationsPanelContentAsync(page);

    const miniTable = page.locator('.relations-panel .editor-table').first();
    await expect(miniTable).toBeVisible();

    // ミニEditorTableのデータセルが DOM に出現するまで待機する。
    // buildMiniTableAsync は非同期（readFileAsync を含む）のため、
    // .relations-panel-content の visible 後もセルがまだ構築中の可能性がある。
    const visibleDataCells = miniTable.locator(VISIBLE_DATA_CELL_SELECTOR);
    await expect(visibleDataCells.first()).toBeVisible();

    // データセルが2件以上あることを確認（id列・ja列の2セル以上）
    const cellCount = await visibleDataCells.count();
    expect(cellCount).toBeGreaterThanOrEqual(2);

    // ドラッグ元セル（id列）とドラッグ先セル（ja列）
    const startCell = visibleDataCells.nth(0);
    const endCell = visibleDataCells.nth(1);

    // boundingBox 取得前に visible であることを確認し、null 到達を実質的に防ぐ
    await expect(startCell).toBeVisible();
    await expect(endCell).toBeVisible();
    const startBox = await startCell.boundingBox();
    const endBox = await endCell.boundingBox();
    if (!startBox || !endBox) throw new Error('セルのboundingBoxが取得できません');

    // mousedown → mousemove → mouseup でドラッグ選択を行う
    // SelectionDragController が activate() されていないと window に mousemove/mouseup
    // リスナーが登録されず、endCell まで mousemove しても selection が拡張されない
    await page.mouse.move(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(endBox.x + endBox.width / 2, endBox.y + endBox.height / 2);
    await page.mouse.up();

    return { startBox, selectionEl: miniTable };
}

// データセルを絞り込むセレクタ（行ヘッダー・列ヘッダー・コーナーセルを除外）
const VISIBLE_DATA_CELL_SELECTOR =
    '.editor-table-cell:not(.editor-table-row-header):not(.editor-table-column-header):not(.editor-table-corner-cell)';

test.describe('ミニEditorTableのマウスドラッグ範囲選択', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createDragSelectionTestFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
        await enableRelationsPanelAsync(page);
    });

    test(
        'ミニEditorTable上でセルAからセルBへドラッグすると複数セルが選択されること',
        async ({ page }) => {
            const { startBox, selectionEl } = await performDragOnMiniTableAsync(page);

            // ドラッグ後の選択範囲を確認する。
            // sel-bg クラスを持つセルの数で複数セル選択されたか判定する。
            // 1セルのみ選択: sel-bg セルは 0 個（フォーカスセルには sel-bg が付かない）
            // 複数セル選択: sel-bg セルが 1 個以上（フォーカスセル以外に選択セルがある）
            //
            // バグ修正前: activate() が呼ばれないため mousemove がウィンドウに届かず、
            //   ドラッグしても選択範囲が startCell のまま → このアサーションが失敗
            // バグ修正後: activate() が呼ばれて mousemove を受け取り、
            //   endCell まで選択範囲が拡張される → このアサーションが成功
            await expect(selectionEl).toBeVisible();

            // sel-top クラスを持つセルが存在すること（選択ボーダーが描画されていること）
            const selTopCells = selectionEl.locator('.sel-top');
            await expect(selTopCells.first()).toBeVisible();

            // 複数セル選択されたことを sel-top セルの数で確認する
            // 2列ドラッグ = sel-top セルが2つ以上存在するはず
            const selTopCount = await selTopCells.count();
            expect(selTopCount).toBeGreaterThanOrEqual(2);
        },
    );

    test(
        'ミニEditorTable上でドラッグ選択した後、mouseupで選択が確定されること',
        async ({ page }) => {
            const { startBox, selectionEl } = await performDragOnMiniTableAsync(page);

            // mouseup 後に Selection.end() が呼ばれ、isSelecting() が false になることで
            // ドラッグ選択が「確定」した状態になる。
            // 確定後も選択範囲は保持されるため、sel-top クラスを持つセルが存在し続けることを確認する。
            //
            // バグ修正前: mouseup が window に届かないため end() が呼ばれず、
            //   isSelecting() が true のまま残る（実際は mousemove 自体も届かないのでドラッグ選択不成立）
            // バグ修正後: mouseup が window に届いて end() が呼ばれ、
            //   isSelecting() が false になって選択範囲が確定する
            await expect(selectionEl.locator('.sel-top').first()).toBeVisible();

            // mouseup の後にマウスを遠くに移動しても選択範囲が変化しないことを確認する
            // （isSelecting() = false になったため、mousemove を受けても範囲が変わらない）
            const selTopCells = selectionEl.locator('.sel-top');
            const selTopCountBeforeMove = await selTopCells.count();

            // 別の場所にマウスを移動する（ドラッグ確定後は selection が動かないはず）
            await page.mouse.move(0, 0);

            const selTopCountAfterMove = await selTopCells.count();

            // 選択範囲が確定していれば mouseup 後のマウス移動で sel-top セルの数は変化しない
            // バグ修正前: そもそもドラッグ選択が1セルのまま → ここでの比較は意味を成さない
            // バグ修正後: 複数セル選択が確定し、その後のマウス移動で変化しない
            expect(selTopCountAfterMove).toBe(selTopCountBeforeMove);

            // さらに、確定した選択範囲が複数セルであることも確認する
            expect(selTopCountAfterMove).toBeGreaterThanOrEqual(2);
        },
    );
});
