import { test as base, expect } from './fixtures/test';
import { MockFileSystem, installMockApiAsync } from './fixtures/mock-api';
import { getDataCell } from './fixtures/test-utils';

// =============================================================================
// BUG_0006 リグレッションテスト — git show パスのハードコード問題
//
// 不具合の概要:
//   workDir がgitリポジトリルートのサブディレクトリ（例: sample-workdir/）の場合、
//   `git status` が返すパスは "subdir/data/xxx.csv" 形式になる。
//   しかし tab.ts の connectGitDiffTrackerAsync() では
//       gitShowAsync('data/' + name + '.csv')
//   とパスをハードコードしているため、git show に渡すパスが
//   実際の git status エントリのパスと一致せずHEAD版CSVを取得できない。
//
// 期待する動作（GREEN条件）:
//   tab.ts が entry.path をそのまま gitShowAsync() に渡すこと。
//   HEAD版CSVが正しく取得されれば .cell-git-changed が付与される。
//
// RED状態の理由:
//   tab.ts 905行目: gitShowAsync('data/' + name + '.csv') とハードコードされており、
//   git_status エントリの path（"subdir/data/test.csv"）を使用していない。
//   HEAD版CSVが "subdir/data/test.csv" キーにしか存在しないため git show が失敗し、
//   .cell-git-changed が付与されない。
// =============================================================================

// テスト共通データ ---------------------------------------------------------------

/**
 * テスト用スキーマ（id, name, value の3列テーブル）
 */
const TEST_SCHEMA = JSON.stringify({
    header: [
        { key: 0, name: "id", type: "int" },
        { key: 1, name: "name", type: "string" },
        { key: 2, name: "value", type: "int" },
    ],
    primary_key: ["id"],
});

/**
 * 現在版CSV（id=1 の value が 100→150 に変更されている）
 */
const CURRENT_CSV = [
    "id,name,value",
    "1,item_a,150",
    "2,item_b,200",
].join("\n");

/**
 * HEAD版CSV（git show で取得される変更前の内容）
 *   id=1 の value=100（変更前）
 */
const HEAD_CSV = [
    "id,name,value",
    "1,item_a,100",
    "2,item_b,200",
].join("\n");

/**
 * git status レスポンス
 * path が "subdir/data/test.csv"（data/ 非プレフィックス）になっているケース
 * これが BUG_0006 の核心：workDir がサブディレクトリのとき git はリポジトリルート相対パスを返す
 */
const GIT_STATUS = {
    changes: [
        { path: "subdir/data/test.csv", tableName: "test", isNew: false },
    ],
    staged: [],
};

/**
 * HEAD版ファイルマップ
 * キーは git status が返す path と同一の "subdir/data/test.csv"
 * "data/test.csv" キーは意図的に存在させない（バグ再現のため）
 */
const HEAD_FILES: Record<string, string> = {
    "subdir/data/test.csv": HEAD_CSV,
};

/**
 * テスト用ファイルシステム（スキーマ + 現在版CSV）
 */
function createBug0006FileSystem(): MockFileSystem {
    return {
        "schema/test.json": TEST_SCHEMA,
        "data/test.csv": CURRENT_CSV,
    };
}

// フィクスチャ型定義 -------------------------------------------------------------

interface Bug0006Fixtures {
    /** git status の path が非 data/ プレフィックスになっている状態でページを開く */
    bug0006Page: void;
}

/**
 * BUG_0006 テスト用フィクスチャ
 * addInitScript は goto より前に実行する必要があるため、
 * installMockApiAsync より前に __mockGitStatus / __mockGitHeadFiles を設定する
 */
const test = base.extend<Bug0006Fixtures>({
    bug0006Page: async ({ page }, use) => {
        // gitモックデータを window に設定する（installMockApiAsync より前に実行が必須）
        await page.addInitScript((args: {
            status: {
                changes: { path: string; tableName: string; isNew: boolean }[];
                staged: { path: string; tableName: string; isNew: boolean }[];
            };
            headFiles: Record<string, string>;
        }) => {
            (window as unknown as { __mockGitStatus: object }).__mockGitStatus = args.status;
            (window as unknown as {
                __mockGitHeadFiles: Record<string, string>;
            }).__mockGitHeadFiles = args.headFiles;
        }, { status: GIT_STATUS, headFiles: HEAD_FILES });

        await installMockApiAsync(page, createBug0006FileSystem());
        await page.goto('/');
        await use();
    },
});

// テスト本体 -------------------------------------------------------------------

test.describe('BUG_0006: git show パスのハードコード問題', () => {

    // -------------------------------------------------------------------------
    // テスト1: entry.path を使って git show が呼ばれること
    //
    // 検証方法:
    //   HEAD版CSVを "subdir/data/test.csv" キーにのみ配置し、
    //   "data/test.csv" キーには配置しない。
    //   tab.ts が entry.path（"subdir/data/test.csv"）を使って git show を呼べば
    //   HEAD版CSVを取得でき .cell-git-changed が付与される。
    //   ハードコードパス（"data/test.csv"）で呼べば取得失敗 → .cell-git-changed なし → RED。
    // -------------------------------------------------------------------------
    test(
        'git statusのentry.pathが "data/" 非プレフィックスでもHEAD版CSVが取得され .cell-git-changed が付与されること',
        async ({ page, bug0006Page: _bug0006Page }) => {
            // test テーブルを開く
            await page.locator('#explorer .explorer-file').getByText('test').click();

            const table = page.locator(
                `.editor-left-pane .tab-wrapper[data-tab-name="test"] .editor-table`,
            );

            // id=1 の value 列（col=2）は HEAD版(100) から 150 に変更されている。
            // tab.ts が entry.path をそのまま gitShowAsync() に渡せば HEAD版CSVが取得でき
            // .cell-git-changed が付与される。
            // 現在の実装 ('data/' + name + '.csv') では "data/test.csv" で git show を呼ぶが
            // HEAD_FILES に "data/test.csv" キーが存在しないため失敗し、クラスが付与されない（RED）。
            const changedValueCell = getDataCell(table, 0, 2);
            await expect(changedValueCell).toHaveClass(/cell-git-changed/);
        },
    );

    // -------------------------------------------------------------------------
    // テスト2: 変更のないセルには .cell-git-changed が付与されないこと
    //
    // HEAD版CSVが正しく取得できたときの正常系確認。
    // id=2 の各列は変更なしなのでクラスが付与されないことを確認する。
    // -------------------------------------------------------------------------
    test(
        'git statusのentry.pathが "data/" 非プレフィックスでもHEAD版CSVが取得され変更なしセルに .cell-git-changed が付与されないこと',
        async ({ page, bug0006Page: _bug0006Page }) => {
            // test テーブルを開く
            await page.locator('#explorer .explorer-file').getByText('test').click();

            const table = page.locator(
                `.editor-left-pane .tab-wrapper[data-tab-name="test"] .editor-table`,
            );

            // id=2 の全列（rowIndex=1）は変更なし → .cell-git-changed が付与されないことを確認する。
            // HEAD版CSVが取得できていれば変更なし判定が正しく機能する。
            // HEAD版CSVの取得に失敗している（RED）場合、このテストはパスするが
            // テスト1が失敗することで不具合を検出する。
            const unchangedId = getDataCell(table, 1, 0);
            const unchangedName = getDataCell(table, 1, 1);
            const unchangedValue = getDataCell(table, 1, 2);
            await expect(unchangedId).not.toHaveClass(/cell-git-changed/);
            await expect(unchangedName).not.toHaveClass(/cell-git-changed/);
            await expect(unchangedValue).not.toHaveClass(/cell-git-changed/);

            // id=1 の id列・name列も変更なし（value列のみ変更）
            const id1IdCell = getDataCell(table, 0, 0);
            const id1NameCell = getDataCell(table, 0, 1);
            await expect(id1IdCell).not.toHaveClass(/cell-git-changed/);
            await expect(id1NameCell).not.toHaveClass(/cell-git-changed/);
        },
    );

});
