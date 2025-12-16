import {EditorTableData} from "./model/editor-table-data";
import Store from "./store";
import {Selection, CellPosition} from "./selection";

export class EditorTable {

    element: HTMLElement;
    
    contentElement: HTMLElement;

    private readonly selection: Selection;

    constructor(tableData: EditorTableData, selection: Selection) {
        this.selection = selection;
        const table = document.createElement('div');
        table.classList.add('editor-table');

        this.contentElement = document.getElementById('editor-table-content')!;

        table.addEventListener('mousemove', (e) => {
            const target = e.target as HTMLElement;
            if (target.classList.contains('editor-table-cell')) {
                const position = EditorTable.getCellPosition(target, table);
                if (position) {
                    this.selection.update(position.row, position.column);
                }
            }
        });

        window.addEventListener('mouseup', () => {
            this.selection.end();
        });

        {
            const cells = [];
            for (let i = 0; i < tableData.header.length; ++i) {
                const column = tableData.header[i];
                cells.push(EditorTable.createCell(column.key));
            }
            const row = EditorTable.createRow(cells);
            row.classList.add('editor-table-header', 'editor-table-header-key');
            table.appendChild(row);
        }

        {
            const cells = [];
            for (let i = 0; i < tableData.header.length; ++i) {
                const column = tableData.header[i];
                cells.push(EditorTable.createCell(column.name));
            }
            const row = EditorTable.createRow(cells);
            row.classList.add('editor-table-header', 'editor-table-header-name');
            table.appendChild(row);
        }

        {
            const cells = [];
            for (let i = 0; i < tableData.header.length; ++i) {
                const column = tableData.header[i];
                cells.push(EditorTable.createCell(column.type));
            }
            const row = EditorTable.createRow(cells);
            row.classList.add('editor-table-header', 'editor-table-header-type');
            table.appendChild(row);
        }

        {
            const cells = [];
            for (let i = 0; i < tableData.header.length; ++i) {
                const column = tableData.header[i];
                cells.push(EditorTable.createCell(column.comment));
            }
            const row = EditorTable.createRow(cells);
            row.classList.add('editor-table-header', 'editor-table-header-comment');
            table.appendChild(row);
        }

        {
            const cells = [];
            for (let i = 0; i < tableData.header.length; ++i) {
                const column = tableData.header[i];
                cells.push(EditorTable.createCell(column.references));
            }
            const row = EditorTable.createRow(cells);
            row.classList.add('editor-table-header', 'editor-table-header-references');
            table.appendChild(row);
        }

        for (let i = 0; i < tableData.body.length; ++i) {
            const cells = [];
            for (let j = 0; j < tableData.header.length; ++j) {
                const cell = EditorTable.createCell(tableData.body[i].values[j]);
                cells.push(cell);
            }
            const row = EditorTable.createRow(cells);
            table.appendChild(row);
        }

        for (let i = 0; i < 1000 - tableData.body.length; ++i) {
            const cells = [];
            for (let j = 0; j < tableData.header.length; ++j) {
                const cell = EditorTable.createCell('');
                cells.push(cell);
            }
            const row = EditorTable.createRow(cells);
            table.appendChild(row);
        }

        this.element = table;
    }
    
    public clear() {
        this.contentElement.innerHTML = '';
    }

    private static createRow(cells: HTMLElement[]) {
        const row = document.createElement('div');
        row.classList.add('editor-table-row');
        for (let i = 0; i < cells.length; ++i) {
            row.appendChild(cells[i]);
        }
        return row;
    }

    private static createCell(value: number | string | string[] | undefined) {
        const cell = document.createElement('div');
        cell.classList.add('editor-table-cell');
        cell.addEventListener('dblclick', () => {
            Store.enableCellEditMode(true);
        });
        cell.addEventListener('mousedown', (e) => {
            Store.selectCell(cell);
        });
        cell.textContent = value as any;
        return cell;
    }

    public static getCellPosition(cell: HTMLElement, tableElement: HTMLElement): CellPosition | null {
        let row: number;
        for (let i = 0; i < tableElement.children.length; ++i) {
            if (tableElement.children[i] === cell.parentElement) {
                row = i;
                break;
            }
        }
        if (row === undefined) return null;

        let column: number;
        for (let i = 0; i < tableElement.children[row].children.length; ++i) {
            if (tableElement.children[row].children[i] === cell) {
                column = i;
                break;
            }
        }
        if (column === undefined) return null;

        return { row, column };
    }
}
