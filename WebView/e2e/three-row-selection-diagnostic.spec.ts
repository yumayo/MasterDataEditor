import {test, expect} from './fixtures/test';
import type {Page} from '@playwright/test';
import {mkdirSync} from 'fs';
import {dirname, resolve} from 'path';
import {fileURLToPath} from 'url';
import {inflateSync} from 'zlib';

const currentDir = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(currentDir, '../../.CONTEXT/three-row-selection-diagnostic');

type Rgb = [number, number, number];

interface PngImage {
    width: number;
    height: number;
    channels: number;
    pixels: Uint8Array;
}

interface ColorRun {
    kind: 'selected' | 'background' | 'other';
    start: number;
    end: number;
}

interface HeaderRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

function paethPredictor(a: number, b: number, c: number): number {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    return pb <= pc ? b : c;
}

function readPng(buffer: Buffer): PngImage {
    let offset = 8;
    let width = 0;
    let height = 0;
    let colorType = 0;
    const idatChunks: Buffer[] = [];

    while (offset < buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
        const chunk = buffer.subarray(offset + 8, offset + 8 + length);
        offset += 12 + length;

        if (type === 'IHDR') {
            width = chunk.readUInt32BE(0);
            height = chunk.readUInt32BE(4);
            colorType = chunk[9];
        } else if (type === 'IDAT') {
            idatChunks.push(chunk);
        } else if (type === 'IEND') {
            break;
        }
    }

    const channels = colorType === 6 ? 4 : 3;
    if (colorType !== 2 && colorType !== 6) throw new Error(`Unsupported PNG color type: ${colorType}`);

    const inflated = inflateSync(Buffer.concat(idatChunks));
    const stride = width * channels;
    const pixels = new Uint8Array(height * stride);
    let sourceOffset = 0;
    let previousRow = new Uint8Array(stride);

    for (let y = 0; y < height; y++) {
        const filter = inflated[sourceOffset++];
        const row = pixels.subarray(y * stride, (y + 1) * stride);

        for (let x = 0; x < stride; x++) {
            const raw = inflated[sourceOffset++];
            const left = x >= channels ? row[x - channels] : 0;
            const up = previousRow[x];
            const upLeft = x >= channels ? previousRow[x - channels] : 0;
            let value: number;

            if (filter === 0) value = raw;
            else if (filter === 1) value = raw + left;
            else if (filter === 2) value = raw + up;
            else if (filter === 3) value = raw + Math.floor((left + up) / 2);
            else if (filter === 4) value = raw + paethPredictor(left, up, upLeft);
            else throw new Error(`Unsupported PNG filter: ${filter}`);

            row[x] = value & 255;
        }

        previousRow = row;
    }

    return {width, height, channels, pixels};
}

function rgbAt(image: PngImage, x: number, y: number): Rgb {
    const offset = (y * image.width + x) * image.channels;
    return [image.pixels[offset], image.pixels[offset + 1], image.pixels[offset + 2]];
}

function isNearColor(actual: Rgb, expected: Rgb): boolean {
    return actual.every((value, index) => Math.abs(value - expected[index]) <= 2);
}

function classifyColor(pixel: Rgb): ColorRun['kind'] {
    if (isNearColor(pixel, [23, 62, 95])) return 'selected';
    if (isNearColor(pixel, [33, 37, 43])) return 'background';
    return 'other';
}

function getVerticalRuns(image: PngImage, x: number, yStart: number, yEnd: number): ColorRun[] {
    const runs: ColorRun[] = [];
    let currentKind = classifyColor(rgbAt(image, x, yStart));
    let start = yStart;

    for (let y = yStart + 1; y <= yEnd; y++) {
        const kind = classifyColor(rgbAt(image, x, y));
        if (kind === currentKind) continue;
        runs.push({kind: currentKind, start, end: y - 1});
        currentKind = kind;
        start = y;
    }

    runs.push({kind: currentKind, start, end: yEnd});
    return runs;
}

function getHorizontalRuns(image: PngImage, y: number, xStart: number, xEnd: number): ColorRun[] {
    const runs: ColorRun[] = [];
    let currentKind = classifyColor(rgbAt(image, xStart, y));
    let start = xStart;

    for (let x = xStart + 1; x <= xEnd; x++) {
        const kind = classifyColor(rgbAt(image, x, y));
        if (kind === currentKind) continue;
        runs.push({kind: currentKind, start, end: x - 1});
        currentKind = kind;
        start = x;
    }

    runs.push({kind: currentKind, start, end: xEnd});
    return runs;
}

async function selectRowsAsync(page: Page, startRowIndex: number, endRowIndex: number): Promise<void> {
    mkdirSync(outputDir, {recursive: true});

    await page.locator('#explorer').getByText('test', {exact: true}).click();
    const table = page.locator('.editor-left-pane .editor-table');
    await expect(table).toBeVisible();

    const startRowHeader = table.locator(
        `.editor-table-detached-row-header-layer .editor-table-detached-row[data-row-index="${startRowIndex}"] .editor-table-row-header`,
    );
    const endRowHeader = table.locator(
        `.editor-table-detached-row-header-layer .editor-table-detached-row[data-row-index="${endRowIndex}"] .editor-table-row-header`,
    );

    await startRowHeader.click();
    if (endRowIndex !== startRowIndex) await endRowHeader.click({modifiers: ['Shift']});

    await expect(
        table.locator('.editor-table-detached-row-header-layer .editor-table-row-header.selected')
    ).toHaveCount(endRowIndex - startRowIndex + 1);
}

async function selectColumnsAsync(page: Page, startColumnIndex: number, endColumnIndex: number): Promise<void> {
    mkdirSync(outputDir, {recursive: true});

    await page.locator('#explorer').getByText('test', {exact: true}).click();
    const table = page.locator('.editor-left-pane .editor-table');
    await expect(table).toBeVisible();

    const startColumnHeader = table.locator(
        `.editor-table-detached-column-header-layer .editor-table-column-header[data-col="${startColumnIndex}"]`,
    );
    const endColumnHeader = table.locator(
        `.editor-table-detached-column-header-layer .editor-table-column-header[data-col="${endColumnIndex}"]`,
    );

    await startColumnHeader.click();
    if (endColumnIndex !== startColumnIndex) await endColumnHeader.click({modifiers: ['Shift']});

    await expect(
        table.locator('.editor-table-detached-column-header-layer .editor-table-column-header.selected')
    ).toHaveCount(endColumnIndex - startColumnIndex + 1);
}

async function getDetachedRowHeaderRectsAsync(page: Page, startRowIndex: number, endRowIndex: number): Promise<HeaderRect[]> {
    return page.evaluate(({startRowIndex, endRowIndex}) => {
        const rects: HeaderRect[] = [];
        for (let rowIndex = startRowIndex; rowIndex <= endRowIndex; rowIndex++) {
            const rowHeader = document.querySelector<HTMLElement>(
                `.editor-left-pane .editor-table-detached-row-header-layer .editor-table-detached-row[data-row-index="${rowIndex}"] .editor-table-row-header`,
            );
            if (rowHeader === null) throw new Error(`row header ${rowIndex} not found`);
            const rect = rowHeader.getBoundingClientRect();
            rects.push({left: rect.left, top: rect.top, width: rect.width, height: rect.height});
        }
        return rects;
    }, {startRowIndex, endRowIndex});
}

async function getDetachedColumnHeaderRectsAsync(page: Page, startColumnIndex: number, endColumnIndex: number): Promise<HeaderRect[]> {
    return page.evaluate(({startColumnIndex, endColumnIndex}) => {
        const rects: HeaderRect[] = [];
        for (let columnIndex = startColumnIndex; columnIndex <= endColumnIndex; columnIndex++) {
            const columnHeader = document.querySelector<HTMLElement>(
                `.editor-left-pane .editor-table-detached-column-header-layer .editor-table-column-header[data-col="${columnIndex}"]`,
            );
            if (columnHeader === null) throw new Error(`column header ${columnIndex} not found`);
            const rect = columnHeader.getBoundingClientRect();
            rects.push({left: rect.left, top: rect.top, width: rect.width, height: rect.height});
        }
        return rects;
    }, {startColumnIndex, endColumnIndex});
}

async function getDetachedColumnHeaderClipRectAsync(page: Page): Promise<HeaderRect> {
    return page.evaluate(() => {
        const viewport = document.querySelector<HTMLElement>(
            '.editor-left-pane .editor-table-top-viewport',
        );
        if (viewport === null) throw new Error('column header viewport not found');
        const rect = viewport.getBoundingClientRect();
        return {left: rect.left, top: rect.top, width: rect.width, height: rect.height};
    });
}

async function assertRowHeaderPixelsAsync(
    page: Page,
    screenshotPath: string,
    startRowIndex: number,
    endRowIndex: number,
): Promise<void> {
    const rects = await getDetachedRowHeaderRectsAsync(page, startRowIndex, endRowIndex);
    const devicePixelRatio = await page.evaluate(() => window.devicePixelRatio);
    const screenshot = await page.screenshot({path: screenshotPath, fullPage: true, scale: 'device'});
    const image = readPng(screenshot);
    const sampleX = Math.floor((rects[0].left + rects[0].width * 0.75) * devicePixelRatio);
    const scanStartY = Math.floor(rects[0].top * devicePixelRatio);
    const lastRect = rects[rects.length - 1];
    const scanEndY = Math.min(
        image.height - 1,
        Math.ceil((lastRect.top + lastRect.height + 2) * devicePixelRatio),
    );
    const runs = getVerticalRuns(image, sampleX, scanStartY, scanEndY);
    const selectedRuns = runs.filter(run => run.kind === 'selected');

    expect(selectedRuns).toHaveLength(endRowIndex - startRowIndex + 1);
    for (let i = 0; i < selectedRuns.length - 1; i++) {
        const separatorRuns = runs.filter(
            run => run.start > selectedRuns[i].end && run.end < selectedRuns[i + 1].start,
        );
        expect(separatorRuns).toHaveLength(1);
        expect(separatorRuns[0].kind).toBe('background');
        expect(separatorRuns[0].end - separatorRuns[0].start + 1).toBeLessThanOrEqual(Math.ceil(devicePixelRatio));
    }

    for (const rect of rects) {
        const edgeX = Math.ceil((rect.left + rect.width) * devicePixelRatio) - 1;
        const edgeY = Math.floor((rect.top + rect.height * 0.35) * devicePixelRatio);
        expect(classifyColor(rgbAt(image, edgeX, edgeY))).toBe('background');
    }
}

async function assertColumnHeaderPixelsAsync(
    page: Page,
    screenshotPath: string,
    startColumnIndex: number,
    endColumnIndex: number,
): Promise<void> {
    const rects = await getDetachedColumnHeaderRectsAsync(page, startColumnIndex, endColumnIndex);
    const clipRect = await getDetachedColumnHeaderClipRectAsync(page);
    const devicePixelRatio = await page.evaluate(() => window.devicePixelRatio);
    const screenshot = await page.screenshot({path: screenshotPath, fullPage: true, scale: 'device'});
    const image = readPng(screenshot);
    const sampleY = Math.floor((rects[0].top + rects[0].height * 0.75) * devicePixelRatio);
    const clipRight = clipRect.left + clipRect.width;

    for (let i = 0; i < rects.length - 1; i++) {
        const boundaryX = Math.round((rects[i].left + rects[i].width) * devicePixelRatio);
        const boundaryCssX = rects[i].left + rects[i].width;
        if (boundaryCssX < clipRect.left || boundaryCssX > clipRight) continue;
        const runs = getHorizontalRuns(
            image,
            sampleY,
            Math.max(0, boundaryX - Math.ceil(3 * devicePixelRatio)),
            Math.min(image.width - 1, boundaryX + Math.ceil(3 * devicePixelRatio)),
        );
        const separatorRuns = runs.filter(run => run.kind === 'background');
        expect(separatorRuns.some(run => run.end - run.start + 1 <= Math.ceil(devicePixelRatio))).toBe(true);
    }

    for (const rect of rects) {
        const visibleLeft = Math.max(rect.left, clipRect.left);
        const visibleRight = Math.min(rect.left + rect.width, clipRight);
        expect(visibleRight).toBeGreaterThan(visibleLeft);
        const bottomY = Math.ceil((rect.top + rect.height) * devicePixelRatio) - 1;
        const bottomX = Math.floor((visibleLeft + (visibleRight - visibleLeft) * 0.85) * devicePixelRatio);
        expect(classifyColor(rgbAt(image, bottomX, bottomY))).toBe('background');
    }

    const lastRect = rects[rects.length - 1];
    const lastRight = lastRect.left + lastRect.width;
    if (lastRight <= clipRight) {
        const rightX = Math.ceil(lastRight * devicePixelRatio) - 1;
        expect(classifyColor(rgbAt(image, rightX, sampleY))).toBe('background');
    }
}

test.describe('one-row selection screenshot at 200%', () => {
    test.use({viewport: {width: 640, height: 360}, deviceScaleFactor: 2});

    test('1行選択 200%', async ({page, mockFileSystem}) => {
        await selectRowsAsync(page, 1, 1);
        await assertRowHeaderPixelsAsync(page, resolve(outputDir, 'one-row-zoom200.png'), 1, 1);
    });
});

test.describe('one-row selection screenshot at 300%', () => {
    test.use({viewport: {width: 427, height: 240}, deviceScaleFactor: 3});

    test('1行選択 300%', async ({page, mockFileSystem}) => {
        await selectRowsAsync(page, 1, 1);
        await assertRowHeaderPixelsAsync(page, resolve(outputDir, 'one-row-zoom300.png'), 1, 1);
    });
});

test.describe('three-row selection screenshot at 200%', () => {
    test.use({viewport: {width: 640, height: 360}, deviceScaleFactor: 2});

    test('3行選択 200%', async ({page, mockFileSystem}) => {
        await selectRowsAsync(page, 0, 2);
        await assertRowHeaderPixelsAsync(page, resolve(outputDir, 'three-rows-zoom200.png'), 0, 2);
    });
});

test.describe('three-row selection screenshot at 300%', () => {
    test.use({viewport: {width: 427, height: 240}, deviceScaleFactor: 3});

    test('3行選択 300%', async ({page, mockFileSystem}) => {
        await selectRowsAsync(page, 0, 2);
        await assertRowHeaderPixelsAsync(page, resolve(outputDir, 'three-rows-zoom300.png'), 0, 2);
    });
});

test.describe('one-column selection screenshot at 200%', () => {
    test.use({viewport: {width: 800, height: 360}, deviceScaleFactor: 2});

    test('1列選択 200%', async ({page, mockFileSystem}) => {
        await selectColumnsAsync(page, 1, 1);
        await assertColumnHeaderPixelsAsync(page, resolve(outputDir, 'one-column-zoom200.png'), 1, 1);
    });
});

test.describe('one-column selection screenshot at 300%', () => {
    test.use({viewport: {width: 800, height: 360}, deviceScaleFactor: 3});

    test('1列選択 300%', async ({page, mockFileSystem}) => {
        await selectColumnsAsync(page, 1, 1);
        await assertColumnHeaderPixelsAsync(page, resolve(outputDir, 'one-column-zoom300.png'), 1, 1);
    });
});

test.describe('three-column selection screenshot at 200%', () => {
    test.use({viewport: {width: 800, height: 360}, deviceScaleFactor: 2});

    test('3列選択 200%', async ({page, mockFileSystem}) => {
        await selectColumnsAsync(page, 0, 2);
        await assertColumnHeaderPixelsAsync(page, resolve(outputDir, 'three-columns-zoom200.png'), 0, 2);
    });
});

test.describe('three-column selection screenshot at 300%', () => {
    test.use({viewport: {width: 800, height: 360}, deviceScaleFactor: 3});

    test('3列選択 300%', async ({page, mockFileSystem}) => {
        await selectColumnsAsync(page, 0, 2);
        await assertColumnHeaderPixelsAsync(page, resolve(outputDir, 'three-columns-zoom300.png'), 0, 2);
    });
});
