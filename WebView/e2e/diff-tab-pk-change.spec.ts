import { test as base, expect } from './fixtures/test';
import { MockFileSystem, installMockApiAsync } from './fixtures/mock-api';

// =============================================================================
// 主キー変更時の差分タブ表示検証テスト
//
// 不具合:
//   主キーを変更したCSV（例: id=3 → id=4）を差分ビューで表示すると、
//   左ペイン（HEAD版）に変更前の主キー行（id=3）が表示されない。
//
// 期待する動作:
//   - 左ペインに HEAD版の全行（id=1, id=2, id=3）が表示されること
//   - id=3 の行は削除行（.diff-row-deleted）としてハイライトされること
//   - 右ペインに 現在版の全行（id=1, id=2, id=4）が表示されること
//   - id=4 の行は追加行（全セルに.diff-cell-added）としてハイライトされること
//
// 検証シナリオ:
//   HEAD版CSV: id,name\n1,A\n2,B\n3,C
//   Current版CSV: id,name\n1,A\n2,B\n4,D
//   主キー: id
// =============================================================================

// テスト用スキーマ（id, name の2列テーブル）
const SCHEMA = JSON.stringify({
    header: [
        { key: 0, name: "id", type: "int" },
        { key: 1, name: "name", type: "string" },
    ],
    primary_key: ["id"],
});

// 現在版CSV（working tree）— id=3 を削除して id=4 を追加した状態
const CURRENT_CSV = [
    "id,name",
    "1,A",
    "2,B",
    "4,D",
].join("\n");

// HEAD版CSV（変更前）— id=3 が存在する
const HEAD_CSV = [
    "id,name",
    "1,A",
    "2,B",
    "3,C",
].join("\n");

// git status レスポンス（pk_test テーブルが changes 状態）
const GIT_STATUS = {
    changes: [{ path: "data/pk_test.csv", tableName: "pk_test", isNew: false }],
    staged: [] as { path: string; tableName: string; isNew: boolean }[],
};

// HEAD版ファイルマップ
const HEAD_FILES: Record<string, string> = {
    "data/pk_test.csv": HEAD_CSV,
};

function createFileSystem(): MockFileSystem {
    return {
        "schema/pk_test.json": SCHEMA,
        "data/pk_test.csv": CURRENT_CSV,
    };
}

// フィクスチャ型定義
interface PkChangeFixtures {
    /** git差分状態（PK変更テーブル）をセットアップした状態でページを開く */
    pkChangePage: void;
}

/**
 * PK変更テスト用フィクスチャ
 * addInitScript は goto より前に実行する必要があるため、
 * installMockApiAsync より前に __mockGitStatus / __mockGitHeadFiles を設定する
 */
const test = base.extend<PkChangeFixtures>({
    pkChangePage: async ({ page }, use) => {
        await page.addInitScript((args: {
            status: { changes: { path: string; tableName: string; isNew: boolean }[]; staged: { path: string; tableName: string; isNew: boolean }[] };
            headFiles: Record<string, string>;
        }) => {
            (window as unknown as { __mockGitStatus: object }).__mockGitStatus = args.status;
            (window as unknown as { __mockGitHeadFiles: Record<string, string> }).__mockGitHeadFiles = args.headFiles;
        }, { status: GIT_STATUS, headFiles: HEAD_FILES });

        await installMockApiAsync(page, createFileSystem());
        await page.goto('/');
        await use();
    },
});

test.describe('主キー変更時の差分タブ表示', () => {

    // -------------------------------------------------------------------------
    // テスト1: 左ペイン（HEAD版）に削除行（id=3）が表示されること
    //
    // HEAD版にのみ存在する id=3 は deleted 行として左ペインに表示される。
    // buildDiffRows は HEAD版の行順でループし、Current版に存在しない行を
    // deleted として元の位置に配置するため、id=3 は id=2 の次に表示されるはず。
    // -------------------------------------------------------------------------
    test(
        '左ペインにHEAD版の削除行（id=3, name=C）が diff-row-deleted として表示されること',
        async ({ page, pkChangePage: _pkChangePage }) => {
            // ソース管理パネルを開く
            await page.locator('[data-panel="sourceControl"]').click();
            const changesSection = page.locator('.source-control-changes-section');
            await expect(changesSection).toBeVisible();

            // pk_test の差分タブを開く
            await changesSection.getByText('pk_test').click();
            const diffTab = page.locator('.diff-tab');
            await expect(diffTab).toBeVisible();

            // 左ペイン（HEAD版）の削除行を検証する
            const leftPane = diffTab.locator('.diff-pane-left');
            await expect(leftPane).toBeVisible();

            // diff-row-deleted クラスを持つ行が1つ存在すること
            const deletedRows = leftPane.locator('.editor-table-grid .diff-row-deleted');
            await expect(deletedRows).toHaveCount(1);

            // 削除行のセル内容が id=3, name=C であること
            // EditorTable のセル構造: .editor-table-row > .editor-table-row-header + .editor-table-cell * N
            const deletedCells = deletedRows.locator('.editor-table-cell:not(.editor-table-row-header)');
            await expect(deletedCells.nth(0)).toHaveText('3');
            await expect(deletedCells.nth(1)).toHaveText('C');
        },
    );

    // -------------------------------------------------------------------------
    // テスト2: 右ペイン（現在版）に追加行（id=4）が表示されること
    //
    // 現在版にのみ存在する id=4 は added 行として右ペインに表示される。
    // buildDiffRows は Current版の行順で未処理行をループし、
    // HEAD版に存在しない行を added として末尾に追加する。
    // -------------------------------------------------------------------------
    test(
        '右ペインに現在版の追加行（id=4, name=D）の全セルに diff-cell-added が付与されること',
        async ({ page, pkChangePage: _pkChangePage }) => {
            // ソース管理パネルを開く
            await page.locator('[data-panel="sourceControl"]').click();
            const changesSection = page.locator('.source-control-changes-section');
            await expect(changesSection).toBeVisible();

            // pk_test の差分タブを開く
            await changesSection.getByText('pk_test').click();
            const diffTab = page.locator('.diff-tab');
            await expect(diffTab).toBeVisible();

            // 右ペイン（現在版）の追加行を検証する
            const rightPane = diffTab.locator('.diff-pane-right');
            await expect(rightPane).toBeVisible();

            // 追加行は行ヘッダーに diff-cell-added が付与された行として特定する
            const addedRowHeaders = rightPane.locator('.editor-table-grid .editor-table-row-header.diff-cell-added');
            await expect(addedRowHeaders).toHaveCount(1);

            // 追加行の全データセルにも diff-cell-added が付与されていること
            const addedRow = addedRowHeaders.locator('..');
            const addedCells = addedRow.locator('.editor-table-cell:not(.editor-table-row-header)');
            await expect(addedCells.nth(0)).toHaveText('4');
            await expect(addedCells.nth(1)).toHaveText('D');
            await expect(addedCells.nth(0)).toHaveClass(/diff-cell-added/);
            await expect(addedCells.nth(1)).toHaveClass(/diff-cell-added/);
        },
    );

    // -------------------------------------------------------------------------
    // テスト3: 左ペインに全3行（id=1, id=2, id=3）が表示されること
    //
    // HEAD版の全行が左ペインに表示されることを検証する。
    // unchanged行2つ（id=1, id=2）+ deleted行1つ（id=3）= 合計3行。
    // ただし added 行に対応する空白パディング行もDOMに存在するため、
    // データを持つ行（diff-row-empty でない行）が3つであることを確認する。
    // -------------------------------------------------------------------------
    test(
        '左ペインにHEAD版の全3行（id=1, id=2, id=3）がデータ行として表示されること',
        async ({ page, pkChangePage: _pkChangePage }) => {
            // ソース管理パネルを開く
            await page.locator('[data-panel="sourceControl"]').click();
            const changesSection = page.locator('.source-control-changes-section');
            await expect(changesSection).toBeVisible();

            // pk_test の差分タブを開く
            await changesSection.getByText('pk_test').click();
            const diffTab = page.locator('.diff-tab');
            await expect(diffTab).toBeVisible();

            // 左ペインの EditorTable 内のデータ行を検証する
            // 列ヘッダー行（.editor-table-column-header-row）を除いた .editor-table-row のうち、
            // 空白パディング行（.diff-row-empty）を除いたデータ行が3つであること
            const leftPane = diffTab.locator('.diff-pane-left');
            const leftDataRows = leftPane.locator('.editor-table-row:not(.editor-table-column-header-row):not(.diff-row-empty)');
            await expect(leftDataRows).toHaveCount(3);

            // 各データ行の id 列（1列目）の値を検証する
            // HEAD版の行順は id=1, id=2, id=3
            const firstRowId = leftDataRows.nth(0).locator('.editor-table-cell:not(.editor-table-row-header)').nth(0);
            const secondRowId = leftDataRows.nth(1).locator('.editor-table-cell:not(.editor-table-row-header)').nth(0);
            const thirdRowId = leftDataRows.nth(2).locator('.editor-table-cell:not(.editor-table-row-header)').nth(0);
            await expect(firstRowId).toHaveText('1');
            await expect(secondRowId).toHaveText('2');
            await expect(thirdRowId).toHaveText('3');
        },
    );

    // -------------------------------------------------------------------------
    // テスト4: 右ペインに全3行（id=1, id=2, id=4）が表示されること
    //
    // 現在版の全行が右ペインに表示されることを検証する。
    // unchanged行2つ（id=1, id=2）+ added行1つ（id=4）= 合計3行。
    // deleted 行に対応する空白パディング行もDOMに存在するため、
    // データを持つ行（diff-row-empty でない行）が3つであることを確認する。
    // -------------------------------------------------------------------------
    test(
        '右ペインに現在版の全3行（id=1, id=2, id=4）がデータ行として表示されること',
        async ({ page, pkChangePage: _pkChangePage }) => {
            // ソース管理パネルを開く
            await page.locator('[data-panel="sourceControl"]').click();
            const changesSection = page.locator('.source-control-changes-section');
            await expect(changesSection).toBeVisible();

            // pk_test の差分タブを開く
            await changesSection.getByText('pk_test').click();
            const diffTab = page.locator('.diff-tab');
            await expect(diffTab).toBeVisible();

            // 右ペインの EditorTable 内のデータ行を検証する
            const rightPane = diffTab.locator('.diff-pane-right');
            const rightDataRows = rightPane.locator('.editor-table-row:not(.editor-table-column-header-row):not(.diff-row-empty)');
            await expect(rightDataRows).toHaveCount(3);

            // 各データ行の id 列（1列目）の値を検証する
            // 現在版の行順と added 行の配置を考慮する:
            // buildDiffRows は HEAD版の行順でループするため、結果は以下の順になる:
            //   [unchanged(id=1), unchanged(id=2), deleted(id=3), added(id=4)]
            // 右ペインでは deleted 行は空白パディング、added 行はデータ行になる。
            // つまり右ペインのデータ行は: id=1, id=2, id=4
            const firstRowId = rightDataRows.nth(0).locator('.editor-table-cell:not(.editor-table-row-header)').nth(0);
            const secondRowId = rightDataRows.nth(1).locator('.editor-table-cell:not(.editor-table-row-header)').nth(0);
            const thirdRowId = rightDataRows.nth(2).locator('.editor-table-cell:not(.editor-table-row-header)').nth(0);
            await expect(firstRowId).toHaveText('1');
            await expect(secondRowId).toHaveText('2');
            await expect(thirdRowId).toHaveText('4');
        },
    );

});
