import {test, expect} from './fixtures/test';
import type {Page} from '@playwright/test';
import {createDefaultFileSystem, installMockApiAsync} from './fixtures/mock-api';

type Theme = 'dark' | 'light';
type Rgba = [number, number, number, number];
interface NativePalette {
    background: Rgba;
    surface: Rgba;
    foreground: Rgba;
    secondaryForeground: Rgba;
    border: Rgba;
    hover: Rgba;
    pressed: Rgba;
    focus: Rgba;
}

// CSSの既存テーマをネイティブへ渡す契約。半透明色も合成せずRGBAのbyte値を保持する。
const PALETTES: Record<Theme, NativePalette> = {
    light: {
        background: [255, 255, 255, 255], surface: [243, 243, 243, 255], foreground: [33, 37, 43, 255],
        secondaryForeground: [0, 0, 0, 115], border: [0, 0, 0, 38], hover: [0, 0, 0, 13],
        pressed: [0, 0, 0, 26], focus: [0, 122, 204, 255],
    },
    dark: {
        background: [33, 37, 43, 255], surface: [40, 44, 52, 255], foreground: [171, 178, 191, 255],
        secondaryForeground: [255, 255, 255, 115], border: [128, 128, 128, 89], hover: [255, 255, 255, 18],
        pressed: [255, 255, 255, 38], focus: [0, 122, 204, 255],
    },
};

async function expectNativePaletteAsync(page: Page, palette: NativePalette): Promise<void> {
    await expect.poll(() => page.evaluate(() => {
        const messages = (window as unknown as {__mockNativeThemes: unknown[]}).__mockNativeThemes;
        return messages.length === 0 ? null : messages[messages.length - 1];
    })).toEqual({type: 'native_theme_changed', palette});
}

async function selectThemeAsync(page: Page, theme: Theme): Promise<void> {
    await page.locator('.settings-panel .settings-dropdown-trigger').click();
    await page.locator(`.settings-dropdown-item[data-value="${theme}"]`).click();
    await expect(page.locator('body')).toHaveAttribute('data-theme', theme);
}

for (const theme of ['dark', 'light'] as const) {
    test(`制限モードの起動時に保存済みの実効${theme}テーマをネイティブへ通知する`, async ({page}) => {
        const fs = createDefaultFileSystem();
        // 既定値darkは既存の正規化で未指定に戻るため、Workspace側にもdarkを置く。
        fs['.masterdataeditor/settings.json'] = JSON.stringify({theme: 'dark'});
        fs['user:settings.json'] = JSON.stringify({theme});
        await installMockApiAsync(page, fs, false);
        await page.goto('/');
        await expect(page.locator('body')).toHaveAttribute('data-theme', theme);
        await expectNativePaletteAsync(page, PALETTES[theme]);
    });
}

test('テーマの変更とUndo・Redo・再読み込みでネイティブの色も追従する', async ({page}) => {
    await installMockApiAsync(page, createDefaultFileSystem());
    await page.goto('/');
    await page.locator('.activity-bar-settings').click();
    await expect(page.locator('.settings-panel')).toBeVisible();
    await expectNativePaletteAsync(page, PALETTES.dark);

    await selectThemeAsync(page, 'light');
    await expectNativePaletteAsync(page, PALETTES.light);
    await page.keyboard.press('Control+Z');
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'dark');
    await expectNativePaletteAsync(page, PALETTES.dark);
    await page.keyboard.press('Control+Y');
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'light');
    await expectNativePaletteAsync(page, PALETTES.light);

    await expect.poll(() => page.evaluate(() => {
        const fs = (window as unknown as {__mockFs: Record<string, string>}).__mockFs;
        return fs['.masterdataeditor/settings.json'];
    })).toContain('"theme": "light"');
    await page.reload();
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'light');
    await expectNativePaletteAsync(page, PALETTES.light);
});

test('ネイティブの色は固定パレットでなく現在のCSS変数と透明度を反映する', async ({page}) => {
    await installMockApiAsync(page, createDefaultFileSystem());
    await page.goto('/');
    await page.locator('.activity-bar-settings').click();
    await expect(page.locator('.settings-panel')).toBeVisible();
    await page.evaluate(() => {
        document.body.style.setProperty('--background-sub-color', 'rgb(12, 34, 56)');
        document.body.style.setProperty('--hover-color', 'rgba(70, 80, 90, 0.25)');
    });
    await selectThemeAsync(page, 'light');
    await expectNativePaletteAsync(page, {...PALETTES.light, surface: [12, 34, 56, 255], hover: [70, 80, 90, 64]});
});
