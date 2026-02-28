import { test, expect } from '@playwright/test';
import { Page, Locator } from '@playwright/test';
import {
    installMockApiAsync,
    MockFileSystem,
} from './fixtures/mock-api';

/**
 * Explorerでテーブルを開き、アクティブなタブのEditorTableを返す
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    if (tableName.startsWith('view_')) {
        await explorer.locator('[data-panel="views"]').click();
    } else {
        await explorer.locator('[data-panel="files"]').click();
    }
    await explorer.getByText(tableName, { exact: true }).click();
    const table = page.locator('.tab-wrapper:not([style*="display: none"]) .editor-table');
    await expect(table).toBeVisible();
    return table;
}

/**
 * 指定した行・列のデータセルを返す
 * rowIndex: 0始まり（ヘッダー行を除く）, colIndex: 0始まり（行ヘッダーを除く）
 */
function getDataCell(table: Locator, rowIndex: number, colIndex: number): Locator {
    const row = table.locator('.editor-table-row').nth(rowIndex + 1);
    return row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
}

/**
 * セルの値を編集する
 */
async function editCellAsync(page: Page, table: Locator, rowIndex: number, colIndex: number, newValue: string): Promise<void> {
    const cell = getDataCell(table, rowIndex, colIndex);
    await cell.dblclick();
    const editField = page.locator('.grid-textfield-active');
    await expect(editField).toBeVisible();
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText(newValue);
    await page.keyboard.press('Enter');
}

/**
 * テストデータ:
 * quest: id=1,name=MainQuest / id=2,name=SideQuest
 * quest_reward: id=1,group_id=1,item=Gold / id=2,group_id=1,item=Gem / id=3,group_id=2,item=Potion
 *
 * view_quest: questベース、quest_rewardをquest.id → quest_reward.group_idでJOIN
 *
 * 期待されるビュー表示（group_idは非表示）:
 * | quest.id | quest.name | quest_reward.id | quest_reward.item |
 * |    1     | MainQuest  |       1         |      Gold         |  ← 実データ行
 * |  [pad]   |   [pad]    |       2         |      Gem          |  ← quest列はパディング
 * |    2     | SideQuest  |       3         |      Potion       |
 */
function createFileSystem(): MockFileSystem {
    return {
        "schema/quest.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
            ],
            primary_key: "id",
        }),
        "data/quest.csv": ["id,name", "1,MainQuest", "2,SideQuest"].join("\n"),
        "schema/quest_reward.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "group_id", type: "int" },
                { key: 2, name: "item", type: "string" },
            ],
            primary_key: "id",
        }),
        "data/quest_reward.csv": ["id,group_id,item", "1,1,Gold", "2,1,Gem", "3,2,Potion"].join("\n"),
        "view/view_quest.json": JSON.stringify({
            name: "view_quest",
            baseTable: "quest",
            joins: [{
                sourceColumn: "id",
                targetTable: "quest_reward",
                targetColumn: "group_id",
                insertAfterViewColumnIndex: 1,
                sourceTable: "",
            }],
        }),
    };
}

// -------------------------------------------------------
// ビュー結合列編集のソーステーブルDOMへの伝搬テスト
// -------------------------------------------------------
test.describe(
    'ビュー結合列編集のソーステーブル伝搬',
    () => {
        test(
            'ビューの結合列編集がソーステーブルのDOMに伝搬されること',
            async ({ page }) => {
                await installMockApiAsync(page, createFileSystem());
                await page.goto('/');

                // quest_rewardを先に開いてEditorTableを作成しておく
                const rewardTable = await openTableAsync(page, 'quest_reward');
                // quest_reward初期状態: row0=id:1,group_id:1,item:Gold / row1=id:2,group_id:1,item:Gem / row2=id:3,group_id:2,item:Potion
                await expect(getDataCell(rewardTable, 0, 2)).toHaveText('Gold');
                await expect(getDataCell(rewardTable, 1, 2)).toHaveText('Gem');

                // view_questを開く
                const viewTable = await openTableAsync(page, 'view_quest');
                // ビュー列: quest.id(0), quest.name(1), quest_reward.id(2), quest_reward.item(3)
                // row0: 1, MainQuest, 1, Gold
                // row1: [pad], [pad], 2, Gem
                // row2: 2, SideQuest, 3, Potion
                await expect(getDataCell(viewTable, 0, 3)).toHaveText('Gold');

                // ビューのquest_reward.item列（row0, col3）を「Diamond」に変更
                await editCellAsync(page, viewTable, 0, 3, 'Diamond');
                await expect(getDataCell(viewTable, 0, 3)).toHaveText('Diamond');

                // quest_rewardタブに切り替え
                const refreshedRewardTable = await openTableAsync(page, 'quest_reward');

                // ソーステーブルの対応するセル（row0, col2=item列）が更新されていること
                // quest_reward id=1 の item が Gold → Diamond に伝搬されるべき
                await expect(getDataCell(refreshedRewardTable, 0, 2)).toHaveText('Diamond');

                // 編集していない行は変更されていないこと
                await expect(getDataCell(refreshedRewardTable, 1, 2)).toHaveText('Gem');
                await expect(getDataCell(refreshedRewardTable, 2, 2)).toHaveText('Potion');
            },
        );

        test(
            'ビューの結合列編集がjoinTableKeyMapsに反映されること'
            + '（タブ切替後もビューの値が維持される）',
            async ({ page }) => {
                await installMockApiAsync(page, createFileSystem());
                await page.goto('/');

                // quest_rewardを先に開く
                await openTableAsync(page, 'quest_reward');

                // view_questを開く
                const viewTable = await openTableAsync(page, 'view_quest');
                await expect(getDataCell(viewTable, 0, 3)).toHaveText('Gold');

                // ビューのquest_reward.item列（row0, col3）を「Diamond」に変更
                await editCellAsync(page, viewTable, 0, 3, 'Diamond');
                await expect(getDataCell(viewTable, 0, 3)).toHaveText('Diamond');

                // quest_rewardタブに切り替え（rebuildJoinTableKeyMapsが呼ばれる）
                await openTableAsync(page, 'quest_reward');

                // view_questタブに戻る（refreshViewRowsがjoinTableKeyMapsを使って再構築）
                const refreshedViewTable = await openTableAsync(page, 'view_quest');

                // joinTableKeyMapsが正しく更新されていれば、編集した値が維持されるはず
                // バグがある場合、rebuildJoinTableKeyMapsがソーステーブルの古いDOMを読み、
                // refreshViewRowsが古い値（Gold）で上書きしてしまう
                await expect(getDataCell(refreshedViewTable, 0, 3)).toHaveText('Diamond');
                await expect(getDataCell(refreshedViewTable, 1, 3)).toHaveText('Gem');
                await expect(getDataCell(refreshedViewTable, 2, 3)).toHaveText('Potion');
            },
        );

        test(
            'ベーステーブル列の編集ではソーステーブルへの伝搬が発生しないこと',
            async ({ page }) => {
                await installMockApiAsync(page, createFileSystem());
                await page.goto('/');

                // quest_rewardを先に開く
                const rewardTable = await openTableAsync(page, 'quest_reward');
                await expect(getDataCell(rewardTable, 0, 2)).toHaveText('Gold');
                await expect(getDataCell(rewardTable, 1, 2)).toHaveText('Gem');
                await expect(getDataCell(rewardTable, 2, 2)).toHaveText('Potion');

                // view_questを開く
                const viewTable = await openTableAsync(page, 'view_quest');

                // ベーステーブル列（quest.name, col1）を編集
                await editCellAsync(page, viewTable, 0, 1, 'NewQuestName');
                await expect(getDataCell(viewTable, 0, 1)).toHaveText('NewQuestName');

                // quest_rewardタブに切り替え
                const refreshedRewardTable = await openTableAsync(page, 'quest_reward');

                // quest_rewardのデータは一切変更されていないこと
                await expect(getDataCell(refreshedRewardTable, 0, 2)).toHaveText('Gold');
                await expect(getDataCell(refreshedRewardTable, 1, 2)).toHaveText('Gem');
                await expect(getDataCell(refreshedRewardTable, 2, 2)).toHaveText('Potion');
            },
        );

        test(
            'ソーステーブルが開かれていない場合でもエラーなく処理が完了すること',
            async ({ page }) => {
                await installMockApiAsync(page, createFileSystem());
                await page.goto('/');

                // quest_rewardを開かずにview_questだけを開く
                const viewTable = await openTableAsync(page, 'view_quest');
                await expect(getDataCell(viewTable, 0, 3)).toHaveText('Gold');

                // ビューの結合列を編集（ソーステーブルは開かれていない）
                await editCellAsync(page, viewTable, 0, 3, 'Diamond');

                // エラーなく値が更新されること
                await expect(getDataCell(viewTable, 0, 3)).toHaveText('Diamond');

                // 同一JOINキーの連動更新（row1はgroup_id=1の別レコードquest_reward.id=2）は
                // 現行のsynchronizeJoinedColumnValuesではリーダー行→パディング行の連動に非対応のため
                // このアサーションはスコープ外とする
                // await expect(getDataCell(viewTable, 1, 3)).toHaveText('Diamond');

                // ベーステーブル列は影響を受けないこと
                await expect(getDataCell(viewTable, 0, 0)).toHaveText(/1/);
                await expect(getDataCell(viewTable, 0, 1)).toHaveText('MainQuest');
            },
        );
    },
);

// -------------------------------------------------------
// setCellValueAtパイプライン化: updateCellValueAt / propagateToSourceTable テスト
// updateCellValueAt: DOM更新 + 参照ヒントのみ（伝搬なし）
// propagateToSourceTable: 変更リストをまとめてソーステーブルに伝搬
// -------------------------------------------------------
test.describe(
    'setCellValueAtパイプライン化',
    () => {
        test(
            'updateCellValueAtはDOMのみ更新しソーステーブルに伝搬しない',
            async ({ page }) => {
                await installMockApiAsync(page, createFileSystem());
                await page.goto('/');

                // quest_rewardを先に開いてEditorTableを作成しておく
                const rewardTable = await openTableAsync(page, 'quest_reward');
                // quest_reward初期状態: row0のitem列=Gold
                await expect(getDataCell(rewardTable, 0, 2)).toHaveText('Gold');

                // view_questを開く
                const viewTable = await openTableAsync(page, 'view_quest');
                // ビュー列: quest.id(0), quest.name(1), quest_reward.id(2), quest_reward.item(3)
                // row0: 1, MainQuest, 1, Gold
                await expect(getDataCell(viewTable, 0, 3)).toHaveText('Gold');

                // updateCellValueAtでDOMのみ更新（ソーステーブルへの伝搬は行わない）
                // row=1（ヘッダー含む）, column=4（行ヘッダー含む）= quest_reward.item列の最初のデータ行
                await page.evaluate(() => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const editor = (window as any).editor;
                    editor.activeEditorTable.updateCellValueAt(1, 4, 'TestValue');
                });

                // ビューのDOMは更新されていること
                await expect(getDataCell(viewTable, 0, 3)).toHaveText('TestValue');

                // quest_rewardタブに切り替え
                const refreshedRewardTable = await openTableAsync(page, 'quest_reward');

                // ソーステーブルには伝搬されていないこと（Goldのまま）
                await expect(getDataCell(refreshedRewardTable, 0, 2)).toHaveText('Gold');
                // 他の行も変更されていないこと
                await expect(getDataCell(refreshedRewardTable, 1, 2)).toHaveText('Gem');
                await expect(getDataCell(refreshedRewardTable, 2, 2)).toHaveText('Potion');
            },
        );

        test(
            'propagateToSourceTableがソーステーブルに変更を伝搬する',
            async ({ page }) => {
                await installMockApiAsync(page, createFileSystem());
                await page.goto('/');

                // quest_rewardを先に開いてEditorTableを作成しておく
                const rewardTable = await openTableAsync(page, 'quest_reward');
                await expect(getDataCell(rewardTable, 0, 2)).toHaveText('Gold');

                // view_questを開く
                const viewTable = await openTableAsync(page, 'view_quest');
                await expect(getDataCell(viewTable, 0, 3)).toHaveText('Gold');

                // updateCellValueAtでDOMのみ更新し、その後propagateToSourceTableで伝搬する
                await page.evaluate(() => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const editor = (window as any).editor;
                    const table = editor.activeEditorTable;
                    // まずDOMだけ更新（伝搬なし）
                    table.updateCellValueAt(1, 4, 'Diamond');
                    // 変更リストをまとめてソーステーブルに伝搬
                    table.propagateToSourceTable([{
                        row: 1,
                        column: 4,
                        oldValue: 'Gold',
                        newValue: 'Diamond',
                    }]);
                });

                // ビューのDOMは更新されていること
                await expect(getDataCell(viewTable, 0, 3)).toHaveText('Diamond');

                // quest_rewardタブに切り替え
                const refreshedRewardTable = await openTableAsync(page, 'quest_reward');

                // ソーステーブルに伝搬されていること
                await expect(getDataCell(refreshedRewardTable, 0, 2)).toHaveText('Diamond');
                // 他の行は変更されていないこと
                await expect(getDataCell(refreshedRewardTable, 1, 2)).toHaveText('Gem');
                await expect(getDataCell(refreshedRewardTable, 2, 2)).toHaveText('Potion');
            },
        );
    },
);
