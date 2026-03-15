import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// 列ヘッダーPK/FKバッジ表示テスト（FEAT_0016）
//
// 実装すべき機能:
//   1. PK列のヘッダーに `.column-header-badge--pk` クラスを持つ「PK」バッジを表示する
//   2. FK列のヘッダーに `.column-header-badge--fk` クラスを持つ「FK」バッジを表示する
//   3. 通常列にはバッジを表示しない
//   4. FKバッジのtitle属性に参照先テーブル情報を含める
//   5. PKバッジのtitle属性を「このテーブルの主キー列です」とする
// =============================================================================

// テスト1・3・4-6で共通利用するskillテーブルのモックデータ
const skillMockFs: MockFileSystem = {
    "schema/skill.json": JSON.stringify({
        description: "スキルマスター",
        primary_key: "id",
        header: [
            { key: 0, name: "id",                  type: "int",    comment: "ID" },
            { key: 1, name: "name",                type: "string", comment: "スキル名" },
            { key: 2, name: "skill_value_type_id", type: "int",    comment: "効果タイプ", reference: "skill_value_type.id" },
        ],
    }),
    "data/skill.csv": [
        "id,name,skill_value_type_id",
        "1,slash,1",
        "2,thunder,2",
    ].join("\n"),
};

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
    const headerRow = table.locator('.editor-table-column-header-row');
    return headerRow.locator('.editor-table-column-header').nth(colIndex);
}

// =============================================================================
// テスト1: PK列にPKバッジが表示される
// =============================================================================
test.describe('PK列のバッジ表示', () => {

    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, skillMockFs);
        await page.goto('/');
    });

    // ---------------------------------------------------------------------------
    // テスト1-1: id列（PK列）のヘッダーに .column-header-badge--pk が表示される
    // ---------------------------------------------------------------------------
    test(
        'id列（PK列）のヘッダーセルに .column-header-badge--pk 要素が存在すること',
        async ({ page }) => {
            const table = await openTableAsync(page, 'skill');

            // id 列は colIndex=0
            const idHeader = getColumnHeaderCell(table, 0);

            // .column-header-badge--pk 要素が存在してテキストが「PK」であることを確認する
            const pkBadge = idHeader.locator('.column-header-badge--pk');
            await expect(pkBadge).toBeVisible();
            await expect(pkBadge).toHaveText('PK');
        },
    );

    // ---------------------------------------------------------------------------
    // テスト1-2: PKバッジのtitle属性が「このテーブルの主キー列です」である
    // ---------------------------------------------------------------------------
    test(
        'id列（PK列）の .column-header-badge--pk のtitle属性が「このテーブルの主キー列です」であること',
        async ({ page }) => {
            const table = await openTableAsync(page, 'skill');

            const idHeader = getColumnHeaderCell(table, 0);
            const pkBadge = idHeader.locator('.column-header-badge--pk');

            // PKバッジにツールチップ文字列が設定されていることを確認する
            await expect(pkBadge).toHaveAttribute('title', 'このテーブルの主キー列です');
        },
    );
});

// =============================================================================
// テスト2: FK列にFKバッジが表示される
// =============================================================================
test.describe('FK列のバッジ表示', () => {

    test.beforeEach(async ({ page }) => {
        // shop_product テーブル: id（PK）/ group_id（通常列）/ table_id（FK: table.id）
        const fs: MockFileSystem = {
            "schema/shop_product.json": JSON.stringify({
                description: "ショップ商品マスター",
                primary_key: "id",
                header: [
                    { key: 0, name: "id",       type: "int", comment: "ID" },
                    { key: 1, name: "group_id",  type: "int", comment: "グループID" },
                    { key: 2, name: "table_id",  type: "int", comment: "テーブルID", reference: "table.id" },
                ],
            }),
            "data/shop_product.csv": [
                "id,group_id,table_id",
                "1,1,2",
                "2,1,3",
            ].join("\n"),
        };
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    // ---------------------------------------------------------------------------
    // テスト2-1: table_id列（FK列）のヘッダーに .column-header-badge--fk が表示される
    // ---------------------------------------------------------------------------
    test(
        'table_id列（FK列）のヘッダーセルに .column-header-badge--fk 要素が存在すること',
        async ({ page }) => {
            const table = await openTableAsync(page, 'shop_product');

            // table_id 列は colIndex=2
            const tableIdHeader = getColumnHeaderCell(table, 2);

            // .column-header-badge--fk 要素が存在してテキストが「FK」であることを確認する
            const fkBadge = tableIdHeader.locator('.column-header-badge--fk');
            await expect(fkBadge).toBeVisible();
            await expect(fkBadge).toHaveText('FK');
        },
    );

    // ---------------------------------------------------------------------------
    // テスト2-2: FKバッジのtitle属性に参照先テーブル情報が含まれる
    // ---------------------------------------------------------------------------
    test(
        'table_id列（FK列）の .column-header-badge--fk のtitle属性に参照先テーブル情報が含まれること',
        async ({ page }) => {
            const table = await openTableAsync(page, 'shop_product');

            const tableIdHeader = getColumnHeaderCell(table, 2);
            const fkBadge = tableIdHeader.locator('.column-header-badge--fk');

            // FKバッジのtitle属性に参照先テーブル「table.id」の情報が含まれていることを確認する
            await expect(fkBadge).toHaveAttribute('title', /table/);
        },
    );
});

// =============================================================================
// テスト3: 通常列にはバッジが表示されない
// =============================================================================
test.describe('通常列にはバッジが表示されない', () => {

    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, skillMockFs);
        await page.goto('/');
    });

    // ---------------------------------------------------------------------------
    // テスト3-1: name列（通常列）のヘッダーに .column-header-badge が存在しない
    // ---------------------------------------------------------------------------
    test(
        'name列（通常列）のヘッダーセルに .column-header-badge 要素が存在しないこと',
        async ({ page }) => {
            const table = await openTableAsync(page, 'skill');

            // name 列は colIndex=1
            const nameHeader = getColumnHeaderCell(table, 1);

            // 通常列にはバッジ要素が一切存在しないことを確認する
            // プロダクションコードでバッジ生成ロジックが誤って通常列にも適用された場合に失敗する
            await expect(nameHeader.locator('.column-header-badge')).toHaveCount(0);
            await expect(nameHeader.locator('.column-header-badge--pk')).toHaveCount(0);
            await expect(nameHeader.locator('.column-header-badge--fk')).toHaveCount(0);
        },
    );
});

// =============================================================================
// テスト4・5・6: PK/FKバッジが .column-header-badge-area コンテナ内に格納されている
//
// 要件: バッジを列ヘッダー左側の専用コンテナ（.column-header-badge-area）に配置する。
//   ソート/フィルターアイコンが右側に配置されているのと対称的に、バッジは左側に配置される。
//
// 期待するDOM構造:
//   .editor-table-column-header
//   ├── .column-header-badge-area  ← 左側コンテナ（position: absolute; left側）
//   │   ├── .column-header-badge--pk  [PKの場合]
//   │   └── .column-header-badge--fk  [FKの場合]
//   ├── 列名部分
//   ├── .filter-icon（右側）
//   ├── .sort-indicator（右側）
//   └── .column-resize-handle
// =============================================================================
test.describe('PK/FKバッジが .column-header-badge-area コンテナ内に格納されている', () => {

    // テスト4（PK列）・テスト5（FK列）・テスト6（通常列）の3ケースをまとめてカバーする
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, skillMockFs);
        await page.goto('/');
    });

    // ---------------------------------------------------------------------------
    // テスト4: id列（PK列）のヘッダーに .column-header-badge-area が存在し、
    //          PKバッジがその子要素として格納されている
    // ---------------------------------------------------------------------------
    test(
        'id列（PK列）のヘッダーセルに .column-header-badge-area が存在し、PKバッジがその子要素であること',
        async ({ page }) => {
            const table = await openTableAsync(page, 'skill');

            // id 列は colIndex=0
            const idHeader = getColumnHeaderCell(table, 0);

            // .column-header-badge-area コンテナ自体が存在することを確認する
            const badgeArea = idHeader.locator('.column-header-badge-area');
            await expect(badgeArea).toBeVisible();

            // PKバッジがコンテナの子要素として格納されていることを確認する
            // （ヘッダー直下ではなく、.column-header-badge-area 内に入っていることを保証する）
            const pkBadgeInArea = badgeArea.locator('.column-header-badge--pk');
            await expect(pkBadgeInArea).toBeVisible();
            await expect(pkBadgeInArea).toHaveText('PK');
        },
    );

    // ---------------------------------------------------------------------------
    // テスト5: skill_value_type_id列（FK列）のヘッダーに .column-header-badge-area が存在し、
    //          FKバッジがその子要素として格納されている
    // ---------------------------------------------------------------------------
    test(
        'skill_value_type_id列（FK列）のヘッダーセルに .column-header-badge-area が存在し、FKバッジがその子要素であること',
        async ({ page }) => {
            const table = await openTableAsync(page, 'skill');

            // skill_value_type_id 列は colIndex=2
            const fkHeader = getColumnHeaderCell(table, 2);

            // .column-header-badge-area コンテナ自体が存在することを確認する
            const badgeArea = fkHeader.locator('.column-header-badge-area');
            await expect(badgeArea).toBeVisible();

            // FKバッジがコンテナの子要素として格納されていることを確認する
            const fkBadgeInArea = badgeArea.locator('.column-header-badge--fk');
            await expect(fkBadgeInArea).toBeVisible();
            await expect(fkBadgeInArea).toHaveText('FK');
        },
    );

    // ---------------------------------------------------------------------------
    // テスト6: name列（通常列）のヘッダーには .column-header-badge-area が存在しない
    // ---------------------------------------------------------------------------
    test(
        'name列（通常列）のヘッダーセルに .column-header-badge-area 要素が存在しないこと',
        async ({ page }) => {
            const table = await openTableAsync(page, 'skill');

            // name 列は colIndex=1
            const nameHeader = getColumnHeaderCell(table, 1);

            // 通常列にはバッジエリアコンテナ自体が存在しないことを確認する
            // バッジが不要な列にコンテナが生成されてしまうと、DOMが余分に汚染されるため検出する
            await expect(nameHeader.locator('.column-header-badge-area')).toHaveCount(0);
        },
    );
});
