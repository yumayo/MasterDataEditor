import { test as base, expect } from './fixtures/test';
import type { Page, Locator } from '@playwright/test';
import {
    createDefaultFileSystem,
    installMockApiAsync,
} from './fixtures/mock-api';

// =============================================================================
// 変更履歴・監査ログ機能テスト — ISSUE_0120
//
// タイムラインパネル: アクティビティバーに履歴アイコンを追加し、
//   git log ベースのコミット履歴をサイドバーパネルとして表示する。
// blameビュー: 行ヘッダーのコンテキストメニューから git blame 情報を
//   トグル表示する。
//
// RED状態: プロダクションコードにタイムラインパネル・blameビューは未実装。
// =============================================================================

// テスト用モックデータ -----------------------------------------------------------

/** git blame のモックエントリ型 */
interface BlameEntry {
    lineNumber: number;
    author: string;
    date: string;
    commitHash: string;
    commitMessage: string;
}

/** git log のモックエントリ型 */
interface LogEntry {
    commitHash: string;
    author: string;
    date: string;
    message: string;
}

/**
 * test.csv 用 blame データ（3行分）
 * 行番号1〜3にそれぞれ異なる author/date を設定する
 */
const BLAME_DATA: Record<string, BlameEntry[]> = {
    "data/test.csv": [
        { lineNumber: 1, author: "Alice", date: "2026-03-01", commitHash: "aaa1111", commitMessage: "initial commit" },
        { lineNumber: 2, author: "Bob", date: "2026-03-15", commitHash: "bbb2222", commitMessage: "update item_b" },
        { lineNumber: 3, author: "Charlie", date: "2026-03-20", commitHash: "ccc3333", commitMessage: "add item_c" },
    ],
};

/**
 * test.csv 用 log データ（3件のコミット履歴）
 */
const LOG_DATA: Record<string, LogEntry[]> = {
    "data/test.csv": [
        { commitHash: "ccc3333", author: "Charlie", date: "2026-03-20", message: "add item_c" },
        { commitHash: "bbb2222", author: "Bob", date: "2026-03-15", message: "update item_b" },
        { commitHash: "aaa1111", author: "Alice", date: "2026-03-01", message: "initial commit" },
    ],
};

// カスタムフィクスチャ -----------------------------------------------------------

interface HistoryFixtures {
    /** git blame/log モックデータ注入済みでテーブル「test」を開いた状態 */
    historyTest: void;
}

/**
 * 変更履歴テスト用フィクスチャ
 * - createDefaultFileSystem() でベースファイルシステムを作成
 * - addInitScript で __mockGitBlame / __mockGitLog を注入
 * - installMockApiAsync → page.goto → テーブル「test」を開く
 */
const test = base.extend<HistoryFixtures>({
    historyTest: async ({ page }, use) => {
        const fs = createDefaultFileSystem();

        // git blame/log モックデータをブラウザコンテキストに注入する
        await page.addInitScript((args: {
            blameData: Record<string, BlameEntry[]>;
            logData: Record<string, LogEntry[]>;
        }) => {
            (window as unknown as { __mockGitBlame: Record<string, BlameEntry[]> }).__mockGitBlame = args.blameData;
            (window as unknown as { __mockGitLog: Record<string, LogEntry[]> }).__mockGitLog = args.logData;
        }, { blameData: BLAME_DATA, logData: LOG_DATA });

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
 * 行ヘッダーを右クリックしてコンテキストメニューを開く
 */
async function rightClickRowHeaderAsync(table: Locator, rowIndex: number): Promise<void> {
    const header = table.locator('.editor-table-row-header').nth(rowIndex);
    await header.click({ button: 'right' });
}

/**
 * コンテキストメニューの項目をクリックする
 */
async function clickContextMenuItemAsync(page: Page, label: string): Promise<void> {
    const menu = page.locator('.context-menu.visible');
    await expect(menu).toBeVisible();
    await menu.locator('.context-menu-item', { hasText: label }).click();
}

// テスト本体 -------------------------------------------------------------------

test.describe('タイムラインパネル', () => {

    // -------------------------------------------------------------------------
    // テスト1: アクティビティバーにタイムライン（履歴）アイコンが表示される
    // -------------------------------------------------------------------------
    test(
        'アクティビティバーに history アイテム（[data-panel="history"]）が表示されること',
        async ({ page, historyTest: _historyTest }) => {
            // data-panel="history" のアイコンボタンが存在することを確認する
            const historyButton = page.locator('.activity-bar-item[data-panel="history"]');
            await expect(historyButton).toBeVisible();
        },
    );

    // -------------------------------------------------------------------------
    // テスト2: タイムラインアイコンクリックでタイムラインパネルが表示される
    // -------------------------------------------------------------------------
    test(
        'history アイテムクリックで .timeline-panel が表示されること',
        async ({ page, historyTest: _historyTest }) => {
            // history アクティビティバーアイテムをクリックする
            const historyButton = page.locator('.activity-bar-item[data-panel="history"]');
            await historyButton.click();

            // .timeline-panel が表示されることを確認する
            const timelinePanel = page.locator('.timeline-panel');
            await expect(timelinePanel).toBeVisible();
        },
    );

    // -------------------------------------------------------------------------
    // テスト3: タイムラインパネルにコミット履歴が表示される
    // -------------------------------------------------------------------------
    test(
        'タイムラインパネルに .timeline-entry が3件表示され、各エントリにメッセージ・著者・日付が含まれること',
        async ({ page, historyTest: _historyTest }) => {
            // history アクティビティバーアイテムをクリックしてパネルを開く
            const historyButton = page.locator('.activity-bar-item[data-panel="history"]');
            await historyButton.click();

            const timelinePanel = page.locator('.timeline-panel');
            await expect(timelinePanel).toBeVisible();

            // .timeline-entry が3件表示されることを確認する
            const entries = timelinePanel.locator('.timeline-entry');
            await expect(entries).toHaveCount(3);

            // 各エントリにメッセージ・著者・日付の要素が含まれることを確認する
            for (let i = 0; i < 3; i++) {
                const entry = entries.nth(i);
                await expect(entry.locator('.timeline-entry-message')).toBeVisible();
                await expect(entry.locator('.timeline-entry-author')).toBeVisible();
                await expect(entry.locator('.timeline-entry-date')).toBeVisible();
            }

            // 1件目のエントリ内容を検証する（最新コミットが先頭）
            const firstEntry = entries.nth(0);
            await expect(firstEntry.locator('.timeline-entry-message')).toHaveText('add item_c');
            await expect(firstEntry.locator('.timeline-entry-author')).toHaveText('Charlie');
            await expect(firstEntry.locator('.timeline-entry-date')).toHaveText('2026-03-20');
        },
    );
});

test.describe('blameビュー', () => {

    // -------------------------------------------------------------------------
    // テスト4: コンテキストメニューから「変更履歴を表示」でblame情報がトグル表示される
    // -------------------------------------------------------------------------
    test(
        '行ヘッダー右クリックで「変更履歴を表示」が存在し、クリックすると .blame-info が表示されること',
        async ({ page, historyTest: _historyTest }) => {
            const table = page.locator('.editor-table');

            // データ行の行ヘッダー（行インデックス1: 最初のデータ行）を右クリックする
            await rightClickRowHeaderAsync(table, 1);

            // コンテキストメニューに「変更履歴を表示」が存在することを確認する
            const menu = page.locator('.context-menu.visible');
            await expect(menu).toBeVisible();
            const blameMenuItem = menu.locator('.context-menu-item', { hasText: '変更履歴を表示' });
            await expect(blameMenuItem).toBeVisible();

            // 「変更履歴を表示」をクリックする
            await blameMenuItem.click();

            // 行ヘッダーに .blame-info サブ要素が表示されることを確認する
            const rowHeader = table.locator('.editor-table-row-header').nth(1);
            const blameInfo = rowHeader.locator('.blame-info');
            await expect(blameInfo).toBeVisible();

            // .blame-info 内の構造化された author/date 要素を検証する
            await expect(blameInfo.locator('.blame-author')).toHaveText('Alice');
            await expect(blameInfo.locator('.blame-date')).toHaveText('2026-03-01');
        },
    );

    // -------------------------------------------------------------------------
    // テスト5: blameトグルを再度クリックするとblame情報が非表示になる
    // -------------------------------------------------------------------------
    test(
        '「変更履歴を非表示」クリックで .blame-info が非表示になること',
        async ({ page, historyTest: _historyTest }) => {
            const table = page.locator('.editor-table');

            // 最初に「変更履歴を表示」で blame を表示状態にする
            await rightClickRowHeaderAsync(table, 1);
            await clickContextMenuItemAsync(page, '変更履歴を表示');

            // blame-info が表示されていることを確認する
            const rowHeader = table.locator('.editor-table-row-header').nth(1);
            await expect(rowHeader.locator('.blame-info')).toBeVisible();

            // 再度行ヘッダーを右クリックしてコンテキストメニューを開く
            await rightClickRowHeaderAsync(table, 1);

            // 「変更履歴を非表示」をクリックする
            await clickContextMenuItemAsync(page, '変更履歴を非表示');

            // .blame-info が非表示になることを確認する
            await expect(rowHeader.locator('.blame-info')).not.toBeVisible();
        },
    );
});
