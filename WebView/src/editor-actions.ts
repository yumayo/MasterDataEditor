import {EditorTable} from "./editor-table";
import {GridTextField} from "./grid-textfield";
import {EditorTableData} from "./model/editor-table-data";
import {Selection, FillDirection} from "./selection";
import {Editor} from "./editor";
import {History, CellChange} from "./history";
import {generateSeriesData} from "./fill-series";
import {ContextMenu} from "./context-menu";

export function getTarget(table: EditorTable, selection: Selection) {
    const focus = selection.getFocus();
    const row = table.element.children[focus.row] as HTMLElement;
    const cell = row.children[focus.column] as HTMLElement;
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
    const focus = selection.getFocus();

    const oldValue = target.cell.textContent ?? '';

    // 履歴に追加（現在のコピー範囲も保存）
    const copyRange = selection.getCopyRange();
    history.pushSingleChange(focus.row, focus.column, oldValue, text, copyRange);

    target.cell.textContent = text;

    textField.hide();
}

/**
 * 選択範囲内のすべてのセルを空にする
 */
export function clearSelectionRange(table: EditorTable, selection: Selection, history: History): void {
    const range = selection.getSelectionRange();
    const copyRange = selection.getCopyRange();
    const changes: CellChange[] = [];

    for (let r = range.startRow; r <= range.endRow; r++) {
        const rowElement = table.element.children[r] as HTMLElement;

        for (let c = range.startColumn; c <= range.endColumn; c++) {
            const cell = rowElement.children[c] as HTMLElement;
            const oldValue = cell.textContent ?? '';

            if (oldValue !== '') {
                changes.push({
                    row: r,
                    column: c,
                    oldValue: oldValue,
                    newValue: ''
                });
                cell.textContent = '';
            }
        }
    }

    if (changes.length > 0) {
        history.push({
            changes: changes,
            range: range,
            copyRange: copyRange
        });
    }
}

/**
 * 範囲選択を解除し、セルを相対座標分移動します。
 * @param table
 * @param selection
 * @param x
 * @param y
 */
export function moveCell(table: EditorTable, selection: Selection, x: number, y: number) {
    console.trace(`${x}, ${y}`);

    const rowLength = table.element.children.length;
    if (rowLength === 0) return;

    const columnLength = (table.element.children[0] as HTMLElement).children.length;
    if (columnLength === 0) return;

    const focus = selection.getFocus();
    // ヘッダー（行0、列0）は選択できないので最小値を1にする
    const column = Math.max(Math.min(focus.column + x, columnLength - 1), 1);
    const row = Math.max(Math.min(focus.row + y, rowLength - 1), 1);

    // 始点と終点を一致させることで
    selection.setRange(row, column, row, column);
    selection.move(row, column);
}

export function extendSelectionCell(table: EditorTable, selection: Selection, x: number, y: number) {
    const rowLength = table.element.children.length;
    if (rowLength === 0) return;

    const columnLength = (table.element.children[0] as HTMLElement).children.length;
    if (columnLength === 0) return;
    
    selection.getSelectionRange();

    x = Math.min(columnLength, x);
    y = Math.min(rowLength, y);
    selection.extendSelectionOffset(x, y);
}

/**
 * 範囲選択内で下方向に移動する（Enterキー用）
 * 範囲選択がない場合は通常の下方向移動
 * 範囲の最下行にいる場合は右隣の列の最上行に移動
 * 右端の列の最下行にいる場合は範囲の左上に戻る
 */
export function moveCellDownWithinSelection(table: EditorTable, selection: Selection): void {
    const range = selection.getSelectionRange();
    const focus = selection.getFocus();

    // 単一セル選択の場合は通常の移動
    if (selection.isSingleCell()) {
        moveCell(table, selection, 0, 1);
        return;
    }

    let newRow = focus.row + 1;
    let newColumn = focus.column;

    // 範囲の最下行を超えた場合
    if (newRow > range.endRow) {
        newRow = range.startRow;
        newColumn = focus.column + 1;

        // 範囲の右端を超えた場合は左上に戻る
        if (newColumn > range.endColumn) {
            newColumn = range.startColumn;
        }
    }

    selection.move(newRow, newColumn);
}

/**
 * 範囲選択内で上方向に移動する（Shift+Enterキー用）
 * 範囲選択がない場合は通常の上方向移動
 * 範囲の最上行にいる場合は左隣の列の最下行に移動
 * 左端の列の最上行にいる場合は範囲の右下に戻る
 */
export function moveCellUpWithinSelection(table: EditorTable, selection: Selection): void {
    const range = selection.getSelectionRange();
    const focus = selection.getFocus();

    // 単一セル選択の場合は通常の移動
    if (selection.isSingleCell()) {
        moveCell(table, selection, 0, -1);
        return;
    }

    let newRow = focus.row - 1;
    let newColumn = focus.column;

    // 範囲の最上行を超えた場合
    if (newRow < range.startRow) {
        newRow = range.endRow;
        newColumn = focus.column - 1;

        // 範囲の左端を超えた場合は右下に戻る
        if (newColumn < range.startColumn) {
            newColumn = range.endColumn;
        }
    }

    selection.move(newRow, newColumn);
}

/**
 * 範囲選択内で右方向に移動する（Tabキー用）
 * 範囲選択がない場合は通常の右方向移動
 * 範囲の右端にいる場合は次の行の左端に移動
 * 右端の最下行にいる場合は範囲の左上に戻る
 */
export function moveCellRightWithinSelection(table: EditorTable, selection: Selection): void {
    const range = selection.getSelectionRange();
    const focus = selection.getFocus();

    // 単一セル選択の場合は通常の移動
    if (selection.isSingleCell()) {
        moveCell(table, selection, 1, 0);
        return;
    }

    let newRow = focus.row;
    let newColumn = focus.column + 1;

    // 範囲の右端を超えた場合
    if (newColumn > range.endColumn) {
        newColumn = range.startColumn;
        newRow = focus.row + 1;

        // 範囲の最下行を超えた場合は左上に戻る
        if (newRow > range.endRow) {
            newRow = range.startRow;
        }
    }

    selection.move(newRow, newColumn);
}

/**
 * 範囲選択内で左方向に移動する（Shift+Tabキー用）
 * 範囲選択がない場合は通常の左方向移動
 * 範囲の左端にいる場合は前の行の右端に移動
 * 左端の最上行にいる場合は範囲の右下に戻る
 */
export function moveCellLeftWithinSelection(table: EditorTable, selection: Selection): void {
    const range = selection.getSelectionRange();
    const focus = selection.getFocus();

    // 単一セル選択の場合は通常の移動
    if (selection.isSingleCell()) {
        moveCell(table, selection, -1, 0);
        return;
    }

    let newRow = focus.row;
    let newColumn = focus.column - 1;

    // 範囲の左端を超えた場合
    if (newColumn < range.startColumn) {
        newColumn = range.endColumn;
        newRow = focus.row - 1;

        // 範囲の最上行を超えた場合は右下に戻る
        if (newRow < range.startRow) {
            newRow = range.endRow;
        }
    }

    selection.move(newRow, newColumn);
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

    const contextMenu = new ContextMenu(editor.element);

    table.setup(textField, selection, contextMenu);

    // 初期選択をA1（row=1, column=1）に設定（row=0は列ヘッダー、column=0は行ヘッダー）
    selection.setRange(1, 1, 1, 1);
    selection.move(1, 1);

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

    // 選択範囲を更新（ソース + ターゲット）
    const newStartRow = Math.min(sourceStartRow, targetStartRow);
    const newStartColumn = Math.min(sourceStartColumn, targetStartColumn);
    const newEndRow = Math.max(sourceEndRow, targetEndRow);
    const newEndColumn = Math.max(sourceEndColumn, targetEndColumn);

    // 履歴に追加（フィル前のソース範囲を保存）
    // Undo時: ソース範囲に戻る
    // Redo時: changesを含めた範囲が計算される（ソース＋ターゲット）
    const copyRange = selection.getCopyRange();
    history.push({
        changes,
        range: {
            startRow: sourceStartRow,
            startColumn: sourceStartColumn,
            endRow: sourceEndRow,
            endColumn: sourceEndColumn
        },
        copyRange: copyRange
    });

    selection.setRange(newStartRow, newStartColumn, newEndRow, newEndColumn);
}
