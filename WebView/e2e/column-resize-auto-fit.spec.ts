import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// 列幅自動調整機能のE2Eテスト（RED状態）
//
// 対象機能:
//   1. リサイズハンドルのダブルクリックでセル内容に合わせた幅を自動計算して適用
//   2. 複数列選択時のD&Dリサイズで選択中の全列に同一幅を一括適用
//   3. 複数列選択時のダブルクリックで各列それぞれのセル内容に合わせた幅を適用
//   4. 上記操作すべてでUndo/Redo対応
//
// 現状の未実装:
//   - AreaResizer に dblclick イベントハンドラが存在しない
//   - 初期列幅計算はセル内容・参照ヒント未考慮のため、自動フィットで追加計測する必要がある
//   - D&Dリサイズが複数列選択状態を考慮しない（1列のみ変更）
// =============================================================================

/** テーブルを開いてEditorTable Locatorを返す */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    await page.locator('#explorer').getByText(tableName, { exact: true }).click();
    const table = page.locator(
        '.tab-wrapper:not([style*="display: none"]) .editor-table',
    );
    await expect(table).toBeVisible();
    return table;
}

/**
 * 列インデックス（0始まり、コーナーセルを除く）の列ヘッダーセルを返す
 */
function getColumnHeader(table: Locator, colIndex: number): Locator {
    return table
        .locator('.editor-table-column-header-row .editor-table-column-header')
        .nth(colIndex);
}

/**
 * 列ヘッダーセルの幅をpx数値で取得する
 */
async function getColumnWidthPxAsync(table: Locator, colIndex: number): Promise<number> {
    const widthStr = await getColumnHeader(table, colIndex).evaluate(
        (el: Element) => getComputedStyle(el).width,
    );
    return parseFloat(widthStr);
}

/**
 * 列ヘッダー内のリサイズハンドルを返す
 */
function getResizeHandle(table: Locator, colIndex: number): Locator {
    return getColumnHeader(table, colIndex).locator('.column-resize-handle').first();
}

/**
 * 列ヘッダーをクリックして列を選択する（通常クリック）
 */
async function selectColumnAsync(table: Locator, colIndex: number): Promise<void> {
    await getColumnHeader(table, colIndex).click();
}

/**
 * 列ヘッダーをCtrl+クリックして複数列選択に追加する
 */
async function addColumnToSelectionAsync(table: Locator, colIndex: number): Promise<void> {
    await getColumnHeader(table, colIndex).click({ modifiers: ['Control'] });
}

// =============================================================================
// テストデータ定義
// =============================================================================

/**
 * シンプルな3列テーブル
 * name列に長めのデータを入れて自動幅調整の効果が出るようにする
 */
function createSimpleFileSystem(): MockFileSystem {
    return {
        "schema/item.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                { key: 2, name: "value", type: "int" },
            ],
            primary_key: ["id"],
        }),
        // name列に長い文字列を意図的に入れる
        "data/item.csv": [
            "id,name,value",
            "1,very_long_item_name_exceeding_default_width,100",
            "2,another_long_name_here,200",
            "3,short,300",
        ].join("\n"),
    };
}

/**
 * FK参照ヒント（.cell-reference-hint）を持つテーブル
 * quest の enemy_id が enemy.ja を参照する
 * enemy.ja に長い表示名を入れてヒント幅が考慮されることを検証する
 */
function createFkReferenceFileSystem(): MockFileSystem {
    return {
        "schema/enemy.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "ja", type: "string" },
            ],
            primary_key: ["id"],
        }),
        "data/enemy.csv": [
            "id,ja",
            "1,スライム",
            "2,超強力なレッドドラゴン（エリート）",
            "3,ゴブリン",
        ].join("\n"),
        "schema/quest.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                { key: 2, name: "enemy_id", type: "int", reference: "enemy.ja" },
            ],
            primary_key: ["id"],
        }),
        "data/quest.csv": [
            "id,name,enemy_id",
            "1,first_quest,1",
            "2,second_quest,2",
            "3,third_quest,3",
        ].join("\n"),
    };
}

// =============================================================================
// テスト本体
// =============================================================================

test.describe('列幅自動調整機能', () => {
    // -------------------------------------------------------------------------
    // テスト1: 単列ダブルクリック自動幅調整
    // -------------------------------------------------------------------------
    test.describe('単列ダブルクリック自動幅調整', () => {
        test.beforeEach(async ({ page }) => {
            await installMockApiAsync(page, createSimpleFileSystem());
            await page.goto('/');
        });

        test(
            'リサイズハンドルをダブルクリックするとセルデータに合わせた幅になること',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');

                // name列（colIndex=1）の初期幅を取得
                const widthBefore = await getColumnWidthPxAsync(table, 1);

                // name列のリサイズハンドルをダブルクリック
                const handle = getResizeHandle(table, 1);
                await expect(handle).toBeAttached();
                await handle.dblclick();

                // ダブルクリック後に幅が初期値から変わること
                // （long name をすべて収められる幅に自動調整されるため）
                const widthAfter = await getColumnWidthPxAsync(table, 1);
                expect(widthAfter).not.toBe(widthBefore);

                // "very_long_item_name_exceeding_default_width" の長さから
                // 初期値より大幅に広くなることを期待する（最低でも初期幅より広い）
                expect(widthAfter).toBeGreaterThan(widthBefore);
            },
        );

        test(
            '自動幅は最小幅(50px)以上になること',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');

                // id列（colIndex=0）は値が短い（1桁数値）
                const handle = getResizeHandle(table, 0);
                await handle.dblclick();

                const widthAfter = await getColumnWidthPxAsync(table, 0);
                // MIN_COLUMN_WIDTH_PX = 50px 以上であること
                expect(widthAfter).toBeGreaterThanOrEqual(50);
            },
        );
    });

    // -------------------------------------------------------------------------
    // テスト2: ダブルクリック自動幅調整で参照ヒントを含む
    // -------------------------------------------------------------------------
    test.describe('参照ヒントを含む自動幅調整', () => {
        test.beforeEach(async ({ page }) => {
            await installMockApiAsync(page, createFkReferenceFileSystem());
            await page.goto('/');
        });

        test(
            'FK参照列のリサイズハンドルをダブルクリックすると参照ヒント含む幅になること',
            async ({ page }) => {
                const table = await openTableAsync(page, 'quest');

                // 参照ヒントが表示されるまで待機する（非同期プリロード）
                // enemy_id 列（colIndex=2）に .cell-reference-hint が出るまで待つ
                const firstHint = table
                    .locator('.editor-table-row')
                    .nth(1)
                    .locator('.editor-table-cell:not(.editor-table-row-header)')
                    .nth(2)
                    .locator('.cell-reference-hint');
                await expect(firstHint).toBeVisible();

                // enemy_id列（colIndex=2）の初期幅を取得
                const widthBefore = await getColumnWidthPxAsync(table, 2);

                // enemy_id列のリサイズハンドルをダブルクリック
                const handle = getResizeHandle(table, 2);
                await handle.dblclick();

                // "超強力なレッドドラゴン（エリート）" という長い参照ヒントを含む幅になること
                const widthAfter = await getColumnWidthPxAsync(table, 2);

                // 参照ヒント「超強力なレッドドラゴン（エリート）」のテキスト幅を取得して比較
                const hintWidth = await firstHint.evaluate((el: Element) => {
                    // 最も長い参照ヒントを含むセルの幅を確認する
                    // 行2（0始まり）が「超強力なレッドドラゴン（エリート）」に対応（enemy_id=2）
                    const allHints = document.querySelectorAll('.cell-reference-hint');
                    let maxWidth = 0;
                    allHints.forEach(hint => {
                        const w = hint.getBoundingClientRect().width;
                        if (w > maxWidth) maxWidth = w;
                    });
                    return maxWidth;
                });

                // 自動調整後の列幅が最長参照ヒント幅より大きいこと
                expect(widthAfter).toBeGreaterThan(hintWidth);
                // 初期幅から変化していること
                expect(widthAfter).not.toBe(widthBefore);
            },
        );
    });

    // -------------------------------------------------------------------------
    // テスト3: 複数列選択時のD&Dリサイズで一括適用
    // -------------------------------------------------------------------------
    test.describe('複数列選択時のD&Dリサイズ一括適用', () => {
        test.beforeEach(async ({ page }) => {
            await installMockApiAsync(page, createSimpleFileSystem());
            await page.goto('/');
        });

        test(
            '複数列選択時にD&Dリサイズすると選択中の全列に同じ幅が適用されること',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');

                // 列0（id）と列1（name）を選択（Ctrl+クリックで複数選択）
                await selectColumnAsync(table, 0);
                await addColumnToSelectionAsync(table, 1);

                // 列1の初期幅を取得（変化したことの確認に使う）
                const col1WidthBefore = await getColumnWidthPxAsync(table, 1);

                // 列1のリサイズハンドルをD&Dで拡張（+80px）
                const header1 = getColumnHeader(table, 1);
                const headerBox = await header1.boundingBox();
                if (!headerBox) throw new Error('列1ヘッダーの boundingBox が取得できません');

                // リサイズハンドルの中央位置（列右端付近）でmousedown
                const startX = headerBox.x + headerBox.width - 2;
                const startY = headerBox.y + headerBox.height / 2;
                await page.mouse.move(startX, startY);
                await page.mouse.down();
                await page.mouse.move(startX + 80, startY);
                await page.mouse.up();

                const col0WidthAfter = await getColumnWidthPxAsync(table, 0);
                const col1WidthAfter = await getColumnWidthPxAsync(table, 1);

                // D&Dでリサイズした列1の幅が変化していること
                expect(col1WidthAfter).not.toBe(col1WidthBefore);

                // 選択中の列0にも同じ幅が適用されること（一括適用）
                expect(col0WidthAfter).toBe(col1WidthAfter);
            },
        );

        test(
            '複数列選択時のD&Dリサイズで選択外の列は幅が変わらないこと',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');

                // 列0（id）と列1（name）を選択
                await selectColumnAsync(table, 0);
                await addColumnToSelectionAsync(table, 1);

                // 列2（value）の初期幅を取得（選択外の列）
                const col2WidthBefore = await getColumnWidthPxAsync(table, 2);

                // 列1のリサイズハンドルをD&Dでリサイズ
                const header1 = getColumnHeader(table, 1);
                const headerBox = await header1.boundingBox();
                if (!headerBox) throw new Error('列1ヘッダーの boundingBox が取得できません');

                const startX = headerBox.x + headerBox.width - 2;
                const startY = headerBox.y + headerBox.height / 2;
                await page.mouse.move(startX, startY);
                await page.mouse.down();
                await page.mouse.move(startX + 80, startY);
                await page.mouse.up();

                // 選択外の列2の幅は変化しないこと
                const col2WidthAfter = await getColumnWidthPxAsync(table, 2);
                expect(col2WidthAfter).toBe(col2WidthBefore);
            },
        );
    });

    // -------------------------------------------------------------------------
    // テスト4: 複数列選択時のダブルクリックで各列個別に自動調整
    // -------------------------------------------------------------------------
    test.describe('複数列選択時のダブルクリック個別自動調整', () => {
        test.beforeEach(async ({ page }) => {
            await installMockApiAsync(page, createSimpleFileSystem());
            await page.goto('/');
        });

        test(
            '複数列選択時にダブルクリックすると各列それぞれのデータ幅に調整されること',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');

                // 列0（id: 短い値）と列1（name: 長い値）を選択
                await selectColumnAsync(table, 0);
                await addColumnToSelectionAsync(table, 1);

                // 列1のリサイズハンドルをダブルクリック
                const handle = getResizeHandle(table, 1);
                await handle.dblclick();

                const col0WidthAfter = await getColumnWidthPxAsync(table, 0);
                const col1WidthAfter = await getColumnWidthPxAsync(table, 1);

                // 両列ともに幅が変化すること（各列のデータに合わせた調整）
                // 列1（長いname）は列0（短いid）より幅が広いこと（個別調整の証拠）
                expect(col1WidthAfter).toBeGreaterThan(col0WidthAfter);
            },
        );

        test(
            '複数列選択時のダブルクリックで選択外の列は変化しないこと',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');

                // 列0と列1を選択
                await selectColumnAsync(table, 0);
                await addColumnToSelectionAsync(table, 1);

                // 列2（value）の初期幅を取得（選択外の列）
                const col2WidthBefore = await getColumnWidthPxAsync(table, 2);

                // 列1のリサイズハンドルをダブルクリック
                const handle = getResizeHandle(table, 1);
                await handle.dblclick();

                // 選択外の列2の幅は変化しないこと
                const col2WidthAfter = await getColumnWidthPxAsync(table, 2);
                expect(col2WidthAfter).toBe(col2WidthBefore);
            },
        );
    });

    // -------------------------------------------------------------------------
    // テスト5: ダブルクリック自動幅調整のUndo/Redo
    // -------------------------------------------------------------------------
    test.describe('ダブルクリック自動幅調整のUndo/Redo', () => {
        test.beforeEach(async ({ page }) => {
            await installMockApiAsync(page, createSimpleFileSystem());
            await page.goto('/');
        });

        test(
            'ダブルクリックで自動調整後にCtrl+Zで元の幅に戻ること',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');

                // テーブルにフォーカスを当てるためにセルをクリックしておく
                // （Ctrl+Z がキーボードショートカットとして受け付けられるようにするため）
                await table.locator('.editor-table-cell').first().click();

                // name列（colIndex=1）の自動幅調整前の幅を記録
                const widthBefore = await getColumnWidthPxAsync(table, 1);

                // name列のリサイズハンドルをダブルクリック
                const handle = getResizeHandle(table, 1);
                await handle.dblclick();

                // 幅が変化したことを確認（自動調整が実行された）
                const widthAfterAutoFit = await getColumnWidthPxAsync(table, 1);
                expect(widthAfterAutoFit).not.toBe(widthBefore);

                // Ctrl+Z でUndo
                await page.keyboard.press('Control+z');

                // 元の幅に戻ること
                const widthAfterUndo = await getColumnWidthPxAsync(table, 1);
                expect(widthAfterUndo).toBe(widthBefore);
            },
        );

        test(
            'Ctrl+ZでUndo後にCtrl+Yで自動調整幅が再適用されること',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');

                // テーブルにフォーカスを当てる
                await table.locator('.editor-table-cell').first().click();

                // name列のリサイズハンドルをダブルクリック
                const handle = getResizeHandle(table, 1);
                await handle.dblclick();

                // 自動調整後の幅を記録
                const widthAfterAutoFit = await getColumnWidthPxAsync(table, 1);

                // Ctrl+Z でUndo
                await page.keyboard.press('Control+z');

                // Ctrl+Y でRedo
                await page.keyboard.press('Control+y');

                // 自動調整後の幅に戻ること
                const widthAfterRedo = await getColumnWidthPxAsync(table, 1);
                expect(widthAfterRedo).toBe(widthAfterAutoFit);
            },
        );
    });

    // -------------------------------------------------------------------------
    // テスト6: 複数列一括リサイズのUndo/Redo
    // -------------------------------------------------------------------------
    test.describe('複数列一括リサイズのUndo/Redo', () => {
        test.beforeEach(async ({ page }) => {
            await installMockApiAsync(page, createSimpleFileSystem());
            await page.goto('/');
        });

        test(
            '複数列D&DリサイズをCtrl+Z 1回で全列が元の幅に戻ること',
            async ({ page }) => {
                const table = await openTableAsync(page, 'item');

                // テーブルにフォーカスを当てる
                await table.locator('.editor-table-cell').first().click();

                // 列0と列1を選択
                await selectColumnAsync(table, 0);
                await addColumnToSelectionAsync(table, 1);

                // 列0と列1の初期幅を記録
                const col0WidthBefore = await getColumnWidthPxAsync(table, 0);
                const col1WidthBefore = await getColumnWidthPxAsync(table, 1);

                // 列1のリサイズハンドルをD&Dでリサイズ
                const header1 = getColumnHeader(table, 1);
                const headerBox = await header1.boundingBox();
                if (!headerBox) throw new Error('列1ヘッダーの boundingBox が取得できません');

                const startX = headerBox.x + headerBox.width - 2;
                const startY = headerBox.y + headerBox.height / 2;
                await page.mouse.move(startX, startY);
                await page.mouse.down();
                await page.mouse.move(startX + 80, startY);
                await page.mouse.up();

                // 一括リサイズが実行されたことを確認
                const col0WidthAfterResize = await getColumnWidthPxAsync(table, 0);
                const col1WidthAfterResize = await getColumnWidthPxAsync(table, 1);
                expect(col0WidthAfterResize).toBe(col1WidthAfterResize);

                // Ctrl+Z 1回で全列（col0, col1）が元の幅に戻ること
                await page.keyboard.press('Control+z');

                const col0WidthAfterUndo = await getColumnWidthPxAsync(table, 0);
                const col1WidthAfterUndo = await getColumnWidthPxAsync(table, 1);

                // Ctrl+Z 1回でどちらの列も元に戻ること
                // （複数列まとめて1つのCommandとしてUndo対象となること）
                expect(col0WidthAfterUndo).toBe(col0WidthBefore);
                expect(col1WidthAfterUndo).toBe(col1WidthBefore);
            },
        );
    });
});
