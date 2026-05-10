import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// ISSUE_0102: PROBLEMSパネルからジャンプ後にキー入力で入力状態にならない問題
//
// 不具合概要:
//   PROBLEMSパネルのエラー一覧からセルをクリックしてジャンプした後、
//   キーを押すとテキストフィールドは表示されるがフォーカスが当たらず
//   入力状態にならない。
//
// 修正内容:
//   validation-panel.ts の jumpToError() でジャンプ後に
//   handler.activate() を呼び出してフォーカスを再取得する。
//
// テストケース:
//   1. PROBLEMSパネルからFK参照切れセルにジャンプ後、キーを押すと
//      テキストフィールドが表示されフォーカスが当たっている
//   2. PROBLEMSパネルからPK重複セルにジャンプ後、キーを押すと
//      テキストフィールドが表示されフォーカスが当たっている
// =============================================================================

// =============================================================================
// フィクスチャ生成ヘルパー
// =============================================================================

/**
 * FK参照切れテスト用のファイルシステムを生成する
 *
 * category テーブル: id=1（weapon）, id=2（armor）
 * product テーブル: category_id が category.id を参照する
 * product の1行目は category_id=999（存在しない値）で初期状態からFK参照切れ
 */
function createFkFileSystem(): MockFileSystem {
    return {
        "schema/category.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
            ],
            primary_key: ["id"],
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
            primary_key: ["id"],
        }),
        // category_id=999 は category.id に存在しないためFK参照切れが発生する
        "data/product.csv": [
            "id,category_id,name",
            "1,999,broken_sword",
            "2,2,shield",
        ].join("\n"),
    };
}

function createLargeFkFileSystem(): MockFileSystem {
    const productRows = ['1,999,broken_sword'];
    for (let i = 2; i <= 240; i++) {
        productRows.push(`${i},2,item_${i}`);
    }
    return {
        ...createFkFileSystem(),
        "data/product.csv": [
            "id,category_id,name",
            ...productRows,
        ].join("\n"),
    };
}

/**
 * PK重複テスト用のファイルシステムを生成する
 * item テーブル: id=1 が2行あるため初期状態でPK重複が発生する
 */
function createPkDuplicateFileSystem(): MockFileSystem {
    return {
        "schema/item.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
            ],
            primary_key: ["id"],
        }),
        // id=1 が重複しているため初期状態でPK重複エラーが発生する
        "data/item.csv": [
            "id,name",
            "1,sword",
            "1,shield",
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
 * バリデーションパネルのエラーアイテムを返す
 */
function getValidationPanelItems(page: Page): Locator {
    return page.locator('.validation-panel .validation-panel-item');
}

/**
 * ステータスバーのバッジをクリックしてバリデーションパネルを開く
 */
async function openValidationPanelAsync(page: Page): Promise<void> {
    await page.locator('.status-bar-badge').click();
}

function getTableMainViewport(page: Page, tableName: string): Locator {
    return page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="${tableName}"] .editor-table-main-viewport`);
}

async function waitForAnimationFrames(page: Page, count: number): Promise<void> {
    await page.evaluate((frameCount) => new Promise<void>((resolve) => {
        let remaining = frameCount;
        const next = () => {
            remaining--;
            if (remaining <= 0) {
                resolve();
                return;
            }
            requestAnimationFrame(next);
        };
        requestAnimationFrame(next);
    }), count);
}

// =============================================================================
// テストケース1: FK参照切れセルへのジャンプ後にキー入力で入力状態になる
// =============================================================================

test.describe('ISSUE_0102: PROBLEMSパネルからジャンプ後のキー入力フォーカス', () => {
    test(
        'FK参照切れセルにジャンプ後、キーを押すとテキストフィールドが表示されフォーカスが当たる',
        async ({ page }) => {
            await installMockApiAsync(page, createFkFileSystem());
            await page.goto('/');

            // 1. category テーブルを開く（FK参照先テーブル）
            await openTableAsync(page, 'category');

            // 2. product テーブルを開く（FK参照元テーブル、初期データに category_id=999 でFK参照切れ）
            await openTableAsync(page, 'product');

            // 3. バリデーションパネルを開いてFK参照切れエラーが検出されていることを確認する
            await openValidationPanelAsync(page);
            const items = getValidationPanelItems(page);
            const productFkError = items.filter({ hasText: 'product' });
            await expect(productFkError.first()).toBeVisible();

            // 4. PROBLEMSパネルのエラー項目をクリックして該当セルにジャンプする
            //    jumpToError() が呼ばれ、setRange() + move() + activate() が実行される
            await productFkError.first().click();

            // 5. フォーカスセルが正しく設定されていることを確認する
            const productTable = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="product"] .editor-table`);
            const focusedCell = productTable.locator('.editor-table-cell-focused');
            await expect(focusedCell).toBeVisible();
            await expect(focusedCell).toHaveText('999');

            // 6. キーを押して入力を開始する
            //    修正前: フォーカスが validation-panel-item に残り、grid-textfield に届かない
            //    修正後: activate() によりフォーカスが grid-textfield に戻っているため入力状態になる
            await page.keyboard.press('a');

            // 7. テキストフィールドが表示されていることを検証する
            const editField = page.locator('.grid-textfield-active');
            await expect(editField).toBeVisible();

            // 8. テキストフィールドにブラウザフォーカスが当たっていることを検証する
            //    document.activeElement が grid-textfield の contenteditable 要素であること
            const hasFocus = await page.evaluate(() => {
                const active = document.activeElement;
                return active !== null && active.classList.contains('grid-textfield');
            });
            expect(hasFocus).toBe(true);

            // 9. 入力した文字がテキストフィールドに実際に反映されていることを検証する
            //    async完了後にshow()でtextContentがnullクリアされるバグを検出するためのアサーション
            await expect(editField).toHaveText('a');
        },
    );

    // =============================================================================
    // テストケース2: PK重複セルへのジャンプ後にキー入力で入力状態になる
    // =============================================================================

    test(
        'PK重複セルにジャンプ後、キーを押すとテキストフィールドが表示されフォーカスが当たる',
        async ({ page }) => {
            await installMockApiAsync(page, createPkDuplicateFileSystem());
            await page.goto('/');

            // 1. item テーブルを開く（id=1 が2行あるためPK重複エラーが発生する）
            await openTableAsync(page, 'item');

            // 2. バリデーションパネルを開いてPK重複エラーが検出されていることを確認する
            await openValidationPanelAsync(page);
            const items = getValidationPanelItems(page);
            const pkError = items.filter({ hasText: 'item' });
            await expect(pkError.first()).toBeVisible();

            // 3. PROBLEMSパネルのエラー項目をクリックして該当セルにジャンプする
            await pkError.first().click();

            // 4. フォーカスセルが正しく設定されていることを確認する
            const itemTable = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="item"] .editor-table`);
            const focusedCell = itemTable.locator('.editor-table-cell-focused');
            await expect(focusedCell).toBeVisible();

            // 5. キーを押して入力を開始する
            await page.keyboard.press('x');

            // 6. テキストフィールドが表示されていることを検証する
            const editField = page.locator('.grid-textfield-active');
            await expect(editField).toBeVisible();

            // 7. テキストフィールドにブラウザフォーカスが当たっていることを検証する
            const hasFocus = await page.evaluate(() => {
                const active = document.activeElement;
                return active !== null && active.classList.contains('grid-textfield');
            });
            expect(hasFocus).toBe(true);

            // 8. 入力した文字がテキストフィールドに実際に反映されていることを検証する
            //    async完了後にshow()でtextContentがnullクリアされるバグを検出するためのアサーション
            await expect(editField).toHaveText('x');
        },
    );

    test(
        '別タブからPROBLEMSのエラーへジャンプした後、保存済みスクロール位置に戻らない',
        async ({ page }) => {
            await installMockApiAsync(page, createLargeFkFileSystem());
            await page.goto('/');

            await openTableAsync(page, 'category');
            await openTableAsync(page, 'product');

            const productViewport = getTableMainViewport(page, 'product');
            await expect(productViewport).toBeVisible();
            await productViewport.evaluate((el) => {
                el.scrollTop = el.scrollHeight;
                el.dispatchEvent(new Event('scroll'));
            });
            await waitForAnimationFrames(page, 2);
            const bottomScrollTop = await productViewport.evaluate((el) => el.scrollTop);
            expect(bottomScrollTop, 'テスト前提: product を下方にスクロールできること').toBeGreaterThan(1000);

            await openTableAsync(page, 'category');
            await openValidationPanelAsync(page);
            const productFkError = getValidationPanelItems(page).filter({ hasText: 'product' });
            await expect(productFkError.first()).toBeVisible();

            await productFkError.first().click();
            await waitForAnimationFrames(page, 4);

            const activeProductViewport = getTableMainViewport(page, 'product');
            await expect(activeProductViewport).toBeVisible();
            const afterJumpScrollTop = await activeProductViewport.evaluate((el) => el.scrollTop);
            expect(afterJumpScrollTop, `ジャンプ後に保存済みスクロール位置へ戻っています: before=${bottomScrollTop}, after=${afterJumpScrollTop}`).toBeLessThan(200);

            const focusedCell = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="product"] .editor-table-cell-focused`);
            await expect(focusedCell).toHaveText('999');
        },
    );
});
