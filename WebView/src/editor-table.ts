import {EditorTableData} from "./model/editor-table-data";
import Store from "./store";

export class EditorTable {

    element: HTMLElement;

    constructor(tableData: EditorTableData) {
        const table = document.createElement('div');
        table.classList.add('editor-table');

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
            Store.enableCellEditMode();
        });
        cell.addEventListener('mousedown', () => {
            Store.selectCell(cell);
        });
        cell.textContent = value as any;
        return cell;
    }
}
