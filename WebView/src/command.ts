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
        this.editorTable.replayCellChanges(this.changes);
    }

    undo(): void {
        // 逆順で元に戻す（oldValueとnewValueを反転した変更リストを構築）
        const undoChanges: CellChange[] = [];
        for (let i = this.changes.length - 1; i >= 0; i--) {
            const c = this.changes[i];
            undoChanges.push({ row: c.row, column: c.column, oldValue: c.newValue, newValue: c.oldValue });
        }
        this.editorTable.replayCellChanges(undoChanges);
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
}

/**
 * 複数のコマンドを順序付きで管理するCompositeコマンド
 *
 * execute/redoは登録順、undoは逆順で実行する。
 * ペースト時のCellChangeCommand + ViewRowRestructureCommand統合など、
 * 異種コマンドの原子的なUndo/Redoに使用する。
 */
export class CompositeCommand implements Command {
    private readonly commands: Command[];

    constructor(commands: Command[]) {
        this.commands = commands;
    }

    execute(): void {
        for (const cmd of this.commands) cmd.execute();
    }

    undo(): void {
        for (let i = this.commands.length - 1; i >= 0; i--) this.commands[i].undo();
    }

    redo(): void {
        for (const cmd of this.commands) cmd.redo();
    }

    getDescription(): string {
        return `Composite: ${this.commands.map(c => c.getDescription()).join(', ')}`;
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
 * 複数列を挿入するコマンド
 */
export class InsertColumnsCommand implements Command {
    private editorTable: EditorTable;
    private columnIndex: number;
    private count: number;

    constructor(
        editorTable: EditorTable,
        columnIndex: number,
        count: number
    ) {
        this.editorTable = editorTable;
        this.columnIndex = columnIndex;
        this.count = count;
    }

    execute(): void {
        for (let i = 0; i < this.count; ++i) {
            this.editorTable.insertColumnInternal(
                this.columnIndex
            );
        }
    }

    undo(): void {
        // 常にcolumnIndexの列を削除
        // （左の列が消えて次が繰り上がる）
        for (let i = 0; i < this.count; ++i) {
            this.editorTable.deleteColumn(
                this.columnIndex
            );
        }
    }

    redo(): void {
        this.execute();
    }

    getDescription(): string {
        return `InsertColumns: `
            + `${this.count} columns `
            + `at ${this.columnIndex}`;
    }

    getColumnIndex(): number {
        return this.columnIndex;
    }

    getCount(): number {
        return this.count;
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
 * 複数行を挿入するコマンド
 */
export class InsertRowsCommand implements Command {
    private editorTable: EditorTable;
    private rowIndex: number;
    private count: number;

    constructor(
        editorTable: EditorTable,
        rowIndex: number,
        count: number
    ) {
        this.editorTable = editorTable;
        this.rowIndex = rowIndex;
        this.count = count;
    }

    execute(): void {
        for (let i = 0; i < this.count; ++i) {
            this.editorTable.insertRowInternal(
                this.rowIndex
            );
        }
    }

    undo(): void {
        // 常にrowIndexの行を削除
        // （上の行が消えて次が繰り上がる）
        for (let i = 0; i < this.count; ++i) {
            this.editorTable.deleteRow(this.rowIndex);
        }
    }

    redo(): void {
        this.execute();
    }

    getDescription(): string {
        return `InsertRows: `
            + `${this.count} rows `
            + `at ${this.rowIndex}`;
    }

    getRowIndex(): number {
        return this.rowIndex;
    }

    getCount(): number {
        return this.count;
    }
}

/**
 * 複数行を削除するコマンド
 * DeleteRowCommandを内部で再利用する
 * Compositeパターン
 */
export class DeleteRowsCommand implements Command {
    private editorTable: EditorTable;
    private startRowIndex: number;
    private count: number;
    private deleteCommands: DeleteRowCommand[];

    constructor(
        editorTable: EditorTable,
        startRowIndex: number,
        count: number
    ) {
        this.editorTable = editorTable;
        this.startRowIndex = startRowIndex;
        this.count = count;
        this.deleteCommands = [];
    }

    execute(): void {
        this.deleteCommands = [];
        // 下から上へ削除（インデックスのずれを防止）
        for (
            let i = this.count - 1;
            i >= 0;
            --i
        ) {
            const command = new DeleteRowCommand(
                this.editorTable,
                this.startRowIndex + i
            );
            command.execute();
            this.deleteCommands.push(command);
        }
    }

    undo(): void {
        // 逆順でundo（上から下へ復元）
        for (
            let i = this.deleteCommands.length - 1;
            i >= 0;
            --i
        ) {
            this.deleteCommands[i].undo();
        }
    }

    redo(): void {
        this.execute();
    }

    getDescription(): string {
        return `DeleteRows: `
            + `${this.count} rows `
            + `at ${this.startRowIndex}`;
    }

    getRowIndex(): number {
        return this.startRowIndex;
    }

    getCount(): number {
        return this.count;
    }
}

/**
 * 複数列を削除するコマンド
 * DeleteColumnCommandを内部で再利用する
 * Compositeパターン
 */
export class DeleteColumnsCommand implements Command {
    private editorTable: EditorTable;
    private startColumnIndex: number;
    private count: number;
    private deleteCommands: DeleteColumnCommand[];

    constructor(
        editorTable: EditorTable,
        startColumnIndex: number,
        count: number
    ) {
        this.editorTable = editorTable;
        this.startColumnIndex = startColumnIndex;
        this.count = count;
        this.deleteCommands = [];
    }

    execute(): void {
        this.deleteCommands = [];
        // 右から左へ削除（インデックスのずれを防止）
        for (
            let i = this.count - 1;
            i >= 0;
            --i
        ) {
            const command = new DeleteColumnCommand(
                this.editorTable,
                this.startColumnIndex + i
            );
            command.execute();
            this.deleteCommands.push(command);
        }
    }

    undo(): void {
        // 逆順でundo（左から右へ復元）
        for (
            let i = this.deleteCommands.length - 1;
            i >= 0;
            --i
        ) {
            this.deleteCommands[i].undo();
        }
    }

    redo(): void {
        this.execute();
    }

    getDescription(): string {
        return `DeleteColumns: `
            + `${this.count} columns `
            + `at ${this.startColumnIndex}`;
    }

    getColumnIndex(): number {
        return this.startColumnIndex;
    }

    getCount(): number {
        return this.count;
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
            this.editorTable.updateCellValueAt(rowIdx, this.columnIndex + 1, this.deletedCellValues[rowIdx - 1]);
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
            this.editorTable.updateCellValueAt(this.rowIndex, colIdx + 1, this.deletedCellValues[colIdx]);
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
