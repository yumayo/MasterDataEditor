import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// 型バリデーション機能のテスト
//
// 機能概要:
//   スキーマで定義された列の型（int, string等）と一致しない値をセルに入力した場合、
//   バリデーションエラーとして表示する。
//
// テストケース一覧:
//   1. int型の列に文字列を入力するとバリデーションエラーが表示される
//   2. int型の列に数値を入力するとバリデーションエラーが表示されない
//   3. string型の列にはどんな値を入力してもバリデーションエラーにならない
//   4. 型エラーのあるセルを正しい値に修正するとエラーが消える
// =============================================================================

// =============================================================================
// フィクスチャ生成ヘルパー
// =============================================================================

/**
 * 型バリデーションテスト用のファイルシステムを生成する
 * id列(int型)をPK、name列(string型)、value列(int型)を持つ
 */
function createTypeValidationFileSystem(): MockFileSystem {
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
            "3,potion,50",
        ].join("\n"),
    };
}

// =============================================================================
// テストヘルパー関数
// =============================================================================

/**
 * エクスプローラーからテーブルを開き、タブ名で絞り込んだ EditorTable の Locator を返す
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
    const table = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="${tableName}"] .editor-table`);
    await expect(table).toBeVisible();
    return table;
}

/**
 * 指定行・列のデータセルをダブルクリックして新しい値を入力しEnterで確定する
 * rowIndex: 0始まり（ヘッダー行を除く）、colIndex: 0始まり（行ヘッダーを除く）
 */
async function editCellAsync(
    table: Locator,
    page: Page,
    rowIndex: number,
    colIndex: number,
    newValue: string,
): Promise<void> {
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
 * 指定行・列のデータセルを返す
 * rowIndex: 0始まり、colIndex: 0始まり（行ヘッダーを除く）
 */
function getDataCell(table: Locator, rowIndex: number, colIndex: number): Locator {
    const row = table.locator('.editor-table-row').nth(rowIndex);
    return row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
}

/**
 * バリデーションパネルのエラーアイテムを返す
 */
function getValidationPanelItems(page: Page): Locator {
    return page.locator('.validation-panel .validation-panel-item');
}

/**
 * ステータスバーのエラーバッジを返す
 */
function getStatusBarBadge(page: Page): Locator {
    return page.locator('.status-bar-badge');
}

/**
 * ステータスバーのバッジをクリックしてバリデーションパネルを開く
 */
async function openValidationPanelAsync(page: Page): Promise<void> {
    await getStatusBarBadge(page).click();
}

// =============================================================================
// テストケース1: int型の列に文字列を入力するとバリデーションエラーが表示される
// =============================================================================

test.describe('テストケース1: int型の列に文字列を入力するとバリデーションエラーが表示される', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createTypeValidationFileSystem());
        await page.goto('/');
    });

    test(
        'int型列に文字列を入力すると、cell-errorクラスが付与されPROBLEMSパネルにエラーが表示される',
        async ({ page }) => {
            const table = await openTableAsync(page, 'item');

            // 初期状態: エラーがないことを確認する
            await expect(getValidationPanelItems(page)).toHaveCount(0);

            // value列（int型、colIndex=2）に文字列 "abc" を入力する
            await editCellAsync(table, page, 0, 2, 'abc');

            // セルに cell-error クラスが付与される
            const errorCell = getDataCell(table, 0, 2);
            await expect(errorCell).toHaveClass(/cell-error/);

            // パネルを開く
            await openValidationPanelAsync(page);

            // PROBLEMSパネルに型不一致エラーが表示される
            const items = getValidationPanelItems(page);
            await expect(items).not.toHaveCount(0);
            const typeErrorItem = page.locator('.validation-panel .validation-panel-item').filter({ hasText: '型不一致' });
            await expect(typeErrorItem.first()).toBeVisible();

            // ステータスバーのエラーカウントが更新される
            const badge = getStatusBarBadge(page);
            const badgeText = await badge.textContent();
            expect(badgeText).not.toBeNull();
            const count = parseInt(badgeText!, 10);
            expect(count).toBeGreaterThanOrEqual(1);
        },
    );
});

// =============================================================================
// テストケース2: int型の列に数値を入力するとバリデーションエラーが表示されない
// =============================================================================

test.describe('テストケース2: int型の列に数値を入力するとバリデーションエラーが表示されない', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createTypeValidationFileSystem());
        await page.goto('/');
    });

    test(
        'int型列に有効な数値を入力しても、cell-errorクラスが付与されない',
        async ({ page }) => {
            const table = await openTableAsync(page, 'item');

            // value列（int型、colIndex=2）に数値 "42" を入力する
            await editCellAsync(table, page, 0, 2, '42');

            // セルに cell-error クラスが付与されない
            const cell = getDataCell(table, 0, 2);
            await expect(cell).not.toHaveClass(/cell-error/);

            // PROBLEMSパネルにエラーが表示されない
            await expect(getValidationPanelItems(page)).toHaveCount(0);
        },
    );
});

// =============================================================================
// テストケース3: string型の列にはどんな値を入力してもバリデーションエラーにならない
// =============================================================================

test.describe('テストケース3: string型の列にはどんな値を入力してもバリデーションエラーにならない', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createTypeValidationFileSystem());
        await page.goto('/');
    });

    test(
        'string型列に数値文字列を入力してもエラーにならない',
        async ({ page }) => {
            const table = await openTableAsync(page, 'item');

            // name列（string型、colIndex=1）に "abc" を入力する
            await editCellAsync(table, page, 0, 1, 'abc');

            // セルに cell-error クラスが付与されない
            const cell = getDataCell(table, 0, 1);
            await expect(cell).not.toHaveClass(/cell-error/);

            // PROBLEMSパネルにエラーが表示されない
            await expect(getValidationPanelItems(page)).toHaveCount(0);
        },
    );
});

// =============================================================================
// テストケース4: 型エラーのあるセルを正しい値に修正するとエラーが消える
// =============================================================================

test.describe('テストケース4: 型エラーのあるセルを正しい値に修正するとエラーが消える', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createTypeValidationFileSystem());
        await page.goto('/');
    });

    test(
        'int型列に文字列を入力してエラー→数値に修正するとエラーが消える',
        async ({ page }) => {
            const table = await openTableAsync(page, 'item');

            // value列（int型、colIndex=2）に文字列 "abc" を入力してエラーを発生させる
            await editCellAsync(table, page, 0, 2, 'abc');
            const errorCell = getDataCell(table, 0, 2);
            await expect(errorCell).toHaveClass(/cell-error/);

            // パネルを開いてエラーが表示されていることを確認する
            await openValidationPanelAsync(page);
            await expect(getValidationPanelItems(page)).not.toHaveCount(0);

            // 正しい値 "42" に修正する
            await editCellAsync(table, page, 0, 2, '42');

            // セルからエラークラスが消える
            await expect(errorCell).not.toHaveClass(/cell-error/);

            // パネルからエラーが消える
            await expect(getValidationPanelItems(page)).toHaveCount(0);

            // ステータスバーのバッジが "0" に戻る
            await expect(getStatusBarBadge(page)).toHaveText('0');
        },
    );
});
