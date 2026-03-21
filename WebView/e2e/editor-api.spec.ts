import { test, expect } from './fixtures/test';
import type { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// ヘルパー関数
// =============================================================================

/** エクスプローラーからテーブルを開き、左ペインの EditorTable を返す */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
    const table = page.locator('.editor-left-pane .editor-table');
    await expect(table).toBeVisible();
    return table;
}

/** テーブルの最初のデータセルをクリックしてフォーカスを確保する */
async function clickFirstCellAsync(table: Locator): Promise<void> {
    await table.locator('.editor-table-row:nth-child(2) .editor-table-cell:nth-child(2)').click();
}

// =============================================================================
// Phase 1: データ読み取りAPI (editorApi.data)
// =============================================================================

test.describe('Phase 1: データ読み取りAPI', () => {
    test('getTableNames はストア登録済みテーブル名を返す', async ({ mockFileSystem, page }) => {
        // test テーブルをエクスプローラーから開いてストアに登録する
        await openTableAsync(page, 'test');

        const names = await page.evaluate(() => {
            return (window as unknown as { editorApi: { data: { getTableNames(): string[] } } }).editorApi.data.getTableNames();
        });
        expect(names).toContain('test');
    });

    test('getHeader は指定テーブルのヘッダー配列のディープコピーを返す', async ({ mockFileSystem, page }) => {
        await openTableAsync(page, 'test');

        const header = await page.evaluate(() => {
            return (window as unknown as { editorApi: { data: { getHeader(name: string): string[] | null } } }).editorApi.data.getHeader('test');
        });
        expect(header).toEqual(['id', 'name', 'value']);
    });

    test('getHeader は未登録テーブルに対して null を返す', async ({ mockFileSystem, page }) => {
        await openTableAsync(page, 'test');

        const header = await page.evaluate(() => {
            return (window as unknown as { editorApi: { data: { getHeader(name: string): string[] | null } } }).editorApi.data.getHeader('nonexistent');
        });
        expect(header).toBeNull();
    });

    test('getRows は全行データのディープコピーを返す', async ({ mockFileSystem, page }) => {
        await openTableAsync(page, 'test');

        const rows = await page.evaluate(() => {
            return (window as unknown as { editorApi: { data: { getRows(name: string): string[][] | null } } }).editorApi.data.getRows('test');
        });
        expect(rows).toEqual([
            ['1', 'item_a', '100'],
            ['2', 'item_b', '200'],
            ['3', 'item_c', '300'],
        ]);
    });

    test('getRows は未登録テーブルに対して null を返す', async ({ mockFileSystem, page }) => {
        await openTableAsync(page, 'test');

        const rows = await page.evaluate(() => {
            return (window as unknown as { editorApi: { data: { getRows(name: string): string[][] | null } } }).editorApi.data.getRows('nonexistent');
        });
        expect(rows).toBeNull();
    });

    test('getRowCount は行数を返す', async ({ mockFileSystem, page }) => {
        await openTableAsync(page, 'test');

        const count = await page.evaluate(() => {
            return (window as unknown as { editorApi: { data: { getRowCount(name: string): number | null } } }).editorApi.data.getRowCount('test');
        });
        expect(count).toBe(3);
    });

    test('getRowCount は未登録テーブルに対して null を返す', async ({ mockFileSystem, page }) => {
        await openTableAsync(page, 'test');

        const count = await page.evaluate(() => {
            return (window as unknown as { editorApi: { data: { getRowCount(name: string): number | null } } }).editorApi.data.getRowCount('nonexistent');
        });
        expect(count).toBeNull();
    });

    test('getCellValue は指定セルの値を返す', async ({ mockFileSystem, page }) => {
        await openTableAsync(page, 'test');

        const value = await page.evaluate(() => {
            return (window as unknown as { editorApi: { data: { getCellValue(name: string, row: number, col: number): string | null } } }).editorApi.data.getCellValue('test', 1, 2);
        });
        // 2行目(index=1)の3列目(index=2) = "200"
        expect(value).toBe('200');
    });

    test('getCellValue は未登録テーブルに対して null を返す', async ({ mockFileSystem, page }) => {
        await openTableAsync(page, 'test');

        const value = await page.evaluate(() => {
            return (window as unknown as { editorApi: { data: { getCellValue(name: string, row: number, col: number): string | null } } }).editorApi.data.getCellValue('nonexistent', 0, 0);
        });
        expect(value).toBeNull();
    });

    test('getRows のディープコピー検証: 返り値を変更しても内部データに影響しない', async ({ mockFileSystem, page }) => {
        await openTableAsync(page, 'test');

        // getRows() の返り値を変更して、再度取得しても元のデータが返ることを検証する
        const unchanged = await page.evaluate(() => {
            const api = (window as unknown as { editorApi: { data: { getRows(name: string): string[][] | null } } }).editorApi.data;
            const rows1 = api.getRows('test');
            if (rows1 === null) return false;
            // 返り値を破壊的に変更する
            rows1[0][0] = 'MODIFIED';
            rows1[0][1] = 'MODIFIED';
            // 再度取得して元のデータが保持されていることを確認する
            const rows2 = api.getRows('test');
            if (rows2 === null) return false;
            return rows2[0][0] === '1' && rows2[0][1] === 'item_a';
        });
        expect(unchanged).toBe(true);
    });
});

// =============================================================================
// Phase 1: スキーマAPI (editorApi.schema)
// =============================================================================

test.describe('Phase 1: スキーマAPI', () => {
    test('getSchemaTableNames はスキーマ登録済みテーブル名一覧を返す', async ({ mockFileSystem, page }) => {
        // ページロード時にスキーマは読み込まれる（エクスプローラーに表示される段階で解析済み）
        const names = await page.evaluate(() => {
            return (window as unknown as { editorApi: { schema: { getSchemaTableNames(): string[] } } }).editorApi.schema.getSchemaTableNames();
        });
        expect(names).toContain('test');
    });

    test('getColumns はカラム定義一覧を返す', async ({ mockFileSystem, page }) => {
        const columns = await page.evaluate(() => {
            return (window as unknown as { editorApi: { schema: { getColumns(name: string): Array<{ name: string; type: string }> | null } } }).editorApi.schema.getColumns('test');
        });
        expect(columns).toEqual([
            { name: 'id', type: 'int' },
            { name: 'name', type: 'string' },
            { name: 'value', type: 'int' },
        ]);
    });

    test('getColumns は未登録テーブルに対して null を返す', async ({ mockFileSystem, page }) => {
        const columns = await page.evaluate(() => {
            return (window as unknown as { editorApi: { schema: { getColumns(name: string): Array<{ name: string; type: string }> | null } } }).editorApi.schema.getColumns('nonexistent');
        });
        expect(columns).toBeNull();
    });

    test('getPrimaryKeys は主キー列名配列を返す', async ({ mockFileSystem, page }) => {
        const keys = await page.evaluate(() => {
            return (window as unknown as { editorApi: { schema: { getPrimaryKeys(name: string): string[] | null } } }).editorApi.schema.getPrimaryKeys('test');
        });
        expect(keys).toEqual(['id']);
    });

    test('getPrimaryKeys は未登録テーブルに対して null を返す', async ({ mockFileSystem, page }) => {
        const keys = await page.evaluate(() => {
            return (window as unknown as { editorApi: { schema: { getPrimaryKeys(name: string): string[] | null } } }).editorApi.schema.getPrimaryKeys('nonexistent');
        });
        expect(keys).toBeNull();
    });

    test('getReferences は FK参照一覧を返す', async ({ page }) => {
        // FK参照を持つスキーマを用意する
        const fs: MockFileSystem = {
            "schema/quest.json": JSON.stringify({
                header: [
                    { key: 0, name: "id", type: "int" },
                    { key: 1, name: "name", type: "string" },
                    { key: 2, name: "enemy_id", type: "int", reference: "enemy.id" },
                ],
                primary_key: ["id"],
            }),
            "data/quest.csv": "id,name,enemy_id\n1,quest_a,1\n2,quest_b,2",
            "schema/enemy.json": JSON.stringify({
                header: [
                    { key: 0, name: "id", type: "int" },
                    { key: 1, name: "ja", type: "string" },
                ],
                primary_key: ["id"],
            }),
            "data/enemy.csv": "id,ja\n1,slime\n2,dragon",
        };
        await installMockApiAsync(page, fs);
        await page.goto('/');

        const refs = await page.evaluate(() => {
            return (window as unknown as { editorApi: { schema: { getReferences(name: string): Array<{ columnName: string; targetTable: string; targetColumn: string }> | null } } }).editorApi.schema.getReferences('quest');
        });
        expect(refs).toEqual([
            { columnName: 'enemy_id', targetTable: 'enemy', targetColumn: 'id' },
        ]);
    });

    test('getReferences は FK参照がないテーブルに対して空配列を返す', async ({ mockFileSystem, page }) => {
        const refs = await page.evaluate(() => {
            return (window as unknown as { editorApi: { schema: { getReferences(name: string): Array<{ columnName: string; targetTable: string; targetColumn: string }> | null } } }).editorApi.schema.getReferences('test');
        });
        expect(refs).toEqual([]);
    });

    test('getReferences は未登録テーブルに対して null を返す', async ({ mockFileSystem, page }) => {
        const refs = await page.evaluate(() => {
            return (window as unknown as { editorApi: { schema: { getReferences(name: string): Array<{ columnName: string; targetTable: string; targetColumn: string }> | null } } }).editorApi.schema.getReferences('nonexistent');
        });
        expect(refs).toBeNull();
    });
});

// =============================================================================
// Phase 2: データ書き込みAPI (editorApi.edit)
// =============================================================================

test.describe('Phase 2: データ書き込みAPI', () => {
    test('setCellValue でセル値を変更できる', async ({ mockFileSystem, page }) => {
        await openTableAsync(page, 'test');

        const result = await page.evaluate(() => {
            return (window as unknown as { editorApi: { edit: { setCellValue(name: string, row: number, col: number, value: string): boolean } } }).editorApi.edit.setCellValue('test', 0, 1, 'modified_name');
        });
        expect(result).toBe(true);

        // ストアに反映されていることを確認する
        const value = await page.evaluate(() => {
            return (window as unknown as { editorApi: { data: { getCellValue(name: string, row: number, col: number): string | null } } }).editorApi.data.getCellValue('test', 0, 1);
        });
        expect(value).toBe('modified_name');
    });

    test('setCellValue 後に Undo で元に戻る', async ({ mockFileSystem, page }) => {
        const table = await openTableAsync(page, 'test');

        await page.evaluate(() => {
            (window as unknown as { editorApi: { edit: { setCellValue(name: string, row: number, col: number, value: string): boolean } } }).editorApi.edit.setCellValue('test', 0, 1, 'modified_name');
        });

        // セルをクリックしてフォーカスを確保し、Undo を実行する
        await clickFirstCellAsync(table);
        await page.keyboard.press('Control+z');

        const value = await page.evaluate(() => {
            return (window as unknown as { editorApi: { data: { getCellValue(name: string, row: number, col: number): string | null } } }).editorApi.data.getCellValue('test', 0, 1);
        });
        expect(value).toBe('item_a');
    });

    test('setCellValues で複数セルを一括変更できる（1 Undo ステップ）', async ({ mockFileSystem, page }) => {
        const table = await openTableAsync(page, 'test');

        const result = await page.evaluate(() => {
            return (window as unknown as { editorApi: { edit: { setCellValues(name: string, changes: Array<{ row: number; column: number; value: string }>): boolean } } }).editorApi.edit.setCellValues('test', [
                { row: 0, column: 1, value: 'bulk_a' },
                { row: 1, column: 1, value: 'bulk_b' },
                { row: 2, column: 1, value: 'bulk_c' },
            ]);
        });
        expect(result).toBe(true);

        // 各セルに反映されていることを確認する
        const values = await page.evaluate(() => {
            const api = (window as unknown as { editorApi: { data: { getCellValue(name: string, row: number, col: number): string | null } } }).editorApi.data;
            return [api.getCellValue('test', 0, 1), api.getCellValue('test', 1, 1), api.getCellValue('test', 2, 1)];
        });
        expect(values).toEqual(['bulk_a', 'bulk_b', 'bulk_c']);

        // 1回の Undo で全て元に戻ることを確認する
        await clickFirstCellAsync(table);
        await page.keyboard.press('Control+z');

        const restored = await page.evaluate(() => {
            const api = (window as unknown as { editorApi: { data: { getCellValue(name: string, row: number, col: number): string | null } } }).editorApi.data;
            return [api.getCellValue('test', 0, 1), api.getCellValue('test', 1, 1), api.getCellValue('test', 2, 1)];
        });
        expect(restored).toEqual(['item_a', 'item_b', 'item_c']);
    });

    test('insertRow で行を挿入できる', async ({ mockFileSystem, page }) => {
        await openTableAsync(page, 'test');

        const result = await page.evaluate(() => {
            return (window as unknown as { editorApi: { edit: { insertRow(name: string, rowIndex: number): boolean } } }).editorApi.edit.insertRow('test', 1);
        });
        expect(result).toBe(true);

        // 行数が4になっていることを確認する
        const count = await page.evaluate(() => {
            return (window as unknown as { editorApi: { data: { getRowCount(name: string): number | null } } }).editorApi.data.getRowCount('test');
        });
        expect(count).toBe(4);

        // 挿入された行（index=1）が空行であることを確認する
        const rows = await page.evaluate(() => {
            return (window as unknown as { editorApi: { data: { getRows(name: string): string[][] | null } } }).editorApi.data.getRows('test');
        });
        expect(rows).toEqual([
            ['1', 'item_a', '100'],
            ['', '', ''],
            ['2', 'item_b', '200'],
            ['3', 'item_c', '300'],
        ]);
    });

    test('insertRow 後に Undo で元に戻る', async ({ mockFileSystem, page }) => {
        const table = await openTableAsync(page, 'test');

        await page.evaluate(() => {
            (window as unknown as { editorApi: { edit: { insertRow(name: string, rowIndex: number): boolean } } }).editorApi.edit.insertRow('test', 1);
        });

        await clickFirstCellAsync(table);
        await page.keyboard.press('Control+z');

        const count = await page.evaluate(() => {
            return (window as unknown as { editorApi: { data: { getRowCount(name: string): number | null } } }).editorApi.data.getRowCount('test');
        });
        expect(count).toBe(3);
    });

    test('deleteRow で行を削除できる', async ({ mockFileSystem, page }) => {
        await openTableAsync(page, 'test');

        const result = await page.evaluate(() => {
            return (window as unknown as { editorApi: { edit: { deleteRow(name: string, rowIndex: number): boolean } } }).editorApi.edit.deleteRow('test', 1);
        });
        expect(result).toBe(true);

        const rows = await page.evaluate(() => {
            return (window as unknown as { editorApi: { data: { getRows(name: string): string[][] | null } } }).editorApi.data.getRows('test');
        });
        expect(rows).toEqual([
            ['1', 'item_a', '100'],
            ['3', 'item_c', '300'],
        ]);
    });

    test('deleteRow 後に Undo で元に戻る', async ({ mockFileSystem, page }) => {
        const table = await openTableAsync(page, 'test');

        await page.evaluate(() => {
            (window as unknown as { editorApi: { edit: { deleteRow(name: string, rowIndex: number): boolean } } }).editorApi.edit.deleteRow('test', 1);
        });

        await clickFirstCellAsync(table);
        await page.keyboard.press('Control+z');

        const rows = await page.evaluate(() => {
            return (window as unknown as { editorApi: { data: { getRows(name: string): string[][] | null } } }).editorApi.data.getRows('test');
        });
        expect(rows).toEqual([
            ['1', 'item_a', '100'],
            ['2', 'item_b', '200'],
            ['3', 'item_c', '300'],
        ]);
    });

    test('タブが開かれていないテーブルへの setCellValue は false を返す', async ({ mockFileSystem, page }) => {
        // テーブルを開かずに操作する
        const result = await page.evaluate(() => {
            return (window as unknown as { editorApi: { edit: { setCellValue(name: string, row: number, col: number, value: string): boolean } } }).editorApi.edit.setCellValue('test', 0, 0, 'x');
        });
        expect(result).toBe(false);
    });

    test('タブが開かれていないテーブルへの insertRow は false を返す', async ({ mockFileSystem, page }) => {
        const result = await page.evaluate(() => {
            return (window as unknown as { editorApi: { edit: { insertRow(name: string, rowIndex: number): boolean } } }).editorApi.edit.insertRow('test', 0);
        });
        expect(result).toBe(false);
    });

    test('タブが開かれていないテーブルへの deleteRow は false を返す', async ({ mockFileSystem, page }) => {
        const result = await page.evaluate(() => {
            return (window as unknown as { editorApi: { edit: { deleteRow(name: string, rowIndex: number): boolean } } }).editorApi.edit.deleteRow('test', 0);
        });
        expect(result).toBe(false);
    });
});

// =============================================================================
// Phase 3: イベントAPI (editorApi.events)
// =============================================================================

test.describe('Phase 3: イベントAPI', () => {
    test('onCellChanged: セル変更時にイベントが発火する', async ({ mockFileSystem, page }) => {
        await openTableAsync(page, 'test');

        // イベントリスナーを登録して、セル変更を待つ
        const event = await page.evaluate(() => {
            return new Promise<{ tableName: string; row: number; column: number; oldValue: string; newValue: string }>((resolve) => {
                const api = (window as unknown as { editorApi: {
                    events: { onCellChanged(handler: (e: { tableName: string; row: number; column: number; oldValue: string; newValue: string }) => void): { dispose(): void } };
                    edit: { setCellValue(name: string, row: number, col: number, value: string): boolean };
                } }).editorApi;
                api.events.onCellChanged((e) => { resolve(e); });
                api.edit.setCellValue('test', 0, 1, 'changed');
            });
        });
        expect(event.tableName).toBe('test');
        expect(event.row).toBe(0);
        expect(event.column).toBe(1);
        expect(event.oldValue).toBe('item_a');
        expect(event.newValue).toBe('changed');
    });

    test('onCellChanged: dispose 後はイベントが発火しない', async ({ mockFileSystem, page }) => {
        await openTableAsync(page, 'test');

        const firedAfterDispose = await page.evaluate(() => {
            return new Promise<boolean>((resolve) => {
                const api = (window as unknown as { editorApi: {
                    events: { onCellChanged(handler: (e: unknown) => void): { dispose(): void } };
                    edit: { setCellValue(name: string, row: number, col: number, value: string): boolean };
                } }).editorApi;
                let fired = false;
                const sub = api.events.onCellChanged(() => { fired = true; });
                // 購読解除してからセル変更する
                sub.dispose();
                api.edit.setCellValue('test', 0, 1, 'after_dispose');
                // イベントが非同期で発火する可能性を考慮して少し待つ
                setTimeout(() => resolve(fired), 100);
            });
        });
        expect(firedAfterDispose).toBe(false);
    });

    test('onTableOpened: タブオープン時にイベントが発火する', async ({ mockFileSystem, page }) => {
        // イベントリスナーを先に登録する
        const eventPromise = page.evaluate(() => {
            return new Promise<string>((resolve) => {
                const api = (window as unknown as { editorApi: {
                    events: { onTableOpened(handler: (e: { tableName: string }) => void): { dispose(): void } };
                } }).editorApi;
                api.events.onTableOpened((e) => { resolve(e.tableName); });
            });
        });

        // テーブルを開く
        await page.locator('#explorer .explorer-file').getByText('test').click();

        const tableName = await eventPromise;
        expect(tableName).toBe('test');
    });

    test('onTableClosed: タブクローズ時にイベントが発火する', async ({ mockFileSystem, page }) => {
        // まずテーブルを開く
        await openTableAsync(page, 'test');

        // イベントリスナーを登録する
        const eventPromise = page.evaluate(() => {
            return new Promise<string>((resolve) => {
                const api = (window as unknown as { editorApi: {
                    events: { onTableClosed(handler: (e: { tableName: string }) => void): { dispose(): void } };
                } }).editorApi;
                api.events.onTableClosed((e) => { resolve(e.tableName); });
            });
        });

        // タブの閉じるボタンをクリックする
        const closeButton = page.locator('.tab-button-close').first();
        await closeButton.click();

        const tableName = await eventPromise;
        expect(tableName).toBe('test');
    });
});

// =============================================================================
// Phase 4: C# ↔ WebView ブリッジ (EditorApiBridge)
// =============================================================================

test.describe('Phase 4: C# ↔ WebView ブリッジ', () => {
    test('ブリッジ: data.getTableNames を呼び出せる', async ({ mockFileSystem, page }) => {
        await openTableAsync(page, 'test');

        const result = await page.evaluate(() => {
            return new Promise<unknown>((resolve) => {
                window.chrome.webview.addEventListener('message', (event: MessageEvent) => {
                    const data = JSON.parse(event.data);
                    if (data.type === 'editor_api_response') resolve(data);
                });
                window.chrome.webview.postMessage(JSON.stringify({
                    type: 'editor_api_request',
                    requestId: 'test-bridge-1',
                    method: 'data.getTableNames',
                    params: {},
                }));
            });
        });
        expect(result).toEqual({
            type: 'editor_api_response',
            requestId: 'test-bridge-1',
            success: true,
            data: expect.arrayContaining(['test']),
        });
    });

    test('ブリッジ: data.getRows を呼び出せる', async ({ mockFileSystem, page }) => {
        await openTableAsync(page, 'test');

        const result = await page.evaluate(() => {
            return new Promise<unknown>((resolve) => {
                window.chrome.webview.addEventListener('message', (event: MessageEvent) => {
                    const data = JSON.parse(event.data);
                    if (data.type === 'editor_api_response') resolve(data);
                });
                window.chrome.webview.postMessage(JSON.stringify({
                    type: 'editor_api_request',
                    requestId: 'test-bridge-2',
                    method: 'data.getRows',
                    params: { tableName: 'test' },
                }));
            });
        });
        expect(result).toEqual({
            type: 'editor_api_response',
            requestId: 'test-bridge-2',
            success: true,
            data: [
                ['1', 'item_a', '100'],
                ['2', 'item_b', '200'],
                ['3', 'item_c', '300'],
            ],
        });
    });

    test('ブリッジ: 存在しないメソッドの呼び出しでエラーレスポンスを返す', async ({ mockFileSystem, page }) => {
        await openTableAsync(page, 'test');

        const result = await page.evaluate(() => {
            return new Promise<unknown>((resolve) => {
                window.chrome.webview.addEventListener('message', (event: MessageEvent) => {
                    const data = JSON.parse(event.data);
                    if (data.type === 'editor_api_response') resolve(data);
                });
                window.chrome.webview.postMessage(JSON.stringify({
                    type: 'editor_api_request',
                    requestId: 'test-bridge-err',
                    method: 'nonexistent.method',
                    params: {},
                }));
            });
        });
        expect(result).toEqual({
            type: 'editor_api_response',
            requestId: 'test-bridge-err',
            success: false,
            error: expect.any(String),
        });
    });
});
