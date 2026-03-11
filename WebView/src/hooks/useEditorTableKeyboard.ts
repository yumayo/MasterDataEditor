import {useEffect} from 'react';
import {useSelectionStore} from '../stores/selection-store';
import {useTableStore} from '../stores/table-store';
import {useHistoryStore, CellChangeCommand} from '../stores/history-store';
import type {CellPosition, CellRange} from '../types/selection-types';

/**
 * useEditorTableKeyboard フックのオプション
 */
interface UseEditorTableKeyboardOptions {
    /** テーブル名 */
    tableName: string;
    /** キーボードイベントが有効か */
    enabled: boolean;
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
 * フォーカスを指定の行・列に移動し、選択範囲もそこに更新するヘルパー
 */
function moveFocus(row: number, column: number): void {
    const pos: CellPosition = {row, column};
    const range: CellRange = {startRow: row, startColumn: column, endRow: row, endColumn: column};
    useSelectionStore.getState().select(range, pos);
}

/**
 * EditorTableのキーボードショートカット管理フック
 *
 * - enabled が true のときのみ document.keydown リスナーを登録する
 * - tableName の activeTableName 確認は行わない（enabled で制御するのが呼び出し元の責務）
 *
 * 対応キー:
 *   矢印キー        — フォーカスを上下左右に移動する
 *   Enter          — フォーカスを1行下に移動する
 *   Tab            — フォーカスを1列右に移動する（最終列では折り返さない）
 *   Shift+Tab      — フォーカスを1列左に移動する
 *   Escape         — 選択をフォーカスセルのみにリセットする
 *   Delete/Backspace — フォーカスセルの値をクリアする（table-store を更新）
 *   Ctrl+C         — 選択範囲をコピー範囲に設定する（selection-store）
 *   Ctrl+A         — テーブル全体を選択する
 *   Ctrl+Z         — Undo（history-store 経由）
 *   Ctrl+Y         — Redo（history-store 経由）
 *   Ctrl+V         — ペースト（未実装）
 *   Ctrl+S         — 保存（未実装）
 *   F2             — セル編集開始
 */
export function useEditorTableKeyboard({tableName, enabled}: UseEditorTableKeyboardOptions): void {
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
                    useSelectionStore.getState().setCopyRange(range);
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
                // Ctrl+V: ペースト — Phase 10で実装
                if (e.key === 'v' || e.key === 'V') {
                    e.preventDefault();
                    return;
                }
                // Ctrl+S: 保存 — Phase 10で実装
                if (e.key === 's' || e.key === 'S') {
                    e.preventDefault();
                    return;
                }
                return;
            }

            // F2: フォーカスセルの現在値を初期値として編集開始する
            // バッファ行（データ行の範囲外）にフォーカスがある場合は何もしない
            if (e.key === 'F2') {
                e.preventDefault();
                const rows = useTableStore.getState().getRows(tableName);
                if (rows === false) return;
                const storeRowIndex = focus.row - 1;
                // storeRowIndex がデータ行の範囲外（バッファ行）の場合はスキップする
                if (storeRowIndex < 0 || storeRowIndex >= rows.length) return;
                const colIndex = focus.column - 1;
                const currentValue = rows[storeRowIndex][colIndex];
                // F2 の場合は現在値を初期値とし、oldValue にも同じ値を設定する
                useSelectionStore.getState().startEditing(currentValue, currentValue);
                return;
            }

            // 印刷可能文字キー: その文字を初期値として編集開始する（Excel同様の動作）
            // バッファ行にフォーカスがある場合も編集は許可する（新規行入力ユースケース）
            if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                // 文字キーで編集開始する場合も oldValue（編集前のストア値）を保存する
                const rows = useTableStore.getState().getRows(tableName);
                const storeRowIndex = focus.row - 1;
                const colIndex = focus.column - 1;
                // バッファ行やストア未登録の場合は oldValue を空文字にする
                const oldValue = rows !== false && storeRowIndex >= 0 && storeRowIndex < rows.length
                    ? rows[storeRowIndex][colIndex]
                    : '';
                useSelectionStore.getState().startEditing(e.key, oldValue);
                return;
            }

            // 矢印キーによるフォーカス移動（行・列の境界でクランプする）
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                moveFocus(Math.max(1, focus.row - 1), focus.column);
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                moveFocus(Math.min(maxRow, focus.row + 1), focus.column);
                return;
            }
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                moveFocus(focus.row, Math.max(1, focus.column - 1));
                return;
            }
            if (e.key === 'ArrowRight') {
                e.preventDefault();
                moveFocus(focus.row, Math.min(maxColumn, focus.column + 1));
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

            // Escape: 選択範囲をフォーカスセルのみにリセットする
            if (e.key === 'Escape') {
                e.preventDefault();
                const singleRange: CellRange = {
                    startRow: focus.row, startColumn: focus.column,
                    endRow: focus.row, endColumn: focus.column,
                };
                useSelectionStore.getState().setRange(singleRange);
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
    }, [enabled, tableName]);
}
