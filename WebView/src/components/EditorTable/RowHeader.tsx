import React from 'react';

interface RowHeaderProps {
    /** 表示する行番号（バッファ行は空文字を渡す） */
    rowNumber: number | string;
    /** mousedown イベントハンドラ */
    onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
}

/**
 * テーブルの行番号ヘッダーセルを描画するコンポーネント。
 * 行番号が変わらない限り再レンダリングされないため React.memo で最適化する。
 */
export const RowHeader = React.memo(function RowHeader({rowNumber, onMouseDown}: RowHeaderProps) {
    return (
        <div className="editor-table-row-header" onMouseDown={onMouseDown}>
            {rowNumber}
        </div>
    );
});
