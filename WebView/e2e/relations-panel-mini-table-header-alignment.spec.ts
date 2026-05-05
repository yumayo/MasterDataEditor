import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';
import { enableRelationsPanelAsync } from './fixtures/test-utils';

function createHeaderAlignmentFileSystem(): MockFileSystem {
    return {
        "schema/enemy.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "ja", type: "string" },
            ],
            primary_key: ["id"],
        }),
        "data/enemy.csv": [
            "id,ja",
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
            "1,first_quest,1",
            "2,second_quest,2",
        ].join("\n"),
    };
}

async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
    const table = page.locator('.editor-left-pane .editor-table');
    await expect(table).toBeVisible();
    return table;
}

test.describe('RelationsPanel mini table header alignment', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createHeaderAlignmentFileSystem());
        await page.goto('/');
        await enableRelationsPanelAsync(page);
    });

    test('列ヘッダーとデータセルの左端が行ヘッダー幅分ずれずに揃うこと', async ({ page }) => {
        const mainTable = await openTableAsync(page, 'quest');
        await mainTable.locator('.editor-table-row-header').first().click();
        await expect(page.locator('.relations-panel-content')).toBeVisible();

        const miniTable = page.locator('.relations-panel .editor-table').first();
        await expect(miniTable).toBeVisible();

        const headerBox = await miniTable
            .locator('.editor-table-detached-column-header-layer .editor-table-column-header')
            .first()
            .boundingBox();
        const dataCellBox = await miniTable
            .locator('.editor-table-row:not(.editor-table-source-column-header-row):not(.editor-table-empty-row)')
            .first()
            .locator('.editor-table-cell:not(.editor-table-row-header)')
            .first()
            .boundingBox();

        if (headerBox === null || dataCellBox === null) {
            throw new Error('ミニテーブルの列ヘッダーまたはデータセルの位置を取得できません');
        }

        expect(Math.abs(headerBox.x - dataCellBox.x)).toBeLessThan(1);
    });
});
