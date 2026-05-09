import { test as base, expect } from './fixtures/test';
import { MockFileSystem, installMockApiAsync } from './fixtures/mock-api';

// =============================================================================
// 差分タブの右ペインでFK列のドロップダウンが表示されない不具合の検証テスト
//
// 根本原因:
//   DiffTab.buildDiffEditorTable() で createDropdownInput() と setReferenceComponents() が
//   呼ばれていないため、EditorTableHandler の referenceDataCache・dropdownInput・tableData が
//   未設定のまま残る。
//
//   enableCellEditModeWithDropdownAsync()（editor-table-handler.ts）の冒頭で
//   dropdownInput が存在しない場合は即 false を返すため、ドロップダウンが表示されない。
//
//   通常タブ（tab.ts）ではこの2行が呼ばれている:
//     const dropdownInput = editorTableHandler.createDropdownInput(wrapperElement, this.referenceDataCache);
//     editorTableHandler.setReferenceComponents(this.referenceDataCache, dropdownInput, tableData);
//
//   しかし DiffTab.buildDiffEditorTable()（diff-tab.ts 386〜418行）には欠落している。
//
// 検証シナリオ:
//   1. FK列（reward_table_id → reward_table.id への参照）を持つ quest_reward の差分タブを開く
//   2. 右ペイン（現在版）の FK列セルをダブルクリックする
//   3. ドロップダウンリスト（.grid-dropdown-list）が表示されることを検証する
//
// RED になる理由:
//   buildDiffEditorTable() で createDropdownInput()/setReferenceComponents() が呼ばれないため、
//   右ペインの EditorTableHandler にドロップダウン入力コンポーネントが設定されず、
//   FK列セルをダブルクリックしても .grid-dropdown-list が表示されない。
// =============================================================================

// テスト用スキーマ（reward_table: id, ja の2列テーブル）
// config.referenceDisplayColumnPriority に従い表示列は "ja" を使用する（"name" は優先リスト外）
const REWARD_TABLE_SCHEMA = JSON.stringify({
    header: [
        { key: 0, name: "id", type: "int" },
        { key: 1, name: "ja", type: "string" },
    ],
    primary_key: ["id"],
});

// reward_table のデータ（ヘッダーは ja 列）
const REWARD_TABLE_CSV = [
    "id,ja",
    "1,gold_small",
    "2,gold_medium",
    "3,item_potion",
].join("\n");

// テスト用スキーマ（quest_reward: id, group_id, reward_table_id(→reward_table.id) の3列テーブル）
const QUEST_REWARD_SCHEMA = JSON.stringify({
    header: [
        { key: 0, name: "id", type: "int" },
        { key: 1, name: "group_id", type: "int" },
        { key: 2, name: "reward_table_id", type: "int", reference: "reward_table.id" },
    ],
    primary_key: ["id"],
});

// quest_reward 現在版（working tree）— id=1 の行を削除した状態
const CURRENT_QUEST_REWARD_CSV = [
    "id,group_id,reward_table_id",
    "2,1,2",
    "3,2,1",
].join("\n");

// quest_reward HEAD版（変更前）— id=1 が存在する
const HEAD_QUEST_REWARD_CSV = [
    "id,group_id,reward_table_id",
    "1,1,1",
    "2,1,2",
    "3,2,1",
].join("\n");

// git status レスポンス（quest_reward が changes 状態）
const GIT_STATUS = {
    changes: [{ path: "data/quest_reward.csv", tableName: "quest_reward", isNew: false }],
    staged: [] as { path: string; tableName: string; isNew: boolean }[],
};

// HEAD版ファイルマップ
const HEAD_FILES: Record<string, string> = {
    "data/quest_reward.csv": HEAD_QUEST_REWARD_CSV,
};

function createDiffTabDropdownFileSystem(): MockFileSystem {
    return {
        "schema/reward_table.json": REWARD_TABLE_SCHEMA,
        "data/reward_table.csv": REWARD_TABLE_CSV,
        "schema/quest_reward.json": QUEST_REWARD_SCHEMA,
        "data/quest_reward.csv": CURRENT_QUEST_REWARD_CSV,
    };
}

// フィクスチャ型定義
interface DiffTabDropdownFixtures {
    /** git差分状態をセットアップした状態でページを開く */
    diffTabDropdownPage: void;
}

/**
 * 差分タブドロップダウンバグ検証テスト用フィクスチャ
 * addInitScript は goto より前に実行する必要があるため、
 * installMockApiAsync より前に __mockGitStatus / __mockGitHeadFiles を設定する
 */
const test = base.extend<DiffTabDropdownFixtures>({
    diffTabDropdownPage: async ({ page }, use) => {
        await page.addInitScript((args: {
            status: { changes: { path: string; tableName: string; isNew: boolean }[]; staged: { path: string; tableName: string; isNew: boolean }[] };
            headFiles: Record<string, string>;
        }) => {
            (window as unknown as { __mockGitStatus: object }).__mockGitStatus = args.status;
            (window as unknown as { __mockGitHeadFiles: Record<string, string> }).__mockGitHeadFiles = args.headFiles;
        }, { status: GIT_STATUS, headFiles: HEAD_FILES });

        await installMockApiAsync(page, createDiffTabDropdownFileSystem());
        await page.goto('/');
        await use();
    },
});

// テスト本体 -------------------------------------------------------------------

test.describe('差分タブ右ペインでのFK列ドロップダウン表示', () => {

    // -------------------------------------------------------------------------
    // テスト1: 右ペイン（現在版）のFK列セルをダブルクリックするとドロップダウンが表示されること
    //
    // 検証手順:
    //   1. ソース管理パネルを開く
    //   2. quest_reward の差分タブを開く
    //   3. 差分タブが表示されることを確認する
    //   4. 右ペイン（現在版）の reward_table_id 列（colIndex=2）をダブルクリックする
    //   5. .grid-dropdown-list が表示されることを検証する
    //
    // なぜ失敗するか（RED の理由）:
    //   buildDiffEditorTable() で createDropdownInput()/setReferenceComponents() が呼ばれないため、
    //   右ペインの EditorTableHandler に dropdownInput が設定されず、
    //   enableCellEditModeWithDropdownAsync() が即 false を返してドロップダウンが表示されない。
    // -------------------------------------------------------------------------
    test(
        '差分タブの右ペイン（現在版）でFK列セルをダブルクリックするとドロップダウンが表示されること',
        async ({ page, diffTabDropdownPage: _diffTabDropdownPage }) => {
            // ソース管理パネルを開く
            await page.locator('[data-panel="sourceControl"]').click();

            const changesSection = page.locator('.source-control-changes-section');
            await expect(changesSection).toBeVisible();

            // quest_reward の差分タブを開く
            await changesSection.getByText('quest_reward').click();

            // 差分タブが表示されることを確認する
            const diffTab = page.locator('.diff-tab');
            await expect(diffTab).toBeVisible();

            // 右ペイン（現在版）のEditorTableが表示されることを確認する
            const rightPane = diffTab.locator('.diff-pane-right');
            await expect(rightPane.locator('.editor-table')).toBeVisible();

            // 右ペインの id=2 行（rowIndex=0, 差分ありの最初の行）の
            // reward_table_id 列（colIndex=2, 0始まり）のセルをダブルクリックする
            // diff-row-empty 行はスキップして実データ行（diff-row-modified または通常行）を狙う
            const firstDataRow = rightPane.locator('.editor-table .editor-table-row').nth(2);
            const fkCell = firstDataRow.locator('.editor-table-cell:not(.editor-table-row-header)').nth(2);
            await fkCell.dblclick();

            // ドロップダウンリストが表示されることを検証する
            // 現行バグでは createDropdownInput()/setReferenceComponents() が呼ばれないため
            // .grid-dropdown-list が表示されずアサーションが失敗する（REDになる）
            const dropdownList = page.locator('.grid-dropdown-list');
            await expect(dropdownList).toBeVisible();

            // ドロップダウンに reward_table のアイテムが表示されること
            const dropdownItems = dropdownList.locator('.grid-dropdown-item');
            await expect(dropdownItems.first()).toBeVisible();
        },
    );

    // -------------------------------------------------------------------------
    // テスト2: ドロップダウンのアイテムに reward_table の値が表示されること
    //
    // 検証手順:
    //   1. ソース管理パネルを開く
    //   2. quest_reward の差分タブを開く
    //   3. 右ペイン（現在版）の reward_table_id 列のセルをダブルクリックする
    //   4. ドロップダウンに "gold_small"・"gold_medium"・"item_potion" が表示されること
    //
    // なぜ失敗するか（RED の理由）:
    //   テスト1 と同じ根本原因。ドロップダウン自体が表示されないため
    //   reward_table のアイテムも当然表示されず、アサーションが失敗する。
    // -------------------------------------------------------------------------
    test(
        '差分タブ右ペインのFK列ドロップダウンに参照先テーブル（reward_table）のアイテムが表示されること',
        async ({ page, diffTabDropdownPage: _diffTabDropdownPage }) => {
            // ソース管理パネルを開く
            await page.locator('[data-panel="sourceControl"]').click();

            const changesSection = page.locator('.source-control-changes-section');
            await expect(changesSection).toBeVisible();

            // quest_reward の差分タブを開く
            await changesSection.getByText('quest_reward').click();

            // 差分タブが表示されることを確認する
            const diffTab = page.locator('.diff-tab');
            await expect(diffTab).toBeVisible();

            // 右ペイン（現在版）のEditorTableが表示されることを確認する
            const rightPane = diffTab.locator('.diff-pane-right');
            await expect(rightPane.locator('.editor-table')).toBeVisible();

            // 右ペインの id=2 行（rowIndex=0, 差分ありの最初の行）の
            // reward_table_id 列（colIndex=2, 0始まり）のセルをダブルクリックする
            const firstDataRow = rightPane.locator('.editor-table .editor-table-row').nth(2);
            const fkCell = firstDataRow.locator('.editor-table-cell:not(.editor-table-row-header)').nth(2);
            await fkCell.dblclick();

            // ドロップダウンリストが表示されることを確認する
            const dropdownList = page.locator('.grid-dropdown-list');
            await expect(dropdownList).toBeVisible();

            // reward_table の全アイテムが表示されること
            // 現行バグでは setReferenceComponents() が呼ばれないため
            // reward_table のデータがロードされずアイテムが表示されない
            await expect(dropdownList).toContainText('gold_small');
            await expect(dropdownList).toContainText('gold_medium');
            await expect(dropdownList).toContainText('item_potion');
        },
    );

});
