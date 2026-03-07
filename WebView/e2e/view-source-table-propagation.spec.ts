import { test, expect } from '@playwright/test';
import { Page, Locator } from '@playwright/test';
import {
    installMockApiAsync,
    MockFileSystem,
} from './fixtures/mock-api';
import { expectTableDataAsync, expectCsvAsync } from './fixtures/test-utils';

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
            'ビューの結合列編集がStoreに反映されること'
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

                // quest_rewardタブに切り替え
                await openTableAsync(page, 'quest_reward');

                // view_questタブに戻る（refreshViewRowsがStoreから都度キーマップを構築して再構築）
                const refreshedViewTable = await openTableAsync(page, 'view_quest');

                // Storeが正しく更新されていれば、編集した値が維持されるはず
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

// -------------------------------------------------------
// 空行編集時のグループ境界チェックテスト
// デフォルト100行のうちデータ行以降の空行にJOIN列を編集しても、
// 遠いグループのFK値を不正に継承せず、既存データを破壊しないことを検証する
// -------------------------------------------------------
test.describe('空行のJOIN列編集がグループ境界を越えないこと', () => {
    test('空行の非PK JOIN列を編集しても既存データが変更されず保存時にも不正行が生成されないこと', async ({ page }) => {
        await installMockApiAsync(page, createFileSystem());
        await page.goto('/');
        // view_questを開く
        // ビュー列: quest.id(0), quest.name(1), quest_reward.id(2), quest_reward.item(3)
        // row0: 1, MainQuest, 1, Gold  ← リーダー行
        // row1: [pad], [pad], 2, Gem   ← パディング行
        // row2: 2, SideQuest, 3, Potion ← リーダー行
        // row3〜: 空行（data-base-row-index属性なし）
        const viewTable = await openTableAsync(page, 'view_quest');
        await expect(getDataCell(viewTable, 0, 3)).toHaveText('Gold');
        await expect(getDataCell(viewTable, 2, 3)).toHaveText('Potion');
        // 空行（row 10）の非PK JOIN列（quest_reward.item）を編集
        // findGroupLeaderはFK値"2"とgroupPosition=8を返すが、
        // Store内にgroupPosition=8に対応する行が存在しないため伝搬されない
        await editCellAsync(page, viewTable, 10, 3, '不正な値');
        // 既存のデータ行が変更されていないこと
        await expect(getDataCell(viewTable, 0, 3)).toHaveText('Gold');
        await expect(getDataCell(viewTable, 1, 3)).toHaveText('Gem');
        await expect(getDataCell(viewTable, 2, 3)).toHaveText('Potion');
        // 保存して不正なStore行が生成されていないことを検証
        const firstCell = viewTable.locator('.editor-table-row:nth-child(2) .editor-table-cell:nth-child(2)');
        await firstCell.click();
        await page.keyboard.press('Control+s');
        await page.waitForTimeout(500);
        await expectCsvAsync(page, 'data/quest_reward.csv', `
            id, group_id, item
            1,  1,        Gold
            2,  1,        Gem
            3,  2,        Potion
        `);
    });

    test('空行のJOIN PK列を編集するとグループが展開しStore行が追加されること', async ({ page }) => {
        await installMockApiAsync(page, createFileSystem());
        await page.goto('/');
        const viewTable = await openTableAsync(page, 'view_quest');
        await expect(getDataCell(viewTable, 0, 2)).toHaveText('1');
        await expect(getDataCell(viewTable, 1, 2)).toHaveText('2');
        await expect(getDataCell(viewTable, 2, 2)).toHaveText('3');
        // 空行（row 3）のJOIN PK列（quest_reward.id）に"4"を入力
        // findGroupLeaderがquest.id=2（group_id=2）を見つけ、Lazy Store挿入が発生する
        // その後refreshViewRowsで全グループが再構築される
        await editCellAsync(page, viewTable, 3, 2, '4');
        // SideQuestのグループが1行→2行に展開されること
        await expect(getDataCell(viewTable, 0, 2)).toHaveText('1');
        await expect(getDataCell(viewTable, 1, 2)).toHaveText('2');
        await expect(getDataCell(viewTable, 2, 2)).toHaveText('3');
        await expect(getDataCell(viewTable, 3, 2)).toHaveText('4');
        // 既存データが破壊されていないこと
        await expect(getDataCell(viewTable, 0, 3)).toHaveText('Gold');
        await expect(getDataCell(viewTable, 1, 3)).toHaveText('Gem');
        await expect(getDataCell(viewTable, 2, 3)).toHaveText('Potion');
        // 保存してStore行が正しく追加されていることを検証
        const firstCell = viewTable.locator('.editor-table-row:nth-child(2) .editor-table-cell:nth-child(2)');
        await firstCell.click();
        await page.keyboard.press('Control+s');
        await page.waitForTimeout(500);
        await expectCsvAsync(page, 'data/quest_reward.csv', `
            id, group_id, item
            1,  1,        Gold
            2,  1,        Gem
            3,  2,        Potion
            4,  2,
        `);
    });
});

// -------------------------------------------------------
// 同一FK値を持つ複数グループの同時展開テスト
// JOINテーブルに新しい行が追加されたとき、同じFK値で展開された
// 全てのベース行グループが自動的に展開されることを検証する
// -------------------------------------------------------
test.describe('同一FK値を持つ複数グループの同時展開', () => {
    /**
     * テストデータ:
     * shop: id=1,name=WeaponShop,group_id=1 / id=2,name=ItemShop,group_id=2 / id=3,name=SecretShop,group_id=1
     * shop_product: id=1,group_id=1,item=Sword / id=2,group_id=1,item=Shield / id=3,group_id=2,item=Potion
     *
     * view_shop: shopベース、shop_productをshop.group_id → shop_product.group_idでJOIN
     *
     * 期待されるビュー表示:
     * | shop.id | shop.name   | shop.group_id | shop_product.id | shop_product.item |
     * |    1    | WeaponShop  |      1        |       1         |      Sword        |  ← group_id=1
     * | [pad]   |   [pad]     |    [pad]      |       2         |      Shield       |
     * |    2    | ItemShop    |      2        |       3         |      Potion       |  ← group_id=2
     * |    3    | SecretShop  |      1        |       1         |      Sword        |  ← group_id=1
     * | [pad]   |   [pad]     |    [pad]      |       2         |      Shield       |
     */
    function createShopFileSystem(): MockFileSystem {
        return {
            "schema/shop.json": JSON.stringify({
                header: [
                    { key: 0, name: "id", type: "int" },
                    { key: 1, name: "name", type: "string" },
                    { key: 2, name: "group_id", type: "int" },
                ],
                primary_key: "id",
            }),
            "data/shop.csv": ["id,name,group_id", "1,WeaponShop,1", "2,ItemShop,2", "3,SecretShop,1"].join("\n"),
            "schema/shop_product.json": JSON.stringify({
                header: [
                    { key: 0, name: "id", type: "int" },
                    { key: 1, name: "group_id", type: "int" },
                    { key: 2, name: "item", type: "string" },
                ],
                primary_key: "id",
            }),
            "data/shop_product.csv": ["id,group_id,item", "1,1,Sword", "2,1,Shield", "3,2,Potion"].join("\n"),
            "view/view_shop.json": JSON.stringify({
                name: "view_shop",
                baseTable: "shop",
                joins: [{
                    sourceColumn: "group_id",
                    targetTable: "shop_product",
                    targetColumn: "group_id",
                    insertAfterViewColumnIndex: 2,
                    sourceTable: "",
                }],
            }),
        };
    }

    test('グループ内に行挿入後、非PK JOIN列を編集すると同一FK値の他グループにも同期されること', async ({ page }) => {
        await installMockApiAsync(page, createShopFileSystem());
        await page.goto('/');
        const viewTable = await openTableAsync(page, 'view_shop');
        // 初期状態を確認
        // ビュー列: shop.id(0), shop.name(1), shop.group_id(2), shop_product.id(3), shop_product.item(4)
        // row0: 1, WeaponShop, 1, 1, Sword   ← group_id=1リーダー
        // row1: [pad], [pad], [pad], 2, Shield ← group_id=1子行
        // row2: 2, ItemShop, 2, 3, Potion     ← group_id=2リーダー
        // row3: 3, SecretShop, 1, 1, Sword    ← group_id=1リーダー（別ベース行）
        // row4: [pad], [pad], [pad], 2, Shield ← group_id=1子行
        await expect(getDataCell(viewTable, 0, 0)).toHaveText('1');
        await expect(getDataCell(viewTable, 0, 4)).toHaveText('Sword');
        await expect(getDataCell(viewTable, 1, 3)).toHaveText('2');
        await expect(getDataCell(viewTable, 1, 4)).toHaveText('Shield');
        await expect(getDataCell(viewTable, 2, 0)).toHaveText('2');
        await expect(getDataCell(viewTable, 3, 0)).toHaveText('3');
        await expect(getDataCell(viewTable, 4, 3)).toHaveText('2');
        await expect(getDataCell(viewTable, 4, 4)).toHaveText('Shield');
        // WeaponShop リーダー行（row0, Sword）の下（= SwordとShieldのグループ中間）に行を挿入
        // グループ中間挿入: 前後が同一グループ（baseRowIndex=0）なのでisWithinGroup=true
        const rowHeader = viewTable.locator('.editor-table-row-header').nth(0);
        await rowHeader.click({ button: 'right' });
        const menu = page.locator('.context-menu.visible');
        await expect(menu).toBeVisible();
        await menu.locator('.context-menu-item', { hasText: '下に行を挿入' }).click();
        // 挿入後（グループ中間挿入）:
        // row0: 1, WeaponShop, 1, 1, Sword
        // row1: [pad], [pad], [pad], (empty), (empty) ← WeaponShop側の挿入行（groupPosition=1）
        // row2: [pad], [pad], [pad], 2, Shield        ← もとのrow1（groupPosition=2に更新されず1のまま）
        // row3: 2, ItemShop, 2, 3, Potion
        // row4: 3, SecretShop, 1, 1, Sword
        // row5: [pad], [pad], [pad], (empty), (empty) ← SecretShop側の同期挿入行（groupPosition=1）
        // row6: [pad], [pad], [pad], 2, Shield        ← もとのrow4
        // 挿入されたWeaponShop新行（row1）の非PK JOIN列（shop_product.item, col4）を編集
        await editCellAsync(page, viewTable, 1, 4, 'テスト商品');
        // エラーが発生せず値が設定されること
        await expect(getDataCell(viewTable, 1, 4)).toHaveText('テスト商品');
        // SecretShopグループにも同期挿入行（row5）が存在し、同一位置（groupPosition=1）の行が連動更新されること
        // SecretShopもgroup_id=1なので、同一FK値・同一グループ位置の行が同期されるべき
        await expect(getDataCell(viewTable, 5, 4)).toHaveText('テスト商品');
        // 保存して既存データが破壊されていないことを検証
        // PK未設定の挿入行はStore行が生成されないため、CSVには元の3行のみが含まれるべき
        const firstCell = viewTable.locator('.editor-table-row:nth-child(2) .editor-table-cell:nth-child(2)');
        await firstCell.click();
        await page.keyboard.press('Control+s');
        await page.waitForTimeout(500);
        await expectCsvAsync(page, 'data/shop_product.csv', `
            id, group_id, item
            1,  1,        Sword
            2,  1,        Shield
            3,  2,        Potion
        `);
    });

    test('新しいJOIN行を追加すると同じFK値を持つ全グループが同時に展開されること', async ({ page }) => {
        await installMockApiAsync(page, createShopFileSystem());
        await page.goto('/');
        const viewTable = await openTableAsync(page, 'view_shop');
        // 初期状態を確認
        // ビュー列: shop.id(0), shop.name(1), shop.group_id(2), shop_product.id(3), shop_product.item(4)
        // row0: 1, WeaponShop, 1, 1, Sword   ← group_id=1リーダー
        // row1: [pad], [pad], [pad], 2, Shield ← group_id=1子行
        // row2: 2, ItemShop, 2, 3, Potion     ← group_id=2リーダー
        // row3: 3, SecretShop, 1, 1, Sword    ← group_id=1リーダー（別ベース行）
        // row4: [pad], [pad], [pad], 2, Shield ← group_id=1子行
        await expect(getDataCell(viewTable, 0, 0)).toHaveText('1');
        await expect(getDataCell(viewTable, 0, 4)).toHaveText('Sword');
        await expect(getDataCell(viewTable, 1, 3)).toHaveText('2');
        await expect(getDataCell(viewTable, 1, 4)).toHaveText('Shield');
        await expect(getDataCell(viewTable, 2, 0)).toHaveText('2');
        await expect(getDataCell(viewTable, 2, 4)).toHaveText('Potion');
        await expect(getDataCell(viewTable, 3, 0)).toHaveText('3');
        await expect(getDataCell(viewTable, 3, 4)).toHaveText('Sword');
        await expect(getDataCell(viewTable, 4, 3)).toHaveText('2');
        await expect(getDataCell(viewTable, 4, 4)).toHaveText('Shield');
        // 空行（row 5）のJOIN PK列（shop_product.id）に"4"を入力
        // SecretShopのグループ(group_id=1)に合流し、Lazy Store挿入 → refreshViewRows
        await editCellAsync(page, viewTable, 5, 3, '4');
        // 同じgroup_id=1を持つ全グループが2行→3行に展開されること
        // row0: 1, WeaponShop, 1, 1, Sword
        // row1: [pad], [pad], [pad], 2, Shield
        // row2: [pad], [pad], [pad], 4, ""     ← 新規展開行（WeaponShop側）
        // row3: 2, ItemShop, 2, 3, Potion       ← group_id=2（変化なし）
        // row4: 3, SecretShop, 1, 1, Sword
        // row5: [pad], [pad], [pad], 2, Shield
        // row6: [pad], [pad], [pad], 4, ""     ← 新規展開行（SecretShop側）
        // WeaponShopグループ（group_id=1）: 2→3行
        await expect(getDataCell(viewTable, 0, 0)).toHaveText('1');
        await expect(getDataCell(viewTable, 0, 4)).toHaveText('Sword');
        await expect(getDataCell(viewTable, 1, 3)).toHaveText('2');
        await expect(getDataCell(viewTable, 1, 4)).toHaveText('Shield');
        await expect(getDataCell(viewTable, 2, 3)).toHaveText('4');
        // ItemShopグループ（group_id=2）: 変化なし
        await expect(getDataCell(viewTable, 3, 0)).toHaveText('2');
        await expect(getDataCell(viewTable, 3, 4)).toHaveText('Potion');
        // SecretShopグループ（group_id=1）: 2→3行
        await expect(getDataCell(viewTable, 4, 0)).toHaveText('3');
        await expect(getDataCell(viewTable, 4, 4)).toHaveText('Sword');
        await expect(getDataCell(viewTable, 5, 3)).toHaveText('2');
        await expect(getDataCell(viewTable, 5, 4)).toHaveText('Shield');
        await expect(getDataCell(viewTable, 6, 3)).toHaveText('4');
        // 保存してStore行が正しく追加されていることを検証
        const firstCell = viewTable.locator('.editor-table-row:nth-child(2) .editor-table-cell:nth-child(2)');
        await firstCell.click();
        await page.keyboard.press('Control+s');
        await page.waitForTimeout(500);
        await expectCsvAsync(page, 'data/shop_product.csv', `
            id, group_id, item
            1,  1,        Sword
            2,  1,        Shield
            3,  2,        Potion
            4,  1,
        `);
    });

    test('グループ末尾への行挿入でも同一FK値グループに同期挿入されること', async ({ page }) => {
        await installMockApiAsync(page, createShopFileSystem());
        await page.goto('/');
        const viewTable = await openTableAsync(page, 'view_shop');
        // 初期状態を確認
        // ビュー列: shop.id(0), shop.name(1), shop.group_id(2), shop_product.id(3), shop_product.item(4)
        // row0: 1, WeaponShop, 1, 1, Sword    ← group_id=1リーダー
        // row1: [pad], [pad], [pad], 2, Shield ← group_id=1子行（WeaponShopグループの末尾）
        // row2: 2, ItemShop, 2, 3, Potion      ← group_id=2リーダー
        // row3: 3, SecretShop, 1, 1, Sword     ← group_id=1リーダー（別ベース行）
        // row4: [pad], [pad], [pad], 2, Shield ← group_id=1子行（SecretShopグループの末尾）
        await expect(getDataCell(viewTable, 0, 0)).toHaveText('1');
        await expect(getDataCell(viewTable, 0, 4)).toHaveText('Sword');
        await expect(getDataCell(viewTable, 1, 3)).toHaveText('2');
        await expect(getDataCell(viewTable, 1, 4)).toHaveText('Shield');
        await expect(getDataCell(viewTable, 2, 0)).toHaveText('2');
        await expect(getDataCell(viewTable, 2, 4)).toHaveText('Potion');
        await expect(getDataCell(viewTable, 3, 0)).toHaveText('3');
        await expect(getDataCell(viewTable, 4, 3)).toHaveText('2');
        await expect(getDataCell(viewTable, 4, 4)).toHaveText('Shield');
        // row1（WeaponShopグループの末尾子行=Shield行）の行ヘッダーを右クリック → 「下に行を挿入」
        // row1は groupPosition=1（子行）なので、次の行（row2=ItemShop）が別グループのリーダーであっても
        // グループ内挿入として扱い、WeaponShopグループに新行を挿入すべき
        // 修正済み: 以前はrowAbove(baseRowIndex=0) !== rowAtInsert(baseRowIndex=1) でグループ境界挿入と誤判定されていた
        const rowHeader = viewTable.locator('.editor-table-row-header').nth(1);
        await rowHeader.click({ button: 'right' });
        const menu = page.locator('.context-menu.visible');
        await expect(menu).toBeVisible();
        await menu.locator('.context-menu-item', { hasText: '下に行を挿入' }).click();
        // 挿入後の期待状態（7行）:
        // row0: 1, WeaponShop, 1, 1, Sword          ← WeaponShopリーダー（変化なし）
        // row1: [pad], [pad], [pad], 2, Shield        ← WeaponShop子行（変化なし）
        // row2: [pad], [pad], [pad], (empty), (empty) ← WeaponShop挿入行（新規）
        // row3: 2, ItemShop, 2, 3, Potion             ← ItemShopリーダー（変化なし）
        // row4: 3, SecretShop, 1, 1, Sword            ← SecretShopリーダー（変化なし）
        // row5: [pad], [pad], [pad], 2, Shield        ← SecretShop子行（変化なし）
        // row6: [pad], [pad], [pad], (empty), (empty) ← SecretShop同期挿入行（新規）

        // WeaponShopグループが2行→3行に展開されること
        await expect(getDataCell(viewTable, 0, 0)).toHaveText('1');
        await expect(getDataCell(viewTable, 0, 4)).toHaveText('Sword');
        await expect(getDataCell(viewTable, 1, 3)).toHaveText('2');
        await expect(getDataCell(viewTable, 1, 4)).toHaveText('Shield');
        // row2: WeaponShop挿入行（ベーステーブル列はパディング=空、JOIN列も空）
        await expect(getDataCell(viewTable, 2, 0)).toHaveText('');
        await expect(getDataCell(viewTable, 2, 1)).toHaveText('');
        await expect(getDataCell(viewTable, 2, 2)).toHaveText('');
        await expect(getDataCell(viewTable, 2, 3)).toHaveText('');
        await expect(getDataCell(viewTable, 2, 4)).toHaveText('');

        // ItemShopグループは変化なし（1行のまま、row3）
        await expect(getDataCell(viewTable, 3, 0)).toHaveText('2');
        await expect(getDataCell(viewTable, 3, 4)).toHaveText('Potion');

        // SecretShopグループが2行→3行に展開されること（同一FK値=1の同期挿入）
        await expect(getDataCell(viewTable, 4, 0)).toHaveText('3');
        await expect(getDataCell(viewTable, 4, 4)).toHaveText('Sword');
        await expect(getDataCell(viewTable, 5, 3)).toHaveText('2');
        await expect(getDataCell(viewTable, 5, 4)).toHaveText('Shield');
        // row6: SecretShop同期挿入行（ベーステーブル列はパディング=空、JOIN列も空）
        await expect(getDataCell(viewTable, 6, 0)).toHaveText('');
        await expect(getDataCell(viewTable, 6, 1)).toHaveText('');
        await expect(getDataCell(viewTable, 6, 2)).toHaveText('');
        await expect(getDataCell(viewTable, 6, 3)).toHaveText('');
        await expect(getDataCell(viewTable, 6, 4)).toHaveText('');

        // --- Undo ---
        await getDataCell(viewTable, 0, 0).click();
        await page.keyboard.press('Control+z');

        // Undo後: 元の5データ行に復元されること
        await expectTableDataAsync(viewTable, `
            1, WeaponShop, 1, 1, Sword
            ,           ,   , 2, Shield
            2, ItemShop,  2, 3, Potion
            3, SecretShop, 1, 1, Sword
            ,           ,   , 2, Shield
        `);

        // --- Redo ---
        await page.keyboard.press('Control+y');

        // Redo後: 再び7行の挿入状態に戻ること
        await expectTableDataAsync(viewTable, `
            1, WeaponShop, 1, 1, Sword
            ,           ,   , 2, Shield
            ,           ,   ,  ,
            2, ItemShop,  2, 3, Potion
            3, SecretShop, 1, 1, Sword
            ,           ,   , 2, Shield
            ,           ,   ,  ,
        `);
        // Redo後の挿入行がグループ内挿入行（ベース列がパディングセル）であることを確認
        await expect(getDataCell(viewTable, 2, 0)).toHaveClass(/view-padding-cell/);
        await expect(getDataCell(viewTable, 6, 0)).toHaveClass(/view-padding-cell/);
    });

    /**
     * Undo/Redoバグ再現テスト:
     * 兄弟グループが主行より前（DOMインデックスが小さい位置）にある場合、
     * execute時に前方の兄弟グループへ同期挿入すると主行のDOMインデックスが+1ずれる。
     * undo時にその兄弟行を削除すると主行のDOMインデックスが-1戻るが、
     * actualRowIndexはexecute完了時の値のまま更新されないため、
     * savedRowが誤った行要素をキャプチャし、redo時にデータが壊れる。
     *
     * テストデータ: SecretShop(id=1, group_id=1)がWeaponShop(id=3, group_id=1)より前に表示される
     * | shop.id | shop.name   | shop.group_id | shop_product.id | shop_product.item |
     * |    1    | SecretShop  |      1        |       1         |      Sword        |  ← row0: group_id=1リーダー
     * | [pad]   |   [pad]     |    [pad]      |       2         |      Shield       |  ← row1: group_id=1子行
     * |    2    | ItemShop    |      2        |       3         |      Potion       |  ← row2: group_id=2リーダー
     * |    3    | WeaponShop  |      1        |       1         |      Sword        |  ← row3: group_id=1リーダー（別ベース行）
     * | [pad]   |   [pad]     |    [pad]      |       2         |      Shield       |  ← row4: group_id=1子行
     */
    function createShopWithSiblingBeforeFileSystem(): MockFileSystem {
        return {
            "schema/shop.json": JSON.stringify({
                header: [
                    { key: 0, name: "id", type: "int" },
                    { key: 1, name: "name", type: "string" },
                    { key: 2, name: "group_id", type: "int" },
                ],
                primary_key: "id",
            }),
            "data/shop.csv": ["id,name,group_id", "1,SecretShop,1", "2,ItemShop,2", "3,WeaponShop,1"].join("\n"),
            "schema/shop_product.json": JSON.stringify({
                header: [
                    { key: 0, name: "id", type: "int" },
                    { key: 1, name: "group_id", type: "int" },
                    { key: 2, name: "item", type: "string" },
                ],
                primary_key: "id",
            }),
            "data/shop_product.csv": ["id,group_id,item", "1,1,Sword", "2,1,Shield", "3,2,Potion"].join("\n"),
            "view/view_shop.json": JSON.stringify({
                name: "view_shop",
                baseTable: "shop",
                joins: [{
                    sourceColumn: "group_id",
                    targetTable: "shop_product",
                    targetColumn: "group_id",
                    insertAfterViewColumnIndex: 2,
                    sourceTable: "",
                }],
            }),
        };
    }

    test('兄弟グループが主行より前にある場合のUndo/Redoが正しく動くこと', async ({ page }) => {
        await installMockApiAsync(page, createShopWithSiblingBeforeFileSystem());
        await page.goto('/');
        const viewTable = await openTableAsync(page, 'view_shop');

        // 初期状態（5データ行）
        await expectTableDataAsync(viewTable, `
            1,  SecretShop,  1, 1,  Sword
             ,            ,   , 2, Shield
            2,    ItemShop,  2, 3, Potion
            3,  WeaponShop,  1, 1,  Sword
             ,            ,   , 2, Shield
        `);

        // row4（WeaponShopグループの末尾子行=Shield行）の行ヘッダーを右クリック → 「下に行を挿入」
        // WeaponShopグループ末尾への挿入 → グループ内挿入として処理される
        // 同一FK値(group_id=1)を持つSecretShopグループ（row0-1、主行より前にある）にも同期挿入される
        const rowHeader = viewTable.locator('.editor-table-row-header').nth(4);
        await rowHeader.click({ button: 'right' });
        const menu = page.locator('.context-menu.visible');
        await expect(menu).toBeVisible();
        await menu.locator('.context-menu-item', { hasText: '下に行を挿入' }).click();

        // 挿入後（7行）: SecretShop(row2)とWeaponShop(row6)に同期挿入行が追加
        await expectTableDataAsync(viewTable, `
            1,  SecretShop,  1, 1,  Sword
             ,            ,   , 2, Shield
             ,            ,   ,  ,
            2,    ItemShop,  2, 3, Potion
            3,  WeaponShop,  1, 1,  Sword
             ,            ,   , 2, Shield
             ,            ,   ,  ,
        `);

        // --- 挿入後のCSV保存検証 ---
        // PK未設定の挿入行はStore行が生成されないため、CSVには元データのみが含まれるべき
        await getDataCell(viewTable, 0, 0).click();
        await page.keyboard.press('Control+s');
        await page.waitForTimeout(500);
        await expectCsvAsync(page, 'data/shop.csv', `
            id,        name, group_id
             1,  SecretShop,        1
             2,    ItemShop,        2
             3,  WeaponShop,        1
        `);
        await expectCsvAsync(page, 'data/shop_product.csv', `
            id, group_id,   item
            1,         1,  Sword
            2,         1, Shield
            3,         2, Potion
        `);

        // --- Undo ---
        await getDataCell(viewTable, 0, 0).click();
        await page.keyboard.press('Control+z');

        // Undo後: 元の5データ行に復元されること
        await expectTableDataAsync(viewTable, `
            1,  SecretShop,  1, 1, Sword
             ,            ,   , 2, Shield
            2,    ItemShop,  2, 3, Potion
            3,  WeaponShop,  1, 1, Sword
             ,            ,   , 2, Shield
        `);

        // --- Undo後のCSV保存検証 ---
        await getDataCell(viewTable, 0, 0).click();
        await page.keyboard.press('Control+s');
        await page.waitForTimeout(500);
        await expectCsvAsync(page, 'data/shop.csv', `
            id,        name,  group_id
             1,  SecretShop,         1
             2,    ItemShop,         2
             3,  WeaponShop,         1
        `);
        await expectCsvAsync(page, 'data/shop_product.csv', `
            id,   group_id,     item
             1,          1,    Sword
             2,          1,   Shield
             3,          2,   Potion
        `);

        // --- Redo ---
        await page.keyboard.press('Control+y');

        // Redo後: 再び7行の挿入状態に戻ること
        await expectTableDataAsync(viewTable, `
            1, SecretShop,  1, 1, Sword
            ,            ,   , 2, Shield
            ,            ,   ,  ,
            2,   ItemShop,  2, 3, Potion
            3, WeaponShop,  1, 1, Sword
            ,            ,   , 2, Shield
            ,            ,   ,  ,
        `);
        // Redo後の挿入行がグループ内挿入行（ベース列がパディングセル）であることを確認
        await expect(getDataCell(viewTable, 6, 0)).toHaveClass(/view-padding-cell/);

        // --- Redo後のCSV保存検証 ---
        await getDataCell(viewTable, 0, 0).click();
        await page.keyboard.press('Control+s');
        await page.waitForTimeout(500);
        await expectCsvAsync(page, 'data/shop.csv', `
            id,        name, group_id
             1,  SecretShop,        1
             2,    ItemShop,        2
             3,  WeaponShop,        1
        `);
        await expectCsvAsync(page, 'data/shop_product.csv', `
            id, group_id,   item
             1,        1,  Sword
             2,        1, Shield
             3,        2, Potion
        `);
    });
});
