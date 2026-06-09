import {test, expect} from './fixtures/test';
import type {Locator, Page} from '@playwright/test';
import {installMockApiAsync, readMockFileAsync, type MockFileSystem} from './fixtures/mock-api';

const UI_STATE_FILE = 'user:ui-state.json';

function createScheduleTimelineFileSystem(): MockFileSystem {
    return {
        "schema/event.json": JSON.stringify({
            header: [
                {key: 0, name: "id", type: "int"},
                {key: 1, name: "name", type: "string"},
                {key: 2, name: "export_begin_date", type: "datetime", comment: "出力予定日"},
                {key: 3, name: "export_end_date", type: "datetime", comment: "削除予定日"},
            ],
            primary_key: ["id"],
        }),
        "data/event.csv": [
            "id,name,export_begin_date,export_end_date",
            "1,start_a,2026-01-05 09:00:00,",
            "2,end_a,,2026-01-05 18:00:00",
            "3,next,2026-02-01 00:00:00,",
        ].join("\n"),
        "schema/campaign.json": JSON.stringify({
            header: [
                {key: 0, name: "id", type: "int"},
                {key: 1, name: "name", type: "string"},
                {key: 2, name: "export_begin_date", type: "datetime", comment: "出力予定日"},
                {key: 3, name: "export_end_date", type: "datetime", comment: "削除予定日"},
            ],
            primary_key: ["id"],
        }),
        "data/campaign.csv": [
            "id,name,export_begin_date,export_end_date",
            "10,campaign_a,2026-01-03 00:00:00,",
            "20,campaign_b,2026-01-05 00:00:00,2026-01-20 00:00:00",
        ].join("\n"),
        ".masterdataeditor/settings.json": JSON.stringify({
            referenceJumpTemporaryFilterEnabled: false,
        }),
        "user:bookmarks.json": "[]",
        "plugins/.gitkeep": "",
    };
}

function createScrollableScheduleTimelineFileSystem(): MockFileSystem {
    const rows = ["id,name,export_begin_date,export_end_date"];
    for (let i = 1; i <= 80; i++) {
        const date = formatFixtureDate(i);
        rows.push(`${i},event_${i},${date} 00:00:00,`);
    }
    return {
        "schema/event.json": JSON.stringify({
            header: [
                {key: 0, name: "id", type: "int"},
                {key: 1, name: "name", type: "string"},
                {key: 2, name: "export_begin_date", type: "datetime", comment: "出力予定日"},
                {key: 3, name: "export_end_date", type: "datetime", comment: "削除予定日"},
            ],
            primary_key: ["id"],
        }),
        "data/event.csv": rows.join("\n"),
        ".masterdataeditor/settings.json": JSON.stringify({
            referenceJumpTemporaryFilterEnabled: false,
        }),
        "user:bookmarks.json": "[]",
        "plugins/.gitkeep": "",
    };
}

function createScheduleTimelineValidationFileSystem(): MockFileSystem {
    return {
        "schema/event.json": JSON.stringify({
            header: [
                {key: 0, name: "id", type: "int"},
                {key: 1, name: "name", type: "string"},
                {key: 2, name: "export_begin_date", type: "datetime", comment: "出力予定日"},
                {key: 3, name: "export_end_date", type: "datetime", comment: "削除予定日"},
            ],
            primary_key: ["id"],
        }),
        "data/event.csv": [
            "id,name,export_begin_date,export_end_date",
            "1,start_a,2026-01-05 09:00:00,",
            "1,start_b,2026-01-05 10:00:00,",
        ].join("\n"),
        ".masterdataeditor/settings.json": JSON.stringify({
            largeFileEagerDataPreloadBytes: 0,
            referenceJumpTemporaryFilterEnabled: false,
        }),
        "user:bookmarks.json": "[]",
        "plugins/.gitkeep": "",
    };
}

async function installScheduleTimelineFixtureAsync(page: Page): Promise<void> {
    await installMockApiAsync(page, createScheduleTimelineFileSystem());
    await page.goto('/');
}

async function installScrollableScheduleTimelineFixtureAsync(page: Page, fileSystem: MockFileSystem = createScrollableScheduleTimelineFileSystem()): Promise<void> {
    await installMockApiAsync(page, fileSystem);
    await page.goto('/');
}

function formatFixtureDate(day: number): string {
    const date = new Date(Date.UTC(2026, 0, day));
    const year = String(date.getUTCFullYear()).padStart(4, '0');
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dateOfMonth = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${dateOfMonth}`;
}

function activeTable(page: Page): Locator {
    return page.locator('.editor-left-pane .tab-wrapper:not([style*="display: none"]) .editor-table');
}

function dataCell(table: Locator, rowIndex: number, colIndex: number): Locator {
    const row = table.locator('.editor-table-row:not(.editor-table-empty-row)').nth(rowIndex);
    return row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
}

async function visibleColumnValuesAsync(table: Locator, colIndex: number): Promise<string[]> {
    const rows = table.locator('.editor-table-row:not(.editor-table-empty-row)');
    const count = await rows.count();
    const values: string[] = [];
    for (let i = 0; i < count; i++) {
        const row = rows.nth(i);
        if (!await row.isVisible()) continue;
        values.push(await row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex).innerText());
    }
    return values;
}

async function waitForSavedScheduleTimelineStateAsync(page: Page, date: string, minScrollTop: number): Promise<void> {
    await page.waitForFunction(
        ({path, collapsedDate, scrollTop}: {path: string; collapsedDate: string; scrollTop: number}) => {
            const raw = (window as unknown as {__mockFs: Record<string, string>}).__mockFs[path];
            if (typeof raw !== 'string') return false;
            try {
                const parsed = JSON.parse(raw) as {
                    sidebar?: {
                        scheduleTimeline?: {
                            collapsedDates?: string[];
                            scroll?: {scrollTop?: number};
                        };
                    };
                };
                const state = parsed.sidebar?.scheduleTimeline;
                return Array.isArray(state?.collapsedDates)
                    && state.collapsedDates.includes(collapsedDate)
                    && typeof state.scroll?.scrollTop === 'number'
                    && state.scroll.scrollTop >= scrollTop;
            } catch {
                return false;
            }
        },
        {path: UI_STATE_FILE, collapsedDate: date, scrollTop: minScrollTop},
        {timeout: 5000},
    );
}

test.describe('予定日タイムラインパネル', () => {
    test('カレンダーアイコンから全テーブルの予定日を日付別に表示する', async ({page}) => {
        await installScheduleTimelineFixtureAsync(page);

        const calendarButton = page.locator('.activity-bar-item[data-panel="calendar"]');
        await expect(calendarButton).toBeVisible();
        await expect(calendarButton.locator('svg')).toBeAttached();
        await calendarButton.click();

        const panel = page.locator('.schedule-timeline-panel');
        await expect(panel).toBeVisible();
        const dates = panel.locator('.schedule-timeline-group-date');
        await expect(dates).toHaveText(['2026-01-03', '2026-01-05', '2026-01-20', '2026-02-01']);

        const jan5Group = panel.locator('.schedule-timeline-group[data-date="2026-01-05"]');
        await expect(jan5Group.locator('.schedule-timeline-group-count')).toHaveText('3 件');
        await expect(jan5Group.locator('.schedule-timeline-table-name')).toHaveText(['campaign', 'event']);
    });

    test('テーブルクリック時は設定OFFでも予定日で一時フィルターする', async ({page}) => {
        await installScheduleTimelineFixtureAsync(page);
        await page.locator('.activity-bar-item[data-panel="calendar"]').click();

        const jan5Group = page.locator('.schedule-timeline-group[data-date="2026-01-05"]');
        await jan5Group.locator('.schedule-timeline-table[data-table-name="event"]').click();

        await expect(page.locator('.tab-button-active')).toContainText('event');
        const table = activeTable(page);
        await expect(page.locator('.editor-left-slot .filter-row-count:visible')).toHaveText('2 / 3 行');
        await expect.poll(() => visibleColumnValuesAsync(table, 0)).toEqual(['1', '2']);
    });

    test('スケジュールパネルから未オープン表を開いてもバリデーション件数は増えない', async ({page}) => {
        await installMockApiAsync(page, createScheduleTimelineValidationFileSystem());
        await page.goto('/');

        const badgeCount = page.locator('.status-bar-badge-count');
        await expect(badgeCount).toHaveText('2', {timeout: 10000});

        await page.locator('.activity-bar-item[data-panel="calendar"]').click();
        const scheduleTable = page.locator('.schedule-timeline-table[data-table-name="event"]');
        await expect(scheduleTable).toBeVisible();
        await expect(badgeCount).toHaveText('2');

        await scheduleTable.click();
        await expect(page.locator('.tab-button-active')).toContainText('event');
        await expect(badgeCount).toHaveText('2');
    });

    test('表示中に予定日列を編集すると日付別リストが更新される', async ({page}) => {
        await installScheduleTimelineFixtureAsync(page);

        await page.locator('#explorer').getByText('event', {exact: true}).click();
        const table = activeTable(page);
        await expect(table).toBeVisible();

        await page.locator('.activity-bar-item[data-panel="calendar"]').click();
        const panel = page.locator('.schedule-timeline-panel');
        await expect(panel.locator('.schedule-timeline-group[data-date="2026-02-01"]')).toBeVisible();

        const beginDateCell = dataCell(table, 2, 2);
        await beginDateCell.dblclick();
        const input = page.locator('.grid-textfield-active');
        await expect(input).toBeVisible();
        await page.keyboard.press('Control+a');
        await page.keyboard.insertText('2026-01-10 00:00:00');
        await page.keyboard.press('Enter');

        await expect(panel.locator('.schedule-timeline-group[data-date="2026-01-10"]')).toBeVisible();
        await expect(panel.locator('.schedule-timeline-group[data-date="2026-02-01"]')).toHaveCount(0);
    });

    test('日付グループの開閉状態とスクロール位置がui-stateへ保存される', async ({page}) => {
        await installScrollableScheduleTimelineFixtureAsync(page);
        await page.locator('.activity-bar-item[data-panel="calendar"]').click();

        const panel = page.locator('.schedule-timeline-panel');
        await expect(panel.locator('.schedule-timeline-group[data-date="2026-01-10"]')).toBeVisible();

        const jan10Group = panel.locator('.schedule-timeline-group[data-date="2026-01-10"]');
        await jan10Group.locator('.schedule-timeline-group-header').click();
        await expect(jan10Group.locator('.schedule-timeline-group-header')).toHaveAttribute('aria-expanded', 'false');

        await panel.evaluate((element) => {
            element.scrollTop = 420;
            element.dispatchEvent(new Event('scroll'));
        });
        await expect.poll(() => panel.evaluate(element => element.scrollTop)).toBeGreaterThan(0);

        await waitForSavedScheduleTimelineStateAsync(page, '2026-01-10', 100);
        const raw = await readMockFileAsync(page, UI_STATE_FILE);
        const state = JSON.parse(raw) as {
            sidebar: {
                scheduleTimeline: {
                    collapsedDates: string[];
                    scroll: {scrollLeft: number; scrollTop: number};
                };
            };
        };
        expect(state.sidebar.scheduleTimeline.collapsedDates).toContain('2026-01-10');
        expect(state.sidebar.scheduleTimeline.scroll.scrollTop).toBeGreaterThanOrEqual(100);
    });

    test('ui-stateから日付グループの開閉状態とスクロール位置が起動時に復元される', async ({page}) => {
        const fs = createScrollableScheduleTimelineFileSystem();
        fs[UI_STATE_FILE] = JSON.stringify({
            sidebar: {
                activePanel: 'calendar',
                scheduleTimeline: {
                    collapsedDates: ['2026-01-10'],
                    scroll: {scrollLeft: 0, scrollTop: 420},
                },
            },
        });
        await installScrollableScheduleTimelineFixtureAsync(page, fs);

        const panel = page.locator('.schedule-timeline-panel');
        await expect(page.locator('.activity-bar-item[data-panel="calendar"]')).toHaveClass(/activity-bar-item-active/);
        await expect(panel.locator('.schedule-timeline-group[data-date="2026-01-10"]')).toBeVisible();

        const jan10Group = panel.locator('.schedule-timeline-group[data-date="2026-01-10"]');
        await expect(jan10Group.locator('.schedule-timeline-group-header')).toHaveAttribute('aria-expanded', 'false');
        await expect(jan10Group.locator('.schedule-timeline-items')).toHaveAttribute('aria-hidden', 'true');
        await expect.poll(() => panel.evaluate(element => element.scrollTop)).toBeGreaterThan(100);
    });
});
