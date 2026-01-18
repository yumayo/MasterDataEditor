import {EditorTableData} from "./model/editor-table-data";
import {Selection, CellPosition} from "./selection";
import {enableCellEditMode} from "./editor-actions";
import {GridTextField} from "./grid-textfield";
import {ContextMenu} from "./context-menu";
import {History} from "./history";
import {InsertColumnCommand, InsertRowCommand, DeleteColumnCommand, DeleteRowCommand} from "./command";
import {AreaResizer} from "./area-resizer";

export class EditorTable {
    readonly tableName: string;
    readonly tableData: EditorTableData;

    readonly element: HTMLElement;

    private selection!: Selection;
    private areaResizer!: AreaResizer;

    constructor(tableName: string, tableData: EditorTableData) {

        this.tableData = tableData;
        this.tableName = tableName;

        this.element = document.createElement('div');
    }
    
    setup(textField: GridTextField, selection: Selection, contextMenu: ContextMenu, history: History, areaResizer: AreaResizer) {

        // インスタンス変数に保存
        this.selection = selection;
        this.areaResizer = areaResizer;

        this.element.classList.add('editor-table');

        // CSS変数で列幅と行高を初期化
        for (let i = 0; i < this.tableData.header.length; ++i) {
            this.element.style.setProperty(`--col-${i}-width`, '100px');
        }
        // 列ヘッダー行 + ヘッダー5行 + データ行 + 空行
        const totalRows = 1 + 5 + this.tableData.body.length + (100 - this.tableData.body.length);
        for (let i = 0; i < totalRows; ++i) {
            this.element.style.setProperty(`--row-${i}-height`, '20px');
        }

        // 動的に行高と列幅のCSSルールを生成
        this.areaResizer.generateRowHeightStyles(totalRows);
        this.areaResizer.generateColumnWidthStyles(this.tableData.header.length);

        window.addEventListener('mousemove', (e) => {
            const target = e.target as HTMLElement;
            if (target.classList.contains('editor-table-cell')) {
                const position = EditorTable.getCellPosition(target, this.element);
                if (position) {
                    if (selection.isSelectingColumn()) {
                        // 列ヘッダーをドラッグ中: 列のみ更新
                        selection.updateColumn(position.column);
                    } else if (selection.isSelectingRow()) {
                        // 行ヘッダーをドラッグ中: 行のみ更新
                        selection.updateRow(position.row);
                    } else if (selection.isSelecting()) {
                        // 通常のセル選択
                        selection.extendSelection(position.row, position.column);
                    }
                }
            }
        });

        window.addEventListener('mouseup', () => {
            this.selection.end();
        });

        {
            const cells = [];
            // 左上隅の空セル
            const cornerCell = document.createElement('div');
            cornerCell.classList.add('editor-table-cell', 'editor-table-corner-cell');

            // コーナーセルクリックで全選択
            cornerCell.addEventListener('mousedown', () => {
                textField.submitText();
                textField.hide();
                selection.selectAll();
            });

            cells.push(cornerCell);

            // 列ヘッダー (A, B, C, ...)
            for (let i = 0; i < this.tableData.header.length; ++i) {
                const columnHeaderCell = document.createElement('div');
                columnHeaderCell.classList.add('editor-table-cell', 'editor-table-column-header');
                columnHeaderCell.textContent = this.tableData.header[i].name;
                columnHeaderCell.dataset.columnIndex = String(i);
                columnHeaderCell.dataset.col = String(i);

                // 列ヘッダークリックで列全体を選択
                columnHeaderCell.addEventListener('mousedown', (e) => {
                    textField.submitText();
                    textField.hide();

                    // DOM上の実際の位置から列インデックスを取得（列0は行ヘッダーなので+1）
                    const clickedColumnIndex = parseInt(columnHeaderCell.dataset.col!) + 1;

                    if (e.shiftKey) {
                        // Shift+クリック: 現在のアンカーから連続選択
                        selection.extendToColumn(clickedColumnIndex);
                    } else if (e.ctrlKey || e.metaKey) {
                        // Ctrl+クリック: 列を追加選択
                        selection.addColumn(clickedColumnIndex);
                    } else {
                        // 通常クリック: 列全体を選択
                        selection.selectColumn(clickedColumnIndex);
                    }
                });

                // 列ヘッダー右クリックでコンテキストメニューを表示
                columnHeaderCell.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // DOM上の実際の位置から列インデックスを取得
                    const contextMenuColumnIndex = parseInt(columnHeaderCell.dataset.col!);
                    contextMenu.show(e.clientX, e.clientY, [
                        {
                            label: '左に列を挿入',
                            action: () => {
                                this.insertColumn(contextMenuColumnIndex, textField, selection, contextMenu, history);
                            }
                        },
                        {
                            label: '右に列を挿入',
                            action: () => {
                                this.insertColumn(contextMenuColumnIndex + 1, textField, selection, contextMenu, history);
                            }
                        },
                        {
                            label: '列を削除',
                            action: () => {
                                this.removeColumn(contextMenuColumnIndex, textField, selection, contextMenu, history);
                            }
                        }
                    ]);
                });

                // リサイズハンドルを追加
                const resizeHandle = document.createElement('div');
                resizeHandle.classList.add('column-resize-handle');
                this.areaResizer.setupColumnResizeHandle(resizeHandle, columnHeaderCell, i);
                columnHeaderCell.appendChild(resizeHandle);

                cells.push(columnHeaderCell);
            }
            const columnHeaderRow = EditorTable.createRow(cells, 0);
            columnHeaderRow.classList.add('editor-table-column-header-row');
            this.element.appendChild(columnHeaderRow);
        }

        // 行ヘッダークリック用のハンドラ作成関数
        const createRowHeaderClickHandler = (rowHeaderCell: HTMLElement) => {
            return (e: MouseEvent) => {
                textField.submitText();
                textField.hide();

                // DOM上の実際の位置から行インデックスを取得
                const clickedRowIndex = parseInt(rowHeaderCell.dataset.rowIndex!) + 1;

                if (e.shiftKey) {
                    // Shift+クリック: 現在のアンカーから連続選択
                    selection.extendToRow(clickedRowIndex);
                } else if (e.ctrlKey || e.metaKey) {
                    // Ctrl+クリック: 行を追加選択
                    selection.addRow(clickedRowIndex);
                } else {
                    // 通常クリック: 行全体を選択
                    selection.selectRow(clickedRowIndex);
                }
            };
        };

        // 行ヘッダー右クリック用のハンドラ作成関数
        const createRowHeaderContextMenuHandler = (rowHeaderCell: HTMLElement) => {
            return (e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                // DOM上の実際の位置から行インデックスを取得
                const contextMenuRowIndex = parseInt(rowHeaderCell.dataset.rowIndex!) + 1;
                contextMenu.show(e.clientX, e.clientY, [
                    {
                        label: '上に行を挿入',
                        action: () => {
                            this.insertRow(contextMenuRowIndex, textField, selection, contextMenu, history);
                        }
                    },
                    {
                        label: '下に行を挿入',
                        action: () => {
                            this.insertRow(contextMenuRowIndex + 1, textField, selection, contextMenu, history);
                        }
                    },
                    {
                        label: '行を削除',
                        action: () => {
                            this.removeRow(contextMenuRowIndex, textField, selection, contextMenu, history);
                        }
                    }
                ]);
            };
        };

        for (let i = 0; i < this.tableData.body.length; ++i) {
            const cells = [];
            const rowIndex = i;
            const rowHeaderCell = this.createRowHeaderCell(String(i + 1), i, createRowHeaderClickHandler, createRowHeaderContextMenuHandler);

            cells.push(rowHeaderCell);

            for (let j = 0; j < this.tableData.header.length; ++j) {
                const cell = EditorTable.createCell(this, textField, selection, this.tableData.body[i].values[j], j);
                cells.push(cell);
            }
            const row = EditorTable.createRow(cells, rowIndex);
            this.element.appendChild(row);
        }

        for (let i = 0; i < 100 - this.tableData.body.length; ++i) {
            const cells = [];
            // 行ヘッダー (続き)
            const rowIndex = this.tableData.body.length + i;
            const rowHeaderCell = this.createRowHeaderCell(String(this.tableData.body.length + i + 1), this.tableData.body.length + i, createRowHeaderClickHandler, createRowHeaderContextMenuHandler);

            cells.push(rowHeaderCell);

            for (let j = 0; j < this.tableData.header.length; ++j) {
                const cell = EditorTable.createCell(this, textField, selection, '', j);
                cells.push(cell);
            }
            const row = EditorTable.createRow(cells, rowIndex);
            this.element.appendChild(row);
        }
    }

    /**
     * 列挿入の公開メソッド（Commandを使用してhistoryに追加）
     */
    public insertColumn(columnIndex: number, textField: GridTextField, selection: Selection, contextMenu: ContextMenu, history: History): void {
        const command = new InsertColumnCommand(
            this,
            columnIndex,
            textField,
            selection,
            contextMenu,
            history
        );
        const copyRange = selection.getCopyRange();
        const anchor = selection.getAnchor();
        history.executeCommand(command, {
            startRow: anchor.row,
            startColumn: anchor.column,
            endRow: anchor.row,
            endColumn: anchor.column
        }, copyRange);
    }

    /**
     * 列挿入の内部実装（Commandから呼び出される）
     */
    public insertColumnInternal(columnIndex: number, textField: GridTextField, selection: Selection, contextMenu: ContextMenu, history: History): void {
        // 列ヘッダー行から実際の列数を取得（行ヘッダーセルを除く）
        const columnHeaderRow = this.element.children[0];
        const totalColumns = columnHeaderRow.children.length - 1;

        // CSS変数を更新（既存の列をシフト）
        for (let i = totalColumns; i > columnIndex; --i) {
            const prevWidth = this.element.style.getPropertyValue(`--col-${i - 1}-width`) || '100px';
            this.element.style.setProperty(`--col-${i}-width`, prevWidth);
        }
        this.element.style.setProperty(`--col-${columnIndex}-width`, '100px');

        // 各行に新しいセルを挿入
        for (let currentRowIndex = 0; currentRowIndex < this.element.children.length; ++currentRowIndex) {
            const row = this.element.children[currentRowIndex] as HTMLElement;

            if (currentRowIndex === 0) {
                // 列ヘッダー行
                const newHeaderCell = document.createElement('div');
                newHeaderCell.classList.add('editor-table-cell', 'editor-table-column-header');
                newHeaderCell.dataset.columnIndex = String(columnIndex);
                newHeaderCell.dataset.col = String(columnIndex);

                // 列ヘッダーのテキストを更新（全列を再計算）
                const newColumnCount = totalColumns + 1;

                // 列ヘッダークリックで列全体を選択
                newHeaderCell.addEventListener('mousedown', (e) => {
                    textField.submitText();
                    textField.hide();

                    // DOM上の実際の位置から列インデックスを取得（列0は行ヘッダーなので+1）
                    const clickedColumnIndex = parseInt(newHeaderCell.dataset.col!) + 1;

                    if (e.shiftKey) {
                        selection.extendToColumn(clickedColumnIndex);
                    } else if (e.ctrlKey || e.metaKey) {
                        selection.addColumn(clickedColumnIndex);
                    } else {
                        selection.selectColumn(clickedColumnIndex);
                    }
                });

                // 列ヘッダー右クリックでコンテキストメニューを表示
                newHeaderCell.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // DOM上の実際の位置から列インデックスを取得
                    const contextMenuColumnIndex = parseInt(newHeaderCell.dataset.col!);
                    contextMenu.show(e.clientX, e.clientY, [
                        {
                            label: '左に列を挿入',
                            action: () => {
                                this.insertColumn(contextMenuColumnIndex, textField, selection, contextMenu, history);
                            }
                        },
                        {
                            label: '右に列を挿入',
                            action: () => {
                                this.insertColumn(contextMenuColumnIndex + 1, textField, selection, contextMenu, history);
                            }
                        },
                        {
                            label: '列を削除',
                            action: () => {
                                this.removeColumn(contextMenuColumnIndex, textField, selection, contextMenu, history);
                            }
                        }
                    ]);
                });

                // リサイズハンドルを追加
                const resizeHandle = document.createElement('div');
                resizeHandle.classList.add('column-resize-handle');
                this.areaResizer.setupColumnResizeHandle(resizeHandle, newHeaderCell, columnIndex);
                newHeaderCell.appendChild(resizeHandle);

                // 挿入位置（行ヘッダーの後、columnIndex番目）
                const insertBefore = row.children[columnIndex + 1];
                row.insertBefore(newHeaderCell, insertBefore);

                // 全列ヘッダーのラベルを更新
                for (let i = 0; i < newColumnCount; ++i) {
                    const headerCell = row.children[i + 1] as HTMLElement;
                    headerCell.dataset.columnIndex = String(i);
                    headerCell.dataset.col = String(i);
                    const label = i < this.tableData.header.length ? this.tableData.header[i].name : '';

                    // 既存のテキストノードを探して更新（リサイズハンドルは保持）
                    let textNode: Text | undefined;
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
                    const resizeHandle = headerCell.querySelector('.column-resize-handle');
                    if (resizeHandle) {
                        resizeHandle.remove();
                    }
                    const newResizeHandle = document.createElement('div');
                    newResizeHandle.classList.add('column-resize-handle');
                    this.areaResizer.setupColumnResizeHandle(newResizeHandle, headerCell, i);
                    headerCell.appendChild(newResizeHandle);
                }
            } else {
                // 通常の行
                const newCell = EditorTable.createCell(this, textField, selection, '', columnIndex);
                const insertBefore = row.children[columnIndex + 1];
                row.insertBefore(newCell, insertBefore);

                // 後続のセルのdata-colを更新
                for (let i = columnIndex + 1; i < row.children.length; ++i) {
                    const cell = row.children[i] as HTMLElement;
                    cell.dataset.col = String(i - 1);
                }
            }
        }

        // 列幅スタイルを再生成
        this.areaResizer.generateColumnWidthStyles(totalColumns + 1);
    }

    /**
     * 行挿入の公開メソッド（Commandを使用してhistoryに追加）
     */
    public insertRow(rowIndex: number, textField: GridTextField, selection: Selection, contextMenu: ContextMenu, history: History): void {
        const command = new InsertRowCommand(
            this,
            rowIndex,
            textField,
            selection,
            contextMenu,
            history
        );
        const copyRange = selection.getCopyRange();
        const anchor = selection.getAnchor();
        history.executeCommand(command, {
            startRow: anchor.row,
            startColumn: anchor.column,
            endRow: anchor.row,
            endColumn: anchor.column
        }, copyRange);
    }

    /**
     * 行挿入の内部実装（Commandから呼び出される）
     */
    public insertRowInternal(rowIndex: number, textField: GridTextField, selection: Selection, contextMenu: ContextMenu, history: History): void {
        const totalRows = this.element.children.length;
        // 列ヘッダー行から実際の列数を取得（行ヘッダーセルを除く）
        const columnHeaderRow = this.element.children[0];
        const columnCount = columnHeaderRow.children.length - 1;

        // CSS変数を更新（既存の行をシフト）
        for (let i = totalRows; i > rowIndex; --i) {
            const prevHeight = this.element.style.getPropertyValue(`--row-${i - 1}-height`) || '20px';
            this.element.style.setProperty(`--row-${i}-height`, prevHeight);
        }
        this.element.style.setProperty(`--row-${rowIndex}-height`, '20px');

        // 新しい行を作成
        const cells: HTMLElement[] = [];

        // 行ヘッダーを作成
        const rowHeaderCell = document.createElement('div');
        rowHeaderCell.classList.add('editor-table-cell', 'editor-table-row-header');
        rowHeaderCell.textContent = String(rowIndex);
        rowHeaderCell.dataset.rowIndex = String(rowIndex - 1);

        // 行ヘッダークリックで行全体を選択
        rowHeaderCell.addEventListener('mousedown', (e) => {
            textField.submitText();
            textField.hide();

            // DOM上の実際の位置から行インデックスを取得
            const clickedRowIndex = parseInt(rowHeaderCell.dataset.rowIndex!) + 1;

            if (e.shiftKey) {
                selection.extendToRow(clickedRowIndex);
            } else if (e.ctrlKey || e.metaKey) {
                selection.addRow(clickedRowIndex);
            } else {
                selection.selectRow(clickedRowIndex);
            }
        });

        // 行ヘッダー右クリックでコンテキストメニューを表示
        rowHeaderCell.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            // DOM上の実際の位置から行インデックスを取得
            const contextMenuRowIndex = parseInt(rowHeaderCell.dataset.rowIndex!) + 1;
            contextMenu.show(e.clientX, e.clientY, [
                {
                    label: '上に行を挿入',
                    action: () => {
                        this.insertRow(contextMenuRowIndex, textField, selection, contextMenu, history);
                    }
                },
                {
                    label: '下に行を挿入',
                    action: () => {
                        this.insertRow(contextMenuRowIndex + 1, textField, selection, contextMenu, history);
                    }
                },
                {
                    label: '行を削除',
                    action: () => {
                        this.removeRow(contextMenuRowIndex, textField, selection, contextMenu, history);
                    }
                }
            ]);
        });

        // リサイズハンドルを追加
        const resizeHandle = document.createElement('div');
        resizeHandle.classList.add('row-resize-handle');
        this.areaResizer.setupRowResizeHandle(resizeHandle, rowHeaderCell, rowIndex);
        rowHeaderCell.appendChild(resizeHandle);

        cells.push(rowHeaderCell);

        // データセルを作成
        for (let j = 0; j < columnCount; ++j) {
            const cell = EditorTable.createCell(this, textField, selection, '', j);
            cells.push(cell);
        }

        const newRow = EditorTable.createRow(cells, rowIndex);
        const insertBefore = this.element.children[rowIndex];
        this.element.insertBefore(newRow, insertBefore);

        // 後続の行のdata-rowと行ヘッダーの番号を更新
        for (let i = rowIndex + 1; i < this.element.children.length; ++i) {
            const row = this.element.children[i] as HTMLElement;
            row.dataset.row = String(i);
            const header = row.children[0] as HTMLElement;
            if (header.classList.contains('editor-table-row-header')) {
                // テキストノードを更新（リサイズハンドルは保持）
                let textNode: Text | undefined;
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

        // 行高スタイルを再生成
        this.areaResizer.generateRowHeightStyles(totalRows + 1);
    }

    /**
     * 列削除の公開メソッド（Commandを使用してhistoryに追加）
     */
    public removeColumn(columnIndex: number, textField: GridTextField, selection: Selection, contextMenu: ContextMenu, history: History): void {
        const command = new DeleteColumnCommand(
            this,
            columnIndex,
            textField,
            selection,
            contextMenu,
            history
        );
        const copyRange = selection.getCopyRange();
        const anchor = selection.getAnchor();
        history.executeCommand(command, {
            startRow: anchor.row,
            startColumn: anchor.column,
            endRow: anchor.row,
            endColumn: anchor.column
        }, copyRange);
    }

    /**
     * 行削除の公開メソッド（Commandを使用してhistoryに追加）
     */
    public removeRow(rowIndex: number, textField: GridTextField, selection: Selection, contextMenu: ContextMenu, history: History): void {
        const command = new DeleteRowCommand(
            this,
            rowIndex,
            textField,
            selection,
            contextMenu,
            history
        );
        const copyRange = selection.getCopyRange();
        const anchor = selection.getAnchor();
        history.executeCommand(command, {
            startRow: anchor.row,
            startColumn: anchor.column,
            endRow: anchor.row,
            endColumn: anchor.column
        }, copyRange);
    }

    private static createRow(cells: HTMLElement[], rowIndex?: number) {
        const row = document.createElement('div');
        row.classList.add('editor-table-row');
        if (rowIndex !== undefined) {
            row.dataset.row = String(rowIndex);
        }
        for (let i = 0; i < cells.length; ++i) {
            row.appendChild(cells[i]);
        }
        return row;
    }

    private static createCell(table: EditorTable, textField: GridTextField, selection: Selection, value: number | string | string[] | undefined, columnIndex: number) {
        const cell = document.createElement('div');
        cell.classList.add('editor-table-cell');
        cell.dataset.col = String(columnIndex);
        cell.addEventListener('dblclick', () => {
            enableCellEditMode(table, textField, selection, true);
        });
        cell.addEventListener('mousedown', (e) => {
            const position = EditorTable.getCellPosition(cell, table.element);
            if (!position) return;

            textField.submitText();
            textField.hide();

            if (e.shiftKey) {
                // Shift+クリック: 現在のアンカーから連続選択
                selection.extendSelection(position.row, position.column);
            } else {
                // 通常クリック: セルを選択
                selection.start(position.row, position.column);
            }
        });
        cell.textContent = value as any;
        return cell;
    }

    public static getCellPosition(cell: HTMLElement, tableElement: HTMLElement): CellPosition | null {
        let row: number = -1;
        for (let i = 0; i < tableElement.children.length; ++i) {
            if (tableElement.children[i] === cell.parentElement) {
                row = i;
                break;
            }
        }
        if (row === -1) return null;

        let column: number = -1;
        for (let i = 0; i < tableElement.children[row].children.length; ++i) {
            if (tableElement.children[row].children[i] === cell) {
                column = i;
                break;
            }
        }
        if (column === -1) return null;

        return {row, column};
    }

    private createRowHeaderCell(
        text: string,
        rowIndex: number,
        createClickHandler: (cell: HTMLElement) => (e: MouseEvent) => void,
        createContextMenuHandler: (cell: HTMLElement) => (e: MouseEvent) => void
    ): HTMLElement {
        const rowHeaderCell = document.createElement('div');
        rowHeaderCell.classList.add('editor-table-cell', 'editor-table-row-header');
        rowHeaderCell.textContent = text;
        rowHeaderCell.dataset.rowIndex = String(rowIndex);

        // 行ヘッダークリックで行全体を選択
        rowHeaderCell.addEventListener('mousedown', (e) => {
            // リサイズハンドルからのイベントは処理しない（stopPropagationされる）
            createClickHandler(rowHeaderCell)(e);
        });

        // 行ヘッダー右クリックでコンテキストメニューを表示
        rowHeaderCell.addEventListener('contextmenu', createContextMenuHandler(rowHeaderCell));

        const resizeHandle = document.createElement('div');
        resizeHandle.classList.add('row-resize-handle');
        this.areaResizer.setupRowResizeHandle(resizeHandle, rowHeaderCell, rowIndex + 1);
        rowHeaderCell.appendChild(resizeHandle);

        return rowHeaderCell;
    }

    /**
     * 列を削除する（Undo用）
     */
    public deleteColumn(columnIndex: number): void {
        const columnHeaderRow = this.element.children[0];
        const totalColumns = columnHeaderRow.children.length - 1;

        // 各行から指定位置のセルを削除
        for (let rowIdx = 0; rowIdx < this.element.children.length; ++rowIdx) {
            const row = this.element.children[rowIdx] as HTMLElement;
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
                    const label = i < this.tableData.header.length ? this.tableData.header[i].name : '';

                    let textNode: Text | undefined;
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
                    const resizeHandle = headerCell.querySelector('.column-resize-handle');
                    if (resizeHandle) {
                        resizeHandle.remove();
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

        // CSS変数をシフト
        for (let i = columnIndex; i < totalColumns - 1; ++i) {
            const nextWidth = this.element.style.getPropertyValue(`--col-${i + 1}-width`) || '100px';
            this.element.style.setProperty(`--col-${i}-width`, nextWidth);
        }
        this.element.style.removeProperty(`--col-${totalColumns - 1}-width`);

        // スタイルを再生成
        this.areaResizer.generateColumnWidthStyles(totalColumns - 1);
    }

    /**
     * 行を削除する（Undo用）
     */
    public deleteRow(rowIndex: number): void {
        const totalRows = this.element.children.length;

        // 指定位置の行を削除
        const rowToRemove = this.element.children[rowIndex];
        if (rowToRemove) {
            rowToRemove.remove();
        }

        // 後続の行のdata-rowと行ヘッダーの番号を更新
        for (let i = rowIndex; i < this.element.children.length; ++i) {
            const row = this.element.children[i] as HTMLElement;
            row.dataset.row = String(i);
            const header = row.children[0] as HTMLElement;
            if (header.classList.contains('editor-table-row-header')) {
                // テキストノードを更新（リサイズハンドルは保持）
                let textNode: Text | undefined;
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

        // CSS変数をシフト
        for (let i = rowIndex; i < totalRows - 1; ++i) {
            const nextHeight = this.element.style.getPropertyValue(`--row-${i + 1}-height`) || '20px';
            this.element.style.setProperty(`--row-${i}-height`, nextHeight);
        }
        this.element.style.removeProperty(`--row-${totalRows - 1}-height`);

        // スタイルを再生成
        this.areaResizer.generateRowHeightStyles(totalRows - 1);
    }
}
