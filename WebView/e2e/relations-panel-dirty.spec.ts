import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';
import { enableRelationsPanelAsync } from './fixtures/test-utils';

// =============================================================================
// ミニEditorTableのDirty管理テスト
//
// 実装すべき機能:
//   1. InMemoryTableStore に Dirty 状態を持たせる
//   2. ミニテーブルで編集するとテーブル名横に Dirty マーク（.relations-table-dirty）が表示される
//   3. ミニテーブルでCtrl+Sすると保存でき、Dirtyマークが消える
//   4. Undo/Redoで変更が戻ったり増えたりしたとき Dirty マークが更新される
//   5. 同じテーブルがタブでも開かれていたら、タブのDirtyマーク（.tab-button-dirty-visible）も連動する
//
// =============================================================================

/**
 * テスト用ファイルシステム
 *
 * テーブル構成:
 *   enemy: id, ja（敵名テーブル）
 *   quest: id, name, enemy_id（クエスト。enemy.id をFK として参照）
 *
 * quest を開いて行を選択すると RelationsPanel に enemy のミニEditorTable が表示される。
 * N:1 リレーションですべての列（id, ja）が表示される。
 * ja 列のセルをダブルクリックして編集に使用する。
 */
function createDirtyTestFileSystem(): MockFileSystem {
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
                // enemy.id を FK として参照する（RelationsPanel に N:1 として enemy が表示される）
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
 * 左ペインのエディターテーブルが表示されるまで待機し、Locator を返す
 *
 * 複数のタブが開かれている場合、アクティブなタブのラッパー（display が none でない .tab-wrapper）の
 * .editor-table のみを取得する。strict mode violation を防ぐためのフィルタリング。
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
    // アクティブなタブ（display:none でない .tab-wrapper）に絞り込む
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
 * リレーションパネルのコンテンツが表示されるまで待機する
 */
async function waitForRelationsPanelContentAsync(page: Page): Promise<void> {
    await expect(page.locator('.relations-panel-content')).toBeVisible();
}

/**
 * リレーションパネル内の最初のデータセルを返す
 */
function getMiniTableFirstDataCell(page: Page): Locator {
    return page.locator(
        '.relations-panel .editor-table .editor-table-cell' +
        ':not(.editor-table-row-header)' +
        ':not(.editor-table-column-header)' +
        ':not(.editor-table-corner-cell)'
    ).first();
}

/**
 * ミニテーブルのセルをダブルクリックして新しい値を入力しEnterで確定する
 *
 * 1. visible な最初のデータセルをダブルクリックして編集モードに入る
 * 2. 既存の内容を全選択してから新しい値を入力する
 * 3. Enter で確定する
 */
async function editMiniTableCellAsync(page: Page, newValue: string): Promise<void> {
    const cell = getMiniTableFirstDataCell(page);
    await expect(cell).toBeVisible();
    await cell.dblclick();

    // 編集UIが表示されるまで待機する
    const editField = page.locator(
        '.relations-panel .grid-textfield-active, .relations-panel input'
    ).first();
    await expect(editField).toBeVisible();

    // 既存内容を全選択してから新しい値を入力する
    await editField.selectText();
    await editField.type(newValue);
    await page.keyboard.press('Enter');
}

// =============================================================================
// テスト本体
// =============================================================================

test.describe('ミニEditorTableのDirty管理', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createDirtyTestFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
        await enableRelationsPanelAsync(page);
    });

    test(
        'テスト1: ミニテーブルでセル編集後にDirtyマーク（.relations-table-dirty）が表示されること',
        async ({ page }) => {
            // quest テーブルを開いて1行目を選択し、RelationsPanel に enemy ミニテーブルを表示する
            const mainTable = await openTableAsync(page, 'quest');
            await selectRowAsync(mainTable, 0);
            await waitForRelationsPanelContentAsync(page);

            // ミニテーブルが表示されるまで待機する
            const miniTable = page.locator('.relations-panel .editor-table').first();
            await expect(miniTable).toBeVisible();

            // 編集前は Dirty マークが非表示であることを確認する
            // .relations-table-dirty 要素は存在するが visible ではない状態を期待する
            const dirtyMark = page.locator('.relations-table-section .relations-table-dirty').first();

            // ミニテーブルのセルを編集する（ja列の「スライム」を「スライム改」に変更）
            await editMiniTableCellAsync(page, 'スライム改');

            // 編集後にDirtyマークが visible になることを確認する
            await expect(dirtyMark).toBeVisible();
        },
    );

    test(
        'テスト2: ミニテーブルでCtrl+S後にDirtyマーク（.relations-table-dirty）が消えること',
        async ({ page }) => {
            // quest テーブルを開いて1行目を選択する
            const mainTable = await openTableAsync(page, 'quest');
            await selectRowAsync(mainTable, 0);
            await waitForRelationsPanelContentAsync(page);

            const miniTable = page.locator('.relations-panel .editor-table').first();
            await expect(miniTable).toBeVisible();

            // ミニテーブルのセルを編集して Dirty 状態にする
            await editMiniTableCellAsync(page, 'スライム改');

            // Dirty マークが表示されるまで待機する
            const dirtyMark = page.locator('.relations-table-section .relations-table-dirty').first();
            await expect(dirtyMark).toBeVisible();

            // ミニテーブル内のセルにフォーカスがある状態で Ctrl+S を押す
            // フォーカスをミニテーブルに当てるため最初の visible なデータセルをクリックする
            const cell = getMiniTableFirstDataCell(page);
            await cell.click();

            await page.keyboard.press('Control+s');

            // Dirty マークが消えることを確認する
            await expect(dirtyMark).not.toBeVisible();
        },
    );

    test(
        'テスト3: ミニテーブルでUndo後にDirtyマーク（.relations-table-dirty）が消えること',
        async ({ page }) => {
            // quest テーブルを開いて1行目を選択する
            const mainTable = await openTableAsync(page, 'quest');
            await selectRowAsync(mainTable, 0);
            await waitForRelationsPanelContentAsync(page);

            const miniTable = page.locator('.relations-panel .editor-table').first();
            await expect(miniTable).toBeVisible();

            // セルを1回編集して Dirty 状態にする
            await editMiniTableCellAsync(page, 'スライム改');

            const dirtyMark = page.locator('.relations-table-section .relations-table-dirty').first();
            await expect(dirtyMark).toBeVisible();

            // ミニテーブルにフォーカスを移してから Ctrl+Z で Undo する
            // フォーカスをミニテーブルに移さないと、メインテーブルの History に Undo が届く
            const cell = getMiniTableFirstDataCell(page);
            await cell.click();

            await page.keyboard.press('Control+z');

            // Undo 後に Dirty マークが消えることを確認する
            await expect(dirtyMark).not.toBeVisible();
        },
    );

    test(
        'テスト4: ミニテーブルでUndo後にRedoしたらDirtyマーク（.relations-table-dirty）が再表示されること',
        async ({ page }) => {
            // quest テーブルを開いて1行目を選択する
            const mainTable = await openTableAsync(page, 'quest');
            await selectRowAsync(mainTable, 0);
            await waitForRelationsPanelContentAsync(page);

            const miniTable = page.locator('.relations-panel .editor-table').first();
            await expect(miniTable).toBeVisible();

            // セルを1回編集して Dirty 状態にする
            await editMiniTableCellAsync(page, 'スライム改');

            const dirtyMark = page.locator('.relations-table-section .relations-table-dirty').first();
            await expect(dirtyMark).toBeVisible();

            // ミニテーブルにフォーカスを移してから Ctrl+Z で Undo する
            const cell = getMiniTableFirstDataCell(page);
            await cell.click();
            await page.keyboard.press('Control+z');

            // Undo 後に Dirty マークが消えることを確認する
            await expect(dirtyMark).not.toBeVisible();

            // Ctrl+Y で Redo する
            await page.keyboard.press('Control+y');

            // Redo 後に Dirty マークが再表示されることを確認する
            await expect(dirtyMark).toBeVisible();
        },
    );

    test(
        'テスト5: ミニテーブルでの編集が同じテーブルのタブのDirtyマーク（.tab-button-dirty-visible）に連動すること',
        async ({ page }) => {
            // 左ペインで enemy テーブルをタブで開く
            // このタブの TabButton が Dirty マーク連動の検証対象となる
            await openTableAsync(page, 'enemy');

            // 次に quest テーブルを開く
            // quest の行を選択すると RelationsPanel に enemy のミニEditorTable が表示される
            const questTable = await openTableAsync(page, 'quest');
            await selectRowAsync(questTable, 0);
            await waitForRelationsPanelContentAsync(page);

            const miniTable = page.locator('.relations-panel .editor-table').first();
            await expect(miniTable).toBeVisible();

            // 編集前は enemy タブの Dirty マークが付いていないことを確認する
            // .tab-button-dirty-visible クラスが enemy タブボタンに存在しないことを検証する
            const enemyTabButton = page.locator('.tab-button').filter({
                hasText: 'enemy',
            });
            await expect(enemyTabButton).toBeVisible();
            const enemyDirtyIndicator = enemyTabButton.locator('.tab-button-dirty');
            await expect(enemyDirtyIndicator).not.toHaveClass(/tab-button-dirty-visible/);

            // ミニテーブル（enemy）のセルを編集する
            await editMiniTableCellAsync(page, 'スライム改');

            // ミニテーブルで編集した後、左ペインの enemy タブに Dirty マークが付くことを確認する
            await expect(enemyDirtyIndicator).toHaveClass(/tab-button-dirty-visible/);
        },
    );
});
