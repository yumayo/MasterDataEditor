import { test, expect } from './fixtures/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

function createFileSystem(): MockFileSystem {
    const rows: string[] = ['id,name,recover_stamina,recover_hp,attack,defence,speed,skill_id,selling_price'];
    for (let i = 1; i <= 120; i++) {
        rows.push([
            `${i}`,
            `chara_${i}`,
            `${(i * 3) % 17 + 1}`,
            `${(i * 7) % 19 + 1}`,
            `${(i * 5) % 23 + 1}`,
            `${(i * 11) % 29 + 1}`,
            `${(i * 13) % 31 + 1}`,
            `${(i * 17) % 101 + 1}`,
            `${(i * 379) % 5000 + 50}`,
        ].join(','));
    }

    return {
        'schema/chara.json': JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int', width: 220 },
                { key: 1, name: 'name', type: 'string', width: 220 },
                { key: 2, name: 'recover_stamina', type: 'int', width: 220 },
                { key: 3, name: 'recover_hp', type: 'int', width: 220 },
                { key: 4, name: 'attack', type: 'int', width: 220 },
                { key: 5, name: 'defence', type: 'int', width: 220 },
                { key: 6, name: 'speed', type: 'int', width: 220 },
                { key: 7, name: 'skill_id', type: 'int', width: 220 },
                { key: 8, name: 'selling_price', type: 'int', width: 220 },
            ],
            primary_key: ['id'],
        }),
        'data/chara.csv': rows.join('\n'),
    };
}

test('通常テーブルでは外側スクロールバーだけを隠し、右下ビューポートの横スクロールバーは残すこと', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await installMockApiAsync(page, createFileSystem());
    await page.goto('/');

    await page.locator('#explorer .explorer-file').getByText('chara', { exact: true }).click();

    const leftPane = page.locator('.editor-left-pane');
    await expect(leftPane).toBeVisible();
    const mainViewport = page.locator('.editor-left-pane .editor-table-main-viewport').first();
    await expect(mainViewport).toBeVisible();

    const metrics = await page.evaluate(() => {
        const leftPaneElement = document.querySelector('.editor-left-pane') as HTMLElement | null;
        const mainViewportElement = document.querySelector('.editor-left-pane .editor-table-main-viewport') as HTMLElement | null;
        if (leftPaneElement === null) throw new Error('editor-left-pane が見つかりません');
        if (mainViewportElement === null) throw new Error('editor-table-main-viewport が見つかりません');
        const leftPaneStyle = window.getComputedStyle(leftPaneElement);
        const mainViewportStyle = window.getComputedStyle(mainViewportElement);
        return {
            leftPaneScrollbarWidth: leftPaneStyle.getPropertyValue('scrollbar-width').trim(),
            mainViewportScrollbarWidth: mainViewportStyle.getPropertyValue('scrollbar-width').trim(),
            mainViewportOverflowX: mainViewportStyle.overflowX,
            mainViewportOverflowY: mainViewportStyle.overflowY,
            hasHorizontalOverflow: mainViewportElement.scrollWidth > mainViewportElement.clientWidth,
            hasVerticalOverflow: mainViewportElement.scrollHeight > mainViewportElement.clientHeight,
        };
    });

    const mainViewportMetrics = await mainViewport.evaluate((element) => {
        const viewport = element as HTMLElement;
        const style = window.getComputedStyle(viewport);
        return {
            overflowX: style.overflowX,
            overflowY: style.overflowY,
            scrollbarWidth: style.getPropertyValue('scrollbar-width').trim(),
        };
    });

    expect(metrics.leftPaneScrollbarWidth).toBe('none');
    expect(metrics.mainViewportScrollbarWidth).toBe('auto');
    expect(metrics.hasHorizontalOverflow).toBeTruthy();
    expect(metrics.hasVerticalOverflow).toBeTruthy();
    expect(metrics.mainViewportOverflowX).toBe('auto');
    expect(metrics.mainViewportOverflowY).toBe('hidden');
    expect(mainViewportMetrics.overflowX).toBe('auto');
    expect(mainViewportMetrics.overflowY).toBe('hidden');
    expect(mainViewportMetrics.scrollbarWidth).toBe('auto');
});

test('右下ビューポートの横スクロールバー領域をeditor-tableが覆わないこと', async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 540 });
    await installMockApiAsync(page, createFileSystem());
    await page.goto('/');

    await page.locator('#explorer .explorer-file').getByText('chara', { exact: true }).click();

    const mainViewport = page.locator('.editor-left-pane .editor-table-main-viewport').first();
    await expect(mainViewport).toBeVisible();

    const metrics = await page.evaluate(() => {
        const viewport = document.querySelector('.editor-left-pane .editor-table-main-viewport') as HTMLElement | null;
        const grid = document.querySelector('.editor-left-pane .editor-table-pane-bottom-right > .editor-table-grid') as HTMLElement | null;
        const horizontalScrollbar = document.querySelector('.editor-left-pane .editor-table-logical-horizontal-scrollbar') as HTMLElement | null;
        const editor = (window as unknown as {
            editor?: { activeEditorTable: { refreshDetachedHeaderLayout(): void } | false };
        }).editor;
        if (viewport === null) throw new Error('editor-table-main-viewport が見つかりません');
        if (grid === null) throw new Error('editor-table-grid が見つかりません');
        if (horizontalScrollbar === null) throw new Error('editor-table-logical-horizontal-scrollbar が見つかりません');
        if (!editor || editor.activeEditorTable === false) throw new Error('activeEditorTable が見つかりません');

        editor.activeEditorTable.refreshDetachedHeaderLayout();

        const viewportRect = viewport.getBoundingClientRect();
        const gutterHeight = viewport.offsetHeight - viewport.clientHeight;
        const reservedHeight = horizontalScrollbar.getBoundingClientRect().height;
        const hit = document.elementFromPoint(
            viewportRect.left + (viewportRect.width / 2),
            viewportRect.bottom - (reservedHeight / 2)
        ) as HTMLElement | null;

        return {
            gutterHeight,
            reservedHeight,
            gridText: grid.textContent ?? '',
            hitClassName: hit?.className ?? '',
            hitInsideHorizontalScrollbar: hit?.closest('.editor-table-logical-horizontal-scrollbar') !== null,
            hitInsideGrid: hit?.closest('.editor-table-grid') !== null,
            hitInsideCell: hit?.closest('.editor-table-cell') !== null,
        };
    });

    expect(metrics.gutterHeight).toBeGreaterThanOrEqual(0);
    expect(metrics.reservedHeight).toBe(12);
    expect(metrics.gridText).toContain('chara_1');
    expect(metrics.hitInsideHorizontalScrollbar, `hitClass=${metrics.hitClassName}`).toBeTruthy();
    expect(metrics.hitInsideGrid, `hitClass=${metrics.hitClassName}`).toBeFalsy();
    expect(metrics.hitInsideCell, `hitClass=${metrics.hitClassName}`).toBeFalsy();
});

test('横スクロールバー領域のドラッグでセル選択ではなく横スクロールすること', async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 540 });
    await installMockApiAsync(page, createFileSystem());
    await page.goto('/');

    await page.locator('#explorer .explorer-file').getByText('chara', { exact: true }).click();

    const horizontalScrollbar = page.locator('.editor-left-pane .editor-table-logical-horizontal-scrollbar').first();
    await expect(horizontalScrollbar).toBeVisible();

    const before = await page.evaluate(() => {
        const viewport = document.querySelector('.editor-left-pane .editor-table-main-viewport') as HTMLElement | null;
        const focused = document.querySelector('.editor-left-pane .editor-table-cell-focused') as HTMLElement | null;
        if (viewport === null) throw new Error('editor-table-main-viewport が見つかりません');
        return {
            scrollLeft: viewport.scrollLeft,
            focusedText: focused?.textContent?.trim() ?? '',
        };
    });

    const box = await horizontalScrollbar.boundingBox();
    if (box === null) throw new Error('横スクロールバーの位置が取得できません');
    const y = box.y + (box.height / 2);
    await page.mouse.move(box.x + 30, y);
    await page.mouse.down();
    await page.mouse.move(box.x + 260, y, { steps: 6 });
    await page.mouse.up();

    const after = await page.evaluate(() => {
        const viewport = document.querySelector('.editor-left-pane .editor-table-main-viewport') as HTMLElement | null;
        const focused = document.querySelector('.editor-left-pane .editor-table-cell-focused') as HTMLElement | null;
        if (viewport === null) throw new Error('editor-table-main-viewport が見つかりません');
        return {
            scrollLeft: viewport.scrollLeft,
            focusedText: focused?.textContent?.trim() ?? '',
        };
    });

    expect(after.scrollLeft).toBeGreaterThan(before.scrollLeft);
    expect(after.focusedText).toBe(before.focusedText);
});
