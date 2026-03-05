import {EditorTableView} from "./editor-table-view";
import {EditorTable} from "./editor-table";
import {getGroupInfos} from "./model/view-row-metadata";
import {isGroupLeaderRow} from "./view-group-query";

/**
 * ビュー行検査モジュール
 *
 * 責務:
 * - セル・行の種別判定（パディング・リーダー・結合列）
 * - データ行の最大行数取得
 */
export class EditorTableViewInspector {
    private readonly view: EditorTableView;
    private readonly table: EditorTable;

    constructor(view: EditorTableView, table: EditorTable) {
        this.view = view;
        this.table = table;
    }

    /**
     * 指定行がビューグループのリーダー行（先頭行）かどうかを判定する
     * ビューコンテキストがない場合は常にtrue
     */
    isViewLeaderRow(row: number): boolean {
        if (!this.view.hasViewContext()) return true;
        return isGroupLeaderRow(this.table.getTableElement(), row);
    }

    /**
     * 指定セルがパディングセルかどうかを判定する
     * DOMのCSSクラスview-padding-cellで判定する
     */
    isPaddingCell(row: number, column: number): boolean {
        if (!this.view.hasViewContext()) return false;
        if (column === 0) return false;
        const tableElement = this.table.getTableElement();
        const rowElement = tableElement.children[row] as HTMLElement;
        if (!rowElement) return false;
        const cell = rowElement.children[column] as HTMLElement;
        if (!cell) return false;
        return cell.classList.contains('view-padding-cell');
    }

    /**
     * 指定範囲にパディングセルが含まれるかを判定する
     */
    containsPaddingCell(startRow: number, startColumn: number, endRow: number, endColumn: number): boolean {
        if (!this.view.hasViewContext()) return false;
        for (let r = startRow; r <= endRow; r++) {
            for (let c = startColumn; c <= endColumn; c++) {
                if (this.isPaddingCell(r, c)) return true;
            }
        }
        return false;
    }

    /**
     * 指定範囲に編集不可セル（結合列またはパディングセル）が含まれるかを判定する
     */
    containsReadOnlyCell(startRow: number, startColumn: number, endRow: number, endColumn: number): boolean {
        return this.containsJoinedColumn(startColumn, endColumn)
            || this.containsPaddingCell(startRow, startColumn, endRow, endColumn);
    }

    /**
     * 選択範囲が完全なFKグループ単位で構成されているかを判定する
     * 選択範囲内の各行について、その行が属するFKグループの全行が選択範囲に含まれていなければfalseを返す。
     * DOM行のdata-base-row-indexとdata-group-infos属性から判定する。
     */
    isSelectionCoveringCompleteGroups(startRow: number, endRow: number): boolean {
        if (!this.view.hasViewContext()) return false;
        const tableElement = this.table.getTableElement();
        for (let domRow = startRow; domRow <= endRow; domRow++) {
            const rowElement = tableElement.children[domRow] as HTMLElement;
            // DOM属性を持たない行はビュー非対象の空行なのでスキップ
            if (!rowElement || !rowElement.hasAttribute('data-base-row-index')) continue;
            const rowGroupInfos = getGroupInfos(rowElement);
            for (const groupInfo of rowGroupInfos) {
                if (groupInfo.groupSize <= 1) continue;
                // グループの先頭と末尾のDOM行を算出
                const groupStartDomRow = domRow - groupInfo.groupPosition;
                const groupEndDomRow = groupStartDomRow + groupInfo.groupSize - 1;
                // グループの全行が選択範囲内にあるか
                if (groupStartDomRow < startRow || groupEndDomRow > endRow) {
                    return false;
                }
            }
        }
        return true;
    }

    /** 単一セル編集のガード（文字入力・ダブルクリック・ドロップダウン） */
    isCellEditBlocked(row: number, column: number): boolean {
        return this.isPaddingCell(row, column);
    }

    /** 範囲編集のガード（Paste・Fill） */
    isRangeEditBlocked(startRow: number, startColumn: number, endRow: number, endColumn: number): boolean {
        return this.containsReadOnlyCell(startRow, startColumn, endRow, endColumn);
    }

    /** Delete操作のガード（パディングセル + FKグループ完全性チェック） */
    isDeleteBlocked(startRow: number, startColumn: number, endRow: number, endColumn: number): boolean {
        const hasPaddingCell = this.containsPaddingCell(startRow, startColumn, endRow, endColumn);
        return hasPaddingCell && !this.isSelectionCoveringCompleteGroups(startRow, endRow);
    }

    /**
     * 指定された列範囲に結合列が含まれるかを判定する
     */
    containsJoinedColumn(startColumn: number, endColumn: number): boolean {
        if (!this.view.hasViewContext()) return false;
        const viewContext = this.view.getViewContext();
        for (let c = startColumn; c <= endColumn; c++) {
            const dataColumnIndex = c - 1;
            if (dataColumnIndex < 0 || dataColumnIndex >= viewContext.columnMappings.length) continue;
            if (viewContext.columnMappings[dataColumnIndex].isJoinedColumn) return true;
        }
        return false;
    }

    /**
     * データ領域の最大行を取得（データが入力されている最後の行）
     */
    getMaxDataRow(): number {
        const tableElement = this.table.getTableElement();
        const dataStartRow = 1;
        let maxRow = 0;
        for (let r = tableElement.children.length - 1; r >= dataStartRow; r--) {
            const rowElement = tableElement.children[r] as HTMLElement;
            if (!rowElement) continue;
            let hasData = false;
            for (let c = 1; c < rowElement.children.length; c++) {
                const cell = rowElement.children[c] as HTMLElement;
                if (cell && cell.textContent && cell.textContent.trim() !== '') {
                    hasData = true;
                    break;
                }
            }
            if (hasData) {
                maxRow = r;
                break;
            }
        }
        return maxRow;
    }
}
