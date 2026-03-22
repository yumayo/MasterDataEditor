import { test as base, expect } from './fixtures/test';
import {
    MockFileSystem,
    installMockApiAsync,
} from './fixtures/mock-api';
import { getDataCell } from './fixtures/test-utils';

// =============================================================================
// BUG_0108: 差分ビューを再表示しても編集内容が反映されない
//
// 根本原因: openDiffTab() で既存DiffTabがある場合に enableTabButton で
// アクティブ化するだけで早期リターンし、最新CSVデータが反映されない。
// 修正: 既存DiffTabを破棄して再作成する。
// =============================================================================

// テスト共通データ ----------------------------------------------------------------

/** 差分テスト用スキーマ（id, name, value の3列） */
const TEST_SCHEMA = JSON.stringify({
    header: [
        { key: 0, name: "id", type: "int" },
        { key: 1, name: "name", type: "string" },
        { key: 2, name: "value", type: "int" },
    ],
    primary_key: ["id"],
});

/** HEAD版CSV（変更前） */
const HEAD_CSV = [
    "id,name,value",
    "1,item_a,100",
    "2,item_b,200",
].join("\n");

/** 現在のCSV（1回目の表示用: id=1 の value が 100→150 に変更） */
const CURRENT_CSV_V1 = [
    "id,name,value",
    "1,item_a,150",
    "2,item_b,200",
].join("\n");

/** 更新後のCSV（2回目の表示用: id=1 の value が 150→250 に変更） */
const CURRENT_CSV_V2 = [
    "id,name,value",
    "1,item_a,250",
    "2,item_b,200",
].join("\n");

/** git status レスポンス（changes にのみ test テーブルが存在） */
const GIT_STATUS = {
    changes: [{ path: "data/test.csv", tableName: "test", isNew: false }],
    staged: [] as { path: string; tableName: string; isNew: boolean }[],
};

/** HEAD版ファイルマップ */
const HEAD_FILES: Record<string, string> = {
    "data/test.csv": HEAD_CSV,
};

/** テスト用ファイルシステム（スキーマ + 現在のCSV v1） */
function createFileSystem(): MockFileSystem {
    return {
        "schema/test.json": TEST_SCHEMA,
        "data/test.csv": CURRENT_CSV_V1,
    };
}

// フィクスチャ -------------------------------------------------------------------

interface DiffTabStaleDataFixtures {
    /** gitステータスとHEADファイルをセットアップした状態でページを開く */
    diffTabPage: void;
}

const test = base.extend<DiffTabStaleDataFixtures>({
    diffTabPage: async ({ page }, use) => {
        // gitモックデータを window に設定する（installMockApiAsync より前に実行が必須）
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

test.describe('BUG_0108: 差分タブの再表示で最新データが反映される', () => {

    test(
        '差分タブを2回開いた場合、2回目は最新のCSVデータで差分表示されること',
        async ({ page, diffTabPage: _diffTabPage }) => {
            // ソース管理パネルを開く
            await page.locator('[data-panel="sourceControl"]').click();

            // 1回目: CHANGESセクションのテーブル名をクリックして差分タブを開く
            await page.locator('.source-control-changes-section').getByText('test').click();

            // 差分タブが開いたことを確認する
            const diffTab = page.locator('.diff-tab');
            await expect(diffTab).toBeVisible();

            // 右ペイン（現在版）の id=1 の value セルが 150 であることを確認する
            const rightTable = diffTab.locator('.diff-pane-right .editor-table');
            // getDataCell: rowIndex=0（データ1行目=id=1）、colIndex=2（value列）
            await expect(getDataCell(rightTable, 0, 2)).toHaveText('150');

            // mock ファイルシステムの現在版CSVを v2 に書き換える
            await page.evaluate((csv) => {
                (window as unknown as { __mockFs: { [key: string]: string } }).__mockFs['data/test.csv'] = csv;
            }, CURRENT_CSV_V2);

            // 2回目: 同じテーブルをクリックして差分タブを再度開く
            await page.locator('.source-control-changes-section').getByText('test').click();

            // 差分タブが表示されていることを確認する
            await expect(diffTab).toBeVisible();

            // 右ペインの id=1 の value セルが最新値（250）に更新されていることを確認する
            const rightTable2 = diffTab.locator('.diff-pane-right .editor-table');
            await expect(getDataCell(rightTable2, 0, 2)).toHaveText('250');
        },
    );
});
