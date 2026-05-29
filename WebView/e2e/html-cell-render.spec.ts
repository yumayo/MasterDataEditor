import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

function createFileSystemWithObsoleteHtmlColumn(): MockFileSystem {
    return {
        "schema/item.json": JSON.stringify({
            primary_key: ["id"],
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                { key: 2, name: "description", type: "string", renderAsHtml: true },
            ],
        }),
        "data/item.csv": [
            "id,name,description",
            `1,Sword,"改行前<br>改行後"`,
            `2,Shield,"<script>alert(1)</script>危険テキスト"`,
        ].join("\n"),
    };
}

async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    await page.locator('#explorer').getByText(tableName, { exact: true }).click();
    const table = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="${tableName}"] .editor-table`);
    await expect(table).toBeVisible();
    return table;
}

function getDataCell(table: Locator, rowIndex: number, colIndex: number): Locator {
    return table.locator(`.editor-table-row[data-row-index="${rowIndex}"] .editor-table-cell[data-col="${colIndex}"]`);
}

async function rightClickColumnHeaderAsync(table: Locator, colIndex: number): Promise<void> {
    const headerRow = table.locator('.editor-table-column-header-row');
    const header = headerRow.locator('.editor-table-column-header').nth(colIndex);
    await header.click({ button: 'right' });
}

test.describe('HTMLとして表示 廃止', () => {
    test('renderAsHtmlが残ったスキーマでもセル値を通常テキストとして表示する', async ({ page }) => {
        await installMockApiAsync(page, createFileSystemWithObsoleteHtmlColumn());
        await page.goto('/');
        const table = await openTableAsync(page, 'item');

        const cell = getDataCell(table, 0, 2);
        await expect(cell).toBeVisible();
        await expect(cell).toHaveText('改行前<br>改行後');

        await expect(cell.locator('br')).toHaveCount(0);
        const innerHTML = await cell.evaluate((el: HTMLElement) => el.innerHTML);
        expect(innerHTML).toContain('&lt;br&gt;');
    });

    test('HTMLとして表示メニューを列ヘッダーのコンテキストメニューに表示しない', async ({ page }) => {
        await installMockApiAsync(page, createFileSystemWithObsoleteHtmlColumn());
        await page.goto('/');
        const table = await openTableAsync(page, 'item');

        await rightClickColumnHeaderAsync(table, 2);

        const contextMenu = page.locator('.context-menu.visible');
        await expect(contextMenu).toBeVisible();
        await expect(contextMenu.locator('.context-menu-item', { hasText: 'HTMLとして表示' })).toHaveCount(0);
    });

    test('危険なタグも通常テキストとして表示する', async ({ page }) => {
        await installMockApiAsync(page, createFileSystemWithObsoleteHtmlColumn());
        await page.goto('/');
        const table = await openTableAsync(page, 'item');

        const cell = getDataCell(table, 1, 2);
        await expect(cell).toBeVisible();
        await expect(cell).toHaveText('<script>alert(1)</script>危険テキスト');
        await expect(cell.locator('script')).toHaveCount(0);
    });
});
