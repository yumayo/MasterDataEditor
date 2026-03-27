import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// destColumn の動的解決を検証するテスト
//
// destColumn は中間テーブルの列名を指し、その列の値が参照先テーブルの実際の列名になる。
// destTable と同じパターンの間接参照（動的解決）を行う。
//
// テーブル構成:
//   type_map: id(PK), ja(表示列), master_table(テーブル名列), column(参照先列名列)
//     - id=1, ja=武器, master_table=weapon, column=id
//     - id=2, ja=防具, master_table=armor,  column=code （非PK列参照）
//
//   weapon: id(PK), ja(表示列)
//     - id=1, ja=剣
//     - id=2, ja=槍
//
//   armor: id(PK), ja(表示列), code(非PK列)
//     - id=1, ja=盾, code=S01
//     - id=2, ja=鎧, code=A01
//
//   test: id(PK), type_id(→type_map.ja), item_id(動的参照)
//
// ネガティブテスト:
//   destColumn = "nonexistent_column" → type_map にその列が存在しない
//   → targetColumn の動的解決が失敗する → 参照ヒントは表示されない
//
// ポジティブテスト（PK列参照パス）:
//   type_id=1 → type_map.column の値 "id" → weapon.id（PK列）でルックアップ
//   → getDisplayTextById() パスを通り、表示名がヒント表示される
//
// ポジティブテスト（非PK列参照パス）:
//   type_id=2 → type_map.column の値 "code" → armor.code（非PK列）でルックアップ
//   → findRowByColumn() パスを通り、表示列（ja）の値がヒント表示される
// =============================================================================

/**
 * ネガティブテスト用のファイルシステム（type_map に column 列なし）
 * destColumn に中間テーブルに存在しない列名を指定して、動的解決が失敗することを検証する
 */
function createNegativeTestFileSystem(): MockFileSystem {
    return {
        "schema/type_map.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "ja", type: "string" },
                { key: 2, name: "master_table", type: "string" },
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
                { key: 1, name: "ja", type: "string" },
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
                { key: 1, name: "ja", type: "string" },
            ],
            primary_key: ["id"],
        }),
        "data/armor.csv": [
            "id,ja",
            "1,盾",
            "2,鎧",
        ].join("\n"),
        "schema/test.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "type_id", type: "int", reference: "type_map.ja" },
                {
                    key: 2, name: "item_id", type: "int",
                    reference: {
                        sourceTable: "type_map",
                        sourceMatchColumn: "id",
                        sourceMatchValue: "type_id",
                        destTable: "master_table",
                        destColumn: "nonexistent_column",
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
        ].join("\n"),
    };
}

/**
 * ポジティブテスト用のファイルシステム（type_map に column 列あり）
 * destColumn = "column" → type_map.column の値が参照先テーブルの列名として動的解決される
 *
 * PK列参照パス: type_id=1 → type_map.column="id" → weapon.id（PK列）でルックアップ
 * 非PK列参照パス: type_id=2 → type_map.column="code" → armor.code（非PK列）でルックアップ
 */
function createPositiveTestFileSystem(): MockFileSystem {
    return {
        "schema/type_map.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "ja", type: "string" },
                { key: 2, name: "master_table", type: "string" },
                { key: 3, name: "column", type: "string" },
            ],
            primary_key: ["id"],
        }),
        "data/type_map.csv": [
            "id,ja,master_table,column",
            "1,武器,weapon,id",
            "2,防具,armor,code",
        ].join("\n"),
        "schema/weapon.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "ja", type: "string" },
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
                { key: 1, name: "ja", type: "string" },
                { key: 2, name: "code", type: "string" },
            ],
            primary_key: ["id"],
        }),
        "data/armor.csv": [
            "id,ja,code",
            "1,盾,S01",
            "2,鎧,A01",
        ].join("\n"),
        "schema/test.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "type_id", type: "int", reference: "type_map.ja" },
                {
                    key: 2, name: "item_id", type: "string",
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
            "3,2,S01",
            "4,2,A01",
        ].join("\n"),
    };
}

/**
 * エクスプローラーからテーブルを開き、左ペインの EditorTable の Locator を返す
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
    const activeTab = page.locator('.tab-button-active');
    await expect(activeTab).toHaveText(tableName);
    const table = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="${tableName}"] .editor-table`);
    await expect(table).toBeVisible();
    return table;
}

/**
 * 指定した行・列の参照ヒント要素の Locator を返す
 * rowIndex: 0始まり（ヘッダー行を除く）
 * colIndex: 0始まり（行ヘッダーを除く）
 */
function getReferenceHint(table: Locator, rowIndex: number, colIndex: number): Locator {
    const row = table.locator('.editor-table-row').nth(rowIndex + 1);
    const cell = row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
    return cell.locator('.cell-reference-hint');
}

// =============================================================================
// ネガティブテスト: destColumn が存在しない列名を指している場合
//
// destColumn = "nonexistent_column" を指定する。
// type_map テーブルに "nonexistent_column" 列は存在しないため、
// targetColumn の動的解決が失敗し、参照ヒントは表示されないのが正しい動作。
// =============================================================================
test.describe('destColumn が存在しない列名の場合、参照ヒントが表示されないこと', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createNegativeTestFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        'destColumn に存在しない列名を指定した動的参照では参照ヒントが表示されないこと',
        async ({ page }) => {
            const table = await openTableAsync(page, 'test');

            // type_id 列（colIndex=1）の単純参照ヒントは正常に表示されることを確認する
            // （動的参照の問題とは無関係なので、テスト環境の正常性検証として）
            const typeHint = getReferenceHint(table, 0, 1);
            await expect(typeHint).toBeVisible({ timeout: 5000 });
            await expect(typeHint).toHaveText('武器');

            // item_id 列（colIndex=2）の動的参照ヒントは表示されないことを検証する。
            // destColumn="nonexistent_column" は type_map に存在しない列名であるため、
            // targetColumn の動的解決が失敗し、参照ヒントは表示されるべきではない。
            const itemHintRow0 = getReferenceHint(table, 0, 2);
            await expect(itemHintRow0).toHaveCount(0);

            const itemHintRow1 = getReferenceHint(table, 1, 2);
            await expect(itemHintRow1).toHaveCount(0);

            const itemHintRow2 = getReferenceHint(table, 2, 2);
            await expect(itemHintRow2).toHaveCount(0);
        },
    );

    test(
        'destColumn に存在しない列名を指定した場合、ステータスバーのメッセージ欄に通知が表示されること',
        async ({ page }) => {
            await openTableAsync(page, 'test');

            // 動的参照の解決失敗時にステータスバーのメッセージ欄に通知されることを検証する。
            // destColumn="nonexistent_column" は type_map に存在しない列名であるため、
            // EditorTableReference.updateDynamicReferenceHint が通知を発行する。
            const message = page.locator('.notification-message');
            await expect(message).toContainText("nonexistent_column", { timeout: 5000 });
        },
    );
});

// =============================================================================
// ポジティブテスト: destColumn が正しい列名を指している場合
//
// PK列参照パス（getDisplayTextById パス）:
//   type_id=1 → type_map.column="id" → weapon.id（PK列）でルックアップ
//   → resolvedTargetColumn === primaryKeyColumnName なので getDisplayTextById() を使用
//
// 非PK列参照パス（findRowByColumn パス）:
//   type_id=2 → type_map.column="code" → armor.code（非PK列）でルックアップ
//   → resolvedTargetColumn !== primaryKeyColumnName なので findRowByColumn() で検索し、
//     表示列（ja）の値をヒント表示する
// =============================================================================
test.describe('destColumn が正しい列名の場合、参照ヒントが正しく表示されること', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createPositiveTestFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        'PK列参照パス: destColumn→"id"（PK列）で参照先テーブルの表示名がヒント表示されること',
        async ({ page }) => {
            const table = await openTableAsync(page, 'test');

            // item_id 列（colIndex=2）の動的参照ヒントが表示されるまで待機
            const firstHint = getReferenceHint(table, 0, 2);
            await expect(firstHint).toBeVisible({ timeout: 5000 });

            // Row 0: type_id=1 → type_map.column="id" → weapon.id=1 → "剣"
            await expect(firstHint).toHaveText('剣');
            // Row 1: type_id=1 → type_map.column="id" → weapon.id=2 → "槍"
            await expect(getReferenceHint(table, 1, 2)).toHaveText('槍');
        },
    );

    test(
        '非PK列参照パス: destColumn→"code"（非PK列）で参照先テーブルの表示名がヒント表示されること',
        async ({ page }) => {
            const table = await openTableAsync(page, 'test');

            // Row 2: type_id=2 → type_map.column="code" → armor.code="S01" でルックアップ
            // armor の code="S01" の行は id=1, ja=盾 → 表示列（ja）の値 "盾" がヒント表示される
            const hintRow2 = getReferenceHint(table, 2, 2);
            await expect(hintRow2).toBeVisible({ timeout: 5000 });
            await expect(hintRow2).toHaveText('盾');

            // Row 3: type_id=2 → type_map.column="code" → armor.code="A01" でルックアップ
            // armor の code="A01" の行は id=2, ja=鎧 → 表示列（ja）の値 "鎧" がヒント表示される
            const hintRow3 = getReferenceHint(table, 3, 2);
            await expect(hintRow3).toBeVisible({ timeout: 5000 });
            await expect(hintRow3).toHaveText('鎧');
        },
    );
});
