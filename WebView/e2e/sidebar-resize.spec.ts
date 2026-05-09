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

test(
    '上限到達後にマウスを逆方向に移動しても超過分を戻りきるまでリサイズが始まらないこと',
    async ({ page, mockFileSystem }) => {
        const handle = page.locator('.explorer .resize-handle');
        const explorer = page.locator('#explorer');

        // ハンドルの初期位置を取得
        const handleBox = await handle.boundingBox();
        const startX = handleBox!.x + handleBox!.width / 2;
        const startY = handleBox!.y + handleBox!.height / 2;
        await page.mouse.move(startX, startY);
        await page.mouse.down();

        // ステップ1: 右に大きく移動して最大幅（600px）に到達させる
        // 初期幅 + 500px ほど動かせば確実に上限に当たる
        await page.mouse.move(startX + 500, startY);

        // 600px に達していることを確認（この時点でのハンドル位置を記録）
        const atMaxBox = await explorer.boundingBox();
        expect(atMaxBox!.width).toBeLessThanOrEqual(600);
        const handleAtMax = await handle.boundingBox();
        const maxHandleX = handleAtMax!.x + handleAtMax!.width / 2;

        // ステップ2: さらに右に100px移動する（パネルは動かないが、マウスの論理位置は右へ）
        await page.mouse.move(maxHandleX + 100, startY);

        // 超過移動後もパネルが最大幅のままであること
        expect((await explorer.boundingBox())!.width).toBeLessThanOrEqual(600);

        // ステップ3: 左に50px移動する（まだ100px分の超過「貯金」があるのでパネルは動かないはず）
        await page.mouse.move(maxHandleX + 50, startY);

        // サイドバー幅がまだ600pxであること（50px分しか戻っていないので縮小が始まっていない）
        const afterPartialReturnBox = await explorer.boundingBox();
        expect(afterPartialReturnBox!.width).toBeCloseTo(600, -1);

        // ステップ4: さらに左に120px移動（超過100pxを解消し、さらに20px分縮小するはず）
        await page.mouse.move(maxHandleX - 20, startY);

        // 超過分を戻りきった後はリサイズが始まるため、600pxより小さくなっているはず
        const afterFullReturnBox = await explorer.boundingBox();
        expect(afterFullReturnBox!.width).toBeLessThan(600);

        await page.mouse.up();
    },
);
