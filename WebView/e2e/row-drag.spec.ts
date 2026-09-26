import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { readMockFileAsync } from './fixtures/mock-api';

/**
 * エクスプローラーからテーブルを開き、表示完了後にLocatorを返す
 */
async function openTableAsync(page: Page): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText('test').click();
    const table = page.locator('.editor-table');
    await expect(table).toBeVisible();
    return table;
}

/**
 * 仮想スクロールが有効になる行数へテストデータを差し替え、テーブルを開く。
 */
async function openLargeTableAsync(page: Page, rowCount: number, frozenRowCount: number = 0): Promise<Locator> {
    const csv = ['id,name,value'];
    for (let i = 1; i <= rowCount; i++) csv.push(`${i},item_${i},${i * 100}`);
    await page.evaluate(({nextCsv, nextFrozenRowCount}) => {
        const mockWindow = window as unknown as { __mockFs: Record<string, string> };
        mockWindow.__mockFs['data/test.csv'] = nextCsv;
        const schema = JSON.parse(mockWindow.__mockFs['schema/test.json']) as Record<string, unknown>;
        schema.frozenRowCount = nextFrozenRowCount;
        mockWindow.__mockFs['schema/test.json'] = JSON.stringify(schema);
        sessionStorage.setItem('__mockFs', JSON.stringify(mockWindow.__mockFs));
    }, {nextCsv: csv.join('\n'), nextFrozenRowCount: frozenRowCount});
    await page.reload();
    return openTableAsync(page);
}

function rowHeader(table: Locator, rowIndex: number): Locator {
    return table.locator([
        `.editor-table-pane-top-left .editor-table-row-header[data-row-index="${rowIndex}"]`,
        `.editor-table-pane-bottom-left .editor-table-row-header[data-row-index="${rowIndex}"]`,
    ].join(','));
}

async function dragRowHeaderAsync(table: Locator, fromRowIndex: number, toRowIndex: number): Promise<void> {
    const fromBox = await rowHeader(table, fromRowIndex).boundingBox();
    const toBox = await rowHeader(table, toRowIndex).boundingBox();
    if (!fromBox || !toBox) throw new Error('行ヘッダーが表示されていません');
    const page = table.page();
    await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(toBox.x + toBox.width / 2, toBox.y + toBox.height / 2, {steps: 5});
    await expect(page.locator('.row-drag-indicator')).toHaveCount(0);
    expect(await page.evaluate(() => document.body.style.cursor)).not.toBe('grabbing');
    await page.mouse.up();
}

async function expectRowIdsAsync(table: Locator, rowIndices: number[], ids: string[]): Promise<void> {
    for (let i = 0; i < rowIndices.length; i++) {
        const cell = table.locator(`.editor-table-grid .editor-table-row[data-row-index="${rowIndices[i]}"] .editor-table-cell[data-col="0"]`);
        await expect(cell).toHaveText(ids[i]);
    }
}

async function expectSelectedRowsAsync(table: Locator, rowIndices: number[]): Promise<void> {
    for (const rowIndex of rowIndices) {
        await expect(rowHeader(table, rowIndex)).toHaveClass(/selected/);
    }
}

test.describe('行ヘッダーのドラッグ選択', () => {
    for (const selected of [false, true]) {
        test(`${selected ? '選択済み' : '未選択'}行のドラッグは行順を変えず範囲選択する`, async ({page, mockFileSystem}) => {
            const table = await openTableAsync(page);
            if (selected) await rowHeader(table, 2).click();

            await dragRowHeaderAsync(table, 2, 0);

            await expectRowIdsAsync(table, [0, 1, 2], ['1', '2', '3']);
            await expectSelectedRowsAsync(table, [0, 1, 2]);
            await expect(page.locator('.tab-button', {hasText: 'test'}).locator('.tab-button-dirty'))
                .not.toHaveClass(/tab-button-dirty-visible/);

            // 行ドラッグが変更履歴や保存結果を汚さないことも確認する。
            await table.locator('.editor-table-grid .editor-table-row[data-row-index="0"] .editor-table-cell[data-col="0"]').click();
            await page.keyboard.press('Control+z');
            await page.keyboard.press('Control+y');
            await expectRowIdsAsync(table, [0, 1, 2], ['1', '2', '3']);
            await page.keyboard.press('Control+s');
            const savedCsv = await readMockFileAsync(page, 'data/test.csv');
            expect(savedCsv.trimEnd()).toBe(mockFileSystem['data/test.csv'].trimEnd());
        });
    }

    test('仮想スクロール対象の表でも選択済み行のドラッグで範囲選択する', async ({page, mockFileSystem: _mockFileSystem}) => {
        const table = await openLargeTableAsync(page, 120);
        await rowHeader(table, 1).click();
        await dragRowHeaderAsync(table, 1, 3);

        await expectRowIdsAsync(table, [0, 1, 2, 3, 4], ['1', '2', '3', '4', '5']);
        await expectSelectedRowsAsync(table, [1, 2, 3]);
        await expect(rowHeader(table, 0)).not.toHaveClass(/selected/);
        await expect(rowHeader(table, 4)).not.toHaveClass(/selected/);
    });

    test('スクロール後も論理行に沿って範囲選択し行順は変わらない', async ({page, mockFileSystem: _mockFileSystem}) => {
        const table = await openLargeTableAsync(page, 120, 2);
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        await table.locator('.editor-table-main-viewport').evaluate(element => {
            // 操作対象の80〜83行目が固定行の下に隠れない位置までスクロールする。
            element.scrollTop = 76 * 20;
            element.dispatchEvent(new Event('scroll'));
        });
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        await expect(rowHeader(table, 83)).toBeInViewport();
        await rowHeader(table, 80).click();
        await expect(rowHeader(table, 80)).toBeInViewport();
        await expect(rowHeader(table, 83)).toBeInViewport();
        await dragRowHeaderAsync(table, 80, 83);

        await expectRowIdsAsync(table, [79, 80, 81, 82, 83], ['80', '81', '82', '83', '84']);
        await expectSelectedRowsAsync(table, [80, 81, 82, 83]);
    });

    test('固定行からのドラッグも行順を変えず範囲選択する', async ({page, mockFileSystem: _mockFileSystem}) => {
        const table = await openLargeTableAsync(page, 120, 2);
        await rowHeader(table, 0).click();
        await dragRowHeaderAsync(table, 0, 3);

        await expectRowIdsAsync(table, [0, 1, 2, 3, 4], ['1', '2', '3', '4', '5']);
        await expectSelectedRowsAsync(table, [0, 1, 2, 3]);
    });

    test('末尾の空行を含むドラッグでもデータや変更状態は変わらない', async ({page, mockFileSystem: _mockFileSystem}) => {
        const table = await openTableAsync(page);
        await rowHeader(table, 3).click();
        await dragRowHeaderAsync(table, 3, 0);
        await expectSelectedRowsAsync(table, [0, 1, 2, 3]);
        await dragRowHeaderAsync(table, 0, 3);
        await expectSelectedRowsAsync(table, [0, 1, 2, 3]);

        await expectRowIdsAsync(table, [0, 1, 2], ['1', '2', '3']);
        await expect(page.locator('.tab-button', {hasText: 'test'}).locator('.tab-button-dirty'))
            .not.toHaveClass(/tab-button-dirty-visible/);
    });

    test('選択済み行のクリックでその行だけを選択する', async ({page, mockFileSystem: _mockFileSystem}) => {
        const table = await openTableAsync(page);
        await rowHeader(table, 0).click();
        await rowHeader(table, 2).click({modifiers: ['Shift']});
        await expectSelectedRowsAsync(table, [0, 1, 2]);

        await rowHeader(table, 1).click();
        await expect(rowHeader(table, 0)).not.toHaveClass(/selected/);
        await expect(rowHeader(table, 1)).toHaveClass(/selected/);
        await expect(rowHeader(table, 2)).not.toHaveClass(/selected/);
    });

    test('選択済み行にも掴むカーソルを表示しない', async ({page, mockFileSystem: _mockFileSystem}) => {
        const table = await openTableAsync(page);
        await rowHeader(table, 1).click();
        for (const rowIndex of [0, 1, 2]) {
            const cursor = await rowHeader(table, rowIndex).evaluate(element => getComputedStyle(element).cursor);
            expect(['grab', 'grabbing']).not.toContain(cursor);
        }
    });
});
