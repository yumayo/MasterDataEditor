import { test, expect } from './fixtures/test';
import type { Page } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

const SETTINGS_FILE = 'userdata/settings.json';
const TABLE_COUNT = 18;
const LONG_TABLE_NAME = `very_long_table_name_${'segment_'.repeat(40)}`;

function createManyTablesFileSystem(): MockFileSystem {
    const fs: MockFileSystem = {
        'userdata/bookmarks.json': '[]',
        'plugins/.gitkeep': '',
    };
    for (let i = 0; i < TABLE_COUNT; i++) {
        const name = `very_long_table_name_${String(i).padStart(2, '0')}`;
        fs[`schema/${name}.json`] = JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int' },
                { key: 1, name: 'name', type: 'string' },
            ],
            primary_key: ['id'],
        });
        fs[`data/${name}.csv`] = ['id,name', '1,row_a', '2,row_b'].join('\n');
    }
    return fs;
}

function createLongTabNameFileSystem(): MockFileSystem {
    const fs: MockFileSystem = {
        'userdata/bookmarks.json': '[]',
        'userdata/settings.json': JSON.stringify({ tabWrapEnabled: true }),
        'plugins/.gitkeep': '',
    };
    const names = [
        LONG_TABLE_NAME,
        ...Array.from({ length: 24 }, (_, i) => `short_table_${String(i).padStart(2, '0')}`),
    ];
    for (const name of names) {
        fs[`schema/${name}.json`] = JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int' },
                { key: 1, name: 'name', type: 'string' },
            ],
            primary_key: ['id'],
        });
        fs[`data/${name}.csv`] = ['id,name', '1,row_a'].join('\n');
    }
    return fs;
}

async function openSettingsTabAsync(page: Page): Promise<void> {
    await page.locator('.activity-bar-settings').click();
    await expect(page.locator('.settings-panel')).toBeVisible();
}

async function selectTabWrapEnabledAsync(page: Page, enabled: boolean): Promise<void> {
    const checkbox = page.locator('.settings-tab-wrap-checkbox');
    await expect(checkbox).toBeVisible();
    if (await checkbox.isChecked() !== enabled) {
        await checkbox.click();
    }
    await page.waitForFunction(
        ({ path, expected }) => {
            const raw = (window as unknown as { __mockFs: Record<string, string> }).__mockFs[path];
            if (typeof raw !== 'string') return false;
            try {
                const parsed = JSON.parse(raw) as { tabWrapEnabled?: boolean };
                return parsed.tabWrapEnabled === expected;
            } catch {
                return false;
            }
        },
        { path: SETTINGS_FILE, expected: enabled },
        { timeout: 5000 },
    );
}

async function openAllTablesAsync(page: Page): Promise<void> {
    const explorer = page.locator('#explorer');
    for (let i = 0; i < TABLE_COUNT; i++) {
        const name = `very_long_table_name_${String(i).padStart(2, '0')}`;
        await explorer.getByText(name, { exact: true }).click();
        await expect(page.locator(`.tab-wrapper[data-tab-name="${name}"] .editor-table`)).toBeVisible();
    }
}

async function openTablesByNameAsync(page: Page, tableNames: string[]): Promise<void> {
    const explorer = page.locator('#explorer');
    for (const name of tableNames) {
        await explorer.getByText(name, { exact: true }).click();
        await expect(page.locator(`.tab-wrapper[data-tab-name="${name}"] .editor-table`)).toBeVisible();
    }
}

async function getTabPageBoundaryMetricsAsync(page: Page): Promise<{
    hasHorizontalOverflow: boolean;
    scrollLeft: number;
    rightEdge: number;
    crossingNames: string[];
    firstVisibleLeft: number | null;
}> {
    return page.evaluate(() => {
        const scrollArea = document.querySelector('.tab-scroll-area') as HTMLElement;
        const viewportStart = scrollArea.scrollLeft;
        const viewportEnd = viewportStart + scrollArea.clientWidth;
        const buttons = Array.from(document.querySelectorAll('.tab-button')).map(button => {
            const element = button as HTMLElement;
            const left = element.offsetLeft;
            const width = element.getBoundingClientRect().width;
            return {
                name: element.querySelector('.tab-button-name')?.textContent ?? '',
                left,
                right: left + width,
            };
        });
        const visibleButtons = buttons.filter(button => button.right > viewportStart + 1 && button.left < viewportEnd - 1);
        const crossingNames = buttons
            .filter(button => button.left < viewportStart - 1 && button.right > viewportStart + 1)
            .map(button => button.name);
        return {
            hasHorizontalOverflow: scrollArea.scrollWidth > scrollArea.clientWidth + 1,
            scrollLeft: scrollArea.scrollLeft,
            rightEdge: Math.max(0, scrollArea.scrollWidth - scrollArea.clientWidth),
            crossingNames,
            firstVisibleLeft: visibleButtons.length === 0
                ? null
                : Math.min(...visibleButtons.map(button => button.left - viewportStart)),
        };
    });
}

async function getActiveTabMetricsAsync(page: Page): Promise<{
    name: string;
    left: number;
    right: number;
    scrollAreaWidth: number;
    hasHorizontalOverflow: boolean;
}> {
    return page.evaluate(() => {
        const scrollArea = document.querySelector('.tab-scroll-area') as HTMLElement;
        const activeTab = document.querySelector('.tab-button-active') as HTMLElement;
        const viewportStart = scrollArea.scrollLeft;
        const width = activeTab.getBoundingClientRect().width;
        return {
            name: activeTab.querySelector('.tab-button-name')?.textContent ?? '',
            left: activeTab.offsetLeft - viewportStart,
            right: activeTab.offsetLeft + width - viewportStart,
            scrollAreaWidth: scrollArea.clientWidth,
            hasHorizontalOverflow: scrollArea.scrollWidth > scrollArea.clientWidth + 1,
        };
    });
}

test.describe('ISSUE_0145: タブの複数段表示', () => {
    test('初期状態でタブバーの横スクロールバーを表示しない', async ({ page }) => {
        await installMockApiAsync(page, createManyTablesFileSystem());
        await page.goto('/');

        await expect(page.locator('.tab-button')).toHaveCount(0);
        const metrics = await page.evaluate(() => {
            const scrollArea = document.querySelector('.tab-scroll-area') as HTMLElement;
            return {
                overflowX: getComputedStyle(scrollArea).overflowX,
                hasHorizontalOverflow: scrollArea.scrollWidth > scrollArea.clientWidth + 1,
            };
        });

        expect(metrics.overflowX).toBe('hidden');
        expect(metrics.hasHorizontalOverflow).toBe(false);
    });

    test('単一タブでは右側ツールバー幅をスクロール幅に含めない', async ({ page }) => {
        await installMockApiAsync(page, createManyTablesFileSystem());
        await page.goto('/');

        const tableName = 'very_long_table_name_00';
        await page.locator('#explorer').getByText(tableName, { exact: true }).click();
        await expect(page.locator(`.tab-wrapper[data-tab-name="${tableName}"] .editor-table`)).toBeVisible();

        const metrics = await page.evaluate(() => {
            const tab = document.querySelector('.tab') as HTMLElement;
            const scrollArea = document.querySelector('.tab-scroll-area') as HTMLElement;
            const tabList = document.querySelector('.tab-list') as HTMLElement;
            const toolbar = document.querySelector('.toolbar') as HTMLElement;
            return {
                tabWidth: tab.getBoundingClientRect().width,
                toolbarWidth: toolbar.getBoundingClientRect().width,
                scrollAreaWidth: scrollArea.getBoundingClientRect().width,
                tabListWidth: tabList.getBoundingClientRect().width,
                hasHorizontalOverflow: scrollArea.scrollWidth > scrollArea.clientWidth + 1,
            };
        });

        expect(metrics.toolbarWidth).toBeGreaterThan(0);
        expect(metrics.scrollAreaWidth).toBeLessThanOrEqual(metrics.tabWidth - metrics.toolbarWidth + 1);
        expect(metrics.tabListWidth).toBeLessThanOrEqual(metrics.scrollAreaWidth + 1);
        expect(metrics.hasHorizontalOverflow).toBe(false);
    });

    test('折り返し設定を有効にするとタブバーが必要な段数まで広がる', async ({ page }) => {
        await installMockApiAsync(page, createManyTablesFileSystem());
        await page.goto('/');

        await openSettingsTabAsync(page);
        await selectTabWrapEnabledAsync(page, true);
        await openAllTablesAsync(page);

        const metrics = await page.evaluate(() => {
            const tab = document.querySelector('.tab') as HTMLElement;
            const editor = document.querySelector('.editor') as HTMLElement;
            const scrollArea = document.querySelector('.tab-scroll-area') as HTMLElement;
            const rowTops = new Set(
                Array.from(document.querySelectorAll('.tab-button'))
                    .map(button => Math.round(button.getBoundingClientRect().top)),
            );
            return {
                cssWrapEnabled: getComputedStyle(document.documentElement).getPropertyValue('--tab-wrap-enabled').trim(),
                visibleCssRowCount: getComputedStyle(document.documentElement).getPropertyValue('--tab-visible-row-count').trim(),
                tabHeight: tab.getBoundingClientRect().height,
                editorTop: editor.getBoundingClientRect().top,
                visibleRowCount: rowTops.size,
                hasHorizontalOverflow: scrollArea.scrollWidth > scrollArea.clientWidth + 1,
                hasVerticalOverflow: scrollArea.scrollHeight > scrollArea.clientHeight + 1,
            };
        });

        expect(metrics.cssWrapEnabled).toBe('1');
        expect(Number(metrics.visibleCssRowCount)).toBe(metrics.visibleRowCount);
        expect(metrics.visibleRowCount).toBeGreaterThan(2);
        expect(metrics.tabHeight).toBeGreaterThanOrEqual(metrics.visibleRowCount * 48 - 1);
        expect(metrics.tabHeight).toBeLessThanOrEqual(metrics.visibleRowCount * 48 + 1);
        expect(metrics.editorTop).toBeGreaterThanOrEqual(metrics.tabHeight - 1);
        expect(metrics.editorTop).toBeLessThanOrEqual(metrics.tabHeight + 1);
        expect(metrics.hasHorizontalOverflow).toBe(false);
        expect(metrics.hasVerticalOverflow).toBe(false);
    });

    test('保存済みのタブ折り返し設定を復元する', async ({ page }) => {
        const fs = createManyTablesFileSystem();
        fs[SETTINGS_FILE] = JSON.stringify({ tabWrapEnabled: true });
        await installMockApiAsync(page, fs);
        await page.goto('/');

        await openAllTablesAsync(page);

        const metrics = await page.evaluate(() => {
            const scrollArea = document.querySelector('.tab-scroll-area') as HTMLElement;
            const rowTops = new Set(
                Array.from(document.querySelectorAll('.tab-button'))
                    .map(button => Math.round(button.getBoundingClientRect().top)),
            );
            return {
                cssWrapEnabled: getComputedStyle(document.documentElement).getPropertyValue('--tab-wrap-enabled').trim(),
                visibleRowCount: rowTops.size,
                hasHorizontalOverflow: scrollArea.scrollWidth > scrollArea.clientWidth + 1,
            };
        });

        expect(metrics.cssWrapEnabled).toBe('1');
        expect(metrics.visibleRowCount).toBeGreaterThan(1);
        expect(metrics.hasHorizontalOverflow).toBe(false);
    });

    test('1段表示の横スクロール境界でタブ間に空白を挟まない', async ({ page }) => {
        await installMockApiAsync(page, createManyTablesFileSystem());
        await page.goto('/');

        await openAllTablesAsync(page);

        const metrics = await page.evaluate(() => {
            const scrollArea = document.querySelector('.tab-scroll-area') as HTMLElement;
            const buttons = Array.from(document.querySelectorAll('.tab-button'))
                .map(button => {
                    const element = button as HTMLElement;
                    return {
                        left: element.offsetLeft,
                        width: element.getBoundingClientRect().width,
                    };
                })
                .sort((a, b) => a.left - b.left);
            const gaps = buttons.slice(1).map((button, index) => button.left - (buttons[index].left + buttons[index].width));
            return {
                hasHorizontalOverflow: scrollArea.scrollWidth > scrollArea.clientWidth + 1,
                maxGap: Math.max(...gaps),
            };
        });

        expect(metrics.hasHorizontalOverflow).toBe(true);
        expect(metrics.maxGap).toBeLessThanOrEqual(1);
    });

    test('ウィンドウリサイズでタブバーのスクロール位置を動かさない', async ({ page }) => {
        await installMockApiAsync(page, createManyTablesFileSystem());
        await page.goto('/');

        await openAllTablesAsync(page);
        await page.locator('.tab-scroll-area').evaluate((element) => {
            return new Promise<void>((resolve) => {
                element.scrollLeft = 0;
                requestAnimationFrame(() => requestAnimationFrame(() => { resolve(); }));
            });
        });

        for (const width of [1000, 920, 1080, 960]) {
            await page.setViewportSize({ width, height: 720 });
            await page.waitForFunction(() => {
                const scrollArea = document.querySelector('.tab-scroll-area') as HTMLElement | null;
                return scrollArea !== null && scrollArea.scrollLeft === 0;
            });
        }

        const scrollLeft = await page.locator('.tab-scroll-area').evaluate((element) => element.scrollLeft);
        expect(scrollLeft).toBe(0);
    });

    test('ウィンドウリサイズでタブバー右端スクロールを維持する', async ({ page }) => {
        await installMockApiAsync(page, createManyTablesFileSystem());
        await page.goto('/');

        await openAllTablesAsync(page);
        await page.locator('.tab-scroll-area').evaluate((element) => { element.scrollLeft = element.scrollWidth; });

        const distanceFromRight = async (): Promise<number> => {
            return page.locator('.tab-scroll-area').evaluate((element) => {
                const scrollArea = element as HTMLElement;
                const rightEdge = Math.max(0, scrollArea.scrollWidth - scrollArea.clientWidth);
                return Math.abs(rightEdge - scrollArea.scrollLeft);
            });
        };
        await expect.poll(distanceFromRight).toBeLessThanOrEqual(1);

        for (const width of [1000, 920, 1080, 960]) {
            await page.setViewportSize({ width, height: 720 });
            await expect.poll(distanceFromRight).toBeLessThanOrEqual(1);
        }
    });

    test('折り返し表示では横スクロールせずページ境界のタブ混在が起きない', async ({ page }) => {
        await page.setViewportSize({ width: 520, height: 1400 });
        await installMockApiAsync(page, createManyTablesFileSystem());
        await page.goto('/');

        await openSettingsTabAsync(page);
        await selectTabWrapEnabledAsync(page, true);
        await openAllTablesAsync(page);
        await page.locator('.tab-scroll-area').evaluate((element) => { element.scrollLeft = element.scrollWidth; });

        await expect.poll(async () => {
            const metrics = await getTabPageBoundaryMetricsAsync(page);
            return !metrics.hasHorizontalOverflow
                && metrics.scrollLeft === 0
                && metrics.rightEdge === 0
                && metrics.crossingNames.length === 0
                && metrics.firstVisibleLeft !== null
                && Math.abs(metrics.firstVisibleLeft) <= 1;
        }).toBe(true);
    });

    test('折り返し表示で最後に開いた設定タブも横方向の可視範囲に収まる', async ({ page }) => {
        await page.setViewportSize({ width: 520, height: 1400 });
        const fs = createManyTablesFileSystem();
        fs[SETTINGS_FILE] = JSON.stringify({ tabWrapEnabled: true });
        await installMockApiAsync(page, fs);
        await page.goto('/');

        await openAllTablesAsync(page);
        await openSettingsTabAsync(page);

        await expect.poll(async () => {
            const metrics = await getActiveTabMetricsAsync(page);
            return metrics.name === '設定'
                && !metrics.hasHorizontalOverflow
                && metrics.left >= -1
                && metrics.right <= metrics.scrollAreaWidth + 1;
        }).toBe(true);
    });

    test('スクロールバーが一度消えてもタブバー右端寄せを記憶する', async ({ page }) => {
        await page.setViewportSize({ width: 900, height: 720 });
        await installMockApiAsync(page, createManyTablesFileSystem());
        await page.goto('/');

        await openAllTablesAsync(page);
        await page.locator('.tab-scroll-area').evaluate((element) => { element.scrollLeft = element.scrollWidth; });

        const getMetrics = async (): Promise<{ hasOverflow: boolean; distanceFromRight: number }> => {
            return page.locator('.tab-scroll-area').evaluate((element) => {
                const scrollArea = element as HTMLElement;
                const rightEdge = Math.max(0, scrollArea.scrollWidth - scrollArea.clientWidth);
                return {
                    hasOverflow: rightEdge > 1,
                    distanceFromRight: Math.abs(rightEdge - scrollArea.scrollLeft),
                };
            });
        };

        await expect.poll(async () => (await getMetrics()).distanceFromRight).toBeLessThanOrEqual(1);

        await page.setViewportSize({ width: 5000, height: 720 });
        await expect.poll(async () => (await getMetrics()).hasOverflow).toBe(false);

        await page.setViewportSize({ width: 900, height: 720 });
        await expect.poll(async () => {
            const metrics = await getMetrics();
            return metrics.hasOverflow && metrics.distanceFromRight <= 1;
        }).toBe(true);
    });

    test('中途半端なタブバー横スクロール位置では端に寄せない', async ({ page }) => {
        await page.setViewportSize({ width: 900, height: 720 });
        await installMockApiAsync(page, createManyTablesFileSystem());
        await page.goto('/');

        await openAllTablesAsync(page);
        await page.locator('.tab-scroll-area').evaluate((element) => {
            const scrollArea = element as HTMLElement;
            const rightEdge = Math.max(0, scrollArea.scrollWidth - scrollArea.clientWidth);
            scrollArea.scrollLeft = rightEdge;
        });
        await page.locator('.tab-scroll-area').evaluate((element) => {
            const scrollArea = element as HTMLElement;
            const rightEdge = Math.max(0, scrollArea.scrollWidth - scrollArea.clientWidth);
            scrollArea.scrollLeft = Math.round(rightEdge * 0.45);
        });

        const isMiddle = async (): Promise<boolean> => {
            return page.locator('.tab-scroll-area').evaluate((element) => {
                const scrollArea = element as HTMLElement;
                const rightEdge = Math.max(0, scrollArea.scrollWidth - scrollArea.clientWidth);
                return rightEdge > 40
                    && scrollArea.scrollLeft > 20
                    && scrollArea.scrollLeft < rightEdge - 20;
            });
        };
        await expect.poll(isMiddle).toBe(true);

        await page.setViewportSize({ width: 5000, height: 720 });
        await page.setViewportSize({ width: 900, height: 720 });
        await expect.poll(isMiddle).toBe(true);
    });

    test('表示領域より長いタブ名でも描画幅がレイアウト計算幅を超えない', async ({ page }) => {
        await installMockApiAsync(page, createLongTabNameFileSystem());
        await page.goto('/');

        await openTablesByNameAsync(page, [
            LONG_TABLE_NAME,
            ...Array.from({ length: 24 }, (_, i) => `short_table_${String(i).padStart(2, '0')}`),
        ]);

        const metrics = await page.evaluate(() => {
            const scrollArea = document.querySelector('.tab-scroll-area') as HTMLElement;
            const tabList = document.querySelector('.tab-list') as HTMLElement;
            const tabListLeft = tabList.getBoundingClientRect().left;
            const buttonRects = Array.from(document.querySelectorAll('.tab-button'))
                .map(button => {
                    const rect = button.getBoundingClientRect();
                    return {
                        width: rect.width,
                        right: rect.right - tabListLeft,
                    };
                });
            return {
                clientWidth: scrollArea.clientWidth,
                tabListWidth: tabList.getBoundingClientRect().width,
                maxButtonWidth: Math.max(...buttonRects.map(rect => rect.width)),
                maxButtonRight: Math.max(...buttonRects.map(rect => rect.right)),
                hasHorizontalOverflow: scrollArea.scrollWidth > scrollArea.clientWidth + 1,
            };
        });

        expect(metrics.hasHorizontalOverflow).toBe(false);
        expect(metrics.maxButtonWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
        expect(metrics.maxButtonRight).toBeLessThanOrEqual(metrics.tabListWidth + 1);
    });
});
