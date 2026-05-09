import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';
import { expectTableDataAsync, enableRelationsPanelAsync } from './fixtures/test-utils';

// =============================================================================
// ミニテーブルで行削除後に左ペインEditorTableのstoreRowIndicesが破損するバグ
//
// 根本原因:
//   ミニテーブル（RelationsPanelの右ペイン）とメインテーブル（左ペインのタブ）は
//   同一の InMemoryTableStore を共有している。
//
//   ミニテーブルで行を追加すると:
//     - ミニテーブルの storeRowIndices が更新される（例: [0,1] → [0,1,2]）
//     - ストアにも空行が挿入される
//
//   その後、同テーブルを左ペインでタブとして開くと:
//     - 新しい EditorTable が生成され storeRowIndices が [0,1,2,3] になる（正しい）
//
//   次に questタブに戻りミニテーブルから追加した行を削除すると:
//     - ミニテーブルの storeRowIndices はまだタブを開く前の古い状態のまま
//     - deleteRow() が indices.splice() + store.removeRow() を呼ぶが、
//       削除対象 storeRowIndex がミニテーブルの古い storeRowIndices から解決されるため
//       ストアから誤った行が削除される（ミニテーブルの3行目 → storeIndex=2の元々の行が消える）
//
//   最後に quest_reward タブに切り替えると:
//     - reloadCellsFromStore() が呼ばれ、左ペインの EditorTable（storeRowIndices=[0,1,2,3]）と
//       ストア（3行に減った）のズレにより、storeRowIndices の一部が範囲外になる
//     - 範囲外の行（storeRowIndex=3）は storeRows.length=3 に対して 3>=3 で continue され
//       DOM の4行目がクリアされないままになり重複表示が残る
//
// 再現手順:
//   1. quest テーブルを開いて1行目（quest_reward_group_id=1）を選択
//   2. RelationsPanelのquest_rewardミニテーブル2行目（id=2）の下に行を挿入
//   3. エクスプローラーからquest_rewardテーブルを開く（左ペインにタブが生成される）
//   4. questタブに戻る
//   5. ミニテーブルの3行目（追加した空行）を削除する
//   6. quest_rewardタブに切り替える
//
// 期待する結果:
//   quest_reward テーブルに重複行がなく正しい3行が表示される:
//     id=1, group_id=1, reward_table_id=1, reward_record_id=1
//     id=2, group_id=1, reward_table_id=2, reward_record_id=2
//     id=3, group_id=2, reward_table_id=1, reward_record_id=2
//
// 実際の結果（不具合）:
//   4行目が重複表示される（id=3の行が2回表示される）
// =============================================================================

/**
 * テスト用ファイルシステムを生成する。
 *
 * テーブル構成:
 *   quest: id, quest_reward_group_id（親テーブル。quest_reward.group_id をFKとして参照）
 *   quest_reward: id, group_id, reward_value（子テーブル。quest.quest_reward_group_id が FK）
 *
 * quest_reward データ:
 *   [0] id=1, group_id=1, reward_value=100  ← quest group_id=1 の行
 *   [1] id=2, group_id=1, reward_value=200  ← quest group_id=1 の行
 *   [2] id=3, group_id=2, reward_value=300  ← quest group_id=2 の行
 *
 * quest id=1（quest_reward_group_id=1）を選択すると、ミニテーブルに
 * id=1（storeIndex=0）, id=2（storeIndex=1）の2行が表示される。
 *
 * ミニテーブルのid=2の行の下に空行を追加すると storeIndex=2 に挿入される。
 * この時点でストアは4行（id=1, id=2, [空行], id=3）になる。
 *
 * 次にquest_rewardタブを開くと、新しいEditorTableがストアの4行を正しく表示する。
 * questタブに戻りミニテーブルから追加した空行（ミニテーブルの3行目）を削除すると、
 * ミニテーブルのstoreRowIndicesが古い値のままのためストアの意図しない行が削除される。
 */
function createQuestRewardCorruptionFileSystem(): MockFileSystem {
    return {
        "schema/quest.json": JSON.stringify({
            description: "クエストマスター",
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "quest_reward_group_id", type: "int", reference: "quest_reward.group_id" },
            ],
            primary_key: ["id"],
        }),
        "data/quest.csv": [
            "id,quest_reward_group_id",
            "1,1",
            "2,2",
        ].join("\n"),
        "schema/quest_reward.json": JSON.stringify({
            description: "クエスト報酬マスター",
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "group_id", type: "int" },
                { key: 2, name: "reward_value", type: "int" },
            ],
            primary_key: ["id"],
        }),
        // ストアインデックス:
        //   [0] id=1, group_id=1, reward_value=100  ← quest_reward_group_id=1 の行
        //   [1] id=2, group_id=1, reward_value=200  ← quest_reward_group_id=1 の行
        //   [2] id=3, group_id=2, reward_value=300  ← quest_reward_group_id=2 の行
        "data/quest_reward.csv": [
            "id,group_id,reward_value",
            "1,1,100",
            "2,1,200",
            "3,2,300",
        ].join("\n"),
    };
}

/**
 * エクスプローラーからテーブルを開き、タブ名で絞り込んだ EditorTable Locator を返す。
 * strict mode violation を防ぐために data-tab-name で絞り込む。
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
    const table = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="${tableName}"] .editor-table`);
    await expect(table).toBeVisible();
    return table;
}

/**
 * 指定した行ヘッダーをクリックして行を選択する。
 * rowIndex: 0始まり（ヘッダー行を除く）
 */
async function selectRowAsync(table: Locator, rowIndex: number): Promise<void> {
    const header = table.locator('.editor-table-row-header').nth(rowIndex);
    await header.click();
}

/**
 * リレーションパネルのコンテンツが表示されるまで待機する。
 */
async function waitForRelationsPanelContentAsync(page: Page): Promise<void> {
    await expect(page.locator('.relations-panel-content')).toBeVisible();
}

/**
 * RelationsPanelの指定テーブルセクションにあるミニEditorTable Locatorを返す。
 */
async function getMiniTableSectionAsync(page: Page, childTableName: string): Promise<Locator> {
    const section = page.locator('.relations-table-section').filter({
        has: page.locator('.relations-table-title').getByText(childTableName, { exact: true }),
    });
    await expect(section).toBeVisible();
    const miniTable = section.locator('.editor-table');
    await expect(miniTable).toBeVisible();
    return miniTable;
}

/**
 * ミニテーブルの行ヘッダーを右クリックしてコンテキストメニューを開く。
 * rowIndex: 0始まり（ヘッダー行を除く）
 */
async function rightClickMiniTableRowHeaderAsync(miniTable: Locator, rowIndex: number): Promise<void> {
    const header = miniTable.locator('.editor-table-row-header').nth(rowIndex);
    await header.click({ button: 'right' });
}

/**
 * コンテキストメニューの項目をクリックする。
 */
async function clickContextMenuItemAsync(page: Page, label: string): Promise<void> {
    const menu = page.locator('.context-menu.visible');
    await expect(menu).toBeVisible();
    await menu.locator('.context-menu-item', { hasText: label }).click();
}

// =============================================================================
// テスト本体
// =============================================================================

test.describe('ミニテーブル行削除後に左ペインEditorTableのstoreRowIndicesが破損するバグ', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createQuestRewardCorruptionFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
        await enableRelationsPanelAsync(page);
    });

    test(
        'ミニテーブルで行追加後に左ペインで同テーブルを開き、questタブに戻ってミニテーブルから' +
        '追加行を削除すると、quest_rewardタブに戻ったときに重複行が表示されないこと',
        async ({ page }) => {
            // ステップ1: quest テーブルを開いて1行目（quest_reward_group_id=1）を選択する
            // → RelationsPanelにquest_rewardのミニテーブルが表示される（group_id=1の2行）
            const questTable = await openTableAsync(page, 'quest');
            await selectRowAsync(questTable, 0);
            await waitForRelationsPanelContentAsync(page);

            // quest_reward ミニテーブルが表示されるまで待機する
            // バッファ空行を除外してデータ行のみカウントする
            const miniTable = await getMiniTableSectionAsync(page, 'quest_reward');
            const allMiniRows = miniTable.locator('.editor-table-row:not(.editor-table-empty-row)');
            await expect(allMiniRows).toHaveCount(2);

            // ステップ2: ミニテーブルの2行目（id=2, group_id=1, storeIndex=1）の下に行を挿入する
            // → ストアのstoreIndex=2に空行が挿入され、ストアは4行になる
            // → ミニテーブルのstoreRowIndicesは [0, 1, 2] になる
            await rightClickMiniTableRowHeaderAsync(miniTable, 1);
            await clickContextMenuItemAsync(page, '下に行を挿入');

            // 行が追加されてミニテーブルに3データ行が表示されることを確認する
            await expect(allMiniRows).toHaveCount(3);

            // 追加された3行目（ミニテーブルのrowIndex=2）の各セルにデータを入力する。
            // group_id=1 を入力しないと、ステップ4でquestタブに戻ったときにFKフィルタ
            // （group_id=1）を通過できず、ミニテーブルに表示されなくなるため必須。
            // ミニテーブルの行: データ行(rowIndex=2が3行目) → .nth(2)
            const insertedRow = miniTable.locator('.editor-table-row').nth(2);
            const dataCells = insertedRow.locator('.editor-table-cell:not(.editor-table-row-header)');
            const editField = page.locator('.relations-panel .grid-textfield-active, .relations-panel input').first();

            // id列（colIndex=0）に "5" を入力する
            await dataCells.nth(0).dblclick();
            await expect(editField).toBeVisible();
            await editField.selectText();
            await editField.type('5');
            await page.keyboard.press('Tab');

            // group_id列（colIndex=1）に "1" を入力する（FKフィルタ通過のために必須）
            await dataCells.nth(1).dblclick();
            await expect(editField).toBeVisible();
            await editField.selectText();
            await editField.type('1');
            await page.keyboard.press('Tab');

            // reward_value列（colIndex=2）に "999" を入力する
            await dataCells.nth(2).dblclick();
            await expect(editField).toBeVisible();
            await editField.selectText();
            await editField.type('999');
            await page.keyboard.press('Enter');

            // ステップ3: エクスプローラーからquest_rewardテーブルをタブとして開く
            // → quest_reward の新しいEditorTableが生成され、storeRowIndicesが [0,1,2,3] になる
            // （ストアは4行: id=1, id=2, id=5(group_id=1,reward_value=999), id=3）
            const questRewardTable = await openTableAsync(page, 'quest_reward');
            // quest_reward テーブルに4データ行表示されていることを確認する
            // バッファ空行を除いた実データ行のみカウントする
            const questRewardDataRows = questRewardTable.locator('.editor-table-row:not(.editor-table-empty-row)');
            await expect(questRewardDataRows).toHaveCount(4);

            // ステップ4: questタブに切り替えて戻る
            // → questのEditorTableにはquest_rewardのミニテーブルが表示される
            // → ミニテーブルのstoreRowIndicesはまだ [0, 1, 2] のまま（古い状態）
            await openTableAsync(page, 'quest');
            // quest の1行目を選択してRelationsPanelを再表示させる
            await selectRowAsync(questTable, 0);
            await waitForRelationsPanelContentAsync(page);

            // ミニテーブルが再表示されるまで待機する
            const miniTableAfterSwitch = await getMiniTableSectionAsync(page, 'quest_reward');
            // バッファ空行を除外してデータ行のみカウントする
            const allMiniRowsAfterSwitch = miniTableAfterSwitch.locator('.editor-table-row:not(.editor-table-empty-row)');
            // ミニテーブルには3行（id=1, id=2, id=5(group_id=1)）が表示される
            await expect(allMiniRowsAfterSwitch).toHaveCount(3);

            // ステップ5: ミニテーブルの3行目（追加した id=5 の行）を削除する
            // ミニテーブルのstoreRowIndicesは古い状態 [0, 1, 2] のまま
            // deleteRow() が indices.splice(2, 1) + store.removeRow(tableName, 2) を呼ぶ
            // storeIndex=2 はステップ2で挿入した空行だが、ミニテーブルのindicesが古い場合
            // storeIndex=2 が本来の id=3 の行を指してしまう可能性がある
            await rightClickMiniTableRowHeaderAsync(miniTableAfterSwitch, 2);
            await clickContextMenuItemAsync(page, '行を削除');

            // 行が削除されてミニテーブルに2データ行が表示されることを確認する
            await expect(allMiniRowsAfterSwitch).toHaveCount(2);

            // ステップ6: quest_rewardタブに切り替える
            // → reloadCellsFromStore() が呼ばれる
            // → 左ペインのquest_rewardのEditorTable（storeRowIndices=[0,1,2,3]）と
            //    ストアの現在の行数のズレにより、重複行が表示される
            // エクスプローラーからクリックすることで既存タブが選択される（タブは既に開いている）
            const questRewardTableAfter = await openTableAsync(page, 'quest_reward');

            // 期待する結果: 重複行なしで3データ行のみ表示される
            //   id=1, group_id=1, reward_value=100
            //   id=2, group_id=1, reward_value=200
            //   id=3, group_id=2, reward_value=300
            //
            // バグが存在する場合:
            //   4行目（id=3の行）が重複表示される
            //   → このアサーションが失敗してRED
            //
            // バッファ空行を除いた実データ行のみカウントする（通常テーブルはemptyRowCount=100）
            const questRewardDataRowsAfter = questRewardTableAfter.locator('.editor-table-row:not(.editor-table-empty-row)');
            // 期待: データ行(3)
            // バグ時: データ行(4)（重複行あり）
            await expect(questRewardDataRowsAfter).toHaveCount(3);

            // セル値でも正しいデータが表示されていることを確認する
            // バグ時は4行目に id=3 の行が重複して表示される
            // expectTableDataAsync はヘッダー行を除いたデータ行を対象にする（rowIndex=0から）
            await expectTableDataAsync(questRewardTableAfter, `
                1, 1, 100
                2, 1, 200
                3, 2, 300
            `);
        },
    );

    test(
        'ミニテーブルで行追加後にquest_rewardを左ペインで開かずにquestタブのままミニテーブルから' +
        '追加行を削除すると、quest_rewardを開いたときに元の3行のみが表示されること',
        async ({ page }) => {
            // このテストは左ペインでquest_rewardを開かない場合の挙動を検証する。
            // 左ペインを開かない場合、ミニテーブルのstoreRowIndicesのみが存在し
            // 参照テーブルのEditorTableは存在しないため、追加・削除が正しく相殺されれば
            // 元の3行のみが表示されるはずである。
            //
            // ミニテーブルでの追加・削除サイクル（バグ有無の境界確認）:
            //   - 追加: storeIndex=2 に空行挿入 → ストアが4行になる
            //   - 削除: 追加した行（storeIndex=2）を削除 → ストアが3行に戻る
            //   これが正しく動作すれば元の3行のみが残る（正常系の確認）
            //
            // もし削除時のstoreRowIndicesが誤っている場合（バグ）:
            //   storeIndex=2 が「元々のid=3の行」を指してしまい、
            //   追加した空行（storeIndex=2）ではなく id=3 が削除されてストアは
            //   [id=1, id=2, [空行]] の3行になり、id=3が消える → このアサーションが失敗してRED

            // ステップ1: quest テーブルを開いて1行目（quest_reward_group_id=1）を選択
            const questTable = await openTableAsync(page, 'quest');
            await selectRowAsync(questTable, 0);
            await waitForRelationsPanelContentAsync(page);

            // バッファ空行を除外して2データ行のみカウントする
            const miniTable = await getMiniTableSectionAsync(page, 'quest_reward');
            const allMiniRows = miniTable.locator('.editor-table-row:not(.editor-table-empty-row)');
            await expect(allMiniRows).toHaveCount(2);

            // ステップ2: ミニテーブルの2行目の下に行を挿入する
            await rightClickMiniTableRowHeaderAsync(miniTable, 1);
            await clickContextMenuItemAsync(page, '下に行を挿入');
            await expect(allMiniRows).toHaveCount(3);

            // ステップ3: そのまま（quest_rewardを左ペインで開かずに）ミニテーブルの3行目を削除する
            await rightClickMiniTableRowHeaderAsync(miniTable, 2);
            await clickContextMenuItemAsync(page, '行を削除');
            await expect(allMiniRows).toHaveCount(2);

            // ステップ4: quest_rewardテーブルを左ペインで開く
            const questRewardTable = await openTableAsync(page, 'quest_reward');

            // 期待する結果: 元通りの3データ行が表示される（空行追加・削除が相殺される）
            //   id=1, group_id=1, reward_value=100
            //   id=2, group_id=1, reward_value=200
            //   id=3, group_id=2, reward_value=300
            //
            // バグが存在する場合:
            //   行追加時にストアに空行が挿入され、行削除時に誤った行が削除されるため
            //   元の3行より増減した行数になる
            const questRewardDataRows = questRewardTable.locator('.editor-table-row:not(.editor-table-empty-row)');
            // 期待: データ行(3)
            await expect(questRewardDataRows).toHaveCount(3);

            await expectTableDataAsync(questRewardTable, `
                1, 1, 100
                2, 1, 200
                3, 2, 300
            `);
        },
    );
});
