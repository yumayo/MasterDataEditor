import { test, expect } from './fixtures/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// バーチャルスクロール タブ切替テスト
//
// 仮想スクロールが有効になるサイズのテーブルを2つ開き、タブを切り替えたとき
// restoreBookmarkMarks() がDOM外の行にアクセスしてクラッシュしないことを検証する。
// =============================================================================

function generateCsv(prefix: string, rowCount: number): string {
    const rows = ['id,name,value'];
    for (let i = 1; i <= rowCount; i++) {
        rows.push(`${i},${prefix}_${i},${i * 10}`);
    }
    return rows.join('\n');
}

function createFileSystem(): MockFileSystem {
    return {
        'schema/weapon.json': JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int' },
                { key: 1, name: 'name', type: 'string' },
                { key: 2, name: 'value', type: 'int' },
            ],
            primary_key: ['id'],
        }),
        'schema/enemy.json': JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int' },
                { key: 1, name: 'name', type: 'string' },
                { key: 2, name: 'value', type: 'int' },
            ],
            primary_key: ['id'],
        }),
        'data/weapon.csv': generateCsv('weapon', 100),
        'data/enemy.csv': generateCsv('enemy', 100),
    };
}

/** ブックマーク付きファイルシステム（weapon 80行目にブックマーク設定済み） */
function createFileSystemWithBookmark(): MockFileSystem {
    const fs = createFileSystem();
    fs['data/bookmarks.json'] = JSON.stringify([
        { tableName: 'weapon', rowKey: '80', columnName: 'name', label: 'weapon_80', createdAt: '2026-01-01T00:00:00.000Z' },
    ]);
    return fs;
}

test.describe('バーチャルスクロール タブ切替', () => {
    test('仮想スクロール有効テーブル2つを開いてタブ切替してもクラッシュしない', async ({ page }) => {
        // ブラウザ側の未キャッチ例外を収集する
        const pageErrors: Error[] = [];
        page.on('pageerror', (error) => pageErrors.push(error));

        const fs = createFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        // 1つ目のテーブルを開く
        await page.locator('#explorer .explorer-file').getByText('weapon', { exact: true }).click();
        const weaponTable = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="weapon"] .editor-table');
        await expect(weaponTable).toBeVisible();

        // 2つ目のテーブルを開く
        await page.locator('#explorer .explorer-file').getByText('enemy', { exact: true }).click();
        const enemyTable = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="enemy"] .editor-table');
        await expect(enemyTable).toBeVisible();

        // 1つ目のタブに戻す（ここで restoreBookmarkMarks がDOM外の行にアクセスしてクラッシュしていた）
        await page.locator('.tab-button').getByText('weapon', { exact: true }).click();

        // クラッシュせずにテーブルが表示されていること
        await expect(weaponTable).toBeVisible();
        // テーブルにデータ行が表示されていること（仮想スクロールにより全行ではなく一部のみ）
        const rows = weaponTable.locator('.editor-table-row:not(.editor-table-column-header-row)');
        const rowCount = await rows.count();
        expect(rowCount, 'データ行が存在すること').toBeGreaterThan(0);

        // さらにもう一度切り替えても問題ないこと
        await page.locator('.tab-button').getByText('enemy', { exact: true }).click();
        await expect(enemyTable).toBeVisible();

        // ブラウザ側で未キャッチ例外が発生していないこと
        expect(pageErrors, '未キャッチ例外が発生していないこと').toHaveLength(0);
    });

    test('仮想スクロールで後方の行にスクロールしたときブックマークが復元される', async ({ page }) => {
        const fs = createFileSystemWithBookmark();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        // weapon テーブルを開く
        await page.locator('#explorer .explorer-file').getByText('weapon', { exact: true }).click();
        const weaponTable = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="weapon"] .editor-table');
        await expect(weaponTable).toBeVisible();

        // 初期表示では80行目はDOMに存在しないため、ブックマーク属性は見えない
        const initialBookmarked = await weaponTable.locator('[data-bookmarked]').count();
        expect(initialBookmarked, '初期表示ではDOM外のブックマークは表示されない').toBe(0);

        // 80行目付近までスクロールする（行の高さは21px）
        const scrollContainer = page.locator('.editor-left-pane');
        await scrollContainer.evaluate((el) => { el.scrollTop = 79 * 21; });
        await page.waitForTimeout(300);

        // スクロール後、80行目のブックマーク属性が復元されていること
        const afterScrollBookmarked = await weaponTable.locator('[data-bookmarked]').count();
        expect(afterScrollBookmarked, 'スクロール後にブックマークが復元されること').toBeGreaterThan(0);
    });
});
