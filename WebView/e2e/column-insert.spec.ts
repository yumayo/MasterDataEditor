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
 * 列ヘッダーのテキスト一覧を取得する
 */
async function getColumnHeaderTextsAsync(
    table: Locator,
): Promise<string[]> {
    const selector =
        '.editor-table-column-header-row'
        + ' .editor-table-column-header';
    const headers = table.locator(selector);
    const count = await headers.count();
    const texts: string[] = [];
    for (let i = 0; i < count; ++i) {
        // テキストノードのみ取得
        // （リサイズハンドルを除外）
        const text = await headers.nth(i).evaluate(
            (el: HTMLElement) => {
                for (const node of
                    Array.from(el.childNodes)
                ) {
                    if (node.nodeType === Node.TEXT_NODE) {
                        return node.textContent || '';
                    }
                }
                return '';
            },
        );
        texts.push(text);
    }
    return texts;
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
        .nth(rowIndex);
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
 * 列ヘッダーを右クリックして
 * コンテキストメニューを開く
 */
async function rightClickColumnHeaderAsync(
    table: Locator,
    columnIndex: number,
): Promise<void> {
    const header = table
        .locator('.editor-table-column-header')
        .nth(columnIndex);
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

/**
 * 列ヘッダーの表示テキストをDOM上だけ改竄する
 */
async function tamperColumnHeaderTextAsync(
    table: Locator,
    columnIndex: number,
    text: string,
): Promise<void> {
    await table
        .locator('.editor-table-column-header')
        .nth(columnIndex)
        .evaluate(
            (
                el: HTMLElement,
                nextText: string,
            ) => {
                const nameSpan =
                    el.querySelector(
                        '.column-header-name',
                    );
                if (nameSpan) {
                    nameSpan.textContent = nextText;
                    return;
                }
                for (const node of
                    Array.from(el.childNodes)
                ) {
                    if (node.nodeType === Node.TEXT_NODE) {
                        node.textContent = nextText;
                        return;
                    }
                }
                el.insertBefore(
                    document.createTextNode(nextText),
                    el.firstChild,
                );
            },
            text,
        );
}

/**
 * セルの表示テキストをDOM上だけ改竄する
 */
async function tamperCellTextAsync(
    table: Locator,
    rowIndex: number,
    columnIndex: number,
    text: string,
): Promise<void> {
    const row = table
        .locator('.editor-table-row')
        .nth(rowIndex);
    await row
        .locator(
            '.editor-table-cell'
            + ':not(.editor-table-row-header)',
        )
        .nth(columnIndex)
        .evaluate(
            (
                el: HTMLElement,
                nextText: string,
            ) => {
                el.textContent = nextText;
                el.dataset.rawValue = nextText;
            },
            text,
        );
}

test(
    '列ヘッダーを右クリックして左に列を挿入できること',
    async ({ page, mockFileSystem }) => {
        const table = await openTableAsync(page);

        // 初期状態: id, name, value
        const before =
            await getColumnHeaderTextsAsync(table);
        expect(before).toEqual(
            ['id', 'name', 'value']
        );

        // "name"列（インデックス1）を右クリック
        await rightClickColumnHeaderAsync(table, 1);
        await clickContextMenuItemAsync(page, '左に列を挿入');

        // name の左に空列が挿入される
        const after =
            await getColumnHeaderTextsAsync(table);
        expect(after).toEqual(
            ['id', '', 'name', 'value']
        );
    },
);

test(
    '列ヘッダーを右クリックして右に列を挿入できること',
    async ({ page, mockFileSystem }) => {
        const table = await openTableAsync(page);

        await rightClickColumnHeaderAsync(table, 1);
        await clickContextMenuItemAsync(page, '右に列を挿入');

        const after =
            await getColumnHeaderTextsAsync(table);
        expect(after).toEqual(
            ['id', 'name', '', 'value']
        );
    },
);

test(
    '先頭列の左に列を挿入できること',
    async ({ page, mockFileSystem }) => {
        const table = await openTableAsync(page);

        await rightClickColumnHeaderAsync(table, 0);
        await clickContextMenuItemAsync(page, '左に列を挿入');

        const after =
            await getColumnHeaderTextsAsync(table);
        expect(after).toEqual(
            ['', 'id', 'name', 'value']
        );
    },
);

test(
    '末尾列の右に列を挿入できること',
    async ({ page, mockFileSystem }) => {
        const table = await openTableAsync(page);

        await rightClickColumnHeaderAsync(table, 2);
        await clickContextMenuItemAsync(page, '右に列を挿入');

        const after =
            await getColumnHeaderTextsAsync(table);
        expect(after).toEqual(
            ['id', 'name', 'value', '']
        );
    },
);

test(
    '列挿入後にデータ行にも空セルが追加されること',
    async ({ page, mockFileSystem }) => {
        const table = await openTableAsync(page);

        const beforeRow =
            await getRowCellTextsAsync(table, 0);
        expect(beforeRow.slice(0, 3)).toEqual(
            ['1', 'item_a', '100']
        );

        // "name"列の左に挿入
        await rightClickColumnHeaderAsync(table, 1);
        await clickContextMenuItemAsync(page, '左に列を挿入');

        // データ行にも空セルが挿入される
        const afterRow =
            await getRowCellTextsAsync(table, 0);
        expect(afterRow.slice(0, 4)).toEqual(
            ['1', '', 'item_a', '100']
        );
    },
);

test(
    '列挿入をUndoで元に戻せること',
    async ({ page, mockFileSystem }) => {
        const table = await openTableAsync(page);

        await rightClickColumnHeaderAsync(table, 1);
        await clickContextMenuItemAsync(page, '左に列を挿入');

        const afterInsert =
            await getColumnHeaderTextsAsync(table);
        expect(afterInsert).toEqual(
            ['id', '', 'name', 'value']
        );

        // セルをクリックしてフォーカスを確保
        await clickFirstCellAsync(table);

        await page.keyboard.press('Control+z');

        const afterUndo =
            await getColumnHeaderTextsAsync(table);
        expect(afterUndo).toEqual(
            ['id', 'name', 'value']
        );
    },
);

test(
    '列挿入のUndoをRedoで再実行できること',
    async ({ page, mockFileSystem }) => {
        const table = await openTableAsync(page);

        await rightClickColumnHeaderAsync(table, 1);
        await clickContextMenuItemAsync(page, '左に列を挿入');

        // セルをクリックしてフォーカスを確保
        await clickFirstCellAsync(table);

        // Undo
        await page.keyboard.press('Control+z');
        const afterUndo =
            await getColumnHeaderTextsAsync(table);
        expect(afterUndo).toEqual(
            ['id', 'name', 'value']
        );

        // Redo
        await page.keyboard.press('Control+y');
        const afterRedo =
            await getColumnHeaderTextsAsync(table);
        expect(afterRedo).toEqual(
            ['id', '', 'name', 'value']
        );
    },
);

test(
    '連続して複数回列を挿入できること',
    async ({ page, mockFileSystem }) => {
        const table = await openTableAsync(page);

        // 1回目: id の右に挿入
        await rightClickColumnHeaderAsync(table, 0);
        await clickContextMenuItemAsync(page, '右に列を挿入');

        const after1 =
            await getColumnHeaderTextsAsync(table);
        expect(after1).toEqual(
            ['id', '', 'name', 'value']
        );

        // 2回目: value の右に挿入
        // value はインデックス3に移動している
        await rightClickColumnHeaderAsync(table, 3);
        await clickContextMenuItemAsync(page, '右に列を挿入');

        const after2 =
            await getColumnHeaderTextsAsync(table);
        expect(after2).toEqual(
            ['id', '', 'name', 'value', '']
        );
    },
);

test(
    'DOM表示が改竄されていても列削除のUndoは内部SSOTから正しく復元すること',
    async ({ page, mockFileSystem }) => {
        const table = await openTableAsync(page);

        await tamperColumnHeaderTextAsync(
            table,
            1,
            'bogus',
        );
        await tamperCellTextAsync(
            table,
            0,
            1,
            'tampered',
        );

        const tamperedHeaders =
            await getColumnHeaderTextsAsync(table);
        expect(tamperedHeaders).toEqual(
            ['id', 'bogus', 'value']
        );
        const tamperedRow =
            await getRowCellTextsAsync(table, 0);
        expect(tamperedRow.slice(0, 3)).toEqual(
            ['1', 'tampered', '100']
        );

        await rightClickColumnHeaderAsync(table, 1);
        await clickContextMenuItemAsync(page, '列を削除');

        const afterDelete =
            await getColumnHeaderTextsAsync(table);
        expect(afterDelete).toEqual(
            ['id', 'value']
        );

        await clickFirstCellAsync(table);
        await page.keyboard.press('Control+z');

        const afterUndoHeaders =
            await getColumnHeaderTextsAsync(table);
        expect(afterUndoHeaders).toEqual(
            ['id', 'name', 'value']
        );
        const afterUndoRow =
            await getRowCellTextsAsync(table, 0);
        expect(afterUndoRow.slice(0, 3)).toEqual(
            ['1', 'item_a', '100']
        );
    },
);
