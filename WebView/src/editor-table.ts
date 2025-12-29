import {EditorTableData} from "./model/editor-table-data";
import {Selection, CellPosition} from "./selection";
import {EditorTableDataColumn} from "./model/editor-table-data-column";
import {EditorTableDataRow} from "./model/editor-table-data-row";
import {enableCellEditMode} from "./editor-actions";
import {GridTextField} from "./grid-textfield";

export class EditorTable {
    readonly tableName: string;
    readonly tableData: EditorTableData;

    readonly element: HTMLElement;

    constructor(tableName: string, tableData: EditorTableData) {

        this.tableData = tableData;
        this.tableName = tableName;

        this.element = document.createElement('div');
    }
    
    setup(textField: GridTextField, selection: Selection) {

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

        this.element.addEventListener('mousemove', (e) => {
            const target = e.target as HTMLElement;
            if (target.classList.contains('editor-table-cell')) {
                const position = EditorTable.getCellPosition(target, this.element);
                if (position) {
                    selection.update(position.row, position.column);
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
            cells.push(cornerCell);

            // 列ヘッダー (A, B, C, ...)
            for (let i = 0; i < this.tableData.header.length; ++i) {
                const columnHeaderCell = document.createElement('div');
                columnHeaderCell.classList.add('editor-table-cell', 'editor-table-column-header');
                columnHeaderCell.textContent = EditorTable.columnIndexToLabel(i);
                columnHeaderCell.dataset.columnIndex = String(i);
                columnHeaderCell.dataset.col = String(i);

                // 列ヘッダークリックで列全体を選択
                const columnIndex = i + 1; // 列0は行ヘッダーなので+1
                columnHeaderCell.addEventListener('mousedown', (e) => {
                    textField.submitText();
                    textField.hide();

                    if (e.shiftKey) {
                        // Shift+クリック: 現在のアンカーから連続選択
                        selection.extendToColumn(columnIndex);
                    } else if (e.ctrlKey || e.metaKey) {
                        // Ctrl+クリック: 列を追加選択
                        selection.addColumn(columnIndex);
                    } else {
                        // 通常クリック: 列全体を選択
                        selection.selectColumn(columnIndex);
                    }
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
        const createRowHeaderClickHandler = (rowIndex: number) => {
            return (e: MouseEvent) => {
                textField.submitText();
                textField.hide();

                if (e.shiftKey) {
                    // Shift+クリック: 現在のアンカーから連続選択
                    selection.extendToRow(rowIndex);
                } else if (e.ctrlKey || e.metaKey) {
                    // Ctrl+クリック: 行を追加選択
                    selection.addRow(rowIndex);
                } else {
                    // 通常クリック: 行全体を選択
                    selection.selectRow(rowIndex);
                }
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
            }, showRowGuideline, createRowHeaderClickHandler(1));

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
            }, showRowGuideline, createRowHeaderClickHandler(2));

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
            }, showRowGuideline, createRowHeaderClickHandler(3));

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
            }, showRowGuideline, createRowHeaderClickHandler(4));

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
            }, showRowGuideline, createRowHeaderClickHandler(5));

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
            }, showRowGuideline, createRowHeaderClickHandler(rowIndex));

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
            }, showRowGuideline, createRowHeaderClickHandler(rowIndex));

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
        onRowHeaderClick: (e: MouseEvent) => void
    ): HTMLElement {
        const rowHeaderCell = document.createElement('div');
        rowHeaderCell.classList.add('editor-table-cell', 'editor-table-row-header');
        rowHeaderCell.textContent = text;
        rowHeaderCell.dataset.rowIndex = String(rowIndex);

        // 行ヘッダークリックで行全体を選択
        rowHeaderCell.addEventListener('mousedown', (e) => {
            // リサイズハンドルからのイベントは処理しない（stopPropagationされる）
            onRowHeaderClick(e);
        });

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
