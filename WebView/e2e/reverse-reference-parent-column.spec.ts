import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';
import { enableRelationsPanelAsync } from './fixtures/test-utils';

// =============================================================================
// 1:N逆参照の parentColumnName バグ再現テスト
//
// バグの概要:
//   shop_product テーブルの右パネル（RelationsPanel）で
//   1:Nミニテーブルとして shop テーブルを表示する際、
//   フィルタリング条件が間違っている。
//
//   shop.shop_product_group_id は shop_product.group_id を参照している
//   （PK列 "id" ではなく非PK列 "group_id" を参照）。
//
//   しかし relations-panel.ts の1:N解決は常に
//   editorTable.getRowPkValue(rowIndex) でPK値を取得し、
//   それを逆参照マップのルックアップキーとして使っている。
//
//   例: shop_product行2（id=2, group_id=1）を選択
//       → getReverseReferenceEntries("2") でPK値"2"で検索してしまう
//       → 正しくは group_id=1 の値 "1" で検索すべき
//
// 修正方針:
//   1. ReverseReferenceEntry に parentColumnName: string を追加
//      （参照先の親テーブル列名、例: "group_id"）
//   2. reverse-reference-resolver.ts で expr.columnName を
//      parentColumnName として渡す
//   3. relations-panel.ts の1:N解決で、parentColumnName が
//      PK列と異なる場合はその列の値を使ってルックアップする
// =============================================================================

/**
 * エディターテーブルが表示されるまで待機し、テーブルのLocatorを返す
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
    // RelationsPanelにもミニEditorTableが表示されるため、左ペインのEditorTableに限定する
    const table = page.locator('.editor-left-pane .editor-table');
    await expect(table).toBeVisible();
    return table;
}

/**
 * 指定した行ヘッダーをクリックして行を選択する
 * rowIndex: 0始まり（ヘッダー行を除く）
 */
async function selectRowAsync(table: Locator, rowIndex: number): Promise<void> {
    const header = table.locator('.editor-table-row-header').nth(rowIndex);
    await header.click();
}

/**
 * リレーションパネルのコンテンツが表示されるまで待機する
 */
async function waitForRelationsPanelContentAsync(page: Page): Promise<Locator> {
    const content = page.locator('.relations-panel-content');
    await expect(content).toBeVisible();
    return content;
}

/**
 * テスト用のファイルシステムを生成する
 *
 * テーブル構成:
 *   shop_product: id, group_id（商品グループテーブル）
 *     - id=1, group_id=1
 *     - id=2, group_id=1  ← PKは2だがgroup_idは1（非PKの参照列）
 *     - id=3, group_id=2
 *
 *   shop: id, name, shop_product_group_id
 *     - shop_product_group_id は shop_product.group_id を参照
 *       （PK列"id"ではなく非PK列"group_id"を参照）
 *     - id=1, name=WeaponShop, shop_product_group_id=1
 *     - id=2, name=ItemShop,   shop_product_group_id=2
 *
 * 検証シナリオ:
 *   shop_product テーブルを開き、行2（id=2, group_id=1）を選択する。
 *   右パネルに shop の1:Nセクションが表示されるとき、
 *   コンテキスト表示が "shop_product_group_id=1" であるべき。
 *   （PK値"2"ではなく group_id の値"1"が使われるべき）
 *
 *   バグ修正前: "shop_product_group_id=2" と表示される → REDテスト失敗
 *   バグ修正後: "shop_product_group_id=1" と表示される → GREEN
 */
function createTestFileSystem(): MockFileSystem {
    return {
        "schema/shop_product.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int", comment: "ID" },
                { key: 1, name: "group_id", type: "int", comment: "グループID" },
            ],
            primary_key: ["id"],
        }),
        "data/shop_product.csv": [
            "id,group_id",
            "1,1",
            "2,1",
            "3,2",
        ].join("\n"),
        "schema/shop.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int", comment: "ID" },
                { key: 1, name: "name", type: "string", comment: "ショップ名" },
                // shop_product_group_id は shop_product.group_id を参照（PK列"id"ではない）
                { key: 2, name: "shop_product_group_id", type: "int", comment: "商品グループID", reference: "shop_product.group_id" },
            ],
            primary_key: ["id"],
        }),
        "data/shop.csv": [
            "id,name,shop_product_group_id",
            "1,WeaponShop,1",
            "2,ItemShop,2",
        ].join("\n"),
    };
}

// =============================================================================
// テスト1: ReverseReferenceResolver が parentColumnName を返すことを確認
//
// 検証方法:
//   shop_product テーブルの逆参照マップには shop テーブルが含まれる。
//   shop.shop_product_group_id が shop_product.group_id を参照しているため、
//   ReverseReferenceEntry の parentColumnName は "group_id" であるべき。
//
//   これが "group_id" であれば、1:N解決で正しい列（PK列"id"でなく"group_id"）の
//   値をルックアップキーとして使えるようになる。
//
//   現状: ReverseReferenceEntry に parentColumnName フィールドが存在しないため、
//         relations-panel.ts は常にPK値をルックアップキーとして使ってしまう。
//
// テスト手法:
//   shop_product 行2（id=2, group_id=1）を選択し、右パネルの shop 1:Nセクションを確認。
//   fkValue が "1"（group_idの値）であればコンテキストが "shop_product_group_id=1" と表示される。
//   fkValue が "2"（PKの値）であれば "shop_product_group_id=2" と表示されてREDになる。
// =============================================================================

test.describe('テスト1: ReverseReferenceEntry に parentColumnName が含まれ1:NのfkValueが正しいこと', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createTestFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
        await enableRelationsPanelAsync(page);
    });

    test(
        'shop_product行2（id=2, group_id=1）選択時、shopの1:Nコンテキストが' +
        '"shop_product_group_id=1"と表示されること（group_idの値"1"が使われること）',
        async ({ page }) => {
            // shop_product テーブルを開く
            const table = await openTableAsync(page, 'shop_product');

            // 行2（id=2, group_id=1）を選択する（rowIndex=1、0始まり）
            await selectRowAsync(table, 1);

            // リレーションパネルのコンテンツが表示されるまで待機する
            await waitForRelationsPanelContentAsync(page);

            // shop テーブルの1:Nセクションが存在することを確認する
            const shopSection = page.locator('.relations-table-section').filter({
                has: page.locator('.relations-table-title').getByText('shop', { exact: true }),
            });
            await expect(shopSection).toBeVisible();

            // 1:N タグが表示されていることを確認する
            await expect(shopSection.locator('.relations-tag--1n')).toBeVisible();

            // コンテキスト表示が "shop_product_group_id=1" であることを確認する。
            // バグ修正前: parentColumnName が存在しないため PKの値"2"が使われ
            //   "shop_product_group_id=2" と表示されてREDになる。
            // バグ修正後: parentColumnName="group_id" によりgroup_idの値"1"が使われ
            //   "shop_product_group_id=1" と表示されてGREENになる。
            const contextEl = shopSection.locator('.relations-table-context');
            await expect(contextEl).toBeVisible();
            await expect(contextEl).toHaveText('shop_product_group_id=1');
        },
    );

    test(
        'shop_product行1（id=1, group_id=1）選択時も' +
        '"shop_product_group_id=1"と表示されること（PKとgroup_idが同じ値1のケース）',
        async ({ page }) => {
            // 行1はid=1, group_id=1 なのでPK値とgroup_id値が両方"1"。
            // このケースでは現状のバグでも偶然正しく見えてしまう可能性がある。
            // バグが存在する場合でもPK="1"とgroup_id="1"が一致するためPASSするかもしれないが、
            // 正しい修正後の動作として "shop_product_group_id=1" が表示されることを確認する。
            const table = await openTableAsync(page, 'shop_product');
            await selectRowAsync(table, 0);
            await waitForRelationsPanelContentAsync(page);

            const shopSection = page.locator('.relations-table-section').filter({
                has: page.locator('.relations-table-title').getByText('shop', { exact: true }),
            });
            await expect(shopSection).toBeVisible();
            await expect(shopSection.locator('.relations-tag--1n')).toBeVisible();

            const contextEl = shopSection.locator('.relations-table-context');
            await expect(contextEl).toBeVisible();
            await expect(contextEl).toHaveText('shop_product_group_id=1');
        },
    );

    test(
        'shop_product行3（id=3, group_id=2）選択時、shopの1:Nコンテキストが' +
        '"shop_product_group_id=2"と表示されること',
        async ({ page }) => {
            // 行3: id=3, group_id=2
            // バグ修正前: PK値"3"が使われ "shop_product_group_id=3" と表示されてREDになる
            // バグ修正後: group_idの値"2"が使われ "shop_product_group_id=2" と表示されてGREENになる
            const table = await openTableAsync(page, 'shop_product');
            await selectRowAsync(table, 2);
            await waitForRelationsPanelContentAsync(page);

            const shopSection = page.locator('.relations-table-section').filter({
                has: page.locator('.relations-table-title').getByText('shop', { exact: true }),
            });
            await expect(shopSection).toBeVisible();
            await expect(shopSection.locator('.relations-tag--1n')).toBeVisible();

            const contextEl = shopSection.locator('.relations-table-context');
            await expect(contextEl).toBeVisible();
            // バグ修正前: "shop_product_group_id=3"（PK値"3"） → REDになる
            // バグ修正後: "shop_product_group_id=2"（group_idの値"2"） → GREEN
            await expect(contextEl).toHaveText('shop_product_group_id=2');
        },
    );
});

// =============================================================================
// テスト2: E2Eテスト — shop_productテーブルの1:Nミニテーブルで
//           正しいフィルタ条件が適用されること
//
// 詳細シナリオ:
//   shop_product行2（id=2, group_id=1）を選択した際に、
//   右パネルの shop 1:Nセクションには shop_product_group_id=1 の
//   shopレコード（WeaponShop）が表示されるべきである。
//
//   バグ修正前の動作:
//     fkValue = PK値 "2" でルックアップ → shop_product_group_id=2 のレコードが表示される
//     → ItemShop（shop_product_group_id=2）が1件表示される
//     または shop_product_group_id=2 に一致するレコードが表示される
//
//   バグ修正後の動作:
//     fkValue = group_id値 "1" でルックアップ → shop_product_group_id=1 のレコードが表示される
//     → WeaponShop（shop_product_group_id=1）が1件表示される
// =============================================================================

test.describe('テスト2: E2E — shop_product行2選択時に正しいshopレコードがフィルタされること', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createTestFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
        await enableRelationsPanelAsync(page);
    });

    test(
        'shop_product行2（id=2, group_id=1）選択時、' +
        'shopの1:Nミニテーブルに shop_product_group_id=1 の行（WeaponShop）が表示されること',
        async ({ page }) => {
            // shop_product テーブルを開く
            const table = await openTableAsync(page, 'shop_product');

            // 行2（id=2, group_id=1）を選択する（rowIndex=1、0始まり）
            await selectRowAsync(table, 1);

            // リレーションパネルのコンテンツが表示されるまで待機する
            await waitForRelationsPanelContentAsync(page);

            // shop セクションが表示されることを確認する
            const shopSection = page.locator('.relations-table-section').filter({
                has: page.locator('.relations-table-title').getByText('shop', { exact: true }),
            });
            await expect(shopSection).toBeVisible();

            // ミニEditorTableが表示されるまで待機する
            const miniTable = shopSection.locator('.editor-table');
            await expect(miniTable).toBeVisible();

            // 表示される行数を確認する。
            // group_id=1 に対応する shop は WeaponShop（1件）。
            // バグ修正前: PK値"2"でルックアップ → shop_product_group_id=2 のItemShop(1件)が表示
            //   行カウントは "1 rows" になるが、内容が間違っている（ItemShopが表示される）
            // バグ修正後: group_idの値"1"でルックアップ → WeaponShop(1件)が正しく表示
            const allRows = miniTable.locator('.editor-table-row');
            // データ行(1) + バッファ行(1) = 合計2行
            await expect(allRows).toHaveCount(2);

            // 行カウントが "1 rows" であることを確認する
            const rowCountEl = shopSection.locator('.relations-table-row-count');
            await expect(rowCountEl).toHaveText('1 rows');

            // コンテキスト表示が "shop_product_group_id=1" であることを確認する。
            // これがREDテストの核心: バグ修正前は "shop_product_group_id=2" になる。
            const contextEl = shopSection.locator('.relations-table-context');
            await expect(contextEl).toHaveText('shop_product_group_id=1');
        },
    );

    test(
        'shop_product行3（id=3, group_id=2）選択時、' +
        'shopの1:Nミニテーブルに shop_product_group_id=2 の行（ItemShop）が表示されること',
        async ({ page }) => {
            // shop_product テーブルを開く
            const table = await openTableAsync(page, 'shop_product');

            // 行3（id=3, group_id=2）を選択する（rowIndex=2、0始まり）
            await selectRowAsync(table, 2);

            // リレーションパネルのコンテンツが表示されるまで待機する
            await waitForRelationsPanelContentAsync(page);

            // shop セクションが表示されることを確認する
            const shopSection = page.locator('.relations-table-section').filter({
                has: page.locator('.relations-table-title').getByText('shop', { exact: true }),
            });
            await expect(shopSection).toBeVisible();

            const miniTable = shopSection.locator('.editor-table');
            await expect(miniTable).toBeVisible();

            // group_id=2 に対応する shop は ItemShop（1件）
            // バグ修正前: PK値"3"でルックアップ → shop_product_group_id=3 に一致するレコードなし
            //   → 0件表示 または エントリが生成されない
            // バグ修正後: group_idの値"2"でルックアップ → ItemShop(1件)が正しく表示
            const allRows = miniTable.locator('.editor-table-row');
            // データ行(1) + バッファ行(1) = 合計2行
            await expect(allRows).toHaveCount(2);

            const rowCountEl = shopSection.locator('.relations-table-row-count');
            await expect(rowCountEl).toHaveText('1 rows');

            // コンテキスト表示が "shop_product_group_id=2" であることを確認する。
            // バグ修正前: "shop_product_group_id=3"（PK値"3"） → REDになる
            const contextEl = shopSection.locator('.relations-table-context');
            await expect(contextEl).toHaveText('shop_product_group_id=2');
        },
    );

    test(
        'shop_product行2を選択したとき、shopセクションのfkValueとして' +
        'PK値の"2"ではなくgroup_idの値"1"が使われていること',
        async ({ page }) => {
            // このテストはコンテキスト表示文字列全体を確認することで、
            // fkValue が正しく解決されているかを検証する。
            // "shop_product_group_id=1" ならgroup_idの値、
            // "shop_product_group_id=2" ならPK値が使われている。
            const table = await openTableAsync(page, 'shop_product');
            await selectRowAsync(table, 1);
            await waitForRelationsPanelContentAsync(page);

            const shopSection = page.locator('.relations-table-section').filter({
                has: page.locator('.relations-table-title').getByText('shop', { exact: true }),
            });
            await expect(shopSection).toBeVisible();

            // コンテキスト要素のテキストを直接取得して検証する。
            // バグ修正前: "shop_product_group_id=2" → このアサーションがFailしてREDになる
            // バグ修正後: "shop_product_group_id=1" → GREEN
            const contextEl = shopSection.locator('.relations-table-context');
            await expect(contextEl).toBeVisible();

            const contextText = await contextEl.textContent();
            // fkValue が "2"（PK）ではなく "1"（group_id）であることを確認する
            expect(contextText).not.toContain('=2');
            expect(contextText).toContain('=1');
        },
    );
});
