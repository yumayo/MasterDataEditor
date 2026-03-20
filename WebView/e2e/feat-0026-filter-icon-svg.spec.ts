import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// FEAT_0026: フィルターアイコンのSVG化
//
// 問題:
//   列ヘッダーの .filter-icon は textContent = '▼' というテキスト文字で実装されており、
//   フォント依存・スケール不可・カラーテーマ対応が不十分。
//
// 期待する修正:
//   .filter-icon 内をインラインSVGで実装し、fill="currentColor" を使用することで
//   CSS テーマに追従し、任意サイズに綺麗にスケールできる漏斗型アイコンにすること。
//
// 検証方針:
//   1. .filter-icon 内に svg 要素が存在すること
//   2. .filter-icon の textContent が '▼' でないこと（テキスト実装でないこと）
//   3. SVG 内の path/polygon 要素の fill 属性が 'currentColor' であること
// =============================================================================

/**
 * SVG化テスト用のシンプルなファイルシステムを生成する。
 * テーブル構成: items: id（int）, name（string）
 * フィルターアイコンが存在する列ヘッダーを確認するための最小構成。
 */
function createFilterIconTestFileSystem(): MockFileSystem {
    return {
        "schema/items.json": JSON.stringify({
            primary_key: ["id"],
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
            ],
        }),
        "data/items.csv": ["id,name", "1,Sword", "2,Shield"].join("\n"),
    };
}

/**
 * エクスプローラーからテーブルを開き、左ペインの EditorTable Locator を返す。
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
    const table = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="${tableName}"] .editor-table`);
    await expect(table).toBeVisible();
    return table;
}

// =============================================================================
// テスト本体
// =============================================================================

test.describe('FEAT_0026: フィルターアイコンのSVG化', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createFilterIconTestFileSystem());
        await page.goto('/');
    });

    // ---------------------------------------------------------------------------
    // テスト1: フィルターアイコンが svg 要素を含むこと
    //
    // 現状は textContent = '▼' で実装されており、svg 要素は存在しない。
    // このテストは RED（失敗）状態でコミットする（REDフェーズ）。
    // ---------------------------------------------------------------------------
    test(
        'フィルターアイコンが svg 要素を含むこと',
        async ({ page }) => {
            const table = await openTableAsync(page, 'items');
            const headerRow = table.locator('.editor-table-column-header-row');
            await expect(headerRow).toBeVisible();

            // 最初の列ヘッダーの .filter-icon に svg 要素が存在することを検証する
            const headerCells = headerRow.locator('.editor-table-column-header');
            const count = await headerCells.count();
            expect(count).toBeGreaterThan(0);

            // 全列ヘッダーについて filter-icon 内の svg を検証する
            for (let i = 0; i < count; i++) {
                const headerCell = headerCells.nth(i);
                const filterIcon = headerCell.locator('.filter-icon');
                const isAttached = await filterIcon.count() > 0;
                if (!isAttached) {
                    // フィルターアイコンが存在しない列はスキップする
                    continue;
                }
                // .filter-icon 内に svg 要素が存在すること
                const svg = filterIcon.locator('svg');
                await expect(
                    svg,
                    `列ヘッダー[${i}] の .filter-icon 内に svg 要素が存在しません — テキスト '▼' ではなくSVGアイコンを使用してください`,
                ).toBeAttached();
            }
        },
    );

    // ---------------------------------------------------------------------------
    // テスト2: フィルターアイコンが テキスト '▼' を含まないこと
    //
    // 現状は textContent = '▼' で実装されているためこのテストは RED（失敗）する。
    // SVG化後は textContent が '▼' でなくなることを確認する。
    // ---------------------------------------------------------------------------
    test(
        'フィルターアイコンがテキスト ▼ を含まないこと',
        async ({ page }) => {
            const table = await openTableAsync(page, 'items');
            const headerRow = table.locator('.editor-table-column-header-row');
            await expect(headerRow).toBeVisible();

            const headerCells = headerRow.locator('.editor-table-column-header');
            const count = await headerCells.count();
            expect(count).toBeGreaterThan(0);

            for (let i = 0; i < count; i++) {
                const headerCell = headerCells.nth(i);
                const filterIcon = headerCell.locator('.filter-icon');
                const isAttached = await filterIcon.count() > 0;
                if (!isAttached) {
                    continue;
                }
                // .filter-icon の textContent が '▼' でないこと
                const textContent = await filterIcon.evaluate((el: Element) => el.textContent ?? '');
                expect(
                    textContent.trim(),
                    `列ヘッダー[${i}] の .filter-icon の textContent が '▼' です — SVGアイコンに切り替えてください`,
                ).not.toBe('▼');
            }
        },
    );

    // ---------------------------------------------------------------------------
    // テスト3: SVG が currentColor を使用していること
    //
    // fill="currentColor" を使うことで CSS テーマ（ライト/ダーク）に自動追従できる。
    // 現状は svg 自体が存在しないため、このテストは RED（失敗）する。
    // ---------------------------------------------------------------------------
    test(
        'SVG内の path/polygon 要素の fill 属性が currentColor であること',
        async ({ page }) => {
            const table = await openTableAsync(page, 'items');
            const headerRow = table.locator('.editor-table-column-header-row');
            await expect(headerRow).toBeVisible();

            const headerCells = headerRow.locator('.editor-table-column-header');
            const count = await headerCells.count();
            expect(count).toBeGreaterThan(0);

            // .filter-icon が存在する最初の列ヘッダーで svg の fill 属性を検証する
            let checkedAtLeastOne = false;
            for (let i = 0; i < count; i++) {
                const headerCell = headerCells.nth(i);
                const filterIcon = headerCell.locator('.filter-icon');
                const isAttached = await filterIcon.count() > 0;
                if (!isAttached) {
                    continue;
                }

                // svg 内の全 path/polygon 要素の fill 属性を確認する
                const fillValues = await filterIcon.evaluate((el: Element) => {
                    const shapes = el.querySelectorAll('svg path, svg polygon');
                    const fills: string[] = [];
                    shapes.forEach(shape => {
                        fills.push(shape.getAttribute('fill') ?? '');
                    });
                    return fills;
                });

                // path/polygon が存在するなら全て currentColor であること
                if (fillValues.length > 0) {
                    for (const fill of fillValues) {
                        expect(
                            fill,
                            `列ヘッダー[${i}] の .filter-icon 内 SVG shape の fill 属性が 'currentColor' ではありません（実際: '${fill}'）— CSSテーマに追従するために currentColor を使用してください`,
                        ).toBe('currentColor');
                    }
                    checkedAtLeastOne = true;
                    break;
                }
            }

            // .filter-icon が1列以上あれば path/polygon も存在すること（SVGが正しく実装されていること）
            const filterIcons = headerRow.locator('.filter-icon');
            const filterIconCount = await filterIcons.count();
            if (filterIconCount > 0) {
                expect(
                    checkedAtLeastOne,
                    '.filter-icon 内のSVGに path/polygon 要素が存在しません — 漏斗型SVGアイコンをpath/polygonで実装してください',
                ).toBe(true);
            }
        },
    );
});
