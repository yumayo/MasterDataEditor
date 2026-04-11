import { test, expect } from './fixtures/test';
import type { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// 仮想スクロール × 固定行（freeze row）の統合テスト
//
// 仮想スクロール有効テーブルで固定行を設定した場合、スクロールしても
// 固定行がDOMに残り position:sticky が維持されることを検証する。
//
// 問題:
//   現在の updateRenderedRows() は固定行を特別扱いしない。
//   OVERSCAN範囲外になると固定行もDOMから削除され、stickyが無効になる。
//
// テストケース:
//   1. 固定行を設定後、下にスクロールしても固定行がDOMに存在しstickyが維持される
// =============================================================================

/** 1000行のCSVデータを生成する */
function generateCsv(rowCount: number): string {
    const rows = ['id,name,value'];
    for (let i = 1; i <= rowCount; i++) {
        rows.push(`${i},name_${i},${(i * 7) % 100}`);
    }
    return rows.join('\n');
}

/** テスト用ファイルシステム（1000行テーブル + frozenRowCount=2 をスキーマに設定） */
function createFileSystem(): MockFileSystem {
    return {
        'schema/big_table.json': JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int' },
                { key: 1, name: 'name', type: 'string' },
                { key: 2, name: 'value', type: 'int' },
            ],
            primary_key: ['id'],
            frozenRowCount: 2,
        }),
        'data/big_table.csv': generateCsv(1000),
    };
}

/** テーブルを開いてLocatorを返す */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
    const table = page.locator('.editor-left-pane .editor-table');
    await expect(table).toBeVisible();
    return table;
}

test.describe('仮想スクロール × 固定行', () => {
    test('固定行を設定後、下にスクロールしても固定行がDOMに存在しstickyが維持される', async ({ page }) => {
        const fs = createFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        const table = await openTableAsync(page, 'big_table');

        // 初期表示で固定行（データ行0, 1）がDOMに存在し、stickyが適用されていることを確認
        const dataRows = table.locator('.editor-table-row:not(.editor-table-column-header-row):not(.editor-table-empty-row)');
        const initialRowCount = await dataRows.count();
        expect(initialRowCount).toBeGreaterThanOrEqual(2);

        // 固定行0のスタイルを確認（position:sticky, topが0pxより大きい）
        const frozenRow0 = dataRows.nth(0);
        const frozenRow0Style = await frozenRow0.evaluate((el) => {
            const cs = window.getComputedStyle(el);
            return { position: cs.position, top: cs.top };
        });
        expect(frozenRow0Style.position).toBe('sticky');
        expect(parseInt(frozenRow0Style.top)).toBeGreaterThan(0);

        // 固定行1のスタイルも確認
        const frozenRow1 = dataRows.nth(1);
        const frozenRow1Style = await frozenRow1.evaluate((el) => {
            const cs = window.getComputedStyle(el);
            return { position: cs.position, top: cs.top };
        });
        expect(frozenRow1Style.position).toBe('sticky');
        expect(parseInt(frozenRow1Style.top)).toBeGreaterThan(parseInt(frozenRow0Style.top));

        // 500行目付近までスクロールする（OVERSCAN=10 をはるかに超える位置）
        const scrollContainer = page.locator('.editor-left-pane');
        await scrollContainer.evaluate((el) => { el.scrollTop = 500 * 21; });
        await page.waitForTimeout(300);

        // スクロール後も固定行（データ行0, 1）のID値を持つ行がDOMに存在することを検証する
        // 固定行のIDは "1" と "2"（CSV上の最初の2行）
        const row0IdCell = table.locator('.editor-table-row:not(.editor-table-column-header-row):not(.editor-table-empty-row)')
            .filter({ has: page.locator('.editor-table-row-header[data-row-index="0"]') });
        await expect(row0IdCell).toHaveCount(1);

        const row1IdCell = table.locator('.editor-table-row:not(.editor-table-column-header-row):not(.editor-table-empty-row)')
            .filter({ has: page.locator('.editor-table-row-header[data-row-index="1"]') });
        await expect(row1IdCell).toHaveCount(1);

        // 固定行0が依然としてstickyであること
        const frozenRow0AfterScroll = row0IdCell.first();
        const afterScrollStyle0 = await frozenRow0AfterScroll.evaluate((el) => {
            const cs = window.getComputedStyle(el);
            return { position: cs.position, top: cs.top };
        });
        expect(afterScrollStyle0.position).toBe('sticky');
        expect(parseInt(afterScrollStyle0.top)).toBeGreaterThan(0);

        // 固定行1が依然としてstickyであること
        const frozenRow1AfterScroll = row1IdCell.first();
        const afterScrollStyle1 = await frozenRow1AfterScroll.evaluate((el) => {
            const cs = window.getComputedStyle(el);
            return { position: cs.position, top: cs.top };
        });
        expect(afterScrollStyle1.position).toBe('sticky');
        expect(parseInt(afterScrollStyle1.top)).toBeGreaterThan(parseInt(afterScrollStyle0.top));

        // さらに: ビューポート内にスクロール位置に対応したデータ行も表示されていること
        // （固定行だけでなく、500行目付近の行も表示されている）
        const allVisibleRows = table.locator('.editor-table-row:not(.editor-table-column-header-row):not(.editor-table-empty-row)');
        const visibleCount = await allVisibleRows.count();
        // 固定行2行 + ビューポート内の通常行（少なくとも数行はある）
        expect(visibleCount).toBeGreaterThan(5);
    });

    test('固定行を選択してスクロールしてもフィルハンドルが固定行セルの右下に正しく位置する', async ({ page }) => {
        const fs = createFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        const table = await openTableAsync(page, 'big_table');

        // 固定行のセル（データ行0, value列）をクリックして選択する
        const dataRows = table.locator('.editor-table-row:not(.editor-table-column-header-row):not(.editor-table-empty-row)');
        const frozenRow = dataRows.nth(0);
        // value列（3番目のデータセル = children[2] ※行ヘッダー除く）をクリック
        const targetCell = frozenRow.locator('.editor-table-cell').nth(2);
        await targetCell.click();

        // まずスクロールを一度行って、仮想スクロールの表示範囲を安定させる。
        // 初回描画では renderedEnd が大きく、スクロール時に行入れ替えが発生して
        // afterRowsUpdated → updateFillHandlePosition が呼ばれてしまう。
        // 安定後の微小スクロールでは行入れ替えが発生しないため、
        // 修正前は updateFillHandlePosition が呼ばれず fillHandle の位置がずれる。
        const scrollContainer = page.locator('.editor-left-pane');
        await scrollContainer.evaluate((el) => { el.scrollTop = 1; });
        await page.waitForTimeout(50);

        // 安定後のfillHandle の style.top を記録する
        const initialTop = await page.evaluate(() => {
            const handle = document.querySelector('.fill-handle') as HTMLElement;
            return parseFloat(handle.style.top);
        });

        // 2回目の微小スクロール: 行入れ替えが発生しない量（1px追加）
        const scrollAmount = 5;
        await scrollContainer.evaluate((el, amount) => { el.scrollTop += amount; }, scrollAmount);
        await page.waitForTimeout(50);

        // スクロール後のfillHandle の style.top を取得する
        const afterScrollTop = await page.evaluate(() => {
            const handle = document.querySelector('.fill-handle') as HTMLElement;
            return parseFloat(handle.style.top);
        });

        // stickyセルのビューポート位置は不変なので、fillHandle の style.top は
        // スクロール量分だけ増加する必要がある。
        // 修正前: style.top が更新されないため差分0 → 失敗
        // 修正後: スクロールイベントで updateFillHandlePosition が呼ばれ、差分 ≈ scrollAmount
        expect(Math.abs((afterScrollTop - initialTop) - scrollAmount)).toBeLessThanOrEqual(2);
    });
});
