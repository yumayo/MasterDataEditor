import { test, expect } from './fixtures/test';

test.describe('BottomPanel tabs', () => {
    test('clicking the active panel tab keeps the bottom panel open', async ({ page, mockFileSystem }) => {
        const bottomPanel = page.locator('.bottom-panel');
        const problemsTab = page.locator('.bottom-panel-tab', { hasText: 'PROBLEMS' });
        const debugTab = page.locator('.bottom-panel-tab', { hasText: 'DEBUG CONSOLE' });

        await page.locator('.status-bar-badge').click();
        await expect(bottomPanel).toBeVisible();
        await expect(problemsTab).toHaveClass(/bottom-panel-tab-active/);
        await expect(page.locator('.validation-panel')).toBeVisible();

        await problemsTab.click();
        await expect(bottomPanel).toBeVisible();
        await expect(problemsTab).toHaveClass(/bottom-panel-tab-active/);
        await expect(page.locator('.validation-panel')).toBeVisible();

        await debugTab.click();
        await expect(bottomPanel).toBeVisible();
        await expect(debugTab).toHaveClass(/bottom-panel-tab-active/);
        await expect(page.locator('.debug-console')).toBeVisible();

        await debugTab.click();
        await expect(bottomPanel).toBeVisible();
        await expect(debugTab).toHaveClass(/bottom-panel-tab-active/);
        await expect(page.locator('.debug-console')).toBeVisible();
    });
});
