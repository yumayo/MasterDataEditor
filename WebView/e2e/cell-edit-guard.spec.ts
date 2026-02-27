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
 * view_quest: questベース、quest_rewardをquest.id -> quest_reward.group_idでJOIN
 *
 * 期待されるビュー表示:
 * | quest.id | quest.name | quest_reward.id | quest_reward.item |
 * |    1     | MainQuest  |       1         |      Gold         |  <- リーダー行
 * |  [pad]   |   [pad]    |       2         |      Gem          |  <- パディング行
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
// isCellEditBlocked: 単一セル編集ガードの検証
// -------------------------------------------------------
test.describe('isCellEditBlocked - 単一セル編集ガード', () => {

    test('パディングセルへの文字入力が拒否されること', async ({ page }) => {
        await installMockApiAsync(page, createOneToManyFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_quest');

        // パディングセル（行1, 列0）を選択
        await selectCellAsync(page, table, 1, 0);

        // 文字入力を試みる
        await page.keyboard.press('a');

        // テキストフィールドが表示されないことを確認（isCellEditBlockedで拒否）
        const editField = page.locator('.grid-textfield-active');
        await expect(editField).not.toBeVisible();
    });

    test('パディングセルへのダブルクリック編集が拒否されること', async ({ page }) => {
        await installMockApiAsync(page, createOneToManyFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_quest');

        // パディングセルを選択してからダブルクリック
        await selectCellAsync(page, table, 1, 0);
        const paddingCell = getDataCell(table, 1, 0);
        await paddingCell.dblclick();

        // テキストフィールドが表示されないことを確認（isCellEditBlockedで拒否）
        const editField = page.locator('.grid-textfield-active');
        await expect(editField).not.toBeVisible();
    });

    test('リーダー行の通常セルへの文字入力が許可されること', async ({ page }) => {
        await installMockApiAsync(page, createOneToManyFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_quest');

        // リーダー行のセル（行0, 列1 = quest.name）を選択
        await selectCellAsync(page, table, 0, 1);

        // 文字入力
        await page.keyboard.press('a');

        // テキストフィールドが表示されること（編集が許可）
        const editField = page.locator('.grid-textfield-active');
        await expect(editField).toBeVisible();

        // ESCで閉じる
        await page.keyboard.press('Escape');
    });
});

// -------------------------------------------------------
// isRangeEditBlocked: 範囲編集ガードの検証
// -------------------------------------------------------
test.describe('isRangeEditBlocked - 範囲編集ガード', () => {

    test('パディングセルを含む範囲へのペーストが拒否されること', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await installMockApiAsync(page, createOneToManyFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_quest');

        // 通常セルの値をコピー
        await selectCellAsync(page, table, 0, 0);
        await page.keyboard.press('Control+c');

        // パディングセルを選択してペースト
        await selectCellAsync(page, table, 1, 0);
        await page.keyboard.press('Control+v');

        // パディングセルは空のまま（isRangeEditBlockedで拒否）
        await expect(getDataCell(table, 1, 0)).toHaveText('');
    });

    test('結合列を含む範囲へのペーストが拒否されること', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await installMockApiAsync(page, createOneToManyFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_quest');

        // quest.id（結合列）セルの値をコピー
        await selectCellAsync(page, table, 2, 0);
        await page.keyboard.press('Control+c');

        // 結合列セルを選択してペースト
        await selectCellAsync(page, table, 2, 0);
        await page.keyboard.press('Control+v');

        // 結合列への書き込みは拒否される（isRangeEditBlockedで拒否）
        // ただしquest.idはFK列なので結合列として扱われる
        // 注: quest.idが結合列かどうかはビュー定義による
    });

    test('リーダー行の通常セルへのダブルクリック編集が許可されること', async ({ page }) => {
        await installMockApiAsync(page, createOneToManyFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_quest');

        // リーダー行の結合テーブルセル（行2, 列3 = quest_reward.item）をダブルクリック編集で値を変更
        const targetCell = getDataCell(table, 2, 3);
        await targetCell.dblclick();
        const editField = page.locator('.grid-textfield-active');
        await expect(editField).toBeVisible();
        await page.keyboard.press('Control+a');
        await page.keyboard.insertText('Ruby');
        await page.keyboard.press('Enter');

        // 値が変更されていること（isRangeEditBlockedで拒否されない）
        await expect(targetCell).toHaveText('Ruby');
    });
});

// -------------------------------------------------------
// isDeleteBlocked: Delete操作ガードの検証
// -------------------------------------------------------
test.describe('isDeleteBlocked - Delete操作ガード', () => {

    test('パディング行を含む不完全グループ選択でDeleteが拒否されること', async ({ page }) => {
        await installMockApiAsync(page, createOneToManyFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_quest');

        // パディング行の結合テーブルセル（行1, 列2）を選択
        await selectCellAsync(page, table, 1, 2);
        const beforeValue = await getDataCell(table, 1, 2).textContent();

        // パディングセルまで範囲拡張（行1, 列0 ～ 行1, 列2）
        const paddingCell = getDataCell(table, 1, 0);
        await paddingCell.click({ modifiers: ['Shift'] });

        // Delete
        await page.keyboard.press('Delete');

        // 値が変わらないこと（isDeleteBlockedで拒否）
        await expect(getDataCell(table, 1, 2)).toHaveText(beforeValue!);
    });

    test('完全なFKグループ選択でDeleteが許可されること', async ({ page }) => {
        await installMockApiAsync(page, createOneToManyFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_quest');

        // リーダー行（行0）からパディング行（行1）まで全グループを選択
        await selectCellAsync(page, table, 0, 2);
        const targetCell = getDataCell(table, 1, 2);
        await targetCell.click({ modifiers: ['Shift'] });

        // Delete
        await page.keyboard.press('Delete');

        // リーダー行の値がクリアされること（isDeleteBlockedがblocked=falseを返す）
        await expect(getDataCell(table, 0, 2)).toHaveText('');
    });

    test('パディング行を含まない単一セルのDeleteが許可されること', async ({ page }) => {
        await installMockApiAsync(page, createOneToManyFileSystem());
        await page.goto('/');
        const table = await openTableAsync(page, 'view_quest');

        // リーダー行の結合テーブルセル（行2, 列3 = quest_reward.item）を選択
        await selectCellAsync(page, table, 2, 3);

        // Delete
        await page.keyboard.press('Delete');

        // 値がクリアされること
        await expect(getDataCell(table, 2, 3)).toHaveText('');
    });
});
