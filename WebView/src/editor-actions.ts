import {EditorTable} from "./editor-table";
import {GridTextField} from "./grid-textfield";
import {EditorTableData} from "./model/editor-table-data";
import {Selection, FillDirection} from "./selection";
import {Editor} from "./editor";
import {History, CellChange} from "./history";
import {generateSeriesData} from "./fill-series";

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

export function extendSelectionCell(table: EditorTable, selection: Selection, x: number, y: number) {
    const rowLength = table.element.children.length;
    if (rowLength === 0) return;

    const columnLength = (table.element.children[0] as HTMLElement).children.length;
    if (columnLength === 0) return;

    const focus = selection.getFocus();
    const column = Math.max(Math.min(focus.column + x, columnLength - 1), 0);
    const row = Math.max(Math.min(focus.row + y, rowLength - 1), 0);

    selection.extendSelection(row, column);
}

export function createTable(editor: Editor, name: string, tableData: EditorTableData) {

    // 上書きする前にテーブル内のエレメントを全削除する必要があるため、呼び出しておきます。
    editor.clear();

    const table = new EditorTable(name, tableData);
    editor.appendChild(table.element);

    const selection = new Selection(table.element, editor.element);

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

/**
 * 連続データを生成してセルに適用する
 */
export function applyFillSeries(
    table: EditorTable,
    selection: Selection,
    history: History,
    direction: FillDirection,
    sourceStartRow: number,
    sourceStartColumn: number,
    sourceEndRow: number,
    sourceEndColumn: number,
    targetStartRow: number,
    targetStartColumn: number,
    targetEndRow: number,
    targetEndColumn: number,
    count: number
): void {
    // ソースデータを取得
    const sourceValues: string[][] = [];
    for (let r = sourceStartRow; r <= sourceEndRow; r++) {
        const rowElement = table.element.children[r] as HTMLElement;
        const rowValues: string[] = [];
        for (let c = sourceStartColumn; c <= sourceEndColumn; c++) {
            const cell = rowElement.children[c] as HTMLElement;
            rowValues.push(cell.textContent ?? '');
        }
        sourceValues.push(rowValues);
    }

    // 連続データを生成
    const generatedData = generateSeriesData(sourceValues, direction, count);

    // 履歴用の変更リスト
    const changes: CellChange[] = [];

    // 生成したデータをセルに適用
    if (direction === 'down') {
        for (let i = 0; i < count; i++) {
            const targetRow = targetStartRow + i;
            const rowElement = table.element.children[targetRow] as HTMLElement;
            for (let c = targetStartColumn; c <= targetEndColumn; c++) {
                const cell = rowElement.children[c] as HTMLElement;
                const oldValue = cell.textContent ?? '';
                const newValue = generatedData[i][c - targetStartColumn];
                changes.push({ row: targetRow, column: c, oldValue, newValue });
                cell.textContent = newValue;
            }
        }
    } else if (direction === 'up') {
        for (let i = 0; i < count; i++) {
            const targetRow = targetEndRow - i;
            const rowElement = table.element.children[targetRow] as HTMLElement;
            for (let c = targetStartColumn; c <= targetEndColumn; c++) {
                const cell = rowElement.children[c] as HTMLElement;
                const oldValue = cell.textContent ?? '';
                const newValue = generatedData[i][c - targetStartColumn];
                changes.push({ row: targetRow, column: c, oldValue, newValue });
                cell.textContent = newValue;
            }
        }
    } else if (direction === 'right') {
        for (let r = targetStartRow; r <= targetEndRow; r++) {
            const rowElement = table.element.children[r] as HTMLElement;
            const generatedRow = generatedData[r - targetStartRow];
            for (let i = 0; i < count; i++) {
                const targetCol = targetStartColumn + i;
                const cell = rowElement.children[targetCol] as HTMLElement;
                const oldValue = cell.textContent ?? '';
                const newValue = generatedRow[i];
                changes.push({ row: r, column: targetCol, oldValue, newValue });
                cell.textContent = newValue;
            }
        }
    } else if (direction === 'left') {
        for (let r = targetStartRow; r <= targetEndRow; r++) {
            const rowElement = table.element.children[r] as HTMLElement;
            const generatedRow = generatedData[r - targetStartRow];
            for (let i = 0; i < count; i++) {
                const targetCol = targetEndColumn - i;
                const cell = rowElement.children[targetCol] as HTMLElement;
                const oldValue = cell.textContent ?? '';
                const newValue = generatedRow[i];
                changes.push({ row: r, column: targetCol, oldValue, newValue });
                cell.textContent = newValue;
            }
        }
    }

    // 履歴に追加
    history.push({ changes });

    // 選択範囲を更新（ソース + ターゲット）
    const newStartRow = Math.min(sourceStartRow, targetStartRow);
    const newStartColumn = Math.min(sourceStartColumn, targetStartColumn);
    const newEndRow = Math.max(sourceEndRow, targetEndRow);
    const newEndColumn = Math.max(sourceEndColumn, targetEndColumn);

    selection.setRange(newStartRow, newStartColumn, newEndRow, newEndColumn);
}
