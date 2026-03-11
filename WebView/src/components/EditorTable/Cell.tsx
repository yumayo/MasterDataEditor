import React from 'react';

interface CellProps {
    /** 表示するセル値 */
    value: string;
    /** 列インデックス（data-col属性に使用） */
    colIndex: number;
    /** 追加CSSクラス名 */
    className: string;
}

/**
 * テーブルの1セルを描画するコンポーネント。
 * 頻繁に再レンダリングされるため React.memo で最適化する。
 */
export const Cell = React.memo(function Cell({value, colIndex, className}: CellProps) {
    return (
        <div
            className={'editor-table-cell' + (className ? ' ' + className : '')}
            data-col={colIndex}
        >
            {value}
        </div>
    );
});
