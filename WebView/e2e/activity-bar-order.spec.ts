import {test, expect} from './fixtures/test';
import type {Page} from '@playwright/test';
import {createDefaultFileSystem, installMockApiAsync, readMockFileAsync} from './fixtures/mock-api';

const UI_STATE_FILE = 'user:ui-state.json';
const DEFAULT_ORDER = ['files', 'references', 'search', 'bookmarks', 'views', 'erDiagram', 'sourceControl', 'history'];

async function getActivityBarOrderAsync(page: Page): Promise<string[]> {
    return page.locator('.activity-bar .activity-bar-item:not(.activity-bar-settings)').evaluateAll((nodes) => {
        return nodes.map(node => (node as HTMLElement).dataset.panel ?? '');
    });
}

async function waitForActivityBarOrderAsync(page: Page, expected: string[]): Promise<void> {
    await page.waitForFunction((order) => {
        const actual = Array.from(document.querySelectorAll('.activity-bar .activity-bar-item:not(.activity-bar-settings)'))
            .map(node => (node as HTMLElement).dataset.panel ?? '');
        return actual.join('\n') === order.join('\n');
    }, expected, {timeout: 5000});
}

async function waitForActivityBarOrderSavedAsync(page: Page, expected: string[]): Promise<void> {
    await page.waitForFunction(
        ({path, order}: {path: string; order: string[]}) => {
            const raw = (window as unknown as {__mockFs: Record<string, string>}).__mockFs[path];
            if (typeof raw !== 'string') return false;
            try {
                const parsed = JSON.parse(raw) as {activityBar?: {order?: string[]}};
                return Array.isArray(parsed.activityBar?.order) && parsed.activityBar.order.join('\n') === order.join('\n');
            } catch {
                return false;
            }
        },
        {path: UI_STATE_FILE, order: expected},
        {timeout: 5000},
    );
}

async function dragActivityBarItemBeforeAsync(page: Page, sourcePanel: string, targetPanel: string): Promise<void> {
    const source = page.locator(`.activity-bar-item[data-panel="${sourcePanel}"]`);
    const target = page.locator(`.activity-bar-item[data-panel="${targetPanel}"]`);
    await expect(source).toBeVisible();
    await expect(target).toBeVisible();
    await source.dragTo(target, {
        targetPosition: {x: 24, y: 4},
    });
}

test.describe('アクティビティバー並び替え', () => {
    test('アイコンをドラッグして並び替えるとui-stateへ保存される', async ({page}) => {
        await installMockApiAsync(page, createDefaultFileSystem());
        await page.goto('/');

        expect(await getActivityBarOrderAsync(page)).toEqual(DEFAULT_ORDER);

        const expected = ['search', 'files', 'references', 'bookmarks', 'views', 'erDiagram', 'sourceControl', 'history'];
        await dragActivityBarItemBeforeAsync(page, 'search', 'files');
        await waitForActivityBarOrderAsync(page, expected);
        await waitForActivityBarOrderSavedAsync(page, expected);

        const raw = await readMockFileAsync(page, UI_STATE_FILE);
        expect(raw).not.toContain('\r');
        expect(raw.endsWith('\n')).toBe(true);
        expect(raw).toContain('\n    "activityBar": {');
        expect((JSON.parse(raw) as {activityBar: {order: string[]}}).activityBar.order).toEqual(expected);
    });

    test('ui-stateに保存された順序で起動時に復元される', async ({page}) => {
        const fs = createDefaultFileSystem();
        const savedOrder = ['history', 'sourceControl', 'erDiagram', 'views', 'bookmarks', 'search', 'references', 'files'];
        fs[UI_STATE_FILE] = JSON.stringify({activityBar: {order: savedOrder}});
        await installMockApiAsync(page, fs);
        await page.goto('/');

        await waitForActivityBarOrderAsync(page, savedOrder);
    });
});
