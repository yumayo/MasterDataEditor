import { test, expect } from '@playwright/test';
import { Page, Locator } from '@playwright/test';
import {
    installMockApiAsync,
    MockFileSystem,
} from './fixtures/mock-api';

/**
 * エディターテーブルが表示されるまで待機し、
 * テーブルのLocatorを返す
 */
async function openTableAsync(
    page: Page,
    tableName: string,
): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName).click();
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

test.describe('逆参照ヒントのフィルタリング', () => {
    test(
        'referenceDisplayColumnPriorityに該当する列がない'
        + '子テーブルは逆参照ヒントに表示されないこと',
        async ({ page }) => {
            // parent テーブル: id, ja
            // child_with_ja: id, parent_id(→parent.id), ja
            //   → ja列あり → ヒント表示対象
            // child_without_ja: id, parent_id(→parent.id), code
            //   → ja列なし → ヒント表示対象外
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

            // child_with_ja のみ表示される
            // child_without_ja は ja列がないため除外
            const hint =
                getReverseReferenceHint(table, 0, 0);
            await expect(hint).toBeVisible();
            await expect(hint)
                .toHaveText('スキルA');
        },
    );
});
