import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';
import { enableRelationsPanelAsync } from './fixtures/test-utils';

// =============================================================================
// RelationsPanel 動的参照（DynamicReference）のN:1ミニテーブル表示テスト
//
// 概要:
//   N:1参照が動的参照（$(table.id == $column).master.id 形式）の場合、
//   現在は resolveEntriesForEditorRowAsync() で isSimpleReference チェックにより
//   スキップされるため、ミニテーブルが表示されない。
//
//   このテストは「動的参照を持つ列でも正しくN:1ミニテーブルが表示される」
//   という仕様を検証する。
//
// テーブル構成:
//   table: id, enum, comment, master（テーブルリスト。masterカラムに実テーブル名が入る）
//   chara: id, name（キャラマスター）
//   item:  id, name（アイテムマスター）
//   quest: id, reward_table_id, reward_record_id, quest_reward_group_id
//     reward_table_id     → reference: "table.id"（どのテーブルかを指定）
//     reward_record_id    → reference: "$(table.id == $reward_table_id).master.id"
//                           （reward_table_id の値でtableテーブルを検索しmasterカラムを取得 → そのテーブルのidを参照）
//     quest_reward_group_id → reference: "quest_reward.group_id"（通常の逆参照）
//   quest_reward: id, group_id, reward_name
//
// テストシナリオ:
//   quest id=1: reward_table_id=1 → tableのid=1行のmaster="chara" → chara.id=3（まんぼう）
//   quest id=2: reward_table_id=2 → tableのid=2行のmaster="item"  → item.id=1（ポーション）
// =============================================================================

/**
 * 動的参照テスト用のファイルシステムを生成する
 */
function createDynamicReferenceTestFileSystem(): MockFileSystem {
    return {
        "schema/table.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "enum", type: "string" },
                { key: 2, name: "comment", type: "string" },
                { key: 3, name: "master", type: "string" },
            ],
            primary_key: ["id"],
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
            primary_key: ["id"],
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
            primary_key: ["id"],
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
                { key: 2, name: "reward_record_id", type: "int", reference: { sourceTable: "table", sourceMatchColumn: "id", sourceMatchValue: "$reward_table_id", destTable: "master", destColumn: "id" } },
                // quest_rewardのgroup_idを参照（通常の単純参照）
                { key: 3, name: "quest_reward_group_id", type: "int", reference: "quest_reward.group_id" },
            ],
            primary_key: ["id"],
        }),
        "data/quest.csv": [
            "id,reward_table_id,reward_record_id,quest_reward_group_id",
            "1,1,3,1",
            "2,2,1,1",
        ].join("\n"),
        "schema/quest_reward.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "group_id", type: "int" },
                { key: 2, name: "reward_name", type: "string" },
            ],
            primary_key: ["id"],
        }),
        "data/quest_reward.csv": [
            "id,group_id,reward_name",
            "1,1,ゴールド",
            "2,1,経験値",
            "3,2,レアアイテム",
        ].join("\n"),
    };
}

/**
 * エクスプローラーからテーブルを開き、左ペインのアクティブな EditorTable の Locator を返す。
 * タブ名でスコープを限定することで strict mode violation を防ぐ。
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
 * 指定した行ヘッダーをクリックして行を選択する
 * rowIndex: 0始まり（ヘッダー行を除く）
 */
async function selectRowAsync(table: Locator, rowIndex: number): Promise<void> {
    const header = table.locator('.editor-table-row-header').nth(rowIndex);
    await header.click();
}

/**
 * RelationsPanel 内の指定テーブル名のセクションを取得する
 */
function getRelationSection(page: Page, tableName: string): Locator {
    return page.locator('.relations-table-section').filter({
        has: page.locator('.relations-table-title').getByText(tableName, { exact: true }),
    });
}

// =============================================================================
// ペインスタック上のRelationsPanelで動的参照を持つテーブルの行をCtrl+クリックした際に
// resolveEntriesForTableRowAsync が動的参照をスキップするバグの再現テスト
//
// 再現シナリオ:
//   1. quest テーブルを開く
//   2. quest row0 を選択する → RP1 に quest_reward の 1:N ミニテーブルが表示される
//      （quest.quest_reward_group_id → quest_reward.group_id の逆参照）
//   3. RP1 の quest_reward ミニテーブルのセルを Ctrl+クリック → RP2 が右スロットに追加される
//      RP2 は resolveEntriesForTableRowAsync("quest_reward", "1") で解決される
//   4. quest_reward テーブルには動的参照（reward_record_id）があるが
//      resolveEntriesForTableRowAsync は isSimpleReference でない参照をスキップするため
//      chara セクションが表示されない → このアサーションが RED で失敗する
//
// フィクスチャ構成（ペインスタックドリルダウン専用）:
//   table: id, master（テーブルリスト。master カラムに実テーブル名が入る）
//   chara: id, name（キャラマスター）
//   quest: id, name（クエストマスター）
//   quest_reward: id, quest_id（→ quest.id 参照）, reward_table_id（→ table.id 参照）,
//                 reward_record_id（動的参照: $(table.id == $reward_table_id).master.id → chara.id）
//
//   quest_reward id=1: quest_id=1, reward_table_id=1 → master="chara" → chara.id=2
//   quest_reward id=2: quest_id=1, reward_table_id=1 → master="chara" → chara.id=3
// =============================================================================

/**
 * ペインスタックドリルダウンでの動的参照解決テスト用ファイルシステムを生成する
 */
function createPaneStackDynamicReferenceTestFileSystem(): MockFileSystem {
    return {
        "schema/table.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "master", type: "string" },
            ],
            primary_key: ["id"],
        }),
        "data/table.csv": [
            "id,master",
            "1,chara",
        ].join("\n"),
        "schema/chara.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
            ],
            primary_key: ["id"],
        }),
        "data/chara.csv": [
            "id,name",
            "1,うーぱー",
            "2,ひつじ",
            "3,まんぼう",
        ].join("\n"),
        "schema/quest.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                // quest_reward.group_id への参照（1:N逆参照のため quest_reward ミニテーブルが RP1 に表示される）
                { key: 2, name: "quest_reward_group_id", type: "int", reference: "quest_reward.group_id" },
            ],
            primary_key: ["id"],
        }),
        "data/quest.csv": [
            "id,name,quest_reward_group_id",
            "1,はじまりのクエスト,1",
        ].join("\n"),
        "schema/quest_reward.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "group_id", type: "int" },
                // table.id への参照（どのテーブルかを指定する列）
                { key: 2, name: "reward_table_id", type: "int", reference: "table.id" },
                // 動的参照: reward_table_id の値で table テーブルを検索し master カラムの値（テーブル名）を取得、
                // そのテーブルの id カラムを参照する
                { key: 3, name: "reward_record_id", type: "int", reference: { sourceTable: "table", sourceMatchColumn: "id", sourceMatchValue: "$reward_table_id", destTable: "master", destColumn: "id" } },
            ],
            primary_key: ["id"],
        }),
        "data/quest_reward.csv": [
            "id,group_id,reward_table_id,reward_record_id",
            "1,1,1,2",
            "2,1,1,3",
        ].join("\n"),
    };
}

test.describe('ペインスタック上のRelationsPanelで動的参照を持つテーブルにドリルダウンしたとき chara セクションが表示される', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createPaneStackDynamicReferenceTestFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
        await enableRelationsPanelAsync(page);
    });

    test(
        'quest row0 選択後に RP1 の quest_reward ミニテーブルをCtrl+クリックすると RP2 に chara セクションが表示される',
        async ({ page }) => {
            // quest テーブルを開いて row0（はじまりのクエスト）を選択する
            const questTable = await openTableAsync(page, 'quest');
            await selectRowAsync(questTable, 0);

            // RP1 に quest_reward の 1:N ミニテーブルが表示されるまで待機する
            // （quest.quest_reward_group_id=1 → quest_reward.group_id=1 の逆参照）
            const questRewardSection = getRelationSection(page, 'quest_reward');
            await expect(questRewardSection).toBeVisible();

            // RP1 の quest_reward ミニテーブルの最初のデータセルを取得する
            // N:1ミニテーブルと同様に id 列は hideColumnsByName() で非表示のため visible なセルを取得する
            const questRewardMiniTable = questRewardSection.locator('.editor-table');
            await expect(questRewardMiniTable).toBeVisible();
            const visibleCell = questRewardMiniTable.locator(
                '.editor-table-cell:not(.editor-table-row-header)' +
                ':not(.editor-table-column-header)' +
                ':not(.editor-table-corner-cell)' +
                ':not([style*="display: none"])'
            ).first();
            await expect(visibleCell).toBeVisible();

            // Ctrl+クリックでペインスタックに RP2 を追加する
            await visibleCell.click({ modifiers: ['Control'] });

            // ナビゲーションバーが表示されること（ペインスタックが3つになった）
            await expect(page.locator('.editor-navigation-bar')).toBeVisible();

            // 右スロットに RP2 が表示されること
            await expect(page.locator('.editor-right-slot .relations-panel')).toBeVisible();

            // RP2 に chara セクションが表示されること
            // resolveEntriesForTableRowAsync が動的参照をスキップするバグにより、
            // 現状はこのアサーションが失敗する（RED）
            const charaSection = page.locator('.editor-right-slot .relations-panel .relations-table-section').filter({
                has: page.locator('.relations-table-title').getByText('chara', { exact: true }),
            });
            await expect(charaSection).toBeVisible();
        },
    );
});

test.describe('RelationsPanel 動的参照のN:1ミニテーブル表示', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createDynamicReferenceTestFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
        await enableRelationsPanelAsync(page);
    });

    test(
        'quest id=1 を選択したとき、動的参照で解決された chara テーブルのミニテーブルが表示される',
        async ({ page }) => {
            // quest テーブルを開いて id=1 の行（0番目）を選択する
            const questTable = await openTableAsync(page, 'quest');
            await selectRowAsync(questTable, 0);

            // RelationsPanel に .relations-table-section が 3 つ表示されること
            // （table: reward_table_id の参照先, chara: 動的参照解決結果, quest_reward: 1:N逆参照）
            const sections = page.locator('.relations-table-section');
            await expect(sections).toHaveCount(3);

            // chara セクションが表示されること
            const charaSection = getRelationSection(page, 'chara');
            await expect(charaSection).toBeVisible();

            // chara セクションのタグが N:1 であること
            const charaTag = charaSection.locator('.relations-tag');
            await expect(charaTag).toHaveText('N:1');

            // chara セクションのミニテーブルに id=3（まんぼう）の行が表示されること
            // ミニテーブルに「まんぼう」（chara id=3）が表示されること
            await expect(charaSection.locator('.editor-table').getByText('まんぼう', { exact: true })).toBeVisible();
        },
    );

    test(
        'quest id=2 を選択したとき、動的参照で item テーブルが表示される',
        async ({ page }) => {
            // quest テーブルを開いて id=2 の行（1番目）を選択する
            // reward_table_id=2 → table.id=2 の master="item" → item.id=1（ポーション）
            const questTable = await openTableAsync(page, 'quest');
            await selectRowAsync(questTable, 1);

            // item セクションが表示されること
            const itemSection = getRelationSection(page, 'item');
            await expect(itemSection).toBeVisible();

            // item セクションのタグが N:1 であること
            const itemTag = itemSection.locator('.relations-tag');
            await expect(itemTag).toHaveText('N:1');

            // item セクションのミニテーブルに id=1（ポーション）の行が表示されること
            const itemMiniTable = itemSection.locator('.editor-table');
            await expect(itemMiniTable.getByText('ポーション', { exact: true })).toBeVisible();
        },
    );
});
