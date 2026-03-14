import { test as base, expect } from '@playwright/test';
import {
    MockFileSystem,
    installMockApiAsync,
} from './fixtures/mock-api';

// =============================================================================
// ソース管理（git差分表示）テスト — FEAT_0005
//
// 実装すべき機能:
//   1. アクティビティバーにgitブランチアイコンを追加する
//   2. クリックするとCHANGES/STAGEDの2セクションが表示される
//   3. テーブルをクリックすると左=変更前(HEAD)・右=変更後(working tree)が表示される
//   4. セル変更の差分: 左赤(.diff-cell-deleted)・右緑(.diff-cell-added)
//   5. 行削除: 左赤のみ（.diff-row-deleted）、右は空白行（.diff-row-empty）
//   6. 行追加: 右緑のみ（.diff-row-added）、左は空白行（.diff-row-empty）
//   7. 差分ビューは読み取り専用
//
// RED状態の理由:
//   - [data-panel="sourceControl"] アイコンボタンが存在しない
//   - .source-control-panel が存在しない
//   - 差分ビュー（.diff-view）が存在しない
//   - .diff-cell-deleted / .diff-cell-added のスタイリングが存在しない
//   - git_status_request / git_show_request のプロダクション実装が存在しない
// =============================================================================

// テスト共通データ ----------------------------------------------------------------

/**
 * 差分テスト用スキーマ
 * id, name, value の3列テーブル
 */
const TEST_SCHEMA = JSON.stringify({
    header: [
        { key: 0, name: "id", type: "int" },
        { key: 1, name: "name", type: "string" },
        { key: 2, name: "value", type: "int" },
    ],
    primary_key: "id",
});

/**
 * 現在のCSV（working tree）
 *   id=1: value が 100→150 に変更
 *   id=2: 変更なし
 *   id=3: 削除された
 *   id=4: 新規追加
 */
const CURRENT_CSV = [
    "id,name,value",
    "1,item_a,150",
    "2,item_b,200",
    "4,item_d,400",
].join("\n");

/**
 * HEAD版CSV（変更前）
 *   id=1: value=100
 *   id=2: 変更なし
 *   id=3: 存在する（削除前）
 */
const HEAD_CSV = [
    "id,name,value",
    "1,item_a,100",
    "2,item_b,200",
    "3,item_c,300",
].join("\n");

/**
 * git status レスポンス
 */
const GIT_STATUS = {
    changes: [{ path: "data/test.csv", tableName: "test" }],
    staged: [],
};

/**
 * HEAD版ファイルマップ
 */
const HEAD_FILES: Record<string, string> = {
    "data/test.csv": HEAD_CSV,
};

/**
 * テスト用ファイルシステム（スキーマ + 現在のCSV）
 */
function createSourceControlFileSystem(): MockFileSystem {
    return {
        "schema/test.json": TEST_SCHEMA,
        "data/test.csv": CURRENT_CSV,
    };
}

// フィクスチャ型定義 -----------------------------------------------------------

interface SourceControlFixtures {
    /** gitステータスとHEADファイルをセットアップした状態でページを開く */
    sourceControlPage: void;
}

/**
 * ソース管理テスト用フィクスチャ
 * addInitScript は goto より前に実行する必要があるため、
 * installMockApiAsync の前に __mockGitStatus / __mockGitHeadFiles を設定する
 */
const test = base.extend<SourceControlFixtures>({
    sourceControlPage: async ({ page }, use) => {
        // gitモックデータを window に設定する（installMockApiAsync より前に実行が必須）
        await page.addInitScript((args: {
            status: { changes: { path: string; tableName: string }[]; staged: { path: string; tableName: string }[] };
            headFiles: Record<string, string>;
        }) => {
            (window as unknown as { __mockGitStatus: object }).__mockGitStatus = args.status;
            (window as unknown as { __mockGitHeadFiles: Record<string, string> }).__mockGitHeadFiles = args.headFiles;
        }, { status: GIT_STATUS, headFiles: HEAD_FILES });

        await installMockApiAsync(page, createSourceControlFileSystem());
        await page.goto('/');
        await use();
    },
});

// テスト本体 -------------------------------------------------------------------

test.describe('ソース管理パネル', () => {

    // -------------------------------------------------------------------------
    // テスト1: アクティビティバーにソース管理アイコンが表示される
    // -------------------------------------------------------------------------
    test(
        'アクティビティバーにソース管理アイコン（[data-panel="sourceControl"]）が存在すること',
        async ({ page, sourceControlPage: _sourceControlPage }) => {
            // data-panel="sourceControl" のアイコンボタンが存在することを確認する
            // プロダクションコードに sourceControl ボタンが存在しないため失敗（RED）
            const sourceControlButton = page.locator('[data-panel="sourceControl"]');
            await expect(sourceControlButton).toBeVisible();
        },
    );

    // -------------------------------------------------------------------------
    // テスト2: ソース管理アイコンをクリックするとパネルが表示される
    // -------------------------------------------------------------------------
    test(
        'ソース管理アイコンをクリックすると .source-control-panel が表示され CHANGES・STAGED セクションが見えること',
        async ({ page, sourceControlPage: _sourceControlPage }) => {
            const sourceControlButton = page.locator('[data-panel="sourceControl"]');
            await sourceControlButton.click();

            // .source-control-panel が表示されることを確認する
            // プロダクションコードに .source-control-panel が存在しないため失敗（RED）
            const panel = page.locator('.source-control-panel');
            await expect(panel).toBeVisible();

            // CHANGES・STAGED セクションヘッダーが存在することを確認する
            await expect(panel.getByText('CHANGES')).toBeVisible();
            await expect(panel.getByText('STAGED')).toBeVisible();
        },
    );

    // -------------------------------------------------------------------------
    // テスト3: 変更のあるテーブルが CHANGES セクションに表示される
    // -------------------------------------------------------------------------
    test(
        '変更のあるテーブル名が CHANGES セクションにリスト表示されること',
        async ({ page, sourceControlPage: _sourceControlPage }) => {
            // ソース管理パネルを開く
            await page.locator('[data-panel="sourceControl"]').click();

            // CHANGES セクションにテーブル名 "test" が表示されることを確認する
            // プロダクションコードに git_status_request の処理が存在しないため失敗（RED）
            const changesSection = page.locator('.source-control-changes-section');
            await expect(changesSection).toBeVisible();
            await expect(changesSection.getByText('test')).toBeVisible();
        },
    );

    // -------------------------------------------------------------------------
    // テスト4: テーブルをクリックすると差分ビューが開く
    // -------------------------------------------------------------------------
    test(
        'CHANGESセクションのテーブル名をクリックすると差分ビュー（.diff-view）が表示されること',
        async ({ page, sourceControlPage: _sourceControlPage }) => {
            // ソース管理パネルを開く
            await page.locator('[data-panel="sourceControl"]').click();

            // CHANGES セクションのテーブル名をクリックする
            await page.locator('.source-control-changes-section').getByText('test').click();

            // 差分ビューが表示されることを確認する
            // プロダクションコードに .diff-view が存在しないため失敗（RED）
            const diffView = page.locator('.diff-view');
            await expect(diffView).toBeVisible();

            // 左ペインに「変更前」ラベルが表示されることを確認する
            await expect(diffView.locator('.diff-view-label-before')).toBeVisible();

            // 右ペインに「変更後」ラベルが表示されることを確認する
            await expect(diffView.locator('.diff-view-label-after')).toBeVisible();
        },
    );

    // -------------------------------------------------------------------------
    // テスト5: セル変更の差分表示（左赤・右緑）
    // -------------------------------------------------------------------------
    test(
        'セル値が変更された行は左ペインが赤背景（.diff-cell-deleted）・右ペインが緑背景（.diff-cell-added）になること',
        async ({ page, sourceControlPage: _sourceControlPage }) => {
            // id=1 の value が 100→150 に変更されている
            await page.locator('[data-panel="sourceControl"]').click();
            await page.locator('.source-control-changes-section').getByText('test').click();

            const diffView = page.locator('.diff-view');

            // 左ペイン（変更前）に .diff-cell-deleted クラスを持つセルが存在することを確認する
            // プロダクションコードに差分セルのスタイリングが存在しないため失敗（RED）
            const leftPane = diffView.locator('.diff-view-pane-before');
            await expect(leftPane.locator('.diff-cell-deleted').first()).toBeVisible();

            // 右ペイン（変更後）に .diff-cell-added クラスを持つセルが存在することを確認する
            const rightPane = diffView.locator('.diff-view-pane-after');
            await expect(rightPane.locator('.diff-cell-added').first()).toBeVisible();
        },
    );

    // -------------------------------------------------------------------------
    // テスト6: 行削除の差分表示（左赤のみ）
    // -------------------------------------------------------------------------
    test(
        '削除された行は左ペインに赤背景行（.diff-row-deleted）・右ペインに空白行（.diff-row-empty）が表示されること',
        async ({ page, sourceControlPage: _sourceControlPage }) => {
            // id=3 が HEAD版にのみ存在する（削除された行）
            await page.locator('[data-panel="sourceControl"]').click();
            await page.locator('.source-control-changes-section').getByText('test').click();

            const diffView = page.locator('.diff-view');
            const leftPane = diffView.locator('.diff-view-pane-before');
            const rightPane = diffView.locator('.diff-view-pane-after');

            // 左ペインに削除行（.diff-row-deleted）が存在することを確認する
            // プロダクションコードに削除行の表現が存在しないため失敗（RED）
            await expect(leftPane.locator('.diff-row-deleted').first()).toBeVisible();

            // 右ペインに対応する空白行（.diff-row-empty）が存在することを確認する
            await expect(rightPane.locator('.diff-row-empty').first()).toBeVisible();
        },
    );

    // -------------------------------------------------------------------------
    // テスト7: 行追加の差分表示（右緑のみ）
    // -------------------------------------------------------------------------
    test(
        '追加された行は右ペインに緑背景行（.diff-row-added）・左ペインに空白行（.diff-row-empty）が表示されること',
        async ({ page, sourceControlPage: _sourceControlPage }) => {
            // id=4 が現在版にのみ存在する（新規追加行）
            await page.locator('[data-panel="sourceControl"]').click();
            await page.locator('.source-control-changes-section').getByText('test').click();

            const diffView = page.locator('.diff-view');
            const leftPane = diffView.locator('.diff-view-pane-before');
            const rightPane = diffView.locator('.diff-view-pane-after');

            // 右ペインに追加行（.diff-row-added）が存在することを確認する
            // プロダクションコードに追加行の表現が存在しないため失敗（RED）
            await expect(rightPane.locator('.diff-row-added').first()).toBeVisible();

            // 左ペインに対応する空白行（.diff-row-empty）が存在することを確認する
            await expect(leftPane.locator('.diff-row-empty').first()).toBeVisible();
        },
    );

    // -------------------------------------------------------------------------
    // テスト8: 差分ビューは読み取り専用
    // -------------------------------------------------------------------------
    test(
        '差分ビューのセルをダブルクリックしても編集モードにならないこと',
        async ({ page, sourceControlPage: _sourceControlPage }) => {
            await page.locator('[data-panel="sourceControl"]').click();
            await page.locator('.source-control-changes-section').getByText('test').click();

            const diffView = page.locator('.diff-view');

            // 差分ビュー内の最初のデータセルをダブルクリックする
            // プロダクションコードに読み取り専用の制御が存在しないため失敗（RED）
            const firstCell = diffView.locator('.diff-row .diff-cell').first();
            await firstCell.dblclick();

            // 編集フィールド（テキスト入力）が出現しないことを確認する
            await expect(page.locator('.grid-textfield-active')).not.toBeVisible();
        },
    );

});
