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
    // 仮想スクロール有効テーブルでは children[1] が topSpacer のため nth-child(3) が最初のデータ行
    await table.locator('.editor-table-row:nth-child(3) .editor-table-cell:nth-child(2)').click();
}

/** スキーマ読み込み完了を待つ */
async function waitForSchemaAsync(page: Page, tableName: string): Promise<void> {
    await expect.poll(async () => {
        return page.evaluate((name) => {
            const api = (window as unknown as { editorApi?: { schema?: { getSchemaTableNames(): string[] } } }).editorApi;
            return api?.schema?.getSchemaTableNames().includes(name) ?? false;
        }, tableName);
    }).toBe(true);
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
        await waitForSchemaAsync(page, 'test');

        const names = await page.evaluate(() => {
            return (window as unknown as { editorApi: { schema: { getSchemaTableNames(): string[] } } }).editorApi.schema.getSchemaTableNames();
        });
        expect(names).toContain('test');
    });

    test('getColumns はカラム定義一覧を返す', async ({ mockFileSystem, page }) => {
        await waitForSchemaAsync(page, 'test');

        const columns = await page.evaluate(() => {
            return (window as unknown as { editorApi: { schema: { getColumns(name: string): Array<{ name: string; type: string; defaultValue: string | null }> | null } } }).editorApi.schema.getColumns('test');
        });
        expect(columns).toEqual([
            { name: 'id', type: 'int', defaultValue: null },
            { name: 'name', type: 'string', defaultValue: null },
            { name: 'value', type: 'int', defaultValue: null },
        ]);
    });

    test('getColumns は未登録テーブルに対して null を返す', async ({ mockFileSystem, page }) => {
        await waitForSchemaAsync(page, 'test');

        const columns = await page.evaluate(() => {
            return (window as unknown as { editorApi: { schema: { getColumns(name: string): Array<{ name: string; type: string }> | null } } }).editorApi.schema.getColumns('nonexistent');
        });
        expect(columns).toBeNull();
    });

    test('getPrimaryKeys は主キー列名配列を返す', async ({ mockFileSystem, page }) => {
        await waitForSchemaAsync(page, 'test');

        const keys = await page.evaluate(() => {
            return (window as unknown as { editorApi: { schema: { getPrimaryKeys(name: string): string[] | null } } }).editorApi.schema.getPrimaryKeys('test');
        });
        expect(keys).toEqual(['id']);
    });

    test('getPrimaryKeys は未登録テーブルに対して null を返す', async ({ mockFileSystem, page }) => {
        await waitForSchemaAsync(page, 'test');

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
        await waitForSchemaAsync(page, 'quest');

        const refs = await page.evaluate(() => {
            return (window as unknown as { editorApi: { schema: { getReferences(name: string): Array<{ columnName: string; targetTable: string; targetColumn: string }> | null } } }).editorApi.schema.getReferences('quest');
        });
        expect(refs).toEqual([
            { columnName: 'enemy_id', targetTable: 'enemy', targetColumn: 'id' },
        ]);
    });

    test('getReferences は FK参照がないテーブルに対して空配列を返す', async ({ mockFileSystem, page }) => {
        await waitForSchemaAsync(page, 'test');

        const refs = await page.evaluate(() => {
            return (window as unknown as { editorApi: { schema: { getReferences(name: string): Array<{ columnName: string; targetTable: string; targetColumn: string }> | null } } }).editorApi.schema.getReferences('test');
        });
        expect(refs).toEqual([]);
    });

    test('getReferences は未登録テーブルに対して null を返す', async ({ mockFileSystem, page }) => {
        await waitForSchemaAsync(page, 'test');

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

    test('onTableSaved: Ctrl+S 保存時にイベントが発火する', async ({ mockFileSystem, page }) => {
        const table = await openTableAsync(page, 'test');

        // セル値を変更してダーティ状態にする
        await page.evaluate(() => {
            (window as unknown as { editorApi: {
                edit: { setCellValue(name: string, row: number, col: number, value: string): boolean };
            } }).editorApi.edit.setCellValue('test', 0, 1, 'saved_name');
        });

        // onTableSaved イベントを Promise で待ち受ける
        const eventPromise = page.evaluate(() => {
            return new Promise<{ tableName: string }>((resolve) => {
                const api = (window as unknown as { editorApi: {
                    events: { onTableSaved(handler: (e: { tableName: string }) => void): { dispose(): void } };
                } }).editorApi;
                api.events.onTableSaved((e) => { resolve(e); });
            });
        });

        // セルをクリックしてフォーカスを確保し、Ctrl+S で保存する
        await clickFirstCellAsync(table);
        await page.keyboard.press('Control+s');

        const event = await eventPromise;
        expect(event.tableName).toBe('test');
    });

    test('onTableSaved: dispose 後はイベントが発火しない', async ({ mockFileSystem, page }) => {
        const table = await openTableAsync(page, 'test');

        // セル値を変更してダーティ状態にする
        await page.evaluate(() => {
            (window as unknown as { editorApi: {
                edit: { setCellValue(name: string, row: number, col: number, value: string): boolean };
            } }).editorApi.edit.setCellValue('test', 0, 1, 'will_not_fire');
        });

        // onTableSaved を登録して即座に dispose し、グローバルフラグで発火を追跡する
        await page.evaluate(() => {
            type FlagWindow = { __tableSavedFired: boolean };
            (window as unknown as FlagWindow).__tableSavedFired = false;
            const api = (window as unknown as { editorApi: {
                events: { onTableSaved(handler: (e: unknown) => void): { dispose(): void } };
            } }).editorApi;
            const sub = api.events.onTableSaved(() => {
                (window as unknown as FlagWindow).__tableSavedFired = true;
            });
            // 購読解除する
            sub.dispose();
        });

        // セルをクリックしてフォーカスを確保し、Ctrl+S で保存する
        await clickFirstCellAsync(table);
        await page.keyboard.press('Control+s');

        // 非同期の保存完了を待ってからフラグを確認する
        const fired = await page.evaluate(() => {
            return new Promise<boolean>((resolve) => {
                setTimeout(() => {
                    resolve((window as unknown as { __tableSavedFired: boolean }).__tableSavedFired);
                }, 300);
            });
        });
        expect(fired).toBe(false);
    });

    test('onRowSelected: 行クリック時にイベントが発火する', async ({ mockFileSystem, page }) => {
        await openTableAsync(page, 'test');

        // onRowSelected イベントを Promise で待ち受ける（2行目クリックを検知する）
        const eventPromise = page.evaluate(() => {
            return new Promise<{ tableName: string; rowIndex: number }>((resolve) => {
                const api = (window as unknown as { editorApi: {
                    events: { onRowSelected(handler: (e: { tableName: string; rowIndex: number }) => void): { dispose(): void } };
                } }).editorApi;
                api.events.onRowSelected((e) => { resolve(e); });
            });
        });

        // 2行目のセルをクリックして行選択を変更する
        // 仮想スクロール有効テーブル: [0]=header, [1]=topSpacer, [2]=データ行1, [3]=データ行2
        const secondRowCell = page.locator('.editor-left-pane .editor-table .editor-table-row:nth-child(4) .editor-table-cell:nth-child(2)');
        await secondRowCell.click();

        const event = await eventPromise;
        expect(event.tableName).toBe('test');
        // rowIndex はストアインデックス（0始まり）で通知される
        expect(event.rowIndex).toBe(1);
    });

    test('onRowSelected: dispose 後はイベントが発火しない', async ({ mockFileSystem, page }) => {
        await openTableAsync(page, 'test');

        // onRowSelected を登録して即座に dispose し、グローバルフラグで発火を追跡する
        await page.evaluate(() => {
            type FlagWindow = { __rowSelectedFired: boolean };
            (window as unknown as FlagWindow).__rowSelectedFired = false;
            const api = (window as unknown as { editorApi: {
                events: { onRowSelected(handler: (e: unknown) => void): { dispose(): void } };
            } }).editorApi;
            const sub = api.events.onRowSelected(() => {
                (window as unknown as FlagWindow).__rowSelectedFired = true;
            });
            // 購読解除する
            sub.dispose();
        });

        // 行クリックして行選択を変更する
        // 仮想スクロール有効テーブル: [0]=header, [1]=topSpacer, [2]=データ行1, [3]=データ行2
        const secondRowCell = page.locator('.editor-left-pane .editor-table .editor-table-row:nth-child(4) .editor-table-cell:nth-child(2)');
        await secondRowCell.click();

        // 行選択イベント処理の完了を待ってからフラグを確認する
        const fired = await page.evaluate(() => {
            return new Promise<boolean>((resolve) => {
                setTimeout(() => {
                    resolve((window as unknown as { __rowSelectedFired: boolean }).__rowSelectedFired);
                }, 300);
            });
        });
        expect(fired).toBe(false);
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

    test('ブリッジ: data.searchCellsAsync を呼び出せる', async ({ page }) => {
        await setupSearchApiTestAsync(page);

        const result = await page.evaluate(() => {
            return new Promise<unknown>((resolve) => {
                window.chrome.webview.addEventListener('message', (event: MessageEvent) => {
                    const data = JSON.parse(event.data);
                    if (data.type === 'editor_api_response') resolve(data);
                });
                window.chrome.webview.postMessage(JSON.stringify({
                    type: 'editor_api_request',
                    requestId: 'test-bridge-search',
                    method: 'data.searchCellsAsync',
                    params: {
                        queryText: 'quest.name = quest_a',
                        caseSensitive: false,
                        wholeWord: false,
                        useRegex: false,
                    },
                }));
            });
        });
        expect(result).toEqual({
            type: 'editor_api_response',
            requestId: 'test-bridge-search',
            success: true,
            data: [
                {
                    tableName: 'quest',
                    rowIndex: 0,
                    columnName: 'name',
                    columnIndex: 1,
                    pkValue: '1',
                    value: 'quest_a',
                    referenceDisplayText: '',
                },
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

// =============================================================================
// Phase 5: 参照ヒント・関連テーブルAPI (editorApi.data)
// =============================================================================

/**
 * FK参照を持つテーブル群のテスト用ファイルシステム
 * weapon（親）← shop_product（子）← order_detail（孫）の3階層
 */
function createReferenceFileSystem(): MockFileSystem {
    return {
        // weapon テーブル（参照先・親）— ja 列が表示列として使われる
        "schema/weapon.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "ja", type: "string" },
                { key: 2, name: "attack", type: "int" },
            ],
            primary_key: ["id"],
        }),
        "data/weapon.csv": "id,ja,attack\n1,炎の剣,150\n2,氷の杖,120\n3,雷の槍,180",
        // shop_product テーブル（weapon を参照する子テーブル）
        "schema/shop_product.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "ja", type: "string" },
                { key: 2, name: "weapon_id", type: "int", reference: "weapon.id" },
            ],
            primary_key: ["id"],
        }),
        "data/shop_product.csv": "id,ja,weapon_id\n1,商品A,1\n2,商品B,2",
        // order_detail テーブル（shop_product を参照する孫テーブル）
        "schema/order_detail.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "product_id", type: "int", reference: "shop_product.id" },
                { key: 2, name: "quantity", type: "int" },
            ],
            primary_key: ["id"],
        }),
        "data/order_detail.csv": "id,product_id,quantity\n10,1,5\n11,2,3\n12,1,2",
    };
}

/** 参照テスト用ページセットアップ（アプリ初期化完了まで待機する） */
async function setupReferenceTestAsync(page: Page): Promise<void> {
    const fs = createReferenceFileSystem();
    await installMockApiAsync(page, fs);
    await page.goto('/');
    // main.ts の非同期初期化が完了して editorApi が公開されるまで待機する
    await page.waitForFunction(() => (window as unknown as { editorApi: unknown }).editorApi !== undefined);
}

// --- getReferenceHintsAsync テスト ---

test.describe('Phase 5: getReferenceHintsAsync', () => {
    test('shop_product の参照ヒントを返す', async ({ page }) => {
        await setupReferenceTestAsync(page);
        const hints = await page.evaluate(() => {
            return (window as unknown as { editorApi: { data: { getReferenceHintsAsync(name: string): Promise<Record<string, Record<string, string>> | null> } } }).editorApi.data.getReferenceHintsAsync('shop_product');
        });
        // weapon_id 列の FK値 → 表示テキスト（ja列）のマッピング
        expect(hints).toEqual({
            weapon_id: {
                '1': '炎の剣',
                '2': '氷の杖',
                '3': '雷の槍',
            },
        });
    });

    test('FK参照のないテーブルは空オブジェクトを返す', async ({ page }) => {
        await setupReferenceTestAsync(page);
        const hints = await page.evaluate(() => {
            return (window as unknown as { editorApi: { data: { getReferenceHintsAsync(name: string): Promise<Record<string, Record<string, string>> | null> } } }).editorApi.data.getReferenceHintsAsync('weapon');
        });
        expect(hints).toEqual({});
    });

    test('未登録テーブルは null を返す', async ({ page }) => {
        await setupReferenceTestAsync(page);
        const hints = await page.evaluate(() => {
            return (window as unknown as { editorApi: { data: { getReferenceHintsAsync(name: string): Promise<Record<string, Record<string, string>> | null> } } }).editorApi.data.getReferenceHintsAsync('nonexistent');
        });
        expect(hints).toBeNull();
    });
});

// --- getRelatedTablesAsync テスト ---

test.describe('Phase 5: getRelatedTablesAsync', () => {
    test('shop_product の関連テーブルを返す', async ({ page }) => {
        await setupReferenceTestAsync(page);
        type RelatedTableInfo = { relationType: string; label: string; tableName: string; header: string[]; rows: string[][] };
        const related = await page.evaluate(() => {
            return (window as unknown as { editorApi: { data: { getRelatedTablesAsync(name: string): Promise<Array<{ relationType: string; label: string; tableName: string; header: string[]; rows: string[][] }> | null> } } }).editorApi.data.getRelatedTablesAsync('shop_product');
        }) as RelatedTableInfo[];
        // N:1 に weapon、1:N に order_detail が含まれること
        const n1 = related.filter(r => r.relationType === 'N:1');
        const oneN = related.filter(r => r.relationType === '1:N');
        expect(n1.length).toBe(1);
        expect(n1[0].tableName).toBe('weapon');
        expect(n1[0].label).toBe('weapon (weapon_id → weapon.id)');
        expect(oneN.length).toBe(1);
        expect(oneN[0].tableName).toBe('order_detail');
        expect(oneN[0].label).toBe('order_detail (order_detail.product_id → shop_product.id)');
    });

    test('N:1 関連テーブルはFK値でフィルタされた行のみ含む', async ({ page }) => {
        await setupReferenceTestAsync(page);
        type RelatedTableInfo = { relationType: string; label: string; tableName: string; header: string[]; rows: string[][] };
        const related = await page.evaluate(() => {
            return (window as unknown as { editorApi: { data: { getRelatedTablesAsync(name: string): Promise<Array<{ relationType: string; label: string; tableName: string; header: string[]; rows: string[][] }> | null> } } }).editorApi.data.getRelatedTablesAsync('shop_product');
        }) as RelatedTableInfo[];
        const weapon = related.find(r => r.tableName === 'weapon')!;
        // shop_product は weapon_id=1, 2 を参照 → weapon の id=1, 2 のみ含まれる（id=3 は除外）
        expect(weapon.header).toEqual(['id', 'ja', 'attack']);
        expect(weapon.rows).toEqual([
            ['1', '炎の剣', '150'],
            ['2', '氷の杖', '120'],
        ]);
    });

    test('1:N 関連テーブルはPK値でフィルタされた行のみ含む', async ({ page }) => {
        // order_detail に shop_product のPK値に含まれない product_id=99 の行を追加したデータで検証する
        const fs: MockFileSystem = {
            "schema/weapon.json": JSON.stringify({
                header: [
                    { key: 0, name: "id", type: "int" },
                    { key: 1, name: "ja", type: "string" },
                    { key: 2, name: "attack", type: "int" },
                ],
                primary_key: ["id"],
            }),
            "data/weapon.csv": "id,ja,attack\n1,炎の剣,150\n2,氷の杖,120\n3,雷の槍,180",
            "schema/shop_product.json": JSON.stringify({
                header: [
                    { key: 0, name: "id", type: "int" },
                    { key: 1, name: "ja", type: "string" },
                    { key: 2, name: "weapon_id", type: "int", reference: "weapon.id" },
                ],
                primary_key: ["id"],
            }),
            "data/shop_product.csv": "id,ja,weapon_id\n1,商品A,1\n2,商品B,2",
            "schema/order_detail.json": JSON.stringify({
                header: [
                    { key: 0, name: "id", type: "int" },
                    { key: 1, name: "product_id", type: "int", reference: "shop_product.id" },
                    { key: 2, name: "quantity", type: "int" },
                ],
                primary_key: ["id"],
            }),
            // product_id=99 は shop_product に存在しない → フィルタで除外されるべき
            "data/order_detail.csv": "id,product_id,quantity\n10,1,5\n11,2,3\n12,1,2\n13,99,1",
        };
        await installMockApiAsync(page, fs);
        await page.goto('/');
        await page.waitForFunction(() => (window as unknown as { editorApi: unknown }).editorApi !== undefined);
        type RelatedTableInfo = { relationType: string; label: string; tableName: string; header: string[]; rows: string[][] };
        const related = await page.evaluate(() => {
            return (window as unknown as { editorApi: { data: { getRelatedTablesAsync(name: string): Promise<Array<{ relationType: string; label: string; tableName: string; header: string[]; rows: string[][] }> | null> } } }).editorApi.data.getRelatedTablesAsync('shop_product');
        }) as RelatedTableInfo[];
        const orderDetail = related.find(r => r.tableName === 'order_detail')!;
        expect(orderDetail.header).toEqual(['id', 'product_id', 'quantity']);
        // product_id=99 の行はフィルタで除外され、PK値に含まれる行のみ返される
        expect(orderDetail.rows).toEqual([
            ['10', '1', '5'],
            ['11', '2', '3'],
            ['12', '1', '2'],
        ]);
    });

    test('FK参照も逆参照もないテーブルは空配列を返す', async ({ page }) => {
        // 孤立テーブルを作成する
        const fs: MockFileSystem = {
            "schema/isolated.json": JSON.stringify({
                header: [
                    { key: 0, name: "id", type: "int" },
                    { key: 1, name: "value", type: "string" },
                ],
                primary_key: ["id"],
            }),
            "data/isolated.csv": "id,value\n1,test",
        };
        await installMockApiAsync(page, fs);
        await page.goto('/');
        await page.waitForFunction(() => (window as unknown as { editorApi: unknown }).editorApi !== undefined);
        const related = await page.evaluate(() => {
            return (window as unknown as { editorApi: { data: { getRelatedTablesAsync(name: string): Promise<Array<unknown> | null> } } }).editorApi.data.getRelatedTablesAsync('isolated');
        });
        expect(related).toEqual([]);
    });

    test('未登録テーブルは null を返す', async ({ page }) => {
        await setupReferenceTestAsync(page);
        const related = await page.evaluate(() => {
            return (window as unknown as { editorApi: { data: { getRelatedTablesAsync(name: string): Promise<Array<unknown> | null> } } }).editorApi.data.getRelatedTablesAsync('nonexistent');
        });
        expect(related).toBeNull();
    });
});

/**
 * 全文検索APIテスト用のファイルシステム
 */
function createSearchApiFileSystem(): MockFileSystem {
    return {
        "schema/enemy.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "ja", type: "string" },
            ],
            primary_key: ["id"],
        }),
        "data/enemy.csv": "id,ja\n1,スライム\n2,ドラゴン",
        "schema/quest.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                { key: 2, name: "enemy_id", type: "int", reference: "enemy.id" },
            ],
            primary_key: ["id"],
        }),
        "data/quest.csv": "id,name,enemy_id\n1,quest_a,1\n2,quest_b,2",
    };
}

/** 全文検索APIテスト用ページセットアップ */
async function setupSearchApiTestAsync(page: Page): Promise<void> {
    await installMockApiAsync(page, createSearchApiFileSystem());
    await page.goto('/');
    await page.waitForFunction(() => (window as unknown as { editorApi: unknown }).editorApi !== undefined);
}

// =============================================================================
// Phase 6: 全文検索API (editorApi.data.searchCellsAsync)
// =============================================================================

test.describe('Phase 6: 全文検索API', () => {
    test('未オープンのテーブルも全文検索できる', async ({ page }) => {
        await setupSearchApiTestAsync(page);

        const results = await page.evaluate(() => {
            return (window as unknown as { editorApi: { data: {
                searchCellsAsync(
                    queryText: string,
                    caseSensitive: boolean,
                    wholeWord: boolean,
                    useRegex: boolean,
                ): Promise<Array<{
                    tableName: string;
                    rowIndex: number;
                    columnName: string;
                    columnIndex: number;
                    pkValue: string;
                    value: string;
                    referenceDisplayText: string;
                }>>;
            } } }).editorApi.data.searchCellsAsync('quest_a', false, false, false);
        });

        expect(results).toEqual([
            {
                tableName: 'quest',
                rowIndex: 0,
                columnName: 'name',
                columnIndex: 1,
                pkValue: '1',
                value: 'quest_a',
                referenceDisplayText: '',
            },
        ]);
    });

    test('開いているテーブルの未保存編集を検索結果に反映する', async ({ page }) => {
        await setupSearchApiTestAsync(page);
        await openTableAsync(page, 'quest');

        const edited = await page.evaluate(() => {
            return (window as unknown as { editorApi: { edit: {
                setCellValue(name: string, row: number, column: number, value: string): boolean;
            } } }).editorApi.edit.setCellValue('quest', 0, 1, 'quest_edited');
        });
        expect(edited).toBe(true);

        const results = await page.evaluate(() => {
            return (window as unknown as { editorApi: { data: {
                searchCellsAsync(
                    queryText: string,
                    caseSensitive: boolean,
                    wholeWord: boolean,
                    useRegex: boolean,
                ): Promise<Array<{
                    tableName: string;
                    rowIndex: number;
                    columnName: string;
                    columnIndex: number;
                    pkValue: string;
                    value: string;
                    referenceDisplayText: string;
                }>>;
            } } }).editorApi.data.searchCellsAsync('quest_edited', false, false, false);
        });

        expect(results).toEqual([
            {
                tableName: 'quest',
                rowIndex: 0,
                columnName: 'name',
                columnIndex: 1,
                pkValue: '1',
                value: 'quest_edited',
                referenceDisplayText: '',
            },
        ]);
    });
});
