import type {Page, Locator} from '@playwright/test';
import {test, expect} from './fixtures/test';
import {installMockApiAsync, type MockFileSystem} from './fixtures/mock-api';

function createFileSystem(dateTimeValue: string): MockFileSystem {
    return {
        'schema/event.json': JSON.stringify({
            primary_key: ['id'],
            header: [
                {key: 0, name: 'id', type: 'int', width: 400},
                {key: 1, name: 'name', type: 'string', width: 400},
                {key: 2, name: 'start_at', type: 'datetime', width: 180},
            ],
        }),
        'data/event.csv': ['id,name,start_at', ...Array.from({length: 40}, (_, index) => `${index + 1},event_${index + 1},${dateTimeValue}`)].join('\n'),
    };
}

async function openTableAsync(page: Page, dateTimeValue: string): Promise<Locator> {
    await installMockApiAsync(page, createFileSystem(dateTimeValue));
    await page.goto('/');
    await page.locator('#explorer').getByText('event', {exact: true}).click();
    const table = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="event"] .editor-table');
    await expect(table).toBeVisible();
    await table.locator('.editor-table-main-viewport').evaluate(element => { element.scrollLeft = element.scrollWidth; });
    return table;
}

async function getBottomDateCellAsync(table: Locator): Promise<Locator> {
    const rowIndex = await table.evaluate(element => {
        const viewport = element.querySelector('.editor-table-main-viewport');
        if (viewport === null) throw new Error('テーブルの表示領域が見つかりません');
        const bounds = viewport.getBoundingClientRect();
        const rows = Array.from(element.querySelectorAll('.editor-table-row[data-row-index]')).filter(row => {
            const rect = row.getBoundingClientRect();
            return rect.top >= bounds.top && rect.bottom <= bounds.bottom - 16;
        });
        if (rows.length === 0) throw new Error('画面内のデータ行が見つかりません');
        return rows[rows.length - 1].getAttribute('data-row-index');
    });
    return table.locator(`.editor-table-row[data-row-index="${rowIndex}"] .editor-table-cell:not(.editor-table-row-header)`).nth(2);
}

async function expectWithinViewportAsync(popup: Locator): Promise<void> {
    await expect(popup).toBeVisible();
    await expect.poll(async () => popup.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return rect.left >= 8 && rect.top >= 8 && rect.right <= window.innerWidth - 8 && rect.bottom <= window.innerHeight - 8;
    })).toBe(true);
}

async function expectFrontmostAsync(popup: Locator): Promise<void> {
    // boundingClientRect だけでは祖先の overflow や別パネルによる遮蔽を検出できない。
    await expect.poll(async () => popup.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return [[rect.left + 4, rect.top + 4], [rect.right - 4, rect.top + 4], [rect.left + 4, rect.bottom - 4], [rect.right - 4, rect.bottom - 4]]
            .every(([x, y]) => element.contains(document.elementFromPoint(x, y)));
    })).toBe(true);
}

test('右下セルのカレンダーはテーブル外のパネルより前面に表示され、日時確定とUndo・Redoができる', async ({page}) => {
    await page.setViewportSize({width: 960, height: 800});
    const table = await openTableAsync(page, '2026-05-10 12:30:45');
    await page.locator('.status-bar-badge').click();
    const bottomPanel = page.locator('.bottom-panel');
    await expect(bottomPanel).toBeVisible();
    // カレンダーがテーブル下端をまたぐ配置を、実際のパネルリサイズで作る。
    const resizeHandle = bottomPanel.locator(':scope > .resize-handle');
    const handleBounds = await resizeHandle.boundingBox();
    if (handleBounds === null) throw new Error('下パネルのリサイズハンドルが見つかりません');
    await page.mouse.move(handleBounds.x + handleBounds.width / 2, handleBounds.y + handleBounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBounds.x + handleBounds.width / 2, handleBounds.y - 120, {steps: 8});
    await page.mouse.up();

    const cell = await getBottomDateCellAsync(table);
    await cell.dblclick();
    const popup = page.locator('.grid-date-time-picker-active .date-time-picker-popover');
    await expectWithinViewportAsync(popup);
    await expectFrontmostAsync(popup);
    const day = popup.locator('.date-time-picker-day[aria-label="2026-05-15"]');
    const dayBounds = await day.boundingBox();
    const tableBounds = await table.boundingBox();
    if (dayBounds === null || tableBounds === null) throw new Error('カレンダーとテーブルの座標を取得できません');
    expect(dayBounds.y).toBeGreaterThan(tableBounds.y + tableBounds.height);
    await day.click();
    await popup.locator('.date-time-picker-second-input').fill('55');
    await expect(popup).toHaveCount(0);
    await expect(cell).toContainText('2026-05-15 12:30:55');
    await page.keyboard.press('Control+z');
    await expect(cell).toContainText('2026-05-10 12:30:45');
    await page.keyboard.press('Control+y');
    await expect(cell).toContainText('2026-05-15 12:30:55');

    // autoDump にテーブル外へ開いた状態の画像を残す。
    await cell.dblclick();
    await expectWithinViewportAsync(popup);
    await expectFrontmostAsync(popup);
});

test('画面右下セルのカレンダーは画面内の上側へ開く', async ({page}) => {
    await page.setViewportSize({width: 960, height: 540});
    const table = await openTableAsync(page, '2026-05-10 12:30:45');
    const cell = await getBottomDateCellAsync(table);
    await cell.dblclick();
    const popup = page.locator('.grid-date-time-picker-active .date-time-picker-popover');
    await expectWithinViewportAsync(popup);
    await expectFrontmostAsync(popup);
    const popupBounds = await popup.boundingBox();
    const cellBounds = await cell.boundingBox();
    if (popupBounds === null || cellBounds === null) throw new Error('カレンダーとセルの座標を取得できません');
    expect(cellBounds.x + popupBounds.width).toBeGreaterThan(960 - 8);
    expect(popupBounds.y + popupBounds.height).toBeLessThanOrEqual(cellBounds.y);
    await popup.locator('.date-time-picker-day[aria-label="2026-05-15"]').click();
    await expect(page.locator('.grid-textfield-active')).toHaveText('2026-05-15 12:30:45');
});

test('カレンダー表示中に画面を縮めても画面内に収まり時刻を確定できる', async ({page}) => {
    await page.setViewportSize({width: 1280, height: 720});
    const table = await openTableAsync(page, '2026-05-10 12:30:45');
    const cell = table.locator('.editor-table-row[data-row-index="0"] .editor-table-cell:not(.editor-table-row-header)').nth(2);
    await cell.dblclick();
    const popup = page.locator('.grid-date-time-picker-active .date-time-picker-popover');
    await expectWithinViewportAsync(popup);
    await page.setViewportSize({width: 760, height: 320});
    await expectWithinViewportAsync(popup);
    await expectFrontmostAsync(popup);
    // 全内容が縦に入らない画面でも、ポップアップ内をスクロールして操作できる。
    await popup.locator('.date-time-picker-second-input').fill('56');
    await expect(popup).toHaveCount(0);
    await expect(cell).toContainText('2026-05-10 12:30:56');
});

test('画面右下セルのバリデーションツールチップも画面内で表示され本文へ移動できる', async ({page}) => {
    await page.setViewportSize({width: 960, height: 540});
    const table = await openTableAsync(page, '2026-02-30 00:00:00');
    const cell = await getBottomDateCellAsync(table);
    await expect(cell).toHaveClass(/cell-error/);
    await page.locator('#explorer').hover({position: {x: 10, y: 10}});
    await cell.hover();
    const tooltip = page.locator('.error-tooltip');
    await expectWithinViewportAsync(tooltip);
    await expectFrontmostAsync(tooltip);
    await tooltip.hover();
    await expect(tooltip).toBeVisible();
    await expect(cell).toHaveAttribute('aria-describedby', await tooltip.getAttribute('id') as string);
});
