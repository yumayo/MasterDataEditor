import { test, expect } from './fixtures/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// バーチャルスクロール セルクリック時の不要スクロール防止テスト
//
// 1000行テーブルを半分までスクロールして画面中央のセルをクリックしたとき、
// ensureRowVisible() の座標計算の不一致により800行目付近まで
// 飛んでしまう問題を検出する。
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

test.describe('バーチャルスクロール セルクリック', () => {
    test('画面内に表示されているセルをクリックしてもスクロール位置が飛ばない', async ({ page }) => {
        const fs = createFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        // テーブルを開く
        await page.locator('#explorer .explorer-file').getByText('item', { exact: true }).click();
        const table = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="item"] .editor-table');
        await expect(table).toBeVisible();

        // 500行目付近までスクロールする
        const scrollContainer = page.locator('.editor-left-pane');
        await scrollContainer.evaluate((el) => { el.scrollTop = 500 * 20; });
        await page.waitForTimeout(300);

        const scrollTopBefore = await scrollContainer.evaluate((el) => el.scrollTop);
        console.log(`クリック前scrollTop: ${scrollTopBefore}`);

        // 画面中央付近に表示されているセルをクリックする
        // ビューポート中央のセルを見つけてクリック
        const visibleCell = await page.evaluate(() => {
            const container = document.querySelector('.editor-left-pane') as HTMLElement;
            const table = container.querySelector('.editor-table') as HTMLElement;
            const rows = table.querySelectorAll('.editor-table-row:not(.editor-table-column-header-row)');
            // DOM上の中間付近の行のデータセル（行ヘッダーを除く2番目のセル）を返す
            const midIndex = Math.floor(rows.length / 2);
            const midRow = rows[midIndex];
            const cell = midRow.querySelector('.editor-table-cell:not(.editor-table-row-header)') as HTMLElement;
            // 行ヘッダーからdata-row-indexを取得
            const rowHeader = midRow.querySelector('.editor-table-row-header') as HTMLElement;
            const rowIndex = rowHeader ? rowHeader.dataset.rowIndex : 'unknown';
            return { rowIndex, rect: cell.getBoundingClientRect() };
        });
        console.log(`クリック対象: data-row-index=${visibleCell.rowIndex}`);

        // そのセルの中心をクリック
        const clickX = visibleCell.rect.x + visibleCell.rect.width / 2;
        const clickY = visibleCell.rect.y + visibleCell.rect.height / 2;
        await page.mouse.click(clickX, clickY);
        await page.waitForTimeout(200);

        const scrollTopAfter = await scrollContainer.evaluate((el) => el.scrollTop);
        console.log(`クリック後scrollTop: ${scrollTopAfter}`);

        // クリック前後でスクロール位置がほとんど変わらないこと（許容: ±100px = 約5行分）
        const drift = Math.abs(scrollTopAfter - scrollTopBefore);
        console.log(`スクロール変動: ${drift}px`);
        expect(drift, `画面内セルクリックでスクロールが${drift}px飛んだ（許容: 100px以内）`).toBeLessThanOrEqual(100);
    });
});
