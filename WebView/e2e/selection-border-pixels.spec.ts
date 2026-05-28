import {test, expect} from './fixtures/test';
import type {Page} from '@playwright/test';
import {inflateSync} from 'zlib';

type Rgb = [number, number, number];

interface PngImage {
    width: number;
    height: number;
    channels: number;
    pixels: Uint8Array;
}

interface Rect {
    left: number;
    top: number;
    right: number;
    bottom: number;
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
    const safeX = Math.max(0, Math.min(image.width - 1, x));
    const safeY = Math.max(0, Math.min(image.height - 1, y));
    const offset = (safeY * image.width + safeX) * image.channels;
    return [image.pixels[offset], image.pixels[offset + 1], image.pixels[offset + 2]];
}

function isSelectionBlue(pixel: Rgb): boolean {
    const [r, g, b] = pixel;
    return Math.abs(r - 0) <= 4 && Math.abs(g - 120) <= 4 && Math.abs(b - 215) <= 4;
}

function isSelectionFill(pixel: Rgb): boolean {
    const [r, g, b] = pixel;
    return r <= 40 && g >= 50 && b >= 70;
}

async function selectTwoByTwoAsync(page: Page): Promise<Rect> {
    await page.locator('#explorer').getByText('test', {exact: true}).click();
    const table = page.locator('.editor-left-pane .editor-table');
    await expect(table).toBeVisible();

    const topLeft = table.locator(
        '.editor-table-grid .editor-table-row[data-row-index="0"] .editor-table-cell[data-col="0"]',
    );
    const bottomRight = table.locator(
        '.editor-table-grid .editor-table-row[data-row-index="1"] .editor-table-cell[data-col="1"]',
    );
    await topLeft.click();
    await bottomRight.click({modifiers: ['Shift']});
    await expect(topLeft).toHaveClass(/sel-top/);
    await expect(topLeft).toHaveClass(/sel-left/);
    await expect(bottomRight).toHaveClass(/sel-bottom/);
    await expect(bottomRight).toHaveClass(/sel-right/);

    return page.evaluate(() => {
        const startCell = document.querySelector<HTMLElement>(
            '.editor-left-pane .editor-table-grid .editor-table-row[data-row-index="0"] .editor-table-cell[data-col="0"]',
        );
        const endCell = document.querySelector<HTMLElement>(
            '.editor-left-pane .editor-table-grid .editor-table-row[data-row-index="1"] .editor-table-cell[data-col="1"]',
        );
        if (startCell === null || endCell === null) throw new Error('selected cells not found');
        const start = startCell.getBoundingClientRect();
        const end = endCell.getBoundingClientRect();
        return {
            left: start.left,
            top: start.top,
            right: end.right,
            bottom: end.bottom,
            width: end.right - start.left,
            height: end.bottom - start.top,
        };
    });
}

async function selectSingleCellAsync(page: Page): Promise<Rect> {
    await page.locator('#explorer').getByText('test', {exact: true}).click();
    const table = page.locator('.editor-left-pane .editor-table');
    await expect(table).toBeVisible();

    const cell = table.locator(
        '.editor-table-grid .editor-table-row[data-row-index="0"] .editor-table-cell[data-col="0"]',
    );
    await cell.click();
    await expect(cell).toHaveClass(/sel-top/);
    await expect(cell).toHaveClass(/sel-bottom/);
    await expect(cell).toHaveClass(/sel-left/);
    await expect(cell).toHaveClass(/sel-right/);

    return cell.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
        };
    });
}

async function copySelectionAsync(page: Page): Promise<void> {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate(() => {
        const editor = (window as unknown as {
            editor?: {activeEditorTable: {
                getSelection(): {
                    copy(): void;
                };
            } | false};
        }).editor;
        if (!editor || editor.activeEditorTable === false) throw new Error('activeEditorTable not found');
        editor.activeEditorTable.getSelection().copy();
    });
}

async function assertSelectionBorderPixelsAsync(page: Page, rect: Rect): Promise<void> {
    await page.addStyleTag({content: '.fill-handle { display: none !important; }'});
    const overlayRect = await page.locator('.selection-overlay-border').evaluate((element) => {
        const currentRect = element.getBoundingClientRect();
        return {
            height: currentRect.height,
        };
    });
    const expectedOverlayHeight = Math.floor(rect.height + 0.01);
    expect(Math.abs(overlayRect.height - expectedOverlayHeight), `overlay height: ${overlayRect.height}, expected height: ${expectedOverlayHeight}, cell height: ${rect.height}`).toBeLessThanOrEqual(0.01);

    const devicePixelRatio = await page.evaluate(() => window.devicePixelRatio);
    const screenshot = await page.screenshot({fullPage: true, scale: 'device'});
    const image = readPng(screenshot);

    const left = Math.round(rect.left * devicePixelRatio);
    const top = Math.round(rect.top * devicePixelRatio);
    const right = Math.round(rect.right * devicePixelRatio) - 1;
    const bottom = Math.round((rect.top + expectedOverlayHeight) * devicePixelRatio) - 1;
    const borderInset = Math.max(1, Math.round(devicePixelRatio));

    const points: Record<string, Rgb> = {
        top: rgbAt(image, Math.round((left + right) / 2), top + borderInset),
        bottom: rgbAt(image, Math.round((left + right) / 2), bottom - borderInset),
        left: rgbAt(image, left + borderInset, Math.round((top + bottom) / 2)),
        right: rgbAt(image, right - borderInset, Math.round((top + bottom) / 2)),
        bottomEdge: rgbAt(image, Math.round((left + right) / 2), bottom),
        topLeft: rgbAt(image, left + borderInset, top + borderInset),
        topRight: rgbAt(image, right - borderInset, top + borderInset),
        bottomLeft: rgbAt(image, left + borderInset, bottom - borderInset),
        bottomRight: rgbAt(image, right - borderInset, bottom - borderInset),
    };

    for (const [name, pixel] of Object.entries(points)) {
        expect(isSelectionBlue(pixel), `${name}: rgb(${pixel.join(', ')})`).toBe(true);
    }

    const topY = top + borderInset;
    const bottomY = bottom - borderInset;
    for (let x = left + borderInset; x <= right - borderInset; x++) {
        const topPixel = rgbAt(image, x, topY);
        const bottomPixel = rgbAt(image, x, bottomY);
        expect(isSelectionBlue(topPixel), `top line x=${x}: rgb(${topPixel.join(', ')})`).toBe(true);
        expect(isSelectionBlue(bottomPixel), `bottom line x=${x}: rgb(${bottomPixel.join(', ')})`).toBe(true);
    }

    const leftX = left + borderInset;
    const rightX = right - borderInset;
    for (let y = top + borderInset; y <= bottom - borderInset; y++) {
        const leftPixel = rgbAt(image, leftX, y);
        const rightPixel = rgbAt(image, rightX, y);
        expect(isSelectionBlue(leftPixel), `left line y=${y}: rgb(${leftPixel.join(', ')})`).toBe(true);
        expect(isSelectionBlue(rightPixel), `right line y=${y}: rgb(${rightPixel.join(', ')})`).toBe(true);
    }
}

test('単一セル選択のborderはフォーカスセルでも表示される', async ({page, mockFileSystem}) => {
    const rect = await selectSingleCellAsync(page);
    await assertSelectionBorderPixelsAsync(page, rect);
});

test('2x2セル選択の外周borderは四隅まで欠けずに表示される', async ({page, mockFileSystem}) => {
    const rect = await selectTwoByTwoAsync(page);
    await assertSelectionBorderPixelsAsync(page, rect);
});

test('2x2セル選択のoverlayは外枠1個とフォーカスを除いた背景だけを描画する', async ({page, mockFileSystem}) => {
    await selectTwoByTwoAsync(page);
    await expect(page.locator('.selection-overlay-border')).toHaveCount(1);
    await expect(page.locator('.selection-overlay-grid-line')).toHaveCount(0);
    await expect(page.locator('.selection-overlay-bg')).toHaveCount(2);

    const samplePoints = await page.evaluate(() => {
        const focusCell = document.querySelector<HTMLElement>(
            '.editor-left-pane .editor-table-grid .editor-table-row[data-row-index="0"] .editor-table-cell[data-col="0"]',
        );
        const selectedCell = document.querySelector<HTMLElement>(
            '.editor-left-pane .editor-table-grid .editor-table-row[data-row-index="1"] .editor-table-cell[data-col="0"]',
        );
        if (focusCell === null || selectedCell === null) throw new Error('selected cells not found');
        const focus = focusCell.getBoundingClientRect();
        const selected = selectedCell.getBoundingClientRect();
        return {
            focus: {
                x: focus.left + focus.width * 0.25,
                y: focus.top + focus.height * 0.5,
            },
            selected: {
                x: selected.left + selected.width * 0.25,
                y: selected.top + selected.height * 0.5,
            },
        };
    });
    const devicePixelRatio = await page.evaluate(() => window.devicePixelRatio);
    const screenshot = await page.screenshot({fullPage: true, scale: 'device'});
    const image = readPng(screenshot);
    const focusPixel = rgbAt(
        image,
        Math.round(samplePoints.focus.x * devicePixelRatio),
        Math.round(samplePoints.focus.y * devicePixelRatio),
    );
    const selectedPixel = rgbAt(
        image,
        Math.round(samplePoints.selected.x * devicePixelRatio),
        Math.round(samplePoints.selected.y * devicePixelRatio),
    );

    expect(isSelectionFill(focusPixel), `focus: rgb(${focusPixel.join(', ')})`).toBe(false);
    expect(isSelectionFill(selectedPixel), `selected: rgb(${selectedPixel.join(', ')})`).toBe(true);
});

test('コピー範囲の点線はoverlayだけで描画する', async ({page, mockFileSystem}) => {
    await selectTwoByTwoAsync(page);
    await copySelectionAsync(page);

    await expect(page.locator('.copy-overlay-border')).toHaveCount(1);
    await expect(page.locator('.copy-top, .copy-bottom, .copy-left, .copy-right')).toHaveCount(0);

    const copyOverlayStyle = await page.locator('.copy-overlay-border').evaluate((element) => {
        const style = getComputedStyle(element);
        return {
            borderTopStyle: style.borderTopStyle,
            borderTopColor: style.borderTopColor,
        };
    });

    expect(copyOverlayStyle.borderTopStyle).toBe('dashed');
    expect(copyOverlayStyle.borderTopColor).toBe('rgb(0, 120, 215)');
});
