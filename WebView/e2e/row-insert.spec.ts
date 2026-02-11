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
 * 先頭N行のID列（1列目）の値を取得する
 * 列ヘッダーテキスト配列と同様に行構造を確認するため
 */
async function getRowIdValuesAsync(
    table: Locator,
    count: number,
): Promise<string[]> {
    const values: string[] = [];
    for (let i = 0; i < count; ++i) {
        const row = table
            .locator('.editor-table-row')
            .nth(i + 1);
        const firstCell = row.locator(
            '.editor-table-cell'
            + ':not(.editor-table-row-header)',
        ).first();
        values.push(await firstCell.innerText());
    }
    return values;
}

/**
 * 指定された行のセルテキスト一覧を取得する
 * rowIndex: 0始まり（ヘッダー行を除く）
 */
async function getRowCellTextsAsync(
    table: Locator,
    rowIndex: number,
): Promise<string[]> {
    const row = table
        .locator('.editor-table-row')
        .nth(rowIndex + 1);
    const selector =
        '.editor-table-cell'
        + ':not(.editor-table-row-header)';
    const cells = row.locator(selector);
    const count = await cells.count();
    const texts: string[] = [];
    for (let i = 0; i < count; ++i) {
        texts.push(await cells.nth(i).innerText());
    }
    return texts;
}

/**
 * 行ヘッダーを右クリックして
 * コンテキストメニューを開く
 */
async function rightClickRowHeaderAsync(
    table: Locator,
    rowIndex: number,
): Promise<void> {
    const header = table
        .locator('.editor-table-row-header')
        .nth(rowIndex);
    await header.click({ button: 'right' });
}

/**
 * コンテキストメニューの項目をクリックする
 */
async function clickContextMenuItemAsync(
    page: Page,
    label: string,
): Promise<void> {
    const menu = page.locator('.context-menu.visible');
    await expect(menu).toBeVisible();
    await menu.locator(
        '.context-menu-item', { hasText: label },
    ).click();
}

/**
 * テーブルの最初のデータセルをクリックして
 * キーボードイベントのフォーカスを確保する
 */
async function clickFirstCellAsync(
    table: Locator,
): Promise<void> {
    const selector =
        '.editor-table-row:nth-child(2)'
        + ' .editor-table-cell:nth-child(2)';
    await table.locator(selector).click();
}

test(
    '行ヘッダーを右クリックして上に行を挿入できること',
    async ({ page, mockFileSystem }) => {
        const table = await openTableAsync(page);

        // 初期状態: id列が 1, 2, 3
        const before =
            await getRowIdValuesAsync(table, 3);
        expect(before).toEqual(['1', '2', '3']);

        // 2行目（インデックス1）を右クリック
        await rightClickRowHeaderAsync(table, 1);
        await clickContextMenuItemAsync(
            page, '上に行を挿入'
        );

        // 2行目の位置に空行が挿入される
        const after =
            await getRowIdValuesAsync(table, 4);
        expect(after).toEqual(
            ['1', '', '2', '3']
        );
    },
);

test(
    '行ヘッダーを右クリックして下に行を挿入できること',
    async ({ page, mockFileSystem }) => {
        const table = await openTableAsync(page);

        // 2行目（インデックス1）を右クリック
        await rightClickRowHeaderAsync(table, 1);
        await clickContextMenuItemAsync(
            page, '下に行を挿入'
        );

        // 2行目の下に空行が挿入される
        const after =
            await getRowIdValuesAsync(table, 4);
        expect(after).toEqual(
            ['1', '2', '', '3']
        );
    },
);

test(
    '先頭行の上に行を挿入できること',
    async ({ page, mockFileSystem }) => {
        const table = await openTableAsync(page);

        // 1行目（インデックス0）を右クリック
        await rightClickRowHeaderAsync(table, 0);
        await clickContextMenuItemAsync(
            page, '上に行を挿入'
        );

        const after =
            await getRowIdValuesAsync(table, 4);
        expect(after).toEqual(
            ['', '1', '2', '3']
        );
    },
);

test(
    '末尾行の下に行を挿入できること',
    async ({ page, mockFileSystem }) => {
        const table = await openTableAsync(page);

        // 3行目（インデックス2、末尾データ行）を右クリック
        await rightClickRowHeaderAsync(table, 2);
        await clickContextMenuItemAsync(
            page, '下に行を挿入'
        );

        const after =
            await getRowIdValuesAsync(table, 4);
        expect(after).toEqual(
            ['1', '2', '3', '']
        );
    },
);

test(
    '行挿入後に全列に空セルが追加されること',
    async ({ page, mockFileSystem }) => {
        const table = await openTableAsync(page);

        // 初期データの確認
        const beforeRow0 =
            await getRowCellTextsAsync(table, 0);
        expect(beforeRow0).toEqual(
            ['1', 'item_a', '100']
        );

        // 1行目の上に挿入
        await rightClickRowHeaderAsync(table, 0);
        await clickContextMenuItemAsync(
            page, '上に行を挿入'
        );

        // 挿入された行の全セルが空
        const insertedRow =
            await getRowCellTextsAsync(table, 0);
        expect(insertedRow).toEqual(['', '', '']);

        // 全データ行が正しい位置に移動
        const row1 =
            await getRowCellTextsAsync(table, 1);
        expect(row1).toEqual(
            ['1', 'item_a', '100']
        );

        const row2 =
            await getRowCellTextsAsync(table, 2);
        expect(row2).toEqual(
            ['2', 'item_b', '200']
        );

        const row3 =
            await getRowCellTextsAsync(table, 3);
        expect(row3).toEqual(
            ['3', 'item_c', '300']
        );
    },
);

test(
    '行挿入をUndoで元に戻せること',
    async ({ page, mockFileSystem }) => {
        const table = await openTableAsync(page);

        await rightClickRowHeaderAsync(table, 1);
        await clickContextMenuItemAsync(
            page, '上に行を挿入'
        );

        const afterInsert =
            await getRowIdValuesAsync(table, 4);
        expect(afterInsert).toEqual(
            ['1', '', '2', '3']
        );

        // セルをクリックしてフォーカスを確保
        await clickFirstCellAsync(table);

        await page.keyboard.press('Control+z');

        const afterUndo =
            await getRowIdValuesAsync(table, 3);
        expect(afterUndo).toEqual(
            ['1', '2', '3']
        );
    },
);

test(
    '行挿入のUndoをRedoで再実行できること',
    async ({ page, mockFileSystem }) => {
        const table = await openTableAsync(page);

        await rightClickRowHeaderAsync(table, 1);
        await clickContextMenuItemAsync(
            page, '上に行を挿入'
        );

        // セルをクリックしてフォーカスを確保
        await clickFirstCellAsync(table);

        // Undo
        await page.keyboard.press('Control+z');
        const afterUndo =
            await getRowIdValuesAsync(table, 3);
        expect(afterUndo).toEqual(
            ['1', '2', '3']
        );

        // Redo
        await page.keyboard.press('Control+y');
        const afterRedo =
            await getRowIdValuesAsync(table, 4);
        expect(afterRedo).toEqual(
            ['1', '', '2', '3']
        );
    },
);

test(
    '連続して複数回行を挿入できること',
    async ({ page, mockFileSystem }) => {
        const table = await openTableAsync(page);

        // 1回目: 1行目の下に挿入
        await rightClickRowHeaderAsync(table, 0);
        await clickContextMenuItemAsync(
            page, '下に行を挿入'
        );

        const after1 =
            await getRowIdValuesAsync(table, 4);
        expect(after1).toEqual(
            ['1', '', '2', '3']
        );

        // 2回目: 3行目（元の末尾データ、
        // インデックス3に移動済み）の下に挿入
        await rightClickRowHeaderAsync(table, 3);
        await clickContextMenuItemAsync(
            page, '下に行を挿入'
        );

        const after2 =
            await getRowIdValuesAsync(table, 5);
        expect(after2).toEqual(
            ['1', '', '2', '3', '']
        );
    },
);
