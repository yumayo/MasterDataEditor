import {EditorTable} from "./editor-table";
import {GridTextField} from "./grid-textfield";
import {Selection, FillDirection} from "./selection";
import {History} from "./history";
import {CellChange} from "./command";
import {generateSeriesData} from "./fill-series";
import {Csv} from "./csv";
import {readFileAsync, writeFileAsync} from "./api";

/**
 * フォーカスセルの情報を取得する
 */
export function getTarget(table: EditorTable, selection: Selection) {
    const focus = selection.getFocus();
    return {
        row: focus.row,
        column: focus.column,
        cellRect: table.getCellRectAt(focus.row, focus.column),
        cellValue: table.getCellValueAt(focus.row, focus.column)
    };
}

export function enableCellEditMode(table: EditorTable, textField: GridTextField, selection: Selection, preserveContent: boolean) {
    const target = getTarget(table, selection);
    const tableRect = table.getTableBoundingClientRect();
    const cellRect = target.cellRect;
    const rect = new DOMRect(
        cellRect.left - tableRect.left - 1,
        cellRect.top - tableRect.top,
        cellRect.width + 1,
        cellRect.height
    );

    textField.show(rect, target.cellValue, preserveContent);
}

export function submitText(table: EditorTable, textField: GridTextField, selection: Selection, text: string, history: History) {
    const target = getTarget(table, selection);

    // 履歴に追加（現在のコピー範囲も保存）
    const copyRange = selection.getCopyRange();
    history.pushSingleChange(target.row, target.column, target.cellValue, text, copyRange);

    table.setCellValueAt(target.row, target.column, text);

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
        for (let c = range.startColumn; c <= range.endColumn; c++) {
            const oldValue = table.getCellValueAt(r, c);

            if (oldValue !== '') {
                changes.push({
                    row: r,
                    column: c,
                    oldValue: oldValue,
                    newValue: ''
                });
                table.setCellValueAt(r, c, '');
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

    const rowLength = table.getRowCount();
    if (rowLength === 0) return;

    const columnLength = table.getTotalColumnCount();
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
    const rowLength = table.getRowCount();
    if (rowLength === 0) return;

    const columnLength = table.getTotalColumnCount();
    if (columnLength === 0) return;

    const maxRow = rowLength - 1;
    const maxColumn = columnLength - 1;

    selection.extendSelectionOffset(x, y, maxRow, maxColumn);
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
        const rowValues: string[] = [];
        for (let c = sourceStartColumn; c <= sourceEndColumn; c++) {
            rowValues.push(table.getCellValueAt(r, c));
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
            for (let c = targetStartColumn; c <= targetEndColumn; c++) {
                const oldValue = table.getCellValueAt(targetRow, c);
                const newValue = generatedData[i][c - targetStartColumn];
                changes.push({ row: targetRow, column: c, oldValue, newValue });
                table.setCellValueAt(targetRow, c, newValue);
            }
        }
    } else if (direction === 'up') {
        for (let i = 0; i < count; i++) {
            const targetRow = targetEndRow - i;
            for (let c = targetStartColumn; c <= targetEndColumn; c++) {
                const oldValue = table.getCellValueAt(targetRow, c);
                const newValue = generatedData[i][c - targetStartColumn];
                changes.push({ row: targetRow, column: c, oldValue, newValue });
                table.setCellValueAt(targetRow, c, newValue);
            }
        }
    } else if (direction === 'right') {
        for (let r = targetStartRow; r <= targetEndRow; r++) {
            const generatedRow = generatedData[r - targetStartRow];
            for (let i = 0; i < count; i++) {
                const targetCol = targetStartColumn + i;
                const oldValue = table.getCellValueAt(r, targetCol);
                const newValue = generatedRow[i];
                changes.push({ row: r, column: targetCol, oldValue, newValue });
                table.setCellValueAt(r, targetCol, newValue);
            }
        }
    } else if (direction === 'left') {
        for (let r = targetStartRow; r <= targetEndRow; r++) {
            const generatedRow = generatedData[r - targetStartRow];
            for (let i = 0; i < count; i++) {
                const targetCol = targetEndColumn - i;
                const oldValue = table.getCellValueAt(r, targetCol);
                const newValue = generatedRow[i];
                changes.push({ row: r, column: targetCol, oldValue, newValue });
                table.setCellValueAt(r, targetCol, newValue);
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

/**
 * テーブルのDOMからCSVデータを抽出する
 * @param table EditorTable
 * @returns ヘッダー配列とボディ配列
 */
function extractTableData(table: EditorTable): { header: string[]; body: string[][] } {
    const header: string[] = [];
    const body: string[][] = [];

    const columnCount = table.getColumnCount();
    const rowCount = table.getRowCount();

    // 列ヘッダーを取得
    for (let c = 0; c < columnCount; c++) {
        header.push(table.getColumnHeaderValue(c));
    }

    // 行1以降がデータ行
    for (let r = 1; r < rowCount; r++) {
        const rowData: string[] = [];

        // 列0は行ヘッダーなのでスキップ（column=1から開始）
        for (let c = 1; c <= columnCount; c++) {
            rowData.push(table.getCellValueAt(r, c));
        }

        // 最初のセルが空でない行のみ追加（データがある行のみ保存）
        if (rowData.length > 0 && rowData[0] !== '') {
            body.push(rowData);
        } else {
            // 空行に到達したら終了
            break;
        }
    }

    return { header, body };
}

/**
 * 既存CSVとテーブルデータをマージする
 * - 既存CSVのヘッダーを基準にする
 * - テーブルの列が既存CSVにあれば、その位置のデータを上書き
 * - テーブルの列が既存CSVになければ、新しい列として追加
 *
 * @param existingCsv 既存のCSV
 * @param tableData テーブルから抽出したデータ
 * @returns マージされたCSV
 */
function mergeCsvData(existingCsv: Csv, tableData: { header: string[]; body: string[][] }): Csv {
    const resultCsv = new Csv();

    // 既存CSVのヘッダーをベースに、新しい列を追加
    const mergedHeader: string[] = [...existingCsv.header];
    const tableToMergedIndex: number[] = [];  // テーブル列 -> マージ後のCSV列のマッピング

    for (let i = 0; i < tableData.header.length; i++) {
        const columnName = tableData.header[i];
        const existingIndex = existingCsv.header.indexOf(columnName);

        if (existingIndex !== -1) {
            // 既存CSVに存在する列
            tableToMergedIndex.push(existingIndex);
        } else {
            // 新しい列を追加
            tableToMergedIndex.push(mergedHeader.length);
            mergedHeader.push(columnName);
        }
    }

    resultCsv.header = mergedHeader;

    // ボディデータをマージ
    const mergedBody: string[][] = [];
    for (let r = 0; r < tableData.body.length; r++) {
        const tableRow = tableData.body[r];
        // マージ後のヘッダーの長さで空行を初期化
        const mergedRow: string[] = new Array(mergedHeader.length).fill('');

        // テーブルのデータを対応する列に配置
        for (let c = 0; c < tableRow.length; c++) {
            const mergedIndex = tableToMergedIndex[c];
            mergedRow[mergedIndex] = tableRow[c];
        }

        mergedBody.push(mergedRow);
    }

    resultCsv.body = mergedBody;

    return resultCsv;
}

/**
 * テーブルデータをCSVファイルに保存する（既存CSVとマージ）
 * @param table EditorTable
 */
export async function saveTableData(table: EditorTable): Promise<void> {
    const tableName = table.tableName;
    const csvPath = `data/${tableName}.csv`;

    // テーブルからデータを抽出
    const tableData = extractTableData(table);

    // 既存CSVを読み込む
    let existingCsv = new Csv();
    try {
        const existingCsvContents = await readFileAsync(csvPath);
        existingCsv.load(existingCsvContents);
    } catch {
        // ファイルが存在しない場合は空のCSVとして扱う
        existingCsv.header = [];
        existingCsv.body = [];
    }

    // マージ
    const mergedCsv = mergeCsvData(existingCsv, tableData);

    // 保存
    await writeFileAsync(csvPath, mergedCsv.toString());

    console.log(`Saved ${csvPath}`);
}
