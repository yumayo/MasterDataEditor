import { test as base, expect } from './fixtures/test';
import { MockFileSystem, installMockApiAsync } from './fixtures/mock-api';
import { getDataCell, expectCsvAsync } from './fixtures/test-utils';

// =============================================================================
// 差分ビューのDirtyマーク表示と Ctrl+S 保存の検証
//
// 根本原因:
//   原因1: tab.ts L646 で DOM未追加の dummyTabButton（名前 '[diff]'）を DiffTab に渡している。
//          History.notifyChange() → setTabButtonDirty() が呼ばれても画面上のタブボタンに反映されない。
//
//   原因2: diff-tab.ts L156-157 で disableSave() を呼んでおり、Ctrl+S が完全に無効化されている。
//          差分タブのストアキーが 'tableName:diff:current' という不正パスのため、
//          そのままファイル保存するとファイルシステムを破壊するリスクがあった。
//          正しくは元テーブル名（tableName）に対して保存する必要がある。
//
// 検証シナリオ:
//   1. 差分ビューで右ペインのセルを編集した後、タブにDirtyマーク（.tab-button-dirty-visible）が表示される
//   2. 差分ビューで右ペインのセルを編集した後、Ctrl+S で元CSVファイルに内容が保存される
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

function createDiffTabDirtySaveFileSystem(): MockFileSystem {
    return {
        "schema/quest_reward.json": QUEST_REWARD_SCHEMA,
        "data/quest_reward.csv": CURRENT_QUEST_REWARD_CSV,
    };
}

// フィクスチャ型定義
interface DiffTabDirtySaveFixtures {
    /** git差分状態をセットアップした状態でページを開く */
    diffTabDirtySavePage: void;
}

/**
 * 差分タブDirty/保存バグ検証テスト用フィクスチャ
 * addInitScript は goto より前に実行する必要があるため、
 * installMockApiAsync より前に __mockGitStatus / __mockGitHeadFiles を設定する
 */
const test = base.extend<DiffTabDirtySaveFixtures>({
    diffTabDirtySavePage: async ({ page }, use) => {
        await page.addInitScript((args: {
            status: { changes: { path: string; tableName: string; isNew: boolean }[]; staged: { path: string; tableName: string; isNew: boolean }[] };
            headFiles: Record<string, string>;
        }) => {
            (window as unknown as { __mockGitStatus: object }).__mockGitStatus = args.status;
            (window as unknown as { __mockGitHeadFiles: Record<string, string> }).__mockGitHeadFiles = args.headFiles;
        }, { status: GIT_STATUS, headFiles: HEAD_FILES });

        await installMockApiAsync(page, createDiffTabDirtySaveFileSystem());
        await page.goto('/');
        await use();
    },
});

// テスト本体 -------------------------------------------------------------------

test.describe('差分ビューのDirtyマークと保存', () => {

    // -------------------------------------------------------------------------
    // テスト1: 差分ビューの右ペインでセルを編集した後、タブにDirtyマークが表示されること
    //
    // 検証手順:
    //   1. ソースコントロールパネルを開く
    //   2. quest_reward の差分タブを開く
    //   3. 差分タブの右ペインのセルをダブルクリックして編集する
    //   4. タブボタンに .tab-button-dirty-visible クラスが付いていることを確認する
    //
    // なぜ失敗するか（RED の理由）:
    //   tab.ts L646 で DOM未追加の dummyTabButton（名前 '[diff]'）を DiffTab に渡している。
    //   History.notifyChange() → tabButton.setDirty() が呼ばれても、
    //   dummyTabButton は DOM に追加されていないため、画面上の「差分: quest_reward」タブには反映されない。
    // -------------------------------------------------------------------------
    test(
        '差分ビューの右ペインでセルを編集した後にタブにDirtyマーク（●）が表示されること',
        async ({ page, diffTabDirtySavePage: _diffTabDirtySavePage }) => {
            // ソースコントロールパネルを開く
            await page.locator('[data-panel="sourceControl"]').click();

            // CHANGES セクションの quest_reward テーブルをクリックして差分タブを開く
            const changesSection = page.locator('.source-control-changes-section');
            await expect(changesSection.getByText('quest_reward')).toBeVisible();
            await changesSection.getByText('quest_reward').click();

            // 差分タブが開いていることを確認する
            const diffTab = page.locator('.diff-tab');
            await expect(diffTab).toBeVisible();

            // 差分タブのタブボタンを取得する
            const diffTabButton = page.locator('.tab-button', { hasText: '差分: quest_reward' });
            await expect(diffTabButton).toBeVisible();

            // 編集前はDirtyマークが付いていないことを確認する
            // .tab-button-dirty-visible クラスがないことを検証する
            const dirtyIndicator = diffTabButton.locator('.tab-button-dirty');
            await expect(dirtyIndicator).not.toHaveClass(/tab-button-dirty-visible/);

            // 右ペインのEditorTableが表示されることを確認する
            const rightPane = diffTab.locator('.diff-pane-right');
            await expect(rightPane.locator('.editor-table')).toBeVisible();

            // 右ペインの1行目1列目（rowIndex=0, colIndex=0）をダブルクリックして編集する
            const rightTable = rightPane.locator('.editor-table');
            const targetCell = getDataCell(rightTable, 0, 0);
            await targetCell.dblclick();

            // テキストフィールドが表示されるまで待機する
            const editField = page.locator('.grid-textfield-active').first();
            await expect(editField).toBeVisible();

            // 新しい値を入力してEnterで確定する
            await editField.selectText();
            await editField.type('999');
            await page.keyboard.press('Enter');

            // 編集後にDirtyマーク（.tab-button-dirty-visible）が付くことを確認する
            // 現行バグでは dummyTabButton が DOM未追加のため、このアサーションが失敗して RED になる
            await expect(dirtyIndicator).toHaveClass(/tab-button-dirty-visible/);
        },
    );

    // -------------------------------------------------------------------------
    // テスト2: 差分ビューの右ペインでセルを編集した後、Ctrl+S で元CSVファイルに保存されること
    //
    // 検証手順:
    //   1. ソースコントロールパネルを開く
    //   2. quest_reward の差分タブを開く
    //   3. 差分タブの右ペインの1行目1列目（id列）を「999」に変更する
    //   4. Ctrl+S を押す
    //   5. data/quest_reward.csv に「999」が書き込まれていることを expectCsvAsync で確認する
    //
    // なぜ失敗するか（RED の理由）:
    //   diff-tab.ts L156-157 で disableSave() を呼んでいる。
    //   Ctrl+S を押しても EditorTableHandler のデフォルト保存処理が完全に無効化されているため、
    //   ファイルは一切書き込まれない。
    //   正しくは tableName（quest_reward）のファイルに右ペインの内容を保存する必要がある。
    // -------------------------------------------------------------------------
    test(
        '差分ビューの右ペインでセルを編集した後にCtrl+Sで元のCSVファイルに保存されること',
        async ({ page, diffTabDirtySavePage: _diffTabDirtySavePage }) => {
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

            // 右ペインの1行目2列目（name列: rowIndex=0, colIndex=1）をダブルクリックして編集する
            // id=1, name=reward_modified の行の name を「reward_edited」に変更する
            const rightTable = rightPane.locator('.editor-table');
            const nameCell = getDataCell(rightTable, 0, 1);
            await nameCell.dblclick();

            // テキストフィールドが表示されるまで待機する
            const editField = page.locator('.grid-textfield-active').first();
            await expect(editField).toBeVisible();

            // 「reward_edited」に変更する
            await editField.selectText();
            await editField.type('reward_edited');
            await page.keyboard.press('Enter');

            // フォーカスを右ペインに戻してから Ctrl+S を押す
            await nameCell.click();
            await page.keyboard.press('Control+s');

            // data/quest_reward.csv に編集内容が保存されていることを確認する
            // 現行バグでは disableSave() により Ctrl+S が無効化されているため、
            // ファイルには元の CURRENT_QUEST_REWARD_CSV のままで変更が反映されない
            // → このアサーションが失敗して RED になる
            await expectCsvAsync(page, 'data/quest_reward.csv', `
                id, name
                1,  reward_edited
                2,  reward_b
                3,  reward_c
            `);
        },
    );

});
