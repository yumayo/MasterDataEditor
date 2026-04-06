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
});
