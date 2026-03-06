import {EditorTable, ViewContext} from "./editor-table";
import {Selection} from "./selection";
import {AreaResizer} from "./area-resizer";
import {CellChange, Command} from "./command";
import {EditorTableViewStyle} from "./editor-table-view-style";
import {EditorTableViewRestructure} from "./editor-table-view-restructure";
import {EditorTableViewSync} from "./editor-table-view-sync";
import {EditorTableViewInspector} from "./editor-table-view-inspector";
import {InMemoryTableStore} from "./in-memory-table-store";
import {ReferenceDataCache} from "./reference-data-cache";
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
 * - EditorTableViewRestructure: ビュー行の構築・再構築・DOM操作
 * - EditorTableViewSync: JOIN列の値同期
 * - EditorTableViewInspector: セル・行の検査判定
 */
export class EditorTableView {
    private readonly table: EditorTable;
    private readonly style: EditorTableViewStyle;
    private readonly restructure: EditorTableViewRestructure;
    private readonly sync: EditorTableViewSync;
    private readonly inspector: EditorTableViewInspector;
    /** ビューコンテキスト（ビュータブのみ） */
    private viewContext: ViewContext | false;

    constructor(table: EditorTable, selection: Selection, areaResizer: AreaResizer, store: InMemoryTableStore, referenceDataCache: ReferenceDataCache) {
        this.table = table;
        this.viewContext = false;
        this.style = new EditorTableViewStyle(this, table, selection);
        this.restructure = new EditorTableViewRestructure(this, table, selection, areaResizer, store);
        this.sync = new EditorTableViewSync(this, table, store, referenceDataCache);
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
        // ビュー行スタイルを適用（data-base-row-index属性が設定されたデータ行のみ対象）
        // 空行にはDOM属性が設定されていないため、属性の有無でデータ行の終端を判定する
        const tableElement = this.table.getTableElement();
        let dataRowCount = 0;
        for (let i = 1; i < tableElement.children.length; i++) {
            if (!(tableElement.children[i] as HTMLElement).hasAttribute('data-base-row-index')) break;
            dataRowCount++;
        }
        this.style.applyViewRowStylesForRange(0, dataRowCount, true);
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

    buildAndExecuteViewRowRestructure(editedRow: number, editedColumn: number, newValue: string, keyMaps: Map<string, Map<string, string[][]>>): Command {
        return this.restructure.buildAndExecuteViewRowRestructure(editedRow, editedColumn, newValue, keyMaps);
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

    // --- Sync委譲 ---

    synchronizeJoinedColumnValues(editedRow: number, editedColumn: number, newValue: string): CellChange[] {
        return this.sync.synchronizeJoinedColumnValues(editedRow, editedColumn, newValue);
    }

    /** ビュー結合列の編集をソーステーブルのDOMとStoreに伝搬する
     *  @returns JOINテーブルのStore行が追加または除去された場合にtrue */
    propagateJoinedColumnToSourceTable(row: number, column: number, value: string, oldValue: string): boolean {
        if (!this.hasViewContext()) return false;
        return this.sync.propagateJoinedColumnToSourceTable(row, column, value, oldValue);
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

    containsReadOnlyCell(startRow: number, startColumn: number, endRow: number, endColumn: number): boolean {
        return this.inspector.containsReadOnlyCell(startRow, startColumn, endRow, endColumn);
    }

    isSelectionCoveringCompleteGroups(startRow: number, endRow: number): boolean {
        return this.inspector.isSelectionCoveringCompleteGroups(startRow, endRow);
    }

    /** 単一セル編集のガード（文字入力・ダブルクリック・ドロップダウン） */
    isCellEditBlocked(row: number, column: number): boolean {
        return this.inspector.isCellEditBlocked(row, column);
    }

    /** 範囲編集のガード（Paste・Fill） */
    isRangeEditBlocked(startRow: number, startColumn: number, endRow: number, endColumn: number): boolean {
        return this.inspector.isRangeEditBlocked(startRow, startColumn, endRow, endColumn);
    }

    /** Delete操作のガード（パディングセル + FKグループ完全性チェック） */
    isDeleteBlocked(startRow: number, startColumn: number, endRow: number, endColumn: number): boolean {
        return this.inspector.isDeleteBlocked(startRow, startColumn, endRow, endColumn);
    }

    containsJoinedColumn(startColumn: number, endColumn: number): boolean {
        return this.inspector.containsJoinedColumn(startColumn, endColumn);
    }

    getMaxDataRow(): number {
        return this.inspector.getMaxDataRow();
    }
}
