import {EditorTable} from "./editor-table";
import {GridTextField} from "./grid-textfield";
import {EditorTableData} from "./model/editor-table-data";
import {Selection} from "./selection";
import {Editor} from "./editor";
import {History} from "./history";

export function getTarget(table: EditorTable, selection: Selection) {
    const row = table.element.children[selection.row] as HTMLElement;
    const cell = row.children[selection.column] as HTMLElement;
    return {row: row, cell: cell};
}

export function enableCellEditMode(table: EditorTable, textField: GridTextField, selection: Selection, preserveContent: boolean) {
    const target = getTarget(table, selection);
    const tableRect = table.element.getBoundingClientRect();
    const cellRect = target.cell.getBoundingClientRect();
    const rect = new DOMRect(
        cellRect.left - tableRect.left - 1,
        cellRect.top - tableRect.top - 1,
        cellRect.width - 1,
        cellRect.height - 1
    );

    const cellText = target.cell.textContent ?? '';
    textField.show(rect, cellText, preserveContent);
}

export function submitText(table: EditorTable, textField: GridTextField, selection: Selection, text: string, history: History) {
    const target = getTarget(table, selection);

    const oldValue = target.cell.textContent ?? '';

    // 履歴に追加
    history.pushSingleChange(selection.row, selection.column, oldValue, text);

    target.cell.textContent = text;

    textField.hide();
}

export function selectCell(table: EditorTable, textField: GridTextField, selection: Selection, cell: HTMLDivElement) {
    const position = EditorTable.getCellPosition(cell, table.element);
    if (!position) return;

    textField.submitText();
    textField.hide();

    // 選択開始
    selection.start(position.row, position.column);
}

export function moveCell(table: EditorTable, selection: Selection, x: number, y: number) {
    console.trace(`${x}, ${y}`);

    const rowLength = table.element.children.length;
    if (rowLength === 0) return;

    const columnLength = (table.element.children[0] as HTMLElement).children.length;
    if (columnLength === 0) return;

    const column = Math.max(Math.min(selection.column + x, columnLength - 1), 0);
    const row = Math.max(Math.min(selection.row + y, rowLength - 1), 0);

    selection.move(row, column);
}

export function createTable(editor: Editor, name: string, tableData: EditorTableData) {

    // 上書きする前にテーブル内のエレメントを全削除する必要があるため、呼び出しておきます。
    editor.clear();

    const table = new EditorTable(name, tableData);
    editor.appendChild(table.element);

    const selection = new Selection(table.element);

    // 履歴管理（最大1000件）
    const history = new History(table.element, 1000);

    const textField = new GridTextField(table, selection, history);
    editor.appendChild(textField.element);

    table.setup(textField, selection);

    // 初期選択を設定
    selection.move(0, 0);

    // 日本語のIMEを一文字目から入力できるように入力状態にしておきます。
    textField.enable();

    return {selection, table, textField, history};
}
