import type {EditorTable} from "./editor-table";
import type {ReverseReferenceEntry} from "../references/reverse-reference-resolver";
import type {BookmarkEntry} from "../panels/bookmark-panel";

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
        if (this.tableData.primaryKeyColumns.length === 0) return;
        const context = this.createBookmarkRestoreContext();
        if (context === null) return;
        // DOMに存在する行のみ処理する。
        // 固定行（0〜frozenRowCount-1）は常にDOMに存在し、ビューポート行（rendered.start〜rendered.end）も
        // DOMに存在する。その間の行（frozenRowCount〜rendered.start）はDOMに存在しないためスキップする。
        const rendered = context.virtualScroll.getRenderedRange();
        const loopEnd = Math.min(context.storeRowIndices.length, rendered.end);
        for (let domDataRow = 0; domDataRow < loopEnd; domDataRow++) {
            // 固定行とビューポート行の間のギャップはDOMに存在しないためスキップする
            if (domDataRow >= context.frozenRowCount && domDataRow < rendered.start) continue;
            const domRow = domDataRow + 1;
            const rowElement = this.getRowElement(domRow);
            if (rowElement === null) continue;
            this.applyBookmarkMarksToRow(rowElement, domDataRow, context, true);
        }
    }

    restoreBookmarkMarksForDataRowRange(startDataRowIndex: number, endDataRowIndex: number, clearExisting: boolean = true): void {
        if (this.isMiniTable) return;
        if (this.tab === false) return;
        if (this.tableData.primaryKeyColumns.length === 0) return;
        const context = this.createBookmarkRestoreContext();
        if (context === null) return;
        const end = Math.min(endDataRowIndex, context.storeRowIndices.length);
        for (let dataRowIndex = startDataRowIndex; dataRowIndex < end; dataRowIndex++) {
            const rowElement = this.getRowElement(dataRowIndex + 1);
            if (rowElement === null) continue;
            this.applyBookmarkMarksToRow(rowElement, dataRowIndex, context, clearExisting);
        }
    }

    private createBookmarkRestoreContext(): {
        bookmarkColumnsByRow: Map<string, Set<string>>;
        dataColumnIndicesByName: Map<string, number[]>;
        pkStoreColumnIndices: number[];
        storeRows: string[][];
        storeRowIndices: number[];
        filteredRowIndices: number[];
        hasActiveFilter: boolean;
        frozenRowCount: number;
        dataColumnOffset: number;
        virtualScroll: any;
    } | null {
        const tableName = this.tableName as string;
        const tableData = this.tableData;
        const storeRows = this.store.getRows(tableName) as string[][] | false;
        if (storeRows === false) return null;

        const bookmarkColumnsByRow = this.getBookmarkColumnsByRow();
        const dataColumnIndicesByName = this.getDataColumnIndicesByName();
        const pkStoreColumnIndices: number[] = [];
        for (const pkColumnName of tableData.primaryKeyColumns) {
            const dataColumnIndex = tableData.header.findIndex((col: any) => col.name === pkColumnName);
            if (dataColumnIndex === -1) return null;
            const storeColumnIndex = tableData.columnMapping[dataColumnIndex];
            if (storeColumnIndex === -1) return null;
            pkStoreColumnIndices.push(storeColumnIndex);
        }

        return {
            bookmarkColumnsByRow,
            dataColumnIndicesByName,
            pkStoreColumnIndices,
            storeRows,
            storeRowIndices: this.storeRowIndices as number[],
            filteredRowIndices: this.filteredRowIndices as number[],
            hasActiveFilter: this.columnFilter.hasActiveFilter() as boolean,
            frozenRowCount: this.frozenRowCount as number,
            dataColumnOffset: this.dataColumnOffset() as number,
            virtualScroll: this.virtualScroll,
        };
    }

    private getBookmarkColumnsByRow(): Map<string, Set<string>> {
        const result = new Map<string, Set<string>>();
        const entries = this.sidebar.getBookmarksForTable(this.tableName) as BookmarkEntry[];
        for (const entry of entries) {
            let columns = result.get(entry.rowKey);
            if (columns === undefined) {
                columns = new Set<string>();
                result.set(entry.rowKey, columns);
            }
            columns.add(entry.columnName);
        }
        return result;
    }

    private getDataColumnIndicesByName(): Map<string, number[]> {
        const result = new Map<string, number[]>();
        for (let dataColumnIndex = 0; dataColumnIndex < this.tableData.header.length; dataColumnIndex++) {
            const columnName = this.tableData.header[dataColumnIndex].name;
            const indices = result.get(columnName);
            if (indices === undefined) {
                result.set(columnName, [dataColumnIndex]);
            } else {
                indices.push(dataColumnIndex);
            }
        }
        return result;
    }

    private applyBookmarkMarksToRow(
        rowElement: HTMLElement,
        dataRowIndex: number,
        context: {
            bookmarkColumnsByRow: Map<string, Set<string>>;
            dataColumnIndicesByName: Map<string, number[]>;
            pkStoreColumnIndices: number[];
            storeRows: string[][];
            storeRowIndices: number[];
            filteredRowIndices: number[];
            hasActiveFilter: boolean;
            dataColumnOffset: number;
        },
        clearExisting: boolean
    ): void {
        const pkValue = this.getRowBookmarkKeyFromStoreDataRow(dataRowIndex, context);
        const bookmarkedColumnNames = pkValue === '' ? undefined : context.bookmarkColumnsByRow.get(pkValue);
        const dataColumnOffset = context.dataColumnOffset;

        const markedCells = clearExisting
            ? rowElement.querySelectorAll<HTMLElement>('.editor-table-cell[data-bookmarked]')
            : [];
        if (bookmarkedColumnNames === undefined || bookmarkedColumnNames.size === 0) {
            for (let i = 0; i < markedCells.length; i++) markedCells[i].removeAttribute('data-bookmarked');
            return;
        }

        for (let i = 0; i < markedCells.length; i++) {
            const cell = markedCells[i];
            const dataColumnIndex = Array.prototype.indexOf.call(rowElement.children, cell) - dataColumnOffset;
            const column = dataColumnIndex >= 0 ? this.tableData.header[dataColumnIndex] : undefined;
            if (column === undefined || !bookmarkedColumnNames.has(column.name)) {
                cell.removeAttribute('data-bookmarked');
            }
        }

        for (const columnName of bookmarkedColumnNames) {
            const dataColumnIndices = context.dataColumnIndicesByName.get(columnName);
            if (dataColumnIndices === undefined) continue;
            for (const dataColumnIndex of dataColumnIndices) {
                const cell = rowElement.children[dataColumnIndex + dataColumnOffset];
                if (cell instanceof HTMLElement && !cell.hasAttribute('data-bookmarked')) {
                    cell.setAttribute('data-bookmarked', '');
                }
            }
        }
    }

    private getRowBookmarkKeyFromStoreDataRow(
        dataRowIndex: number,
        context: {
            pkStoreColumnIndices: number[];
            storeRows: string[][];
            storeRowIndices: number[];
            filteredRowIndices: number[];
            hasActiveFilter: boolean;
        }
    ): string {
        let storeRowIndex = -1;
        if (context.hasActiveFilter) {
            if (dataRowIndex < 0 || dataRowIndex >= context.filteredRowIndices.length) return '';
            const mappedIndex = context.filteredRowIndices[dataRowIndex];
            if (mappedIndex < 0 || mappedIndex >= context.storeRowIndices.length) return '';
            storeRowIndex = context.storeRowIndices[mappedIndex];
        } else {
            if (dataRowIndex < 0 || dataRowIndex >= context.storeRowIndices.length) return '';
            storeRowIndex = context.storeRowIndices[dataRowIndex];
        }
        const storeRow = storeRowIndex >= 0 && storeRowIndex < context.storeRows.length
            ? context.storeRows[storeRowIndex]
            : undefined;
        if (storeRow === undefined) return '';
        const values: string[] = [];
        for (const storeColumnIndex of context.pkStoreColumnIndices) {
            const value = storeColumnIndex < storeRow.length ? storeRow[storeColumnIndex] : '';
            if (value === '') return '';
            values.push(value);
        }
        return values.join('\t');
    }
}
