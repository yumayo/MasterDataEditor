import { test as base, expect } from './fixtures/test';
import { MockFileSystem, installMockApiAsync } from './fixtures/mock-api';
import { getDataCell } from './fixtures/test-utils';

// =============================================================================
// 差分タブの右ペインで保存後にgit差分ハイライトが更新されることを検証する
//
// 根本原因:
//   差分タブの右ペイン保存処理（editor-table-handler.ts）で保存後に
//   refreshGitDiffAsync() が呼ばれていなかった。
//   差分タブの tableName は "xxx:diff:current" という仮名のため、
//   通常テーブルの refreshGitDiffAsync() は使えない（git status でファイルパスが解決できない）。
//   refreshGitDiffForDiffTabAsync() で saveTargetTableName（実テーブル名）を使って
//   HEAD版CSVを取得し、GitDiffTracker を再構築してハイライトを更新する。
//
// 検証シナリオ:
//   1. 差分タブを開く
//   2. 右ペインのセルを編集する
//   3. Ctrl+S で保存する
//   4. 編集したセルに .cell-git-changed クラスが付与されていることを確認する
// =============================================================================

// テスト用スキーマ（id, name の2列テーブル）
const QUEST_REWARD_SCHEMA = JSON.stringify({
    header: [
        { key: 0, name: "id", type: "int" },
        { key: 1, name: "name", type: "string" },
    ],
    primary_key: ["id"],
});

// 現在版CSV（working tree）— HEAD版から id=1 の name を変更した状態
const CURRENT_QUEST_REWARD_CSV = [
    "id,name",
    "1,reward_modified",
    "2,reward_b",
    "3,reward_c",
].join("\n");

// HEAD版CSV（変更前）
const HEAD_QUEST_REWARD_CSV = [
    "id,name",
    "1,reward_a",
    "2,reward_b",
    "3,reward_c",
].join("\n");

// git status レスポンス（quest_reward が変更あり）
const GIT_STATUS = {
    changes: [{ path: "data/quest_reward.csv", tableName: "quest_reward", isNew: false }],
    staged: [] as { path: string; tableName: string; isNew: boolean }[],
};

// HEAD版ファイルマップ
const HEAD_FILES: Record<string, string> = {
    "data/quest_reward.csv": HEAD_QUEST_REWARD_CSV,
};

function createFileSystem(): MockFileSystem {
    return {
        "schema/quest_reward.json": QUEST_REWARD_SCHEMA,
        "data/quest_reward.csv": CURRENT_QUEST_REWARD_CSV,
    };
}

// フィクスチャ型定義
interface DiffTabSaveHighlightFixtures {
    /** git差分状態をセットアップした状態でページを開く */
    diffTabSaveHighlightPage: void;
}

/**
 * 差分タブ保存後ハイライト検証テスト用フィクスチャ
 * addInitScript は goto より前に実行する必要があるため、
 * installMockApiAsync より前に __mockGitStatus / __mockGitHeadFiles を設定する
 */
const test = base.extend<DiffTabSaveHighlightFixtures>({
    diffTabSaveHighlightPage: async ({ page }, use) => {
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

// テスト本体 -------------------------------------------------------------------

test.describe('差分タブ保存後のgit差分ハイライト更新', () => {

    // -------------------------------------------------------------------------
    // テスト: 差分タブ右ペインで編集・保存後に変更セルの背景がcell-git-changedになる
    //
    // 検証手順:
    //   1. ソースコントロールパネルを開く
    //   2. quest_reward の差分タブを開く
    //   3. 右ペインのセル（id=2, name列）を編集する
    //   4. Ctrl+S で保存する
    //   5. 編集したセルに .cell-git-changed クラスが付与されていることを確認する
    //   6. HEAD版と同じ値のセルには .cell-git-changed が付いていないことも確認する
    // -------------------------------------------------------------------------
    test(
        '差分タブの右ペインでセルを編集してCtrl+S保存後、変更セルに.cell-git-changedが付与されること',
        async ({ page, diffTabSaveHighlightPage: _diffTabSaveHighlightPage }) => {
            // ソースコントロールパネルを開く
            await page.locator('[data-panel="sourceControl"]').click();

            // CHANGES セクションの quest_reward テーブルをクリックして差分タブを開く
            const changesSection = page.locator('.source-control-changes-section');
            await expect(changesSection.getByText('quest_reward')).toBeVisible();
            await changesSection.getByText('quest_reward').click();

            // 差分タブが開いていることを確認する
            const diffTab = page.locator('.diff-tab');
            await expect(diffTab).toBeVisible();

            // 右ペインのEditorTableが表示されることを確認する
            const rightPane = diffTab.locator('.diff-pane-right');
            await expect(rightPane.locator('.editor-table')).toBeVisible();
            const rightTable = rightPane.locator('.editor-table');

            // 右ペインの2行目（id=2）のname列（colIndex=1）をダブルクリックして編集する
            // HEAD版では "reward_b" なので、別の値に変更すると差分が生じる
            const targetCell = getDataCell(rightTable, 1, 1);
            await targetCell.dblclick();

            // テキストフィールドが表示されるまで待機する
            const editField = page.locator('.grid-textfield-active').first();
            await expect(editField).toBeVisible();

            // 「reward_b_edited」に変更する
            await editField.selectText();
            await editField.type('reward_b_edited');
            await page.keyboard.press('Enter');

            // フォーカスを右ペインに戻してから Ctrl+S を押す
            await targetCell.click();
            await page.keyboard.press('Control+s');

            // 保存後、編集したセル（id=2, name列）に .cell-git-changed が付与されることを確認する
            // refreshGitDiffForDiffTabAsync() → GitDiffTracker 再構築 → applyGitDiffHighlight()
            await expect(targetCell).toHaveClass(/cell-git-changed/);

            // HEAD版と同じ値のセル（id=2, id列）には .cell-git-changed が付いていないことを確認する
            const unchangedCell = getDataCell(rightTable, 1, 0);
            await expect(unchangedCell).not.toHaveClass(/cell-git-changed/);

            // もともとHEAD版から変更されていたセル（id=1, name列: reward_a → reward_modified）にも
            // .cell-git-changed が付与されていることを確認する
            const alreadyChangedCell = getDataCell(rightTable, 0, 1);
            await expect(alreadyChangedCell).toHaveClass(/cell-git-changed/);
        },
    );

});
