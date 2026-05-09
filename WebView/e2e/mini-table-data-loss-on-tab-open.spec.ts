import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';
import { enableRelationsPanelAsync } from './fixtures/test-utils';

// =============================================================================
// ミニEditorTableで編集したデータが、同テーブルをタブで開くと失われる問題のテスト
//
// 不具合の概要:
//   右ペイン（RelationsPanel）のミニEditorTableで shop_product テーブルを編集して
//   Dirtyマークが付いた状態で、まだ shop_product がタブとして開かれていない場合に、
//   エクスプローラーから shop_product を開くと、ミニテーブルで編集した値が
//   CSVファイルの値に戻ってしまう。
//
// 根本原因:
//   destroyMiniEditorTables で unregisterTable が呼ばれ、ミニテーブルが唯一の
//   参照元の場合に参照カウントが0になり InMemoryTableStore からデータが完全に削除される。
//   その後 registerTableAsync が呼ばれるとCSVから再読み込みされ、編集済みデータが失われる。
//
//   さらに destroyMiniEditorTables では history.unregister() が unregisterTable() より
//   先に呼ばれるため、unregisterTable 時点では History レジストリが空になり
//   Dirty 判定もできない。
//
// 期待動作:
//   ミニEditorTableで編集した値がDirtyな状態のとき、右ペインを破棄して同名テーブルを
//   タブで開いてもデータは失われず、編集済みの値が左ペインのEditorTableに表示されること。
//
// RED状態の理由:
//   InMemoryTableStore.unregisterTable が参照カウント=0になった場合に Dirty 状態を
//   確認せずにデータを削除するため、タブを開くと常にCSVから再読み込みされる。
// =============================================================================

/**
 * テスト用ファイルシステムを生成する。
 *
 * テーブル構成:
 *   shop_product: id, group_id, name（商品グループ別の商品一覧）
 *     - group_id=1: id=1(Sword), id=2(Shield)  ← 2件
 *     - group_id=2: id=3(Potion)               ← 1件
 *   shop: id, name, product_group_id（商品グループIDを参照）
 *     - product_group_id は shop_product.group_id を参照（N:1）
 *
 * shop を開いて行を選択すると RelationsPanel に shop_product のミニEditorTable が表示される。
 * ミニテーブルで name セルを編集した後、shop_product をエクスプローラーからタブで開くと、
 * 編集した値が反映されているはず（現在は失われる）。
 */
function createShopProductFileSystem(): MockFileSystem {
    return {
        "schema/shop_product.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "group_id", type: "int" },
                { key: 2, name: "name", type: "string" },
            ],
            primary_key: ["id"],
        }),
        "data/shop_product.csv": [
            "id,group_id,name",
            "1,1,Sword",
            "2,1,Shield",
            "3,2,Potion",
        ].join("\n"),
        "schema/shop.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                // product_group_id は shop_product.group_id を参照（group_id はPK "id" ではない）
                { key: 2, name: "product_group_id", type: "int", reference: "shop_product.group_id" },
            ],
            primary_key: ["id"],
        }),
        "data/shop.csv": [
            "id,name,product_group_id",
            "1,WeaponShop,1",
            "2,ItemShop,2",
        ].join("\n"),
    };
}

/**
 * エクスプローラーからテーブルを開き、左ペインのアクティブな EditorTable の Locator を返す。
 * 複数タブが開かれている場合も data-tab-name で絞り込むことで strict mode violation を防ぐ。
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
    const table = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="${tableName}"] .editor-table`);
    await expect(table).toBeVisible();
    return table;
}

/**
 * 指定した行ヘッダーをクリックして行を選択する。
 * rowIndex: 0始まり（ヘッダー行を除く）
 */
async function selectRowAsync(table: Locator, rowIndex: number): Promise<void> {
    const header = table.locator('.editor-table-row-header').nth(rowIndex);
    await header.click();
}

/**
 * リレーションパネルのコンテンツが表示されるまで待機する。
 */
async function waitForRelationsPanelContentAsync(page: Page): Promise<void> {
    await expect(page.locator('.relations-panel-content')).toBeVisible();
}

/**
 * リレーションパネル内の指定テーブルセクションにある、3番目のデータセル（name列）を返す。
 *
 * shop_product の列構成: id(nth0), group_id(nth1), name(nth2)
 * すべての列が表示されるため、nth(2) が name 列のセルになる。
 * nth(0) は PK列の id セルのため編集対象から外す。
 * nth(1) は group_id 列のため編集対象から外す。
 * nth(2) の name 列を対象にする。
 */
function getMiniTableFirstDataCell(sectionLocator: Locator): Locator {
    return sectionLocator.locator(
        '.editor-table .editor-table-cell' +
        ':not(.editor-table-row-header)' +
        ':not(.editor-table-column-header)' +
        ':not(.editor-table-corner-cell)'
    ).nth(2);
}

/**
 * ミニテーブルのセルをダブルクリックして新しい値を入力しEnterで確定する。
 *
 * 1. nth(2) のデータセル（name列）をダブルクリックして編集モードに入る
 * 2. 既存の内容を全選択してから新しい値を入力する
 * 3. Enter で確定する
 */
async function editMiniTableCellAsync(
    page: Page,
    sectionLocator: Locator,
    newValue: string,
): Promise<void> {
    const cell = getMiniTableFirstDataCell(sectionLocator);
    await expect(cell).toBeVisible();
    await cell.dblclick();

    const editField = sectionLocator.locator(
        '.grid-textfield-active, input'
    ).first();
    await expect(editField).toBeVisible();

    await editField.selectText();
    await editField.type(newValue);
    await page.keyboard.press('Enter');
}

// =============================================================================
// テスト本体
// =============================================================================

test.describe('ミニEditorTableで編集したデータがタブを開くと失われる問題', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createShopProductFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
        await enableRelationsPanelAsync(page);
    });

    test(
        '【メインシナリオ】ミニテーブルで shop_product を編集後、' +
        'エクスプローラーから shop_product をタブで開くと編集済みの値が表示されること',
        async ({ page }) => {
            // 1. shop テーブルをタブで開く
            const shopTable = await openTableAsync(page, 'shop');

            // 2. shop の1行目（WeaponShop, product_group_id=1）を選択する
            //    → RelationsPanel に shop_product のミニEditorTable が表示される
            await selectRowAsync(shopTable, 0);
            await waitForRelationsPanelContentAsync(page);

            // shop_product テーブルのセクションが表示されていることを確認する
            const shopProductSection = page.locator('.relations-table-section').filter({
                has: page.locator('.relations-table-title').getByText('shop_product', { exact: true }),
            });
            await expect(shopProductSection).toBeVisible();

            // ミニEditorTable が表示されるまで待機する
            const miniTable = shopProductSection.locator('.editor-table');
            await expect(miniTable).toBeVisible();

            // 3. ミニテーブル内の name 列セル（nth=2）を編集する
            //    group_id=1 に対応する行は Sword(id=1) と Shield(id=2) の2件
            //    セルの並び: nth(0)=id列"1", nth(1)=group_id列"1", nth(2)=name列"Sword", nth(3)=id列"2", ...
            //    nth(0) は PK列のため編集すると store 更新が壊れる → nth(2) の name 列を選ぶ
            const editedValue = 'SwordEdited';
            await editMiniTableCellAsync(page, shopProductSection, editedValue);

            // 編集後にミニテーブルが Dirty 状態になっていることをセル値で確認する
            // （Dirtyマーク .relations-table-dirty は未実装だが、値の変更は確認できる）
            const firstDataCell = getMiniTableFirstDataCell(shopProductSection);
            await expect(firstDataCell).toHaveText(editedValue);

            // 4. エクスプローラーから shop_product をタブとして開く
            //    この操作で destroyMiniEditorTables → unregisterTable が呼ばれ、
            //    不具合があればデータが削除される
            const shopProductTable = await openTableAsync(page, 'shop_product');

            // 5. 開いた shop_product タブで編集済みの値が表示されていることを確認する
            //    不具合がある場合: CSVから再読み込みされて "Sword"（元の値）が表示される → テスト失敗（RED）
            //    修正後: InMemoryTableStore のデータが保持されて "SwordEdited" が表示される → テスト成功（GREEN）
            //
            // id=1 の行の name 列（インデックス2）の値を確認する
            // タブで開いた shop_product テーブルのデータセルを取得する
            // ヘッダー行（row=0）を除いた最初のデータ行（row=1）の name 列セルを探す
            const nameColumnCells = shopProductTable.locator(
                '.editor-table-cell:not(.editor-table-row-header):not(.editor-table-column-header):not(.editor-table-corner-cell)'
            );
            // name 列は3列目（id, group_id, name の順）のため、最初の行のname列は
            // データ行1の3番目のセルにあたる（row-header + col0 + col1 + col2 の並び）
            // 実際のセルが "SwordEdited" を持っていることを確認する
            // nameColumnCells の中に editedValue を含むセルが存在することを検証する
            //
            // バグ修正前: "Sword"（CSV元値）が表示されるためこのアサーションが失敗してREDになる
            // バグ修正後: "SwordEdited"（編集済み値）が表示されてGREENになる
            await expect(nameColumnCells.filter({ hasText: editedValue })).toBeVisible();
        },
    );

    test(
        'ミニテーブルで編集した後に shop_product タブを開いても、' +
        '未編集の shop_product 行（id=3, Potion）は変更されていないこと',
        async ({ page }) => {
            // 1. shop テーブルを開く
            const shopTable = await openTableAsync(page, 'shop');

            // 2. shop の1行目（WeaponShop, product_group_id=1）を選択して
            //    RelationsPanel に shop_product のミニテーブルを表示する
            await selectRowAsync(shopTable, 0);
            await waitForRelationsPanelContentAsync(page);

            const shopProductSection = page.locator('.relations-table-section').filter({
                has: page.locator('.relations-table-title').getByText('shop_product', { exact: true }),
            });
            await expect(shopProductSection).toBeVisible();

            const miniTable = shopProductSection.locator('.editor-table');
            await expect(miniTable).toBeVisible();

            // 3. ミニテーブルの最初の visible なデータセルを編集する（id=1 の Sword → SwordEdited）
            await editMiniTableCellAsync(page, shopProductSection, 'SwordEdited');

            // 4. エクスプローラーから shop_product をタブとして開く
            const shopProductTable = await openTableAsync(page, 'shop_product');

            // 5. 未編集の Potion（id=3）が変更されていないことを確認する
            //    不具合の有無に関わらずこの値は元のままであるべき
            const allCells = shopProductTable.locator(
                '.editor-table-cell:not(.editor-table-row-header):not(.editor-table-column-header):not(.editor-table-corner-cell)'
            );
            await expect(allCells.filter({ hasText: 'Potion' })).toBeVisible();
        },
    );

    test(
        'ミニテーブルで編集していない場合は shop_product タブを開いても元の値が表示されること（正常系確認）',
        async ({ page }) => {
            // 1. shop テーブルを開く
            const shopTable = await openTableAsync(page, 'shop');

            // 2. shop の1行目を選択して RelationsPanel に shop_product のミニテーブルを表示する
            await selectRowAsync(shopTable, 0);
            await waitForRelationsPanelContentAsync(page);

            const shopProductSection = page.locator('.relations-table-section').filter({
                has: page.locator('.relations-table-title').getByText('shop_product', { exact: true }),
            });
            await expect(shopProductSection).toBeVisible();

            // 編集を行わずに shop_product をタブで開く（Dirty なし → データ削除は発生しない想定）
            const shopProductTable = await openTableAsync(page, 'shop_product');

            // 元の値 "Sword" が表示されていることを確認する（正常系）
            // この場合は refCount=0 になってもデータは残っているはず（Dirty=false なのでデータ削除は問題ない）
            // ただし registerTableAsync でCSVから再読み込みされるため元の値が表示されることが期待される
            const allCells = shopProductTable.locator(
                '.editor-table-cell:not(.editor-table-row-header):not(.editor-table-column-header):not(.editor-table-corner-cell)'
            );
            await expect(allCells.filter({ hasText: 'Sword' })).toBeVisible();
        },
    );

    test(
        '【タブDirty表示】ミニテーブルで shop_product を編集後、' +
        'エクスプローラーから shop_product を新規タブで開いたときタブボタンに Dirty マークが付くこと',
        async ({ page }) => {
            // 1. shop テーブルをタブで開く
            const shopTable = await openTableAsync(page, 'shop');

            // 2. shop の1行目（WeaponShop, product_group_id=1）を選択する
            //    → RelationsPanel に shop_product のミニEditorTable が表示される
            await selectRowAsync(shopTable, 0);
            await waitForRelationsPanelContentAsync(page);

            // shop_product テーブルのセクションが表示されていることを確認する
            const shopProductSection = page.locator('.relations-table-section').filter({
                has: page.locator('.relations-table-title').getByText('shop_product', { exact: true }),
            });
            await expect(shopProductSection).toBeVisible();

            // ミニEditorTable が表示されるまで待機する
            const miniTable = shopProductSection.locator('.editor-table');
            await expect(miniTable).toBeVisible();

            // 3. ミニテーブル内の name 列セル（nth=2）を編集する
            //    この時点では shop_product はまだ左ペインのタブとして開かれていない
            await editMiniTableCellAsync(page, shopProductSection, 'SwordEdited');

            // 編集後にミニテーブルの編集値が反映されていることを確認する
            const firstDataCell = getMiniTableFirstDataCell(shopProductSection);
            await expect(firstDataCell).toHaveText('SwordEdited');

            // 4. エクスプローラーから shop_product を新規タブとして開く
            //    タブ生成時に registerHistory() が呼ばれ、dirtyTableNames の Dirty 状態が
            //    History の markInitiallyDirty() を通じて引き継がれる
            await openTableAsync(page, 'shop_product');

            // 5. shop_product のタブボタンに .tab-button-dirty-visible クラスが付与されていることを確認する
            //
            // 根本原因（RED になる理由）:
            //   タブ生成時に History が savedIndex=0, currentIndex=0 で作られるため isDirty()=false。
            //   InMemoryTableStore.isTableDirty() は別のミニテーブル History が dirty なので true を返すが、
            //   タブ生成時にそれをチェックしてタブボタンの Dirty 表示を初期化するコードが存在しない。
            //
            // 修正後（GREEN になる条件）:
            //   タブ生成時に InMemoryTableStore.isTableDirty() を確認し、
            //   true であればタブボタンに setDirty(true) を呼び出す。
            const shopProductTabButton = page.locator('.tab-button').filter({
                hasText: 'shop_product',
            });
            await expect(shopProductTabButton).toBeVisible();
            const dirtyIndicator = shopProductTabButton.locator('.tab-button-dirty');
            await expect(dirtyIndicator).toHaveClass(/tab-button-dirty-visible/);
        },
    );
});
