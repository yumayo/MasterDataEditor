import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/test';
import { installMockApiAsync, readMockFileAsync } from './fixtures/mock-api';
import { getDataCell } from './fixtures/test-utils';

const HEAD_ROWS = [
    ['1', '2026-01-01 00:00:00', '2026-01-31 23:59:59', 'first', '100'],
    ['1', '2026-01-01 00:00:00', '2026-02-28 23:59:59', 'same_begin', '200'],
    ['1', '2026-01-15 00:00:00', '2026-01-31 23:59:59', 'same_end', '300'],
    ['1', '', '2026-03-31 23:59:59', 'no_begin', '400'],
    ['1', '2026-04-01 00:00:00', '', 'no_end', '500'],
    ['1', '', '', 'no_limits', '600'],
];

// 同じPK内でHEADと行順が違っても、開始・終了の両方が一致する行と比較する。
const REORDERED_ROWS = [HEAD_ROWS[2], HEAD_ROWS[4], HEAD_ROWS[1], HEAD_ROWS[5], HEAD_ROWS[3], HEAD_ROWS[0]];
const MODIFIED_GIT_STATUS = { changes: [{ path: 'data/item.csv', tableName: 'item', isNew: false }], staged: [] };

async function openPeriodTableAsync(page: Page, beginColumnName: string, endColumnName: string, headRows: string[][], currentRows: string[][], initiallyClean: boolean): Promise<Locator> {
    const header = ['id', beginColumnName, endColumnName, 'name', 'value'];
    // HEADは列順も変更し、期間の列インデックスを現在版CSVのまま流用できない条件にする。
    const headColumnOrder = [4, 2, 0, 3, 1];
    const headCsv = [headColumnOrder.map(index => header[index]).join(','), ...headRows.map(row => headColumnOrder.map(index => row[index]).join(','))].join('\n');
    await page.addInitScript(args => {
        (window as unknown as { __mockGitStatus: object }).__mockGitStatus = args.status;
        (window as unknown as { __mockGitHeadFiles: Record<string, string> }).__mockGitHeadFiles = { 'data/item.csv': args.headCsv };
    }, { status: initiallyClean ? { changes: [], staged: [] } : MODIFIED_GIT_STATUS, headCsv });
    await installMockApiAsync(page, {
        '.masterdataeditor/settings.json': JSON.stringify({ exportBeginDateColumnName: beginColumnName, exportEndDateColumnName: endColumnName }),
        'schema/item.json': JSON.stringify({
            header: header.map((name, key) => ({ key, name, type: key === 0 || key === 4 ? 'int' : 'string' })),
            primary_key: ['id'],
        }),
        'data/item.csv': [header.join(','), ...currentRows.map(row => row.join(','))].join('\n'),
    });
    await page.goto('/');
    await page.locator('#explorer .explorer-file').getByText('item', { exact: true }).click();
    const table = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="item"] .editor-table');
    await expect(table).toBeVisible();
    return table;
}

async function expectChangedCellsAsync(table: Locator, expected: boolean[][]): Promise<void> {
    await expect.poll(() => table.locator('.editor-table-row').evaluateAll((rows, rowCount) => rows.slice(0, rowCount).map(row =>
        Array.from(row.querySelectorAll('.editor-table-cell:not(.editor-table-row-header)')).map(cell => cell.classList.contains('cell-git-changed')),
    ), expected.length)).toEqual(expected);
}

async function editCellAsync(page: Page, cell: Locator, value: string): Promise<void> {
    await cell.dblclick();
    const input = page.locator('.grid-textfield-active').first();
    await expect(input).toBeVisible();
    await input.fill(value);
    await page.keyboard.press('Enter');
}

test.describe('公開期間を含むGit差分ハイライト', () => {
    for (const columns of [
        { title: '標準の公開期間列', begin: 'export_begin_date', end: 'export_end_date' },
        { title: '設定で変更した公開期間列', begin: 'available_from', end: 'available_until' },
    ]) {
        test(`${columns.title}で同一PKの各期間をHEADと照合し、変更セルと新規期間行だけを強調する`, async ({ page }) => {
            const currentRows = REORDERED_ROWS.map(row => [...row]);
            // HEADの先頭行と同じ値に変更しても、その期間のHEAD行との差分は消えない。
            currentRows[2][4] = '100';
            currentRows.push(['1', '2026-07-01 00:00:00', '2026-07-31 23:59:59', 'first', '100']);
            const table = await openPeriodTableAsync(page, columns.begin, columns.end, HEAD_ROWS, currentRows, false);
            await expectChangedCellsAsync(table, [
                [false, false, false, false, false],
                [false, false, false, false, false],
                [false, false, false, false, true],
                [false, false, false, false, false],
                [false, false, false, false, false],
                [false, false, false, false, false],
                [true, true, true, true, true],
            ]);
        });
    }

    test('clean状態から編集して保存した後も同一PKの該当期間にある変更セルだけを強調する', async ({ page }) => {
        const table = await openPeriodTableAsync(page, 'export_begin_date', 'export_end_date', HEAD_ROWS, REORDERED_ROWS, true);
        await expect(table.locator('.cell-git-changed')).toHaveCount(0);
        await editCellAsync(page, getDataCell(table, 2, 4), '100');
        await page.evaluate(status => {
            (window as unknown as { __mockGitStatus: object }).__mockGitStatus = status;
        }, MODIFIED_GIT_STATUS);
        await page.keyboard.press('Control+s');
        await expect.poll(() => readMockFileAsync(page, 'data/item.csv')).toContain('1,2026-01-01 00:00:00,2026-02-28 23:59:59,same_begin,100');
        await expectChangedCellsAsync(table, [
            [false, false, false, false, false],
            [false, false, false, false, false],
            [false, false, false, false, true],
            [false, false, false, false, false],
            [false, false, false, false, false],
            [false, false, false, false, false],
        ]);
    });

    test('期間セルの編集・Undo・RedoでHEADに対応する行の有無を再判定する', async ({ page }) => {
        const table = await openPeriodTableAsync(page, 'export_begin_date', 'export_end_date', [HEAD_ROWS[0]], [HEAD_ROWS[0]], false);
        await expectChangedCellsAsync(table, [[false, false, false, false, false]]);
        await editCellAsync(page, getDataCell(table, 0, 2), '2026-02-28 23:59:59');
        await expectChangedCellsAsync(table, [[true, true, true, true, true]]);
        await page.keyboard.press('Control+z');
        await expectChangedCellsAsync(table, [[false, false, false, false, false]]);
        await page.keyboard.press('Control+y');
        await expectChangedCellsAsync(table, [[true, true, true, true, true]]);
    });
});
