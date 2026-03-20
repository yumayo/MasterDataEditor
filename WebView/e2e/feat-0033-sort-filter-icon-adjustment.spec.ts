import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// FEAT_0033: フィルターとソートアイコンの位置調整
//
// 問題:
//   1. ソートアイコン（.sort-icon-asc / .sort-icon-desc）が Unicode 文字（▲▼）で
//      実装されており、SVG でないためスケール・カラーテーマ対応が不十分。
//   2. フィルターアイコンの hover 時に background-color が設定されており、
//      SVG アイコンの color だけが変わるべきところ背景色も変化してしまう。
//
// 期待する修正:
//   1. .sort-icon-asc と .sort-icon-desc の内部を SVG で実装する。
//      .sort-indicator 内に SVG 要素が存在すること。
//   2. .filter-icon:hover の background-color を transparent（または削除）にする。
//
// 検証方針:
//   1. .sort-indicator svg が DOM に存在すること
//   2. .sort-icon-asc svg が DOM に存在すること
//   3. .sort-icon-desc svg が DOM に存在すること
//   4. スタイルシートの .filter-icon:hover ルールで background-color が
//      transparent または rgba(0,0,0,0) であること
// =============================================================================

/**
 * テスト用のシンプルなファイルシステムを生成する。
 * ソート・フィルターアイコンが存在する列ヘッダーを確認するための最小構成。
 */
function createTestFileSystem(): MockFileSystem {
    return {
        "schema/items.json": JSON.stringify({
            primary_key: ["id"],
            header: [
                { key: 0, name: "id",   type: "int" },
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

test.describe('FEAT_0033: フィルターとソートアイコンの位置調整', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createTestFileSystem());
        await page.goto('/');
    });

    // ---------------------------------------------------------------------------
    // テスト1: ソートインジケーター内に SVG 要素が存在すること
    //
    // 現状は ascIcon.textContent = '▲'、descIcon.textContent = '▼' のテキスト実装であり、
    // .sort-indicator 内に svg 要素は存在しない。このテストは RED（失敗）する。
    // ---------------------------------------------------------------------------
    test(
        'ソートインジケーター内に SVG 要素が存在すること',
        async ({ page }) => {
            const table = await openTableAsync(page, 'items');
            const headerRow = table.locator('.editor-table-column-header-row');
            await expect(headerRow).toBeVisible();

            const headers = headerRow.locator('.editor-table-column-header');
            const count = await headers.count();
            expect(count).toBeGreaterThan(0);

            // .sort-indicator が存在する列ヘッダーについて svg の存在を検証する
            let checkedAtLeastOne = false;
            for (let i = 0; i < count; i++) {
                const header = headers.nth(i);
                const sortIndicator = header.locator('.sort-indicator');
                const isAttached = await sortIndicator.count() > 0;
                if (!isAttached) {
                    continue;
                }
                // .sort-indicator 内に svg 要素が存在すること
                const svg = sortIndicator.locator('svg');
                await expect(
                    svg.first(),
                    `列ヘッダー[${i}] の .sort-indicator 内に svg 要素が存在しません — Unicode 文字ではなく SVG アイコンを使用してください`,
                ).toBeAttached();
                checkedAtLeastOne = true;
                break;
            }

            // .sort-indicator が1列以上あれば必ず検証済みであること
            const sortIndicators = headerRow.locator('.sort-indicator');
            const sortIndicatorCount = await sortIndicators.count();
            if (sortIndicatorCount > 0) {
                expect(
                    checkedAtLeastOne,
                    '.sort-indicator が存在するにもかかわらず svg の検証が行われませんでした',
                ).toBe(true);
            }
        },
    );

    // ---------------------------------------------------------------------------
    // テスト2: .sort-icon-asc 内に SVG 要素が存在すること
    //
    // 現状は textContent = '▲' のテキスト実装のため、このテストは RED（失敗）する。
    // ---------------------------------------------------------------------------
    test(
        '.sort-icon-asc 内に SVG 要素が存在すること',
        async ({ page }) => {
            const table = await openTableAsync(page, 'items');
            const headerRow = table.locator('.editor-table-column-header-row');
            await expect(headerRow).toBeVisible();

            const headers = headerRow.locator('.editor-table-column-header');
            const count = await headers.count();
            expect(count).toBeGreaterThan(0);

            let checkedAtLeastOne = false;
            for (let i = 0; i < count; i++) {
                const header = headers.nth(i);
                const ascIcon = header.locator('.sort-icon-asc');
                const isAttached = await ascIcon.count() > 0;
                if (!isAttached) {
                    continue;
                }
                // .sort-icon-asc 内に svg 要素が存在すること
                const svg = ascIcon.locator('svg');
                await expect(
                    svg,
                    `列ヘッダー[${i}] の .sort-icon-asc 内に svg 要素が存在しません — '▲' テキストではなく SVG で上矢印を実装してください`,
                ).toBeAttached();
                checkedAtLeastOne = true;
                break;
            }

            const ascIcons = headerRow.locator('.sort-icon-asc');
            const ascIconCount = await ascIcons.count();
            if (ascIconCount > 0) {
                expect(
                    checkedAtLeastOne,
                    '.sort-icon-asc が存在するにもかかわらず svg の検証が行われませんでした',
                ).toBe(true);
            }
        },
    );

    // ---------------------------------------------------------------------------
    // テスト3: .sort-icon-desc 内に SVG 要素が存在すること
    //
    // 現状は textContent = '▼' のテキスト実装のため、このテストは RED（失敗）する。
    // ---------------------------------------------------------------------------
    test(
        '.sort-icon-desc 内に SVG 要素が存在すること',
        async ({ page }) => {
            const table = await openTableAsync(page, 'items');
            const headerRow = table.locator('.editor-table-column-header-row');
            await expect(headerRow).toBeVisible();

            const headers = headerRow.locator('.editor-table-column-header');
            const count = await headers.count();
            expect(count).toBeGreaterThan(0);

            let checkedAtLeastOne = false;
            for (let i = 0; i < count; i++) {
                const header = headers.nth(i);
                const descIcon = header.locator('.sort-icon-desc');
                const isAttached = await descIcon.count() > 0;
                if (!isAttached) {
                    continue;
                }
                // .sort-icon-desc 内に svg 要素が存在すること
                const svg = descIcon.locator('svg');
                await expect(
                    svg,
                    `列ヘッダー[${i}] の .sort-icon-desc 内に svg 要素が存在しません — '▼' テキストではなく SVG で下矢印を実装してください`,
                ).toBeAttached();
                checkedAtLeastOne = true;
                break;
            }

            const descIcons = headerRow.locator('.sort-icon-desc');
            const descIconCount = await descIcons.count();
            if (descIconCount > 0) {
                expect(
                    checkedAtLeastOne,
                    '.sort-icon-desc が存在するにもかかわらず svg の検証が行われませんでした',
                ).toBe(true);
            }
        },
    );

    // ---------------------------------------------------------------------------
    // テスト4: フィルターアイコンの hover 時に background-color が透明であること
    //
    // 現状は .filter-icon:hover に background-color: rgba(128,128,128,0.1) が設定されており、
    // hover 時に背景色が変化してしまう。SVG の color だけが変わるべき。
    // このテストはスタイルシートの CSSRule を直接検査することで hover 疑似クラスを評価する。
    // 現状は rgba(128,128,128,0.1) が設定されているため RED（失敗）する。
    // ---------------------------------------------------------------------------
    test(
        'フィルターアイコンの hover 時に background-color が透明であること',
        async ({ page }) => {
            // スタイルシートから .filter-icon:hover の background-color ルールを取得する。
            // Playwright の page.evaluate でドキュメントのスタイルシートを走査し、
            // セレクター .filter-icon:hover の background-color プロパティ値を確認する。
            const filterIconHoverBackgroundColor = await page.evaluate((): string => {
                for (const sheet of Array.from(document.styleSheets)) {
                    let rules: CSSRuleList;
                    try {
                        rules = sheet.cssRules;
                    } catch {
                        // cross-origin sheet にはアクセス不可のためスキップする
                        continue;
                    }
                    for (const rule of Array.from(rules)) {
                        if (!(rule instanceof CSSStyleRule)) {
                            continue;
                        }
                        // セレクターが .filter-icon:hover を含むルールを検索する
                        if (!rule.selectorText.includes('.filter-icon:hover')) {
                            continue;
                        }
                        const bg = rule.style.backgroundColor;
                        // background-color プロパティが設定されていれば返す
                        if (bg !== '') {
                            return bg;
                        }
                    }
                }
                // background-color が設定されていない（透明）場合は空文字を返す
                return '';
            });

            // background-color が設定されていない（空文字）か、
            // transparent / rgba(0,0,0,0) であることを検証する。
            // 現状は rgba(128, 128, 128, 0.1) が返るため、このテストは RED になる。
            const isTransparent =
                filterIconHoverBackgroundColor === '' ||
                filterIconHoverBackgroundColor === 'transparent' ||
                filterIconHoverBackgroundColor === 'rgba(0, 0, 0, 0)';

            expect(
                isTransparent,
                `.filter-icon:hover の background-color が透明ではありません（実際: '${filterIconHoverBackgroundColor}'）` +
                ` — hover 時は color プロパティのみ変化させ、background-color は transparent にしてください`,
            ).toBe(true);
        },
    );
});
