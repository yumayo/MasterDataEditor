import {test, expect} from './fixtures/test';
import type {Locator, Page} from '@playwright/test';
import type {EditorTable} from '../src/editor/editor-table';
import {installMockApiAsync} from './fixtures/mock-api';

type TestWindow = Window & {
    editor: {activeEditorTable: EditorTable};
    copied: {text: string; html: string} | null;
};

const values = Array.from({length: 8}, (_, row) =>
    Array.from({length: 6}, (_, col) => col === 0 ? String(row + 1) : `r${row + 1}c${col + 1}`));

async function openTable(page: Page, rowCount = 8): Promise<Locator> {
    const names = ['id', 'column_a', 'column_b', 'column_c', 'column_d', 'column_e'];
    const rows = rowCount === 8 ? values : Array.from({length: rowCount}, (_, row) =>
        Array.from({length: 6}, (_, col) => col === 0 ? String(row + 1) : `r${row + 1}c${col + 1}`));
    await installMockApiAsync(page, {
        'schema/items.json': JSON.stringify({
            header: names.map((name, key) => ({key, name, type: 'string'})), primary_key: ['id'],
        }),
        'data/items.csv': [names.join(','), ...rows.map(row => row.join(','))].join('\n'),
    });
    // ブラウザー共通のOSクリップボードを並列テスト間で共有しない。
    // アプリが書き出す text/plain と text/html を両方検証する。
    await page.addInitScript(() => {
        (window as TestWindow).copied = null;
        Object.defineProperty(navigator.clipboard, 'write', {value: async (items: ClipboardItem[]) => {
            (window as TestWindow).copied = {
                text: await (await items[0].getType('text/plain')).text(),
                html: await (await items[0].getType('text/html')).text(),
            };
        }});
    });
    await page.goto('/');
    await page.locator('#explorer').getByText('items', {exact: true}).click();
    const table = page.locator('.editor-left-pane .editor-table');
    await expect(table).toBeVisible();
    return table;
}

function rowHeader(table: Locator, row: number): Locator {
    return table.locator(`.editor-table-detached-row-header-layer .editor-table-row-header[data-row-index="${row}"]`);
}
function columnHeader(table: Locator, col: number): Locator {
    return table.locator(`.editor-table-detached-column-header-layer .editor-table-column-header[data-col="${col}"]`);
}
function cell(table: Locator, row: number, col: number): Locator {
    return table.locator(`.editor-table-grid .editor-table-row[data-row-index="${row}"] .editor-table-cell[data-col="${col}"]`);
}
async function readValues(page: Page): Promise<string[][]> {
    return page.evaluate(() => {
        const table = (window as TestWindow).editor.activeEditorTable;
        return Array.from({length: 8}, (_, row) =>
            Array.from({length: 6}, (_, col) => table.getCellValueAt(row + 1, col + 1)));
    });
}
async function selectedHeaders(table: Locator, axis: 'row' | 'column'): Promise<number[]> {
    return table.locator(`.editor-table-grid .editor-table-${axis}-header.selected`).evaluateAll((headers, axis) =>
        headers.map(header => Number(header.getAttribute(axis === 'row' ? 'data-row-index' : 'data-col'))), axis);
}
async function copy(page: Page): Promise<{text: string; html: string}> {
    await page.evaluate(() => { (window as TestWindow).copied = null; });
    await page.keyboard.press('Control+c');
    await expect.poll(() => page.evaluate(() => (window as TestWindow).copied)).not.toBeNull();
    return page.evaluate(() => (window as TestWindow).copied!);
}
async function paste(page: Page, text: string): Promise<void> {
    await page.evaluate(text => {
        const clipboardData = new DataTransfer();
        clipboardData.setData('text/plain', text);
        document.activeElement!.dispatchEvent(new ClipboardEvent('paste', {clipboardData, bubbles: true, cancelable: true}));
    }, text);
}
async function drag(page: Page, from: Locator, to: Locator): Promise<void> {
    const a = await from.boundingBox();
    const b = await to.boundingBox();
    if (!a || !b) throw new Error('ドラッグ対象が表示されていません');
    await page.keyboard.down('Control');
    await page.mouse.move(a.x + 8, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + 8, b.y + b.height / 2, {steps: 5});
    await page.mouse.up();
    await page.keyboard.up('Control');
}

for (const axis of ['row', 'column'] as const) {
    test(`${axis}: 離れた選択を表の順にコピーし、連続範囲へ貼り付けられる`, async ({page}) => {
        const table = await openTable(page);
        const header = axis === 'row' ? rowHeader : columnHeader;
        await header(table, 2).click();
        await header(table, 0).click({modifiers: ['Control']});
        await expect.poll(() => selectedHeaders(table, axis)).toEqual([0, 2]);
        const gap = cell(table, 1, 1);
        await expect(gap).not.toHaveClass(/sel-bg/);
        await expect(page.locator('.selection-overlay-border')).toHaveCount(2);
        const copied = await copy(page);
        const expected = axis === 'row' ? [values[0], values[2]] : values.map(row => [row[0], row[2]]);
        // 列選択には末尾の入力待機行も含まれるため、実データ部分を検証する。
        expect(copied.text.split('\n').slice(0, expected.length)).toEqual(expected.map(row => row.join('\t')));
        const html = await page.evaluate(html => {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            return [...doc.querySelectorAll('tr')].map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent));
        }, copied.html);
        expect(html.slice(0, expected.length)).toEqual(expected);
        await expect(page.locator('.copy-overlay-border')).toHaveCount(2);
        const destRow = axis === 'row' ? 4 : 0;
        const destCol = axis === 'row' ? 0 : 3;
        await cell(table, destRow, destCol).click();
        await paste(page, copied.text);
        const result = await readValues(page);
        for (let r = 0; r < expected.length; r++) {
            expect(result[destRow + r].slice(destCol, destCol + expected[r].length)).toEqual(expected[r]);
        }
    });

    test(`${axis}: 離れた貼り付け先で隙間を変更せず、Undo/Redoで範囲を復元する`, async ({page}) => {
        const table = await openTable(page);
        const header = axis === 'row' ? rowHeader : columnHeader;
        await header(table, 2).click();
        await header(table, 0).click({modifiers: ['Control']});
        const data = axis === 'row' ? [values[5], values[6]] : values.map(row => [row[4], row[5]]);
        await paste(page, data.map(row => row.join('\t')).join('\n'));
        const expected = values.map(row => [...row]);
        if (axis === 'row') {
            expected[0] = values[5];
            expected[2] = values[6];
        } else {
            for (let row = 0; row < 8; row++) {
                expected[row][0] = values[row][4];
                expected[row][2] = values[row][5];
            }
        }
        expect(await readValues(page)).toEqual(expected);
        await page.keyboard.press('Control+z');
        expect(await readValues(page)).toEqual(values);
        await expect.poll(() => selectedHeaders(table, axis)).toEqual([0, 2]);
        await page.keyboard.press('Control+y');
        expect(await readValues(page)).toEqual(expected);
        await expect.poll(() => selectedHeaders(table, axis)).toEqual([0, 2]);
    });

    test(`${axis}: CtrlドラッグとShiftで追加範囲を拡張し、重複をコピーしない`, async ({page}) => {
        const table = await openTable(page);
        const header = axis === 'row' ? rowHeader : columnHeader;
        await header(table, 0).click();
        await drag(page, header(table, 3), header(table, 4));
        await expect.poll(() => selectedHeaders(table, axis)).toEqual([0, 3, 4]);
        await header(table, 5).click({modifiers: ['Shift']});
        await expect.poll(() => selectedHeaders(table, axis)).toEqual([0, 3, 4, 5]);
        await header(table, 0).click({modifiers: ['Shift']});
        await expect.poll(() => selectedHeaders(table, axis)).toEqual([0, 1, 2, 3]);
        const copied = await copy(page);
        const expected = axis === 'row' ? values.slice(0, 4) : values.map(row => row.slice(0, 4));
        expect(copied.text.split('\n').slice(0, expected.length)).toEqual(expected.map(row => row.join('\t')));
    });

    test(`${axis}: Ctrl/Commandクリックで選択を解除し、通常クリックで単独選択に戻す`, async ({page}) => {
        const table = await openTable(page);
        const header = axis === 'row' ? rowHeader : columnHeader;
        await header(table, 0).click();
        await header(table, 2).click({modifiers: ['Meta']});
        await header(table, 4).click({modifiers: ['Control']});
        await header(table, 2).click({modifiers: ['Control']});
        await expect.poll(() => selectedHeaders(table, axis)).toEqual([0, 4]);
        await header(table, 3).click();
        await expect.poll(() => selectedHeaders(table, axis)).toEqual([3]);
        await cell(table, 1, 1).click();
        await expect(page.locator('.selection-overlay-border')).toHaveCount(1);
    });

    test(`${axis}: Deleteと右クリック削除が未選択の行列を巻き込まない`, async ({page}) => {
        const table = await openTable(page);
        const header = axis === 'row' ? rowHeader : columnHeader;
        await header(table, 0).click();
        await header(table, 2).click({modifiers: ['Control']});
        await page.keyboard.press('Delete');
        const expected = values.map((row, r) => row.map((value, c) => [0, 2].includes(axis === 'row' ? r : c) ? '' : value));
        expect(await readValues(page)).toEqual(expected);
        await page.keyboard.press('Control+z');
        expect(await readValues(page)).toEqual(values);
        await header(table, 0).click({button: 'right'});
        await expect.poll(() => selectedHeaders(table, axis)).toEqual([0, 2]);
        await page.locator('.context-menu.visible').getByText(axis === 'row' ? '2行を削除' : '2列を削除', {exact: true}).click();
        const result = await readValues(page);
        if (axis === 'row') expect(result.slice(0, 2)).toEqual([values[1], values[3]]);
        else expect(result[0].slice(0, 4)).toEqual([values[0][1], ...values[0].slice(3)]);
        await page.keyboard.press('Control+z');
        expect(await readValues(page)).toEqual(values);
    });
}

test('単一値を離れた行へ繰り返し貼り付け、コピー元が変わっても同じ値を貼り付ける', async ({page}) => {
    const table = await openTable(page);
    await cell(table, 0, 1).click();
    const copied = await copy(page);
    await rowHeader(table, 0).click();
    await rowHeader(table, 2).click({modifiers: ['Control']});
    await paste(page, copied.text);
    const expected = values.map((row, r) => [0, 2].includes(r) ? row.map(() => 'r1c2') : row);
    expect(await readValues(page)).toEqual(expected);
    await cell(table, 0, 1).click();
    await paste(page, 'changed');
    await cell(table, 5, 1).click();
    await paste(page, copied.text);
    expect((await readValues(page))[5][1]).toBe('r1c2');
});

test('離れた列を選択したまま仮想スクロールしても隙間に選択が付かない', async ({page}) => {
    const table = await openTable(page, 1000);
    await columnHeader(table, 0).click();
    await columnHeader(table, 2).click({modifiers: ['Control']});
    await expect.poll(() => selectedHeaders(table, 'column')).toEqual([0, 2]);
    await table.locator('.editor-table-main-viewport').evaluate(async element => {
        element.scrollTop = 10000;
        element.dispatchEvent(new Event('scroll'));
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    await expect.poll(() => cell(table, 0, 0).count()).toBe(0);
    await expect.poll(() => table.locator('.editor-table-grid .editor-table-cell[data-col="0"].sel-bg').count()).toBeGreaterThan(0);
    await expect(table.locator('.editor-table-grid .editor-table-cell[data-col="1"].sel-bg')).toHaveCount(0);
    await expect.poll(() => selectedHeaders(table, 'column')).toEqual([0, 2]);
    const copied = await copy(page);
    expect(copied.text.split('\n')[799]).toBe('800\tr800c3');
});


test('離れた行から離れた行へコピーし、Tab/Enterで未選択行を飛ばす', async ({page}) => {
    const table = await openTable(page);
    await rowHeader(table, 0).click();
    await rowHeader(table, 2).click({modifiers: ['Control']});
    const copied = await copy(page);
    await rowHeader(table, 4).click();
    await rowHeader(table, 6).click({modifiers: ['Control']});
    await paste(page, copied.text);
    const expected = values.map(row => [...row]);
    expected[4] = values[0];
    expected[6] = values[2];
    expect(await readValues(page)).toEqual(expected);
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => (window as TestWindow).editor.activeEditorTable.getSelection().getFocus()))
        .toEqual({row: 5, column: 2});
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => (window as TestWindow).editor.activeEditorTable.getSelection().getFocus()))
        .toEqual({row: 5, column: 3});
});

test('空文字も離れた選択先に貼り付けられる', async ({page}) => {
    const table = await openTable(page);
    await rowHeader(table, 0).click();
    await rowHeader(table, 2).click({modifiers: ['Control']});
    await paste(page, '');
    expect(await readValues(page)).toEqual(values.map((row, r) => [0, 2].includes(r) ? row.map(() => '') : row));
});
