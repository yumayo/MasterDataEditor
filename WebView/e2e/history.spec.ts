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
        // lineNumber はCSVファイルの1始まり行番号（行1=ヘッダー、行2〜=データ行）
        { lineNumber: 2, author: "Alice", date: "2026-03-01", commitHash: "aaa1111", commitMessage: "initial commit" },
        { lineNumber: 3, author: "Bob", date: "2026-03-15", commitHash: "bbb2222", commitMessage: "update item_b" },
        { lineNumber: 4, author: "Charlie", date: "2026-03-20", commitHash: "ccc3333", commitMessage: "add item_c" },
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
    "data/other.csv": [
        { commitHash: "fff6666", author: "Frank", date: "2026-04-02", message: "rebalance other table" },
        { commitHash: "eee5555", author: "Eve", date: "2026-03-28", message: "add other row" },
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
        fs["schema/other.json"] = JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                { key: 2, name: "value", type: "int" },
            ],
            primary_key: ["id"],
        });
        fs["data/other.csv"] = [
            "id,name,value",
            "10,other_a,500",
            "20,other_b,800",
        ].join("\n");

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

    test(
        'history パネル表示中に通常テーブルタブを切り替えると、そのタブのコミット履歴に更新されること',
        async ({ page, historyTest: _historyTest }) => {
            const explorer = page.locator('#explorer');
            await explorer.getByText('other', { exact: true }).click();
            await expect(page.locator('.tab-button-active')).toContainText('other');

            const historyButton = page.locator('.activity-bar-item[data-panel="history"]');
            await historyButton.click();

            const timelinePanel = page.locator('.timeline-panel');
            await expect(timelinePanel).toBeVisible();
            const entries = timelinePanel.locator('.timeline-entry');
            await expect(entries).toHaveCount(2);
            await expect(entries.nth(0).locator('.timeline-entry-message')).toHaveText('rebalance other table');
            await expect(entries.nth(0).locator('.timeline-entry-author')).toHaveText('Frank');

            await page.locator('.tab-button').getByText('test', { exact: true }).click();
            await expect(page.locator('.tab-button-active')).toContainText('test');
            await expect(entries).toHaveCount(3);
            await expect(entries.nth(0).locator('.timeline-entry-message')).toHaveText('add item_c');
            await expect(entries.nth(0).locator('.timeline-entry-author')).toHaveText('Charlie');
        },
    );
});

test.describe('blameビュー', () => {

    // -------------------------------------------------------------------------
    // テスト4: コンテキストメニューから「変更履歴を表示」でblame情報がトグル表示される
    // -------------------------------------------------------------------------
    test(
        '行ヘッダー右クリックで「変更履歴を表示」が存在し、クリックすると .blame-cell が表示されること',
        async ({ page, historyTest: _historyTest }) => {
            const table = page.locator('.editor-table');

            // データ行の行ヘッダー（nth(1): 2番目のデータ行）を右クリックする
            await rightClickRowHeaderAsync(table, 1);

            // コンテキストメニューに「変更履歴を表示」が存在することを確認する
            const menu = page.locator('.context-menu.visible');
            await expect(menu).toBeVisible();
            const blameMenuItem = menu.locator('.context-menu-item', { hasText: '変更履歴を表示' });
            await expect(blameMenuItem).toBeVisible();

            // 「変更履歴を表示」をクリックする
            await blameMenuItem.click();

            // 行の children[0] に .blame-cell が表示されることを確認する（行ヘッダーの兄弟要素）
            const dataRow = table.locator('.editor-table-row').nth(1);
            const blameCell = dataRow.locator('.blame-cell');
            await expect(blameCell).toBeVisible();

            // .blame-cell 内の構造化された author/date 要素を検証する（データ行2→lineNumber=3→Bob）
            await expect(blameCell.locator('.blame-author')).toHaveText('Bob');
            await expect(blameCell.locator('.blame-date')).toHaveText('2026-03-15');
        },
    );

    // -------------------------------------------------------------------------
    // テスト5: blameトグルを再度クリックするとblame情報が非表示になる
    // -------------------------------------------------------------------------
    test(
        '「変更履歴を非表示」クリックで .blame-cell が非表示になること',
        async ({ page, historyTest: _historyTest }) => {
            const table = page.locator('.editor-table');

            // 最初に「変更履歴を表示」で blame を表示状態にする
            await rightClickRowHeaderAsync(table, 1);
            await clickContextMenuItemAsync(page, '変更履歴を表示');

            // blame-cell が表示されていることを確認する
            const dataRow = table.locator('.editor-table-row').nth(1);
            await expect(dataRow.locator('.blame-cell')).toBeVisible();

            // 再度行ヘッダーを右クリックしてコンテキストメニューを開く
            await rightClickRowHeaderAsync(table, 1);

            // 「変更履歴を非表示」をクリックする
            await clickContextMenuItemAsync(page, '変更履歴を非表示');

            // .blame-cell が非表示になることを確認する
            await expect(dataRow.locator('.blame-cell')).toHaveCount(0);
        },
    );
});

test.describe('blame表示時の列選択', () => {

    // -------------------------------------------------------------------------
    // テスト6: blame表示時に列ヘッダーをクリックすると正しい1列のみ選択される
    // blame列（children[0]）がDOMインデックスをずらすため、列ヘッダークリックで
    // 隣の列が選択されたり2列選択されたりするバグのリグレッションテスト
    // -------------------------------------------------------------------------
    test(
        'blame表示時に列ヘッダー「name」をクリックすると、name列の1列のみに selected クラスが付与されること',
        async ({ page, historyTest: _historyTest }) => {
            const table = page.locator('.editor-table');

            // blameを表示する
            await rightClickRowHeaderAsync(table, 0);
            await clickContextMenuItemAsync(page, '変更履歴を表示');
            await expect(table.locator('.blame-cell').first()).toBeVisible();

            // name列ヘッダーをクリックする
            const nameHeader = table.locator('.editor-table-column-header-row .editor-table-column-header', { hasText: 'name' });
            await nameHeader.click();

            // name列ヘッダーにのみ selected クラスが付与されていること
            await expect(nameHeader).toHaveClass(/selected/);

            // 他の列ヘッダー（id, value）には selected クラスが付与されていないこと
            const idHeader = table.locator('.editor-table-column-header-row .editor-table-column-header', { hasText: 'id' });
            const valueHeader = table.locator('.editor-table-column-header-row .editor-table-column-header', { hasText: 'value' });
            await expect(idHeader).not.toHaveClass(/selected/);
            await expect(valueHeader).not.toHaveClass(/selected/);
        },
    );

    // -------------------------------------------------------------------------
    // テスト7: blame表示時にセルをクリックすると正しいセルにフォーカスが当たる
    // -------------------------------------------------------------------------
    test(
        'blame表示時にデータセルをクリックすると、クリックしたセルにフォーカスクラスが付与されること',
        async ({ page, historyTest: _historyTest }) => {
            const table = page.locator('.editor-table');

            // blameを表示する
            await rightClickRowHeaderAsync(table, 0);
            await clickContextMenuItemAsync(page, '変更履歴を表示');
            await expect(table.locator('.blame-cell').first()).toBeVisible();

            // 1行目のname列セル（2列目のデータセル）をクリックする
            const firstDataRow = table.locator('.editor-table-row').nth(0);
            const nameCell = firstDataRow.locator('.editor-table-cell[data-col="1"]');
            await nameCell.click();

            // クリックしたセルに editor-table-cell-focused クラスが付与されていること
            await expect(nameCell).toHaveClass(/editor-table-cell-focused/);

            // 隣のセル（id列）にはフォーカスクラスが付与されていないこと
            const idCell = firstDataRow.locator('.editor-table-cell[data-col="0"]');
            await expect(idCell).not.toHaveClass(/editor-table-cell-focused/);
        },
    );
});

test.describe('blame表示時の行ドラッグ移動', () => {

    test(
        'blame表示中に行ドラッグで行移動後、移動先の行が選択状態になること',
        async ({ page, historyTest: _historyTest }) => {
            const table = page.locator('.editor-table');

            // blameを表示する
            await rightClickRowHeaderAsync(table, 0);
            await clickContextMenuItemAsync(page, '変更履歴を表示');
            await expect(table.locator('.blame-cell').first()).toBeVisible();

            // 1行目（index=0）を選択する
            const firstHeader = table.locator('.editor-table-row-header').nth(0);
            await firstHeader.click();
            // 1行目が選択されていることを確認する
            await expect(firstHeader).toHaveClass(/selected/);

            // 1行目を3行目の下にドラッグ移動する（テストデータは3行なので最終行の下端に移動）
            const fromBox = await firstHeader.boundingBox();
            if (!fromBox) throw new Error('fromHeader bounding box is null');
            const startX = fromBox.x + fromBox.width / 2;
            const startY = fromBox.y + fromBox.height / 2;

            // ドロップ先: 3行目（index=2）の下端
            const lastHeader = table.locator('.editor-table-row-header').nth(2);
            const lastBox = await lastHeader.boundingBox();
            if (!lastBox) throw new Error('lastHeader bounding box is null');
            const endX = lastBox.x + lastBox.width / 2;
            const endY = lastBox.y + lastBox.height - 2;

            await page.mouse.move(startX, startY);
            await page.mouse.down();
            await page.mouse.move(startX, startY + 6);
            await page.mouse.move(endX, endY);
            await page.mouse.up();

            // 移動後: 2, 3, 1 の順になる
            const row0Id = await table.locator('.editor-table-row').nth(0).locator('.editor-table-cell[data-col="0"]').innerText();
            const row2Id = await table.locator('.editor-table-row').nth(2).locator('.editor-table-cell[data-col="0"]').innerText();
            expect(row0Id).toBe('2');
            expect(row2Id).toBe('1');

            // 移動先の行（index=2、元の1行目）が選択状態になること
            const movedHeader = table.locator('.editor-table-row-header').nth(2);
            await expect(movedHeader).toHaveClass(/selected/);

            // 移動元の位置（index=0）は選択されていないこと
            const firstPos = table.locator('.editor-table-row-header').nth(0);
            await expect(firstPos).not.toHaveClass(/selected/);

            // blame-cell がまだ表示されていること（blameが解除されていないこと）
            await expect(table.locator('.blame-cell').first()).toBeVisible();
        },
    );
});
