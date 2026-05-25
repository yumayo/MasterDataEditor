/**
 * テーブルのデフォルトサイズ定数
 */

/** デフォルトの列幅 */
export const DEFAULT_COLUMN_WIDTH = '100px';

/** 行ヘッダー列の幅(px) */
export const ROW_HEADER_WIDTH_PX = 40;

/** blame列の幅(px) */
export const BLAME_COLUMN_WIDTH_PX = 200;

/** content-box セルのレイアウト上の水平余白(px)。padding左右12px + border-right 1px */
const CELL_CONTENT_BOX_LAYOUT_HORIZONTAL_EXTRA_PX = 13;

/** 行ヘッダーセルの実レイアウト幅(px) */
export const ROW_HEADER_LAYOUT_WIDTH_PX = ROW_HEADER_WIDTH_PX + CELL_CONTENT_BOX_LAYOUT_HORIZONTAL_EXTRA_PX;

/** 行のCSSheightプロパティ値(px) */
export const ROW_HEIGHT_PX = 20;

/** border-bottom: 1px を含む行の実描画高さ(px)。バーチャルスクロールの位置計算に使用する */
export const ROW_TOTAL_HEIGHT_PX = 21;

/** ブラウザの巨大DOM座標誤差を避けつつ、スクロールバーつまみを小さく保つ物理コンテンツ高さ上限(px) */
export const MAX_SCROLL_CONTENT_HEIGHT_PX = 262_144;

/** EditorTable の自作縦スクロールバー幅(px) */
export const CUSTOM_VERTICAL_SCROLLBAR_WIDTH_PX = 14;

/** 自作縦スクロールバーのつまみ最小高さ(px) */
export const CUSTOM_VERTICAL_SCROLLBAR_MIN_THUMB_HEIGHT_PX = 18;

/** 行のCSSheightプロパティ値（文字列） */
export const DEFAULT_ROW_HEIGHT = `${ROW_HEIGHT_PX}px`;

/** 列ヘッダーのフォント指定（CSSの body { font-size: 13px; font-family: sans-serif; } と .editor-table-column-header { font-weight: bold; } に対応） */
export const COLUMN_HEADER_FONT = 'bold 13px sans-serif';

/** データセルのフォント指定（body と同じ通常ウェイト） */
export const CELL_FONT = '13px sans-serif';

/** 参照ヒントのフォントサイズ（CSSの .cell-reference-hint { font-size: 0.9em } に対応） */
export const REFERENCE_HINT_FONT = '11.7px sans-serif';

/** 参照ヒントの水平マージン(px)（CSSの .cell-reference-hint { margin-right: 4px } に対応） */
export const REFERENCE_HINT_MARGIN_PX = 4;

/** セル水平方向の自動幅計算用余白（パディング左右12px + ボーダー右1px + セル内部余裕4px）。
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

/** サイドバーの最小幅(px)。検索パネルの置換UIが見切れない幅を確保する */
export const MIN_SIDEBAR_WIDTH = 200;

/** サイドバーの最大幅(px) */
export const MAX_SIDEBAR_WIDTH = 600;
