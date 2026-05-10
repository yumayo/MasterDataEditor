import { test, expect } from './fixtures/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// バーチャルスクロール スクロールバー安定性テスト
//
// 仮想スクロールでゆっくりスクロールしたとき、scrollHeight が一定に保たれることを検証する。
// DPIスケーリング時に offsetHeight（整数）と実際のレンダリング高さ（小数）の差異により
// スペーサー高さが変動し、スクロールバーのつまみ位置がずれる問題を検出する。
// =============================================================================

function generateCsv(rowCount: number): string {
    const rows = ['id,name,value'];
    for (let i = 1; i <= rowCount; i++) {
        rows.push(`${i},item_${i},${i * 10}`);
    }
    return rows.join('\n');
}

function createFileSystem(): MockFileSystem {
    return {
        'schema/item.json': JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int' },
                { key: 1, name: 'name', type: 'string' },
                { key: 2, name: 'value', type: 'int' },
            ],
            primary_key: ['id'],
        }),
        'data/item.csv': generateCsv(1000),
    };
}

test.describe('バーチャルスクロール スクロールバー安定性', () => {
    // DPI 125% でスクロールバーのつまみずれを再現する
    test.use({ deviceScaleFactor: 1.25 });

    test('スクロール中にscrollHeightが一定に保たれる', async ({ page }) => {
        const fs = createFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        // テーブルを開く
        await page.locator('#explorer .explorer-file').getByText('item', { exact: true }).click();
        const table = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="item"] .editor-table');
        await expect(table).toBeVisible();

        const scrollContainer = page.locator('.editor-left-pane');

        // 初期表示時のscrollHeightを記録する
        const initialScrollHeight = await scrollContainer.evaluate((el) => el.scrollHeight);
        console.log(`初期scrollHeight: ${initialScrollHeight}`);

        // 複数のスクロール位置でscrollHeightを測定し、変動がないことを確認する
        // ゆっくりスクロールすると仮想スクロールの行入れ替えが複数回発生する
        const scrollPositions = [100, 500, 2000, 5000, 10000, 15000, 18000, 10000, 5000, 0];
        const scrollHeights: number[] = [initialScrollHeight];

        for (const targetScrollTop of scrollPositions) {
            await scrollContainer.evaluate((el, top) => { el.scrollTop = top; }, targetScrollTop);
            // スクロールイベント処理とDOM更新を待つ
            await page.waitForTimeout(100);
            const currentScrollHeight = await scrollContainer.evaluate((el) => el.scrollHeight);
            scrollHeights.push(currentScrollHeight);
        }

        console.log(`scrollHeight推移: ${JSON.stringify(scrollHeights)}`);

        // scrollHeightの最大変動幅が2px以内であること
        // DPIスケーリングでoffsetHeight（整数）と実際の行高さ（小数）に差があると
        // 表示行数の変化に応じてscrollHeightが変動し、スクロールバーのつまみがずれる
        const minHeight = Math.min(...scrollHeights);
        const maxHeight = Math.max(...scrollHeights);
        const drift = maxHeight - minHeight;
        console.log(`scrollHeight変動幅: ${drift}px (min=${minHeight}, max=${maxHeight})`);
        expect(drift, `scrollHeightの変動幅が2px以内であること（実際: ${drift}px）`).toBeLessThanOrEqual(2);
    });

    test('右下ビューポートを高速に下端から中央へスクロールしても位置が巻き戻らない', async ({ page }) => {
        const fs = createFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        await page.locator('#explorer .explorer-file').getByText('item', { exact: true }).click();
        const table = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="item"] .editor-table');
        await expect(table).toBeVisible();

        const result = await page.evaluate(() => {
            return new Promise<{
                initialScrollHeight: number;
                finalScrollHeight: number;
                maxScrollTop: number;
                targetScrollTop: number;
                finalScrollTop: number;
                leftPaneScrollTop: number;
                overflowAnchor: string;
                leftPaneOverflowAnchor: string;
            }>((resolve) => {
                const viewport = document.querySelector('.editor-left-pane .editor-table-main-viewport') as HTMLElement | null;
                const leftPane = document.querySelector('.editor-left-pane') as HTMLElement | null;
                if (viewport === null) throw new Error('editor-table-main-viewport が見つかりません');
                if (leftPane === null) throw new Error('editor-left-pane が見つかりません');

                const initialScrollHeight = viewport.scrollHeight;
                const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
                const targetScrollTop = Math.round(maxScrollTop * 0.5);
                viewport.scrollTop = maxScrollTop;
                viewport.dispatchEvent(new Event('scroll'));

                let frame = 0;
                const totalFrames = 12;
                const start = maxScrollTop;

                function step() {
                    frame++;
                    const progress = frame / totalFrames;
                    viewport.scrollTop = Math.round(start + ((targetScrollTop - start) * progress));
                    viewport.dispatchEvent(new Event('scroll'));

                    if (frame < totalFrames) {
                        requestAnimationFrame(step);
                        return;
                    }

                    requestAnimationFrame(() => {
                        resolve({
                            initialScrollHeight,
                            finalScrollHeight: viewport.scrollHeight,
                            maxScrollTop,
                            targetScrollTop,
                            finalScrollTop: viewport.scrollTop,
                            leftPaneScrollTop: leftPane.scrollTop,
                            overflowAnchor: window.getComputedStyle(viewport).getPropertyValue('overflow-anchor'),
                            leftPaneOverflowAnchor: window.getComputedStyle(leftPane).getPropertyValue('overflow-anchor'),
                        });
                    });
                }

                requestAnimationFrame(step);
            });
        });

        const drift = Math.abs(result.finalScrollHeight - result.initialScrollHeight);
        console.log(`mainViewport scrollHeight drift: ${drift}px`);
        console.log(`target=${result.targetScrollTop}, final=${result.finalScrollTop}, leftPane=${result.leftPaneScrollTop}, max=${result.maxScrollTop}`);

        expect(drift, '右下ビューポートのscrollHeightが高速スクロール後も安定していること').toBeLessThanOrEqual(2);
        expect(result.overflowAnchor, '仮想スクロールの行差し替え中にブラウザがscrollTopを補正しないこと').toBe('none');
        expect(result.leftPaneOverflowAnchor, '互換スクロール領域の同期中にブラウザがscrollTopを補正しないこと').toBe('none');
        expect(
            Math.abs(result.finalScrollTop - result.targetScrollTop),
            `高速スクロール後のscrollTopが目標から大きくずれています: target=${result.targetScrollTop}, final=${result.finalScrollTop}`
        ).toBeLessThanOrEqual(2);
    });
});
