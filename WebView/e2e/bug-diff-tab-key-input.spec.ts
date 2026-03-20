import { test as base, expect } from './fixtures/test';
import { MockFileSystem, installMockApiAsync } from './fixtures/mock-api';
import { getDataCell } from './fixtures/test-utils';

// =============================================================================
// 差分タブの左右ペインEditorTableでのキー入力・排他制御の検証
//
// 修正内容:
//   editor-table.ts の mousedown ハンドラで DiffTab.activateHandler() を呼ぶことで
//   左右ペイン間の排他制御を実現した。
//
//   ```typescript
//   // 修正後
//   if (table.relationsPanel !== false) {
//       table.relationsPanel.activateHandler(table);
//   } else if (table.diffTab !== false) {
//       table.diffTab.activateHandler(table);   // 左右ペイン間の排他制御
//   } else {
//       table.handler.activate();
//   }
//   ```
//
// 検証シナリオ:
//   1. 右ペインをクリック後キー入力でテキストフィールドが表示される
//   2. 右ペインに行挿入後、挿入行でキー入力できる
//   3. 右ペインをシングルクリック後 Enter でセル移動できる
//   4. 左ペインをクリック後に右ペインをクリック → キー入力が右ペインに作用する
//   5. 左ペインは readOnly のためクリックしてもテキストフィールドが表示されない
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
    "4,reward_d",
].join("\n");

// HEAD版CSV（変更前）
const HEAD_QUEST_REWARD_CSV = [
    "id,name",
    "1,reward_a",
    "2,reward_b",
    "3,reward_c",
    "4,reward_d",
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

function createDiffTabKeyInputFileSystem(): MockFileSystem {
    return {
        "schema/quest_reward.json": QUEST_REWARD_SCHEMA,
        "data/quest_reward.csv": CURRENT_QUEST_REWARD_CSV,
    };
}

// フィクスチャ型定義
interface DiffTabKeyInputFixtures {
    /** git差分状態をセットアップした状態でページを開く */
    diffTabKeyInputPage: void;
}

/**
 * 差分タブキー入力バグ検証テスト用フィクスチャ
 * addInitScript は goto より前に実行する必要があるため、
 * installMockApiAsync より前に __mockGitStatus / __mockGitHeadFiles を設定する
 */
const test = base.extend<DiffTabKeyInputFixtures>({
    diffTabKeyInputPage: async ({ page }, use) => {
        await page.addInitScript((args: {
            status: { changes: { path: string; tableName: string; isNew: boolean }[]; staged: { path: string; tableName: string; isNew: boolean }[] };
            headFiles: Record<string, string>;
        }) => {
            (window as unknown as { __mockGitStatus: object }).__mockGitStatus = args.status;
            (window as unknown as { __mockGitHeadFiles: Record<string, string> }).__mockGitHeadFiles = args.headFiles;
        }, { status: GIT_STATUS, headFiles: HEAD_FILES });

        await installMockApiAsync(page, createDiffTabKeyInputFileSystem());
        await page.goto('/');
        await use();
    },
});

// テスト本体 -------------------------------------------------------------------

test.describe('差分タブの右ペインEditorTableでのキー入力', () => {

    // -------------------------------------------------------------------------
    // テスト1: 差分タブの右ペインEditorTableでセルをクリック後、キー入力でテキストフィールドが表示される
    // -------------------------------------------------------------------------
    test(
        '差分タブの右ペインEditorTableでセルをクリックしてキー入力するとテキストフィールドが表示されること',
        async ({ page, diffTabKeyInputPage: _diffTabKeyInputPage }) => {
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

            // 右ペインの1行目1列目（rowIndex=0, colIndex=0）をクリックする
            // mousedown で diffTab.activateHandler(table) が呼ばれ handler.active = true になる
            const rightTable = rightPane.locator('.editor-table');
            const targetCell = getDataCell(rightTable, 0, 0);
            await targetCell.click();

            // キー入力する（'a' キーを押してテキストフィールドが開くことを確認する）
            // active=true のため onKeydown がテキストフィールドを表示する
            await page.keyboard.press('a');

            // テキストフィールドが表示されることを確認する
            await expect(page.locator('.grid-textfield-active')).toBeVisible();
        },
    );

    // -------------------------------------------------------------------------
    // テスト2: 差分タブの右ペインEditorTableで行挿入後、挿入行のセルをクリックしてキー入力できること
    // -------------------------------------------------------------------------
    test(
        '差分タブの右ペインEditorTableで行挿入後、挿入した行のセルをクリックしてキー入力するとテキストフィールドが表示されること',
        async ({ page, diffTabKeyInputPage: _diffTabKeyInputPage }) => {
            // ソースコントロールパネルを開く
            await page.locator('[data-panel="sourceControl"]').click();

            // CHANGES セクションの quest_reward テーブルをクリックして差分タブを開く
            await page.locator('.source-control-changes-section').getByText('quest_reward').click();

            // 差分タブが開いていることを確認する
            const diffTab = page.locator('.diff-tab');
            await expect(diffTab).toBeVisible();

            // 右ペインのEditorTableが表示されることを確認する
            const rightPane = diffTab.locator('.diff-pane-right');
            await expect(rightPane.locator('.editor-table')).toBeVisible();

            // 右ペインEditorTableの4行目（rowIndex=3）の行ヘッダーを右クリックする
            // （変更シナリオ: 4行目を右クリック→下に行を挿入）
            const rightTable = rightPane.locator('.editor-table');
            const rowHeader = rightTable.locator('.editor-table-row-header').nth(3);
            await rowHeader.click({ button: 'right' });

            // コンテキストメニューから「下に行を挿入」をクリックする
            const contextMenu = page.locator('.context-menu.visible');
            await expect(contextMenu).toBeVisible();
            await contextMenu.locator('.context-menu-item', { hasText: '下に行を挿入' }).click();

            // 挿入した行（5行目 = rowIndex=4）の1列目セルをクリックする
            const insertedCell = getDataCell(rightTable, 4, 0);
            await insertedCell.click();

            // キー入力する（'5' キーを押してテキストフィールドが開くことを確認する）
            // 行挿入後も diffTab.activateHandler() により active=true が維持される
            await page.keyboard.press('5');

            // テキストフィールドが表示されることを確認する
            await expect(page.locator('.grid-textfield-active')).toBeVisible();
        },
    );

    // -------------------------------------------------------------------------
    // テスト3: シングルクリック後に Enter キーでセルが下に移動すること
    //          Enter キーは editor-table-handler.ts でセル下移動（moveCellDownWithinSelection）に
    //          割り当てられているため、テキストフィールドは表示されず rowIndex=2 のセルに移動する。
    // -------------------------------------------------------------------------
    test(
        '差分タブの右ペインEditorTableでシングルクリックした後にEnterキーでセル移動できること',
        async ({ page, diffTabKeyInputPage: _diffTabKeyInputPage }) => {
            // ソースコントロールパネルを開く
            await page.locator('[data-panel="sourceControl"]').click();

            // CHANGES セクションの quest_reward テーブルをクリックして差分タブを開く
            await page.locator('.source-control-changes-section').getByText('quest_reward').click();

            // 差分タブが開いていることを確認する
            const diffTab = page.locator('.diff-tab');
            await expect(diffTab).toBeVisible();

            // 右ペインのEditorTableが表示されることを確認する
            const rightPane = diffTab.locator('.diff-pane-right');
            await expect(rightPane.locator('.editor-table')).toBeVisible();

            // 右ペインの2行目1列目（rowIndex=1, colIndex=0）をシングルクリックする
            const rightTable = rightPane.locator('.editor-table');
            const targetCell = getDataCell(rightTable, 1, 0);
            await targetCell.click();

            // Enter キーを押す → moveCellDownWithinSelection により rowIndex=2 のセルに移動する
            await page.keyboard.press('Enter');

            // rowIndex=2 の行ヘッダーに selected クラスが付いていることを確認する
            // editor-table-row は nth(0)=ヘッダー行、nth(1)=rowIndex=0、nth(2)=rowIndex=1、nth(3)=rowIndex=2
            const movedRowHeader = rightTable.locator('.editor-table-row').nth(3).locator('.editor-table-row-header');
            await expect(movedRowHeader).toHaveClass(/selected/);
        },
    );

    // -------------------------------------------------------------------------
    // テスト4: 左ペインをクリック後に右ペインをクリック → キー入力が右テーブルのみに作用すること
    //          DiffTab.activateHandler() の排他制御検証。
    //          左→右の順でクリックすると左の handler.active が false になり、
    //          右の handler.active が true になるため、キー入力は右ペインに作用する。
    // -------------------------------------------------------------------------
    test(
        '左ペインをクリック後に右ペインをクリックするとキー入力が右ペインのみに作用すること',
        async ({ page, diffTabKeyInputPage: _diffTabKeyInputPage }) => {
            // ソースコントロールパネルを開く
            await page.locator('[data-panel="sourceControl"]').click();

            // CHANGES セクションの quest_reward テーブルをクリックして差分タブを開く
            await page.locator('.source-control-changes-section').getByText('quest_reward').click();

            // 差分タブが開いていることを確認する
            const diffTab = page.locator('.diff-tab');
            await expect(diffTab).toBeVisible();

            const leftPane = diffTab.locator('.diff-pane-left');
            const rightPane = diffTab.locator('.diff-pane-right');
            await expect(leftPane.locator('.editor-table')).toBeVisible();
            await expect(rightPane.locator('.editor-table')).toBeVisible();

            // まず左ペイン1行目1列目をクリックする（左が active になる）
            const leftTable = leftPane.locator('.editor-table');
            await getDataCell(leftTable, 0, 0).click();

            // 次に右ペイン1行目1列目をクリックする（右が active になり左は deactivate される）
            const rightTable = rightPane.locator('.editor-table');
            await getDataCell(rightTable, 0, 0).click();

            // 'b' キーを押す → 右ペインのテキストフィールドが表示されることを確認する
            await page.keyboard.press('b');
            await expect(page.locator('.grid-textfield-active')).toBeVisible();

            // テキストフィールドが右ペイン内に存在することを確認する（左ペインには表示されない）
            await expect(rightPane.locator('.grid-textfield-active')).toBeVisible();
            await expect(leftPane.locator('.grid-textfield-active')).toHaveCount(0);
        },
    );

    // -------------------------------------------------------------------------
    // テスト5: 左ペイン（readOnly）ではセルをクリックしてもテキストフィールドが表示されないこと
    //          左ペインは makeReadOnly() が呼ばれているため、キー入力でも編集UIは表示されない。
    // -------------------------------------------------------------------------
    test(
        '左ペイン（readOnly）ではセルをクリックしてキー入力しても編集UIが表示されないこと',
        async ({ page, diffTabKeyInputPage: _diffTabKeyInputPage }) => {
            // ソースコントロールパネルを開く
            await page.locator('[data-panel="sourceControl"]').click();

            // CHANGES セクションの quest_reward テーブルをクリックして差分タブを開く
            await page.locator('.source-control-changes-section').getByText('quest_reward').click();

            // 差分タブが開いていることを確認する
            const diffTab = page.locator('.diff-tab');
            await expect(diffTab).toBeVisible();

            const leftPane = diffTab.locator('.diff-pane-left');
            await expect(leftPane.locator('.editor-table')).toBeVisible();

            // 左ペイン1行目1列目をクリックする
            const leftTable = leftPane.locator('.editor-table');
            await getDataCell(leftTable, 0, 0).click();

            // 'c' キーを押す → 左ペインは readOnly のためテキストフィールドは表示されない
            await page.keyboard.press('c');
            await expect(page.locator('.grid-textfield-active')).toHaveCount(0);
        },
    );

});
