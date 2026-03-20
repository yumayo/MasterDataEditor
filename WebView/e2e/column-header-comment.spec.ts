import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// 列ヘッダーcomment表示 / タブdescription表示 テスト（FEAT_0004）
//
// 実装すべき機能:
//   1. 列ヘッダーセルにcomment（日本語名）とname（変数名）を2行で表示する
//      - comment あり: 上段に .column-header-name、下段に .column-header-comment
//      - comment なし: .column-header-comment 要素は生成しない（name のみ表示）
//   2. タブボタンにdescription（日本語説明）を表示する
//      - タブボタンのtextContentがdescriptionになる
//      - 元のテーブル名はtitle属性（ツールチップ）に設定される
//
// RED状態の理由:
//   - createColumnHeaderCell() が textContent = text のみで .column-header-comment /
//     .column-header-name の要素を生成していない
//   - TabButton.element.textContent がテーブルファイル名のままで description に更新されない
//   - TabButton.element.title が設定されていない
// =============================================================================

/**
 * テーブルを開き、左ペインの EditorTable Locator を返す
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName).click();
    // RelationsPanel にもミニテーブルが出るため左ペインに限定する
    const table = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="${tableName}"] .editor-table`);
    await expect(table).toBeVisible();
    return table;
}

/**
 * 指定した列インデックスのヘッダーセル Locator を返す（0始まり）
 */
function getColumnHeaderCell(table: Locator, colIndex: number): Locator {
    // ヘッダー行（0行目）のセルから行ヘッダー（コーナー）を除いた colIndex 番目
    const headerRow = table.locator('.editor-table-column-header-row');
    return headerRow.locator('.editor-table-column-header').nth(colIndex);
}

// =============================================================================
// テスト1: commentあり列にはcommentとnameの両方が表示される
// =============================================================================
test.describe('列ヘッダーへのcomment表示', () => {

    test.beforeEach(async ({ page }) => {
        // itemテーブル: id / name / attack(comment="攻撃値") / defense(comment="防御値")
        // id と name は comment なし（undefined）、attack と defense は comment あり
        const fs: MockFileSystem = {
            "schema/item.json": JSON.stringify({
                description: "アイテムマスタ",
                primary_key: ["id"],
                header: [
                    { key: 0, name: "id",      type: "int" },
                    { key: 1, name: "name",     type: "string" },
                    { key: 2, name: "attack",   type: "int", comment: "攻撃値" },
                    { key: 3, name: "defense",  type: "int", comment: "防御値" },
                ],
            }),
            "data/item.csv": [
                "id,name,attack,defense",
                "1,Sword,50,10",
                "2,Shield,5,80",
            ].join("\n"),
        };
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    // ---------------------------------------------------------------------------
    // テスト1-a: comment が存在する列ヘッダーに .column-header-comment が表示される
    // ---------------------------------------------------------------------------
    test(
        'commentあり列（attack）のヘッダーセルに .column-header-comment 要素が表示されること',
        async ({ page }) => {
            const table = await openTableAsync(page, 'item');

            // attack 列は colIndex=2（コーナーセルを除くと index=2 が attack）
            const attackHeader = getColumnHeaderCell(table, 2);

            // .column-header-comment 要素が存在し「攻撃値」が表示されることを確認する
            // プロダクションコードに .column-header-comment 生成ロジックが存在しないため失敗（RED）
            const commentEl = attackHeader.locator('.column-header-comment');
            await expect(commentEl).toBeVisible();
            await expect(commentEl).toHaveText('攻撃値');
        },
    );

    // ---------------------------------------------------------------------------
    // テスト1-b: comment が存在する列ヘッダーに .column-header-name が表示される
    // ---------------------------------------------------------------------------
    test(
        'commentあり列（attack）のヘッダーセルに .column-header-name 要素が表示されること',
        async ({ page }) => {
            const table = await openTableAsync(page, 'item');

            const attackHeader = getColumnHeaderCell(table, 2);

            // .column-header-name 要素が存在し変数名「attack」が表示されることを確認する
            // プロダクションコードに .column-header-name 生成ロジックが存在しないため失敗（RED）
            const nameEl = attackHeader.locator('.column-header-name');
            await expect(nameEl).toBeVisible();
            await expect(nameEl).toHaveText('attack');
        },
    );

    // ---------------------------------------------------------------------------
    // テスト1-c: defense 列も同様にcomment・nameの両方が表示される
    // ---------------------------------------------------------------------------
    test(
        'commentあり列（defense）のヘッダーセルにcommentとnameが表示されること',
        async ({ page }) => {
            const table = await openTableAsync(page, 'item');

            const defenseHeader = getColumnHeaderCell(table, 3);

            await expect(defenseHeader.locator('.column-header-comment')).toHaveText('防御値');
            await expect(defenseHeader.locator('.column-header-name')).toHaveText('defense');
        },
    );

    // ---------------------------------------------------------------------------
    // テスト2-a: comment が未定義の列には .column-header-comment が存在しない
    // ---------------------------------------------------------------------------
    test(
        'commentなし列（id）のヘッダーセルに .column-header-comment 要素が存在しないこと',
        async ({ page }) => {
            const table = await openTableAsync(page, 'item');

            // id 列は colIndex=0
            const idHeader = getColumnHeaderCell(table, 0);

            // .column-header-comment 要素が存在しないことを確認する
            // commentなしの列にまで .column-header-comment を生成してしまうと失敗する（RED時は逆に合格する可能性があるが
            // プロダクション実装後に正しく機能することを保証するため明示する）
            await expect(idHeader.locator('.column-header-comment')).toHaveCount(0);
        },
    );

    // ---------------------------------------------------------------------------
    // テスト2-b: comment が未定義の列では name テキストが直接表示される
    // ---------------------------------------------------------------------------
    test(
        'commentなし列（name）のヘッダーセルに変数名「name」が表示されること',
        async ({ page }) => {
            const table = await openTableAsync(page, 'item');

            // name 列は colIndex=1
            const nameHeader = getColumnHeaderCell(table, 1);

            // comment なしの列では .column-header-comment は存在せず、
            // ヘッダーセルのテキストに直接 "name" が含まれることを確認する
            await expect(nameHeader.locator('.column-header-comment')).toHaveCount(0);
            // textContent 全体に変数名が含まれていること（.column-header-name でも素のテキストでも可）
            await expect(nameHeader).toContainText('name');
        },
    );
});

// =============================================================================
// テスト（FEAT_0049）: 列ヘッダーの表示順序 — name が上段、comment が下段
// =============================================================================
test.describe('FEAT_0049: 列ヘッダーの順序 — name上段・comment下段', () => {

    test.beforeEach(async ({ page }) => {
        const fs: MockFileSystem = {
            "schema/item.json": JSON.stringify({
                description: "アイテムマスタ",
                primary_key: ["id"],
                header: [
                    { key: 0, name: "id",     type: "int" },
                    { key: 1, name: "attack",  type: "int", comment: "攻撃値\n追加説明" },
                    { key: 2, name: "defense", type: "int", comment: "防御値" },
                ],
            }),
            "data/item.csv": [
                "id,attack,defense",
                "1,50,10",
            ].join("\n"),
        };
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    // ---------------------------------------------------------------------------
    // テスト: .column-header-name が .column-header-comment より上（先）に DOM 上で現れること
    // DOM 上の出現順序を previousElementSibling で検証する（display:block で縦並びになるため）
    // ---------------------------------------------------------------------------
    test(
        '.column-header-name が .column-header-comment より上（DOM上で先）に表示されること',
        async ({ page }) => {
            const table = await openTableAsync(page, 'item');
            // attack 列は colIndex=1
            const attackHeader = getColumnHeaderCell(table, 1);

            // nameEl が commentEl より DOM 上で先（上側）に現れることを verify する。
            // nameEl の直後の兄弟要素が commentEl であることを確認する（name → comment の順）
            const isNameBeforeComment = await attackHeader.evaluate((el: Element) => {
                const nameEl = el.querySelector('.column-header-name');
                const commentEl = el.querySelector('.column-header-comment');
                if (!nameEl || !commentEl) return false;
                // nameEl の nextElementSibling が commentEl であれば name が先
                return nameEl.nextElementSibling === commentEl;
            });
            // プロダクションコードが name→comment 順で appendChild するまで失敗（RED）
            expect(isNameBeforeComment).toBe(true);
        },
    );

    // ---------------------------------------------------------------------------
    // テスト: comment に \n が含まれる場合、\n 以降を切り捨てて最初の行のみ表示されること
    // ---------------------------------------------------------------------------
    test(
        'commentに\\nが含まれる場合は最初の行のみ表示されること',
        async ({ page }) => {
            const table = await openTableAsync(page, 'item');
            // attack 列の comment は "攻撃値\n追加説明" — \n 以降は表示しない
            const attackHeader = getColumnHeaderCell(table, 1);
            const commentEl = attackHeader.locator('.column-header-comment');

            await expect(commentEl).toBeVisible();
            // "追加説明" が表示されていないことを確認する（\n でカット）
            await expect(commentEl).toHaveText('攻撃値');
        },
    );
});

// =============================================================================
// テスト3: タブボタンに description が表示される
// =============================================================================
test.describe('タブへのdescription表示', () => {

    test.beforeEach(async ({ page }) => {
        const fs: MockFileSystem = {
            "schema/item.json": JSON.stringify({
                description: "アイテムマスタ",
                primary_key: ["id"],
                header: [
                    { key: 0, name: "id",   type: "int" },
                    { key: 1, name: "name", type: "string" },
                ],
            }),
            "data/item.csv": [
                "id,name",
                "1,Sword",
            ].join("\n"),
        };
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    // ---------------------------------------------------------------------------
    // テスト3-a: タブボタンの表示テキストがdescriptionになること
    // ---------------------------------------------------------------------------
    test(
        'itemテーブルを開くとタブボタンのテキストが "アイテムマスタ" になること',
        async ({ page }) => {
            // Explorer で item テーブルを開く
            await page.locator('#explorer').getByText('item').click();

            // タブボタンが表示されるまで待機する
            const tabButton = page.locator('.tab-button').filter({ hasText: 'アイテムマスタ' });

            // タブボタンのテキストが description（アイテムマスタ）になることを確認する
            // プロダクションコードでは TabButton.element.textContent が name のままのため失敗（RED）
            await expect(tabButton).toBeVisible();
        },
    );

    // ---------------------------------------------------------------------------
    // テスト3-b: タブボタンのtitle属性に元のテーブルファイル名が設定されること
    // ---------------------------------------------------------------------------
    test(
        'itemテーブルを開くとタブボタンのtitle属性が "item" になること',
        async ({ page }) => {
            // Explorer で item テーブルを開く
            await page.locator('#explorer').getByText('item').click();

            // タブバーに item のタブが表示されるまで待機する（description への更新前に存在確認）
            // 初期表示はファイル名なので、まず .tab-button が生成されることを確認する
            const tabBar = page.locator('#tab');
            await expect(tabBar.locator('.tab-button').first()).toBeVisible();

            // description 更新後のタブボタンを対象に title 属性を確認する
            // description が "アイテムマスタ" になった後のボタンに title="item" が設定されること
            // プロダクションコードで title 属性が設定されていないため失敗（RED）
            const tabButton = page.locator('.tab-button').filter({ hasText: 'アイテムマスタ' });
            await expect(tabButton).toHaveAttribute('title', 'item');
        },
    );
});
