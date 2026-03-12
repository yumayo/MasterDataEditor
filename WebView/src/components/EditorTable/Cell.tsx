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
    /** CSS幅文字列（例: "150px", "62px"）。ヘッダーと同じ幅を設定する。 */
    width: string;
    /**
     * 参照ヒントテキスト。
     * 空文字列の場合はヒントを表示しない。
     */
    referenceHint: string;
    /**
     * 参照ヒントの種別。
     * 'fk': FK参照ヒント（.cell-reference-hint）
     * 'reverse': 逆参照ヒント（.cell-reverse-reference-hint）
     * 'none': ヒントなし
     */
    referenceHintType: 'fk' | 'reverse' | 'none';
    /** mousedown イベントハンドラ */
    onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
    /** ダブルクリックイベントハンドラ（編集開始トリガー） */
    onDoubleClick: (e: React.MouseEvent<HTMLDivElement>) => void;
}

/**
 * テーブルの1セルを描画するコンポーネント。
 * 頻繁に再レンダリングされるため React.memo で最適化する。
 */
export const Cell = React.memo(function Cell({value, colIndex, className, isFocused, width, referenceHint, referenceHintType, onMouseDown, onDoubleClick}: CellProps) {
    const focusClass = isFocused ? ' editor-table-cell-focus' : '';
    return (
        <div
            className={'editor-table-cell' + (className ? ' ' + className : '') + focusClass}
            data-col={colIndex}
            style={{width}}
            onMouseDown={onMouseDown}
            onDoubleClick={onDoubleClick}
        >
            {value}
            {referenceHint !== '' && referenceHintType === 'fk' && (
                <span className="cell-reference-hint">{referenceHint}</span>
            )}
            {referenceHint !== '' && referenceHintType === 'reverse' && (
                <span className="cell-reverse-reference-hint">{referenceHint}</span>
            )}
        </div>
    );
});
