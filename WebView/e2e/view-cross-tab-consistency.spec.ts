import { test, expect } from '@playwright/test';
import { Page, Locator } from '@playwright/test';
import {
    installMockApiAsync,
    MockFileSystem,
} from './fixtures/mock-api';

/**
 * Explorerでテーブルを開き、アクティブなタブのEditorTableを返す
 * ビューテーブルの場合はVIEWSパネルに切り替える
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
 * 指定した行・列の参照ヒント要素を返す
 */
function getReferenceHint(table: Locator, rowIndex: number, colIndex: number): Locator {
    return getDataCell(table, rowIndex, colIndex).locator('.cell-reference-hint');
}

/**
 * セルの値を編集する
 * ダブルクリックで編集モードに入り、全選択→新しい値を入力→Enterで確定
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
 * テストデータ構成:
 *
 * chara: id(PK), skill_id(FK→skill.id)
 *   id=1,skill_id=100 / id=2,skill_id=200
 *
 * chara_name: id(PK, FK→chara.id), ja
 *   id=1,ja=うーぱーるーぱー / id=2,ja=まーぼーどーふ
 *
 * skill: id(PK), value
 *   id=100,value=ファイアボール / id=200,value=ヒール
 *
 * quest: id(PK), name, quest_reward_group_id
 *   id=1,name=はじまりの冒険,quest_reward_group_id=1
 *
 * quest_reward: id(PK), group_id, reward_record_id(FK→chara.id)
 *   id=1,group_id=1,reward_record_id=1 / id=2,group_id=1,reward_record_id=2
 *
 * view_chara: charaベース
 *   JOINs: chara_name via chara.id = chara_name.id
 *          skill via chara.skill_id = skill.id
 *   ビュー列: chara.id(0), chara.skill_id(1), chara_name.ja(2), skill.value(3)
 *
 * view_quest: questベース
 *   JOINs: quest_reward via quest.quest_reward_group_id = quest_reward.group_id
 *   ビュー列: quest.id(0), quest.name(1), quest_reward_group_id(2),
 *             quest_reward.id(3), quest_reward.reward_record_id(4)
 *   ※ quest_reward.reward_record_idにreference:"chara_name.ja"を設定
 *
 * ビュー表示イメージ（view_chara）:
 * | chara.id | chara.skill_id | chara_name.ja    | skill.value    |
 * |    1     |      100       | うーぱーるーぱー | ファイアボール |
 * |    2     |      200       | まーぼーどーふ   | ヒール         |
 *
 * ビュー表示イメージ（view_quest）:
 * | quest.id | quest.name     | quest_reward_group_id | quest_reward.id | quest_reward.reward_record_id |
 * |    1     | はじまりの冒険 |          1            |       1         |              1                |
 * | [pad]    | [pad]          |        [pad]          |       2         |              2                |
 * ※ reward_record_id列の参照ヒント: id=1→うーぱーるーぱー, id=2→まーぼーどーふ
 */
function createFileSystem(): MockFileSystem {
    return {
        // charaテーブル
        "schema/chara.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "skill_id", type: "int", reference: "skill.id" },
            ],
            primary_key: "id",
        }),
        "data/chara.csv": ["id,skill_id", "1,100", "2,200"].join("\n"),
        // chara_nameテーブル（charaの名前を管理するサブテーブル）
        "schema/chara_name.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int", reference: "chara.id" },
                { key: 1, name: "ja", type: "string" },
            ],
            primary_key: "id",
        }),
        "data/chara_name.csv": ["id,ja", "1,うーぱーるーぱー", "2,まーぼーどーふ"].join("\n"),
        // skillテーブル
        "schema/skill.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "value", type: "string" },
            ],
            primary_key: "id",
        }),
        "data/skill.csv": ["id,value", "100,ファイアボール", "200,ヒール"].join("\n"),
        // questテーブル
        "schema/quest.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                { key: 2, name: "quest_reward_group_id", type: "int" },
            ],
            primary_key: "id",
        }),
        "data/quest.csv": ["id,name,quest_reward_group_id", "1,はじまりの冒険,1"].join("\n"),
        // quest_rewardテーブル（reward_record_idがchara.idを参照し、ヒントにchara_name.jaを表示）
        "schema/quest_reward.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "group_id", type: "int" },
                { key: 2, name: "reward_record_id", type: "int", reference: "chara_name.ja" },
            ],
            primary_key: "id",
        }),
        "data/quest_reward.csv": ["id,group_id,reward_record_id", "1,1,1", "2,1,2"].join("\n"),
        // view_chara: charaベース、chara_name + skill をJOIN
        "view/view_chara.json": JSON.stringify({
            name: "view_chara",
            baseTable: "chara",
            joins: [
                {
                    sourceColumn: "id",
                    targetTable: "chara_name",
                    targetColumn: "id",
                    insertAfterViewColumnIndex: 1,
                    sourceTable: "",
                },
                {
                    sourceColumn: "skill_id",
                    targetTable: "skill",
                    targetColumn: "id",
                    insertAfterViewColumnIndex: 2,
                    sourceTable: "",
                },
            ],
        }),
        // view_quest: questベース、quest_reward をJOIN
        "view/view_quest.json": JSON.stringify({
            name: "view_quest",
            baseTable: "quest",
            joins: [{
                sourceColumn: "quest_reward_group_id",
                targetTable: "quest_reward",
                targetColumn: "group_id",
                insertAfterViewColumnIndex: 2,
                sourceTable: "",
            }],
        }),
    };
}

// -------------------------------------------------------
// ビュータブ間のデータ整合性テスト
// 異なるビュータブで同一ソーステーブルのデータを共有する際の
// 整合性バグを再現する
// -------------------------------------------------------
test.describe(
    'ビュータブ間のデータ整合性',
    () => {
        test(
            'ビューの結合列を編集後、他のビュータブに切替えて戻っても値が維持される',
            async ({ page }) => {
                await installMockApiAsync(page, createFileSystem());
                await page.goto('/');

                // 1. view_charaタブを開く
                const viewCharaTable = await openTableAsync(page, 'view_chara');
                // ビュー列: chara.id(0), chara.skill_id(1), chara_name.ja(2), skill.value(3)

                // 2. view_questタブを開く（両ビューが同時にタブに存在する状態を作る）
                await openTableAsync(page, 'view_quest');

                // 3. view_charaタブに切り替え
                const refreshedCharaTable = await openTableAsync(page, 'view_chara');

                // 4. chara_name.ja（row0, col2）の初期値を確認
                await expect(getDataCell(refreshedCharaTable, 0, 2)).toHaveText('うーぱーるーぱー');

                // 5. chara_name.ja（row0, col2）を"うーぱー"に編集
                await editCellAsync(page, refreshedCharaTable, 0, 2, 'うーぱー');
                await expect(getDataCell(refreshedCharaTable, 0, 2)).toHaveText('うーぱー');

                // 6. view_questタブに切り替え
                await openTableAsync(page, 'view_quest');

                // 7. view_charaタブに戻る
                const finalCharaTable = await openTableAsync(page, 'view_chara');

                // 8. chara_name.ja（row0）が"うーぱー"のままであること
                // Bug B: 実際には"うーぱーるーぱー"に巻き戻る
                await expect(getDataCell(finalCharaTable, 0, 2)).toHaveText('うーぱー');

                // 編集していない行は変更されていないこと
                await expect(getDataCell(finalCharaTable, 1, 2)).toHaveText('まーぼーどーふ');
            },
        );

        test(
            'ビューの結合列編集が他ビュータブの参照ヒントに反映される',
            async ({ page }) => {
                await installMockApiAsync(page, createFileSystem());
                await page.goto('/');

                // 1. view_charaタブを開く
                await openTableAsync(page, 'view_chara');

                // 2. view_questタブを開く
                await openTableAsync(page, 'view_quest');

                // 3. view_charaタブに切り替え
                const charaTable = await openTableAsync(page, 'view_chara');

                // 4. chara_name.ja（row0, col2）を"うーぱー"に編集
                await editCellAsync(page, charaTable, 0, 2, 'うーぱー');
                await expect(getDataCell(charaTable, 0, 2)).toHaveText('うーぱー');

                // 5. view_questタブに切り替え
                const questTable = await openTableAsync(page, 'view_quest');

                // 6. quest_reward.reward_record_id（row0, col4）の参照ヒントを確認
                // reward_record_id=1 → chara_name.id=1 → ja の値
                // ビュー列: quest.id(0), quest.name(1), quest_reward_group_id(2),
                //           quest_reward.id(3), quest_reward.reward_record_id(4)
                const row0Hint = getReferenceHint(questTable, 0, 4);
                await expect(row0Hint).toBeVisible({ timeout: 10000 });

                // 7. ヒントに"うーぱー"（編集後の値）が含まれること
                // Bug A: 実際には旧値"うーぱーるーぱー"が表示される
                await expect(row0Hint).toHaveText('うーぱー');

                // row1のreward_record_id=2は未編集なので"まーぼーどーふ"のまま
                const row1Hint = getReferenceHint(questTable, 1, 4);
                await expect(row1Hint).toBeVisible({ timeout: 10000 });
                await expect(row1Hint).toHaveText('まーぼーどーふ');
            },
        );
    },
);
