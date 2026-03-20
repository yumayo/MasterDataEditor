import { test as base, expect } from './fixtures/test';
import { MockFileSystem, installMockApiAsync } from './fixtures/mock-api';

// =============================================================================
// BUG — 差分ビューで右ペインに行を挿入すると左ペインの行番号が消える不具合
//
// 根本原因:
//   原因1: editor-table.ts の createPaddingRow() (L667-682)
//     行ヘッダーセル（.editor-table-row-header）にテキストコンテンツを設定していない。
//     パディング行の行番号欄が空白のまま生成される。
//
//   原因2: diff-tab.ts の renumberLeftRows() (L344-349)
//     data-row 属性のみ更新し、行ヘッダーのテキストノード（行番号表示）と
//     data-rowIndex 属性を更新していない。
//     さらに notifyRightPaneRowInserted での呼び出しが rowIndex + 1 から始まるため、
//     挿入されたパディング行自身が再ナンバリング対象外になっている。
//
// 検証シナリオ:
//   1. chara テーブル（id, name の2列）をセットアップ
//      HEAD版: id=1〜4（4行）、Current版: id=1〜3（3行、id=4が削除済み）
//   2. ソースコントロールから chara の差分タブを開く
//   3. 右ペインの3行目（id=3の行）の行ヘッダーを右クリック → 下に行を挿入
//   4. 左ペインの新規挿入パディング行に行番号が表示されること（バグ1の検証）
//   5. 左ペインの既存行の行番号が正しく再ナンバリングされること（バグ2の検証）
// =============================================================================

// テスト用スキーマ（chara: id, name の2列テーブル）
const CHARA_SCHEMA = JSON.stringify({
    header: [
        { key: 0, name: "id", type: "int" },
        { key: 1, name: "name", type: "string" },
    ],
    primary_key: ["id"],
});

// 現在版CSV（working tree）— id=1〜3（id=4が削除済み）
const CURRENT_CHARA_CSV = [
    "id,name",
    "1,hero",
    "2,mage",
    "3,rogue",
].join("\n");

// HEAD版CSV（変更前）— id=1〜4 が存在
const HEAD_CHARA_CSV = [
    "id,name",
    "1,hero",
    "2,mage",
    "3,rogue",
    "4,warrior",
].join("\n");

// git status レスポンス（chara が changes 状態）
const GIT_STATUS = {
    changes: [{ path: "data/chara.csv", tableName: "chara", isNew: false }],
    staged: [] as { path: string; tableName: string; isNew: boolean }[],
};

// HEAD版ファイルマップ
const HEAD_FILES: Record<string, string> = {
    "data/chara.csv": HEAD_CHARA_CSV,
};

function createCharaFileSystem(): MockFileSystem {
    return {
        "schema/chara.json": CHARA_SCHEMA,
        "data/chara.csv": CURRENT_CHARA_CSV,
    };
}

// フィクスチャ型定義
interface BugDiffRowNumberFixtures {
    /** git差分状態をセットアップした状態でページを開くフィクスチャ */
    diffRowNumberPage: void;
}

/**
 * 差分行番号バグテスト用フィクスチャ
 * addInitScript は goto より前に実行する必要があるため、
 * installMockApiAsync より前に __mockGitStatus / __mockGitHeadFiles を設定する
 */
const test = base.extend<BugDiffRowNumberFixtures>({
    diffRowNumberPage: async ({ page }, use) => {
        await page.addInitScript((args: {
            status: { changes: { path: string; tableName: string; isNew: boolean }[]; staged: { path: string; tableName: string; isNew: boolean }[] };
            headFiles: Record<string, string>;
        }) => {
            (window as unknown as { __mockGitStatus: object }).__mockGitStatus = args.status;
            (window as unknown as { __mockGitHeadFiles: Record<string, string> }).__mockGitHeadFiles = args.headFiles;
        }, { status: GIT_STATUS, headFiles: HEAD_FILES });

        await installMockApiAsync(page, createCharaFileSystem());
        await page.goto('/');
        await use();
    },
});

// テスト本体 -------------------------------------------------------------------

test.describe('BUG — 差分ビューで右ペインに行挿入後の左ペイン行番号', () => {

    // -------------------------------------------------------------------------
    // テスト1: 右ペインで行を挿入した後、左ペインの新規パディング行に行番号が表示されること
    //
    // 初期状態:
    //   HEAD版: [id=1(hero), id=2(mage), id=3(rogue), id=4(warrior)]
    //   Current版: [id=1(hero), id=2(mage), id=3(rogue)]（id=4が削除済み）
    //   差分ビュー:
    //     左ペイン: [header, id=1, id=2, id=3, id=4(deleted)]
    //     右ペイン: [header, id=1, id=2, id=3, empty(padding)]
    //
    // 操作:
    //   右ペインの2行目（id=2: データ行nth(1)）の行ヘッダーを右クリック → 下に行を挿入
    //   挿入後の右ペイン構成: [header, id=1, id=2, 新規行, id=3, empty(padding)] = 6行
    //   挿入後の左ペイン構成: [header, id=1, id=2, 新規パディング行, id=3, id=4(deleted)] = 6行
    //
    // ※ id=3の下に挿入すると差分ビューの notifyRightPaneRowInserted が「削除のUndo」パスに入る
    //   （左ペインのrowIndex=4が diff-row-deleted を持つid=4行のため）。
    //   そのため id=2の下に挿入して通常の行挿入パスを通るシナリオを採用する。
    //
    // 期待（RED の理由）:
    //   左ペインの新規パディング行（.diff-row-padding-inserted）の .editor-table-row-header に
    //   行番号テキストが表示されなければならない。
    //   現行実装では createPaddingRow() が行ヘッダーの textContent を設定しないため、
    //   行番号が空欄になる → このアサーションが失敗してREDになる。
    // -------------------------------------------------------------------------
    test(
        '右ペインで行を挿入した後、左ペインに挿入されたパディング行に行番号が表示されること',
        async ({ page, diffRowNumberPage: _diffRowNumberPage }) => {
            // ソース管理パネルを開く
            await page.locator('[data-panel="sourceControl"]').click();

            // chara の差分タブを開く
            const changesSection = page.locator('.source-control-changes-section');
            await expect(changesSection).toBeVisible();
            await changesSection.getByText('chara').click();

            const diffTab = page.locator('.diff-tab-wrapper:not([style*="display: none"]) .diff-tab');
            await expect(diffTab).toBeVisible();

            const leftTable = diffTab.locator('.diff-pane-left .editor-table');
            const rightTable = diffTab.locator('.diff-pane-right .editor-table');
            await expect(leftTable).toBeVisible();
            await expect(rightTable).toBeVisible();

            // 右ペインの初期構成確認:
            // header(nth=0) + id=1(nth=1) + id=2(nth=2) + id=3(nth=3) + padding(nth=4) = 5行
            await expect(rightTable.locator('.editor-table-row')).toHaveCount(5);

            // 右ペインの2行目データ行（id=2: .editor-table-row-header の nth=1）を右クリックする
            // nth=0: id=1, nth=1: id=2, nth=2: id=3, nth=3: initial-padding
            // id=3の下への挿入は notifyRightPaneRowInserted が「削除のUndo」として処理するため、
            // 通常の行挿入パスを通るid=2の下への挿入を採用する。
            const secondRowHeader = rightTable.locator('.editor-table-row-header').nth(1);
            await secondRowHeader.click({ button: 'right' });

            // コンテキストメニューから「下に行を挿入」を選択する
            const contextMenu = page.locator('.context-menu.visible');
            await expect(contextMenu).toBeVisible();
            await contextMenu.locator('.context-menu-item', { hasText: '下に行を挿入' }).click();

            // 挿入後: 右ペインの行数が1増加すること（6行）
            // header(0) + id=1(1) + id=2(2) + 新規行(3) + id=3(4) + padding(5) = 6行
            await expect(rightTable.locator('.editor-table-row')).toHaveCount(6);

            // 挿入後の左ペイン構成:
            // header(0) + id=1(1) + id=2(2) + 新規パディング行(3) + id=3(4) + id=4 deleted(5) = 6行
            // 左ペインの行数も6行になっていること（パディング行同期済み）
            await expect(leftTable.locator('.editor-table-row')).toHaveCount(6);

            // 左ペインの新規パディング行（diff-row-padding-inserted）を取得する
            const newPaddingRow = leftTable.locator('.editor-table-row.diff-row-padding-inserted');
            await expect(newPaddingRow).toHaveCount(1);

            // 新規パディング行の行ヘッダーに行番号が表示されること。
            // 挿入位置（DOM rowIndex=3）に対応する行番号は "3"。
            // 現行実装では createPaddingRow() が textContent を設定しないため、空欄になる。
            // このアサーションが失敗してREDになる（行番号が空のため）。
            const paddingRowHeader = newPaddingRow.locator('.editor-table-row-header');
            await expect(paddingRowHeader).toHaveText('3');
        },
    );

    // -------------------------------------------------------------------------
    // テスト2: 右ペインで行を挿入した後、左ペインの既存行の行番号が正しく再ナンバリングされること
    //
    // 初期状態（テスト1と同じ差分構成）
    //
    // 操作:
    //   右ペインの1行目（id=1: .editor-table-row-header の nth=0）の上に行を挿入
    //   挿入後の左ペイン構成:
    //     [header(DOM=0), パディング行(DOM=1), id=1(DOM=2), id=2(DOM=3), id=3(DOM=4), id=4 deleted(DOM=5)]
    //
    // 期待（RED の理由）:
    //   挿入後、左ペインの各データ行の行番号が DOM インデックスに合わせて正しく更新されること。
    //   具体的には:
    //     - id=1 の行ヘッダーに "2" が表示されること（DOM インデックス 2 → 行番号 2）
    //     - id=2 の行ヘッダーに "3" が表示されること
    //     - id=3 の行ヘッダーに "4" が表示されること
    //     - id=4(deleted) の行ヘッダーに "5" が表示されること
    //   現行実装では renumberLeftRows() が data-row 属性のみ更新し textContent を更新しないため、
    //   既存行の行番号テキストが更新されず古い値のまま（"1", "2", "3", "4"）になる。
    //   このアサーションが失敗してREDになる。
    // -------------------------------------------------------------------------
    test(
        '右ペインで行を挿入した後、左ペインの既存行の行番号が正しく再ナンバリングされること',
        async ({ page, diffRowNumberPage: _diffRowNumberPage }) => {
            // ソース管理パネルを開く
            await page.locator('[data-panel="sourceControl"]').click();

            // chara の差分タブを開く
            const changesSection = page.locator('.source-control-changes-section');
            await expect(changesSection).toBeVisible();
            await changesSection.getByText('chara').click();

            const diffTab = page.locator('.diff-tab-wrapper:not([style*="display: none"]) .diff-tab');
            await expect(diffTab).toBeVisible();

            const leftTable = diffTab.locator('.diff-pane-left .editor-table');
            const rightTable = diffTab.locator('.diff-pane-right .editor-table');
            await expect(leftTable).toBeVisible();
            await expect(rightTable).toBeVisible();

            // 挿入前の左ペインの行番号を確認する（初期状態は正しく 1, 2, 3, 4 の順）
            // データ行の行ヘッダー: nth=0がid=1(「1」), nth=1がid=2(「2」), nth=2がid=3(「3」), nth=3がid=4(「4」)
            const leftRowHeaders = leftTable.locator('.editor-table-row-header');
            await expect(leftRowHeaders.nth(0)).toHaveText('1');
            await expect(leftRowHeaders.nth(1)).toHaveText('2');
            await expect(leftRowHeaders.nth(2)).toHaveText('3');
            await expect(leftRowHeaders.nth(3)).toHaveText('4');

            // 右ペインの1行目データ行（id=1: nth=0）の上に行を挿入する
            const firstRowHeader = rightTable.locator('.editor-table-row-header').nth(0);
            await firstRowHeader.click({ button: 'right' });

            const contextMenu = page.locator('.context-menu.visible');
            await expect(contextMenu).toBeVisible();
            await contextMenu.locator('.context-menu-item', { hasText: '上に行を挿入' }).click();

            // 挿入後: 右ペインの行数が1増加すること（6行）
            await expect(rightTable.locator('.editor-table-row')).toHaveCount(6);

            // 挿入後: 左ペインの行数も1増加すること（6行）
            await expect(leftTable.locator('.editor-table-row')).toHaveCount(6);

            // 挿入後の左ペイン行ヘッダー:
            // nth=0: 新規パディング行（DOM=1） → 行番号は "1"
            // nth=1: id=1 の行（DOM=2）     → 行番号は "2"
            // nth=2: id=2 の行（DOM=3）     → 行番号は "3"
            // nth=3: id=3 の行（DOM=4）     → 行番号は "4"
            // nth=4: id=4(deleted)の行(DOM=5) → 行番号は "5"
            //
            // 現行実装では renumberLeftRows() が textContent を更新しないため
            // 既存行が古い行番号（"1", "2", "3", "4"）のままになる → RED

            // 新規パディング行（nth=0）の行番号が表示されていること
            // 挿入位置（DOM rowIndex=1）に対応する行番号は "1"。
            // createPaddingRow() が textContent を設定しないため空になる → RED
            const updatedLeftRowHeaders = leftTable.locator('.editor-table-row-header');
            await expect(updatedLeftRowHeaders.nth(0)).toHaveText('1');

            // 既存行の行番号が再ナンバリングされていること
            // renumberLeftRows() が textContent を更新しないため古い値のまま → RED
            await expect(updatedLeftRowHeaders.nth(1)).toHaveText('2');
            await expect(updatedLeftRowHeaders.nth(2)).toHaveText('3');
            await expect(updatedLeftRowHeaders.nth(3)).toHaveText('4');
            await expect(updatedLeftRowHeaders.nth(4)).toHaveText('5');
        },
    );

});
