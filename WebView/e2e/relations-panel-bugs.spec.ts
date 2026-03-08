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
 *   enemy: id, ja, en（敵名テーブル。複数列あり）
 *   quest: id, name, enemy_id（クエスト2行。enemy.idをFKとして参照）
 *
 * quest を開いて1行目を選択 → RelationsPanelに enemy の id=1(スライム) 1行が表示される。
 * N:1リレーションでは hideColumnsByName() により id列（参照対象列）が display:none になる。
 * ミニEditorTableには visible な列として ja列・en列の2列が残るため、ArrowRightで列移動を検証できる。
 * quest は2行用意しているため、メインテーブルでのArrowDown移動も検証できる。
 *
 * enemy に3列（id, ja, en）用意する理由:
 *   id 列が hideColumnsByName() で非表示になった後も ja→en の ArrowRight 移動を検証するため。
 *   2列（id, ja）だと id 非表示後に visible 列が1列しか残らず ArrowRight で移動先がなくなる。
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
            primary_key: "id",
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
            // id列は hideColumnsByName() で非表示になるため、visible 列は ja・en の2列
            // ja列（左）から en列（右）へ ArrowRight で移動できることを検証する
            const mainTable = await openTableAsync(page, 'quest');
            await selectRowAsync(mainTable, 0);
            await waitForRelationsPanelContentAsync(page);

            const miniTable = page.locator('.relations-panel .editor-table').first();
            await expect(miniTable).toBeVisible();

            // ミニEditorTableの選択枠（.selection）を確認する
            const selectionEl = page.locator('.relations-panel .selection').first();
            await expect(selectionEl).toBeVisible();

            // 最初の visible なデータセルが DOM に出現するまで待機してからクリックする。
            // buildMiniTableAsync は非同期（readFileAsync を含む）のため、
            // .relations-panel-content の visible 後もセルがまだ構築中の可能性がある。
            // hideColumnsByName() で id 列（col=0）が display:none になるため、
            // ":not([style*='display: none'])" で visible なセルに絞り込む。
            const firstDataCell = miniTable.locator(
                '.editor-table-cell:not(.editor-table-row-header):not(.editor-table-column-header):not(.editor-table-corner-cell):not([style*="display: none"])'
            ).first();
            await expect(firstDataCell).toBeVisible();
            await firstDataCell.click();

            // クリック直後の選択枠のleft値を記録する（id列が非表示のため最初のvisible列=ja列の位置）
            const initialLeft = await selectionEl.evaluate((el: Element) => {
                return (el as HTMLElement).style.left;
            });

            // ArrowRight を押して右の列（en列）に移動させる
            await page.keyboard.press('ArrowRight');

            // 選択枠の left 値が変化していることを確認（ja列→en列に移動した証拠）
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

            // ミニEditorTableの visible なデータセルが DOM に出現するまで待機してからクリックする
            // hideColumnsByName() で id 列（col=0）が display:none になるため、
            // ":not([style*='display: none'])" で visible なセルに絞り込む
            const miniTable = page.locator('.relations-panel .editor-table').first();
            await expect(miniTable).toBeVisible();
            const miniCell = miniTable.locator(
                '.editor-table-cell:not(.editor-table-row-header):not(.editor-table-column-header):not(.editor-table-corner-cell):not([style*="display: none"])'
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
// バグ3: N:1リレーションのミニテーブルで参照対象列（PK列）が表示される問題
//
// 根本原因:
//   resolveEntriesForEditorRowAsync() の N:1エントリ生成部（行292-301）で
//   hiddenColumns: [] が固定のため、参照対象列（expr.columnName, 通常は "id"）が
//   ミニEditorTable に表示されてしまう。
//
// 期待動作:
//   N:1でも参照対象列（expr.columnName）を hiddenColumns に追加し、
//   buildMiniEditorTableAsync() の汎用ロジックで非表示にする。
//   例: quest.enemy_id が enemy.id を参照 → enemy のミニテーブルに "id" 列を表示しない。
// =============================================================================

/**
 * バグ3テスト用のファイルシステムを生成する
 *
 * テーブル構成:
 *   enemy: id, ja（敵名テーブル。id=PK列）
 *   quest: id, name, enemy_id（クエスト。enemy.id をFKとして参照）
 *
 * quest の行を選択すると RelationsPanel に N:1 として enemy テーブルが表示される。
 * 参照対象列は "id"（expr.columnName）なので、enemy のミニテーブルに "id" 列が
 * 表示されないことを検証する。
 */
function createN1HiddenColumnFileSystem(): MockFileSystem {
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
                // enemy.id を FK として参照する（参照対象列 = "id"）
                { key: 2, name: "enemy_id", type: "int", reference: "enemy.id" },
            ],
            primary_key: "id",
        }),
        "data/quest.csv": [
            "id,name,enemy_id",
            "1,first_quest,1",
            "2,second_quest,2",
        ].join("\n"),
    };
}

test.describe('バグ3: N:1リレーションのミニテーブルで参照対象列（id列）が非表示になること', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createN1HiddenColumnFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        'quest の行を選択したとき、リレーションパネルの enemy ミニテーブルに "id" 列ヘッダーが表示されないこと',
        async ({ page }) => {
            // quest テーブルを開いて1行目（first_quest, enemy_id=1）を選択する
            const mainTable = await openTableAsync(page, 'quest');
            await selectRowAsync(mainTable, 0);

            // リレーションパネルにコンテンツが表示されるまで待機する
            await waitForRelationsPanelContentAsync(page);

            // enemy テーブルセクションが存在することを確認する
            const enemySection = page.locator('.relations-table-section').filter({
                has: page.locator('.relations-table-title').getByText('enemy', { exact: true }),
            });
            await expect(enemySection).toBeVisible();

            // N:1 タグが表示されていることを確認する
            await expect(enemySection.locator('.relations-tag--n1')).toBeVisible();

            // ミニEditorTableが表示されるまで待機する
            const miniTable = enemySection.locator('.editor-table');
            await expect(miniTable).toBeVisible();

            // ミニEditorTable のヘッダー列を取得する
            // .editor-table-column-header は各列見出しセル
            // display:none が適用されている列は Playwright の visible 判定から除外されるため、
            // ":not([style*='display: none'])" セレクタで visible な列ヘッダーのみを対象にする
            const visibleColumnHeaders = miniTable.locator(
                '.editor-table-column-header:not([style*="display: none"])'
            );
            await expect(visibleColumnHeaders.first()).toBeVisible();

            // visible なヘッダーのテキストのみを収集する（display:none の "id" 列は除外される）
            const headerTexts = await visibleColumnHeaders.allTextContents();

            // "id" 列が非表示になっているため、visible ヘッダーテキストに "id" が含まれないことを検証する
            expect(headerTexts).not.toContain('id');
        },
    );

    test(
        '参照対象列（id）が非表示でも残りの列（ja）はミニテーブルに表示されること',
        async ({ page }) => {
            // quest テーブルを開いて1行目を選択する
            const mainTable = await openTableAsync(page, 'quest');
            await selectRowAsync(mainTable, 0);
            await waitForRelationsPanelContentAsync(page);

            const enemySection = page.locator('.relations-table-section').filter({
                has: page.locator('.relations-table-title').getByText('enemy', { exact: true }),
            });
            await expect(enemySection).toBeVisible();

            const miniTable = enemySection.locator('.editor-table');
            await expect(miniTable).toBeVisible();

            // "ja" 列は非表示にならないため、visible なヘッダーに存在することを確認する
            // display:none が適用されている "id" 列を除外して visible な列ヘッダーのみを対象にする
            const visibleColumnHeaders = miniTable.locator(
                '.editor-table-column-header:not([style*="display: none"])'
            );
            await expect(visibleColumnHeaders.first()).toBeVisible();
            const headerTexts = await visibleColumnHeaders.allTextContents();
            expect(headerTexts).toContain('ja');
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
                // enemy.id を FK として参照する（逆参照: enemy → quest が 1:N）
                { key: 2, name: "enemy_id", type: "int", reference: "enemy.id" },
            ],
            primary_key: "id",
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

            // ヘッダー行(1) + データ行(2) = 合計3行
            // enemy_id=1 に対応する行は id=1(first_quest) と id=2(second_quest) の2件
            const allRows = miniTable.locator('.editor-table-row');
            await expect(allRows).toHaveCount(3);

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

            // ヘッダー行(1) + データ行(1) = 合計2行
            // enemy_id=2 に対応する行は id=3(dragon_quest) の1件
            const allRows = miniTable.locator('.editor-table-row');
            await expect(allRows).toHaveCount(2);

            const rowCountEl = questSection.locator('.relations-table-row-count');
            await expect(rowCountEl).toHaveText('1 rows');
        },
    );
});
