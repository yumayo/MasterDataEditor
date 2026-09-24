import { test, expect } from './fixtures/test';
import { installMockApiAsync, type MockFileSystem } from './fixtures/mock-api';

function createFileSystem(): MockFileSystem {
    const columns = ['id', 'name', 'hp', 'mp', 'attack', 'defense', 'speed', 'cost'];
    return {
        'schema/chara.json': JSON.stringify({
            header: columns.map((name, key) => ({ key, name, type: key === 1 ? 'string' : 'int', width: 220 })),
            primary_key: ['id'],
        }),
        'data/chara.csv': [columns.join(','), ...Array.from({ length: 1000 }, (_, index) =>
            [index + 1, `chara_${index + 1}`, 100, 50, 30, 20, 10, 5].join(','))].join('\n'),
    };
}

test('テーブルをスクロールして設定へ戻っても外側にスクロール領域が残らない', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await installMockApiAsync(page, createFileSystem());
    await page.goto('/');

    await page.locator('.activity-bar-settings').click();
    const settings = page.locator('.settings-tab-wrapper');
    const leftPane = page.locator('.editor-left-pane');
    await expect(settings).toBeVisible();

    await page.locator('#explorer .explorer-file').getByText('chara', { exact: true }).click();
    const viewport = page.locator('.tab-wrapper[data-tab-name="chara"] .editor-table-main-viewport');
    await expect(viewport).toBeVisible();
    await viewport.evaluate(element => element.scrollTo(400, 5000));
    await expect.poll(() => leftPane.evaluate(element => element.scrollTop)).toBe(5000);
    await expect.poll(() => leftPane.evaluate(element => element.scrollLeft)).toBe(400);

    for (let round = 0; round < 2; round++) {
        await page.locator('.tab-button').getByText('設定', { exact: true }).click();
        await expect(settings).toBeVisible();
        await expect.poll(() => leftPane.evaluate(element => ({
            top: element.scrollTop,
            left: element.scrollLeft,
            extraHeight: element.scrollHeight - element.clientHeight,
            extraWidth: element.scrollWidth - element.clientWidth,
        }))).toEqual({ top: 0, left: 0, extraHeight: 0, extraWidth: 0 });

        await settings.evaluate(element => { element.scrollTop = 0; });
        await settings.hover();
        await page.mouse.wheel(0, 180);
        await expect.poll(() => settings.evaluate(element => element.scrollTop)).toBeGreaterThan(0);

        // 設定の末尾でさらにホイール操作しても、外側が動いて空白へ抜けないこと。
        await settings.evaluate(element => { element.scrollTop = element.scrollHeight; });
        await settings.hover();
        await page.mouse.wheel(0, 600);
        await expect(page.locator('.settings-label').last()).toBeInViewport();
        await expect(leftPane).toHaveJSProperty('scrollTop', 0);
        await expect(leftPane).toHaveJSProperty('scrollLeft', 0);

        // 設定を開いても、テーブル側の保存済みスクロール位置は失われないこと。
        await page.locator('.tab-button').getByText('chara', { exact: true }).click();
        await expect(viewport).toBeVisible();
        await expect(viewport).toHaveJSProperty('scrollTop', 5000);
        await expect(viewport).toHaveJSProperty('scrollLeft', 400);
        // セルは別レイヤーに描画されるため、viewport 自体への hover 判定は使わない。
        const viewportBounds = await viewport.boundingBox();
        if (viewportBounds === null) throw new Error('テーブルのスクロール領域が表示されていません');
        await page.mouse.move(viewportBounds.x + viewportBounds.width / 2, viewportBounds.y + viewportBounds.height / 2);
        await page.mouse.wheel(0, 200);
        await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(5000);
        await viewport.evaluate(element => element.scrollTo(400, 5000));
        await expect.poll(() => leftPane.evaluate(element => element.scrollTop)).toBe(5000);
    }

    // 自動スクリーンショットを設定ページの末尾で記録する。
    await page.locator('.tab-button').getByText('設定', { exact: true }).click();
    await settings.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(page.locator('.settings-label').last()).toBeInViewport();
});
