import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';

/**
 * エディターテーブルが表示されるまで待機し、
 * テーブルのLocatorを返す
 */
async function openTableAsync(
    page: Page,
): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText('test').click();
    const table = page.locator('.editor-table');
    await expect(table).toBeVisible();
    return table;
}

/**
 * 選択状態の列ヘッダー数を取得する
 */
async function getSelectedColumnHeaderCountAsync(
    table: Locator,
): Promise<number> {
    const selector =
        '.editor-table-column-header-row'
        + ' .editor-table-column-header.selected';
    return await table.locator(selector).count();
}

/**
 * 選択状態の行ヘッダー数を取得する
 */
async function getSelectedRowHeaderCountAsync(
    table: Locator,
): Promise<number> {
    return await table
        .locator('.editor-table-row-header.selected')
        .count();
}

test(
    '列ヘッダー右クリック後にマウス移動しても列選択が拡張されないこと',
    async ({ page, mockFileSystem }) => {
        const table = await openTableAsync(page);

        // "name"列（インデックス1）を右クリック
        const nameHeader = table
            .locator('.editor-table-column-header')
            .nth(1);
        await nameHeader.click({ button: 'right' });

        // コンテキストメニューが表示される
        const menu = page.locator('.context-menu.visible');
        await expect(menu).toBeVisible();

        // "value"列（インデックス2）のデータセルへ
        // マウスを移動する
        const valueCell = table
            .locator('.editor-table-row:nth-child(2)')
            .locator(
                '.editor-table-cell'
                + ':not(.editor-table-row-header)'
            )
            .nth(2);
        await valueCell.hover({ force: true });

        // 選択された列ヘッダーは1つだけであること
        // （ドラグ拡張されていないこと）
        const selectedCount =
            await getSelectedColumnHeaderCountAsync(
                table
            );
        expect(selectedCount).toBe(1);
    },
);

test(
    '行ヘッダー右クリック後にマウス移動しても行選択が拡張されないこと',
    async ({ page, mockFileSystem }) => {
        const table = await openTableAsync(page);

        // 1行目（インデックス0）の行ヘッダーを右クリック
        const rowHeader = table
            .locator('.editor-table-row-header')
            .first();
        await rowHeader.click({ button: 'right' });

        // コンテキストメニューが表示される
        const menu = page.locator('.context-menu.visible');
        await expect(menu).toBeVisible();

        // 3行目のデータセルへマウスを移動する
        const thirdRowCell = table
            .locator('.editor-table-row:nth-child(4)')
            .locator(
                '.editor-table-cell'
                + ':not(.editor-table-row-header)'
            )
            .first();
        await thirdRowCell.hover({ force: true });

        // 選択された行ヘッダーは1つだけであること
        // （ドラグ拡張されていないこと）
        const selectedCount =
            await getSelectedRowHeaderCountAsync(table);
        expect(selectedCount).toBe(1);
    },
);
