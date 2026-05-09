import { test as base, expect } from './fixtures/test';
import { MockFileSystem, installMockApiAsync } from './fixtures/mock-api';
import { getDataCell } from './fixtures/test-utils';

// =============================================================================
// ISSUE_0105: DiffTabでカンマ含有フィールドがあると未変更行が変更扱いになる問題
//
// 根本原因:
//   diff-rows.ts の parseCsv() が split(',') でフィールドを分割するため、
//   RFC4180準拠のダブルクォートで囲まれたカンマ含有フィールドを正しく処理できない。
//   例: HEAD版 `1,"hello,world",100` → parseCsv → ["1",'"hello','world"',"100"] (4列)
//   列数がずれるため、後続の未変更行の比較で列がずれ、全セルがchangedと判定される。
//
// 期待動作:
//   DiffTabの右ペインで未変更行のセルに .diff-cell-added が付与されないこと。
// =============================================================================

// テスト用スキーマ（id, name, value の3列テーブル）------------------------------

const TEST_SCHEMA = JSON.stringify({
    header: [
        { key: 0, name: "id", type: "int" },
        { key: 1, name: "name", type: "string" },
        { key: 2, name: "value", type: "int" },
    ],
    primary_key: ["id"],
});

// テスト用CSV -----------------------------------------------------------------

/**
 * 現在版CSV（working tree）
 *   id=1: value が 100→150 に変更、nameにカンマ含有フィールド
 *   id=2: 未変更（nameにカンマ含有フィールド）
 *
 * RFC4180: カンマを含むフィールドはダブルクォートで囲む
 */
const CURRENT_CSV = [
    'id,name,value',
    '1,"hello,world",150',
    '2,"foo,bar",200',
].join("\n");

/**
 * HEAD版CSV（変更前）
 *   id=1: value=100、nameにカンマ含有フィールド
 *   id=2: 未変更（nameにカンマ含有フィールド）
 */
const HEAD_CSV = [
    'id,name,value',
    '1,"hello,world",100',
    '2,"foo,bar",200',
].join("\n");

// git status 定義 -------------------------------------------------------------

const GIT_STATUS = {
    changes: [{ path: "data/test.csv", tableName: "test", isNew: false }],
    staged: [] as { path: string; tableName: string; isNew: boolean }[],
};

const HEAD_FILES: Record<string, string> = {
    "data/test.csv": HEAD_CSV,
};

// ファイルシステム生成 ---------------------------------------------------------

function createTestFileSystem(): MockFileSystem {
    return {
        "schema/test.json": TEST_SCHEMA,
        "data/test.csv": CURRENT_CSV,
    };
}

// フィクスチャ -----------------------------------------------------------------

interface DiffTabUnchangedRowsFixtures {
    /** git差分状態をセットアップした状態でページを開く */
    diffTabPage: void;
}

const test = base.extend<DiffTabUnchangedRowsFixtures>({
    diffTabPage: async ({ page }, use) => {
        await page.addInitScript((args: {
            status: { changes: { path: string; tableName: string; isNew: boolean }[]; staged: { path: string; tableName: string; isNew: boolean }[] };
            headFiles: Record<string, string>;
        }) => {
            (window as unknown as { __mockGitStatus: object }).__mockGitStatus = args.status;
            (window as unknown as { __mockGitHeadFiles: Record<string, string> }).__mockGitHeadFiles = args.headFiles;
        }, { status: GIT_STATUS, headFiles: HEAD_FILES });

        await installMockApiAsync(page, createTestFileSystem());
        await page.goto('/');
        await use();
    },
});

// テスト本体 -------------------------------------------------------------------

test.describe('ISSUE_0105: DiffTabでカンマ含有フィールドがあると未変更行が変更扱いになる', () => {

    test(
        '右ペインの未変更行（id=2）のセルに .diff-cell-added が付与されないこと',
        async ({ page, diffTabPage: _diffTabPage }) => {
            // ソース管理パネルを開く
            await page.locator('[data-panel="sourceControl"]').click();

            // CHANGES セクションの test テーブルをクリックして差分タブを開く
            const changesSection = page.locator('.source-control-changes-section');
            await expect(changesSection.getByText('test')).toBeVisible();
            await changesSection.getByText('test').click();

            // 差分タブが開いていることを確認する
            const diffTab = page.locator('.diff-tab');
            await expect(diffTab).toBeVisible();

            // 右ペイン（現在版）のEditorTableを取得する
            const rightPane = diffTab.locator('.diff-pane-right');
            await expect(rightPane.locator('.editor-table')).toBeVisible();
            const rightTable = rightPane.locator('.editor-table');

            // 左ペイン（HEAD版）のEditorTableを取得する
            const leftPane = diffTab.locator('.diff-pane-left');
            await expect(leftPane.locator('.editor-table')).toBeVisible();
            const leftTable = leftPane.locator('.editor-table');

            // 前提条件: id=1の変更セル（value列, colIndex=2）にdiff-cell-addedが付与されている
            // HEAD版: value=100, 現在版: value=150 → 差分あり
            const changedCell = getDataCell(rightTable, 0, 2);
            await expect(changedCell).toHaveClass(/diff-cell-added/);

            // 検証: id=2の行（rowIndex=1）は未変更なので、全セルにdiff-cell-addedが付与されていないこと
            // バグ状態: parseCsv が split(',') でカンマ含有フィールドを誤分割し、
            //   id=2行の列比較がずれて全セルがchangedと判定される
            const unchangedId = getDataCell(rightTable, 1, 0);
            const unchangedName = getDataCell(rightTable, 1, 1);
            const unchangedValue = getDataCell(rightTable, 1, 2);

            await expect(unchangedId).not.toHaveClass(/diff-cell-added/);
            await expect(unchangedName).not.toHaveClass(/diff-cell-added/);
            await expect(unchangedValue).not.toHaveClass(/diff-cell-added/);

            // 左ペインのid=2行にもdiff-cell-deletedが付与されていないこと
            const leftUnchangedId = getDataCell(leftTable, 1, 0);
            const leftUnchangedName = getDataCell(leftTable, 1, 1);
            const leftUnchangedValue = getDataCell(leftTable, 1, 2);

            await expect(leftUnchangedId).not.toHaveClass(/diff-cell-deleted/);
            await expect(leftUnchangedName).not.toHaveClass(/diff-cell-deleted/);
            await expect(leftUnchangedValue).not.toHaveClass(/diff-cell-deleted/);
        },
    );

});
