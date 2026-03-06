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
 * FK列が空の行（パディング行・空行）から、FK値が入っているリーダー行を探す
 *
 * 開始行にdata-base-row-indexがある場合: その値をグループ境界として同一グループ内を走査
 * 開始行にdata-base-row-indexがない場合（空行）: 上方の空行を飛ばし、
 *   最初にdata-base-row-indexを持つ行のグループに合流して走査を継続する
 * いずれの場合もグループ境界（異なるbaseRowIndex）を越えない
 */
export function findGroupLeader(
    tableElement: HTMLElement, domRow: number, fkDomColumn: number
): { fkValue: string; groupPosition: number } {
    const currentRow = tableElement.children[domRow] as HTMLElement;
    // 開始行がデータ行ならそのbaseRowIndexをグループ境界とする
    // 空行なら走査中に最初のデータ行で境界を確定する
    let groupBaseRowIndex: number | false = currentRow.hasAttribute('data-base-row-index')
        ? getBaseRowIndex(currentRow) : false;
    for (let r = domRow - 1; r >= 1; r--) {
        const rowElement = tableElement.children[r] as HTMLElement;
        if (!rowElement.hasAttribute('data-base-row-index')) continue;
        const rowBase = getBaseRowIndex(rowElement);
        if (groupBaseRowIndex === false) {
            // 空行から走査して最初のデータ行に到達: このグループに合流
            groupBaseRowIndex = rowBase;
        } else if (rowBase !== groupBaseRowIndex) {
            break;
        }
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

/**
 * 同じFK値を持つ全グループのリーダー行DOMインデックスを昇順で返す
 *
 * ビューテーブルでは同じFKソース値（例: group_id=1）を持つ複数のベース行がある。
 * グループ内挿入時に同一FK値の他グループを全て特定するために使用する。
 *
 * @param tableElement テーブルのDOM要素
 * @param fkDomColumn FK列のDOMインデックス（1始まり、行ヘッダーを含む）
 * @param fkValue 検索するFK値
 * @param excludeLeaderDomRow 除外するリーダー行のDOMインデックス（主挿入対象グループを除外）
 * @returns リーダー行のDOMインデックスの昇順配列
 */
export function findAllGroupLeadersByFkValue(
    tableElement: HTMLElement, fkDomColumn: number, fkValue: string, excludeLeaderDomRow: number
): number[] {
    const leaderDomRows: number[] = [];
    for (let r = 1; r < tableElement.children.length; r++) {
        const rowElement = tableElement.children[r] as HTMLElement;
        // data-base-row-index属性がない行はデータ行でないため走査を終了
        // ビューテーブルではデータ行が連続して並び、空行はその後方にまとまる構造なので
        // データ行が途切れたら残りを走査する必要はない
        if (!rowElement.hasAttribute('data-base-row-index')) break;
        const cell = rowElement.children[fkDomColumn] as HTMLElement;
        const cellValue = readCellValue(cell);
        // FK列が空の行はグループの子行（リーダーではない）のためスキップ
        if (cellValue !== fkValue) continue;
        // 主挿入対象グループのリーダー行は除外
        if (r === excludeLeaderDomRow) continue;
        leaderDomRows.push(r);
    }
    return leaderDomRows;
}
