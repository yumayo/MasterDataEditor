import type { Page, Locator } from '@playwright/test';
import { test as base, expect } from './fixtures/test';
import { MockFileSystem, installMockApiAsync } from './fixtures/mock-api';
import { getDataCell, expectCsvAsync } from './fixtures/test-utils';

// =============================================================================
// 差分ビューのDirtyマーク表示と Ctrl+S 保存の検証
//
// 検証シナリオ:
//   1. 差分ビューで右ペインのセルを編集した後、タブにDirtyマーク（.tab-button-dirty-visible）が表示される
//   2. 差分ビューで右ペインのセルを編集した後、Ctrl+S で元CSVファイルに内容が保存される
//
// 保存の仕組み:
//   差分タブの右ペインは configureDiffRightPane(tableName, gitPath) で saveTargetTableName が設定される。
//   Ctrl+S 時に saveDiffTableDataFromStoreAsync(saveTargetTableName, ...) で元テーブル名のCSVに保存する。
//   保存は fire-and-forget（await なし）で実行されるため、テストでは Dirty マーク消去を保存完了シグナルとして待機する。
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

// 差分タブのセットアップ結果
interface DiffTabSetupResult {
    rightPane: Locator;
    dirtyIndicator: Locator;
    editedCell: Locator;
}

/**
 * 差分タブを開いてセルを編集するまでの共通セットアップ
 *
 * 手順:
 *   1. ソースコントロールパネルを開く
 *   2. quest_reward の差分タブを開く
 *   3. タブ表示確認・Dirtyインジケーター取得
 *   4. 右ペインの指定列セルをダブルクリックして値を入力・確定する
 */
async function setupDiffTabAndEditCellAsync(page: Page, colIndex: number, inputValue: string): Promise<DiffTabSetupResult> {
    // ソースコントロールパネルを開く
    await page.locator('[data-panel="sourceControl"]').click();

    // CHANGES セクションの quest_reward テーブルをクリックして差分タブを開く
    const changesSection = page.locator('.source-control-changes-section');
    await expect(changesSection.getByText('quest_reward')).toBeVisible();
    await changesSection.getByText('quest_reward').click();

    // 差分タブが開いていることを確認する
    const diffTab = page.locator('.diff-tab');
    await expect(diffTab).toBeVisible();

    // 差分タブのタブボタンとDirtyインジケーターを取得する
    const diffTabButton = page.locator('.tab-button', { hasText: '差分: quest_reward' });
    await expect(diffTabButton).toBeVisible();
    const dirtyIndicator = diffTabButton.locator('.tab-button-dirty');

    // 右ペインのEditorTableが表示されることを確認する
    const rightPane = diffTab.locator('.diff-pane-right');
    await expect(rightPane.locator('.editor-table')).toBeVisible();

    // 右ペインの1行目・指定列をダブルクリックして編集する
    const rightTable = rightPane.locator('.editor-table');
    const editedCell = getDataCell(rightTable, 0, colIndex);
    await editedCell.dblclick();

    // テキストフィールドが表示されるまで待機する（右ペインにスコープ）
    const editField = rightPane.locator('.grid-textfield-active').first();
    await expect(editField).toBeVisible();

    // 値を入力してEnterで確定する
    await editField.selectText();
    await editField.type(inputValue);
    await page.keyboard.press('Enter');

    return { rightPane, dirtyIndicator, editedCell };
}

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
    // 実装:
    //   tab.ts の openDiffTabAsync で画面上のタブボタン（TabButton）を DiffTab に渡し、
    //   History.notifyChange() → tabButton.setDirty() でDirtyマークが反映される。
    // -------------------------------------------------------------------------
    test(
        '差分ビューの右ペインでセルを編集した後にタブにDirtyマーク（●）が表示されること',
        async ({ page, diffTabDirtySavePage: _diffTabDirtySavePage }) => {
            // 編集前のDirtyマーク不在を確認するため、セットアップ前にDirtyインジケーターを検証する必要がある
            // → セットアップ内で編集まで完了するので、編集前検証はセットアップ前に行う必要がない
            //   （Dirtyマークは編集前は付いていないことが前提。編集後に付くことを検証する）
            const { dirtyIndicator } = await setupDiffTabAndEditCellAsync(page, 0, '999');

            // 編集後にDirtyマーク（.tab-button-dirty-visible）が付くことを確認する
            await expect(dirtyIndicator).toHaveClass(/tab-button-dirty-visible/);
        },
    );

    // -------------------------------------------------------------------------
    // テスト2: 差分ビューの右ペインでセルを編集した後、Ctrl+S で元CSVファイルに保存されること
    //
    // 検証手順:
    //   1. ソースコントロールパネルを開く
    //   2. quest_reward の差分タブを開く
    //   3. 差分タブの右ペインの name 列を「reward_edited」に変更する
    //   4. Ctrl+S を押す
    //   5. Dirtyマークが消えるのを待つ（保存完了のシグナル）
    //   6. data/quest_reward.csv に「reward_edited」が保存されていることを expectCsvAsync で確認する
    //
    // 保存フロー:
    //   Ctrl+S → saveDiffTableDataFromStoreAsync（非同期）→ writeFileAsync → store.markAllSaved
    //   → TabButton の Dirty マーク消去。
    //   saveDiffTableDataFromStoreAsync は fire-and-forget（await なし）で呼ばれるため、
    //   Ctrl+S のキーイベント配信完了後に即座に CSV を検証すると書き込みが未完了の場合がある。
    //   Dirty マーク消去を保存完了のシグナルとして待機することで確実に検証できる。
    // -------------------------------------------------------------------------
    test(
        '差分ビューの右ペインでセルを編集した後にCtrl+Sで元のCSVファイルに保存されること',
        async ({ page, diffTabDirtySavePage: _diffTabDirtySavePage }) => {
            const { dirtyIndicator, editedCell } = await setupDiffTabAndEditCellAsync(page, 1, 'reward_edited');

            // 編集によりDirtyマークが表示されるのを待つ
            await expect(dirtyIndicator).toHaveClass(/tab-button-dirty-visible/);

            // フォーカスを右ペインに戻してから Ctrl+S を押す
            await editedCell.click();
            await page.keyboard.press('Control+s');

            // 保存完了を待機する: saveDiffTableDataFromStoreAsync は fire-and-forget で呼ばれるため、
            // Dirty マーク消去（store.markAllSaved → TabButton 更新）を保存完了のシグナルとして使う
            await expect(dirtyIndicator).not.toHaveClass(/tab-button-dirty-visible/);

            // data/quest_reward.csv に編集内容が保存されていることを確認する
            await expectCsvAsync(page, 'data/quest_reward.csv', `
                id, name
                1,  reward_edited
                2,  reward_b
                3,  reward_c
            `);
        },
    );

});
