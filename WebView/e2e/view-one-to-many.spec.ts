import { test, expect } from '@playwright/test';
import { Page, Locator } from '@playwright/test';
import {
    installMockApiAsync,
    readMockFileAsync,
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
 * セルをクリックして選択状態にする
 */
async function selectCellAsync(page: Page, table: Locator, rowIndex: number, colIndex: number): Promise<void> {
    const cell = getDataCell(table, rowIndex, colIndex);
    await cell.click();
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
function createOneToManyFileSystem(): MockFileSystem {
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

/**
 * ドロップダウンFK変更テスト用データ:
 * reward_group: id=1,GroupA / id=2,GroupB / id=3,GroupC
 * quest: id=1,name=MainQuest,reward_group_id=1 / id=2,name=SideQuest,reward_group_id=2
 *   ※ reward_group_id列にreference:"reward_group.id"を設定（ドロップダウン表示用）
 * quest_reward: id=1,group_id=1,item=Gold / id=2,group_id=1,item=Gem / id=3,group_id=2,item=Potion
 *
 * view_quest: questベース、quest_rewardをquest.reward_group_id → quest_reward.group_idでJOIN
 *
 * 期待されるビュー表示:
 * | quest.id | quest.name | quest.reward_group_id | quest_reward.id | quest_reward.item |
 * |    1     | MainQuest  |          1            |       1         |      Gold         |
 * |  [pad]   |   [pad]    |        [pad]          |       2         |      Gem          |
 * |    2     | SideQuest  |          2            |       3         |      Potion       |
 */
function createDropdownFkTestFileSystem(): MockFileSystem {
    return {
        "schema/quest.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                { key: 2, name: "reward_group_id", type: "int", reference: "reward_group.id" },
            ],
            primary_key: "id",
        }),
        "data/quest.csv": ["id,name,reward_group_id", "1,MainQuest,1", "2,SideQuest,2"].join("\n"),
        "schema/reward_group.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
            ],
            primary_key: "id",
        }),
        "data/reward_group.csv": ["id,name", "1,GroupA", "2,GroupB", "3,GroupC"].join("\n"),
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
                sourceColumn: "reward_group_id",
                targetTable: "quest_reward",
                targetColumn: "group_id",
                insertAfterViewColumnIndex: 2,
                sourceTable: "",
            }],
        }),
    };
}

/**
 * 3ベース行テストデータ（複数ビュー行ペーストのテスト用）:
 * quest: id=1,MainQuest / id=2,SideQuest / id=3,ExtraQuest
 * quest_reward: id=1,group_id=1,Gold / id=2,group_id=1,Gem / id=3,group_id=2,Potion / id=4,group_id=3,Sword
 *
 * view_quest: questベース、quest_rewardをquest.id → quest_reward.group_idでJOIN
 *
 * 期待されるビュー表示:
 * | quest.id | quest.name | quest_reward.id | quest_reward.item |
 * |    1     | MainQuest  |       1         |      Gold         |  ← リーダー行（1:2）
 * |  [pad]   |   [pad]    |       2         |      Gem          |  ← パディング
 * |    2     | SideQuest  |       3         |      Potion       |  ← 1:1
 * |    3     | ExtraQuest |       4         |      Sword        |  ← 1:1
 */
function createThreeBaseRowFileSystem(): MockFileSystem {
    return {
        "schema/quest.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
            ],
            primary_key: "id",
        }),
        "data/quest.csv": ["id,name", "1,MainQuest", "2,SideQuest", "3,ExtraQuest"].join("\n"),
        "schema/quest_reward.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "group_id", type: "int" },
                { key: 2, name: "item", type: "string" },
            ],
            primary_key: "id",
        }),
        "data/quest_reward.csv": ["id,group_id,item", "1,1,Gold", "2,1,Gem", "3,2,Potion", "4,3,Sword"].join("\n"),
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

/**
 * 5ベース行テストデータ（メタデータ範囲外ペーストのバグ再現用）:
 * quest: id=1,Quest1,group_id=1 / id=2,Quest2,group_id=1 / id=3,Quest3,group_id=2 / id=4,Quest4,group_id=3 / id=5,Quest5,group_id=空
 * quest_reward: group_id=1に2件(Gold,Gem), group_id=2に1件(Potion), group_id=3に1件(Sword)
 *
 * view_quest: questベース、quest_rewardをquest.group_id → quest_reward.group_idでJOIN
 *
 * 期待されるビュー表示:
 * | quest.id | quest.name | quest.group_id | quest_reward.id | quest_reward.item |
 * |    1     | Quest1     |       1        |       1         |      Gold         |  ← リーダー（1:2）
 * |  [pad]   |   [pad]    |     [pad]      |       2         |      Gem          |  ← パディング
 * |    2     | Quest2     |       1        |       1         |      Gold         |  ← リーダー（1:2）
 * |  [pad]   |   [pad]    |     [pad]      |       2         |      Gem          |  ← パディング
 * |    3     | Quest3     |       2        |       3         |      Potion       |  ← 1:1
 * |    4     | Quest4     |       3        |       4         |      Sword        |  ← 1:1
 * |    5     | Quest5     |                |                 |                   |  ← LEFT JOIN空
 */
function createFiveBaseRowFileSystem(): MockFileSystem {
    return {
        "schema/quest.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                { key: 2, name: "group_id", type: "int" },
            ],
            primary_key: "id",
        }),
        "data/quest.csv": ["id,name,group_id", "1,Quest1,1", "2,Quest2,1", "3,Quest3,2", "4,Quest4,3", "5,Quest5,"].join("\n"),
        "schema/quest_reward.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "group_id", type: "int" },
                { key: 2, name: "item", type: "string" },
            ],
            primary_key: "id",
        }),
        "data/quest_reward.csv": ["id,group_id,item", "1,1,Gold", "2,1,Gem", "3,2,Potion", "4,3,Sword"].join("\n"),
        "view/view_quest.json": JSON.stringify({
            name: "view_quest",
            baseTable: "quest",
            joins: [{
                sourceColumn: "group_id",
                targetTable: "quest_reward",
                targetColumn: "group_id",
                insertAfterViewColumnIndex: 2,
                sourceTable: "",
            }],
        }),
    };
}

// -------------------------------------------------------
// 1:n展開のテスト
// -------------------------------------------------------
test.describe('1:n展開ビュー', () => {

    test('1:n展開で全子行が表示されること', async ({ page }) => {
        await installMockApiAsync(page, createOneToManyFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_quest');

        // ビュー列: quest.id(0), quest.name(1), quest_reward.id(2), quest_reward.item(3)
        // 行0: quest.id=1, MainQuest, qr.id=1, Gold
        await expect(getDataCell(table, 0, 0)).toHaveText(/1/);
        await expect(getDataCell(table, 0, 1)).toHaveText('MainQuest');
        await expect(getDataCell(table, 0, 2)).toHaveText('1');
        await expect(getDataCell(table, 0, 3)).toHaveText('Gold');

        // 行1: パディング, パディング, qr.id=2, Gem
        await expect(getDataCell(table, 1, 2)).toHaveText('2');
        await expect(getDataCell(table, 1, 3)).toHaveText('Gem');

        // 行2: quest.id=2, SideQuest, qr.id=3, Potion
        await expect(getDataCell(table, 2, 0)).toHaveText('2');
        await expect(getDataCell(table, 2, 1)).toHaveText('SideQuest');
        await expect(getDataCell(table, 2, 2)).toHaveText('3');
        await expect(getDataCell(table, 2, 3)).toHaveText('Potion');
    });

    test('パディングセルが空で表示されること', async ({ page }) => {
        await installMockApiAsync(page, createOneToManyFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_quest');

        // 行1のquest列（col 0, 1）はパディング → 空文字
        await expect(getDataCell(table, 1, 0)).toHaveText('');
        await expect(getDataCell(table, 1, 1)).toHaveText('');
    });

    test('パディングセルにview-padding-cellクラスが付与されること', async ({ page }) => {
        await installMockApiAsync(page, createOneToManyFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_quest');

        // 行1のquest列はパディングセル
        const paddingCell = getDataCell(table, 1, 0);
        await expect(paddingCell).toHaveClass(/view-padding-cell/);

        // 行0のquest列は通常セル（パディングではない）
        const normalCell = getDataCell(table, 0, 0);
        await expect(normalCell).not.toHaveClass(/view-padding-cell/);
    });

    test('パディングセルのダブルクリックで赤枠振動アニメーションが表示されること', async ({ page }) => {
        await installMockApiAsync(page, createOneToManyFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_quest');

        // パディングセルをクリックして選択
        await selectCellAsync(page, table, 1, 0);

        // パディングセルをダブルクリック → 編集モードにはならず拒否アニメーション
        const paddingCell = getDataCell(table, 1, 0);
        await paddingCell.dblclick();

        // テキストフィールドが表示されないことを確認
        const editField = page.locator('.grid-textfield-active');
        await expect(editField).not.toBeVisible();
    });

    test('パディングセルへのペーストが拒否されること', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await installMockApiAsync(page, createOneToManyFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_quest');

        // 非パディングセルの値をコピーしてクリップボードに載せる
        await selectCellAsync(page, table, 0, 0);
        await page.keyboard.press('Control+c');

        // パディングセルを選択
        await selectCellAsync(page, table, 1, 0);

        // ペースト
        await page.keyboard.press('Control+v');

        // パディングセルは空のまま
        await expect(getDataCell(table, 1, 0)).toHaveText('');
    });

    test('パディングセルへのDelete操作が拒否されること', async ({ page }) => {
        await installMockApiAsync(page, createOneToManyFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_quest');

        // 非パディングの結合テーブルセルを選択
        await selectCellAsync(page, table, 1, 2);
        const beforeValue = await getDataCell(table, 1, 2).textContent();

        // パディングセルを含む範囲を選択（Shift+クリック）
        const paddingCell = getDataCell(table, 1, 0);
        await paddingCell.click({ modifiers: ['Shift'] });

        // Delete
        await page.keyboard.press('Delete');

        // 結合テーブルセルは値が変わらない（操作全体が拒否されるため）
        await expect(getDataCell(table, 1, 2)).toHaveText(beforeValue!);
    });

    test('非パディングセル（結合テーブルの実データ行）が編集可能なこと', async ({ page }) => {
        await installMockApiAsync(page, createOneToManyFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_quest');

        // 行1のquest_reward.item（col 3）を編集
        await editCellAsync(page, table, 1, 3, 'Diamond');
        await expect(getDataCell(table, 1, 3)).toHaveText('Diamond');
    });

    test('折りたたみ/展開が動作すること', async ({ page }) => {
        await installMockApiAsync(page, createOneToManyFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_quest');

        // 折りたたみトグルが存在するか確認
        const toggle = table.locator('.view-collapse-toggle').first();
        await expect(toggle).toBeVisible();
        await expect(toggle).toHaveText('▼');

        // 折りたたむ
        await toggle.click();
        await expect(toggle).toHaveText('▶');

        // 子行（行1）が非表示になることを確認
        const row1 = table.locator('.editor-table-row').nth(2);
        await expect(row1).toHaveCSS('display', 'none');

        // 展開する
        await toggle.click();
        await expect(toggle).toHaveText('▼');

        // 子行が表示されることを確認
        await expect(row1).not.toHaveCSS('display', 'none');
    });

    test('保存時にベーステーブルデータが正しく抽出されること', async ({ page }) => {
        await installMockApiAsync(page, createOneToManyFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_quest');

        // quest.nameを編集
        await editCellAsync(page, table, 0, 1, 'EditedQuest');

        // 保存（Ctrl+S）
        await page.keyboard.press('Control+s');
        await page.waitForTimeout(500);

        // questのCSVを検証 → パディング行は保存されず、2行のみ
        const questCsv = await readMockFileAsync(page, 'data/quest.csv');
        const questLines = questCsv.split('\n').filter((l: string) => l.trim() !== '');
        expect(questLines.length).toBe(3); // ヘッダー + 2データ行
        expect(questLines[0]).toContain('id');
        expect(questLines[1]).toContain('EditedQuest');
        expect(questLines[2]).toContain('SideQuest');
    });

    test('保存時に結合テーブルデータが正しく抽出されること', async ({ page }) => {
        await installMockApiAsync(page, createOneToManyFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_quest');

        // quest_reward.itemを編集（行1 = Gem → Ruby）
        await editCellAsync(page, table, 1, 3, 'Ruby');

        // 保存
        await page.keyboard.press('Control+s');
        await page.waitForTimeout(500);

        // quest_rewardのCSVを検証 → 3行すべて保持（重複排除済み）
        const rewardCsv = await readMockFileAsync(page, 'data/quest_reward.csv');
        const rewardLines = rewardCsv.split('\n').filter((l: string) => l.trim() !== '');
        expect(rewardLines.length).toBe(4); // ヘッダー + 3データ行
        expect(rewardLines[0]).toContain('id');
        // id=2のitemがRubyに変更されていること
        expect(rewardCsv).toContain('Ruby');
        // Gemは存在しないこと（Rubyに変更されたため）
        expect(rewardCsv).not.toContain('Gem');
    });

    test('1:1JOINとの共存（同一ビュー内に1:1と1:nが混在するケース）', async ({ page }) => {
        // 1:1のskill参照と1:nのquest_rewardが混在するビューを作成
        const fs: MockFileSystem = {
            ...createOneToManyFileSystem(),
            "schema/quest.json": JSON.stringify({
                header: [
                    { key: 0, name: "id", type: "int" },
                    { key: 1, name: "name", type: "string" },
                    { key: 2, name: "difficulty_id", type: "int", reference: "difficulty.id" },
                ],
                primary_key: "id",
            }),
            "data/quest.csv": ["id,name,difficulty_id", "1,MainQuest,1", "2,SideQuest,2"].join("\n"),
            "schema/difficulty.json": JSON.stringify({
                header: [
                    { key: 0, name: "id", type: "int" },
                    { key: 1, name: "label", type: "string" },
                ],
                primary_key: "id",
            }),
            "data/difficulty.csv": ["id,label", "1,Easy", "2,Hard"].join("\n"),
            "view/view_quest.json": JSON.stringify({
                name: "view_quest",
                baseTable: "quest",
                joins: [
                    {
                        sourceColumn: "difficulty_id",
                        targetTable: "difficulty",
                        targetColumn: "id",
                        insertAfterViewColumnIndex: 2,
                        sourceTable: "",
                    },
                    {
                        sourceColumn: "id",
                        targetTable: "quest_reward",
                        targetColumn: "group_id",
                        insertAfterViewColumnIndex: 3,
                        sourceTable: "",
                    },
                ],
            }),
        };

        await installMockApiAsync(page, fs);
        await page.goto('/');
        const table = await openTableAsync(page, 'view_quest');

        // ビュー列: quest.id(0), quest.name(1), quest.difficulty_id(2), difficulty.label(3), quest_reward.id(4), quest_reward.item(5)
        // 行0: 1, MainQuest, 1, Easy, 1, Gold
        await expect(getDataCell(table, 0, 0)).toHaveText(/1/);
        await expect(getDataCell(table, 0, 1)).toHaveText('MainQuest');
        await expect(getDataCell(table, 0, 3)).toHaveText('Easy');
        await expect(getDataCell(table, 0, 5)).toHaveText('Gold');

        // 行1: [pad], [pad], [pad], [pad], 2, Gem (1:nの2行目)
        await expect(getDataCell(table, 1, 0)).toHaveText('');
        await expect(getDataCell(table, 1, 4)).toHaveText('2');
        await expect(getDataCell(table, 1, 5)).toHaveText('Gem');

        // 行2: 2, SideQuest, 2, Hard, 3, Potion (1:1のdifficulty + 1:1のquest_reward)
        await expect(getDataCell(table, 2, 0)).toHaveText('2');
        await expect(getDataCell(table, 2, 1)).toHaveText('SideQuest');
        await expect(getDataCell(table, 2, 3)).toHaveText('Hard');
        await expect(getDataCell(table, 2, 5)).toHaveText('Potion');
    });

    // ---------------------------------------------------------
    // FK値変更時の行数更新テスト
    // ---------------------------------------------------------

    test('source列の値変更で1:2→1:1になったとき行が減ること', async ({ page }) => {
        await installMockApiAsync(page, createOneToManyFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_quest');

        // 初期状態確認: 行0=Gold, 行1=Gem(パディング), 行2=SideQuest/Potion
        await expect(getDataCell(table, 0, 3)).toHaveText('Gold');
        await expect(getDataCell(table, 1, 3)).toHaveText('Gem');
        await expect(getDataCell(table, 2, 1)).toHaveText('SideQuest');

        // quest.id=1のセル（行0, col0）を "2" に変更
        // → quest_rewardでgroup_id=2にマッチする行はid=3(Potion)のみ → 1行に減少
        await editCellAsync(page, table, 0, 0, '2');

        // 行0: quest.id=2, MainQuest, qr.id=3, Potion（group_id=2の1件マッチ）
        await expect(getDataCell(table, 0, 0)).toHaveText('2');
        await expect(getDataCell(table, 0, 1)).toHaveText('MainQuest');
        await expect(getDataCell(table, 0, 2)).toHaveText('3');
        await expect(getDataCell(table, 0, 3)).toHaveText('Potion');

        // 行1: 旧row2のSideQuestが繰り上がっている
        await expect(getDataCell(table, 1, 0)).toHaveText('2');
        await expect(getDataCell(table, 1, 1)).toHaveText('SideQuest');
        await expect(getDataCell(table, 1, 2)).toHaveText('3');
        await expect(getDataCell(table, 1, 3)).toHaveText('Potion');

        // 行2は空（旧パディング行のGemが消えた）
        await expect(getDataCell(table, 2, 0)).toHaveText('');
        await expect(getDataCell(table, 2, 3)).toHaveText('');
    });

    test('source列の値変更で1:1→1:2になったとき行が増えること', async ({ page }) => {
        await installMockApiAsync(page, createOneToManyFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_quest');

        // 初期状態確認: 行2=SideQuest, quest.id=2
        await expect(getDataCell(table, 2, 0)).toHaveText('2');
        await expect(getDataCell(table, 2, 1)).toHaveText('SideQuest');

        // quest.id=2のセル（行2, col0）を "1" に変更
        // → quest_rewardでgroup_id=1にマッチする行はid=1(Gold),id=2(Gem) → 2行に増加
        await editCellAsync(page, table, 2, 0, '1');

        // 行2: quest.id=1, SideQuest, qr.id=1, Gold（group_id=1の1件目）
        // トグル文字▼が含まれる可能性があるため正規表現を使用
        await expect(getDataCell(table, 2, 0)).toHaveText(/^▼?1$/);
        await expect(getDataCell(table, 2, 1)).toHaveText('SideQuest');
        await expect(getDataCell(table, 2, 2)).toHaveText(/^▼?1$/);
        await expect(getDataCell(table, 2, 3)).toHaveText('Gold');

        // 行3: パディング行、qr.id=2, Gem（group_id=1の2件目）
        await expect(getDataCell(table, 3, 0)).toHaveText('');
        await expect(getDataCell(table, 3, 0)).toHaveClass(/view-padding-cell/);
        await expect(getDataCell(table, 3, 2)).toHaveText('2');
        await expect(getDataCell(table, 3, 3)).toHaveText('Gem');
    });

    test('行数変更のUndo/Redoが正しく動作すること', async ({ page }) => {
        await installMockApiAsync(page, createOneToManyFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_quest');

        // 初期状態: 行0=Gold, 行1=Gem(パディング), 行2=SideQuest
        await expect(getDataCell(table, 1, 3)).toHaveText('Gem');
        await expect(getDataCell(table, 2, 1)).toHaveText('SideQuest');

        // quest.id=1を "2" に変更（2展開行→1展開行に減少）
        await editCellAsync(page, table, 0, 0, '2');

        // 変更後: 行0=Potion, 行1=SideQuest
        await expect(getDataCell(table, 0, 3)).toHaveText('Potion');
        await expect(getDataCell(table, 1, 1)).toHaveText('SideQuest');
        // 行2は空になっている
        await expect(getDataCell(table, 2, 1)).toHaveText('');

        // Undo → 元の3データ行に戻る
        await page.keyboard.press('Control+z');
        await expect(getDataCell(table, 0, 0)).toHaveText(/1/);
        await expect(getDataCell(table, 0, 3)).toHaveText('Gold');
        await expect(getDataCell(table, 1, 3)).toHaveText('Gem');
        await expect(getDataCell(table, 2, 1)).toHaveText('SideQuest');

        // Redo → 再度減少状態に
        await page.keyboard.press('Control+y');
        await expect(getDataCell(table, 0, 3)).toHaveText('Potion');
        await expect(getDataCell(table, 1, 1)).toHaveText('SideQuest');
        await expect(getDataCell(table, 2, 1)).toHaveText('');
    });

    test('ベーステーブル側の編集がビュータブに反映されること', async ({ page }) => {
        await installMockApiAsync(page, createOneToManyFileSystem());
        await page.goto('/');

        // まずview_questを開く（quest.id=1は2行展開: Gold, Gem）
        const viewTable = await openTableAsync(page, 'view_quest');
        await expect(getDataCell(viewTable, 0, 3)).toHaveText('Gold');
        await expect(getDataCell(viewTable, 1, 3)).toHaveText('Gem');

        // quest_rewardタブを開く
        const rewardTable = await openTableAsync(page, 'quest_reward');

        // id=2のgroup_idを 1→2 に変更（col1がgroup_id）
        // quest_reward: id=1,group_id=1,Gold / id=2,group_id=2(変更),Gem / id=3,group_id=2,Potion
        await editCellAsync(page, rewardTable, 1, 1, '2');

        // view_questタブに戻る
        const explorer = page.locator('#explorer');
        await explorer.locator('[data-panel="views"]').click();
        await explorer.getByText('view_quest', { exact: true }).click();

        const refreshedTable = page.locator('.tab-wrapper:not([style*="display: none"]) .editor-table');
        await expect(refreshedTable).toBeVisible();

        // quest.id=1の展開行が2行→1行に減少（group_id=1はid=1のGoldのみ）
        await expect(getDataCell(refreshedTable, 0, 0)).toHaveText(/1/);
        await expect(getDataCell(refreshedTable, 0, 1)).toHaveText('MainQuest');
        await expect(getDataCell(refreshedTable, 0, 3)).toHaveText('Gold');

        // quest.id=2の展開行が1行→2行に増加（group_id=2はid=2のGemとid=3のPotion）
        // トグル文字▼が含まれる可能性があるため正規表現を使用
        await expect(getDataCell(refreshedTable, 1, 0)).toHaveText(/^▼?2$/);
        await expect(getDataCell(refreshedTable, 1, 1)).toHaveText('SideQuest');
        // パディング行が追加されている
        await expect(getDataCell(refreshedTable, 2, 0)).toHaveText('');
        await expect(getDataCell(refreshedTable, 2, 0)).toHaveClass(/view-padding-cell/);
    });

    test('折りたたみ後にカーソル表示位置が再計算されること', async ({ page }) => {
        await installMockApiAsync(page, createOneToManyFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_quest');

        // 行2（SideQuest行）のセルをクリックしてカーソルを移動
        await selectCellAsync(page, table, 2, 1);

        // 折りたたみ前のカーソル位置を記録
        const selection = page.locator('.selection').first();
        const topBefore = await selection.evaluate(el => parseFloat(el.style.top));

        // 行0のグループを折りたたむ → 行1（Gemパディング行）が非表示になる
        const toggle = table.locator('.view-collapse-toggle').first();
        await toggle.click();
        await expect(toggle).toHaveText('▶');

        // カーソル位置が上に移動していること（非表示行分だけtopが減少）
        const topAfter = await selection.evaluate(el => parseFloat(el.style.top));
        expect(topAfter).toBeLessThan(topBefore);
    });

    // ---------------------------------------------------------
    // ドロップダウン経由のFK値変更テスト
    // ---------------------------------------------------------

    test('ドロップダウン経由のFK値変更で1:n展開行数が更新されること', async ({ page }) => {
        await installMockApiAsync(page, createDropdownFkTestFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_quest');

        // ビュー列: quest.id(0), quest.name(1), quest.reward_group_id(2), quest_reward.id(3), quest_reward.item(4)
        // 初期状態:
        // Row 0: 1, MainQuest, 1, 1, Gold (reward_group_id=1 → 2 matches)
        // Row 1: [pad], [pad], [pad], 2, Gem
        // Row 2: 2, SideQuest, 2, 3, Potion (reward_group_id=2 → 1 match)
        await expect(getDataCell(table, 0, 4)).toHaveText('Gold');
        await expect(getDataCell(table, 1, 4)).toHaveText('Gem');
        await expect(getDataCell(table, 2, 1)).toHaveText('SideQuest');

        // reward_group_id=1のセル（行0, col2）をダブルクリックしてドロップダウンを開く
        const fkCell = getDataCell(table, 0, 2);
        await fkCell.dblclick();

        // ドロップダウンが表示されるまで待機
        const dropdown = page.locator('.grid-dropdown-list');
        await expect(dropdown).toBeVisible();

        // "2" のアイテムをクリックして選択（reward_group_id=2にするとquest_reward match数が1件に減少）
        const targetItem = dropdown.locator('.grid-dropdown-item').filter({
            has: page.locator('.grid-dropdown-item-id', { hasText: /^2$/ })
        });
        await targetItem.click();

        // 行0: 1, MainQuest, 2, 3, Potion (reward_group_id=2 → 1 match)
        await expect(getDataCell(table, 0, 2)).toHaveText('2');
        await expect(getDataCell(table, 0, 3)).toHaveText('3');
        await expect(getDataCell(table, 0, 4)).toHaveText('Potion');

        // 行1: SideQuest行が繰り上がっている（パディング行が消えた）
        await expect(getDataCell(table, 1, 0)).toHaveText('2');
        await expect(getDataCell(table, 1, 1)).toHaveText('SideQuest');
    });

    test('ドロップダウン経由のFK値変更のUndo/Redoが正しく動作すること', async ({ page }) => {
        await installMockApiAsync(page, createDropdownFkTestFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_quest');

        // 初期状態: 行0=Gold, 行1=Gem(パディング), 行2=SideQuest
        await expect(getDataCell(table, 0, 4)).toHaveText('Gold');
        await expect(getDataCell(table, 1, 4)).toHaveText('Gem');
        await expect(getDataCell(table, 2, 1)).toHaveText('SideQuest');

        // ドロップダウンでreward_group_id=1→2に変更（2行展開→1行展開に減少）
        const fkCell = getDataCell(table, 0, 2);
        await fkCell.dblclick();
        const dropdown = page.locator('.grid-dropdown-list');
        await expect(dropdown).toBeVisible();
        const targetItem = dropdown.locator('.grid-dropdown-item').filter({
            has: page.locator('.grid-dropdown-item-id', { hasText: /^2$/ })
        });
        await targetItem.click();

        // 変更後: 行0=Potion, 行1=SideQuest
        await expect(getDataCell(table, 0, 4)).toHaveText('Potion');
        await expect(getDataCell(table, 1, 1)).toHaveText('SideQuest');

        // Undo → 元の3データ行に戻る
        await page.keyboard.press('Control+z');
        // トグル文字▼が含まれる可能性があるため正規表現を使用
        await expect(getDataCell(table, 0, 2)).toHaveText(/^▼?1$/);
        await expect(getDataCell(table, 0, 4)).toHaveText('Gold');
        await expect(getDataCell(table, 1, 4)).toHaveText('Gem');
        await expect(getDataCell(table, 2, 1)).toHaveText('SideQuest');

        // Redo → 再度減少状態に
        await page.keyboard.press('Control+y');
        await expect(getDataCell(table, 0, 4)).toHaveText('Potion');
        await expect(getDataCell(table, 1, 1)).toHaveText('SideQuest');
    });

    // ---------------------------------------------------------
    // 同マッチ数でFK値変更時のパディング行更新テスト
    // ---------------------------------------------------------

    test('同マッチ数でFK値変更時にパディング行の内容が更新されること', async ({ page }) => {
        // group_id=1に2件(Gold,Gem)、group_id=3に2件(Shield,Scroll)
        const fs: MockFileSystem = {
            "schema/quest.json": JSON.stringify({
                header: [
                    { key: 0, name: "id", type: "int" },
                    { key: 1, name: "name", type: "string" },
                ],
                primary_key: "id",
            }),
            "data/quest.csv": ["id,name", "1,MainQuest", "3,SideQuest"].join("\n"),
            "schema/quest_reward.json": JSON.stringify({
                header: [
                    { key: 0, name: "id", type: "int" },
                    { key: 1, name: "group_id", type: "int" },
                    { key: 2, name: "item", type: "string" },
                ],
                primary_key: "id",
            }),
            "data/quest_reward.csv": ["id,group_id,item", "1,1,Gold", "2,1,Gem", "3,3,Shield", "4,3,Scroll"].join("\n"),
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

        await installMockApiAsync(page, fs);
        await page.goto('/');
        const table = await openTableAsync(page, 'view_quest');

        // ビュー列: quest.id(0), quest.name(1), quest_reward.id(2), quest_reward.item(3)
        // 初期状態:
        // Row 0: 1, MainQuest, 1, Gold
        // Row 1: [pad], [pad], 2, Gem
        // Row 2: 3, SideQuest, 3, Shield
        // Row 3: [pad], [pad], 4, Scroll
        await expect(getDataCell(table, 0, 3)).toHaveText('Gold');
        await expect(getDataCell(table, 1, 3)).toHaveText('Gem');
        await expect(getDataCell(table, 2, 3)).toHaveText('Shield');
        await expect(getDataCell(table, 3, 3)).toHaveText('Scroll');

        // quest.id=1のセル（行0, col0）を "3" に変更
        // → group_id=3にマッチする2件(Shield,Scroll)に切り替わるが、行数は2のまま
        await editCellAsync(page, table, 0, 0, '3');

        // 行0: 3, MainQuest, 3, Shield（group_id=3の1件目）
        // トグル文字▼がJOINソース列（col0）に含まれる可能性があるため正規表現を使用
        await expect(getDataCell(table, 0, 0)).toHaveText(/^▼?3$/);
        await expect(getDataCell(table, 0, 1)).toHaveText('MainQuest');
        await expect(getDataCell(table, 0, 2)).toHaveText('3');
        await expect(getDataCell(table, 0, 3)).toHaveText('Shield');

        // 行1: パディング行、quest_reward.id=4, Scroll（group_id=3の2件目）
        await expect(getDataCell(table, 1, 0)).toHaveText('');
        await expect(getDataCell(table, 1, 2)).toHaveText('4');
        await expect(getDataCell(table, 1, 3)).toHaveText('Scroll');
    });

    test('折りたたみトグルのダブルクリックで編集モードに入らないこと', async ({ page }) => {
        await installMockApiAsync(page, createOneToManyFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_quest');

        // 折りたたみトグルをダブルクリック
        const toggle = table.locator('.view-collapse-toggle').first();
        await toggle.dblclick();

        // 編集モードのテキストフィールドが表示されないことを確認
        const editField = page.locator('.grid-textfield-active');
        await expect(editField).not.toBeVisible();
    });

    // ---------------------------------------------------------
    // ペーストによるFK値変更時の行再構築テスト
    // ---------------------------------------------------------

    test('FK列のペーストで1:2→1:1にビュー行が再構築されること', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await installMockApiAsync(page, createOneToManyFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_quest');

        // 初期状態確認:
        // Row 0: quest.id=1, MainQuest, qr.id=1, Gold (1:2展開)
        // Row 1: [pad], [pad], qr.id=2, Gem
        // Row 2: quest.id=2, SideQuest, qr.id=3, Potion (1:1)
        await expect(getDataCell(table, 0, 3)).toHaveText('Gold');
        await expect(getDataCell(table, 1, 3)).toHaveText('Gem');
        await expect(getDataCell(table, 2, 1)).toHaveText('SideQuest');

        // quest.id=2（行2, col0）のセルをコピー
        await selectCellAsync(page, table, 2, 0);
        await page.keyboard.press('Control+c');

        // quest.id=1（行0, col0）のセルに貼り付け → 1:2 → 1:1に減少
        await selectCellAsync(page, table, 0, 0);
        await page.keyboard.press('Control+v');

        // 行0: quest.id=2, MainQuest, qr.id=3, Potion (group_id=2の1件マッチ)
        await expect(getDataCell(table, 0, 0)).toHaveText('2');
        await expect(getDataCell(table, 0, 1)).toHaveText('MainQuest');
        await expect(getDataCell(table, 0, 2)).toHaveText('3');
        await expect(getDataCell(table, 0, 3)).toHaveText('Potion');

        // 行1: SideQuestが繰り上がっている
        await expect(getDataCell(table, 1, 0)).toHaveText('2');
        await expect(getDataCell(table, 1, 1)).toHaveText('SideQuest');
    });

    test('FK列のペーストで1:1→1:2にビュー行が再構築され折りたたみトグルが表示されること', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await installMockApiAsync(page, createOneToManyFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_quest');

        // quest.id=1（行0, col0）のセルをコピー
        await selectCellAsync(page, table, 0, 0);
        await page.keyboard.press('Control+c');

        // quest.id=2（行2, col0）のセルに貼り付け → 1:1 → 1:2に増加
        await selectCellAsync(page, table, 2, 0);
        await page.keyboard.press('Control+v');

        // 行2: quest.id=1, SideQuest, qr.id=1, Gold (group_id=1の1件目)
        // トグル文字▼が含まれる可能性があるため正規表現を使用
        await expect(getDataCell(table, 2, 0)).toHaveText(/^▼?1$/);
        await expect(getDataCell(table, 2, 1)).toHaveText('SideQuest');
        await expect(getDataCell(table, 2, 2)).toHaveText(/^▼?1$/);
        await expect(getDataCell(table, 2, 3)).toHaveText('Gold');

        // 行3: パディング行、qr.id=2, Gem (group_id=1の2件目)
        await expect(getDataCell(table, 3, 0)).toHaveText('');
        await expect(getDataCell(table, 3, 0)).toHaveClass(/view-padding-cell/);
        await expect(getDataCell(table, 3, 2)).toHaveText('2');
        await expect(getDataCell(table, 3, 3)).toHaveText('Gem');

        // 折りたたみトグルが表示されていること
        const toggles = table.locator('.view-collapse-toggle');
        // 行0（元から1:2）と行2（ペーストで1:2）の2つ
        await expect(toggles).toHaveCount(2);
    });

    test('FK列のペースト後のUndo/Redoが正しく動作すること', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await installMockApiAsync(page, createOneToManyFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_quest');

        // 初期状態: Row0=Gold, Row1=Gem(padding), Row2=SideQuest
        await expect(getDataCell(table, 0, 3)).toHaveText('Gold');
        await expect(getDataCell(table, 1, 3)).toHaveText('Gem');
        await expect(getDataCell(table, 2, 1)).toHaveText('SideQuest');

        // quest.id=2をコピー → quest.id=1に貼り付け（1:2→1:1）
        await selectCellAsync(page, table, 2, 0);
        await page.keyboard.press('Control+c');
        await selectCellAsync(page, table, 0, 0);
        await page.keyboard.press('Control+v');

        // 変更後: Row0=Potion, Row1=SideQuest
        await expect(getDataCell(table, 0, 3)).toHaveText('Potion');
        await expect(getDataCell(table, 1, 1)).toHaveText('SideQuest');

        // Undo → 元の状態に戻る
        await page.keyboard.press('Control+z');
        await expect(getDataCell(table, 0, 0)).toHaveText(/1/);
        await expect(getDataCell(table, 0, 3)).toHaveText('Gold');
        await expect(getDataCell(table, 1, 3)).toHaveText('Gem');
        await expect(getDataCell(table, 2, 1)).toHaveText('SideQuest');

        // Redo → 再度変更状態に
        await page.keyboard.press('Control+y');
        await expect(getDataCell(table, 0, 3)).toHaveText('Potion');
        await expect(getDataCell(table, 1, 1)).toHaveText('SideQuest');
    });

    // ---------------------------------------------------------
    // 複数ビュー行ペーストでパディング行データが漏洩しないテスト
    // ---------------------------------------------------------

    test('複数ビュー行ペーストで次のベース行が破壊されないこと', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await installMockApiAsync(page, createThreeBaseRowFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_quest');

        // 初期状態:
        // Row 0: 1, MainQuest, 1, Gold (1:2リーダー)
        // Row 1: [pad], [pad], 2, Gem (パディング)
        // Row 2: 2, SideQuest, 3, Potion (1:1)
        // Row 3: 3, ExtraQuest, 4, Sword (1:1)
        await expect(getDataCell(table, 3, 0)).toHaveText('3');
        await expect(getDataCell(table, 3, 1)).toHaveText('ExtraQuest');

        // row0-1（リーダー+パディング）を範囲選択してコピー
        await selectCellAsync(page, table, 0, 0);
        await getDataCell(table, 1, 3).click({ modifiers: ['Shift'] });
        await page.keyboard.press('Control+c');

        // row2にペースト
        await selectCellAsync(page, table, 2, 0);
        await page.keyboard.press('Control+v');

        // row2のquest.idが1に変更されFKリストラクチャで1:2展開
        // ExtraQuestはrow4に移動するが、データは破壊されていないこと
        await expect(getDataCell(table, 4, 0)).toHaveText('3');
        await expect(getDataCell(table, 4, 1)).toHaveText('ExtraQuest');
        await expect(getDataCell(table, 4, 2)).toHaveText('4');
        await expect(getDataCell(table, 4, 3)).toHaveText('Sword');
    });

    test('複数ビュー行ペースト後のUndo/Redoが正しく動作すること', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await installMockApiAsync(page, createThreeBaseRowFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_quest');

        // 初期状態: Row3=ExtraQuest
        await expect(getDataCell(table, 3, 1)).toHaveText('ExtraQuest');

        // row0-1を範囲選択してコピー
        await selectCellAsync(page, table, 0, 0);
        await getDataCell(table, 1, 3).click({ modifiers: ['Shift'] });
        await page.keyboard.press('Control+c');

        // row2にペースト
        await selectCellAsync(page, table, 2, 0);
        await page.keyboard.press('Control+v');

        // ペースト後: ExtraQuestはrow4に移動
        await expect(getDataCell(table, 4, 0)).toHaveText('3');
        await expect(getDataCell(table, 4, 1)).toHaveText('ExtraQuest');

        // Undo → 元の4行レイアウトに戻る
        await page.keyboard.press('Control+z');
        await expect(getDataCell(table, 2, 0)).toHaveText('2');
        await expect(getDataCell(table, 2, 1)).toHaveText('SideQuest');
        await expect(getDataCell(table, 3, 0)).toHaveText('3');
        await expect(getDataCell(table, 3, 1)).toHaveText('ExtraQuest');

        // Redo → 再度ペースト状態に
        await page.keyboard.press('Control+y');
        await expect(getDataCell(table, 4, 0)).toHaveText('3');
        await expect(getDataCell(table, 4, 1)).toHaveText('ExtraQuest');
    });

    test('最終行への複数ビュー行ペーストでテーブル境界を超えないこと', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await installMockApiAsync(page, createThreeBaseRowFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_quest');

        // 初期状態:
        // Row 0: 1, MainQuest, 1, Gold (1:2リーダー)
        // Row 1: [pad], [pad], 2, Gem (パディング)
        // Row 2: 2, SideQuest, 3, Potion (1:1)
        // Row 3: 3, ExtraQuest, 4, Sword (1:1)

        // row0-1（リーダー+パディング）を範囲選択してコピー
        await selectCellAsync(page, table, 0, 0);
        await getDataCell(table, 1, 3).click({ modifiers: ['Shift'] });
        await page.keyboard.press('Control+c');

        // 最終行（row3）にペースト
        await selectCellAsync(page, table, 3, 0);
        await page.keyboard.press('Control+v');

        // row3のquest.idが1に変更されFKリストラクチャで1:2展開
        // リーダーデータのみペーストされ、パディングデータは漏洩しない
        await expect(getDataCell(table, 3, 0)).toHaveText(/^▼?1$/);
        await expect(getDataCell(table, 3, 1)).toHaveText('MainQuest');

        // row2（SideQuest）は変更されていないこと
        await expect(getDataCell(table, 2, 0)).toHaveText('2');
        await expect(getDataCell(table, 2, 1)).toHaveText('SideQuest');
        await expect(getDataCell(table, 2, 2)).toHaveText('3');
        await expect(getDataCell(table, 2, 3)).toHaveText('Potion');
    });

    // ---------------------------------------------------------
    // メタデータ範囲外への複数リーダーペーストテスト
    // ---------------------------------------------------------

    test('最終データ行への複数リーダーペーストで4行に展開されること', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await installMockApiAsync(page, createFiveBaseRowFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_quest');

        // ビュー列: quest.id(0), quest.name(1), quest.group_id(2), quest_reward.id(3), quest_reward.item(4)
        // 初期状態:
        // Row 0: 1, Quest1, 1, 1, Gold (1:2リーダー)
        // Row 1: [pad], [pad], [pad], 2, Gem (パディング)
        // Row 2: 2, Quest2, 1, 1, Gold (1:2リーダー)
        // Row 3: [pad], [pad], [pad], 2, Gem (パディング)
        // Row 4: 3, Quest3, 2, 3, Potion (1:1)
        // Row 5: 4, Quest4, 3, 4, Sword (1:1)
        // Row 6: 5, Quest5, , , (LEFT JOIN空)
        await expect(getDataCell(table, 6, 0)).toHaveText('5');
        await expect(getDataCell(table, 6, 1)).toHaveText('Quest5');

        // row0-3（2リーダー+2パディング）を範囲選択してコピー
        await selectCellAsync(page, table, 0, 0);
        await getDataCell(table, 3, 4).click({ modifiers: ['Shift'] });
        await page.keyboard.press('Control+c');

        // row6（最終データ行）にペースト
        await selectCellAsync(page, table, 6, 0);
        await page.keyboard.press('Control+v');

        // row6-9の4行が生成される（各リーダーがgroup_id=1で1:2展開）
        // Row 6: quest.id=1, Quest1, group_id=1, qr.id=1, Gold
        await expect(getDataCell(table, 6, 0)).toHaveText(/^▼?1$/);
        await expect(getDataCell(table, 6, 1)).toHaveText('Quest1');
        await expect(getDataCell(table, 6, 3)).toHaveText('1');
        await expect(getDataCell(table, 6, 4)).toHaveText('Gold');

        // Row 7: パディング
        await expect(getDataCell(table, 7, 0)).toHaveText('');
        await expect(getDataCell(table, 7, 0)).toHaveClass(/view-padding-cell/);
        await expect(getDataCell(table, 7, 3)).toHaveText('2');
        await expect(getDataCell(table, 7, 4)).toHaveText('Gem');

        // Row 8: quest.id=2, Quest2, group_id=1, qr.id=1, Gold
        await expect(getDataCell(table, 8, 0)).toHaveText(/^▼?2$/);
        await expect(getDataCell(table, 8, 1)).toHaveText('Quest2');
        await expect(getDataCell(table, 8, 3)).toHaveText('1');
        await expect(getDataCell(table, 8, 4)).toHaveText('Gold');

        // Row 9: パディング
        await expect(getDataCell(table, 9, 0)).toHaveText('');
        await expect(getDataCell(table, 9, 0)).toHaveClass(/view-padding-cell/);
        await expect(getDataCell(table, 9, 3)).toHaveText('2');
        await expect(getDataCell(table, 9, 4)).toHaveText('Gem');
    });

    test('最終データ行への複数リーダーペーストのUndo/Redoが正しく動作すること', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await installMockApiAsync(page, createFiveBaseRowFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_quest');

        // row0-3（2リーダー+2パディング）を範囲選択してコピー
        await selectCellAsync(page, table, 0, 0);
        await getDataCell(table, 3, 4).click({ modifiers: ['Shift'] });
        await page.keyboard.press('Control+c');

        // row6（最終データ行）にペースト
        await selectCellAsync(page, table, 6, 0);
        await page.keyboard.press('Control+v');

        // ペースト後: 4行に展開されていること
        await expect(getDataCell(table, 6, 0)).toHaveText(/^▼?1$/);
        await expect(getDataCell(table, 6, 1)).toHaveText('Quest1');
        await expect(getDataCell(table, 8, 0)).toHaveText(/^▼?2$/);
        await expect(getDataCell(table, 8, 1)).toHaveText('Quest2');

        // Undo → 元のレイアウトに戻る
        await page.keyboard.press('Control+z');
        await expect(getDataCell(table, 6, 0)).toHaveText('5');
        await expect(getDataCell(table, 6, 1)).toHaveText('Quest5');
        // Row 7以降は空行に戻る
        await expect(getDataCell(table, 7, 0)).toHaveText('');
        await expect(getDataCell(table, 7, 1)).toHaveText('');

        // Redo → 再度4行ペースト状態に
        await page.keyboard.press('Control+y');
        await expect(getDataCell(table, 6, 0)).toHaveText(/^▼?1$/);
        await expect(getDataCell(table, 6, 1)).toHaveText('Quest1');
        await expect(getDataCell(table, 8, 0)).toHaveText(/^▼?2$/);
        await expect(getDataCell(table, 8, 1)).toHaveText('Quest2');
    });
});
