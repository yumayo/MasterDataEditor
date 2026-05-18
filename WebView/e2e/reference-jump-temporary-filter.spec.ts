import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, readMockFileAsync, MockFileSystem } from './fixtures/mock-api';

function createReferenceJumpFilterFileSystem(): MockFileSystem {
    return {
        "schema/enemy.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
            ],
            primary_key: ["id"],
        }),
        "data/enemy.csv": [
            "id,name",
            "1,slime",
            "2,dragon",
        ].join("\n"),
        "schema/quest.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                { key: 2, name: "enemy_id", type: "int", reference: "enemy.id" },
            ],
            primary_key: ["id"],
        }),
        "data/quest.csv": [
            "id,name,enemy_id",
            "1,first_quest,2",
            "2,second_quest,1",
        ].join("\n"),
    };
}

async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    await page.locator('#explorer').getByText(tableName, { exact: true }).click();
    await expect(page.locator('.tab-button-active')).toContainText(tableName);
    const table = page.locator('.editor-left-pane .editor-table');
    await expect(table).toBeVisible();
    return table;
}

function getActiveTable(page: Page): Locator {
    return page.locator('.editor-left-pane .tab-wrapper:not([style*="display: none"]) .editor-table');
}

function getDataCell(table: Locator, rowIndex: number, colIndex: number): Locator {
    const row = table.locator('.editor-table-row:not(.editor-table-empty-row)').nth(rowIndex);
    return row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
}

async function getVisibleColumnValuesAsync(table: Locator, colIndex: number): Promise<string[]> {
    const rows = table.locator('.editor-table-row:not(.editor-table-empty-row)');
    const count = await rows.count();
    const values: string[] = [];
    for (let i = 0; i < count; i++) {
        const row = rows.nth(i);
        if (!await row.isVisible()) continue;
        values.push(await row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex).innerText());
    }
    return values;
}

async function countSchemaWritesAsync(page: Page, filename: string): Promise<number> {
    return page.evaluate((target) => {
        const details = (window as unknown as {
            __mockApiRequestDetails: Array<{ type: string; filename?: string }>;
        }).__mockApiRequestDetails;
        return details.filter(entry => entry.type === 'write_file_request' && entry.filename === target).length;
    }, filename);
}

test.describe('参照ジャンプの一時フィルター', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createReferenceJumpFilterFileSystem());
        await page.goto('/');
    });

    test('FKセルをCtrl+クリックすると参照先列に一時フィルターが適用され、schemaには保存されない', async ({ page }) => {
        const questTable = await openTableAsync(page, 'quest');
        await getDataCell(questTable, 0, 2).click({ modifiers: ['Control'] });

        await expect(page.locator('.tab-button-active')).toContainText('enemy');
        const enemyTable = getActiveTable(page);
        await expect(page.locator('.editor-left-slot .filter-row-count:visible')).toHaveText('1 / 2 行');
        await expect.poll(() => getVisibleColumnValuesAsync(enemyTable, 0)).toEqual(['2']);

        expect(await countSchemaWritesAsync(page, 'schema/enemy.json')).toBe(0);
        const schema = JSON.parse(await readMockFileAsync(page, 'schema/enemy.json'));
        expect(schema.filters).toBeUndefined();
    });

    test('PKセルをCtrl+クリックすると逆参照先列に一時フィルターが適用され、schemaには保存されない', async ({ page }) => {
        const enemyTable = await openTableAsync(page, 'enemy');
        await expect.poll(async () => {
            const activeTabName = await page.locator('.tab-button-active .tab-button-name').innerText();
            if (activeTabName !== 'quest') {
                await getDataCell(enemyTable, 0, 0).click({ modifiers: ['Control'] });
            }
            return page.locator('.tab-button-active .tab-button-name').innerText();
        }).toBe('quest');
        const questTable = getActiveTable(page);
        await expect(page.locator('.editor-left-slot .filter-row-count:visible')).toHaveText('1 / 2 行');
        await expect.poll(() => getVisibleColumnValuesAsync(questTable, 2)).toEqual(['1']);

        expect(await countSchemaWritesAsync(page, 'schema/quest.json')).toBe(0);
        const schema = JSON.parse(await readMockFileAsync(page, 'schema/quest.json'));
        expect(schema.filters).toBeUndefined();
    });
});
