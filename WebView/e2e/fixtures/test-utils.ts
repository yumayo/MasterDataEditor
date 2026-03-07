import { Locator, Page, expect } from '@playwright/test';
import { readMockFileAsync } from './mock-api';

/**
 * 指定した行・列のデータセルを返す
 * rowIndex: 0始まり（ヘッダー行を除く）, colIndex: 0始まり（行ヘッダーを除く）
 */
export function getDataCell(table: Locator, rowIndex: number, colIndex: number): Locator {
    const row = table.locator('.editor-table-row').nth(rowIndex + 1);
    return row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
}

/**
 * テーブルのデータ行をCSV文字列で一括検証する
 *
 * 使用例:
 *   await expectTableDataAsync(table, `
 *       1, WeaponShop, 1, 1, Sword
 *       ,           ,  , 2, Shield
 *       2, ItemShop,  2, 3, Potion
 *   `);
 *
 * 各セル値は前後の空白をtrimして比較する。
 * 空セルはカンマ間を空にする（例: ",,"）。
 * 指定した行数分だけ検証し、それ以降の行は検証しない。
 * セル内のトグル・参照ヒント等の装飾要素は除外してデータ値のみ比較する。
 *
 * セル値読み取りロジック（プロダクションコードのreadCellValue/view-group-query.tsと同一）:
 * .cell-value要素があればその内容、特殊要素がある場合はテキストノードのみ結合、それ以外はtextContent全体。
 */
/**
 * 保存されたCSVファイルの内容を一括検証する
 *
 * 使用例:
 *   await expectCsvAsync(page, 'data/shop_product.csv', `
 *       id, group_id, item
 *       1,  1,        Sword
 *       2,  1,        Shield
 *       3,  2,        Potion
 *   `);
 *
 * 各セル値は前後の空白をtrimして比較する。
 * 行数が一致しない場合もエラーとなる。
 */
export async function expectCsvAsync(page: Page, filePath: string, expectedCsv: string): Promise<void> {
    const csv = await readMockFileAsync(page, filePath);
    const actualLines = csv.split('\n').filter(l => l.trim() !== '');
    const expectedLines = expectedCsv.split('\n').map(l => l.trim()).filter(l => l !== '');
    expect(actualLines.length, `${filePath}: 行数が一致しません (actual=${actualLines.length}, expected=${expectedLines.length})`).toBe(expectedLines.length);
    for (let i = 0; i < expectedLines.length; i++) {
        const expectedCells = expectedLines[i].split(',').map(c => c.trim());
        const actualCells = actualLines[i].split(',');
        for (let c = 0; c < expectedCells.length; c++) {
            expect(actualCells[c], `${filePath}: line[${i}] col[${c}] expected "${expectedCells[c]}" but got "${actualCells[c]}"`).toBe(expectedCells[c]);
        }
    }
}

export async function expectTableDataAsync(table: Locator, expectedCsv: string): Promise<void> {
    const lines = expectedCsv.split('\n').map(l => l.trim()).filter(l => l !== '');
    for (let row = 0; row < lines.length; row++) {
        const cells = lines[row].split(',').map(c => c.trim());
        for (let col = 0; col < cells.length; col++) {
            const cell = getDataCell(table, row, col);
            await expect.poll(() => cell.evaluate(el => {
                const valueEl = el.querySelector('.cell-value');
                if (valueEl) return valueEl.textContent!;
                const hasSpecial = el.querySelector('.cell-reference-hint, .cell-reverse-reference-hint, .view-collapse-toggle');
                if (hasSpecial) {
                    let t = '';
                    for (const node of Array.from(el.childNodes)) {
                        if (node.nodeType === Node.TEXT_NODE) t += node.textContent!;
                    }
                    return t;
                }
                return el.textContent!;
            }), {
                message: `row[${row}] col[${col}] expected "${cells[col]}"`,
            }).toBe(cells[col]);
        }
    }
}
