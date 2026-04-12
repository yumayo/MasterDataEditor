import { test, expect } from './fixtures/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// 仮想スクロール 高速下方スクロールで行が消失する不具合のテスト
//
// 問題:
//   高速に下方向へスクロールすると、テーブルのデータ行が一時的にDOMから消失する。
//   上スクロール時は問題ない。
//
// 調査手法:
//   ブラウザ内部で requestAnimationFrame ループを使い scrollTop を段階的に変更。
//   各フレームでDOM行数をチェックし、行が0になった瞬間を検出する。
//   これにより実際のスクロールイベントとrecalculate処理の競合を再現する。
// =============================================================================

/** データ行セレクタ（ヘッダー行とバッファ空行を除外） */
const DATA_ROW_SELECTOR = '.editor-table-row:not(.editor-table-column-header-row):not(.editor-table-empty-row)';

function generateCsv(rowCount: number): string {
    const rows = ['id,name,value'];
    for (let i = 1; i <= rowCount; i++) {
        rows.push(`${i},name_${i},${(i * 7) % 100}`);
    }
    return rows.join('\n');
}

function createFileSystem(): MockFileSystem {
    return {
        'schema/big_table.json': JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int' },
                { key: 1, name: 'name', type: 'string' },
                { key: 2, name: 'value', type: 'int' },
            ],
            primary_key: ['id'],
        }),
        'data/big_table.csv': generateCsv(1000),
    };
}

test.describe('仮想スクロール 高速下方スクロール', () => {
    test('rAFループで高速スクロールしてもデータ行が消失しない', async ({ page }) => {
        const fs = createFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        // テーブルを開く
        await page.locator('#explorer .explorer-file').getByText('big_table', { exact: true }).click();
        const table = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="big_table"] .editor-table');
        await expect(table).toBeVisible();

        // ブラウザ内部でrAFループを使った高速スクロールシミュレーション
        const result = await page.evaluate(() => {
            return new Promise<{
                zeroRowFrames: Array<{frame: number, scrollTop: number, childCount: number}>,
                totalFrames: number,
                finalScrollTop: number,
                finalDataRowCount: number,
                maxScrollTop: number,
            }>((resolve) => {
                const container = document.querySelector('.editor-left-pane') as HTMLElement;
                const tableEl = container.querySelector('.editor-table') as HTMLElement;
                const maxScrollTop = container.scrollHeight - container.clientHeight;
                const zeroRowFrames: Array<{frame: number, scrollTop: number, childCount: number}> = [];
                let frame = 0;
                const scrollPerFrame = 500; // 1フレームあたり500pxスクロール（高速）

                function step() {
                    container.scrollTop += scrollPerFrame;
                    frame++;

                    // scrollイベントハンドラが同期的に処理された後のDOM状態をチェック
                    const dataRowCount = tableEl.querySelectorAll(
                        '.editor-table-row:not(.editor-table-column-header-row):not(.editor-table-empty-row)'
                    ).length;

                    if (dataRowCount === 0) {
                        zeroRowFrames.push({
                            frame,
                            scrollTop: Math.round(container.scrollTop),
                            childCount: tableEl.children.length,
                        });
                        console.error(`[SCROLL-BUG] frame=${frame}: データ行0件! scrollTop=${Math.round(container.scrollTop)}, children=${tableEl.children.length}`);
                    }

                    // 末尾に到達するか60フレーム経過で終了
                    if (container.scrollTop >= maxScrollTop || frame >= 60) {
                        const finalDataRowCount = tableEl.querySelectorAll(
                            '.editor-table-row:not(.editor-table-column-header-row):not(.editor-table-empty-row)'
                        ).length;
                        resolve({
                            zeroRowFrames,
                            totalFrames: frame,
                            finalScrollTop: Math.round(container.scrollTop),
                            finalDataRowCount,
                            maxScrollTop: Math.round(maxScrollTop),
                        });
                        return;
                    }
                    requestAnimationFrame(step);
                }
                requestAnimationFrame(step);
            });
        });

        console.log(`総フレーム数: ${result.totalFrames}`);
        console.log(`最終scrollTop: ${result.finalScrollTop} / ${result.maxScrollTop}`);
        console.log(`最終データ行数: ${result.finalDataRowCount}`);
        console.log(`行消失フレーム数: ${result.zeroRowFrames.length}`);

        if (result.zeroRowFrames.length > 0) {
            for (const f of result.zeroRowFrames) {
                console.log(`  frame=${f.frame}: scrollTop=${f.scrollTop}, children=${f.childCount}`);
            }
        }

        // スクロール中にデータ行が0件になるフレームが存在してはならない
        expect(result.zeroRowFrames.length, 'スクロール中にデータ行が消失するフレームがあってはならない').toBe(0);
        expect(result.finalDataRowCount, 'スクロール完了後にデータ行が存在すること').toBeGreaterThan(0);
    });

    test('scrollTop復元がスクロール進行を妨げない', async ({ page }) => {
        const fs = createFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        // テーブルを開く
        await page.locator('#explorer .explorer-file').getByText('big_table', { exact: true }).click();
        const table = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="big_table"] .editor-table');
        await expect(table).toBeVisible();

        // rAFループで段階的にscrollTopを増加させ、各ステップでscrollTopが進んでいることを確認
        // scrollTop復元が戦っている場合、scrollTopが進まない
        const scrollPositions = await page.evaluate(() => {
            return new Promise<number[]>((resolve) => {
                const container = document.querySelector('.editor-left-pane') as HTMLElement;
                const positions: number[] = [];
                let frame = 0;

                function step() {
                    container.scrollTop += 300;
                    frame++;
                    positions.push(Math.round(container.scrollTop));

                    if (frame >= 40) {
                        resolve(positions);
                        return;
                    }
                    requestAnimationFrame(step);
                }
                requestAnimationFrame(step);
            });
        });

        console.log(`scrollTop推移（先頭5件）: ${JSON.stringify(scrollPositions.slice(0, 5))}`);
        console.log(`scrollTop推移（末尾5件）: ${JSON.stringify(scrollPositions.slice(-5))}`);

        // scrollTopは単調増加するべき（または末尾に到達して一定）
        // 復元が戦っている場合、同じ値が連続したり減少したりする
        let stuckCount = 0;
        let decreaseCount = 0;
        for (let i = 1; i < scrollPositions.length; i++) {
            if (scrollPositions[i] <= scrollPositions[i - 1] && scrollPositions[i - 1] < 20000) {
                // 末尾到達前にscrollTopが停滞/減少している
                if (scrollPositions[i] < scrollPositions[i - 1]) {
                    decreaseCount++;
                } else {
                    stuckCount++;
                }
            }
        }
        console.log(`停滞回数: ${stuckCount}, 減少回数: ${decreaseCount}`);

        // scrollTopは基本的に増加し続けるべき（末尾到達前に停滞5回以上は異常）
        expect(stuckCount, 'scrollTopが末尾到達前に停滞してはならない（scrollTop復元の戦い）').toBeLessThan(5);
        expect(decreaseCount, 'scrollTopが減少してはならない（scrollTop復元による巻き戻り）').toBe(0);
    });
});
