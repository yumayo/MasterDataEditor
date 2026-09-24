import {test, expect} from './fixtures/test';
import type {Locator, Page} from '@playwright/test';
import {installMockApiAsync, readMockFileAsync} from './fixtures/mock-api';
import type {MockFileSystem} from './fixtures/mock-api';

const tableName = 'freeze_right';
const columnCount = 10;

function createFileSystem(): MockFileSystem {
    const columns = ['id', ...Array.from({length: columnCount - 1}, (_, index) => `value_${index + 1}`)];
    const rows = Array.from({length: 1000}, (_, index) => columns.map((name, column) => column === 0 ? String(index + 1) : `${name}_${index + 1}`).join(','));
    return {
        [`schema/${tableName}.json`]: JSON.stringify({
            header: columns.map((name, key) => ({key, name, type: key === 0 ? 'int' : 'string', width: 110})),
            primary_key: ['id'],
        }),
        [`data/${tableName}.csv`]: [columns.join(','), ...rows].join('\n'),
    };
}

async function openTableAsync(page: Page): Promise<Locator> {
    await page.locator('#explorer').getByText(tableName, {exact: true}).click();
    const table = page.locator('.editor-left-pane .editor-table');
    await expect(table).toBeVisible();
    await expect(table.locator('.editor-table-grid .editor-table-row[data-row-index="0"]')).toBeAttached();
    return table;
}

function getColumnHeader(table: Locator, columnIndex: number): Locator {
    return table.locator([
        `.editor-table-pane-top-left .editor-table-column-header[data-column-index="${columnIndex}"]`,
        `.editor-table-pane-top-right .editor-table-column-header[data-column-index="${columnIndex}"]`,
        `.editor-table-detached-right-column-header-layer .editor-table-column-header[data-column-index="${columnIndex}"]`,
    ].join(',')).first();
}

function getRightCell(table: Locator, rowIndex: number, columnIndex: number): Locator {
    return table.locator([
        `.editor-table-detached-right-column-layer .editor-table-detached-row[data-row-index="${rowIndex}"] .editor-table-cell[data-col="${columnIndex}"]`,
        `.editor-table-detached-frozen-right-corner-layer .editor-table-detached-row[data-row-index="${rowIndex}"] .editor-table-cell[data-col="${columnIndex}"]`,
    ].join(','));
}

async function clickMenuItemAsync(page: Page, label: string): Promise<void> {
    const menu = page.locator('.context-menu.visible');
    await expect(menu).toBeVisible();
    await menu.locator('.context-menu-item').filter({hasText: label}).click();
}

async function freezeRightColumnsAsync(page: Page, table: Locator, count: number): Promise<void> {
    await table.locator('.editor-table-main-viewport').evaluate(element => { element.scrollLeft = element.scrollWidth; });
    await getColumnHeader(table, columnCount - count).click({button: 'right'});
    await clickMenuItemAsync(page, `この列から末尾まで右に固定 (${count}列)`);
    await expect(getRightCell(table, 0, columnCount - 1)).toBeVisible();
}

async function freezeLeftColumnsAsync(page: Page, table: Locator, count: number): Promise<void> {
    await table.locator('.editor-table-main-viewport').evaluate(element => { element.scrollLeft = 0; });
    await getColumnHeader(table, count - 1).click({button: 'right'});
    await clickMenuItemAsync(page, `先頭からこの列まで固定 (${count}列)`);
}

async function readSavedCountsAsync(page: Page): Promise<{left: number; right: number; rows: number} | null> {
    const contents = await readMockFileAsync(page, 'user:table-view-settings.json');
    if (typeof contents !== 'string') return null;
    const saved = JSON.parse(contents) as {tables: Record<string, {frozenColumnCount: number; frozenRightColumnCount: number; frozenRowCount: number}>};
    if (!Object.hasOwn(saved.tables, tableName)) return null;
    const settings = saved.tables[tableName];
    return {left: settings.frozenColumnCount, right: settings.frozenRightColumnCount, rows: settings.frozenRowCount};
}

async function getRectAsync(locator: Locator): Promise<{left: number; top: number; right: number; bottom: number}> {
    return await locator.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return {left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom};
    });
}

async function readSelectionAsync(page: Page): Promise<{row: number; column: number}> {
    return await page.evaluate(() => {
        const editor = (window as unknown as {editor: {activeEditorTable: {
            selection: {getSelectionRange(): {startRow: number; startColumn: number}};
            dataColumnOffset(): number;
        } | false}}).editor;
        if (editor.activeEditorTable === false) throw new Error('テーブルが開かれていません');
        const table = editor.activeEditorTable;
        const range = table.selection.getSelectionRange();
        return {row: range.startRow - 1, column: range.startColumn - table.dataColumnOffset()};
    });
}

test.describe('右側の列固定', () => {
    test.beforeEach(async ({page}) => {
        await page.setViewportSize({width: 1100, height: 700});
        await installMockApiAsync(page, createFileSystem());
        await page.goto('/');
    });

    test('列ヘッダーから末尾までの列を右端に固定し横スクロールしても動かない', async ({page}) => {
        const table = await openTableAsync(page);
        await freezeRightColumnsAsync(page, table, 2);
        const rightCell = getRightCell(table, 0, 9);
        const before = await getRectAsync(rightCell);
        const viewport = table.locator('.editor-table-main-viewport');
        await viewport.evaluate(element => { element.scrollLeft = 0; });
        await expect.poll(async () => Math.abs((await getRectAsync(rightCell)).left - before.left)).toBeLessThanOrEqual(1);
        const scrollbarLeft = await table.locator('.editor-table-logical-vertical-scrollbar').evaluate(element => element.getBoundingClientRect().left);
        expect(Math.abs(before.right - scrollbarLeft)).toBeLessThanOrEqual(2);
        await expect(getRightCell(table, 0, 8)).toHaveText('value_8_1');
        await expect(rightCell).toHaveText('value_9_1');
        const header = table.locator('.editor-table-detached-right-column-header-layer .editor-table-column-header[data-column-index="9"]');
        expect(Math.abs((await getRectAsync(header)).left - before.left)).toBeLessThanOrEqual(1);
        await viewport.evaluate(element => { element.scrollLeft = 230; });
        await expect.poll(async () => Math.abs((await getRectAsync(rightCell)).left - before.left)).toBeLessThanOrEqual(1);
        expect(await viewport.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
    });

    test('左右の列と先頭行を同時に固定して仮想スクロールしても表示が揃う', async ({page}) => {
        const table = await openTableAsync(page);
        await freezeLeftColumnsAsync(page, table, 2);
        await table.locator('.editor-table-detached-row-header-layer .editor-table-row-header[data-row-index="0"]').click({button: 'right'});
        await clickMenuItemAsync(page, 'この行まで固定');
        await freezeRightColumnsAsync(page, table, 2);
        const frozenRight = getRightCell(table, 0, 9);
        const frozenLeft = table.locator('.editor-table-detached-frozen-corner-layer .editor-table-detached-row[data-row-index="0"] .editor-table-cell[data-col="0"]');
        const rightBefore = await getRectAsync(frozenRight);
        const leftBefore = await getRectAsync(frozenLeft);
        await table.locator('.editor-table-main-viewport').evaluate(element => {
            element.scrollLeft = 260;
            element.scrollTop = 500 * 20;
        });
        const scrolledRight = getRightCell(table, 500, 9);
        await expect(scrolledRight).toHaveText('value_9_501');
        await expect(scrolledRight).toBeVisible();
        const rightAfter = await getRectAsync(frozenRight);
        const leftAfter = await getRectAsync(frozenLeft);
        expect(Math.abs(rightAfter.left - rightBefore.left)).toBeLessThanOrEqual(1);
        expect(Math.abs(rightAfter.top - rightBefore.top)).toBeLessThanOrEqual(1);
        expect(Math.abs(leftAfter.left - leftBefore.left)).toBeLessThanOrEqual(1);
        expect(Math.abs(leftAfter.top - leftBefore.top)).toBeLessThanOrEqual(1);
        const scrolledRect = await getRectAsync(scrolledRight);
        const sourceRow = table.locator('.editor-table-grid .editor-table-row[data-row-index="500"]');
        expect(Math.abs(scrolledRect.top - (await getRectAsync(sourceRow)).top)).toBeLessThanOrEqual(1);
        expect(Math.abs(scrolledRect.right - rightAfter.right)).toBeLessThanOrEqual(1);
        await expect(frozenRight).toHaveText('value_9_1');
        await expect.poll(async () => await readSavedCountsAsync(page)).toEqual({left: 2, right: 2, rows: 1});
        // autoDump に左右と上端を固定したスクロール後の画面を残し、重なり順を目視レビューする。
    });

    test('スクロール後の右固定セルを選択編集できUndoとRedoも反映される', async ({page}) => {
        const table = await openTableAsync(page);
        await freezeRightColumnsAsync(page, table, 2);
        await table.locator('.editor-table-main-viewport').evaluate(element => {
            element.scrollLeft = 170;
            element.scrollTop = 500 * 20;
        });
        const rightCell = getRightCell(table, 500, 9);
        await expect(rightCell).toHaveText('value_9_501');
        await rightCell.click();
        expect(await readSelectionAsync(page)).toEqual({row: 500, column: 9});
        await rightCell.dblclick();
        const editField = page.locator('.grid-textfield-active');
        await expect(editField).toBeVisible();
        await expect(editField).toHaveText('value_9_501');
        const cellRect = await getRectAsync(rightCell);
        const editRect = await getRectAsync(editField);
        expect(Math.abs(editRect.left - cellRect.left)).toBeLessThanOrEqual(2);
        expect(Math.abs(editRect.top - cellRect.top)).toBeLessThanOrEqual(2);
        await editField.fill('右固定列の変更');
        await page.keyboard.press('Enter');
        await expect(rightCell).toHaveText('右固定列の変更');
        const sourceCell = table.locator('.editor-table-grid .editor-table-row[data-row-index="500"] .editor-table-cell[data-col="9"]');
        await expect(sourceCell).toHaveText('右固定列の変更');
        await page.keyboard.press('Control+z');
        await expect(rightCell).toHaveText('value_9_501');
        await page.keyboard.press('Control+y');
        await expect(rightCell).toHaveText('右固定列の変更');
    });

    test('固定行と右固定列の交差セルをスクロール後も正しい位置で編集できる', async ({page}) => {
        const table = await openTableAsync(page);
        await table.locator('.editor-table-detached-row-header-layer .editor-table-row-header[data-row-index="0"]').click({button: 'right'});
        await clickMenuItemAsync(page, 'この行まで固定');
        await freezeRightColumnsAsync(page, table, 2);
        await table.locator('.editor-table-main-viewport').evaluate(element => {
            element.scrollLeft = 200;
            element.scrollTop = 500 * 20;
        });
        await expect(getRightCell(table, 500, 9)).toBeVisible();
        const fixedCell = getRightCell(table, 0, 8);
        await fixedCell.dblclick();
        expect(await readSelectionAsync(page)).toEqual({row: 0, column: 8});
        const field = page.locator('.grid-textfield-active');
        await expect(field).toHaveText('value_8_1');
        const cellRect = await getRectAsync(fixedCell);
        const editRect = await getRectAsync(field);
        expect(Math.abs(editRect.left - cellRect.left)).toBeLessThanOrEqual(2);
        expect(Math.abs(editRect.top - cellRect.top)).toBeLessThanOrEqual(2);
        await field.fill('固定行の右セル');
        await page.keyboard.press('Enter');
        await expect(fixedCell).toHaveText('固定行の右セル');
        // 編集UIのフォーカス復元と選択移動のrAFが完了しても、次の行が見えていること。
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        expect(await readSelectionAsync(page)).toEqual({row: 1, column: 8});
        const nextCell = getRightCell(table, 1, 8);
        await expect(nextCell).toBeVisible();
        await expect(nextCell).toHaveClass(/editor-table-cell-focused/);
        await expect(page.locator('.selection-overlay-border:visible').first()).toBeVisible();
    });

    test('左右の固定を保存復元し右側だけを解除できる', async ({page}) => {
        const table = await openTableAsync(page);
        await freezeLeftColumnsAsync(page, table, 1);
        await freezeRightColumnsAsync(page, table, 2);
        await expect.poll(async () => await readSavedCountsAsync(page)).toEqual({left: 1, right: 2, rows: 0});
        await page.locator('.tab-button', {hasText: tableName}).locator('.tab-button-close').click();
        const reopened = await openTableAsync(page);
        await expect(getRightCell(reopened, 0, 9)).toBeVisible();
        const rightHeader = reopened.locator('.editor-table-detached-right-column-header-layer .editor-table-column-header[data-column-index="9"]');
        await rightHeader.click({button: 'right'});
        await clickMenuItemAsync(page, '右側の列固定を解除');
        await expect.poll(async () => await readSavedCountsAsync(page)).toEqual({left: 1, right: 0, rows: 0});
        await expect(getRightCell(reopened, 0, 9)).toHaveCount(0);
        const leftCell = reopened.locator('.editor-table-detached-row-header-layer .editor-table-detached-row[data-row-index="0"] .editor-table-cell[data-col="0"]');
        const before = await getRectAsync(leftCell);
        await reopened.locator('.editor-table-main-viewport').evaluate(element => { element.scrollLeft = 200; });
        await expect.poll(async () => Math.abs((await getRectAsync(leftCell)).left - before.left)).toBeLessThanOrEqual(1);
    });

    test('左側だけを解除しても右側の列固定を維持する', async ({page}) => {
        const table = await openTableAsync(page);
        await freezeLeftColumnsAsync(page, table, 1);
        await freezeRightColumnsAsync(page, table, 2);
        await getColumnHeader(table, 0).click({button: 'right'});
        await clickMenuItemAsync(page, '左側の列固定を解除');
        await expect.poll(async () => await readSavedCountsAsync(page)).toEqual({left: 0, right: 2, rows: 0});
        await expect(getRightCell(table, 0, 9)).toHaveText('value_9_1');
        const before = await getRectAsync(getRightCell(table, 0, 9));
        await table.locator('.editor-table-main-viewport').evaluate(element => { element.scrollLeft = 0; });
        await expect.poll(async () => Math.abs((await getRectAsync(getRightCell(table, 0, 9))).left - before.left)).toBeLessThanOrEqual(1);
    });

    test('左右の固定範囲が重なる場合は最後に指定した側を優先する', async ({page}) => {
        await openTableAsync(page);
        const counts = await page.evaluate(() => {
            const editor = (window as unknown as {editor: {activeEditorTable: {
                freezeColumns(count: number): void;
                freezeRightColumns(count: number): void;
                getFrozenColumnCount(): number;
                getFrozenRightColumnCount(): number;
            } | false}}).editor;
            if (editor.activeEditorTable === false) throw new Error('テーブルが開かれていません');
            const table = editor.activeEditorTable;
            table.freezeColumns(6);
            table.freezeRightColumns(6);
            const rightPriority = {left: table.getFrozenColumnCount(), right: table.getFrozenRightColumnCount()};
            table.freezeColumns(7);
            return {rightPriority, leftPriority: {left: table.getFrozenColumnCount(), right: table.getFrozenRightColumnCount()}};
        });
        expect(counts).toEqual({rightPriority: {left: 4, right: 6}, leftPriority: {left: 7, right: 3}});
    });

    test('中央列と右固定列の間を矢印キーで移動し表示位置を維持する', async ({page}) => {
        const table = await openTableAsync(page);
        await freezeRightColumnsAsync(page, table, 2);
        await table.locator('.editor-table-main-viewport').evaluate(element => { element.scrollLeft = 0; });
        const rightCell = getRightCell(table, 0, 8);
        await rightCell.click();
        await page.keyboard.press('ArrowLeft');
        expect(await readSelectionAsync(page)).toEqual({row: 0, column: 7});
        const source = table.locator('.editor-table-grid .editor-table-row[data-row-index="0"] .editor-table-cell[data-col="7"]');
        const sourceRect = await getRectAsync(source);
        const viewportRect = await getRectAsync(table.locator('.editor-table-main-viewport'));
        expect(sourceRect.left).toBeGreaterThanOrEqual(viewportRect.left - 1);
        expect(sourceRect.right).toBeLessThanOrEqual(viewportRect.right + 1);
        const scrollLeft = await table.locator('.editor-table-main-viewport').evaluate(element => element.scrollLeft);
        await page.keyboard.press('ArrowRight');
        expect(await readSelectionAsync(page)).toEqual({row: 0, column: 8});
        await expect(rightCell).toHaveClass(/editor-table-cell-focused/);
        expect(await table.locator('.editor-table-main-viewport').evaluate(element => element.scrollLeft)).toBe(scrollLeft);
    });

    test('中央列から右固定列へドラッグして正しい終端列まで選択する', async ({page}) => {
        const table = await openTableAsync(page);
        await freezeRightColumnsAsync(page, table, 2);
        await getRightCell(table, 0, 8).click();
        await page.keyboard.press('ArrowLeft');
        const source = table.locator('.editor-table-grid .editor-table-row[data-row-index="0"] .editor-table-cell[data-col="7"]');
        const from = await getRectAsync(source);
        const to = await getRectAsync(getRightCell(table, 2, 9));
        const viewport = table.locator('.editor-table-main-viewport');
        const scrollBefore = await viewport.evaluate(element => element.scrollLeft);
        await page.mouse.move((from.left + from.right) / 2, (from.top + from.bottom) / 2);
        await page.mouse.down();
        await page.mouse.move((to.left + to.right) / 2, (to.top + to.bottom) / 2, {steps: 10});
        await page.mouse.up();
        const range = await page.evaluate(() => {
            const editor = (window as unknown as {editor: {activeEditorTable: {
                selection: {getSelectionRange(): {startRow: number; endRow: number; startColumn: number; endColumn: number}};
                dataColumnOffset(): number;
            } | false}}).editor;
            if (editor.activeEditorTable === false) throw new Error('テーブルが開かれていません');
            const table = editor.activeEditorTable;
            const selected = table.selection.getSelectionRange();
            return {startRow: selected.startRow - 1, endRow: selected.endRow - 1,
                startColumn: selected.startColumn - table.dataColumnOffset(), endColumn: selected.endColumn - table.dataColumnOffset()};
        });
        expect(range).toEqual({startRow: 0, endRow: 2, startColumn: 7, endColumn: 9});
        expect(await viewport.evaluate(element => element.scrollLeft)).toBe(scrollBefore);
    });

    test('右固定列の幅を変更してUndoしてもヘッダーと本文が右端に揃う', async ({page}) => {
        const table = await openTableAsync(page);
        await freezeRightColumnsAsync(page, table, 2);
        const header = table.locator('.editor-table-detached-right-column-header-layer .editor-table-column-header[data-column-index="8"]');
        const original = await getRectAsync(header);
        const lastRight = (await getRectAsync(getRightCell(table, 0, 9))).right;
        const handle = await getRectAsync(header.locator('.column-resize-handle'));
        await page.mouse.move((handle.left + handle.right) / 2, (handle.top + handle.bottom) / 2);
        await page.mouse.down();
        await page.mouse.move((handle.left + handle.right) / 2 + 50, (handle.top + handle.bottom) / 2, {steps: 5});
        await page.mouse.up();
        await expect.poll(async () => {
            const rect = await getRectAsync(header);
            return rect.right - rect.left;
        }).toBeGreaterThan(original.right - original.left + 30);
        const resized = await getRectAsync(header);
        expect(Math.abs(resized.left - (await getRectAsync(getRightCell(table, 0, 8))).left)).toBeLessThanOrEqual(1);
        expect(Math.abs(lastRight - (await getRectAsync(getRightCell(table, 0, 9))).right)).toBeLessThanOrEqual(1);
        await page.keyboard.press('Control+z');
        await expect.poll(async () => {
            const rect = await getRectAsync(header);
            return Math.abs(rect.right - rect.left - (original.right - original.left));
        }).toBeLessThanOrEqual(1);
    });

    test('狭い画面で全列を右固定しても各列へ移動して編集と固定範囲の変更ができる', async ({page}) => {
        await page.setViewportSize({width: 640, height: 600});
        const table = await openTableAsync(page);
        await getColumnHeader(table, 0).click({button: 'right'});
        await clickMenuItemAsync(page, 'この列から末尾まで右に固定 (10列)');
        await expect.poll(async () => await readSavedCountsAsync(page)).toEqual({left: 0, right: 10, rows: 0});
        await getRightCell(table, 0, 9).click();
        for (let column = 8; column >= 0; column--) await page.keyboard.press('ArrowLeft');
        expect(await readSelectionAsync(page)).toEqual({row: 0, column: 0});
        const first = getRightCell(table, 0, 0);
        await first.dblclick();
        await expect(page.locator('.grid-textfield-active')).toHaveText('1');
        await page.keyboard.press('Escape');
        for (let column = 1; column <= 8; column++) await page.keyboard.press('ArrowRight');
        const header = table.locator('.editor-table-detached-right-column-header-layer .editor-table-column-header[data-column-index="8"]');
        await header.click({button: 'right'});
        await clickMenuItemAsync(page, 'この列から末尾まで右に固定 (2列)');
        await expect.poll(async () => await readSavedCountsAsync(page)).toEqual({left: 0, right: 2, rows: 0});
        await header.click({button: 'right'});
        await clickMenuItemAsync(page, '右側の列固定を解除');
        await expect.poll(async () => await readSavedCountsAsync(page)).toEqual({left: 0, right: 0, rows: 0});
    });

    test('横スクロールの不要な短いテーブルでも右固定列が中央余白に重複表示されない', async ({page}) => {
        const fs: MockFileSystem = {
            [`schema/${tableName}.json`]: JSON.stringify({
                header: ['id', 'name', 'value'].map((name, key) => ({name, key, type: key === 0 ? 'int' : 'string', width: 110})),
                primary_key: ['id'],
            }),
            [`data/${tableName}.csv`]: 'id,name,value\n1,first,LAST\n2,second,END',
        };
        await installMockApiAsync(page, fs);
        await page.goto('/');
        const table = await openTableAsync(page);
        await getColumnHeader(table, 2).click({button: 'right'});
        await clickMenuItemAsync(page, 'この列から末尾まで右に固定 (1列)');
        await expect(getRightCell(table, 0, 2)).toHaveText('LAST');
        const source = table.locator('.editor-table-grid .editor-table-row[data-row-index="0"] .editor-table-cell[data-col="2"]');
        const sourceIsPainted = await source.evaluate(cell => {
            const rect = cell.getBoundingClientRect();
            return document.elementsFromPoint((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2).some(element => element === cell || cell.contains(element));
        });
        expect(sourceIsPainted).toBe(false);
        const right = await getRectAsync(getRightCell(table, 0, 2));
        const lastCentral = await getRectAsync(table.locator('.editor-table-grid .editor-table-row[data-row-index="0"] .editor-table-cell[data-col="1"]'));
        expect(right.left - lastCentral.right).toBeGreaterThan(100);
    });

    test('左右の固定幅が画面を超えても左の隠れた列と右列を選択編集できる', async ({page}) => {
        await page.setViewportSize({width: 640, height: 600});
        const table = await openTableAsync(page);
        await page.evaluate(() => {
            const editor = (window as unknown as {editor: {activeEditorTable: {
                freezeColumns(count: number): void;
                freezeRightColumns(count: number): void;
            } | false}}).editor;
            if (editor.activeEditorTable === false) throw new Error('テーブルが開かれていません');
            editor.activeEditorTable.freezeColumns(7);
            editor.activeEditorTable.freezeRightColumns(3);
        });
        const leftRow = table.locator('.editor-table-detached-row-header-layer .editor-table-detached-row[data-row-index="0"]');
        await leftRow.locator('.editor-table-cell[data-col="0"]').click();
        for (let column = 1; column <= 6; column++) await page.keyboard.press('ArrowRight');
        expect(await readSelectionAsync(page)).toEqual({row: 0, column: 6});
        const leftCell = leftRow.locator('.editor-table-cell[data-col="6"]');
        const leftRect = await getRectAsync(leftCell);
        const prefixRect = await getRectAsync(leftRow.locator('.editor-table-row-header'));
        const paneRect = await getRectAsync(table.locator('.editor-table-pane-bottom-left'));
        expect(leftRect.left).toBeGreaterThanOrEqual(prefixRect.right - 1);
        expect(leftRect.right).toBeLessThanOrEqual(paneRect.right + 1);
        await leftCell.dblclick();
        await expect(page.locator('.grid-textfield-active')).toHaveText('value_6_1');
        await page.keyboard.press('Escape');
        await page.keyboard.press('ArrowRight');
        expect(await readSelectionAsync(page)).toEqual({row: 0, column: 7});
        await getRightCell(table, 0, 7).dblclick();
        await expect(page.locator('.grid-textfield-active')).toHaveText('value_7_1');
        await page.keyboard.press('Escape');
        await table.locator('.editor-table-pane-bottom-left').dispatchEvent('wheel', {deltaY: -1000, shiftKey: true});
        const firstRect = await getRectAsync(leftRow.locator('.editor-table-cell[data-col="0"]'));
        expect(firstRect.left).toBeGreaterThanOrEqual(prefixRect.right - 1);
        expect(firstRect.right).toBeLessThanOrEqual(paneRect.right + 1);
    });

    test('全列右固定と先頭行固定でもドラッグ選択の終端を先頭行へ戻せる', async ({page}) => {
        const table = await openTableAsync(page);
        await table.locator('.editor-table-detached-row-header-layer .editor-table-row-header[data-row-index="0"]').click({button: 'right'});
        await clickMenuItemAsync(page, 'この行まで固定');
        await getColumnHeader(table, 0).click({button: 'right'});
        await clickMenuItemAsync(page, 'この列から末尾まで右に固定 (10列)');
        const from = await getRectAsync(getRightCell(table, 3, 9));
        const to = await getRectAsync(getRightCell(table, 0, 9));
        await page.mouse.move((from.left + from.right) / 2, (from.top + from.bottom) / 2);
        await page.mouse.down();
        await page.mouse.move((to.left + to.right) / 2, (to.top + to.bottom) / 2, {steps: 8});
        await page.mouse.up();
        expect(await readSelectionAsync(page)).toEqual({row: 0, column: 9});
        await expect(getRightCell(table, 0, 9)).toHaveClass(/sel-top/);
    });

    test('右固定列数のない旧ユーザー設定を0列として読み込み左固定を保つ', async ({page}) => {
        const fs = createFileSystem();
        fs['user:table-view-settings.json'] = JSON.stringify({tables: {
            [tableName]: {frozenColumnCount: 1, frozenRowCount: 0, sortKeys: [], filters: {}},
        }});
        await installMockApiAsync(page, fs);
        await page.goto('/');
        const table = await openTableAsync(page);
        const counts = await page.evaluate(() => {
            const editor = (window as unknown as {editor: {activeEditorTable: {
                getFrozenColumnCount(): number;
                getFrozenRightColumnCount(): number;
            } | false}}).editor;
            if (editor.activeEditorTable === false) throw new Error('テーブルが開かれていません');
            return {left: editor.activeEditorTable.getFrozenColumnCount(), right: editor.activeEditorTable.getFrozenRightColumnCount()};
        });
        expect(counts).toEqual({left: 1, right: 0});
        await freezeRightColumnsAsync(page, table, 1);
        await expect.poll(async () => await readSavedCountsAsync(page)).toEqual({left: 1, right: 1, rows: 0});
    });
});
