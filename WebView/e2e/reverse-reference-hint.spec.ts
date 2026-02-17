import { test, expect } from '@playwright/test';
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
    const table = page.locator('.editor-table');
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
                primary_key: "id",
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
                primary_key: "id",
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
                primary_key: "id",
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
                    reference:
                        "$(type_map.id == $type_id)"
                        + ".master_table.id",
                },
            ],
            primary_key: "id",
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
            ],
            primary_key: "id",
        }),
        "data/type_map.csv": [
            "id,ja,master_table",
            "1,武器,weapon",
            "2,防具,armor",
        ].join("\n"),
        "schema/weapon.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
            ],
            primary_key: "id",
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
            primary_key: "id",
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
            primary_key: "id",
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
            primary_key: "id",
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

            // プルダウンが表示されること
            const dropdown = page.locator(
                '.grid-dropdown-list'
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
                    primary_key: "id",
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
                        primary_key: "id",
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
                        primary_key: "id",
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
// ビュータブでの逆参照ヒントのテスト
// -------------------------------------------------------
test.describe('ビュータブでの逆参照ヒント表示', () => {
    /**
     * テストデータ:
     * chara: id(PK), skill_id(→skill.id)
     * skill: id(PK), value
     * chara_name: id(PK), chara_id(→chara.id), ja
     * view_chara: charaベース、skillをJOIN
     *
     * chara.id=1 → chara_name に ja="勇者" の1件
     * chara.id=2 → chara_name に ja="魔法使い" の1件
     * chara.id=3 → 逆参照なし
     */
    function createViewFs(): MockFileSystem {
        return {
            "schema/chara.json": JSON.stringify({
                header: [
                    { key: 0, name: "id", type: "int" },
                    { key: 1, name: "skill_id", type: "int", reference: "skill.id" },
                ],
                primary_key: "id",
            }),
            "data/chara.csv": [
                "id,skill_id",
                "1,1",
                "2,1",
                "3,2",
            ].join("\n"),
            "schema/skill.json": JSON.stringify({
                header: [
                    { key: 0, name: "id", type: "int" },
                    { key: 1, name: "value", type: "int" },
                ],
                primary_key: "id",
            }),
            "data/skill.csv": [
                "id,value",
                "1,3",
                "2,5",
                "3,10",
            ].join("\n"),
            "schema/chara_name.json": JSON.stringify({
                header: [
                    { key: 0, name: "id", type: "int" },
                    { key: 1, name: "chara_id", type: "int", reference: "chara.id" },
                    { key: 2, name: "ja", type: "string" },
                ],
                primary_key: "id",
            }),
            "data/chara_name.csv": [
                "id,chara_id,ja",
                "1,1,勇者",
                "2,2,魔法使い",
            ].join("\n"),
            "view/view_chara.json": JSON.stringify({
                name: "view_chara",
                baseTable: "chara",
                joins: [
                    {
                        sourceColumn: "skill_id",
                        targetTable: "skill",
                        targetColumn: "id",
                        insertAfterViewColumnIndex: 1,
                    },
                ],
            }),
        };
    }

    test(
        'ビュータブのPK列に逆参照ヒントが'
        + '表示されること',
        async ({ page }) => {
            await installMockApiAsync(
                page, createViewFs()
            );
            await page.goto('/');

            // ビューパネルに切り替えてからview_charaを開く
            const explorer = page.locator('#explorer');
            await explorer.locator('[data-panel="views"]').click();
            await explorer
                .getByText('view_chara', { exact: true })
                .click();
            const table = page.locator(
                '.tab-wrapper'
                + ':not([style*="display: none"])'
                + ' .editor-table'
            );
            await expect(table).toBeVisible();

            // ビュー列: chara.id(0), chara.skill_id(1), skill.value(2)
            // 逆参照ヒントは非同期で解決されるため待機
            const firstHint =
                getReverseReferenceHint(table, 0, 0);
            await expect(firstHint).toBeVisible();

            // chara.id=1: chara_name(1件, ja=勇者)
            await expect(firstHint)
                .toHaveText('勇者');

            // chara.id=2: chara_name(1件, ja=魔法使い)
            await expect(
                getReverseReferenceHint(table, 1, 0)
            ).toHaveText('魔法使い');

            // chara.id=3: 逆参照なし → ヒント非表示
            await expect(
                getReverseReferenceHint(table, 2, 0)
            ).not.toBeVisible();
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
                primary_key: "id",
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
                primary_key: "id",
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
// ビューJOIN列の表示列編集時に参照ヒントが更新されるテスト
// -------------------------------------------------------
test.describe('ビューJOIN列編集時の参照ヒント同期更新', () => {
    /**
     * テストデータ:
     * reward_table: id(PK), ja（表示列あり）
     * quest: id(PK), clear_table_id(FK→reward_table.id), bonus_table_id(FK→reward_table.id)
     * view_quest: questベース、clear_table_idでreward_tableをJOIN
     *
     * ビュー列:
     *   col0: id, col1: clear_table_id, col2: reward_table.ja(JOIN列), col3: bonus_table_id
     *
     * quest行: id=1, clear_table_id=1, bonus_table_id=1
     *   → clear_table_id, bonus_table_id ともに reward_table id=1 を参照
     *   → 参照ヒントは "初回報酬"
     *
     * reward_table.ja(col2) を編集したとき、
     * bonus_table_id(col3) の参照ヒントが即座に更新されること。
     */
    function createViewQuestFs(): MockFileSystem {
        return {
            "schema/reward_table.json": JSON.stringify({
                header: [
                    { key: 0, name: "id", type: "int" },
                    { key: 1, name: "ja", type: "string" },
                ],
                primary_key: "id",
            }),
            "data/reward_table.csv": [
                "id,ja",
                "1,初回報酬",
                "2,連続報酬",
            ].join("\n"),
            "schema/quest.json": JSON.stringify({
                header: [
                    { key: 0, name: "id", type: "int" },
                    { key: 1, name: "clear_table_id", type: "int", reference: "reward_table.id" },
                    { key: 2, name: "bonus_table_id", type: "int", reference: "reward_table.id" },
                ],
                primary_key: "id",
            }),
            "data/quest.csv": [
                "id,clear_table_id,bonus_table_id",
                "1,1,1",
            ].join("\n"),
            "view/view_quest.json": JSON.stringify({
                name: "view_quest",
                baseTable: "quest",
                joins: [
                    {
                        sourceColumn: "clear_table_id",
                        targetTable: "reward_table",
                        targetColumn: "id",
                        insertAfterViewColumnIndex: 1,
                    },
                ],
            }),
        };
    }

    /**
     * ビュータブを開き、テーブルのLocatorを返す
     */
    async function openViewAsync(page: Page, viewName: string): Promise<Locator> {
        const explorer = page.locator('#explorer');
        // ビューパネルに切り替える
        await explorer.locator('[data-panel="views"]').click();
        await explorer.getByText(viewName, { exact: true }).click();
        const table = page.locator(
            '.tab-wrapper:not([style*="display: none"]) .editor-table'
        );
        await expect(table).toBeVisible();
        return table;
    }

    test('JOIN列の表示列を編集すると同一行のFK列参照ヒントが即座に更新されること', async ({ page }) => {
        await installMockApiAsync(page, createViewQuestFs());
        await page.goto('/');

        const table = await openViewAsync(page, 'view_quest');

        // ビュー列: id(0), clear_table_id(1), reward_table.ja(2), bonus_table_id(3)
        // bonus_table_id=1 → reward_table id=1 の参照ヒント "初回報酬"
        const bonusHint = getReferenceHint(table, 0, 3);
        await expect(bonusHint).toBeVisible();
        await expect(bonusHint).toHaveText('初回報酬');

        // reward_table.ja(col2) を編集: "初回報酬" → "特別報酬"
        await editCellAsync(page, table, 0, 2, '特別報酬');

        // bonus_table_id の参照ヒントが即座に更新されること
        await expect(bonusHint).toHaveText('特別報酬');
    });

    test('Undoすると参照ヒントが元の値に戻ること', async ({ page }) => {
        await installMockApiAsync(page, createViewQuestFs());
        await page.goto('/');

        const table = await openViewAsync(page, 'view_quest');

        // 参照ヒントが表示されるまで待機
        const bonusHint = getReferenceHint(table, 0, 3);
        await expect(bonusHint).toBeVisible();
        await expect(bonusHint).toHaveText('初回報酬');

        // reward_table.ja を編集
        await editCellAsync(page, table, 0, 2, '特別報酬');
        await expect(bonusHint).toHaveText('特別報酬');

        // Undo
        await page.keyboard.press('Control+z');

        // 参照ヒントが元の値に戻ること
        await expect(bonusHint).toHaveText('初回報酬');
    });
});
