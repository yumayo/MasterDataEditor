import { test as base, expect } from './fixtures/test';
import { MockFileSystem, installMockApiAsync } from './fixtures/mock-api';
import { getDataCell } from './fixtures/test-utils';

// =============================================================================
// 差分タブで列が間に挿入された場合の diff クラス付与を検証する
//
// シナリオ:
//   HEAD版: id, name, cooldown_ms, start_at, description（5列、end_atなし）
//   Current版: id, name, cooldown_ms, start_at, end_at, description（6列、end_atが間に挿入）
//
// 期待:
//   - 左ペインのend_at列に diff-cell-new-column が付与される（HEAD版に存在しない列）
//   - 右ペインのend_at列に diff-cell-added が付与される（新データ追加）
//   - 値が変わっていない既存列（description, name等）にはdiffクラスが付与されない
// =============================================================================

// テスト用スキーマ（現在版に合わせた6列構成）
const BUFF_SCHEMA = JSON.stringify({
    header: [
        { key: 0, name: "id", type: "int" },
        { key: 1, name: "name", type: "string" },
        { key: 2, name: "cooldown_ms", type: "int" },
        { key: 3, name: "start_at", type: "datetime" },
        { key: 4, name: "end_at", type: "datetime" },
        { key: 5, name: "description", type: "string" },
    ],
    primary_key: ["id"],
});

// 現在版CSV（end_at列が間に挿入されている）
const CURRENT_BUFF_CSV = [
    "id,name,cooldown_ms,start_at,end_at,description",
    "1,攻撃力アップ,5000,2026-01-01 00:00:00,2026-03-31 23:59:59,攻撃力を50%上昇させる",
    "2,防御力アップ,3000,2026-01-15 12:00:00,2026-04-15 12:00:00,防御力を30%上昇させる",
].join("\n");

// HEAD版CSV（end_at列が存在しない）
const HEAD_BUFF_CSV = [
    "id,name,cooldown_ms,start_at,description",
    "1,攻撃力アップ,5000,2026-01-01 00:00:00,攻撃力を50%上昇させる",
    "2,防御力アップ,3000,2026-01-15 12:00:00,防御力を30%上昇させる",
].join("\n");

// git status レスポンス（buffが変更あり）
const GIT_STATUS = {
    changes: [{ path: "data/buff.csv", tableName: "buff", isNew: false }],
    staged: [] as { path: string; tableName: string; isNew: boolean }[],
};

// HEAD版ファイルマップ
const HEAD_FILES: Record<string, string> = {
    "data/buff.csv": HEAD_BUFF_CSV,
};

function createFileSystem(): MockFileSystem {
    return {
        "schema/buff.json": BUFF_SCHEMA,
        "data/buff.csv": CURRENT_BUFF_CSV,
    };
}

// フィクスチャ型定義
interface DiffTabColumnInsertionFixtures {
    /** git差分状態をセットアップした状態でページを開く */
    diffTabColumnInsertionPage: void;
}

/**
 * 列挿入差分検証テスト用フィクスチャ
 * addInitScript は goto より前に実行する必要があるため、
 * installMockApiAsync より前に __mockGitStatus / __mockGitHeadFiles を設定する
 */
const test = base.extend<DiffTabColumnInsertionFixtures>({
    diffTabColumnInsertionPage: async ({ page }, use) => {
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

test.describe('差分タブで列が間に挿入された場合のdiffクラス付与', () => {

    // -------------------------------------------------------------------------
    // テスト1: 左ペインのend_at列に diff-cell-new-column が付与されること
    //
    // HEAD版にend_at列は存在しないため、左ペインではパディング列として表示される。
    // buildDiffRows の newColumnIndices に end_at のインデックス（4）が含まれ、
    // applyDiffClasses で diff-cell-new-column（灰色）が付与される。
    // -------------------------------------------------------------------------
    test(
        '左ペインのend_at列にdiff-cell-new-columnが付与されること',
        async ({ page, diffTabColumnInsertionPage: _setup }) => {
            // ソースコントロールパネルを開く
            await page.locator('[data-panel="sourceControl"]').click();

            // CHANGESセクションの buff テーブルをクリックして差分タブを開く
            const changesSection = page.locator('.source-control-changes-section');
            await expect(changesSection.getByText('buff')).toBeVisible();
            await changesSection.getByText('buff').click();

            // 差分タブが開いていることを確認する
            const diffTab = page.locator('.diff-tab');
            await expect(diffTab).toBeVisible();

            // 左ペインのEditorTableを取得する
            const leftPane = diffTab.locator('.diff-pane-left');
            await expect(leftPane.locator('.editor-table')).toBeVisible();
            const leftTable = leftPane.locator('.editor-table');

            // データ行1（id=1）のend_at列（DOM列インデックス4）に diff-cell-new-column が付与されている
            const leftCellRow0 = getDataCell(leftTable, 0, 4);
            await expect(leftCellRow0).toHaveClass(/diff-cell-new-column/);

            // データ行2（id=2）のend_at列にも同様に付与されている
            const leftCellRow1 = getDataCell(leftTable, 1, 4);
            await expect(leftCellRow1).toHaveClass(/diff-cell-new-column/);
        },
    );

    // -------------------------------------------------------------------------
    // テスト2: 右ペインのend_at列に diff-cell-added が付与されること
    //
    // Current版に新しく追加されたend_at列は、右ペインでは新データとして
    // diff-cell-added（緑色）が付与される。
    // -------------------------------------------------------------------------
    test(
        '右ペインのend_at列にdiff-cell-addedが付与されること',
        async ({ page, diffTabColumnInsertionPage: _setup }) => {
            // ソースコントロールパネルを開く
            await page.locator('[data-panel="sourceControl"]').click();

            // CHANGESセクションの buff テーブルをクリックして差分タブを開く
            const changesSection = page.locator('.source-control-changes-section');
            await expect(changesSection.getByText('buff')).toBeVisible();
            await changesSection.getByText('buff').click();

            // 差分タブが開いていることを確認する
            const diffTab = page.locator('.diff-tab');
            await expect(diffTab).toBeVisible();

            // 右ペインのEditorTableを取得する
            const rightPane = diffTab.locator('.diff-pane-right');
            await expect(rightPane.locator('.editor-table')).toBeVisible();
            const rightTable = rightPane.locator('.editor-table');

            // データ行1（id=1）のend_at列（DOM列インデックス4）に diff-cell-added が付与されている
            const rightCellRow0 = getDataCell(rightTable, 0, 4);
            await expect(rightCellRow0).toHaveClass(/diff-cell-added/);

            // データ行2（id=2）のend_at列にも同様に付与されている
            const rightCellRow1 = getDataCell(rightTable, 1, 4);
            await expect(rightCellRow1).toHaveClass(/diff-cell-added/);
        },
    );

    // -------------------------------------------------------------------------
    // テスト3: 値が変わっていない既存列にdiffクラスが付与されないこと
    //
    // description列は列位置が4→5にシフトしたが値は変わっていないため、
    // diff-cell-added / diff-cell-deleted は付与されない。
    // name列も同様に値が変わっていないのでdiffクラスは不要。
    // -------------------------------------------------------------------------
    test(
        '値が変わっていない既存列にdiff-cell-added/diff-cell-deletedが付与されないこと',
        async ({ page, diffTabColumnInsertionPage: _setup }) => {
            // ソースコントロールパネルを開く
            await page.locator('[data-panel="sourceControl"]').click();

            // CHANGESセクションの buff テーブルをクリックして差分タブを開く
            const changesSection = page.locator('.source-control-changes-section');
            await expect(changesSection.getByText('buff')).toBeVisible();
            await changesSection.getByText('buff').click();

            // 差分タブが開いていることを確認する
            const diffTab = page.locator('.diff-tab');
            await expect(diffTab).toBeVisible();

            // 左右ペインのEditorTableを取得する
            const leftPane = diffTab.locator('.diff-pane-left');
            await expect(leftPane.locator('.editor-table')).toBeVisible();
            const leftTable = leftPane.locator('.editor-table');

            const rightPane = diffTab.locator('.diff-pane-right');
            await expect(rightPane.locator('.editor-table')).toBeVisible();
            const rightTable = rightPane.locator('.editor-table');

            // 左ペインのdescription列（DOM列インデックス5）に diff-cell-deleted がないことを確認する
            const leftDescRow0 = getDataCell(leftTable, 0, 5);
            await expect(leftDescRow0).not.toHaveClass(/diff-cell-deleted/);
            const leftDescRow1 = getDataCell(leftTable, 1, 5);
            await expect(leftDescRow1).not.toHaveClass(/diff-cell-deleted/);

            // 右ペインのdescription列（DOM列インデックス5）に diff-cell-added がないことを確認する
            const rightDescRow0 = getDataCell(rightTable, 0, 5);
            await expect(rightDescRow0).not.toHaveClass(/diff-cell-added/);
            const rightDescRow1 = getDataCell(rightTable, 1, 5);
            await expect(rightDescRow1).not.toHaveClass(/diff-cell-added/);

            // 左ペインのname列（DOM列インデックス1）に diff-cell-deleted がないことを確認する
            const leftNameRow0 = getDataCell(leftTable, 0, 1);
            await expect(leftNameRow0).not.toHaveClass(/diff-cell-deleted/);
            const leftNameRow1 = getDataCell(leftTable, 1, 1);
            await expect(leftNameRow1).not.toHaveClass(/diff-cell-deleted/);
        },
    );

});
