import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem, readMockFileAsync } from './fixtures/mock-api';
import { getDataCell } from './fixtures/test-utils';

// =============================================================================
// BUG_0028: CSVカンマエスケープ処理
//
// 不具合の根本原因:
//   Csv クラスが RFC4180 のクォート処理に非対応。
//   - load(): line.split(',') で単純分割しているため、"a,b" のような
//     クォートされたカンマ含みフィールドを正しくパースできない。
//   - toString(): fields.join(',') で単純結合しているため、
//     カンマを含むフィールドをクォートして出力しない。
//
// RFC4180 準拠要件（フィールド内改行は除く）:
//   1. フィールドにカンマ（,）を含む場合、フィールドをダブルクォート（"）で囲む
//   2. フィールドにダブルクォート（"）を含む場合、"" にエスケープして全体を " で囲む
//
// テスト一覧:
//   1. カンマを含むフィールドが1つのセルとして正しく読み込まれること（パース）
//   2. ダブルクォートのエスケープ（""）が正しくパースされること（パース）
//   3. カンマを含むセル値がCSV保存時にクォートで囲まれること（シリアライズ）
//   4. ダブルクォートを含むセル値が "" エスケープされクォートで囲まれること（シリアライズ）
// =============================================================================

/**
 * テスト1・2用: カンマ含み・ダブルクォートエスケープを持つCSVを提供するファイルシステム
 *
 * RFC4180 形式:
 *   - "hello,world" → カンマを含むフィールド → パース後は hello,world
 *   - "say ""hello""" → ダブルクォートのエスケープ → パース後は say "hello"
 */
function createParseTestFileSystem(): MockFileSystem {
    // RFC4180 に準拠した正しいCSVを注入する。
    // 現行 Csv.load() は単純 split(',') なので、これらを誤ってパースする（REDになる）。
    const schema = JSON.stringify({
        header: [
            { key: 0, name: "id", type: "int" },
            { key: 1, name: "description", type: "string" },
        ],
        primary_key: ["id"],
    });

    // RFC4180 形式: "hello,world" は1フィールド、"say ""hello""" は say "hello" にパースされる
    const csv = [
        `id,description`,
        `1,"hello,world"`,
        `2,"say ""hello"""`,
    ].join('\n');

    return {
        "schema/item.json": schema,
        "data/item.csv": csv,
    };
}

/**
 * テスト3・4用: 通常のCSVを提供するファイルシステム（セル編集後に保存検証する）
 */
function createSerializeTestFileSystem(): MockFileSystem {
    const schema = JSON.stringify({
        header: [
            { key: 0, name: "id", type: "int" },
            { key: 1, name: "description", type: "string" },
        ],
        primary_key: ["id"],
    });

    const csv = [
        "id,description",
        "1,original_value",
    ].join('\n');

    return {
        "schema/item.json": schema,
        "data/item.csv": csv,
    };
}

/**
 * セルの表示テキストを取得する。`.cell-value` 要素が存在する場合はその textContent を返す。
 */
async function getCellTextAsync(cell: Locator): Promise<string | null> {
    return cell.evaluate((el) => {
        const valueEl = el.querySelector('.cell-value');
        return valueEl ? valueEl.textContent : el.textContent;
    });
}

/**
 * エクスプローラーからテーブルを開き、テーブルの Locator を返す
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    await page.locator('#explorer').getByText(tableName, { exact: true }).click();
    const table = page.locator(
        `.editor-left-pane .tab-wrapper[data-tab-name="${tableName}"] .editor-table`,
    );
    await expect(table).toBeVisible();
    return table;
}

// =============================================================================
// テスト1: カンマを含むフィールドが1つのセルとして正しく読み込まれること
// =============================================================================
test(
    '[BUG_0028] カンマを含むフィールドが1つのセルとして正しく読み込まれること',
    async ({ page }) => {
        await installMockApiAsync(page, createParseTestFileSystem());
        await page.goto('/');

        const table = await openTableAsync(page, 'item');

        // id=1 行の description セル（col index 1）
        // RFC4180 準拠パースなら "hello,world" → hello,world として表示される
        // 現行実装（単純 split(',')）では "hello,world" が
        //   '"hello' と 'world"' の2セルに分かれてしまうため、このテストは RED になる
        const descriptionCell = getDataCell(table, 0, 1);
        await expect.poll(
            () => getCellTextAsync(descriptionCell),
            { message: 'カンマを含むフィールド "hello,world" が1セルとして表示されること' },
        ).toBe('hello,world');
    },
);

// =============================================================================
// テスト2: ダブルクォートのエスケープ（""）が正しくパースされること
// =============================================================================
test(
    '[BUG_0028] ダブルクォートのエスケープ（""）が say "hello" として正しく読み込まれること',
    async ({ page }) => {
        await installMockApiAsync(page, createParseTestFileSystem());
        await page.goto('/');

        const table = await openTableAsync(page, 'item');

        // id=2 行の description セル（col index 1）
        // RFC4180 準拠パースなら "say ""hello""" → say "hello" として表示される
        // 現行実装（単純 split(',')）では "say ""hello""" が
        //   '"say ""hello"""' のまま表示される（ダブルクォートが除去されない）ため、このテストは RED になる
        const descriptionCell = getDataCell(table, 1, 1);
        await expect.poll(
            () => getCellTextAsync(descriptionCell),
            { message: 'ダブルクォートエスケープ "say ""hello""" が say "hello" として表示されること' },
        ).toBe('say "hello"');
    },
);

// =============================================================================
// テスト3: カンマを含むセル値がCSV保存時にクォートで囲まれること
// =============================================================================
test(
    '[BUG_0028] カンマを含むセル値がCSV保存時に "value,with,comma" としてクォートされること',
    async ({ page }) => {
        await installMockApiAsync(page, createSerializeTestFileSystem());
        await page.goto('/');

        const table = await openTableAsync(page, 'item');

        // description セル（row 0, col 1）をダブルクリックして編集モードに入る
        const descriptionCell = getDataCell(table, 0, 1);
        await descriptionCell.dblclick();

        const editField = page.locator('.grid-textfield-active').first();
        await expect(editField).toBeVisible();

        // カンマを含む値を入力する
        await editField.fill('value,with,comma');
        await page.keyboard.press('Enter');

        // Ctrl+S で保存する
        await page.keyboard.press('Control+s');

        // 保存されたCSVを取得して検証する
        // RFC4180 準拠なら "value,with,comma" とクォートされるはず
        // 現行実装（単純 join(',')）では value,with,comma がクォートなしで出力され
        //   CSV が壊れる（3列データとして読まれる）ため、このテストは RED になる
        const savedCsv = await readMockFileAsync(page, 'data/item.csv');
        const lines = savedCsv.split('\n').filter(l => l.trim() !== '');

        // ヘッダー行
        expect(lines[0]).toBe('id,description');
        // データ行: カンマを含む値はダブルクォートで囲まれること
        expect(lines[1]).toBe('1,"value,with,comma"');
    },
);

// =============================================================================
// テスト4: ダブルクォートを含むセル値が "" エスケープされクォートで囲まれること
// =============================================================================
test(
    '[BUG_0028] ダブルクォートを含むセル値がCSV保存時に "say ""hello""" としてエスケープされること',
    async ({ page }) => {
        await installMockApiAsync(page, createSerializeTestFileSystem());
        await page.goto('/');

        const table = await openTableAsync(page, 'item');

        // description セル（row 0, col 1）をダブルクリックして編集モードに入る
        const descriptionCell = getDataCell(table, 0, 1);
        await descriptionCell.dblclick();

        const editField = page.locator('.grid-textfield-active').first();
        await expect(editField).toBeVisible();

        // ダブルクォートを含む値を入力する
        await editField.fill('say "hello"');
        await page.keyboard.press('Enter');

        // Ctrl+S で保存する
        await page.keyboard.press('Control+s');

        // 保存されたCSVを取得して検証する
        // RFC4180 準拠なら "say ""hello""" とエスケープされるはず
        // 現行実装（単純 join(',')）では say "hello" がエスケープなしで出力されるため、このテストは RED になる
        const savedCsv = await readMockFileAsync(page, 'data/item.csv');
        const lines = savedCsv.split('\n').filter(l => l.trim() !== '');

        // ヘッダー行
        expect(lines[0]).toBe('id,description');
        // データ行: ダブルクォートを含む値は "" エスケープされてクォートで囲まれること
        expect(lines[1]).toBe('1,"say ""hello"""');
    },
);
