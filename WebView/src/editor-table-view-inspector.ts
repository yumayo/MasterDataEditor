import {EditorTableView} from "./editor-table-view";
import {EditorTable} from "./editor-table";

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
     */
    isViewLeaderRow(row: number): boolean {
        if (!this.view.hasViewContext()) return true;
        const viewContext = this.view.getViewContext();
        const metaIndex = row - 1;
        if (metaIndex <= 0) return true;
        if (metaIndex >= viewContext.rowMetadata.length) return true;
        return viewContext.rowMetadata[metaIndex].baseRowIndex
            !== viewContext.rowMetadata[metaIndex - 1].baseRowIndex;
    }

    /**
     * 指定セルがパディングセルかどうかを判定する
     */
    isPaddingCell(row: number, column: number): boolean {
        if (!this.view.hasViewContext()) return false;
        if (column === 0) return false;
        const viewContext = this.view.getViewContext();
        const metadataIndex = row - 1;
        const rowMetadata = viewContext.rowMetadata;
        if (metadataIndex < 0 || metadataIndex >= rowMetadata.length) return false;
        const dataColumnIndex = column - 1;
        if (dataColumnIndex < 0 || dataColumnIndex >= rowMetadata[metadataIndex].paddingColumns.length) return false;
        return rowMetadata[metadataIndex].paddingColumns[dataColumnIndex];
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
