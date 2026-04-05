import { test, expect } from './fixtures/test';
import type { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// バーチャルスクロール 参照ヒントテスト
//
// 100行テーブルでFK参照列を持つ場合、仮想スクロールで下方向にスクロールした後も
// 参照ヒント（.cell-reference-hint）が表示されることを検証する。
// =============================================================================

/** 100行のCSVデータ（FK列あり） */
function generateCsv(rowCount: number): string {
    const rows = ['id,name,enemy_id'];
    for (let i = 1; i <= rowCount; i++) {
        // enemy_id は 1〜5 のループ
        rows.push(`${i},item_${i},${((i - 1) % 5) + 1}`);
    }
    return rows.join('\n');
}

function createFileSystem(): MockFileSystem {
    return {
        'schema/test.json': JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int' },
                { key: 1, name: 'name', type: 'string' },
                { key: 2, name: 'enemy_id', type: 'int', reference: 'enemy.ja' },
            ],
            primary_key: ['id'],
        }),
        'data/test.csv': generateCsv(100),
        'schema/enemy.json': JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int' },
                { key: 1, name: 'ja', type: 'string' },
            ],
            primary_key: ['id'],
        }),
        'data/enemy.csv': [
            'id,ja',
            '1,スライム',
            '2,ドラゴン',
            '3,ゴブリン',
            '4,オーク',
            '5,スケルトン',
        ].join('\n'),
    };
}

/** 表示中の参照ヒント数を取得する */
async function countVisibleHints(table: Locator): Promise<number> {
    return table.locator('.cell-reference-hint').count();
}

/** 表示中のデータ行から指定列の参照ヒントテキストを取得する */
async function getHintTextsInColumn(table: Locator, colIndex: number): Promise<string[]> {
    const rows = table.locator('.editor-table-row:not(.editor-table-column-header-row):not(.editor-table-empty-row)');
    const count = await rows.count();
    const texts: string[] = [];
    for (let i = 0; i < count; i++) {
        const cell = rows.nth(i).locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
        const hint = cell.locator('.cell-reference-hint');
        if (await hint.count() > 0) {
            const text = await hint.first().textContent();
            if (text !== null) texts.push(text);
        }
    }
    return texts;
}

test.describe('バーチャルスクロール参照ヒント', () => {
    test('下スクロール後もFK参照ヒントが表示される', async ({ page }) => {
        const fs = createFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        // テーブルを開く
        await page.locator('#explorer .explorer-file').getByText('test', { exact: true }).click();
        const table = page.locator('.editor-left-pane .editor-table').first();
        await expect(table).toBeVisible();

        // 参照データのプリロード完了を待つ
        await expect(table.locator('.cell-reference-hint').first()).toBeAttached({ timeout: 5000 });

        // 初期表示で参照ヒントが存在することを確認
        const initialHintCount = await countVisibleHints(table);
        console.log(`初期表示の参照ヒント数: ${initialHintCount}`);
        expect(initialHintCount).toBeGreaterThan(0);

        const initialHints = await getHintTextsInColumn(table, 2);
        console.log(`初期表示のヒントテキスト: ${JSON.stringify(initialHints.slice(0, 5))}`);

        // スクロールコンテナは左ペイン
        const scrollContainer = page.locator('.editor-left-pane');

        // 下方向に大きくスクロール（行70付近を表示）
        await scrollContainer.evaluate((el) => { el.scrollTop = 70 * 21; });
        await page.waitForTimeout(300);

        // スクロール後も参照ヒントが表示されるべき
        const afterScrollHintCount = await countVisibleHints(table);
        console.log(`下スクロール後の参照ヒント数: ${afterScrollHintCount}`);
        expect(afterScrollHintCount, '下スクロール後に参照ヒントが消えている').toBeGreaterThan(0);

        const afterScrollHints = await getHintTextsInColumn(table, 2);
        console.log(`下スクロール後のヒントテキスト: ${JSON.stringify(afterScrollHints.slice(0, 5))}`);

        // ヒントテキストは敵名のいずれかであるべき
        const validNames = ['スライム', 'ドラゴン', 'ゴブリン', 'オーク', 'スケルトン'];
        for (const hint of afterScrollHints) {
            expect(validNames, `不正なヒントテキスト: ${hint}`).toContain(hint);
        }
    });

    test('上→下→上のスクロール往復で参照ヒントが常に表示される', async ({ page }) => {
        const fs = createFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        await page.locator('#explorer .explorer-file').getByText('test', { exact: true }).click();
        const table = page.locator('.editor-left-pane .editor-table').first();
        await expect(table).toBeVisible();

        // 参照データのプリロード完了を待つ
        await expect(table.locator('.cell-reference-hint').first()).toBeAttached({ timeout: 5000 });

        const scrollContainer = page.locator('.editor-left-pane');

        // 段階的にスクロールして各地点で参照ヒントを確認
        const scrollPositions = [0, 30, 60, 90, 60, 30, 0];
        for (const scrollRow of scrollPositions) {
            await scrollContainer.evaluate((el, row) => { el.scrollTop = row * 21; }, scrollRow);
            await page.waitForTimeout(200);

            const hintCount = await countVisibleHints(table);
            console.log(`scroll=${scrollRow}: ヒント数=${hintCount}`);
            expect(hintCount, `scroll=${scrollRow}で参照ヒントが消えている`).toBeGreaterThan(0);
        }
    });
});
