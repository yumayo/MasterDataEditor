import { test as base, expect } from './fixtures/test';
import { MockFileSystem, installMockApiAsync } from './fixtures/mock-api';
import { getDataCell } from './fixtures/test-utils';

// =============================================================================
// MCP経由の saveTableAsync 保存後にgit差分ハイライトが更新されることを検証するテスト
//
// 不具合の概要:
//   通常の Ctrl+S 保存では markSavedAndUpdatePanel() 内で refreshGitDiffAsync() が
//   呼ばれるため .cell-git-changed が正しく更新される。
//   しかし MCP経由の editorApi.edit.saveTableAsync() では refreshGitDiffAsync() が
//   呼ばれないため、保存後もgit差分ハイライトが更新されない。
//
// テスト方針:
//   git-diff-after-save.spec.ts と同様にgit statusをclean状態で初期化し、
//   editorApi.edit.setCellValue() でセル編集 → git statusモック更新 →
//   editorApi.edit.saveTableAsync() で保存 → .cell-git-changed が付与されることを検証する。
//   saveTableAsync 内で refreshGitDiffAsync が呼ばれ .cell-git-changed が正しく更新される。
// =============================================================================

// テスト共通データ ---------------------------------------------------------------

/** FK参照を持たないシンプルな4列スキーマ（git-diff-after-save.spec.ts と同一構成） */
const QUEST_SCHEMA = JSON.stringify({
    header: [
        { key: 0, name: "id", type: "int" },
        { key: 1, name: "first_clear_reward_table_id", type: "int" },
        { key: 2, name: "first_clear_reward_record_id", type: "int" },
        { key: 3, name: "quest_reward_group_id", type: "int" },
    ],
    primary_key: ["id"],
});

/** 現在版CSV（working tree）— HEAD版と同一の初期状態 */
const CURRENT_QUEST_CSV = [
    "id,first_clear_reward_table_id,first_clear_reward_record_id,quest_reward_group_id",
    "1,1,3,1",
    "2,2,1,1",
    "3,1,3,2",
].join("\n");

/** HEAD版CSV — 初期状態では現在版と同一（差分なし） */
const HEAD_QUEST_CSV = [
    "id,first_clear_reward_table_id,first_clear_reward_record_id,quest_reward_group_id",
    "1,1,3,1",
    "2,2,1,1",
    "3,1,3,2",
].join("\n");

/** 初期git status: questテーブルはclean（changesに含まれない） */
const INITIAL_GIT_STATUS = {
    changes: [],
    staged: [],
};

/** 保存後git status: questテーブルが変更対象として含まれる */
const GIT_STATUS_AFTER_SAVE = {
    changes: [
        { path: "data/quest.csv", tableName: "quest", isNew: false },
    ],
    staged: [],
};

function createFileSystem(): MockFileSystem {
    return {
        "schema/quest.json": QUEST_SCHEMA,
        "data/quest.csv": CURRENT_QUEST_CSV,
    };
}

// フィクスチャ型定義 -------------------------------------------------------------

interface McpSaveGitDiffFixtures {
    /** git statusをclean状態でセットアップした状態でページを開く */
    mcpSaveGitDiffPage: void;
}

/**
 * MCP保存後git差分ハイライトテスト用フィクスチャ
 * git statusはclean状態で初期化する（タブオープン時にGitDiffTrackerが構築されない）
 */
const test = base.extend<McpSaveGitDiffFixtures>({
    mcpSaveGitDiffPage: async ({ page }, use) => {
        // 初期git状態をcleanに設定する（questはchangesに含まれない）
        await page.addInitScript((args: {
            status: { changes: object[]; staged: object[] };
        }) => {
            (window as unknown as { __mockGitStatus: object }).__mockGitStatus = args.status;
            (window as unknown as { __mockGitHeadFiles: Record<string, string> }).__mockGitHeadFiles = {};
        }, { status: INITIAL_GIT_STATUS });

        await installMockApiAsync(page, createFileSystem());
        await page.goto('/');
        await use();
    },
});

// テスト本体 -------------------------------------------------------------------

test.describe('MCP経由 saveTableAsync 後のgit差分ハイライト更新', () => {

    test(
        'editorApi.edit.saveTableAsync 後に変更セルに .cell-git-changed クラスが付与されること',
        async ({ page, mcpSaveGitDiffPage: _mcpSaveGitDiffPage }) => {
            // questテーブルを開く
            await page.locator('#explorer .explorer-file').getByText('quest').click();
            const table = page.locator(
                `.editor-left-pane .tab-wrapper[data-tab-name="quest"] .editor-table`,
            );
            await expect(table).toBeVisible();

            // 対象セル: 1行目、4列目（quest_reward_group_id、col index 3）
            // 初期状態ではgit statusがcleanなのでcell-git-changedは付与されていない
            const targetCell = getDataCell(table, 0, 3);
            await expect(targetCell).not.toHaveClass(/cell-git-changed/);

            // editorApi.edit.setCellValue() でセルを編集する（MCP経由の操作を模倣）
            const editResult = await page.evaluate(() => {
                return (window as unknown as {
                    editorApi: { edit: { setCellValue(name: string, row: number, col: number, value: string): boolean } };
                }).editorApi.edit.setCellValue('quest', 0, 3, '2');
            });
            expect(editResult).toBe(true);

            // セル編集後もGitDiffTrackerが未構築のため cell-git-changed は付かないままである
            await expect(targetCell).not.toHaveClass(/cell-git-changed/);

            // 保存前にgit状態モックを更新する（保存後のgit statusとHEAD版CSVを設定）
            await page.evaluate((args: {
                statusAfterSave: { changes: { path: string; tableName: string; isNew: boolean }[]; staged: object[] };
                headCsv: string;
            }) => {
                (window as unknown as { __mockGitStatus: object }).__mockGitStatus = args.statusAfterSave;
                (window as unknown as {
                    __mockGitHeadFiles: Record<string, string>;
                }).__mockGitHeadFiles = { "data/quest.csv": args.headCsv };
            }, { statusAfterSave: GIT_STATUS_AFTER_SAVE, headCsv: HEAD_QUEST_CSV });

            // editorApi.edit.saveTableAsync() で保存する（MCP経由の保存を模倣）
            const saveResult = await page.evaluate(() => {
                return (window as unknown as {
                    editorApi: { edit: { saveTableAsync(name: string): Promise<boolean> } };
                }).editorApi.edit.saveTableAsync('quest');
            });
            expect(saveResult).toBe(true);

            // 保存後、変更セルに .cell-git-changed が付与されることを検証する
            // 保存後、refreshGitDiffAsync により変更セルにgit差分ハイライトが付与される
            await expect(targetCell).toHaveClass(/cell-git-changed/);
        },
    );

    test(
        'editorApi.edit.saveTableAsync 後に変更していないセルには .cell-git-changed が付かないこと',
        async ({ page, mcpSaveGitDiffPage: _mcpSaveGitDiffPage }) => {
            // questテーブルを開く
            await page.locator('#explorer .explorer-file').getByText('quest').click();
            const table = page.locator(
                `.editor-left-pane .tab-wrapper[data-tab-name="quest"] .editor-table`,
            );
            await expect(table).toBeVisible();

            // editorApi.edit.setCellValue() で1行目4列目のみ編集する
            await page.evaluate(() => {
                (window as unknown as {
                    editorApi: { edit: { setCellValue(name: string, row: number, col: number, value: string): boolean } };
                }).editorApi.edit.setCellValue('quest', 0, 3, '2');
            });

            // git状態モックを更新する
            await page.evaluate((args: {
                statusAfterSave: { changes: { path: string; tableName: string; isNew: boolean }[]; staged: object[] };
                headCsv: string;
            }) => {
                (window as unknown as { __mockGitStatus: object }).__mockGitStatus = args.statusAfterSave;
                (window as unknown as {
                    __mockGitHeadFiles: Record<string, string>;
                }).__mockGitHeadFiles = { "data/quest.csv": args.headCsv };
            }, { statusAfterSave: GIT_STATUS_AFTER_SAVE, headCsv: HEAD_QUEST_CSV });

            // MCP経由で保存する
            await page.evaluate(() => {
                return (window as unknown as {
                    editorApi: { edit: { saveTableAsync(name: string): Promise<boolean> } };
                }).editorApi.edit.saveTableAsync('quest');
            });

            // 変更していないセル（2行目4列目）にはcell-git-changedが付かないことを検証する
            // HEAD版の値 "1" とworking treeの値 "1" が同一のため差分なし
            const unchangedCell = getDataCell(table, 1, 3);
            await expect(unchangedCell).not.toHaveClass(/cell-git-changed/);
        },
    );
});
