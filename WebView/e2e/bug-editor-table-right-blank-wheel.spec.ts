import {test, expect} from './fixtures/test';
import {installMockApiAsync, MockFileSystem} from './fixtures/mock-api';

function createNarrowFrozenTableFileSystem(): MockFileSystem {
    const rows = ['id,name,value'];
    for (let i = 1; i <= 120; i++) {
        rows.push(`${i},item_${i},${i * 10}`);
    }

    return {
        'schema/test.json': JSON.stringify({
            header: [
                {key: 0, name: 'id', type: 'int', width: 120},
                {key: 1, name: 'name', type: 'string', width: 160},
                {key: 2, name: 'value', type: 'int', width: 120},
            ],
            primary_key: ['id'],
            frozenRowCount: 2,
        }),
        'data/test.csv': rows.join('\n'),
    };
}

test('列の右側の余白でもテーブル内と同じ固定行スクロールを行うこと', async ({page}) => {
    await page.setViewportSize({width: 1600, height: 720});
    await installMockApiAsync(page, createNarrowFrozenTableFileSystem());
    await page.goto('/');

    await page.locator('#explorer .explorer-file').getByText('test', {exact: true}).click();

    const mainViewport = page.locator('.editor-left-pane .editor-table-main-viewport').first();
    await expect(mainViewport).toBeVisible();

    const result = await page.evaluate(() => {
        const viewport = document.querySelector('.editor-left-pane .editor-table-main-viewport') as HTMLElement | null;
        const grid = document.querySelector('.editor-left-pane .editor-table-pane-bottom-right > .editor-table-grid') as HTMLElement | null;
        const frozenRow = document.querySelector('.editor-left-pane .editor-table-detached-frozen-row-layer .editor-table-detached-row') as HTMLElement | null;
        const dataCell = grid?.querySelector('.editor-table-row[data-row-index="5"] .editor-table-cell:not(.editor-table-row-header)') as HTMLElement | null;
        const editor = (window as unknown as {
            editor?: {
                activeEditorTable: {
                    getScrollTop(): number;
                    restoreScrollPosition(scrollTop: number, scrollLeft: number): void;
                } | false;
            };
        }).editor;
        if (viewport === null) throw new Error('editor-table-main-viewport が見つかりません');
        if (grid === null) throw new Error('editor-table-grid が見つかりません');
        if (frozenRow === null) throw new Error('固定行が見つかりません');
        if (dataCell === null) throw new Error('テーブル内のデータセルが見つかりません');
        if (!editor || editor.activeEditorTable === false) throw new Error('activeEditorTable が見つかりません');

        const viewportRect = viewport.getBoundingClientRect();
        const gridRect = grid.getBoundingClientRect();
        if (gridRect.right + 20 >= viewportRect.right - 20) {
            throw new Error('テーブル右側の余白を確保できません');
        }
        const blankTarget = document.elementFromPoint(
            gridRect.right + ((viewportRect.right - gridRect.right) / 2),
            viewportRect.top + Math.min(80, viewportRect.height / 2),
        );
        if (!(blankTarget instanceof HTMLElement)) throw new Error('右側余白の要素が見つかりません');

        const frozenTopBefore = frozenRow.getBoundingClientRect().top;
        editor.activeEditorTable.restoreScrollPosition(0, 0);
        const cellWheelEvent = new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            deltaY: 100,
        });
        dataCell.dispatchEvent(cellWheelEvent);
        const cellScrollTop = editor.activeEditorTable.getScrollTop();

        editor.activeEditorTable.restoreScrollPosition(0, 0);
        const wheelEvent = new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            deltaY: 100,
        });
        const dispatchResult = blankTarget.dispatchEvent(wheelEvent);

        return {
            targetInsideMainViewport: viewport.contains(blankTarget),
            targetInsideGrid: grid.contains(blankTarget),
            cellDefaultPrevented: cellWheelEvent.defaultPrevented,
            cellScrollTop,
            defaultPrevented: wheelEvent.defaultPrevented,
            dispatchResult,
            scrollTop: editor.activeEditorTable.getScrollTop(),
            frozenTopBefore,
            frozenTopAfter: frozenRow.getBoundingClientRect().top,
        };
    });

    expect(result.targetInsideMainViewport).toBeTruthy();
    expect(result.targetInsideGrid).toBeFalsy();
    expect(result.cellDefaultPrevented).toBeTruthy();
    expect(result.defaultPrevented).toBeTruthy();
    expect(result.dispatchResult).toBeFalsy();
    expect(result.scrollTop).toBe(result.cellScrollTop);
    expect(result.scrollTop).toBe(100);
    expect(result.frozenTopAfter).toBeCloseTo(result.frozenTopBefore, 5);
});
