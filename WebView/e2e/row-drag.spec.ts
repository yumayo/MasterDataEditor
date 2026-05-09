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
    const row = table.locator('.editor-table-row').nth(rowIndex);
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
        const row = table.locator('.editor-table-row').nth(i);
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
    await table
        .locator('.editor-table-row')
        .first()
        .locator('.editor-table-cell:not(.editor-table-row-header)')
        .first()
        .click();
}

/**
 * 指定した行ヘッダーをクリックして行全体を選択する
 * rowIndex: 0始まり（ヘッダー行を除くデータ行のインデックス）
 */
async function selectRowAsync(table: Locator, rowIndex: number): Promise<void> {
    const header = table.locator('.editor-table-row-header').nth(rowIndex);
    await header.click();
}

/**
 * 指定した行ヘッダーが選択状態かどうかを返す
 * rowIndex: 0始まり（ヘッダー行を除くデータ行のインデックス）
 */
async function isRowSelectedAsync(table: Locator, rowIndex: number): Promise<boolean> {
    const header = table.locator('.editor-table-row-header').nth(rowIndex);
    return header.evaluate(el => el.classList.contains('selected'));
}

/**
 * 行ヘッダーをmousedownして、閾値を超えてドラッグし、指定行位置でmouseupする
 * selectRow を呼ばずにドラッグだけ行う（未選択状態からのドラッグを再現するため）
 * fromRowIndex, toRowIndex: 0始まり（ヘッダー行を除くデータ行のインデックス）
 */
async function dragRowHeaderWithoutSelectAsync(page: Page, table: Locator, fromRowIndex: number, toRowIndex: number): Promise<void> {
    const fromHeader = table.locator('.editor-table-row-header').nth(fromRowIndex);
    const fromBox = await fromHeader.boundingBox();
    if (!fromBox) throw new Error('fromHeader bounding box is null');
    const startX = fromBox.x + fromBox.width / 2;
    const startY = fromBox.y + fromBox.height / 2;

    const toHeader = table.locator('.editor-table-row-header').nth(toRowIndex);
    const toBox = await toHeader.boundingBox();
    if (!toBox) throw new Error('toHeader bounding box is null');
    const endX = toBox.x + toBox.width / 2;
    const endY = toBox.y + toBox.height / 2;

    // mousedown → 閾値超え → 各行を通過 → mouseup
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // 5px閾値を超えるために少し移動
    const direction = toRowIndex > fromRowIndex ? 1 : -1;
    await page.mouse.move(startX, startY + direction * 6);
    // 目的行まで移動
    await page.mouse.move(endX, endY);
    await page.mouse.up();
}

test.describe('行ドラッグ移動', () => {
    test('行ヘッダーをドラッグして行を移動できる', async ({ page, mockFileSystem }) => {
        const table = await openTableAsync(page);

        // 初期状態: 3行 (1,item_a,100), (2,item_b,200), (3,item_c,300)
        const before = await getRowIdValuesAsync(table, 3);
        expect(before).toEqual(['1', '2', '3']);

        // 3行目（index=2）を選択してからドラッグ移動する（選択済み行のみ行移動が可能）
        await selectRowAsync(table, 2);
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

        // 3行目を選択してからドラッグ移動する
        await selectRowAsync(table, 2);
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

        // 3行目を選択してからドラッグする（選択済み行のみインジケーターが表示される）
        await selectRowAsync(table, 2);

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

        // 3行目を選択してからドラッグ移動する
        await selectRowAsync(table, 2);
        await dragRowAsync(table, 2, 0);

        // セルをクリックしてフォーカスを確保してから保存
        await clickFirstCellAsync(table);

        // Dirtyマークが付いていることを確認（行移動コマンドの実行確認）
        const tabButton = page.locator('.tab-button', { hasText: 'test' });
        const dirtyIndicator = tabButton.locator('.tab-button-dirty');
        await expect(dirtyIndicator).toHaveClass(/tab-button-dirty-visible/);

        await page.keyboard.press('Control+s');

        // 保存は fire-and-forget の非同期処理のため、Dirtyマーク消去を保存完了のシグナルとして待機する
        await expect(dirtyIndicator).not.toHaveClass(/tab-button-dirty-visible/);

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

    test('行移動後に移動先の行が選択状態になる', async ({ page, mockFileSystem }) => {
        const table = await openTableAsync(page);

        // 3行目（index=2）を選択してから先頭（index=0）にドラッグ移動する
        await selectRowAsync(table, 2);
        await dragRowAsync(table, 2, 0);

        // 移動後: 3, 1, 2 → 移動先は先頭（index=0）なので先頭行ヘッダーが選択状態になる
        expect(await isRowSelectedAsync(table, 0)).toBe(true);
        // 移動元の位置（元の3行目、現在はindex=2）は選択されていない
        expect(await isRowSelectedAsync(table, 2)).toBe(false);
    });

    test('Undo後にRedoで行移動を再実行できる', async ({ page, mockFileSystem }) => {
        const table = await openTableAsync(page);

        // 3行目を選択してからドラッグ移動する
        await selectRowAsync(table, 2);
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

test.describe('行ドラッグ操作の分離（選択済み行 vs 未選択行）', () => {
    test('未選択行のドラッグで複数行選択される（行移動は発生しない）', async ({ page, mockFileSystem }) => {
        const table = await openTableAsync(page);

        // 初期状態: 3行 (1,item_a,100), (2,item_b,200), (3,item_c,300)
        const before = await getRowIdValuesAsync(table, 3);
        expect(before).toEqual(['1', '2', '3']);

        // 何も選択していない状態から、3行目（index=2）のヘッダーをmousedown
        // → 5行目方向にドラッグ（テスト用テーブルは3行なので3行目まで）
        // 3行目からのドラッグなので、通過した行（1行目、2行目を跨ぐ場合含む）が選択される
        // ここでは3行目から1行目方向へドラッグして3〜1行目を範囲選択する
        await dragRowHeaderWithoutSelectAsync(page, table, 2, 0);

        // 行の並びは変わっていないこと（行移動が発生していない）
        const after = await getRowIdValuesAsync(table, 3);
        expect(after).toEqual(['1', '2', '3']);

        // 1〜3行目の行ヘッダーがすべて選択状態であること
        expect(await isRowSelectedAsync(table, 0)).toBe(true);
        expect(await isRowSelectedAsync(table, 1)).toBe(true);
        expect(await isRowSelectedAsync(table, 2)).toBe(true);
    });

    test('選択済み行のドラッグで行移動が発生する', async ({ page, mockFileSystem }) => {
        const table = await openTableAsync(page);

        // 初期状態: 3行
        const before = await getRowIdValuesAsync(table, 3);
        expect(before).toEqual(['1', '2', '3']);

        // まず3行目（index=2）を選択する
        await selectRowAsync(table, 2);
        expect(await isRowSelectedAsync(table, 2)).toBe(true);

        // 選択済みの3行目のヘッダーをドラッグして1行目（index=0）の位置に移動
        await dragRowAsync(table, 2, 0);

        // 行の並びが変わること: 3, 1, 2
        const after = await getRowIdValuesAsync(table, 3);
        expect(after).toEqual(['3', '1', '2']);
    });

    test('未選択行のドラッグでは行移動が発生しない', async ({ page, mockFileSystem }) => {
        const table = await openTableAsync(page);

        // 初期状態: 3行
        const before = await getRowIdValuesAsync(table, 3);
        expect(before).toEqual(['1', '2', '3']);

        // 何も選択していない状態で、2行目（index=1）のヘッダーを1行目（index=0）位置にドラッグ
        // 現在の実装ではこれで行移動が発生してしまう（RED状態になる）
        await dragRowHeaderWithoutSelectAsync(page, table, 1, 0);

        // 行の並びが変わっていないこと（ドラッグ移動ではなく選択のみ行われる）
        const after = await getRowIdValuesAsync(table, 3);
        expect(after).toEqual(['1', '2', '3']);
    });

    test('選択済み行のクリック（移動なしmouseup）で単独選択になる', async ({ page, mockFileSystem }) => {
        const table = await openTableAsync(page);

        // まず1〜3行目を選択する（1行目をクリック → Shiftクリックで3行目まで拡張）
        await selectRowAsync(table, 0);
        const thirdHeader = table.locator('.editor-table-row-header').nth(2);
        await thirdHeader.click({ modifiers: ['Shift'] });

        // 1〜3行目がすべて選択されていること
        expect(await isRowSelectedAsync(table, 0)).toBe(true);
        expect(await isRowSelectedAsync(table, 1)).toBe(true);
        expect(await isRowSelectedAsync(table, 2)).toBe(true);

        // 選択済みの2行目（index=1）をクリック（mousedown→移動なし→mouseup）
        await selectRowAsync(table, 1);

        // 2行目のみが選択された状態になること
        expect(await isRowSelectedAsync(table, 0)).toBe(false);
        expect(await isRowSelectedAsync(table, 1)).toBe(true);
        expect(await isRowSelectedAsync(table, 2)).toBe(false);
    });

    test('選択済み行ヘッダーのカーソルがgrab、未選択行はgrabでない', async ({ page, mockFileSystem }) => {
        const table = await openTableAsync(page);

        // 2行目（index=1）を選択する
        await selectRowAsync(table, 1);

        // 選択済みの2行目の行ヘッダーはcursorがgrabであること
        const selectedHeader = table.locator('.editor-table-row-header').nth(1);
        const selectedCursor = await selectedHeader.evaluate(el => window.getComputedStyle(el).cursor);
        expect(selectedCursor).toBe('grab');

        // 未選択の1行目（index=0）の行ヘッダーはcursorがgrabでないこと
        const unselectedHeader = table.locator('.editor-table-row-header').nth(0);
        const unselectedCursor = await unselectedHeader.evaluate(el => window.getComputedStyle(el).cursor);
        expect(unselectedCursor).not.toBe('grab');

        // 未選択の3行目（index=2）も同様にgrabでないこと
        const anotherUnselectedHeader = table.locator('.editor-table-row-header').nth(2);
        const anotherCursor = await anotherUnselectedHeader.evaluate(el => window.getComputedStyle(el).cursor);
        expect(anotherCursor).not.toBe('grab');
    });
});
