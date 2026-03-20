import { test, expect } from './fixtures/test';
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
): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText('test').click();
    // RelationsPanelにもミニEditorTableが表示されるため、左ペインのEditorTableに限定する
    const table = page.locator('.editor-left-pane .editor-table');
    await expect(table).toBeVisible();
    return table;
}

/**
 * 指定した行・列の参照ヒント要素のLocatorを返す
 * rowIndex: 0始まり（ヘッダー行を除く）
 * colIndex: 0始まり（行ヘッダーを除く）
 */
function getReferenceHint(
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
    return cell.locator('.cell-reference-hint');
}

// -------------------------------------------------------
// 単純参照（1段目）のテスト
// -------------------------------------------------------
test.describe('単純参照の参照名表示', () => {
    test.beforeEach(async ({ page }) => {
        const fs: MockFileSystem = {
            "schema/test.json": JSON.stringify({
                header: [
                    { key: 0, name: "id", type: "int" },
                    {
                        key: 1,
                        name: "name",
                        type: "string",
                    },
                    {
                        key: 2,
                        name: "enemy_id",
                        type: "int",
                        reference: "enemy.ja",
                    },
                ],
                primary_key: ["id"],
            }),
            "data/test.csv": [
                "id,name,enemy_id",
                "1,quest_a,1",
                "2,quest_b,2",
                "3,quest_c,3",
            ].join("\n"),
            "schema/enemy.json": JSON.stringify({
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
            "data/enemy.csv": [
                "id,ja",
                "1,スライム",
                "2,ドラゴン",
                "3,ゴブリン",
            ].join("\n"),
        };
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        '参照列のセルに参照先の表示名がヒントとして'
        + '表示されること',
        async ({ page }) => {
            const table = await openTableAsync(page);

            // 参照ヒントは非同期でpreloadされるため、
            // 最初のヒントが出現するまで待機する
            const firstHint =
                getReferenceHint(table, 0, 2);
            await expect(firstHint).toBeVisible();

            // 各行のenemy_id列（colIndex=2）の
            // 参照ヒントを検証
            await expect(firstHint)
                .toHaveText('スライム');
            await expect(
                getReferenceHint(table, 1, 2)
            ).toHaveText('ドラゴン');
            await expect(
                getReferenceHint(table, 2, 2)
            ).toHaveText('ゴブリン');
        },
    );
});

// -------------------------------------------------------
// 動的参照（二段リスト）のテスト
// -------------------------------------------------------
test.describe('動的参照（二段リスト）の参照名表示', () => {
    test.beforeEach(async ({ page }) => {
        // テストテーブル:
        //   type_id → type_map.ja への単純参照
        //   item_id → $(type_map.id == $type_id)
        //             .master_table.ja への動的参照
        //
        // type_map テーブル:
        //   id=1 → 武器, master_table=weapon
        //   id=2 → 防具, master_table=armor
        //
        // weapon テーブル: id=1→剣, id=2→槍
        // armor テーブル:  id=1→盾, id=2→鎧
        const fs: MockFileSystem = {
            "schema/test.json": JSON.stringify({
                header: [
                    { key: 0, name: "id", type: "int" },
                    {
                        key: 1,
                        name: "type_id",
                        type: "int",
                        reference: "type_map.ja",
                    },
                    {
                        key: 2,
                        name: "item_id",
                        type: "int",
                        reference:
                            "$(type_map.id == $type_id)"
                            + ".master_table.ja",
                    },
                ],
                primary_key: ["id"],
            }),
            "data/test.csv": [
                "id,type_id,item_id",
                "1,1,1",
                "2,1,2",
                "3,2,1",
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
                primary_key: ["id"],
            }),
            "data/type_map.csv": [
                "id,ja,master_table",
                "1,武器,weapon",
                "2,防具,armor",
            ].join("\n"),
            "schema/weapon.json": JSON.stringify({
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
            "data/weapon.csv": [
                "id,ja",
                "1,剣",
                "2,槍",
            ].join("\n"),
            "schema/armor.json": JSON.stringify({
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
            "data/armor.csv": [
                "id,ja",
                "1,盾",
                "2,鎧",
            ].join("\n"),
        };
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        '単純参照列にtype_mapの表示名が'
        + 'ヒントとして表示されること',
        async ({ page }) => {
            const table = await openTableAsync(page);

            // type_id列（colIndex=1）の参照ヒントを検証
            const firstHint =
                getReferenceHint(table, 0, 1);
            await expect(firstHint).toBeVisible();

            // Row 0: type_id=1 → 武器
            await expect(firstHint)
                .toHaveText('武器');
            // Row 1: type_id=1 → 武器
            await expect(
                getReferenceHint(table, 1, 1)
            ).toHaveText('武器');
            // Row 2: type_id=2 → 防具
            await expect(
                getReferenceHint(table, 2, 1)
            ).toHaveText('防具');
        },
    );

    test(
        '動的参照列にtype_idに応じた参照先テーブルの'
        + '表示名がヒントとして表示されること',
        async ({ page }) => {
            const table = await openTableAsync(page);

            // item_id列（colIndex=2）の参照ヒントを検証
            // 動的参照は複数段階の非同期解決を経るため
            // 出現を待機する
            const firstHint =
                getReferenceHint(table, 0, 2);
            await expect(firstHint).toBeVisible();

            // Row 0: type_id=1(武器)
            //   → weapon → id=1 → 剣
            await expect(firstHint)
                .toHaveText('剣');
            // Row 1: type_id=1(武器)
            //   → weapon → id=2 → 槍
            await expect(
                getReferenceHint(table, 1, 2)
            ).toHaveText('槍');
            // Row 2: type_id=2(防具)
            //   → armor → id=1 → 盾
            await expect(
                getReferenceHint(table, 2, 2)
            ).toHaveText('盾');
        },
    );
});
