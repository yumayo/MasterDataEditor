import {test, expect} from './fixtures/test';
import {installMockApiAsync} from './fixtures/mock-api';
import type {MockFileSystem} from './fixtures/mock-api';

function distanceToInteger(value: number): number {
    return Math.abs(value - Math.round(value));
}

function minDistance(values: number[], target: number): number {
    return Math.min(...values.map(value => Math.abs(value - target)));
}

function generateWideCsv(rowCount: number, columnCount: number): string {
    const headers = Array.from({length: columnCount}, (_, index) => `col_${index}`);
    const rows = [headers.join(',')];
    for (let row = 0; row < rowCount; row++) {
        rows.push(headers.map((_, col) => `${row}_${col}`).join(','));
    }
    return rows.join('\n');
}

function createWideFileSystem(rowCount: number = 200, columnCount: number = 20): MockFileSystem {
    return {
        'schema/wide.json': JSON.stringify({
            header: Array.from({length: columnCount}, (_, index) => ({
                key: index,
                name: `col_${index}`,
                type: 'string',
            })),
            primary_key: ['col_0'],
        }),
        'data/wide.csv': generateWideCsv(rowCount, columnCount),
        'user:bookmarks.json': '[]',
        'plugins/.gitkeep': '',
    };
}

test('セル境界線はCSS borderではなく1px divで描画される', async ({page, mockFileSystem}) => {
    await page.locator('#explorer').getByText('test', {exact: true}).click();
    const table = page.locator('.editor-left-pane .editor-table');
    await expect(table).toBeVisible();

    const metrics = await page.evaluate(() => {
        const cell = document.querySelector<HTMLElement>(
            '.editor-left-pane .editor-table-grid .editor-table-row[data-row-index="0"] .editor-table-cell[data-col="0"]',
        );
        const vertical = document.querySelector<HTMLElement>(
            '.editor-left-pane .editor-table-grid-line-layer .editor-table-grid-line-vertical',
        );
        const horizontal = document.querySelector<HTMLElement>(
            '.editor-left-pane .editor-table-grid-line-layer .editor-table-grid-line-horizontal',
        );
        if (cell === null || vertical === null || horizontal === null) throw new Error('target elements not found');
        const cellStyle = getComputedStyle(cell);
        const verticalStyle = getComputedStyle(vertical);
        const horizontalStyle = getComputedStyle(horizontal);
        const verticalRect = vertical.getBoundingClientRect();
        const horizontalRect = horizontal.getBoundingClientRect();
        const dpr = window.devicePixelRatio;
        return {
            dpr,
            cellBorderRightWidth: cellStyle.borderRightWidth,
            cellBorderBottomWidth: cellStyle.borderBottomWidth,
            verticalPosition: verticalStyle.position,
            verticalWidth: verticalStyle.width,
            verticalLeft: vertical.style.left,
            verticalDeviceWidth: verticalRect.width * dpr,
            verticalDeviceLeft: verticalRect.left * dpr,
            horizontalPosition: horizontalStyle.position,
            horizontalHeight: horizontalStyle.height,
            horizontalTop: horizontal.style.top,
            horizontalDeviceHeight: horizontalRect.height * dpr,
            horizontalDeviceTop: horizontalRect.top * dpr,
            lineCount: document.querySelectorAll('.editor-left-pane .editor-table-grid-line').length,
        };
    });

    expect(metrics.cellBorderRightWidth).toBe('0px');
    expect(metrics.cellBorderBottomWidth).toBe('0px');
    expect(metrics.verticalPosition).toBe('absolute');
    expect(metrics.verticalDeviceWidth).toBeCloseTo(1, 3);
    expect(distanceToInteger(metrics.verticalDeviceLeft)).toBeLessThan(0.01);
    expect(metrics.horizontalPosition).toBe('absolute');
    expect(metrics.horizontalDeviceHeight).toBeCloseTo(1, 3);
    expect(distanceToInteger(metrics.horizontalDeviceTop)).toBeLessThan(0.01);
    expect(metrics.lineCount).toBeGreaterThan(0);
});

test('列ヘッダーの境界線はヘッダーセルの実座標に揃う', async ({page, mockFileSystem}) => {
    await page.locator('#explorer').getByText('test', {exact: true}).click();
    const table = page.locator('.editor-left-pane .editor-table');
    await expect(table).toBeVisible();

    const metrics = await page.evaluate(() => {
        const headerCell = document.querySelector<HTMLElement>(
            '.editor-left-pane .editor-table-detached-column-header-layer .editor-table-column-header[data-col="0"]',
        );
        const lineLayer = document.querySelector<HTMLElement>(
            '.editor-left-pane .editor-table-detached-column-header-layer',
        );
        if (headerCell === null || lineLayer === null) throw new Error('header target elements not found');
        const headerRect = headerCell.getBoundingClientRect();
        const verticalLineRects = Array.from(
            lineLayer.querySelectorAll<HTMLElement>('.editor-table-grid-line-vertical'),
            line => line.getBoundingClientRect(),
        );
        const horizontalLineRects = Array.from(
            lineLayer.querySelectorAll<HTMLElement>('.editor-table-grid-line-horizontal'),
            line => line.getBoundingClientRect(),
        );
        if (verticalLineRects.length === 0 || horizontalLineRects.length === 0) throw new Error('header grid lines not found');
        return {
            dpr: window.devicePixelRatio,
            headerRight: headerRect.right,
            headerBottom: headerRect.bottom,
            verticalLineRights: verticalLineRects.map(rect => rect.right),
            horizontalLineBottoms: horizontalLineRects.map(rect => rect.bottom),
        };
    });

    expect(minDistance(metrics.verticalLineRights, metrics.headerRight) * metrics.dpr).toBeLessThan(0.02);
    expect(minDistance(metrics.horizontalLineBottoms, metrics.headerBottom) * metrics.dpr).toBeLessThan(0.02);
});

test('固定行と固定列の境界線もdetached layer上の1px divで描画される', async ({page, mockFileSystem}) => {
    await page.locator('#explorer').getByText('test', {exact: true}).click();
    const table = page.locator('.editor-left-pane .editor-table');
    await expect(table).toBeVisible();

    await page.evaluate(() => {
        const editor = (window as unknown as {
            editor?: {activeEditorTable: {freezeRows(count: number): void; freezeColumns(count: number): void} | false};
        }).editor;
        if (!editor || editor.activeEditorTable === false) throw new Error('activeEditorTable not found');
        editor.activeEditorTable.freezeRows(1);
        editor.activeEditorTable.freezeColumns(1);
    });

    const metrics = await page.evaluate(() => {
        const frozenCornerLineCount = document.querySelectorAll(
            '.editor-left-pane .editor-table-detached-frozen-corner-layer > .editor-table-grid-line-group .editor-table-grid-line',
        ).length;
        const frozenRowLineCount = document.querySelectorAll(
            '.editor-left-pane .editor-table-detached-frozen-row-layer > .editor-table-grid-line-group .editor-table-grid-line',
        ).length;
        const frozenColumnLineCount = document.querySelectorAll(
            '.editor-left-pane .editor-table-detached-row-header-layer > .editor-table-grid-line-group .editor-table-grid-line',
        ).length;
        const boundaryCell = document.querySelector<HTMLElement>(
            '.editor-left-pane .freeze-column-border:not(.editor-table-column-header):not(.editor-table-row-header)',
        );
        if (boundaryCell === null) throw new Error('freeze boundary cell not found');
        const boundaryStyle = getComputedStyle(boundaryCell);
        const line = document.querySelector<HTMLElement>(
            '.editor-left-pane .editor-table-detached-frozen-corner-layer > .editor-table-grid-line-group .editor-table-grid-line-vertical',
        );
        if (line === null) throw new Error('frozen line not found');
        const lineStyle = getComputedStyle(line);
        const lineRect = line.getBoundingClientRect();
        const dpr = window.devicePixelRatio;
        return {
            dpr,
            frozenCornerLineCount,
            frozenRowLineCount,
            frozenColumnLineCount,
            boundaryBorderRightWidth: boundaryStyle.borderRightWidth,
            boundaryBoxShadow: boundaryStyle.boxShadow,
            lineWidth: lineStyle.width,
            lineLeft: line.style.left,
            lineDeviceWidth: lineRect.width * dpr,
            lineDeviceLeft: lineRect.left * dpr,
        };
    });

    expect(metrics.frozenCornerLineCount).toBeGreaterThan(0);
    expect(metrics.frozenRowLineCount).toBeGreaterThan(0);
    expect(metrics.frozenColumnLineCount).toBeGreaterThan(0);
    expect(metrics.boundaryBorderRightWidth).toBe('0px');
    expect(metrics.boundaryBoxShadow).toBe('none');
    expect(metrics.lineDeviceWidth).toBeCloseTo(1, 3);
    expect(distanceToInteger(metrics.lineDeviceLeft)).toBeLessThan(0.01);
});

test('固定列の境界線は固定セル背景より上、選択overlayより下に描画される', async ({page, mockFileSystem}) => {
    await page.locator('#explorer').getByText('test', {exact: true}).click();
    const table = page.locator('.editor-left-pane .editor-table');
    await expect(table).toBeVisible();

    await page.evaluate(() => {
        const editor = (window as unknown as {
            editor?: {activeEditorTable: {freezeColumns(count: number): void; getSelection(): {start(row: number, column: number): void}} | false};
        }).editor;
        if (!editor || editor.activeEditorTable === false) throw new Error('activeEditorTable not found');
        editor.activeEditorTable.freezeColumns(1);
        editor.activeEditorTable.getSelection().start(1, 1);
    });

    const metrics = await page.evaluate(() => {
        const layer = document.querySelector<HTMLElement>('.editor-left-pane .editor-table-detached-row-header-layer');
        const group = layer?.querySelector<HTMLElement>('.editor-table-grid-line-group') ?? null;
        const boundaryCell = layer?.querySelector<HTMLElement>(
            '.editor-table-detached-row[data-row-index="0"] .freeze-column-border:not(.editor-table-row-header)',
        ) ?? null;
        const selection = document.querySelector<HTMLElement>('.editor-left-pane .selection-overlay');
        if (layer === null || group === null || boundaryCell === null || selection === null) {
            throw new Error('fixed column target elements not found');
        }
        const boundaryRect = boundaryCell.getBoundingClientRect();
        const verticalLineRects = Array.from(
            layer.querySelectorAll<HTMLElement>('.editor-table-grid-line-vertical'),
            line => line.getBoundingClientRect(),
        );
        if (verticalLineRects.length === 0) throw new Error('fixed column grid lines not found');
        const zIndex = (element: HTMLElement): number => {
            const value = window.getComputedStyle(element).zIndex;
            if (value === 'auto') return 0;
            const parsed = Number(value);
            if (!Number.isFinite(parsed)) throw new Error(`invalid z-index: ${value}`);
            return parsed;
        };
        return {
            dpr: window.devicePixelRatio,
            boundaryRight: boundaryRect.right,
            verticalLineRights: verticalLineRects.map(rect => rect.right),
            groupZIndex: zIndex(group),
            boundaryCellZIndex: zIndex(boundaryCell),
            selectionZIndex: zIndex(selection),
        };
    });

    expect(minDistance(metrics.verticalLineRights, metrics.boundaryRight) * metrics.dpr).toBeLessThan(0.02);
    expect(metrics.groupZIndex).toBeGreaterThan(metrics.boundaryCellZIndex);
    expect(metrics.groupZIndex).toBeLessThan(metrics.selectionZIndex);
});

test.describe('DPIスケーリング時のセル境界線', () => {
    test.use({viewport: {width: 780, height: 460}, deviceScaleFactor: 1.25});

    test('スクロールバー移動中の小数スクロール位置でも境界線は物理1pxに揃う', async ({page}) => {
        await installMockApiAsync(page, createWideFileSystem());
        await page.goto('/');

        await page.locator('#explorer .explorer-file').getByText('wide', {exact: true}).click();
        const table = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="wide"] .editor-table');
        await expect(table).toBeVisible();

        const horizontalThumb = page.locator('.editor-left-pane .editor-table-logical-horizontal-scrollbar-thumb');
        const verticalThumb = page.locator('.editor-left-pane .editor-table-logical-vertical-scrollbar-thumb');
        await expect(horizontalThumb).toBeVisible();
        await expect(verticalThumb).toBeVisible();

        const horizontalBox = await horizontalThumb.boundingBox();
        const verticalBox = await verticalThumb.boundingBox();
        if (horizontalBox === null || verticalBox === null) throw new Error('scrollbar thumb not found');

        await page.mouse.move(horizontalBox.x + horizontalBox.width / 2, horizontalBox.y + horizontalBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(horizontalBox.x + horizontalBox.width / 2 + 37.6, horizontalBox.y + horizontalBox.height / 2, {steps: 5});
        await page.mouse.up();

        await page.mouse.move(verticalBox.x + verticalBox.width / 2, verticalBox.y + verticalBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(verticalBox.x + verticalBox.width / 2, verticalBox.y + verticalBox.height / 2 + 53.4, {steps: 5});
        await page.mouse.up();
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));

        const metrics = await page.evaluate(() => {
            const dpr = window.devicePixelRatio;
            const lines = Array.from(document.querySelectorAll<HTMLElement>('.editor-left-pane .editor-table-grid-line'));
            if (lines.length === 0) throw new Error('grid lines not found');
            let maxThicknessError = 0;
            let maxAlignmentError = 0;
            for (const line of lines) {
                const rect = line.getBoundingClientRect();
                const isVertical = line.classList.contains('editor-table-grid-line-vertical');
                const thickness = (isVertical ? rect.width : rect.height) * dpr;
                const edge = (isVertical ? rect.left : rect.top) * dpr;
                maxThicknessError = Math.max(maxThicknessError, Math.abs(thickness - 1));
                maxAlignmentError = Math.max(maxAlignmentError, Math.abs(edge - Math.round(edge)));
            }
            return {
                dpr,
                lineCount: lines.length,
                maxThicknessError,
                maxAlignmentError,
            };
        });

        expect(metrics.dpr).toBe(1.25);
        expect(metrics.lineCount).toBeGreaterThan(0);
        expect(metrics.maxThicknessError).toBeLessThan(0.02);
        expect(metrics.maxAlignmentError).toBeLessThan(0.02);
    });
});
