import {test, expect} from './fixtures/test';
import {installMockApiAsync, type MockFileSystem} from './fixtures/mock-api';
import type {Locator, Page} from '@playwright/test';

const ROW_COUNT = 200;

function createFileSystem(frozenRowCount: number, frozenColumnCount: number): MockFileSystem {
    return {
        'schema/item.json': JSON.stringify({
            header: [
                {key: 0, name: 'id', type: 'int', reference: 'item_name.ja', width: 160},
                {key: 1, name: 'name', type: 'string', width: 180},
            ],
            primary_key: ['id'],
            frozenRowCount,
            frozenColumnCount,
        }),
        'data/item.csv': ['id,name', ...Array.from({length: ROW_COUNT}, (_, i) => `${i + 1},item_${i + 1}`)].join('\n'),
        'schema/item_name.json': JSON.stringify({
            header: [{key: 0, name: 'id', type: 'int'}, {key: 1, name: 'ja', type: 'string'}],
            primary_key: ['id'],
        }),
        'data/item_name.csv': ['id,ja', ...Array.from({length: ROW_COUNT}, (_, i) => `${i + 1},ヒント${i + 1}`)].join('\n'),
    };
}

async function openTableAsync(page: Page, frozenRowCount: number, frozenColumnCount: number): Promise<Locator> {
    await page.addInitScript((rowCount) => {
        (window as unknown as {__mockGitBlame: Record<string, object[]>}).__mockGitBlame = {
            'data/item.csv': Array.from({length: rowCount}, (_, i) => ({
                lineNumber: i + 2,
                author: `author_${i + 1}`,
                date: '2026-09-09',
                commitHash: 'aaa1111',
                commitMessage: 'initial',
            })),
        };
    }, ROW_COUNT);
    await installMockApiAsync(page, createFileSystem(frozenRowCount, frozenColumnCount));
    await page.goto('/');
    await page.locator('#explorer').getByText('item', {exact: true}).click();
    const table = page.locator('.editor-left-pane .editor-table:visible');
    await expect(table).toBeVisible();
    await expect(table.locator('.editor-table-grid .cell-reference-hint').first()).toHaveText('ヒント1');
    return table;
}

async function toggleBlameAsync(page: Page, table: Locator, show: boolean): Promise<void> {
    const target = await table.evaluate((element) => {
        const viewport = element.querySelector('.editor-table-main-viewport')!.getBoundingClientRect();
        for (const header of element.querySelectorAll('.editor-table-detached-row-header-layer .editor-table-row-header')) {
            const rect = header.getBoundingClientRect();
            if (rect.top >= viewport.top && rect.bottom <= viewport.bottom) {
                return {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2};
            }
        }
        throw new Error('画面内の行ヘッダーが見つかりません');
    });
    await page.mouse.click(target.x, target.y, {button: 'right'});
    const menu = page.locator('.context-menu.visible');
    await expect(menu).toBeVisible();
    await menu.getByText(show ? '変更履歴を表示' : '変更履歴を非表示', {exact: true}).click();
    const header = table.locator('.editor-table-detached-corner-layer .blame-column-header');
    if (show) await expect(header).toBeVisible();
    else await expect(header).toHaveCount(0);
}

async function scrollAsync(table: Locator, position: 'top' | 'middle' | 'bottom'): Promise<void> {
    await table.locator('.editor-table-main-viewport').evaluate((element, target) => {
        element.scrollTop = target === 'top' ? 0 : target === 'bottom' ? element.scrollHeight : element.scrollHeight / 2;
    }, position);
    const rowIndex = position === 'top' ? 2 : position === 'bottom' ? ROW_COUNT - 1 : ROW_COUNT / 2;
    await expect(table.locator(`.editor-table-grid > .editor-table-row[data-row-index="${rowIndex}"]`)).toBeAttached();
}

async function releaseBlameAsync(page: Page): Promise<void> {
    await page.evaluate(() => {
        const respond = (window as unknown as {__mockGitBlamePendingResponses: Array<() => void>}).__mockGitBlamePendingResponses.shift();
        if (respond === undefined) throw new Error('BLAMEの応答がありません');
        respond();
    });
}

async function expectColumnsAlignedAsync(table: Locator, showBlame: boolean, frozenColumnCount: number): Promise<void> {
    // 元の行と、画面に表示する行ヘッダーの複製の両方を確認する。
    const rows = await table.locator(
        '.editor-table-grid > .editor-table-row,' +
        '.editor-table-detached-row-header-layer > .editor-table-detached-row,' +
        '.editor-table-detached-frozen-corner-layer > .editor-table-detached-row[data-row-index]',
    ).evaluateAll(elements => elements.map(element => ({
        rowIndex: Number((element as HTMLElement).dataset.rowIndex),
        detached: element.classList.contains('editor-table-detached-row'),
        cells: Array.from(element.children).map(cell => ({
            kind: cell.classList.contains('blame-cell') ? 'blame'
                : cell.classList.contains('editor-table-row-header') ? 'row-header' : 'data',
            value: Array.from(cell.childNodes).filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join(''),
            hint: cell.querySelector('.cell-reference-hint')?.textContent ?? null,
            author: cell.querySelector('.blame-author')?.textContent ?? null,
        })),
    })));
    const sourceRows = rows.filter(row => !row.detached);
    expect(sourceRows.length).toBeGreaterThan(0);
    expect(sourceRows.length).toBeLessThan(ROW_COUNT);
    expect(rows.filter(row => row.detached)).toHaveLength(sourceRows.length);
    for (const row of rows) {
        const number = row.rowIndex + 1;
        const isBuffer = row.rowIndex === ROW_COUNT;
        const expected: Array<{kind: string; value: string; hint: string | null; author: string | null}> = [
            {kind: 'row-header', value: String(number), hint: null, author: null},
            {kind: 'data', value: isBuffer ? '' : String(number), hint: isBuffer ? null : `ヒント${number}`, author: null},
            {kind: 'data', value: isBuffer ? '' : `item_${number}`, hint: null, author: null},
        ];
        if (showBlame) expected.unshift({kind: 'blame', value: '', hint: null, author: isBuffer ? null : `author_${number}`});
        const prefixCount = (showBlame ? 2 : 1) + frozenColumnCount;
        expect(row.cells, `行${number} (${row.detached ? '表示用' : '元の行'})`).toEqual(row.detached ? expected.slice(0, prefixCount) : expected);
    }
    if (!showBlame) await expect(table.locator('.blame-cell, .blame-column-header, .blame-author, .blame-date')).toHaveCount(0);
}

for (const frozen of [false, true]) {
    test.describe(frozen ? '固定行・固定列ありのBLAME仮想スクロール' : 'BLAME仮想スクロール', () => {
        const frozenRowCount = frozen ? 2 : 0;
        const frozenColumnCount = frozen ? 1 : 0;

        test('BLAMEの取得前に列幅を確保し、スクロールやタブ復帰後も取得完了で位置がずれない', async ({page}) => {
            await page.addInitScript(() => {
                (window as unknown as {__mockGitBlameManualResponses: boolean}).__mockGitBlameManualResponses = true;
            });
            const table = await openTableAsync(page, frozenRowCount, frozenColumnCount);
            const viewport = table.locator('.editor-table-main-viewport');
            const withoutBlame = await viewport.boundingBox();
            await toggleBlameAsync(page, table, true);
            const loading = await viewport.boundingBox();
            expect(loading!.x - withoutBlame!.x).toBe(200);
            await scrollAsync(table, 'bottom');
            const lastRow = table.locator(`.editor-table-grid > .editor-table-row[data-row-index="${ROW_COUNT - 1}"]`);
            await expect(lastRow.locator('.blame-cell')).toHaveText('…');
            await expect(table.locator('.editor-table-grid > .editor-table-empty-row .blame-cell')).toHaveText('');
            const beforeResponse = await viewport.boundingBox();
            await page.screenshot({path: `../.CONTEXT/dump/virtual-scroll-blame/blame-loading-${frozen}.png`});
            await releaseBlameAsync(page);
            await expect(lastRow.locator('.blame-author')).toHaveText(`author_${ROW_COUNT}`);
            expect(await viewport.boundingBox()).toEqual(beforeResponse);
            await expectColumnsAlignedAsync(table, true, frozenColumnCount);

            await page.locator('#explorer').getByText('item_name', {exact: true}).click();
            await page.locator('.tab-button').getByText('item', {exact: true}).click();
            await expect(table.locator('.editor-table-detached-corner-layer .blame-column-header')).toBeVisible();
            await expect(lastRow.locator('.blame-cell')).toHaveText('…');
            expect(await viewport.boundingBox()).toEqual(beforeResponse);
            await releaseBlameAsync(page);
            await expect(lastRow.locator('.blame-author')).toHaveText(`author_${ROW_COUNT}`);
            expect(await viewport.boundingBox()).toEqual(beforeResponse);
            await expectColumnsAlignedAsync(table, true, frozenColumnCount);
        });

        test('タブごとにBLAMEの表示・非表示を保持し、復帰や同じタブの再選択でも列がずれない', async ({page}) => {
            const table = await openTableAsync(page, frozenRowCount, frozenColumnCount);
            await toggleBlameAsync(page, table, true);
            await scrollAsync(table, 'bottom');
            await page.locator('#explorer').getByText('item_name', {exact: true}).click();
            await expect(page.locator('.tab-button-active')).toHaveText('item_name');
            await expect(table.locator('.blame-column-header')).toHaveCount(0);

            await page.locator('.tab-button').getByText('item', {exact: true}).click();
            await expect(table.locator('.editor-table-detached-corner-layer .blame-column-header')).toBeVisible();
            await expect(table.locator(`.editor-table-grid > .editor-table-row[data-row-index="${ROW_COUNT - 1}"]`)).toBeAttached();
            await expectColumnsAlignedAsync(table, true, frozenColumnCount);
            await page.locator('.tab-button').getByText('item', {exact: true}).click();
            await expect(table.locator('.editor-table-detached-corner-layer .blame-column-header')).toBeVisible();
            await expectColumnsAlignedAsync(table, true, frozenColumnCount);

            await toggleBlameAsync(page, table, false);
            await page.locator('.tab-button').getByText('item_name', {exact: true}).click();
            await page.locator('.tab-button').getByText('item', {exact: true}).click();
            await expectColumnsAlignedAsync(table, false, frozenColumnCount);
        });

        test('末尾でBLAMEを切り替えても行番号・参照ヒントの列がずれない', async ({page}) => {
            const table = await openTableAsync(page, frozenRowCount, frozenColumnCount);
            await scrollAsync(table, 'bottom');
            await expectColumnsAlignedAsync(table, false, frozenColumnCount);
            await toggleBlameAsync(page, table, true);
            await expectColumnsAlignedAsync(table, true, frozenColumnCount);
            for (const position of ['top', 'middle', 'bottom'] as const) {
                await scrollAsync(table, position);
                await expectColumnsAlignedAsync(table, true, frozenColumnCount);
            }
            await toggleBlameAsync(page, table, false);
            await expectColumnsAlignedAsync(table, false, frozenColumnCount);
            await toggleBlameAsync(page, table, true);
            await expectColumnsAlignedAsync(table, true, frozenColumnCount);
            await toggleBlameAsync(page, table, false);
            await scrollAsync(table, 'top');
            await expectColumnsAlignedAsync(table, false, frozenColumnCount);
        });

        test('先頭でBLAMEを表示して末尾で解除するとBLAMEが残らない', async ({page}) => {
            const table = await openTableAsync(page, frozenRowCount, frozenColumnCount);
            await toggleBlameAsync(page, table, true);
            await expectColumnsAlignedAsync(table, true, frozenColumnCount);
            await scrollAsync(table, 'bottom');
            await expectColumnsAlignedAsync(table, true, frozenColumnCount);
            await toggleBlameAsync(page, table, false);
            await expectColumnsAlignedAsync(table, false, frozenColumnCount);
            await scrollAsync(table, 'top');
            await expectColumnsAlignedAsync(table, false, frozenColumnCount);
        });
    });
}
