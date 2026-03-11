import React from 'react';

interface CellProps {
    /** 表示するセル値 */
    value: string;
    /** 列インデックス（data-col属性に使用） */
    colIndex: number;
    /** 追加CSSクラス名 */
    className: string;
    /** フォーカスセルかどうか（editor-table-cell-focus クラスを付与する） */
    isFocused: boolean;
    /** mousedown イベントハンドラ */
    onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
}

/**
 * テーブルの1セルを描画するコンポーネント。
 * 頻繁に再レンダリングされるため React.memo で最適化する。
 */
export const Cell = React.memo(function Cell({value, colIndex, className, isFocused, onMouseDown}: CellProps) {
    const focusClass = isFocused ? ' editor-table-cell-focus' : '';
    return (
        <div
            className={'editor-table-cell' + (className ? ' ' + className : '') + focusClass}
            data-col={colIndex}
            onMouseDown={onMouseDown}
        >
            {value}
        </div>
    );
});
