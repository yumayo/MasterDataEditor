/**
 * ER図の自動レイアウト
 * テーブルノードをグリッド状に配置する
 */

/** ノードの配置座標 */
export interface NodePosition {
    x: number;
    y: number;
}

/** レイアウトパラメータ */
const NODE_WIDTH = 200;
const NODE_MARGIN_X = 80;
const NODE_MARGIN_Y = 60;
const INITIAL_OFFSET_X = 40;
const INITIAL_OFFSET_Y = 40;

/**
 * テーブル名の配列からグリッドレイアウトの座標マップを計算する
 * 列数は sqrt(ノード数) の切り上げで決定する
 */
export function calculateGridLayout(tableNames: string[], nodeHeights: Map<string, number>): Map<string, NodePosition> {
    const positions = new Map<string, NodePosition>();
    const columns = Math.ceil(Math.sqrt(tableNames.length));
    let currentX = INITIAL_OFFSET_X;
    let currentY = INITIAL_OFFSET_Y;
    let columnIndex = 0;
    let maxHeightInRow = 0;

    for (let i = 0; i < tableNames.length; i++) {
        const name = tableNames[i];
        const height = nodeHeights.get(name)!;
        positions.set(name, { x: currentX, y: currentY });
        if (height > maxHeightInRow) maxHeightInRow = height;
        columnIndex++;
        if (columnIndex >= columns) {
            // 次の行に折り返す
            columnIndex = 0;
            currentX = INITIAL_OFFSET_X;
            currentY += maxHeightInRow + NODE_MARGIN_Y;
            maxHeightInRow = 0;
        } else {
            currentX += NODE_WIDTH + NODE_MARGIN_X;
        }
    }
    return positions;
}

/** ノード幅の公開定数（エッジ描画でノード中心を計算するため） */
export const ER_NODE_WIDTH = NODE_WIDTH;
