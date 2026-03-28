import { test as base, expect } from './fixtures/test';
import type { Page } from '@playwright/test';
import {
    createDefaultFileSystem,
    installMockApiAsync,
} from './fixtures/mock-api';

// =============================================================================
// バージョン比較機能テスト — ISSUE_0123
//
// 任意コミット間のデータバージョン比較機能を検証する。
// タブボタンの右クリックからコミット選択ダイアログを開き、
// 2つのコミットを選択して差分タブを表示する。
//
// RED状態: プロダクションコードにバージョン比較機能は未実装。
// =============================================================================

// テスト用モックデータ -----------------------------------------------------------

/** git log のモックエントリ型 */
interface LogEntry {
    commitHash: string;
    author: string;
    date: string;
    message: string;
}

/**
 * test.csv 用 log データ（3件のコミット履歴、新しい順）
 */
const LOG_DATA: Record<string, LogEntry[]> = {
    "data/test.csv": [
        { commitHash: "ccc3333", author: "Charlie", date: "2026-03-20", message: "value変更+3行目追加" },
        { commitHash: "bbb2222", author: "Bob", date: "2026-03-15", message: "2行目追加" },
        { commitHash: "aaa1111", author: "Alice", date: "2026-03-01", message: "初期コミット" },
    ],
};

/**
 * 各コミット時点でのファイル内容（commit → path → content のネストマップ）
 */
const COMMIT_FILES: Record<string, Record<string, string>> = {
    "aaa1111": {
        "data/test.csv": "id,name,value\n1,item_a,100",
    },
    "bbb2222": {
        "data/test.csv": "id,name,value\n1,item_a,100\n2,item_b,200",
    },
    "ccc3333": {
        "data/test.csv": "id,name,value\n1,item_a,150\n2,item_b,200\n3,item_c,300",
    },
};

/**
 * HEAD版ファイルマップ（ccc3333 と同じ内容）
 */
const HEAD_FILES: Record<string, string> = {
    "data/test.csv": "id,name,value\n1,item_a,150\n2,item_b,200\n3,item_c,300",
};

// カスタムフィクスチャ -----------------------------------------------------------

interface VersionCompareFixtures {
    /** git log / commit files モック注入済みでテーブル「test」を開いた状態 */
    versionCompareTest: void;
}

/**
 * バージョン比較テスト用フィクスチャ
 * - createDefaultFileSystem() でベースファイルシステムを作成
 * - addInitScript で __mockGitLog / __mockGitCommitFiles / __mockGitHeadFiles を注入
 * - installMockApiAsync -> page.goto -> テーブル「test」を開く
 */
const test = base.extend<VersionCompareFixtures>({
    versionCompareTest: async ({ page }, use) => {
        const fs = createDefaultFileSystem();

        // git log / commit files / head files モックデータをブラウザコンテキストに注入する
        await page.addInitScript((args: {
            logData: Record<string, LogEntry[]>;
            commitFiles: Record<string, Record<string, string>>;
            headFiles: Record<string, string>;
        }) => {
            (window as unknown as { __mockGitLog: Record<string, LogEntry[]> }).__mockGitLog = args.logData;
            (window as unknown as { __mockGitCommitFiles: Record<string, Record<string, string>> }).__mockGitCommitFiles = args.commitFiles;
            (window as unknown as { __mockGitHeadFiles: Record<string, string> }).__mockGitHeadFiles = args.headFiles;
        }, { logData: LOG_DATA, commitFiles: COMMIT_FILES, headFiles: HEAD_FILES });

        await installMockApiAsync(page, fs);
        await page.goto('/');

        // テーブル「test」をエクスプローラーからクリックして開く
        const explorer = page.locator('#explorer');
        await explorer.getByText('test').click();
        const table = page.locator('.editor-table');
        await expect(table).toBeVisible();

        await use();
    },
});

// ヘルパー関数 -------------------------------------------------------------------

/**
 * テーブル「test」のタブボタンを右クリックしてコンテキストメニューを表示する
 */
async function rightClickTabButtonAsync(page: Page): Promise<void> {
    const tabButton = page.locator('.tab-button').filter({ hasText: 'test' }).first();
    await expect(tabButton).toBeVisible();
    await tabButton.click({ button: 'right' });
}

/**
 * コンテキストメニューの指定項目をクリックする
 */
async function clickContextMenuItemAsync(page: Page, label: string): Promise<void> {
    const menu = page.locator('.context-menu.visible');
    await expect(menu).toBeVisible();
    await menu.locator('.context-menu-item', { hasText: label }).click();
}

/**
 * コミット選択ダイアログを開く（タブ右クリック -> 「バージョン比較...」クリック）
 */
async function openCommitSelectorDialogAsync(page: Page): Promise<void> {
    await rightClickTabButtonAsync(page);
    await clickContextMenuItemAsync(page, 'バージョン比較...');
    await expect(page.locator('.commit-selector-dialog')).toBeVisible();
}

/**
 * コミット選択ダイアログで左ペインのコミットエントリを選択する
 */
async function selectLeftCommitAsync(page: Page, commitHash: string): Promise<void> {
    const leftPane = page.locator('.commit-selector-left');
    const entry = leftPane.locator('.commit-list-entry', { hasText: commitHash });
    await entry.click();
    await expect(entry).toHaveClass(/selected/);
}

/**
 * コミット選択ダイアログで右ペインのコミットエントリを選択する
 */
async function selectRightCommitAsync(page: Page, commitHash: string): Promise<void> {
    const rightPane = page.locator('.commit-selector-right');
    const entry = rightPane.locator('.commit-list-entry', { hasText: commitHash });
    await entry.click();
    await expect(entry).toHaveClass(/selected/);
}

/**
 * 「比較」ボタンをクリックして差分タブを開く
 */
async function clickCompareButtonAsync(page: Page): Promise<void> {
    await page.locator('.commit-selector-compare-button').click();
}

/**
 * aaa1111 と ccc3333 を選択して比較タブを開く共通手順
 */
async function openCompareTabAsync(page: Page): Promise<void> {
    await openCommitSelectorDialogAsync(page);
    await selectLeftCommitAsync(page, 'aaa1111');
    await selectRightCommitAsync(page, 'ccc3333');
    await clickCompareButtonAsync(page);
}

// テスト本体 -------------------------------------------------------------------

test.describe('バージョン比較 - コミット選択ダイアログ', () => {

    // -------------------------------------------------------------------------
    // テスト1: タブボタン右クリックで「バージョン比較...」メニューが表示される
    //
    // テーブル「test」のタブボタンを右クリックすると、
    // コンテキストメニューに「バージョン比較...」項目が表示されることを検証する。
    //
    // RED理由: タブボタンの右クリックコンテキストメニューは未実装。
    // -------------------------------------------------------------------------
    test(
        'タブボタン右クリックで「バージョン比較...」メニューが表示される',
        async ({ page, versionCompareTest: _versionCompareTest }) => {
            // タブボタンを右クリックする
            await rightClickTabButtonAsync(page);

            // コンテキストメニューが表示されることを検証する
            const menu = page.locator('.context-menu.visible');
            await expect(menu).toBeVisible();

            // 「バージョン比較...」項目が存在することを検証する
            const versionCompareItem = menu.locator('.context-menu-item', { hasText: 'バージョン比較...' });
            await expect(versionCompareItem).toBeVisible();
        },
    );

    // -------------------------------------------------------------------------
    // テスト2: 「バージョン比較...」クリックでコミット選択ダイアログが表示される
    //
    // ダイアログ内に左右ペイン、コミットリスト、比較ボタンが存在することを検証する。
    //
    // RED理由: コミット選択ダイアログのUIは未実装。
    // -------------------------------------------------------------------------
    test(
        '「バージョン比較...」クリックでコミット選択ダイアログが表示される',
        async ({ page, versionCompareTest: _versionCompareTest }) => {
            // ダイアログを開く
            await rightClickTabButtonAsync(page);
            await clickContextMenuItemAsync(page, 'バージョン比較...');

            // ダイアログが表示されることを検証する
            const dialog = page.locator('.commit-selector-dialog');
            await expect(dialog).toBeVisible();

            // 左ペインと右ペインが存在することを検証する
            await expect(dialog.locator('.commit-selector-left')).toBeVisible();
            await expect(dialog.locator('.commit-selector-right')).toBeVisible();

            // 各ペインにコミットリストが存在することを検証する
            const leftList = dialog.locator('.commit-selector-left .commit-list');
            const rightList = dialog.locator('.commit-selector-right .commit-list');
            await expect(leftList).toBeVisible();
            await expect(rightList).toBeVisible();

            // コミットリストにエントリが表示されることを検証する
            // プリセット（HEAD, 作業ツリー）+ 3件のコミット = 5件ずつ
            const leftEntries = leftList.locator('.commit-list-entry');
            const rightEntries = rightList.locator('.commit-list-entry');
            await expect(leftEntries).toHaveCount(5);
            await expect(rightEntries).toHaveCount(5);

            // プリセットエントリ（HEAD, 作業ツリー）がリスト最上部に固定表示されることを検証する
            const leftPresets = leftList.locator('.commit-list-entry.preset');
            await expect(leftPresets).toHaveCount(2);

            // 各コミットエントリにハッシュとメッセージが表示されることを検証する
            const commitEntryA = leftList.locator('.commit-list-entry', { hasText: 'aaa1111' });
            await expect(commitEntryA.locator('.commit-list-entry-hash')).toHaveText('aaa1111');
            await expect(commitEntryA.locator('.commit-list-entry-message')).toHaveText('初期コミット');

            // 「比較」ボタンが存在することを検証する
            await expect(dialog.locator('.commit-selector-compare-button')).toBeVisible();

            // 「キャンセル」ボタンが存在することを検証する
            await expect(dialog.locator('.commit-selector-cancel-button')).toBeVisible();
        },
    );

    // -------------------------------------------------------------------------
    // テスト3: コミット選択ダイアログでコミットを選択して比較タブが開く
    //
    // 左ペインで aaa1111、右ペインで ccc3333（HEAD）を選択し、
    // 「比較」ボタンをクリックすると差分タブが開くことを検証する。
    //
    // RED理由: ダイアログの選択 -> 差分タブ生成のフローは未実装。
    // -------------------------------------------------------------------------
    test(
        'コミット選択ダイアログでコミットを選択して比較タブが開く',
        async ({ page, versionCompareTest: _versionCompareTest }) => {
            // ダイアログを開く
            await openCommitSelectorDialogAsync(page);

            // 左ペインで aaa1111 を選択する
            await selectLeftCommitAsync(page, 'aaa1111');

            // 右ペインで ccc3333 を選択する（HEAD と同じ内容）
            await selectRightCommitAsync(page, 'ccc3333');

            // 「比較」ボタンをクリックする
            await clickCompareButtonAsync(page);

            // ダイアログが閉じることを検証する
            await expect(page.locator('.commit-selector-dialog')).not.toBeVisible();

            // 差分タブが表示されることを検証する（左右ペインが存在する）
            await expect(page.locator('.diff-pane-left')).toBeVisible();
            await expect(page.locator('.diff-pane-right')).toBeVisible();

            // タブボタンにコミット比較情報が含まれることを検証する
            const compareTabButton = page.locator('.tab-button', { hasText: 'test' }).filter({ hasText: 'aaa1111' });
            await expect(compareTabButton).toBeVisible();
            // タブ名の形式: "test (aaa1111 <-> HEAD)" のようなテキスト
            await expect(compareTabButton).toContainText('aaa1111');
        },
    );
});

test.describe('バージョン比較 - 差分表示', () => {

    // -------------------------------------------------------------------------
    // テスト4: 比較元と比較先のデータ差分が正しく表示される
    //
    // aaa1111（1行）と ccc3333（3行）を比較し、
    // 追加行と値の変更がハイライトされることを検証する。
    //
    // aaa1111: id,name,value / 1,item_a,100
    // ccc3333: id,name,value / 1,item_a,150 / 2,item_b,200 / 3,item_c,300
    //
    // 差分:
    //   - value列の 100 -> 150 の変更（ハイライト）
    //   - 2行目（item_b）と3行目（item_c）の追加
    //
    // RED理由: バージョン比較の差分表示は未実装。
    // -------------------------------------------------------------------------
    test(
        '比較元と比較先のデータ差分が正しく表示される',
        async ({ page, versionCompareTest: _versionCompareTest }) => {
            // aaa1111 と ccc3333 を選択して比較タブを開く
            await openCompareTabAsync(page);

            // 差分タブが表示されていることを検証する
            const diffTab = page.locator('.diff-tab');
            await expect(diffTab).toBeVisible();

            const leftPane = diffTab.locator('.diff-pane-left');
            const rightPane = diffTab.locator('.diff-pane-right');

            // 左ペイン（aaa1111）にはヘッダー + データ1行が表示されること
            // 行ヘッダー列を除くデータセルで検証する
            const leftDataRows = leftPane.locator('.editor-table-row:not(.diff-row-empty)');
            // ヘッダー行(1) + データ行(1) = 2行
            await expect(leftDataRows).toHaveCount(2);

            // 右ペイン（ccc3333）にはヘッダー + データ3行が表示されること
            const rightDataRows = rightPane.locator('.editor-table-row:not(.diff-row-empty)');
            // ヘッダー行(1) + データ行(3) = 4行
            await expect(rightDataRows).toHaveCount(4);

            // 右ペインに追加行（.diff-cell-added）が存在することを検証する
            // item_b と item_c の行が追加されている
            const addedCells = rightPane.locator('.diff-cell-added');
            await expect(addedCells.first()).toBeVisible();

            // 値の変更がハイライトされていることを検証する
            // aaa1111: value=100 -> ccc3333: value=150
            // 左ペインの削除セル（旧値 100）
            const deletedValueCells = leftPane.locator('.diff-cell-deleted');
            await expect(deletedValueCells.first()).toBeVisible();
        },
    );

    // -------------------------------------------------------------------------
    // テスト5: 比較タブのペインラベルにコミット情報が表示される
    //
    // 左ペインラベルに aaa1111 のハッシュ、
    // 右ペインラベルに ccc3333 のハッシュ（またはHEAD表記）が含まれることを検証する。
    //
    // RED理由: ペインラベルのUI要素は未実装。
    // -------------------------------------------------------------------------
    test(
        '比較タブのペインラベルにコミット情報が表示される',
        async ({ page, versionCompareTest: _versionCompareTest }) => {
            // aaa1111 と ccc3333 を選択して比較タブを開く
            await openCompareTabAsync(page);

            // 左ペインラベルに aaa1111 のハッシュが含まれることを検証する
            const leftLabel = page.locator('.diff-pane-label-left');
            await expect(leftLabel).toBeVisible();
            await expect(leftLabel).toContainText('aaa1111');

            // 右ペインラベルに ccc3333 のハッシュ（またはHEAD表記）が含まれることを検証する
            const rightLabel = page.locator('.diff-pane-label-right');
            await expect(rightLabel).toBeVisible();
            // ccc3333 は HEAD と同じ内容なので "ccc3333" または "HEAD" のいずれかが表示される
            const rightLabelText = await rightLabel.textContent();
            const containsCommitInfo = rightLabelText !== null && (rightLabelText.includes('ccc3333') || rightLabelText.includes('HEAD'));
            expect(containsCommitInfo, `右ペインラベルに ccc3333 または HEAD が含まれること（実際: "${rightLabelText}"）`).toBe(true);
        },
    );
});
