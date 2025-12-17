import {EditorTableData} from "./model/editor-table-data";
import {Selection, CellPosition} from "./selection";
import {EditorTableDataColumn} from "./model/editor-table-data-column";
import {EditorTableDataRow} from "./model/editor-table-data-row";
import {enableCellEditMode, selectCell} from "./editor-actions";
import {GridTextField} from "./grid-textfield";
import {Cursor} from "./cursor";

export class EditorTable {
    readonly tableName: string;
    readonly tableData: EditorTableData;

    readonly element: HTMLElement;

    constructor(tableName: string, tableData: EditorTableData) {

        this.tableData = tableData;
        this.tableName = tableName;

        this.element = document.createElement('div');
    }
    
    setup(textField: GridTextField, cursor: Cursor, selection: Selection) {

        this.element.classList.add('editor-table');

        this.element.addEventListener('mousemove', (e) => {
            const target = e.target as HTMLElement;
            if (target.classList.contains('editor-table-cell')) {
                const position = EditorTable.getCellPosition(target, this.element);
                if (position) {
                    selection.update(position.row, position.column);
                }
            }
        });

        window.addEventListener('mouseup', () => {
            selection.end();
        });

        {
            const cells = [];
            for (let i = 0; i < this.tableData.header.length; ++i) {
                const column = this.tableData.header[i];
                cells.push(EditorTable.createCell(this, textField, cursor, selection, column.key));
            }
            const row = EditorTable.createRow(cells);
            row.classList.add('editor-table-header', 'editor-table-header-key');
            this.element.appendChild(row);
        }

        {
            const cells = [];
            for (let i = 0; i < this.tableData.header.length; ++i) {
                const column = this.tableData.header[i];
                cells.push(EditorTable.createCell(this, textField, cursor, selection, column.name));
            }
            const row = EditorTable.createRow(cells);
            row.classList.add('editor-table-header', 'editor-table-header-name');
            this.element.appendChild(row);
        }

        {
            const cells = [];
            for (let i = 0; i < this.tableData.header.length; ++i) {
                const column = this.tableData.header[i];
                cells.push(EditorTable.createCell(this, textField, cursor, selection, column.type));
            }
            const row = EditorTable.createRow(cells);
            row.classList.add('editor-table-header', 'editor-table-header-type');
            this.element.appendChild(row);
        }

        {
            const cells = [];
            for (let i = 0; i < this.tableData.header.length; ++i) {
                const column = this.tableData.header[i];
                cells.push(EditorTable.createCell(this, textField, cursor, selection, column.comment));
            }
            const row = EditorTable.createRow(cells);
            row.classList.add('editor-table-header', 'editor-table-header-comment');
            this.element.appendChild(row);
        }

        {
            const cells = [];
            for (let i = 0; i < this.tableData.header.length; ++i) {
                const column = this.tableData.header[i];
                cells.push(EditorTable.createCell(this, textField, cursor, selection, column.references));
            }
            const row = EditorTable.createRow(cells);
            row.classList.add('editor-table-header', 'editor-table-header-references');
            this.element.appendChild(row);
        }

        for (let i = 0; i < this.tableData.body.length; ++i) {
            const cells = [];
            for (let j = 0; j < this.tableData.header.length; ++j) {
                const cell = EditorTable.createCell(this, textField, cursor, selection, this.tableData.body[i].values[j]);
                cells.push(cell);
            }
            const row = EditorTable.createRow(cells);
            this.element.appendChild(row);
        }

        for (let i = 0; i < 1000 - this.tableData.body.length; ++i) {
            const cells = [];
            for (let j = 0; j < this.tableData.header.length; ++j) {
                const cell = EditorTable.createCell(this, textField, cursor, selection, '');
                cells.push(cell);
            }
            const row = EditorTable.createRow(cells);
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

    private static createRow(cells: HTMLElement[]) {
        const row = document.createElement('div');
        row.classList.add('editor-table-row');
        for (let i = 0; i < cells.length; ++i) {
            row.appendChild(cells[i]);
        }
        return row;
    }

    private static createCell(table: EditorTable, textField: GridTextField, cursor: Cursor, selection: Selection, value: number | string | string[] | undefined) {
        const cell = document.createElement('div');
        cell.classList.add('editor-table-cell');
        cell.addEventListener('dblclick', () => {
            enableCellEditMode(table, textField, cursor, true);
        });
        cell.addEventListener('mousedown', () => {
            selectCell(table, textField, cursor, selection, cell);
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
}
