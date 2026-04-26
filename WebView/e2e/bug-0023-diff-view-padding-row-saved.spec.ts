import { test as base, expect } from './fixtures/test';
import { MockFileSystem, installMockApiAsync } from './fixtures/mock-api';
import { expectCsvAsync } from './fixtures/test-utils';
import { Page } from '@playwright/test';

// =============================================================================
// BUG_0023 — 差分ビューで行追加後に保存するとパディング行がCSVに混入する不具合
//
// 根本原因:
//   原因1: パディング行がCSVに保存される
//     diff-rows.ts の buildMergedData() が 'deleted' 行に対して右ペインに
//     emptyRow(columnCount) = ['', '', '', ''] を生成する。
//     この空行がストア（"quest_reward:diff:current" キー）に登録される。
//     saveDiffTableDataFromStoreAsync は store.getCsv(storeKey) を全行書き出すため、
//     パディング行 ",,," もそのままCSVに出力される。
//
//   原因2: Dirtyフラグが消えない
//     editor-table-handler.ts でCtrl+S後に markAllSaved(this.saveTargetTableName) =
//     markAllSaved("quest_reward") を呼ぶ。しかし差分タブのHistoryは
//     "quest_reward:diff:current" キーで historyRegistry に登録されており、
//     "quest_reward" キーにはHistoryが存在しない。
//     結果: markAllSaved がエラーまたはDirtyフラグが消えない。
//
//   原因3: 通常タブに反映されない
//     差分タブ保存はCSVファイルのみ更新し、通常タブのストア（"quest_reward"）は更新しない。
//     通常タブを開いても古いデータのまま。
//
// 検証シナリオ:
//   1. quest_rewardテーブル（id, quest_id, master_id, count の4列）をセットアップ
//   2. HEAD版: id=1〜4が存在、Current版: id=1が削除された状態（差分がある状態）
//   3. ソースコントロールパネルを開いてquest_rewardの差分タブを開く
//   4. 差分ビューの右ペインで最後の行ヘッダー（4行目）を右クリック→下に行を挿入
//   5. 挿入した行に「5,1,1,1」と入力
//   6. Ctrl+Sで保存
//   7. 検証:
//      A. CSVに空行（パディング行）が含まれないこと
//      B. 差分タブのDirtyフラグが消えること
//      C. 通常タブを開いたとき新しい行が反映されること
// =============================================================================

// テスト用スキーマ（id, quest_id, master_id, count の4列テーブル）
const QUEST_REWARD_SCHEMA = JSON.stringify({
    header: [
        { key: 0, name: "id", type: "int" },
        { key: 1, name: "quest_id", type: "int" },
        { key: 2, name: "master_id", type: "int" },
        { key: 3, name: "count", type: "int" },
    ],
    primary_key: ["id"],
});

// 現在版CSV（working tree）— id=1が削除された状態（id=2〜4のみ）
const CURRENT_QUEST_REWARD_CSV = [
    "id,quest_id,master_id,count",
    "2,1,1,1",
    "3,1,2,1",
    "4,2,1,1",
].join("\n");

// HEAD版CSV（変更前）— id=1〜4が存在
const HEAD_QUEST_REWARD_CSV = [
    "id,quest_id,master_id,count",
    "1,1,1,1",
    "2,1,1,1",
    "3,1,2,1",
    "4,2,1,1",
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

function createBug0023FileSystem(): MockFileSystem {
    return {
        "schema/quest_reward.json": QUEST_REWARD_SCHEMA,
        "data/quest_reward.csv": CURRENT_QUEST_REWARD_CSV,
    };
}

// フィクスチャ型定義
interface Bug0023Fixtures {
    /** git差分状態をセットアップした状態でページを開く */
    bug0023Page: void;
}

/**
 * BUG_0023 テスト用フィクスチャ
 * addInitScript は goto より前に実行する必要があるため、
 * installMockApiAsync より前に __mockGitStatus / __mockGitHeadFiles を設定する
 */
const test = base.extend<Bug0023Fixtures>({
    bug0023Page: async ({ page }, use) => {
        await page.addInitScript((args: {
            status: { changes: { path: string; tableName: string; isNew: boolean }[]; staged: { path: string; tableName: string; isNew: boolean }[] };
            headFiles: Record<string, string>;
        }) => {
            (window as unknown as { __mockGitStatus: object }).__mockGitStatus = args.status;
            (window as unknown as { __mockGitHeadFiles: Record<string, string> }).__mockGitHeadFiles = args.headFiles;
        }, { status: GIT_STATUS, headFiles: HEAD_FILES });

        await installMockApiAsync(page, createBug0023FileSystem());
        await page.goto('/');
        await use();
    },
});

/**
 * ソースコントロールパネルからquest_rewardの差分タブを開くヘルパー
 */
async function openQuestRewardDiffTabAsync(page: Page): Promise<void> {
    await page.locator('[data-panel="sourceControl"]').click();
    const changesSection = page.locator('.source-control-changes-section');
    await expect(changesSection.getByText('quest_reward')).toBeVisible();
    await changesSection.getByText('quest_reward').click();
    await expect(page.locator('.diff-tab')).toBeVisible();
}

// テスト本体 -------------------------------------------------------------------

test.describe('BUG_0023 — 差分ビューで行追加保存時のパディング行混入', () => {

    // -------------------------------------------------------------------------
    // テスト1: 差分ビューで行を追加して保存してもCSVにパディング行（空行）が混入しないこと
    //
    // 初期状態:
    //   HEAD版: [id=1, id=2, id=3, id=4]
    //   Current版: [id=2, id=3, id=4]（id=1が削除済み）
    //   差分ビュー右ペイン: [empty（削除行パディング）, id=2, id=3, id=4]
    //
    // 操作:
    //   1. 差分ビューを開く
    //   2. 右ペインの4行目（id=4の行）の行ヘッダーを右クリック→下に行を挿入
    //   3. 挿入した行に「5」「1」「1」「1」と入力
    //   4. Ctrl+Sで保存
    //
    // 期待（RED の理由）:
    //   保存されたCSVに ",,,（パディング行）" が含まれてはならない。
    //   現行実装では削除行に対する右ペインのパディング行（emptyRow）がストアに登録されているため、
    //   そのままCSVに書き出されて ",,,\n5,1,1,1" のような出力になる。
    // -------------------------------------------------------------------------
    test(
        '差分ビューで行を追加して保存した後、CSVにパディング行（全列空の行）が含まれないこと',
        async ({ page, bug0023Page: _bug0023Page }) => {
            await openQuestRewardDiffTabAsync(page);

            const diffTab = page.locator('.diff-tab');
            const rightPane = diffTab.locator('.diff-pane-right');
            const rightTable = rightPane.locator('.editor-table');
            await expect(rightTable).toBeVisible();

            // 差分ビュー右ペインの初期行数を確認する
            // パディング行(1) + データ行(3) = 4行
            const allRightRows = rightTable.locator('.editor-table-row');
            await expect(allRightRows).toHaveCount(4);

            // 右ペインの4行目データ行（id=4の行、rowIndex=3）の行ヘッダーを右クリックして下に行を挿入する。
            // .editor-table-row-header はデータ行専用クラスのため nth(3) がデータ4行目（パディング行含む）。
            // 差分ビューではパディング行も.editor-table-row-headerを持つ。
            // データ行としては: [empty(idx=0), id=2(idx=1), id=3(idx=2), id=4(idx=3)]
            // nth(3) = id=4の行ヘッダー
            const fourthRowHeader = rightTable.locator('.editor-table-row-header').nth(3);
            await fourthRowHeader.click({ button: 'right' });

            // コンテキストメニューから「下に行を挿入」を選択する
            const contextMenu = page.locator('.context-menu.visible');
            await expect(contextMenu).toBeVisible();
            await contextMenu.locator('.context-menu-item', { hasText: '下に行を挿入' }).click();

            // 挿入後: 右ペインの行数が1増加していること（5行）
            await expect(allRightRows).toHaveCount(5);

            // 挿入した行（5行目データ行 = id=4の下）の最初のセルにデータを入力する
            // 挿入行は .editor-table-row の5番目なので nth(4)
            const insertedRow = rightTable.locator('.editor-table-row').nth(4);
            const firstCell = insertedRow.locator('.editor-table-cell:not(.editor-table-row-header)').nth(0);

            // コンテキストメニュー操作後はEditorTableHandlerのフォーカスが失われる。
            // dblclickの前に一度clickしてHandlerをアクティブ化してから編集モードに入る。
            await firstCell.click();
            await firstCell.dblclick();

            // id列に「5」を入力してTabで次のセルへ
            const editField = page.locator('.grid-textfield-active').first();
            await expect(editField).toBeVisible();
            await editField.selectText();
            await editField.type('5');
            await page.keyboard.press('Tab');

            // quest_id列: 明示的にdblclickで編集モードに入る（Tab後は自動的に編集モードにならない）
            const secondCell = insertedRow.locator('.editor-table-cell:not(.editor-table-row-header)').nth(1);
            await secondCell.dblclick();
            const editField2 = page.locator('.grid-textfield-active').first();
            await expect(editField2).toBeVisible();
            await editField2.selectText();
            await editField2.type('1');
            await page.keyboard.press('Tab');

            // master_id列: 明示的にdblclickで編集モードに入る
            const thirdCell = insertedRow.locator('.editor-table-cell:not(.editor-table-row-header)').nth(2);
            await thirdCell.dblclick();
            const editField3 = page.locator('.grid-textfield-active').first();
            await expect(editField3).toBeVisible();
            await editField3.selectText();
            await editField3.type('1');
            await page.keyboard.press('Tab');

            // count列: 明示的にdblclickで編集モードに入る
            const fourthCell = insertedRow.locator('.editor-table-cell:not(.editor-table-row-header)').nth(3);
            await fourthCell.dblclick();
            const editField4 = page.locator('.grid-textfield-active').first();
            await expect(editField4).toBeVisible();
            await editField4.selectText();
            await editField4.type('1');
            await page.keyboard.press('Enter');

            // 挿入行のセルをクリックしてフォーカスを確保してからCtrl+Sで保存する
            await firstCell.click();
            await page.keyboard.press('Control+s');

            // 保存完了を待機する。saveDiffTableDataFromStoreAsync は .then() チェーンで非同期実行されるため、
            // Ctrl+S のキーイベント完了後も保存処理は継続中の場合がある。
            // Dirtyフラグが消えるまで待機することで、保存完了後の状態でCSVを検証できる。
            const diffTabButton1 = page.locator('.tab-button', { hasText: '差分: quest_reward' });
            await expect(diffTabButton1.locator('.tab-button-dirty')).not.toHaveClass(/tab-button-dirty-visible/);

            // CSVに保存内容が反映されることを確認する。
            // パディング行（全列空 = ",,,"）が含まれず、正しいデータ行のみが出力されること。
            await expectCsvAsync(page, 'data/quest_reward.csv', `
                id, quest_id, master_id, count
                2,  1,        1,         1
                3,  1,        2,         1
                4,  2,        1,         1
                5,  1,        1,         1
            `);
        },
    );

    // -------------------------------------------------------------------------
    // テスト2: 差分ビューで行を追加してCtrl+S保存した後、差分タブのDirtyフラグが消えること
    //
    // 初期状態:
    //   差分タブを開いた初期状態（右ペインでデータ行を編集してDirtyにする前）
    //
    // 操作:
    //   1. 差分タブを開く
    //   2. 右ペインの最初のデータ行（id=2の行）のセルを編集してDirtyにする
    //   3. Ctrl+Sで保存する
    //   4. 差分タブのタブボタンにDirtyマーク（.tab-button-dirty-visible）がないことを確認する
    //
    // 期待（RED の理由）:
    //   保存後にDirtyフラグが消えなければならない。
    //   現行実装では markAllSaved("quest_reward") を呼ぶが、差分タブのHistoryは
    //   "quest_reward:diff:current" キーで登録されており、"quest_reward" キーには
    //   Historyレジストリが存在しないためエラーが発生する（またはDirtyが消えない）。
    // -------------------------------------------------------------------------
    test(
        '差分ビューでセルを編集してCtrl+S保存した後、差分タブのDirtyフラグ（●）が消えること',
        async ({ page, bug0023Page: _bug0023Page }) => {
            await openQuestRewardDiffTabAsync(page);

            const diffTab = page.locator('.diff-tab');

            // 差分タブのタブボタンを取得する
            const diffTabButton = page.locator('.tab-button', { hasText: '差分: quest_reward' });
            await expect(diffTabButton).toBeVisible();
            const dirtyIndicator = diffTabButton.locator('.tab-button-dirty');

            // 右ペインの2行目データ行（id=2の行: パディング行の次）のセルを編集する
            // .editor-table-row-header でデータ行のインデックスを数える:
            // idx=0: パディング行（削除されたid=1の対応空行）
            // idx=1: id=2の行
            const rightPane = diffTab.locator('.diff-pane-right');
            const rightTable = rightPane.locator('.editor-table');

            // id=2の行（2番目のデータ行 = パディング行を除く実際のデータ）のid列をダブルクリック
            // .editor-table-row のnth(1): nth(0)=パディング行, nth(1)=id=2行
            const idRow2 = rightTable.locator('.editor-table-row').nth(1);
            const idCell = idRow2.locator('.editor-table-cell:not(.editor-table-row-header)').nth(0);
            await idCell.dblclick();

            const editField = page.locator('.grid-textfield-active').first();
            await expect(editField).toBeVisible();
            await editField.selectText();
            await editField.type('99');
            await page.keyboard.press('Enter');

            // 編集後にDirtyマークが付いていることを確認する
            // 現行バグでは dummyTabButton が DOM未追加のため、このアサーションが失敗してREDになる可能性があるが、
            // bug-diff-tab-dirty-and-save.spec.ts でDirtyマーク表示は既に修正済みとして扱う。
            // ここでは「保存後にDirtyが消えること」を主眼とする。
            await expect(dirtyIndicator).toHaveClass(/tab-button-dirty-visible/);

            // フォーカスを右ペインに戻してからCtrl+Sで保存する
            await idCell.click();
            await page.keyboard.press('Control+s');

            // 保存後にDirtyマーク（.tab-button-dirty-visible）が消えることを確認する。
            // 現行実装では markAllSaved("quest_reward") が呼ばれるが、差分タブのHistoryは
            // "quest_reward:diff:current" キーで登録されているため "quest_reward" キーには
            // Historyが存在せずエラーまたはDirtyが消えない → このアサーションが失敗してREDになる
            await expect(dirtyIndicator).not.toHaveClass(/tab-button-dirty-visible/);
        },
    );

    // -------------------------------------------------------------------------
    // テスト3: 差分ビューで行を追加して保存した後、通常タブを開くと新しい行が表示されること
    //
    // 初期状態:
    //   差分タブを開いた初期状態
    //
    // 操作:
    //   1. 差分タブを開く
    //   2. 右ペインに行を挿入して「5,1,1,1」と入力する
    //   3. Ctrl+Sで保存する
    //   4. エクスプローラーからquest_rewardテーブルを通常タブで開く
    //   5. 通常タブのテーブルに新しい行（id=5）が表示されていることを確認する
    //
    // 期待（RED の理由）:
    //   差分タブ保存後は通常タブのストア（"quest_reward" キー）に反映されなければならない。
    //   現行実装では差分タブ保存はCSVファイルのみ更新し、通常タブのストアは更新しない。
    //   通常タブを開いても古いデータ（id=2〜4のみ）のまま新しい行（id=5）が表示されない。
    // -------------------------------------------------------------------------
    test(
        '差分ビューで行を追加して保存した後、通常タブを開くと新しい行が反映されていること',
        async ({ page, bug0023Page: _bug0023Page }) => {
            await openQuestRewardDiffTabAsync(page);

            const diffTab = page.locator('.diff-tab');
            const rightPane = diffTab.locator('.diff-pane-right');
            const rightTable = rightPane.locator('.editor-table');
            await expect(rightTable).toBeVisible();

            // 右ペインの4行目データ行（id=4、インデックス=3）の行ヘッダーを右クリックして下に行を挿入する
            const fourthRowHeader = rightTable.locator('.editor-table-row-header').nth(3);
            await fourthRowHeader.click({ button: 'right' });

            const contextMenu = page.locator('.context-menu.visible');
            await expect(contextMenu).toBeVisible();
            await contextMenu.locator('.context-menu-item', { hasText: '下に行を挿入' }).click();

            // 挿入した行に「5,1,1,1」を入力する
            // 挿入行は .editor-table-row のnth(4)
            const insertedRow = rightTable.locator('.editor-table-row').nth(4);
            const firstCell = insertedRow.locator('.editor-table-cell:not(.editor-table-row-header)').nth(0);

            // コンテキストメニュー操作後はEditorTableHandlerのフォーカスが失われる。
            // dblclickの前に一度clickしてHandlerをアクティブ化してから編集モードに入る。
            await firstCell.click();
            await firstCell.dblclick();

            const editField = page.locator('.grid-textfield-active').first();
            await expect(editField).toBeVisible();
            await editField.selectText();
            await editField.type('5');
            await page.keyboard.press('Tab');

            // quest_id列: 明示的にdblclickで編集モードに入る（Tab後は自動的に編集モードにならない）
            const secondCell = insertedRow.locator('.editor-table-cell:not(.editor-table-row-header)').nth(1);
            await secondCell.dblclick();
            const editField2 = page.locator('.grid-textfield-active').first();
            await expect(editField2).toBeVisible();
            await editField2.selectText();
            await editField2.type('1');
            await page.keyboard.press('Tab');

            // master_id列: 明示的にdblclickで編集モードに入る
            const thirdCell = insertedRow.locator('.editor-table-cell:not(.editor-table-row-header)').nth(2);
            await thirdCell.dblclick();
            const editField3 = page.locator('.grid-textfield-active').first();
            await expect(editField3).toBeVisible();
            await editField3.selectText();
            await editField3.type('1');
            await page.keyboard.press('Tab');

            // count列: 明示的にdblclickで編集モードに入る
            const fourthCell = insertedRow.locator('.editor-table-cell:not(.editor-table-row-header)').nth(3);
            await fourthCell.dblclick();
            const editField4 = page.locator('.grid-textfield-active').first();
            await expect(editField4).toBeVisible();
            await editField4.selectText();
            await editField4.type('1');
            await page.keyboard.press('Enter');

            // Ctrl+Sで保存する
            await firstCell.click();
            await page.keyboard.press('Control+s');

            // エクスプローラーからquest_rewardテーブルを通常タブで開く。
            // Ctrl+S保存後はソースコントロールパネルが表示されている状態のため、
            // アクティビティバーのEXPLORERアイコン（[data-panel="files"]）をクリックして
            // エクスプローラーパネルに切り替えてからファイルツリーを操作する。
            await page.locator('.activity-bar-item[data-panel="files"]').click();
            const explorer = page.locator('#explorer');
            await explorer.locator('.explorer-file', { hasText: 'quest_reward' }).click();

            // 通常タブのEditorTableが表示されるまで待機する
            const normalTable = page.locator(
                `.editor-left-pane .tab-wrapper[data-tab-name="quest_reward"] .editor-table`
            );
            await expect(normalTable).toBeVisible();

            // 通常タブにid=5の新しい行が含まれていることを確認する。
            // バッファ空行（editor-table-empty-row）を除外してデータ行のみカウントする。
            // 現行実装では差分タブ保存後にストアが更新されないため、
            // 通常タブは再ロード時にCSVから再読み込みするか、古いストアデータを使うかに依存する。
            // 「通常タブのストアが更新されないため古いデータのまま」なので、
            // id=5の行がテーブルに表示されないことでREDになる。
            const dataRows = normalTable.locator('.editor-table-row:not(.editor-table-empty-row)');
            // データ行(4: id=2,3,4,5)
            await expect(dataRows).toHaveCount(4);

            // 最後のデータ行（id=5）の内容を確認する（4行目データ行: nth(3)）
            const lastDataRow = normalTable.locator('.editor-table-row:not(.editor-table-empty-row)').nth(3);
            const lastDataFirstCell = lastDataRow.locator('.editor-table-cell:not(.editor-table-row-header)').nth(0);
            await expect(lastDataFirstCell).toHaveText('5');
        },
    );

});
