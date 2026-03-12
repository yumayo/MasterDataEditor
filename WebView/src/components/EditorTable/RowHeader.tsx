import React from 'react';

interface RowHeaderProps {
    /** 表示する行番号（バッファ行は空文字を渡す） */
    rowNumber: number | string;
    /** 固定幅(px): 呼び出し元から ROW_HEADER_WIDTH_PX を渡す */
    width: number;
    /** mousedown イベントハンドラ */
    onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
    /** 右クリック（コンテキストメニュー）ハンドラ */
    onContextMenu: (e: React.MouseEvent<HTMLDivElement>) => void;
}

/**
 * テーブルの行番号ヘッダーセルを描画するコンポーネント。
 * .editor-table-row の直接の子として配置するため、width / flexShrink を自身に持つ。
 * 行番号が変わらない限り再レンダリングされないため React.memo で最適化する。
 */
export const RowHeader = React.memo(function RowHeader({rowNumber, width, onMouseDown, onContextMenu}: RowHeaderProps) {
    return (
        <div
            className="editor-table-row-header"
            style={{width, flexShrink: 0}}
            onMouseDown={onMouseDown}
            onContextMenu={onContextMenu}
        >
            {rowNumber}
        </div>
    );
});
