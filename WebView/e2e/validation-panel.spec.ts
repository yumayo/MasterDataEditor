import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// バリデーションエラーパネル機能のテスト
//
// 機能概要:
//   画面下段にバリデーションエラーをリアルタイムで一覧表示するパネルと、
//   エラー件数を常時表示するステータスバーバッジを提供する。
//
// 検出するエラー種別:
//   1. PK重複: 同一テーブル内で主キー値が重複
//   2. FK参照切れ: 外部キー参照先テーブルに該当する値が存在しない
//
// テストケース一覧:
//   PK重複関連:
//     1. PK重複エラーが検出されると、バリデーションパネルにエラーが表示される
//     2. PK重複エラーをクリックすると該当セルにジャンプする
//     3. PK重複を解消するとエラーがパネルから消える
//   FK参照切れ関連:
//     4. FK参照先に存在しない値を入力すると、バリデーションパネルにエラーが表示される
//     5. FK参照切れエラーをクリックすると該当セルにジャンプする
//     6. 有効なFK値に修正するとエラーがパネルから消える
//   ステータスバー関連:
//     7. エラーがある場合、ステータスバーにエラー件数が表示される
//     8. ステータスバーのバッジクリックでパネルの表示/非表示がトグルされる
//     9. エラーが0件になるとバッジの件数が0になる
//   エラーセル視覚化:
//    10. PK重複セルの背景が赤く、枠も赤くなる
//    11. FK参照切れセルの背景が赤く、枠も赤くなる
// =============================================================================

// =============================================================================
// フィクスチャ生成ヘルパー
// =============================================================================

/**
 * PK重複テスト用のファイルシステムを生成する
 * id列をPK、初期データは id=1,2,3 の一意な行
 */
function createPkFileSystem(): MockFileSystem {
    return {
        "schema/product.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
            ],
            primary_key: "id",
        }),
        "data/product.csv": [
            "id,name",
            "1,sword",
            "2,shield",
            "3,potion",
        ].join("\n"),
    };
}

/**
 * FK参照切れテスト用のファイルシステムを生成する
 *
 * category テーブル: id=1（weapon）, id=2（armor）
 * product テーブル: category_id が category.id を参照する
 * 初期データはすべて有効な FK 値（category_id=1 または =2）を持つ
 */
function createFkFileSystem(): MockFileSystem {
    return {
        "schema/category.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
            ],
            primary_key: "id",
        }),
        "data/category.csv": [
            "id,name",
            "1,weapon",
            "2,armor",
        ].join("\n"),
        "schema/product.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "category_id", type: "int", reference: "category.id" },
                { key: 2, name: "name", type: "string" },
            ],
            primary_key: "id",
        }),
        "data/product.csv": [
            "id,category_id,name",
            "1,1,sword",
            "2,2,shield",
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
 * 指定行・列のデータセルをダブルクリックして新しい値を入力しEnterで確定する
 * rowIndex: 0始まり（ヘッダー行を除く）、colIndex: 0始まり（行ヘッダーを除く）
 */
async function editCellAsync(
    table: Locator,
    page: Page,
    rowIndex: number,
    colIndex: number,
    newValue: string,
): Promise<void> {
    // ヘッダー行（nth(0)）を除いてデータ行を取得する
    const row = table.locator('.editor-table-row').nth(rowIndex + 1);
    const cell = row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
    await expect(cell).toBeVisible();
    await cell.dblclick();

    const editField = page.locator('.grid-textfield-active');
    await expect(editField).toBeVisible();
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText(newValue);
    await page.keyboard.press('Enter');
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
 * 指定行・列のデータセルを返す
 * rowIndex: 0始まり、colIndex: 0始まり（行ヘッダーを除く）
 */
function getDataCell(table: Locator, rowIndex: number, colIndex: number): Locator {
    const row = table.locator('.editor-table-row').nth(rowIndex + 1);
    return row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
}

/**
 * バリデーションパネルのエラーアイテムを返す
 * テキストで絞り込む場合は hasText オプションで指定する
 */
function getValidationPanelItems(page: Page): Locator {
    return page.locator('.validation-panel .validation-panel-item');
}

/**
 * ステータスバーのエラーバッジを返す
 */
function getStatusBarBadge(page: Page): Locator {
    return page.locator('.status-bar-badge');
}

// =============================================================================
// テストケース1: PK重複エラーが検出されると、バリデーションパネルにエラーが表示される
// =============================================================================

test.describe('テストケース1: PK重複エラーが検出されると、バリデーションパネルにエラーが表示される', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createPkFileSystem());
        await page.goto('/');
    });

    test(
        'PK値を重複させると、バリデーションパネルに product テーブルのPK重複エラーが表示される',
        async ({ page }) => {
            const table = await openTableAsync(page, 'product');

            // 初期状態: パネルにエラーがないことを確認する
            await expect(getValidationPanelItems(page)).toHaveCount(0);

            // 2行目の id を 1行目と同じ "1" に変更してPK重複を発生させる
            await editCellAsync(table, page, 1, 0, '1');

            // バリデーションパネルに product テーブルのPK重複エラーが表示される
            // エラーアイテムは「テーブル名 > 列名 > エラー内容」の形式で表示される想定
            const items = getValidationPanelItems(page);
            await expect(items).not.toHaveCount(0);

            // product テーブルのPK重複エラーが少なくとも1件表示される
            const pkDuplicateItem = page.locator('.validation-panel .validation-panel-item').filter({
                hasText: 'product',
            });
            await expect(pkDuplicateItem.first()).toBeVisible();
        },
    );
});

// =============================================================================
// テストケース2: PK重複エラーをクリックすると該当セルにジャンプする
// =============================================================================

test.describe('テストケース2: PK重複エラーをクリックすると該当セルにジャンプする', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createPkFileSystem());
        await page.goto('/');
    });

    test(
        'バリデーションパネルのPK重複エラーをクリックすると、該当セルがフォーカスされる',
        async ({ page }) => {
            const table = await openTableAsync(page, 'product');

            // PK重複を発生させる
            await editCellAsync(table, page, 1, 0, '1');

            // バリデーションパネルのエラーアイテムをクリックする
            const items = getValidationPanelItems(page);
            await expect(items.first()).toBeVisible();
            await items.first().click();

            // クリック後、該当セルがフォーカス（アクティブ）状態になる
            // フォーカスされたセルは .editor-table-cell-focused クラスを持つ想定
            const focusedCell = table.locator('.editor-table-cell-focused');
            await expect(focusedCell).toBeVisible();
        },
    );
});

// =============================================================================
// テストケース3: PK重複を解消するとエラーがパネルから消える
// =============================================================================

test.describe('テストケース3: PK重複を解消するとエラーがパネルから消える', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createPkFileSystem());
        await page.goto('/');
    });

    test(
        'PK重複を解消する値に変更すると、バリデーションパネルのエラーが消える',
        async ({ page }) => {
            const table = await openTableAsync(page, 'product');

            // PK重複を発生させてパネルにエラーが出ることを確認する
            await editCellAsync(table, page, 1, 0, '1');
            await expect(getValidationPanelItems(page)).not.toHaveCount(0);

            // 重複を解消する値（=99）に変更する
            await editCellAsync(table, page, 1, 0, '99');

            // パネルからエラーが消えることを確認する
            await expect(getValidationPanelItems(page)).toHaveCount(0);
        },
    );
});

// =============================================================================
// テストケース4: FK参照先に存在しない値を入力すると、バリデーションパネルにエラーが表示される
// =============================================================================

test.describe('テストケース4: FK参照先に存在しない値を入力すると、バリデーションパネルにエラーが表示される', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createFkFileSystem());
        await page.goto('/');
    });

    test(
        'category.id に存在しない値を category_id 列に入力すると、バリデーションパネルにFKエラーが表示される',
        async ({ page }) => {
            const table = await openTableAsync(page, 'product');

            // 初期状態: FK参照エラーがないことを確認する
            await expect(getValidationPanelItems(page)).toHaveCount(0);

            // category.id に存在しない値 "999" を category_id 列（colIndex=1）に入力する
            await editCellAsync(table, page, 0, 1, '999');

            // バリデーションパネルに product テーブルのFK参照切れエラーが表示される
            const items = getValidationPanelItems(page);
            await expect(items).not.toHaveCount(0);

            const fkErrorItem = page.locator('.validation-panel .validation-panel-item').filter({
                hasText: 'product',
            });
            await expect(fkErrorItem.first()).toBeVisible();
        },
    );
});

// =============================================================================
// テストケース5: FK参照切れエラーをクリックすると該当セルにジャンプする
// =============================================================================

test.describe('テストケース5: FK参照切れエラーをクリックすると該当セルにジャンプする', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createFkFileSystem());
        await page.goto('/');
    });

    test(
        'バリデーションパネルのFK参照切れエラーをクリックすると、該当セルがフォーカスされる',
        async ({ page }) => {
            const table = await openTableAsync(page, 'product');

            // FK参照切れを発生させる（category_id に存在しない値 "999" を入力）
            await editCellAsync(table, page, 0, 1, '999');

            // バリデーションパネルのエラーアイテムをクリックする
            const items = getValidationPanelItems(page);
            await expect(items.first()).toBeVisible();
            await items.first().click();

            // クリック後、product テーブルタブがアクティブで該当セルがフォーカスされる
            const focusedCell = table.locator('.editor-table-cell-focused');
            await expect(focusedCell).toBeVisible();
        },
    );
});

// =============================================================================
// テストケース6: 有効なFK値に修正するとエラーがパネルから消える
// =============================================================================

test.describe('テストケース6: 有効なFK値に修正するとエラーがパネルから消える', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createFkFileSystem());
        await page.goto('/');
    });

    test(
        'FK参照切れを有効な値に修正すると、バリデーションパネルのエラーが消える',
        async ({ page }) => {
            const table = await openTableAsync(page, 'product');

            // FK参照切れを発生させる
            await editCellAsync(table, page, 0, 1, '999');
            await expect(getValidationPanelItems(page)).not.toHaveCount(0);

            // 有効な FK 値（category.id=2 が存在する）に修正する
            await editCellAsync(table, page, 0, 1, '2');

            // パネルからエラーが消えることを確認する
            await expect(getValidationPanelItems(page)).toHaveCount(0);
        },
    );
});

// =============================================================================
// テストケース7: エラーがある場合、ステータスバーにエラー件数が表示される
// =============================================================================

test.describe('テストケース7: エラーがある場合、ステータスバーにエラー件数が表示される', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createPkFileSystem());
        await page.goto('/');
    });

    test(
        'エラーなしの初期状態ではバッジが "0" を表示し、PK重複後は "2" 以上を表示する',
        async ({ page }) => {
            const table = await openTableAsync(page, 'product');
            const badge = getStatusBarBadge(page);

            // ステータスバーが画面最下部に存在する
            await expect(badge).toBeVisible();

            // 初期状態: エラー件数は 0
            await expect(badge).toHaveText('0');

            // PK重複を2件（同一値で2行）発生させる
            // 2行目を1行目と同じ id=1 にすると2つのセルがエラー対象になる
            await editCellAsync(table, page, 1, 0, '1');

            // エラー件数が 1 以上になることを確認する（PK重複は2セルで2件）
            const badgeText = await badge.textContent();
            const count = parseInt(badgeText ?? '0', 10);
            expect(count).toBeGreaterThanOrEqual(1);
        },
    );
});

// =============================================================================
// テストケース8: ステータスバーのバッジクリックでパネルの表示/非表示がトグルされる
// =============================================================================

test.describe('テストケース8: ステータスバーのバッジクリックでパネルの表示/非表示がトグルされる', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createPkFileSystem());
        await page.goto('/');
    });

    test(
        'バッジを1回クリックするとパネルが表示され、2回目クリックで非表示になる',
        async ({ page }) => {
            const badge = getStatusBarBadge(page);
            const panel = page.locator('.validation-panel');

            // 初期状態: パネルは非表示
            await expect(panel).not.toBeVisible();

            // 1回クリック: パネルが表示される
            await badge.click();
            await expect(panel).toBeVisible();

            // 2回クリック: パネルが非表示になる
            await badge.click();
            await expect(panel).not.toBeVisible();
        },
    );
});

// =============================================================================
// テストケース9: エラーが0件になるとバッジの件数が0になる
// =============================================================================

test.describe('テストケース9: エラーが0件になるとバッジの件数が0になる', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createPkFileSystem());
        await page.goto('/');
    });

    test(
        'PK重複を解消するとステータスバーのバッジが "0" に戻る',
        async ({ page }) => {
            const table = await openTableAsync(page, 'product');
            const badge = getStatusBarBadge(page);

            // PK重複を発生させてエラー件数が増えることを確認する
            await editCellAsync(table, page, 1, 0, '1');
            const badgeText = await badge.textContent();
            const count = parseInt(badgeText ?? '0', 10);
            expect(count).toBeGreaterThanOrEqual(1);

            // 重複を解消する
            await editCellAsync(table, page, 1, 0, '99');

            // バッジが "0" に戻ることを確認する
            await expect(badge).toHaveText('0');
        },
    );
});

// =============================================================================
// テストケース10: PK重複セルの背景が赤く、枠も赤くなる
// =============================================================================

test.describe('テストケース10: PK重複セルの背景が赤く、枠も赤くなる', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createPkFileSystem());
        await page.goto('/');
    });

    test(
        'PK重複が発生したセルに cell-error クラスが付与され、背景色・枠色が赤になる',
        async ({ page }) => {
            const table = await openTableAsync(page, 'product');

            // PK重複を発生させる
            await editCellAsync(table, page, 1, 0, '1');

            // 1行目と2行目のPKセルに cell-error クラスが付与される
            // cell-error は背景赤 + セル枠赤を表すCSSクラス（波線下線の cell-pk-duplicate より強い表示）
            const firstPkCell = getPkCell(table, 0);
            const secondPkCell = getPkCell(table, 1);
            await expect(firstPkCell).toHaveClass(/cell-error/);
            await expect(secondPkCell).toHaveClass(/cell-error/);

            // 背景色が実際に赤系であることをスタイルで確認する
            const bgColor = await firstPkCell.evaluate(el => getComputedStyle(el).backgroundColor);
            // 赤系の背景色が設定されている（rgb(255, ...) または rgba(255, ...)）
            expect(bgColor).toMatch(/rgb\(25[0-5]/);
        },
    );
});

// =============================================================================
// テストケース11: FK参照切れセルの背景が赤く、枠も赤くなる
// =============================================================================

test.describe('テストケース11: FK参照切れセルの背景が赤く、枠も赤くなる', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createFkFileSystem());
        await page.goto('/');
    });

    test(
        'FK参照切れが発生したセルに cell-error クラスが付与され、背景色・枠色が赤になる',
        async ({ page }) => {
            const table = await openTableAsync(page, 'product');

            // category.id に存在しない値を入力してFK参照切れを発生させる
            await editCellAsync(table, page, 0, 1, '999');

            // category_id 列（colIndex=1）のセルに cell-error クラスが付与される
            const fkCell = getDataCell(table, 0, 1);
            await expect(fkCell).toHaveClass(/cell-error/);

            // 背景色が赤系であることを確認する
            const bgColor = await fkCell.evaluate(el => getComputedStyle(el).backgroundColor);
            expect(bgColor).toMatch(/rgb\(25[0-5]/);
        },
    );
});

// =============================================================================
// テストケース12: FK参照先テーブルを閉じた後、FKエラーをクリックしてもエラーがパネルから消えない
// =============================================================================

test.describe('テストケース12: FK参照先テーブルを閉じた後、FKエラーをクリックしてもエラーがパネルから消えない', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createFkFileSystem());
        await page.goto('/');
    });

    test(
        'category タブを閉じた後にパネルの FK エラーをクリックしても、エラーがパネルから消えない',
        async ({ page }) => {
            // 1. FK参照元テーブル（product）を開く
            const productTable = await openTableAsync(page, 'product');

            // 2. FK参照先テーブル（category）を開く
            await openTableAsync(page, 'category');

            // productタブに戻る
            await openTableAsync(page, 'product');

            // 3. productのcategory_id列（colIndex=1）に存在しない値 "999" を入力してFKエラーを発生させる
            await editCellAsync(productTable, page, 0, 1, '999');

            // FKエラーがパネルに表示されていることを確認する
            const items = getValidationPanelItems(page);
            await expect(items).not.toHaveCount(0);
            const fkErrorItem = items.filter({ hasText: 'product' });
            await expect(fkErrorItem.first()).toBeVisible();

            // 4. category タブの閉じるボタンをクリックしてタブを閉じる
            //    これにより store.unregisterTable('category') が呼ばれ、categoryのデータがストアから消える
            const categoryTabButton = page.locator('.tab-button').filter({ hasText: 'category' }).first();
            await categoryTabButton.locator('.tab-button-close').click();

            // 5. パネルのFKエラー項目をクリックする
            //    クリックにより jumpToError() → switchToExistingTab('product') → reloadCellsFromStore()
            //    → runValidation() が呼ばれるが、category のデータがストアにないためFKチェックがスキップされる
            //    【不具合】: このタイミングでエラーが消えてしまう（currentErrors が [] にリセットされる）
            await fkErrorItem.first().click();

            // 6. アサーション: FKエラーがパネルに表示されたままであること
            //    reloadCellsFromStore() はDOMリロードのためエラークラスが消えるが、
            //    新しいバリデーション実行をせずに既存エラーをそのまま再適用すべき
            await expect(fkErrorItem.first()).toBeVisible();
        },
    );
});

// =============================================================================
// テストケース13: FK参照先テーブルを閉じた状態でセルを編集してもFKエラーが消えない
// =============================================================================

test.describe('テストケース13: FK参照先テーブルを閉じた状態でセルを編集してもFKエラーが消えない', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createFkFileSystem());
        await page.goto('/');
    });

    test(
        'category タブを閉じた状態で product の別セルを編集しても、FK エラーがパネルから消えない',
        async ({ page }) => {
            // 1. product と category を両方開く
            const productTable = await openTableAsync(page, 'product');
            await openTableAsync(page, 'category');
            await openTableAsync(page, 'product');

            // 2. productのcategory_id列（colIndex=1）に存在しない値 "999" を入力してFKエラーを発生させる
            await editCellAsync(productTable, page, 0, 1, '999');

            // FKエラーがパネルに表示されていることを確認する
            const items = getValidationPanelItems(page);
            await expect(items).not.toHaveCount(0);
            const fkErrorItem = items.filter({ hasText: 'product' });
            await expect(fkErrorItem.first()).toBeVisible();

            // 3. categoryタブを閉じる（ストアからcategoryデータが消える）
            const categoryTabButton = page.locator('.tab-button').filter({ hasText: 'category' }).first();
            await categoryTabButton.locator('.tab-button-close').click();

            // 4. productの別セル（name列 colIndex=2）を編集して確定する
            //    applyCellChanges → runAndUpdate() → engine.validate() が呼ばれるが、
            //    categoryがストアにないためFKチェックがスキップされる
            //    【修正前の不具合】: currentErrors が [] にリセットされFKエラーが消えていた
            await editCellAsync(productTable, page, 0, 2, 'super_sword');

            // 5. アサーション: FKエラーがパネルに表示されたままであること
            //    スキップされたFK列のエラーは前回currentErrorsから引き継がれるべき
            await expect(fkErrorItem.first()).toBeVisible();
        },
    );
});
