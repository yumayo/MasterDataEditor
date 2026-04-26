import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// Dirty タブの閉じ確認ダイアログテスト
//
// dirty 状態（未保存の変更あり）のタブを閉じようとしたとき、
// 確認ダイアログが表示され、ユーザーが明示的に「閉じる」を選択しない限り
// タブが閉じられないことを検証する。
// =============================================================================

/**
 * テスト用ファイルシステム（シンプルな1テーブル構成）
 */
function createTestFileSystem(): MockFileSystem {
    return {
        "schema/item.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                { key: 2, name: "value", type: "int" },
            ],
            primary_key: ["id"],
        }),
        "data/item.csv": [
            "id,name,value",
            "1,sword,100",
            "2,shield,200",
        ].join("\n"),
    };
}

/**
 * エクスプローラーからテーブルを開き、エディターテーブルの Locator を返す
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
    const table = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="${tableName}"] .editor-table`);
    await expect(table).toBeVisible();
    return table;
}

/**
 * 指定行・列のデータセルをダブルクリックして新しい値を入力し Enter で確定する。
 * これにより対象テーブルが dirty 状態になる。
 */
async function editCellAsync(table: Locator, page: Page, rowIndex: number, colIndex: number, newValue: string): Promise<void> {
    const row = table.locator('.editor-table-row').nth(rowIndex);
    const cell = row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
    await expect(cell).toBeVisible();
    await cell.dblclick();
    const editField = page.locator('.grid-textfield-active');
    await expect(editField).toBeVisible();
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText(newValue);
    await page.keyboard.press('Enter');
}

/**
 * 指定テーブル名のタブの閉じるボタンをクリックする
 */
async function clickTabCloseButtonAsync(page: Page, tableName: string): Promise<void> {
    const tabButton = page.locator('.tab-button').filter({ hasText: tableName }).first();
    await expect(tabButton).toBeVisible();
    await tabButton.locator('.tab-button-close').click();
}

// =============================================================================
// テスト本体
// =============================================================================

test.describe('Dirty タブの閉じ確認ダイアログ', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createTestFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        'dirty 状態のタブの閉じるボタンをクリックすると確認ダイアログが表示される',
        async ({ page }) => {
            // テーブルを開いてセルを編集し dirty 状態にする
            const table = await openTableAsync(page, 'item');
            await editCellAsync(table, page, 0, 1, 'katana');

            // dirty マークが表示されていることを確認する
            const tabButton = page.locator('.tab-button').filter({ hasText: 'item' }).first();
            await expect(tabButton.locator('.tab-button-dirty')).toHaveClass(/tab-button-dirty-visible/);

            // 閉じるボタンをクリックする
            await clickTabCloseButtonAsync(page, 'item');

            // 確認ダイアログが表示されることを検証する
            const overlay = page.locator('.close-confirm-overlay.visible');
            await expect(overlay).toBeVisible();
            await expect(overlay.locator('.close-confirm-message')).toContainText('「item」には未保存の変更があります');

            // タブがまだ開いていることを検証する（閉じられていない）
            await expect(tabButton).toBeVisible();
        },
    );

    test(
        '確認ダイアログで「閉じる」を押すとタブが閉じる',
        async ({ page }) => {
            // テーブルを開いてセルを編集し dirty 状態にする
            const table = await openTableAsync(page, 'item');
            await editCellAsync(table, page, 0, 1, 'katana');

            // 閉じるボタンをクリックしてダイアログを表示する
            await clickTabCloseButtonAsync(page, 'item');
            const overlay = page.locator('.close-confirm-overlay.visible');
            await expect(overlay).toBeVisible();

            // 「閉じる」ボタンをクリックする
            await overlay.locator('.close-confirm-button-close').click();

            // ダイアログが閉じることを検証する
            await expect(page.locator('.close-confirm-overlay')).toHaveCount(0);

            // タブが閉じられたことを検証する
            const tabButton = page.locator('.tab-button').filter({ hasText: 'item' });
            await expect(tabButton).toHaveCount(0);
        },
    );

    test(
        '確認ダイアログで「キャンセル」を押すとタブが閉じない',
        async ({ page }) => {
            // テーブルを開いてセルを編集し dirty 状態にする
            const table = await openTableAsync(page, 'item');
            await editCellAsync(table, page, 0, 1, 'katana');

            // 閉じるボタンをクリックしてダイアログを表示する
            await clickTabCloseButtonAsync(page, 'item');
            const overlay = page.locator('.close-confirm-overlay.visible');
            await expect(overlay).toBeVisible();

            // 「キャンセル」ボタンをクリックする
            await overlay.locator('.close-confirm-button-cancel').click();

            // ダイアログが閉じることを検証する
            await expect(page.locator('.close-confirm-overlay')).toHaveCount(0);

            // タブがまだ開いていることを検証する
            const tabButton = page.locator('.tab-button').filter({ hasText: 'item' }).first();
            await expect(tabButton).toBeVisible();
        },
    );

    test(
        'dirty でないタブは確認なしで閉じる',
        async ({ page }) => {
            // テーブルを開く（編集しない）
            await openTableAsync(page, 'item');

            // dirty マークが表示されていないことを確認する
            const tabButton = page.locator('.tab-button').filter({ hasText: 'item' }).first();
            await expect(tabButton.locator('.tab-button-dirty')).not.toHaveClass(/tab-button-dirty-visible/);

            // 閉じるボタンをクリックする
            await clickTabCloseButtonAsync(page, 'item');

            // ダイアログが表示されないことを検証する
            await expect(page.locator('.close-confirm-overlay')).toHaveCount(0);

            // タブが閉じられたことを検証する
            const closedTabButton = page.locator('.tab-button').filter({ hasText: 'item' });
            await expect(closedTabButton).toHaveCount(0);
        },
    );
});
