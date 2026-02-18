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
});
