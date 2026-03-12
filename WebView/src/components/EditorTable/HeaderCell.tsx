import React from 'react';

interface HeaderCellProps {
    /** 列名 */
    columnName: string;
    /** 列インデックス（data-col属性に使用） */
    colIndex: number;
    /** CSS幅文字列（例: "150px", "62px"） */
    width: string;
    /** mousedown イベントハンドラ */
    onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
    /** 右クリック（コンテキストメニュー）ハンドラ */
    onContextMenu: (e: React.MouseEvent<HTMLDivElement>) => void;
}

/**
 * テーブルの列ヘッダーセルを描画するコンポーネント。
 * ヘッダーは列数が変わらない限り再レンダリングされないため React.memo で最適化する。
 */
export const HeaderCell = React.memo(function HeaderCell({columnName, colIndex, width, onMouseDown, onContextMenu}: HeaderCellProps) {
    return (
        <div
            className="editor-table-column-header"
            data-col={colIndex}
            style={{width}}
            onMouseDown={onMouseDown}
            onContextMenu={onContextMenu}
        >
            {columnName}
        </div>
    );
});
