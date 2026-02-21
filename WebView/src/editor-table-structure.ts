import {EditorTable} from "./editor-table";
import {Selection} from "./selection";
import {History} from "./history";
import {Command, InsertColumnCommand, InsertColumnsCommand, InsertRowCommand, InsertRowsCommand, DeleteColumnCommand, DeleteColumnsCommand, DeleteRowCommand, DeleteRowsCommand} from "./command";
import {AreaResizer} from "./area-resizer";
import {DEFAULT_COLUMN_WIDTH, DEFAULT_ROW_HEIGHT} from "./constant";

/**
 * テーブル構造操作モジュール
 *
 * 責務:
 * - 列の挿入・削除のDOM操作
 * - 行の挿入・削除のDOM操作
 * - 列ヘッダーセル・行ヘッダーセルの生成
 */
export class EditorTableStructure {
    private readonly table: EditorTable;
    private readonly selection: Selection;
    private readonly history: History;
    private readonly areaResizer: AreaResizer;

    constructor(table: EditorTable, selection: Selection, history: History, areaResizer: AreaResizer) {
        this.table = table;
        this.selection = selection;
        this.history = history;
        this.areaResizer = areaResizer;
    }

    /**
     * 列挿入の公開メソッド（Commandを使用してhistoryに追加）
     */
    insertColumn(columnIndex: number): void {
        this.insertColumns(columnIndex, 1);
    }

    /**
     * 複数列挿入の公開メソッド（Commandを使用してhistoryに追加）
     */
    insertColumns(columnIndex: number, count: number): void {
        let command: Command = new InsertColumnCommand(this.table, columnIndex);
        if (count > 1) {
            command = new InsertColumnsCommand(this.table, columnIndex, count);
        }
        const copyRange = this.selection.getCopyRange();
        const anchor = this.selection.getAnchor();
        this.history.executeCommand(command, {startRow: anchor.row, startColumn: anchor.column, endRow: anchor.row, endColumn: anchor.column}, copyRange);
    }

    /**
     * 列挿入の内部実装（Commandから呼び出される）
     */
    insertColumnInternal(columnIndex: number): void {
        const tableElement = this.table.getTableElement();
        // 各行に新しいセルを挿入
        for (let currentRowIndex = 0; currentRowIndex < tableElement.children.length; ++currentRowIndex) {
            const row = tableElement.children[currentRowIndex] as HTMLElement;
            if (currentRowIndex === 0) {
                // 列ヘッダー行
                // 挿入前に既存のラベルをDOMから取得
                const existingLabels: string[] = [];
                for (let i = 1; i < row.children.length; ++i) {
                    const headerCell = row.children[i] as HTMLElement;
                    let label = '';
                    for (const node of Array.from(headerCell.childNodes)) {
                        if (node.nodeType === Node.TEXT_NODE) {
                            label = node.textContent || '';
                            break;
                        }
                    }
                    existingLabels.push(label);
                }
                const newHeaderCell = this.createColumnHeaderCell('', columnIndex, DEFAULT_COLUMN_WIDTH);
                // 挿入位置（行ヘッダーの後、columnIndex番目）
                const insertBefore = row.children[columnIndex + 1];
                row.insertBefore(newHeaderCell, insertBefore);
                // 全列ヘッダーのラベルを更新（DOMから取得した既存ラベルを使用）
                const newColumnCount = existingLabels.length + 1;
                for (let i = 0; i < newColumnCount; ++i) {
                    const headerCell = row.children[i + 1] as HTMLElement;
                    headerCell.dataset.columnIndex = String(i);
                    headerCell.dataset.col = String(i);
                    let label = '';
                    if (i < columnIndex) {
                        label = existingLabels[i] || '';
                    } else if (i > columnIndex) {
                        label = existingLabels[i - 1] || '';
                    }
                    // 既存のテキストノードを探して更新（リサイズハンドルは保持）
                    let textNode: Text | false = false;
                    for (const node of Array.from(headerCell.childNodes)) {
                        if (node.nodeType === Node.TEXT_NODE) {
                            textNode = node as Text;
                            break;
                        }
                    }
                    if (textNode) {
                        textNode.textContent = label;
                    } else {
                        // テキストノードがない場合は先頭に挿入
                        headerCell.insertBefore(document.createTextNode(label), headerCell.firstChild);
                    }
                    // リサイズハンドルのイベントハンドラを再設定
                    const existingResizeHandle = headerCell.querySelector('.column-resize-handle');
                    if (existingResizeHandle) {
                        existingResizeHandle.remove();
                    }
                    const newResizeHandle = document.createElement('div');
                    newResizeHandle.classList.add('column-resize-handle');
                    this.areaResizer.setupColumnResizeHandle(newResizeHandle, headerCell, i);
                    headerCell.appendChild(newResizeHandle);
                }
            } else {
                // 通常の行: 行の高さは既存のセルから取得
                const newCell = EditorTable.createCell(this.table, '', columnIndex, DEFAULT_COLUMN_WIDTH, DEFAULT_ROW_HEIGHT);
                const insertBefore = row.children[columnIndex + 1];
                row.insertBefore(newCell, insertBefore);
                // 後続のセルのdata-colを更新
                for (let i = columnIndex + 1; i < row.children.length; ++i) {
                    const cell = row.children[i] as HTMLElement;
                    cell.dataset.col = String(i - 1);
                }
            }
        }
        // コピー範囲をクリア（列構造が変わったため）
        this.selection.clearCopyRange();
        // 選択範囲の描画を更新（ヘッダーの背景色を正しく表示するため）
        this.selection.updateRendererAfterResize();
    }

    /**
     * 行挿入の公開メソッド（Commandを使用してhistoryに追加）
     */
    insertRow(rowIndex: number): void {
        this.insertRows(rowIndex, 1);
    }

    /**
     * 複数行挿入の公開メソッド（Commandを使用してhistoryに追加）
     */
    insertRows(rowIndex: number, count: number): void {
        let command: Command = new InsertRowCommand(this.table, rowIndex);
        if (count > 1) {
            command = new InsertRowsCommand(this.table, rowIndex, count);
        }
        const copyRange = this.selection.getCopyRange();
        const anchor = this.selection.getAnchor();
        this.history.executeCommand(command, {startRow: anchor.row, startColumn: anchor.column, endRow: anchor.row, endColumn: anchor.column}, copyRange);
    }

    /**
     * 行挿入の内部実装（Commandから呼び出される）
     */
    insertRowInternal(rowIndex: number): void {
        const tableElement = this.table.getTableElement();
        // 列ヘッダー行から実際の列数を取得（行ヘッダーセルを除く）
        const columnHeaderRow = tableElement.children[0];
        const columnCount = columnHeaderRow.children.length - 1;
        // 新しい行を作成
        const cells: HTMLElement[] = [];
        // 行ヘッダーを作成
        const rowHeaderCell = this.createRowHeaderCell(String(rowIndex), rowIndex - 1);
        cells.push(rowHeaderCell);
        // データセルを作成（列幅は列ヘッダーから取得）
        for (let j = 0; j < columnCount; ++j) {
            const cell = EditorTable.createCell(this.table, '', j, DEFAULT_COLUMN_WIDTH, DEFAULT_ROW_HEIGHT);
            cells.push(cell);
        }
        const newRow = EditorTable.createRow(cells, rowIndex);
        const insertBefore = tableElement.children[rowIndex];
        tableElement.insertBefore(newRow, insertBefore);
        // 後続の行のdata-rowと行ヘッダーの番号を更新
        for (let i = rowIndex + 1; i < tableElement.children.length; ++i) {
            const row = tableElement.children[i] as HTMLElement;
            row.dataset.row = String(i);
            const header = row.children[0] as HTMLElement;
            if (header.classList.contains('editor-table-row-header')) {
                // テキストノードを更新（リサイズハンドルは保持）
                let textNode: Text | false = false;
                for (const node of Array.from(header.childNodes)) {
                    if (node.nodeType === Node.TEXT_NODE) {
                        textNode = node as Text;
                        break;
                    }
                }
                if (textNode) {
                    textNode.textContent = String(i);
                } else {
                    header.insertBefore(document.createTextNode(String(i)), header.firstChild);
                }
                header.dataset.rowIndex = String(i - 1);
                // リサイズハンドルのイベントハンドラを再設定
                const resizeHandle = header.querySelector('.row-resize-handle');
                if (resizeHandle) {
                    resizeHandle.remove();
                }
                const newResizeHandle = document.createElement('div');
                newResizeHandle.classList.add('row-resize-handle');
                this.areaResizer.setupRowResizeHandle(newResizeHandle, header, i);
                header.appendChild(newResizeHandle);
            }
        }
        // コピー範囲をクリア（行構造が変わったため）
        this.selection.clearCopyRange();
        // 選択範囲の描画を更新（ヘッダーの背景色を正しく表示するため）
        this.selection.updateRendererAfterResize();
    }

    /**
     * 列削除の公開メソッド（Commandを使用してhistoryに追加）
     */
    removeColumn(columnIndex: number): void {
        this.removeColumns(columnIndex, 1);
    }

    /**
     * 複数列削除の公開メソッド（Commandを使用してhistoryに追加）
     */
    removeColumns(startColumnIndex: number, count: number): void {
        const columnCount = this.table.getColumnCount();
        const maxCountFromStart = columnCount - startColumnIndex;
        const maxCountForKeepOne = columnCount - 1;
        const effectiveCount = Math.min(count, maxCountFromStart, maxCountForKeepOne);
        if (effectiveCount <= 0) return;
        let command: Command = new DeleteColumnCommand(this.table, startColumnIndex);
        if (effectiveCount > 1) {
            command = new DeleteColumnsCommand(this.table, startColumnIndex, effectiveCount);
        }
        const copyRange = this.selection.getCopyRange();
        const anchor = this.selection.getAnchor();
        this.history.executeCommand(command, {startRow: anchor.row, startColumn: anchor.column, endRow: anchor.row, endColumn: anchor.column}, copyRange);
    }

    /**
     * 行削除の公開メソッド（Commandを使用してhistoryに追加）
     */
    removeRow(rowIndex: number): void {
        this.removeRows(rowIndex, 1);
    }

    /**
     * 複数行削除の公開メソッド（Commandを使用してhistoryに追加）
     */
    removeRows(startRowIndex: number, count: number): void {
        let command: Command = new DeleteRowCommand(this.table, startRowIndex);
        if (count > 1) {
            command = new DeleteRowsCommand(this.table, startRowIndex, count);
        }
        const copyRange = this.selection.getCopyRange();
        const anchor = this.selection.getAnchor();
        this.history.executeCommand(command, {startRow: anchor.row, startColumn: anchor.column, endRow: anchor.row, endColumn: anchor.column}, copyRange);
    }

    /**
     * 列を削除する（Undo用）
     */
    deleteColumn(columnIndex: number): void {
        const tableElement = this.table.getTableElement();
        const columnHeaderRow = tableElement.children[0];
        const totalColumns = columnHeaderRow.children.length - 1;
        // 削除前に既存のラベルをDOMから取得
        const existingLabels: string[] = [];
        for (let i = 1; i < columnHeaderRow.children.length; ++i) {
            const headerCell = columnHeaderRow.children[i] as HTMLElement;
            let label = '';
            for (const node of Array.from(headerCell.childNodes)) {
                if (node.nodeType === Node.TEXT_NODE) {
                    label = node.textContent || '';
                    break;
                }
            }
            existingLabels.push(label);
        }
        // 各行から指定位置のセルを削除
        for (let rowIdx = 0; rowIdx < tableElement.children.length; ++rowIdx) {
            const row = tableElement.children[rowIdx] as HTMLElement;
            // columnIndex + 1 は行ヘッダーを除いた位置
            const cellToRemove = row.children[columnIndex + 1];
            if (cellToRemove) {
                cellToRemove.remove();
            }
            // 列ヘッダー行の場合、ラベルを更新
            if (rowIdx === 0) {
                for (let i = 0; i < totalColumns - 1; ++i) {
                    const headerCell = row.children[i + 1] as HTMLElement;
                    headerCell.dataset.columnIndex = String(i);
                    headerCell.dataset.col = String(i);
                    let label = '';
                    if (i < columnIndex) {
                        label = existingLabels[i] || '';
                    } else {
                        label = existingLabels[i + 1] || '';
                    }
                    let textNode: Text | false = false;
                    for (const node of Array.from(headerCell.childNodes)) {
                        if (node.nodeType === Node.TEXT_NODE) {
                            textNode = node as Text;
                            break;
                        }
                    }
                    if (textNode) {
                        textNode.textContent = label;
                    } else {
                        headerCell.insertBefore(document.createTextNode(label), headerCell.firstChild);
                    }
                    // リサイズハンドルのイベントハンドラを再設定
                    const existingResizeHandle = headerCell.querySelector('.column-resize-handle');
                    if (existingResizeHandle) {
                        existingResizeHandle.remove();
                    }
                    const newResizeHandle = document.createElement('div');
                    newResizeHandle.classList.add('column-resize-handle');
                    this.areaResizer.setupColumnResizeHandle(newResizeHandle, headerCell, i);
                    headerCell.appendChild(newResizeHandle);
                }
            } else {
                // data-colを更新
                for (let i = columnIndex; i < row.children.length - 1; ++i) {
                    const cell = row.children[i + 1] as HTMLElement;
                    cell.dataset.col = String(i);
                }
            }
        }
        // コピー範囲をクリア（列構造が変わったため）
        this.selection.clearCopyRange();
        // 選択範囲の描画を更新（ヘッダーの背景色を正しく表示するため）
        this.selection.updateRendererAfterResize();
    }

    /**
     * 行を削除する（Undo用）
     */
    deleteRow(rowIndex: number): void {
        const tableElement = this.table.getTableElement();
        // 指定位置の行を削除
        const rowToRemove = tableElement.children[rowIndex];
        if (rowToRemove) {
            rowToRemove.remove();
        }
        // 後続の行のdata-rowと行ヘッダーの番号を更新
        for (let i = rowIndex; i < tableElement.children.length; ++i) {
            const row = tableElement.children[i] as HTMLElement;
            row.dataset.row = String(i);
            const header = row.children[0] as HTMLElement;
            if (header.classList.contains('editor-table-row-header')) {
                // テキストノードを更新（リサイズハンドルは保持）
                let textNode: Text | false = false;
                for (const node of Array.from(header.childNodes)) {
                    if (node.nodeType === Node.TEXT_NODE) {
                        textNode = node as Text;
                        break;
                    }
                }
                if (textNode) {
                    textNode.textContent = String(i);
                } else {
                    header.insertBefore(document.createTextNode(String(i)), header.firstChild);
                }
                header.dataset.rowIndex = String(i - 1);
                // リサイズハンドルのイベントハンドラを再設定
                const resizeHandle = header.querySelector('.row-resize-handle');
                if (resizeHandle) {
                    resizeHandle.remove();
                }
                const newResizeHandle = document.createElement('div');
                newResizeHandle.classList.add('row-resize-handle');
                this.areaResizer.setupRowResizeHandle(newResizeHandle, header, i);
                header.appendChild(newResizeHandle);
            }
        }
        // コピー範囲をクリア（行構造が変わったため）
        this.selection.clearCopyRange();
        // 選択範囲の描画を更新（ヘッダーの背景色を正しく表示するため）
        this.selection.updateRendererAfterResize();
    }

    /**
     * 列ヘッダーセルを生成する
     */
    createColumnHeaderCell(text: string, columnIndex: number, width: string): HTMLElement {
        const columnHeaderCell = document.createElement('div');
        columnHeaderCell.classList.add('editor-table-cell', 'editor-table-column-header');
        columnHeaderCell.textContent = text;
        columnHeaderCell.dataset.columnIndex = String(columnIndex);
        columnHeaderCell.dataset.col = String(columnIndex);
        EditorTable.applyCellWidth(columnHeaderCell, width);
        EditorTable.applyCellHeight(columnHeaderCell, DEFAULT_ROW_HEIGHT);
        // 列ヘッダークリックで列全体を選択
        columnHeaderCell.addEventListener('mousedown', this.table.contextMenuHandler.createColumnHeaderClickHandler(columnHeaderCell));
        // 列ヘッダー右クリックでコンテキストメニュー
        columnHeaderCell.addEventListener('contextmenu', this.table.contextMenuHandler.createColumnHeaderContextMenuHandler(columnHeaderCell));
        const resizeHandle = document.createElement('div');
        resizeHandle.classList.add('column-resize-handle');
        this.areaResizer.setupColumnResizeHandle(resizeHandle, columnHeaderCell, columnIndex);
        columnHeaderCell.appendChild(resizeHandle);
        return columnHeaderCell;
    }

    /**
     * 行ヘッダーセルを生成する
     */
    createRowHeaderCell(text: string, rowIndex: number): HTMLElement {
        const rowHeaderCell = document.createElement('div');
        rowHeaderCell.classList.add('editor-table-cell', 'editor-table-row-header');
        rowHeaderCell.textContent = text;
        rowHeaderCell.dataset.rowIndex = String(rowIndex);
        EditorTable.applyCellHeight(rowHeaderCell, DEFAULT_ROW_HEIGHT);
        // 行ヘッダークリックで行全体を選択
        rowHeaderCell.addEventListener('mousedown', this.table.contextMenuHandler.createRowHeaderClickHandler(rowHeaderCell));
        // 行ヘッダー右クリックでコンテキストメニュー
        rowHeaderCell.addEventListener('contextmenu', this.table.contextMenuHandler.createRowHeaderContextMenuHandler(rowHeaderCell));
        const resizeHandle = document.createElement('div');
        resizeHandle.classList.add('row-resize-handle');
        this.areaResizer.setupRowResizeHandle(resizeHandle, rowHeaderCell, rowIndex + 1);
        rowHeaderCell.appendChild(resizeHandle);
        return rowHeaderCell;
    }
}
