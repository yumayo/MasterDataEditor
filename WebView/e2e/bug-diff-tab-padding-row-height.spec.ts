import { test as base, expect } from './fixtures/test';
import { MockFileSystem, installMockApiAsync } from './fixtures/mock-api';
import { Page, Locator } from '@playwright/test';

// =============================================================================
// 差分ビューの右ペインで行挿入したときに左ペインのパディング行の高さが0になる不具合の検証
//
// 不具合の根本原因:
//   diff-tab.ts の notifyRightPaneRowInserted() メソッドが左ペインのパディング行を
//   独自にDOM手書きしており、EditorTable.applyCellHeight() を呼んでいない。
//   そのため、セルに height/minHeight/maxHeight が設定されず高さが0になる。
//
//   通常の行生成は EditorTable.createCell() → applyCellHeight() を経由して
//   height: 20px が付与される。パディング行だけこの共通経路を使っていない。
//
// 再現手順:
//   1. quest_reward テーブルを開く（エクスプローラーから）
//   2. 1行目を削除して Ctrl+S で保存する
//   3. gitアイコンをクリックしてソースコントロールパネルを開く
//   4. quest_reward の差分タブを開く
//   5. 右ペインで行ヘッダー2〜4をドラッグして3行選択する
//   6. コンテキストメニューから「下に3行を挿入」を選択する
//   7. 左ペインの5行目（パディング行）のセルの高さを検証する
//   8. 左右ペインの行数が一致していることを検証する
//
// なぜ失敗するか（RED の理由）:
//   notifyRightPaneRowInserted() で生成するパディング行のセルに
//   applyCellHeight() が呼ばれていないため、セルの高さが 0px になる。
//   通常のデータセルは height: 20px が設定されているが、パディング行は height が未設定。
// =============================================================================

// テスト用スキーマ（quest_reward: id, name の2列テーブル）
const QUEST_REWARD_SCHEMA = JSON.stringify({
    header: [
        { key: 0, name: "id", type: "int" },
        { key: 1, name: "name", type: "string" },
    ],
    primary_key: ["id"],
});

// HEAD版CSV（変更前）— id=1〜4 の全行が存在する
// テストシナリオでは「1行目を削除してCtrl+S保存」の結果として id=1 が消えた状態を表す
const HEAD_QUEST_REWARD_CSV = [
    "id,name",
    "1,reward_a",
    "2,reward_b",
    "3,reward_c",
    "4,reward_d",
].join("\n");

// 現在版CSV（working tree）— id=1 を削除した状態
// 「1行目を削除してCtrl+S保存」後の状態をモックで再現する
const CURRENT_QUEST_REWARD_CSV = [
    "id,name",
    "2,reward_b",
    "3,reward_c",
    "4,reward_d",
].join("\n");

// git status レスポンス（quest_reward が changes 状態）
// ページ読み込み時から差分状態を設定しておく（モックAPIの制約によりページロード前に設定が必要）
const GIT_STATUS = {
    changes: [{ path: "data/quest_reward.csv", tableName: "quest_reward", isNew: false }],
    staged: [] as { path: string; tableName: string; isNew: boolean }[],
};

// HEAD版ファイルマップ
const HEAD_FILES: Record<string, string> = {
    "data/quest_reward.csv": HEAD_QUEST_REWARD_CSV,
};

function createPaddingRowHeightFileSystem(): MockFileSystem {
    return {
        "schema/quest_reward.json": QUEST_REWARD_SCHEMA,
        "data/quest_reward.csv": CURRENT_QUEST_REWARD_CSV,
    };
}

// フィクスチャ型定義
interface PaddingRowHeightFixtures {
    /** git差分状態をセットアップした状態でページを開くフィクスチャ */
    paddingRowHeightPage: void;
}

/**
 * 差分タブパディング行高さバグ検証テスト用フィクスチャ
 * addInitScript は goto より前に実行する必要があるため、
 * installMockApiAsync より前に __mockGitStatus / __mockGitHeadFiles を設定する
 */
const test = base.extend<PaddingRowHeightFixtures>({
    paddingRowHeightPage: async ({ page }, use) => {
        await page.addInitScript((args: {
            status: { changes: { path: string; tableName: string; isNew: boolean }[]; staged: { path: string; tableName: string; isNew: boolean }[] };
            headFiles: Record<string, string>;
        }) => {
            (window as unknown as { __mockGitStatus: object }).__mockGitStatus = args.status;
            (window as unknown as { __mockGitHeadFiles: Record<string, string> }).__mockGitHeadFiles = args.headFiles;
        }, { status: GIT_STATUS, headFiles: HEAD_FILES });

        await installMockApiAsync(page, createPaddingRowHeightFileSystem());
        await page.goto('/');
        await use();
    },
});

/**
 * 行ヘッダーのドラッグ選択を行う
 * 開始行ヘッダーから終了行ヘッダーまで mousedown → mousemove → mouseup の操作で範囲選択する
 * @param page Playwright の Page オブジェクト
 * @param startHeader ドラッグ開始の行ヘッダー Locator
 * @param endHeader ドラッグ終了の行ヘッダー Locator
 */
async function dragSelectRowHeadersAsync(
    page: Page,
    startHeader: Locator,
    endHeader: Locator,
): Promise<void> {
    const startBox = await startHeader.boundingBox();
    const endBox = await endHeader.boundingBox();
    if (startBox === null || endBox === null) {
        throw new Error('行ヘッダーの boundingBox が取得できません');
    }
    // mousedown → mousemove → mouseup でドラッグ選択を行う
    await page.mouse.move(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(endBox.x + endBox.width / 2, endBox.y + endBox.height / 2, { steps: 5 });
    await page.mouse.up();
}

// テスト本体 -------------------------------------------------------------------

test.describe('差分ビューの右ペインで行挿入したときのパディング行高さバグ', () => {

    // -------------------------------------------------------------------------
    // テスト: 右ペインで3行選択して「下に3行を挿入」後、左ペインのパディング行の高さが適切であること
    //
    // 初期状態:
    //   - HEAD: [id=1(削除済み), id=2, id=3, id=4]
    //   - Current: [id=2, id=3, id=4]
    //   差分表示では4行構成:
    //     左: [id=1(deleted), id=2, id=3, id=4]
    //     右: [empty,         id=2, id=3, id=4]
    //
    // 操作:
    //   1. ソースコントロールを開いて quest_reward の差分タブを開く
    //   2. 右ペインの行ヘッダー2〜4（データ行 index 1〜3）をドラッグして3行選択する
    //   3. 右クリックして「下に3行を挿入」を選択する
    //
    // 期待:
    //   - 右ペインに3行追加されること（行数: ヘッダー1 + データ4 + 挿入3 = 8行）
    //   - 左ペインにも3行のパディング行（diff-row-empty）が追加されること
    //   - 左ペインの5行目（パディング行）のセルの高さが 20px 程度（1px以上）であること
    //   - 左右ペインの行数が一致していること
    //
    // なぜ失敗するか（RED の理由）:
    //   notifyRightPaneRowInserted() がパディング行のセルを手書きDOMで生成する際に
    //   EditorTable.applyCellHeight() を呼んでいない。
    //   その結果、セルの style.height が空（未設定）のまま高さが 0px〜1px 未満になる。
    //   通常のデータセルは createCell() → applyCellHeight() 経由で height: 20px が設定される。
    // -------------------------------------------------------------------------
    test(
        '右ペインで3行選択して下に3行挿入した後、左ペインのパディング行のセル高さが20px程度あり左右の行数が一致すること',
        async ({ page, paddingRowHeightPage: _paddingRowHeightPage }) => {
            // ソースコントロールパネルを開く
            await page.locator('[data-panel="sourceControl"]').click();

            // CHANGES セクションが表示されることを確認する
            const changesSection = page.locator('.source-control-changes-section');
            await expect(changesSection).toBeVisible();
            await expect(changesSection.getByText('quest_reward')).toBeVisible();

            // quest_reward の差分タブを開く
            await changesSection.getByText('quest_reward').click();

            // 差分タブが表示されることを確認する
            const diffTab = page.locator('.diff-tab-wrapper:not([style*="display: none"]) .diff-tab');
            await expect(diffTab).toBeVisible();

            // 左右ペインとそれぞれのテーブルを取得する
            const leftPane = diffTab.locator('.diff-pane-left');
            const rightPane = diffTab.locator('.diff-pane-right');
            const leftTable = leftPane.locator('.editor-table');
            const rightTable = rightPane.locator('.editor-table');

            // 左右のテーブルが表示されることを確認する
            await expect(leftTable).toBeVisible();
            await expect(rightTable).toBeVisible();

            // 初期行数を確認する
            // HEAD=4行・Current=3行の差分なので、パディング行含めて左右とも4行のデータ行が表示される
            // .editor-table-row には列ヘッダー行（nth(0)）+ データ行（nth(1)〜）が含まれる
            const initialLeftRowCount = await leftTable.locator('.editor-table-row').count();
            const initialRightRowCount = await rightTable.locator('.editor-table-row').count();
            expect(initialLeftRowCount).toBe(initialRightRowCount);

            // 右ペインの行ヘッダー2〜4（データ行 index 1〜3）をドラッグして3行選択する
            // .editor-table-row-header はデータ行専用クラス（nth(0) = データ1行目、nth(1) = データ2行目）
            // 行ヘッダー2 = nth(1)（0始まりのため）、行ヘッダー4 = nth(3)
            const startRowHeader = rightTable.locator('.editor-table-row-header').nth(1);
            const endRowHeader = rightTable.locator('.editor-table-row-header').nth(3);
            await dragSelectRowHeadersAsync(page, startRowHeader, endRowHeader);

            // 3行が選択されたことを確認する（行ヘッダーに selected クラスが付く）
            const selectedRowHeaders = rightTable.locator('.editor-table-row-header.selected');
            await expect(selectedRowHeaders).toHaveCount(3);

            // 選択した行ヘッダーを右クリックしてコンテキストメニューを表示する
            const lastSelectedHeader = rightTable.locator('.editor-table-row-header').nth(3);
            await lastSelectedHeader.click({ button: 'right' });

            // コンテキストメニューが表示されることを確認する
            const contextMenu = page.locator('.context-menu.visible');
            await expect(contextMenu).toBeVisible();

            // 「下に3行を挿入」を選択する（3行選択時のラベル）
            await contextMenu.locator('.context-menu-item', { hasText: '下に3行を挿入' }).click();

            // 右ペインに3行追加されたことを確認する
            // 初期行数 + 3行（挿入）が新しい右ペイン行数
            const afterRightRowCount = await rightTable.locator('.editor-table-row').count();
            expect(afterRightRowCount).toBe(initialRightRowCount + 3);

            // 左ペインにもパディング行が3行追加されて右ペインと行数が一致すること
            // 現行実装では notifyRightPaneRowInserted() に applyCellHeight() 呼び出しがないため、
            // パディング行のセルの高さが 0 になる（このアサーションは通るかもしれないが、次のアサーションが失敗する）
            const afterLeftRowCount = await leftTable.locator('.editor-table-row').count();
            expect(afterLeftRowCount).toBe(afterRightRowCount);

            // 左ペインの5行目（挿入されたパディング行）のセルの高さを確認する
            // DOM構造: nth(0) = 列ヘッダー行, nth(1)〜 = データ行
            // 初期データは4行なので、挿入されたパディング行は nth(5)〜nth(7) の位置に入る
            // 「5行目」= データ行の5番目 = DOM行インデックス5（列ヘッダー行 + データ4行の次）
            // ※ 右ペインのデータ4行目の「下」に挿入されるため、左ペインのパディング行は
            //   既存4行の後ろ（DOM行インデックス5〜7）に挿入される
            const paddingRow = leftTable.locator('.editor-table-row').nth(5);
            await expect(paddingRow).toBeVisible();

            // パディング行が diff-row-empty クラスを持つことを確認する
            await expect(paddingRow).toHaveClass(/diff-row-empty/);

            // パディング行内のデータセル（行ヘッダーを除く）の高さを確認する
            // 通常のデータセルは applyCellHeight() により height: 20px が設定される。
            // 現行バグではパディング行のセルに applyCellHeight() が呼ばれていないため、
            // height が空文字（未設定）のまま実際の表示高さが 0〜1px 未満になる。
            // このアサーションが失敗することで RED になる。
            const paddingDataCell = paddingRow.locator('.editor-table-cell:not(.editor-table-row-header)').first();
            await expect(paddingDataCell).toBeVisible();

            // セルの実際の高さ（getBoundingClientRect().height）が 10px 以上あることを確認する
            // 通常のセルは 20px なので 10px をしきい値として設定する（1px 未満は明らかに異常）
            // 現行バグでは height/minHeight/maxHeight が未設定のため、flex コンテナ依存で 0〜1px 未満になる
            const cellHeight = await paddingDataCell.evaluate((el) => el.getBoundingClientRect().height);
            expect(cellHeight, 'パディング行のセルの高さが 10px 以上あること（現行バグでは 1px 未満になる）')
                .toBeGreaterThanOrEqual(10);
        },
    );

});
