import { test, expect } from './fixtures/test';
import type { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// 仮想スクロール × 固定行（freeze row）の統合テスト
//
// 仮想スクロール有効テーブルで固定行を設定した場合、スクロールしても
// 固定行がDOMに残り、transform で固定位置が維持されることを検証する。
//
// 問題:
//   現在の updateRenderedRows() は固定行を特別扱いしない。
//   OVERSCAN範囲外になると固定行もDOMから削除され、位置固定が無効になる。
//
// テストケース:
//   1. 固定行を設定後、下にスクロールしても固定行がDOMに存在し位置固定が維持される
// =============================================================================

/** 1000行のCSVデータを生成する */
function generateCsv(rowCount: number): string {
    const rows = ['id,name,value'];
    for (let i = 1; i <= rowCount; i++) {
        rows.push(`${i},name_${i},${(i * 7) % 100}`);
    }
    return rows.join('\n');
}

/** テスト用ファイルシステム（1000行テーブル + frozenRowCount=2 をスキーマに設定） */
function createFileSystem(): MockFileSystem {
    return {
        'schema/big_table.json': JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int' },
                { key: 1, name: 'name', type: 'string' },
                { key: 2, name: 'value', type: 'int' },
            ],
            primary_key: ['id'],
            frozenRowCount: 2,
        }),
        'data/big_table.csv': generateCsv(1000),
    };
}

function createCommentedFrozenPaneFileSystem(): MockFileSystem {
    return {
        'schema/big_table.json': JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int', comment: '識別子' },
                { key: 1, name: 'name', type: 'string', comment: '表示名' },
                { key: 2, name: 'value', type: 'int', comment: '内部値' },
            ],
            primary_key: ['id'],
            frozenRowCount: 2,
            frozenColumnCount: 1,
        }),
        'data/big_table.csv': generateCsv(1000),
    };
}

function createFiveFrozenRowsFileSystem(): MockFileSystem {
    return {
        'schema/big_table.json': JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int' },
                { key: 1, name: 'name', type: 'string' },
                { key: 2, name: 'value', type: 'int' },
            ],
            primary_key: ['id'],
            frozenRowCount: 5,
        }),
        'data/big_table.csv': generateCsv(1000),
    };
}

/** テーブルを開いてLocatorを返す */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
    const table = page.locator('.editor-left-pane .editor-table');
    await expect(table).toBeVisible();
    return table;
}

async function getTableScrollContainerAsync(page: Page): Promise<Locator> {
    const mainViewport = page.locator('.editor-left-pane .editor-table-main-viewport');
    if (await mainViewport.count() !== 1) throw new Error('main viewport が見つかりません');
    return mainViewport;
}

async function getFrozenRowViewportTopAsync(table: Locator, rowIndex: number): Promise<number> {
    return table.evaluate((tableElement, targetRowIndex) => {
        const detachedRow = tableElement.querySelector<HTMLElement>(`.editor-table-detached-frozen-row-layer .editor-table-detached-row[data-row-index="${targetRowIndex}"]`);
        if (detachedRow instanceof HTMLElement) {
            const cell = detachedRow.querySelector<HTMLElement>('.editor-table-cell');
            if (!(cell instanceof HTMLElement)) throw new Error('固定行の分離セルが見つかりません');
            return cell.getBoundingClientRect().top;
        }
        const sourceRow = tableElement.querySelectorAll<HTMLElement>('.editor-table-row:not(.editor-table-column-header-row):not(.editor-table-empty-row)')[targetRowIndex];
        if (!(sourceRow instanceof HTMLElement)) throw new Error(`固定行が見つかりません: rowIndex=${targetRowIndex}`);
        const cell = sourceRow.querySelector<HTMLElement>('.editor-table-cell:not(.editor-table-row-header)');
        if (!(cell instanceof HTMLElement)) throw new Error('固定行の本文セルが見つかりません');
        return cell.getBoundingClientRect().top;
    }, rowIndex);
}

async function clickVisibleDataCellAsync(table: Locator, rowIndex: number, columnIndex: number): Promise<void> {
    const detachedCell = table.locator([
        `.editor-table-detached-frozen-corner-layer .editor-table-detached-row[data-row-index="${rowIndex}"] .editor-table-cell[data-col="${columnIndex}"]`,
        `.editor-table-detached-frozen-row-layer .editor-table-detached-row[data-row-index="${rowIndex}"] .editor-table-cell[data-col="${columnIndex}"]`,
        `.editor-table-detached-row-header-layer .editor-table-detached-row[data-row-index="${rowIndex}"] .editor-table-cell[data-col="${columnIndex}"]`,
    ].join(',')).first();
    if (await detachedCell.count() > 0) {
        await detachedCell.click();
        return;
    }
    const row = table.locator('.editor-table-row:not(.editor-table-column-header-row):not(.editor-table-empty-row)').nth(rowIndex);
    await row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(columnIndex).click();
}

async function rightClickRowHeaderAsync(table: Locator, dataRowIndex: number): Promise<void> {
    const header = table.locator('.editor-table-detached-row-header-layer .editor-table-row-header').nth(dataRowIndex);
    await header.click({ button: 'right' });
}

async function clickContextMenuItemAsync(page: Page, label: string): Promise<void> {
    const menu = page.locator('.context-menu.visible');
    await expect(menu).toBeVisible();
    await menu.locator('.context-menu-item', { hasText: label }).click();
}

async function installFrozenCellRectCounterAsync(page: Page, dataRowIndex: number, columnIndex: number): Promise<void> {
    await page.evaluate(({ targetRowIndex, targetColumnIndex }) => {
        const trackerWindow = window as unknown as Record<string, unknown> & {
            __trackedFrozenCellRectCount: number | null;
            __trackedFrozenCellRectOriginal: typeof HTMLElement.prototype.getBoundingClientRect | null;
        };
        if (!('__trackedFrozenCellRectCount' in trackerWindow)) trackerWindow.__trackedFrozenCellRectCount = null;
        if (!('__trackedFrozenCellRectOriginal' in trackerWindow)) trackerWindow.__trackedFrozenCellRectOriginal = null;
        const selector = `.editor-table-detached-frozen-row-layer .editor-table-detached-row[data-row-index="${targetRowIndex}"] .editor-table-cell[data-col="${targetColumnIndex}"]`;
        if (!(document.querySelector(selector) instanceof HTMLElement)) {
            throw new Error(`計測対象の固定セルが見つかりません: selector=${selector}`);
        }
        trackerWindow.__trackedFrozenCellRectCount = 0;
        trackerWindow.__trackedFrozenCellRectOriginal = HTMLElement.prototype.getBoundingClientRect;
        HTMLElement.prototype.getBoundingClientRect = function(this: HTMLElement): DOMRect {
            if (this.matches(selector)) {
                if (trackerWindow.__trackedFrozenCellRectCount === null) throw new Error('固定セル計測カウンタが初期化されていません');
                trackerWindow.__trackedFrozenCellRectCount += 1;
            }
            const original = trackerWindow.__trackedFrozenCellRectOriginal;
            if (original === null) throw new Error('元の getBoundingClientRect が見つかりません');
            return original.call(this);
        };
    }, { targetRowIndex: dataRowIndex, targetColumnIndex: columnIndex });
}

async function getFrozenCellRectCountAsync(page: Page): Promise<number> {
    return page.evaluate(() => {
        const trackerWindow = window as unknown as Record<string, unknown> & { __trackedFrozenCellRectCount: number | null };
        if (!('__trackedFrozenCellRectCount' in trackerWindow)) throw new Error('固定セル計測カウンタが初期化されていません');
        if (trackerWindow.__trackedFrozenCellRectCount === null) throw new Error('固定セル計測カウンタが初期化されていません');
        return trackerWindow.__trackedFrozenCellRectCount;
    });
}

async function installMainGridRowOffsetTopCounterAsync(page: Page): Promise<void> {
    await page.evaluate(() => {
        const trackerWindow = window as unknown as Record<string, unknown> & {
            __mainGridRowOffsetTopCount: number | null;
            __mainGridRowOffsetTopDescriptor: PropertyDescriptor | null;
            __mainGridRowOffsetTopPrototype: object | null;
        };
        if (!('__mainGridRowOffsetTopCount' in trackerWindow)) trackerWindow.__mainGridRowOffsetTopCount = null;
        if (!('__mainGridRowOffsetTopDescriptor' in trackerWindow)) trackerWindow.__mainGridRowOffsetTopDescriptor = null;
        if (!('__mainGridRowOffsetTopPrototype' in trackerWindow)) trackerWindow.__mainGridRowOffsetTopPrototype = null;
        let currentPrototype: object | null = document.body;
        let descriptor: PropertyDescriptor | null = null;
        while (currentPrototype !== null) {
            descriptor = Object.getOwnPropertyDescriptor(currentPrototype, 'offsetTop') ?? null;
            if (descriptor !== null) break;
            currentPrototype = Object.getPrototypeOf(currentPrototype);
        }
        if (currentPrototype === null || descriptor === null || typeof descriptor.get !== 'function') {
            throw new Error('offsetTop の元ディスクリプタが見つかりません');
        }
        trackerWindow.__mainGridRowOffsetTopCount = 0;
        trackerWindow.__mainGridRowOffsetTopPrototype = currentPrototype;
        trackerWindow.__mainGridRowOffsetTopDescriptor = descriptor;
        Object.defineProperty(currentPrototype, 'offsetTop', {
            configurable: true,
            get: function(this: HTMLElement): number {
                if (this.classList.contains('editor-table-row')
                    && !this.classList.contains('editor-table-column-header-row')
                    && !this.classList.contains('editor-table-detached-row')
                    && this.closest('.editor-table-grid') !== null) {
                    if (trackerWindow.__mainGridRowOffsetTopCount === null) throw new Error('offsetTop 計測カウンタが初期化されていません');
                    trackerWindow.__mainGridRowOffsetTopCount += 1;
                }
                const originalDescriptor = trackerWindow.__mainGridRowOffsetTopDescriptor;
                if (originalDescriptor === null || typeof originalDescriptor.get !== 'function') {
                    throw new Error('offsetTop の元 getter が失われました');
                }
                return originalDescriptor.get.call(this) as number;
            },
        });
    });
}

async function getMainGridRowOffsetTopCountAsync(page: Page): Promise<number> {
    return page.evaluate(() => {
        const trackerWindow = window as unknown as Record<string, unknown> & { __mainGridRowOffsetTopCount: number | null };
        if (!('__mainGridRowOffsetTopCount' in trackerWindow)) throw new Error('offsetTop 計測カウンタが初期化されていません');
        if (trackerWindow.__mainGridRowOffsetTopCount === null) throw new Error('offsetTop 計測カウンタが初期化されていません');
        return trackerWindow.__mainGridRowOffsetTopCount;
    });
}

async function applyCustomDataRowHeightAsync(page: Page, heightPx: string): Promise<void> {
    await page.addStyleTag({
        content: `
            .editor-table-row:not(.editor-table-column-header-row) .editor-table-cell {
                height: ${heightPx} !important;
                min-height: ${heightPx} !important;
                line-height: ${heightPx} !important;
            }
        `,
    });
}

async function getFirstVisibleQuadrantRowHeaderTopDeltaAsync(table: Locator): Promise<number> {
    return table.evaluate((tableElement) => {
        const detachedRow = tableElement.querySelector<HTMLElement>('.editor-table-detached-row-header-layer .editor-table-detached-row[data-row-index]');
        if (!(detachedRow instanceof HTMLElement)) throw new Error('分離行ヘッダー行が見つかりません');
        const rowIndexText = detachedRow.dataset.rowIndex;
        if (rowIndexText === undefined) throw new Error('分離行ヘッダーに rowIndex がありません');
        const sourceRow = tableElement.querySelector<HTMLElement>(`.editor-table-grid .editor-table-row[data-row-index="${rowIndexText}"]`);
        if (!(sourceRow instanceof HTMLElement)) throw new Error(`元行が見つかりません: rowIndex=${rowIndexText}`);
        const detachedHeader = detachedRow.querySelector<HTMLElement>('.editor-table-row-header');
        const sourceHeader = sourceRow.querySelector<HTMLElement>('.editor-table-row-header');
        if (!(detachedHeader instanceof HTMLElement) || !(sourceHeader instanceof HTMLElement)) {
            throw new Error(`比較対象の行ヘッダーが見つかりません: rowIndex=${rowIndexText}`);
        }
        return Math.abs(detachedHeader.getBoundingClientRect().top - sourceHeader.getBoundingClientRect().top);
    });
}

test.describe('仮想スクロール × 固定行', () => {
    test('固定行を設定後、下にスクロールしても固定行がDOMに存在し位置固定が維持される', async ({ page }) => {
        const fs = createFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        const table = await openTableAsync(page, 'big_table');

        // 初期表示で固定行（データ行0, 1）がDOMに存在することを確認
        const dataRows = table.locator('.editor-table-row:not(.editor-table-column-header-row):not(.editor-table-empty-row)');
        const initialRowCount = await dataRows.count();
        expect(initialRowCount).toBeGreaterThanOrEqual(2);

        // 固定行0/1の初期位置を記録する
        const frozenRow0Top = await getFrozenRowViewportTopAsync(table, 0);

        const frozenRow1Top = await getFrozenRowViewportTopAsync(table, 1);
        expect(frozenRow1Top).toBeGreaterThan(frozenRow0Top);

        // 500行目付近までスクロールする（OVERSCAN=10 をはるかに超える位置）
        const scrollContainer = await getTableScrollContainerAsync(page);
        await scrollContainer.evaluate((el) => { el.scrollTop = 500 * 20; });
        await page.waitForTimeout(300);

        // スクロール後も固定行（データ行0, 1）のID値を持つ行がDOMに存在することを検証する
        // 固定行のIDは "1" と "2"（CSV上の最初の2行）
        const row0IdCell = table.locator('.editor-table-row:not(.editor-table-column-header-row):not(.editor-table-empty-row)')
            .filter({ has: page.locator('.editor-table-row-header[data-row-index="0"]') });
        await expect(row0IdCell).toHaveCount(1);

        const row1IdCell = table.locator('.editor-table-row:not(.editor-table-column-header-row):not(.editor-table-empty-row)')
            .filter({ has: page.locator('.editor-table-row-header[data-row-index="1"]') });
        await expect(row1IdCell).toHaveCount(1);

        // 固定行0/1のビューポート位置が維持されること
        const afterScrollTop0 = await getFrozenRowViewportTopAsync(table, 0);
        expect(Math.abs(afterScrollTop0 - frozenRow0Top)).toBeLessThanOrEqual(2);

        const afterScrollTop1 = await getFrozenRowViewportTopAsync(table, 1);
        expect(Math.abs(afterScrollTop1 - frozenRow1Top)).toBeLessThanOrEqual(2);

        // さらに: ビューポート内にスクロール位置に対応したデータ行も表示されていること
        // （固定行だけでなく、500行目付近の行も表示されている）
        const allVisibleRows = table.locator('.editor-table-row:not(.editor-table-column-header-row):not(.editor-table-empty-row)');
        const visibleCount = await allVisibleRows.count();
        // 固定行2行 + ビューポート内の通常行（少なくとも数行はある）
        expect(visibleCount).toBeGreaterThan(5);
    });

    test('固定5行の元行を右下グリッドで非表示にし通常行に被せない', async ({ page }) => {
        const fs = createFiveFrozenRowsFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        const table = await openTableAsync(page, 'big_table');

        const state = await table.evaluate((tableElement) => {
            const getSourceRow = (dataRowIndex: number): HTMLElement => {
                const row = tableElement.querySelector<HTMLElement>(
                    `.editor-table-grid .editor-table-row[data-row-index="${dataRowIndex}"]`,
                );
                if (!(row instanceof HTMLElement)) throw new Error(`元行が見つかりません: dataRowIndex=${dataRowIndex}`);
                return row;
            };
            const sourceRows = Array.from({ length: 10 }, (_unused, dataRowIndex) => {
                const row = getSourceRow(dataRowIndex);
                const firstCell = row.querySelector<HTMLElement>('.editor-table-cell:not(.editor-table-row-header)');
                if (!(firstCell instanceof HTMLElement)) throw new Error(`本文セルが見つかりません: dataRowIndex=${dataRowIndex}`);
                return {
                    dataRowIndex,
                    visibility: window.getComputedStyle(row).visibility,
                    firstCellText: (firstCell.textContent ?? '').trim(),
                };
            });
            const detachedFrozenRows = Array.from(
                tableElement.querySelectorAll<HTMLElement>('.editor-table-detached-frozen-row-layer .editor-table-detached-row'),
            ).map((row) => {
                const firstCell = row.querySelector<HTMLElement>('.editor-table-cell');
                if (!(firstCell instanceof HTMLElement)) throw new Error('固定行の分離本文セルが見つかりません');
                return {
                    rowIndex: row.dataset.rowIndex ?? '',
                    visibility: window.getComputedStyle(row).visibility,
                    firstCellText: (firstCell.textContent ?? '').trim(),
                };
            });
            return { sourceRows, detachedFrozenRows };
        });

        expect(state.sourceRows.slice(0, 5).map(row => row.visibility)).toEqual([
            'hidden',
            'hidden',
            'hidden',
            'hidden',
            'hidden',
        ]);
        expect(state.sourceRows.slice(5, 10).map(row => row.visibility)).toEqual([
            'visible',
            'visible',
            'visible',
            'visible',
            'visible',
        ]);
        expect(state.sourceRows.slice(5, 10).map(row => row.firstCellText)).toEqual(['6', '7', '8', '9', '10']);
        expect(state.detachedFrozenRows).toEqual([
            { rowIndex: '0', visibility: 'visible', firstCellText: '1' },
            { rowIndex: '1', visibility: 'visible', firstCellText: '2' },
            { rowIndex: '2', visibility: 'visible', firstCellText: '3' },
            { rowIndex: '3', visibility: 'visible', firstCellText: '4' },
            { rowIndex: '4', visibility: 'visible', firstCellText: '5' },
        ]);
    });

    test('固定行を選択してスクロールしてもフィルハンドルが固定行セルの右下に正しく位置する', async ({ page }) => {
        const fs = createFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        const table = await openTableAsync(page, 'big_table');

        // 固定行のセル（データ行0, value列）をクリックして選択する
        const dataRows = table.locator('.editor-table-row:not(.editor-table-column-header-row):not(.editor-table-empty-row)');
        await clickVisibleDataCellAsync(table, 0, 2);

        // まずスクロールを一度行って、仮想スクロールの表示範囲を安定させる。
        // 初回描画では renderedEnd が大きく、スクロール時に行入れ替えが発生して
        // afterRowsUpdated → updateFillHandlePosition が呼ばれてしまう。
        // 安定後の微小スクロールでは行入れ替えが発生しないため、
        // 修正前は updateFillHandlePosition が呼ばれず fillHandle の位置がずれる。
        const scrollContainer = await getTableScrollContainerAsync(page);
        await scrollContainer.evaluate((el) => { el.scrollTop = 1; });
        await page.waitForTimeout(50);

        // 安定後の fillHandle とホストセル右下の相対位置を記録する
        const initialOffset = await page.evaluate(() => {
            const handle = document.querySelector('.fill-handle') as HTMLElement;
            const host = handle.parentElement as HTMLElement | null;
            if (!(host instanceof HTMLElement)) throw new Error('fillHandle のホストセルが見つかりません');
            const handleRect = handle.getBoundingClientRect();
            const hostRect = host.getBoundingClientRect();
            return {
                right: handleRect.right - hostRect.right,
                bottom: handleRect.bottom - hostRect.bottom,
            };
        });

        // 2回目の微小スクロール: 行入れ替えが発生しない量（1px追加）
        const scrollAmount = 5;
        await scrollContainer.evaluate((el, amount) => { el.scrollTop += amount; }, scrollAmount);
        await page.waitForTimeout(50);

        // スクロール後もセル右下に対する相対位置が維持されることを確認する
        const afterScrollOffset = await page.evaluate(() => {
            const handle = document.querySelector('.fill-handle') as HTMLElement;
            const host = handle.parentElement as HTMLElement | null;
            if (!(host instanceof HTMLElement)) throw new Error('fillHandle のホストセルが見つかりません');
            const handleRect = handle.getBoundingClientRect();
            const hostRect = host.getBoundingClientRect();
            return {
                right: handleRect.right - hostRect.right,
                bottom: handleRect.bottom - hostRect.bottom,
            };
        });

        expect(Math.abs(afterScrollOffset.right - initialOffset.right)).toBeLessThanOrEqual(1);
        expect(Math.abs(afterScrollOffset.bottom - initialOffset.bottom)).toBeLessThanOrEqual(1);
    });

    test('固定行選択で表示レンジ更新を伴うスクロールでも fillHandle のセル計測は1回で済む', async ({ page }) => {
        const fs = createFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        const table = await openTableAsync(page, 'big_table');
        await clickVisibleDataCellAsync(table, 0, 2);

        const scrollContainer = await getTableScrollContainerAsync(page);
        await scrollContainer.evaluate((el) => { el.scrollTop = 1; });
        await page.waitForTimeout(50);

        await installFrozenCellRectCounterAsync(page, 0, 2);

        await scrollContainer.evaluate((el) => { el.scrollTop = 70 * 20; });
        await page.waitForTimeout(100);

        await expect.poll(async () => getFrozenCellRectCountAsync(page)).toBeLessThanOrEqual(2);
    });

    test('表示レンジ更新を伴うスクロールでも main grid 行の offsetTop を読み直さない', async ({ page }) => {
        const fs = createFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        await openTableAsync(page, 'big_table');
        const scrollContainer = await getTableScrollContainerAsync(page);

        await scrollContainer.evaluate((el) => { el.scrollTop = 1; });
        await page.waitForTimeout(50);

        await installMainGridRowOffsetTopCounterAsync(page);

        await scrollContainer.evaluate((el) => { el.scrollTop = 70 * 20; });
        await page.waitForTimeout(100);

        await expect.poll(async () => getMainGridRowOffsetTopCountAsync(page)).toBe(0);
    });

    test('コメント付きヘッダーと固定列を併用して行高が変わっても quadrant 行ヘッダーが本文と揃う', async ({ page }) => {
        const fs = createCommentedFrozenPaneFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
        await applyCustomDataRowHeightAsync(page, '25.5px');

        const table = await openTableAsync(page, 'big_table');
        const scrollContainer = await getTableScrollContainerAsync(page);

        await scrollContainer.evaluate((el) => { el.scrollTop = 2600; });
        await page.waitForTimeout(100);

        await expect.poll(async () => getFirstVisibleQuadrantRowHeaderTopDeltaAsync(table)).toBeLessThanOrEqual(2);
    });

    test('quadrant レイアウトでもセル選択時に分離行ヘッダーの selected 状態が同期される', async ({ page }) => {
        const fs = createFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        const table = await openTableAsync(page, 'big_table');
        await clickVisibleDataCellAsync(table, 5, 1);

        await expect(table.locator('.editor-table-detached-row-header-layer .editor-table-row-header[data-row-index="5"]')).toHaveClass(/selected/);
    });

    test('1行目の固定を解除した後に1行目1列目をクリックしても先頭行が重複しない', async ({ page }) => {
        const fs = createFileSystem();
        delete fs['schema/big_table.json'];
        fs['schema/big_table.json'] = JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int' },
                { key: 1, name: 'name', type: 'string' },
                { key: 2, name: 'value', type: 'int' },
            ],
            primary_key: ['id'],
        });
        await installMockApiAsync(page, fs);
        await page.goto('/');

        const table = await openTableAsync(page, 'big_table');

        await rightClickRowHeaderAsync(table, 0);
        await clickContextMenuItemAsync(page, 'この行まで固定');
        await rightClickRowHeaderAsync(table, 0);
        await clickContextMenuItemAsync(page, '行の固定を解除');

        const firstDataCell = table.locator('.editor-table-row:not(.editor-table-column-header-row):not(.editor-table-empty-row)').nth(0)
            .locator('.editor-table-cell:not(.editor-table-row-header)').nth(0);
        await firstDataCell.click();

        await expect.poll(async () => {
            return table.locator('.editor-table-row:not(.editor-table-column-header-row):not(.editor-table-empty-row)')
                .evaluateAll((rowElements) => {
                    return rowElements.slice(0, 3).map((rowElement) => {
                        const cells = Array.from(rowElement.children) as HTMLElement[];
                        return {
                            rowHeader: (cells[0]?.textContent ?? '').trim(),
                            id: (cells[1]?.textContent ?? '').trim(),
                            name: (cells[2]?.textContent ?? '').trim(),
                        };
                    });
                });
        }).toEqual([
            { rowHeader: '1', id: '1', name: 'name_1' },
            { rowHeader: '2', id: '2', name: 'name_2' },
            { rowHeader: '3', id: '3', name: 'name_3' },
        ]);
    });
});
