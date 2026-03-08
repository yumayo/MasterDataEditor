import { test, expect } from '@playwright/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// 共通ヘルパー
// =============================================================================

/**
 * エディターテーブルが表示されるまで待機し、テーブルのLocatorを返す
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
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

// =============================================================================
// バグ1: N:1リレーションが最初の行しか表示されない問題
//
// 根本原因:
//   resolveEntriesForEditorRowAsync() の fullData.rows.get(fkValue) が
//   PKルックアップ（Map）しか行わないため、参照式の columnName がPK以外の場合に
//   1件しか返らない。
//
// 例: shop の product_group_id が shop_product.group_id を参照している場合、
//   fkValue="1" で id=1 の1行しか取得できない。
//   本来は group_id=1 の全行（複数件）を返すべき。
// =============================================================================

/**
 * バグ1テスト用のファイルシステムを生成する
 *
 * テーブル構成:
 *   shop_product: id, group_id, name（商品グループ別の商品一覧）
 *     - group_id=1: id=1(Sword), id=2(Shield)  ← 2件
 *     - group_id=2: id=3(Potion)               ← 1件
 *   shop: id, name, product_group_id（商品グループIDを参照）
 *     - product_group_id は shop_product.group_id を参照（group_id はPKではない）
 */
function createNto1MultiRowFileSystem(): MockFileSystem {
    return {
        "schema/shop_product.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "group_id", type: "int" },
                { key: 2, name: "name", type: "string" },
            ],
            primary_key: "id",
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
            primary_key: "id",
        }),
        "data/shop.csv": [
            "id,name,product_group_id",
            "1,WeaponShop,1",
            "2,ItemShop,2",
        ].join("\n"),
    };
}

test.describe('バグ1: N:1リレーションで参照列がPK以外のとき複数行が表示されること', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createNto1MultiRowFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        'shop の1行目（product_group_id=1）を選択したとき、' +
        'リレーションパネルに shop_product のgroup_id=1の行が2件表示されること',
        async ({ page }) => {
            // shopテーブルを開く
            const table = await openTableAsync(page, 'shop');

            // 1行目（WeaponShop, product_group_id=1）を選択
            await selectRowAsync(table, 0);

            // リレーションパネルのコンテンツが表示されるまで待機
            await waitForRelationsPanelContentAsync(page);

            // shop_product テーブルセクションが存在することを確認
            const shopProductSection = page.locator('.relations-table-section').filter({
                has: page.locator('.relations-table-title').getByText('shop_product', { exact: true }),
            });
            await expect(shopProductSection).toBeVisible();

            // N:1 タグが表示されていることを確認
            await expect(shopProductSection.locator('.relations-tag--n1')).toBeVisible();

            // ミニEditorTableに表示される行数を確認する
            // group_id=1 に対応する行は id=1(Sword) と id=2(Shield) の2件
            // ヘッダー行を除いたデータ行が2件あることを検証する
            const miniEditorTable = shopProductSection.locator('.editor-table');
            await expect(miniEditorTable).toBeVisible();

            // データ行（ヘッダー行 row=0 を除いた .editor-table-row）を数える
            // .editor-table-row の nth(0) はヘッダー行なので、データ行は nth(1) 以降
            const allRows = miniEditorTable.locator('.editor-table-row');
            // ヘッダー行(1) + データ行(2) = 合計3行以上あることを検証
            await expect(allRows).toHaveCount(3);

            // 行カウント表示も "2 rows" であることを確認
            const rowCountEl = shopProductSection.locator('.relations-table-row-count');
            await expect(rowCountEl).toHaveText('2 rows');
        },
    );

    test(
        'shop の2行目（product_group_id=2）を選択したとき、' +
        'リレーションパネルに shop_product の group_id=2 の行が1件表示されること',
        async ({ page }) => {
            const table = await openTableAsync(page, 'shop');

            // 2行目（ItemShop, product_group_id=2）を選択
            await selectRowAsync(table, 1);

            await waitForRelationsPanelContentAsync(page);

            const shopProductSection = page.locator('.relations-table-section').filter({
                has: page.locator('.relations-table-title').getByText('shop_product', { exact: true }),
            });
            await expect(shopProductSection).toBeVisible();

            // group_id=2 に対応する行は id=3(Potion) の1件
            const allRows = shopProductSection.locator('.editor-table .editor-table-row');
            // ヘッダー行(1) + データ行(1) = 合計2行
            await expect(allRows).toHaveCount(2);

            const rowCountEl = shopProductSection.locator('.relations-table-row-count');
            await expect(rowCountEl).toHaveText('1 rows');
        },
    );
});

// =============================================================================
// バグ2: editor-table の操作がメインパネルでしか受け付けていない問題
//
// 根本原因1:
//   editor-table-handler.ts の onFocusout() がフォーカスを常にメインテーブルに
//   奪い返す（active=true の handler が element.focus() を呼ぶ）
//
// 根本原因2:
//   ミニEditorTableでは enable() が呼ばれず active=false のままなので、
//   onKeydown() の if (!this.active) return でキー入力が全て無視される。
//   矢印キーによるセル選択移動もできない。
// =============================================================================

/**
 * バグ2テスト用のファイルシステムを生成する
 *
 * テーブル構成:
 *   enemy: id, ja（敵名テーブル。複数列あり）
 *   quest: id, name, enemy_id（クエスト2行。enemy.idをFKとして参照）
 *
 * quest を開いて1行目を選択 → RelationsPanelに enemy の id=1(スライム) 1行が表示される。
 * ミニEditorTableには id列・ja列の2列があるため、ArrowRightで列移動を検証できる。
 * quest は2行用意しているため、メインテーブルでのArrowDown移動も検証できる。
 *
 * reference: "enemy.id" にする理由:
 *   resolveRowsByFkValue() は columnName（"id"）で enemy テーブルの行を検索する。
 *   "enemy.id" ならPKルックアップで fkValue="1" → enemy.id=1 の行（スライム）が1件正しく返る。
 *   "enemy.ja" にすると ja 列の値（"スライム"等）と fkValue="1" を比較するため 0 件になり、
 *   ミニEditorTableが空になってデータセルが見つからなくなる。
 */
function createMiniTableKeyboardFileSystem(): MockFileSystem {
    return {
        "schema/enemy.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "ja", type: "string" },
            ],
            primary_key: "id",
        }),
        "data/enemy.csv": [
            "id,ja",
            "1,スライム",
            "2,ドラゴン",
        ].join("\n"),
        "schema/quest.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                // enemy.id を FK として参照する（RelationsPanel は columnName="id" で PKルックアップ）
                { key: 2, name: "enemy_id", type: "int", reference: "enemy.id" },
            ],
            primary_key: "id",
        }),
        // quest は2行。メインテーブルでの ArrowDown 移動を検証するためにも2行必要
        "data/quest.csv": [
            "id,name,enemy_id",
            "1,first_quest,1",
            "2,second_quest,2",
        ].join("\n"),
    };
}

test.describe('バグ2: ミニEditorTableでの矢印キー操作が無視される問題', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createMiniTableKeyboardFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        'リレーションパネルのミニEditorTableのセルをクリックした後、' +
        'ArrowRight キーでセル選択が右の列に移動すること',
        async ({ page }) => {
            // questテーブルを開いて1行目を選択 → RelationsPanelにenemyのミニEditorTableが表示される
            // enemy は id列・ja列の2列があり、id列(左)からja列(右)へ ArrowRight で移動できる
            const mainTable = await openTableAsync(page, 'quest');
            await selectRowAsync(mainTable, 0);
            await waitForRelationsPanelContentAsync(page);

            const miniTable = page.locator('.relations-panel .editor-table').first();
            await expect(miniTable).toBeVisible();

            // ミニEditorTableの選択枠（.selection）を確認する
            const selectionEl = page.locator('.relations-panel .selection').first();
            await expect(selectionEl).toBeVisible();

            // 最初のデータセル（id列）が DOM に出現するまで待機してからクリックする。
            // buildMiniTableAsync は非同期（readFileAsync を含む）のため、
            // .relations-panel-content の visible 後もセルがまだ構築中の可能性がある。
            const firstDataCell = miniTable.locator(
                '.editor-table-cell:not(.editor-table-row-header):not(.editor-table-column-header):not(.editor-table-corner-cell)'
            ).first();
            await expect(firstDataCell).toBeVisible();
            await firstDataCell.click();

            // クリック直後の選択枠のleft値を記録する（id列の位置）
            const initialLeft = await selectionEl.evaluate((el: Element) => {
                return (el as HTMLElement).style.left;
            });

            // ArrowRight を押して右の列（ja列）に移動させる
            await page.keyboard.press('ArrowRight');

            // 選択枠の left 値が変化していることを確認（右列に移動した証拠）
            // 現状バグでは active=false のため onKeydown() が即 return し、left は変化しない
            const afterLeft = await selectionEl.evaluate((el: Element) => {
                return (el as HTMLElement).style.left;
            });

            expect(afterLeft).not.toBe(initialLeft);
        },
    );

    test(
        'ミニEditorTableをクリックした後、メインテーブルのセルをクリックしたら' +
        'メインテーブルに操作権が戻ること（矢印キーがメインテーブルで有効になること）',
        async ({ page }) => {
            // questテーブルを開いて1行目を選択
            const mainTable = await openTableAsync(page, 'quest');
            await selectRowAsync(mainTable, 0);
            await waitForRelationsPanelContentAsync(page);

            // ミニEditorTableのデータセルが DOM に出現するまで待機してからクリックする
            const miniTable = page.locator('.relations-panel .editor-table').first();
            await expect(miniTable).toBeVisible();
            const miniCell = miniTable.locator(
                '.editor-table-cell:not(.editor-table-row-header):not(.editor-table-column-header):not(.editor-table-corner-cell)'
            ).first();
            await expect(miniCell).toBeVisible();
            await miniCell.click();

            // メインテーブルの最初のデータセルをクリックして操作権をメインに戻す
            const mainCell = mainTable.locator(
                '.editor-table-cell:not(.editor-table-row-header):not(.editor-table-column-header):not(.editor-table-corner-cell)'
            ).first();
            await mainCell.click();

            // メインテーブルの選択枠の初期位置を記録する
            const mainSelectionEl = page.locator('.editor-left-pane .selection').first();
            const beforeTop = await mainSelectionEl.evaluate((el: Element) => {
                return (el as HTMLElement).style.top;
            });

            // メインテーブルで矢印キーを押す
            await page.keyboard.press('ArrowDown');

            // メインテーブルの選択枠が移動したことを確認
            // ミニEditorTableがフォーカスを奪い続けている場合はメインのselectionが動かない
            const afterTop = await mainSelectionEl.evaluate((el: Element) => {
                return (el as HTMLElement).style.top;
            });

            expect(afterTop).not.toBe(beforeTop);
        },
    );
});
