import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';

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
 * 先頭N行のデータセル値を取得する（行ヘッダーを除く全列）
 * rowIndex: 0始まり（ヘッダー行を除く）
 */
async function getRowCellTextsAsync(table: Locator, rowIndex: number): Promise<string[]> {
    const row = table.locator('.editor-table-row').nth(rowIndex + 1);
    const cells = row.locator('.editor-table-cell:not(.editor-table-row-header)');
    const count = await cells.count();
    const texts: string[] = [];
    for (let i = 0; i < count; ++i) {
        texts.push(await cells.nth(i).innerText());
    }
    return texts;
}

/**
 * 先頭N行のID列（1列目）の値を取得する
 */
async function getRowIdValuesAsync(table: Locator, count: number): Promise<string[]> {
    const values: string[] = [];
    for (let i = 0; i < count; ++i) {
        const row = table.locator('.editor-table-row').nth(i + 1);
        const firstCell = row.locator('.editor-table-cell:not(.editor-table-row-header)').first();
        values.push(await firstCell.innerText());
    }
    return values;
}

/**
 * 行ヘッダーをドラッグして行を移動する
 * fromRowIndex, toRowIndex: 0始まり（ヘッダー行を除くデータ行のインデックス）
 * toRowIndex の行の上端にドロップする（その位置に挿入される）
 */
async function dragRowAsync(table: Locator, fromRowIndex: number, toRowIndex: number): Promise<void> {
    // ドラッグ元の行ヘッダー
    const fromHeader = table.locator('.editor-table-row-header').nth(fromRowIndex);
    const fromBox = await fromHeader.boundingBox();
    if (!fromBox) throw new Error('fromHeader bounding box is null');
    const startX = fromBox.x + fromBox.width / 2;
    const startY = fromBox.y + fromBox.height / 2;

    // ドロップ先の行ヘッダー
    const toHeader = table.locator('.editor-table-row-header').nth(toRowIndex);
    const toBox = await toHeader.boundingBox();
    if (!toBox) throw new Error('toHeader bounding box is null');
    const endX = toBox.x + toBox.width / 2;
    // 行の上端（上半分）にドロップすることで「この行の上に挿入」を示す
    const endY = toBox.y + 2;

    // mousedown → 5px以上移動 → mouseup
    await fromHeader.page().mouse.move(startX, startY);
    await fromHeader.page().mouse.down();
    // 最初に少し移動して5px閾値を超える
    await fromHeader.page().mouse.move(startX, startY - 6);
    // 目的位置まで移動
    await fromHeader.page().mouse.move(endX, endY);
    await fromHeader.page().mouse.up();
}

/**
 * テーブルの最初のデータセルをクリックしてキーボードフォーカスを確保する
 */
async function clickFirstCellAsync(table: Locator): Promise<void> {
    await table.locator('.editor-table-row:nth-child(2) .editor-table-cell:nth-child(2)').click();
}

test.describe('行ドラッグ移動', () => {
    test('行ヘッダーをドラッグして行を移動できる', async ({ page, mockFileSystem }) => {
        const table = await openTableAsync(page);

        // 初期状態: 3行 (1,item_a,100), (2,item_b,200), (3,item_c,300)
        const before = await getRowIdValuesAsync(table, 3);
        expect(before).toEqual(['1', '2', '3']);

        // 3行目（index=2）を1行目（index=0）の位置にドラッグ
        await dragRowAsync(table, 2, 0);

        // 3行目が先頭に移動: (3,item_c,300), (1,item_a,100), (2,item_b,200)
        const afterRow0 = await getRowCellTextsAsync(table, 0);
        expect(afterRow0).toEqual(['3', 'item_c', '300']);
        const afterRow1 = await getRowCellTextsAsync(table, 1);
        expect(afterRow1).toEqual(['1', 'item_a', '100']);
        const afterRow2 = await getRowCellTextsAsync(table, 2);
        expect(afterRow2).toEqual(['2', 'item_b', '200']);
    });

    test('行移動後にCtrl+Zでundo可能', async ({ page, mockFileSystem }) => {
        const table = await openTableAsync(page);

        // 3行目を1行目の位置にドラッグ
        await dragRowAsync(table, 2, 0);

        // 移動後: 3, 1, 2
        const afterMove = await getRowIdValuesAsync(table, 3);
        expect(afterMove).toEqual(['3', '1', '2']);

        // セルをクリックしてフォーカスを確保
        await clickFirstCellAsync(table);

        // Undo
        await page.keyboard.press('Control+z');

        // 元に戻る: 1, 2, 3
        const afterUndo = await getRowIdValuesAsync(table, 3);
        expect(afterUndo).toEqual(['1', '2', '3']);
    });

    test('移動中にインジケーターが表示される', async ({ page, mockFileSystem }) => {
        const table = await openTableAsync(page);

        // ドラッグ元の行ヘッダー（3行目）
        const fromHeader = table.locator('.editor-table-row-header').nth(2);
        const fromBox = await fromHeader.boundingBox();
        if (!fromBox) throw new Error('bounding box is null');
        const startX = fromBox.x + fromBox.width / 2;
        const startY = fromBox.y + fromBox.height / 2;

        // mousedown して5px以上移動するとドラッグ開始
        await page.mouse.move(startX, startY);
        await page.mouse.down();
        await page.mouse.move(startX, startY - 10);

        // インジケーターが表示されていることを確認
        const indicator = page.locator('.row-drag-indicator');
        await expect(indicator).toBeVisible();

        // マウスを離すとインジケーターが消える
        await page.mouse.up();
        await expect(indicator).not.toBeVisible();
    });

    test('行移動後にCtrl+Sで保存するとCSVに反映される', async ({ page, mockFileSystem }) => {
        const table = await openTableAsync(page);

        // 3行目を1行目の位置にドラッグ
        await dragRowAsync(table, 2, 0);

        // セルをクリックしてフォーカスを確保してから保存
        await clickFirstCellAsync(table);
        await page.keyboard.press('Control+s');

        // CSVの内容を検証
        const csv = await page.evaluate(() => {
            return (window as unknown as { __mockFs: Record<string, string> }).__mockFs['data/test.csv'];
        });
        const lines = csv.split('\n').filter((l: string) => l.trim() !== '');
        expect(lines).toEqual([
            'id,name,value',
            '3,item_c,300',
            '1,item_a,100',
            '2,item_b,200',
        ]);
    });

    test('Undo後にRedoで行移動を再実行できる', async ({ page, mockFileSystem }) => {
        const table = await openTableAsync(page);

        // 3行目を1行目の位置にドラッグ
        await dragRowAsync(table, 2, 0);

        // セルをクリックしてフォーカスを確保
        await clickFirstCellAsync(table);

        // Undo
        await page.keyboard.press('Control+z');
        const afterUndo = await getRowIdValuesAsync(table, 3);
        expect(afterUndo).toEqual(['1', '2', '3']);

        // Redo
        await page.keyboard.press('Control+y');
        const afterRedo = await getRowIdValuesAsync(table, 3);
        expect(afterRedo).toEqual(['3', '1', '2']);
    });
});
