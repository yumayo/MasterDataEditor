import { test as base, expect } from './fixtures/test';
import { MockFileSystem, installMockApiAsync } from './fixtures/mock-api';
import { getDataCell } from './fixtures/test-utils';

// =============================================================================
// 差分ビューの diff-cell-added / diff-cell-deleted クラスが
// 右ペインでのセル編集後に動的に更新されることを検証する
//
// 根本原因:
//   DiffTab.applyDiffClasses() はコンストラクタで1回だけ呼ばれ、
//   以降セルを編集しても diff-cell-added / diff-cell-deleted は再評価されない。
//   たとえ値をHEAD版と同じに戻しても、初期構築時の差分クラスが残り続ける。
//
// 検証シナリオ:
//   1. 差分ビューを開く（HEAD版と現在版で値が異なるセルがある状態）
//   2. diff-cell-added クラスが付与されていることを確認する
//   3. 右ペインのセルをHEAD版と同じ値に編集する
//   4. diff-cell-added クラスが除去されていることを確認する（RED: 現状除去されない）
//
//   5. 右ペインのセルをHEAD版と異なる別の値に編集する
//   6. diff-cell-added クラスが維持されていることを確認する
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
interface DiffTabDynamicDiffFixtures {
    /** git差分状態をセットアップした状態でページを開く */
    diffTabDynamicDiffPage: void;
}

/**
 * 差分タブ動的差分クラス検証テスト用フィクスチャ
 * addInitScript は goto より前に実行する必要があるため、
 * installMockApiAsync より前に __mockGitStatus / __mockGitHeadFiles を設定する
 */
const test = base.extend<DiffTabDynamicDiffFixtures>({
    diffTabDynamicDiffPage: async ({ page }, use) => {
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

test.describe('差分タブの diff-cell-added/deleted クラスが編集後に動的更新される', () => {

    // -------------------------------------------------------------------------
    // テスト1: 値をHEAD版と同じにしたら diff-cell-added が除去される
    //
    // 初期状態: id=1, name列 → HEAD版="reward_a", 現在版="reward_modified"
    //   → 右ペインの (0, 1) セルに diff-cell-added が付与されている
    // 操作: 右ペインの (0, 1) セルを "reward_a"（HEAD版と同じ値）に編集する
    // 期待: diff-cell-added クラスが除去されている
    //
    // RED理由: applyDiffClasses() はコンストラクタで1回だけ呼ばれ、
    //          セル編集後に diff-cell-added の除去が行われないため。
    // -------------------------------------------------------------------------
    test(
        '右ペインのセルをHEAD版と同じ値に編集すると diff-cell-added が除去されること',
        async ({ page, diffTabDynamicDiffPage: _diffTabDynamicDiffPage }) => {
            // ソースコントロールパネルを開く
            await page.locator('[data-panel="sourceControl"]').click();

            // CHANGES セクションの quest_reward テーブルをクリックして差分タブを開く
            const changesSection = page.locator('.source-control-changes-section');
            await expect(changesSection.getByText('quest_reward')).toBeVisible();
            await changesSection.getByText('quest_reward').click();

            // 差分タブが開いていることを確認する
            const diffTab = page.locator('.diff-tab');
            await expect(diffTab).toBeVisible();

            // 右ペインのEditorTableを取得する
            const rightPane = diffTab.locator('.diff-pane-right');
            await expect(rightPane.locator('.editor-table')).toBeVisible();
            const rightTable = rightPane.locator('.editor-table');

            // 左ペインのEditorTableを取得する
            const leftPane = diffTab.locator('.diff-pane-left');
            await expect(leftPane.locator('.editor-table')).toBeVisible();
            const leftTable = leftPane.locator('.editor-table');

            // 初期状態の確認: 右ペインの (0, 1) セル（id=1, name列）に diff-cell-added が付与されている
            const targetCell = getDataCell(rightTable, 0, 1);
            await expect(targetCell).toHaveClass(/diff-cell-added/);

            // 左ペインの (0, 1) セルに diff-cell-deleted が付与されていることも確認する
            const leftCell = getDataCell(leftTable, 0, 1);
            await expect(leftCell).toHaveClass(/diff-cell-deleted/);

            // 右ペインのセルをダブルクリックして編集モードにする
            await targetCell.dblclick();

            // テキストフィールドが表示されるまで待機する
            const editField = page.locator('.grid-textfield-active').first();
            await expect(editField).toBeVisible();

            // HEAD版と同じ値 "reward_a" に変更する
            await editField.selectText();
            await editField.type('reward_a');
            await page.keyboard.press('Enter');

            // diff-cell-added クラスが除去されていることを確認する
            // RED: 現状 applyDiffClasses は初期構築時のみ実行されるため、
            //      セル編集後も diff-cell-added が残り続ける
            await expect(targetCell).not.toHaveClass(/diff-cell-added/);

            // 左ペインの diff-cell-deleted も除去されていることを確認する
            // （右ペインの値がHEADと一致したので、左ペインの「削除」ハイライトも不要になる）
            await expect(leftCell).not.toHaveClass(/diff-cell-deleted/);
        },
    );

    // -------------------------------------------------------------------------
    // テスト2: 値をHEAD版と異なる値にしたら diff-cell-added が維持される
    //
    // 初期状態: id=1, name列 → HEAD版="reward_a", 現在版="reward_modified"
    //   → 右ペインの (0, 1) セルに diff-cell-added が付与されている
    // 操作: 右ペインの (0, 1) セルを "reward_other"（HEAD版と異なる別の値）に編集する
    // 期待: diff-cell-added クラスが維持されている
    // -------------------------------------------------------------------------
    test(
        '右ペインのセルをHEAD版と異なる値に編集すると diff-cell-added が維持されること',
        async ({ page, diffTabDynamicDiffPage: _diffTabDynamicDiffPage }) => {
            // ソースコントロールパネルを開く
            await page.locator('[data-panel="sourceControl"]').click();

            // CHANGES セクションの quest_reward テーブルをクリックして差分タブを開く
            const changesSection = page.locator('.source-control-changes-section');
            await expect(changesSection.getByText('quest_reward')).toBeVisible();
            await changesSection.getByText('quest_reward').click();

            // 差分タブが開いていることを確認する
            const diffTab = page.locator('.diff-tab');
            await expect(diffTab).toBeVisible();

            // 右ペインのEditorTableを取得する
            const rightPane = diffTab.locator('.diff-pane-right');
            await expect(rightPane.locator('.editor-table')).toBeVisible();
            const rightTable = rightPane.locator('.editor-table');

            // 初期状態の確認: 右ペインの (0, 1) セル（id=1, name列）に diff-cell-added が付与されている
            const targetCell = getDataCell(rightTable, 0, 1);
            await expect(targetCell).toHaveClass(/diff-cell-added/);

            // 右ペインのセルをダブルクリックして編集モードにする
            await targetCell.dblclick();

            // テキストフィールドが表示されるまで待機する
            const editField = page.locator('.grid-textfield-active').first();
            await expect(editField).toBeVisible();

            // HEAD版と異なる別の値 "reward_other" に変更する
            await editField.selectText();
            await editField.type('reward_other');
            await page.keyboard.press('Enter');

            // diff-cell-added クラスが維持されていることを確認する
            // （HEAD版 "reward_a" と異なる値なので差分ハイライトは残る）
            await expect(targetCell).toHaveClass(/diff-cell-added/);
        },
    );

});
