import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import {
    installMockApiAsync,
    MockFileSystem,
    readMockFileAsync,
} from './fixtures/mock-api';

function createFileSystem(): MockFileSystem {
    const fs: MockFileSystem = {
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
        "schema/enemy_name.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int", reference: "enemy.id" },
                { key: 1, name: "ja", type: "string" },
            ],
            primary_key: ["id"],
            reverseReferencePriority: 1,
        }),
        "data/enemy_name.csv": [
            "id,ja",
            "1,slime name",
            "2,dragon name",
        ].join("\n"),
    };

    for (let i = 0; i < 12; i++) {
        fs[`schema/unrelated_${i}.json`] = JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
            ],
            primary_key: ["id"],
        });
        fs[`data/unrelated_${i}.csv`] = [
            "id,name",
            `1,value_${i}`,
        ].join("\n");
    }
    return fs;
}

async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    await page.locator('#explorer').getByText(tableName, { exact: true }).click();
    const table = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="${tableName}"] .editor-table`);
    await expect(table).toBeVisible();
    return table;
}

function getDataCell(table: Locator, rowIndex: number, colIndex: number): Locator {
    return table
        .locator('.editor-table-row')
        .nth(rowIndex)
        .locator('.editor-table-cell:not(.editor-table-row-header)')
        .nth(colIndex);
}

function getReverseReferenceHint(table: Locator, rowIndex: number, colIndex: number): Locator {
    return getDataCell(table, rowIndex, colIndex).locator('.cell-reverse-reference-hint');
}

async function editCellAsync(page: Page, table: Locator, rowIndex: number, colIndex: number, value: string): Promise<void> {
    await getDataCell(table, rowIndex, colIndex).dblclick();
    const field = page.locator('.grid-textfield-active').first();
    await expect(field).toBeVisible();
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText(value);
    await page.keyboard.press('Enter');
}

async function clearApiRequestsAsync(page: Page): Promise<void> {
    await page.evaluate(() => {
        const w = window as unknown as {
            __mockApiRequests: string[];
            __mockApiRequestDetails: Array<{ type: string; filename?: string }>;
        };
        w.__mockApiRequests = [];
        w.__mockApiRequestDetails = [];
    });
}

async function readApiRequestDetailsAsync(page: Page): Promise<Array<{ type: string; filename?: string }>> {
    return page.evaluate(() => {
        const w = window as unknown as {
            __mockApiRequestDetails: Array<{ type: string; filename?: string }>;
        };
        return w.__mockApiRequestDetails;
    });
}

async function dispatchSelfSaveFileChangedAsync(page: Page, filenames: string[]): Promise<void> {
    await page.evaluate((changedFilenames) => {
        window.chrome.webview.postMessage(JSON.stringify({
            type: 'file_changed',
            filenames: changedFilenames,
        }));
    }, filenames);
    await page.waitForTimeout(50);
}

test.describe('逆参照エンジンのリアルタイム更新', () => {
    test('参照元テーブル編集後に親テーブルを開いてもschema全体を再走査せず逆参照ヒントが更新されること', async ({ page }) => {
        await installMockApiAsync(page, createFileSystem());
        await page.goto('/');

        const enemyTable = await openTableAsync(page, 'enemy');
        await expect(getReverseReferenceHint(enemyTable, 0, 0)).toHaveText('slime name');

        const enemyNameTable = await openTableAsync(page, 'enemy_name');
        await editCellAsync(page, enemyNameTable, 0, 1, 'slime realtime');
        await page.keyboard.press('Control+s');
        await expect.poll(
            async () => readMockFileAsync(page, 'data/enemy_name.csv')
        ).toContain('slime realtime');

        await dispatchSelfSaveFileChangedAsync(page, ['data/enemy_name.csv', 'schema/enemy_name.json']);
        await clearApiRequestsAsync(page);

        const reopenedEnemyTable = await openTableAsync(page, 'enemy');
        await expect(getReverseReferenceHint(reopenedEnemyTable, 0, 0)).toHaveText('slime realtime');

        const requests = await readApiRequestDetailsAsync(page);
        const schemaReads = requests.filter(request =>
            request.type === 'read_file_request'
            && request.filename !== undefined
            && request.filename.startsWith('schema/')
        );
        const findFiles = requests.filter(request => request.type === 'find_files_request');
        expect(schemaReads).toEqual([]);
        expect(findFiles).toEqual([]);
    });
});
