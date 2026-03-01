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
 * item: id(PK), name
 *   id=1,name=Sword / id=2,name=Shield
 *
 * enemy: id(PK), name, dropItemId(FK→item.id)
 *   id=1,name=Goblin,dropItemId=1 / id=2,name=Dragon,dropItemId=2
 *
 * view_enemy: enemyベース、item をJOIN
 *   JOINs: enemy.dropItemId → item.id
 *   ビュー列: enemy.id(0), enemy.name(1), enemy.dropItemId(2), item.name(3)
 *
 * ビュー表示イメージ:
 * | enemy.id | enemy.name | enemy.dropItemId | item.name |
 * |    1     |   Goblin   |        1         |   Sword   |
 * |    2     |   Dragon   |        2         |   Shield  |
 */
function createFileSystem(): MockFileSystem {
    return {
        "schema/item.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
            ],
            primary_key: "id",
        }),
        "data/item.csv": ["id,name", "1,Sword", "2,Shield"].join("\n"),
        "schema/enemy.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                { key: 2, name: "dropItemId", type: "int", reference: "item.id" },
            ],
            primary_key: "id",
        }),
        "data/enemy.csv": ["id,name,dropItemId", "1,Goblin,1", "2,Dragon,2"].join("\n"),
        "view/view_enemy.json": JSON.stringify({
            name: "view_enemy",
            baseTable: "enemy",
            joins: [{
                sourceColumn: "dropItemId",
                targetTable: "item",
                targetColumn: "id",
                insertAfterViewColumnIndex: 2,
                sourceTable: "",
            }],
        }),
    };
}

// -------------------------------------------------------
// タブ切替時のストア→DOM差分同期テスト
// ビュータブでの編集がストアを更新した後、通常タブに切替えた際に
// DOMがストアの最新値に同期されることを検証する
// -------------------------------------------------------
test.describe(
    'タブ切替時のストア→DOM差分同期',
    () => {
        test(
            'ビューのベース列を編集後、通常タブに切替えるとDOMが同期されること',
            async ({ page }) => {
                await installMockApiAsync(page, createFileSystem());
                await page.goto('/');

                // 1. enemyテーブルを通常タブで開く
                const enemyTable = await openTableAsync(page, 'enemy');
                // 初期値: row0=Goblin, row1=Dragon
                await expect(getDataCell(enemyTable, 0, 1)).toHaveText('Goblin');
                await expect(getDataCell(enemyTable, 1, 1)).toHaveText('Dragon');

                // 2. view_enemyを開く
                const viewTable = await openTableAsync(page, 'view_enemy');
                // ビュー列: enemy.id(0), enemy.name(1), enemy.dropItemId(2), item.name(3)
                await expect(getDataCell(viewTable, 0, 1)).toHaveText('Goblin');

                // 3. ビューのベース列（enemy.name, col1）を編集
                // propagateJoinedColumnToSourceTableのベース列分岐: ストアのみ更新、DOMへの伝搬なし
                await editCellAsync(page, viewTable, 0, 1, 'GoblinKing');
                await expect(getDataCell(viewTable, 0, 1)).toHaveText('GoblinKing');

                // 4. enemyタブに切替え
                const refreshedEnemyTable = await openTableAsync(page, 'enemy');

                // 5. reloadCellsFromStoreにより、ストアの値がDOMに反映されていること
                await expect(getDataCell(refreshedEnemyTable, 0, 1)).toHaveText('GoblinKing');
                // 編集していない行は変更されていないこと
                await expect(getDataCell(refreshedEnemyTable, 1, 1)).toHaveText('Dragon');
            },
        );

        test(
            'ビューの結合列を編集後、結合先の通常タブに切替えるとDOMが同期されること',
            async ({ page }) => {
                await installMockApiAsync(page, createFileSystem());
                await page.goto('/');

                // 1. itemテーブルを通常タブで開く
                const itemTable = await openTableAsync(page, 'item');
                await expect(getDataCell(itemTable, 0, 1)).toHaveText('Sword');

                // 2. view_enemyを開く
                const viewTable = await openTableAsync(page, 'view_enemy');
                // ビュー列: enemy.id(0), enemy.name(1), enemy.dropItemId(2), item.name(3)
                await expect(getDataCell(viewTable, 0, 3)).toHaveText('Sword');

                // 3. ビューの結合列（item.name, col3）を編集
                // propagateJoinedColumnToSourceTableの結合列分岐: ソーステーブルが開かれているのでDOMも更新される
                // ただしupdateCellValueAtはDOM+Storeを更新するので、この場合は既にDOMが更新済み
                await editCellAsync(page, viewTable, 0, 3, 'Excalibur');
                await expect(getDataCell(viewTable, 0, 3)).toHaveText('Excalibur');

                // 4. itemタブに切替え
                const refreshedItemTable = await openTableAsync(page, 'item');

                // 5. DOMが更新されていること
                // 結合列の場合はupdateCellValueAtで既にDOMが更新されているため、
                // reloadCellsFromStoreがなくても通る可能性があるが、
                // 確認のためアサートする
                await expect(getDataCell(refreshedItemTable, 0, 1)).toHaveText('Excalibur');
                // 編集していない行は変更されていないこと
                await expect(getDataCell(refreshedItemTable, 1, 1)).toHaveText('Shield');
            },
        );

        test(
            'ビューのベース列を複数セル編集後、通常タブに切替えるとすべて同期されること',
            async ({ page }) => {
                await installMockApiAsync(page, createFileSystem());
                await page.goto('/');

                // 1. enemyテーブルを通常タブで開く
                const enemyTable = await openTableAsync(page, 'enemy');
                await expect(getDataCell(enemyTable, 0, 1)).toHaveText('Goblin');
                await expect(getDataCell(enemyTable, 1, 1)).toHaveText('Dragon');

                // 2. view_enemyを開く
                const viewTable = await openTableAsync(page, 'view_enemy');

                // 3. 2つのベース列セルを連続して編集
                await editCellAsync(page, viewTable, 0, 1, 'GoblinKing');
                await editCellAsync(page, viewTable, 1, 1, 'DragonLord');
                await expect(getDataCell(viewTable, 0, 1)).toHaveText('GoblinKing');
                await expect(getDataCell(viewTable, 1, 1)).toHaveText('DragonLord');

                // 4. enemyタブに切替え
                const refreshedEnemyTable = await openTableAsync(page, 'enemy');

                // 5. 両方のセルが同期されていること
                await expect(getDataCell(refreshedEnemyTable, 0, 1)).toHaveText('GoblinKing');
                await expect(getDataCell(refreshedEnemyTable, 1, 1)).toHaveText('DragonLord');
            },
        );
    },
);
