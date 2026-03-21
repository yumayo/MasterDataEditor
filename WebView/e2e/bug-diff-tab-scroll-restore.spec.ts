import { test as base, expect } from './fixtures/test';
import { MockFileSystem, installMockApiAsync } from './fixtures/mock-api';
import { Page } from '@playwright/test';

// =============================================================================
// ISSUE_0092: 差分タブのスクロール位置復元時に行ヘッダーだけが取り残される
//
// 不具合の再現:
//   1. 差分タブを開いて右スクロール
//      → leftPaneElement.scrollLeft = N、行ヘッダー style.left = Npx
//   2. タブバーから通常タブに切り替え → diffTab.hide() で display: none
//      → ブラウザが scrollLeft を 0 にリセットするが scroll イベントは発火しない
//      → lastScrollLeft = N のまま、行ヘッダーも left: Npx のまま残る
//   3. タブバーから差分タブに戻る → diffTab.show() で display: ''
//      → scrollLeft=0 だが行ヘッダーは left: Npx → ずれ発生
//
// テストシナリオ:
//   横スクロールが発生するよう列数の多いテーブルを用意し、
//   通常テーブルを先に開く → 差分タブを開いて右スクロール
//   → タブバーから通常タブに切り替え → タブバーから差分タブに戻る
//   → 行ヘッダーの style.left が scrollLeft と一致することを検証する
//
// 注意:
//   エクスプローラーパネルに切り替えると closeAllDiffTabs() が呼ばれて
//   差分タブが destroy されてしまう。そのため通常テーブルを先に開き、
//   タブバーのタブボタンクリックで切り替えることで hide/show だけ発生させる。
// =============================================================================

// 横スクロールが発生するよう10列のテーブルを用意する
const WIDE_TABLE_SCHEMA = JSON.stringify({
    header: [
        { key: 0, name: "id", type: "int" },
        { key: 1, name: "col_a", type: "string" },
        { key: 2, name: "col_b", type: "string" },
        { key: 3, name: "col_c", type: "string" },
        { key: 4, name: "col_d", type: "string" },
        { key: 5, name: "col_e", type: "string" },
        { key: 6, name: "col_f", type: "string" },
        { key: 7, name: "col_g", type: "string" },
        { key: 8, name: "col_h", type: "string" },
        { key: 9, name: "col_i", type: "string" },
    ],
    primary_key: ["id"],
});

// 現在版CSV — id=1 の col_a を変更した状態
const CURRENT_CSV = [
    "id,col_a,col_b,col_c,col_d,col_e,col_f,col_g,col_h,col_i",
    "1,modified_value,bbbbbbbbbb,cccccccccc,dddddddddd,eeeeeeeeee,ffffffffff,gggggggggg,hhhhhhhhhh,iiiiiiiiii",
    "2,aaaaaaaaaa,bbbbbbbbbb,cccccccccc,dddddddddd,eeeeeeeeee,ffffffffff,gggggggggg,hhhhhhhhhh,iiiiiiiiii",
    "3,aaaaaaaaaa,bbbbbbbbbb,cccccccccc,dddddddddd,eeeeeeeeee,ffffffffff,gggggggggg,hhhhhhhhhh,iiiiiiiiii",
].join("\n");

// HEAD版CSV（変更前）
const HEAD_CSV = [
    "id,col_a,col_b,col_c,col_d,col_e,col_f,col_g,col_h,col_i",
    "1,original_value,bbbbbbbbbb,cccccccccc,dddddddddd,eeeeeeeeee,ffffffffff,gggggggggg,hhhhhhhhhh,iiiiiiiiii",
    "2,aaaaaaaaaa,bbbbbbbbbb,cccccccccc,dddddddddd,eeeeeeeeee,ffffffffff,gggggggggg,hhhhhhhhhh,iiiiiiiiii",
    "3,aaaaaaaaaa,bbbbbbbbbb,cccccccccc,dddddddddd,eeeeeeeeee,ffffffffff,gggggggggg,hhhhhhhhhh,iiiiiiiiii",
].join("\n");

// 通常タブ用テーブル
const NORMAL_TABLE_SCHEMA = JSON.stringify({
    header: [
        { key: 0, name: "id", type: "int" },
        { key: 1, name: "name", type: "string" },
    ],
    primary_key: ["id"],
});

const NORMAL_TABLE_CSV = [
    "id,name",
    "1,normal_a",
    "2,normal_b",
].join("\n");

// git status レスポンス（wide_table が変更あり）
const GIT_STATUS = {
    changes: [{ path: "data/wide_table.csv", tableName: "wide_table", isNew: false }],
    staged: [] as { path: string; tableName: string; isNew: boolean }[],
};

// HEAD版ファイルマップ
const HEAD_FILES: Record<string, string> = {
    "data/wide_table.csv": HEAD_CSV,
};

function createFileSystem(): MockFileSystem {
    return {
        "schema/wide_table.json": WIDE_TABLE_SCHEMA,
        "data/wide_table.csv": CURRENT_CSV,
        "schema/normal.json": NORMAL_TABLE_SCHEMA,
        "data/normal.csv": NORMAL_TABLE_CSV,
    };
}

// フィクスチャ型定義
interface ScrollRestoreFixtures {
    /** git差分状態をセットアップし、通常テーブルを先に開いた状態でページを提供する */
    diffSetup: void;
}

const test = base.extend<ScrollRestoreFixtures>({
    diffSetup: async ({ page }, use) => {
        await page.addInitScript((args: {
            status: { changes: { path: string; tableName: string; isNew: boolean }[]; staged: { path: string; tableName: string; isNew: boolean }[] };
            headFiles: Record<string, string>;
        }) => {
            (window as unknown as { __mockGitStatus: object }).__mockGitStatus = args.status;
            (window as unknown as { __mockGitHeadFiles: Record<string, string> }).__mockGitHeadFiles = args.headFiles;
        }, { status: GIT_STATUS, headFiles: HEAD_FILES });

        await installMockApiAsync(page, createFileSystem());
        await page.goto('/');

        // 通常テーブルを先に開く（エクスプローラーから）
        // これにより後でタブバーから通常テーブルに切り替えられる（closeAllDiffTabs を避ける）
        await page.locator('[data-panel="files"]').click();
        await page.locator('#explorer .explorer-file').getByText('normal', { exact: true }).click();
        const normalTable = page.locator('.tab-wrapper[data-tab-name="normal"] .editor-table');
        await expect(normalTable).toBeVisible();

        await use();
    },
});

// =============================================================================
// テスト群
// =============================================================================

test.describe('ISSUE_0092: 差分タブのスクロール位置復元時に行ヘッダーがずれる', () => {

    // -------------------------------------------------------------------------
    // 差分タブを右スクロール → タブバーで通常タブに切り替え → タブバーで差分タブに戻る
    // → 行ヘッダーの style.left が scrollLeft と一致すること
    //
    // 不具合状態（RED）:
    //   hide() で display:none → ブラウザが scrollLeft を 0 にリセット
    //   しかし scroll イベントは発火しないため行ヘッダーの left は古い値のまま
    //   show() で差分タブに戻ると scrollLeft=0 なのに行ヘッダーだけ left:Npx でずれる
    // -------------------------------------------------------------------------
    test(
        '差分タブ再表示時に行ヘッダーのleftがscrollLeftと一致すること',
        async ({ page, diffSetup: _diffSetup }) => {
            // ソースコントロールパネルから差分タブを開く
            await page.locator('[data-panel="sourceControl"]').click();
            const changesSection = page.locator('.source-control-changes-section');
            await expect(changesSection.getByText('wide_table')).toBeVisible();
            await changesSection.getByText('wide_table').click();
            await expect(page.locator('.diff-tab')).toBeVisible();

            // 差分タブの左ペインを取得
            const leftPane = page.locator('.diff-pane-left');
            await expect(leftPane).toBeVisible();

            // 右方向にスクロールする（scrollLeft を設定）
            await leftPane.evaluate((el) => {
                el.scrollLeft = 200;
            });

            // スクロールイベントが処理されるまで待つ
            // （行ヘッダーの style.left が更新されることを確認）
            await page.waitForTimeout(200);

            // スクロール後、行ヘッダーの style.left が 200px になっていることを確認する（事前条件）
            const leftBeforeSwitch = await leftPane.evaluate((el) => {
                const header = el.querySelector('.editor-table-row-header') as HTMLElement | null;
                if (!header) throw new Error('行ヘッダーが見つかりません');
                return header.style.left;
            });
            expect(leftBeforeSwitch).toBe('200px');

            // タブバーから通常テーブルのタブに切り替える
            // （エクスプローラーパネルに切り替えると closeAllDiffTabs() が呼ばれて差分タブが
            //   destroy されてしまうため、タブバーから切り替えて hide のみ発生させる）
            await page.locator('.tab-button', { hasText: 'normal' }).click();

            // 差分タブのラッパーが非表示になっていることを確認する
            const diffWrapper = page.locator('.diff-tab-wrapper');
            await expect(diffWrapper).toBeHidden();

            // タブバーから差分タブに戻る
            await page.locator('.tab-button', { hasText: '差分: wide_table' }).click();
            await expect(page.locator('.diff-tab')).toBeVisible();

            // 左ペイン: 行ヘッダーの style.left が scrollLeft と一致することを検証する
            // 不具合状態では scrollLeft=0 なのに行ヘッダーの left が 200px のままでずれる
            const leftResult = await leftPane.evaluate((el) => {
                const header = el.querySelector('.editor-table-row-header') as HTMLElement | null;
                if (!header) throw new Error('左ペインの行ヘッダーが見つかりません');
                return {
                    scrollLeft: el.scrollLeft,
                    headerLeft: header.style.left,
                };
            });
            // scrollLeft が 0 なら行ヘッダーの left も 0px であるべき
            // scrollLeft が 200 なら行ヘッダーの left も 200px であるべき
            // いずれにせよ両者が一致していることが正しい動作
            expect(leftResult.headerLeft).toBe(`${leftResult.scrollLeft}px`);

            // 右ペイン: 行ヘッダーの style.left が scrollLeft と一致することを検証する
            const rightPane = page.locator('.diff-pane-right');
            const rightResult = await rightPane.evaluate((el) => {
                const header = el.querySelector('.editor-table-row-header') as HTMLElement | null;
                if (!header) throw new Error('右ペインの行ヘッダーが見つかりません');
                return {
                    scrollLeft: el.scrollLeft,
                    headerLeft: header.style.left,
                };
            });
            expect(rightResult.headerLeft).toBe(`${rightResult.scrollLeft}px`);
        },
    );
});
