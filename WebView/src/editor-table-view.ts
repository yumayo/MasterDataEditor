import {EditorTable, ViewContext} from "./editor-table";
import {Selection} from "./selection";
import {AreaResizer} from "./area-resizer";
import {CellChange, Command} from "./command";
import {EditorTableViewStyle} from "./editor-table-view-style";
import {EditorTableViewRestructure} from "./editor-table-view-restructure";
import {EditorTableViewSync} from "./editor-table-view-sync";
import {EditorTableViewInspector} from "./editor-table-view-inspector";
import {SavedViewRowState} from "./view-row-restructure-command";

/**
 * ビュー行管理モジュール（ファサード）
 *
 * 責務:
 * - viewContextの一元管理
 * - サブモジュールの初期化と委譲
 *
 * 実処理は以下のサブモジュールに委譲する:
 * - EditorTableViewStyle: パディング・グループリーダー・折りたたみトグルのスタイル適用
 * - EditorTableViewRestructure: ビュー行の構築・再構築・DOM操作・キーマップ再構築
 * - EditorTableViewSync: JOIN列の値同期
 * - EditorTableViewInspector: セル・行の検査判定
 */
export class EditorTableView {
    private readonly style: EditorTableViewStyle;
    private readonly restructure: EditorTableViewRestructure;
    private readonly sync: EditorTableViewSync;
    private readonly inspector: EditorTableViewInspector;
    /** ビューコンテキスト（ビュータブのみ） */
    private viewContext: ViewContext | false;

    constructor(table: EditorTable, selection: Selection, areaResizer: AreaResizer) {
        this.viewContext = false;
        this.style = new EditorTableViewStyle(this, table, selection);
        this.restructure = new EditorTableViewRestructure(this, table, selection, areaResizer);
        this.sync = new EditorTableViewSync(this, table);
        this.inspector = new EditorTableViewInspector(this, table);
    }

    // --- viewContextアクセス ---

    /**
     * ビューコンテキストを設定する
     *
     * 初期描画パスで使用される。行番号の再付番とビュー行スタイルを適用する。
     * 参照ヒントはこの時点では参照データキャッシュが未構築のため適用されない。
     * 呼び出し元が TabReference.preloadReferenceTables() 完了後に
     * updateReferenceHints() を呼び出す責務を持つ。
     */
    setViewContext(context: ViewContext): void {
        this.viewContext = context;
        // 初期テーブル構築ではdata-rowが0始まりのため、DOM位置と一致するよう再番号付け
        this.restructure.renumberRowsFrom(1);
        this.style.applyViewRowStylesForRange(0, context.rowMetadata.length, true);
    }

    /**
     * ビューコンテキストが設定されているかを返す
     * ビュータブの場合のみtrueを返す
     */
    hasViewContext(): boolean {
        return this.viewContext !== false;
    }

    /**
     * ビューコンテキストを取得する
     * hasViewContext()がtrueの場合のみ呼び出すこと
     */
    getViewContext(): ViewContext {
        if (!this.viewContext) throw new Error('viewContextが未設定');
        return this.viewContext;
    }

    // --- Style委譲 ---

    applyViewRowStylesForRange(startMetaIdx: number, endMetaIdx: number, applyPadding: boolean): void {
        this.style.applyViewRowStylesForRange(startMetaIdx, endMetaIdx, applyPadding);
    }

    // --- Restructure委譲 ---

    needsViewRowRestructure(editedRow: number, editedColumn: number, newValue: string): boolean {
        return this.restructure.needsViewRowRestructure(editedRow, editedColumn, newValue);
    }

    buildAndExecuteViewRowRestructure(editedRow: number, editedColumn: number, newValue: string): Command {
        return this.restructure.buildAndExecuteViewRowRestructure(editedRow, editedColumn, newValue);
    }

    replaceViewRows(metaStartIndex: number, removeCount: number, insertRows: SavedViewRowState[]): void {
        this.restructure.replaceViewRows(metaStartIndex, removeCount, insertRows);
    }

    renumberRowsFrom(startDomIndex: number): void {
        this.restructure.renumberRowsFrom(startDomIndex);
    }

    refreshViewRows(): void {
        this.restructure.refreshViewRows();
    }

    rebuildJoinTableKeyMaps(openEditorTables: Map<string, EditorTable>): void {
        this.restructure.rebuildJoinTableKeyMaps(openEditorTables);
    }

    // --- Sync委譲 ---

    synchronizeJoinedColumnValues(editedRow: number, editedColumn: number, newValue: string): CellChange[] {
        return this.sync.synchronizeJoinedColumnValues(editedRow, editedColumn, newValue);
    }

    // --- Inspector委譲 ---

    isViewLeaderRow(row: number): boolean {
        return this.inspector.isViewLeaderRow(row);
    }

    isPaddingCell(row: number, column: number): boolean {
        return this.inspector.isPaddingCell(row, column);
    }

    containsPaddingCell(startRow: number, startColumn: number, endRow: number, endColumn: number): boolean {
        return this.inspector.containsPaddingCell(startRow, startColumn, endRow, endColumn);
    }

    containsPaddingRow(startRow: number, endRow: number): boolean {
        return this.inspector.containsPaddingRow(startRow, endRow);
    }

    containsReadOnlyCell(startRow: number, startColumn: number, endRow: number, endColumn: number): boolean {
        return this.inspector.containsReadOnlyCell(startRow, startColumn, endRow, endColumn);
    }

    isSelectionCoveringCompleteGroups(startRow: number, endRow: number): boolean {
        return this.inspector.isSelectionCoveringCompleteGroups(startRow, endRow);
    }

    containsJoinedColumn(startColumn: number, endColumn: number): boolean {
        return this.inspector.containsJoinedColumn(startColumn, endColumn);
    }

    getMaxDataRow(): number {
        return this.inspector.getMaxDataRow();
    }
}
