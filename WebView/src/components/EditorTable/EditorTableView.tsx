import React, {useRef, useMemo} from 'react';
import {useStore} from 'zustand';
import {
    useReactTable,
    getCoreRowModel,
    flexRender,
    createColumnHelper,
} from '@tanstack/react-table';
import {useVirtualizer} from '@tanstack/react-virtual';
import {useTableStore} from '../../stores/table-store';
import {Cell} from './Cell';
import {HeaderCell} from './HeaderCell';
import {RowHeader} from './RowHeader';

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

        // スクロールコンテナへの内部ref（useVirtualizerに渡す）
        const scrollContainerRef = useRef<HTMLDivElement>(null);

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
        const columns = useMemo(() => {
            if (!header) return [];
            return header.map((colName, colIndex) =>
                columnHelper.accessor(row => row.cells[colIndex] as string, {
                    id: colName,
                    header: () => <HeaderCell columnName={colName} colIndex={colIndex} />,
                    cell: info => (
                        <Cell
                            value={info.getValue()}
                            colIndex={colIndex}
                            className=""
                        />
                    ),
                })
            );
        }, [header, columnHelper]);

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
                                    <RowHeader rowNumber={rowNumber} />
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
            </div>
        );
    }
);
