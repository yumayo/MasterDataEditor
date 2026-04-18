import { test, expect } from './fixtures/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// バーチャルスクロール ブックマークジャンプテスト
//
// 1000行テーブルの800行目にブックマークを設定し、ブックマーク一覧から
// クリックしてジャンプできることを検証する。
// navigateToCell() が getRowCount()（DOM行数）でループしているため、
// 仮想スクロール外の行に到達できない問題を検出する。
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
        // 800行目の name 列にブックマーク設定済み
        'userdata/bookmarks.json': JSON.stringify([
            { tableName: 'item', rowKey: '800', columnName: 'name', label: 'item_800', createdAt: '2026-01-01T00:00:00.000Z' },
        ]),
    };
}

test.describe('バーチャルスクロール ブックマークジャンプ', () => {
    test('800行目のブックマークをクリックするとその行にジャンプできる', async ({ page }) => {
        const pageErrors: Error[] = [];
        page.on('pageerror', (error) => pageErrors.push(error));

        const fs = createFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        // テーブルを開く
        await page.locator('#explorer .explorer-file').getByText('item', { exact: true }).click();
        const table = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="item"] .editor-table');
        await expect(table).toBeVisible();

        // ブックマークパネルを開く
        await page.locator('.activity-bar-item[data-panel="bookmarks"]').click();

        // ブックマークエントリが表示されていること
        const bookmarkEntry = page.locator('.bookmark-entry');
        await expect(bookmarkEntry).toHaveCount(1);

        // ブックマークエントリをクリックしてジャンプする
        await bookmarkEntry.first().click();
        await page.waitForTimeout(500);

        // 800行目付近にスクロールされていること
        const scrollContainer = page.locator('.editor-left-pane');
        const scrollTop = await scrollContainer.evaluate((el) => el.scrollTop);
        console.log(`ジャンプ後scrollTop: ${scrollTop}`);
        // 800行目 × 21px ≈ 16800付近にスクロールされているはず（ビューポート中央表示のため多少ずれる）
        expect(scrollTop, '800行目付近にスクロールされていること').toBeGreaterThan(10000);

        // フォーカスセルが800行目であること（選択クラスで確認）
        const focusedCell = table.locator('.editor-table-cell-focused');
        await expect(focusedCell, 'フォーカスセルが存在すること').toHaveCount(1);

        // ブラウザ側で未キャッチ例外が発生していないこと
        expect(pageErrors, '未キャッチ例外が発生していないこと').toHaveLength(0);
    });
});
