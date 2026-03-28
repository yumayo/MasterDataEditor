import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem} from './fixtures/mock-api';

/**
 * エディターテーブルが表示されるまで待機し、
 * テーブルのLocatorを返す
 */
async function openTableAsync(
    page: Page,
    tableName: string,
): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer
        .getByText(tableName, { exact: true })
        .click();
    // RelationsPanelにもミニEditorTableが表示されるため、左ペインのEditorTableに限定する
    const table = page.locator('.editor-left-pane .editor-table');
    await expect(table).toBeVisible();
    return table;
}

/**
 * 指定した行・列の逆参照ヒント要素のLocatorを返す
 * rowIndex: 0始まり（ヘッダー行を除く）
 * colIndex: 0始まり（行ヘッダーを除く）
 */
function getReverseReferenceHint(
    table: Locator,
    rowIndex: number,
    colIndex: number,
): Locator {
    const row = table
        .locator('.editor-table-row')
        .nth(rowIndex + 1);
    const cell = row
        .locator(
            '.editor-table-cell'
            + ':not(.editor-table-row-header)'
        )
        .nth(colIndex);
    return cell.locator(
        '.cell-reverse-reference-hint'
    );
}

/**
 * 指定した行・列のデータセルを返す
 * rowIndex: 0始まり（ヘッダー行を除く）
 * colIndex: 0始まり（行ヘッダーを除く）
 */
function getDataCell(table: Locator, rowIndex: number, colIndex: number): Locator {
    const row = table.locator('.editor-table-row').nth(rowIndex + 1);
    return row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
}

/**
 * 指定した行・列の参照ヒント要素のLocatorを返す
 * rowIndex: 0始まり（ヘッダー行を除く）
 * colIndex: 0始まり（行ヘッダーを除く）
 */
function getReferenceHint(table: Locator, rowIndex: number, colIndex: number): Locator {
    return getDataCell(table, rowIndex, colIndex).locator('.cell-reference-hint');
}

/**
 * セルの値を編集する
 * ダブルクリックで編集モードに入り、
 * 全選択→新しい値を入力→Enterで確定
 */
async function editCellAsync(page: Page, table: Locator, rowIndex: number, colIndex: number, newValue: string): Promise<void> {
    const cell = getDataCell(table, rowIndex, colIndex);
    await cell.dblclick();
    const editField = page.locator('.grid-textfield-active');
    await expect(editField).toBeVisible();
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText(newValue);
    await page.keyboard.press('Enter');
}

// -------------------------------------------------------
// 逆参照ヒントのテスト
// -------------------------------------------------------
test.describe('逆参照ヒントの表示', () => {
    test.beforeEach(async ({ page }) => {
        // parent テーブル: id, ja
        // child_a テーブル: id, parent_id(→parent.id), ja
        //   parent_id=1 が1件（スキルA）
        // child_b テーブル: id, parent_id(→parent.id), ja
        //   parent_id=1 が3件, parent_id=2 が2件
        const fs: MockFileSystem = {
            "schema/parent.json": JSON.stringify({
                header: [
                    { key: 0, name: "id", type: "int" },
                    {
                        key: 1,
                        name: "ja",
                        type: "string",
                    },
                ],
                primary_key: ["id"],
            }),
            "data/parent.csv": [
                "id,ja",
                "1,勇者",
                "2,魔法使い",
                "3,戦士",
            ].join("\n"),
            "schema/child_a.json": JSON.stringify({
                header: [
                    { key: 0, name: "id", type: "int" },
                    {
                        key: 1,
                        name: "parent_id",
                        type: "int",
                        reference: "parent.id",
                    },
                    {
                        key: 2,
                        name: "ja",
                        type: "string",
                    },
                ],
                primary_key: ["id"],
            }),
            "data/child_a.csv": [
                "id,parent_id,ja",
                "1,1,スキルA",
            ].join("\n"),
            "schema/child_b.json": JSON.stringify({
                header: [
                    { key: 0, name: "id", type: "int" },
                    {
                        key: 1,
                        name: "parent_id",
                        type: "int",
                        reference: "parent.id",
                    },
                    {
                        key: 2,
                        name: "ja",
                        type: "string",
                    },
                ],
                primary_key: ["id"],
            }),
            "data/child_b.csv": [
                "id,parent_id,ja",
                "1,1,アイテムX",
                "2,1,アイテムY",
                "3,1,アイテムZ",
                "4,2,アイテムP",
                "5,2,アイテムQ",
            ].join("\n"),
        };
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        '1件かつ表示名ありのエントリのみ'
        + 'インライン表示されること',
        async ({ page }) => {
            const table =
                await openTableAsync(page, 'parent');

            // 逆参照ヒントは非同期で解決されるため、
            // 最初のヒントが出現するまで待機する
            const firstHint =
                getReverseReferenceHint(table, 0, 0);
            await expect(firstHint).toBeVisible();

            // id=1: child_a(1件, "スキルA") → インライン表示
            //   child_b(3件) → スキップ（REFERENCESパネル）
            await expect(firstHint)
                .toHaveText('スキルA');

            // id=2: child_b(2件) → インライン表示なし
            await expect(
                getReverseReferenceHint(table, 1, 0)
            ).not.toBeVisible();

            // id=3: 逆参照なし → ヒント非表示
            await expect(
                getReverseReferenceHint(table, 2, 0)
            ).not.toBeVisible();
        },
    );
});

// -------------------------------------------------------
// 動的参照（二段階リスト）の逆参照ヒントのテスト
// -------------------------------------------------------
test.describe('動的参照の逆参照ヒント表示', () => {
    /**
     * テストデータ:
     * test テーブル: id, type_id(→type_map.id),
     *   item_id(→$(type_map.id == $type_id).master_table.id)
     * type_map: id=1→武器/weapon, id=2→防具/armor
     * weapon: id のみ
     * weapon_name: id(→weapon.id), ja (剣, 槍)
     * armor: id のみ
     * armor_name: id(→armor.id), ja (盾, 兜)
     *
     * weapon を開くと PK列に逆参照ヒント:
     *   weapon_name から 剣/槍、test から test(N)
     * armor を開くと PK列に逆参照ヒント:
     *   armor_name から 盾/兜、test から test(N)
     * test を開くと type_id列に参照ヒント: 武器/防具
     */
    const createDynamicRefFs = (): MockFileSystem => ({
        "schema/test.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                {
                    key: 1,
                    name: "type_id",
                    type: "int",
                    reference: "type_map.id",
                },
                {
                    key: 2,
                    name: "item_id",
                    type: "int",
                    reference: {
                        sourceTable: "type_map",
                        sourceMatchColumn: "id",
                        sourceMatchValue: "type_id",
                        destTable: "master_table",
                        destColumn: "column",
                    },
                },
            ],
            primary_key: ["id"],
        }),
        "data/test.csv": [
            "id,type_id,item_id",
            "1,1,1",
            "2,1,2",
            "3,2,1",
            "4,2,2",
        ].join("\n"),
        "schema/type_map.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                {
                    key: 1,
                    name: "ja",
                    type: "string",
                },
                {
                    key: 2,
                    name: "master_table",
                    type: "string",
                },
                {
                    key: 3,
                    name: "column",
                    type: "string",
                },
            ],
            primary_key: ["id"],
        }),
        "data/type_map.csv": [
            "id,ja,master_table,column",
            "1,武器,weapon,id",
            "2,防具,armor,id",
        ].join("\n"),
        "schema/weapon.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
            ],
            primary_key: ["id"],
        }),
        "data/weapon.csv": [
            "id",
            "1",
            "2",
        ].join("\n"),
        "schema/weapon_name.json": JSON.stringify({
            header: [
                {
                    key: 0,
                    name: "id",
                    type: "int",
                    reference: "weapon.id",
                },
                {
                    key: 1,
                    name: "ja",
                    type: "string",
                },
            ],
            primary_key: ["id"],
        }),
        "data/weapon_name.csv": [
            "id,ja",
            "1,剣",
            "2,槍",
        ].join("\n"),
        "schema/armor.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
            ],
            primary_key: ["id"],
        }),
        "data/armor.csv": [
            "id",
            "1",
            "2",
        ].join("\n"),
        "schema/armor_name.json": JSON.stringify({
            header: [
                {
                    key: 0,
                    name: "id",
                    type: "int",
                    reference: "armor.id",
                },
                {
                    key: 1,
                    name: "ja",
                    type: "string",
                },
            ],
            primary_key: ["id"],
        }),
        "data/armor_name.csv": [
            "id,ja",
            "1,盾",
            "2,兜",
        ].join("\n"),
    });

    test('weapon テーブルに逆参照ヒントが表示されること',
        async ({ page }) => {
            await installMockApiAsync(
                page, createDynamicRefFs()
            );
            await page.goto('/');

            const table =
                await openTableAsync(page, 'weapon');

            const hint0 =
                getReverseReferenceHint(table, 0, 0);
            await expect(hint0).toBeVisible();

            // weapon id=1:
            //   weapon_name(1件, ja=剣) → インライン表示
            //   test(1件, 表示名なし) → スキップ
            await expect(hint0)
                .toHaveText('剣');

            // weapon id=2:
            //   weapon_name(1件, ja=槍) → インライン表示
            //   test(1件, 表示名なし) → スキップ
            const hint1 =
                getReverseReferenceHint(table, 1, 0);
            await expect(hint1).toBeVisible();
            await expect(hint1)
                .toHaveText('槍');
        },
    );

    test('armor テーブルに逆参照ヒントが表示されること',
        async ({ page }) => {
            await installMockApiAsync(
                page, createDynamicRefFs()
            );
            await page.goto('/');

            const table =
                await openTableAsync(page, 'armor');

            const hint0 =
                getReverseReferenceHint(table, 0, 0);
            await expect(hint0).toBeVisible();

            // armor id=1:
            //   armor_name(1件, ja=盾) → インライン表示
            //   test(1件, 表示名なし) → スキップ
            await expect(hint0)
                .toHaveText('盾');

            // armor id=2:
            //   armor_name(1件, ja=兜) → インライン表示
            //   test(1件, 表示名なし) → スキップ
            const hint1 =
                getReverseReferenceHint(table, 1, 0);
            await expect(hint1).toBeVisible();
            await expect(hint1)
                .toHaveText('兜');
        },
    );

    test('test テーブルに武器/防具/剣/槍/盾/兜の'
        + '参照ヒントが表示されること',
        async ({ page }) => {
            await installMockApiAsync(
                page, createDynamicRefFs()
            );
            await page.goto('/');

            const table =
                await openTableAsync(page, 'test');

            // type_id 列（colIndex=1）
            // type_map.id を参照 → ja列の値が表示
            await expect(
                getReferenceHint(table, 0, 1)
            ).toBeVisible();

            // 行1,2: type_id=1 → 武器
            await expect(
                getReferenceHint(table, 0, 1)
            ).toHaveText('武器');
            await expect(
                getReferenceHint(table, 1, 1)
            ).toHaveText('武器');

            // 行3,4: type_id=2 → 防具
            await expect(
                getReferenceHint(table, 2, 1)
            ).toHaveText('防具');
            await expect(
                getReferenceHint(table, 3, 1)
            ).toHaveText('防具');

            // item_id 列（colIndex=2）
            // 動的参照で weapon/armor に解決され、
            // 逆参照チェーンを辿り
            // weapon_name/armor_name の ja 列が表示される
            // 行1: type_id=1→weapon, item_id=1 → 剣
            await expect(
                getReferenceHint(table, 0, 2)
            ).toHaveText('剣');

            // 行2: type_id=1→weapon, item_id=2 → 槍
            await expect(
                getReferenceHint(table, 1, 2)
            ).toHaveText('槍');

            // 行3: type_id=2→armor, item_id=1 → 盾
            await expect(
                getReferenceHint(table, 2, 2)
            ).toHaveText('盾');

            // 行4: type_id=2→armor, item_id=2 → 兜
            await expect(
                getReferenceHint(table, 3, 2)
            ).toHaveText('兜');
        },
    );

    test('逆参照されているPK列でダブルクリックすると'
        + 'プルダウンが表示されること',
        async ({ page }) => {
            await installMockApiAsync(
                page, createDynamicRefFs()
            );
            await page.goto('/');

            const table =
                await openTableAsync(page, 'weapon');

            // 逆参照ヒントが表示されるまで待機
            const hint =
                getReverseReferenceHint(table, 0, 0);
            await expect(hint).toBeVisible();

            // PK列のセルをダブルクリック
            const row = table
                .locator('.editor-table-row')
                .nth(1);
            const pkCell = row.locator(
                '.editor-table-cell'
                + ':not(.editor-table-row-header)'
            ).nth(0);
            await pkCell.dblclick();

            // プルダウンが表示されること（左ペインのものに限定してstrict mode violationを回避）
            const dropdown = page.locator(
                '.editor-left-pane .grid-dropdown-list'
            );
            await expect(dropdown).toBeVisible();

            // 既存のPK値（1, 2）がリストに含まれる
            await expect(
                dropdown.locator('.grid-dropdown-item')
            ).toHaveCount(2);
        },
    );
});

test.describe('逆参照ヒントの表示形式', () => {
    test(
        '1件かつ表示名ありのみインライン表示され、'
        + '複数件や表示名なしはスキップされること',
        async ({ page }) => {
            // parent テーブル: id, ja
            // child_with_ja: id, parent_id(→parent.id), ja
            //   → 1件かつ表示テキストあり → インライン表示
            // child_without_ja: id, parent_id(→parent.id), code
            //   → 2件 → スキップ（REFERENCESパネル）
            const fs: MockFileSystem = {
                "schema/parent.json": JSON.stringify({
                    header: [
                        {
                            key: 0,
                            name: "id",
                            type: "int",
                        },
                        {
                            key: 1,
                            name: "ja",
                            type: "string",
                        },
                    ],
                    primary_key: ["id"],
                }),
                "data/parent.csv": [
                    "id,ja",
                    "1,勇者",
                ].join("\n"),
                "schema/child_with_ja.json":
                    JSON.stringify({
                        header: [
                            {
                                key: 0,
                                name: "id",
                                type: "int",
                            },
                            {
                                key: 1,
                                name: "parent_id",
                                type: "int",
                                reference: "parent.id",
                            },
                            {
                                key: 2,
                                name: "ja",
                                type: "string",
                            },
                        ],
                        primary_key: ["id"],
                    }),
                "data/child_with_ja.csv": [
                    "id,parent_id,ja",
                    "1,1,スキルA",
                ].join("\n"),
                "schema/child_without_ja.json":
                    JSON.stringify({
                        header: [
                            {
                                key: 0,
                                name: "id",
                                type: "int",
                            },
                            {
                                key: 1,
                                name: "parent_id",
                                type: "int",
                                reference: "parent.id",
                            },
                            {
                                key: 2,
                                name: "code",
                                type: "string",
                            },
                        ],
                        primary_key: ["id"],
                    }),
                "data/child_without_ja.csv": [
                    "id,parent_id,code",
                    "1,1,CODE_X",
                    "2,1,CODE_Y",
                ].join("\n"),
            };
            await installMockApiAsync(page, fs);
            await page.goto('/');

            const table =
                await openTableAsync(page, 'parent');

            // child_with_ja(1件, "スキルA") → インライン表示
            // child_without_ja(2件) → スキップ
            const hint =
                getReverseReferenceHint(table, 0, 0);
            await expect(hint).toBeVisible();
            await expect(hint).toHaveText(
                'スキルA'
            );
        },
    );
});

// -------------------------------------------------------
// 表示列編集時に参照ヒントが即座に更新されるテスト
// -------------------------------------------------------
test.describe('表示列編集時の参照ヒント同期更新', () => {
    /**
     * テストデータ:
     * chara: id(PK) のみ（表示列なし）
     * chara_name: id(PK, FK→chara.id), ja
     *
     * chara_name.id は chara.id を参照するが、
     * chara に表示列がないため逆参照チェーンにより
     * chara_name.ja の値が参照ヒントとして表示される。
     * chara_name.ja を編集したとき、
     * chara_name.id の参照ヒントが即座に更新されること。
     */
    function createFs(): MockFileSystem {
        return {
            "schema/chara.json": JSON.stringify({
                header: [
                    { key: 0, name: "id", type: "int" },
                ],
                primary_key: ["id"],
            }),
            "data/chara.csv": [
                "id",
                "1",
                "2",
            ].join("\n"),
            "schema/chara_name.json": JSON.stringify({
                header: [
                    { key: 0, name: "id", type: "int", reference: "chara.id" },
                    { key: 1, name: "ja", type: "string" },
                ],
                primary_key: ["id"],
            }),
            "data/chara_name.csv": [
                "id,ja",
                "1,勇者",
                "2,魔法使い",
            ].join("\n"),
        };
    }

    test('表示列を編集すると同一行の参照ヒントが即座に更新されること', async ({ page }) => {
        await installMockApiAsync(page, createFs());
        await page.goto('/');

        const table = await openTableAsync(page, 'chara_name');

        // 逆参照チェーンで解決された参照ヒントが表示されるまで待機
        // id列(colIndex=0) に chara テーブルの逆参照チェーンヒントが表示される
        const hint0 = getReferenceHint(table, 0, 0);
        await expect(hint0).toBeVisible();
        await expect(hint0).toHaveText('勇者');

        // ja列(colIndex=1) を編集: "勇者" → "英雄"
        await editCellAsync(page, table, 0, 1, '英雄');

        // id列の参照ヒントが即座に更新されること
        await expect(hint0).toHaveText('英雄');

        // 2行目のヒントは変更されていないこと
        await expect(getReferenceHint(table, 1, 0)).toHaveText('魔法使い');
    });

    test('Undoすると参照ヒントが元の値に戻ること', async ({ page }) => {
        await installMockApiAsync(page, createFs());
        await page.goto('/');

        const table = await openTableAsync(page, 'chara_name');

        // 参照ヒントが表示されるまで待機
        const hint0 = getReferenceHint(table, 0, 0);
        await expect(hint0).toBeVisible();
        await expect(hint0).toHaveText('勇者');

        // ja列を編集: "勇者" → "英雄"
        await editCellAsync(page, table, 0, 1, '英雄');
        await expect(hint0).toHaveText('英雄');

        // Undo
        await page.keyboard.press('Control+z');

        // 参照ヒントが元の値に戻ること
        await expect(hint0).toHaveText('勇者');
    });
});

// -------------------------------------------------------
// 逆参照の表示優先度テスト
// -------------------------------------------------------
test.describe('逆参照の表示優先度', () => {
    test(
        '優先度に基づくフィルタリング: '
        + '最高優先度のエントリのみインライン表示されること',
        async ({ page }) => {
            // parent: id列のみ
            // child_high: reverseReferencePriority=1, parent.id を参照, ja列あり
            // child_low: reverseReferencePriority=2, parent.id を参照, ja列あり
            // parent.id=1 をそれぞれ1件ずつ参照
            const fs: MockFileSystem = {
                "schema/parent.json": JSON.stringify({
                    header: [
                        { key: 0, name: "id", type: "int" },
                    ],
                    primary_key: ["id"],
                }),
                "data/parent.csv": [
                    "id",
                    "1",
                ].join("\n"),
                "schema/child_high.json": JSON.stringify({
                    header: [
                        { key: 0, name: "id", type: "int" },
                        { key: 1, name: "parent_id", type: "int", reference: "parent.id" },
                        { key: 2, name: "ja", type: "string" },
                    ],
                    primary_key: ["id"],
                    reverseReferencePriority: 1,
                }),
                "data/child_high.csv": [
                    "id,parent_id,ja",
                    "1,1,高優先の名前",
                ].join("\n"),
                "schema/child_low.json": JSON.stringify({
                    header: [
                        { key: 0, name: "id", type: "int" },
                        { key: 1, name: "parent_id", type: "int", reference: "parent.id" },
                        { key: 2, name: "ja", type: "string" },
                    ],
                    primary_key: ["id"],
                    reverseReferencePriority: 2,
                }),
                "data/child_low.csv": [
                    "id,parent_id,ja",
                    "1,1,低優先の説明",
                ].join("\n"),
            };
            await installMockApiAsync(page, fs);
            await page.goto('/');

            const table = await openTableAsync(page, 'parent');

            // 逆参照ヒントが表示されるまで待機
            const hint = getReverseReferenceHint(table, 0, 0);
            await expect(hint).toBeVisible();

            // 優先度1の child_high の ja 値のみ表示されること
            // 優先度2の child_low の ja 値は表示されないこと
            await expect(hint).toHaveText('高優先の名前');
        },
    );

    test(
        '優先度未設定は最低優先: '
        + '優先度設定済みのエントリのみ表示されること',
        async ({ page }) => {
            // parent: id列のみ
            // child_priority: reverseReferencePriority=1, parent.id を参照, ja列あり
            // child_none: reverseReferencePriority 未設定, parent.id を参照, ja列あり
            const fs: MockFileSystem = {
                "schema/parent.json": JSON.stringify({
                    header: [
                        { key: 0, name: "id", type: "int" },
                    ],
                    primary_key: ["id"],
                }),
                "data/parent.csv": [
                    "id",
                    "1",
                ].join("\n"),
                "schema/child_priority.json": JSON.stringify({
                    header: [
                        { key: 0, name: "id", type: "int" },
                        { key: 1, name: "parent_id", type: "int", reference: "parent.id" },
                        { key: 2, name: "ja", type: "string" },
                    ],
                    primary_key: ["id"],
                    reverseReferencePriority: 1,
                }),
                "data/child_priority.csv": [
                    "id,parent_id,ja",
                    "1,1,優先あり名前",
                ].join("\n"),
                "schema/child_none.json": JSON.stringify({
                    header: [
                        { key: 0, name: "id", type: "int" },
                        { key: 1, name: "parent_id", type: "int", reference: "parent.id" },
                        { key: 2, name: "ja", type: "string" },
                    ],
                    primary_key: ["id"],
                }),
                "data/child_none.csv": [
                    "id,parent_id,ja",
                    "1,1,未設定名前",
                ].join("\n"),
            };
            await installMockApiAsync(page, fs);
            await page.goto('/');

            const table = await openTableAsync(page, 'parent');

            // 逆参照ヒントが表示されるまで待機
            const hint = getReverseReferenceHint(table, 0, 0);
            await expect(hint).toBeVisible();

            // reverseReferencePriority=1 の child_priority の ja 値のみ表示
            // reverseReferencePriority 未設定の child_none は最低優先で除外
            await expect(hint).toHaveText('優先あり名前');
        },
    );

    test(
        '同一優先度は両方表示: '
        + '同じ優先度を持つエントリが全てカンマ区切りで表示されること',
        async ({ page }) => {
            // parent: id列のみ
            // child_a: reverseReferencePriority=1, parent.id を参照, ja列あり
            // child_b: reverseReferencePriority=1, parent.id を参照, ja列あり
            const fs: MockFileSystem = {
                "schema/parent.json": JSON.stringify({
                    header: [
                        { key: 0, name: "id", type: "int" },
                    ],
                    primary_key: ["id"],
                }),
                "data/parent.csv": [
                    "id",
                    "1",
                ].join("\n"),
                "schema/child_a.json": JSON.stringify({
                    header: [
                        { key: 0, name: "id", type: "int" },
                        { key: 1, name: "parent_id", type: "int", reference: "parent.id" },
                        { key: 2, name: "ja", type: "string" },
                    ],
                    primary_key: ["id"],
                    reverseReferencePriority: 1,
                }),
                "data/child_a.csv": [
                    "id,parent_id,ja",
                    "1,1,名前A",
                ].join("\n"),
                "schema/child_b.json": JSON.stringify({
                    header: [
                        { key: 0, name: "id", type: "int" },
                        { key: 1, name: "parent_id", type: "int", reference: "parent.id" },
                        { key: 2, name: "ja", type: "string" },
                    ],
                    primary_key: ["id"],
                    reverseReferencePriority: 1,
                }),
                "data/child_b.csv": [
                    "id,parent_id,ja",
                    "1,1,名前B",
                ].join("\n"),
            };
            await installMockApiAsync(page, fs);
            await page.goto('/');

            const table = await openTableAsync(page, 'parent');

            // 逆参照ヒントが表示されるまで待機
            const hint = getReverseReferenceHint(table, 0, 0);
            await expect(hint).toBeVisible();

            // 同一優先度（reverseReferencePriority=1）の child_a, child_b
            // 両方の ja 値がカンマ区切りで表示されること
            // エントリの列挙順が不定のため、どちらの並び順でも許容する
            await expect(hint).toHaveText(
                /^(名前A, 名前B|名前B, 名前A)$/
            );
        },
    );

    test(
        '逆参照チェーンでの優先度: '
        + 'FK列の参照ヒントが最高優先度の子テーブルで解決されること',
        async ({ page }) => {
            // parent: id のみ（表示列なし）
            //   → 逆参照チェーンで表示テキストを解決する
            // aaa_child_low: id(PK, FK→parent.id), ja
            //   → reverseReferencePriority=2
            //   → アルファベット順で先に列挙される（現実装では先にbreakされる）
            // zzz_child_high: id(PK, FK→parent.id), ja
            //   → reverseReferencePriority=1
            //   → 優先度ベースの選択により、こちらが選ばれるべき
            // other: id, parent_id(FK→parent.id)
            //   → other を開いて parent_id 列の参照ヒントを確認
            const fs: MockFileSystem = {
                "schema/parent.json": JSON.stringify({
                    header: [
                        { key: 0, name: "id", type: "int" },
                    ],
                    primary_key: ["id"],
                }),
                "data/parent.csv": [
                    "id",
                    "1",
                    "2",
                ].join("\n"),
                "schema/aaa_child_low.json": JSON.stringify({
                    header: [
                        { key: 0, name: "id", type: "int", reference: "parent.id" },
                        { key: 1, name: "ja", type: "string" },
                    ],
                    primary_key: ["id"],
                    reverseReferencePriority: 2,
                }),
                "data/aaa_child_low.csv": [
                    "id,ja",
                    "1,低優先テキスト",
                    "2,低優先テキスト2",
                ].join("\n"),
                "schema/zzz_child_high.json": JSON.stringify({
                    header: [
                        { key: 0, name: "id", type: "int", reference: "parent.id" },
                        { key: 1, name: "ja", type: "string" },
                    ],
                    primary_key: ["id"],
                    reverseReferencePriority: 1,
                }),
                "data/zzz_child_high.csv": [
                    "id,ja",
                    "1,高優先テキスト",
                    "2,高優先テキスト2",
                ].join("\n"),
                "schema/other.json": JSON.stringify({
                    header: [
                        { key: 0, name: "id", type: "int" },
                        { key: 1, name: "parent_id", type: "int", reference: "parent.id" },
                    ],
                    primary_key: ["id"],
                }),
                "data/other.csv": [
                    "id,parent_id",
                    "1,1",
                    "2,2",
                ].join("\n"),
            };
            await installMockApiAsync(page, fs);
            await page.goto('/');

            const table = await openTableAsync(page, 'other');

            // parent_id 列（colIndex=1）の参照ヒント
            // parent テーブルに表示列がないため、逆参照チェーンで解決される
            // reverseReferencePriority=1 の zzz_child_high が選択されるべき
            const hint0 = getReferenceHint(table, 0, 1);
            await expect(hint0).toBeVisible();
            await expect(hint0).toHaveText('高優先テキスト');

            const hint1 = getReferenceHint(table, 1, 1);
            await expect(hint1).toBeVisible();
            await expect(hint1).toHaveText('高優先テキスト2');
        },
    );
});

// -------------------------------------------------------
// PK列の逆参照ヒント配置テスト（ISSUE_0136）
// -------------------------------------------------------
test.describe('PK列の逆参照ヒント配置', () => {
    test(
        'PK列のint値が逆参照ヒントの右側に配置される（ISSUE_0136）',
        async ({ page }) => {
            // parent: id(PK, int), ja(string)
            // child_name: id(PK), parent_id(FK→parent.id), ja(string)
            //   parent_id=1 が1件（"名前A"）→ parent.id=1 に逆参照ヒント表示
            const fs: MockFileSystem = {
                "schema/parent.json": JSON.stringify({
                    header: [
                        { key: 0, name: "id", type: "int" },
                        { key: 1, name: "ja", type: "string" },
                    ],
                    primary_key: ["id"],
                }),
                "data/parent.csv": [
                    "id,ja",
                    "1,勇者",
                ].join("\n"),
                "schema/child_name.json": JSON.stringify({
                    header: [
                        { key: 0, name: "id", type: "int" },
                        { key: 1, name: "parent_id", type: "int", reference: "parent.id" },
                        { key: 2, name: "ja", type: "string" },
                    ],
                    primary_key: ["id"],
                }),
                "data/child_name.csv": [
                    "id,parent_id,ja",
                    "1,1,名前A",
                ].join("\n"),
            };
            await installMockApiAsync(page, fs);
            await page.goto('/');

            const table = await openTableAsync(page, 'parent');

            // PK列（id, int型）に逆参照ヒントが表示されるまで待機
            const pkCell = getDataCell(table, 0, 0);
            const hint = pkCell.locator('.cell-reverse-reference-hint');
            await expect(hint).toBeVisible();
            await expect(hint).toHaveText('名前A');

            // PK列は int 型なので cell-numeric クラスが付与されていること
            await expect(pkCell).toHaveClass(/cell-numeric/);

            // 逆参照ヒントの boundingRect.left が PK値テキストノードの boundingRect.left より小さい
            // → ヒントが数値の左側に配置されていること
            const positions = await pkCell.evaluate((el) => {
                const hintEl = el.querySelector('.cell-reverse-reference-hint') as HTMLElement;
                if (!hintEl) return null;
                // テキストノード（PK値）の位置を取得する
                const range = document.createRange();
                for (const node of Array.from(el.childNodes)) {
                    if (node.nodeType === Node.TEXT_NODE && node.textContent!.trim() !== '') {
                        range.selectNodeContents(node);
                        break;
                    }
                }
                const textRect = range.getBoundingClientRect();
                const hintRect = hintEl.getBoundingClientRect();
                return { hintLeft: hintRect.left, textLeft: textRect.left };
            });

            expect(positions).not.toBeNull();
            // ヒントのleft < PK値テキストのleft → ヒントが数値の左に配置されている
            expect(positions!.hintLeft).toBeLessThan(positions!.textLeft);
        },
    );
});
