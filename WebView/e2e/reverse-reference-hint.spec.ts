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
 * 指定した行・列の参照ヒント要素のLocatorを返す
 * rowIndex: 0始まり（ヘッダー行を除く）
 * colIndex: 0始まり（行ヘッダーを除く）
 */
function getReferenceHint(table: Locator, rowIndex: number, colIndex: number): Locator {
    const row = table.locator('.editor-table-row').nth(rowIndex + 1);
    const cell = row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
    return cell.locator('.cell-reference-hint');
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
        '複数テーブルから参照されるPK値に'
        + '逆参照ヒントが表示されること',
        async ({ page }) => {
            const table =
                await openTableAsync(page, 'parent');

            // 逆参照ヒントは非同期で解決されるため、
            // 最初のヒントが出現するまで待機する
            const firstHint =
                getReverseReferenceHint(table, 0, 0);
            await expect(firstHint).toBeVisible();

            // id=1: child_a(1件)+child_b(3件)
            // → "スキルA, child_b(3)"
            await expect(firstHint)
                .toHaveText('スキルA, child_b(3)');

            // id=2: child_b(2件)
            // → "child_b(2)"
            await expect(
                getReverseReferenceHint(table, 1, 0)
            ).toHaveText('child_b(2)');

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
            //   weapon_name(1件, ja=剣) + test(1件)
            await expect(hint0)
                .toHaveText('剣, test(1)');

            // weapon id=2:
            //   weapon_name(1件, ja=槍) + test(1件)
            const hint1 =
                getReverseReferenceHint(table, 1, 0);
            await expect(hint1).toBeVisible();
            await expect(hint1)
                .toHaveText('槍, test(1)');
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
            //   armor_name(1件, ja=盾) + test(1件)
            await expect(hint0)
                .toHaveText('盾, test(1)');

            // armor id=2:
            //   armor_name(1件, ja=兜) + test(1件)
            const hint1 =
                getReverseReferenceHint(table, 1, 0);
            await expect(hint1).toBeVisible();
            await expect(hint1)
                .toHaveText('兜, test(1)');
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
        '表示列がある子テーブルは表示テキスト、'
        + 'ない子テーブルはテーブル名(件数)で表示されること',
        async ({ page }) => {
            // parent テーブル: id, ja
            // child_with_ja: id, parent_id(→parent.id), ja
            //   → ja列あり → 表示テキスト使用
            // child_without_ja: id, parent_id(→parent.id), code
            //   → ja列なし → テーブル名(件数)形式
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

            // child_with_ja は表示テキスト "スキルA"
            // child_without_ja は ja列がないため
            // テーブル名(件数) 形式 "child_without_ja(2)"
            const hint =
                getReverseReferenceHint(table, 0, 0);
            await expect(hint).toBeVisible();
            await expect(hint).toHaveText(
                'スキルA, child_without_ja(2)'
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

            // view_charaを開く
            const explorer = page.locator('#explorer');
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
