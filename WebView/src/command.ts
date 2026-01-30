import { CellRange } from "./selection";
import { EditorTable } from "./editor-table";

/**
 * Undo/Redo可能なコマンドのインターフェース
 */
export interface Command {
    /**
     * コマンドを実行する
     */
    execute(): void;

    /**
     * コマンドを元に戻す
     */
    undo(): void;

    /**
     * コマンドを再実行する（デフォルトはexecuteと同じ）
     */
    redo(): void;

    /**
     * コマンドの説明（デバッグ用）
     */
    getDescription(): string;
}

/**
 * セルの変更情報
 */
export interface CellChange {
    row: number;
    column: number;
    oldValue: string;
    newValue: string;
}

/**
 * Undo/Redo操作の結果
 */
export interface HistoryResult {
    range: CellRange;
    copyRange: CellRange;
}

/**
 * セルの値を変更するコマンド
 */
export class CellChangeCommand implements Command {
    private editorTable: EditorTable;
    private changes: CellChange[];
    private range: CellRange;
    private copyRange: CellRange;

    constructor(
        editorTable: EditorTable,
        changes: CellChange[],
        range: CellRange,
        copyRange: CellRange
    ) {
        this.editorTable = editorTable;
        this.changes = changes;
        this.range = range;
        this.copyRange = copyRange;
    }

    execute(): void {
        for (const change of this.changes) {
            this.setCellValue(change.row, change.column, change.newValue);
        }
    }

    undo(): void {
        // 逆順で元に戻す
        for (let i = this.changes.length - 1; i >= 0; i--) {
            const change = this.changes[i];
            this.setCellValue(change.row, change.column, change.oldValue);
        }
    }

    redo(): void {
        this.execute();
    }

    getDescription(): string {
        return `CellChange: ${this.changes.length} cells`;
    }

    getRange(): CellRange {
        return this.range;
    }

    getCopyRange(): CellRange {
        return this.copyRange;
    }

    getChanges(): CellChange[] {
        return this.changes;
    }

    private setCellValue(row: number, column: number, value: string): void {
        this.editorTable.setCellValueAt(row, column, value);
    }
}

/**
 * 列を挿入するコマンド
 * insertColumn/deleteColumnメソッドを呼び出す形で実装
 */
export class InsertColumnCommand implements Command {
    private editorTable: EditorTable;
    private columnIndex: number;

    constructor(editorTable: EditorTable, columnIndex: number) {
        this.editorTable = editorTable;
        this.columnIndex = columnIndex;
    }

    execute(): void {
        this.editorTable.insertColumnInternal(this.columnIndex);
    }

    undo(): void {
        this.editorTable.deleteColumn(this.columnIndex);
    }

    redo(): void {
        this.execute();
    }

    getDescription(): string {
        return `InsertColumn at ${this.columnIndex}`;
    }

    getColumnIndex(): number {
        return this.columnIndex;
    }
}

/**
 * 行を挿入するコマンド
 * insertRow/deleteRowメソッドを呼び出す形で実装
 */
export class InsertRowCommand implements Command {
    private editorTable: EditorTable;
    private rowIndex: number;

    constructor(editorTable: EditorTable, rowIndex: number) {
        this.editorTable = editorTable;
        this.rowIndex = rowIndex;
    }

    execute(): void {
        this.editorTable.insertRowInternal(this.rowIndex);
    }

    undo(): void {
        this.editorTable.deleteRow(this.rowIndex);
    }

    redo(): void {
        this.execute();
    }

    getDescription(): string {
        return `InsertRow at ${this.rowIndex}`;
    }

    getRowIndex(): number {
        return this.rowIndex;
    }
}

/**
 * 列幅を変更するコマンド
 */
export class ColumnWidthCommand implements Command {
    private editorTable: EditorTable;
    private columnIndex: number;
    private oldWidth: string;
    private newWidth: string;

    constructor(
        editorTable: EditorTable,
        columnIndex: number,
        oldWidth: string,
        newWidth: string
    ) {
        this.editorTable = editorTable;
        this.columnIndex = columnIndex;
        this.oldWidth = oldWidth;
        this.newWidth = newWidth;
    }

    execute(): void {
        this.editorTable.setColumnWidth(this.columnIndex, this.newWidth);
    }

    undo(): void {
        this.editorTable.setColumnWidth(this.columnIndex, this.oldWidth);
    }

    redo(): void {
        this.execute();
    }

    getDescription(): string {
        return `ColumnWidth[${this.columnIndex}]: ${this.oldWidth} -> ${this.newWidth}`;
    }
}

/**
 * 行高を変更するコマンド
 */
export class RowHeightCommand implements Command {
    private editorTable: EditorTable;
    private rowIndex: number;
    private oldHeight: string;
    private newHeight: string;

    constructor(
        editorTable: EditorTable,
        rowIndex: number,
        oldHeight: string,
        newHeight: string
    ) {
        this.editorTable = editorTable;
        this.rowIndex = rowIndex;
        this.oldHeight = oldHeight;
        this.newHeight = newHeight;
    }

    execute(): void {
        this.editorTable.setRowHeight(this.rowIndex, this.newHeight);
    }

    undo(): void {
        this.editorTable.setRowHeight(this.rowIndex, this.oldHeight);
    }

    redo(): void {
        this.execute();
    }

    getDescription(): string {
        return `RowHeight[${this.rowIndex}]: ${this.oldHeight} -> ${this.newHeight}`;
    }
}

/**
 * 列を削除するコマンド
 * deleteColumn/insertColumnInternalメソッドを呼び出す形で実装
 */
export class DeleteColumnCommand implements Command {
    private editorTable: EditorTable;
    private columnIndex: number;
    private deletedHeaderValue: string;
    private deletedCellValues: string[];
    private deletedWidth: string;

    constructor(editorTable: EditorTable, columnIndex: number) {
        this.editorTable = editorTable;
        this.columnIndex = columnIndex;
        this.deletedHeaderValue = '';
        this.deletedCellValues = [];
        this.deletedWidth = '';
    }

    execute(): void {
        this.deletedCellValues = [];

        // 列ヘッダーの値を保存
        this.deletedHeaderValue = this.editorTable.getColumnHeaderValue(this.columnIndex);

        // 各行から削除する列のセル値を保存（列ヘッダー行を除く）
        const rowCount = this.editorTable.getRowCount();
        for (let rowIdx = 1; rowIdx < rowCount; ++rowIdx) {
            const value = this.editorTable.getCellValueAt(rowIdx, this.columnIndex + 1);
            this.deletedCellValues.push(value);
        }

        // 列幅を保存（セルのスタイルから取得）
        this.deletedWidth = this.editorTable.getColumnWidth(this.columnIndex);

        // 列を削除
        this.editorTable.deleteColumn(this.columnIndex);
    }

    undo(): void {
        // 列を挿入
        this.editorTable.insertColumnInternal(this.columnIndex);

        // 列ヘッダーの値を復元
        this.editorTable.setColumnHeaderValue(this.columnIndex, this.deletedHeaderValue);

        // セル値を復元
        const rowCount = this.editorTable.getRowCount();
        for (let rowIdx = 1; rowIdx < rowCount; ++rowIdx) {
            this.editorTable.setCellValueAt(rowIdx, this.columnIndex + 1, this.deletedCellValues[rowIdx - 1]);
        }

        // 列幅を復元（全セルに適用）
        this.editorTable.setColumnWidth(this.columnIndex, this.deletedWidth);
    }

    redo(): void {
        // 再削除時は再度データを保存する必要がある
        this.execute();
    }

    getDescription(): string {
        return `DeleteColumn at ${this.columnIndex}`;
    }

    getColumnIndex(): number {
        return this.columnIndex;
    }
}

/**
 * 行を削除するコマンド
 * deleteRow/insertRowInternalメソッドを呼び出す形で実装
 */
export class DeleteRowCommand implements Command {
    private editorTable: EditorTable;
    private rowIndex: number;
    private deletedCellValues: string[];
    private deletedHeight: string;

    constructor(editorTable: EditorTable, rowIndex: number) {
        this.editorTable = editorTable;
        this.rowIndex = rowIndex;
        this.deletedCellValues = [];
        this.deletedHeight = '';
    }

    execute(): void {
        this.deletedCellValues = [];

        // 削除する行のセル値を保存（行ヘッダーセルを除く）
        const columnCount = this.editorTable.getColumnCount();
        for (let colIdx = 0; colIdx < columnCount; ++colIdx) {
            const value = this.editorTable.getCellValueAt(this.rowIndex, colIdx + 1);
            this.deletedCellValues.push(value);
        }

        // 行高を保存（セルのスタイルから取得）
        this.deletedHeight = this.editorTable.getRowHeight(this.rowIndex);

        // 行を削除
        this.editorTable.deleteRow(this.rowIndex);
    }

    undo(): void {
        // 行を挿入
        this.editorTable.insertRowInternal(this.rowIndex);

        // セル値を復元
        const columnCount = this.editorTable.getColumnCount();
        for (let colIdx = 0; colIdx < columnCount; ++colIdx) {
            this.editorTable.setCellValueAt(this.rowIndex, colIdx + 1, this.deletedCellValues[colIdx]);
        }

        // 行高を復元（全セルに適用）
        this.editorTable.setRowHeight(this.rowIndex, this.deletedHeight);
    }

    redo(): void {
        // 再削除時は再度データを保存する必要がある
        this.execute();
    }

    getDescription(): string {
        return `DeleteRow at ${this.rowIndex}`;
    }

    getRowIndex(): number {
        return this.rowIndex;
    }
}
