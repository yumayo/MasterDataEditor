import { test as base, expect } from '@playwright/test';
import { MockFileSystem, installMockApiAsync } from './fixtures/mock-api';

// =============================================================================
// 差分タブで参照ヒントが表示されない不具合の検証テスト
//
// 根本原因:
//   DiffTab.buildDiffEditorTable() で TabReference.preloadReferenceTables() と
//   resolveReverseReferencesAsync() が呼ばれていないため、
//   差分タブの左右両ペインの EditorTable に参照ヒントが描画されない。
//
//   通常タブ（tab.ts 971行目）とミニテーブル（tab.ts 1212行目）では以下が呼ばれている:
//     this.reference.preloadReferenceTables(tableData, editorTable);
//     this.reference.resolveReverseReferencesAsync(name, editorTable);
//
//   しかし DiffTab.buildDiffEditorTable() にはこれらの呼び出しが存在しない。
//
// 検証シナリオ:
//   1. FK列（enemy_id → enemy.ja への参照）を持つテーブルの差分タブを開く
//   2. 左ペイン（HEAD版）の FK列セルに .cell-reference-hint が表示されること
//   3. 右ペイン（現在版）の FK列セルに .cell-reference-hint が表示されること
//
// RED になる理由:
//   buildDiffEditorTable() で preloadReferenceTables() が呼ばれないため、
//   差分タブの EditorTable に参照ヒントが描画されず、
//   .cell-reference-hint 要素が存在しないためアサーションが失敗する。
// =============================================================================

// テスト用スキーマ（quest: id, enemy_id(→enemy.ja), name の3列テーブル）
const QUEST_SCHEMA = JSON.stringify({
    header: [
        { key: 0, name: "id", type: "int" },
        { key: 1, name: "enemy_id", type: "int", reference: "enemy.ja" },
        { key: 2, name: "name", type: "string" },
    ],
    primary_key: "id",
});

// 参照先テーブルのスキーマ（enemy: id, ja の2列テーブル）
const ENEMY_SCHEMA = JSON.stringify({
    header: [
        { key: 0, name: "id", type: "int" },
        { key: 1, name: "ja", type: "string" },
    ],
    primary_key: "id",
});

// 参照先テーブルのデータ（enemy）
const ENEMY_CSV = [
    "id,ja",
    "1,スライム",
    "2,ドラゴン",
].join("\n");

// 現在版CSV（working tree）— id=3 を追加した状態
const CURRENT_QUEST_CSV = [
    "id,enemy_id,name",
    "1,1,quest_a",
    "2,2,quest_b",
    "3,1,quest_c",
].join("\n");

// HEAD版CSV（変更前）— id=3 が存在しない
const HEAD_QUEST_CSV = [
    "id,enemy_id,name",
    "1,1,quest_a",
    "2,2,quest_b",
].join("\n");

// git status レスポンス（quest が変更あり）
const GIT_STATUS = {
    changes: [{ path: "data/quest.csv", tableName: "quest", isNew: false }],
    staged: [] as { path: string; tableName: string; isNew: boolean }[],
};

// HEAD版ファイルマップ
const HEAD_FILES: Record<string, string> = {
    "data/quest.csv": HEAD_QUEST_CSV,
};

function createDiffTabReferenceHintFileSystem(): MockFileSystem {
    return {
        "schema/quest.json": QUEST_SCHEMA,
        "data/quest.csv": CURRENT_QUEST_CSV,
        "schema/enemy.json": ENEMY_SCHEMA,
        "data/enemy.csv": ENEMY_CSV,
    };
}

// フィクスチャ型定義
interface DiffTabReferenceHintFixtures {
    /** git差分状態をセットアップした状態でページを開く */
    diffTabReferenceHintPage: void;
}

/**
 * 差分タブ参照ヒントバグ検証テスト用フィクスチャ
 * addInitScript は goto より前に実行する必要があるため、
 * installMockApiAsync より前に __mockGitStatus / __mockGitHeadFiles を設定する
 */
const test = base.extend<DiffTabReferenceHintFixtures>({
    diffTabReferenceHintPage: async ({ page }, use) => {
        await page.addInitScript((args: {
            status: { changes: { path: string; tableName: string; isNew: boolean }[]; staged: { path: string; tableName: string; isNew: boolean }[] };
            headFiles: Record<string, string>;
        }) => {
            (window as unknown as { __mockGitStatus: object }).__mockGitStatus = args.status;
            (window as unknown as { __mockGitHeadFiles: Record<string, string> }).__mockGitHeadFiles = args.headFiles;
        }, { status: GIT_STATUS, headFiles: HEAD_FILES });

        await installMockApiAsync(page, createDiffTabReferenceHintFileSystem());
        await page.goto('/');
        await use();
    },
});

/**
 * 差分ビューのペイン内の指定行・列にある参照ヒント要素を返す
 * rowIndex: 0始まり（ヘッダー行を除く）
 * colIndex: 0始まり（行ヘッダーを除く）
 */
function getDiffPaneReferenceHint(pane: import('@playwright/test').Locator, rowIndex: number, colIndex: number): import('@playwright/test').Locator {
    const row = pane.locator('.editor-table .editor-table-row').nth(rowIndex + 1);
    const cell = row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
    return cell.locator('.cell-reference-hint');
}

// テスト本体 -------------------------------------------------------------------

test.describe('差分タブでの参照ヒント表示', () => {

    // -------------------------------------------------------------------------
    // テスト1: 差分タブの左ペイン（HEAD版）の FK列セルに参照ヒントが表示されること
    //
    // 検証手順:
    //   1. ソース管理パネルを開く
    //   2. quest の差分タブを開く
    //   3. 差分タブが表示されることを確認する
    //   4. 左ペイン（HEAD版）の enemy_id列（colIndex=1）に .cell-reference-hint が表示されること
    //
    // なぜ失敗するか（RED の理由）:
    //   buildDiffEditorTable() で preloadReferenceTables() が呼ばれないため、
    //   参照ヒントの描画に必要な参照データが EditorTable にロードされず、
    //   .cell-reference-hint 要素がDOMに存在しない。
    // -------------------------------------------------------------------------
    test(
        '差分タブの左ペイン（HEAD版）のFK列セルに参照ヒントが表示されること',
        async ({ page, diffTabReferenceHintPage: _diffTabReferenceHintPage }) => {
            // ソース管理パネルを開く
            await page.locator('[data-panel="sourceControl"]').click();

            const changesSection = page.locator('.source-control-changes-section');
            await expect(changesSection).toBeVisible();

            // quest の差分タブを開く
            await changesSection.getByText('quest').click();

            // 差分タブが表示されることを確認する
            const diffTab = page.locator('.diff-tab');
            await expect(diffTab).toBeVisible();

            // 左ペイン（HEAD版）のEditorTableが表示されることを確認する
            const leftPane = diffTab.locator('.diff-pane-left');
            await expect(leftPane.locator('.editor-table')).toBeVisible();

            // 左ペインの id=1 行（rowIndex=0）の enemy_id列（colIndex=1）に参照ヒントが表示されること
            // 現行バグでは preloadReferenceTables() が呼ばれないため .cell-reference-hint が存在せず失敗する
            const leftHintRow0 = getDiffPaneReferenceHint(leftPane, 0, 1);
            await expect(leftHintRow0).toBeVisible();
            await expect(leftHintRow0).toHaveText('スライム');

            // 左ペインの id=2 行（rowIndex=1）の enemy_id列（colIndex=1）
            const leftHintRow1 = getDiffPaneReferenceHint(leftPane, 1, 1);
            await expect(leftHintRow1).toBeVisible();
            await expect(leftHintRow1).toHaveText('ドラゴン');
        },
    );

    // -------------------------------------------------------------------------
    // テスト2: 差分タブの右ペイン（現在版）の FK列セルに参照ヒントが表示されること
    //
    // 検証手順:
    //   1. ソース管理パネルを開く
    //   2. quest の差分タブを開く
    //   3. 差分タブが表示されることを確認する
    //   4. 右ペイン（現在版）の enemy_id列（colIndex=1）に .cell-reference-hint が表示されること
    //
    // なぜ失敗するか（RED の理由）:
    //   buildDiffEditorTable() で preloadReferenceTables() が呼ばれないため、
    //   右ペインの EditorTable も同様に参照データが存在せず .cell-reference-hint が描画されない。
    // -------------------------------------------------------------------------
    test(
        '差分タブの右ペイン（現在版）のFK列セルに参照ヒントが表示されること',
        async ({ page, diffTabReferenceHintPage: _diffTabReferenceHintPage }) => {
            // ソース管理パネルを開く
            await page.locator('[data-panel="sourceControl"]').click();

            const changesSection = page.locator('.source-control-changes-section');
            await expect(changesSection).toBeVisible();

            // quest の差分タブを開く
            await changesSection.getByText('quest').click();

            // 差分タブが表示されることを確認する
            const diffTab = page.locator('.diff-tab');
            await expect(diffTab).toBeVisible();

            // 右ペイン（現在版）のEditorTableが表示されることを確認する
            const rightPane = diffTab.locator('.diff-pane-right');
            await expect(rightPane.locator('.editor-table')).toBeVisible();

            // 右ペインの id=1 行（rowIndex=0）の enemy_id列（colIndex=1）に参照ヒントが表示されること
            // 現行バグでは preloadReferenceTables() が呼ばれないため .cell-reference-hint が存在せず失敗する
            const rightHintRow0 = getDiffPaneReferenceHint(rightPane, 0, 1);
            await expect(rightHintRow0).toBeVisible();
            await expect(rightHintRow0).toHaveText('スライム');

            // 右ペインの id=2 行（rowIndex=1）の enemy_id列（colIndex=1）
            const rightHintRow1 = getDiffPaneReferenceHint(rightPane, 1, 1);
            await expect(rightHintRow1).toBeVisible();
            await expect(rightHintRow1).toHaveText('ドラゴン');

            // 右ペインには id=3（追加行）も存在する（rowIndex=2）
            // 追加行も enemy_id=1 なので参照ヒント「スライム」が表示されること
            const rightHintRow2 = getDiffPaneReferenceHint(rightPane, 2, 1);
            await expect(rightHintRow2).toBeVisible();
            await expect(rightHintRow2).toHaveText('スライム');
        },
    );

});
