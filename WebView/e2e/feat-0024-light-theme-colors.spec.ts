import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// ライトテーマ色改修テスト（FEAT_0024）
//
// 改修対象:
//   1. PK/FKバッジの背景色が薄すぎる問題（アルファ値0.10 → 0.20に引き上げ）
//   2. プルダウン選択項目の背景色がダークテーマ用（#264f78）になっている問題
//   3. プルダウンのホバー色がダークテーマ前提（rgba(255,255,255,0.1)）になっている問題
//
// テスト構成:
//   1. PKバッジの背景色のアルファ値が0.15以上であること
//   2. FKバッジの背景色のアルファ値が0.15以上であること
//   3. プルダウン選択項目の背景色がライトテーマに適切な明るい色であること
// =============================================================================

// skill テーブル（PK=id, FK=skill_value_type_id → skill_value_type.id）のモックデータ
const mockFs: MockFileSystem = {
    "schema/skill.json": JSON.stringify({
        description: "スキルマスター",
        primary_key: ["id"],
        header: [
            { key: 0, name: "id",                  type: "int",    comment: "ID" },
            { key: 1, name: "name",                type: "string", comment: "スキル名" },
            { key: 2, name: "skill_value_type_id", type: "int",    comment: "効果タイプ", reference: "skill_value_type.id" },
        ],
    }),
    "data/skill.csv": ["id,name,skill_value_type_id", "1,slash,1", "2,thunder,2"].join("\n"),
    "schema/skill_value_type.json": JSON.stringify({
        description: "スキル効果タイプ",
        primary_key: ["id"],
        header: [
            { key: 0, name: "id",   type: "int",    comment: "ID" },
            { key: 1, name: "name", type: "string", comment: "タイプ名" },
        ],
    }),
    "data/skill_value_type.csv": ["id,name", "1,物理", "2,魔法"].join("\n"),
};

/**
 * エクスプローラーからテーブルを開き、左ペインのEditorTable Locatorを返す
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    await page.locator('#explorer').getByText(tableName, { exact: true }).click();
    const table = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="${tableName}"] .editor-table`);
    await expect(table).toBeVisible();
    return table;
}

/**
 * 列インデックス（0始まり）に対応する列ヘッダーセル Locator を返す
 */
function getColumnHeaderCell(table: Locator, colIndex: number): Locator {
    return table.locator('.editor-table-column-header-row').locator('.editor-table-column-header').nth(colIndex);
}

/**
 * 指定セルをダブルクリックしてFKドロップダウンを開き、ドロップダウンリスト Locator を返す。
 * rowIndex: 0始まり（ヘッダー除く）、colIndex: 0始まり（行ヘッダー除く）
 */
async function openFkDropdownAsync(page: Page, table: Locator, rowIndex: number, colIndex: number): Promise<Locator> {
    const row = table.locator('.editor-table-row').nth(rowIndex);
    const cell = row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
    await cell.dblclick();
    const dropdownList = page.locator('.editor-left-pane .grid-dropdown-list');
    await expect(dropdownList).toBeVisible();
    await expect(dropdownList.locator('.grid-dropdown-item').first()).toBeVisible();
    return dropdownList;
}

/**
 * "rgba(R, G, B, A)" または "rgb(R, G, B)" 形式の文字列からアルファ値を抽出して返す。
 * rgb() 形式（アルファなし）の場合は 1.0 を返す。
 */
function extractAlpha(rgbaString: string): number {
    // rgba(R, G, B, A) 形式を試みる
    const rgbaMatch = rgbaString.match(/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/);
    if (rgbaMatch) { return parseFloat(rgbaMatch[1]); }
    // rgb(R, G, B) 形式（アルファなし = 不透明）
    const rgbMatch = rgbaString.match(/rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)/);
    if (rgbMatch) { return 1.0; }
    throw new Error(`予期しない色文字列形式: ${rgbaString}`);
}

/**
 * "rgba(R, G, B, A)" または "rgb(R, G, B)" 形式の文字列からRGB各成分を抽出し、平均値を返す。
 */
function extractRgbAverage(rgbaString: string): number {
    const match = rgbaString.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!match) { throw new Error(`予期しない色文字列形式: ${rgbaString}`); }
    return (parseInt(match[1]) + parseInt(match[2]) + parseInt(match[3])) / 3;
}

// 全テスト共通: ライトテーマでの色検証のためダークテーマ属性を除去する
test.beforeEach(async ({ page }) => {
    await installMockApiAsync(page, mockFs);
    await page.goto('/');
    // ライトテーマを明示的に設定する（テスト環境はダークテーマがデフォルトのため）
    await page.evaluate(() => document.body.removeAttribute('data-theme'));
});

// =============================================================================
// テスト1: PKバッジの背景色が十分に濃いこと
// =============================================================================
test.describe('PKバッジの背景色（FEAT_0024）', () => {

    test(
        'PKバッジ（.column-header-badge--pk）の背景色のアルファ値が0.15以上であること',
        async ({ page }) => {
            const table = await openTableAsync(page, 'skill');
            // id列（colIndex=0）はPK列
            const idHeader = getColumnHeaderCell(table, 0);
            const pkBadge = idHeader.locator('.column-header-badge--pk');
            await expect(pkBadge).toBeVisible();

            // computedStyleで背景色を取得してアルファ値を検証する
            const bgColor = await pkBadge.evaluate(
                (el: Element) => window.getComputedStyle(el).backgroundColor,
            );
            const alpha = extractAlpha(bgColor);
            expect(alpha).toBeGreaterThanOrEqual(0.15);
        },
    );
});

// =============================================================================
// テスト2: FKバッジの背景色が十分に濃いこと
// =============================================================================
test.describe('FKバッジの背景色（FEAT_0024）', () => {

    test(
        'FKバッジ（.column-header-badge--fk）の背景色のアルファ値が0.15以上であること',
        async ({ page }) => {
            const table = await openTableAsync(page, 'skill');
            // skill_value_type_id列（colIndex=2）はFK列
            const fkHeader = getColumnHeaderCell(table, 2);
            const fkBadge = fkHeader.locator('.column-header-badge--fk');
            await expect(fkBadge).toBeVisible();

            // computedStyleで背景色を取得してアルファ値を検証する
            const bgColor = await fkBadge.evaluate(
                (el: Element) => window.getComputedStyle(el).backgroundColor,
            );
            const alpha = extractAlpha(bgColor);
            expect(alpha).toBeGreaterThanOrEqual(0.15);
        },
    );
});

// =============================================================================
// テスト3: プルダウン選択項目の背景色がライトテーマに適切であること
// =============================================================================
test.describe('プルダウン選択項目の背景色（FEAT_0024）', () => {

    test(
        'プルダウン選択項目（.grid-dropdown-item.selected）の背景色がライトテーマに適切な明るい色であること',
        async ({ page }) => {
            const table = await openTableAsync(page, 'skill');
            // skill_value_type_id列（colIndex=2）をダブルクリックしてドロップダウンを開く
            // skill行0（id=1, slash, skill_value_type_id=1）のFK列
            const dropdown = await openFkDropdownAsync(page, table, 0, 2);

            // .selected クラスが付いた項目が存在することを確認する
            const selectedItem = dropdown.locator('.grid-dropdown-item.selected').first();
            await expect(selectedItem).toBeVisible();

            // computedStyleで背景色を取得してRGB平均値を検証する
            const bgColor = await selectedItem.evaluate(
                (el: Element) => window.getComputedStyle(el).backgroundColor,
            );
            const rgbAverage = extractRgbAverage(bgColor);
            // ライトテーマでは明るい色（平均128以上）を使うべき
            expect(rgbAverage).toBeGreaterThanOrEqual(128);
        },
    );
});
