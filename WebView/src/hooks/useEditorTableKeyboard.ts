import {useEffect} from 'react';
import {useSelectionStore} from '../stores/selection-store';
import {useTableStore} from '../stores/table-store';
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
 *   Ctrl+Z         — Undo（Phase 10で実装）
 *   Ctrl+Y         — Redo（Phase 10で実装）
 *   Ctrl+V         — ペースト（Phase 10で実装）
 *   Ctrl+S         — 保存（Phase 10で実装）
 *   F2             — セル編集開始（Phase 10で実装）
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
                // Ctrl+Z: Undo — Phase 10で実装
                if (e.key === 'z' || e.key === 'Z') {
                    e.preventDefault();
                    return;
                }
                // Ctrl+Y: Redo — Phase 10で実装
                if (e.key === 'y' || e.key === 'Y') {
                    e.preventDefault();
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
                useSelectionStore.getState().startEditing(rows[storeRowIndex][colIndex]);
                return;
            }

            // 印刷可能文字キー: その文字を初期値として編集開始する（Excel同様の動作）
            // バッファ行にフォーカスがある場合も編集は許可する（新規行入力ユースケース）
            if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                useSelectionStore.getState().startEditing(e.key);
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
                useTableStore.getState().updateCellValueByRowIndex(tableName, storeRowIndex, columnIndex, '');
            }
        }

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [enabled, tableName]);
}
