import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// HTMLセルレンダリング テスト（FEAT_0042）
//
// 実装すべき機能:
//   - 列スキーマに renderAsHtml: true が設定されたとき、セル内の <br> タグを
//     HTML改行要素として描画する
//   - 許可タグ（<br> 等）以外はエスケープし、<script> 等の危険タグを無効化する
//   - 列ヘッダーを右クリックすると「HTMLとして表示」コンテキストメニューが現れる
//
// RED状態の理由:
//   - editor-table.ts の createCell() が cell.textContent = value のみで
//     renderAsHtml モードの判定・innerHTML 設定を行っていない
//   - editor-table-data-column.ts が renderAsHtml フィールドを持っていない
//   - editor-table-context-menu.ts の列コンテキストメニューに「HTMLとして表示」が存在しない
// =============================================================================

/**
 * renderAsHtml: true の description 列を持つ item テーブルのファイルシステムを構築する
 */
function createFileSystemWithHtmlColumn(): MockFileSystem {
    return {
        "schema/item.json": JSON.stringify({
            primary_key: ["id"],
            header: [
                { key: 0, name: "id",          type: "int" },
                { key: 1, name: "name",         type: "string" },
                { key: 2, name: "description",  type: "string", renderAsHtml: true },
            ],
        }),
        // CSVにはクォートでラップした <br> 含む値と <script> 含む値を用意する
        "data/item.csv": [
            "id,name,description",
            `1,Sword,"改行前<br>改行後"`,
            `2,Shield,"<script>alert(1)</script>危険テキスト"`,
        ].join("\n"),
    };
}

/**
 * エディターテーブルが表示されるまで待機し、左ペインのテーブルLocatorを返す
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    await page.locator('#explorer').getByText(tableName, { exact: true }).click();
    const table = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="${tableName}"] .editor-table`);
    await expect(table).toBeVisible();
    return table;
}

/**
 * 指定した行・列のデータセルを返す
 * rowIndex: 0始まり（ヘッダー行を除く）, colIndex: 0始まり（行ヘッダーを除く）
 */
function getDataCell(table: Locator, rowIndex: number, colIndex: number): Locator {
    // .editor-table-row の nth(0) はヘッダー行なので、nth(rowIndex + 1) がデータ行
    const row = table.locator('.editor-table-row').nth(rowIndex);
    return row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
}

/**
 * 列ヘッダーを右クリックしてコンテキストメニューを開く
 * colIndex: 0始まり（行ヘッダーコーナーを除く）
 */
async function rightClickColumnHeaderAsync(table: Locator, colIndex: number): Promise<void> {
    const headerRow = table.locator('.editor-table-column-header-row');
    const header = headerRow.locator('.editor-table-column-header').nth(colIndex);
    await header.click({ button: 'right' });
}

// =============================================================================
// テスト1: HTMLモードのセルで <br> が改行要素として描画されること
// =============================================================================
test(
    'renderAsHtml列のセルで <br> タグが <br> 要素としてDOMに存在すること',
    async ({ page }) => {
        await installMockApiAsync(page, createFileSystemWithHtmlColumn());
        await page.goto('/');
        const table = await openTableAsync(page, 'item');

        // id=1 の description 列（colIndex=2）。値は "改行前<br>改行後"
        const cell = getDataCell(table, 0, 2);
        await expect(cell).toBeVisible();

        // <br> 要素がセルDOM内に存在することを確認する
        // プロダクションコードに renderAsHtml 対応がないため失敗（RED）
        const brCount = await cell.locator('br').count();
        expect(brCount).toBeGreaterThanOrEqual(1);
    },
);

test(
    'renderAsHtml列のセルの innerHTML に <br> が含まれること',
    async ({ page }) => {
        await installMockApiAsync(page, createFileSystemWithHtmlColumn());
        await page.goto('/');
        const table = await openTableAsync(page, 'item');

        const cell = getDataCell(table, 0, 2);
        await expect(cell).toBeVisible();

        // innerHTML に <br> が含まれることを確認する
        // プロダクションコードに renderAsHtml 対応がないため失敗（RED）
        const innerHTML = await cell.evaluate((el: HTMLElement) => el.innerHTML);
        expect(innerHTML).toContain('<br>');
    },
);

// =============================================================================
// テスト2: HTMLモードでも許可されていないタグはエスケープされること
// =============================================================================
test(
    'renderAsHtml列のセルで <script> 要素がDOMに存在しないこと',
    async ({ page }) => {
        await installMockApiAsync(page, createFileSystemWithHtmlColumn());
        await page.goto('/');
        const table = await openTableAsync(page, 'item');

        // id=2 の description 列（colIndex=2）。値は "<script>alert(1)</script>危険テキスト"
        const cell = getDataCell(table, 1, 2);
        await expect(cell).toBeVisible();

        // <script> 要素がセルDOM内に存在しないことを確認する
        // プロダクションコードに renderAsHtml 対応がないため、現状は textContent = value により
        // <script> がテキストとして表示されるだけだが、innerHTML 設定時に script が挿入されると危険
        // 実装後は sanitize により script タグが除去されていることを保証する（RED）
        const scriptCount = await cell.locator('script').count();
        expect(scriptCount).toBe(0);
    },
);

test(
    'renderAsHtml列のセルで <script> がエスケープされたテキストとして表示されること',
    async ({ page }) => {
        await installMockApiAsync(page, createFileSystemWithHtmlColumn());
        await page.goto('/');
        const table = await openTableAsync(page, 'item');

        const cell = getDataCell(table, 1, 2);
        await expect(cell).toBeVisible();

        // セルのテキスト内容に "危険テキスト" が表示されていることを確認する
        // （<script> タグが除去されてもテキスト部分は残る）
        // プロダクションコードに renderAsHtml 対応がないため失敗（RED）
        await expect(cell).toContainText('危険テキスト');

        // innerHTML に <script> 要素が含まれないこと（エスケープ済みであること）
        const innerHTML = await cell.evaluate((el: HTMLElement) => el.innerHTML);
        expect(innerHTML).not.toContain('<script>');
    },
);

// =============================================================================
// テスト3: 列ヘッダー右クリックで「HTMLとして表示」メニューが表示されること
// =============================================================================
test(
    '列ヘッダーを右クリックするとコンテキストメニューに「HTMLとして表示」が含まれること',
    async ({ page }) => {
        await installMockApiAsync(page, createFileSystemWithHtmlColumn());
        await page.goto('/');
        const table = await openTableAsync(page, 'item');

        // description 列（colIndex=2）のヘッダーを右クリック
        await rightClickColumnHeaderAsync(table, 2);

        // コンテキストメニューが表示されること
        const contextMenu = page.locator('.context-menu.visible');
        await expect(contextMenu).toBeVisible();

        // 「HTMLとして表示」メニュー項目が存在することを確認する
        // プロダクションコードに「HTMLとして表示」メニュー項目が存在しないため失敗（RED）
        const htmlMenuItem = contextMenu.locator('.context-menu-item', { hasText: 'HTMLとして表示' });
        await expect(htmlMenuItem).toBeVisible();
    },
);

test(
    '「HTMLとして表示」メニューを選択するとスキーマに renderAsHtml: true が保存されること',
    async ({ page }) => {
        // renderAsHtml が未設定のスキーマから始める
        const fs: MockFileSystem = {
            "schema/item.json": JSON.stringify({
                primary_key: ["id"],
                header: [
                    { key: 0, name: "id",          type: "int" },
                    { key: 1, name: "name",         type: "string" },
                    { key: 2, name: "description",  type: "string" },
                ],
            }),
            "data/item.csv": [
                "id,name,description",
                "1,Sword,説明文",
            ].join("\n"),
        };
        await installMockApiAsync(page, fs);
        await page.goto('/');
        const table = await openTableAsync(page, 'item');

        // description 列（colIndex=2）のヘッダーを右クリック
        await rightClickColumnHeaderAsync(table, 2);

        // コンテキストメニューの「HTMLとして表示」をクリック
        // プロダクションコードに「HTMLとして表示」が存在しないため失敗（RED）
        const contextMenu = page.locator('.context-menu.visible');
        await expect(contextMenu).toBeVisible();
        await contextMenu.locator('.context-menu-item', { hasText: 'HTMLとして表示' }).click();

        // Ctrl+S でスキーマを保存
        await page.keyboard.press('Control+s');
        await page.waitForTimeout(500);

        // スキーマJSONに renderAsHtml: true が含まれることを確認する
        const schemaJson = await page.evaluate(
            () => (window as unknown as { __mockFs: Record<string, string> }).__mockFs['schema/item.json']
        );
        const schema = JSON.parse(schemaJson) as {
            header: Array<{ name: string; renderAsHtml?: boolean }>
        };
        const descriptionColumn = schema.header.find(col => col.name === 'description');
        expect(descriptionColumn?.renderAsHtml).toBe(true);
    },
);
