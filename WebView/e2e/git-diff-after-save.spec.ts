import { test as base, expect } from './fixtures/test';
import { MockFileSystem, installMockApiAsync } from './fixtures/mock-api';
import { getDataCell } from './fixtures/test-utils';

// =============================================================================
// 保存後のgit差分ハイライト更新テスト
//
// 実装済み機能:
//   セルを編集してCtrl+Sで保存した後、保存時点のworking treeとHEAD版の差分に基づいて
//   セルの背景色（.cell-git-changed）が再評価・更新される。
//
// 実装方針:
//   editor-table-handler.ts の markSavedAndUpdatePanel() が refreshGitDiffAsync() を
//   fire-and-forget で呼び出す。refreshGitDiffAsync() は git statusを再取得し、
//   GitDiffTracker を再構築して applyGitDiffHighlight() を一括適用する。
// =============================================================================

// テスト共通データ ---------------------------------------------------------------

/**
 * テスト用questスキーマ
 * FK参照を持たないシンプルな4列定義
 * 実際のquestスキーマに対応した列名を使用する
 */
const QUEST_SCHEMA = JSON.stringify({
    header: [
        { key: 0, name: "id", type: "int" },
        { key: 1, name: "first_clear_reward_table_id", type: "int" },
        { key: 2, name: "first_clear_reward_record_id", type: "int" },
        { key: 3, name: "quest_reward_group_id", type: "int" },
    ],
    primary_key: ["id"],
});

/**
 * 現在版CSV（working tree）
 * HEAD版と同一の初期状態（保存前は差分なし）
 */
const CURRENT_QUEST_CSV = [
    "id,first_clear_reward_table_id,first_clear_reward_record_id,quest_reward_group_id",
    "1,1,3,1",
    "2,2,1,1",
    "3,1,3,2",
].join("\n");

/**
 * HEAD版CSV（git show HEAD:data/quest.csv）
 * 現在版と同一の内容（初期状態では差分なし）
 */
const HEAD_QUEST_CSV = [
    "id,first_clear_reward_table_id,first_clear_reward_record_id,quest_reward_group_id",
    "1,1,3,1",
    "2,2,1,1",
    "3,1,3,2",
].join("\n");

/**
 * 初期git statusレスポンス
 * questテーブルはclean（changesに含まれない）
 * → タブオープン時に GitDiffTracker が構築されない = cell-git-changed が付与されない
 */
const INITIAL_GIT_STATUS = {
    changes: [],
    staged: [],
};

/**
 * 保存後git statusレスポンス
 * questテーブルが変更対象として含まれる（isNew: false）
 * → 保存後に GitDiffTracker が再構築されれば cell-git-changed が付与されるはず
 */
const GIT_STATUS_AFTER_SAVE = {
    changes: [
        { path: "data/quest.csv", tableName: "quest", isNew: false },
    ],
    staged: [],
};

/**
 * テスト用ファイルシステム（スキーマ + 現在版CSV）
 */
function createGitDiffAfterSaveFileSystem(): MockFileSystem {
    return {
        "schema/quest.json": QUEST_SCHEMA,
        "data/quest.csv": CURRENT_QUEST_CSV,
    };
}

// フィクスチャ型定義 -------------------------------------------------------------

interface GitDiffAfterSaveFixtures {
    /** git status と HEAD ファイルをセットアップした状態でページを開く */
    gitDiffAfterSavePage: void;
}

/**
 * 保存後git差分ハイライトテスト用フィクスチャ
 * 初期状態: git statusはclean（questはchangesに含まれない）
 * addInitScript は goto より前に実行する必要があるため、
 * installMockApiAsync より前に __mockGitStatus / __mockGitHeadFiles を設定する
 */
const test = base.extend<GitDiffAfterSaveFixtures>({
    gitDiffAfterSavePage: async ({ page }, use) => {
        // 初期git状態をcleanに設定する（questはchangesに含まれない）
        // これによりタブオープン時にGitDiffTrackerが構築されない
        await page.addInitScript((args: {
            status: { changes: object[]; staged: object[] };
        }) => {
            (window as unknown as { __mockGitStatus: object }).__mockGitStatus = args.status;
            // HEAD版ファイルは保存後のフックで設定するため、初期は空マップを設定する
            (window as unknown as { __mockGitHeadFiles: Record<string, string> }).__mockGitHeadFiles = {};
        }, { status: INITIAL_GIT_STATUS });

        await installMockApiAsync(page, createGitDiffAfterSaveFileSystem());
        await page.goto('/');
        await use();
    },
});

// テスト本体 -------------------------------------------------------------------

test.describe('保存後のgit差分ハイライト更新', () => {

    // -------------------------------------------------------------------------
    // テスト1: セルを編集してCtrl+S保存後、git statusが変化した場合にcell-git-changedが付与される
    // -------------------------------------------------------------------------
    test(
        'セルを編集してCtrl+Sで保存した後、変更セルに .cell-git-changed クラスが付与されること',
        async ({ page, gitDiffAfterSavePage: _gitDiffAfterSavePage }) => {
            // quest テーブルを開く
            await page.locator('#explorer .explorer-file').getByText('quest').click();

            const table = page.locator(
                `.editor-left-pane .tab-wrapper[data-tab-name="quest"] .editor-table`,
            );
            await expect(table).toBeVisible();

            // 1行目、3列目（quest_reward_group_id、col index 3）を対象とする
            // 初期状態: questはclean（git statusのchangesに含まれない）
            // そのためGitDiffTrackerが未構築 → cell-git-changedが付与されていないことを確認する
            const targetCell = getDataCell(table, 0, 3);
            await expect(targetCell).not.toHaveClass(/cell-git-changed/);

            // セルをダブルクリックして編集モードに入り、値を 1 から 2 に変更する
            await targetCell.dblclick();
            const editField = page.locator('.grid-textfield-active').first();
            await expect(editField).toBeVisible();
            await editField.fill('2');
            await page.keyboard.press('Enter');

            // セル編集後もGitDiffTrackerが未構築のため cell-git-changed は付かないままであることを確認する
            await expect(targetCell).not.toHaveClass(/cell-git-changed/);

            // 保存前にgit状態をモック更新する:
            // Ctrl+Sを押す前に __mockGitStatus と __mockGitHeadFiles を保存後の状態に変更する
            // これにより、保存処理が git_status_request を投げた際に更新済みの状態が返される
            await page.evaluate((args: {
                statusAfterSave: { changes: { path: string; tableName: string; isNew: boolean }[]; staged: object[] };
                headCsv: string;
            }) => {
                (window as unknown as { __mockGitStatus: object }).__mockGitStatus = args.statusAfterSave;
                (window as unknown as {
                    __mockGitHeadFiles: Record<string, string>;
                }).__mockGitHeadFiles = { "data/quest.csv": args.headCsv };
                (window as unknown as { __mockApiRequests: string[] }).__mockApiRequests = [];
                (window as unknown as { __mockApiRequestDetails: Array<{ type: string; filename?: string }> }).__mockApiRequestDetails = [];
                (window as unknown as { __onAfterWriteFile: (filename: string) => void }).__onAfterWriteFile = (filename: string) => {
                    if (filename !== "data/quest.csv" && filename !== "schema/quest.json") return;
                    window.setTimeout(() => {
                        window.chrome.webview.postMessage(JSON.stringify({ type: "file_changed" }));
                    }, 20);
                };
            }, { statusAfterSave: GIT_STATUS_AFTER_SAVE, headCsv: HEAD_QUEST_CSV });

            // Ctrl+S で保存する
            await page.keyboard.press('Control+s');

            // 保存後、変更セルに .cell-git-changed が付与されることを確認する
            // markSavedAndUpdatePanel() → refreshGitDiffAsync() → GitDiffTracker 再構築 → applyGitDiffHighlight()
            await expect(targetCell).toHaveClass(/cell-git-changed/);

            await page.waitForTimeout(100);
            const requestCounts = await page.evaluate(() => {
                const requests = (window as unknown as { __mockApiRequestDetails: Array<{ type: string; filename?: string }> }).__mockApiRequestDetails;
                return {
                    tableWrites: requests.filter(request =>
                        request.type === "write_file_request"
                        && (request.filename === "data/quest.csv" || request.filename === "schema/quest.json")
                    ).length,
                    gitStatus: requests.filter(request => request.type === "git_status_request").length,
                };
            });
            expect(requestCounts.tableWrites).toBe(2);
            expect(requestCounts.gitStatus).toBe(1);
        },
    );

    // -------------------------------------------------------------------------
    // テスト2: 保存前にHEAD版と同じ値のセルには.cell-git-changedが付かない
    //          （保存後の確認が保存前状態のレグレッションでないことを保証する補足テスト）
    // -------------------------------------------------------------------------
    test(
        '保存前はHEAD版と同じ値のセルに .cell-git-changed クラスが付与されないこと',
        async ({ page, gitDiffAfterSavePage: _gitDiffAfterSavePage }) => {
            // quest テーブルを開く
            await page.locator('#explorer .explorer-file').getByText('quest').click();

            const table = page.locator(
                `.editor-left-pane .tab-wrapper[data-tab-name="quest"] .editor-table`,
            );
            await expect(table).toBeVisible();

            // 初期状態: questはclean（git statusのchangesに含まれない）
            // そのためGitDiffTrackerが未構築 → 全セルに .cell-git-changed が付かないことを確認する
            const cell0 = getDataCell(table, 0, 3);
            const cell1 = getDataCell(table, 1, 3);
            const cell2 = getDataCell(table, 2, 3);
            await expect(cell0).not.toHaveClass(/cell-git-changed/);
            await expect(cell1).not.toHaveClass(/cell-git-changed/);
            await expect(cell2).not.toHaveClass(/cell-git-changed/);
        },
    );

});
