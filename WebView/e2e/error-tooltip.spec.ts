import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// エラーセルホバーツールチップ機能のテスト
//
// 機能概要:
//   .cell-error クラスを持つセルにマウスホバー 500ms でツールチップを表示する。
//   ValidationPanel からセル位置でエラーを照合し、エラーメッセージを表示する。
//   複数エラーは改行区切りで全表示する。
//   セル離脱・クリック・スクロールで非表示にする。
//
// テストケース一覧:
//   1. PK重複エラーがあるセルにホバー 500ms でツールチップが表示される
//   2. ツールチップにエラーメッセージが含まれる
//   3. セルから離れるとツールチップが非表示になる
//   4. 500ms 以内にセルから離れるとツールチップが表示されない
//   5. セルをクリックするとツールチップが非表示になる
// =============================================================================

// =============================================================================
// フィクスチャ生成ヘルパー
// =============================================================================

/**
 * 初期状態からPK重複が存在するファイルシステムを生成する
 * id=1 が2行存在する（初期データに重複あり）
 */
function createDuplicateFileSystem(): MockFileSystem {
    return {
        "schema/item.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
            ],
            primary_key: ["id"],
        }),
        "data/item.csv": [
            "id,name",
            "1,sword",
            "1,shield",
            "3,potion",
        ].join("\n"),
    };
}

// =============================================================================
// テストヘルパー関数
// =============================================================================

/**
 * エクスプローラーからテーブルを開き、タブ名で絞り込んだ EditorTable の Locator を返す
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
    const table = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="${tableName}"] .editor-table`);
    await expect(table).toBeVisible();
    return table;
}

/**
 * 指定行のPKセル（colIndex=0）を返す
 * rowIndex: 0始まり（ヘッダー行を除く）
 */
function getPkCell(table: Locator, rowIndex: number): Locator {
    const row = table.locator('.editor-table-row').nth(rowIndex + 1);
    return row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(0);
}

/**
 * ツールチップの Locator を返す
 */
function getTooltip(page: Page): Locator {
    return page.locator('.error-tooltip');
}

// =============================================================================
// テストケース1: PK重複エラーがあるセルにホバー 500ms でツールチップが表示される
// =============================================================================

test.describe('テストケース1: エラーセルにホバー 500ms でツールチップが表示される', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createDuplicateFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        'PK重複セルに 500ms ホバーするとツールチップが visible になる',
        async ({ page }) => {
            const table = await openTableAsync(page, 'item');
            const pkCell = getPkCell(table, 0);
            const tooltip = getTooltip(page);

            // 初期状態: PK重複（id=1が2行）のため cell-error が付与済み
            await expect(pkCell).toHaveClass(/cell-error/);

            // ツールチップは非表示
            await expect(tooltip).not.toHaveClass(/visible/);

            // セルにホバーする
            await pkCell.hover();

            // 500ms 以上待機してツールチップが visible になることを確認する
            await expect(tooltip).toHaveClass(/visible/, { timeout: 2000 });
        },
    );
});

// =============================================================================
// テストケース2: ツールチップにエラーメッセージが含まれる
// =============================================================================

test.describe('テストケース2: ツールチップにエラーメッセージが含まれる', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createDuplicateFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        'ツールチップのテキストにPK重複のエラーメッセージが含まれる',
        async ({ page }) => {
            const table = await openTableAsync(page, 'item');
            const pkCell = getPkCell(table, 0);
            const tooltip = getTooltip(page);

            await pkCell.hover();
            await expect(tooltip).toHaveClass(/visible/, { timeout: 2000 });

            // ツールチップのテキスト内容を検証する
            // ValidationEngine のPK重複メッセージが表示されるはず
            const text = await tooltip.textContent();
            expect(text).toBeTruthy();
            // PK重複メッセージにはPK値 "1" が含まれるはず
            expect(text).toContain('1');
        },
    );
});

// =============================================================================
// テストケース3: セルから離れるとツールチップが非表示になる
// =============================================================================

test.describe('テストケース3: セルから離れるとツールチップが非表示になる', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createDuplicateFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        'エラーセルからマウスを離すとツールチップが非表示になる',
        async ({ page }) => {
            const table = await openTableAsync(page, 'item');
            const pkCell = getPkCell(table, 0);
            const tooltip = getTooltip(page);

            // ホバーしてツールチップ表示を待つ
            await pkCell.hover();
            await expect(tooltip).toHaveClass(/visible/, { timeout: 2000 });

            // エラーでないセル（3行目のnameセル、id=3は重複なし）にマウスを移動する
            const nonErrorCell = table.locator('.editor-table-row').nth(3).locator('.editor-table-cell:not(.editor-table-row-header)').nth(1);
            await nonErrorCell.hover();

            // ツールチップが非表示になることを確認する
            await expect(tooltip).not.toHaveClass(/visible/);
        },
    );
});

// =============================================================================
// テストケース4: 500ms 以内にセルから離れるとツールチップが表示されない
// =============================================================================

test.describe('テストケース4: 500ms 以内にセルから離れるとツールチップが表示されない', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createDuplicateFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        '短時間ホバー後に離脱するとツールチップが表示されない',
        async ({ page }) => {
            const table = await openTableAsync(page, 'item');
            const pkCell = getPkCell(table, 0);
            const tooltip = getTooltip(page);

            // セルにホバーする
            await pkCell.hover();

            // 100ms 待機（500ms のディレイより短い）
            await page.waitForTimeout(100);

            // 別のセルにマウスを移動する（離脱）
            const nonErrorCell = table.locator('.editor-table-row').nth(3).locator('.editor-table-cell:not(.editor-table-row-header)').nth(1);
            await nonErrorCell.hover();

            // さらに 600ms 待っても visible にならないことを確認する
            await page.waitForTimeout(600);
            await expect(tooltip).not.toHaveClass(/visible/);
        },
    );
});

// =============================================================================
// テストケース5: セルをクリックするとツールチップが非表示になる
// =============================================================================

test.describe('テストケース5: セルをクリックするとツールチップが非表示になる', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createDuplicateFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        'ツールチップ表示中にセルをクリックすると非表示になる',
        async ({ page }) => {
            const table = await openTableAsync(page, 'item');
            const pkCell = getPkCell(table, 0);
            const tooltip = getTooltip(page);

            // ホバーしてツールチップ表示を待つ
            await pkCell.hover();
            await expect(tooltip).toHaveClass(/visible/, { timeout: 2000 });

            // セルをクリックする（mousedown イベントでツールチップが非表示になるはず）
            await pkCell.click();

            // ツールチップが非表示になることを確認する
            await expect(tooltip).not.toHaveClass(/visible/);
        },
    );
});
