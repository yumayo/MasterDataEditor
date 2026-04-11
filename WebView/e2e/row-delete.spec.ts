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
    // 仮想スクロール有効テーブルでは children[1] が topSpacer のため nth-child(3) が最初のデータ行
    const selector =
        '.editor-table-row:nth-child(3)'
        + ' .editor-table-cell:nth-child(2)';
    await table.locator(selector).click();
}

test(
    '行ヘッダーを右クリックして行を削除できること',
    async ({ page, mockFileSystem }) => {
        const table = await openTableAsync(page);

        // 初期状態: id列が 1, 2, 3
        const before =
            await getRowIdValuesAsync(table, 3);
        expect(before).toEqual(['1', '2', '3']);

        // 2行目（インデックス1）を右クリック
        await rightClickRowHeaderAsync(table, 1);
        await clickContextMenuItemAsync(
            page, '行を削除'
        );

        // 2行目が削除され、1, 3 になる
        const after =
            await getRowIdValuesAsync(table, 2);
        expect(after).toEqual(['1', '3']);
    },
);

test(
    '先頭行を削除できること',
    async ({ page, mockFileSystem }) => {
        const table = await openTableAsync(page);

        await rightClickRowHeaderAsync(table, 0);
        await clickContextMenuItemAsync(
            page, '行を削除'
        );

        const after =
            await getRowIdValuesAsync(table, 2);
        expect(after).toEqual(['2', '3']);
    },
);

test(
    '末尾行を削除できること',
    async ({ page, mockFileSystem }) => {
        const table = await openTableAsync(page);

        await rightClickRowHeaderAsync(table, 2);
        await clickContextMenuItemAsync(
            page, '行を削除'
        );

        const after =
            await getRowIdValuesAsync(table, 2);
        expect(after).toEqual(['1', '2']);
    },
);

test(
    '行削除をUndoで元に戻せること',
    async ({ page, mockFileSystem }) => {
        const table = await openTableAsync(page);

        await rightClickRowHeaderAsync(table, 1);
        await clickContextMenuItemAsync(
            page, '行を削除'
        );

        const afterDelete =
            await getRowIdValuesAsync(table, 2);
        expect(afterDelete).toEqual(['1', '3']);

        // セルをクリックしてフォーカスを確保
        await clickFirstCellAsync(table);

        await page.keyboard.press('Control+z');

        // データが完全に復元される
        const afterUndo =
            await getRowIdValuesAsync(table, 3);
        expect(afterUndo).toEqual(['1', '2', '3']);

        // 復元された行の全セル値を確認
        const restoredRow =
            await getRowCellTextsAsync(table, 1);
        expect(restoredRow).toEqual(
            ['2', 'item_b', '200']
        );
    },
);

test(
    '行削除のUndoをRedoで再実行できること',
    async ({ page, mockFileSystem }) => {
        const table = await openTableAsync(page);

        await rightClickRowHeaderAsync(table, 1);
        await clickContextMenuItemAsync(
            page, '行を削除'
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
            await getRowIdValuesAsync(table, 2);
        expect(afterRedo).toEqual(['1', '3']);
    },
);

test(
    '連続して複数回行を削除できること',
    async ({ page, mockFileSystem }) => {
        const table = await openTableAsync(page);

        // 1回目: 3行目（末尾）を削除
        await rightClickRowHeaderAsync(table, 2);
        await clickContextMenuItemAsync(
            page, '行を削除'
        );

        const after1 =
            await getRowIdValuesAsync(table, 2);
        expect(after1).toEqual(['1', '2']);

        // 2回目: 1行目（先頭）を削除
        await rightClickRowHeaderAsync(table, 0);
        await clickContextMenuItemAsync(
            page, '行を削除'
        );

        const after2 =
            await getRowIdValuesAsync(table, 1);
        expect(after2).toEqual(['2']);
    },
);
