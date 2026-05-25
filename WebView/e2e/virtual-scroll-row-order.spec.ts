import { test, expect } from './fixtures/test';
import type { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// バーチャルスクロール 行順序テスト
//
// 100行テーブルをスクロールしたとき、表示される行のデータが正しい順序を維持するか検証する。
// 特にソート状態が保存されたテーブル（charaテーブルのsortKeys等）で
// 仮想スクロールとソート復元が干渉してIDがめちゃくちゃになる問題の再現テスト。
// =============================================================================

/** 100行のCSVデータ（id昇順連番、value列はランダム風） */
function generateCsv(rowCount: number): string {
    const rows = ['id,name,value'];
    for (let i = 1; i <= rowCount; i++) {
        rows.push(`${i},name_${i},${(i * 7) % 100}`);
    }
    return rows.join('\n');
}

/** ソートなしのファイルシステム */
function createUnsortedFileSystem(): MockFileSystem {
    return {
        'schema/item.json': JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int' },
                { key: 1, name: 'name', type: 'string' },
                { key: 2, name: 'value', type: 'int' },
            ],
            primary_key: ['id'],
        }),
        'data/item.csv': generateCsv(100),
    };
}

/** sortKeys付きのファイルシステム（charaテーブルと同パターン） */
function createSortedFileSystem(): MockFileSystem {
    return {
        'schema/item.json': JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int' },
                { key: 1, name: 'name', type: 'string' },
                { key: 2, name: 'value', type: 'int' },
            ],
            primary_key: ['id'],
            sortKeys: [{ columnName: 'value', direction: 'desc' }],
        }),
        'data/item.csv': generateCsv(100),
    };
}

/** テーブル内の表示行から指定列の値を順番に抽出する */
async function getVisibleColumnValues(table: Locator, colIndex: number): Promise<string[]> {
    const rows = table.locator('.editor-table-row:not(.editor-table-column-header-row):not(.editor-table-empty-row)');
    const count = await rows.count();
    const values: string[] = [];
    for (let i = 0; i < count; i++) {
        // colIndex+1 はヘッダーセル分のオフセット（children[0]=行ヘッダー）
        const cell = rows.nth(i).locator('.editor-table-cell').nth(colIndex + 1);
        const text = await cell.textContent();
        if (text !== null && text.trim() !== '') {
            values.push(text.trim());
        }
    }
    return values;
}

/** 表示行の行ヘッダー番号を取得する */
async function getVisibleRowNumbers(table: Locator): Promise<number[]> {
    const rows = table.locator('.editor-table-row:not(.editor-table-column-header-row):not(.editor-table-empty-row)');
    const count = await rows.count();
    const numbers: number[] = [];
    for (let i = 0; i < count; i++) {
        const header = rows.nth(i).locator('.editor-table-row-header');
        const text = await header.textContent();
        if (text !== null && text.trim() !== '') {
            numbers.push(parseInt(text.trim(), 10));
        }
    }
    return numbers;
}

test.describe('バーチャルスクロール行順序', () => {
    test('ソートなしテーブルでスクロール後もID列が昇順を維持する', async ({ page }) => {
        const fs = createUnsortedFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        await page.locator('#explorer .explorer-file').getByText('item', { exact: true }).click();
        const table = page.locator('.editor-left-slot .editor-table:visible').first();
        await expect(table).toBeVisible();

        const scrollContainer = page.locator('.editor-left-pane');

        // 中間付近までスクロール
        await scrollContainer.evaluate((el) => { el.scrollTop = 50 * 21; });
        await page.waitForTimeout(300);

        const midIds = await getVisibleColumnValues(table, 0);
        const midRowNums = await getVisibleRowNumbers(table);
        console.log('ソートなし中間IDs:', JSON.stringify(midIds));
        console.log('ソートなし中間行番号:', JSON.stringify(midRowNums));

        // IDは昇順であるべき
        for (let i = 1; i < midIds.length; i++) {
            expect(parseInt(midIds[i]), `ID順序エラー: idx=${i}, prev=${midIds[i-1]}, curr=${midIds[i]}`).toBeGreaterThan(parseInt(midIds[i - 1]));
        }
        // 行番号も昇順であるべき
        for (let i = 1; i < midRowNums.length; i++) {
            expect(midRowNums[i], `行番号順序エラー: idx=${i}`).toBeGreaterThan(midRowNums[i - 1]);
        }
    });

    test('sortKeys付きテーブルでスクロール後もvalue列がソート順を維持する', async ({ page }) => {
        const fs = createSortedFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        await page.locator('#explorer .explorer-file').getByText('item', { exact: true }).click();
        const table = page.locator('.editor-left-slot .editor-table:visible').first();
        await expect(table).toBeVisible();

        // 初期表示でvalue列が降順ソートされているか確認
        const initialValues = await getVisibleColumnValues(table, 2);
        const initialRowNums = await getVisibleRowNumbers(table);
        console.log('初期表示value列:', JSON.stringify(initialValues));
        console.log('初期表示行番号:', JSON.stringify(initialRowNums));

        // value列は降順であるべき（各値は前の値以下）
        for (let i = 1; i < initialValues.length; i++) {
            expect(parseInt(initialValues[i]), `初期value降順エラー: idx=${i}, prev=${initialValues[i-1]}, curr=${initialValues[i]}`).toBeLessThanOrEqual(parseInt(initialValues[i - 1]));
        }

        const scrollContainer = page.locator('.editor-left-pane');

        // 中間付近までスクロール
        await scrollContainer.evaluate((el) => { el.scrollTop = 50 * 21; });
        await page.waitForTimeout(300);

        const midValues = await getVisibleColumnValues(table, 2);
        const midRowNums = await getVisibleRowNumbers(table);
        console.log('中間スクロール後value列:', JSON.stringify(midValues));
        console.log('中間スクロール後行番号:', JSON.stringify(midRowNums));

        // value列は降順を維持すべき
        for (let i = 1; i < midValues.length; i++) {
            expect(parseInt(midValues[i]), `中間value降順エラー: idx=${i}, prev=${midValues[i-1]}, curr=${midValues[i]}`).toBeLessThanOrEqual(parseInt(midValues[i - 1]));
        }
        // 行番号は昇順であるべき
        for (let i = 1; i < midRowNums.length; i++) {
            expect(midRowNums[i], `中間行番号順序エラー: idx=${i}`).toBeGreaterThan(midRowNums[i - 1]);
        }

        // 末尾付近までスクロール
        await scrollContainer.evaluate((el) => { el.scrollTop = 85 * 21; });
        await page.waitForTimeout(300);

        const tailValues = await getVisibleColumnValues(table, 2);
        const tailRowNums = await getVisibleRowNumbers(table);
        console.log('末尾スクロール後value列:', JSON.stringify(tailValues));
        console.log('末尾スクロール後行番号:', JSON.stringify(tailRowNums));

        // value列は降順を維持すべき
        for (let i = 1; i < tailValues.length; i++) {
            expect(parseInt(tailValues[i]), `末尾value降順エラー: idx=${i}, prev=${tailValues[i-1]}, curr=${tailValues[i]}`).toBeLessThanOrEqual(parseInt(tailValues[i - 1]));
        }
    });

    test('少しずつスクロールしてもデータ行が正しい順序を維持する', async ({ page }) => {
        const fs = createUnsortedFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        await page.locator('#explorer .explorer-file').getByText('item', { exact: true }).click();
        const table = page.locator('.editor-left-slot .editor-table:visible').first();
        await expect(table).toBeVisible();

        const scrollContainer = page.locator('.editor-left-pane');

        // 5行ずつ段階的にスクロールダウン→アップの往復で確認
        for (let scrollRow = 0; scrollRow <= 80; scrollRow += 5) {
            await scrollContainer.evaluate((el, row) => { el.scrollTop = row * 21; }, scrollRow);
            await page.waitForTimeout(100);

            const ids = await getVisibleColumnValues(table, 0);
            // IDは昇順であるべき
            for (let i = 1; i < ids.length; i++) {
                expect(parseInt(ids[i]), `scroll=${scrollRow} ID順序エラー: idx=${i}, prev=${ids[i-1]}, curr=${ids[i]}`).toBeGreaterThan(parseInt(ids[i - 1]));
            }
        }

        // スクロールアップ
        for (let scrollRow = 80; scrollRow >= 0; scrollRow -= 5) {
            await scrollContainer.evaluate((el, row) => { el.scrollTop = row * 21; }, scrollRow);
            await page.waitForTimeout(100);

            const ids = await getVisibleColumnValues(table, 0);
            for (let i = 1; i < ids.length; i++) {
                expect(parseInt(ids[i]), `scrollUp=${scrollRow} ID順序エラー: idx=${i}, prev=${ids[i-1]}, curr=${ids[i]}`).toBeGreaterThan(parseInt(ids[i - 1]));
            }
        }
    });

    test('表示中の行DOMのtopがスクロール位置近傍にリベースされる', async ({ page }) => {
        const fs: MockFileSystem = {
            'schema/item.json': JSON.stringify({
                header: [
                    { key: 0, name: 'id', type: 'int' },
                    { key: 1, name: 'name', type: 'string' },
                    { key: 2, name: 'value', type: 'int' },
                ],
                primary_key: ['id'],
            }),
            'data/item.csv': generateCsv(5000),
        };
        await installMockApiAsync(page, fs);
        await page.goto('/');

        await page.locator('#explorer .explorer-file').getByText('item', { exact: true }).click();
        const table = page.locator('.editor-left-slot .editor-table:visible').first();
        await expect(table).toBeVisible();

        const scrollContainer = page.locator('.editor-left-pane');
        await scrollContainer.evaluate((el) => { el.scrollTop = 4000 * 21; });
        await page.waitForTimeout(300);

        const topMetrics = await table.evaluate((tableElement) => {
            const rows = Array.from(tableElement.querySelectorAll<HTMLElement>(
                '.editor-table-grid .editor-table-row:not(.editor-table-empty-row)'
            ));
            const rowTops = rows
                .map(row => Number.parseFloat(row.style.top))
                .filter(top => Number.isFinite(top));
            const grid = tableElement.querySelector<HTMLElement>('.editor-table-grid');
            return {
                count: rowTops.length,
                maxAbsRowTop: Math.max(...rowTops.map(top => Math.abs(top))),
                gridTop: grid === null ? Number.NaN : Number.parseFloat(grid.style.top),
            };
        });

        expect(topMetrics.count).toBeGreaterThan(0);
        expect(topMetrics.maxAbsRowTop).toBeLessThan(5000);
        expect(Math.abs(topMetrics.gridTop)).toBeLessThan(5000);
    });
});
