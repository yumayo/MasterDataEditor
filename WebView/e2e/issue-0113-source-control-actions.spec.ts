import { test as base, expect } from './fixtures/test';
import { MockFileSystem, installMockApiAsync } from './fixtures/mock-api';

// =============================================================================
// ISSUE_0113: ソース管理パネルにステージング・変更取消ボタンを追加する
//
// changesセクション: 「+」ボタン（git add）、「戻る矢印」ボタン（git discard）
// stagedセクション: 「-」ボタン（git reset）のみ
// =============================================================================

// テスト共通データ ----------------------------------------------------------------

const TEST_SCHEMA = JSON.stringify({
    header: [
        { key: 0, name: "id", type: "int" },
        { key: 1, name: "name", type: "string" },
        { key: 2, name: "value", type: "int" },
    ],
    primary_key: ["id"],
});

const CURRENT_CSV = [
    "id,name,value",
    "1,item_a,150",
    "2,item_b,200",
].join("\n");

const HEAD_CSV = [
    "id,name,value",
    "1,item_a,100",
    "2,item_b,200",
].join("\n");

/**
 * changesとstagedの両方にエントリがある状態のgit status
 * alpha はchanges、beta はstaged
 */
const GIT_STATUS_BOTH = {
    changes: [{ path: "data/alpha.csv", tableName: "alpha", isNew: false }],
    staged: [{ path: "data/beta.csv", tableName: "beta", isNew: false }],
};

const HEAD_FILES: Record<string, string> = {
    "data/alpha.csv": HEAD_CSV,
    "data/beta.csv": HEAD_CSV,
};

function createTestFileSystem(): MockFileSystem {
    return {
        "schema/alpha.json": TEST_SCHEMA,
        "data/alpha.csv": CURRENT_CSV,
        "schema/beta.json": TEST_SCHEMA,
        "data/beta.csv": CURRENT_CSV,
    };
}

// フィクスチャ -------------------------------------------------------------------

interface Fixtures {
    /** changesとstagedの両方にエントリがあるページ */
    actionsPage: void;
}

const test = base.extend<Fixtures>({
    actionsPage: async ({ page }, use) => {
        await page.addInitScript((args: {
            status: typeof GIT_STATUS_BOTH;
            headFiles: Record<string, string>;
        }) => {
            (window as unknown as { __mockGitStatus: object }).__mockGitStatus = args.status;
            (window as unknown as { __mockGitHeadFiles: Record<string, string> }).__mockGitHeadFiles = args.headFiles;
        }, { status: GIT_STATUS_BOTH, headFiles: HEAD_FILES });

        await installMockApiAsync(page, createTestFileSystem());
        await page.goto('/');
        await use();
    },
});

/**
 * ソース管理パネルを開くヘルパー
 */
async function openSourceControlPanel(page: import('@playwright/test').Page): Promise<import('@playwright/test').Locator> {
    const btn = page.locator('[data-panel="sourceControl"]');
    await btn.click();
    const panel = page.locator('.source-control-panel');
    await expect(panel).toBeVisible();
    return panel;
}

// テスト本体 -------------------------------------------------------------------

test.describe('ソース管理パネル — ステージング・変更取消ボタン', () => {

    // テスト1: changesセクションのファイル行に「+」「戻る矢印」ボタンが表示される
    test('changesセクションのファイル行にstageボタンとdiscardボタンが表示されること', async ({ page, actionsPage: _ }) => {
        const panel = await openSourceControlPanel(page);
        const changesSection = panel.locator('.source-control-changes-section');
        const fileItem = changesSection.locator('.source-control-file-item').first();
        // ホバーしてボタンを表示する
        await fileItem.hover();
        const stageBtn = fileItem.locator('.source-control-action-btn[data-action="stage"]');
        const discardBtn = fileItem.locator('.source-control-action-btn[data-action="discard"]');
        await expect(stageBtn).toBeVisible();
        await expect(discardBtn).toBeVisible();
    });

    // テスト2: stagedセクションのファイル行に「-」ボタンのみ表示される（discardボタンなし）
    test('stagedセクションのファイル行にunstageボタンのみ表示されdiscardボタンは存在しないこと', async ({ page, actionsPage: _ }) => {
        const panel = await openSourceControlPanel(page);
        const stagedSection = panel.locator('.source-control-staged-section');
        const fileItem = stagedSection.locator('.source-control-file-item').first();
        // ホバーしてボタンを表示する
        await fileItem.hover();
        const unstageBtn = fileItem.locator('.source-control-action-btn[data-action="unstage"]');
        const discardBtn = fileItem.locator('.source-control-action-btn[data-action="discard"]');
        await expect(unstageBtn).toBeVisible();
        await expect(discardBtn).toHaveCount(0);
    });

    // テスト3: 「+」ボタンクリックでファイルがchangesからstagedに移動する
    test('stageボタンクリックでファイルがchangesからstagedに移動すること', async ({ page, actionsPage: _ }) => {
        const panel = await openSourceControlPanel(page);
        const changesSection = panel.locator('.source-control-changes-section');
        const stagedSection = panel.locator('.source-control-staged-section');

        // 初期状態: changes=1件、staged=1件
        await expect(changesSection.locator('.source-control-file-item')).toHaveCount(1);
        await expect(stagedSection.locator('.source-control-file-item')).toHaveCount(1);

        // changesのファイルにホバーして「+」ボタンをクリック
        const fileItem = changesSection.locator('.source-control-file-item').first();
        await fileItem.hover();
        const stageBtn = fileItem.locator('.source-control-action-btn[data-action="stage"]');
        await stageBtn.click();

        // refreshAsync後: changes=0件、staged=2件
        await expect(changesSection.locator('.source-control-file-item')).toHaveCount(0);
        await expect(stagedSection.locator('.source-control-file-item')).toHaveCount(2);
    });

    // テスト4: 「-」ボタンクリックでファイルがstagedからchangesに戻る
    test('unstageボタンクリックでファイルがstagedからchangesに戻ること', async ({ page, actionsPage: _ }) => {
        const panel = await openSourceControlPanel(page);
        const changesSection = panel.locator('.source-control-changes-section');
        const stagedSection = panel.locator('.source-control-staged-section');

        // 初期状態: changes=1件、staged=1件
        await expect(changesSection.locator('.source-control-file-item')).toHaveCount(1);
        await expect(stagedSection.locator('.source-control-file-item')).toHaveCount(1);

        // stagedのファイルにホバーして「-」ボタンをクリック
        const fileItem = stagedSection.locator('.source-control-file-item').first();
        await fileItem.hover();
        const unstageBtn = fileItem.locator('.source-control-action-btn[data-action="unstage"]');
        await unstageBtn.click();

        // refreshAsync後: changes=2件、staged=0件
        await expect(changesSection.locator('.source-control-file-item')).toHaveCount(2);
        await expect(stagedSection.locator('.source-control-file-item')).toHaveCount(0);
    });

    // テスト5: changesの「戻る矢印」クリックで確認ダイアログ承認後にファイルがchangesから消える（変更破棄）
    test('changesのdiscardボタンクリックで確認ダイアログ承認後にファイルがchangesから消えること', async ({ page, actionsPage: _ }) => {
        const panel = await openSourceControlPanel(page);
        const changesSection = panel.locator('.source-control-changes-section');
        const stagedSection = panel.locator('.source-control-staged-section');

        // 初期状態: changes=1件、staged=1件
        await expect(changesSection.locator('.source-control-file-item')).toHaveCount(1);
        await expect(stagedSection.locator('.source-control-file-item')).toHaveCount(1);

        // window.confirm を自動承認するリスナーを登録する
        page.on('dialog', dialog => dialog.accept());

        // changesのファイルにホバーして「戻る矢印」ボタンをクリック
        const fileItem = changesSection.locator('.source-control-file-item').first();
        await fileItem.hover();
        const discardBtn = fileItem.locator('.source-control-action-btn[data-action="discard"]');
        await discardBtn.click();

        // refreshAsync後: changes=0件（破棄された）、staged=1件（変更なし）
        await expect(changesSection.locator('.source-control-file-item')).toHaveCount(0);
        await expect(stagedSection.locator('.source-control-file-item')).toHaveCount(1);
    });
});
