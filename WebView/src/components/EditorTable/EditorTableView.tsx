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
import {Cell} from './Cell';
import {HeaderCell} from './HeaderCell';
import {RowHeader} from './RowHeader';
import {SelectionOverlay} from './SelectionOverlay';
import {GridTextField} from '../GridTextField';
import type {CellRange, CellPosition} from '../../types/selection-types';

/** データ行の下に表示するバッファ空行数 */
const BUFFER_ROW_COUNT = 100;

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
        const editing = useStore(useSelectionStore, state => state.editing);
        const editingInitialValue = useStore(useSelectionStore, state => state.editingInitialValue);
        const editingOldValue = useStore(useSelectionStore, state => state.editingOldValue);

        // スクロールコンテナへの内部ref（useVirtualizerに渡す）
        const scrollContainerRef = useRef<HTMLDivElement>(null);

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
