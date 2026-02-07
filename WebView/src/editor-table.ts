import {EditorTableData} from "./model/editor-table-data";
import {Selection, CellPosition} from "./selection";
import {EditorTableHandler} from "./editor-table-handler";
import {ContextMenu} from "./context-menu";
import {History} from "./history";
import {InsertColumnCommand, InsertRowCommand, DeleteColumnCommand, DeleteRowCommand} from "./command";
import {AreaResizer} from "./area-resizer";
import {DEFAULT_COLUMN_WIDTH, DEFAULT_ROW_HEIGHT} from "./constant";
import {ScrollViewportController} from "./scroll-viewport-controller";
import {SelectionDragController} from "./selection-drag-controller";
import {ReferenceDataCache} from "./reference-data-cache";
import {parseReferenceExpression, isDynamicReference} from "./reference-expression";

export class EditorTable {
    readonly tableName: string;
    private readonly tableData: EditorTableData;

    private readonly element: HTMLElement;

    private readonly selection: Selection;
    private readonly areaResizer: AreaResizer;
    private readonly handler: EditorTableHandler;
    private readonly contextMenu: ContextMenu;
    private readonly history: History;
    private readonly selectionDragController: SelectionDragController;
    private readonly scrollBinding: ScrollViewportController;
    private lastScrollLeft = -1;
    private readonly referenceDataCache: ReferenceDataCache;

    constructor(
        tableName: string,
        tableData: EditorTableData,
        referenceDataCache: ReferenceDataCache,
        handler: EditorTableHandler,
        selection: Selection,
        contextMenu: ContextMenu,
        history: History,
        areaResizer: AreaResizer,
        scrollBinding: ScrollViewportController
    ) {
        this.tableData = tableData;
        this.tableName = tableName;
        this.referenceDataCache = referenceDataCache;
        this.handler = handler;
        this.selection = selection;
        this.contextMenu = contextMenu;
        this.history = history;
        this.areaResizer = areaResizer;
        this.scrollBinding = scrollBinding;

        this.element = document.createElement('div');

        this.selectionDragController = new SelectionDragController(
            this.element,
            selection,
            scrollBinding
        );
    }

    /**
     * 参照データのpreload完了後にセルの参照ヒントを更新する
     */
    updateReferenceHints(): void {
        // 全データ行のセルを更新
        for (let rowIndex = 1; rowIndex < this.element.children.length; rowIndex++) {
            const row = this.element.children[rowIndex] as HTMLElement;
            // 列ヘッダーは除く（column=0が行ヘッダー、column=1以降がデータセル）
            for (let colIndex = 1; colIndex < row.children.length; colIndex++) {
                const cell = row.children[colIndex] as HTMLElement;
                const dataColumnIndex = colIndex - 1;
                const value = EditorTable.getCellValue(cell);
                this.setCellValue(cell, value, dataColumnIndex, rowIndex);
            }
        }
    }

    /**
     * 指定した列のすべてのセルの参照ヒントを更新する
     */
    updateColumnReferenceHints(columnIndex: number): void {
        for (let rowIndex = 1; rowIndex < this.element.children.length; rowIndex++) {
            const row = this.element.children[rowIndex] as HTMLElement;
            const cell = row.children[columnIndex + 1] as HTMLElement;
            if (cell) {
                const value = EditorTable.getCellValue(cell);
                this.setCellValue(cell, value, columnIndex, rowIndex);
            }
        }
    }
    
    /**
     * テーブル要素を親要素に追加する
     * @param parent 親要素
     */
    appendTo(parent: HTMLElement): void {
        parent.appendChild(this.element);
    }

    /**
     * DOM要素を構築し、イベントリスナーを登録する
     * ファクトリ関数から呼び出される
     */
    initialize(): void {
        this.element.classList.add('editor-table');

        {
            const cells = [];
            // 左上隅の空セル
            const cornerCell = document.createElement('div');
            cornerCell.classList.add('editor-table-cell', 'editor-table-corner-cell');
            EditorTable.applyCellHeight(cornerCell, DEFAULT_ROW_HEIGHT);

            // コーナーセルクリックで全選択
            cornerCell.addEventListener('mousedown', () => {
                this.handler.submitAndHide();
                this.selection.selectAll();
            });

            cells.push(cornerCell);

            // 列ヘッダー (A, B, C, ...)
            for (let i = 0; i < this.tableData.header.length; ++i) {
                const columnHeaderCell = document.createElement('div');
                columnHeaderCell.classList.add('editor-table-cell', 'editor-table-column-header');
                columnHeaderCell.textContent = this.tableData.header[i].name;
                columnHeaderCell.dataset.columnIndex = String(i);
                columnHeaderCell.dataset.col = String(i);
                // 幅と高さを直接設定
                EditorTable.applyCellWidth(columnHeaderCell, DEFAULT_COLUMN_WIDTH);
                EditorTable.applyCellHeight(columnHeaderCell, DEFAULT_ROW_HEIGHT);

                // 列ヘッダークリックで列全体を選択
                columnHeaderCell.addEventListener('mousedown', (e) => {
                    this.handler.submitAndHide();

                    // DOM上の実際の位置から列インデックスを取得（列0は行ヘッダーなので+1）
                    const clickedColumnIndex = parseInt(columnHeaderCell.dataset.col!) + 1;

                    if (e.shiftKey) {
                        // Shift+クリック: 現在のアンカーから連続選択
                        this.selection.extendToColumn(clickedColumnIndex);
                    } else if (e.ctrlKey || e.metaKey) {
                        // Ctrl+クリック: 列を追加選択
                        this.selection.addColumn(clickedColumnIndex);
                    } else {
                        // 通常クリック: 列全体を選択
                        this.selection.selectColumn(clickedColumnIndex);
                    }
                });

                // 列ヘッダー右クリックでコンテキストメニューを表示
                columnHeaderCell.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // DOM上の実際の位置から列インデックスを取得
                    const contextMenuColumnIndex = parseInt(columnHeaderCell.dataset.col!);
                    this.contextMenu.show(e.clientX, e.clientY, [
                        {
                            label: '左に列を挿入',
                            action: () => {
                                this.insertColumn(contextMenuColumnIndex);
                            }
                        },
                        {
                            label: '右に列を挿入',
                            action: () => {
                                this.insertColumn(contextMenuColumnIndex + 1);
                            }
                        },
                        {
                            label: '列を削除',
                            action: () => {
                                this.removeColumn(contextMenuColumnIndex);
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
                this.handler.submitAndHide();

                // DOM上の実際の位置から行インデックスを取得
                const clickedRowIndex = parseInt(rowHeaderCell.dataset.rowIndex!) + 1;

                if (e.shiftKey) {
                    // Shift+クリック: 現在のアンカーから連続選択
                    this.selection.extendToRow(clickedRowIndex);
                } else if (e.ctrlKey || e.metaKey) {
                    // Ctrl+クリック: 行を追加選択
                    this.selection.addRow(clickedRowIndex);
                } else {
                    // 通常クリック: 行全体を選択
                    this.selection.selectRow(clickedRowIndex);
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
                this.contextMenu.show(e.clientX, e.clientY, [
                    {
                        label: '上に行を挿入',
                        action: () => {
                            this.insertRow(contextMenuRowIndex);
                        }
                    },
                    {
                        label: '下に行を挿入',
                        action: () => {
                            this.insertRow(contextMenuRowIndex + 1);
                        }
                    },
                    {
                        label: '行を削除',
                        action: () => {
                            this.removeRow(contextMenuRowIndex);
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
                const cell = EditorTable.createCell(this, this.tableData.body[i].values[j], j, DEFAULT_COLUMN_WIDTH, DEFAULT_ROW_HEIGHT);
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
                const cell = EditorTable.createCell(this, '', j, DEFAULT_COLUMN_WIDTH, DEFAULT_ROW_HEIGHT);
                cells.push(cell);
            }
            const row = EditorTable.createRow(cells, rowIndex);
            this.element.appendChild(row);
        }

        // フィル中のマウス移動イベント
        this.element.addEventListener('mousemove', (e) => {
            const target = e.target as HTMLElement;
            if (target.classList.contains('editor-table-cell')) {
                const position = this.getCellPositionFromElement(target);
                if (position) {
                    this.selection.updateFill(position.row, position.column, e.clientX, e.clientY);
                }
            }
        });
    }

    /**
     * 列挿入の公開メソッド（Commandを使用してhistoryに追加）
     */
    public insertColumn(columnIndex: number): void {
        const command = new InsertColumnCommand(this, columnIndex);
        const copyRange = this.selection.getCopyRange();
        const anchor = this.selection.getAnchor();
        this.history.executeCommand(command, {
            startRow: anchor.row,
            startColumn: anchor.column,
            endRow: anchor.row,
            endColumn: anchor.column
        }, copyRange);
    }

    /**
     * 列挿入の内部実装（Commandから呼び出される）
     */
    public insertColumnInternal(columnIndex: number): void {
        // 各行に新しいセルを挿入
        for (let currentRowIndex = 0; currentRowIndex < this.element.children.length; ++currentRowIndex) {
            const row = this.element.children[currentRowIndex] as HTMLElement;

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

                const newHeaderCell = document.createElement('div');
                newHeaderCell.classList.add('editor-table-cell', 'editor-table-column-header');
                newHeaderCell.dataset.columnIndex = String(columnIndex);
                newHeaderCell.dataset.col = String(columnIndex);
                // 幅と高さを直接設定
                EditorTable.applyCellWidth(newHeaderCell, DEFAULT_COLUMN_WIDTH);
                EditorTable.applyCellHeight(newHeaderCell, DEFAULT_ROW_HEIGHT);

                // 列ヘッダークリックで列全体を選択
                newHeaderCell.addEventListener('mousedown', (e) => {
                    this.handler.submitAndHide();

                    // DOM上の実際の位置から列インデックスを取得（列0は行ヘッダーなので+1）
                    const clickedColumnIndex = parseInt(newHeaderCell.dataset.col!) + 1;

                    if (e.shiftKey) {
                        this.selection.extendToColumn(clickedColumnIndex);
                    } else if (e.ctrlKey || e.metaKey) {
                        this.selection.addColumn(clickedColumnIndex);
                    } else {
                        this.selection.selectColumn(clickedColumnIndex);
                    }
                });

                // 列ヘッダー右クリックでコンテキストメニューを表示
                newHeaderCell.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // DOM上の実際の位置から列インデックスを取得
                    const contextMenuColumnIndex = parseInt(newHeaderCell.dataset.col!);
                    this.contextMenu.show(e.clientX, e.clientY, [
                        {
                            label: '左に列を挿入',
                            action: () => {
                                this.insertColumn(contextMenuColumnIndex);
                            }
                        },
                        {
                            label: '右に列を挿入',
                            action: () => {
                                this.insertColumn(contextMenuColumnIndex + 1);
                            }
                        },
                        {
                            label: '列を削除',
                            action: () => {
                                this.removeColumn(contextMenuColumnIndex);
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

                // 全列ヘッダーのラベルを更新（DOMから取得した既存ラベルを使用）
                const newColumnCount = existingLabels.length + 1;
                for (let i = 0; i < newColumnCount; ++i) {
                    const headerCell = row.children[i + 1] as HTMLElement;
                    headerCell.dataset.columnIndex = String(i);
                    headerCell.dataset.col = String(i);
                    // 挿入位置を考慮してラベルを決定
                    // i < columnIndex: 元の位置のラベル
                    // i == columnIndex: 新しく挿入された列（空）
                    // i > columnIndex: 元の位置-1のラベル（挿入によりずれた）
                    let label = '';
                    if (i < columnIndex) {
                        label = existingLabels[i] || '';
                    } else if (i > columnIndex) {
                        label = existingLabels[i - 1] || '';
                    }
                    // i === columnIndex の場合は空文字列のまま

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
                const newCell = EditorTable.createCell(this, '', columnIndex, DEFAULT_COLUMN_WIDTH, DEFAULT_ROW_HEIGHT);
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
    public insertRow(rowIndex: number): void {
        const command = new InsertRowCommand(this, rowIndex);
        const copyRange = this.selection.getCopyRange();
        const anchor = this.selection.getAnchor();
        this.history.executeCommand(command, {
            startRow: anchor.row,
            startColumn: anchor.column,
            endRow: anchor.row,
            endColumn: anchor.column
        }, copyRange);
    }

    /**
     * 行挿入の内部実装（Commandから呼び出される）
     */
    public insertRowInternal(rowIndex: number): void {
        // 列ヘッダー行から実際の列数を取得（行ヘッダーセルを除く）
        const columnHeaderRow = this.element.children[0];
        const columnCount = columnHeaderRow.children.length - 1;

        // 新しい行を作成
        const cells: HTMLElement[] = [];

        // 行ヘッダーを作成
        const rowHeaderCell = document.createElement('div');
        rowHeaderCell.classList.add('editor-table-cell', 'editor-table-row-header');
        rowHeaderCell.textContent = String(rowIndex);
        rowHeaderCell.dataset.rowIndex = String(rowIndex - 1);
        EditorTable.applyCellHeight(rowHeaderCell, DEFAULT_ROW_HEIGHT);

        // 行ヘッダークリックで行全体を選択
        rowHeaderCell.addEventListener('mousedown', (e) => {
            this.handler.submitAndHide();

            // DOM上の実際の位置から行インデックスを取得
            const clickedRowIndex = parseInt(rowHeaderCell.dataset.rowIndex!) + 1;

            if (e.shiftKey) {
                this.selection.extendToRow(clickedRowIndex);
            } else if (e.ctrlKey || e.metaKey) {
                this.selection.addRow(clickedRowIndex);
            } else {
                this.selection.selectRow(clickedRowIndex);
            }
        });

        // 行ヘッダー右クリックでコンテキストメニューを表示
        rowHeaderCell.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            // DOM上の実際の位置から行インデックスを取得
            const contextMenuRowIndex = parseInt(rowHeaderCell.dataset.rowIndex!) + 1;
            this.contextMenu.show(e.clientX, e.clientY, [
                {
                    label: '上に行を挿入',
                    action: () => {
                        this.insertRow(contextMenuRowIndex);
                    }
                },
                {
                    label: '下に行を挿入',
                    action: () => {
                        this.insertRow(contextMenuRowIndex + 1);
                    }
                },
                {
                    label: '行を削除',
                    action: () => {
                        this.removeRow(contextMenuRowIndex);
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

        // データセルを作成（列幅は列ヘッダーから取得）
        for (let j = 0; j < columnCount; ++j) {
            const cell = EditorTable.createCell(this, '', j, DEFAULT_COLUMN_WIDTH, DEFAULT_ROW_HEIGHT);
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

        // コピー範囲をクリア（行構造が変わったため）
        this.selection.clearCopyRange();
        // 選択範囲の描画を更新（ヘッダーの背景色を正しく表示するため）
        this.selection.updateRendererAfterResize();
    }

    /**
     * 列削除の公開メソッド（Commandを使用してhistoryに追加）
     */
    public removeColumn(columnIndex: number): void {
        const command = new DeleteColumnCommand(this, columnIndex);
        const copyRange = this.selection.getCopyRange();
        const anchor = this.selection.getAnchor();
        this.history.executeCommand(command, {
            startRow: anchor.row,
            startColumn: anchor.column,
            endRow: anchor.row,
            endColumn: anchor.column
        }, copyRange);
    }

    /**
     * 行削除の公開メソッド（Commandを使用してhistoryに追加）
     */
    public removeRow(rowIndex: number): void {
        const command = new DeleteRowCommand(this, rowIndex);
        const copyRange = this.selection.getCopyRange();
        const anchor = this.selection.getAnchor();
        this.history.executeCommand(command, {
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

    private static createCell(table: EditorTable, value: number | string | string[] | undefined, columnIndex: number, width: string, height: string) {
        const cell = document.createElement('div');
        cell.classList.add('editor-table-cell');
        cell.dataset.col = String(columnIndex);
        // 幅と高さを直接スタイルに設定
        EditorTable.applyCellWidth(cell, width);
        EditorTable.applyCellHeight(cell, height);
        cell.addEventListener('dblclick', () => {
            // 参照列の場合はドロップダウンを表示
            table.handler.enableCellEditModeWithDropdownAsync(true).then((handled) => {
                if (!handled) {
                    // ドロップダウンで処理されなかった場合は通常の編集モード
                    table.handler.enableCellEditMode(true);
                }
            });
        });
        cell.addEventListener('mousedown', (e) => {
            const position = EditorTable.getCellPosition(cell, table.element);
            if (!position) return;

            table.handler.submitAndHide();

            if (e.shiftKey) {
                // Shift+クリック: 現在のアンカーから連続選択
                table.selection.extendSelection(position.row, position.column);
            } else {
                // 通常クリック: セルを選択
                table.selection.start(position.row, position.column);
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
        EditorTable.applyCellHeight(rowHeaderCell, DEFAULT_ROW_HEIGHT);

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
                    // 削除位置を考慮してラベルを決定（DOMから取得したラベルを使用）
                    // i < columnIndex: 元の位置のラベル
                    // i >= columnIndex: 元の位置+1のラベル（削除によりずれた）
                    let label = '';
                    if (i < columnIndex) {
                        label = existingLabels[i] || '';
                    } else {
                        label = existingLabels[i + 1] || '';
                    }

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
    public deleteRow(rowIndex: number): void {
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

        // コピー範囲をクリア（行構造が変わったため）
        this.selection.clearCopyRange();
        // 選択範囲の描画を更新（ヘッダーの背景色を正しく表示するため）
        this.selection.updateRendererAfterResize();
    }

    /**
     * グローバルイベントリスナーを登録する（タブがアクティブになったとき）
     */
    activate(): void {
        this.selectionDragController.activate();
        this.scrollBinding.activate();
    }

    /**
     * グローバルイベントリスナーを解除する（タブが非アクティブになったとき）
     */
    deactivate(): void {
        this.selectionDragController.deactivate();
        this.scrollBinding.deactivate();
    }

    onScroll(): void {
        this.updateRowHeaderSticky();
    }

    private updateRowHeaderSticky(): void {
        const offset = this.scrollBinding.getScrollLeft();
        if (offset === this.lastScrollLeft) return;
        this.lastScrollLeft = offset;

        const rowHeaders = this.element.querySelectorAll('.editor-table-row-header, .editor-table-corner-cell') as NodeListOf<HTMLElement>;
        if (rowHeaders.length === 0) return;
        for (const header of Array.from(rowHeaders)) {
            header.style.position = 'relative';
            header.style.left = `${offset}px`;
            header.style.transform = '';
            header.style.zIndex = '20';
            header.style.overflow = 'visible';
        }
    }

    stopAutoScrollForInput(): void {
        this.selectionDragController.stopAutoScrollForInput();
    }

    /**
     * 指定列の幅を取得（列ヘッダーセルから取得）
     */
    getColumnWidth(columnIndex: number): string {
        const columnHeaderRow = this.element.children[0];
        const headerCell = columnHeaderRow.children[columnIndex + 1] as HTMLElement;
        return headerCell.style.width || DEFAULT_COLUMN_WIDTH;
    }

    /**
     * 指定列の幅を設定し、その列の全セルのスタイルを更新
     */
    setColumnWidth(columnIndex: number, width: string): void {
        // 全行の該当列セルのスタイルを更新
        for (let i = 0; i < this.element.children.length; ++i) {
            const row = this.element.children[i] as HTMLElement;
            // columnIndex + 1: 行ヘッダーを除く
            const cell = row.children[columnIndex + 1] as HTMLElement;
            if (cell) {
                EditorTable.applyCellWidth(cell, width);
            }
        }
    }

    /**
     * 指定行の高さを取得（その行の最初のセルから取得）
     */
    getRowHeight(rowIndex: number): string {
        const row = this.element.children[rowIndex] as HTMLElement;
        const cell = row.children[0] as HTMLElement;
        return cell.style.height || DEFAULT_ROW_HEIGHT;
    }

    /**
     * 指定行の高さを設定し、その行の全セルのスタイルを更新
     */
    setRowHeight(rowIndex: number, height: string): void {
        // 該当行の全セルのスタイルを更新
        const row = this.element.children[rowIndex] as HTMLElement;
        if (row) {
            for (let i = 0; i < row.children.length; ++i) {
                const cell = row.children[i] as HTMLElement;
                EditorTable.applyCellHeight(cell, height);
            }
        }
    }

    /**
     * セルに幅のスタイルを適用
     */
    static applyCellWidth(cell: HTMLElement, width: string): void {
        cell.style.width = width;
        cell.style.minWidth = width;
        cell.style.maxWidth = width;
    }

    /**
     * セルに高さのスタイルを適用
     */
    static applyCellHeight(cell: HTMLElement, height: string): void {
        cell.style.height = height;
        cell.style.minHeight = height;
        cell.style.maxHeight = height;
        cell.style.lineHeight = height;
    }

    /**
     * セルの値を取得する（参照ヒントを除外）
     */
    static getCellValue(cell: HTMLElement): string {
        // .cell-value 要素があればそこから取得
        const valueElement = cell.querySelector('.cell-value');
        if (valueElement) {
            return valueElement.textContent ?? '';
        }
        // .cell-reference-hint 要素があれば、最初のテキストノードから取得
        const hintElement = cell.querySelector('.cell-reference-hint');
        if (hintElement) {
            for (const node of Array.from(cell.childNodes)) {
                if (node.nodeType === Node.TEXT_NODE) {
                    return node.textContent ?? '';
                }
            }
            return '';
        }
        // そうでなければ textContent をそのまま返す
        return cell.textContent ?? '';
    }

    /**
     * 座標からセル要素を取得する
     * @param row 行インデックス（0始まり、列ヘッダー行を含む）
     * @param column 列インデックス（0始まり、行ヘッダーセルを含む）
     * @returns セル要素。存在しない場合はnullを投げる
     */
    private getCell(row: number, column: number): HTMLElement {
        const rowElement = this.element.children[row] as HTMLElement;
        if (!rowElement) {
            throw new Error(`行が見つかりません: row=${row}`);
        }
        const cell = rowElement.children[column] as HTMLElement;
        if (!cell) {
            throw new Error(`セルが見つかりません: row=${row}, column=${column}`);
        }
        return cell;
    }

    /**
     * 座標でセルの値を設定する（参照ヒント付き）
     * @param row 行インデックス（0始まり、列ヘッダー行を含む）
     * @param column 列インデックス（0始まり、行ヘッダーセルを含む）
     * @param value セルの値
     */
    setCellValueAt(row: number, column: number, value: string): void {
        const cell = this.getCell(row, column);
        const dataColumnIndex = column - 1;
        this.setCellValue(cell, value, dataColumnIndex, row);

        // 変更された列に依存する動的参照列のヒントを再評価する（二段リスト対応）
        this.updateDependentColumnsInRow(row, dataColumnIndex);
    }

    /**
     * セルの値を設定する（参照ヒント付き）
     * @param cell セル要素
     * @param value セルの値
     * @param dataColumnIndex データ列のインデックス（0始まり）
     * @param rowIndex 行インデックス（動的参照の解決に使用）
     */
    setCellValue(cell: HTMLElement, value: string, dataColumnIndex: number, rowIndex: number): void {
        // 既存の参照ヒントを削除
        const existingHint = cell.querySelector('.cell-reference-hint');
        if (existingHint) {
            existingHint.remove();
        }

        // 参照列かどうかを判定
        const column = this.tableData.header[dataColumnIndex];
        if (!column || !column.reference) {
            // 参照列でなければ通常のテキストコンテンツを設定
            cell.textContent = value;
            return;
        }

        // 値を設定
        cell.textContent = value;

        // 参照式をパース
        const expr = parseReferenceExpression(column.reference);

        if (isDynamicReference(expr)) {
            // 動的参照の場合: 非同期で参照ヒントを更新
            this.updateDynamicReferenceHintAsync(cell, value, expr, rowIndex);
            return;
        }

        // 単純参照の場合: 同期的に参照ヒントを取得
        const displayText = this.referenceDataCache.getDisplayTextById(expr.tableName, value);

        // 参照ヒントを追加（表示テキストがある場合のみ）
        if (displayText) {
            const hintSpan = document.createElement('span');
            hintSpan.classList.add('cell-reference-hint');
            hintSpan.textContent = displayText;
            cell.appendChild(hintSpan);
        }
    }

    /**
     * 動的参照の参照ヒントを非同期で更新する
     */
    private updateDynamicReferenceHintAsync(
        cell: HTMLElement,
        value: string,
        expr: ReturnType<typeof parseReferenceExpression>,
        rowIndex: number
    ): void {
        if (!isDynamicReference(expr)) return;

        // 同一行の指定カラムの値を取得
        const valueColumnIndex = this.tableData.header.findIndex(col => col.name === expr.filter.valueColumn);
        if (valueColumnIndex === -1) return;

        // column=0は行ヘッダーなので、データ列インデックスに+1する
        const filterValue = this.getCellValueAt(rowIndex, valueColumnIndex + 1);
        if (filterValue === '') return;

        // フィルタテーブルからテーブル名を取得
        this.referenceDataCache.getFullDataAsync(expr.filter.tableName).then(fullData => {
            const lookupColumnIndex = fullData.header.indexOf(expr.lookupColumn);
            if (lookupColumnIndex === -1) return;

            // filterColumn で行を検索（主キー以外のカラムにも対応）
            const row = this.referenceDataCache.findRowByColumn(fullData, expr.filter.filterColumn, filterValue);
            if (!row) return;

            const targetTableName = row[lookupColumnIndex];
            if (targetTableName === '') return;

            // 参照先テーブルの表示テキストを取得
            const displayText = this.referenceDataCache.getDisplayTextById(targetTableName, value);
            if (!displayText) {
                // キャッシュにない場合は非同期で取得
                this.referenceDataCache.get(targetTableName).then(() => {
                    const resolvedDisplayText = this.referenceDataCache.getDisplayTextById(targetTableName, value);
                    if (resolvedDisplayText) {
                        this.appendReferenceHint(cell, resolvedDisplayText);
                    }
                }).catch(() => {
                    // 取得失敗時は何もしない
                });
                return;
            }

            this.appendReferenceHint(cell, displayText);
        }).catch(() => {
            // 取得失敗時は何もしない
        });
    }

    /**
     * セルに参照ヒントを追加する（既存のヒントは削除）
     */
    private appendReferenceHint(cell: HTMLElement, displayText: string): void {
        // 既存の参照ヒントを削除
        const existingHint = cell.querySelector('.cell-reference-hint');
        if (existingHint) {
            existingHint.remove();
        }

        const hintSpan = document.createElement('span');
        hintSpan.classList.add('cell-reference-hint');
        hintSpan.textContent = displayText;
        cell.appendChild(hintSpan);
    }

    /**
     * 変更された列に依存する動的参照列のヒントを同一行内で再評価する
     * Excelの二段リストと同様に、親列の変更で子列の参照先を切り替える
     */
    private updateDependentColumnsInRow(rowIndex: number, changedDataColumnIndex: number): void {
        const changedColumnName = this.tableData.header[changedDataColumnIndex]?.name;
        if (!changedColumnName) return;

        const rowElement = this.element.children[rowIndex] as HTMLElement;
        for (let colIdx = 0; colIdx < this.tableData.header.length; colIdx++) {
            if (colIdx === changedDataColumnIndex) continue;

            const column = this.tableData.header[colIdx];
            if (!column.reference) continue;

            const expr = parseReferenceExpression(column.reference);
            if (!isDynamicReference(expr)) continue;

            // この動的参照が変更された列を参照元としているか確認
            if (expr.filter.valueColumn !== changedColumnName) continue;

            // 依存しているセルのヒントを再評価する
            const cell = rowElement.children[colIdx + 1] as HTMLElement;
            if (cell) {
                const cellValue = EditorTable.getCellValue(cell);
                this.setCellValue(cell, cellValue, colIdx, rowIndex);
            }
        }
    }

    /**
     * 行数を取得する（列ヘッダー行を含む）
     */
    getRowCount(): number {
        return this.element.children.length;
    }

    /**
     * 列数を取得する（行ヘッダーセルを除く）
     */
    getColumnCount(): number {
        const headerRow = this.element.children[0];
        return headerRow.children.length - 1;
    }

    /**
     * 座標でセルの値を取得する（参照ヒントを除外）
     * @param row 行インデックス（0始まり、列ヘッダー行を含む）
     * @param column 列インデックス（0始まり、行ヘッダーセルを含む）
     */
    getCellValueAt(row: number, column: number): string {
        const cell = this.getCell(row, column);
        return EditorTable.getCellValue(cell);
    }

    /**
     * 列ヘッダーの値を取得する
     * @param columnIndex 列インデックス（0始まり、行ヘッダーセルを除く）
     */
    getColumnHeaderValue(columnIndex: number): string {
        const headerRow = this.element.children[0] as HTMLElement;
        const headerCell = headerRow.children[columnIndex + 1] as HTMLElement;
        // 列ヘッダーセルはTEXT_NODEとしてテキストを持つ（リサイズハンドル等の子要素がある）
        for (const node of Array.from(headerCell.childNodes)) {
            if (node.nodeType === Node.TEXT_NODE) {
                return node.textContent ?? '';
            }
        }
        return '';
    }

    /**
     * 列ヘッダーの値を設定する
     * @param columnIndex 列インデックス（0始まり、行ヘッダーセルを除く）
     * @param value 設定する値
     */
    setColumnHeaderValue(columnIndex: number, value: string): void {
        const headerRow = this.element.children[0] as HTMLElement;
        const headerCell = headerRow.children[columnIndex + 1] as HTMLElement;
        // 既存のTEXT_NODEを探して更新、なければ追加
        for (const node of Array.from(headerCell.childNodes)) {
            if (node.nodeType === Node.TEXT_NODE) {
                node.textContent = value;
                return;
            }
        }
        headerCell.insertBefore(document.createTextNode(value), headerCell.firstChild);
    }

    /**
     * 指定座標のセルのBoundingClientRectを取得する
     * @param row 行インデックス（0始まり、列ヘッダー行を含む）
     * @param column 列インデックス（0始まり、行ヘッダーセルを含む）
     */
    getCellRectAt(row: number, column: number): DOMRect {
        const cell = this.getCell(row, column);
        return cell.getBoundingClientRect();
    }

    /**
     * テキストフィールドの幅を計算する
     * 指定セルから右方向にセルの幅を合算し、テキスト幅が収まる幅を返す
     * @param row 行インデックス
     * @param column 列インデックス
     * @param textWidth テキストの幅（ピクセル）
     * @returns 計算された幅とセルの高さ
     */
    calculateTextFieldWidth(row: number, column: number, textWidth: number): { width: number; cellHeight: number } {
        const rowElement = this.element.children[row] as HTMLElement;
        const startCell = rowElement.children[column] as HTMLElement;
        const cellHeight = startCell.getBoundingClientRect().height;

        // 自分から右側にあるセルを結合する
        // box-sizing: border-boxなので、セルの幅をそのまま使用
        // テキスト幅との比較では、パディング(12px)とボーダー(2px)を考慮
        let width = 0;
        for (let i = column; i < rowElement.children.length; i++) {
            const cell = rowElement.children[i] as HTMLElement;
            width += cell.getBoundingClientRect().width;
            if (textWidth < width - 14) {
                break;
            }
        }

        return { width, cellHeight };
    }

    /**
     * テーブル要素のBoundingClientRectを取得する
     */
    getTableBoundingClientRect(): DOMRect {
        return this.element.getBoundingClientRect();
    }

    /**
     * セル要素から位置を取得する
     * @param cell セル要素
     * @returns セル位置。見つからない場合はnull
     */
    getCellPositionFromElement(cell: HTMLElement): CellPosition | null {
        return EditorTable.getCellPosition(cell, this.element);
    }

    /**
     * 行ヘッダーを含む全列数を取得する
     */
    getTotalColumnCount(): number {
        const headerRow = this.element.children[0];
        return headerRow.children.length;
    }

    /**
     * 座標でセルのBoundingClientRectを取得する（存在しない場合はnull）
     * @param row 行インデックス（0始まり、列ヘッダー行を含む）
     * @param column 列インデックス（0始まり、行ヘッダーセルを含む）
     */
    getCellRectOrNull(row: number, column: number): DOMRect | null {
        const rowElement = this.element.children[row] as HTMLElement | undefined;
        if (!rowElement) return null;
        const cell = rowElement.children[column] as HTMLElement | undefined;
        if (!cell) return null;
        return cell.getBoundingClientRect();
    }

    /**
     * 列ヘッダー行の高さを取得する
     */
    getFirstRowHeight(): number {
        const headerRow = this.element.children[0] as HTMLElement | undefined;
        if (!headerRow) return 0;
        return headerRow.getBoundingClientRect().height;
    }

    /**
     * 行ヘッダー（コーナーセル）の幅を取得する
     */
    getRowHeaderWidth(): number {
        const headerRow = this.element.children[0] as HTMLElement | undefined;
        const cornerCell = headerRow?.children[0] as HTMLElement | undefined;
        if (!cornerCell) return 0;
        return cornerCell.getBoundingClientRect().width;
    }

    /**
     * ヘッダーの選択状態を更新する
     * @param startRow 選択範囲の開始行
     * @param startColumn 選択範囲の開始列
     * @param endRow 選択範囲の終了行
     * @param endColumn 選択範囲の終了列
     */
    updateHeaderSelection(startRow: number, startColumn: number, endRow: number, endColumn: number): void {
        // 列ヘッダー行を取得
        const columnHeaderRow = this.element.children[0] as HTMLElement;

        // すべての列ヘッダーから選択状態を解除
        for (let i = 1; i < columnHeaderRow.children.length; i++) {
            const headerCell = columnHeaderRow.children[i] as HTMLElement;
            headerCell.classList.remove('selected');
        }

        // すべての行ヘッダーから選択状態を解除
        for (let i = 1; i < this.element.children.length; i++) {
            const row = this.element.children[i] as HTMLElement;
            const rowHeader = row.children[0] as HTMLElement;
            if (rowHeader.classList.contains('editor-table-row-header')) {
                rowHeader.classList.remove('selected');
            }
        }

        // 選択範囲に含まれる列ヘッダーに選択状態を追加
        for (let col = startColumn; col <= endColumn; col++) {
            const headerCell = columnHeaderRow.children[col] as HTMLElement;
            if (headerCell) {
                headerCell.classList.add('selected');
            }
        }

        // 選択範囲に含まれる行ヘッダーに選択状態を追加
        for (let row = startRow; row <= endRow; row++) {
            const rowElement = this.element.children[row] as HTMLElement;
            if (rowElement) {
                const rowHeader = rowElement.children[0] as HTMLElement;
                if (rowHeader.classList.contains('editor-table-row-header')) {
                    rowHeader.classList.add('selected');
                }
            }
        }
    }

    /**
     * データ領域の最大行を取得（データが入力されている最後の行）
     * row=0は列ヘッダーなので、データ行はrow=1から開始
     */
    getMaxDataRow(): number {
        // row=0は列ヘッダー、データ行はrow=1から
        const dataStartRow = 1;
        let maxRow = 0;

        for (let r = this.element.children.length - 1; r >= dataStartRow; r--) {
            const rowElement = this.element.children[r] as HTMLElement;
            if (!rowElement) continue;

            let hasData = false;
            for (let c = 1; c < rowElement.children.length; c++) {
                const cell = rowElement.children[c] as HTMLElement;
                if (cell && cell.textContent && cell.textContent.trim() !== '') {
                    hasData = true;
                    break;
                }
            }

            if (hasData) {
                maxRow = r;
                break;
            }
        }

        return maxRow;
    }
}
