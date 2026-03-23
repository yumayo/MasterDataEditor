import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';
import { enableRelationsPanelAsync } from './fixtures/test-utils';

// =============================================================================
// 非アクティブテーブルのセル選択色が灰色になることを検証するテスト
//
// 実装方針:
//   EditorTable が deactivate されたとき、コンテナ要素に CSS クラス
//   `editor-table--inactive` を付与し、その子孫の .selection の border-color を
//   灰色系に変更する。activate されたときはクラスを除去して青色に戻す。
//
//   注意: .selection-background は複数セル選択時のみ表示されるため、
//   単一セルクリック後の色検証には .selection の border-color を使用する。
//
// テーブル構成:
//   enemy: id, ja（敵名テーブル）
//   quest: id, name, enemy_id（クエスト。enemy.id を FK として参照）
//
// テストシナリオ:
//   1. quest テーブルを開いて左ペインのセルを選択 → .selection の border-color が青色
//   2. 右ペインのミニテーブル（enemy の N:1）のセルをクリック
//      → 左ペインに editor-table--inactive クラスが付与される
//      → 左ペインの .selection の border-color が灰色系になる
//   3. 左ペインのセルを再クリック
//      → editor-table--inactive クラスが除去される
//      → .selection の border-color が青色に戻る
// =============================================================================

/**
 * テスト用のファイルシステムを生成する
 *
 * quest の enemy_id 列が enemy.id を FK 参照しているため、
 * quest の行を選択すると RelationsPanel に enemy の N:1 ミニテーブルが表示される。
 */
function createInactiveColorTestFileSystem(): MockFileSystem {
    return {
        "schema/enemy.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "ja", type: "string" },
            ],
            primary_key: ["id"],
        }),
        "data/enemy.csv": [
            "id,ja",
            "1,スライム",
            "2,ドラゴン",
        ].join("\n"),
        "schema/quest.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                // enemy.id を FK として参照する（RelationsPanel は columnName="id" で PKルックアップ）
                { key: 2, name: "enemy_id", type: "int", reference: "enemy.id" },
            ],
            primary_key: ["id"],
        }),
        "data/quest.csv": [
            "id,name,enemy_id",
            "1,first_quest,1",
            "2,second_quest,2",
        ].join("\n"),
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
 * 指定した行ヘッダーをクリックして行を選択する
 * rowIndex: 0始まり（ヘッダー行を除く）
 */
async function selectRowAsync(table: Locator, rowIndex: number): Promise<void> {
    const header = table.locator('.editor-table-row-header').nth(rowIndex);
    await header.click();
}

/**
 * RelationsPanel のコンテンツが表示されるまで待機する
 */
async function waitForRelationsPanelContentAsync(page: Page): Promise<void> {
    await expect(page.locator('.relations-panel-content')).toBeVisible();
}

/**
 * 指定した要素の computed border-top-color に colorFragment が含まれるかどうかを返す。
 * computed style は "rgba(R, G, B, A)" 形式で返るため、スペースありなしの両方を許容する。
 * colorFragment 例: '0, 120, 215'（青）、'128, 128, 128'（灰）
 */
async function hasBorderColorAsync(el: Locator, colorFragment: string): Promise<boolean> {
    const color = await el.evaluate((e: Element) => window.getComputedStyle(e).borderTopColor);
    // "R, G, B" と "R,G,B" どちらの形式でも一致させるためスペース除去版も確認する
    return color.includes(colorFragment) || color.includes(colorFragment.replace(/, /g, ','));
}

/**
 * 指定した要素の computed border-color が「青色系」かどうかを返す
 * .selection 要素のアクティブ時の border-color は rgba(0, 120, 215, 0.5)
 */
async function isBlueBorderAsync(el: Locator): Promise<boolean> {
    return hasBorderColorAsync(el, '0, 120, 215');
}

/**
 * 指定した要素の computed border-color が「灰色系」かどうかを返す
 * .selection 要素の非アクティブ時の border-color は rgba(128, 128, 128, 0.5)
 */
async function isGrayBorderAsync(el: Locator): Promise<boolean> {
    return hasBorderColorAsync(el, '128, 128, 128');
}

// データセルを絞り込むセレクタ（行ヘッダー・列ヘッダー・コーナーセルを除外）
const DATA_CELL_SELECTOR =
    '.editor-table-cell:not(.editor-table-row-header):not(.editor-table-column-header):not(.editor-table-corner-cell)';

test.describe('非アクティブテーブルのセル選択色', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createInactiveColorTestFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
        await enableRelationsPanelAsync(page);
    });

    // ---------------------------------------------------------------------------
    // テスト1: 右ペインをクリックすると左ペインの選択色が灰色になること
    // ---------------------------------------------------------------------------
    test(
        '右ペインのミニテーブルをクリックすると左ペインの選択色が灰色（非アクティブ色）になること',
        async ({ page }) => {
            // quest テーブルを開いて0行目を行選択する
            const mainTable = await openTableAsync(page, 'quest');
            await selectRowAsync(mainTable, 0);
            await waitForRelationsPanelContentAsync(page);

            // RelationsPanel の enemy ミニテーブルが表示されるまで待機する
            const miniTable = page.locator('.relations-panel .editor-table').first();
            await expect(miniTable).toBeVisible();

            // ミニテーブルのデータセルが DOM に出現するまで待機する
            const miniDataCell = miniTable.locator(DATA_CELL_SELECTOR).first();
            await expect(miniDataCell).toBeVisible();

            // 左ペインのセルをクリックして選択状態を作る（.selection 枠線を生成させる）
            const mainDataCell = mainTable.locator(DATA_CELL_SELECTOR).first();
            await expect(mainDataCell).toBeVisible();
            await mainDataCell.click();

            // 左ペインの .selection 要素が存在し、border-color が青色であることを確認する（前提確認）
            // .selection は単一セル選択時でも常に表示される（.selection-background と異なり非表示にならない）
            const mainSelection = page.locator('.editor-left-pane .selection').first();
            await expect(mainSelection).toBeVisible();
            expect(await isBlueBorderAsync(mainSelection)).toBe(true);

            // 右ペインのミニテーブルのセルをクリックして、右ペインをアクティブにする
            await miniDataCell.click();

            // 左ペインの EditorTable に editor-table--inactive クラスが付与されることを確認する
            await expect(mainTable).toHaveClass(/editor-table--inactive/);

            // 左ペインの .selection の border-color が灰色系（非アクティブ色）になることを確認する
            await expect.poll(() => isGrayBorderAsync(mainSelection)).toBe(true);
        },
    );

    // ---------------------------------------------------------------------------
    // テスト2: 左ペインを再クリックすると選択色が青（アクティブ色）に戻ること
    // ---------------------------------------------------------------------------
    test(
        '右ペインをクリックした後、左ペインのセルをクリックすると選択色が青（アクティブ色）に戻ること',
        async ({ page }) => {
            // quest テーブルを開いて0行目を行選択する
            const mainTable = await openTableAsync(page, 'quest');
            await selectRowAsync(mainTable, 0);
            await waitForRelationsPanelContentAsync(page);

            // RelationsPanel の enemy ミニテーブルが表示されるまで待機する
            const miniTable = page.locator('.relations-panel .editor-table').first();
            await expect(miniTable).toBeVisible();

            // ミニテーブルのデータセルが DOM に出現するまで待機する
            const miniDataCell = miniTable.locator(DATA_CELL_SELECTOR).first();
            await expect(miniDataCell).toBeVisible();

            // 左ペインのセルをクリックして選択状態を作る（.selection 枠線を生成させる）
            const mainDataCell = mainTable.locator(DATA_CELL_SELECTOR).first();
            await expect(mainDataCell).toBeVisible();
            await mainDataCell.click();

            // 右ペインのミニテーブルのセルをクリックして、右ペインをアクティブにする
            await miniDataCell.click();

            // 左ペインが非アクティブになったことを確認する（前提確認）
            await expect(mainTable).toHaveClass(/editor-table--inactive/);

            // 左ペインのセルを再クリックする
            await mainDataCell.click();

            // editor-table--inactive クラスが除去されることを確認する
            await expect(mainTable).not.toHaveClass(/editor-table--inactive/);

            // 左ペインの .selection の border-color が青色（アクティブ色）に戻ることを確認する
            // .selection は単一セル選択時でも常に表示される
            const mainSelection = page.locator('.editor-left-pane .selection').first();
            await expect(mainSelection).toBeVisible();
            await expect.poll(() => isBlueBorderAsync(mainSelection)).toBe(true);
        },
    );
});
