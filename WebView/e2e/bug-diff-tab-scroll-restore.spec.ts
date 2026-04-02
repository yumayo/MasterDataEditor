import { test as base, expect } from './fixtures/test';
import { MockFileSystem, installMockApiAsync } from './fixtures/mock-api';
import { Page } from '@playwright/test';

// =============================================================================
// ISSUE_0092: 差分タブのスクロール位置復元時に行ヘッダーがずれる
//
// 行ヘッダーは CSS position:sticky; left:0 で固定されるため、
// display:none → display:'' の切り替えでもブラウザが自動で位置を管理する。
// このテストは差分タブの表示切替後も行ヘッダーがスクロールコンテナの
// 左端に視覚的に固定されていることを getBoundingClientRect() で検証する。
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
    // → 行ヘッダーがスクロールコンテナの左端に視覚的に固定されていること
    //
    // CSS position:sticky; left:0 により、display:none → display:'' の切り替え後も
    // ブラウザが自動で行ヘッダーの位置を管理する。
    // -------------------------------------------------------------------------
    test(
        '差分タブ再表示時に行ヘッダーがスクロールコンテナの左端に固定されていること',
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
            await page.waitForTimeout(200);

            // スクロール後、行ヘッダーがコンテナの左端に固定されていることを確認する（事前条件）
            const offsetBeforeSwitch = await leftPane.evaluate((el) => {
                const header = el.querySelector('.editor-table-row-header') as HTMLElement | null;
                if (!header) throw new Error('行ヘッダーが見つかりません');
                return Math.abs(header.getBoundingClientRect().left - el.getBoundingClientRect().left);
            });
            // 行ヘッダーはスクロールコンテナの左端に固定されるべき（1px以内の誤差を許容）
            expect(offsetBeforeSwitch).toBeLessThanOrEqual(1);

            // タブバーから通常テーブルのタブに切り替える
            await page.locator('.tab-button', { hasText: 'normal' }).click();

            // 差分タブのラッパーが非表示になっていることを確認する
            const diffWrapper = page.locator('.diff-tab-wrapper');
            await expect(diffWrapper).toBeHidden();

            // タブバーから差分タブに戻る
            await page.locator('.tab-button', { hasText: '差分: wide_table' }).click();
            await expect(page.locator('.diff-tab')).toBeVisible();

            // 左ペイン: 行ヘッダーがスクロールコンテナの左端に固定されていることを検証する
            const leftOffset = await leftPane.evaluate((el) => {
                const header = el.querySelector('.editor-table-row-header') as HTMLElement | null;
                if (!header) throw new Error('左ペインの行ヘッダーが見つかりません');
                return Math.abs(header.getBoundingClientRect().left - el.getBoundingClientRect().left);
            });
            expect(leftOffset).toBeLessThanOrEqual(1);

            // 右ペイン: 行ヘッダーがスクロールコンテナの左端に固定されていることを検証する
            const rightPane = page.locator('.diff-pane-right');
            const rightOffset = await rightPane.evaluate((el) => {
                const header = el.querySelector('.editor-table-row-header') as HTMLElement | null;
                if (!header) throw new Error('右ペインの行ヘッダーが見つかりません');
                return Math.abs(header.getBoundingClientRect().left - el.getBoundingClientRect().left);
            });
            expect(rightOffset).toBeLessThanOrEqual(1);
        },
    );
});
