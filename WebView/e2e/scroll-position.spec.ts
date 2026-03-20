import { test, expect } from './fixtures/test';
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
            primary_key: ["id"],
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

// =============================================================================
// TDD RED テスト: マウスクリック時の自動スクロール
//
// 背景:
//   キーボード操作（矢印キー等）では selection.move() → scrollFocusIntoView() が呼ばれ
//   選択セルが画面内に収まるよう自動スクロールされる。
//   しかし mousedown 時の selection.start() / extendSelection() では
//   scrollFocusIntoView() が呼ばれないため自動スクロールが行われない。
//
// 期待動作:
//   マウスクリック時にも選択セルが画面内に完全に収まるようスクロールされること。
//   Shift+クリック時にも拡張先のセルが画面内に完全に収まるようスクロールされること。
// =============================================================================

/**
 * セルの DOMRect を JS 評価で取得する
 * Playwright の getBoundingClientRect は scrollIntoViewIfNeeded を内部で呼ぶ可能性があるため
 * evaluate 経由で直接取得する
 * rowIndex: 0始まり（ヘッダー行を除く）、colIndex: 0始まり（行ヘッダーを除く）
 */
async function getCellBoundingRectAsync(
    page: Page,
    rowIndex: number,
    colIndex: number,
): Promise<{ top: number; bottom: number; left: number; right: number }> {
    return page.evaluate(
        ([rowIdx, colIdx]) => {
            // editor-table-row を rowIdx+1 番目（ヘッダー行をスキップ）から取得する
            const rows = document.querySelectorAll('.editor-left-pane .editor-table .editor-table-row');
            const row = rows[rowIdx + 1] as HTMLElement | undefined;
            if (!row) return { top: 0, bottom: 0, left: 0, right: 0 };
            const cells = row.querySelectorAll('.editor-table-cell:not(.editor-table-row-header)');
            const cell = cells[colIdx] as HTMLElement | undefined;
            if (!cell) return { top: 0, bottom: 0, left: 0, right: 0 };
            const rect = cell.getBoundingClientRect();
            return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
        },
        [rowIndex, colIndex] as [number, number],
    );
}

/**
 * スクロールコンテナのクライアント矩形を取得する
 */
async function getContainerRectAsync(page: Page): Promise<{ top: number; bottom: number; left: number; right: number }> {
    return page.evaluate(() => {
        const container = document.querySelector('.editor-left-pane');
        if (!container) return { top: 0, bottom: 0, left: 0, right: 0 };
        const rect = container.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
    });
}

test(
    'マウスクリック時にセルが画面外にある場合、クリック後にセルが完全に見えるようスクロールされること',
    async ({ page }) => {
        // 小さいビューポートでスクロールが発生しやすくする
        await page.setViewportSize({ width: 1024, height: 400 });

        const fs = createFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        const table = await openTableAsync(page, 'chara');

        const dataRows = table.locator('.editor-table-row:not(.editor-table-empty-row)');
        await expect(dataRows).toHaveCount(101);

        // まず最初の行を選択してフォーカスをテーブルに当てる（{ force: true } のためフォーカスが必要）
        const firstCell = getDataCell(table, 0, 0);
        await firstCell.click();

        // ターゲット行（rowIndex=30）の下端が画面下端からはみ出るようスクロールする
        // offsetTop を使って、行の上端がコンテナ表示領域の下端から5pxだけ内側に来るようにする
        // これにより行の大部分は画面外にはみ出す
        const targetRowIndex = 30;
        await page.evaluate(([rowIdx]) => {
            const container = document.querySelector('.editor-left-pane');
            if (!container) return;
            const rows = container.querySelectorAll('.editor-table-row:not(.editor-table-empty-row)');
            const targetRow = rows[rowIdx + 1] as HTMLElement | undefined; // +1 でヘッダー行をスキップ
            if (!targetRow) return;
            // 行の上端がコンテナ下端から5pxだけ見える位置にスクロール
            // これにより行の大部分（下端）は画面外にはみ出す
            container.scrollTop = targetRow.offsetTop - container.clientHeight + 5;
        }, [targetRowIndex] as [number]);

        // スクロール後にターゲットセルの下端が画面外にはみ出していることを確認する
        const containerRectAfterScroll = await getContainerRectAsync(page);
        const cellRectBefore = await getCellBoundingRectAsync(page, targetRowIndex, 2);
        expect(
            cellRectBefore.bottom,
            `ターゲットセルが画面外にない（bottom=${cellRectBefore.bottom}, containerBottom=${containerRectAfterScroll.bottom}）`,
        ).toBeGreaterThan(containerRectAfterScroll.bottom);

        // スクロール前のスクロール量を記録する
        const scrollBefore = await getScrollPositionAsync(page);

        // ターゲットセルに対して mousedown イベントを直接ディスパッチする
        // page.mouse.click() や Locator.click() はブラウザの scrollIntoView が介入するため、
        // evaluate 経由でイベントを直接発火し、アプリケーション側の自動スクロールのみを検証する
        await page.evaluate(([rowIdx, colIdx]) => {
            const rows = document.querySelectorAll('.editor-table-row:not(.editor-table-empty-row)');
            const row = rows[rowIdx + 1] as HTMLElement | undefined;
            if (!row) return;
            const cells = row.querySelectorAll('.editor-table-cell:not(.editor-table-row-header)');
            const cell = cells[colIdx] as HTMLElement | undefined;
            if (!cell) return;
            cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
            cell.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
        }, [targetRowIndex, 2] as [number, number]);

        // requestAnimationFrame でスクロール位置が再適用されるため、1フレーム待つ
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));

        // クリック後のスクロール量を取得する
        const scrollAfter = await getScrollPositionAsync(page);

        // クリック後にセルが画面内に収まるようスクロールされているはず（scrollTop が増加する）
        expect(
            scrollAfter.scrollTop,
            `クリック後に自動スクロールが行われなかった。クリック前: scrollTop=${scrollBefore.scrollTop}, クリック後: scrollTop=${scrollAfter.scrollTop}`,
        ).toBeGreaterThan(scrollBefore.scrollTop);

        // さらにクリック後にターゲットセルが完全に画面内に収まっていることを確認する
        const containerRectFinal = await getContainerRectAsync(page);
        const cellRectAfter = await getCellBoundingRectAsync(page, targetRowIndex, 2);
        expect(
            cellRectAfter.bottom,
            `自動スクロール後もターゲットセルが画面外にある（bottom=${cellRectAfter.bottom}, containerBottom=${containerRectFinal.bottom}）`,
        ).toBeLessThanOrEqual(containerRectFinal.bottom);
    },
);

test(
    'Shift+クリックで選択範囲を拡張した際、拡張先のセルが画面内に収まるようスクロールされること',
    async ({ page }) => {
        // 小さいビューポートでスクロールが発生しやすくする
        await page.setViewportSize({ width: 1024, height: 400 });

        const fs = createFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        const table = await openTableAsync(page, 'chara');

        const dataRows = table.locator('.editor-table-row:not(.editor-table-empty-row)');
        await expect(dataRows).toHaveCount(101);

        // 1行目のセルを通常クリックして選択開始位置（アンカー）を確立する
        const anchorCell = getDataCell(table, 0, 0);
        await anchorCell.click();

        // Shift+クリックのターゲット行（rowIndex=30）の下端が画面外にはみ出るようスクロールする
        const targetRowIndex = 30;
        await page.evaluate(([rowIdx]) => {
            const container = document.querySelector('.editor-left-pane');
            if (!container) return;
            const rows = container.querySelectorAll('.editor-table-row:not(.editor-table-empty-row)');
            const targetRow = rows[rowIdx + 1] as HTMLElement | undefined;
            if (!targetRow) return;
            // 行の上端がコンテナ下端から5pxだけ見える位置にスクロール
            container.scrollTop = targetRow.offsetTop - container.clientHeight + 5;
        }, [targetRowIndex] as [number]);

        // スクロール後にターゲットセルの下端が画面外にはみ出していることを確認する
        const containerRectAfterScroll = await getContainerRectAsync(page);
        const cellRectBefore = await getCellBoundingRectAsync(page, targetRowIndex, 0);
        expect(
            cellRectBefore.bottom,
            `Shift+クリックのターゲットセルが画面外にない（bottom=${cellRectBefore.bottom}, containerBottom=${containerRectAfterScroll.bottom}）`,
        ).toBeGreaterThan(containerRectAfterScroll.bottom);

        // スクロール前のスクロール量を記録する
        const scrollBefore = await getScrollPositionAsync(page);

        // ターゲットセルに対して Shift+mousedown を直接ディスパッチする
        await page.evaluate(([rowIdx, colIdx]) => {
            const rows = document.querySelectorAll('.editor-table-row:not(.editor-table-empty-row)');
            const row = rows[rowIdx + 1] as HTMLElement | undefined;
            if (!row) return;
            const cells = row.querySelectorAll('.editor-table-cell:not(.editor-table-row-header)');
            const cell = cells[colIdx] as HTMLElement | undefined;
            if (!cell) return;
            cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, shiftKey: true }));
            cell.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, shiftKey: true }));
        }, [targetRowIndex, 0] as [number, number]);

        // requestAnimationFrame でスクロール位置が再適用されるため、1フレーム待つ
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));

        // クリック後のスクロール量を取得する
        const scrollAfter = await getScrollPositionAsync(page);

        // Shift+クリック後に拡張先セルが画面内に収まるようスクロールされているはず（scrollTop が増加する）
        expect(
            scrollAfter.scrollTop,
            `Shift+クリック後に自動スクロールが行われなかった。クリック前: scrollTop=${scrollBefore.scrollTop}, クリック後: scrollTop=${scrollAfter.scrollTop}`,
        ).toBeGreaterThan(scrollBefore.scrollTop);

        // さらにShift+クリック後にターゲットセルが完全に画面内に収まっていることを確認する
        const containerRectFinal = await getContainerRectAsync(page);
        const cellRectAfter = await getCellBoundingRectAsync(page, targetRowIndex, 0);
        expect(
            cellRectAfter.bottom,
            `Shift+クリック自動スクロール後もターゲットセルが画面外にある（bottom=${cellRectAfter.bottom}, containerBottom=${containerRectFinal.bottom}）`,
        ).toBeLessThanOrEqual(containerRectFinal.bottom);
    },
);
