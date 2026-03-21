import { test as base, expect } from './fixtures/test';
import { MockFileSystem, installMockApiAsync } from './fixtures/mock-api';
import { getDataCell } from './fixtures/test-utils';

// =============================================================================
// gitセルハイライト（git変更セルの緑背景）テスト — FEAT_0006
//
// 実装すべき機能:
//   1. テーブルを開いたとき、HEAD版CSVと比較して値が変更されたセルに .cell-git-changed が付与される
//   2. 新規追加行（HEAD版に存在しない行）の全データセルに .cell-git-changed が付与される
//   3. 変更がないセルには .cell-git-changed が付与されない
//   4. セル編集後にリアルタイムで .cell-git-changed を更新する
//   5. git statusで isNew: true のテーブルは全セルに .cell-git-changed が付与される
//
// RED状態の理由:
//   - EditorTable がロード時に git_show_request を呼んでHEAD版と比較する実装が存在しない
//   - .cell-git-changed CSSクラスの付与・除去ロジックが存在しない
//   - セル編集確定時に .cell-git-changed を再評価する実装が存在しない
//   - isNew テーブルで全セルに .cell-git-changed を付与する実装が存在しない
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
 * 現在版CSV（working tree）
 *   id=1: value が 100→150 に変更
 *   id=2: 変更なし
 *   id=3: HEAD版から削除された（このテーブルには存在しない）
 *   id=4: 新規追加行
 */
const CURRENT_CSV = [
    "id,name,value",
    "1,item_a,150",
    "2,item_b,200",
    "4,item_d,400",
].join("\n");

/**
 * HEAD版CSV（git show HEAD:data/test.csv）
 *   id=1: value=100
 *   id=2: 変更なし
 *   id=3: 存在する（現在版では削除済み）
 */
const HEAD_CSV = [
    "id,name,value",
    "1,item_a,100",
    "2,item_b,200",
    "3,item_c,300",
].join("\n");

/**
 * 新規テーブル用スキーマ（HEADに存在しないテーブル）
 */
const NEW_TABLE_SCHEMA = JSON.stringify({
    header: [
        { key: 0, name: "id", type: "int" },
        { key: 1, name: "label", type: "string" },
    ],
    primary_key: ["id"],
});

/**
 * 新規テーブルの現在版CSV（HEADには存在しない）
 */
const NEW_TABLE_CSV = [
    "id,label",
    "1,alpha",
    "2,beta",
].join("\n");

/**
 * git status レスポンス
 * test: 既存ファイルの変更（isNew: false）
 * new_table: 新規ファイル（isNew: true）
 */
const GIT_STATUS = {
    changes: [
        { path: "data/test.csv", tableName: "test", isNew: false },
        { path: "data/new_table.csv", tableName: "new_table", isNew: true },
    ],
    staged: [],
};

/**
 * HEAD版ファイルマップ（git show でアクセスされるファイル）
 * new_table は HEADに存在しないため含めない
 */
const HEAD_FILES: Record<string, string> = {
    "data/test.csv": HEAD_CSV,
};

/**
 * テスト用ファイルシステム（スキーマ + 現在版CSV）
 */
function createGitHighlightFileSystem(): MockFileSystem {
    return {
        "schema/test.json": TEST_SCHEMA,
        "data/test.csv": CURRENT_CSV,
        "schema/new_table.json": NEW_TABLE_SCHEMA,
        "data/new_table.csv": NEW_TABLE_CSV,
    };
}

// フィクスチャ型定義 -------------------------------------------------------------

interface GitHighlightFixtures {
    /** git status とHEADファイルをセットアップした状態でページを開く */
    gitHighlightPage: void;
}

/**
 * gitセルハイライトテスト用フィクスチャ
 * addInitScript は goto より前に実行する必要があるため、
 * installMockApiAsync より前に __mockGitStatus / __mockGitHeadFiles を設定する
 */
const test = base.extend<GitHighlightFixtures>({
    gitHighlightPage: async ({ page }, use) => {
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

        await installMockApiAsync(page, createGitHighlightFileSystem());
        await page.goto('/');
        await use();
    },
});

// テスト本体 -------------------------------------------------------------------

test.describe('gitセルハイライト', () => {

    // -------------------------------------------------------------------------
    // テスト1: 値変更セルに .cell-git-changed が付与される
    // -------------------------------------------------------------------------
    test(
        'HEAD版から値が変更されたセルに .cell-git-changed クラスが付与されること',
        async ({ page, gitHighlightPage: _gitHighlightPage }) => {
            // test テーブルを開く
            await page.locator('#explorer .explorer-file').getByText('test').click();

            const table = page.locator(
                `.editor-left-pane .tab-wrapper[data-tab-name="test"] .editor-table`,
            );

            // id=1 の value 列（col=2）のセルに .cell-git-changed が付与されることを確認する
            // プロダクションコードに HEAD版との比較・クラス付与実装が存在しないため失敗（RED）
            const changedCell = getDataCell(table, 0, 2);
            await expect(changedCell).toHaveClass(/cell-git-changed/);
        },
    );

    // -------------------------------------------------------------------------
    // テスト2: 新規追加行の全データセルに .cell-git-changed が付与される
    // -------------------------------------------------------------------------
    test(
        'HEAD版に存在しない新規追加行の全データセルに .cell-git-changed クラスが付与されること',
        async ({ page, gitHighlightPage: _gitHighlightPage }) => {
            // test テーブルを開く
            await page.locator('#explorer .explorer-file').getByText('test').click();

            const table = page.locator(
                `.editor-left-pane .tab-wrapper[data-tab-name="test"] .editor-table`,
            );

            // id=4 は新規追加行（現在版の3行目: rowIndex=2）
            // プロダクションコードに新規追加行の全セルハイライト実装が存在しないため失敗（RED）
            const newRowCell0 = getDataCell(table, 2, 0);
            const newRowCell1 = getDataCell(table, 2, 1);
            const newRowCell2 = getDataCell(table, 2, 2);
            await expect(newRowCell0).toHaveClass(/cell-git-changed/);
            await expect(newRowCell1).toHaveClass(/cell-git-changed/);
            await expect(newRowCell2).toHaveClass(/cell-git-changed/);
        },
    );

    // -------------------------------------------------------------------------
    // テスト3: 変更なしセルに .cell-git-changed が付与されない
    // -------------------------------------------------------------------------
    test(
        'HEAD版と同じ値のセルには .cell-git-changed クラスが付与されないこと',
        async ({ page, gitHighlightPage: _gitHighlightPage }) => {
            // test テーブルを開く
            await page.locator('#explorer .explorer-file').getByText('test').click();

            const table = page.locator(
                `.editor-left-pane .tab-wrapper[data-tab-name="test"] .editor-table`,
            );

            // id=2 は変更なし（rowIndex=1）：id, name, value すべて変更なし
            // プロダクションコードに変更なしセルへの誤クラス付与防止実装が存在しないため失敗（RED）
            const unchangedCell0 = getDataCell(table, 1, 0);
            const unchangedCell1 = getDataCell(table, 1, 1);
            const unchangedCell2 = getDataCell(table, 1, 2);
            await expect(unchangedCell0).not.toHaveClass(/cell-git-changed/);
            await expect(unchangedCell1).not.toHaveClass(/cell-git-changed/);
            await expect(unchangedCell2).not.toHaveClass(/cell-git-changed/);

            // id=1 の id列(col=0)・name列(col=1)は変更なし（value列のみ変更）
            const id1IdCell = getDataCell(table, 0, 0);
            const id1NameCell = getDataCell(table, 0, 1);
            await expect(id1IdCell).not.toHaveClass(/cell-git-changed/);
            await expect(id1NameCell).not.toHaveClass(/cell-git-changed/);
        },
    );

    // -------------------------------------------------------------------------
    // テスト4: セル編集後にリアルタイムで .cell-git-changed を更新する
    // -------------------------------------------------------------------------
    test(
        'セルを編集してHEAD版と異なる値にすると .cell-git-changed が付与され、HEAD版と同じ値に戻すと除去されること',
        async ({ page, gitHighlightPage: _gitHighlightPage }) => {
            // test テーブルを開く
            await page.locator('#explorer .explorer-file').getByText('test').click();

            const table = page.locator(
                `.editor-left-pane .tab-wrapper[data-tab-name="test"] .editor-table`,
            );

            // id=2 の name列（rowIndex=1, col=1）は現在 "item_b" で変更なし
            // プロダクションコードにリアルタイムハイライト更新実装が存在しないため失敗（RED）
            const targetCell = getDataCell(table, 1, 1);
            await expect(targetCell).not.toHaveClass(/cell-git-changed/);

            // セルをダブルクリックして編集モードに入り、値を "item_b_changed" に変更する
            await targetCell.dblclick();
            const editField = page.locator('.grid-textfield-active').first();
            await editField.fill('item_b_changed');
            await page.keyboard.press('Enter');

            // HEAD版 "item_b" と異なるため .cell-git-changed が付与されることを確認する
            await expect(targetCell).toHaveClass(/cell-git-changed/);

            // HEAD版の値 "item_b" に戻して .cell-git-changed が除去されることを確認する
            await targetCell.dblclick();
            const editField2 = page.locator('.grid-textfield-active').first();
            await editField2.fill('item_b');
            await page.keyboard.press('Enter');

            // HEAD版と同じ値に戻したので .cell-git-changed が除去されることを確認する
            await expect(targetCell).not.toHaveClass(/cell-git-changed/);
        },
    );

    // -------------------------------------------------------------------------
    // テスト5: isNew: true のテーブルは全セルに .cell-git-changed が付与される
    // -------------------------------------------------------------------------
    test(
        'git statusで isNew: true のテーブルは全データセルに .cell-git-changed クラスが付与されること',
        async ({ page, gitHighlightPage: _gitHighlightPage }) => {
            // new_table テーブルを開く（isNew: true でHEADに存在しない）
            await page.locator('#explorer .explorer-file').getByText('new_table').click();

            const table = page.locator(
                `.editor-left-pane .tab-wrapper[data-tab-name="new_table"] .editor-table`,
            );

            // 全行・全列のデータセルに .cell-git-changed が付与されることを確認する
            // プロダクションコードに isNew テーブルの全セルハイライト実装が存在しないため失敗（RED）

            // 1行目 (id=1): id列・label列
            const row0col0 = getDataCell(table, 0, 0);
            const row0col1 = getDataCell(table, 0, 1);
            await expect(row0col0).toHaveClass(/cell-git-changed/);
            await expect(row0col1).toHaveClass(/cell-git-changed/);

            // 2行目 (id=2): id列・label列
            const row1col0 = getDataCell(table, 1, 0);
            const row1col1 = getDataCell(table, 1, 1);
            await expect(row1col0).toHaveClass(/cell-git-changed/);
            await expect(row1col1).toHaveClass(/cell-git-changed/);
        },
    );

    // -------------------------------------------------------------------------
    // テスト追加: 列ヘッダー行・行ヘッダーセルには .cell-git-changed が付与されない
    // -------------------------------------------------------------------------
    test(
        '列ヘッダー行および行ヘッダーセルには .cell-git-changed クラスが付与されないこと',
        async ({ page, gitHighlightPage: _gitHighlightPage }) => {
            // test テーブルを開く
            await page.locator('#explorer .explorer-file').getByText('test').click();

            const table = page.locator(
                `.editor-left-pane .tab-wrapper[data-tab-name="test"] .editor-table`,
            );

            // 列ヘッダー行（row=0）のセルには .cell-git-changed が付与されないことを確認する
            // プロダクションコードにヘッダー行除外実装が存在しないため失敗（RED）
            const headerRow = table.locator('.editor-table-row').first();
            const headerCells = headerRow.locator('.editor-table-cell');
            const headerCellCount = await headerCells.count();
            for (let i = 0; i < headerCellCount; i++) {
                await expect(headerCells.nth(i)).not.toHaveClass(/cell-git-changed/);
            }

            // 行ヘッダーセル（.editor-table-row-header）には .cell-git-changed が付与されないことを確認する
            const rowHeaders = table.locator('.editor-table-row-header');
            const rowHeaderCount = await rowHeaders.count();
            for (let i = 0; i < rowHeaderCount; i++) {
                await expect(rowHeaders.nth(i)).not.toHaveClass(/cell-git-changed/);
            }
        },
    );

});
