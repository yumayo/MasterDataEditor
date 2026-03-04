import {Command} from "./command";
import {EditorTable} from "./editor-table";
import {ViewDefinition, ViewColumnConfig} from "./model/view-definition";
import {ViewColumnMapping} from "./model/view-column-mapping";

/**
 * ビュー列を非表示にするCommand（Undo/Redo対応）
 *
 * execute: 対象列をDOMから削除し、columnMappingsを更新、
 *          viewDefinition.columnsにhidden:trueエントリを追加
 * undo: 列を復元し、columnMappingsを復元、
 *       viewDefinition.columnsからhidden:trueエントリを削除
 */
export class ViewHideColumnCommand implements Command {
    private readonly editorTable: EditorTable;
    private readonly viewDefinition: ViewDefinition;
    private readonly columnMappings: ViewColumnMapping[];
    private readonly columnIndex: number;

    /** 保存したマッピング（undo復元用） */
    private savedMapping: ViewColumnMapping;
    /** 保存したヘッダー名（undo復元用） */
    private savedHeaderName: string;
    /** 保存した列幅（undo復元用） */
    private savedWidth: string;
    /** 保存した全行のセル値（undo復元用） */
    private savedCellValues: string[];
    /** 保存した各行のパディングフラグ（undo復元用、DOMのCSSクラスから取得） */
    private savedPaddingFlags: boolean[];
    /** JOIN列ヘッダーのCSSクラス有無（undo復元用） */
    private savedIsJoinedHeader: boolean;
    /** 追加したhiddenエントリ（undo時の削除用） */
    private hiddenConfig: ViewColumnConfig;

    constructor(
        editorTable: EditorTable,
        viewDefinition: ViewDefinition,
        columnMappings: ViewColumnMapping[],
        columnIndex: number
    ) {
        this.editorTable = editorTable;
        this.viewDefinition = viewDefinition;
        this.columnMappings = columnMappings;
        this.columnIndex = columnIndex;

        // 列情報を保存
        this.savedMapping = columnMappings[columnIndex];
        this.savedHeaderName = editorTable.getColumnHeaderValue(columnIndex);
        this.savedWidth = editorTable.getColumnWidth(columnIndex);
        this.savedIsJoinedHeader = this.savedMapping.isJoinedColumn;

        // 全行のセル値とパディングフラグを保存（DOMのCSSクラスから取得）
        const tableElement = editorTable.getTableElement();
        const rowCount = editorTable.getRowCount();
        this.savedCellValues = [];
        this.savedPaddingFlags = [];
        for (let r = 1; r < rowCount; r++) {
            this.savedCellValues.push(editorTable.getCellValueAt(r, this.columnIndex + 1));
            const rowElement = tableElement.children[r] as HTMLElement;
            const cell = rowElement.children[this.columnIndex + 1] as HTMLElement;
            this.savedPaddingFlags.push(cell.classList.contains('view-padding-cell'));
        }

        // hiddenエントリを構築
        this.hiddenConfig = {
            tableName: this.savedMapping.tableName,
            columnName: this.savedMapping.sourceColumnName,
            width: parseInt(this.savedWidth),
            hidden: true,
        };
    }

    execute(): void {
        // viewDefinition.columnsにhidden:trueエントリを追加
        this.viewDefinition.columns.push(this.hiddenConfig);

        // DOMから列を削除
        this.editorTable.deleteColumn(this.columnIndex);

        // columnMappingsから削除
        this.columnMappings.splice(this.columnIndex, 1);
    }

    undo(): void {
        // viewDefinition.columnsからhidden:trueエントリを削除
        const idx = this.viewDefinition.columns.indexOf(this.hiddenConfig);
        if (idx >= 0) {
            this.viewDefinition.columns.splice(idx, 1);
        }

        // DOM列を復元
        this.editorTable.insertColumnInternal(this.columnIndex);

        // ヘッダー名を復元
        this.editorTable.setColumnHeaderValue(this.columnIndex, this.savedHeaderName);

        // 列幅を復元
        this.editorTable.setColumnWidth(this.columnIndex, this.savedWidth);

        // セル値を復元し、パディングフラグをCSSクラスとして復元
        const rowCount = this.editorTable.getRowCount();
        const tableElement = this.editorTable.getTableElement();
        for (let r = 1; r < rowCount; r++) {
            this.editorTable.updateCellValueAt(r, this.columnIndex + 1, this.savedCellValues[r - 1]);
            if (r - 1 < this.savedPaddingFlags.length && this.savedPaddingFlags[r - 1]) {
                const rowElement = tableElement.children[r] as HTMLElement;
                const cell = rowElement.children[this.columnIndex + 1] as HTMLElement;
                cell.classList.add('view-padding-cell');
                cell.textContent = '';
            }
        }

        // JOIN列ヘッダーのCSSクラスを復元
        if (this.savedIsJoinedHeader) {
            this.editorTable.addColumnHeaderClass(this.columnIndex, 'editor-table-joined-column-header');
        }

        // columnMappingsを復元
        this.columnMappings.splice(this.columnIndex, 0, this.savedMapping);
    }

    redo(): void {
        this.execute();
    }

    getDescription(): string {
        return 'ViewHideColumn: ' + this.savedMapping.tableName + '.' + this.savedMapping.sourceColumnName;
    }
}
