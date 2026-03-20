import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// FEAT_0023: ヘッダーアイコンと列名テキストが重ならないことの検証
//
// 問題:
//   .filter-icon { right: 30px } と .sort-indicator { right: 8px } が絶対配置であるが、
//   ヘッダーセルに padding-right が確保されていないため、列名テキストとアイコンが重なる。
//   特に列名が長い場合や列幅が狭い場合にテキストがアイコン領域に食い込む。
//
// 期待する修正:
//   ヘッダーセルに十分な padding-right を設けるか、calculateColumnWidth() で
//   アイコン領域（フィルター14px + ソート約20px + マージン8px）を加味すること。
//
// 検証方針:
//   実際の DOM の getBoundingClientRect() を使い、テキスト要素の右端が
//   フィルターアイコンの左端を超えていないこと（重なっていないこと）を確認する。
//   また、ソートインジケーターの左端もテキスト右端以上であることを確認する。
// =============================================================================

/**
 * アイコン重複検証に使う長めの列名テーブルを生成する。
 * 列名を長くすることでテキストがアイコン領域に食い込みやすい状況を作る。
 */
function createFileSystemWithLongColumnNames(): MockFileSystem {
    return {
        "schema/long_columns.json": JSON.stringify({
            primary_key: ["id"],
            header: [
                { key: 0, name: "id",                   type: "int" },
                { key: 1, name: "character_name",       type: "string" },
                { key: 2, name: "attack_power",         type: "int" },
                { key: 3, name: "defense_rating",       type: "int" },
                { key: 4, name: "magic_resistance",     type: "int" },
            ],
        }),
        "data/long_columns.csv": [
            "id,character_name,attack_power,defense_rating,magic_resistance",
            "1,Warrior,100,80,30",
            "2,Mage,40,20,120",
        ].join("\n"),
    };
}

/**
 * 短い列名テーブルも用意する。
 * 短い列名でも MIN_COLUMN_WIDTH_PX に切り詰められるため、アイコンが食い込む可能性がある。
 */
function createFileSystemWithShortColumnNames(): MockFileSystem {
    return {
        "schema/short_columns.json": JSON.stringify({
            primary_key: ["id"],
            header: [
                { key: 0, name: "id",  type: "int" },
                { key: 1, name: "hp",  type: "int" },
                { key: 2, name: "mp",  type: "int" },
            ],
        }),
        "data/short_columns.csv": [
            "id,hp,mp",
            "1,100,50",
            "2,80,120",
        ].join("\n"),
    };
}

/**
 * エクスプローラーからテーブルを開き、左ペインの EditorTable Locator を返す
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
    const table = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="${tableName}"] .editor-table`);
    await expect(table).toBeVisible();
    return table;
}

/**
 * 列ヘッダーセル内の列名テキスト要素の bounding rect を取得する。
 * comment あり（.column-header-name）と comment なし（TextNode を span でラップしていないため
 * ヘッダーセル自体のコンテンツ幅を利用）の両方に対応する。
 *
 * comment なしの場合、TextNode は getBoundingClientRect() が使えないため、
 * ヘッダーセルに Range を作成してテキスト部分の矩形を取得する。
 */
async function getTextRightEdgeAsync(headerCell: Locator): Promise<number> {
    return headerCell.evaluate((el: Element) => {
        // .column-header-name があれば（comment あり 2行構造）その right を返す
        const nameEl = el.querySelector('.column-header-name');
        if (nameEl !== null) {
            return nameEl.getBoundingClientRect().right;
        }
        // .column-header-comment だけがある場合も同様
        const commentEl = el.querySelector('.column-header-comment');
        if (commentEl !== null) {
            return commentEl.getBoundingClientRect().right;
        }
        // comment なし: TextNode を Range で測定する
        // テキストノードを探す（filter-icon・sort-indicator 等の子要素以外のテキストノード）
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
            acceptNode(node: Node) {
                // 空白のみのテキストノードは除外する
                return (node.textContent ?? '').trim().length > 0
                    ? NodeFilter.FILTER_ACCEPT
                    : NodeFilter.FILTER_REJECT;
            },
        });
        const textNode = walker.nextNode();
        if (textNode === null) {
            // テキストノードが見つからない場合はセルの左端を返す（重なりなしと判定させない）
            return el.getBoundingClientRect().left;
        }
        const range = document.createRange();
        range.selectNode(textNode);
        return range.getBoundingClientRect().right;
    });
}

/**
 * 列ヘッダーセル内の .filter-icon の left 座標を取得する。
 * .filter-icon が存在しない場合は null を返す。
 */
async function getFilterIconLeftAsync(headerCell: Locator): Promise<number | null> {
    return headerCell.evaluate((el: Element) => {
        const icon = el.querySelector('.filter-icon');
        if (icon === null) { return null; }
        return icon.getBoundingClientRect().left;
    });
}

/**
 * 列ヘッダーセル内の .sort-indicator の left 座標を取得する。
 * .sort-indicator が存在しない場合は null を返す。
 */
async function getSortIndicatorLeftAsync(headerCell: Locator): Promise<number | null> {
    return headerCell.evaluate((el: Element) => {
        const indicator = el.querySelector('.sort-indicator');
        if (indicator === null) { return null; }
        return indicator.getBoundingClientRect().left;
    });
}

// =============================================================================
// テスト本体: 長い列名テーブル
// =============================================================================
test.describe('FEAT_0023: ヘッダーアイコンと列名テキストの重なり（長い列名）', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createFileSystemWithLongColumnNames());
        await page.goto('/');
    });

    // ---------------------------------------------------------------------------
    // テスト1: 列名テキストの右端がフィルターアイコンの左端を超えていないこと
    //
    // .filter-icon は right: 30px の絶対配置。padding-right が不足していると
    // テキストがアイコンの下に食い込む。全列ヘッダーで検証する。
    // ---------------------------------------------------------------------------
    test(
        '列名テキストの右端がフィルターアイコンの左端を超えていないこと（長い列名）',
        async ({ page }) => {
            const table = await openTableAsync(page, 'long_columns');
            const headerRow = table.locator('.editor-table-column-header-row');
            await expect(headerRow).toBeVisible();

            const headers = headerRow.locator('.editor-table-column-header');
            const count = await headers.count();
            expect(count).toBeGreaterThanOrEqual(5);

            for (let i = 0; i < count; i++) {
                const header = headers.nth(i);
                const filterLeft = await getFilterIconLeftAsync(header);
                if (filterLeft === null) {
                    // フィルターアイコンが存在しない列は検証しない（ミニテーブル列など）
                    continue;
                }
                const textRight = await getTextRightEdgeAsync(header);
                // テキストの右端がフィルターアイコンの左端を超えていないこと
                // 超えている場合はアイコンとテキストが重なっている
                expect(
                    textRight,
                    `列ヘッダー[${i}] のテキスト右端(${textRight.toFixed(1)}px)がフィルターアイコン左端(${filterLeft.toFixed(1)}px)を超えています — アイコンとテキストが重なっています`,
                ).toBeLessThanOrEqual(filterLeft);
            }
        },
    );

    // ---------------------------------------------------------------------------
    // テスト2: 列名テキストの右端がソートインジケーターの左端を超えていないこと
    //
    // .sort-indicator は right: 8px の絶対配置。padding-right が不足していると
    // テキストがソートインジケーターの下にも食い込む。
    // ---------------------------------------------------------------------------
    test(
        '列名テキストの右端がソートインジケーターの左端を超えていないこと（長い列名）',
        async ({ page }) => {
            const table = await openTableAsync(page, 'long_columns');
            const headerRow = table.locator('.editor-table-column-header-row');
            await expect(headerRow).toBeVisible();

            const headers = headerRow.locator('.editor-table-column-header');
            const count = await headers.count();
            expect(count).toBeGreaterThanOrEqual(5);

            for (let i = 0; i < count; i++) {
                const header = headers.nth(i);
                const sortLeft = await getSortIndicatorLeftAsync(header);
                if (sortLeft === null) { continue; }
                const textRight = await getTextRightEdgeAsync(header);
                expect(
                    textRight,
                    `列ヘッダー[${i}] のテキスト右端(${textRight.toFixed(1)}px)がソートインジケーター左端(${sortLeft.toFixed(1)}px)を超えています — ソートアイコンとテキストが重なっています`,
                ).toBeLessThanOrEqual(sortLeft);
            }
        },
    );

    // ---------------------------------------------------------------------------
    // テスト3: ヘッダーセルの幅がアイコン領域を確保した最小幅以上であること
    //
    // フィルターアイコン(14px) + マージン(8px) + ソートインジケーター(約20px) + 右端マージン(8px) = 約50px
    // この値を ICON_AREA_WIDTH とし、テキスト幅 + ICON_AREA_WIDTH のいずれかが
    // 列幅として確保されていることを検証する。
    // 現状の CELL_HORIZONTAL_EXTRA = 17 はアイコン領域を考慮していないため失敗するはず。
    // ---------------------------------------------------------------------------
    test(
        'ヘッダーセルの幅がテキスト幅とアイコン領域の合計以上であること（長い列名）',
        async ({ page }) => {
            const table = await openTableAsync(page, 'long_columns');
            const headerRow = table.locator('.editor-table-column-header-row');
            await expect(headerRow).toBeVisible();

            const headers = headerRow.locator('.editor-table-column-header');
            const count = await headers.count();
            expect(count).toBeGreaterThanOrEqual(5);

            // アイコン領域の最小必要幅:
            //   filter-icon: right=30px, width=14px → 占有幅は right端から44px
            //   sort-indicator: right=8px, 幅は約20px → 占有幅は right端から28px
            //   両者を合わせると right端から44px が最低限のアイコン占有幅
            //   さらに padding-right 相当を加えると、アイコン用スペースは最低44px必要
            const ICON_AREA_MIN_PX = 44;

            for (let i = 0; i < count; i++) {
                const header = headers.nth(i);
                // フィルターアイコンが存在しない列はスキップ
                const filterLeft = await getFilterIconLeftAsync(header);
                if (filterLeft === null) { continue; }

                const rect = await header.evaluate((el: Element) => {
                    const r = el.getBoundingClientRect();
                    return { width: r.width, left: r.left, right: r.right };
                });

                const textRight = await getTextRightEdgeAsync(header);
                // テキスト右端からセル右端までの余白がアイコン領域以上あること
                const trailingSpace = rect.right - textRight;
                expect(
                    trailingSpace,
                    `列ヘッダー[${i}] のセル右端からテキスト右端までの余白(${trailingSpace.toFixed(1)}px)が` +
                    `アイコン最小幅(${ICON_AREA_MIN_PX}px)を下回っています — padding-right が不足しています`,
                ).toBeGreaterThanOrEqual(ICON_AREA_MIN_PX);
            }
        },
    );
});

// =============================================================================
// テスト本体: 短い列名テーブル（MIN_COLUMN_WIDTH_PX に切り詰められるケース）
// =============================================================================
test.describe('FEAT_0023: ヘッダーアイコンと列名テキストの重なり（短い列名）', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createFileSystemWithShortColumnNames());
        await page.goto('/');
    });

    // ---------------------------------------------------------------------------
    // テスト4: 短い列名でも列名テキストの右端がフィルターアイコンの左端を超えていないこと
    //
    // 短い列名は MIN_COLUMN_WIDTH_PX = 50px に切り詰められる。
    // 50px の列幅に対して filter-icon(right:30px, 幅14px) が存在すると、
    // テキスト表示可能領域は実質的に 50 - 44 = 6px しか残らない。
    // しかしテキストは overflow: hidden でクリップされるだけで、
    // 重なり判定上は filter-icon の左端よりテキスト右端が左にあるべき。
    // 現状は padding-right が設定されていないため overflow: hidden の適用範囲が
    // セル全幅になり、テキストがアイコンに食い込んでしまう。
    // ---------------------------------------------------------------------------
    test(
        '列名テキストの右端がフィルターアイコンの左端を超えていないこと（短い列名）',
        async ({ page }) => {
            const table = await openTableAsync(page, 'short_columns');
            const headerRow = table.locator('.editor-table-column-header-row');
            await expect(headerRow).toBeVisible();

            const headers = headerRow.locator('.editor-table-column-header');
            const count = await headers.count();
            expect(count).toBeGreaterThanOrEqual(3);

            for (let i = 0; i < count; i++) {
                const header = headers.nth(i);
                const filterLeft = await getFilterIconLeftAsync(header);
                if (filterLeft === null) { continue; }
                const textRight = await getTextRightEdgeAsync(header);
                expect(
                    textRight,
                    `列ヘッダー[${i}] のテキスト右端(${textRight.toFixed(1)}px)がフィルターアイコン左端(${filterLeft.toFixed(1)}px)を超えています（短い列名ケース）`,
                ).toBeLessThanOrEqual(filterLeft);
            }
        },
    );

    // ---------------------------------------------------------------------------
    // テスト5: 短い列名でも列名テキストの右端がソートインジケーターの左端を超えていないこと
    // ---------------------------------------------------------------------------
    test(
        '列名テキストの右端がソートインジケーターの左端を超えていないこと（短い列名）',
        async ({ page }) => {
            const table = await openTableAsync(page, 'short_columns');
            const headerRow = table.locator('.editor-table-column-header-row');
            await expect(headerRow).toBeVisible();

            const headers = headerRow.locator('.editor-table-column-header');
            const count = await headers.count();
            expect(count).toBeGreaterThanOrEqual(3);

            for (let i = 0; i < count; i++) {
                const header = headers.nth(i);
                const sortLeft = await getSortIndicatorLeftAsync(header);
                if (sortLeft === null) { continue; }
                const textRight = await getTextRightEdgeAsync(header);
                expect(
                    textRight,
                    `列ヘッダー[${i}] のテキスト右端(${textRight.toFixed(1)}px)がソートインジケーター左端(${sortLeft.toFixed(1)}px)を超えています（短い列名ケース）`,
                ).toBeLessThanOrEqual(sortLeft);
            }
        },
    );
});
