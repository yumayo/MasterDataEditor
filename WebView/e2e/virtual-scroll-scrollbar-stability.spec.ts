import { test, expect } from './fixtures/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// バーチャルスクロール スクロールバー安定性テスト
//
// 仮想スクロールでゆっくりスクロールしたとき、scrollHeight が一定に保たれることを検証する。
// DPIスケーリング時に offsetHeight（整数）と実際のレンダリング高さ（小数）の差異により
// スペーサー高さが変動し、スクロールバーのつまみ位置がずれる問題を検出する。
// =============================================================================

function generateCsv(rowCount: number): string {
    const rows = ['id,name,value'];
    for (let i = 1; i <= rowCount; i++) {
        rows.push(`${i},item_${i},${i * 10}`);
    }
    return rows.join('\n');
}

function createFileSystem(): MockFileSystem {
    return {
        'schema/item.json': JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int' },
                { key: 1, name: 'name', type: 'string' },
                { key: 2, name: 'value', type: 'int' },
            ],
            primary_key: ['id'],
        }),
        'data/item.csv': generateCsv(1000),
    };
}

test.describe('バーチャルスクロール スクロールバー安定性', () => {
    // DPI 125% でスクロールバーのつまみずれを再現する
    test.use({ deviceScaleFactor: 1.25 });

    test('スクロール中にscrollHeightが一定に保たれる', async ({ page }) => {
        const fs = createFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        // テーブルを開く
        await page.locator('#explorer .explorer-file').getByText('item', { exact: true }).click();
        const table = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="item"] .editor-table');
        await expect(table).toBeVisible();

        const scrollContainer = page.locator('.editor-left-pane');

        // 初期表示時のscrollHeightを記録する
        const initialScrollHeight = await scrollContainer.evaluate((el) => el.scrollHeight);
        console.log(`初期scrollHeight: ${initialScrollHeight}`);

        // 複数のスクロール位置でscrollHeightを測定し、変動がないことを確認する
        // ゆっくりスクロールすると仮想スクロールの行入れ替えが複数回発生する
        const scrollPositions = [100, 500, 2000, 5000, 10000, 15000, 18000, 10000, 5000, 0];
        const scrollHeights: number[] = [initialScrollHeight];

        for (const targetScrollTop of scrollPositions) {
            await scrollContainer.evaluate((el, top) => { el.scrollTop = top; }, targetScrollTop);
            // スクロールイベント処理とDOM更新を待つ
            await page.waitForTimeout(100);
            const currentScrollHeight = await scrollContainer.evaluate((el) => el.scrollHeight);
            scrollHeights.push(currentScrollHeight);
        }

        console.log(`scrollHeight推移: ${JSON.stringify(scrollHeights)}`);

        // scrollHeightの最大変動幅が2px以内であること
        // DPIスケーリングでoffsetHeight（整数）と実際の行高さ（小数）に差があると
        // 表示行数の変化に応じてscrollHeightが変動し、スクロールバーのつまみがずれる
        const minHeight = Math.min(...scrollHeights);
        const maxHeight = Math.max(...scrollHeights);
        const drift = maxHeight - minHeight;
        console.log(`scrollHeight変動幅: ${drift}px (min=${minHeight}, max=${maxHeight})`);
        expect(drift, `scrollHeightの変動幅が2px以内であること（実際: ${drift}px）`).toBeLessThanOrEqual(2);
    });

    test('右下ビューポートを高速に下端から中央へスクロールしても位置が巻き戻らない', async ({ page }) => {
        const fs = createFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        await page.locator('#explorer .explorer-file').getByText('item', { exact: true }).click();
        const table = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="item"] .editor-table');
        await expect(table).toBeVisible();

        const result = await page.evaluate(() => {
            return new Promise<{
                initialScrollHeight: number;
                finalScrollHeight: number;
                maxScrollTop: number;
                targetScrollTop: number;
                finalScrollTop: number;
                leftPaneScrollTop: number;
                overflowAnchor: string;
                leftPaneOverflowAnchor: string;
            }>((resolve) => {
                const viewport = document.querySelector('.editor-left-pane .editor-table-main-viewport') as HTMLElement | null;
                const leftPane = document.querySelector('.editor-left-pane') as HTMLElement | null;
                if (viewport === null) throw new Error('editor-table-main-viewport が見つかりません');
                if (leftPane === null) throw new Error('editor-left-pane が見つかりません');

                const initialScrollHeight = viewport.scrollHeight;
                const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
                const targetScrollTop = Math.round(maxScrollTop * 0.5);
                viewport.scrollTop = maxScrollTop;
                viewport.dispatchEvent(new Event('scroll'));

                let frame = 0;
                const totalFrames = 12;
                const start = maxScrollTop;

                function step() {
                    frame++;
                    const progress = frame / totalFrames;
                    viewport.scrollTop = Math.round(start + ((targetScrollTop - start) * progress));
                    viewport.dispatchEvent(new Event('scroll'));

                    if (frame < totalFrames) {
                        requestAnimationFrame(step);
                        return;
                    }

                    requestAnimationFrame(() => {
                        resolve({
                            initialScrollHeight,
                            finalScrollHeight: viewport.scrollHeight,
                            maxScrollTop,
                            targetScrollTop,
                            finalScrollTop: viewport.scrollTop,
                            leftPaneScrollTop: leftPane.scrollTop,
                            overflowAnchor: window.getComputedStyle(viewport).getPropertyValue('overflow-anchor'),
                            leftPaneOverflowAnchor: window.getComputedStyle(leftPane).getPropertyValue('overflow-anchor'),
                        });
                    });
                }

                requestAnimationFrame(step);
            });
        });

        const drift = Math.abs(result.finalScrollHeight - result.initialScrollHeight);
        console.log(`mainViewport scrollHeight drift: ${drift}px`);
        console.log(`target=${result.targetScrollTop}, final=${result.finalScrollTop}, leftPane=${result.leftPaneScrollTop}, max=${result.maxScrollTop}`);

        expect(drift, '右下ビューポートのscrollHeightが高速スクロール後も安定していること').toBeLessThanOrEqual(2);
        expect(result.overflowAnchor, '仮想スクロールの行差し替え中にブラウザがscrollTopを補正しないこと').toBe('none');
        expect(result.leftPaneOverflowAnchor, '互換スクロール領域の同期中にブラウザがscrollTopを補正しないこと').toBe('none');
        expect(
            Math.abs(result.finalScrollTop - result.targetScrollTop),
            `高速スクロール後のscrollTopが目標から大きくずれています: target=${result.targetScrollTop}, final=${result.finalScrollTop}`
        ).toBeLessThanOrEqual(2);
    });

    test('巨大テーブルではmain-contentの物理heightを抑えつつ末尾行までスクロールできる', async ({ page }) => {
        const rowCount = 60000;
        const fs: MockFileSystem = {
            'schema/big_table.json': JSON.stringify({
                header: [
                    { key: 0, name: 'id', type: 'int' },
                    { key: 1, name: 'name', type: 'string' },
                    { key: 2, name: 'value', type: 'int' },
                ],
                primary_key: ['id'],
            }),
            'data/big_table.csv': generateCsv(rowCount),
        };
        await installMockApiAsync(page, fs);
        await page.goto('/');

        await page.locator('#explorer .explorer-file').getByText('big_table', { exact: true }).click();
        const table = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="big_table"] .editor-table');
        await expect(table).toBeVisible();

        const initial = await page.evaluate(() => {
            const viewport = document.querySelector<HTMLElement>('.editor-left-pane .editor-table-main-viewport');
            const content = viewport?.querySelector<HTMLElement>('.editor-table-main-content') ?? null;
            const editor = (window as unknown as {
                editor?: {
                    activeEditorTable: {
                        getScrollMetrics(): { scrollHeight: number; clientHeight: number };
                        getPhysicalScrollMetrics(): { scrollHeight: number; clientHeight: number };
                    } | false;
                };
            }).editor;
            if (viewport === null) throw new Error('viewport not found');
            if (content === null) throw new Error('content not found');
            if (!editor || editor.activeEditorTable === false) throw new Error('activeEditorTable not found');
            return {
                contentHeight: Number.parseFloat(content.style.height),
                viewportClientHeight: viewport.clientHeight,
                viewportScrollHeight: viewport.scrollHeight,
                logicalScrollHeight: editor.activeEditorTable.getScrollMetrics().scrollHeight,
                physicalScrollHeight: editor.activeEditorTable.getPhysicalScrollMetrics().scrollHeight,
                nativeOverflowY: window.getComputedStyle(viewport).overflowY,
                customTrackDisplay: window.getComputedStyle(document.querySelector<HTMLElement>('.editor-left-pane .editor-table-logical-vertical-scrollbar')!).display,
                customTrackHeight: document.querySelector<HTMLElement>('.editor-left-pane .editor-table-logical-vertical-scrollbar')!.clientHeight,
                customThumbHeight: document.querySelector<HTMLElement>('.editor-left-pane .editor-table-logical-vertical-scrollbar-thumb')!.offsetHeight,
            };
        });

        expect(initial.contentHeight).toBeLessThanOrEqual(262_144);
        expect(initial.viewportScrollHeight).toBeLessThanOrEqual(262_144);
        expect(initial.physicalScrollHeight).toBeLessThanOrEqual(262_144);
        expect(initial.contentHeight).toBeGreaterThan(initial.viewportClientHeight * 10);
        expect(initial.logicalScrollHeight).toBeGreaterThan(initial.contentHeight);
        expect(initial.nativeOverflowY).toBe('hidden');
        expect(initial.customTrackDisplay).not.toBe('none');
        expect(initial.customThumbHeight).toBeGreaterThan(0);
        expect(initial.customThumbHeight).toBeLessThan(initial.customTrackHeight / 2);

        const bottom = await page.evaluate(async () => {
            const viewport = document.querySelector<HTMLElement>('.editor-left-pane .editor-table-main-viewport');
            const editor = (window as unknown as {
                editor?: {
                    activeEditorTable: {
                        getScrollMetrics(): { scrollTop: number; scrollHeight: number; clientHeight: number };
                        restoreScrollPosition(scrollTop: number, scrollLeft: number): void;
                    } | false;
                };
            }).editor;
            if (viewport === null) throw new Error('viewport not found');
            if (!editor || editor.activeEditorTable === false) throw new Error('activeEditorTable not found');
            const metrics = editor.activeEditorTable.getScrollMetrics();
            const targetLogicalScrollTop = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
            editor.activeEditorTable.restoreScrollPosition(targetLogicalScrollTop, 0);
            await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
            const rows = Array.from(document.querySelectorAll<HTMLElement>(
                '.editor-left-pane .editor-table-grid .editor-table-row[data-row-index]:not(.editor-table-empty-row)',
            ));
            const rowIndices = rows
                .map(row => Number(row.dataset.rowIndex))
                .filter(rowIndex => Number.isFinite(rowIndex));
            return {
                targetLogicalScrollTop,
                logicalScrollTop: editor.activeEditorTable.getScrollMetrics().scrollTop,
                physicalScrollTop: viewport.scrollTop,
                maxRenderedRowIndex: Math.max(...rowIndices),
            };
        });

        expect(bottom.logicalScrollTop).toBeGreaterThan(bottom.targetLogicalScrollTop - 100);
        expect(bottom.physicalScrollTop).toBeLessThanOrEqual(262_144);
        expect(bottom.maxRenderedRowIndex).toBeGreaterThan(rowCount - 80);
    });

    test('巨大テーブルでもキーボード移動で画面外セルへ自動スクロールする', async ({ page }) => {
        const rowCount = 60000;
        const fs: MockFileSystem = {
            'schema/big_table.json': JSON.stringify({
                header: [
                    { key: 0, name: 'id', type: 'int' },
                    { key: 1, name: 'name', type: 'string' },
                    { key: 2, name: 'value', type: 'int' },
                ],
                primary_key: ['id'],
            }),
            'data/big_table.csv': generateCsv(rowCount),
        };
        await installMockApiAsync(page, fs);
        await page.goto('/');

        await page.locator('#explorer .explorer-file').getByText('big_table', { exact: true }).click();
        const table = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="big_table"] .editor-table');
        await expect(table).toBeVisible();

        const targetCell = table.locator('.editor-table-row[data-row-index="28"] .editor-table-cell[data-col="0"]');
        await targetCell.click();
        const before = await page.evaluate(() => {
            const editor = (window as unknown as {
                editor?: { activeEditorTable: {
                    getScrollMetrics(): { scrollTop: number };
                    getPhysicalScrollMetrics(): { scrollTop: number };
                } | false };
            }).editor;
            if (!editor || editor.activeEditorTable === false) throw new Error('activeEditorTable not found');
            return {
                logicalScrollTop: editor.activeEditorTable.getScrollMetrics().scrollTop,
                physicalScrollTop: editor.activeEditorTable.getPhysicalScrollMetrics().scrollTop,
            };
        });

        for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(100);

        const after = await page.evaluate(() => {
            const editor = (window as unknown as {
                editor?: { activeEditorTable: {
                    getSelection(): { getFocus(): { row: number; column: number } };
                    getScrollMetrics(): { scrollTop: number };
                    getPhysicalScrollMetrics(): { scrollTop: number };
                } | false };
            }).editor;
            const viewport = document.querySelector<HTMLElement>('.editor-left-pane .editor-table-main-viewport');
            if (!editor || editor.activeEditorTable === false) throw new Error('activeEditorTable not found');
            if (viewport === null) throw new Error('viewport not found');
            const focus = editor.activeEditorTable.getSelection().getFocus();
            const focusedCell = document.querySelector<HTMLElement>(
                `.editor-left-pane .editor-table-row[data-row-index="${focus.row - 1}"] .editor-table-cell[data-col="0"]`,
            );
            const viewportRect = viewport.getBoundingClientRect();
            const cellRect = focusedCell?.getBoundingClientRect() ?? null;
            return {
                focus,
                logicalScrollTop: editor.activeEditorTable.getScrollMetrics().scrollTop,
                physicalScrollTop: editor.activeEditorTable.getPhysicalScrollMetrics().scrollTop,
                cellTop: cellRect?.top ?? null,
                cellBottom: cellRect?.bottom ?? null,
                viewportTop: viewportRect.top,
                viewportBottom: viewportRect.bottom,
            };
        });

        expect(after.focus.row).toBe(41);
        expect(after.logicalScrollTop).toBeGreaterThan(before.logicalScrollTop);
        expect(after.physicalScrollTop).toBeGreaterThan(before.physicalScrollTop);
        expect(after.cellTop).not.toBeNull();
        expect(after.cellBottom).not.toBeNull();
        expect(after.cellBottom!).toBeLessThanOrEqual(after.viewportBottom + 1);
        expect(after.cellTop!).toBeGreaterThanOrEqual(after.viewportTop - 1);
    });

    test('下矢印キーで画面外へ移動すると論理scrollTopが20px刻みで安定して進む', async ({ page }) => {
        const rowCount = 60000;
        const fs: MockFileSystem = {
            'schema/big_table.json': JSON.stringify({
                header: [
                    { key: 0, name: 'id', type: 'int' },
                    { key: 1, name: 'name', type: 'string' },
                    { key: 2, name: 'value', type: 'int' },
                ],
                primary_key: ['id'],
            }),
            'data/big_table.csv': generateCsv(rowCount),
        };
        await installMockApiAsync(page, fs);
        await page.goto('/');

        await page.locator('#explorer .explorer-file').getByText('big_table', { exact: true }).click();
        const table = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="big_table"] .editor-table');
        await expect(table).toBeVisible();

        const bottomVisibleDataRowIndex = await page.evaluate(() => {
            const viewport = document.querySelector<HTMLElement>('.editor-left-pane .editor-table-main-viewport');
            if (viewport === null) throw new Error('viewport not found');
            const viewportRect = viewport.getBoundingClientRect();
            const rows = Array.from(document.querySelectorAll<HTMLElement>(
                '.editor-left-pane .editor-table-grid .editor-table-row[data-row-index]:not(.editor-table-empty-row)',
            ));
            const visibleRows = rows
                .map(row => ({ row, rect: row.getBoundingClientRect(), rowIndex: Number(row.dataset.rowIndex) }))
                .filter(entry => Number.isFinite(entry.rowIndex))
                .filter(entry => entry.rect.top >= viewportRect.top - 1 && entry.rect.bottom <= viewportRect.bottom + 1);
            if (visibleRows.length === 0) throw new Error('visible rows not found');
            return Math.max(...visibleRows.map(entry => entry.rowIndex));
        });

        await table
            .locator(`.editor-table-row[data-row-index="${bottomVisibleDataRowIndex}"] .editor-table-cell[data-col="0"]`)
            .click();

        const samples: Array<{ focusRow: number; scrollTop: number; cellTop: number; cellBottom: number; viewportTop: number; viewportBottom: number }> = [];
        for (let i = 0; i < 7; i++) {
            await page.keyboard.press('ArrowDown');
            await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
            samples.push(await page.evaluate(() => {
                const editor = (window as unknown as {
                    editor?: { activeEditorTable: {
                        getSelection(): { getFocus(): { row: number; column: number } };
                        getScrollMetrics(): { scrollTop: number };
                    } | false };
                }).editor;
                const viewport = document.querySelector<HTMLElement>('.editor-left-pane .editor-table-main-viewport');
                if (!editor || editor.activeEditorTable === false) throw new Error('activeEditorTable not found');
                if (viewport === null) throw new Error('viewport not found');
                const focus = editor.activeEditorTable.getSelection().getFocus();
                const focusedCell = document.querySelector<HTMLElement>(
                    `.editor-left-pane .editor-table-row[data-row-index="${focus.row - 1}"] .editor-table-cell[data-col="0"]`,
                );
                if (focusedCell === null) throw new Error('focused cell not found');
                const cellRect = focusedCell.getBoundingClientRect();
                const viewportRect = viewport.getBoundingClientRect();
                return {
                    focusRow: focus.row,
                    scrollTop: editor.activeEditorTable.getScrollMetrics().scrollTop,
                    cellTop: cellRect.top,
                    cellBottom: cellRect.bottom,
                    viewportTop: viewportRect.top,
                    viewportBottom: viewportRect.bottom,
                };
            }));
        }

        const steadyDeltas = samples
            .slice(2)
            .map((sample, index) => sample.scrollTop - samples[index + 1].scrollTop);
        for (const delta of steadyDeltas) {
            expect(delta).toBeCloseTo(20, 5);
        }
        for (const sample of samples.slice(1)) {
            expect(sample.cellBottom).toBeLessThanOrEqual(sample.viewportBottom + 1);
            expect(sample.cellTop).toBeGreaterThanOrEqual(sample.viewportTop - 1);
        }
    });

    test('固定左幅はDOM測定が0pxでもmain gridのleftを0pxへ戻さない', async ({ page }) => {
        const fs = createFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        await page.locator('#explorer .explorer-file').getByText('item', { exact: true }).click();
        const table = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="item"] .editor-table');
        await expect(table).toBeVisible();

        const result = await page.evaluate(() => {
            const grid = document.querySelector<HTMLElement>('.editor-left-pane .editor-table-grid');
            const headerRow = document.querySelector<HTMLElement>('.editor-left-pane .editor-table-grid .editor-table-source-column-header-row');
            const firstDataCell = headerRow?.children[1] as HTMLElement | undefined;
            const editor = (window as unknown as {
                editor?: { activeEditorTable: {
                    getScrollMetrics(): { scrollHeight: number; clientHeight: number };
                    restoreScrollPosition(scrollTop: number, scrollLeft: number): void;
                    refreshDetachedHeaderLayout(): void;
                } | false };
            }).editor;
            if (grid === null) throw new Error('grid not found');
            if (headerRow === null) throw new Error('header row not found');
            if (!(firstDataCell instanceof HTMLElement)) throw new Error('first data cell not found');
            if (!editor || editor.activeEditorTable === false) throw new Error('activeEditorTable not found');

            const initialLeft = grid.style.left;
            const originalHeaderRect = headerRow.getBoundingClientRect.bind(headerRow);
            const originalFirstDataCellRect = firstDataCell.getBoundingClientRect.bind(firstDataCell);
            const headerRect = originalHeaderRect();
            const cellRect = originalFirstDataCellRect();
            Object.defineProperty(headerRow, 'getBoundingClientRect', {
                configurable: true,
                value: () => DOMRect.fromRect({
                    x: headerRect.x,
                    y: headerRect.y,
                    width: headerRect.width,
                    height: headerRect.height,
                }),
            });
            Object.defineProperty(firstDataCell, 'getBoundingClientRect', {
                configurable: true,
                value: () => DOMRect.fromRect({
                    x: headerRect.x,
                    y: cellRect.y,
                    width: cellRect.width,
                    height: cellRect.height,
                }),
            });
            try {
                const metrics = editor.activeEditorTable.getScrollMetrics();
                editor.activeEditorTable.restoreScrollPosition(Math.max(0, metrics.scrollHeight - metrics.clientHeight), 0);
                editor.activeEditorTable.restoreScrollPosition(0, 0);
                editor.activeEditorTable.refreshDetachedHeaderLayout();
                return {
                    initialLeft,
                    afterLeft: grid.style.left,
                };
            } finally {
                Object.defineProperty(headerRow, 'getBoundingClientRect', {
                    configurable: true,
                    value: originalHeaderRect,
                });
                Object.defineProperty(firstDataCell, 'getBoundingClientRect', {
                    configurable: true,
                    value: originalFirstDataCellRect,
                });
            }
        });

        expect(result.initialLeft).not.toBe('0px');
        expect(result.afterLeft).toBe(result.initialLeft);
        expect(result.afterLeft).not.toBe('0px');
    });
});
