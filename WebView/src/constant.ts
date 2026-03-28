/**
 * テーブルのデフォルトサイズ定数
 */

/** デフォルトの列幅 */
export const DEFAULT_COLUMN_WIDTH = '100px';

/** デフォルトの行高さ */
export const DEFAULT_ROW_HEIGHT = '20px';

/** 列ヘッダーのフォント指定（CSSの body { font-size: 13px; font-family: sans-serif; } と .editor-table-column-header { font-weight: bold; } に対応） */
export const COLUMN_HEADER_FONT = 'bold 13px sans-serif';

/** データセルのフォント指定（body と同じ通常ウェイト） */
export const CELL_FONT = '13px sans-serif';

/** 参照ヒントのフォントサイズ（CSSの .cell-reference-hint { font-size: 0.9em } に対応） */
export const REFERENCE_HINT_FONT = '11.7px sans-serif';

/** 参照ヒントの水平マージン(px)（CSSの .cell-reference-hint { margin-right: 4px } に対応） */
export const REFERENCE_HINT_MARGIN_PX = 4;

/** セル水平方向の余白（パディング左右12px + ボーダー右1px + セル内部余裕4px）。
 *  リサイズハンドルは position: absolute のためテキスト幅計算に影響しない。 */
export const CELL_HORIZONTAL_EXTRA = 17;

/** 通常テーブルのヘッダーアイコン占有幅(px)。
 *  filter-icon(right:30px, width:14px) の左端が cell.right-44px にあるため、
 *  テキスト右端が cell.right-44px を超えないよう padding-right 相当の余白として確保する。
 *  44px + 余裕4px = 48px。 */
export const HEADER_ICON_AREA_PX = 48;

/** 最小列幅(px) */
export const MIN_COLUMN_WIDTH_PX = 50;

/**
 * サイドバー幅の定数
 */

/** サイドバーの初期幅(px) */
export const DEFAULT_SIDEBAR_WIDTH = 300;

/** サイドバーの最小幅(px) */
export const MIN_SIDEBAR_WIDTH = 150;

/** サイドバーの最大幅(px) */
export const MAX_SIDEBAR_WIDTH = 600;
