import { CellRange } from "./selection";

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
    private tableElement: HTMLElement;
    private changes: CellChange[];
    private range: CellRange;
    private copyRange: CellRange;

    constructor(
        tableElement: HTMLElement,
        changes: CellChange[],
        range: CellRange,
        copyRange: CellRange
    ) {
        this.tableElement = tableElement;
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
        const rowElement = this.tableElement.children[row] as HTMLElement;
        if (!rowElement) return;

        const cell = rowElement.children[column] as HTMLElement;
        if (!cell) return;

        cell.textContent = value;
    }
}

/**
 * 列を挿入するコマンド
 * insertColumn/deleteColumnメソッドを呼び出す形で実装
 */
export class InsertColumnCommand implements Command {
    private editorTable: any; // EditorTable型への循環参照を避けるためany
    private columnIndex: number;
    private textField: any;
    private selection: any;
    private contextMenu: any;
    private history: any;

    constructor(
        editorTable: any,
        columnIndex: number,
        textField: any,
        selection: any,
        contextMenu: any,
        history: any
    ) {
        this.editorTable = editorTable;
        this.columnIndex = columnIndex;
        this.textField = textField;
        this.selection = selection;
        this.contextMenu = contextMenu;
        this.history = history;
    }

    execute(): void {
        this.editorTable.insertColumnInternal(this.columnIndex, this.textField, this.selection, this.contextMenu, this.history);
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
    private editorTable: any;
    private rowIndex: number;
    private textField: any;
    private selection: any;
    private contextMenu: any;
    private history: any;

    constructor(
        editorTable: any,
        rowIndex: number,
        textField: any,
        selection: any,
        contextMenu: any,
        history: any
    ) {
        this.editorTable = editorTable;
        this.rowIndex = rowIndex;
        this.textField = textField;
        this.selection = selection;
        this.contextMenu = contextMenu;
        this.history = history;
    }

    execute(): void {
        this.editorTable.insertRowInternal(this.rowIndex, this.textField, this.selection, this.contextMenu, this.history);
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
    private tableElement: HTMLElement;
    private columnIndex: number;
    private oldWidth: string;
    private newWidth: string;

    constructor(
        tableElement: HTMLElement,
        columnIndex: number,
        oldWidth: string,
        newWidth: string
    ) {
        this.tableElement = tableElement;
        this.columnIndex = columnIndex;
        this.oldWidth = oldWidth;
        this.newWidth = newWidth;
    }

    execute(): void {
        this.tableElement.style.setProperty(`--col-${this.columnIndex}-width`, this.newWidth);
    }

    undo(): void {
        this.tableElement.style.setProperty(`--col-${this.columnIndex}-width`, this.oldWidth);
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
    private tableElement: HTMLElement;
    private rowIndex: number;
    private oldHeight: string;
    private newHeight: string;

    constructor(
        tableElement: HTMLElement,
        rowIndex: number,
        oldHeight: string,
        newHeight: string
    ) {
        this.tableElement = tableElement;
        this.rowIndex = rowIndex;
        this.oldHeight = oldHeight;
        this.newHeight = newHeight;
    }

    execute(): void {
        this.tableElement.style.setProperty(`--row-${this.rowIndex}-height`, this.newHeight);
    }

    undo(): void {
        this.tableElement.style.setProperty(`--row-${this.rowIndex}-height`, this.oldHeight);
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
    private editorTable: any;
    private columnIndex: number;
    private textField: any;
    private selection: any;
    private contextMenu: any;
    private history: any;
    private deletedCellValues: string[];
    private deletedWidth: string;

    constructor(
        editorTable: any,
        columnIndex: number,
        textField: any,
        selection: any,
        contextMenu: any,
        history: any
    ) {
        this.editorTable = editorTable;
        this.columnIndex = columnIndex;
        this.textField = textField;
        this.selection = selection;
        this.contextMenu = contextMenu;
        this.history = history;
        this.deletedCellValues = [];
        this.deletedWidth = '';
    }

    execute(): void {
        const tableElement = this.editorTable.element;
        this.deletedCellValues = [];

        // 各行から削除する列のセル値を保存（列ヘッダー行を除く）
        for (let rowIdx = 1; rowIdx < tableElement.children.length; ++rowIdx) {
            const row = tableElement.children[rowIdx] as HTMLElement;
            const cell = row.children[this.columnIndex + 1] as HTMLElement;
            if (cell) {
                this.deletedCellValues.push(cell.textContent || '');
            }
        }

        // 列幅を保存
        this.deletedWidth = tableElement.style.getPropertyValue(`--col-${this.columnIndex}-width`) || '100px';

        // 列を削除
        this.editorTable.deleteColumn(this.columnIndex);
    }

    undo(): void {
        // 列を挿入
        this.editorTable.insertColumnInternal(this.columnIndex, this.textField, this.selection, this.contextMenu, this.history);

        // セル値を復元
        const tableElement = this.editorTable.element;
        for (let rowIdx = 1; rowIdx < tableElement.children.length; ++rowIdx) {
            const row = tableElement.children[rowIdx] as HTMLElement;
            const cell = row.children[this.columnIndex + 1] as HTMLElement;
            if (cell && this.deletedCellValues[rowIdx - 1] !== undefined) {
                cell.textContent = this.deletedCellValues[rowIdx - 1];
            }
        }

        // 列幅を復元
        tableElement.style.setProperty(`--col-${this.columnIndex}-width`, this.deletedWidth);
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
    private editorTable: any;
    private rowIndex: number;
    private textField: any;
    private selection: any;
    private contextMenu: any;
    private history: any;
    private deletedCellValues: string[];
    private deletedHeight: string;

    constructor(
        editorTable: any,
        rowIndex: number,
        textField: any,
        selection: any,
        contextMenu: any,
        history: any
    ) {
        this.editorTable = editorTable;
        this.rowIndex = rowIndex;
        this.textField = textField;
        this.selection = selection;
        this.contextMenu = contextMenu;
        this.history = history;
        this.deletedCellValues = [];
        this.deletedHeight = '';
    }

    execute(): void {
        const tableElement = this.editorTable.element;
        this.deletedCellValues = [];

        // 削除する行のセル値を保存（行ヘッダーセルを除く）
        const row = tableElement.children[this.rowIndex] as HTMLElement;
        if (row) {
            for (let colIdx = 1; colIdx < row.children.length; ++colIdx) {
                const cell = row.children[colIdx] as HTMLElement;
                if (cell) {
                    this.deletedCellValues.push(cell.textContent || '');
                }
            }

            // 行高を保存
            this.deletedHeight = tableElement.style.getPropertyValue(`--row-${this.rowIndex - 1}-height`) || '20px';
        }

        // 行を削除
        this.editorTable.deleteRow(this.rowIndex);
    }

    undo(): void {
        // 行を挿入
        this.editorTable.insertRowInternal(this.rowIndex, this.textField, this.selection, this.contextMenu, this.history);

        // セル値を復元
        const tableElement = this.editorTable.element;
        const row = tableElement.children[this.rowIndex] as HTMLElement;
        if (row) {
            for (let colIdx = 1; colIdx < row.children.length; ++colIdx) {
                const cell = row.children[colIdx] as HTMLElement;
                if (cell && this.deletedCellValues[colIdx - 1] !== undefined) {
                    cell.textContent = this.deletedCellValues[colIdx - 1];
                }
            }

            // 行高を復元
            tableElement.style.setProperty(`--row-${this.rowIndex - 1}-height`, this.deletedHeight);
        }
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
