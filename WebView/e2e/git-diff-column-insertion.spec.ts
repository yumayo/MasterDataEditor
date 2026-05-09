import { test as base, expect } from './fixtures/test';
import { MockFileSystem, installMockApiAsync } from './fixtures/mock-api';
import { getDataCell } from './fixtures/test-utils';

// =============================================================================
// 列挿入時のgit差分ハイライトテスト
//
// シナリオ:
//   HEAD版CSVには end_at 列が存在しないが、現在版CSVには end_at 列が
//   start_at と description の間に挿入されている。
//   GitDiffTracker は列名ベースで差分を判定するため:
//   - end_at（新規列）: HEAD版に存在しない → 全行で .cell-git-changed が付与される
//   - description（既存列、値変更なし）: .cell-git-changed は付与されない
//   - その他の既存列（値変更なし）: .cell-git-changed は付与されない
// =============================================================================

// テスト共通データ ---------------------------------------------------------------

/**
 * テスト用buffスキーマ（現在版、6列構成）
 * end_at列がstart_atとdescriptionの間に挿入されている
 */
const BUFF_SCHEMA = JSON.stringify({
    header: [
        { key: 0, name: "id", type: "int" },
        { key: 1, name: "name", type: "string" },
        { key: 8, name: "cooldown_ms", type: "int" },
        { key: 9, name: "start_at", type: "datetime" },
        { key: 10, name: "end_at", type: "datetime" },
        { key: 11, name: "description", type: "string" },
    ],
    primary_key: ["id"],
});

/**
 * HEAD版CSV（end_at列なし、5列構成）
 * git show HEAD:data/buff.csv で返されるデータ
 */
const HEAD_BUFF_CSV = [
    "id,name,cooldown_ms,start_at,description",
    "1,攻撃力アップ,5000,2026-01-01 00:00:00,攻撃力を50%上昇させる",
    "2,防御力アップ,3000,2026-01-15 12:00:00,防御力を30%上昇させる",
].join("\n");

/**
 * 現在版CSV（end_at列あり、6列構成）
 * start_atとdescriptionの間にend_atが挿入されている
 * description列の値はHEAD版と同一
 */
const CURRENT_BUFF_CSV = [
    "id,name,cooldown_ms,start_at,end_at,description",
    "1,攻撃力アップ,5000,2026-01-01 00:00:00,2026-03-31 23:59:59,攻撃力を50%上昇させる",
    "2,防御力アップ,3000,2026-01-15 12:00:00,2026-04-15 12:00:00,防御力を30%上昇させる",
].join("\n");

/**
 * 初期git status: buffテーブルが変更済み（isNew: false）
 * テーブルオープン時にGitDiffTrackerが即座に構築される
 */
const INITIAL_GIT_STATUS = {
    changes: [
        { path: "data/buff.csv", tableName: "buff", isNew: false },
    ],
    staged: [],
};

/**
 * テスト用ファイルシステム（スキーマ + 現在版CSV）
 */
function createColumnInsertionFileSystem(): MockFileSystem {
    return {
        "schema/buff.json": BUFF_SCHEMA,
        "data/buff.csv": CURRENT_BUFF_CSV,
    };
}

// フィクスチャ型定義 -------------------------------------------------------------

interface GitDiffColumnInsertionFixtures {
    /** git status と HEAD ファイルをセットアップした状態でページを開く */
    gitDiffColumnInsertionPage: void;
}

/**
 * 列挿入時git差分ハイライトテスト用フィクスチャ
 * 初期状態: buffテーブルがchangesに含まれる（isNew: false）
 * テーブルオープン時に GitDiffTracker が構築され、列名ベースで差分が検出される
 */
const test = base.extend<GitDiffColumnInsertionFixtures>({
    gitDiffColumnInsertionPage: async ({ page }, use) => {
        // git状態を設定する: buffテーブルが変更済み
        // HEAD版ファイルも初期設定する（テーブルオープン時にgit showで取得されるため）
        await page.addInitScript((args: {
            status: { changes: object[]; staged: object[] };
            headFiles: Record<string, string>;
        }) => {
            (window as unknown as { __mockGitStatus: object }).__mockGitStatus = args.status;
            (window as unknown as { __mockGitHeadFiles: Record<string, string> }).__mockGitHeadFiles = args.headFiles;
        }, { status: INITIAL_GIT_STATUS, headFiles: { "data/buff.csv": HEAD_BUFF_CSV } });

        await installMockApiAsync(page, createColumnInsertionFileSystem());
        await page.goto('/');
        await use();
    },
});

// テスト本体 -------------------------------------------------------------------

test.describe('列挿入時のgit差分ハイライト', () => {

    // -------------------------------------------------------------------------
    // テスト1: 新規列(end_at)のセルに .cell-git-changed が付与されること
    // -------------------------------------------------------------------------
    test(
        '列挿入時、新規列(end_at)のセルに .cell-git-changed が付与されること',
        async ({ page, gitDiffColumnInsertionPage: _gitDiffColumnInsertionPage }) => {
            // buffテーブルを開く
            await page.locator('#explorer .explorer-file').getByText('buff').click();

            const table = page.locator(
                `.editor-left-pane .tab-wrapper[data-tab-name="buff"] .editor-table`,
            );
            await expect(table).toBeVisible();

            // end_at列はDOM列インデックス4（id=0, name=1, cooldown_ms=2, start_at=3, end_at=4）
            // HEAD版にend_at列は存在しないため、リマップ時に空文字がセットされる
            // 現在版には値があるため、全行で .cell-git-changed が付与されるはず
            const endAtRow0 = getDataCell(table, 0, 4);
            const endAtRow1 = getDataCell(table, 1, 4);
            await expect(endAtRow0).toHaveClass(/cell-git-changed/);
            await expect(endAtRow1).toHaveClass(/cell-git-changed/);
        },
    );

    // -------------------------------------------------------------------------
    // テスト2: 値が変わっていない既存列のセルに .cell-git-changed が付与されないこと
    // -------------------------------------------------------------------------
    test(
        '列挿入時、値が変わっていない既存列(description等)のセルに .cell-git-changed が付与されないこと',
        async ({ page, gitDiffColumnInsertionPage: _gitDiffColumnInsertionPage }) => {
            // buffテーブルを開く
            await page.locator('#explorer .explorer-file').getByText('buff').click();

            const table = page.locator(
                `.editor-left-pane .tab-wrapper[data-tab-name="buff"] .editor-table`,
            );
            await expect(table).toBeVisible();

            // description列（DOM列インデックス5）: HEAD版と同じ値 → .cell-git-changed なし
            const descRow0 = getDataCell(table, 0, 5);
            const descRow1 = getDataCell(table, 1, 5);
            await expect(descRow0).not.toHaveClass(/cell-git-changed/);
            await expect(descRow1).not.toHaveClass(/cell-git-changed/);

            // start_at列（DOM列インデックス3）: HEAD版と同じ値 → .cell-git-changed なし
            const startAtRow0 = getDataCell(table, 0, 3);
            const startAtRow1 = getDataCell(table, 1, 3);
            await expect(startAtRow0).not.toHaveClass(/cell-git-changed/);
            await expect(startAtRow1).not.toHaveClass(/cell-git-changed/);

            // name列（DOM列インデックス1）: HEAD版と同じ値 → .cell-git-changed なし
            const nameRow0 = getDataCell(table, 0, 1);
            const nameRow1 = getDataCell(table, 1, 1);
            await expect(nameRow0).not.toHaveClass(/cell-git-changed/);
            await expect(nameRow1).not.toHaveClass(/cell-git-changed/);
        },
    );

});
