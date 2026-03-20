import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// 動的参照（DynamicReference）バリデーションのテスト
//
// 不具合概要:
//   動的参照を持つカラム（例: reward_record_id）のバリデーションに2つの問題がある。
//
//   問題1: 依存カラム（reward_table_id）を変更しても、動的参照カラムの
//          バリデーションが再実行されない。最終テーブルが InMemoryTableStore に
//          未ロードの場合、バリデーションを丸ごとスキップしてエラーが出ない。
//
//   問題2: 依存カラム（reward_table_id）が空のとき、動的参照カラムに値があっても
//          バリデーションを無条件スキップしてエラーが出ない。
//
// テーブル構成:
//   table: id, enum, comment, master（テーブルリスト。masterカラムに実テーブル名が入る）
//   chara: id, name（キャラマスター）
//   item:  id, name（アイテムマスター）
//   quest: id, reward_table_id, reward_record_id
//     reward_table_id   → reference: "table.id"
//     reward_record_id  → reference: "$(table.id == $reward_table_id).master.id"
//
// テストデータ:
//   quest id=1: reward_table_id=1（chara）, reward_record_id=3（まんぼう）→ 有効
//   quest id=2: reward_table_id=2（item）,  reward_record_id=1（ポーション）→ 有効
//
// テストシナリオ:
//   シナリオ1: quest id=2 の reward_table_id を "1"（chara）に変更すると、
//             reward_record_id=1 は chara.id に存在しないためエラーになるべき
//             （chara には id=1,2,3 があるが、これは item から chara に切り替わった
//              ことで参照先が変わるケースで、chara.id=1 は存在するため id=1 は有効。
//              → reward_record_id=1 は chara.id=1("うーぱー") に一致するため有効。
//              しかし最終テーブルがストアに未ロードの場合はバリデーション自体がスキップ
//              されるため、意図的に chara にない値でテストする必要がある）
//
//   シナリオ1（修正版）: quest id=2 の reward_table_id を "1"（chara）に変更する。
//             reward_record_id=1 は chara.id=1 に存在するため本来有効だが、
//             現在の不具合ではバリデーション自体がスキップされてしまう。
//             そこで、先に reward_record_id を chara に存在しない値 "99" に変更してから
//             reward_table_id を変更し、エラーが出ることを検証する。
//
//   シナリオ2: quest id=1 の reward_table_id を空にすると、
//             reward_record_id=3 はどのテーブルも参照できないためエラーになるべき
// =============================================================================

/**
 * 動的参照バリデーションテスト用のファイルシステムを生成する
 */
function createDynamicRefValidationFileSystem(): MockFileSystem {
    return {
        "schema/table.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "enum", type: "string" },
                { key: 2, name: "comment", type: "string" },
                { key: 3, name: "master", type: "string" },
            ],
            primary_key: "id",
        }),
        "data/table.csv": [
            "id,enum,comment,master",
            "1,chara,キャラ,chara",
            "2,item,アイテム,item",
        ].join("\n"),
        "schema/chara.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
            ],
            primary_key: "id",
        }),
        "data/chara.csv": [
            "id,name",
            "1,うーぱー",
            "2,ひつじ",
            "3,まんぼう",
        ].join("\n"),
        "schema/item.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
            ],
            primary_key: "id",
        }),
        "data/item.csv": [
            "id,name",
            "1,ポーション",
            "2,エリクサー",
        ].join("\n"),
        "schema/quest.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                // tableテーブルのidを参照（どのテーブルかを指定する列）
                { key: 1, name: "reward_table_id", type: "int", reference: "table.id" },
                // 動的参照: reward_table_idの値でtableテーブルを検索し、masterカラムの値（テーブル名）を取得、
                // そのテーブルのidカラムを参照する
                { key: 2, name: "reward_record_id", type: "int", reference: "$(table.id == $reward_table_id).master.id" },
            ],
            primary_key: "id",
        }),
        // quest id=1: reward_table_id=1(chara), reward_record_id=3(まんぼう) → 有効
        // quest id=2: reward_table_id=2(item),  reward_record_id=1(ポーション) → 有効
        "data/quest.csv": [
            "id,reward_table_id,reward_record_id",
            "1,1,3",
            "2,2,1",
        ].join("\n"),
    };
}

/**
 * エクスプローラーからテーブルを開き、左ペインのアクティブな EditorTable の Locator を返す
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
    const activeTab = page.locator('.tab-button-active');
    await expect(activeTab).toHaveText(tableName);
    const table = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="${tableName}"] .editor-table`);
    await expect(table).toBeVisible();
    return table;
}

/**
 * 指定行・列のデータセルを返す
 * rowIndex: 0始まり（ヘッダー行を除く）、colIndex: 0始まり（行ヘッダーを除く）
 */
function getDataCell(table: Locator, rowIndex: number, colIndex: number): Locator {
    const row = table.locator('.editor-table-row').nth(rowIndex + 1);
    return row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
}

/**
 * 指定行・列のデータセルをダブルクリックして新しい値を入力しEnterで確定する
 * rowIndex: 0始まり（ヘッダー行を除く）、colIndex: 0始まり（行ヘッダーを除く）
 */
async function editCellAsync(
    table: Locator,
    page: Page,
    rowIndex: number,
    colIndex: number,
    newValue: string,
): Promise<void> {
    const row = table.locator('.editor-table-row').nth(rowIndex + 1);
    const cell = row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
    await expect(cell).toBeVisible();
    await cell.dblclick();
    const editField = page.locator('.grid-textfield-active');
    await expect(editField).toBeVisible();
    await page.keyboard.press('Control+a');
    // insertText('') は空文字列挿入時に選択テキストを削除しないため、Backspace で削除する
    if (newValue === '') {
        await page.keyboard.press('Backspace');
    } else {
        await page.keyboard.insertText(newValue);
    }
    await page.keyboard.press('Enter');
}

// =============================================================================
// シナリオ1: reward_table_id を変更した後、reward_record_id のバリデーションが
// 再実行されず cell-error が付与されない不具合の再現
// =============================================================================

test.describe('動的参照バリデーション: 依存カラム変更後のエラー検出', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createDynamicRefValidationFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        'reward_table_id を変更して参照先テーブルが切り替わった後、reward_record_id に存在しない値があれば cell-error が付与される',
        async ({ page }) => {
            // quest テーブルを開く
            const questTable = await openTableAsync(page, 'quest');

            // 初期状態の確認: quest id=2（row index 1）
            // reward_table_id=2（item）, reward_record_id=1（ポーション）→ どちらもエラーなし
            const rewardRecordIdCell = getDataCell(questTable, 1, 2);
            await expect(rewardRecordIdCell).not.toHaveClass(/cell-error/);

            // まず reward_record_id を "99"（どのテーブルにも存在しない値）に変更する
            // この時点で item テーブルに id=99 は存在しないためエラーになるべき
            await editCellAsync(questTable, page, 1, 2, '99');

            // reward_record_id のセルを再取得（DOMが更新されている可能性）
            const rewardRecordIdCellAfterEdit = getDataCell(questTable, 1, 2);

            // reward_table_id を "1"（chara テーブル）に変更する
            // chara テーブルにも id=99 は存在しないため、引き続きエラーであるべき
            await editCellAsync(questTable, page, 1, 1, '1');

            // reward_record_id=99 は chara.id に存在しないため cell-error が付与されるべき
            // 現在の不具合: 最終テーブル（chara）がストアに未ロードの場合、
            // validateDynamicReference() がバリデーションをスキップしてエラーが出ない
            await expect(rewardRecordIdCellAfterEdit).toHaveClass(/cell-error/);
        },
    );
});

// =============================================================================
// シナリオ2: reward_table_id を空にした後、reward_record_id に値があっても
// バリデーションが無条件スキップされてエラーが出ない不具合の再現
// =============================================================================

test.describe('動的参照バリデーション: 依存カラムが空の場合のエラー検出', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createDynamicRefValidationFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        'reward_table_id を空にした後、reward_record_id に値があれば cell-error が付与される',
        async ({ page }) => {
            // quest テーブルを開く
            const questTable = await openTableAsync(page, 'quest');

            // 初期状態の確認: quest id=1（row index 0）
            // reward_table_id=1（chara）, reward_record_id=3（まんぼう）→ エラーなし
            const rewardRecordIdCell = getDataCell(questTable, 0, 2);
            await expect(rewardRecordIdCell).not.toHaveClass(/cell-error/);

            // reward_table_id を空にする（参照先テーブルが不明になる）
            // reward_table_id は reference を持つためダブルクリックでドロップダウンが開く。
            // ドロップダウンモードでは空文字入力ができないため、シングルクリック + Delete キーでクリアする。
            const rewardTableIdCell = getDataCell(questTable, 0, 1);
            await rewardTableIdCell.click();
            await page.keyboard.press('Delete');

            // reward_record_id=3 はどのテーブルも参照できない状態になるため、
            // cell-error が付与されるべき
            // 現在の不具合: filterValue === '' のとき無条件スキップされてエラーが出ない
            await expect(rewardRecordIdCell).toHaveClass(/cell-error/);
        },
    );
});
