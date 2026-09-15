import {test, expect} from './fixtures/test';
import type {CDPSession, Locator, Page} from '@playwright/test';
import {installMockApiAsync} from './fixtures/mock-api';
import type {MockFileSystem} from './fixtures/mock-api';

interface CellRange {
    startRow: number;
    startColumn: number;
    endRow: number;
    endColumn: number;
}

interface SelectionTestWindow extends Window {
    editor: {activeEditorTable: {getSelection(): {getRange(): CellRange}; scrollByInput(top: number, left: number): void} | false};
    selectionDragProbe: {mutations: number; gridMutations: number; notifications: number; lines: Element[]};
}

const wrapperSelector = '.editor-left-pane .tab-wrapper[data-tab-name="selection_perf"]';
const tableSelector = `${wrapperSelector} .editor-table`;
const rowCount = 1000;
const columnCount = 6;

function createFileSystem(frozen: boolean): MockFileSystem {
    const headers = Array.from({length: columnCount}, (_, index) => `col_${index}`);
    return {
        'schema/selection_perf.json': JSON.stringify({
            header: headers.map((name, key) => ({key, name, type: 'string'})),
            primary_key: [headers[0]],
            frozenRowCount: frozen ? 2 : 0,
            frozenColumnCount: frozen ? 2 : 0,
        }),
        'data/selection_perf.csv': [headers.join(','), ...Array.from({length: rowCount}, (_, row) => headers.map((_, col) => `${row}_${col}`).join(','))].join('\n'),
    };
}

async function settleFramesAsync(page: Page): Promise<void> {
    // 選択・ResizeObserver・罫線の次フレーム処理まで観測してから比較する。
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))));
}

async function openTableAsync(page: Page, frozen: boolean): Promise<Locator> {
    await page.setViewportSize({width: 1280, height: 800});
    await installMockApiAsync(page, createFileSystem(frozen));
    await page.goto('/');
    await page.locator('#explorer .explorer-file').getByText('selection_perf', {exact: true}).click();
    const table = page.locator(tableSelector);
    await expect(table).toBeVisible();
    await expect(table.locator('.editor-table-grid-line').first()).toBeAttached();
    await settleFramesAsync(page);
    return table;
}

function dataCell(table: Locator, frozen: boolean, row: number, column: number): Locator {
    const layer = frozen && row < 2
        ? column < 2 ? '.editor-table-detached-frozen-corner-layer' : '.editor-table-detached-frozen-row-layer'
        : frozen && column < 2 ? '.editor-table-detached-row-header-layer' : '.editor-table-grid';
    return table.locator(`${layer} [data-row-index="${row}"] .editor-table-cell[data-col="${column}"]`);
}

async function centerAsync(locator: Locator): Promise<{x: number; y: number}> {
    const box = await locator.boundingBox();
    if (box === null) throw new Error('マウス操作対象が表示されていません');
    return {x: box.x + box.width / 2, y: box.y + box.height / 2};
}

async function installProbeAsync(page: Page): Promise<void> {
    await page.evaluate(selector => {
        const table = document.querySelector(selector);
        if (table === null) throw new Error('測定対象のテーブルがありません');
        const probe = {mutations: 0, gridMutations: 0, notifications: 0, lines: Array.from(table.querySelectorAll('.editor-table-grid-line'))};
        (window as SelectionTestWindow).selectionDragProbe = probe;
        new MutationObserver(records => {
            probe.mutations += records.length;
            for (const record of records) {
                if (record.type !== 'childList') continue;
                const changes = [...record.addedNodes, ...record.removedNodes];
                if (changes.some(node => node instanceof Element && (node.matches('.editor-table-grid-line, .editor-table-grid-line-group') || node.querySelector('.editor-table-grid-line') !== null))) {
                    probe.gridMutations++;
                }
            }
        }).observe(table, {subtree: true, childList: true, attributes: true, characterData: true});
        table.addEventListener('editor-table-selection-changed', () => probe.notifications++);
    }, tableSelector);
}

async function readRangeAsync(page: Page): Promise<CellRange> {
    return page.evaluate(() => {
        const table = (window as SelectionTestWindow).editor.activeEditorTable;
        if (table === false) throw new Error('選択対象のテーブルがありません');
        return table.getSelection().getRange();
    });
}

async function expectSelectionClassesAsync(table: Locator, range: CellRange): Promise<void> {
    const mismatches = await table.evaluate((element, selection) => {
        const errors: string[] = [];
        // source と detached の両方を期待範囲から検証し、同期漏れと古い選択の残留を検出する。
        for (const cell of element.querySelectorAll<HTMLElement>('.editor-table-cell')) {
            const row = cell.closest('[data-row-index]');
            const columnText = cell.getAttribute('data-col');
            if (cell.classList.contains('editor-table-column-header')) {
                if (columnText === null) throw new Error('列ヘッダーに data-col がありません');
                const column = Number(columnText) + 1;
                const selected = column >= selection.startColumn && column <= selection.endColumn;
                if (cell.classList.contains('selected') !== selected) errors.push(`列ヘッダー ${column}: ${cell.className}`);
                if (cell.classList.contains('selected-column-end') !== (column === selection.endColumn)) errors.push(`列ヘッダー終端 ${column}: ${cell.className}`);
                continue;
            }
            if (row === null) continue;
            const logicalRow = Number(row.getAttribute('data-row-index')) + 1;
            const rowSelected = logicalRow >= selection.startRow && logicalRow <= selection.endRow;
            if (cell.classList.contains('editor-table-row-header')) {
                if (cell.classList.contains('selected') !== rowSelected) errors.push(`行ヘッダー ${logicalRow}: ${cell.className}`);
                if (cell.classList.contains('selected-row-end') !== (logicalRow === selection.endRow)) errors.push(`行ヘッダー終端 ${logicalRow}: ${cell.className}`);
                continue;
            }
            if (columnText === null) continue;
            const column = Number(columnText) + 1;
            const selected = rowSelected && column >= selection.startColumn && column <= selection.endColumn;
            const expectedClasses: Record<string, boolean> = {
                'sel-bg': selected && !(logicalRow === selection.startRow && column === selection.startColumn),
                'sel-top': selected && logicalRow === selection.startRow,
                'sel-bottom': selected && logicalRow === selection.endRow,
                'sel-left': selected && column === selection.startColumn,
                'sel-right': selected && column === selection.endColumn,
            };
            for (const [name, expected] of Object.entries(expectedClasses)) {
                if (cell.classList.contains(name) !== expected) errors.push(`セル ${logicalRow},${column} ${name}: ${cell.className}`);
            }
        }
        return errors;
    }, range);
    expect(mismatches).toEqual([]);
}

async function readMetricsAsync(session: CDPSession): Promise<Record<string, number>> {
    const result = await session.send('Performance.getMetrics');
    const metrics: Record<string, number> = {};
    for (const name of ['LayoutCount', 'LayoutDuration', 'RecalcStyleCount', 'RecalcStyleDuration', 'ScriptDuration', 'TaskDuration']) {
        const metric = result.metrics.find(entry => entry.name === name);
        if (!metric) throw new Error(`Performance metric ${name} がありません`);
        metrics[name] = metric.value;
    }
    return metrics;
}

for (const frozen of [false, true]) {
    for (const mode of ['セル', '行', '列'] as const) {
        test(`${frozen ? '固定行列あり' : '通常'}の${mode}ドラッグは罫線を再生成せず同じ終点でDOM更新と通知を行わない`, async ({page, context}) => {
            const table = await openTableAsync(page, frozen);
            if (mode === '行') {
                // 初期選択行のヘッダーでは行移動になるため、測定前に別行へ選択を移す。
                await dataCell(table, frozen, 8, 0).click();
                await settleFramesAsync(page);
            }
            const firstCell = dataCell(table, frozen, 0, 0);
            const start = mode === '行'
                ? table.locator(`${frozen ? '.editor-table-detached-frozen-corner-layer' : '.editor-table-detached-row-header-layer'} [data-row-index="0"] .editor-table-row-header`)
                : mode === '列' ? table.locator(`.editor-table-${frozen ? 'detached-corner-layer' : 'detached-column-header-layer'} .editor-table-column-header[data-col="0"]`) : firstCell;
            const startPoint = await centerAsync(start);
            const farPoint = await centerAsync(dataCell(table, frozen, 5, 3));
            const nearCell = dataCell(table, frozen, 3, 2);
            const nearPoint = await centerAsync(nearCell);
            const session = await context.newCDPSession(page);
            await session.send('Performance.enable');
            await page.mouse.move(startPoint.x, startPoint.y);
            await installProbeAsync(page);
            const before = await readMetricsAsync(session);
            await page.mouse.down();
            // ヘッダーから本文へ直接移動し、自動スクロールを発生させず選択更新だけを測る。
            await page.mouse.move(farPoint.x, farPoint.y);
            await settleFramesAsync(page);
            const farRange = {startRow: 1, startColumn: 1, endRow: mode === '列' ? rowCount + 1 : 6, endColumn: mode === '行' ? columnCount : 4};
            expect(await readRangeAsync(page)).toEqual(farRange);
            await expectSelectionClassesAsync(table, farRange);

            await page.mouse.move(nearPoint.x, nearPoint.y, {steps: 20});
            await settleFramesAsync(page);
            const nearRange = {...farRange, endRow: mode === '列' ? rowCount + 1 : 4, endColumn: mode === '行' ? columnCount : 3};
            expect(await readRangeAsync(page)).toEqual(nearRange);
            await expectSelectionClassesAsync(table, nearRange);
            if (mode === 'セル') {
                const firstBox = await firstCell.boundingBox();
                const lastBox = await nearCell.boundingBox();
                if (firstBox === null || lastBox === null) throw new Error('選択範囲のセルがありません');
                const borders = page.locator(`${wrapperSelector} .selection-overlay-border`);
                await expect(borders.first()).toBeVisible();
                const border = await borders.evaluateAll(elements => {
                    const rects = elements.map(element => element.getBoundingClientRect());
                    return {left: Math.min(...rects.map(rect => rect.left)), top: Math.min(...rects.map(rect => rect.top)), right: Math.max(...rects.map(rect => rect.right)), bottom: Math.max(...rects.map(rect => rect.bottom))};
                });
                expect(Math.abs(border.left - firstBox.x)).toBeLessThanOrEqual(2);
                expect(Math.abs(border.top - firstBox.y)).toBeLessThanOrEqual(2);
                expect(Math.abs(border.right - lastBox.x - lastBox.width)).toBeLessThanOrEqual(2);
                expect(Math.abs(border.bottom - lastBox.y - lastBox.height)).toBeLessThanOrEqual(2);
            }
            const expanded = await page.evaluate(() => {
                const probe = (window as SelectionTestWindow).selectionDragProbe;
                const result = {gridMutations: probe.gridMutations, retainedLines: probe.lines.every(line => line.isConnected), notifications: probe.notifications};
                probe.mutations = 0;
                probe.notifications = 0;
                return result;
            });
            const during = await readMetricsAsync(session);
            // 終点のセル内で細かく動くイベントは範囲を変えない。
            await page.mouse.move(nearPoint.x + 3, nearPoint.y + 3, {steps: 20});
            await page.mouse.move(nearPoint.x, nearPoint.y, {steps: 20});
            await settleFramesAsync(page);
            const unchanged = await page.evaluate(() => {
                const probe = (window as SelectionTestWindow).selectionDragProbe;
                return {mutations: probe.mutations, notifications: probe.notifications};
            });
            const after = await readMetricsAsync(session);
            const delta = (startMetrics: Record<string, number>, endMetrics: Record<string, number>): Record<string, number> => Object.fromEntries(Object.keys(startMetrics).map(name => [name, endMetrics[name] - startMetrics[name]]));
            await page.evaluate(metrics => console.log('selection-drag-performance', JSON.stringify(metrics)), {
                frozen, mode, expansion: {...expanded, metrics: delta(before, during)}, unchanged: {...unchanged, metrics: delta(during, after)},
            });
            await page.mouse.up();
            await session.detach();
            expect(await readRangeAsync(page)).toEqual(nearRange);
            expect(expanded.notifications).toBeGreaterThan(0);
            expect.soft(expanded.gridMutations, '選択の拡張・縮小で罫線を再生成しない').toBe(0);
            expect.soft(expanded.retainedLines, '測定開始時の罫線DOMを保持する').toBe(true);
            expect.soft(unchanged.mutations, '同じ終点ではDOMを変更しない').toBe(0);
            expect.soft(unchanged.notifications, '同じ終点では選択変更を通知しない').toBe(0);
        });
    }
}

test('列ドラッグ中に終点列を変えず仮想スクロールしても新しい表示行に選択を適用する', async ({page}) => {
    const table = await openTableAsync(page, true);
    const columnHeader = table.locator('.editor-table-detached-column-header-layer .editor-table-column-header[data-col="2"]');
    const headerPoint = await centerAsync(columnHeader);
    const bodyPoint = await centerAsync(dataCell(table, true, 5, 2));
    await page.mouse.move(headerPoint.x, headerPoint.y);
    await page.mouse.down();
    await page.mouse.move(bodyPoint.x, bodyPoint.y);
    const range = await readRangeAsync(page);
    await page.evaluate(() => {
        const activeTable = (window as SelectionTestWindow).editor.activeEditorTable;
        if (activeTable === false) throw new Error('選択対象のテーブルがありません');
        activeTable.scrollByInput(5000, 0);
    });
    await settleFramesAsync(page);
    // スクロール後も同じ列上で mousemove を発生させ、終点不変の最適化と行再生成を組み合わせる。
    await page.mouse.move(bodyPoint.x + 1, bodyPoint.y);
    await settleFramesAsync(page);
    const visibleRowIndices = await table.locator('.editor-table-grid .editor-table-row[data-row-index]').evaluateAll(rows => rows.map(row => Number(row.getAttribute('data-row-index'))));
    expect(Math.max(...visibleRowIndices)).toBeGreaterThan(100);
    expect(await readRangeAsync(page)).toEqual(range);
    await expectSelectionClassesAsync(table, range);
    await page.mouse.up();
});

test('圧縮スクロールの論理位置だけの変化は通知し同じ位置の再設定は通知しない', async ({page}) => {
    await openTableAsync(page, false);
    const result = await page.evaluate(() => {
        interface ScrollBindingForTest {
            setScrollPosition(top: number, left: number): void;
            setVerticalScrollMapper(fromPhysical: (top: number) => number, fromLogical: (top: number) => number): void;
        }
        const table = (window as unknown as {editor: {activeEditorTable: {scrollBinding: {constructor: new (container: HTMLElement) => ScrollBindingForTest}} | false}}).editor.activeEditorTable;
        if (table === false) throw new Error('スクロールのテスト対象がありません');
        // 本物のコントローラーとDOMを使い、大量データを生成せず物理座標の丸めを再現する。
        const viewport = document.createElement('div');
        viewport.style.cssText = 'position:fixed;left:0;top:0;width:100px;height:100px;overflow:scroll';
        const content = document.createElement('div');
        content.style.cssText = 'width:2000px;height:2000px';
        viewport.appendChild(content);
        document.body.appendChild(viewport);
        const binding = new table.scrollBinding.constructor(viewport);
        let logicalTop = 0;
        binding.setVerticalScrollMapper(() => logicalTop, top => {
            logicalTop = Math.max(0, Math.min(top, 1000));
            return logicalTop / 1000;
        });
        let notifications = 0;
        viewport.addEventListener('scroll', () => notifications++);
        binding.setScrollPosition(6, 0);
        const logicalMove = {physicalTop: viewport.scrollTop, logicalTop, notifications};
        binding.setScrollPosition(6, 0);
        const unchanged = notifications;
        binding.setScrollPosition(-1, 0);
        const clampedMove = {physicalTop: viewport.scrollTop, logicalTop, notifications};
        binding.setScrollPosition(-1, 0);
        const clampedUnchanged = notifications;
        binding.setScrollPosition(0, 25);
        const horizontalMove = {left: viewport.scrollLeft, notifications};
        binding.setScrollPosition(0, 25);
        const horizontalUnchanged = notifications;
        viewport.remove();
        return {logicalMove, unchanged, clampedMove, clampedUnchanged, horizontalMove, horizontalUnchanged};
    });
    expect(result.logicalMove).toEqual({physicalTop: 0, logicalTop: 6, notifications: 1});
    expect(result.unchanged).toBe(1);
    expect(result.clampedMove).toEqual({physicalTop: 0, logicalTop: 0, notifications: 2});
    expect(result.clampedUnchanged).toBe(2);
    expect(result.horizontalMove).toEqual({left: 25, notifications: 3});
    expect(result.horizontalUnchanged).toBe(3);
});
