import {test, expect} from './fixtures/test';
import {installMockApiAsync, MockFileSystem} from './fixtures/mock-api';

function generateCsv(rowCount: number): string {
    const rows = ['id,group_id,label,score,rank,export_begin_date,export_end_date'];
    for (let i = 1; i <= rowCount; i++) {
        rows.push(`${i},1,group_${String(i).padStart(3, '0')},${(i * 137) % 10000},${['S', 'A', 'B', 'C', 'D'][i % 5]},,`);
    }
    return rows.join('\n');
}

function createFileSystem(): MockFileSystem {
    return {
        'schema/gacha_item.json': JSON.stringify({
            header: [
                {key: 0, name: 'id', type: 'int', comment: 'ID'},
                {key: 1, name: 'group_id', type: 'int', comment: 'group ID'},
                {key: 2, name: 'label', type: 'string', comment: 'label'},
                {key: 3, name: 'score', type: 'int', comment: 'score'},
                {key: 4, name: 'rank', type: 'string', comment: 'rank'},
                {key: 5, name: 'export_begin_date', type: 'string', comment: 'begin'},
                {key: 6, name: 'export_end_date', type: 'string', comment: 'end'},
            ],
            primary_key: ['id'],
        }),
        'data/gacha_item.csv': generateCsv(1000),
    };
}

test.describe('virtual scroll column header', () => {
    test('does not show a second column header inside the body after scrolling', async ({page}) => {
        await installMockApiAsync(page, createFileSystem());
        await page.goto('/');

        await page.locator('#explorer .explorer-file').getByText('gacha_item', {exact: true}).click();
        const table = page.locator('.editor-left-slot .editor-table:visible').first();
        await expect(table).toBeVisible();

        const scrollArea = page.locator('.editor-left-pane');
        await scrollArea.evaluate((element) => {
            element.scrollTop = 1200;
            element.dispatchEvent(new Event('scroll'));
        });
        await page.waitForTimeout(300);
        await scrollArea.evaluate((element) => {
            element.scrollTop = 0;
            element.dispatchEvent(new Event('scroll'));
        });
        await page.waitForTimeout(300);

        const metrics = await table.evaluate((tableElement) => {
            const viewportElement = tableElement.querySelector<HTMLElement>('.editor-table-main-viewport');
            const topPane = tableElement.querySelector<HTMLElement>('.editor-table-pane-top-right');
            const sourceHeader = tableElement.querySelector<HTMLElement>('.editor-table-grid > .editor-table-source-column-header-row');
            const detachedHeaderRows = Array.from(tableElement.querySelectorAll<HTMLElement>(
                '.editor-table-detached-column-header-layer > .editor-table-column-header-row'
            ));
            if (viewportElement === null || topPane === null || sourceHeader === null) {
                throw new Error('table layout was not initialized');
            }

            const viewportRect = viewportElement.getBoundingClientRect();
            const bodyTop = Math.max(viewportRect.top, topPane.getBoundingClientRect().bottom);
            const bodyBottom = viewportRect.bottom;
            const sourceRect = sourceHeader.getBoundingClientRect();
            const sourceStyle = window.getComputedStyle(sourceHeader);
            const sourceIsPainted = sourceStyle.visibility !== 'hidden'
                && sourceStyle.display !== 'none'
                && Number(sourceStyle.opacity) > 0.01;
            const sourceIntersectsBody = sourceRect.bottom > bodyTop && sourceRect.top < bodyBottom;
            const sourceCellsVisible = Array.from(sourceHeader.children).some((child) => {
                return window.getComputedStyle(child as Element).visibility !== 'hidden';
            });

            const headerHitTests: Array<{x: number; y: number; className: string; text: string}> = [];
            const sampleXs = [160, 280, 440, 620, 760].filter((x) => x >= viewportRect.left && x <= viewportRect.right);
            for (let y = bodyTop + 8; y < Math.min(bodyBottom, bodyTop + 360); y += 8) {
                for (const x of sampleXs) {
                    const hit = document.elementsFromPoint(x, y).find((element) => {
                        return element instanceof HTMLElement
                            && (element.closest('.editor-table-source-column-header-row') !== null
                                || element.closest('.editor-table-detached-column-header-layer') !== null);
                    }) as HTMLElement | undefined;
                    if (hit !== undefined) {
                        headerHitTests.push({
                            x: Math.round(x),
                            y: Math.round(y),
                            className: hit.className,
                            text: (hit.textContent ?? '').trim(),
                        });
                    }
                }
            }

            return {
                scrollTop: viewportElement.scrollTop,
                bodyTop,
                bodyBottom,
                sourceIntersectsBody,
                sourceIsPainted,
                sourceCellsVisible,
                sourceVisibility: sourceStyle.visibility,
                sourceOpacity: sourceStyle.opacity,
                sourceRect: {
                    top: sourceRect.top,
                    bottom: sourceRect.bottom,
                    height: sourceRect.height,
                },
                detachedHeaderRowCount: detachedHeaderRows.length,
                detachedHeaderRects: detachedHeaderRows.map((row) => {
                    const rect = row.getBoundingClientRect();
                    return {top: rect.top, bottom: rect.bottom, height: rect.height};
                }),
                headerHitTests: headerHitTests.slice(0, 10),
            };
        });

        expect(metrics.detachedHeaderRowCount, JSON.stringify(metrics)).toBe(1);
        expect(metrics.sourceIsPainted, JSON.stringify(metrics)).toBe(false);
        expect(metrics.headerHitTests, JSON.stringify(metrics)).toEqual([]);
        expect(
            metrics.sourceIntersectsBody && metrics.sourceIsPainted,
            JSON.stringify(metrics)
        ).toBe(false);
    });
});
