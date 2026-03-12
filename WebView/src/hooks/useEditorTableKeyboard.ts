import {useEffect} from 'react';
import {useSelectionStore} from '../stores/selection-store';
import {useTableStore} from '../stores/table-store';
import {useHistoryStore, CellChangeCommand, InsertRowCommand, DeleteRowCommand, InsertColumnCommand, DeleteColumnCommand, BatchCommand, PromoteBufferRowCommand} from '../stores/history-store';
import {useTabStore} from '../stores/tab-store';
import type {CellPosition, CellRange} from '../types/selection-types';
import type {DropdownItem} from '../components/GridDropdownInput';
import {writeFileAsync} from '../api';
import {Csv} from '../csv';
import {config} from '../config';
import {Utility} from '../utility';

/**
 * スキーマの列定義（reference プロパティの有無で FK 列を判定する）
 */
export interface ColumnSchema {
    name: string;
    reference?: string;
    /** スキーマJSONの列幅(px)。未指定の場合はカラム名から自動計算する */
    width?: number;
}

/**
 * useEditorTableKeyboard フックが返す行/列操作アクション群
 * コンテキストメニューなど外部から呼び出す際に使用する
 */
export interface EditorTableKeyboardActions {
    /** フォーカス行の上に空行を挿入する */
    insertRowAbove: () => void;
    /** フォーカス行の下に空行を挿入する */
    insertRowBelow: () => void;
    /** 選択範囲の行をすべて削除する */
    deleteSelectedRows: () => void;
    /** フォーカス列の左に空列を挿入する */
    insertColumnLeft: () => void;
    /** フォーカス列の右に空列を挿入する */
    insertColumnRight: () => void;
    /** 選択範囲の列をすべて削除する */
    deleteSelectedColumns: () => void;
}

/** FK自動埋め込みエントリ（バッファ行昇格後にFKカラムへ自動設定する） */
export interface AutoFillEntry {
    columnName: string;
    value: string;
}

/**
 * useEditorTableKeyboard フックのオプション
 */
interface UseEditorTableKeyboardOptions {
    /** テーブル名 */
    tableName: string;
    /** キーボードイベントが有効か */
    enabled: boolean;
    /** 列スキーマ（FK列判定用）。ヘッダー列と同じ順序で渡す */
    columnSchemas: ColumnSchema[];
    /**
     * FK列で編集開始する際に呼ばれるコールバック。
     * 非FK列の場合は通常の startEditing() を使用する。
     */
    onShowDropdown: (items: DropdownItem[], position: {top: number; left: number; width: number}, filterText: string) => void;
    /**
     * バッファ行昇格後に自動設定するFK値のリスト。
     * 1:Nミニテーブルで行追加時に親テーブルのFK値を自動埋めするために使用する。
     */
    autoFillEntries: AutoFillEntry[];
    /**
     * DOMの行インデックス（0始まり）からストアの行インデックスへのマッピング。
     * null の場合は通常テーブル（ミニテーブルではない）として扱う。
     * null でない場合はミニテーブルとして F12 定義ジャンプを有効にする。
     */
    storeRowIndices: number[] | null;
}

/**
 * テーブルの列数を取得するヘルパー
 * ヘッダーが存在しない場合は 0 を返す
 */
function getColumnCount(tableName: string): number {
    const header = useTableStore.getState().getHeader(tableName);
    return header === false ? 0 : header.length;
}

/**
 * テーブルのデータ行数を取得するヘルパー
 * 行データが存在しない場合は 0 を返す
 */
function getRowCount(tableName: string): number {
    const rows = useTableStore.getState().getRows(tableName);
    return rows === false ? 0 : rows.length;
}

/**
 * バッファ行にフォーカスがある場合にストアへ昇格する。
 * targetDomRowIndex がストア行数以上の場合に PromoteBufferRowCommand を実行し、
 * autoFillEntries で指定されたFK列の値を設定する。
 * 既にストア行の場合は何もしない。
 * 戻り値: 昇格または既存ストア行の場合は true、ストア未登録テーブルの場合は false
 */
function promoteBufferRowIfNeeded(tableName: string, targetDomRowIndex: number, autoFillEntries: AutoFillEntry[]): boolean {
    const header = useTableStore.getState().getHeader(tableName);
    if (header === false) return false;
    const rows = useTableStore.getState().getRows(tableName);
    const storeRowCount = rows === false ? 0 : rows.length;
    // 既存のストア行であれば昇格不要
    if (targetDomRowIndex < storeRowCount) return true;
    // バッファ行: PromoteBufferRowCommand で昇格する
    const columnCount = header.length;
    const {range, copyRange} = useSelectionStore.getState();
    const singleRange: CellRange = {
        startRow: targetDomRowIndex + 1, startColumn: range.startColumn,
        endRow: targetDomRowIndex + 1, endColumn: range.startColumn,
    };
    const promoteCmd = new PromoteBufferRowCommand(tableName, targetDomRowIndex, columnCount);
    useHistoryStore.getState().executeCommand(tableName, promoteCmd, singleRange, copyRange);
    // autoFillEntries のFK値を昇格行に設定する（BatchCommand にまとめてUndoの粒度を保つ）
    if (autoFillEntries.length > 0) {
        const newRows = useTableStore.getState().getRows(tableName);
        if (newRows !== false) {
            const changes = autoFillEntries.flatMap(entry => {
                const colIndex = header.indexOf(entry.columnName);
                if (colIndex === -1) return [];
                // 昇格で追加された行（targetDomRowIndex 以下）すべてにFK値を設定する
                const startRowIndex = storeRowCount;
                const endRowIndex = newRows.length - 1;
                const result: Array<{tableName: string; rowIndex: number; colIndex: number; oldValue: string; newValue: string}> = [];
                for (let ri = startRowIndex; ri <= endRowIndex; ri++) {
                    const oldValue = newRows[ri][colIndex];
                    if (oldValue !== entry.value) {
                        result.push({tableName, rowIndex: ri, colIndex, oldValue, newValue: entry.value});
                    }
                }
                return result;
            });
            if (changes.length > 0) {
                const fillCmd = new CellChangeCommand(changes);
                useHistoryStore.getState().executeCommand(tableName, fillCmd, singleRange, copyRange);
            }
        }
    }
    return true;
}

/**
 * フォーカスを指定の行・列に移動し、選択範囲もそこに更新するヘルパー
 */
function moveFocus(row: number, column: number): void {
    const pos: CellPosition = {row, column};
    const range: CellRange = {startRow: row, startColumn: column, endRow: row, endColumn: column};
    useSelectionStore.getState().select(range, pos);
}

/**
 * クリップボードテキストを2次元配列にパースする
 * 末尾の改行を除去し、行をタブ区切りで分割する
 */
function parseClipboardText(text: string): string[][] {
    const trimmed = text.replace(/\r?\n$/, '');
    return trimmed.split(/\r?\n/).map(line => line.split('\t'));
}

/**
 * HTML特殊文字をエスケープする
 */
function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * 選択範囲がソースデータの倍数サイズかどうかを判定する
 * 倍数ペーストの場合は選択範囲全体にソースデータを繰り返し埋め込む
 */
function shouldFillSelection(
    selectionRows: number, selectionCols: number,
    sourceRows: number, sourceCols: number
): boolean {
    const isRowMultiple = selectionRows >= sourceRows && selectionRows % sourceRows === 0;
    const isColumnMultiple = selectionCols >= sourceCols && selectionCols % sourceCols === 0;
    const isLarger = selectionRows > sourceRows || selectionCols > sourceCols;
    return isRowMultiple && isColumnMultiple && isLarger;
}

/**
 * EditorTableのキーボードショートカット管理フック
 *
 * - enabled が true のときのみ document.keydown リスナーを登録する
 * - tableName の activeTableName 確認は行わない（enabled で制御するのが呼び出し元の責務）
 *
 * 対応キー:
 *   矢印キー        — フォーカスを上下左右に移動する（Shift+矢印で範囲拡張）
 *   Enter          — フォーカスを1行下に移動する
 *   Tab            — フォーカスを1列右に移動する（最終列では折り返さない）
 *   Shift+Tab      — フォーカスを1列左に移動する
 *   Escape         — 選択をフォーカスセルのみにリセットし、コピー範囲をクリアする
 *   Delete/Backspace — フォーカスセルの値をクリアする（table-store を更新）
 *   Ctrl+C         — 選択範囲をコピー範囲に設定してクリップボードに書き込む
 *   Ctrl+A         — テーブル全体を選択する
 *   Ctrl+Z         — Undo（history-store 経由）
 *   Ctrl+Y         — Redo（history-store 経由）
 *   Ctrl+V         — クリップボードからペーストする
 *   Ctrl+S         — 保存（未実装）
 *   F2             — セル編集開始
 */
/**
 * ミニテーブルのフォーカス行のPK値を取得するヘルパー。
 * PK列が存在しない・行が範囲外・値が空の場合は null を返す。
 */
function getMiniTableFocusPkValue(tableName: string, focusRow: number, storeRowIndices: number[]): string | null {
    const header = useTableStore.getState().getHeader(tableName);
    const rows = useTableStore.getState().getRows(tableName);
    if (header === false || rows === false) return null;
    const pkColIndex = header.indexOf(config.primaryKeyColumnName);
    if (pkColIndex === -1) return null;
    // focusRow は UI上1始まり → DOM行インデックスは focusRow - 1
    const domRowIndex = focusRow - 1;
    if (domRowIndex < 0 || domRowIndex >= storeRowIndices.length) return null;
    const storeRowIndex = storeRowIndices[domRowIndex];
    if (storeRowIndex < 0 || storeRowIndex >= rows.length) return null;
    const pkValue = rows[storeRowIndex][pkColIndex];
    if (pkValue === '') return null;
    return pkValue;
}

export function useEditorTableKeyboard({tableName, enabled, columnSchemas, onShowDropdown, autoFillEntries, storeRowIndices}: UseEditorTableKeyboardOptions): EditorTableKeyboardActions {
    useEffect(() => {
        if (!enabled) return;

        function handleKeyDown(e: KeyboardEvent): void {
            const {focus, range, editing} = useSelectionStore.getState();

            // 編集中（GridTextField がフォーカスを持つ）はすべてのキーを GridTextField に委任する
            if (editing) return;

            const columnCount = getColumnCount(tableName);
            const rowCount = getRowCount(tableName);

            // 行・列の上限（データ行は1始まり、列は1始まり）
            const maxRow = rowCount;
            const maxColumn = columnCount;

            // Ctrl系ショートカットの処理
            if (e.ctrlKey || e.metaKey) {
                if (e.key === 'c' || e.key === 'C') {
                    e.preventDefault();
                    // 選択範囲を正規化する（startRow <= endRow, startColumn <= endColumn）
                    const normalizedRange: CellRange = {
                        startRow: Math.min(range.startRow, range.endRow),
                        startColumn: Math.min(range.startColumn, range.endColumn),
                        endRow: Math.max(range.startRow, range.endRow),
                        endColumn: Math.max(range.startColumn, range.endColumn),
                    };
                    useSelectionStore.getState().setCopyRange(normalizedRange);
                    // クリップボードに text/plain と text/html の2形式で書き込む
                    const rows = useTableStore.getState().getRows(tableName);
                    if (rows !== false) {
                        const lines: string[] = [];
                        const htmlRows: string[] = [];
                        for (let r = normalizedRange.startRow; r <= normalizedRange.endRow; r++) {
                            const storeRow = r - 1;
                            if (storeRow < 0 || storeRow >= rows.length) continue;
                            const cells: string[] = [];
                            const htmlCells: string[] = [];
                            for (let c = normalizedRange.startColumn; c <= normalizedRange.endColumn; c++) {
                                const value = rows[storeRow][c - 1];
                                cells.push(value);
                                htmlCells.push(`<td>${escapeHtml(value)}</td>`);
                            }
                            lines.push(cells.join('\t'));
                            htmlRows.push(`<tr>${htmlCells.join('')}</tr>`);
                        }
                        const plainText = lines.join('\n');
                        const htmlText = `<table>${htmlRows.join('')}</table>`;
                        const blob = new Blob([htmlText], {type: 'text/html'});
                        const plainBlob = new Blob([plainText], {type: 'text/plain'});
                        void navigator.clipboard.write([
                            new ClipboardItem({'text/html': blob, 'text/plain': plainBlob}),
                        ]).catch(err => console.error('クリップボードへの書き込みに失敗しました', err));
                    }
                    return;
                }
                if (e.key === 'a' || e.key === 'A') {
                    e.preventDefault();
                    if (rowCount > 0 && columnCount > 0) {
                        const allRange: CellRange = {startRow: 1, startColumn: 1, endRow: rowCount, endColumn: columnCount};
                        useSelectionStore.getState().select(allRange, focus);
                    }
                    return;
                }
                // Ctrl+Z: Undo
                if (e.key === 'z' || e.key === 'Z') {
                    e.preventDefault();
                    const undoResult = useHistoryStore.getState().undo(tableName);
                    if (undoResult) {
                        useSelectionStore.getState().select(undoResult.range, {row: undoResult.range.startRow, column: undoResult.range.startColumn});
                        useSelectionStore.getState().setCopyRange(undoResult.copyRange);
                    }
                    return;
                }
                // Ctrl+Y: Redo
                if (e.key === 'y' || e.key === 'Y') {
                    e.preventDefault();
                    const redoResult = useHistoryStore.getState().redo(tableName);
                    if (redoResult) {
                        useSelectionStore.getState().select(redoResult.range, {row: redoResult.range.startRow, column: redoResult.range.startColumn});
                        useSelectionStore.getState().setCopyRange(redoResult.copyRange);
                    }
                    return;
                }
                // Ctrl+V: クリップボードからペーストする
                if (e.key === 'v' || e.key === 'V') {
                    e.preventDefault();
                    void (async () => {
                        let clipText: string;
                        try {
                            clipText = await navigator.clipboard.readText();
                        } catch (err) {
                            console.error('クリップボードの読み取りに失敗しました', err);
                            return;
                        }
                        const sourceData = parseClipboardText(clipText);
                        const sourceRows = sourceData.length;
                        const sourceCols = sourceData[0].length;

                        const rows = useTableStore.getState().getRows(tableName);
                        if (rows === false) return;

                        // ペースト先の選択範囲を取得する（ペースト開始はフォーカス or range の左上）
                        const {range: currentRange, copyRange: currentCopyRange} = useSelectionStore.getState();
                        const baseRow = Math.min(currentRange.startRow, currentRange.endRow);
                        const baseCol = Math.min(currentRange.startColumn, currentRange.endColumn);
                        const selectionRows = Math.abs(currentRange.endRow - currentRange.startRow) + 1;
                        const selectionCols = Math.abs(currentRange.endColumn - currentRange.startColumn) + 1;

                        const isFill = shouldFillSelection(selectionRows, selectionCols, sourceRows, sourceCols);

                        // ペースト対象のセル変更リストを構築する
                        interface CellChangeEntry {
                            rowIndex: number;
                            colIndex: number;
                            oldValue: string;
                            newValue: string;
                        }
                        const changes: CellChangeEntry[] = [];

                        if (isFill) {
                            // 倍数ペースト: 選択範囲全体にソースデータを繰り返し埋め込む
                            for (let sr = 0; sr < selectionRows; sr++) {
                                const targetRow = baseRow + sr;
                                const storeRowIndex = targetRow - 1;
                                if (storeRowIndex < 0 || storeRowIndex >= rows.length) continue;
                                for (let sc = 0; sc < selectionCols; sc++) {
                                    const targetCol = baseCol + sc;
                                    const storeColIndex = targetCol - 1;
                                    if (storeColIndex < 0 || storeColIndex >= rows[storeRowIndex].length) continue;
                                    const newValue = sourceData[sr % sourceRows][sc % sourceCols];
                                    const oldValue = rows[storeRowIndex][storeColIndex];
                                    if (oldValue !== newValue) {
                                        changes.push({rowIndex: storeRowIndex, colIndex: storeColIndex, oldValue, newValue});
                                    }
                                }
                            }
                        } else {
                            // 通常ペースト: フォーカス位置を基点にソースデータのサイズだけペーストする
                            for (let sr = 0; sr < sourceRows; sr++) {
                                const targetRow = baseRow + sr;
                                const storeRowIndex = targetRow - 1;
                                if (storeRowIndex < 0 || storeRowIndex >= rows.length) break;
                                for (let sc = 0; sc < sourceCols; sc++) {
                                    const targetCol = baseCol + sc;
                                    const storeColIndex = targetCol - 1;
                                    if (storeColIndex < 0 || storeColIndex >= rows[storeRowIndex].length) break;
                                    const newValue = sourceData[sr][sc];
                                    const oldValue = rows[storeRowIndex][storeColIndex];
                                    if (oldValue !== newValue) {
                                        changes.push({rowIndex: storeRowIndex, colIndex: storeColIndex, oldValue, newValue});
                                    }
                                }
                            }
                        }

                        if (changes.length === 0) return;

                        // ペースト後の選択範囲を計算する
                        const pasteRowCount = isFill ? selectionRows : sourceRows;
                        const pasteColCount = isFill ? selectionCols : sourceCols;
                        const pasteRange: CellRange = {
                            startRow: baseRow,
                            startColumn: baseCol,
                            endRow: Math.min(baseRow + pasteRowCount - 1, maxRow),
                            endColumn: Math.min(baseCol + pasteColCount - 1, maxColumn),
                        };

                        const command = new CellChangeCommand(
                            changes.map(c => ({tableName, rowIndex: c.rowIndex, colIndex: c.colIndex, oldValue: c.oldValue, newValue: c.newValue}))
                        );
                        useHistoryStore.getState().executeCommand(tableName, command, pasteRange, currentCopyRange);
                        useSelectionStore.getState().select(pasteRange, {row: pasteRange.startRow, column: pasteRange.startColumn});
                    })();
                    return;
                }
                // Ctrl+S: ストアの全データをCSVとしてファイルに保存し、スキーマJSONにも列幅を反映する
                if (e.key === 's' || e.key === 'S') {
                    e.preventDefault();
                    void (async () => {
                        try {
                            // ストアからヘッダーと行データを取得する
                            const header = useTableStore.getState().getHeader(tableName);
                            const rows = useTableStore.getState().getRows(tableName);
                            if (header === false || rows === false) return;

                            // CSV文字列を生成する
                            const csv = new Csv();
                            csv.header = header;
                            csv.body = rows;
                            const csvString = csv.toString();

                            // data/ ディレクトリにCSVファイルを書き込む
                            await writeFileAsync(`data/${tableName}.csv`, csvString);

                            // スキーマJSONに列幅を保存する（既存フィールドは保持する）
                            const rawSchema = useTabStore.getState().getRawSchema(tableName);
                            if (rawSchema !== null) {
                                const schemas = useTabStore.getState().getColumnSchemas(tableName);
                                // headerDefs は元のスキーマの header 配列（各エントリの全フィールドを保持する）
                                const headerDefs = rawSchema.header as Array<Record<string, unknown>>;
                                if (Array.isArray(headerDefs)) {
                                    for (let i = 0; i < headerDefs.length && i < schemas.length; i++) {
                                        const schema = schemas[i];
                                        // 列幅: スキーマに width がある場合はそれを使い、なければ列名から計算する
                                        const widthStr = typeof schema.width === 'number'
                                            ? `${schema.width}px`
                                            : Utility.calculateColumnWidth(schema.name);
                                        headerDefs[i].width = parseInt(widthStr, 10);
                                    }
                                }
                                await writeFileAsync(`schema/${tableName}.json`, JSON.stringify(rawSchema, null, 2));
                            }

                            // 保存成功: Dirty状態をクリアする
                            useHistoryStore.getState().markSaved(tableName);
                        } catch (err) {
                            console.error('CSV保存に失敗しました', err);
                        }
                    })();
                    return;
                }
                return;
            }

            // F12: ミニテーブルの場合、フォーカス行の定義元テーブルにジャンプする
            if (e.key === 'F12' && storeRowIndices !== null) {
                e.preventDefault();
                const pkValue = getMiniTableFocusPkValue(tableName, focus.row, storeRowIndices);
                if (pkValue !== null) {
                    useTabStore.getState().navigateToTableRow(tableName, pkValue);
                }
                return;
            }

            // F2: フォーカスセルの現在値を初期値として編集開始する
            // バッファ行の場合は昇格してから編集開始する
            if (e.key === 'F2') {
                e.preventDefault();
                const domRowIndex = focus.row - 1;
                if (domRowIndex < 0) return;
                // バッファ行の場合は昇格する（既存ストア行の場合は何もしない）
                if (!promoteBufferRowIfNeeded(tableName, domRowIndex, autoFillEntries)) return;
                const rows = useTableStore.getState().getRows(tableName);
                if (rows === false) return;
                const colIndex = focus.column - 1;
                const currentValue = rows[domRowIndex][colIndex];
                // FK列の場合はドロップダウンを表示する（単純参照のみ対応。動的参照は TODO）
                const schema = columnSchemas[colIndex];
                if (schema && schema.reference) {
                    // TODO: 動的参照（DynamicReference）の場合はドロップダウン非対応
                    onShowDropdown([], {top: 0, left: 0, width: 0}, '');
                } else {
                    // F2 の場合は現在値を初期値とし、oldValue にも同じ値を設定する
                    useSelectionStore.getState().startEditing(currentValue, currentValue);
                }
                return;
            }

            // 印刷可能文字キー: その文字を初期値として編集開始する（Excel同様の動作）
            // バッファ行の場合は昇格してから編集開始する
            if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                const domRowIndex = focus.row - 1;
                if (domRowIndex < 0) return;
                // バッファ行の場合は昇格する（既存ストア行の場合は何もしない）
                if (!promoteBufferRowIfNeeded(tableName, domRowIndex, autoFillEntries)) return;
                const rows = useTableStore.getState().getRows(tableName);
                if (rows === false) return;
                const colIndex = focus.column - 1;
                const schema = columnSchemas[colIndex];
                if (schema && schema.reference) {
                    // FK列: ドロップダウンを表示して、押下した文字をフィルタ初期値とする
                    // TODO: 動的参照（DynamicReference）の場合はドロップダウン非対応
                    onShowDropdown([], {top: 0, left: 0, width: 0}, e.key);
                } else {
                    // 昇格後は必ずストア行が存在するため rows[domRowIndex] から oldValue を取得できる
                    const oldValue = rows[domRowIndex][colIndex];
                    useSelectionStore.getState().startEditing(e.key, oldValue);
                }
                return;
            }

            // 矢印キーによるフォーカス移動（Shift が押されている場合は範囲拡張）
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (e.shiftKey) {
                    useSelectionStore.getState().setRange({...range, endRow: Math.max(1, range.endRow - 1)});
                } else {
                    moveFocus(Math.max(1, focus.row - 1), focus.column);
                }
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (e.shiftKey) {
                    useSelectionStore.getState().setRange({...range, endRow: Math.min(maxRow, range.endRow + 1)});
                } else {
                    moveFocus(Math.min(maxRow, focus.row + 1), focus.column);
                }
                return;
            }
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                if (e.shiftKey) {
                    useSelectionStore.getState().setRange({...range, endColumn: Math.max(1, range.endColumn - 1)});
                } else {
                    moveFocus(focus.row, Math.max(1, focus.column - 1));
                }
                return;
            }
            if (e.key === 'ArrowRight') {
                e.preventDefault();
                if (e.shiftKey) {
                    useSelectionStore.getState().setRange({...range, endColumn: Math.min(maxColumn, range.endColumn + 1)});
                } else {
                    moveFocus(focus.row, Math.min(maxColumn, focus.column + 1));
                }
                return;
            }

            // Enter: 1行下に移動する
            if (e.key === 'Enter') {
                e.preventDefault();
                moveFocus(Math.min(maxRow, focus.row + 1), focus.column);
                return;
            }

            // Tab: 右（Shift+Tab: 左）に移動する
            if (e.key === 'Tab') {
                e.preventDefault();
                if (e.shiftKey) {
                    moveFocus(focus.row, Math.max(1, focus.column - 1));
                } else {
                    moveFocus(focus.row, Math.min(maxColumn, focus.column + 1));
                }
                return;
            }

            // Escape: 選択範囲をフォーカスセルのみにリセットし、コピー範囲をクリアする
            if (e.key === 'Escape') {
                e.preventDefault();
                const singleRange: CellRange = {
                    startRow: focus.row, startColumn: focus.column,
                    endRow: focus.row, endColumn: focus.column,
                };
                useSelectionStore.getState().setRange(singleRange);
                useSelectionStore.getState().clearCopyRange();
                return;
            }

            // Delete/Backspace: フォーカスセルの値をクリアする
            if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                // フォーカス位置のストア行インデックスは「行番号(1始まり) - 1」で計算する
                const storeRowIndex = focus.row - 1;
                const columnIndex = focus.column - 1;
                const rows = useTableStore.getState().getRows(tableName);
                // バッファ行またはストア未登録の場合は何もしない
                if (rows === false || storeRowIndex < 0 || storeRowIndex >= rows.length) return;
                const oldValue = rows[storeRowIndex][columnIndex];
                // 既に空なら履歴に積まない
                if (oldValue === '') return;
                const singleRange: CellRange = {
                    startRow: focus.row, startColumn: focus.column,
                    endRow: focus.row, endColumn: focus.column,
                };
                const copyRange = useSelectionStore.getState().copyRange;
                const command = new CellChangeCommand([{tableName, rowIndex: storeRowIndex, colIndex: columnIndex, oldValue, newValue: ''}]);
                useHistoryStore.getState().executeCommand(tableName, command, singleRange, copyRange);
            }
        }

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [enabled, tableName, columnSchemas, onShowDropdown, autoFillEntries, storeRowIndices]);

    // コンテキストメニューなど外部から呼び出す行/列操作アクション群を返す
    return {
        insertRowAbove() {
            const {focus, range, copyRange} = useSelectionStore.getState();
            const columnCount = getColumnCount(tableName);
            // focus.row は1始まり → ストアインデックスは focus.row - 1
            const storeRowIndex = focus.row - 1;
            const command = new InsertRowCommand(tableName, storeRowIndex, columnCount);
            // 挿入後は挿入した行（focus.row）にフォーカスを維持する
            const insertedRange: CellRange = {startRow: focus.row, startColumn: focus.column, endRow: focus.row, endColumn: focus.column};
            useHistoryStore.getState().executeCommand(tableName, command, insertedRange, copyRange);
            useSelectionStore.getState().select(insertedRange, {row: focus.row, column: focus.column});
        },

        insertRowBelow() {
            const {focus, copyRange} = useSelectionStore.getState();
            const columnCount = getColumnCount(tableName);
            // 下に挿入するため、ストアインデックスは focus.row（1始まり）= focus.row - 1 + 1
            const storeRowIndex = focus.row;
            const command = new InsertRowCommand(tableName, storeRowIndex, columnCount);
            // 挿入後は挿入した行（focus.row + 1）にフォーカスを移動する
            const insertedRow = focus.row + 1;
            const insertedRange: CellRange = {startRow: insertedRow, startColumn: focus.column, endRow: insertedRow, endColumn: focus.column};
            useHistoryStore.getState().executeCommand(tableName, command, insertedRange, copyRange);
            useSelectionStore.getState().select(insertedRange, {row: insertedRow, column: focus.column});
        },

        deleteSelectedRows() {
            const {range, focus, copyRange} = useSelectionStore.getState();
            const minRow = Math.min(range.startRow, range.endRow);
            const maxRow = Math.max(range.startRow, range.endRow);
            const rowCount = getRowCount(tableName);
            // インデックスずれを防ぐため高インデックスから順に DeleteRowCommand を生成し BatchCommand にまとめる
            const commands: DeleteRowCommand[] = [];
            for (let uiRow = maxRow; uiRow >= minRow; uiRow--) {
                const storeRowIndex = uiRow - 1;
                if (storeRowIndex < 0 || storeRowIndex >= rowCount) continue;
                commands.push(new DeleteRowCommand(tableName, storeRowIndex));
            }
            if (commands.length === 0) return;
            // 削除後のフォーカス先（削除範囲先頭行、行数を超えない）
            const newFocusRow = Math.min(minRow, Math.max(rowCount - commands.length, 1));
            const afterRange: CellRange = {startRow: newFocusRow, startColumn: focus.column, endRow: newFocusRow, endColumn: focus.column};
            const batch = new BatchCommand(commands, `DeleteRows ${minRow}-${maxRow}`);
            useHistoryStore.getState().executeCommand(tableName, batch, afterRange, copyRange);
            useSelectionStore.getState().select(afterRange, {row: newFocusRow, column: focus.column});
        },

        insertColumnLeft() {
            const {focus, copyRange} = useSelectionStore.getState();
            // focus.column は1始まり → 列インデックスは focus.column - 1
            const colIndex = focus.column - 1;
            const command = new InsertColumnCommand(tableName, colIndex);
            // 挿入後は挿入した列（focus.column）にフォーカスを維持する
            const insertedRange: CellRange = {startRow: focus.row, startColumn: focus.column, endRow: focus.row, endColumn: focus.column};
            useHistoryStore.getState().executeCommand(tableName, command, insertedRange, copyRange);
            useSelectionStore.getState().select(insertedRange, {row: focus.row, column: focus.column});
        },

        insertColumnRight() {
            const {focus, copyRange} = useSelectionStore.getState();
            // 右に挿入するため、列インデックスは focus.column（1始まり）= focus.column - 1 + 1
            const colIndex = focus.column;
            const command = new InsertColumnCommand(tableName, colIndex);
            // 挿入後は挿入した列（focus.column + 1）にフォーカスを移動する
            const insertedCol = focus.column + 1;
            const insertedRange: CellRange = {startRow: focus.row, startColumn: insertedCol, endRow: focus.row, endColumn: insertedCol};
            useHistoryStore.getState().executeCommand(tableName, command, insertedRange, copyRange);
            useSelectionStore.getState().select(insertedRange, {row: focus.row, column: insertedCol});
        },

        deleteSelectedColumns() {
            const {range, focus, copyRange} = useSelectionStore.getState();
            const minCol = Math.min(range.startColumn, range.endColumn);
            const maxCol = Math.max(range.startColumn, range.endColumn);
            const columnCount = getColumnCount(tableName);
            // インデックスずれを防ぐため高インデックスから順に DeleteColumnCommand を生成し BatchCommand にまとめる
            const commands: DeleteColumnCommand[] = [];
            for (let uiCol = maxCol; uiCol >= minCol; uiCol--) {
                const colIndex = uiCol - 1;
                if (colIndex < 0 || colIndex >= columnCount) continue;
                commands.push(new DeleteColumnCommand(tableName, colIndex));
            }
            if (commands.length === 0) return;
            // 削除後のフォーカス先（削除範囲先頭列、列数を超えない）
            const newFocusCol = Math.min(minCol, Math.max(columnCount - commands.length, 1));
            const afterRange: CellRange = {startRow: focus.row, startColumn: newFocusCol, endRow: focus.row, endColumn: newFocusCol};
            const batch = new BatchCommand(commands, `DeleteColumns ${minCol}-${maxCol}`);
            useHistoryStore.getState().executeCommand(tableName, batch, afterRange, copyRange);
            useSelectionStore.getState().select(afterRange, {row: focus.row, column: newFocusCol});
        },
    };
}
