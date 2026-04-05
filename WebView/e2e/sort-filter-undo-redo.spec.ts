import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// ソート・フィルター Undo/Redo テスト
//
// 機能概要:
//   ソート・フィルタ操作を History に積み、Ctrl+Z / Ctrl+Y で
//   Undo/Redo できるようにする。
//
// 致命的シナリオの検証:
//   1. ソートUndo後にDOM行順序が元に戻ること
//   2. ソートA→ソートB→ソートBのUndoで、ソートAの状態に正しく戻ること
//   3. ソート→セル編集→セル編集Undo→ソートUndoの順でデータが壊れないこと
//   4. ソートだけの操作ではdirtyにならないこと（View変換のみ）
//   5. フィルタUndoで元の表示状態に戻ること
//   6. フィルタだけの操作ではdirtyにならないこと
// =============================================================================

// =============================================================================
// フィクスチャ生成ヘルパー
// =============================================================================

/**
 * Undo/Redo テスト用のファイルシステムを生成する。
 *
 * テーブル構成:
 *   item: id（int）, name（string）, value（int）
 *
 * CSVの行順序: id=2, id=10, id=1（ソート前の元の順序）
 */
function createTestFileSystem(): MockFileSystem {
    return {
        "schema/item.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                { key: 2, name: "value", type: "int" },
            ],
            primary_key: ["id"],
        }),
        "data/item.csv": [
            "id,name,value",
            "2,beta,200",
            "10,alpha,900",
            "1,gamma,100",
        ].join("\n"),
    };
}

// =============================================================================
// テストユーティリティ
// =============================================================================

/** テーブルを開いて左ペインの Locator を返す */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
    const table = page.locator('.editor-left-pane .editor-table');
    await expect(table).toBeVisible();
    return table;
}

/**
 * テーブルのデータ行（バッファ空行を除く）の指定列のテキスト一覧を取得する。
 * colIndex: 0始まり（行ヘッダーを除く）
 */
async function getColumnValuesAsync(table: Locator, colIndex: number): Promise<string[]> {
    const dataRows = table.locator('.editor-table-row:not(.editor-table-empty-row)');
    const count = await dataRows.count();
    const values: string[] = [];
    // 行0はヘッダー行。データ行は1から始まる。
    for (let i = 1; i < count; i++) {
        const row = dataRows.nth(i);
        const cell = row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
        values.push(await cell.innerText());
    }
    return values;
}

/**
 * テーブルの表示行（バッファ空行・非表示行を除く）の指定列のテキスト一覧を取得する。
 * colIndex: 0始まり（行ヘッダーを除く）
 */
async function getVisibleColumnValuesAsync(table: Locator, colIndex: number): Promise<string[]> {
    const dataRows = table.locator('.editor-table-row:not(.editor-table-empty-row)');
    const count = await dataRows.count();
    const values: string[] = [];
    for (let i = 1; i < count; i++) {
        const row = dataRows.nth(i);
        const isVisible = await row.isVisible();
        if (!isVisible) continue;
        const cell = row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
        values.push(await cell.innerText());
    }
    return values;
}

/** 指定した列ヘッダーのソートインジケーターをクリックする */
async function clickSortIndicatorAsync(table: Locator, colIndex: number): Promise<void> {
    const headerRow = table.locator('.editor-table-column-header-row');
    const headerCell = headerRow.locator('.editor-table-column-header').nth(colIndex);
    const sortIndicator = headerCell.locator('.sort-indicator');
    await sortIndicator.click();
}

/** 指定した列ヘッダーのフィルターアイコンをクリックしてドロップダウンを開く */
async function clickFilterIconAsync(table: Locator, colIndex: number): Promise<void> {
    const headerRow = table.locator('.editor-table-column-header-row');
    const headerCell = headerRow.locator('.editor-table-column-header').nth(colIndex);
    const filterIcon = headerCell.locator('.filter-icon');
    await filterIcon.click();
}

/** フィルタードロップダウン内の指定ラベルの項目のチェック状態を変更する */
async function setFilterItemCheckedAsync(page: Page, label: string, checked: boolean): Promise<void> {
    const dropdown = page.locator('.filter-dropdown.visible');
    const item = dropdown.locator('.filter-item').filter({ hasText: label });
    const checkbox = item.locator('input[type="checkbox"]');
    const currentChecked = await checkbox.isChecked();
    if (currentChecked !== checked) {
        await checkbox.click();
    }
}

/** フィルタードロップダウンの適用ボタンをクリックしてフィルターを適用する */
async function applyFilterAsync(page: Page): Promise<void> {
    const dropdown = page.locator('.filter-dropdown.visible');
    await dropdown.locator('.filter-apply').click();
}

/**
 * 指定セルをダブルクリックして値を入力し、Enterで確定する。
 * rowIndex: 1始まり（データ行）, colIndex: 0始まり（行ヘッダー除く）
 */
async function editCellAsync(table: Locator, page: Page, rowIndex: number, colIndex: number, value: string): Promise<void> {
    const dataRows = table.locator('.editor-table-row:not(.editor-table-empty-row)');
    const row = dataRows.nth(rowIndex);
    const cell = row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
    await cell.dblclick();
    // テキストフィールドが表示されるのを待つ
    const textfield = page.locator('.grid-textfield');
    await expect(textfield).toBeVisible();
    await textfield.fill(value);
    await page.keyboard.press('Enter');
}

/** タブボタンにdirtyマーク（未保存インジケーター）が表示されているか */
async function isTabDirtyAsync(page: Page, tableName: string): Promise<boolean> {
    const tabButton = page.locator('.tab-button').filter({ hasText: tableName });
    const dirtyIndicator = tabButton.locator('.tab-button-dirty');
    return dirtyIndicator.evaluate(el => el.classList.contains('tab-button-dirty-visible'));
}

// =============================================================================
// テストケース
// =============================================================================

test.describe('ソート・フィルター Undo/Redo', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createTestFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    // =========================================================================
    // ソート Undo/Redo
    // =========================================================================

    test.describe('ソートの Undo/Redo', () => {
        test('ソートをUndoすると元の行順序に戻る', async ({ page }) => {
            const table = await openTableAsync(page, 'item');

            // 元の順序: 2, 10, 1
            const originalOrder = await getColumnValuesAsync(table, 0);
            expect(originalOrder).toEqual(['2', '10', '1']);

            // id列を昇順ソート → 1, 2, 10
            await clickSortIndicatorAsync(table, 0);
            const sortedOrder = await getColumnValuesAsync(table, 0);
            expect(sortedOrder).toEqual(['1', '2', '10']);

            // Ctrl+Z でソートをUndo → 元の順序 2, 10, 1 に戻る
            await page.keyboard.press('Control+z');
            const undoneOrder = await getColumnValuesAsync(table, 0);
            expect(undoneOrder).toEqual(['2', '10', '1']);
        });

        test('ソートをRedo すると再びソート状態になる', async ({ page }) => {
            const table = await openTableAsync(page, 'item');

            // id列を昇順ソート
            await clickSortIndicatorAsync(table, 0);

            // Undo
            await page.keyboard.press('Control+z');
            const undoneOrder = await getColumnValuesAsync(table, 0);
            expect(undoneOrder).toEqual(['2', '10', '1']);

            // Ctrl+Y でRedo → 1, 2, 10
            await page.keyboard.press('Control+y');
            const redoneOrder = await getColumnValuesAsync(table, 0);
            expect(redoneOrder).toEqual(['1', '2', '10']);
        });

        test(
            'ソートA→ソートB→ソートBのUndoで、ソートAの状態に正しく戻る',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');

                // 元の順序: id=[2, 10, 1]
                // id列を昇順ソート（ソートA）→ id=[1, 2, 10]
                await clickSortIndicatorAsync(table, 0);
                const sortAOrder = await getColumnValuesAsync(table, 0);
                expect(sortAOrder).toEqual(['1', '2', '10']);

                // id列をもう一度クリック（ソートB: id降順）→ id=[10, 2, 1]
                await clickSortIndicatorAsync(table, 0);
                const sortBOrder = await getColumnValuesAsync(table, 0);
                expect(sortBOrder).toEqual(['10', '2', '1']);

                // Ctrl+Z でソートBだけをUndo → ソートAの状態（id昇順）に戻る
                await page.keyboard.press('Control+z');
                const afterUndoB = await getColumnValuesAsync(table, 0);
                expect(afterUndoB).toEqual(['1', '2', '10']);
            },
        );
    });

    // =========================================================================
    // ソート × セル編集の交錯
    // =========================================================================

    test.describe('ソートとセル編集の交錯', () => {
        test(
            'ソート→セル編集→セル編集Undo→ソートUndoの順で正しいセルが復元される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');

                // 元の順序: id=[2, 10, 1], name=[beta, alpha, gamma]
                // id列を昇順ソート → id=[1, 2, 10], name=[gamma, beta, alpha]
                await clickSortIndicatorAsync(table, 0);
                const sortedNames = await getColumnValuesAsync(table, 1);
                expect(sortedNames).toEqual(['gamma', 'beta', 'alpha']);

                // ソート後の1行目（id=1, name=gamma）の name を "EDITED" に変更
                await editCellAsync(table, page, 1, 1, 'EDITED');
                const afterEdit = await getColumnValuesAsync(table, 1);
                expect(afterEdit).toEqual(['EDITED', 'beta', 'alpha']);

                // Ctrl+Z でセル編集をUndo → name が "gamma" に戻る
                await page.keyboard.press('Control+z');
                const afterUndoEdit = await getColumnValuesAsync(table, 1);
                expect(afterUndoEdit).toEqual(['gamma', 'beta', 'alpha']);

                // Ctrl+Z でソートをUndo → 元の順序に戻る
                await page.keyboard.press('Control+z');
                const afterUndoSort = await getColumnValuesAsync(table, 0);
                expect(afterUndoSort).toEqual(['2', '10', '1']);

                // 重要: name列も元のCSV順序で元の値が維持されていること
                // id=2→beta, id=10→alpha, id=1→gamma
                const afterUndoSortNames = await getColumnValuesAsync(table, 1);
                expect(afterUndoSortNames).toEqual(['beta', 'alpha', 'gamma']);
            },
        );

        test(
            'ソート→セル編集→ソートUndo→セル編集Redoで正しいセルに適用される',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');

                // 元の順序: id=[2, 10, 1], name=[beta, alpha, gamma]
                // id列を昇順ソート → id=[1, 2, 10], name=[gamma, beta, alpha]
                await clickSortIndicatorAsync(table, 0);

                // ソート後の1行目（id=1）の name を "EDITED" に変更
                await editCellAsync(table, page, 1, 1, 'EDITED');

                // Ctrl+Z でセル編集をUndo
                await page.keyboard.press('Control+z');
                // Ctrl+Z でソートをUndo → 元の順序
                await page.keyboard.press('Control+z');

                const afterUndoAll = await getColumnValuesAsync(table, 1);
                expect(afterUndoAll).toEqual(['beta', 'alpha', 'gamma']);

                // Ctrl+Y でソートをRedo → id昇順
                await page.keyboard.press('Control+y');
                // Ctrl+Y でセル編集をRedo → id=1の name が "EDITED" になるべき
                await page.keyboard.press('Control+y');

                const afterRedoAll = await getColumnValuesAsync(table, 1);
                // id=1 の name が "EDITED" であること（1行目）
                // id=2 の name は "beta"（2行目）
                // id=10 の name は "alpha"（3行目）
                expect(afterRedoAll).toEqual(['EDITED', 'beta', 'alpha']);
            },
        );
    });

    // =========================================================================
    // Dirty 状態の正確性
    // =========================================================================

    test.describe('Dirty状態', () => {
        test('ソートだけの操作ではdirtyにならない', async ({ page }) => {
            const table = await openTableAsync(page, 'item');

            // ソート前はclean
            const beforeSort = await isTabDirtyAsync(page, 'item');
            expect(beforeSort).toBe(false);

            // ソートしてもデータは変わっていないのでcleanのまま
            await clickSortIndicatorAsync(table, 0);
            const afterSort = await isTabDirtyAsync(page, 'item');
            expect(afterSort).toBe(false);
        });

        test('フィルタだけの操作ではdirtyにならない', async ({ page }) => {
            const table = await openTableAsync(page, 'item');

            // フィルタ前はclean
            const beforeFilter = await isTabDirtyAsync(page, 'item');
            expect(beforeFilter).toBe(false);

            // name列でフィルタ適用（alphaのみ表示）
            await clickFilterIconAsync(table, 1);
            await setFilterItemCheckedAsync(page, 'beta', false);
            await setFilterItemCheckedAsync(page, 'gamma', false);
            await applyFilterAsync(page);

            // フィルタはView変換のみなのでcleanのまま
            const afterFilter = await isTabDirtyAsync(page, 'item');
            expect(afterFilter).toBe(false);
        });

        test('セル編集後にソートUndoしてもdirty状態が維持される', async ({ page }) => {
            const table = await openTableAsync(page, 'item');

            // セルを編集 → dirty
            await editCellAsync(table, page, 1, 1, 'EDITED');
            const afterEdit = await isTabDirtyAsync(page, 'item');
            expect(afterEdit).toBe(true);

            // ソート → まだdirty（セル編集がUndoされていないため）
            await clickSortIndicatorAsync(table, 0);
            const afterSort = await isTabDirtyAsync(page, 'item');
            expect(afterSort).toBe(true);

            // ソートUndo → まだdirty（セル編集がUndoされていないため）
            await page.keyboard.press('Control+z');
            const afterSortUndo = await isTabDirtyAsync(page, 'item');
            expect(afterSortUndo).toBe(true);

            // セル編集Undo → clean
            await page.keyboard.press('Control+z');
            const afterAllUndo = await isTabDirtyAsync(page, 'item');
            expect(afterAllUndo).toBe(false);
        });
    });

    // =========================================================================
    // フィルタ Undo/Redo
    // =========================================================================

    test.describe('フィルタの Undo/Redo', () => {
        test('フィルタをUndoすると全行が再表示される', async ({ page }) => {
            const table = await openTableAsync(page, 'item');

            // 全行表示: 3行
            const allNames = await getVisibleColumnValuesAsync(table, 1);
            expect(allNames).toEqual(['beta', 'alpha', 'gamma']);

            // name列でフィルタ適用（alphaのみ表示）
            await clickFilterIconAsync(table, 1);
            await setFilterItemCheckedAsync(page, 'beta', false);
            await setFilterItemCheckedAsync(page, 'gamma', false);
            await applyFilterAsync(page);

            const filteredNames = await getVisibleColumnValuesAsync(table, 1);
            expect(filteredNames).toEqual(['alpha']);

            // Ctrl+Z でフィルタをUndo → 全行再表示
            await page.keyboard.press('Control+z');
            const undoneNames = await getVisibleColumnValuesAsync(table, 1);
            expect(undoneNames).toEqual(['beta', 'alpha', 'gamma']);
        });

        test('フィルタをRedoすると再びフィルタ状態になる', async ({ page }) => {
            const table = await openTableAsync(page, 'item');

            // name列でフィルタ適用（alphaのみ表示）
            await clickFilterIconAsync(table, 1);
            await setFilterItemCheckedAsync(page, 'beta', false);
            await setFilterItemCheckedAsync(page, 'gamma', false);
            await applyFilterAsync(page);

            // Undo
            await page.keyboard.press('Control+z');
            const undoneNames = await getVisibleColumnValuesAsync(table, 1);
            expect(undoneNames).toEqual(['beta', 'alpha', 'gamma']);

            // Ctrl+Y でRedo → alphaのみ表示
            await page.keyboard.press('Control+y');
            const redoneNames = await getVisibleColumnValuesAsync(table, 1);
            expect(redoneNames).toEqual(['alpha']);
        });
    });
});
