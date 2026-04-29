import type {EditorTable} from "./editor-table";
import type {ReverseReferenceEntry} from "../references/reverse-reference-resolver";

/**
 * EditorTable のブックマーク操作と data-bookmarked 復元を担当する。
 */
export class EditorTableBookmarks {
    [key: string]: any;

    constructor(table: EditorTable) {
        return new Proxy(this, {
            get: (target, property, receiver) => {
                if (property in target) return Reflect.get(target, property, receiver);
                return Reflect.get(table as any, property);
            },
            set: (target, property, value, receiver) => {
                if (property in target) return Reflect.set(target, property, value, receiver);
                (table as any)[property] = value;
                return true;
            },
        });
    }

    /** セルレベルでブックマークが存在するか確認する */
    hasBookmark(tableName: string, pkValue: string, columnName: string): boolean {
        return this.sidebar.hasBookmark(tableName, pkValue, columnName);
    }

    /** 行レベルでブックマークが1件以上存在するか確認する（PK列右クリック用） */
    hasBookmarkForRow(tableName: string, pkValue: string): boolean {
        return this.sidebar.hasBookmarkForRow(tableName, pkValue);
    }

    /** セルレベルでブックマークを追加する */
    addBookmark(tableName: string, pkValue: string, columnName: string, label: string): void {
        this.sidebar.addBookmark(tableName, pkValue, columnName, label);
    }

    /** セルレベルでブックマークを削除する */
    removeBookmark(tableName: string, pkValue: string, columnName: string): void {
        this.sidebar.removeBookmark(tableName, pkValue, columnName);
    }

    /** 既に開いているテーブルに対してブックマーク視覚マークを再適用する */
    reapplyBookmarkMarks(): void {
        this.restoreBookmarkMarks();
    }

    /** 行レベルで全ブックマークを削除する（PK列右クリック「ブックマークを解除」用） */
    removeBookmarksForRow(tableName: string, pkValue: string): void {
        this.sidebar.removeBookmarksForRow(tableName, pkValue);
    }

    /** REFERENCESパネルに逆参照エントリを表示する（コンテキストメニュー「参照箇所を表示」用） */
    showReferences(pkValue: string, entries: ReverseReferenceEntry[]): void {
        this.sidebar.showReferences(pkValue, entries);
    }

    /** 指定行の全データセルから data-bookmarked 属性を除去する */
    removeBookmarkMarksForRow(row: number): void {
        const rowElement = this.getRowElement(row) as HTMLElement | null;
        // 設計上 row は有効なDOM行インデックスであるべき
        if (!rowElement) throw new Error(`[EditorTable.removeBookmarkMarksForRow] rowElement が null: row=${row}`);
        const cells = rowElement.querySelectorAll<HTMLElement>('.editor-table-cell[data-bookmarked]');
        for (let i = 0; i < cells.length; i++) {
            cells[i].removeAttribute('data-bookmarked');
        }
    }

    /**
     * ストアの行データからブックマーク済みセルを検出し data-bookmarked 属性を復元する。
     * reloadCellsFromStore() 末尾から呼ばれ、セル再作成後にブックマーク視覚マークを回復する。
     */
    restoreBookmarkMarks(): void {
        // ミニテーブルや差分タブではブックマーク不要
        if (this.isMiniTable) return;
        if (this.tab === false) return;
        const pkColIndex = this.tableData.primaryKeyColumns.length > 0
            ? this.tableData.header.findIndex((h: any) => h.name === this.tableData.primaryKeyColumns[0])
            : -1;
        if (pkColIndex === -1) return;
        // DOMに存在する行のみ処理する。
        // 固定行（0〜frozenRowCount-1）は常にDOMに存在し、ビューポート行（rendered.start〜rendered.end）も
        // DOMに存在する。その間の行（frozenRowCount〜rendered.start）はDOMに存在しないためスキップする。
        const rendered = this.virtualScroll.getRenderedRange();
        const loopEnd = Math.min(this.storeRowIndices.length, rendered.end);
        for (let domDataRow = 0; domDataRow < loopEnd; domDataRow++) {
            // 固定行とビューポート行の間のギャップはDOMに存在しないためスキップする
            if (domDataRow >= this.frozenRowCount && domDataRow < rendered.start) continue;
            const domRow = domDataRow + 1;
            const pkValue = this.getCellValueAt(domRow, pkColIndex + this.dataColumnOffset());
            if (pkValue === '') continue;
            for (let domCol = 0; domCol < this.getColumnCount(); domCol++) {
                const columnName = this.tableData.header[domCol].name;
                const cell = this.getCellOrNull(domRow, domCol + this.dataColumnOffset());
                if (cell === null) continue;
                if (this.sidebar.hasBookmark(this.tableName, pkValue, columnName)) {
                    cell.setAttribute('data-bookmarked', '');
                } else {
                    cell.removeAttribute('data-bookmarked');
                }
            }
        }
    }

    restoreBookmarkMarksForDataRowRange(startDataRowIndex: number, endDataRowIndex: number): void {
        if (this.isMiniTable) return;
        if (this.tab === false) return;
        const pkColIndex = this.tableData.primaryKeyColumns.length > 0
            ? this.tableData.header.findIndex((h: any) => h.name === this.tableData.primaryKeyColumns[0])
            : -1;
        if (pkColIndex === -1) return;
        for (let dataRowIndex = startDataRowIndex; dataRowIndex < endDataRowIndex; dataRowIndex++) {
            const domRow = dataRowIndex + 1;
            const rowElement = this.getRowElement(domRow);
            if (rowElement === null) continue;
            const pkValue = this.getCellValueAt(domRow, pkColIndex + this.dataColumnOffset());
            if (pkValue === '') continue;
            for (let domCol = 0; domCol < this.getColumnCount(); domCol++) {
                const columnName = this.tableData.header[domCol].name;
                const cell = rowElement.children[domCol + this.dataColumnOffset()];
                if (!(cell instanceof HTMLElement)) continue;
                if (this.sidebar.hasBookmark(this.tableName, pkValue, columnName)) {
                    cell.setAttribute('data-bookmarked', '');
                } else {
                    cell.removeAttribute('data-bookmarked');
                }
            }
        }
    }
}
