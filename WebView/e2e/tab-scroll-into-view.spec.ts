import { test, expect } from './fixtures/test';
import type { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// タブアクティブ時の自動スクロールテスト
//
// 多数のタブが開かれてタブバーがオーバーフローしている状態で、
// 画面外のタブをアクティブにしたとき、タブボタンが scrollIntoView で
// 可視領域内にスクロールされることを検証する。
// =============================================================================

/** テーブル数: タブバーをオーバーフローさせるために十分な数 */
const TABLE_COUNT = 15;

/**
 * 多数のテーブルを持つテスト用ファイルシステムを生成する
 */
function createManyTablesFileSystem(): MockFileSystem {
    const fs: MockFileSystem = {};
    for (let i = 0; i < TABLE_COUNT; i++) {
        const name = `table_${String(i).padStart(2, '0')}`;
        fs[`schema/${name}.json`] = JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
            ],
            primary_key: ["id"],
        });
        fs[`data/${name}.csv`] = [
            "id,name",
            `1,row_a`,
            `2,row_b`,
        ].join("\n");
    }
    return fs;
}

/**
 * エクスプローラーからテーブルを開く
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
    const table = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="${tableName}"] .editor-table`);
    await expect(table).toBeVisible();
    return table;
}

/**
 * タブボタンがスクロール領域の可視範囲内にあるかを判定する。
 * タブボタンの左端と右端がスクロール領域のビューポート内に収まっていれば true。
 */
async function isTabButtonVisibleInScrollArea(page: Page, tableName: string): Promise<boolean> {
    return page.evaluate((name: string) => {
        const scrollArea = document.querySelector('.tab-scroll-area');
        if (!scrollArea) return false;
        const buttons = scrollArea.querySelectorAll('.tab-button');
        let targetButton: Element | null = null;
        for (let i = 0; i < buttons.length; i++) {
            const nameSpan = buttons[i].querySelector('.tab-button-name');
            if (nameSpan && nameSpan.textContent === name) {
                targetButton = buttons[i];
                break;
            }
        }
        if (!targetButton) return false;
        const scrollRect = scrollArea.getBoundingClientRect();
        const buttonRect = targetButton.getBoundingClientRect();
        // タブボタンの左端がスクロール領域の左端以上、右端がスクロール領域の右端以下
        return buttonRect.left >= scrollRect.left - 1 && buttonRect.right <= scrollRect.right + 1;
    }, tableName);
}

test.describe('タブアクティブ時の自動スクロール', () => {

    test('画面外のタブをアクティブにするとタブバーがスクロールして可視領域に入る', async ({ page }) => {
        const fs = createManyTablesFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        // 全テーブルを順番に開く（最後に開いたタブがアクティブ）
        for (let i = 0; i < TABLE_COUNT; i++) {
            const name = `table_${String(i).padStart(2, '0')}`;
            await openTableAsync(page, name);
        }

        // 最後のタブがアクティブな状態で、最初のタブは画面外にスクロールされているはず
        const firstName = 'table_00';
        const isVisibleBefore = await isTabButtonVisibleInScrollArea(page, firstName);
        // タブバーがオーバーフローしている前提: 最初のタブは可視範囲外
        // （ビューポートが非常に広い場合はオーバーフローしない可能性があるため、
        //   念のため条件チェックする。オーバーフローしていなければテスト対象外としてスキップ）
        if (isVisibleBefore) {
            test.skip();
            return;
        }

        // 最初のタブをエクスプローラーからクリックしてアクティブにする
        await openTableAsync(page, firstName);

        // scrollIntoView({ behavior: 'smooth' }) のアニメーション完了を待つ
        await page.waitForTimeout(500);

        // スクロール後、最初のタブボタンが可視領域内に入っていることを検証
        const isVisibleAfter = await isTabButtonVisibleInScrollArea(page, firstName);
        expect(isVisibleAfter).toBe(true);
    });

    test('右端の画面外タブにも自動スクロールが効く', async ({ page }) => {
        const fs = createManyTablesFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        // 全テーブルを順番に開く
        for (let i = 0; i < TABLE_COUNT; i++) {
            const name = `table_${String(i).padStart(2, '0')}`;
            await openTableAsync(page, name);
        }

        const lastName = `table_${String(TABLE_COUNT - 1).padStart(2, '0')}`;

        // 最初のタブをアクティブにする（スクロールを左端に移動）
        await openTableAsync(page, 'table_00');
        await page.waitForTimeout(500);

        // 最後のタブは画面外にあるはず
        const isVisibleBefore = await isTabButtonVisibleInScrollArea(page, lastName);
        if (isVisibleBefore) {
            test.skip();
            return;
        }

        // 最後のタブをアクティブにする
        await openTableAsync(page, lastName);
        await page.waitForTimeout(500);

        // スクロール後、最後のタブボタンが可視領域内に入っていることを検証
        const isVisibleAfter = await isTabButtonVisibleInScrollArea(page, lastName);
        expect(isVisibleAfter).toBe(true);
    });
});
