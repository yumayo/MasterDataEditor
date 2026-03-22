import { test as base, expect } from './fixtures/test';
import type { Page, Locator } from '@playwright/test';
import {
    MockFileSystem,
    installMockApiAsync,
} from './fixtures/mock-api';

// =============================================================================
// BUG_0107: 差分ビューでのデータ編集時にバリデーションが実行されない
//
// 根本原因:
//   diff-tab.ts の buildDiffEditorTable() で ValidationPanel が接続されていない。
//   tab.ts の createEditorTable() / createMiniEditorTable() では registerSchema +
//   connectValidationPanel が呼ばれるが、DiffTab 用の buildDiffEditorTable() では省略。
//
// テストケース:
//   1. changes状態の差分タブ右ペインで int 型列に文字列を入力すると cell-error が付与される
// =============================================================================

// テスト共通データ ----------------------------------------------------------------

/**
 * バリデーションテスト用スキーマ
 * id (int, PK), name (string), value (int) の3列テーブル
 */
const TEST_SCHEMA = JSON.stringify({
    header: [
        { key: 0, name: "id", type: "int" },
        { key: 1, name: "name", type: "string" },
        { key: 2, name: "value", type: "int" },
    ],
    primary_key: ["id"],
});

/**
 * 現在のCSV（working tree）— id=1 の value を 100→150 に変更
 */
const CURRENT_CSV = [
    "id,name,value",
    "1,item_a,150",
    "2,item_b,200",
].join("\n");

/**
 * HEAD版CSV（変更前）
 */
const HEAD_CSV = [
    "id,name,value",
    "1,item_a,100",
    "2,item_b,200",
].join("\n");

/** git status レスポンス（changes） */
const GIT_STATUS = {
    changes: [{ path: "data/test.csv", tableName: "test", isNew: false }],
    staged: [] as { path: string; tableName: string; isNew: boolean }[],
};

/** HEAD版ファイルマップ */
const HEAD_FILES: Record<string, string> = {
    "data/test.csv": HEAD_CSV,
};

/** テスト用ファイルシステム（スキーマ + 現在のCSV） */
function createFileSystem(): MockFileSystem {
    return {
        "schema/test.json": TEST_SCHEMA,
        "data/test.csv": CURRENT_CSV,
    };
}

// フィクスチャ -------------------------------------------------------------------

interface DiffValidationFixtures {
    /** gitステータスとHEADファイルをセットアップしたchanges状態のページ */
    diffValidationPage: void;
}

const test = base.extend<DiffValidationFixtures>({
    diffValidationPage: async ({ page }, use) => {
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

// =============================================================================
// テスト
// =============================================================================

test.describe('BUG_0107: 差分タブのバリデーション', () => {
    test(
        'changes状態の差分タブ右ペインで int 型列に文字列を入力すると cell-error が付与されること',
        async ({ page, diffValidationPage: _diffValidationPage }) => {
            // ソース管理パネルを開き、差分タブを表示する
            await page.locator('[data-panel="sourceControl"]').click();
            await page.locator('.source-control-changes-section').getByText('test').click();

            const diffTab = page.locator('.diff-tab');
            await expect(diffTab).toBeVisible();

            const rightPane = diffTab.locator('.diff-pane-right');
            const rightTable = rightPane.locator('.editor-table');
            await expect(rightTable).toBeVisible();

            // 右ペインの1行目（id=1）の value 列（colIndex=2）をダブルクリックして "abc" を入力する
            // ヘッダー行が nth(0) なのでデータ行は nth(1) から
            const firstDataRow = rightTable.locator('.editor-table-row').nth(1);
            // 行ヘッダーを除くデータセル: id(0), name(1), value(2)
            const valueCell = firstDataRow.locator('.editor-table-cell:not(.editor-table-row-header)').nth(2);
            await valueCell.dblclick();

            // 編集フィールドが出現することを確認する
            const editField = page.locator('.grid-textfield-active');
            await expect(editField).toBeVisible();

            // "abc" を入力して Enter で確定する
            await page.keyboard.press('Control+a');
            await page.keyboard.insertText('abc');
            await page.keyboard.press('Enter');

            // int 型列に文字列を入力したため、型不一致バリデーションエラーで cell-error が付与される
            await expect(valueCell).toHaveClass(/cell-error/);
        },
    );
});
