import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

function createFrozenValidationFileSystem(): MockFileSystem {
    return {
        "schema/freeze_validation.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                { key: 2, name: "hp", type: "int" },
                { key: 3, name: "atk", type: "int" },
            ],
            primary_key: ["id"],
            frozenRowCount: 1,
            frozenColumnCount: 1,
        }),
        "data/freeze_validation.csv": [
            "id,name,hp,atk",
            "1,Slime,bad,10",
            "1,Dragon,9999,500",
            "3,Goblin,200,30",
        ].join("\n"),
    };
}

async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    await page.locator('#explorer').getByText(tableName, { exact: true }).click();
    const table = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="${tableName}"] .editor-table`);
    await expect(table).toBeVisible();
    return table;
}

test.describe('起動時バリデーションとフリーズペイン', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createFrozenValidationFileSystem());
        await page.goto('/');
    });

    test('固定表示用の複製セルにも初期バリデーションの赤波線クラスが付与される', async ({ page }) => {
        const table = await openTableAsync(page, 'freeze_validation');

        const frozenCornerPkCell = table.locator(
            '.editor-table-detached-frozen-corner-layer .editor-table-detached-row[data-row-index="0"] .editor-table-cell[data-col="0"]',
        );
        await expect(frozenCornerPkCell).toHaveClass(/cell-error/);
        await expect(frozenCornerPkCell).toHaveClass(/cell-pk-duplicate/);

        const frozenColumnPkCell = table.locator(
            '.editor-table-detached-row-header-layer .editor-table-detached-row[data-row-index="1"] .editor-table-cell[data-col="0"]',
        );
        await expect(frozenColumnPkCell).toHaveClass(/cell-error/);
        await expect(frozenColumnPkCell).toHaveClass(/cell-pk-duplicate/);

        const frozenRowTypeErrorCell = table.locator(
            '.editor-table-detached-frozen-row-layer .editor-table-detached-row[data-row-index="0"] .editor-table-cell[data-col="2"]',
        );
        await expect(frozenRowTypeErrorCell).toHaveClass(/cell-error/);
    });
});
