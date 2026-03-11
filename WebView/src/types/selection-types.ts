/** セルの位置（行・列は1始まり、0は行/列ヘッダーを意味する） */
export interface CellPosition {
    row: number;
    column: number;
}

/** 選択範囲（startRow <= endRow、startColumn <= endColumn は保証しない — 正規化は getSelectionRange で行う） */
export interface CellRange {
    startRow: number;
    startColumn: number;
    endRow: number;
    endColumn: number;
}

/** フィル操作の方向 */
export type FillDirection = 'down' | 'up' | 'right' | 'left';
