import React from 'react';
import {useStore} from 'zustand';
import {useSelectionStore} from '../../stores/selection-store';

interface FillPreviewProps {
    /** テーブル名（selection-storeのactiveTableNameとマッチする場合のみ表示） */
    tableName: string;
    /** セル位置からDOMRectを取得する関数（EditorTableViewから渡す） */
    getCellRect: (row: number, column: number) => DOMRect | null;
    /** テーブル全体のDOMRect（座標計算の基準点） */
    tableBoundingRect: DOMRect | null;
}

/**
 * フィル操作プレビューオーバーレイのReactコンポーネント
 *
 * Vanilla側の Selection.updateFillPreview() / clearFillPreview() が行っていた
 * fillPreviewElement の直接スタイル操作を、React 状態駆動レンダリングで置き換える。
 *
 * - filling が true のときのみ表示する
 * - activeTableName が自分の tableName と一致する場合のみ表示する
 * - fillTarget に基づいてプレビュー範囲（.fill-preview クラス）を表示する
 *
 * フィル方向の決定ロジック（縦横の優先判定）は Vanilla 側の getFillInfo() に相当するが、
 * ここでは fillTarget をそのままプレビュー表示に使用する。
 * 実際の方向判定はマウス操作のイベントハンドラ（Vanilla / React 統合レイヤー）が担う。
 */
export function FillPreview({tableName, getCellRect, tableBoundingRect}: FillPreviewProps): React.ReactElement | null {
    const activeTableName = useStore(useSelectionStore, state => state.activeTableName);
    const filling = useStore(useSelectionStore, state => state.filling);
    const fillTarget = useStore(useSelectionStore, state => state.fillTarget);
    const range = useStore(useSelectionStore, state => state.range);

    // 別テーブルがアクティブな場合、またはフィル操作中でない場合は非表示
    if (activeTableName !== tableName || !filling) return null;
    if (!tableBoundingRect) return null;

    // 選択範囲の正規化（フィルプレビューはフィル先とのデルタで表示範囲を決定する）
    const selStartRow = Math.min(range.startRow, range.endRow);
    const selStartColumn = Math.min(range.startColumn, range.endColumn);
    const selEndRow = Math.max(range.startRow, range.endRow);
    const selEndColumn = Math.max(range.startColumn, range.endColumn);

    const targetRow = fillTarget.row;
    const targetColumn = fillTarget.column;

    // フィルプレビューの表示範囲: 選択範囲の外側にはみ出した部分
    let previewStartRow: number;
    let previewEndRow: number;
    let previewStartColumn: number;
    let previewEndColumn: number;

    if (targetRow > selEndRow) {
        // 下方向フィル
        previewStartRow = selEndRow + 1;
        previewEndRow = targetRow;
        previewStartColumn = selStartColumn;
        previewEndColumn = selEndColumn;
    } else if (targetRow < selStartRow) {
        // 上方向フィル
        previewStartRow = targetRow;
        previewEndRow = selStartRow - 1;
        previewStartColumn = selStartColumn;
        previewEndColumn = selEndColumn;
    } else if (targetColumn > selEndColumn) {
        // 右方向フィル
        previewStartRow = selStartRow;
        previewEndRow = selEndRow;
        previewStartColumn = selEndColumn + 1;
        previewEndColumn = targetColumn;
    } else if (targetColumn < selStartColumn) {
        // 左方向フィル
        previewStartRow = selStartRow;
        previewEndRow = selEndRow;
        previewStartColumn = targetColumn;
        previewEndColumn = selStartColumn - 1;
    } else {
        // フィル対象なし（選択範囲内にいる場合）
        return null;
    }

    const previewStartRect = getCellRect(previewStartRow, previewStartColumn);
    const previewEndRect = getCellRect(previewEndRow, previewEndColumn);

    if (!previewStartRect || !previewEndRect) return null;

    const left = Math.round(previewStartRect.left - tableBoundingRect.left - 1);
    const top = Math.round(previewStartRect.top - tableBoundingRect.top - 1);
    const width = Math.round(previewEndRect.right - previewStartRect.left - 1);
    const height = Math.round(previewEndRect.bottom - previewStartRect.top - 1);

    return (
        <div
            className="fill-preview"
            style={{
                display: 'block',
                position: 'absolute',
                left,
                top,
                width,
                height,
                pointerEvents: 'none',
            }}
        />
    );
}
