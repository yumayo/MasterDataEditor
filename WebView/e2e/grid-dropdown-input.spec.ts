import { test, expect } from './fixtures/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';
import { expectTableDataAsync, getDataCell } from './fixtures/test-utils';

const fileSystem: MockFileSystem = {
    'schema/reward_group.json': JSON.stringify({
        header: [
            { key: 0, name: 'id', type: 'int' },
            { key: 1, name: 'ja', type: 'string' },
        ],
        primary_key: ['id'],
    }),
    'data/reward_group.csv': 'id,ja\n1,daily_reward\n2,event_reward\n3,login_bonus',
    'schema/quest.json': JSON.stringify({
        header: [
            { key: 0, name: 'id', type: 'int' },
            { key: 1, name: 'reward_group_id', type: 'int', reference: 'reward_group.id' },
        ],
        primary_key: ['id'],
    }),
    'data/quest.csv': 'id,reward_group_id\n1,1',
};

test.describe('参照列のドロップダウン', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, fileSystem);
        await page.goto('/');
        await page.locator('#explorer').getByText('quest', { exact: true }).click();
        const table = page.locator('.editor-left-pane .editor-table');
        await expect(table).toBeVisible();
        await getDataCell(table, 0, 1).dblclick();
        await expect(page.locator('.editor-left-pane .grid-dropdown-item')).toHaveCount(3);
    });

    test('候補にホバーしてもクイックビューを表示せず、クリックで値を確定できる', async ({ page }) => {
        const dropdown = page.locator('.editor-left-pane .grid-dropdown-list');
        const item = dropdown.locator('.grid-dropdown-item', { hasText: 'event_reward' });
        await item.hover();
        await expect(page.locator('.dropdown-quick-view')).toHaveCount(0);
        await item.click();
        await expect(dropdown).not.toBeVisible();
        await expectTableDataAsync(page.locator('.editor-left-pane .editor-table'), '1,2');

        // 選択による変更も通常のセル編集と同じ履歴に記録される。
        await page.keyboard.press('Control+z');
        await expectTableDataAsync(page.locator('.editor-left-pane .editor-table'), '1,1');
        await page.keyboard.press('Control+y');
        await expectTableDataAsync(page.locator('.editor-left-pane .editor-table'), '1,2');
    });

    test('矢印キーで候補を移動してもクイックビューを表示せず、Enterで値を確定できる', async ({ page }) => {
        const dropdown = page.locator('.editor-left-pane .grid-dropdown-list');
        await page.keyboard.press('ArrowDown');
        await expect(dropdown.locator('.selected')).toContainText('event_reward');
        await expect(page.locator('.dropdown-quick-view')).toHaveCount(0);
        await page.keyboard.press('ArrowUp');
        await expect(dropdown.locator('.selected')).toContainText('daily_reward');
        await page.keyboard.press('ArrowUp');
        await expect(dropdown.locator('.selected')).toContainText('login_bonus');
        await page.keyboard.press('Enter');
        await expect(dropdown).not.toBeVisible();
        await expectTableDataAsync(page.locator('.editor-left-pane .editor-table'), '1,3');
    });

    test('入力で候補を絞り込み、Escapeで元の値を維持して閉じられる', async ({ page }) => {
        const dropdown = page.locator('.editor-left-pane .grid-dropdown-list');
        await page.keyboard.press('Control+a');
        await page.keyboard.type('event');
        await expect(dropdown.locator('.grid-dropdown-item')).toHaveCount(1);
        await expect(dropdown.locator('.selected')).toContainText('event_reward');
        await expect(page.locator('.dropdown-quick-view')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(dropdown).not.toBeVisible();
        await expectTableDataAsync(page.locator('.editor-left-pane .editor-table'), '1,1');
    });
});

test.describe('参照列のドロップダウンのホイール操作', () => {
    for (const { tableName, column, label } of [
        { tableName: 'quest', column: 1, label: 'FK' },
        { tableName: 'reward_group', column: 0, label: 'PK' },
    ]) {
        test(`${label}列の候補リストだけがスクロールし、端でも表へ伝播しない`, async ({ page }) => {
            await installMockApiAsync(page, {
                ...fileSystem,
                'data/reward_group.csv': 'id,ja\n' + Array.from({ length: 200 }, (_, i) => `${i + 1},reward_${i + 1}`).join('\n'),
                'data/quest.csv': 'id,reward_group_id\n' + Array.from({ length: 200 }, (_, i) => `${i + 1},1`).join('\n'),
            });
            await page.goto('/');
            await page.locator('#explorer').getByText(tableName, { exact: true }).click();
            const table = page.locator('.editor-left-pane .editor-table');
            const viewport = table.locator('.editor-table-main-viewport');
            await expect(table).toBeVisible();
            expect(await viewport.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
            await getDataCell(table, 0, column).dblclick();

            const dropdown = page.locator('.editor-left-pane .grid-dropdown-list');
            await expect(dropdown.locator('.grid-dropdown-item')).toHaveCount(200);
            const tableScrollTop = await viewport.evaluate(el => el.scrollTop);
            const maxScrollTop = await dropdown.evaluate(el => el.scrollHeight - el.clientHeight);
            expect(maxScrollTop).toBeGreaterThan(0);
            await dropdown.hover();

            // 実際のホイール入力で、リスト内のスクロールと上下端での連鎖を確認する。
            let expectedScrollTop = 0;
            for (const deltaY of [120, 100000, 120, -120, -100000, -120]) {
                expectedScrollTop = Math.max(0, Math.min(maxScrollTop, expectedScrollTop + deltaY));
                await page.mouse.wheel(0, deltaY);
                // 端ではscrollイベントが発火しないため、ブラウザのホイール処理を待つ。
                await page.waitForTimeout(100);
                await expect.poll(() => dropdown.evaluate(el => el.scrollTop)).toBe(expectedScrollTop);
                expect(await viewport.evaluate(el => el.scrollTop)).toBe(tableScrollTop);
            }

            await page.keyboard.press('Escape');
            await expect(dropdown).not.toBeVisible();
            await viewport.hover();
            await page.mouse.wheel(0, 120);
            await expect.poll(() => viewport.evaluate(el => el.scrollTop)).toBeGreaterThan(tableScrollTop);
        });
    }
});
