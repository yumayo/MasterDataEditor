import {EditorTableData} from "./model/editor-table-data";
import {Selection, CellPosition} from "./selection";
import {EditorTableDataColumn} from "./model/editor-table-data-column";
import {EditorTableDataRow} from "./model/editor-table-data-row";
import {enableCellEditMode} from "./editor-actions";
import {GridTextField} from "./grid-textfield";
import {ContextMenu} from "./context-menu";

export class EditorTable {
    readonly tableName: string;
    readonly tableData: EditorTableData;

    readonly element: HTMLElement;

    constructor(tableName: string, tableData: EditorTableData) {

        this.tableData = tableData;
        this.tableName = tableName;

        this.element = document.createElement('div');
    }
    
    setup(textField: GridTextField, selection: Selection, contextMenu: ContextMenu) {

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
        this.generateRowHeightStyles(totalRows);
        this.generateColumnWidthStyles(this.tableData.header.length);

        // 列幅リサイズの状態管理
        let isResizingColumn = false;
        let resizingColumnIndex = -1;
        let resizeStartX = 0;
        let resizeStartWidth = 0;
        let resizeColumnStartLeft = 0;

        // 行高リサイズの状態管理
        let isResizingRow = false;
        let resizingRowIndex = -1;
        let resizeStartY = 0;
        let resizeStartHeight = 0;
        let resizeRowStartTop = 0;

        // リサイズ用ガイドライン要素を作成
        const resizeGuideline = document.createElement('div');
        resizeGuideline.classList.add('resize-guideline');
        resizeGuideline.style.display = 'none';

        // editorの親要素に追加（テーブルの外に配置）
        const editorElement = document.getElementById('editor');
        if (editorElement) {
            editorElement.appendChild(resizeGuideline);
        }

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

        window.addEventListener('mousemove', (e) => {
            if (isResizingColumn) {
                const deltaX = e.clientX - resizeStartX;
                const newLeft = resizeColumnStartLeft + deltaX;

                // ガイドラインの位置を更新（実際のセルは変更しない）
                resizeGuideline.style.left = newLeft + 'px';
            }

            if (isResizingRow) {
                const deltaY = e.clientY - resizeStartY;
                const newTop = resizeRowStartTop + deltaY;

                // ガイドラインの位置を更新（実際のセルは変更しない）
                resizeGuideline.style.top = newTop + 'px';
            }
        });

        window.addEventListener('mouseup', (e) => {
            if (isResizingColumn) {
                const deltaX = e.clientX - resizeStartX;
                const newWidth = Math.max(20, resizeStartWidth + deltaX);

                // マウスアップ時にCSS変数を更新
                this.element.style.setProperty(`--col-${resizingColumnIndex}-width`, newWidth + 'px');

                // ガイドラインを非表示
                resizeGuideline.style.display = 'none';
                resizeGuideline.classList.remove('resize-guideline-column', 'resize-guideline-row');
            }

            if (isResizingRow) {
                const deltaY = e.clientY - resizeStartY;
                const newHeight = Math.max(20, resizeStartHeight + deltaY);

                // マウスアップ時にCSS変数を更新
                this.element.style.setProperty(`--row-${resizingRowIndex}-height`, newHeight + 'px');

                // ガイドラインを非表示
                resizeGuideline.style.display = 'none';
                resizeGuideline.classList.remove('resize-guideline-column', 'resize-guideline-row');
            }

            selection.end();
            isResizingColumn = false;
            isResizingRow = false;
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
                columnHeaderCell.textContent = EditorTable.columnIndexToLabel(i);
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
                                this.insertColumn(contextMenuColumnIndex, textField, selection, contextMenu);
                            }
                        },
                        {
                            label: '右に列を挿入',
                            action: () => {
                                this.insertColumn(contextMenuColumnIndex + 1, textField, selection, contextMenu);
                            }
                        }
                    ]);
                });

                // リサイズハンドルを追加
                const resizeHandle = document.createElement('div');
                resizeHandle.classList.add('column-resize-handle');
                resizeHandle.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    isResizingColumn = true;
                    resizingColumnIndex = i;
                    resizeStartX = e.clientX;
                    const width = columnHeaderCell.offsetWidth;
                    resizeStartWidth = width;

                    // ガイドラインを表示（縦線）
                    const rect = columnHeaderCell.getBoundingClientRect();
                    const editorRect = editorElement!.getBoundingClientRect();
                    resizeColumnStartLeft = rect.right - editorRect.left + editorElement!.scrollLeft;
                    resizeGuideline.style.display = 'block';
                    resizeGuideline.style.left = resizeColumnStartLeft + 'px';
                    resizeGuideline.style.top = '0';
                    resizeGuideline.classList.add('resize-guideline-column');
                    resizeGuideline.classList.remove('resize-guideline-row');
                });
                columnHeaderCell.appendChild(resizeHandle);

                cells.push(columnHeaderCell);
            }
            const columnHeaderRow = EditorTable.createRow(cells, 0);
            columnHeaderRow.classList.add('editor-table-column-header-row');
            this.element.appendChild(columnHeaderRow);
        }

        // 行リサイズ時にガイドラインを表示する共通関数
        const showRowGuideline = (cell: HTMLElement) => {
            const rect = cell.getBoundingClientRect();
            const editorRect = editorElement!.getBoundingClientRect();
            resizeRowStartTop = rect.bottom - editorRect.top + editorElement!.scrollTop;
            resizeGuideline.style.display = 'block';
            resizeGuideline.style.top = resizeRowStartTop + 'px';
            resizeGuideline.style.left = '0';
            resizeGuideline.classList.add('resize-guideline-row');
            resizeGuideline.classList.remove('resize-guideline-column');
        };

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
                            this.insertRow(contextMenuRowIndex, textField, selection, contextMenu);
                        }
                    },
                    {
                        label: '下に行を挿入',
                        action: () => {
                            this.insertRow(contextMenuRowIndex + 1, textField, selection, contextMenu);
                        }
                    }
                ]);
            };
        };

        {
            const cells = [];
            // 行ヘッダー (1)
            const rowHeaderCell = EditorTable.createRowHeaderCell('1', 0, () => {
                isResizingRow = true;
                resizingRowIndex = 1;
            }, (startY: number, startHeight: number) => {
                resizeStartY = startY;
                resizeStartHeight = startHeight;
            }, showRowGuideline, createRowHeaderClickHandler, createRowHeaderContextMenuHandler);

            cells.push(rowHeaderCell);

            for (let i = 0; i < this.tableData.header.length; ++i) {
                const column = this.tableData.header[i];
                cells.push(EditorTable.createCell(this, textField, selection, column.key, i));
            }
            const row = EditorTable.createRow(cells, 1);
            row.classList.add('editor-table-header', 'editor-table-header-key');
            this.element.appendChild(row);
        }

        {
            const cells = [];
            // 行ヘッダー (2)
            const rowHeaderCell = EditorTable.createRowHeaderCell('2', 1, () => {
                isResizingRow = true;
                resizingRowIndex = 2;
            }, (startY: number, startHeight: number) => {
                resizeStartY = startY;
                resizeStartHeight = startHeight;
            }, showRowGuideline, createRowHeaderClickHandler, createRowHeaderContextMenuHandler);

            cells.push(rowHeaderCell);

            for (let i = 0; i < this.tableData.header.length; ++i) {
                const column = this.tableData.header[i];
                cells.push(EditorTable.createCell(this, textField, selection, column.name, i));
            }
            const row = EditorTable.createRow(cells, 2);
            row.classList.add('editor-table-header', 'editor-table-header-name');
            this.element.appendChild(row);
        }

        {
            const cells = [];
            // 行ヘッダー (3)
            const rowHeaderCell = EditorTable.createRowHeaderCell('3', 2, () => {
                isResizingRow = true;
                resizingRowIndex = 3;
            }, (startY: number, startHeight: number) => {
                resizeStartY = startY;
                resizeStartHeight = startHeight;
            }, showRowGuideline, createRowHeaderClickHandler, createRowHeaderContextMenuHandler);

            cells.push(rowHeaderCell);

            for (let i = 0; i < this.tableData.header.length; ++i) {
                const column = this.tableData.header[i];
                cells.push(EditorTable.createCell(this, textField, selection, column.type, i));
            }
            const row = EditorTable.createRow(cells, 3);
            row.classList.add('editor-table-header', 'editor-table-header-type');
            this.element.appendChild(row);
        }

        {
            const cells = [];
            // 行ヘッダー (4)
            const rowHeaderCell = EditorTable.createRowHeaderCell('4', 3, () => {
                isResizingRow = true;
                resizingRowIndex = 4;
            }, (startY: number, startHeight: number) => {
                resizeStartY = startY;
                resizeStartHeight = startHeight;
            }, showRowGuideline, createRowHeaderClickHandler, createRowHeaderContextMenuHandler);

            cells.push(rowHeaderCell);

            for (let i = 0; i < this.tableData.header.length; ++i) {
                const column = this.tableData.header[i];
                cells.push(EditorTable.createCell(this, textField, selection, column.comment, i));
            }
            const row = EditorTable.createRow(cells, 4);
            row.classList.add('editor-table-header', 'editor-table-header-comment');
            this.element.appendChild(row);
        }

        {
            const cells = [];
            // 行ヘッダー (5)
            const rowHeaderCell = EditorTable.createRowHeaderCell('5', 4, () => {
                isResizingRow = true;
                resizingRowIndex = 5;
            }, (startY: number, startHeight: number) => {
                resizeStartY = startY;
                resizeStartHeight = startHeight;
            }, showRowGuideline, createRowHeaderClickHandler, createRowHeaderContextMenuHandler);

            cells.push(rowHeaderCell);

            for (let i = 0; i < this.tableData.header.length; ++i) {
                const column = this.tableData.header[i];
                cells.push(EditorTable.createCell(this, textField, selection, column.references, i));
            }
            const row = EditorTable.createRow(cells, 5);
            row.classList.add('editor-table-header', 'editor-table-header-references');
            this.element.appendChild(row);
        }

        for (let i = 0; i < this.tableData.body.length; ++i) {
            const cells = [];
            // 行ヘッダー (6, 7, 8, ...)
            const rowIndex = i + 6;
            const rowHeaderCell = EditorTable.createRowHeaderCell(String(i + 6), i + 5, () => {
                isResizingRow = true;
                resizingRowIndex = rowIndex;
            }, (startY: number, startHeight: number) => {
                resizeStartY = startY;
                resizeStartHeight = startHeight;
            }, showRowGuideline, createRowHeaderClickHandler, createRowHeaderContextMenuHandler);

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
            const rowIndex = this.tableData.body.length + i + 6;
            const rowHeaderCell = EditorTable.createRowHeaderCell(String(this.tableData.body.length + i + 6), this.tableData.body.length + i + 5, () => {
                isResizingRow = true;
                resizingRowIndex = rowIndex;
            }, (startY: number, startHeight: number) => {
                resizeStartY = startY;
                resizeStartHeight = startHeight;
            }, showRowGuideline, createRowHeaderClickHandler, createRowHeaderContextMenuHandler);

            cells.push(rowHeaderCell);

            for (let j = 0; j < this.tableData.header.length; ++j) {
                const cell = EditorTable.createCell(this, textField, selection, '', j);
                cells.push(cell);
            }
            const row = EditorTable.createRow(cells, rowIndex);
            this.element.appendChild(row);
        }
    }

    public serializeTable() {
        if (!this.tableData) return;

        const allChildren = Array.from(this.element.children) as HTMLElement[];
        const header: HTMLElement[] = [];
        for (const row of allChildren) {
            if (row.classList.contains('editor-table-header')) {
                header.push(row);
            } else {
                break;
            }
        }

        const headerKey = header.find(row => row.classList.contains('editor-table-header-key'))!;
        const headerName = header.find(row => row.classList.contains('editor-table-header-name'))!;
        const headerType = header.find(row => row.classList.contains('editor-table-header-type'))!;
        const headerComment = header.find(row => row.classList.contains('editor-table-header-comment'))!;
        const headerReferences = header.find(row => row.classList.contains('editor-table-header-references'))!;

        const columns = [];
        for (let i = 0; i < headerName.children.length; ++i) {

            const comment = headerComment.children[i].textContent;
            let jsonComment: string | undefined;
            if (comment !== null && comment !== '') {
                jsonComment = comment;
            } else {
                jsonComment = undefined;
            }

            const references = (headerReferences.children[i]?.textContent?.split(',') ?? [])
                .filter(x => x !== '');

            let jsonReference: string[];
            if (references.length > 0) {
                jsonReference = references;
            } else {
                jsonReference = [];
            }

            columns.push(
                new EditorTableDataColumn(
                    parseInt(headerKey.children[i].textContent!),
                    headerName.children[i].textContent!,
                    headerType.children[i].textContent!,
                    jsonComment,
                    jsonReference,
                )
            );
        }

        const body = allChildren.filter(row => !row.classList.contains('editor-table-header'));

        const rows = body.map(row => new EditorTableDataRow(Array.from(row.children).map(x => x.textContent!)));

        return new EditorTableData(this.tableData.description, this.tableData.primaryKey, columns, rows);
    }

    public insertColumn(columnIndex: number, textField: GridTextField, selection: Selection, contextMenu: ContextMenu): void {
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
                                this.insertColumn(contextMenuColumnIndex, textField, selection, contextMenu);
                            }
                        },
                        {
                            label: '右に列を挿入',
                            action: () => {
                                this.insertColumn(contextMenuColumnIndex + 1, textField, selection, contextMenu);
                            }
                        }
                    ]);
                });

                // リサイズハンドルを追加
                const resizeHandle = document.createElement('div');
                resizeHandle.classList.add('column-resize-handle');
                newHeaderCell.appendChild(resizeHandle);

                // 挿入位置（行ヘッダーの後、columnIndex番目）
                const insertBefore = row.children[columnIndex + 1];
                row.insertBefore(newHeaderCell, insertBefore);

                // 全列ヘッダーのラベルを更新
                for (let i = 0; i < newColumnCount; ++i) {
                    const headerCell = row.children[i + 1] as HTMLElement;
                    headerCell.dataset.columnIndex = String(i);
                    headerCell.dataset.col = String(i);
                    const label = EditorTable.columnIndexToLabel(i);

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
        this.generateColumnWidthStyles(totalColumns + 1);
    }

    public insertRow(rowIndex: number, textField: GridTextField, selection: Selection, contextMenu: ContextMenu): void {
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
                        this.insertRow(contextMenuRowIndex, textField, selection, contextMenu);
                    }
                },
                {
                    label: '下に行を挿入',
                    action: () => {
                        this.insertRow(contextMenuRowIndex + 1, textField, selection, contextMenu);
                    }
                }
            ]);
        });

        // リサイズハンドルを追加
        const resizeHandle = document.createElement('div');
        resizeHandle.classList.add('row-resize-handle');
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
                header.textContent = String(i);
                header.dataset.rowIndex = String(i - 1);
                // リサイズハンドルを再追加
                const handle = document.createElement('div');
                handle.classList.add('row-resize-handle');
                header.appendChild(handle);
            }
        }

        // 行高スタイルを再生成
        this.generateRowHeightStyles(totalRows + 1);
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

    private static columnIndexToLabel(index: number): string {
        let label = '';
        let num = index;
        while (num >= 0) {
            label = String.fromCharCode(65 + (num % 26)) + label;
            num = Math.floor(num / 26) - 1;
        }
        return label;
    }

    private static createRowHeaderCell(
        text: string,
        rowIndex: number,
        onResizeStart: () => void,
        setResizeState: (startY: number, startHeight: number) => void,
        showGuideline: (cell: HTMLElement) => void,
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
        resizeHandle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            onResizeStart();
            const height = rowHeaderCell.offsetHeight;
            setResizeState(e.clientY, height);
            showGuideline(rowHeaderCell);
        });
        rowHeaderCell.appendChild(resizeHandle);

        return rowHeaderCell;
    }

    private generateRowHeightStyles(totalRows: number): void {
        // 既存のスタイルシートがあれば削除
        const existingStyle = document.getElementById('editor-table-row-heights');
        if (existingStyle) {
            existingStyle.remove();
        }

        // 新しいスタイルシートを作成
        const style = document.createElement('style');
        style.id = 'editor-table-row-heights';

        let css = '';
        for (let i = 0; i < totalRows; ++i) {
            css += `.editor-table-row[data-row="${i}"] { --row-height: var(--row-${i}-height, 20px); }\n`;
        }

        style.textContent = css;
        document.head.appendChild(style);
    }

    private generateColumnWidthStyles(columnCount: number): void {
        // 既存のスタイルシートがあれば削除
        const existingStyle = document.getElementById('editor-table-column-widths');
        if (existingStyle) {
            existingStyle.remove();
        }

        // 新しいスタイルシートを作成
        const style = document.createElement('style');
        style.id = 'editor-table-column-widths';

        let css = '';
        for (let i = 0; i < columnCount; ++i) {
            css += `.editor-table-cell[data-col="${i}"] { width: var(--col-${i}-width, 100px); min-width: var(--col-${i}-width, 100px); max-width: var(--col-${i}-width, 100px); }\n`;
        }

        style.textContent = css;
        document.head.appendChild(style);
    }
}
