import {getBaseRowIndex} from "./model/view-row-metadata";
import {ViewDefinition} from "./model/view-definition";
import {ViewColumnMapping} from "./model/view-column-mapping";

/**
 * ビューグループクエリモジュール
 *
 * 責務: DOMからビューグループ情報を読み取るpure function群
 * グループ走査ロジックの唯一の実装場所。
 * 各editor-table-view-*モジュールはこの関数群を使い、独自のDOM走査を持たない。
 */

/**
 * DOM上のセルからテキスト値を読み取る（参照ヒント・トグルを除外）
 * セル値の読み取りはEditorTable.getCellValueと同一ロジックであり、
 * EditorTable.getCellValueはこの関数に委譲する。
 */
export function readCellValue(cell: HTMLElement): string {
    // .cell-value 要素があればそこから取得
    const valueElement = cell.querySelector('.cell-value');
    if (valueElement) return valueElement.textContent ?? '';
    // ヒント要素やトグル要素がある場合、直下のテキストノードのみを結合して返す
    const hasChildElements = cell.querySelector('.cell-reference-hint, .cell-reverse-reference-hint, .view-collapse-toggle');
    if (hasChildElements) {
        let text = '';
        for (const node of Array.from(cell.childNodes)) {
            if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? '';
        }
        return text;
    }
    // そうでなければ textContent をそのまま返す
    return cell.textContent ?? '';
}

/**
 * DOM上で上方向に走査し、グループリーダーのFK値とグループ内位置を返す
 * FK列が空の行（パディング行）から、FK値が入っているリーダー行を探す
 */
export function findGroupLeader(
    tableElement: HTMLElement, domRow: number, fkDomColumn: number
): { fkValue: string; groupPosition: number } {
    for (let r = domRow - 1; r >= 1; r--) {
        const rowElement = tableElement.children[r] as HTMLElement;
        const cell = rowElement.children[fkDomColumn] as HTMLElement;
        const cellValue = readCellValue(cell);
        if (cellValue !== '') return { fkValue: cellValue, groupPosition: domRow - r };
    }
    return { fkValue: '', groupPosition: 0 };
}

/**
 * 指定メタデータインデックスが属するベース行のメタデータ範囲を返す
 * DOM行のdata-base-row-index属性を走査して同一ベース行のグループを特定する
 */
export function findGroupRange(
    tableElement: HTMLElement, metaIndex: number
): { metaStart: number; metaEnd: number } {
    const domIndex = metaIndex + 1;
    const domRow = tableElement.children[domIndex] as HTMLElement;
    const baseRowIdx = getBaseRowIndex(domRow);
    let metaStart = metaIndex;
    while (metaStart > 0) {
        const prevDomRow = tableElement.children[metaStart] as HTMLElement;
        if (!prevDomRow.hasAttribute('data-base-row-index') || getBaseRowIndex(prevDomRow) !== baseRowIdx) break;
        metaStart--;
    }
    let metaEnd = metaIndex + 1;
    while (metaEnd + 1 < tableElement.children.length) {
        const nextDomRow = tableElement.children[metaEnd + 1] as HTMLElement;
        if (!nextDomRow.hasAttribute('data-base-row-index') || getBaseRowIndex(nextDomRow) !== baseRowIdx) break;
        metaEnd++;
    }
    return { metaStart, metaEnd };
}

/**
 * 指定行がビューグループのリーダー行（先頭行）かどうかを判定する
 * DOM行のdata-base-row-index属性を前行と比較して判定する
 */
export function isGroupLeaderRow(tableElement: HTMLElement, domRow: number): boolean {
    if (domRow <= 1) return true;
    const currentRow = tableElement.children[domRow] as HTMLElement;
    if (!currentRow || !currentRow.hasAttribute('data-base-row-index')) return true;
    const prevRow = tableElement.children[domRow - 1] as HTMLElement;
    if (!prevRow || !prevRow.hasAttribute('data-base-row-index')) return true;
    return getBaseRowIndex(currentRow) !== getBaseRowIndex(prevRow);
}

/**
 * 下方向走査でグループの子行数を返す
 * リーダー行のFK列に値が入っており、子行のFK列は空という構造を利用する
 */
export function countGroupChildren(
    tableElement: HTMLElement, leaderDomRow: number, fkDomColumn: number
): number {
    let childCount = 0;
    for (let domRow = leaderDomRow + 1; domRow < tableElement.children.length; domRow++) {
        const rowElement = tableElement.children[domRow] as HTMLElement;
        const cell = rowElement.children[fkDomColumn] as HTMLElement;
        if (readCellValue(cell) !== '') break;
        childCount++;
    }
    return childCount;
}

/**
 * JOINターゲットテーブルからFK列のcompositeインデックスを解決する
 * ViewDefinitionとcolumnMappingsから純粋に計算する
 */
export function findFkColumnIndex(
    viewDefinition: ViewDefinition, columnMappings: ViewColumnMapping[], targetTable: string
): number {
    const joinDef = viewDefinition.joins.find(j => j.targetTable === targetTable);
    if (!joinDef) return -1;
    const sourceTableName = joinDef.sourceTable === '' ? viewDefinition.baseTable : joinDef.sourceTable;
    return columnMappings.findIndex(
        m => m.tableName === sourceTableName && m.sourceColumnName === joinDef.sourceColumn
    );
}
