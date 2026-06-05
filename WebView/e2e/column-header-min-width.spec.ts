import { test, expect } from './fixtures/test';
import { Locator, Page } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';
import {
    COLUMN_HEADER_FONT,
    HEADER_BADGE_AREA_PX,
    HEADER_ICON_AREA_PX,
    HEADER_LABEL_SAFE_GAP_PX,
    HEADER_SIDE_PADDING_PX,
    MIN_COLUMN_WIDTH_PX,
} from '../src/core/constant';

function createMinWidthFileSystem(): MockFileSystem {
    return {
        'schema/enemy.json': JSON.stringify({
            primary_key: ['id'],
            header: [
                { key: 0, name: 'id', type: 'int' },
                { key: 1, name: 'name', type: 'string' },
            ],
        }),
        'data/enemy.csv': [
            'id,name',
            '1,Slime',
        ].join('\n'),
        'schema/min_width.json': JSON.stringify({
            primary_key: ['id'],
            header: [
                { key: 0, name: 'id', type: 'int', width: 1 },
                { key: 1, name: 'enemy_id', type: 'int', reference: 'enemy.name', width: 220 },
                { key: 2, name: 'name', type: 'string', width: 1 },
            ],
        }),
        'data/min_width.csv': [
            'id,enemy_id,name',
            '1,1,alpha',
        ].join('\n'),
    };
}

async function openTableAsync(page: Page): Promise<Locator> {
    await page.locator('#explorer').getByText('min_width', { exact: true }).click();
    const table = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="min_width"] .editor-table');
    await expect(table).toBeVisible();
    return table;
}

function getColumnHeader(table: Locator, colIndex: number): Locator {
    return table.locator('.editor-table-column-header-row .editor-table-column-header').nth(colIndex);
}

async function calculateHeaderMinimumWidthAsync(header: Locator): Promise<number> {
    return header.evaluate((el: Element, metrics) => {
        const headerCell = el as HTMLElement;
        const nameElement = headerCell.querySelector<HTMLElement>('.column-header-name');
        let label = nameElement?.textContent ?? '';
        if (label === '') {
            for (const node of Array.from(headerCell.childNodes)) {
                if (node.nodeType === Node.TEXT_NODE) {
                    label = (node.textContent ?? '').trim();
                    break;
                }
            }
        }
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        const labelWidth = context === null
            ? 0
            : (() => {
                context.font = metrics.columnHeaderFont;
                return Math.ceil(context.measureText(label).width);
            })();
        const hasBadge = headerCell.querySelector('.column-header-badge-area') !== null;
        const hasIcons = headerCell.querySelector('.filter-icon, .sort-indicator') !== null;
        const leftArea = hasBadge ? metrics.headerBadgeAreaPx : metrics.headerSidePaddingPx;
        const rightArea = hasIcons ? metrics.headerIconAreaPx : metrics.headerSidePaddingPx;
        return Math.max(
            labelWidth + leftArea + rightArea + metrics.headerLabelSafeGapPx,
            metrics.minColumnWidthPx,
        );
    }, {
        columnHeaderFont: COLUMN_HEADER_FONT,
        headerBadgeAreaPx: HEADER_BADGE_AREA_PX,
        headerIconAreaPx: HEADER_ICON_AREA_PX,
        headerLabelSafeGapPx: HEADER_LABEL_SAFE_GAP_PX,
        headerSidePaddingPx: HEADER_SIDE_PADDING_PX,
        minColumnWidthPx: MIN_COLUMN_WIDTH_PX,
    });
}

async function getInlineWidthPxAsync(header: Locator): Promise<number> {
    return header.evaluate((el: Element) => parseFloat((el as HTMLElement).style.width));
}

test.describe('column header minimum width', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createMinWidthFileSystem());
        await page.goto('/');
    });

    test('schema width is clamped to the combined header parts minimum', async ({ page }) => {
        const table = await openTableAsync(page);

        for (const colIndex of [0, 1, 2]) {
            const header = getColumnHeader(table, colIndex);
            const minimumWidth = await calculateHeaderMinimumWidthAsync(header);
            const inlineWidth = await getInlineWidthPxAsync(header);
            expect(inlineWidth).toBeGreaterThanOrEqual(minimumWidth);
        }
    });

    test('drag resize cannot shrink a header below its combined parts minimum', async ({ page }) => {
        const table = await openTableAsync(page);
        const header = getColumnHeader(table, 1);
        const minimumWidth = await calculateHeaderMinimumWidthAsync(header);
        const box = await header.boundingBox();
        if (box === null) throw new Error('header bounding box was not available');

        const startX = box.x + box.width - 2;
        const startY = box.y + box.height / 2;
        await page.mouse.move(startX, startY);
        await page.mouse.down();
        await page.mouse.move(startX - 500, startY);
        await page.mouse.up();

        const inlineWidth = await getInlineWidthPxAsync(header);
        expect(inlineWidth).toBeGreaterThanOrEqual(minimumWidth);
        expect(inlineWidth).toBeLessThanOrEqual(minimumWidth + 1);
    });
});
