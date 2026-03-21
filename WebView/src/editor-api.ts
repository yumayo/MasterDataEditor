import {InMemoryTableStore} from "./in-memory-table-store";
import {Tab} from "./tab";
import {CellChangeCommand, CellChange, InsertRowCommand, DeleteRowCommand} from "./command";
import type {EditorAPI, EditorDataAPI, EditorSchemaAPI, EditorEditAPI, EditorEventsAPI, EditorDisposable, EditorCellChangeEvent, SchemaEntry} from "./editor-api-types";

/**
 * EditorAPI の実装
 *
 * ストア・タブ・スキーマレジストリを密結合で保持し、
 * data/schema/edit/events の4名前空間を提供する。
 * window.editorApi として公開され、C# ブリッジやe2eテストから利用される。
 */
export class EditorApiImpl implements EditorAPI {
    readonly data: EditorDataAPI;
    readonly schema: EditorSchemaAPI;
    readonly edit: EditorEditAPI;
    readonly events: EditorEventsAPI;

    // イベントハンドラーリスト（events 名前空間の emit で使用する）
    private readonly cellChangedHandlers: Array<(event: EditorCellChangeEvent) => void>;
    private readonly tableOpenedHandlers: Array<(event: { tableName: string }) => void>;
    private readonly tableClosedHandlers: Array<(event: { tableName: string }) => void>;

    constructor(store: InMemoryTableStore, tab: Tab, schemaRegistry: Map<string, SchemaEntry>) {
        this.cellChangedHandlers = [];
        this.tableOpenedHandlers = [];
        this.tableClosedHandlers = [];

        // data 名前空間: ストアからの読み取り（ディープコピーを返して内部データを保護する）
        this.data = {
            getTableNames(): string[] {
                return store.getTableNames();
            },
            getHeader(tableName: string): string[] | null {
                const header = store.getHeader(tableName);
                if (header === false) return null;
                return [...header];
            },
            getRows(tableName: string): string[][] | null {
                const rows = store.getRows(tableName);
                if (rows === false) return null;
                return rows.map(r => [...r]);
            },
            getRowCount(tableName: string): number | null {
                const rows = store.getRows(tableName);
                if (rows === false) return null;
                return rows.length;
            },
            getCellValue(tableName: string, row: number, column: number): string | null {
                const rows = store.getRows(tableName);
                if (rows === false) return null;
                if (row < 0 || row >= rows.length) return null;
                const rowData = rows[row];
                if (column < 0 || column >= rowData.length) return null;
                return rowData[column];
            },
        };

        // schema 名前空間: スキーマレジストリからの読み取り
        this.schema = {
            getSchemaTableNames(): string[] {
                return [...schemaRegistry.keys()];
            },
            getColumns(tableName: string): Array<{ name: string; type: string }> | null {
                const entry = schemaRegistry.get(tableName);
                if (!entry) return null;
                return entry.columns.map(c => ({ name: c.name, type: c.type }));
            },
            getPrimaryKeys(tableName: string): string[] | null {
                const entry = schemaRegistry.get(tableName);
                if (!entry) return null;
                return [...entry.primaryKeys];
            },
            getReferences(tableName: string): Array<{ columnName: string; targetTable: string; targetColumn: string }> | null {
                const entry = schemaRegistry.get(tableName);
                if (!entry) return null;
                return entry.references.map(r => ({ columnName: r.columnName, targetTable: r.targetTable, targetColumn: r.targetColumn }));
            },
        };

        // edit 名前空間のクロージャから cellChangedHandlers にアクセスするためのキャプチャ
        const cellChangedHandlers = this.cellChangedHandlers;

        // edit 名前空間: コマンドパターンを使った書き込み操作（Undo/Redo 対応）
        // EditorAPI の row/column はストアインデックス（0始まり）だが、
        // CellChangeCommand が呼ぶ updateCellValueAt() は DOM インデックス（1始まり: ヘッダー行/行ヘッダー列を含む）を期待する。
        // 変換: domRow = storeRow + 1, domColumn = storeColumn + 1
        // InsertRowCommand / DeleteRowCommand の rowIndex も DOM データ行インデックス（1始まり）を期待する。
        // 変換: domRowIndex = storeRowIndex + 1
        this.edit = {
            setCellValue(tableName: string, row: number, column: number, value: string): boolean {
                const tabState = tab.getTabStateByName(tableName);
                if (!tabState) return false;
                const rows = store.getRows(tableName);
                if (rows === false) return false;
                if (row < 0 || row >= rows.length) return false;
                if (column < 0 || column >= rows[row].length) return false;
                const oldValue = rows[row][column];
                // DOM インデックスに変換する
                const domRow = row + 1;
                const domColumn = column + 1;
                const changes: CellChange[] = [{ row: domRow, column: domColumn, oldValue, newValue: value }];
                const range = { startRow: domRow, startColumn: domColumn, endRow: domRow, endColumn: domColumn };
                const command = new CellChangeCommand(tabState.editorTable, changes, range, range);
                tabState.history.executeCommand(command, range, range);
                // セル変更イベントはストアインデックスで発火する（外部API視点）
                for (let i = 0; i < cellChangedHandlers.length; ++i) {
                    try { cellChangedHandlers[i]({ tableName, row, column, oldValue, newValue: value }); } catch (e) { console.error('[EditorAPI] イベントハンドラーでエラーが発生しました:', e); }
                }
                return true;
            },
            setCellValues(tableName: string, changes: Array<{ row: number; column: number; value: string }>): boolean {
                const tabState = tab.getTabStateByName(tableName);
                if (!tabState) return false;
                const rows = store.getRows(tableName);
                if (rows === false) return false;
                // 全変更の oldValue を取得して CellChange[] を構築する（DOM インデックスに変換）
                const cellChanges: CellChange[] = [];
                for (let i = 0; i < changes.length; ++i) {
                    const c = changes[i];
                    if (c.row < 0 || c.row >= rows.length) return false;
                    if (c.column < 0 || c.column >= rows[c.row].length) return false;
                    cellChanges.push({ row: c.row + 1, column: c.column + 1, oldValue: rows[c.row][c.column], newValue: c.value });
                }
                // 空配列の場合は何もせず成功を返す
                if (cellChanges.length === 0) return true;
                // 範囲は DOM インデックスで包含するバウンディングボックスとする
                let minRow = cellChanges[0].row, maxRow = cellChanges[0].row;
                let minCol = cellChanges[0].column, maxCol = cellChanges[0].column;
                for (let i = 1; i < cellChanges.length; ++i) {
                    if (cellChanges[i].row < minRow) minRow = cellChanges[i].row;
                    if (cellChanges[i].row > maxRow) maxRow = cellChanges[i].row;
                    if (cellChanges[i].column < minCol) minCol = cellChanges[i].column;
                    if (cellChanges[i].column > maxCol) maxCol = cellChanges[i].column;
                }
                const range = { startRow: minRow, startColumn: minCol, endRow: maxRow, endColumn: maxCol };
                const command = new CellChangeCommand(tabState.editorTable, cellChanges, range, range);
                tabState.history.executeCommand(command, range, range);
                // セル変更イベントはストアインデックスで発火する（外部API視点）
                // oldValue は cellChanges から取得する（executeCommand 後はストアが更新済みのため rows を参照してはならない）
                for (let i = 0; i < cellChanges.length; ++i) {
                    const cc = cellChanges[i];
                    const c = changes[i];
                    for (let j = 0; j < cellChangedHandlers.length; ++j) {
                        try { cellChangedHandlers[j]({ tableName, row: c.row, column: c.column, oldValue: cc.oldValue, newValue: c.value }); } catch (e) { console.error('[EditorAPI] イベントハンドラーでエラーが発生しました:', e); }
                    }
                }
                return true;
            },
            insertRow(tableName: string, rowIndex: number): boolean {
                const tabState = tab.getTabStateByName(tableName);
                if (!tabState) return false;
                const rows = store.getRows(tableName);
                if (rows === false) return false;
                // 末尾挿入（rowIndex === rows.length）を許可するため > で比較する
                if (rowIndex < 0 || rowIndex > rows.length) return false;
                const header = store.getHeader(tableName);
                if (header === false) return false;
                // DOM データ行インデックスに変換する
                const domRowIndex = rowIndex + 1;
                const command = new InsertRowCommand(tabState.editorTable, domRowIndex);
                const range = { startRow: domRowIndex, startColumn: 1, endRow: domRowIndex, endColumn: header.length };
                tabState.history.executeCommand(command, range, range);
                return true;
            },
            deleteRow(tableName: string, rowIndex: number): boolean {
                const tabState = tab.getTabStateByName(tableName);
                if (!tabState) return false;
                const rows = store.getRows(tableName);
                if (rows === false) return false;
                if (rowIndex < 0 || rowIndex >= rows.length) return false;
                const header = store.getHeader(tableName);
                if (header === false) return false;
                // DOM データ行インデックスに変換する
                const domRowIndex = rowIndex + 1;
                const command = new DeleteRowCommand(tabState.editorTable, domRowIndex);
                const range = { startRow: domRowIndex, startColumn: 1, endRow: domRowIndex, endColumn: header.length };
                tabState.history.executeCommand(command, range, range);
                return true;
            },
        };

        // events 名前空間: イベント購読
        this.events = {
            onCellChanged: (handler: (event: EditorCellChangeEvent) => void): EditorDisposable => {
                this.cellChangedHandlers.push(handler);
                return { dispose: () => { const idx = this.cellChangedHandlers.indexOf(handler); if (idx !== -1) this.cellChangedHandlers.splice(idx, 1); } };
            },
            onTableOpened: (handler: (event: { tableName: string }) => void): EditorDisposable => {
                this.tableOpenedHandlers.push(handler);
                return { dispose: () => { const idx = this.tableOpenedHandlers.indexOf(handler); if (idx !== -1) this.tableOpenedHandlers.splice(idx, 1); } };
            },
            onTableClosed: (handler: (event: { tableName: string }) => void): EditorDisposable => {
                this.tableClosedHandlers.push(handler);
                return { dispose: () => { const idx = this.tableClosedHandlers.indexOf(handler); if (idx !== -1) this.tableClosedHandlers.splice(idx, 1); } };
            },
        };
    }

    /** テーブルオープンイベントを発火する（Tab.enableTabButton から呼ばれる） */
    emitTableOpened(tableName: string): void {
        for (let i = 0; i < this.tableOpenedHandlers.length; ++i) {
            try { this.tableOpenedHandlers[i]({ tableName }); } catch (e) { console.error('[EditorAPI] イベントハンドラーでエラーが発生しました:', e); }
        }
    }

    /** テーブルクローズイベントを発火する（Tab.performCloseTab から呼ばれる） */
    emitTableClosed(tableName: string): void {
        for (let i = 0; i < this.tableClosedHandlers.length; ++i) {
            try { this.tableClosedHandlers[i]({ tableName }); } catch (e) { console.error('[EditorAPI] イベントハンドラーでエラーが発生しました:', e); }
        }
    }
}
