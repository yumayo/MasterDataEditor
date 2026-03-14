import { test, expect } from '@playwright/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// リグレッションテスト: セル編集確定後にスクロール位置が(0,0)にリセットされるバグ
//
// 根本原因:
//   editor-table-handler.ts の onFocusout() (行267付近) で
//   this.element.focus({ preventScroll: true }) を呼ぶが、
//   WebView2/Chromiumで preventScroll: true が機能しない場合、
//   top: -99999px に位置する contenteditable 要素にフォーカスすることで
//   ブラウザがスクロール位置を(0,0)にリセットする。
//
// 期待動作:
//   セル編集確定後（Enter/Tab/focusout）にスクロール位置が維持されること。
// =============================================================================

/**
 * テスト用ファイルシステムを生成する
 * スクロールが発生するように100行以上のデータを持つテーブルを用意する
 */
function createFileSystem(): MockFileSystem {
    // 十分なスクロール量を確保するために100行のデータを生成する
    const rows = ['id,name,attack,defense,speed'];
    for (let i = 1; i <= 100; i++) {
        rows.push(`${i},chara_${i},${i * 10},${i * 5},${i * 3}`);
    }

    return {
        "schema/chara.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                { key: 2, name: "attack", type: "int" },
                { key: 3, name: "defense", type: "int" },
                { key: 4, name: "speed", type: "int" },
            ],
            primary_key: "id",
        }),
        "data/chara.csv": rows.join("\n"),
    };
}

/**
 * エクスプローラーからテーブルを開き、左ペインの EditorTable Locator を返す
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
    const table = page.locator('.editor-left-pane .editor-table');
    await expect(table).toBeVisible();
    return table;
}

/**
 * テーブルコンテナのスクロール位置を取得する
 * editor-table は .editor-table-body-container または
 * テーブル自身の親要素がスクロールコンテナになっている
 */
async function getScrollPositionAsync(page: Page): Promise<{ scrollTop: number; scrollLeft: number }> {
    return page.evaluate(() => {
        // スクロールコンテナを探す。EditorTableはleft-pane内でスクロールする。
        const container = document.querySelector('.editor-left-pane');
        if (!container) return { scrollTop: 0, scrollLeft: 0 };
        return {
            scrollTop: container.scrollTop,
            scrollLeft: container.scrollLeft,
        };
    });
}

/**
 * テーブルの指定行・列のデータセルを返す
 * rowIndex: 0始まり（ヘッダー行を除く）
 * colIndex: 0始まり（行ヘッダーを除く）
 */
function getDataCell(table: Locator, rowIndex: number, colIndex: number): Locator {
    const row = table.locator('.editor-table-row').nth(rowIndex + 1);
    return row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
}

test(
    'セル編集確定後にスクロール位置がリセットされないこと',
    async ({ page }) => {
        // 画面サイズを1024x768に制限してスクロールが発生しやすくする
        await page.setViewportSize({ width: 1024, height: 768 });

        const fs = createFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        // charaテーブルを開く
        const table = await openTableAsync(page, 'chara');

        // テーブルが100行分のデータを読み込んでいることを確認する
        // （バッファ空行 editor-table-empty-row を除外してデータ行のみカウント）
        const dataRows = table.locator('.editor-table-row:not(.editor-table-empty-row)');
        // ヘッダー行(1) + データ行(100) = 101
        await expect(dataRows).toHaveCount(101);

        // left-pane をスクロールして95行目付近を表示する
        // 1行あたりの高さを考慮してスクロール量を計算する
        const scrollTop = await page.evaluate(() => {
            const container = document.querySelector('.editor-left-pane');
            if (!container) return 0;
            // 95行目付近まで大きくスクロールする（行の高さは約28px程度と仮定）
            const targetScrollTop = 94 * 28;
            container.scrollTop = targetScrollTop;
            return container.scrollTop;
        });

        // スクロールが実際に行われたことを確認する（0より大きければ十分）
        expect(scrollTop).toBeGreaterThan(0);

        // スクロール後の位置を記録する
        const scrollBefore = await getScrollPositionAsync(page);
        expect(scrollBefore.scrollTop).toBeGreaterThan(0);

        // 95行目（0始まりインデックス=94）のattack列（colIndex=2）をダブルクリックして編集開始
        // scrollIntoViewIfNeeded() を使うとスクロール位置が変わるため使わない
        // スクロール後に目的のセルが viewport 内に入っている前提でクリックする
        const targetCell = getDataCell(table, 94, 2);
        await targetCell.dblclick();

        // 編集フィールドが表示されることを確認する
        const editField = page.locator('.grid-textfield-active');
        await expect(editField).toBeVisible();

        // 値を入力してEnterで確定する
        await page.keyboard.press('Control+a');
        await page.keyboard.insertText('999');
        await page.keyboard.press('Enter');

        // 確定後のスクロール位置を取得する
        const scrollAfter = await getScrollPositionAsync(page);

        // スクロール位置が(0,0)にリセットされていないことを検証する
        // バグが存在する場合、scrollTop が 0 に戻ってしまう
        expect(
            scrollAfter.scrollTop,
            `セル編集確定後にスクロール位置がリセットされた。確定前: scrollTop=${scrollBefore.scrollTop}, 確定後: scrollTop=${scrollAfter.scrollTop}`
        ).toBeGreaterThan(100);
    },
);

test(
    'Tab確定後にスクロール位置がリセットされないこと',
    async ({ page }) => {
        await page.setViewportSize({ width: 1024, height: 768 });

        const fs = createFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        const table = await openTableAsync(page, 'chara');

        // データ行100行が表示されるまで待機する
        const dataRows = table.locator('.editor-table-row:not(.editor-table-empty-row)');
        await expect(dataRows).toHaveCount(101);

        // スクロールして90行目付近を表示する
        const scrollTop = await page.evaluate(() => {
            const container = document.querySelector('.editor-left-pane');
            if (!container) return 0;
            container.scrollTop = 90 * 28;
            return container.scrollTop;
        });
        expect(scrollTop).toBeGreaterThan(0);

        const scrollBefore = await getScrollPositionAsync(page);
        expect(scrollBefore.scrollTop).toBeGreaterThan(0);

        // 90行目（0始まりインデックス=89）のname列（colIndex=1）をダブルクリックして編集開始
        // scrollIntoViewIfNeeded() を使うとスクロール位置が変わるため使わない
        const targetCell = getDataCell(table, 89, 1);
        await targetCell.dblclick();

        const editField = page.locator('.grid-textfield-active');
        await expect(editField).toBeVisible();

        // 値を入力してTabで確定する
        await page.keyboard.press('Control+a');
        await page.keyboard.insertText('test_hero');
        await page.keyboard.press('Tab');

        const scrollAfter = await getScrollPositionAsync(page);

        // スクロール位置がリセットされていないことを検証する
        expect(
            scrollAfter.scrollTop,
            `Tab確定後にスクロール位置がリセットされた。確定前: scrollTop=${scrollBefore.scrollTop}, 確定後: scrollTop=${scrollAfter.scrollTop}`
        ).toBeGreaterThan(100);
    },
);
