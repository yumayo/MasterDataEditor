import React, {useRef, useMemo, useCallback, useState, useEffect} from 'react';
import {useStore} from 'zustand';
import {
    useReactTable,
    getCoreRowModel,
    flexRender,
    createColumnHelper,
} from '@tanstack/react-table';
import {useVirtualizer} from '@tanstack/react-virtual';
import {useTableStore} from '../../stores/table-store';
import {useSelectionStore} from '../../stores/selection-store';
import {useHistoryStore, CellChangeCommand} from '../../stores/history-store';
import {generateSeriesData} from '../../fill-series';
import {Cell} from './Cell';
import {HeaderCell} from './HeaderCell';
import {RowHeader} from './RowHeader';
import {SelectionOverlay} from './SelectionOverlay';
import {FillPreview} from './FillPreview';
import {GridTextField} from '../GridTextField';
import type {CellRange, CellPosition, FillDirection} from '../../types/selection-types';

/** データ行の下に表示するバッファ空行数 */
const BUFFER_ROW_COUNT = 100;

/**
 * フィル操作の方向・ソース範囲・ターゲット範囲・件数をまとめた情報
 */
interface FillInfo {
    direction: FillDirection;
    sourceRange: CellRange;
    targetRange: CellRange;
    count: number;
}

/**
 * 選択範囲とフィル先セルからフィル情報を計算する。
 * フィル先が選択範囲内に収まっている場合は null を返す（フィル対象なし）。
 * row/column は 1始まり。
 */
function computeFillInfo(range: CellRange, fillTarget: CellPosition): FillInfo | null {
    const selStartRow = Math.min(range.startRow, range.endRow);
    const selStartColumn = Math.min(range.startColumn, range.endColumn);
    const selEndRow = Math.max(range.startRow, range.endRow);
    const selEndColumn = Math.max(range.startColumn, range.endColumn);
    const {row: targetRow, column: targetCol} = fillTarget;

    if (targetRow > selEndRow) {
        return {
            direction: 'down',
            sourceRange: {startRow: selStartRow, startColumn: selStartColumn, endRow: selEndRow, endColumn: selEndColumn},
            targetRange: {startRow: selEndRow + 1, startColumn: selStartColumn, endRow: targetRow, endColumn: selEndColumn},
            count: targetRow - selEndRow,
        };
    }
    if (targetRow < selStartRow) {
        return {
            direction: 'up',
            sourceRange: {startRow: selStartRow, startColumn: selStartColumn, endRow: selEndRow, endColumn: selEndColumn},
            targetRange: {startRow: targetRow, startColumn: selStartColumn, endRow: selStartRow - 1, endColumn: selEndColumn},
            count: selStartRow - targetRow,
        };
    }
    if (targetCol > selEndColumn) {
        return {
            direction: 'right',
            sourceRange: {startRow: selStartRow, startColumn: selStartColumn, endRow: selEndRow, endColumn: selEndColumn},
            targetRange: {startRow: selStartRow, startColumn: selEndColumn + 1, endRow: selEndRow, endColumn: targetCol},
            count: targetCol - selEndColumn,
        };
    }
    if (targetCol < selStartColumn) {
        return {
            direction: 'left',
            sourceRange: {startRow: selStartRow, startColumn: selStartColumn, endRow: selEndRow, endColumn: selEndColumn},
            targetRange: {startRow: selStartRow, startColumn: targetCol, endRow: selEndRow, endColumn: selStartColumn - 1},
            count: selStartColumn - targetCol,
        };
    }
    return null;
}

/**
 * フィル操作を実行してストアに値を書き込み、履歴に記録する。
 * generateSeriesData でソース値から連続データを生成し、CellChangeCommand で一括適用する。
 */
function applyFill(tableName: string, fillInfo: FillInfo): void {
    const rows = useTableStore.getState().getRows(tableName);
    if (rows === false) return;

    const {sourceRange, targetRange, direction, count} = fillInfo;

    // ソース値を2次元配列として読み取る（ストアインデックスは row-1）
    const sourceValues: string[][] = [];
    for (let r = sourceRange.startRow; r <= sourceRange.endRow; r++) {
        const rowValues: string[] = [];
        for (let c = sourceRange.startColumn; c <= sourceRange.endColumn; c++) {
            rowValues.push(rows[r - 1][c - 1]);
        }
        sourceValues.push(rowValues);
    }

    // fill-series で連続データを生成する
    const generatedData = generateSeriesData(sourceValues, direction, count);

    // 生成データをターゲット範囲のセルにマッピングして変更リストを構築する
    const changes: Array<{tableName: string; rowIndex: number; colIndex: number; oldValue: string; newValue: string}> = [];

    if (direction === 'down') {
        // generatedData[i][j] → targetRange.startRow + i 行、sourceRange.startColumn + j 列
        for (let i = 0; i < generatedData.length; i++) {
            for (let j = 0; j < generatedData[i].length; j++) {
                const rowIndex = targetRange.startRow + i - 1;
                const colIndex = sourceRange.startColumn + j - 1;
                const oldValue = rows[rowIndex][colIndex];
                const newValue = generatedData[i][j];
                if (oldValue !== newValue) {
                    changes.push({tableName, rowIndex, colIndex, oldValue, newValue});
                }
            }
        }
    } else if (direction === 'up') {
        // generateSeriesData('up') は先頭が「1つ上」の値、末尾が「最も上」の値を返す。
        // ターゲット範囲の末尾（selStartRow-1）から先頭（targetRow）に向かってマッピングする。
        for (let i = 0; i < generatedData.length; i++) {
            for (let j = 0; j < generatedData[i].length; j++) {
                const rowIndex = targetRange.endRow - i - 1;
                const colIndex = sourceRange.startColumn + j - 1;
                const oldValue = rows[rowIndex][colIndex];
                const newValue = generatedData[i][j];
                if (oldValue !== newValue) {
                    changes.push({tableName, rowIndex, colIndex, oldValue, newValue});
                }
            }
        }
    } else if (direction === 'right') {
        // generatedData[rowIdx][i] → sourceRange.startRow + rowIdx 行、targetRange.startColumn + i 列
        for (let rowIdx = 0; rowIdx < generatedData.length; rowIdx++) {
            for (let i = 0; i < generatedData[rowIdx].length; i++) {
                const rowIndex = sourceRange.startRow + rowIdx - 1;
                const colIndex = targetRange.startColumn + i - 1;
                const oldValue = rows[rowIndex][colIndex];
                const newValue = generatedData[rowIdx][i];
                if (oldValue !== newValue) {
                    changes.push({tableName, rowIndex, colIndex, oldValue, newValue});
                }
            }
        }
    } else {
        // left: generateSeriesData('left') は先頭が「1つ左」の値、末尾が「最も左」の値を返す。
        // ターゲット範囲の末尾列（selStartColumn-1）から先頭列（targetCol）に向かってマッピングする。
        for (let rowIdx = 0; rowIdx < generatedData.length; rowIdx++) {
            for (let i = 0; i < generatedData[rowIdx].length; i++) {
                const rowIndex = sourceRange.startRow + rowIdx - 1;
                const colIndex = targetRange.endColumn - i - 1;
                const oldValue = rows[rowIndex][colIndex];
                const newValue = generatedData[rowIdx][i];
                if (oldValue !== newValue) {
                    changes.push({tableName, rowIndex, colIndex, oldValue, newValue});
                }
            }
        }
    }

    if (changes.length === 0) return;

    // 変更をコマンドとして実行し、履歴に記録する
    const command = new CellChangeCommand(changes);
    // フィル後の選択範囲はソース範囲とターゲット範囲を合わせた全体にする
    const newRange: CellRange = {
        startRow: Math.min(sourceRange.startRow, targetRange.startRow),
        startColumn: Math.min(sourceRange.startColumn, targetRange.startColumn),
        endRow: Math.max(sourceRange.endRow, targetRange.endRow),
        endColumn: Math.max(sourceRange.endColumn, targetRange.endColumn),
    };
    const currentState = useSelectionStore.getState();
    useHistoryStore.getState().executeCommand(tableName, command, newRange, currentState.copyRange);
    currentState.select(newRange, currentState.focus);
}

/** テーブル行の高さ(px) — Vanilla側の DEFAULT_ROW_HEIGHT と揃える */
const ROW_HEIGHT_PX = 20;

/** 行ヘッダー列の固定幅(px) */
const ROW_HEADER_WIDTH_PX = 40;

interface EditorTableViewProps {
    /** 表示するテーブル名（Zustand Store のキー） */
    tableName: string;
    /**
     * DOMの行インデックス（0始まり）からストアの行インデックスへのマッピング。
     * ミニテーブルではフィルタリングされた行のストアインデックスを渡す。
     * null の場合はストア行と同じ順序（0, 1, 2, ...）として扱う。
     */
    storeRowIndices: number[] | null;
}

/** テーブル1行分のデータ型。列名をキーとした文字列マップ + バッファフラグ */
interface RowData {
    /** セル値の配列（列インデックス順） */
    cells: string[];
    /** バッファ空行フラグ */
    isBuffer: boolean;
    /** DOM上の行インデックス（0始まり、ヘッダー行を除く） */
    domRowIndex: number;
}

/**
 * Reactで実装したEditorTableコンポーネント。
 *
 * TanStack Table でカラム定義・ヘッダー描画を管理し、
 * TanStack Virtual で大量行の仮想スクロールを実現する。
 * `React.forwardRef` でスクロールコンテナのDOMノードを外部公開する。
 */
export const EditorTableView = React.forwardRef<HTMLDivElement, EditorTableViewProps>(
    function EditorTableView({tableName, storeRowIndices}, ref) {
        // Zustand Store からヘッダーと行データを取得する
        const header = useStore(useTableStore, state => state.headers.get(tableName));
        const storeRows = useStore(useTableStore, state => state.rows.get(tableName));

        // selection-store から必要な状態のみ購読する（不要な再レンダリングを防ぐ）
        const focus = useStore(useSelectionStore, state => state.focus);
        const selecting = useStore(useSelectionStore, state => state.selecting);
        const selectingColumn = useStore(useSelectionStore, state => state.selectingColumn);
        const selectingRow = useStore(useSelectionStore, state => state.selectingRow);
        const filling = useStore(useSelectionStore, state => state.filling);
        const editing = useStore(useSelectionStore, state => state.editing);
        const editingInitialValue = useStore(useSelectionStore, state => state.editingInitialValue);
        const editingOldValue = useStore(useSelectionStore, state => state.editingOldValue);

        // スクロールコンテナへの内部ref（useVirtualizerに渡す）
        const scrollContainerRef = useRef<HTMLDivElement>(null);

        // フィルハンドルmousedown時のマウス座標（縦横方向判定用）
        const fillStartMouseRef = useRef<{x: number; y: number}>({x: 0, y: 0});

        // テーブル全体のBoundingRect（SelectionOverlay・GridTextFieldの座標計算基準）
        const [tableBoundingRect, setTableBoundingRect] = useState<DOMRect | null>(null);

        // IME変換中フラグ（GridTextField から通知を受け取る）
        const composingRef = useRef(false);

        // ResizeObserver でテーブルサイズ変化を監視してBoundingRectを更新する
        useEffect(() => {
            const container = scrollContainerRef.current;
            if (!container) return;

            const updateRect = () => setTableBoundingRect(container.getBoundingClientRect());
            updateRect();

            const observer = new ResizeObserver(updateRect);
            observer.observe(container);
            return () => observer.disconnect();
        }, []);

        // 仮想化対象の全行データ（データ行 + バッファ空行）を構築する
        const allRows = useMemo<RowData[]>(() => {
            if (!storeRows || !header) return [];

            // storeRowIndices が null の場合は通常順序（0, 1, 2, ...）を使用する
            const indices = storeRowIndices !== null
                ? storeRowIndices
                : storeRows.map((_, i) => i);

            // データ行: DOM行インデックス順にストアから行データを取得する
            const dataRows: RowData[] = indices.map((storeIndex, domIndex) => ({
                cells: storeRows[storeIndex],
                isBuffer: false,
                domRowIndex: domIndex,
            }));

            // バッファ空行: 列数に合わせた空配列を生成する
            const emptyRow: string[] = Array.from({length: header.length}, () => '');
            const bufferRows: RowData[] = Array.from({length: BUFFER_ROW_COUNT}, (_, i) => ({
                cells: emptyRow,
                isBuffer: true,
                domRowIndex: dataRows.length + i,
            }));

            return [...dataRows, ...bufferRows];
        }, [storeRows, storeRowIndices, header]);

        // TanStack Table のカラム定義を構築する
        const columnHelper = useMemo(() => createColumnHelper<RowData>(), []);

        // フィルハンドルmousedown: フィル開始座標を記録してフィル操作を開始する
        const handleFillHandleMouseDown = useCallback((e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            fillStartMouseRef.current = {x: e.clientX, y: e.clientY};
            useSelectionStore.getState().startFilling({row: 0, column: 0});
        }, []);

        // セルの mousedown ハンドラ: selection-store を更新する（columns より前に定義する必要がある）
        const handleCellMouseDown = useCallback((domRowIndex: number, colIndex: number, e: React.MouseEvent<HTMLDivElement>) => {
            e.preventDefault();
            const row = domRowIndex + 1;
            const col = colIndex + 1;
            const store = useSelectionStore.getState();
            store.setActiveTable(tableName);

            if (e.shiftKey) {
                // Shift+クリック: フォーカスは変えず範囲の終了位置のみ更新する
                const currentRange = store.range;
                store.setRange({
                    startRow: currentRange.startRow,
                    startColumn: currentRange.startColumn,
                    endRow: row,
                    endColumn: col,
                });
            } else {
                // 通常クリック: フォーカスと選択範囲を単一セルに設定する
                const pos: CellPosition = {row, column: col};
                store.select({startRow: row, startColumn: col, endRow: row, endColumn: col}, pos);
                store.startSelecting();
            }
        }, [tableName]);

        // 列ヘッダーの mousedown ハンドラ: 列全体を選択する
        const handleColumnHeaderMouseDown = useCallback((colIndex: number, e: React.MouseEvent<HTMLDivElement>) => {
            e.preventDefault();
            const totalRows = allRows.filter(r => !r.isBuffer).length;
            if (totalRows === 0) return;
            const col = colIndex + 1;
            const range: CellRange = {startRow: 1, startColumn: col, endRow: totalRows, endColumn: col};
            const focusPos: CellPosition = {row: 1, column: col};
            const store = useSelectionStore.getState();
            store.setActiveTable(tableName);
            store.select(range, focusPos);
            store.startSelectingColumn();
        }, [allRows, tableName]);

        const columns = useMemo(() => {
            if (!header) return [];
            return header.map((colName, colIndex) =>
                columnHelper.accessor(row => row.cells[colIndex] as string, {
                    id: colName,
                    header: () => (
                        <HeaderCell
                            columnName={colName}
                            colIndex={colIndex}
                            onMouseDown={e => handleColumnHeaderMouseDown(colIndex, e)}
                        />
                    ),
                    cell: info => {
                        // フォーカスセルかどうかを計算して Cell に渡す
                        const rowData = info.row.original;
                        const isFocused = !rowData.isBuffer
                            && focus.row === rowData.domRowIndex + 1
                            && focus.column === colIndex + 1;
                        return (
                            <Cell
                                value={info.getValue()}
                                colIndex={colIndex}
                                className=""
                                isFocused={isFocused}
                                onMouseDown={e => handleCellMouseDown(rowData.domRowIndex, colIndex, e)}
                                onDoubleClick={() => {
                                    // ダブルクリックで現在のセル値を初期値として編集開始する
                                    // oldValue にも同じ値を設定する（Undo 時の元の値として使用）
                                    const currentValue = info.getValue();
                                    useSelectionStore.getState().startEditing(currentValue, currentValue);
                                }}
                            />
                        );
                    },
                })
            );
        }, [header, columnHelper, focus, handleColumnHeaderMouseDown, handleCellMouseDown]);

        const table = useReactTable({
            data: allRows,
            columns,
            getCoreRowModel: getCoreRowModel(),
        });

        // TanStack Virtual で行の仮想化を設定する
        const rowVirtualizer = useVirtualizer({
            count: allRows.length,
            getScrollElement: () => scrollContainerRef.current,
            estimateSize: () => ROW_HEIGHT_PX,
            overscan: 10,
        });

        // フォーカス行が変わったとき、仮想スクロールでその行を表示域に収める
        useEffect(() => {
            if (focus.row < 1) return;
            rowVirtualizer.scrollToIndex(focus.row - 1);
        }, [focus.row]);

        // ドラッグ選択: window の mousemove/mouseup で範囲更新・終了する
        useEffect(() => {
            if (!selecting) return;

            const handleMouseMove = (e: MouseEvent) => {
                // document.elementsFromPoint でマウス下のセルを特定する
                const elements = document.elementsFromPoint(e.clientX, e.clientY);
                const cellEl = elements.find(el => el.classList.contains('editor-table-cell')) as HTMLElement | null;
                if (!cellEl) return;

                const colAttr = cellEl.getAttribute('data-col');
                if (!colAttr) return;
                const col = parseInt(colAttr, 10) + 1;

                // セルの親行要素から data-row 属性で domRowIndex を特定する
                const rowEl = cellEl.closest('[data-row]') as HTMLElement | null;
                if (!rowEl) return;
                const rowAttr = rowEl.getAttribute('data-row');
                if (!rowAttr) return;
                const domRowIndex = parseInt(rowAttr, 10);
                if (isNaN(domRowIndex) || domRowIndex < 0) return;
                const row = domRowIndex + 1;

                const store = useSelectionStore.getState();
                if (selectingColumn) {
                    // 列選択ドラッグ: 列方向のみ範囲を拡張する
                    const totalRows = allRows.filter(r => !r.isBuffer).length;
                    const currentRange = store.range;
                    store.setRange({
                        startRow: 1,
                        startColumn: currentRange.startColumn,
                        endRow: totalRows,
                        endColumn: col,
                    });
                } else if (selectingRow) {
                    // 行選択ドラッグ: 行方向のみ範囲を拡張する
                    // useEffect クロージャー内では header が古い参照になりえるため、allRows から列数を算出する
                    const totalCols = allRows.length > 0 ? allRows[0].cells.length : 1;
                    const currentRange = store.range;
                    store.setRange({
                        startRow: currentRange.startRow,
                        startColumn: 1,
                        endRow: row,
                        endColumn: totalCols,
                    });
                } else {
                    // 通常ドラッグ: フォーカスは固定のまま終了位置のみ更新する
                    const currentRange = store.range;
                    store.setRange({
                        startRow: currentRange.startRow,
                        startColumn: currentRange.startColumn,
                        endRow: row,
                        endColumn: col,
                    });
                }
            };

            const handleMouseUp = () => {
                useSelectionStore.getState().stopSelecting();
            };

            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
            return () => {
                window.removeEventListener('mousemove', handleMouseMove);
                window.removeEventListener('mouseup', handleMouseUp);
            };
        }, [selecting, selectingColumn, selectingRow, allRows, header]);

        // フィルドラッグ: filling が true のときにのみ有効にする（ドラッグ選択とは別のuseEffect）
        useEffect(() => {
            if (!filling) return;

            const handleMouseMove = (e: MouseEvent) => {
                // document.elementsFromPoint でマウス下のセルを特定する
                const elements = document.elementsFromPoint(e.clientX, e.clientY);
                const cellEl = elements.find(el => el.classList.contains('editor-table-cell')) as HTMLElement | null;
                if (!cellEl) return;
                const colAttr = cellEl.getAttribute('data-col');
                if (!colAttr) return;
                const col = parseInt(colAttr, 10) + 1;
                const rowEl = cellEl.closest('[data-row]') as HTMLElement | null;
                if (!rowEl) return;
                const rowAttr = rowEl.getAttribute('data-row');
                if (!rowAttr) return;
                const domRowIndex = parseInt(rowAttr, 10);
                const row = domRowIndex + 1;

                const {range} = useSelectionStore.getState();
                const selStartRow = Math.min(range.startRow, range.endRow);
                const selStartColumn = Math.min(range.startColumn, range.endColumn);
                const selEndRow = Math.max(range.startRow, range.endRow);
                const selEndColumn = Math.max(range.startColumn, range.endColumn);

                // セルデルタ量を計算して縦横のはみ出し量を求める
                const rowDeltaDown = Math.max(0, row - selEndRow);
                const rowDeltaUp = Math.max(0, selStartRow - row);
                const colDeltaRight = Math.max(0, col - selEndColumn);
                const colDeltaLeft = Math.max(0, selStartColumn - col);
                const hasRowDelta = rowDeltaDown > 0 || rowDeltaUp > 0;
                const hasColDelta = colDeltaRight > 0 || colDeltaLeft > 0;

                // ピクセル移動量で縦横の優先方向を判定する
                const startMouse = fillStartMouseRef.current;
                const mouseDx = Math.abs(e.clientX - startMouse.x);
                const mouseDy = Math.abs(e.clientY - startMouse.y);

                let targetRow = row;
                let targetCol = col;

                if (hasRowDelta && hasColDelta) {
                    if (mouseDy >= mouseDx) {
                        // 縦方向優先: 列は選択範囲に固定
                        targetCol = col > selEndColumn ? selEndColumn : (col < selStartColumn ? selStartColumn : col);
                    } else {
                        // 横方向優先: 行は選択範囲に固定
                        targetRow = row > selEndRow ? selEndRow : (row < selStartRow ? selStartRow : row);
                    }
                } else if (hasRowDelta && !hasColDelta) {
                    // 縦方向のみ: FillPreviewが列範囲全体を使うので列は選択開始列に固定
                    targetCol = selStartColumn;
                } else if (!hasRowDelta && hasColDelta) {
                    // 横方向のみ: FillPreviewが行範囲全体を使うので行は選択開始行に固定
                    targetRow = selStartRow;
                }

                useSelectionStore.getState().setFillTarget({row: targetRow, column: targetCol});
            };

            const handleMouseUp = () => {
                // mouseup時に fillTarget を使ってフィルを実行してからフィル操作を終了する
                const {range, fillTarget} = useSelectionStore.getState();
                useSelectionStore.getState().stopFilling();
                const fillInfo = computeFillInfo(range, fillTarget);
                if (!fillInfo) return;
                applyFill(tableName, fillInfo);
            };

            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
            return () => {
                window.removeEventListener('mousemove', handleMouseMove);
                window.removeEventListener('mouseup', handleMouseUp);
            };
        }, [filling, tableName]);

        // 仮想スクロール内のセルDOMを特定してBoundingRectを返す関数
        // SelectionOverlay の描画座標計算に使用する
        // row, column は 1始まり
        const getCellRect = useCallback((row: number, column: number): DOMRect | null => {
            const container = scrollContainerRef.current;
            if (!container) return null;

            // data-row 属性で対象行を直接特定する（domRowIndex は 0始まり）
            const domRowIndex = row - 1;
            const rowEl = container.querySelector<HTMLElement>(`[data-row="${domRowIndex}"]`);
            if (!rowEl) return null;

            // 列インデックスは 1始まり → 0始まりに変換して data-col で検索する
            const colIndex = column - 1;
            const cellEl = rowEl.querySelector<HTMLElement>(`[data-col="${colIndex}"]`);
            if (!cellEl) return null;
            return cellEl.getBoundingClientRect();
        }, []);

        // 行ヘッダーの mousedown ハンドラ: 行全体を選択する
        const handleRowHeaderMouseDown = useCallback((domRowIndex: number, e: React.MouseEvent<HTMLDivElement>) => {
            e.preventDefault();
            const row = domRowIndex + 1;
            // allRows が存在すれば cells.length = header.length となる
            const totalCols = allRows.length > 0 ? allRows[0].cells.length : 1;
            const range: CellRange = {startRow: row, startColumn: 1, endRow: row, endColumn: totalCols};
            const focusPos: CellPosition = {row, column: 1};
            const store = useSelectionStore.getState();
            store.setActiveTable(tableName);
            store.select(range, focusPos);
            store.startSelectingRow();
        }, [allRows, tableName]);

        // GridTextField の絶対配置座標（スクロールコンテナからの相対座標で計算）
        // editing が false のときは位置計算を行わずダミー値を返す
        const gridTextFieldPosition = useMemo<{top: number; left: number; width: number; height: number}>(() => {
            if (!editing) return {top: 0, left: 0, width: 0, height: 0};
            const cellRect = getCellRect(focus.row, focus.column);
            if (!cellRect) return {top: 0, left: 0, width: 0, height: 0};
            // スクロールコンテナ内の相対座標に変換する（スクロールオフセットを加算する）
            const container = scrollContainerRef.current;
            if (!container) return {top: 0, left: 0, width: 0, height: 0};
            const containerRect = container.getBoundingClientRect();
            return {
                top: cellRect.top - containerRect.top + container.scrollTop,
                left: cellRect.left - containerRect.left + container.scrollLeft,
                width: cellRect.width,
                height: cellRect.height,
            };
        }, [editing, focus, getCellRect]);

        // editing が true になったとき、フォーカスセルが仮想スクロール内に存在しない場合は editing をリセットする
        useEffect(() => {
            if (!editing) return;
            const cellRect = getCellRect(focus.row, focus.column);
            if (!cellRect) {
                useSelectionStore.getState().stopEditing();
            }
        }, [editing, focus]);

        const virtualItems = rowVirtualizer.getVirtualItems();
        const totalSize = rowVirtualizer.getTotalSize();
        const tableRows = table.getRowModel().rows;

        // データが未ロードの場合は空コンテナを返す
        if (!header || !storeRows) {
            return <div className="editor-table" ref={ref} />;
        }

        return (
            // スクロールコンテナ: useVirtualizer の getScrollElement として使用する
            <div
                className="editor-table"
                ref={node => {
                    // 内部refと外部forwardRefの両方を設定する
                    (scrollContainerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
                    if (typeof ref === 'function') {
                        ref(node);
                    } else if (ref) {
                        ref.current = node;
                    }
                }}
                style={{overflow: 'auto', position: 'relative'}}
            >
                {/* ヘッダー行: スティッキーで上部に固定する */}
                <div className="editor-table-row" style={{display: 'flex', position: 'sticky', top: 0, zIndex: 1}}>
                    {/* 角セル: 行ヘッダー列とカラムヘッダー行の交差部分 */}
                    <div
                        className="editor-table-corner-cell"
                        style={{width: ROW_HEADER_WIDTH_PX, flexShrink: 0}}
                    />
                    {table.getHeaderGroups().map(headerGroup =>
                        headerGroup.headers.map(header => (
                            <div key={header.id} style={{display: 'flex', alignItems: 'stretch'}}>
                                {flexRender(header.column.columnDef.header, header.getContext())}
                            </div>
                        ))
                    )}
                </div>

                {/* 仮想スクロール領域: totalSize で実際の高さを確保する */}
                <div style={{height: totalSize, position: 'relative'}}>
                    {virtualItems.map(virtualRow => {
                        const row = tableRows[virtualRow.index];
                        const rowData = row.original;
                        const isBuffer = rowData.isBuffer;
                        // バッファ行には editor-table-empty-row クラスを付与する
                        const rowClassName = 'editor-table-row' + (isBuffer ? ' editor-table-empty-row' : '');
                        // 行番号: データ行は1始まり、バッファ行は空文字
                        const rowNumber = isBuffer ? '' : rowData.domRowIndex + 1;

                        return (
                            <div
                                key={virtualRow.key}
                                className={rowClassName}
                                data-row={rowData.domRowIndex}
                                style={{
                                    position: 'absolute',
                                    top: virtualRow.start,
                                    left: 0,
                                    width: '100%',
                                    height: ROW_HEIGHT_PX,
                                    display: 'flex',
                                }}
                            >
                                {/* 行番号ヘッダー */}
                                <div style={{width: ROW_HEADER_WIDTH_PX, flexShrink: 0}}>
                                    <RowHeader
                                        rowNumber={rowNumber}
                                        onMouseDown={e => handleRowHeaderMouseDown(rowData.domRowIndex, e)}
                                    />
                                </div>
                                {/* データセル群 */}
                                {row.getVisibleCells().map(cell => (
                                    <div key={cell.id} style={{display: 'flex', alignItems: 'stretch'}}>
                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                    </div>
                                ))}
                            </div>
                        );
                    })}
                </div>

                {/* 選択範囲オーバーレイ: position:absolute で仮想スクロール領域に重ねる */}
                <SelectionOverlay
                    tableName={tableName}
                    getCellRect={getCellRect}
                    tableBoundingRect={tableBoundingRect}
                    onFillHandleMouseDown={handleFillHandleMouseDown}
                />

                {/* フィル操作プレビューオーバーレイ */}
                <FillPreview
                    tableName={tableName}
                    getCellRect={getCellRect}
                    tableBoundingRect={tableBoundingRect}
                />

                {/* セル編集テキストフィールド: フォーカスセル上に重ねて表示する */}
                <GridTextField
                    visible={editing}
                    initialValue={editingInitialValue}
                    position={gridTextFieldPosition}
                    onSubmit={value => {
                        // 確定: CellChangeCommand を作成して履歴に記録してから編集モードを終了する
                        const storeRowIndex = focus.row - 1;
                        const colIndex = focus.column - 1;
                        // oldValue === newValue の場合は何もしない（履歴に積まない）
                        if (editingOldValue !== value) {
                            const singleRange: CellRange = {
                                startRow: focus.row, startColumn: focus.column,
                                endRow: focus.row, endColumn: focus.column,
                            };
                            const copyRange = useSelectionStore.getState().copyRange;
                            const command = new CellChangeCommand([{tableName, rowIndex: storeRowIndex, colIndex, oldValue: editingOldValue, newValue: value}]);
                            useHistoryStore.getState().executeCommand(tableName, command, singleRange, copyRange);
                        }
                        useSelectionStore.getState().stopEditing();
                    }}
                    onCancel={() => {
                        // キャンセル: 値を変更せず編集モードを終了する
                        useSelectionStore.getState().stopEditing();
                    }}
                    onCompositionChange={composing => {
                        composingRef.current = composing;
                    }}
                />
            </div>
        );
    }
);
