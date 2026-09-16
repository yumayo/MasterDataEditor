import { test, expect } from './fixtures/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';
import type { Page } from '@playwright/test';

function createPerformanceGroupFileSystem(frozenRowCount: number): MockFileSystem {
    const rows: string[] = ['id,group_id,label,score,rank,export_begin_date,export_end_date'];
    const ranks = ['S', 'A', 'B', 'C', 'D'];
    for (let i = 1; i <= 1000; i++) {
        rows.push([
            `${i}`,
            `${Math.ceil(i / 100)}`,
            `group_${String(i).padStart(3, '0')}`,
            `${(i * 379) % 10000}`,
            ranks[i % ranks.length],
            '',
            '',
        ].join(','));
    }

    return {
        'schema/performance_group.json': JSON.stringify({
            description: 'パフォーマンステスト用グループマスター',
            header: [
                { key: 0, name: 'id', type: 'int', comment: 'ID', width: 100 },
                { key: 1, name: 'group_id', type: 'int', comment: 'グループID', width: 100 },
                { key: 2, name: 'label', type: 'string', comment: 'ラベル', width: 150 },
                { key: 3, name: 'score', type: 'int', comment: 'スコア', width: 100 },
                { key: 4, name: 'rank', type: 'string', comment: 'ランク', width: 100 },
                { key: 5, name: 'export_begin_date', type: 'datetime', comment: '出力予定日', width: 187 },
                { key: 6, name: 'export_end_date', type: 'datetime', comment: '削除予定日', width: 175 },
            ],
            primary_key: ['id'],
            frozenRowCount,
            frozenColumnCount: 2,
        }),
        'data/performance_group.csv': rows.join('\n'),
    };
}

async function readQuadrantColumnMetrics(page: Page): Promise<{
    scrollLeft: number;
    headerLabelLeft: number;
    frozenRowLabelLeft: number;
    bodyLabelLeft: number;
    bodyFrozenIdRight: number;
    bottomRightLeft: number;
}> {
    return await page.evaluate(async () => {
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

        const root = document.querySelector<HTMLElement>('.editor-left-pane .tab-wrapper[data-tab-name="performance_group"] .editor-table');
        const viewport = root?.querySelector<HTMLElement>('.editor-table-main-viewport') ?? null;
        const bottomRightPane = root?.querySelector<HTMLElement>('.editor-table-pane-bottom-right') ?? null;
        const headerLabel = root?.querySelector<HTMLElement>('.editor-table-pane-top-right .editor-table-column-header[data-col="2"]') ?? null;
        const frozenRowLabel = root?.querySelector<HTMLElement>('.editor-table-detached-frozen-row-layer .editor-table-detached-row[data-row-index="4"] .editor-table-cell[data-col="2"]') ?? null;
        const bodyLabel = root?.querySelector<HTMLElement>('.editor-table-grid .editor-table-row[data-row-index="5"] .editor-table-cell[data-col="2"]') ?? null;
        const bodyFrozenId = root?.querySelector<HTMLElement>('.editor-table-grid .editor-table-row[data-row-index="5"] .editor-table-cell[data-col="0"]') ?? null;
        if (root === null) throw new Error('editor-table が見つかりません');
        if (viewport === null) throw new Error('main viewport が見つかりません');
        if (bottomRightPane === null) throw new Error('bottom-right pane が見つかりません');
        if (headerLabel === null) throw new Error('label ヘッダーが見つかりません');
        if (frozenRowLabel === null) throw new Error('固定行 label セルが見つかりません');
        if (bodyLabel === null) throw new Error('通常行 label セルが見つかりません');
        if (bodyFrozenId === null) throw new Error('通常行 id セルが見つかりません');

        const headerLabelRect = headerLabel.getBoundingClientRect();
        const frozenRowLabelRect = frozenRowLabel.getBoundingClientRect();
        const bodyLabelRect = bodyLabel.getBoundingClientRect();
        const bodyFrozenIdRect = bodyFrozenId.getBoundingClientRect();
        const bottomRightRect = bottomRightPane.getBoundingClientRect();

        return {
            scrollLeft: viewport.scrollLeft,
            headerLabelLeft: headerLabelRect.left,
            frozenRowLabelLeft: frozenRowLabelRect.left,
            bodyLabelLeft: bodyLabelRect.left,
            bodyFrozenIdRight: bodyFrozenIdRect.right,
            bottomRightLeft: bottomRightRect.left,
        };
    });
}

async function readQuadrantRowMetrics(page: Page): Promise<{
    scrollTop: number;
    frozenRowTop: number;
    viewportRowIndex: number;
    leftHeaderTop: number;
    bodyLabelTop: number;
    bodyLabelLeft: number;
    headerLabelLeft: number;
}> {
    return await page.evaluate(async () => {
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

        const root = document.querySelector<HTMLElement>('.editor-left-pane .tab-wrapper[data-tab-name="performance_group"] .editor-table');
        const frozenRow = root?.querySelector<HTMLElement>('.editor-table-detached-frozen-row-layer .editor-table-detached-row[data-row-index="4"]') ?? null;
        const detachedViewportRow = root?.querySelector<HTMLElement>('.editor-table-detached-row-header-layer .editor-table-detached-row') ?? null;
        const headerLabel = root?.querySelector<HTMLElement>('.editor-table-pane-top-right .editor-table-column-header[data-col="2"]') ?? null;
        if (root === null) throw new Error('editor-table が見つかりません');
        if (frozenRow === null) throw new Error('固定行が見つかりません');
        if (detachedViewportRow === null) throw new Error('左固定列の表示行が見つかりません');
        if (headerLabel === null) throw new Error('label ヘッダーが見つかりません');

        const rowIndexText = detachedViewportRow.dataset.rowIndex;
        if (rowIndexText === undefined) throw new Error('左固定列の表示行に rowIndex がありません');
        const viewportRowIndex = Number(rowIndexText);
        const bodyLabel = root.querySelector<HTMLElement>(`.editor-table-grid .editor-table-row[data-row-index="${viewportRowIndex}"] .editor-table-cell[data-col="2"]`);
        if (bodyLabel === null) throw new Error(`通常行 label セルが見つかりません: rowIndex=${viewportRowIndex}`);

        const editor = (window as unknown as {
            editor?: {
                activeEditorTable: {
                    getScrollMetrics(): { scrollTop: number };
                } | false;
            };
        }).editor;
        if (!editor || editor.activeEditorTable === false) throw new Error('activeEditorTable が見つかりません');

        const frozenRowRect = frozenRow.getBoundingClientRect();
        const detachedViewportRowRect = detachedViewportRow.getBoundingClientRect();
        const bodyLabelRect = bodyLabel.getBoundingClientRect();
        const headerLabelRect = headerLabel.getBoundingClientRect();

        return {
            scrollTop: editor.activeEditorTable.getScrollMetrics().scrollTop,
            frozenRowTop: frozenRowRect.top,
            viewportRowIndex,
            leftHeaderTop: detachedViewportRowRect.top,
            bodyLabelTop: bodyLabelRect.top,
            bodyLabelLeft: bodyLabelRect.left,
            headerLabelLeft: headerLabelRect.left,
        };
    });
}

test('固定2列5行で横スクロールバーを左へ引っ張っても本文列が固定列の下へ残らない', async ({ page }) => {
    await page.setViewportSize({ width: 1160, height: 580 });
    await installMockApiAsync(page, createPerformanceGroupFileSystem(5));
    await page.goto('/');

    await page.locator('#explorer .explorer-file').getByText('performance_group', { exact: true }).click();
    const table = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="performance_group"] .editor-table');
    await expect(table).toBeVisible();

    await page.evaluate(() => {
        const editor = (window as unknown as {
            editor?: {
                activeEditorTable: {
                    restoreScrollPosition(scrollTop: number, scrollLeft: number): void;
                } | false;
            };
        }).editor;
        if (!editor || editor.activeEditorTable === false) throw new Error('activeEditorTable が見つかりません');
        editor.activeEditorTable.restoreScrollPosition(0, 280);
    });
    await expect.poll(async () => {
        return await page.locator('.editor-left-pane .editor-table-main-viewport').evaluate((element) => element.scrollLeft);
    }).toBeGreaterThan(100);

    const horizontalScrollbar = page.locator('.editor-left-pane .editor-table-logical-horizontal-scrollbar').first();
    const horizontalThumb = page.locator('.editor-left-pane .editor-table-logical-horizontal-scrollbar-thumb').first();
    await expect(horizontalScrollbar).toBeVisible();
    await expect(horizontalThumb).toBeVisible();

    const trackBox = await horizontalScrollbar.boundingBox();
    const thumbBox = await horizontalThumb.boundingBox();
    if (trackBox === null || thumbBox === null) throw new Error('横スクロールバーの座標が取得できません');
    const y = thumbBox.y + (thumbBox.height / 2);
    await page.mouse.move(thumbBox.x + (thumbBox.width / 2), y);
    await page.mouse.down();
    await page.mouse.move(trackBox.x - 120, y, { steps: 8 });
    await page.mouse.up();

    const metrics = await readQuadrantColumnMetrics(page);

    expect(metrics.scrollLeft).toBeLessThanOrEqual(1);
    expect(Math.abs(metrics.frozenRowLabelLeft - metrics.headerLabelLeft)).toBeLessThanOrEqual(1);
    expect(Math.abs(metrics.bodyLabelLeft - metrics.headerLabelLeft)).toBeLessThanOrEqual(1);
    expect(metrics.bodyFrozenIdRight).toBeLessThanOrEqual(metrics.bottomRightLeft + 1);
});

test('横スクロールバーを押している間と離した後で固定行列の列位置が一致する', async ({ page }) => {
    await page.setViewportSize({ width: 1160, height: 580 });
    await installMockApiAsync(page, createPerformanceGroupFileSystem(5));
    await page.goto('/');

    await page.locator('#explorer .explorer-file').getByText('performance_group', { exact: true }).click();
    const table = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="performance_group"] .editor-table');
    await expect(table).toBeVisible();

    await page.evaluate(() => {
        const editor = (window as unknown as {
            editor?: {
                activeEditorTable: {
                    restoreScrollPosition(scrollTop: number, scrollLeft: number): void;
                } | false;
            };
        }).editor;
        if (!editor || editor.activeEditorTable === false) throw new Error('activeEditorTable が見つかりません');
        editor.activeEditorTable.restoreScrollPosition(0, 0);
    });

    const horizontalScrollbar = page.locator('.editor-left-pane .editor-table-logical-horizontal-scrollbar').first();
    const horizontalThumb = page.locator('.editor-left-pane .editor-table-logical-horizontal-scrollbar-thumb').first();
    await expect(horizontalScrollbar).toBeVisible();
    await expect(horizontalThumb).toBeVisible();

    const trackBox = await horizontalScrollbar.boundingBox();
    const thumbBox = await horizontalThumb.boundingBox();
    if (trackBox === null || thumbBox === null) throw new Error('横スクロールバーの座標が取得できません');

    const y = thumbBox.y + (thumbBox.height / 2);
    await page.mouse.move(thumbBox.x + (thumbBox.width / 2), y);
    await page.mouse.down();
    await page.mouse.move(trackBox.x + Math.round(trackBox.width * 0.7), y, { steps: 12 });

    const draggingMetrics = await readQuadrantColumnMetrics(page);
    expect(draggingMetrics.scrollLeft).toBeGreaterThan(100);
    expect(Math.abs(draggingMetrics.frozenRowLabelLeft - draggingMetrics.headerLabelLeft)).toBeLessThanOrEqual(1);
    expect(Math.abs(draggingMetrics.bodyLabelLeft - draggingMetrics.headerLabelLeft)).toBeLessThanOrEqual(1);
    expect(draggingMetrics.bodyFrozenIdRight).toBeLessThanOrEqual(draggingMetrics.bottomRightLeft + 1);

    await page.mouse.up();

    const releasedMetrics = await readQuadrantColumnMetrics(page);
    expect(Math.abs(releasedMetrics.scrollLeft - draggingMetrics.scrollLeft)).toBeLessThanOrEqual(1);
    expect(Math.abs(releasedMetrics.frozenRowLabelLeft - releasedMetrics.headerLabelLeft)).toBeLessThanOrEqual(1);
    expect(Math.abs(releasedMetrics.bodyLabelLeft - releasedMetrics.headerLabelLeft)).toBeLessThanOrEqual(1);
    expect(releasedMetrics.bodyFrozenIdRight).toBeLessThanOrEqual(releasedMetrics.bottomRightLeft + 1);
    expect(Math.abs(releasedMetrics.headerLabelLeft - draggingMetrics.headerLabelLeft)).toBeLessThanOrEqual(1);
    expect(Math.abs(releasedMetrics.bodyLabelLeft - draggingMetrics.bodyLabelLeft)).toBeLessThanOrEqual(1);
});

test('縦スクロールバーを押している間と離した後で固定列と本文行の位置が一致する', async ({ page }) => {
    await page.setViewportSize({ width: 1160, height: 580 });
    await installMockApiAsync(page, createPerformanceGroupFileSystem(5));
    await page.goto('/');

    await page.locator('#explorer .explorer-file').getByText('performance_group', { exact: true }).click();
    const table = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="performance_group"] .editor-table');
    await expect(table).toBeVisible();

    await page.evaluate(() => {
        const editor = (window as unknown as {
            editor?: {
                activeEditorTable: {
                    restoreScrollPosition(scrollTop: number, scrollLeft: number): void;
                } | false;
            };
        }).editor;
        if (!editor || editor.activeEditorTable === false) throw new Error('activeEditorTable が見つかりません');
        editor.activeEditorTable.restoreScrollPosition(0, 180);
    });

    const verticalScrollbar = page.locator('.editor-left-pane .editor-table-logical-vertical-scrollbar').first();
    const verticalThumb = page.locator('.editor-left-pane .editor-table-logical-vertical-scrollbar-thumb').first();
    await expect(verticalScrollbar).toBeVisible();
    await expect(verticalThumb).toBeVisible();

    const scrollbarAlignment = await page.evaluate(() => {
        const vertical = document.querySelector<HTMLElement>('.editor-left-pane .editor-table-logical-vertical-scrollbar');
        const horizontal = document.querySelector<HTMLElement>('.editor-left-pane .editor-table-logical-horizontal-scrollbar');
        if (vertical === null) throw new Error('縦スクロールバーが見つかりません');
        if (horizontal === null) throw new Error('横スクロールバーが見つかりません');
        const verticalRect = vertical.getBoundingClientRect();
        const horizontalRect = horizontal.getBoundingClientRect();
        return {
            verticalBottom: verticalRect.bottom,
            horizontalTop: horizontalRect.top,
            gap: Math.abs(Math.round(horizontalRect.top - verticalRect.bottom)),
        };
    });
    expect(scrollbarAlignment.gap, `verticalBottom=${scrollbarAlignment.verticalBottom}, horizontalTop=${scrollbarAlignment.horizontalTop}`).toBe(0);

    const trackBox = await verticalScrollbar.boundingBox();
    const thumbBox = await verticalThumb.boundingBox();
    if (trackBox === null || thumbBox === null) throw new Error('縦スクロールバーの座標が取得できません');

    const x = thumbBox.x + (thumbBox.width / 2);
    await page.mouse.move(x, thumbBox.y + (thumbBox.height / 2));
    await page.mouse.down();
    await page.mouse.move(x, trackBox.y + Math.round(trackBox.height * 0.62), { steps: 16 });

    const draggingMetrics = await readQuadrantRowMetrics(page);
    expect(draggingMetrics.scrollTop).toBeGreaterThan(1000);
    expect(Math.abs(draggingMetrics.leftHeaderTop - draggingMetrics.bodyLabelTop)).toBeLessThanOrEqual(1);
    expect(Math.abs(draggingMetrics.bodyLabelLeft - draggingMetrics.headerLabelLeft)).toBeLessThanOrEqual(1);

    await page.mouse.up();

    const releasedMetrics = await readQuadrantRowMetrics(page);
    expect(Math.abs(releasedMetrics.scrollTop - draggingMetrics.scrollTop)).toBeLessThanOrEqual(1);
    expect(releasedMetrics.viewportRowIndex).toBe(draggingMetrics.viewportRowIndex);
    expect(Math.abs(releasedMetrics.leftHeaderTop - releasedMetrics.bodyLabelTop)).toBeLessThanOrEqual(1);
    expect(Math.abs(releasedMetrics.bodyLabelLeft - releasedMetrics.headerLabelLeft)).toBeLessThanOrEqual(1);
    expect(Math.abs(releasedMetrics.frozenRowTop - draggingMetrics.frozenRowTop)).toBeLessThanOrEqual(1);
});

interface FrozenColumnFirstFrameMetrics {
    scrollTop: number;
    previousScrollTop: number;
    rowCount: number;
    insertedRowCount: number;
    removedRowCount: number;
    reusedRowCount: number;
    lineGroupCount: number;
    horizontalLineCount: number;
    verticalLineCount: number;
    cellCount: number;
    rowsWithoutAlignedHorizontalLine: number[];
    rowsWithoutAlignedVerticalLines: number[];
    rowsMisalignedWithBody: number[];
}

type FrozenColumnFrameWindow = Window & typeof globalThis & {
    frozenColumnFirstFrame: Promise<FrozenColumnFirstFrameMetrics>;
};

for (const frozenRowCount of [0, 5]) {
    for (const direction of [{ name: '下', sign: 1 }, { name: '上', sign: -1 }]) {
        for (const updateMode of ['差分更新', '全再生成']) {
            test(`固定2列${frozenRowCount}行で縦バーを${direction.name}へ高速ドラッグした最初の描画フレームから罫線が揃う（${updateMode}）`, async ({ page }) => {
                await page.setViewportSize({ width: 1160, height: 580 });
                await installMockApiAsync(page, createPerformanceGroupFileSystem(frozenRowCount));
                await page.goto('/');
                await page.locator('#explorer .explorer-file').getByText('performance_group', { exact: true }).click();
                const table = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="performance_group"] .editor-table');
                await expect(table).toBeVisible();

                // 準備時だけ描画完了を待つ。ドラッグ後の測定では罫線が復活する次フレームを待たない。
                await page.evaluate(async () => {
                    const editor = (window as unknown as {
                        editor: { activeEditorTable: {
                            getScrollMetrics(): { scrollHeight: number; clientHeight: number };
                            restoreScrollPosition(scrollTop: number, scrollLeft: number): void;
                        } | false };
                    }).editor;
                    if (editor.activeEditorTable === false) throw new Error('activeEditorTable が見つかりません');
                    const metrics = editor.activeEditorTable.getScrollMetrics();
                    editor.activeEditorTable.restoreScrollPosition((metrics.scrollHeight - metrics.clientHeight) / 2, 180);
                    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
                });

                const thumb = table.locator('.editor-table-logical-vertical-scrollbar-thumb');
                const track = table.locator('.editor-table-logical-vertical-scrollbar');
                const thumbBox = await thumb.boundingBox();
                const trackBox = await track.boundingBox();
                if (thumbBox === null || trackBox === null) throw new Error('縦スクロールバーの座標が取得できません');
                const x = thumbBox.x + thumbBox.width / 2;
                const y = thumbBox.y + thumbBox.height / 2;
                await page.mouse.move(x, y);
                await page.mouse.down();

                // アプリは pointerdown で window の pointermove リスナーを登録する。
                // その後に測定リスナーを登録し、同じ pointermove が予約した更新 rAF の直後に測る。
                // rAF は差し替えず、行 DOM を更新した最初のフレームの状態を保存する。
                const scrollDeltaRatio = await page.evaluate(({ sign, incremental }) => {
                    const root = document.querySelector<HTMLElement>('.editor-left-pane .tab-wrapper[data-tab-name="performance_group"] .editor-table');
                    const layer = root?.querySelector<HTMLElement>('.editor-table-detached-row-header-layer') ?? null;
                    const viewport = root?.querySelector<HTMLElement>('.editor-table-main-viewport') ?? null;
                    if (root === null || layer === null || viewport === null) throw new Error('固定列の表示レイヤーが見つかりません');
                    const previousRows = new Set(layer.querySelectorAll<HTMLElement>(':scope > .editor-table-detached-row'));
                    const firstRow = layer.querySelector<HTMLElement>(':scope > .editor-table-detached-row');
                    if (firstRow === null) throw new Error('ドラッグ前の固定列行が見つかりません');
                    if (layer.querySelector(':scope > .editor-table-grid-line-group') === null) throw new Error('ドラッグ前の固定列罫線が見つかりません');
                    const previousScrollTop = viewport.scrollTop;
                    const maxScrollTop = viewport.scrollHeight - viewport.clientHeight;
                    const scrollDelta = incremental ? firstRow.getBoundingClientRect().height * 5 : maxScrollTop / 4;
                    (window as FrozenColumnFrameWindow).frozenColumnFirstFrame = new Promise<FrozenColumnFirstFrameMetrics>((resolve, reject) => {
                        window.addEventListener('pointermove', () => {
                            requestAnimationFrame(() => {
                                try {
                                    const rows = Array.from(layer.querySelectorAll<HTMLElement>(':scope > .editor-table-detached-row'));
                                    const horizontalLines = Array.from(layer.querySelectorAll<HTMLElement>('.editor-table-grid-line-horizontal'), line => line.getBoundingClientRect());
                                    const verticalLines = Array.from(layer.querySelectorAll<HTMLElement>('.editor-table-grid-line-vertical'), line => line.getBoundingClientRect());
                                    const rowsWithoutAlignedHorizontalLine: number[] = [];
                                    const rowsWithoutAlignedVerticalLines: number[] = [];
                                    const rowsMisalignedWithBody: number[] = [];
                                    for (const row of rows) {
                                        const rowIndex = Number(row.dataset.rowIndex);
                                        const cells = Array.from(row.querySelectorAll<HTMLElement>(':scope > .editor-table-cell'));
                                        const rowRect = row.getBoundingClientRect();
                                        const firstCell = cells[0].getBoundingClientRect();
                                        const lastCell = cells[cells.length - 1].getBoundingClientRect();
                                        if (!horizontalLines.some(line => Math.abs(line.bottom - rowRect.bottom) <= 1 && Math.abs(line.left - firstCell.left) <= 1 && Math.abs(line.right - lastCell.right) <= 1)) {
                                            rowsWithoutAlignedHorizontalLine.push(rowIndex);
                                        }
                                        if (cells.some(cell => !verticalLines.some(line => Math.abs(line.right - cell.getBoundingClientRect().right) <= 1 && line.top <= rowRect.top + 1 && line.bottom >= rowRect.bottom - 1))) {
                                            rowsWithoutAlignedVerticalLines.push(rowIndex);
                                        }
                                        const bodyCell = root.querySelector<HTMLElement>(`.editor-table-grid .editor-table-row[data-row-index="${rowIndex}"] .editor-table-cell[data-col="2"]`);
                                        if (bodyCell === null) throw new Error(`本文セルが見つかりません: rowIndex=${rowIndex}`);
                                        const bodyRect = bodyCell.getBoundingClientRect();
                                        if (Math.abs(bodyRect.top - rowRect.top) > 1 || Math.abs(bodyRect.bottom - rowRect.bottom) > 1) rowsMisalignedWithBody.push(rowIndex);
                                    }
                                    resolve({
                                        scrollTop: viewport.scrollTop,
                                        previousScrollTop,
                                        rowCount: rows.length,
                                        insertedRowCount: rows.filter(row => !previousRows.has(row)).length,
                                        removedRowCount: Array.from(previousRows).filter(row => !row.isConnected).length,
                                        reusedRowCount: rows.filter(row => previousRows.has(row)).length,
                                        lineGroupCount: layer.querySelectorAll(':scope > .editor-table-grid-line-group').length,
                                        horizontalLineCount: horizontalLines.length,
                                        verticalLineCount: verticalLines.length,
                                        cellCount: firstRow.childElementCount,
                                        rowsWithoutAlignedHorizontalLine,
                                        rowsWithoutAlignedVerticalLines,
                                        rowsMisalignedWithBody,
                                    });
                                } catch (error) {
                                    reject(error);
                                }
                            });
                        }, { once: true });
                    });
                    return sign * scrollDelta / maxScrollTop;
                }, { sign: direction.sign, incremental: updateMode === '差分更新' });

                // 1 回の実 pointermove でジャンプし、pointerup による最終同期より前に採取する。
                await page.mouse.move(x, y + scrollDeltaRatio * (trackBox.height - thumbBox.height));
                const metrics = await page.evaluate(() => (window as FrozenColumnFrameWindow).frozenColumnFirstFrame);
                await page.mouse.up();

                expect((metrics.scrollTop - metrics.previousScrollTop) * direction.sign).toBeGreaterThan(0);
                expect(metrics.rowCount).toBeGreaterThan(0);
                expect(metrics.insertedRowCount, '測定フレームで新しい行が表示されている').toBeGreaterThan(0);
                expect(metrics.removedRowCount, '測定フレームで古い行が除去されている').toBeGreaterThan(0);
                if (updateMode === '差分更新') expect(metrics.reusedRowCount).toBeGreaterThan(0);
                else expect(metrics.reusedRowCount).toBe(0);
                expect(metrics.lineGroupCount, '行 DOM を更新した最初のフレームから固定列の罫線が必要').toBe(1);
                expect(metrics.horizontalLineCount).toBe(metrics.rowCount);
                expect(metrics.verticalLineCount).toBe(metrics.cellCount);
                expect(metrics.rowsWithoutAlignedHorizontalLine, '横罫線が各行の下端と固定列の左右端に揃う').toEqual([]);
                expect(metrics.rowsWithoutAlignedVerticalLines, '縦罫線が各セルの右端に揃い、表示行全体を覆う').toEqual([]);
                expect(metrics.rowsMisalignedWithBody, '固定列と本文セルの行位置が揃う').toEqual([]);
            });
        }
    }
}
