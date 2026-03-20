import { test, expect } from './fixtures/test';
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
            // ヘッダー行(1) + データ行(2) + バッファ空行(1) = 合計4行あることを検証
            await expect(allRows).toHaveCount(4);

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
            // ヘッダー行(1) + データ行(1) + バッファ空行(1) = 合計3行
            await expect(allRows).toHaveCount(3);

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
 *   enemy: id, ja, en（敵名テーブル。複数列あり）
 *   quest: id, name, enemy_id（クエスト2行。enemy.idをFKとして参照）
 *
 * quest を開いて1行目を選択 → RelationsPanelに enemy の id=1(スライム) 1行が表示される。
 * N:1リレーションではすべての列（id, ja, en）が表示されるため、ArrowRightで列移動を検証できる。
 * quest は2行用意しているため、メインテーブルでのArrowDown移動も検証できる。
 *
 * enemy に3列（id, ja, en）用意する理由:
 *   id→ja→en のArrowRight移動を検証するために3列必要。
 *   2列（id, ja）だと最初のセル（id）から1回しか ArrowRight できない。
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
                { key: 2, name: "en", type: "string" },
            ],
            primary_key: ["id"],
        }),
        "data/enemy.csv": [
            "id,ja,en",
            "1,スライム,Slime",
            "2,ドラゴン,Dragon",
        ].join("\n"),
        "schema/quest.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                // enemy.id を FK として参照する（RelationsPanel は columnName="id" で PKルックアップ）
                { key: 2, name: "enemy_id", type: "int", reference: "enemy.id" },
            ],
            primary_key: ["id"],
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
            // 全列（id, ja, en）が表示されるため、id列（左端）から ArrowRight で ja→en と移動できることを検証する
            const mainTable = await openTableAsync(page, 'quest');
            await selectRowAsync(mainTable, 0);
            await waitForRelationsPanelContentAsync(page);

            const miniTable = page.locator('.relations-panel .editor-table').first();
            await expect(miniTable).toBeVisible();

            // ミニEditorTableの選択枠（.selection）を確認する
            const selectionEl = page.locator('.relations-panel .selection').first();
            await expect(selectionEl).toBeVisible();

            // 最初のデータセルが DOM に出現するまで待機してからクリックする。
            // buildMiniTableAsync は非同期（readFileAsync を含む）のため、
            // .relations-panel-content の visible 後もセルがまだ構築中の可能性がある。
            const firstDataCell = miniTable.locator(
                '.editor-table-cell:not(.editor-table-row-header):not(.editor-table-column-header):not(.editor-table-corner-cell)'
            ).first();
            await expect(firstDataCell).toBeVisible();
            await firstDataCell.click();

            // クリック直後の選択枠のleft値を記録する
            const initialLeft = await selectionEl.evaluate((el: Element) => {
                return (el as HTMLElement).style.left;
            });

            // ArrowRight を押して右の列に移動させる
            await page.keyboard.press('ArrowRight');

            // 選択枠の left 値が変化していることを確認（列移動した証拠）
            // バグ修正前は active=false のため onKeydown() が即 return し、left は変化しなかった
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

// =============================================================================
// バグ4: 1:N子テーブルのタブが未開放だと右ペインに1:Nセクションが表示されない問題
//
// 根本原因:
//   resolveEntriesForEditorRowAsync() の1:N解決部（318-320行目）で
//   this.store.getHeader(childTableName) / this.store.getRows(childTableName) を
//   呼んでいるが、InMemoryTableStore はタブで開かれたテーブルのみ registerTable()
//   されるストアのため、タブが開かれていない子テーブルは false を返し continue される。
//
// 期待動作:
//   N:1と同様に getFullDataAsync() を使って子テーブルを非同期ロードし、
//   子テーブルのタブが開かれていなくても1:Nセクションを表示できるようにする。
//   ただし1:N側では各行の pkValue フィルタリングが必要なため、
//   getFullDataAsync() で取得した rows Map から pkSet でフィルタリングする。
// =============================================================================

/**
 * バグ4テスト用のファイルシステムを生成する
 *
 * テーブル構成:
 *   enemy: id, ja（親テーブル。id=PK列）
 *   quest: id, name, enemy_id（子テーブル。enemy.id をFKとして参照）
 *
 * enemy テーブルのみタブを開き、quest テーブルは開かない。
 * enemy の行を選択したとき、1:N として quest セクションが表示されることを検証する。
 *
 * データ:
 *   enemy: id=1(スライム), id=2(ドラゴン)
 *   quest: id=1(first_quest, enemy_id=1), id=2(second_quest, enemy_id=1), id=3(dragon_quest, enemy_id=2)
 *   → enemy id=1 を選択すると quest が2件（first_quest, second_quest）表示されるはず
 */
function createOneToNUnloadedChildFileSystem(): MockFileSystem {
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
            "2,ドラゴン",
        ].join("\n"),
        "schema/quest.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                // enemy.id を FK として参照する（逆参照: enemy → quest が 1:N）
                { key: 2, name: "enemy_id", type: "int", reference: "enemy.id" },
            ],
            primary_key: ["id"],
        }),
        "data/quest.csv": [
            "id,name,enemy_id",
            "1,first_quest,1",
            "2,second_quest,1",
            "3,dragon_quest,2",
        ].join("\n"),
    };
}

test.describe('バグ4: 1:N子テーブルのタブが未開放でも右ペインに1:Nセクションが表示されること', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createOneToNUnloadedChildFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        'enemy テーブルのみ開いた状態で enemy の行を選択したとき、' +
        'quest タブが開かれていなくても右ペインに 1:N セクションとして quest が表示されること',
        async ({ page }) => {
            // enemy テーブルを開く（quest テーブルは開かない）
            const mainTable = await openTableAsync(page, 'enemy');

            // enemy の1行目（id=1, スライム）を選択する
            await selectRowAsync(mainTable, 0);

            // quest テーブルの1:N セクションが表示されることを直接確認する
            // .relations-panel-content を経由しない理由:
            //   バグ修正前は1:Nエントリが全スキップされて entries=[] になり、
            //   renderMessage() が呼ばれて .relations-panel-content 自体が生成されない。
            //   waitForRelationsPanelContentAsync を使うとプレースホルダー状態でタイムアウトし、
            //   失敗の原因が分かりにくくなる。
            //   quest セクションを直接待機することで「セクションが現れない」という失敗を明示する。
            //
            // バグ修正前: store.getHeader('quest') が false を返して continue され、
            //   セクションが生成されない → このアサーションが失敗して RED になる
            // バグ修正後: getFullDataAsync() で非同期ロードして1:Nエントリを生成するため GREEN になる
            const questSection = page.locator('.relations-table-section').filter({
                has: page.locator('.relations-table-title').getByText('quest', { exact: true }),
            });
            await expect(questSection).toBeVisible();
        },
    );

    test(
        'enemy の1行目（id=1）を選択したとき、1:N セクションに 1:N タグが付いていること',
        async ({ page }) => {
            const mainTable = await openTableAsync(page, 'enemy');
            await selectRowAsync(mainTable, 0);
            await waitForRelationsPanelContentAsync(page);

            const questSection = page.locator('.relations-table-section').filter({
                has: page.locator('.relations-table-title').getByText('quest', { exact: true }),
            });
            await expect(questSection).toBeVisible();

            // 1:N タグが表示されていることを確認する
            await expect(questSection.locator('.relations-tag--1n')).toBeVisible();
        },
    );

    test(
        'enemy の1行目（id=1）を選択したとき、quest の enemy_id=1 の行が2件表示されること',
        async ({ page }) => {
            const mainTable = await openTableAsync(page, 'enemy');
            await selectRowAsync(mainTable, 0);
            await waitForRelationsPanelContentAsync(page);

            const questSection = page.locator('.relations-table-section').filter({
                has: page.locator('.relations-table-title').getByText('quest', { exact: true }),
            });
            await expect(questSection).toBeVisible();

            // ミニEditorTableが表示されるまで待機する
            const miniTable = questSection.locator('.editor-table');
            await expect(miniTable).toBeVisible();

            // ヘッダー行(1) + データ行(2) + バッファ行(1) = 合計4行
            // enemy_id=1 に対応する行は id=1(first_quest) と id=2(second_quest) の2件
            const allRows = miniTable.locator('.editor-table-row');
            await expect(allRows).toHaveCount(4);

            // 行カウント表示も "2 rows" であることを確認する
            const rowCountEl = questSection.locator('.relations-table-row-count');
            await expect(rowCountEl).toHaveText('2 rows');
        },
    );

    test(
        'enemy の2行目（id=2）を選択したとき、quest の enemy_id=2 の行が1件表示されること',
        async ({ page }) => {
            const mainTable = await openTableAsync(page, 'enemy');
            await selectRowAsync(mainTable, 1);
            await waitForRelationsPanelContentAsync(page);

            const questSection = page.locator('.relations-table-section').filter({
                has: page.locator('.relations-table-title').getByText('quest', { exact: true }),
            });
            await expect(questSection).toBeVisible();

            const miniTable = questSection.locator('.editor-table');
            await expect(miniTable).toBeVisible();

            // ヘッダー行(1) + データ行(1) + バッファ行(1) = 合計3行
            // enemy_id=2 に対応する行は id=3(dragon_quest) の1件
            const allRows = miniTable.locator('.editor-table-row');
            await expect(allRows).toHaveCount(3);

            const rowCountEl = questSection.locator('.relations-table-row-count');
            await expect(rowCountEl).toHaveText('1 rows');
        },
    );
});

// =============================================================================
// バグ5: N:1ミニテーブルで参照対象列（PK列等）が非表示になっている問題
//
// 現在の動作:
//   resolveEntriesForEditorRowAsync() の N:1エントリ生成部で
//   cssHiddenColumns: [expr.columnName] が設定され、
//   buildMiniEditorTableAsync() 内で hideColumnsByName() が呼ばれて
//   参照対象列（通常は "id"）が display:none になっている。
//
// 期待動作（変更後）:
//   N:1ミニテーブルでも参照対象列を含むすべての列を表示する。
//   cssHiddenColumns を空にして hideColumnsByName() を呼ばないことで、
//   すべての列ヘッダーと全セルが visible になる。
// =============================================================================

/**
 * バグ5テスト用のファイルシステムを生成する
 *
 * テーブル構成:
 *   enemy: id, ja（敵名テーブル。id=PK列）
 *   quest: id, name, enemy_id（クエスト。enemy.id をFKとして参照）
 *
 * quest の行を選択すると RelationsPanel に N:1 として enemy テーブルが表示される。
 * 参照対象列は "id"（expr.columnName）で、現在は display:none になっている。
 * 変更後はすべての列（id, ja）が visible になることを検証する。
 */
function createN1AllColumnsVisibleFileSystem(): MockFileSystem {
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
            "2,ドラゴン",
        ].join("\n"),
        "schema/quest.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                { key: 2, name: "enemy_id", type: "int", reference: "enemy.id" },
            ],
            primary_key: ["id"],
        }),
        "data/quest.csv": [
            "id,name,enemy_id",
            "1,first_quest,1",
            "2,second_quest,2",
        ].join("\n"),
    };
}

test.describe('バグ5: N:1ミニテーブルで参照対象列（PK列）がすべて表示されること', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createN1AllColumnsVisibleFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        'quest の行を選択したとき、リレーションパネルの enemy ミニテーブルに "id" 列ヘッダーが表示されること',
        async ({ page }) => {
            // quest テーブルを開いて1行目（first_quest, enemy_id=1）を選択する
            const mainTable = await openTableAsync(page, 'quest');
            await selectRowAsync(mainTable, 0);
            await waitForRelationsPanelContentAsync(page);

            // enemy テーブルセクションを特定する
            const enemySection = page.locator('.relations-table-section').filter({
                has: page.locator('.relations-table-title').getByText('enemy', { exact: true }),
            });
            await expect(enemySection).toBeVisible();

            const miniTable = enemySection.locator('.editor-table');
            await expect(miniTable).toBeVisible();

            // すべての列ヘッダーが display:none なしで表示されていることを確認する。
            // 変更前は cssHiddenColumns: ["id"] が設定され hideColumnsByName() で
            // "id" 列に display:none が付与されるため、このアサーションは FAIL する（RED）。
            // 変更後は cssHiddenColumns が空になり "id" 列も visible になるため GREEN になる。
            const idHeader = miniTable.locator('.editor-table-column-header').filter({
                hasText: 'id',
            });
            // toBeVisible() は display:none の要素を false とするため、
            // "id" 列ヘッダーが visible であることをここで検証する
            await expect(idHeader.first()).toBeVisible();
        },
    );

    test(
        'quest の行を選択したとき、enemy ミニテーブルの "id" 列データセルが表示されていること',
        async ({ page }) => {
            const mainTable = await openTableAsync(page, 'quest');
            // enemy_id=1 → enemy の id=1(スライム) の行が表示される
            await selectRowAsync(mainTable, 0);
            await waitForRelationsPanelContentAsync(page);

            const enemySection = page.locator('.relations-table-section').filter({
                has: page.locator('.relations-table-title').getByText('enemy', { exact: true }),
            });
            await expect(enemySection).toBeVisible();

            const miniTable = enemySection.locator('.editor-table');
            await expect(miniTable).toBeVisible();

            // "id" 列のデータセルが display:none なしで visible であることを確認する。
            // ヘッダー行（.editor-table-column-header を含む行）を除いたデータ行の id 列セルを取得する。
            // 変更前は hideColumnsByName() で "id" 列セルも display:none になるため FAIL する（RED）。
            // 変更後はすべてのセルが visible になるため GREEN になる。
            //
            // DOM上の列インデックス: 行ヘッダー(col=0), id列(col=1), ja列(col=2)
            // データ行の "id" 列セルは .editor-table-row の nth(1)（ヘッダー行除く最初の行）の children[1]
            const dataRow = miniTable.locator('.editor-table-row').nth(1);
            await expect(dataRow).toBeVisible();
            const idCell = dataRow.locator('.editor-table-cell').nth(1);
            await expect(idCell).toBeVisible();
            // セルに "1" が表示されていること（enemy.id=1 の値）
            await expect(idCell).toHaveText('1');
        },
    );
});

// =============================================================================
// バグ6: 1:NミニテーブルでFK列が物理除去されて表示されない問題
//
// 現在の動作:
//   resolveEntriesForEditorRowAsync() の 1:N エントリ生成部で
//   hiddenColumns: [fkColName] が設定され、
//   buildMiniEditorTableAsync() 内でスキーマ・ヘッダー・行データから
//   FK列が物理除去される。
//
// 期待動作（変更後）:
//   1:NミニテーブルでもFK列を除去せず、すべての列を表示する。
//   hiddenColumns を空にすることで、FK列のヘッダーと値がミニテーブルに表示される。
// =============================================================================

/**
 * バグ6テスト用のファイルシステムを生成する
 *
 * テーブル構成:
 *   enemy: id, ja（親テーブル。id=PK列）
 *   quest: id, name, enemy_id（子テーブル。enemy.id をFKとして参照）
 *
 * enemy の行を選択すると RelationsPanel に 1:N として quest テーブルが表示される。
 * quest の enemy_id 列は現在は物理除去されているが、変更後は表示される。
 *
 * データ:
 *   enemy: id=1(スライム), id=2(ドラゴン)
 *   quest: id=1(first_quest, enemy_id=1), id=2(second_quest, enemy_id=1), id=3(dragon_quest, enemy_id=2)
 */
function createOneToNFkColumnVisibleFileSystem(): MockFileSystem {
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
            "2,ドラゴン",
        ].join("\n"),
        "schema/quest.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                { key: 2, name: "enemy_id", type: "int", reference: "enemy.id" },
            ],
            primary_key: ["id"],
        }),
        "data/quest.csv": [
            "id,name,enemy_id",
            "1,first_quest,1",
            "2,second_quest,1",
            "3,dragon_quest,2",
        ].join("\n"),
    };
}

test.describe('バグ6: 1:NミニテーブルでFK列が表示されること', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createOneToNFkColumnVisibleFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        'enemy の行を選択したとき、quest ミニテーブルに "enemy_id" 列ヘッダーが存在し表示されること',
        async ({ page }) => {
            // enemy テーブルを開いて1行目（id=1, スライム）を選択する
            const mainTable = await openTableAsync(page, 'enemy');
            await selectRowAsync(mainTable, 0);
            await waitForRelationsPanelContentAsync(page);

            // quest テーブルセクションを特定する
            const questSection = page.locator('.relations-table-section').filter({
                has: page.locator('.relations-table-title').getByText('quest', { exact: true }),
            });
            await expect(questSection).toBeVisible();

            const miniTable = questSection.locator('.editor-table');
            await expect(miniTable).toBeVisible();

            // "enemy_id" 列ヘッダーが存在し visible であることを確認する。
            // 変更前は hiddenColumns: ["enemy_id"] でスキーマ・ヘッダー・行から物理除去されるため
            // ヘッダーセルが DOM に存在せず、このアサーションは FAIL する（RED）。
            // 変更後は hiddenColumns が空になり "enemy_id" 列が DOM に存在して GREEN になる。
            const enemyIdHeader = miniTable.locator('.editor-table-column-header').filter({
                hasText: 'enemy_id',
            });
            await expect(enemyIdHeader.first()).toBeVisible();
        },
    );

    test(
        'enemy の1行目（id=1）を選択したとき、quest ミニテーブルの "enemy_id" 列に正しいFK値が表示されること',
        async ({ page }) => {
            // enemy テーブルを開いて1行目（id=1）を選択する
            const mainTable = await openTableAsync(page, 'enemy');
            await selectRowAsync(mainTable, 0);
            await waitForRelationsPanelContentAsync(page);

            const questSection = page.locator('.relations-table-section').filter({
                has: page.locator('.relations-table-title').getByText('quest', { exact: true }),
            });
            await expect(questSection).toBeVisible();

            const miniTable = questSection.locator('.editor-table');
            await expect(miniTable).toBeVisible();

            // quest テーブルのヘッダー列から "enemy_id" の列インデックスを取得する。
            // 変更後は hiddenColumns が空なので quest のフルスキーマ（id, name, enemy_id）が表示される。
            // DOM上: 行ヘッダー(col=0), id(col=1), name(col=2), enemy_id(col=3)
            //
            // 変更前は物理除去によりヘッダーが存在しないため以降のセル検証も FAIL する（RED）。
            // 変更後は enemy_id 列のデータセルに "1" が入っていることを確認できる（GREEN）。
            const allHeaders = miniTable.locator('.editor-table-column-header');
            await expect(allHeaders.first()).toBeVisible();
            // PK/FKバッジ実装によりallTextContents()は "enemy_idFK" のようにバッジテキストを含む。
            // PK+FK両バッジを持つ列では複数バッジが存在するため querySelectorAll で全バッジを取得し、
            // 各バッジのテキストを順に除去して列名のみを抽出する。
            const headerTexts = await allHeaders.evaluateAll((headers: Element[]) =>
                headers.map(h => {
                    const badges = h.querySelectorAll('.column-header-badge');
                    let text = h.textContent!;
                    badges.forEach(b => { text = text.replace(b.textContent!, ''); });
                    return text;
                }),
            );
            // "enemy_id" がヘッダーに含まれることを検証する（物理除去されていないことの確認）
            expect(headerTexts).toContain('enemy_id');

            // enemy_id 列のデータセルが "1スライム" であることを確認する。
            // EditorTableはFK列にリバースリファレンスヒント（参照先の表示名）を連結して表示するため、
            // 物理値 "1"（enemy.id=1）に参照先 enemy.ja="スライム" が連結されて "1スライム" と表示される。
            // データ行 nth(1)（ヘッダー行を除いた最初のデータ行）の enemy_id 列インデックスでセルを取得する
            const enemyIdColIndex = headerTexts.indexOf('enemy_id');
            const firstDataRow = miniTable.locator('.editor-table-row').nth(1);
            await expect(firstDataRow).toBeVisible();
            // DOM列インデックス: 行ヘッダー列(children[0]) + データ列(children[1]以降)
            // headerTexts は列ヘッダーセルのテキスト一覧（行ヘッダーセルは除かれる）
            // そのため DOM インデックスは enemyIdColIndex + 1（行ヘッダー分オフセット）
            const enemyIdCell = firstDataRow.locator('.editor-table-cell').nth(enemyIdColIndex + 1);
            await expect(enemyIdCell).toBeVisible();
            await expect(enemyIdCell).toHaveText('1スライム');
        },
    );
});

// =============================================================================
// バグ7: N:1ミニテーブルにバッファ行（editor-table-empty-row）が表示されない問題
//
// 根本原因:
//   relations-panel.ts の buildMiniEditorTableAsync() 呼び出し箇所で、
//   N:1ミニテーブルに emptyRowCount=0 がハードコードされているため、
//   バッファ行（editor-table-empty-row）が一切生成されない。
//
//   const emptyRowCount = entry.relationType === '1:N' ? entry.rows.length + 1 : 0;
//
//   1:Nミニテーブルには entry.rows.length + 1 が渡されてバッファ行が表示されるが、
//   N:1ミニテーブルは常に 0 が渡されるため空行がなく、
//   コンテキストメニューなしでは新規データ入力ができない。
//
// 期待動作（修正後）:
//   N:1ミニテーブルにも 1:N と同様に emptyRowCount = entry.rows.length + 1 を渡し、
//   データ末尾にバッファ行1行を常時表示する。
//
// テーブル構成:
//   table: id, name（シーンテーブル）
//   chara: id, name（キャラテーブル）
//   quest: id, name, table_id（table.id を FK 参照）, chara_id（chara.id を FK 参照）
//
//   quest を開くと RelationsPanel に N:1 として table と chara のミニテーブルが表示される。
//   現在の実装では emptyRowCount=0 のためバッファ行がなく、修正後は表示されるべき。
// =============================================================================

/**
 * バグ7テスト用のファイルシステムを生成する
 *
 * テーブル構成:
 *   table: id, name（シーン種別テーブル）
 *   chara: id, name（キャラクターテーブル）
 *   quest: id, name, table_id（table.id を FK 参照）, chara_id（chara.id を FK 参照）
 *
 * quest の行を選択すると RelationsPanel に N:1 として table と chara のミニテーブルが表示される。
 * N:1ミニテーブルには現在 emptyRowCount=0 が渡されるためバッファ行が存在しない（バグ）。
 * 修正後は emptyRowCount = entry.rows.length + 1 が渡されてバッファ行が表示される（GREEN）。
 */
function createN1EmptyRowFileSystem(): MockFileSystem {
    return {
        "schema/table.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
            ],
            primary_key: ["id"],
        }),
        "data/table.csv": [
            "id,name",
            "1,dungeon",
            "2,field",
        ].join("\n"),
        "schema/chara.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
            ],
            primary_key: ["id"],
        }),
        "data/chara.csv": [
            "id,name",
            "1,hero",
            "2,villain",
        ].join("\n"),
        "schema/quest.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                // table.id を FK として参照する（N:1 関係）
                { key: 2, name: "table_id", type: "int", reference: "table.id" },
                // chara.id を FK として参照する（N:1 関係）
                { key: 3, name: "chara_id", type: "int", reference: "chara.id" },
            ],
            primary_key: ["id"],
        }),
        "data/quest.csv": [
            "id,name,table_id,chara_id",
            "1,first_quest,1,1",
            "2,second_quest,2,2",
        ].join("\n"),
    };
}

test.describe('バグ7: N:1ミニテーブルにバッファ行（editor-table-empty-row）が表示されること', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createN1EmptyRowFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        'quest を開いた際、N:1 の table ミニテーブルにバッファ行（editor-table-empty-row）が少なくとも1行存在すること',
        async ({ page }) => {
            // quest テーブルを開く（activateTabState により id=1 が初期選択される）
            // quest の1行目は table_id=1 → N:1 で table テーブルが表示される
            const mainTable = await openTableAsync(page, 'quest');
            await selectRowAsync(mainTable, 0);
            await waitForRelationsPanelContentAsync(page);

            // table テーブルセクションを取得する（N:1ミニテーブル）
            const tableSection = page.locator('.relations-table-section').filter({
                has: page.locator('.relations-table-title').getByText('table', { exact: true }),
            });
            await expect(tableSection).toBeVisible();

            const miniTable = tableSection.locator('.editor-table');
            await expect(miniTable).toBeVisible();

            // N:1も emptyRowCount = entry.rows.length + 1 でバッファ行が確保されるため、
            // ミニテーブルの末尾に editor-table-empty-row クラスの行が1行表示される。
            const bufferRow = miniTable.locator('.editor-table-empty-row').first();
            await expect(
                bufferRow,
                'N:1 ミニテーブル（table）にバッファ行（editor-table-empty-row）が最低1行表示されていること',
            ).toBeVisible();
        },
    );

    test(
        'quest を開いた際、N:1 の chara ミニテーブルにバッファ行（editor-table-empty-row）が少なくとも1行存在すること',
        async ({ page }) => {
            // quest の1行目は chara_id=1 → N:1 で chara テーブルが表示される
            const mainTable = await openTableAsync(page, 'quest');
            await selectRowAsync(mainTable, 0);
            await waitForRelationsPanelContentAsync(page);

            // chara テーブルセクションを取得する（N:1ミニテーブル）
            const charaSection = page.locator('.relations-table-section').filter({
                has: page.locator('.relations-table-title').getByText('chara', { exact: true }),
            });
            await expect(charaSection).toBeVisible();

            const miniTable = charaSection.locator('.editor-table');
            await expect(miniTable).toBeVisible();

            // N:1も emptyRowCount = entry.rows.length + 1 でバッファ行が確保されるため、
            // ミニテーブルの末尾に editor-table-empty-row クラスの行が1行表示される。
            const bufferRow = miniTable.locator('.editor-table-empty-row').first();
            await expect(
                bufferRow,
                'N:1 ミニテーブル（chara）にバッファ行（editor-table-empty-row）が最低1行表示されていること',
            ).toBeVisible();
        },
    );

    test(
        'quest を開いた際、N:1 の table ミニテーブルに行数カウントを除く正しい行数が表示されること',
        async ({ page }) => {
            // quest の1行目（table_id=1）→ N:1 で table テーブルが表示される
            // table.id=1（dungeon）の1行がデータ行として表示される
            const mainTable = await openTableAsync(page, 'quest');
            await selectRowAsync(mainTable, 0);
            await waitForRelationsPanelContentAsync(page);

            const tableSection = page.locator('.relations-table-section').filter({
                has: page.locator('.relations-table-title').getByText('table', { exact: true }),
            });
            await expect(tableSection).toBeVisible();

            const miniTable = tableSection.locator('.editor-table');
            await expect(miniTable).toBeVisible();

            // N:1も emptyRowCount = entry.rows.length + 1 でバッファ行が確保されるため、
            // ヘッダー行(1) + データ行(1) + バッファ行(1) = 3行が表示される。
            const allRows = miniTable.locator('.editor-table-row');
            await expect(
                allRows,
                'N:1 ミニテーブル（table）にはヘッダー(1) + データ(1) + バッファ(1) = 3行が表示されるべき',
            ).toHaveCount(3);
        },
    );
});
