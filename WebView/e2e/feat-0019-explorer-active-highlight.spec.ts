import { test, expect } from './fixtures/test';
import { Page } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// FEAT_0019: エクスプローラーアクティブハイライト・2行表示テスト
//
// 実装すべき機能:
//   1. タブがアクティブになったとき、対応するエクスプローラーのファイルノードに
//      `explorer-file-active` CSSクラスが付与される
//   2. 別のタブに切り替えたとき、前のファイルのハイライトが外れ、
//      新しいファイルにハイライトが付く
//   3. タブを全て閉じたとき、ハイライトが全て外れる
//   4. エクスプローラーのファイルノードが description + テーブル名の2行構造になる
//      DOM: <div class="explorer-file">
//               <span class="explorer-file-description">description</span>
//               <span class="explorer-file-name">tableName</span>
//           </div>
//   5. タブボタンが description + テーブル名の2行構造になる
//      DOM: <li class="tab-button">
//               <div class="tab-button-label">
//                   <span class="tab-button-description">description</span>
//                   <span class="tab-button-name">tableName</span>
//               </div>
//               <div class="tab-button-container">...</div>
//           </li>
//   6. description が null の場合は1行表示（explorer-file-description / tab-button-description が不在）
// =============================================================================

/**
 * テスト用ファイルシステムを生成する
 *
 * テーブル構成:
 *   item:  description あり（「アイテムマスター」）
 *   enemy: description あり（「敵マスター」）
 *   quest: description なし（null）
 */
function createTestFileSystem(): MockFileSystem {
    return {
        "schema/item.json": JSON.stringify({
            description: "アイテムマスター",
            primary_key: "id",
            header: [
                { key: 0, name: "id",    type: "int" },
                { key: 1, name: "name",  type: "string" },
                { key: 2, name: "value", type: "int" },
            ],
        }),
        "data/item.csv": [
            "id,name,value",
            "1,sword,100",
            "2,shield,200",
        ].join("\n"),
        "schema/enemy.json": JSON.stringify({
            description: "敵マスター",
            primary_key: "id",
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "ja", type: "string" },
            ],
        }),
        "data/enemy.csv": [
            "id,ja",
            "1,スライム",
            "2,ドラゴン",
        ].join("\n"),
        "schema/quest.json": JSON.stringify({
            // description なし（フィールド未定義）
            primary_key: "id",
            header: [
                { key: 0, name: "id",   type: "int" },
                { key: 1, name: "name", type: "string" },
            ],
        }),
        "data/quest.csv": [
            "id,name",
            "1,first_quest",
        ].join("\n"),
    };
}

/**
 * エクスプローラーからテーブルをクリックしてタブを開く。
 * エクスプローラーの要素をクリックするだけで、テーブルの可視性は検証しない。
 */
async function clickExplorerFileAsync(page: Page, tableName: string): Promise<void> {
    const explorer = page.locator('#explorer');
    await explorer.locator('.explorer-file .explorer-file-name', { hasText: tableName }).click();
}

/**
 * エクスプローラーのファイルノード Locator を取得する（テーブル名で検索）
 */
function getExplorerFile(page: Page, tableName: string) {
    return page.locator('#explorer .explorer-file').filter({
        has: page.locator('.explorer-file-name', { hasText: tableName }),
    });
}

// =============================================================================
// テスト1: エクスプローラーでファイルをクリックすると explorer-file-active が付く
// =============================================================================
test.describe('エクスプローラーアクティブハイライト', () => {

    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createTestFileSystem());
        await page.goto('/');
    });

    // -------------------------------------------------------------------------
    // テスト1-1: ファイルをクリックしたとき explorer-file-active クラスが付与される
    // -------------------------------------------------------------------------
    test(
        'itemファイルをクリックしたとき explorer-file-active クラスが付与されること',
        async ({ page }) => {
            await clickExplorerFileAsync(page, 'item');

            // item ファイルノードに explorer-file-active クラスが付与される
            const itemFile = getExplorerFile(page, 'item');
            await expect(itemFile).toHaveClass(/explorer-file-active/);
        },
    );

    // -------------------------------------------------------------------------
    // テスト1-2: 別のファイルに切り替えると前のファイルのハイライトが外れ、
    //            新しいファイルにハイライトが付く
    // -------------------------------------------------------------------------
    test(
        '別のファイルに切り替えたとき前のファイルのハイライトが外れ新しいファイルにハイライトが付くこと',
        async ({ page }) => {
            // まず item を開く
            await clickExplorerFileAsync(page, 'item');
            const itemFile = getExplorerFile(page, 'item');
            await expect(itemFile).toHaveClass(/explorer-file-active/);

            // 次に enemy を開く（タブ切り替え）
            await clickExplorerFileAsync(page, 'enemy');

            // item のハイライトが外れる
            await expect(itemFile).not.toHaveClass(/explorer-file-active/);

            // enemy のハイライトが付く
            const enemyFile = getExplorerFile(page, 'enemy');
            await expect(enemyFile).toHaveClass(/explorer-file-active/);
        },
    );

    // -------------------------------------------------------------------------
    // テスト1-3: タブを閉じて全タブがなくなったとき、ハイライトが全て外れる
    // -------------------------------------------------------------------------
    test(
        'タブを閉じて全タブがなくなったとき explorer-file-active クラスを持つ要素がないこと',
        async ({ page }) => {
            // item を開いてアクティブにする
            await clickExplorerFileAsync(page, 'item');
            const itemFile = getExplorerFile(page, 'item');
            await expect(itemFile).toHaveClass(/explorer-file-active/);

            // item タブの閉じるボタンをクリックしてタブを閉じる
            const tabButton = page.locator('.tab-button').filter({ hasText: 'item' }).first();
            await tabButton.locator('.tab-button-close').click();

            // explorer-file-active クラスを持つ要素が一切存在しないこと
            await expect(page.locator('#explorer .explorer-file-active')).toHaveCount(0);
        },
    );
});

// =============================================================================
// テスト2: エクスプローラーのファイルノードが2行構造で表示される
// =============================================================================
test.describe('エクスプローラーファイルノードの2行表示', () => {

    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createTestFileSystem());
        await page.goto('/');
    });

    // -------------------------------------------------------------------------
    // テスト2-1: description あり → .explorer-file-description と .explorer-file-name の2行構造
    // -------------------------------------------------------------------------
    test(
        'descriptionありのテーブル（item）のファイルノードが2行構造で表示されること',
        async ({ page }) => {
            // item はエクスプローラーに初期表示されるため、クリック不要
            const itemFile = getExplorerFile(page, 'item');
            await expect(itemFile).toBeVisible();

            // .explorer-file-description 要素が存在し、description テキストを表示する
            const descriptionSpan = itemFile.locator('.explorer-file-description');
            await expect(descriptionSpan).toBeVisible();
            await expect(descriptionSpan).toHaveText('アイテムマスター');

            // .explorer-file-name 要素が存在し、テーブル名を表示する
            const nameSpan = itemFile.locator('.explorer-file-name');
            await expect(nameSpan).toBeVisible();
            await expect(nameSpan).toHaveText('item');
        },
    );

    // -------------------------------------------------------------------------
    // テスト2-2: description なし → .explorer-file-description は存在しない（1行表示）
    // -------------------------------------------------------------------------
    test(
        'descriptionなしのテーブル（quest）のファイルノードが1行表示（explorer-file-description なし）であること',
        async ({ page }) => {
            const questFile = getExplorerFile(page, 'quest');
            await expect(questFile).toBeVisible();

            // .explorer-file-description 要素が存在しないこと
            await expect(questFile.locator('.explorer-file-description')).toHaveCount(0);

            // .explorer-file-name 要素が存在し、テーブル名を表示する
            const nameSpan = questFile.locator('.explorer-file-name');
            await expect(nameSpan).toBeVisible();
            await expect(nameSpan).toHaveText('quest');
        },
    );

    // -------------------------------------------------------------------------
    // テスト2-3: enemy テーブルのファイルノードの description が正しく表示される
    // -------------------------------------------------------------------------
    test(
        'descriptionありのテーブル（enemy）のファイルノードに正しいdescriptionが表示されること',
        async ({ page }) => {
            const enemyFile = getExplorerFile(page, 'enemy');
            await expect(enemyFile).toBeVisible();

            const descriptionSpan = enemyFile.locator('.explorer-file-description');
            await expect(descriptionSpan).toBeVisible();
            await expect(descriptionSpan).toHaveText('敵マスター');
        },
    );
});

// =============================================================================
// テスト3: タブボタンが2行構造で表示される
// =============================================================================
test.describe('タブボタンの2行表示', () => {

    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createTestFileSystem());
        await page.goto('/');
    });

    // -------------------------------------------------------------------------
    // テスト3-1: description あり → .tab-button-description と .tab-button-name の2行構造
    // -------------------------------------------------------------------------
    test(
        'descriptionありのテーブル（item）を開いたとき、タブボタンが2行構造になること',
        async ({ page }) => {
            // item タブを開く（エクスプローラーからクリック）
            const explorer = page.locator('#explorer');
            await explorer.locator('.explorer-file-name', { hasText: 'item' }).click();

            // タブボタンを取得（tab-button-label 内に description と name が入る）
            const tabButton = page.locator('.tab-button').filter({
                has: page.locator('.tab-button-name', { hasText: 'item' }),
            }).first();
            await expect(tabButton).toBeVisible();

            // .tab-button-label コンテナが存在すること
            const label = tabButton.locator('.tab-button-label');
            await expect(label).toBeVisible();

            // .tab-button-description が存在し、description テキストを表示すること
            const descriptionSpan = label.locator('.tab-button-description');
            await expect(descriptionSpan).toBeVisible();
            await expect(descriptionSpan).toHaveText('アイテムマスター');

            // .tab-button-name が存在し、テーブル名を表示すること
            const nameSpan = label.locator('.tab-button-name');
            await expect(nameSpan).toBeVisible();
            await expect(nameSpan).toHaveText('item');
        },
    );

    // -------------------------------------------------------------------------
    // テスト3-2: description なし → .tab-button-description は存在しない（1行表示）
    // -------------------------------------------------------------------------
    test(
        'descriptionなしのテーブル（quest）を開いたとき、タブボタンに tab-button-description が存在しないこと',
        async ({ page }) => {
            const explorer = page.locator('#explorer');
            await explorer.locator('.explorer-file-name', { hasText: 'quest' }).click();

            const tabButton = page.locator('.tab-button').filter({
                has: page.locator('.tab-button-name', { hasText: 'quest' }),
            }).first();
            await expect(tabButton).toBeVisible();

            // .tab-button-description が存在しないこと（description=nullなら不要）
            await expect(tabButton.locator('.tab-button-description')).toHaveCount(0);

            // .tab-button-name は存在しテーブル名を表示すること
            const nameSpan = tabButton.locator('.tab-button-name');
            await expect(nameSpan).toBeVisible();
            await expect(nameSpan).toHaveText('quest');
        },
    );

    // -------------------------------------------------------------------------
    // テスト3-3: .tab-button-container（閉じるボタン等）が .tab-button-label とは別のコンテナに存在すること
    // -------------------------------------------------------------------------
    test(
        'タブボタンが tab-button-label と tab-button-container の2コンテナ構造であること',
        async ({ page }) => {
            const explorer = page.locator('#explorer');
            await explorer.locator('.explorer-file-name', { hasText: 'item' }).click();

            const tabButton = page.locator('.tab-button').filter({
                has: page.locator('.tab-button-name', { hasText: 'item' }),
            }).first();
            await expect(tabButton).toBeVisible();

            // .tab-button-label が存在すること
            await expect(tabButton.locator('.tab-button-label')).toBeVisible();

            // .tab-button-container が存在すること（閉じるボタン等を格納するコンテナ）
            await expect(tabButton.locator('.tab-button-container')).toBeVisible();
        },
    );

    // -------------------------------------------------------------------------
    // テスト3-4: 別のタブに切り替えると、アクティブなタブボタンのハイライトが移る
    //            （tab-button-active クラスが正しく付け替えられること）
    //            ※ タブボタンの2行構造採用後もタブ切り替え動作が維持されること
    // -------------------------------------------------------------------------
    test(
        '2行構造タブボタンで別のタブに切り替えると tab-button-active が正しく付け替えられること',
        async ({ page }) => {
            const explorer = page.locator('#explorer');

            // item を開く
            await explorer.locator('.explorer-file-name', { hasText: 'item' }).click();
            const itemTabButton = page.locator('.tab-button').filter({
                has: page.locator('.tab-button-name', { hasText: 'item' }),
            }).first();
            await expect(itemTabButton).toHaveClass(/tab-button-active/);

            // enemy を開く
            await explorer.locator('.explorer-file-name', { hasText: 'enemy' }).click();
            const enemyTabButton = page.locator('.tab-button').filter({
                has: page.locator('.tab-button-name', { hasText: 'enemy' }),
            }).first();

            // item の tab-button-active が外れる
            await expect(itemTabButton).not.toHaveClass(/tab-button-active/);

            // enemy の tab-button-active が付く
            await expect(enemyTabButton).toHaveClass(/tab-button-active/);
        },
    );
});

// =============================================================================
// テスト4: FEAT_0041 — エクスプローラーでテーブル名が説明の前に表示されること
// =============================================================================
// テストデータ: description に "\n" 含む item テーブルを追加して切り捨ても検証する
// =============================================================================

/**
 * FEAT_0041 用のファイルシステム
 * item: description に改行を含む（"アイテムマスタ\n詳細説明"）
 * enemy: 通常の description
 * quest: description なし
 */
function createFeat0041FileSystem(): MockFileSystem {
    return {
        "schema/item.json": JSON.stringify({
            description: "アイテムマスタ\n詳細説明",
            primary_key: "id",
            header: [
                { key: 0, name: "id",    type: "int" },
                { key: 1, name: "name",  type: "string" },
                { key: 2, name: "value", type: "int" },
            ],
        }),
        "data/item.csv": [
            "id,name,value",
            "1,sword,100",
        ].join("\n"),
        "schema/enemy.json": JSON.stringify({
            description: "敵マスター",
            primary_key: "id",
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "ja", type: "string" },
            ],
        }),
        "data/enemy.csv": [
            "id,ja",
            "1,スライム",
        ].join("\n"),
        "schema/quest.json": JSON.stringify({
            primary_key: "id",
            header: [
                { key: 0, name: "id",   type: "int" },
                { key: 1, name: "name", type: "string" },
            ],
        }),
        "data/quest.csv": [
            "id,name",
            "1,first_quest",
        ].join("\n"),
    };
}

test.describe('FEAT_0041: エクスプローラーでテーブル名が説明の前に表示されること', () => {

    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createFeat0041FileSystem());
        await page.goto('/');
    });

    // -------------------------------------------------------------------------
    // テスト4-1: .explorer-file の最初の子要素が .explorer-file-name であること
    // -------------------------------------------------------------------------
    test(
        'エクスプローラーのファイルノードで最初の子要素が .explorer-file-name であること',
        async ({ page }) => {
            const itemFile = getExplorerFile(page, 'item');
            await expect(itemFile).toBeVisible();

            // 最初の子要素が .explorer-file-name であること（テーブル名が1行目）
            const firstChild = itemFile.locator(':scope > :first-child');
            await expect(firstChild).toHaveClass(/explorer-file-name/);

            // 次の子要素が .explorer-file-description であること（説明が2行目）
            const secondChild = itemFile.locator(':scope > :nth-child(2)');
            await expect(secondChild).toHaveClass(/explorer-file-description/);
        },
    );

    // -------------------------------------------------------------------------
    // テスト4-2: description の \n 以降が表示されないこと（"アイテムマスタ" のみ表示）
    // -------------------------------------------------------------------------
    test(
        'エクスプローラーの説明で \\n 以降が切り捨てられ1行目のみ表示されること',
        async ({ page }) => {
            const itemFile = getExplorerFile(page, 'item');
            await expect(itemFile).toBeVisible();

            // .explorer-file-description のテキストが \n より前の部分のみであること
            const descriptionSpan = itemFile.locator('.explorer-file-description');
            await expect(descriptionSpan).toBeVisible();
            await expect(descriptionSpan).toHaveText('アイテムマスタ');
        },
    );
});

// =============================================================================
// テスト5: FEAT_0041 — タブでテーブル名が説明の前に表示されること
// =============================================================================

test.describe('FEAT_0041: タブでテーブル名が説明の前に表示されること', () => {

    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createFeat0041FileSystem());
        await page.goto('/');
    });

    // -------------------------------------------------------------------------
    // テスト5-1: .tab-button-label の最初の子要素が .tab-button-name であること
    // -------------------------------------------------------------------------
    test(
        'タブの .tab-button-label で最初の子要素が .tab-button-name であること',
        async ({ page }) => {
            // item タブを開く
            const explorer = page.locator('#explorer');
            await explorer.locator('.explorer-file-name', { hasText: 'item' }).click();

            const tabButton = page.locator('.tab-button').filter({
                has: page.locator('.tab-button-name', { hasText: 'item' }),
            }).first();
            await expect(tabButton).toBeVisible();

            const label = tabButton.locator('.tab-button-label');
            await expect(label).toBeVisible();

            // .tab-button-label の最初の子要素が .tab-button-name であること（テーブル名が1行目）
            const firstChild = label.locator(':scope > :first-child');
            await expect(firstChild).toHaveClass(/tab-button-name/);

            // 次の子要素が .tab-button-description であること（説明が2行目）
            const secondChild = label.locator(':scope > :nth-child(2)');
            await expect(secondChild).toHaveClass(/tab-button-description/);
        },
    );

    // -------------------------------------------------------------------------
    // テスト5-2: タブの description で \n 以降が切り捨てられること
    // -------------------------------------------------------------------------
    test(
        'タブの説明で \\n 以降が切り捨てられ1行目のみ表示されること',
        async ({ page }) => {
            const explorer = page.locator('#explorer');
            await explorer.locator('.explorer-file-name', { hasText: 'item' }).click();

            const tabButton = page.locator('.tab-button').filter({
                has: page.locator('.tab-button-name', { hasText: 'item' }),
            }).first();
            await expect(tabButton).toBeVisible();

            const label = tabButton.locator('.tab-button-label');
            const descriptionSpan = label.locator('.tab-button-description');
            await expect(descriptionSpan).toBeVisible();
            // \n 以降が切り捨てられた "アイテムマスタ" のみ表示されること
            await expect(descriptionSpan).toHaveText('アイテムマスタ');
        },
    );
});
