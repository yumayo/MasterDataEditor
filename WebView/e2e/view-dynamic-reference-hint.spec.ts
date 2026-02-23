import { test, expect } from '@playwright/test';
import { Page, Locator } from '@playwright/test';
import {
    installMockApiAsync,
    MockFileSystem,
} from './fixtures/mock-api';

/**
 * Explorerでビューテーブルを開き、EditorTableのLocatorを返す
 */
async function openViewTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.locator('[data-panel="views"]').click();
    await explorer.getByText(tableName, { exact: true }).click();
    const table = page.locator('.tab-wrapper:not([style*="display: none"]) .editor-table');
    await expect(table).toBeVisible();
    return table;
}

/**
 * 指定した行・列の参照ヒント要素のLocatorを返す
 * rowIndex: 0始まり（ヘッダー行を除く）
 * colIndex: 0始まり（行ヘッダーを除く）
 */
function getReferenceHint(table: Locator, rowIndex: number, colIndex: number): Locator {
    const row = table.locator('.editor-table-row').nth(rowIndex + 1);
    const cell = row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
    return cell.locator('.cell-reference-hint');
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
 * テストデータ構成:
 *
 * table: IDとマスターテーブル名のマッピング
 *   id=1 → master=chara
 *   id=2 → master=item
 *
 * chara: id=1→勇者, id=2→魔法使い, id=3→戦士
 * item:  id=1→ポーション, id=2→エリクサー, id=5→エーテル
 *
 * quest_reward: 動的参照列を持つ子テーブル
 *   id=1, group_id=1, reward_table_id=1, reward_record_id=1 → chara 勇者
 *   id=2, group_id=1, reward_table_id=2, reward_record_id=2 → item エリクサー
 *   id=3, group_id=2, reward_table_id=1, reward_record_id=2 → chara 魔法使い
 *   id=4, group_id=2, reward_table_id=2, reward_record_id=5 → item エーテル
 *
 * quest: ベーステーブル（動的参照列も持つ）
 *   id=1, name=MainQuest, first_clear_reward_table_id=1, first_clear_reward_record_id=3 → chara 戦士
 *   id=2, name=SideQuest, first_clear_reward_table_id=2, first_clear_reward_record_id=1 → item ポーション
 *
 * view_quest: questをベースにquest_rewardをgroup_idでJOIN
 *
 * ビュー合成ヘッダー:
 *   col0: id (quest)
 *   col1: name (quest)
 *   col2: first_clear_reward_table_id (quest) ※動的参照
 *   col3: first_clear_reward_record_id (quest) ※動的参照
 *   col4: quest_reward.id
 *   col5: quest_reward.reward_table_id
 *   col6: quest_reward.reward_record_id ※動的参照（バグ対象）
 *
 * ビュー表示（1:n展開後）:
 *   Row0: id=1, MainQuest, 1, 3, qr.id=1, qr.rtid=1, qr.rrid=1 (勇者)
 *   Row1: [pad], [pad], [pad], [pad], qr.id=2, qr.rtid=2, qr.rrid=2 (エリクサー)
 *   Row2: id=2, SideQuest, 2, 1, qr.id=3, qr.rtid=1, qr.rrid=2 (魔法使い)
 *   Row3: [pad], [pad], [pad], [pad], qr.id=4, qr.rtid=2, qr.rrid=5 (エーテル)
 */
function createFileSystem(): MockFileSystem {
    return {
        // tableマッピングテーブル: IDからマスターテーブル名を引く
        "schema/table.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "master", type: "string" },
            ],
            primary_key: "id",
        }),
        "data/table.csv": ["id,master", "1,chara", "2,item"].join("\n"),
        // charaテーブル
        "schema/chara.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "ja", type: "string" },
            ],
            primary_key: "id",
        }),
        "data/chara.csv": ["id,ja", "1,勇者", "2,魔法使い", "3,戦士"].join("\n"),
        // itemテーブル
        "schema/item.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "ja", type: "string" },
            ],
            primary_key: "id",
        }),
        "data/item.csv": ["id,ja", "1,ポーション", "2,エリクサー", "5,エーテル"].join("\n"),
        // quest_rewardテーブル: 動的参照列あり
        "schema/quest_reward.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "group_id", type: "int" },
                { key: 2, name: "reward_table_id", type: "int", reference: "table.master" },
                {
                    key: 3, name: "reward_record_id", type: "int",
                    reference: "$(table.id == $reward_table_id).master.ja",
                },
            ],
            primary_key: "id",
        }),
        "data/quest_reward.csv": [
            "id,group_id,reward_table_id,reward_record_id",
            "1,1,1,1",
            "2,1,2,2",
            "3,2,1,2",
            "4,2,2,5",
        ].join("\n"),
        // questテーブル: ベーステーブル（動的参照列も持つ）
        "schema/quest.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                { key: 2, name: "first_clear_reward_table_id", type: "int", reference: "table.master" },
                {
                    key: 3, name: "first_clear_reward_record_id", type: "int",
                    reference: "$(table.id == $first_clear_reward_table_id).master.ja",
                },
            ],
            primary_key: "id",
        }),
        "data/quest.csv": [
            "id,name,first_clear_reward_table_id,first_clear_reward_record_id",
            "1,MainQuest,1,3",
            "2,SideQuest,2,1",
        ].join("\n"),
        // ビュー定義: questベース、quest_rewardをgroup_idでJOIN
        "view/view_quest.json": JSON.stringify({
            name: "view_quest",
            baseTable: "quest",
            joins: [{
                sourceColumn: "id",
                targetTable: "quest_reward",
                targetColumn: "group_id",
                insertAfterViewColumnIndex: 3,
                sourceTable: "",
            }],
        }),
    };
}

// -------------------------------------------------------
// ビューテーブルでの動的参照（二段リスト）ヒント表示テスト
// -------------------------------------------------------
test.describe('ビューテーブルの動的参照ヒント表示', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        'JOIN列の動的参照ヒントが初期表示されること',
        async ({ page }) => {
            const table = await openViewTableAsync(page, 'view_quest');
            // quest_reward.reward_record_id列（colIndex=6）の参照ヒントを検証
            // 動的参照は非同期で解決されるため出現を待機する
            const row0Hint = getReferenceHint(table, 0, 6);
            await expect(row0Hint).toBeVisible({ timeout: 10000 });
            // Row0: reward_table_id=1(chara), reward_record_id=1 → 勇者
            await expect(row0Hint).toHaveText('勇者');
            // Row1: reward_table_id=2(item), reward_record_id=2 → エリクサー
            await expect(getReferenceHint(table, 1, 6)).toHaveText('エリクサー');
            // Row2: reward_table_id=1(chara), reward_record_id=2 → 魔法使い
            await expect(getReferenceHint(table, 2, 6)).toHaveText('魔法使い');
            // Row3: reward_table_id=2(item), reward_record_id=5 → エーテル
            await expect(getReferenceHint(table, 3, 6)).toHaveText('エーテル');
        },
    );

    test(
        'ベーステーブル列の動的参照ヒントも正常に表示されること（回帰テスト）',
        async ({ page }) => {
            const table = await openViewTableAsync(page, 'view_quest');
            // first_clear_reward_record_id列（colIndex=3）の参照ヒントを検証
            const row0Hint = getReferenceHint(table, 0, 3);
            await expect(row0Hint).toBeVisible({ timeout: 10000 });
            // Row0: first_clear_reward_table_id=1(chara), first_clear_reward_record_id=3 → 戦士
            await expect(row0Hint).toHaveText('戦士');
            // Row2: first_clear_reward_table_id=2(item), first_clear_reward_record_id=1 → ポーション
            // ※ Row1はパディング行なのでRow2がベース行2行目
            await expect(getReferenceHint(table, 2, 3)).toHaveText('ポーション');
        },
    );

    test(
        'JOIN列のvalueColumn変更時に依存列のヒントが更新されること',
        async ({ page }) => {
            const table = await openViewTableAsync(page, 'view_quest');
            // まず初期状態のヒントが表示されるまで待機
            const row0Hint = getReferenceHint(table, 0, 6);
            await expect(row0Hint).toBeVisible({ timeout: 10000 });
            await expect(row0Hint).toHaveText('勇者');
            // quest_reward.reward_table_id列（colIndex=5）のRow0を1→2に変更
            // reward_table_id=2はitemテーブルを指すので、reward_record_id=1はポーションになるはず
            await editCellAsync(page, table, 0, 5, '2');
            // quest_reward.reward_record_id列（colIndex=6）のRow0のヒントが更新されることを検証
            await expect(getReferenceHint(table, 0, 6)).toHaveText('ポーション');
        },
    );

    test(
        'JOIN列の動的参照セルをダブルクリックするとドロップダウンが表示されること',
        async ({ page }) => {
            const table = await openViewTableAsync(page, 'view_quest');
            // 動的参照ヒントが表示されるまで待機（参照データのプリロード完了を確認）
            const row0Hint = getReferenceHint(table, 0, 6);
            await expect(row0Hint).toBeVisible({ timeout: 10000 });
            await expect(row0Hint).toHaveText('勇者');
            // quest_reward.reward_record_id列（colIndex=6）のRow0をダブルクリック
            // Row0: reward_table_id=1 → charaテーブルのドロップダウンが開くべき
            const dynamicRefCell = getDataCell(table, 0, 6);
            await dynamicRefCell.dblclick();
            // ドロップダウンが表示されること
            const dropdown = page.locator('.grid-dropdown-list');
            await expect(dropdown).toBeVisible();
            // charaテーブルの全レコード（勇者、魔法使い、戦士）が選択肢に含まれること
            const items = dropdown.locator('.grid-dropdown-item');
            await expect(items).toHaveCount(3);
        },
    );

    test(
        'ベーステーブル列の動的参照セルをダブルクリックするとドロップダウンが表示されること（回帰テスト）',
        async ({ page }) => {
            const table = await openViewTableAsync(page, 'view_quest');
            // 動的参照ヒントが表示されるまで待機
            const row0Hint = getReferenceHint(table, 0, 3);
            await expect(row0Hint).toBeVisible({ timeout: 10000 });
            await expect(row0Hint).toHaveText('戦士');
            // first_clear_reward_record_id列（colIndex=3）のRow0をダブルクリック
            // Row0: first_clear_reward_table_id=1 → charaテーブルのドロップダウンが開くべき
            const dynamicRefCell = getDataCell(table, 0, 3);
            await dynamicRefCell.dblclick();
            // ドロップダウンが表示されること
            const dropdown = page.locator('.grid-dropdown-list');
            await expect(dropdown).toBeVisible();
            // charaテーブルの全レコード（勇者、魔法使い、戦士）が選択肢に含まれること
            const items = dropdown.locator('.grid-dropdown-item');
            await expect(items).toHaveCount(3);
        },
    );
});
