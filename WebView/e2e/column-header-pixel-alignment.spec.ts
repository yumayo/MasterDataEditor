import {test, expect} from './fixtures/test';
import {installMockApiAsync, type MockFileSystem} from './fixtures/mock-api';
import type {Locator, Page} from '@playwright/test';

function createCharaFs(rowCount: number = 90): MockFileSystem {
    const charaRows = ['id,recover_stamina,recover_hp,attack,defence,speed'];
    const nameRows = ['id,ja'];
    const names = ['パンジー', 'アイビー', 'ジャック', 'ケイト', 'レオ', 'マヤ', 'ネイト', 'オリビア', 'ポール', 'クイン', 'ローズ', 'サム', 'ティナ', 'ウーノ', 'ビクター', 'ウェンディ', 'ゼン', 'ヤラ'];
    for (let id = 1; id <= rowCount; id++) {
        charaRows.push([
            id,
            (id * 7) % 11,
            (id * 13) % 20,
            (id * 17) % 23,
            (id * 19) % 19,
            (id * 5) % 13,
        ].join(','));
        nameRows.push(`${id},${names[id % names.length]}Mk${Math.floor(id / 19) + 1}`);
    }
    return {
        'schema/chara.json': JSON.stringify({
            header: [
                {key: 0, name: 'id', type: 'int', comment: 'ID', width: 173},
                {key: 1, name: 'recover_stamina', type: 'int', comment: 'スタミナ回復量', width: 219},
                {key: 2, name: 'recover_hp', type: 'int', comment: 'HP回復量', width: 443},
                {key: 3, name: 'attack', type: 'int', comment: '攻撃力', width: 100},
                {key: 4, name: 'defence', type: 'int', comment: '防御力', width: 100},
                {key: 5, name: 'speed', type: 'int', comment: '速度', width: 100},
            ],
            primary_key: ['id'],
        }),
        'data/chara.csv': charaRows.join('\n'),
        'schema/chara_name.json': JSON.stringify({
            header: [
                {key: 0, name: 'id', type: 'int', reference: 'chara.id', width: 80},
                {key: 1, name: 'ja', type: 'string', width: 200},
            ],
            primary_key: ['id'],
        }),
        'data/chara_name.csv': nameRows.join('\n'),
        'user:bookmarks.json': '[]',
        'plugins/.gitkeep': '',
    };
}

async function getBottomRightBrightnessAsync(page: Page, target: Locator): Promise<{
    width: number;
    height: number;
    rgba: number[];
    brightness: number;
}> {
    const pngBase64 = (await target.screenshot()).toString('base64');
    return page.evaluate(async (src) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        if (context === null) throw new Error('2d context not available');
        context.drawImage(image, 0, 0);
        const data = Array.from(context.getImageData(canvas.width - 1, canvas.height - 1, 1, 1).data);
        return {
            width: canvas.width,
            height: canvas.height,
            rgba: data,
            brightness: data[0] + data[1] + data[2],
        };
    }, `data:image/png;base64,${pngBase64}`);
}

async function getRowHeaderBoundaryPixelsAsync(page: Page, rowIndex: number): Promise<{
    dpr: number;
    imageWidth: number;
    imageHeight: number;
    boundaryDeviceX: number;
    centerDeviceX: number;
    centerDeviceY: number;
    bottomDeviceY: number;
    right: Array<{offset: number; rgba: number[]; brightness: number}>;
    bottom: Array<{offset: number; rgba: number[]; brightness: number}>;
}> {
    const metrics = await page.evaluate((index) => {
        const rowHeader = document.querySelector<HTMLElement>(
            `.editor-table-detached-row-header-layer .editor-table-detached-row[data-row-index="${index}"] .editor-table-row-header`,
        );
        if (rowHeader === null) throw new Error('row header not found');
        const rect = rowHeader.getBoundingClientRect();
        return {
            dpr: window.devicePixelRatio,
            boundaryDeviceX: Math.round(rect.right * window.devicePixelRatio),
            centerDeviceX: Math.round((rect.left + rect.width / 2) * window.devicePixelRatio),
            centerDeviceY: Math.round((rect.top + rect.height / 2) * window.devicePixelRatio),
            bottomDeviceY: Math.round(rect.bottom * window.devicePixelRatio),
        };
    }, rowIndex);
    const pngBase64 = (await page.screenshot({scale: 'device'})).toString('base64');
    return page.evaluate(async ({src, metrics}) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        if (context === null) throw new Error('2d context not available');
        context.drawImage(image, 0, 0);
        const read = (x: number, y: number, offset: number): {offset: number; rgba: number[]; brightness: number} => {
            const rgba = Array.from(context.getImageData(x, y, 1, 1).data);
            return {offset, rgba, brightness: rgba[0] + rgba[1] + rgba[2]};
        };
        return {
            ...metrics,
            imageWidth: canvas.width,
            imageHeight: canvas.height,
            right: [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6].map((offset) =>
                read(metrics.boundaryDeviceX + offset, metrics.centerDeviceY, offset),
            ),
            bottom: [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3].map((offset) =>
                read(metrics.centerDeviceX, metrics.bottomDeviceY + offset, offset),
            ),
        };
    }, {src: `data:image/png;base64,${pngBase64}`, metrics});
}

async function getBodyCellJunctionPixelsAsync(page: Page): Promise<{
    dpr: number;
    imageWidth: number;
    imageHeight: number;
    boundaryDeviceX: number;
    boundaryDeviceY: number;
    firstCellRightDevice: number;
    secondCellLeftDevice: number;
    firstCellBottomDevice: number;
    secondRowTopDevice: number;
    pixels: Array<{xOffset: number; yOffset: number; rgba: number[]; brightness: number}>;
}> {
    const metrics = await page.evaluate(() => {
        const cell00 = document.querySelector<HTMLElement>(
            '.editor-table-grid .editor-table-row[data-row-index="0"] .editor-table-cell[data-col="0"]',
        );
        const cell01 = document.querySelector<HTMLElement>(
            '.editor-table-grid .editor-table-row[data-row-index="0"] .editor-table-cell[data-col="1"]',
        );
        const cell10 = document.querySelector<HTMLElement>(
            '.editor-table-grid .editor-table-row[data-row-index="1"] .editor-table-cell[data-col="0"]',
        );
        if (cell00 === null || cell01 === null || cell10 === null) {
            throw new Error('target body cells not found');
        }
        const cell00Rect = cell00.getBoundingClientRect();
        const cell01Rect = cell01.getBoundingClientRect();
        const cell10Rect = cell10.getBoundingClientRect();
        return {
            dpr: window.devicePixelRatio,
            boundaryDeviceX: Math.round(cell00Rect.right * window.devicePixelRatio),
            boundaryDeviceY: Math.round(cell00Rect.bottom * window.devicePixelRatio),
            firstCellRightDevice: Math.round(cell00Rect.right * window.devicePixelRatio),
            secondCellLeftDevice: Math.round(cell01Rect.left * window.devicePixelRatio),
            firstCellBottomDevice: Math.round(cell00Rect.bottom * window.devicePixelRatio),
            secondRowTopDevice: Math.round(cell10Rect.top * window.devicePixelRatio),
        };
    });
    const pngBase64 = (await page.screenshot({scale: 'device'})).toString('base64');
    return page.evaluate(async ({src, metrics}) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        if (context === null) throw new Error('2d context not available');
        context.drawImage(image, 0, 0);
        const offsets = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3];
        const pixels = offsets.flatMap((yOffset) =>
            offsets.map((xOffset) => {
                const rgba = Array.from(context.getImageData(
                    metrics.boundaryDeviceX + xOffset,
                    metrics.boundaryDeviceY + yOffset,
                    1,
                    1,
                ).data);
                return {xOffset, yOffset, rgba, brightness: rgba[0] + rgba[1] + rgba[2]};
            }),
        );
        return {
            ...metrics,
            imageWidth: canvas.width,
            imageHeight: canvas.height,
            pixels,
        };
    }, {src: `data:image/png;base64,${pngBase64}`, metrics});
}

type BodyCellJunctionPixels = Awaited<ReturnType<typeof getBodyCellJunctionPixelsAsync>>;
type BodyCellJunctionPixel = BodyCellJunctionPixels['pixels'][number];

async function openCharaWithNarrowExplorerAsync(page: Page): Promise<Locator> {
    await installMockApiAsync(page, createCharaFs());
    await page.goto('/');
    await page.addStyleTag({
        content: `
            .explorer {
                width: 120px !important;
            }

            .editor,
            .tab {
                left: 120px !important;
                width: calc(100vw - 120px) !important;
            }
        `,
    });
    await page.locator('#explorer').getByText('chara', {exact: true}).click();
    const table = page.locator('.editor-left-pane .editor-table');
    await expect(table).toBeVisible();
    return table;
}

async function setTableSelectionAsync(
    page: Page,
    startRow: number,
    startColumn: number,
    endRow: number,
    endColumn: number,
    focusRow: number,
    focusColumn: number,
): Promise<void> {
    await page.evaluate(({startRow, startColumn, endRow, endColumn, focusRow, focusColumn}) => {
        const editor = (window as unknown as {
            editor?: {activeEditorTable: {
                getSelection(): {
                    setRange(startRow: number, startColumn: number, endRow: number, endColumn: number): void;
                    move(row: number, column: number): void;
                    end(): void;
                };
            } | false};
        }).editor;
        if (!editor || editor.activeEditorTable === false) throw new Error('activeEditorTable not found');
        const selection = editor.activeEditorTable.getSelection();
        selection.setRange(startRow, startColumn, endRow, endColumn);
        selection.move(focusRow, focusColumn);
        selection.end();
    }, {startRow, startColumn, endRow, endColumn, focusRow, focusColumn});
}

function getJunctionPixel(junction: BodyCellJunctionPixels, xOffset: number, yOffset: number): BodyCellJunctionPixel {
    const pixel = junction.pixels.find((item) => item.xOffset === xOffset && item.yOffset === yOffset);
    if (pixel === undefined) throw new Error(`junction pixel not found: ${xOffset},${yOffset}`);
    return pixel;
}

function expectJunctionGeometry(junction: BodyCellJunctionPixels): void {
    expect(junction.dpr).toBe(3);
    expect(junction.firstCellRightDevice).toBe(junction.secondCellLeftDevice);
    expect(junction.firstCellBottomDevice).toBe(junction.secondRowTopDevice);
    expect(junction.imageWidth).toBeGreaterThan(junction.boundaryDeviceX + 3);
    expect(junction.imageHeight).toBeGreaterThan(junction.boundaryDeviceY + 3);
}

function getVisualGridLineOffset(junction: BodyCellJunctionPixels): number {
    return -Math.round(junction.dpr);
}

function expectNormalGridPixel(junction: BodyCellJunctionPixels, xOffset: number, yOffset: number): void {
    const pixel = getJunctionPixel(junction, xOffset, yOffset);
    expect(pixel.brightness, `junction ${xOffset},${yOffset} rgba=${pixel.rgba.join(',')}`).toBeLessThan(125);
}

test.describe('column header pixel alignment', () => {
    test.use({viewport: {width: 470, height: 260}, deviceScaleFactor: 3});

    test('300%表示でも列ヘッダー境界とボディセル境界が同じピクセル列に描画される', async ({page}) => {
        await installMockApiAsync(page, createCharaFs());
        await page.goto('/');
        await page.locator('#explorer').getByText('chara', {exact: true}).click();
        const table = page.locator('.editor-left-pane .editor-table');
        await expect(table).toBeVisible();

        await page.evaluate(() => {
            const editor = (window as unknown as {
                editor?: {activeEditorTable: {
                    restoreScrollPosition(scrollTop: number, scrollLeft: number): void;
                    refreshDetachedHeaderLayout(): void;
                } | false};
            }).editor;
            if (!editor || editor.activeEditorTable === false) throw new Error('activeEditorTable not found');
            editor.activeEditorTable.restoreScrollPosition(1120, 0);
            editor.activeEditorTable.refreshDetachedHeaderLayout();
        });

        const metrics = await page.evaluate(() => {
            const tableEl = document.querySelector<HTMLElement>('.editor-left-pane .editor-table');
            const header = document.querySelector<HTMLElement>('.editor-left-pane .editor-table-detached-column-header-layer .editor-table-column-header[data-col="0"]');
            const body = document.querySelector<HTMLElement>('.editor-left-pane .editor-table-grid .editor-table-row[data-row-index] .editor-table-cell[data-col="0"]');
            const nextBody = body?.parentElement?.querySelector<HTMLElement>('.editor-table-cell[data-col="1"]') ?? null;
            if (tableEl === null || header === null || body === null || nextBody === null) throw new Error('target cells not found');
            const tableRect = tableEl.getBoundingClientRect();
            const headerRect = header.getBoundingClientRect();
            const bodyRect = body.getBoundingClientRect();
            const nextBodyRect = nextBody.getBoundingClientRect();
            return {
                dpr: window.devicePixelRatio,
                headerRightCss: headerRect.right - tableRect.left,
                bodyRightCss: bodyRect.right - tableRect.left,
                nextBodyLeftCss: nextBodyRect.left - tableRect.left,
                headerRightDevice: Math.round((headerRect.right - tableRect.left) * window.devicePixelRatio),
                bodyRightDevice: Math.round((bodyRect.right - tableRect.left) * window.devicePixelRatio),
                nextBodyLeftDevice: Math.round((nextBodyRect.left - tableRect.left) * window.devicePixelRatio),
            };
        });

        expect(metrics.dpr).toBe(3);
        expect(metrics.headerRightDevice).toBe(metrics.bodyRightDevice);
        expect(metrics.nextBodyLeftDevice).toBe(metrics.bodyRightDevice);
        expect(Math.abs(metrics.headerRightCss - metrics.bodyRightCss)).toBeLessThan(0.01);
        expect(Math.abs(metrics.nextBodyLeftCss - metrics.bodyRightCss)).toBeLessThan(0.01);

        const headerCell = table.locator('.editor-table-detached-column-header-layer .editor-table-column-header[data-col="0"]');
        const bodyCell = table.locator('.editor-table-grid .editor-table-row[data-row-index] .editor-table-cell[data-col="0"]').first();
        const headerCorner = await getBottomRightBrightnessAsync(page, headerCell);
        const bodyCorner = await getBottomRightBrightnessAsync(page, bodyCell);

        expect(headerCorner.brightness, `header bottom-right rgba=${headerCorner.rgba.join(',')}`).toBeLessThan(140);
        expect(bodyCorner.brightness, `body bottom-right rgba=${bodyCorner.rgba.join(',')}`).toBeLessThan(140);
    });

    test('300%表示でも行範囲選択のoverlayが1デバイスpxの境界まで塗られる', async ({page}) => {
        await installMockApiAsync(page, createCharaFs());
        await page.goto('/');
        await page.locator('#explorer').getByText('chara', {exact: true}).click();
        const table = page.locator('.editor-left-pane .editor-table');
        await expect(table).toBeVisible();

        await page.evaluate(() => {
            const editor = (window as unknown as {
                editor?: {activeEditorTable: {
                    restoreScrollPosition(scrollTop: number, scrollLeft: number): void;
                    refreshDetachedHeaderLayout(): void;
                    getSelection(): {
                        selectRow(row: number): void;
                        extendToRow(row: number): void;
                        end(): void;
                    };
                } | false};
            }).editor;
            if (!editor || editor.activeEditorTable === false) throw new Error('activeEditorTable not found');
            editor.activeEditorTable.restoreScrollPosition(1400, 0);
            editor.activeEditorTable.getSelection().selectRow(70);
            editor.activeEditorTable.getSelection().extendToRow(73);
            editor.activeEditorTable.getSelection().end();
            editor.activeEditorTable.refreshDetachedHeaderLayout();
        });

        const selectedRowHeader = table.locator(
            '.editor-table-detached-row-header-layer .editor-table-detached-row[data-row-index="69"] .editor-table-row-header',
        );
        const selectedRowEndHeader = table.locator(
            '.editor-table-detached-row-header-layer .editor-table-detached-row[data-row-index="72"] .editor-table-row-header',
        );
        await expect(selectedRowHeader).toBeVisible();
        await expect(selectedRowEndHeader).toBeVisible();

        const metrics = await page.evaluate(() => {
            const row = document.querySelector<HTMLElement>('.editor-table-detached-row-header-layer .editor-table-detached-row[data-row-index="69"] .editor-table-row-header');
            const data = document.querySelector<HTMLElement>('.editor-table-grid .editor-table-row[data-row-index="69"] .editor-table-cell[data-col="0"]');
            if (row === null || data === null) throw new Error('target row cells not found');
            const rowStyle = getComputedStyle(row);
            const rr = row.getBoundingClientRect();
            const dr = data.getBoundingClientRect();
            return {
                dpr: window.devicePixelRatio,
                rowRightDevice: Math.round(rr.right * window.devicePixelRatio),
                dataLeftDevice: Math.round(dr.left * window.devicePixelRatio),
                backgroundSize: rowStyle.backgroundSize,
                backgroundClip: rowStyle.backgroundClip,
                borderRightColor: rowStyle.borderRightColor,
            };
        });

        expect(metrics.dpr).toBe(3);
        expect(metrics.rowRightDevice).toBe(metrics.dataLeftDevice);
        expect(metrics.backgroundSize).toBe('100% 100%');
        expect(metrics.backgroundClip).toBe('border-box');
        expect(metrics.borderRightColor).not.toBe('rgba(0, 0, 0, 0)');

        const rightBoundary = await getRowHeaderBoundaryPixelsAsync(page, 69);
        expect(rightBoundary.imageWidth).toBeGreaterThan(rightBoundary.boundaryDeviceX + 6);
        expect(rightBoundary.imageHeight).toBeGreaterThan(rightBoundary.centerDeviceY);
        for (const offset of [-3, -2, -1]) {
            const pixel = rightBoundary.right.find((item) => item.offset === offset);
            expect(pixel?.brightness, `right grid border ${offset} rgba=${pixel?.rgba.join(',')}`).toBeLessThan(150);
        }
        const outsideRight = rightBoundary.right.find((item) => item.offset === 0);
        expect(outsideRight?.brightness, `overlay right border rgba=${outsideRight?.rgba.join(',')}`).toBeGreaterThan(150);

        const bottomBoundary = await getRowHeaderBoundaryPixelsAsync(page, 72);
        for (const offset of [-3, -2, -1]) {
            const pixel = bottomBoundary.bottom.find((item) => item.offset === offset);
            expect(pixel?.brightness, `bottom grid border ${offset} rgba=${pixel?.rgba.join(',')}`).toBeLessThan(150);
        }
        const outsideBottom = bottomBoundary.bottom.find((item) => item.offset === 0);
        expect(outsideBottom?.brightness, `bottom gridline rgba=${outsideBottom?.rgba.join(',')}`).toBeLessThan(150);
    });
});

test.describe('body cell junction pixel alignment', () => {
    test.use({viewport: {width: 720, height: 320}, deviceScaleFactor: 3});

    test('300%表示でも通常グリッドの交点をborderで埋める', async ({page}) => {
        await openCharaWithNarrowExplorerAsync(page);
        await setTableSelectionAsync(page, 5, 2, 5, 2, 5, 2);

        const junction = await getBodyCellJunctionPixelsAsync(page);

        expectJunctionGeometry(junction);
        const visualLineOffset = getVisualGridLineOffset(junction);
        for (let xOffset = visualLineOffset; xOffset <= -1; xOffset++) {
            expectNormalGridPixel(junction, xOffset, visualLineOffset);
        }
        for (let yOffset = visualLineOffset; yOffset <= -1; yOffset++) {
            expectNormalGridPixel(junction, visualLineOffset, yOffset);
        }

        const sampleOffset = visualLineOffset - 2;
        const verticalGridPixels = junction.pixels
            .filter((item) => item.yOffset === sampleOffset && item.xOffset >= sampleOffset && item.xOffset <= -1 && item.brightness < 125)
            .map((item) => item.xOffset);
        const horizontalGridPixels = junction.pixels
            .filter((item) => item.xOffset === sampleOffset && item.yOffset >= sampleOffset && item.yOffset <= -1 && item.brightness < 125)
            .map((item) => item.yOffset);

        expect(verticalGridPixels, `vertical scanline=${JSON.stringify(verticalGridPixels)}`).toEqual([-3, -2, -1]);
        expect(horizontalGridPixels, `horizontal scanline=${JSON.stringify(horizontalGridPixels)}`).toEqual([-3, -2, -1]);
    });

    test('300%表示でも範囲選択の1列目と2列目、1行目と2行目の交点に1px隙間がない', async ({page}) => {
        await openCharaWithNarrowExplorerAsync(page);
        await setTableSelectionAsync(page, 1, 1, 3, 2, 3, 1);

        const selectedClasses = await page.evaluate(() => {
            const selectors = [
                '.editor-table-grid .editor-table-row[data-row-index="0"] .editor-table-cell[data-col="0"]',
                '.editor-table-grid .editor-table-row[data-row-index="0"] .editor-table-cell[data-col="1"]',
                '.editor-table-grid .editor-table-row[data-row-index="1"] .editor-table-cell[data-col="0"]',
                '.editor-table-grid .editor-table-row[data-row-index="1"] .editor-table-cell[data-col="1"]',
            ];
            return selectors.map((selector) => {
                const cell = document.querySelector<HTMLElement>(selector);
                if (cell === null) throw new Error(`selected cell not found: ${selector}`);
                return Array.from(cell.classList);
            });
        });
        for (const classList of selectedClasses) {
            expect(classList).toContain('sel-bg');
        }

        const junction = await getBodyCellJunctionPixelsAsync(page);
        expectJunctionGeometry(junction);

        const visualLineOffset = getVisualGridLineOffset(junction);
        const expectNotPlainCellBackground = (xOffset: number, yOffset: number): void => {
            const pixel = getJunctionPixel(junction, xOffset, yOffset);
            const isDefaultCellBackground = pixel.brightness >= 125 && pixel.brightness <= 150;
            expect(isDefaultCellBackground, `selection junction ${xOffset},${yOffset} rgba=${pixel.rgba.join(',')}`).toBe(false);
        };
        const expectSelectedFill = (xOffset: number, yOffset: number): void => {
            const pixel = getJunctionPixel(junction, xOffset, yOffset);
            expect(pixel.brightness, `selection fill ${xOffset},${yOffset} rgba=${pixel.rgba.join(',')}`).toBeGreaterThan(150);
        };

        for (let xOffset = visualLineOffset + 1; xOffset <= -1; xOffset++) {
            expectNotPlainCellBackground(xOffset, visualLineOffset);
        }
        for (let yOffset = visualLineOffset + 1; yOffset <= -1; yOffset++) {
            expectNotPlainCellBackground(visualLineOffset, yOffset);
        }
        for (let yOffset = visualLineOffset + 1; yOffset <= -1; yOffset++) {
            for (let xOffset = visualLineOffset + 1; xOffset <= -1; xOffset++) {
                expectSelectedFill(xOffset, yOffset);
            }
        }
    });
});
