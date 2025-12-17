import {EditorTable} from "./editor-table";
import {Cursor} from "./cursor";
import {GridTextField} from "./grid-textfield";
import {EditorTableData} from "./model/editor-table-data";
import {Selection} from "./selection";
import {Editor} from "./editor";

export function getTarget(table: EditorTable, cursor: Cursor) {
    const row = table.element.children[cursor.row] as HTMLElement;
    const cell = row.children[cursor.column] as HTMLElement;
    return {row: row, cell: cell};
}

export function enableCellEditMode(table: EditorTable, textField: GridTextField, cursor: Cursor, preserveContent: boolean) {
    const target = getTarget(table, cursor);
    const tableRect = table.element.getBoundingClientRect();
    const cellRect = target.cell.getBoundingClientRect();
    const rect = new DOMRect(
        cellRect.left - tableRect.left - 1,
        cellRect.top - tableRect.top - 1,
        cellRect.width - 1,
        cellRect.height - 1
    );

    cursor.move(cursor.row, cursor.column, rect);

    const cellText = target.cell.textContent ?? '';
    textField.show(rect, cellText, preserveContent);
}

export function submitText(table: EditorTable, textField: GridTextField, cursor: Cursor, text: string) {
    if (!textField) return;
    if (!cursor) return;

    const target = getTarget(table, cursor);
    if (!target) return;

    target.cell.textContent = text;

    textField.hide();
}

export function selectCell(table: EditorTable, textField: GridTextField, cursor: Cursor, selection: Selection, cell: HTMLDivElement) {

    const tableRect = table.element.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const rect = new DOMRect(
        cellRect.left - tableRect.left - 1,
        cellRect.top - tableRect.top - 1,
        cellRect.width - 1,
        cellRect.height - 1
    );

    const position = EditorTable.getCellPosition(cell, table.element);
    if (!position) return;

    textField.submitText();
    textField.hide();

    cursor.move(position.row, position.column, rect);

    // 選択開始
    if (selection) {
        selection.start(position.row, position.column);
    }
}

export function moveCell(table: EditorTable, cursor: Cursor, x: number, y: number) {
    console.trace(`${x}, ${y}`);

    const rowLength = table.element.children.length;
    if (rowLength === 0) return;

    const columnLength = (table.element.children[0] as HTMLElement).children.length;
    if (columnLength === 0) return;

    const column = Math.max(Math.min(cursor.column + x, columnLength - 1), 0);
    const row = Math.max(Math.min(cursor.row + y, rowLength - 1), 0);

    const cell = table.element.children[row].children[column];
    if (!cell) return;

    const tableRect = table.element.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const rect = new DOMRect(
        cellRect.left - tableRect.left - 1,
        cellRect.top - tableRect.top - 1,
        cellRect.width - 1,
        cellRect.height - 1
    );

    cursor.move(row, column, rect);
}

export function createTable(editor: Editor, name: string, tableData: EditorTableData) {

    // 上書きする前にテーブル内のエレメントを全削除する必要があるため、呼び出しておきます。
    editor.clear();
    
    const selection = new Selection();

    const table = new EditorTable(name, tableData);
    editor.appendChild(table.element);

    selection.setTableElement(table.element);
    editor.appendChild(selection.element);

    const cursor = new Cursor();
    editor.appendChild(cursor.element);

    const textField = new GridTextField(table, cursor);
    editor.appendChild(textField.element);
    
    table.setup(textField, cursor, selection);

    // カーソルの初期位置を設定します。
    moveCell(table, cursor, 0, 0);

    // 初期選択を設定
    selection.start(0, 0);
    selection.end();

    // 日本語のIMEを一文字目から入力できるように入力状態にしておきます。
    textField.enable();
    
    return {selection, table, cursor, textField};
}
