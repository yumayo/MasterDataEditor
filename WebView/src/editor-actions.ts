import {EditorTable} from "./editor-table";
import {Selection, FillDirection} from "./selection";
import {History} from "./history";
import {CellChange, CellChangeCommand, CompositeCommand, PromoteBufferRowCommand} from "./command";
import {generateSeriesData} from "./fill-series";
import {readFileAsync, writeFileAsync} from "./api";
import {InMemoryTableStore} from "./in-memory-table-store";

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

    // 変更リストを収集（読み取りフェーズ: oldValueをDOMから取得）
    const changes: CellChange[] = [];
    if (direction === 'down') {
        for (let i = 0; i < count; i++) {
            const targetRow = targetStartRow + i;
            for (let c = targetStartColumn; c <= targetEndColumn; c++) {
                const oldValue = table.getCellValueAt(targetRow, c);
                const newValue = generatedData[i][c - targetStartColumn];
                changes.push({ row: targetRow, column: c, oldValue, newValue });
            }
        }
    } else if (direction === 'up') {
        for (let i = 0; i < count; i++) {
            const targetRow = targetEndRow - i;
            for (let c = targetStartColumn; c <= targetEndColumn; c++) {
                const oldValue = table.getCellValueAt(targetRow, c);
                const newValue = generatedData[i][c - targetStartColumn];
                changes.push({ row: targetRow, column: c, oldValue, newValue });
            }
        }
    } else if (direction === 'right') {
        for (let r = targetStartRow; r <= targetEndRow; r++) {
            const generatedRow = generatedData[r - targetStartRow];
            for (let i = 0; i < count; i++) {
                const targetCol = targetStartColumn + i;
                const oldValue = table.getCellValueAt(r, targetCol);
                changes.push({ row: r, column: targetCol, oldValue, newValue: generatedRow[i] });
            }
        }
    } else if (direction === 'left') {
        for (let r = targetStartRow; r <= targetEndRow; r++) {
            const generatedRow = generatedData[r - targetStartRow];
            for (let i = 0; i < count; i++) {
                const targetCol = targetEndColumn - i;
                const oldValue = table.getCellValueAt(r, targetCol);
                changes.push({ row: r, column: targetCol, oldValue, newValue: generatedRow[i] });
            }
        }
    }
    // バッファ空行（ストア未登録行）への変更が含まれる場合、昇格処理を行う。
    // applyCellChangesWithHistory と同じパターン:
    //   1. 昇格前の storeRowIndices.length を記録
    //   2. promoteBufferRowToStore を呼んでストアに行を追加
    //   3. PromoteBufferRowCommand を生成して CompositeCommand として履歴に積む
    const promoteCommands: PromoteBufferRowCommand[] = [];
    const promotedDomDataRowIndices = new Set<number>();
    for (const change of changes) {
        const domDataRowIndex = change.row - 1; // DOM行インデックス(1始まり) → DOMデータ行インデックス(0始まり)
        if (domDataRowIndex >= 0 && table.isBufferRow(domDataRowIndex) && !promotedDomDataRowIndices.has(domDataRowIndex)) {
            const lengthBefore = table.getStoreRowIndices().length;
            table.promoteBufferRowToStore(domDataRowIndex);
            promoteCommands.push(new PromoteBufferRowCommand(table, domDataRowIndex, lengthBefore));
            promotedDomDataRowIndices.add(domDataRowIndex);
        }
    }

    // 書き込みフェーズ: DOM更新 + ソーステーブル伝搬を一括実行
    const allChanges = table.applyCellChanges(changes);

    // 選択範囲を更新（ソース + ターゲット）
    const newStartRow = Math.min(sourceStartRow, targetStartRow);
    const newStartColumn = Math.min(sourceStartColumn, targetStartColumn);
    const newEndRow = Math.max(sourceEndRow, targetEndRow);
    const newEndColumn = Math.max(sourceEndColumn, targetEndColumn);

    // 履歴に追加（フィル前のソース範囲を保存）
    // Undo時: ソース範囲に戻る
    const copyRange = selection.getCopyRange();
    const fillRange = {
        startRow: sourceStartRow,
        startColumn: sourceStartColumn,
        endRow: sourceEndRow,
        endColumn: sourceEndColumn
    };

    if (promoteCommands.length > 0) {
        // バッファ昇格が発生した場合は CompositeCommand として積む
        const meaningfulChanges = allChanges.filter(c => c.oldValue !== c.newValue);
        const commands = [
            ...promoteCommands,
            ...(meaningfulChanges.length > 0
                ? [new CellChangeCommand(table, meaningfulChanges, fillRange, copyRange)]
                : []),
        ];
        history.pushCommand(new CompositeCommand(commands), fillRange, copyRange);
    } else {
        history.push({ changes: allChanges, range: fillRange, copyRange });
    }

    selection.setRange(newStartRow, newStartColumn, newEndRow, newEndColumn);
}

/**
 * スキーマJSONに列幅を保存する
 * 既存JSONを読み込んでwidthフィールドだけ更新することで、
 * serialize()では保持できないフィールド（unique_key, index等）を破壊しない
 */
export async function saveSchemaDataAsync(table: EditorTable): Promise<void> {
    const tableName = table.tableName;
    const schemaPath = `schema/${tableName}.json`;

    const existingSchemaText = await readFileAsync(schemaPath);
    const existingSchema = JSON.parse(existingSchemaText);

    // 現在のDOM列幅を取得してヘッダーに反映
    const columnWidths = table.getColumnWidths();
    const header = existingSchema['header'];
    for (let i = 0; i < header.length && i < columnWidths.length; i++) {
        header[i].width = parseInt(columnWidths[i]);
    }

    await writeFileAsync(schemaPath, JSON.stringify(existingSchema, null, 4));
}

/**
 * ストアのデータからCSVを保存する
 *
 * ストアはSSOT（信頼できる唯一の情報源）として全行・全列のデータを保持する。
 * DOM経由の保存（旧: saveTableData）は「最初のセルが空の行で終了」するため、
 * 行挿入で追加した空行がストア内にある場合にデータが欠落する。
 * ストアから直接保存することで挿入・削除を含む全変更を正確にCSVに反映できる。
 *
 * @param tableName 保存するテーブル名（= ファイルパス `data/tableName.csv` の tableName）
 * @param store InMemoryTableStore（全行全列データを持つ）
 */
export async function saveTableDataFromStoreAsync(tableName: string, store: InMemoryTableStore): Promise<void> {
    const csvPath = `data/${tableName}.csv`;
    const csv = store.getCsv(tableName);
    if (csv === false) {
        // 呼び出し元（Ctrl+Sハンドラ）の時点でミニテーブルが存在する = ストアへの登録済みが保証されている
        // ストアに存在しないまま保存が呼ばれたのはバグなので例外で知らせる
        throw new Error(`[saveTableDataFromStoreAsync] テーブル "${tableName}" がストアに存在しません`);
    }
    await writeFileAsync(csvPath, csv.toString());
}

/**
 * 差分タブの右ペイン専用の保存関数
 *
 * 差分タブのストアキーは "tableName:diff:current" のような不正パスのため、
 * 保存先ファイル（saveTableName）とデータ取得元（storeKey）を分離して渡す。
 *
 * @param saveTableName 保存先テーブル名（= ファイルパス `data/saveTableName.csv`）
 * @param store InMemoryTableStore（全行全列データを持つ）
 * @param storeKey ストアのキー（差分タブでは "tableName:diff:current" 等の専用キー）
 */
export async function saveDiffTableDataFromStoreAsync(saveTableName: string, store: InMemoryTableStore, storeKey: string): Promise<void> {
    const csvPath = `data/${saveTableName}.csv`;
    const csv = store.getCsv(storeKey);
    if (csv === false) {
        throw new Error(`[saveDiffTableDataFromStoreAsync] ストアキー "${storeKey}" がストアに存在しません`);
    }
    await writeFileAsync(csvPath, csv.toString());
}
