import {GridTextField} from "./grid-textfield";
import {Cursor} from "./cursor";
import {EditorTableHolder} from "./editor-table-holder";
import {EditorTableData} from "./model/editor-table-data";
import {Explorer} from "./explorer";
import {Utility} from "./utility";
import {EditorTableDataColumn} from "./model/editor-table-data-column";
import {EditorTableDataRow} from "./model/editor-table-data-row";
import {EditorTable} from "./editor-table";
import {Tab} from "./tab";

class Store {

    explorer: Explorer;

    tableName: string | undefined;

    tableData: EditorTableData | undefined;

    tableHolder: EditorTableHolder | undefined;

    table: EditorTable | undefined;

    textField: GridTextField | undefined;

    cursor: Cursor | undefined;

    tab: Tab;

    constructor() {
        this.explorer = new Explorer();
        this.tab = new Tab();
    }

    enableCellEditMode() {

        if (!this.textField) return;
        if (!this.table) return;
        if (!this.table.element) return;
        if (!this.cursor) return;
        if (!this.cursor.element) return;

        const target = this.getTarget();
        if (!target) return;

        const tableRect = this.table.element.getBoundingClientRect();
        const cellRect = target.cell.getBoundingClientRect();
        const rect = new DOMRect(
            cellRect.left - tableRect.left - 1,
            cellRect.top - tableRect.top - 1,
            cellRect.width - 1,
            cellRect.height - 1
        );

        this.cursor.move(this.cursor.row, this.cursor.column, rect);

        const cellText = target.cell.textContent ?? '';
        this.textField.show(rect, cellText);
    }

    submitText(text: string) {
        if (!this.textField) return;
        if (!this.cursor) return;

        const target = this.getTarget();
        if (!target) return;

        target.cell.textContent = text;

        this.textField.hide();
    }

    resizeTextField(textContent: string) {
        if (!this.textField) return;

        const target = this.getTarget();
        if (!target) return;

        const textFieldWidth = Utility.getTextWidth(textContent, 'normal 13px sans-serif');

        // 自分自身を探す。
        let i = 0;
        for (; i < target.row.children.length; ++i) {
            if (target.cell === target.row.children[i]) {
                break;
            }
        }

        // 自分から右側にあるセルを結合する。
        let width = - 1 - 1 - 6 - 6; // borderの1pxとpaddingの6px
        width += 1; // ←なぜか必要な1px
        for (; i < target.row.children.length; ++i) {
            const elm = target.row.children[i];
            width += elm.getBoundingClientRect().width;
            if (textFieldWidth < width) {
                break;
            }
        }

        this.textField.resize(width);
    }

    selectCell(cell: HTMLDivElement) {
        if (!this.table) return;
        if (!this.table.element) return;
        if (!this.cursor) return;
        if (!this.textField) return;

        const tableRect = this.table.element.getBoundingClientRect();
        const cellRect = cell.getBoundingClientRect();
        const rect = new DOMRect(
            cellRect.left - tableRect.left - 1,
            cellRect.top - tableRect.top - 1,
            cellRect.width - 1,
            cellRect.height - 1
        );

        let row;
        for (let i = 0; i < this.table.element.children.length; ++i) {
            if (this.table.element.children[i] === cell.parentElement) {
                row = i;
                break;
            }
        }
        if (row === undefined) return;

        let column;
        for (let i = 0; i < this.table.element.children[row].children.length; ++i) {
            if (this.table.element.children[row].children[i] === cell) {
                column = i;
                break;
            }
        }
        if (column === undefined) return;

        this.textField.submitText();
        this.textField.hide();

        this.cursor.move(row, column, rect);
    }

    moveCell(x: number, y: number) {
        console.trace(`${x}, ${y}`);

        if (!this.cursor) return;
        if (!this.table) return;
        if (!this.table.element) return;

        const rowLength = this.table.element.children.length;
        if (rowLength === 0) return;

        const columnLength = (this.table.element.children[0] as HTMLElement).children.length;
        if (columnLength === 0) return;

        const column = Math.max(Math.min(this.cursor.column + x, columnLength - 1), 0);
        const row = Math.max(Math.min(this.cursor.row + y, rowLength - 1), 0);

        const cell = this.table.element.children[row].children[column];
        if (!cell) return;

        const tableRect = this.table.element.getBoundingClientRect();
        const cellRect = cell.getBoundingClientRect();
        const rect = new DOMRect(
            cellRect.left - tableRect.left - 1,
            cellRect.top - tableRect.top - 1,
            cellRect.width - 1,
            cellRect.height - 1
        );

        this.cursor.move(row, column, rect);
    }

    getTarget() {
        if (!this.table) return;
        if (!this.table.element) return;
        if (!this.cursor) return;
        if (!this.cursor.element) return;
        const row = this.table.element.children[this.cursor.row] as HTMLElement;
        const cell = row.children[this.cursor.column] as HTMLElement;
        return { row: row, cell: cell };
    }

    serializeTable() {
        if (!this.table) return;
        if (!this.table.element) return;
        if (!this.tableData) return;

        const allChildren = Array.from(this.table.element.children) as HTMLElement[];
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
            if (comment !== null && comment !== ''){
                jsonComment = comment;
            } else {
                jsonComment = undefined;
            }

            const references = (headerReferences.children[i]?.textContent?.split(',') ?? [])
                .filter(x => x !== '');

            let jsonReference;
            if (references.length > 0) {
                jsonReference = references;
            } else {
                jsonReference = undefined;
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

    createTable(name: string, tableData: EditorTableData) {

        this.tableName = name;
        this.tableData = tableData;

        if (this.tableHolder) {
            this.tableHolder.clear();
        }

        this.tableHolder = new EditorTableHolder();

        this.table = new EditorTable(tableData);
        this.tableHolder.element.appendChild(this.table.element);

        this.cursor = new Cursor();
        this.tableHolder.element.appendChild(this.cursor.element);

        this.textField = new GridTextField();
        this.tableHolder.element.appendChild(this.textField.element);

        this.moveCell(0, 0);

        // 日本語のIMEを一文字目から入力できるように入力状態にしておきます。
        this.textField.enable();
    }
}

export default new Store();
