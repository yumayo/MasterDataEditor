import { test as base, expect } from './fixtures/test';
import type { Page, Locator } from '@playwright/test';
import { MockFileSystem, installMockApiAsync } from './fixtures/mock-api';
import { getDataCell } from './fixtures/test-utils';

// =============================================================================
// ISSUE_0091 — gitShowAsync のエラー種別による分岐テスト
//
// 修正の概要:
//   refreshGitDiffForDiffTabAsync の catch 節でエラーメッセージを判定し、
//   "does not exist" を含むエラーのみ createForNewTable()（全セルchanged）にし、
//   それ以外のエラーでは gitDiffTracker = false（ハイライトなし）にする。
//
// テスト設計:
//   差分タブを開くときにも gitShowAsync が呼ばれるため、初回は正常に成功させる必要がある。
//   フィクスチャでは __mockGitHeadFiles にHEAD版CSVを入れて差分タブを正常に開き、
//   差分タブが開いた後に page.evaluate でモック変数を動的に書き換えてエラーを注入する。
// =============================================================================

// テスト用スキーマ（id, name の2列テーブル）
const SCHEMA = JSON.stringify({
    header: [
        { key: 0, name: "id", type: "int" },
        { key: 1, name: "name", type: "string" },
    ],
    primary_key: ["id"],
});

// 現在版CSV（working tree）— HEAD版から id=1 の name を変更した状態
const CURRENT_CSV = [
    "id,name",
    "1,reward_modified",
    "2,reward_b",
    "3,reward_c",
].join("\n");

// HEAD版CSV（変更前）
const HEAD_CSV = [
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

// HEAD版ファイルマップ（差分タブを正常に開くために必要）
const HEAD_FILES: Record<string, string> = {
    "data/quest_reward.csv": HEAD_CSV,
};

function createFileSystem(): MockFileSystem {
    return {
        "schema/quest_reward.json": SCHEMA,
        "data/quest_reward.csv": CURRENT_CSV,
    };
}

/**
 * 差分タブを開き、右ペインのセルを編集して保存する共通シーケンス。
 * 返り値として右ペインのテーブルLocatorを返す。
 */
async function openDiffTabAndEditCellAsync(page: Page): Promise<Locator> {
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

    return rightTable;
}

/**
 * 右ペインのセルを編集して保存する共通シーケンス。
 * rightPane スコープ内で .grid-textfield-active を取得する。
 */
async function editCellAndSaveAsync(page: Page, rightTable: Locator): Promise<void> {
    // 右ペインの2行目（id=2）のname列（colIndex=1）をダブルクリックして編集する
    const targetCell = getDataCell(rightTable, 1, 1);
    await targetCell.dblclick();

    // テキストフィールドが表示されるまで待機する（右ペインにスコープを限定する）
    const rightPane = rightTable.locator('..');
    const editField = rightPane.locator('.grid-textfield-active');
    await expect(editField).toBeVisible();

    // 「reward_b_edited」に変更する
    await editField.selectText();
    await editField.type('reward_b_edited');
    await page.keyboard.press('Enter');

    // フォーカスを右ペインに戻してから Ctrl+S を押す
    await targetCell.click();
    await page.keyboard.press('Control+s');
}

// 共通フィクスチャ: git差分状態をセットアップして差分タブを正常に開ける状態にする
interface GitShowErrorBranchingFixtures {
    /** git差分状態をセットアップした状態でページを開く */
    gitDiffPage: void;
}

const test = base.extend<GitShowErrorBranchingFixtures>({
    gitDiffPage: async ({ page }, use) => {
        // __mockGitStatus と __mockGitHeadFiles を設定して差分タブが正常に開けるようにする
        // __mockGitShowError は設定しない（差分タブを開く初回の gitShowAsync を成功させるため）
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

test.describe('ISSUE_0091: gitShowAsync エラー種別分岐', () => {

    // -------------------------------------------------------------------------
    // テスト1: バリデーションエラー（"does not exist" を含まないエラー）で
    //          createForNewTable にフォールバックしないこと
    //
    // 検証手順:
    //   1. 差分タブを正常に開く（HEAD版CSVが取得できるため成功する）
    //   2. __mockGitShowError を動的に設定して "invalid path" エラーを注入する
    //   3. 右ペインのセルを編集して Ctrl+S で保存する
    //   4. refreshGitDiffForDiffTabAsync が呼ばれ、__mockGitShowError により
    //      "invalid path" エラーが返る
    //   5. エラーが "does not exist" を含まないため gitDiffTracker = false になり、
    //      全セルに .cell-git-changed が付与されない（ハイライトなし）ことを確認
    // -------------------------------------------------------------------------
    test(
        'バリデーションエラー時は全セルにcell-git-changedが付与されないこと',
        async ({ page, gitDiffPage: _gitDiffPage }) => {
            const rightTable = await openDiffTabAndEditCellAsync(page);

            // 差分タブが開いた後に __mockGitShowError を動的に設定する
            // これにより次回以降の gitShowAsync 呼び出しが "invalid path" エラーを返す
            await page.evaluate(() => {
                (window as unknown as { __mockGitShowError: string }).__mockGitShowError = "fatal: invalid path 'data/quest_reward.csv'";
            });

            await editCellAndSaveAsync(page, rightTable);

            // 保存後、refreshGitDiffForDiffTabAsync が呼ばれて __mockGitShowError により
            // "invalid path" エラーが返る。
            // エラーが "does not exist" を含まないため gitDiffTracker = false でハイライトなし。
            // 全データセル（3行 × 2列 = 6セル）に .cell-git-changed が付いていないことを確認する
            for (let row = 0; row < 3; row++) {
                for (let col = 0; col < 2; col++) {
                    const cell = getDataCell(rightTable, row, col);
                    await expect(cell, `row=${row}, col=${col} に .cell-git-changed が付いてはいけない`).not.toHaveClass(/cell-git-changed/);
                }
            }
        },
    );

    // -------------------------------------------------------------------------
    // テスト2: "does not exist" エラーでは全セルが cell-git-changed になること
    //
    // 検証手順:
    //   1. 差分タブを正常に開く（HEAD版CSVが取得できるため成功する）
    //   2. __mockGitHeadFiles を空マップに動的に書き換える
    //   3. 右ペインのセルを編集して Ctrl+S で保存する
    //   4. refreshGitDiffForDiffTabAsync が呼ばれ、HEADファイルマップが空のため
    //      "does not exist" エラーが返る
    //   5. createForNewTable() が使われ全セルが .cell-git-changed になることを確認
    // -------------------------------------------------------------------------
    test(
        '"does not exist" エラー時は全セルにcell-git-changedが付与されること',
        async ({ page, gitDiffPage: _gitDiffPage }) => {
            const rightTable = await openDiffTabAndEditCellAsync(page);

            // 差分タブが開いた後に __mockGitHeadFiles を空マップに書き換える
            // これにより次回以降の gitShowAsync 呼び出しが "does not exist" エラーを返す
            await page.evaluate(() => {
                (window as unknown as { __mockGitHeadFiles: Record<string, string> }).__mockGitHeadFiles = {};
            });

            await editCellAndSaveAsync(page, rightTable);

            // 保存後、refreshGitDiffForDiffTabAsync が呼ばれて "does not exist" エラーが返る。
            // createForNewTable() が使われ、全セルが .cell-git-changed になる。
            // 全データセル（3行 × 2列 = 6セル）に .cell-git-changed が付いていることを確認する
            for (let row = 0; row < 3; row++) {
                for (let col = 0; col < 2; col++) {
                    const cell = getDataCell(rightTable, row, col);
                    await expect(cell, `row=${row}, col=${col} に .cell-git-changed が付いているべき`).toHaveClass(/cell-git-changed/);
                }
            }
        },
    );
});
