import { test, expect } from './fixtures/test';

/**
 * サイドバーのリサイズハンドルをドラッグして幅を変更するテスト
 */

test(
    'リサイズハンドルが存在すること',
    async ({ page, mockFileSystem }) => {
        const handle = page.locator('.explorer .resize-handle');
        await expect(handle).toBeVisible();
    },
);

test(
    'ドラッグでサイドバー幅が変更されること',
    async ({ page, mockFileSystem }) => {
        const handle = page.locator('.explorer .resize-handle');
        const explorer = page.locator('#explorer');
        const tab = page.locator('#tab');
        const editor = page.locator('#editor');

        // 初期幅を取得
        const initialBox = await explorer.boundingBox();
        const initialWidth = initialBox!.width;

        // ハンドルをドラッグ（右に100px移動）
        const handleBox = await handle.boundingBox();
        const startX = handleBox!.x + handleBox!.width / 2;
        const startY = handleBox!.y + handleBox!.height / 2;
        await page.mouse.move(startX, startY);
        await page.mouse.down();
        await page.mouse.move(startX + 100, startY);
        await page.mouse.up();

        // サイドバー幅が増加していること
        const newBox = await explorer.boundingBox();
        expect(newBox!.width).toBeCloseTo(initialWidth + 100, -1);

        // tab と editor の left が連動していること
        const tabBox = await tab.boundingBox();
        expect(tabBox!.x).toBeCloseTo(newBox!.width, -1);

        const editorBox = await editor.boundingBox();
        expect(editorBox!.x).toBeCloseTo(newBox!.width, -1);
    },
);

test(
    '最小幅（150px）を下回らないこと',
    async ({ page, mockFileSystem }) => {
        const handle = page.locator('.explorer .resize-handle');

        // ハンドルを左に大きくドラッグ（-300px）
        const handleBox = await handle.boundingBox();
        const startX = handleBox!.x + handleBox!.width / 2;
        const startY = handleBox!.y + handleBox!.height / 2;
        await page.mouse.move(startX, startY);
        await page.mouse.down();
        await page.mouse.move(startX - 300, startY);
        await page.mouse.up();

        // サイドバー幅が最小幅以上であること
        const explorer = page.locator('#explorer');
        const box = await explorer.boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(150);
    },
);

test(
    '最大幅（600px）を超えないこと',
    async ({ page, mockFileSystem }) => {
        const handle = page.locator('.explorer .resize-handle');

        // ハンドルを右に大きくドラッグ（+500px）
        const handleBox = await handle.boundingBox();
        const startX = handleBox!.x + handleBox!.width / 2;
        const startY = handleBox!.y + handleBox!.height / 2;
        await page.mouse.move(startX, startY);
        await page.mouse.down();
        await page.mouse.move(startX + 500, startY);
        await page.mouse.up();

        // サイドバー幅が最大幅以下であること
        const explorer = page.locator('#explorer');
        const box = await explorer.boundingBox();
        expect(box!.width).toBeLessThanOrEqual(600);
    },
);
