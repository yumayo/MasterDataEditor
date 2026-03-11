import React from 'react';
import {useStore} from 'zustand';
import {useSelectionStore} from '../../stores/selection-store';
import type {CellRange, CellPosition} from '../../types/selection-types';

interface SelectionOverlayProps {
    /** テーブル名（selection-storeのactiveTableNameとマッチする場合のみ表示） */
    tableName: string;
    /** セル位置からDOMRectを取得する関数（EditorTableViewから渡す） */
    getCellRect: (row: number, column: number) => DOMRect | null;
    /** テーブル全体のDOMRect（座標計算の基準点） */
    tableBoundingRect: DOMRect | null;
}

/**
 * 選択範囲の正規化（startRow <= endRow、startColumn <= endColumn に揃える）
 * Vanilla側の getSelectionRange() と同等の処理
 */
function normalizeRange(range: CellRange): CellRange {
    return {
        startRow: Math.min(range.startRow, range.endRow),
        startColumn: Math.min(range.startColumn, range.endColumn),
        endRow: Math.max(range.startRow, range.endRow),
        endColumn: Math.max(range.startColumn, range.endColumn),
    };
}

/**
 * DOMRect と基準Rect から left/top/width/height(px) を計算するヘルパー
 */
function calcRect(startRect: DOMRect, endRect: DOMRect, tableRect: DOMRect): {left: number; top: number; width: number; height: number} {
    return {
        left: Math.round(startRect.left - tableRect.left - 1),
        top: Math.round(startRect.top - tableRect.top - 1),
        width: Math.round(endRect.right - startRect.left - 1),
        height: Math.round(endRect.bottom - startRect.top - 1),
    };
}

/**
 * 背景要素（選択ハイライト領域）のスタイルを計算するヘルパー
 * フォーカスセルを囲む上・下・左・右の4領域のスタイルを返す。
 * 単一セル選択時はすべて非表示にする。
 */
function calcBackgroundStyles(
    startRect: DOMRect,
    endRect: DOMRect,
    focusRect: DOMRect
): {top: React.CSSProperties; bottom: React.CSSProperties; left: React.CSSProperties; right: React.CSSProperties} {
    const focusLeftPx = Math.floor(focusRect.left - startRect.left);
    const focusTopPx = Math.floor(focusRect.top - startRect.top);
    const focusWidth = Math.ceil(focusRect.width);
    const focusHeight = Math.ceil(focusRect.height);
    const totalWidth = Math.ceil(endRect.right - startRect.left);
    const totalHeight = Math.ceil(endRect.bottom - startRect.top);

    const topHeight = focusTopPx;
    const bottomTop = focusTopPx + focusHeight;
    const bottomHeight = totalHeight - bottomTop;
    const leftWidth = focusLeftPx;
    const rightLeft = focusLeftPx + focusWidth;
    const rightWidth = totalWidth - rightLeft;

    const makeStyle = (l: number, t: number, w: number, h: number): React.CSSProperties =>
        w > 0 && h > 0
            ? {display: 'block', position: 'absolute', left: l, top: t, width: w, height: h}
            : {display: 'none'};

    return {
        top: makeStyle(0, 0, totalWidth, topHeight),
        bottom: makeStyle(0, bottomTop, totalWidth, bottomHeight),
        left: makeStyle(0, focusTopPx, leftWidth, focusHeight),
        right: makeStyle(rightLeft, focusTopPx, rightWidth, focusHeight),
    };
}

/**
 * 選択範囲オーバーレイのReactコンポーネント
 *
 * Vanilla側の Selection クラスが行っていた DOM 直接操作（element.style.left = ... 等）を
 * React の state 駆動レンダリングで置き換える。
 *
 * - activeTableName が自分の tableName と一致する場合のみ表示する
 * - セル座標は getCellRect prop 経由で EditorTableView が提供するDOM参照から取得する
 * - コピー範囲は点線ボーダー（.copy-border クラス）で表示する
 * - フィルハンドル（.fill-handle クラス）を選択範囲の右下に表示する
 */
export function SelectionOverlay({tableName, getCellRect, tableBoundingRect}: SelectionOverlayProps): React.ReactElement | null {
    const activeTableName = useStore(useSelectionStore, state => state.activeTableName);
    const range = useStore(useSelectionStore, state => state.range);
    const focus = useStore(useSelectionStore, state => state.focus);
    const copyRange = useStore(useSelectionStore, state => state.copyRange);

    // 別テーブルがアクティブな場合は何も表示しない
    if (activeTableName !== tableName) return null;
    // テーブルのBoundingRectが取れていない場合も表示しない
    if (!tableBoundingRect) return null;

    const normalized = normalizeRange(range);
    const startRect = getCellRect(normalized.startRow, normalized.startColumn);
    const endRect = getCellRect(normalized.endRow, normalized.endColumn);
    const focusRect = getCellRect(focus.row, focus.column);

    // いずれかのセルDOMRectが取れない場合は非表示
    if (!startRect || !endRect || !focusRect) return null;

    const selectionBox = calcRect(startRect, endRect, tableBoundingRect);
    const isSingleCell = normalized.startRow === normalized.endRow && normalized.startColumn === normalized.endColumn;
    const bgStyles = isSingleCell ? null : calcBackgroundStyles(startRect, endRect, focusRect);

    // フィルハンドルの位置: 選択範囲の右下コーナー
    const fillHandleLeft = Math.round(endRect.right - tableBoundingRect.left - 4);
    const fillHandleTop = Math.round(endRect.bottom - tableBoundingRect.top - 4);

    // コピー範囲（startRow >= 0 のとき有効）
    const hasCopyRange = copyRange.startRow >= 0;
    let copyBorderStyle: React.CSSProperties = {display: 'none'};
    if (hasCopyRange) {
        const copyStartRect = getCellRect(copyRange.startRow, copyRange.startColumn);
        const copyEndRect = getCellRect(copyRange.endRow, copyRange.endColumn);
        if (copyStartRect && copyEndRect) {
            const copyBox = calcRect(copyStartRect, copyEndRect, tableBoundingRect);
            copyBorderStyle = {
                display: 'block',
                position: 'absolute',
                left: copyBox.left,
                top: copyBox.top,
                width: copyBox.width,
                height: copyBox.height,
            };
        }
    }

    return (
        <>
            {/* 選択範囲本体（フォーカスセルの枠線を含む） */}
            <div
                className="selection"
                style={{
                    position: 'absolute',
                    left: selectionBox.left,
                    top: selectionBox.top,
                    width: selectionBox.width,
                    height: selectionBox.height,
                    pointerEvents: 'none',
                }}
            >
                {/* フォーカスセル以外の選択範囲ハイライト（上・下・左・右の4領域） */}
                {bgStyles && (
                    <>
                        <div className="selection-background" style={bgStyles.top} />
                        <div className="selection-background" style={bgStyles.bottom} />
                        <div className="selection-background" style={bgStyles.left} />
                        <div className="selection-background" style={bgStyles.right} />
                    </>
                )}
            </div>

            {/* コピー範囲の点線ボーダー */}
            <div className="copy-border" style={copyBorderStyle} />

            {/* フィルハンドル: 選択範囲右下に表示 */}
            <div
                className="fill-handle"
                style={{
                    display: 'block',
                    position: 'absolute',
                    left: fillHandleLeft,
                    top: fillHandleTop,
                }}
            />
        </>
    );
}
