import {EditorTableData} from
    "./model/editor-table-data";
import {Selection, CellPosition} from
    "./selection";
import {EditorTableHandler} from
    "./editor-table-handler";
import {
    ContextMenu,
    ContextMenuEntry
} from "./context-menu";
import {History} from "./history";
import {
    Command,
    CellChange,
    InsertColumnCommand,
    InsertColumnsCommand,
    InsertRowCommand,
    InsertRowsCommand,
    DeleteColumnCommand,
    DeleteColumnsCommand,
    DeleteRowCommand,
    DeleteRowsCommand
} from "./command";
import {AreaResizer} from "./area-resizer";
import {
    DEFAULT_COLUMN_WIDTH,
    DEFAULT_ROW_HEIGHT
} from "./constant";
import {ScrollViewportController} from
    "./scroll-viewport-controller";
import {SelectionDragController} from
    "./selection-drag-controller";
import {ReferenceDataCache} from
    "./reference-data-cache";
import {
    parseReferenceExpression,
    isDynamicReference,
    isSimpleReference
} from "./reference-expression";
import {
    ReverseReferenceEntry,
    ReverseReferenceMap,
    formatReverseReferenceHint
} from "./reverse-reference-resolver";
import {Sidebar} from "./sidebar";
import {ViewDefinition} from
    "./model/view-definition";
import {ViewColumnMapping} from
    "./model/view-column-mapping";
import {ViewRowMetadata} from
    "./model/view-row-metadata";
import {config} from "./config";
import {rebuildExpandedRowsForBaseRow, ExpandedRowResult} from
    "./view-table-data-builder";
import {
    ViewRowRestructureCommand,
    SavedViewRowState
} from "./view-row-restructure-command";
import {ViewHideColumnCommand} from
    "./view-hide-column-command";

/**
 * 利用可能なJoin対象の情報
 */
export interface AvailableJoinTarget {
    /** 参照元列名 */
    sourceColumnName: string;
    /** 結合先テーブル名 */
    targetTableName: string;
    /** 結合先キー列名 */
    targetColumnName: string;
}

/**
 * ビューコンテキスト
 * ビュータブでのみ設定される
 */
export interface ViewContext {
    viewDefinition: ViewDefinition;
    columnMappings: ViewColumnMapping[];
    availableJoinTargets: AvailableJoinTarget[];
    /** 結合テーブルのキーマップ（テーブル名 → キー値 → 行の配列） */
    joinTableKeyMaps: Map<string, Map<string, string[][]>>;
    /** 各行のメタデータ（1:n展開のパディング・グループ情報） */
    rowMetadata: ViewRowMetadata[];
    onJoinAsync: (targetTable: string, sourceColumn: string, afterColumnIndex: number) => Promise<void>;
    /** 非表示列を再表示するコールバック（ビュータブの再構築を行う） */
    onShowHiddenColumn: (tableName: string, columnName: string) => void;
}

export class EditorTable {
    readonly tableName: string;
    private readonly tableData: EditorTableData;

    private readonly element: HTMLElement;

    private readonly selection: Selection;
    private readonly areaResizer: AreaResizer;
    private readonly handler: EditorTableHandler;
    private readonly contextMenu: ContextMenu;
    private readonly history: History;
    private readonly selectionDragController: SelectionDragController;
    private readonly scrollBinding: ScrollViewportController;
    private lastScrollLeft = -1;
    private readonly referenceDataCache: ReferenceDataCache;

    /** ビューコンテキスト（ビュータブのみ） */
    private viewContext:
        ViewContext | undefined;

    /** 逆参照マップ（PK値→逆参照エントリ配列） */
    private reverseReferenceMap:
        ReverseReferenceMap | undefined;

    /** 参照箇所を表示するサイドバー */
    private readonly sidebar: Sidebar;

    constructor(
        tableName: string,
        tableData: EditorTableData,
        referenceDataCache: ReferenceDataCache,
        handler: EditorTableHandler,
        selection: Selection,
        contextMenu: ContextMenu,
        history: History,
        areaResizer: AreaResizer,
        scrollBinding: ScrollViewportController,
        sidebar: Sidebar
    ) {
        this.tableData = tableData;
        this.tableName = tableName;
        this.referenceDataCache = referenceDataCache;
        this.handler = handler;
        this.selection = selection;
        this.contextMenu = contextMenu;
        this.history = history;
        this.areaResizer = areaResizer;
        this.scrollBinding = scrollBinding;
        this.sidebar = sidebar;

        this.element = document.createElement('div');

        this.selectionDragController = new SelectionDragController(
            this.element,
            selection,
            scrollBinding
        );
        this.viewContext = undefined;
        this.reverseReferenceMap = undefined;
    }

    /**
     * ビューコンテキストを設定する
     */
    setViewContext(context: ViewContext): void {
        this.viewContext = context;
        this.applyViewRowStyles();
    }

    /**
     * 1:n展開のパディングセル・グループリーダー行のスタイルを適用する
     * setViewContext()後に呼び出される
     */
    private applyViewRowStyles(): void {
        if (!this.viewContext) return;
        this.applyViewRowStylesForRange(0, this.viewContext.rowMetadata.length, true);
    }

    /**
     * グループの折りたたみ/展開をトグルする
     * 表示状態の変更のみでデータ変更を伴わないため、Undo/Redo対象外
     */
    private toggleCollapseGroup(leaderMetaIndex: number, targetTable: string, toggle: HTMLElement): void {
        if (!this.viewContext) throw new Error('viewContextが未設定');
        const rowMetadata = this.viewContext.rowMetadata;
        const leaderMeta = rowMetadata[leaderMetaIndex];

        // このグループのgroupInfoを特定
        const groupInfoIndex = leaderMeta.groupInfos.findIndex(g => g.sourceTable === targetTable);
        if (groupInfoIndex === -1) return;

        const isCollapsed = toggle.textContent === '▶';

        if (isCollapsed) {
            // 展開: 子行を表示する
            toggle.textContent = '▼';
            this.setGroupRowsVisibility(leaderMetaIndex, targetTable, groupInfoIndex, true);
        } else {
            // 折りたたみ: 子行を非表示にする
            toggle.textContent = '▶';
            this.setGroupRowsVisibility(leaderMetaIndex, targetTable, groupInfoIndex, false);
        }
        // 行の表示/非表示が変わったので選択範囲の描画を再計算する
        this.selection.updateRendererAfterResize();
    }

    /**
     * グループの子行の表示/非表示を設定する
     */
    private setGroupRowsVisibility(
        leaderMetaIndex: number, targetTable: string, groupInfoIndex: number, visible: boolean
    ): void {
        if (!this.viewContext) throw new Error('viewContextが未設定');
        const rowMetadata = this.viewContext.rowMetadata;
        const leaderMeta = rowMetadata[leaderMetaIndex];
        const leaderGroupInfo = leaderMeta.groupInfos[groupInfoIndex];

        // リーダー行以降の同一グループの行を探す
        for (let i = leaderMetaIndex + 1; i < rowMetadata.length; i++) {
            const meta = rowMetadata[i];
            // ベース行が変わったらグループ終了
            if (meta.baseRowIndex !== leaderMeta.baseRowIndex) break;

            // このレベルのgroupInfoが同じキー値を持つか判定
            if (groupInfoIndex >= meta.groupInfos.length) break;
            const groupInfo = meta.groupInfos[groupInfoIndex];
            if (groupInfo.sourceTable !== targetTable) break;
            if (groupInfo.sourceKeyValue !== leaderGroupInfo.sourceKeyValue) break;

            const domRowIndex = i + 1;
            const rowElement = this.element.children[domRowIndex] as HTMLElement;
            if (!rowElement) continue;
            rowElement.style.display = visible ? '' : 'none';
        }
    }

    /**
     * テーブルデータを取得する
     */
    getTableData(): EditorTableData {
        return this.tableData;
    }

    /**
     * Selection を取得する
     */
    getSelection(): Selection {
        return this.selection;
    }

    /**
     * 列ヘッダーにCSSクラスを追加する
     */
    addColumnHeaderClass(
        columnIndex: number,
        className: string
    ): void {
        const headerRow =
            this.element.children[0];
        const headerCell =
            headerRow.children[
                columnIndex + 1
            ] as HTMLElement;
        if (headerCell) {
            headerCell.classList.add(className);
        }
    }

    /**
     * 参照データのpreload完了後にセルの参照ヒントを更新する
     */
    updateReferenceHints(): void {
        // 全データ行のセルを更新
        for (let rowIndex = 1; rowIndex < this.element.children.length; rowIndex++) {
            const row = this.element.children[rowIndex] as HTMLElement;
            // 列ヘッダーは除く（column=0が行ヘッダー、column=1以降がデータセル）
            for (let colIndex = 1; colIndex < row.children.length; colIndex++) {
                const cell = row.children[colIndex] as HTMLElement;
                const dataColumnIndex = colIndex - 1;
                const value = EditorTable.getCellValue(cell);
                this.setCellValue(cell, value, dataColumnIndex, rowIndex);
            }
        }
    }

    /**
     * 逆参照マップにエントリが存在するか判定する
     */
    hasReverseReferences(): boolean {
        if (!this.reverseReferenceMap) return false;
        return this.reverseReferenceMap.size > 0;
    }

    /**
     * PK値から逆参照エントリを取得する
     * Map.get()の戻り値がundefined許容のため ?? で空配列に変換
     */
    getReverseReferenceEntries(pkValue: string): ReverseReferenceEntry[] {
        if (!this.reverseReferenceMap) return [];
        return this.reverseReferenceMap.get(pkValue) ?? [];
    }

    /**
     * 行のPK値を取得する
     * @param rowIndex 行インデックス（0始まり、列ヘッダー行を含む）
     */
    getRowPkValue(rowIndex: number): string {
        const pkColumnIndex = this.tableData.header.findIndex(
            col => col.name === config.primaryKeyColumnName
        );
        if (pkColumnIndex === -1) return '';
        return this.getCellValueAt(rowIndex, pkColumnIndex + 1);
    }

    /**
     * 逆参照ヒントを更新する
     * ReverseReferenceResolver の結果を受け取り、
     * PK列のセルに逆参照ヒントspanを追加する
     */
    updateReverseReferenceHints(
        map: ReverseReferenceMap
    ): void {
        this.reverseReferenceMap = map;

        // PK列のインデックスを取得
        const pkColumnIndex =
            this.tableData.header.findIndex(
                col => col.name
                    === config.primaryKeyColumnName
            );
        if (pkColumnIndex === -1) return;

        // 全データ行のPK列セルに逆参照ヒントを追加
        for (let rowIndex = 1; rowIndex < this.element.children.length; rowIndex++) {
            const row = this.element.children[rowIndex] as HTMLElement;
            const cell = row.children[pkColumnIndex + 1] as HTMLElement;
            if (!cell) continue;

            const pkValue = EditorTable.getCellValue(cell);
            this.applyReverseReferenceHint(cell, pkValue);
        }
    }

    /**
     * 指定した列のすべてのセルの参照ヒントを更新する
     */
    updateColumnReferenceHints(columnIndex: number): void {
        for (let rowIndex = 1; rowIndex < this.element.children.length; rowIndex++) {
            const row = this.element.children[rowIndex] as HTMLElement;
            const cell = row.children[columnIndex + 1] as HTMLElement;
            if (cell) {
                const value = EditorTable.getCellValue(cell);
                this.setCellValue(cell, value, columnIndex, rowIndex);
            }
        }
    }
    
    /**
     * テーブル要素を親要素に追加する
     * @param parent 親要素
     */
    appendTo(parent: HTMLElement): void {
        parent.appendChild(this.element);
    }

    /**
     * DOM要素を構築し、イベントリスナーを登録する
     * ファクトリ関数から呼び出される
     */
    initialize(): void {
        this.element.classList.add('editor-table');

        {
            const cells = [];
            // 左上隅の空セル
            const cornerCell = document.createElement('div');
            cornerCell.classList.add('editor-table-cell', 'editor-table-corner-cell');
            EditorTable.applyCellHeight(cornerCell, DEFAULT_ROW_HEIGHT);

            // コーナーセルクリックで全選択
            cornerCell.addEventListener('mousedown', () => {
                this.handler.submitAndHide();
                this.selection.selectAll();
            });

            cells.push(cornerCell);

            // 列ヘッダー (A, B, C, ...)
            for (let i = 0; i < this.tableData.header.length; ++i) {
                const columnHeaderCell =
                    this.createColumnHeaderCell(
                        this.tableData.header[i].name,
                        i,
                        this.tableData.header[i].width
                    );
                cells.push(columnHeaderCell);
            }
            const columnHeaderRow = EditorTable.createRow(cells, 0);
            columnHeaderRow.classList.add('editor-table-column-header-row');
            this.element.appendChild(columnHeaderRow);
        }

        for (let i = 0; i < this.tableData.body.length; ++i) {
            const cells = [];
            const rowIndex = i;
            const rowHeaderCell = this.createRowHeaderCell(String(i + 1), i);

            cells.push(rowHeaderCell);

            for (let j = 0; j < this.tableData.header.length; ++j) {
                const cell = EditorTable.createCell(this, this.tableData.body[i].values[j], j, this.tableData.header[j].width, DEFAULT_ROW_HEIGHT);
                cells.push(cell);
            }
            const row = EditorTable.createRow(cells, rowIndex);
            this.element.appendChild(row);
        }

        for (let i = 0; i < 100 - this.tableData.body.length; ++i) {
            const cells = [];
            // 行ヘッダー (続き)
            const rowIndex = this.tableData.body.length + i;
            const rowHeaderCell = this.createRowHeaderCell(String(this.tableData.body.length + i + 1), this.tableData.body.length + i);

            cells.push(rowHeaderCell);

            for (let j = 0; j < this.tableData.header.length; ++j) {
                const cell = EditorTable.createCell(this, '', j, this.tableData.header[j].width, DEFAULT_ROW_HEIGHT);
                cells.push(cell);
            }
            const row = EditorTable.createRow(cells, rowIndex);
            this.element.appendChild(row);
        }

        // フィル中のマウス移動イベント
        this.element.addEventListener('mousemove', (e) => {
            const target = e.target as HTMLElement;
            if (target.classList.contains('editor-table-cell')) {
                const position = this.getCellPositionFromElement(target);
                if (position) {
                    this.selection.updateFill(position.row, position.column, e.clientX, e.clientY);
                }
            }
        });
    }

    /**
     * 列挿入の公開メソッド（Commandを使用してhistoryに追加）
     */
    public insertColumn(columnIndex: number): void {
        this.insertColumns(columnIndex, 1);
    }

    /**
     * 列挿入の内部実装（Commandから呼び出される）
     */
    public insertColumnInternal(columnIndex: number): void {
        // 各行に新しいセルを挿入
        for (let currentRowIndex = 0; currentRowIndex < this.element.children.length; ++currentRowIndex) {
            const row = this.element.children[currentRowIndex] as HTMLElement;

            if (currentRowIndex === 0) {
                // 列ヘッダー行
                // 挿入前に既存のラベルをDOMから取得
                const existingLabels: string[] = [];
                for (let i = 1; i < row.children.length; ++i) {
                    const headerCell = row.children[i] as HTMLElement;
                    let label = '';
                    for (const node of Array.from(headerCell.childNodes)) {
                        if (node.nodeType === Node.TEXT_NODE) {
                            label = node.textContent || '';
                            break;
                        }
                    }
                    existingLabels.push(label);
                }

                const newHeaderCell =
                    this.createColumnHeaderCell(
                        '',
                        columnIndex,
                        DEFAULT_COLUMN_WIDTH
                    );

                // 挿入位置（行ヘッダーの後、columnIndex番目）
                const insertBefore = row.children[columnIndex + 1];
                row.insertBefore(newHeaderCell, insertBefore);

                // 全列ヘッダーのラベルを更新（DOMから取得した既存ラベルを使用）
                const newColumnCount = existingLabels.length + 1;
                for (let i = 0; i < newColumnCount; ++i) {
                    const headerCell = row.children[i + 1] as HTMLElement;
                    headerCell.dataset.columnIndex = String(i);
                    headerCell.dataset.col = String(i);
                    // 挿入位置を考慮してラベルを決定
                    // i < columnIndex: 元の位置のラベル
                    // i == columnIndex: 新しく挿入された列（空）
                    // i > columnIndex: 元の位置-1のラベル（挿入によりずれた）
                    let label = '';
                    if (i < columnIndex) {
                        label = existingLabels[i] || '';
                    } else if (i > columnIndex) {
                        label = existingLabels[i - 1] || '';
                    }
                    // i === columnIndex の場合は空文字列のまま

                    // 既存のテキストノードを探して更新（リサイズハンドルは保持）
                    let textNode: Text | undefined;
                    for (const node of Array.from(headerCell.childNodes)) {
                        if (node.nodeType === Node.TEXT_NODE) {
                            textNode = node as Text;
                            break;
                        }
                    }

                    if (textNode) {
                        textNode.textContent = label;
                    } else {
                        // テキストノードがない場合は先頭に挿入
                        headerCell.insertBefore(document.createTextNode(label), headerCell.firstChild);
                    }

                    // リサイズハンドルのイベントハンドラを再設定
                    const existingResizeHandle = headerCell.querySelector('.column-resize-handle');
                    if (existingResizeHandle) {
                        existingResizeHandle.remove();
                    }
                    const newResizeHandle = document.createElement('div');
                    newResizeHandle.classList.add('column-resize-handle');
                    this.areaResizer.setupColumnResizeHandle(newResizeHandle, headerCell, i);
                    headerCell.appendChild(newResizeHandle);
                }
            } else {
                // 通常の行: 行の高さは既存のセルから取得
                const newCell = EditorTable.createCell(this, '', columnIndex, DEFAULT_COLUMN_WIDTH, DEFAULT_ROW_HEIGHT);
                const insertBefore = row.children[columnIndex + 1];
                row.insertBefore(newCell, insertBefore);

                // 後続のセルのdata-colを更新
                for (let i = columnIndex + 1; i < row.children.length; ++i) {
                    const cell = row.children[i] as HTMLElement;
                    cell.dataset.col = String(i - 1);
                }
            }
        }

        // コピー範囲をクリア（列構造が変わったため）
        this.selection.clearCopyRange();
        // 選択範囲の描画を更新（ヘッダーの背景色を正しく表示するため）
        this.selection.updateRendererAfterResize();
    }

    /**
     * 行挿入の公開メソッド
     * （Commandを使用してhistoryに追加）
     */
    public insertRow(rowIndex: number): void {
        this.insertRows(rowIndex, 1);
    }

    /**
     * 行挿入の内部実装（Commandから呼び出される）
     */
    public insertRowInternal(rowIndex: number): void {
        // 列ヘッダー行から実際の列数を取得（行ヘッダーセルを除く）
        const columnHeaderRow = this.element.children[0];
        const columnCount = columnHeaderRow.children.length - 1;

        // 新しい行を作成
        const cells: HTMLElement[] = [];

        // 行ヘッダーを作成
        const rowHeaderCell =
            this.createRowHeaderCell(
                String(rowIndex), rowIndex - 1
            );
        cells.push(rowHeaderCell);

        // データセルを作成（列幅は列ヘッダーから取得）
        for (let j = 0; j < columnCount; ++j) {
            const cell = EditorTable.createCell(this, '', j, DEFAULT_COLUMN_WIDTH, DEFAULT_ROW_HEIGHT);
            cells.push(cell);
        }

        const newRow = EditorTable.createRow(cells, rowIndex);
        const insertBefore = this.element.children[rowIndex];
        this.element.insertBefore(newRow, insertBefore);

        // 後続の行のdata-rowと行ヘッダーの番号を更新
        for (let i = rowIndex + 1; i < this.element.children.length; ++i) {
            const row = this.element.children[i] as HTMLElement;
            row.dataset.row = String(i);
            const header = row.children[0] as HTMLElement;
            if (header.classList.contains('editor-table-row-header')) {
                // テキストノードを更新（リサイズハンドルは保持）
                let textNode: Text | undefined;
                for (const node of Array.from(header.childNodes)) {
                    if (node.nodeType === Node.TEXT_NODE) {
                        textNode = node as Text;
                        break;
                    }
                }
                if (textNode) {
                    textNode.textContent = String(i);
                } else {
                    header.insertBefore(document.createTextNode(String(i)), header.firstChild);
                }
                header.dataset.rowIndex = String(i - 1);

                // リサイズハンドルのイベントハンドラを再設定
                const resizeHandle = header.querySelector('.row-resize-handle');
                if (resizeHandle) {
                    resizeHandle.remove();
                }
                const newResizeHandle = document.createElement('div');
                newResizeHandle.classList.add('row-resize-handle');
                this.areaResizer.setupRowResizeHandle(newResizeHandle, header, i);
                header.appendChild(newResizeHandle);
            }
        }

        // コピー範囲をクリア（行構造が変わったため）
        this.selection.clearCopyRange();
        // 選択範囲の描画を更新（ヘッダーの背景色を正しく表示するため）
        this.selection.updateRendererAfterResize();
    }

    /**
     * 列削除の公開メソッド（Commandを使用してhistoryに追加）
     */
    public removeColumn(columnIndex: number): void {
        this.removeColumns(columnIndex, 1);
    }

    /**
     * 複数列挿入の公開メソッド
     * （Commandを使用してhistoryに追加）
     */
    public insertColumns(
        columnIndex: number,
        count: number
    ): void {
        let command: Command =
            new InsertColumnCommand(this, columnIndex);
        if (count > 1) {
            command = new InsertColumnsCommand(
                this, columnIndex, count
            );
        }

        const copyRange = this.selection.getCopyRange();
        const anchor = this.selection.getAnchor();
        this.history.executeCommand(command, {
            startRow: anchor.row,
            startColumn: anchor.column,
            endRow: anchor.row,
            endColumn: anchor.column
        }, copyRange);
    }

    /**
     * 複数列削除の公開メソッド
     * （Commandを使用してhistoryに追加）
     */
    public removeColumns(
        startColumnIndex: number,
        count: number
    ): void {
        const columnCount = this.getColumnCount();
        const maxCountFromStart =
            columnCount - startColumnIndex;
        const maxCountForKeepOne =
            columnCount - 1;
        const effectiveCount = Math.min(
            count,
            maxCountFromStart,
            maxCountForKeepOne
        );
        if (effectiveCount <= 0) {
            return;
        }

        let command: Command =
            new DeleteColumnCommand(
                this, startColumnIndex
            );
        if (effectiveCount > 1) {
            command = new DeleteColumnsCommand(
                this, startColumnIndex, effectiveCount
            );
        }

        const copyRange =
            this.selection.getCopyRange();
        const anchor = this.selection.getAnchor();
        this.history.executeCommand(command, {
            startRow: anchor.row,
            startColumn: anchor.column,
            endRow: anchor.row,
            endColumn: anchor.column
        }, copyRange);
    }

    /**
     * 行削除の公開メソッド
     * （Commandを使用してhistoryに追加）
     */
    public removeRow(rowIndex: number): void {
        this.removeRows(rowIndex, 1);
    }

    /**
     * 複数行挿入の公開メソッド
     * （Commandを使用してhistoryに追加）
     */
    public insertRows(
        rowIndex: number,
        count: number
    ): void {
        let command: Command =
            new InsertRowCommand(this, rowIndex);
        if (count > 1) {
            command = new InsertRowsCommand(
                this, rowIndex, count
            );
        }

        const copyRange =
            this.selection.getCopyRange();
        const anchor = this.selection.getAnchor();
        this.history.executeCommand(command, {
            startRow: anchor.row,
            startColumn: anchor.column,
            endRow: anchor.row,
            endColumn: anchor.column
        }, copyRange);
    }

    /**
     * 複数行削除の公開メソッド
     * （Commandを使用してhistoryに追加）
     */
    public removeRows(
        startRowIndex: number,
        count: number
    ): void {
        let command: Command =
            new DeleteRowCommand(
                this, startRowIndex
            );
        if (count > 1) {
            command = new DeleteRowsCommand(
                this, startRowIndex, count
            );
        }

        const copyRange =
            this.selection.getCopyRange();
        const anchor = this.selection.getAnchor();
        this.history.executeCommand(command, {
            startRow: anchor.row,
            startColumn: anchor.column,
            endRow: anchor.row,
            endColumn: anchor.column
        }, copyRange);
    }

    private static createRow(cells: HTMLElement[], rowIndex?: number) {
        const row = document.createElement('div');
        row.classList.add('editor-table-row');
        if (rowIndex !== undefined) {
            row.dataset.row = String(rowIndex);
        }
        for (let i = 0; i < cells.length; ++i) {
            row.appendChild(cells[i]);
        }
        return row;
    }

    private static createCell(table: EditorTable, value: number | string | string[] | undefined, columnIndex: number, width: string, height: string) {
        const cell = document.createElement('div');
        cell.classList.add('editor-table-cell');
        cell.dataset.col = String(columnIndex);
        // 幅と高さを直接スタイルに設定
        EditorTable.applyCellWidth(cell, width);
        EditorTable.applyCellHeight(cell, height);
        cell.addEventListener('dblclick', () => {
            // パディングセルへの編集を拒否
            const pos = EditorTable.getCellPosition(cell, table.element);
            if (pos && table.isPaddingCell(pos.row, pos.column)) {
                table.showRejectionFeedback();
                return;
            }
            // 参照列の場合はドロップダウンを表示
            table.handler.enableCellEditModeWithDropdownAsync(true).then((handled) => {
                if (!handled) {
                    // ドロップダウンで処理されなかった場合は通常の編集モード
                    table.handler.enableCellEditMode(true);
                }
            });
        });
        cell.addEventListener('mousedown', (e) => {
            const position = EditorTable.getCellPosition(cell, table.element);
            if (!position) return;

            table.handler.submitAndHide();

            if (e.shiftKey) {
                // Shift+クリック: 現在のアンカーから連続選択
                table.selection.extendSelection(position.row, position.column);
            } else {
                // 通常クリック: セルを選択
                table.selection.start(position.row, position.column);
            }
        });
        cell.addEventListener('contextmenu', (e) => {
            const position = EditorTable.getCellPosition(cell, table.element);
            if (!position) return;
            const pkValue = table.getRowPkValue(position.row);
            if (pkValue === '') return;
            const entries = table.getReverseReferenceEntries(pkValue);
            if (entries.length === 0) return;

            e.preventDefault();
            e.stopPropagation();

            // ドラグ状態をリセット
            table.selection.end();

            table.contextMenu.show(e.clientX, e.clientY, [{
                label: '参照箇所を表示',
                action: () => {
                    table.sidebar.showReferences(pkValue, entries);
                },
            }]);
        });
        cell.textContent = value as any;
        return cell;
    }

    public static getCellPosition(cell: HTMLElement, tableElement: HTMLElement): CellPosition | null {
        let row: number = -1;
        for (let i = 0; i < tableElement.children.length; ++i) {
            if (tableElement.children[i] === cell.parentElement) {
                row = i;
                break;
            }
        }
        if (row === -1) return null;

        let column: number = -1;
        for (let i = 0; i < tableElement.children[row].children.length; ++i) {
            if (tableElement.children[row].children[i] === cell) {
                column = i;
                break;
            }
        }
        if (column === -1) return null;

        return {row, column};
    }

    /**
     * 列ヘッダーのクリックハンドラを生成する
     */
    private createColumnHeaderClickHandler(
        columnHeaderCell: HTMLElement
    ): (e: MouseEvent) => void {
        return (e: MouseEvent) => {
            // 左クリック以外は無視
            if (e.button !== 0) {
                return;
            }

            this.handler.submitAndHide();

            const clickedColumnIndex = parseInt(
                columnHeaderCell.dataset.col!
            ) + 1;

            if (e.shiftKey) {
                this.selection.extendToColumn(
                    clickedColumnIndex
                );
            } else if (e.ctrlKey || e.metaKey) {
                this.selection.addColumn(
                    clickedColumnIndex
                );
            } else {
                this.selection.selectColumn(
                    clickedColumnIndex
                );
            }
        };
    }

    /**
     * 列ヘッダーのコンテキストメニューハンドラ
     * 複数列選択時は選択列数分の挿入・削除に対応
     */
    private createColumnHeaderContextMenuHandler(
        columnHeaderCell: HTMLElement
    ): (e: MouseEvent) => void {
        return (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();

            const contextMenuColumnIndex = parseInt(
                columnHeaderCell.dataset.col!
            );
            const contextMenuSelectionColumnIndex =
                contextMenuColumnIndex + 1;

            // 選択範囲を取得
            const selRange =
                this.selection.getSelectionRange();

            // 列全体が選択されているか判定
            // （行範囲がテーブル全高さか確認）
            const lastRow = this.getRowCount() - 1;
            const isColumnSelection =
                selRange.startRow === 1
                && selRange.endRow === lastRow;

            // 右クリックした列が選択範囲内か判定
            const isInSelection =
                contextMenuSelectionColumnIndex
                    >= selRange.startColumn
                && contextMenuSelectionColumnIndex
                    <= selRange.endColumn;

            // 列全体選択かつ範囲内の場合のみ
            // 複数列操作とする
            const useSelectedColumns =
                isColumnSelection && isInSelection;

            // 複数列選択時の列情報を計算
            const columnCount = useSelectedColumns
                ? selRange.endColumn
                    - selRange.startColumn + 1
                : 1;
            const startColumnIndex =
                useSelectedColumns
                ? selRange.startColumn - 1
                : contextMenuColumnIndex;
            const endColumnIndex =
                useSelectedColumns
                ? selRange.endColumn - 1
                : contextMenuColumnIndex;

            // 選択範囲外の右クリック時は
            // 対象列を選択する
            if (!useSelectedColumns) {
                this.selection.selectColumn(
                    contextMenuSelectionColumnIndex
                );
            }
            // コンテキストメニュー表示はドラグ操作ではないため、
            // ドラグ状態フラグをリセットする
            this.selection.end();

            // ラベルを列数に応じて変更
            const insertLeftLabel = columnCount > 1
                ? `左に${columnCount}列を挿入`
                : '左に列を挿入';
            const insertRightLabel = columnCount > 1
                ? `右に${columnCount}列を挿入`
                : '右に列を挿入';
            const deleteLabel = columnCount > 1
                ? `${columnCount}列を削除`
                : '列を削除';

            const menuItems:
                ContextMenuEntry[] = [
                {
                    label: insertLeftLabel,
                    action: () => {
                        this.insertColumns(
                            startColumnIndex,
                            columnCount
                        );
                    }
                },
                {
                    label: insertRightLabel,
                    action: () => {
                        this.insertColumns(
                            endColumnIndex + 1,
                            columnCount
                        );
                    }
                },
                {
                    label: deleteLabel,
                    action: () => {
                        this.removeColumns(
                            startColumnIndex,
                            columnCount
                        );
                    }
                }
            ];

            // ビューコンテキストがある場合
            if (this.viewContext) {
                // 列を非表示メニュー
                menuItems.push({ separator: true });
                menuItems.push({
                    label: '列を非表示',
                    action: () => {
                        this.hideViewColumn(contextMenuColumnIndex);
                    },
                });

                // 非表示列を表示メニュー（非表示列がある場合のみ）
                const hiddenCols = this.viewContext.viewDefinition.columns.filter(c => c.hidden);
                for (const col of hiddenCols) {
                    menuItems.push({
                        label: '表示: ' + col.tableName + '.' + col.columnName,
                        action: () => {
                            this.showHiddenViewColumn(col.tableName, col.columnName);
                        },
                    });
                }

                // Join項目を追加
                const joinItems =
                    this.buildJoinMenuItems(
                        contextMenuColumnIndex
                    );
                if (joinItems.length > 0) {
                    menuItems.push(
                        { separator: true }
                    );
                    for (
                        const item of joinItems
                    ) {
                        menuItems.push(item);
                    }
                }
            }

            this.contextMenu.show(
                e.clientX,
                e.clientY,
                menuItems
            );
        };
    }

    /**
     * Join用メニュー項目を構築する
     * 既にJoin済みのテーブルは除外する
     */
    private buildJoinMenuItems(
        columnIndex: number
    ): ContextMenuEntry[] {
        if (!this.viewContext) return [];

        const items: ContextMenuEntry[] = [];
        const joinedTables = new Set(
            this.viewContext.viewDefinition.joins
                .map(j => j.targetTable)
        );

        for (
            const target
            of this.viewContext
                .availableJoinTargets
        ) {
            // 既にJoin済みなら表示しない
            if (
                joinedTables.has(
                    target.targetTableName
                )
            ) {
                continue;
            }

            items.push({
                label: 'Join: '
                    + target.targetTableName
                    + ' (via '
                    + target.sourceColumnName
                    + ')',
                action: () => {
                    this.viewContext!.onJoinAsync(
                        target.targetTableName,
                        target.sourceColumnName,
                        columnIndex
                    );
                },
            });
        }

        return items;
    }

    /**
     * ビュー列を非表示にする（ViewHideColumnCommandを実行）
     */
    private hideViewColumn(columnIndex: number): void {
        if (!this.viewContext) throw new Error('viewContextが未設定');
        const command = new ViewHideColumnCommand(
            this, this.viewContext.viewDefinition,
            this.viewContext.columnMappings, this.viewContext.rowMetadata,
            columnIndex
        );
        const anchor = this.selection.getAnchor();
        const copyRange = this.selection.getCopyRange();
        this.history.executeCommand(command, {
            startRow: anchor.row, startColumn: anchor.column,
            endRow: anchor.row, endColumn: anchor.column,
        }, copyRange);
    }

    /**
     * 非表示列を再表示する（viewDefinition.columnsのhiddenをfalseに変更してビューを再構築）
     */
    private showHiddenViewColumn(tableName: string, columnName: string): void {
        if (!this.viewContext) throw new Error('viewContextが未設定');
        this.viewContext.onShowHiddenColumn(tableName, columnName);
    }

    private createColumnHeaderCell(
        text: string,
        columnIndex: number,
        width: string
    ): HTMLElement {
        const columnHeaderCell =
            document.createElement('div');
        columnHeaderCell.classList.add(
            'editor-table-cell',
            'editor-table-column-header'
        );
        columnHeaderCell.textContent = text;
        columnHeaderCell.dataset.columnIndex =
            String(columnIndex);
        columnHeaderCell.dataset.col =
            String(columnIndex);
        EditorTable.applyCellWidth(
            columnHeaderCell, width
        );
        EditorTable.applyCellHeight(
            columnHeaderCell, DEFAULT_ROW_HEIGHT
        );

        // 列ヘッダークリックで列全体を選択
        columnHeaderCell.addEventListener(
            'mousedown',
            this.createColumnHeaderClickHandler(
                columnHeaderCell
            )
        );

        // 列ヘッダー右クリックでコンテキストメニュー
        columnHeaderCell.addEventListener(
            'contextmenu',
            this.createColumnHeaderContextMenuHandler(
                columnHeaderCell
            )
        );

        const resizeHandle =
            document.createElement('div');
        resizeHandle.classList.add('column-resize-handle');
        this.areaResizer.setupColumnResizeHandle(
            resizeHandle,
            columnHeaderCell,
            columnIndex
        );
        columnHeaderCell.appendChild(resizeHandle);

        return columnHeaderCell;
    }

    /**
     * 行ヘッダーのクリックハンドラを生成する
     * 右クリック時に選択範囲内であれば選択を保持する
     */
    private createRowHeaderClickHandler(
        rowHeaderCell: HTMLElement
    ): (e: MouseEvent) => void {
        return (e: MouseEvent) => {
            // 左クリック以外は無視
            if (e.button !== 0) {
                return;
            }

            this.handler.submitAndHide();

            const clickedRowIndex = parseInt(
                rowHeaderCell.dataset.rowIndex!
            ) + 1;

            if (e.shiftKey) {
                this.selection.extendToRow(
                    clickedRowIndex
                );
            } else if (e.ctrlKey || e.metaKey) {
                this.selection.addRow(clickedRowIndex);
            } else {
                this.selection.selectRow(
                    clickedRowIndex
                );
            }
        };
    }

    /**
     * 行ヘッダーのコンテキストメニューハンドラ
     * 複数行選択時は選択行数分の挿入・削除に対応
     */
    private createRowHeaderContextMenuHandler(
        rowHeaderCell: HTMLElement
    ): (e: MouseEvent) => void {
        return (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();

            const contextMenuRowIndex = parseInt(
                rowHeaderCell.dataset.rowIndex!
            ) + 1;

            // 選択範囲を取得
            const selRange =
                this.selection.getSelectionRange();

            // 行全体が選択されているか判定
            // （カラム範囲がテーブル全幅か確認）
            const lastColumn =
                this.getTotalColumnCount() - 1;
            const isRowSelection =
                selRange.startColumn === 1
                && selRange.endColumn === lastColumn;

            // 右クリックした行が選択範囲内か判定
            const isInSelection =
                contextMenuRowIndex
                    >= selRange.startRow
                && contextMenuRowIndex
                    <= selRange.endRow;

            // 行全体選択かつ範囲内の場合のみ
            // 複数行操作とする
            const useSelectedRows =
                isRowSelection && isInSelection;

            // 複数行選択時の行数を計算
            const rowCount = useSelectedRows
                ? selRange.endRow
                    - selRange.startRow + 1
                : 1;
            const startRow = useSelectedRows
                ? selRange.startRow
                : contextMenuRowIndex;
            const endRow = useSelectedRows
                ? selRange.endRow
                : contextMenuRowIndex;

            // 選択範囲外の右クリック時は
            // 対象行を選択する
            if (!useSelectedRows) {
                this.selection.selectRow(
                    contextMenuRowIndex
                );
            }
            // コンテキストメニュー表示はドラグ操作ではないため、
            // ドラグ状態フラグをリセットする
            this.selection.end();

            // ラベルを行数に応じて変更
            const insertAboveLabel = rowCount > 1
                ? `上に${rowCount}行を挿入`
                : '上に行を挿入';
            const insertBelowLabel = rowCount > 1
                ? `下に${rowCount}行を挿入`
                : '下に行を挿入';
            const deleteLabel = rowCount > 1
                ? `${rowCount}行を削除`
                : '行を削除';

            this.contextMenu.show(
                e.clientX, e.clientY, [
                {
                    label: insertAboveLabel,
                    action: () => {
                        this.insertRows(
                            startRow, rowCount
                        );
                    }
                },
                {
                    label: insertBelowLabel,
                    action: () => {
                        this.insertRows(
                            endRow + 1, rowCount
                        );
                    }
                },
                {
                    label: deleteLabel,
                    action: () => {
                        this.removeRows(
                            startRow, rowCount
                        );
                    }
                }
            ]);
        };
    }

    private createRowHeaderCell(
        text: string,
        rowIndex: number
    ): HTMLElement {
        const rowHeaderCell =
            document.createElement('div');
        rowHeaderCell.classList.add(
            'editor-table-cell',
            'editor-table-row-header'
        );
        rowHeaderCell.textContent = text;
        rowHeaderCell.dataset.rowIndex =
            String(rowIndex);
        EditorTable.applyCellHeight(
            rowHeaderCell, DEFAULT_ROW_HEIGHT
        );

        // 行ヘッダークリックで行全体を選択
        rowHeaderCell.addEventListener(
            'mousedown',
            this.createRowHeaderClickHandler(
                rowHeaderCell
            )
        );

        // 行ヘッダー右クリックでコンテキストメニュー
        rowHeaderCell.addEventListener(
            'contextmenu',
            this.createRowHeaderContextMenuHandler(
                rowHeaderCell
            )
        );

        const resizeHandle =
            document.createElement('div');
        resizeHandle.classList.add('row-resize-handle');
        this.areaResizer.setupRowResizeHandle(
            resizeHandle, rowHeaderCell, rowIndex + 1
        );
        rowHeaderCell.appendChild(resizeHandle);

        return rowHeaderCell;
    }

    /**
     * 列を削除する（Undo用）
     */
    public deleteColumn(columnIndex: number): void {
        const columnHeaderRow = this.element.children[0];
        const totalColumns = columnHeaderRow.children.length - 1;

        // 削除前に既存のラベルをDOMから取得
        const existingLabels: string[] = [];
        for (let i = 1; i < columnHeaderRow.children.length; ++i) {
            const headerCell = columnHeaderRow.children[i] as HTMLElement;
            let label = '';
            for (const node of Array.from(headerCell.childNodes)) {
                if (node.nodeType === Node.TEXT_NODE) {
                    label = node.textContent || '';
                    break;
                }
            }
            existingLabels.push(label);
        }

        // 各行から指定位置のセルを削除
        for (let rowIdx = 0; rowIdx < this.element.children.length; ++rowIdx) {
            const row = this.element.children[rowIdx] as HTMLElement;
            // columnIndex + 1 は行ヘッダーを除いた位置
            const cellToRemove = row.children[columnIndex + 1];
            if (cellToRemove) {
                cellToRemove.remove();
            }

            // 列ヘッダー行の場合、ラベルを更新
            if (rowIdx === 0) {
                for (let i = 0; i < totalColumns - 1; ++i) {
                    const headerCell = row.children[i + 1] as HTMLElement;
                    headerCell.dataset.columnIndex = String(i);
                    headerCell.dataset.col = String(i);
                    // 削除位置を考慮してラベルを決定（DOMから取得したラベルを使用）
                    // i < columnIndex: 元の位置のラベル
                    // i >= columnIndex: 元の位置+1のラベル（削除によりずれた）
                    let label = '';
                    if (i < columnIndex) {
                        label = existingLabels[i] || '';
                    } else {
                        label = existingLabels[i + 1] || '';
                    }

                    let textNode: Text | undefined;
                    for (const node of Array.from(headerCell.childNodes)) {
                        if (node.nodeType === Node.TEXT_NODE) {
                            textNode = node as Text;
                            break;
                        }
                    }

                    if (textNode) {
                        textNode.textContent = label;
                    } else {
                        headerCell.insertBefore(document.createTextNode(label), headerCell.firstChild);
                    }

                    // リサイズハンドルのイベントハンドラを再設定
                    const existingResizeHandle = headerCell.querySelector('.column-resize-handle');
                    if (existingResizeHandle) {
                        existingResizeHandle.remove();
                    }
                    const newResizeHandle = document.createElement('div');
                    newResizeHandle.classList.add('column-resize-handle');
                    this.areaResizer.setupColumnResizeHandle(newResizeHandle, headerCell, i);
                    headerCell.appendChild(newResizeHandle);
                }
            } else {
                // data-colを更新
                for (let i = columnIndex; i < row.children.length - 1; ++i) {
                    const cell = row.children[i + 1] as HTMLElement;
                    cell.dataset.col = String(i);
                }
            }
        }

        // コピー範囲をクリア（列構造が変わったため）
        this.selection.clearCopyRange();
        // 選択範囲の描画を更新（ヘッダーの背景色を正しく表示するため）
        this.selection.updateRendererAfterResize();
    }

    /**
     * 行を削除する（Undo用）
     */
    public deleteRow(rowIndex: number): void {
        // 指定位置の行を削除
        const rowToRemove = this.element.children[rowIndex];
        if (rowToRemove) {
            rowToRemove.remove();
        }

        // 後続の行のdata-rowと行ヘッダーの番号を更新
        for (let i = rowIndex; i < this.element.children.length; ++i) {
            const row = this.element.children[i] as HTMLElement;
            row.dataset.row = String(i);
            const header = row.children[0] as HTMLElement;
            if (header.classList.contains('editor-table-row-header')) {
                // テキストノードを更新（リサイズハンドルは保持）
                let textNode: Text | undefined;
                for (const node of Array.from(header.childNodes)) {
                    if (node.nodeType === Node.TEXT_NODE) {
                        textNode = node as Text;
                        break;
                    }
                }
                if (textNode) {
                    textNode.textContent = String(i);
                } else {
                    header.insertBefore(document.createTextNode(String(i)), header.firstChild);
                }
                header.dataset.rowIndex = String(i - 1);

                // リサイズハンドルのイベントハンドラを再設定
                const resizeHandle = header.querySelector('.row-resize-handle');
                if (resizeHandle) {
                    resizeHandle.remove();
                }
                const newResizeHandle = document.createElement('div');
                newResizeHandle.classList.add('row-resize-handle');
                this.areaResizer.setupRowResizeHandle(newResizeHandle, header, i);
                header.appendChild(newResizeHandle);
            }
        }

        // コピー範囲をクリア（行構造が変わったため）
        this.selection.clearCopyRange();
        // 選択範囲の描画を更新（ヘッダーの背景色を正しく表示するため）
        this.selection.updateRendererAfterResize();
    }

    /**
     * グローバルイベントリスナーを登録する（タブがアクティブになったとき）
     */
    activate(): void {
        this.selectionDragController.activate();
        this.scrollBinding.activate();
    }

    /**
     * グローバルイベントリスナーを解除する（タブが非アクティブになったとき）
     */
    deactivate(): void {
        this.selectionDragController.deactivate();
        this.scrollBinding.deactivate();
    }

    onScroll(): void {
        this.updateRowHeaderSticky();
    }

    private updateRowHeaderSticky(): void {
        const offset = this.scrollBinding.getScrollLeft();
        if (offset === this.lastScrollLeft) return;
        this.lastScrollLeft = offset;

        const rowHeaders = this.element.querySelectorAll('.editor-table-row-header, .editor-table-corner-cell') as NodeListOf<HTMLElement>;
        if (rowHeaders.length === 0) return;
        for (const header of Array.from(rowHeaders)) {
            header.style.position = 'relative';
            header.style.left = `${offset}px`;
            header.style.transform = '';
            header.style.zIndex = '20';
            header.style.overflow = 'visible';
        }
    }

    stopAutoScrollForInput(): void {
        this.selectionDragController.stopAutoScrollForInput();
    }

    /**
     * 指定列の幅を取得（列ヘッダーセルから取得）
     */
    getColumnWidth(columnIndex: number): string {
        const columnHeaderRow = this.element.children[0];
        const headerCell = columnHeaderRow.children[columnIndex + 1] as HTMLElement;
        return headerCell.style.width || DEFAULT_COLUMN_WIDTH;
    }

    /**
     * 全列の幅を配列で取得する
     */
    getColumnWidths(): string[] {
        const widths: string[] = [];
        const columnCount = this.getColumnCount();
        for (let i = 0; i < columnCount; i++) {
            widths.push(this.getColumnWidth(i));
        }
        return widths;
    }

    /**
     * 指定列の幅を設定し、その列の全セルのスタイルを更新
     */
    setColumnWidth(columnIndex: number, width: string): void {
        // 全行の該当列セルのスタイルを更新
        for (let i = 0; i < this.element.children.length; ++i) {
            const row = this.element.children[i] as HTMLElement;
            // columnIndex + 1: 行ヘッダーを除く
            const cell = row.children[columnIndex + 1] as HTMLElement;
            if (cell) {
                EditorTable.applyCellWidth(cell, width);
            }
        }
    }

    /**
     * 指定行の高さを取得（その行の最初のセルから取得）
     */
    getRowHeight(rowIndex: number): string {
        const row = this.element.children[rowIndex] as HTMLElement;
        const cell = row.children[0] as HTMLElement;
        return cell.style.height || DEFAULT_ROW_HEIGHT;
    }

    /**
     * 指定行の高さを設定し、その行の全セルのスタイルを更新
     */
    setRowHeight(rowIndex: number, height: string): void {
        // 該当行の全セルのスタイルを更新
        const row = this.element.children[rowIndex] as HTMLElement;
        if (row) {
            for (let i = 0; i < row.children.length; ++i) {
                const cell = row.children[i] as HTMLElement;
                EditorTable.applyCellHeight(cell, height);
            }
        }
    }

    /**
     * セルに幅のスタイルを適用
     */
    static applyCellWidth(cell: HTMLElement, width: string): void {
        cell.style.width = width;
        cell.style.minWidth = width;
        cell.style.maxWidth = width;
    }

    /**
     * セルに高さのスタイルを適用
     */
    static applyCellHeight(cell: HTMLElement, height: string): void {
        cell.style.height = height;
        cell.style.minHeight = height;
        cell.style.maxHeight = height;
        cell.style.lineHeight = height;
    }

    /**
     * セルの値を取得する（参照ヒント・折りたたみトグルを除外）
     */
    static getCellValue(cell: HTMLElement): string {
        // .cell-value 要素があればそこから取得
        const valueElement = cell.querySelector('.cell-value');
        if (valueElement) {
            return valueElement.textContent ?? '';
        }
        // ヒント要素やトグル要素がある場合、直下のテキストノードのみを結合して返す
        const hasChildElements = cell.querySelector(
            '.cell-reference-hint, .cell-reverse-reference-hint, .view-collapse-toggle'
        );
        if (hasChildElements) {
            let text = '';
            for (const node of Array.from(cell.childNodes)) {
                if (node.nodeType === Node.TEXT_NODE) {
                    text += node.textContent ?? '';
                }
            }
            return text;
        }
        // そうでなければ textContent をそのまま返す
        return cell.textContent ?? '';
    }

    /**
     * 座標からセル要素を取得する
     * @param row 行インデックス（0始まり、列ヘッダー行を含む）
     * @param column 列インデックス（0始まり、行ヘッダーセルを含む）
     * @returns セル要素。存在しない場合はnullを投げる
     */
    private getCell(row: number, column: number): HTMLElement {
        const rowElement = this.element.children[row] as HTMLElement;
        if (!rowElement) {
            throw new Error(`行が見つかりません: row=${row}`);
        }
        const cell = rowElement.children[column] as HTMLElement;
        if (!cell) {
            throw new Error(`セルが見つかりません: row=${row}, column=${column}`);
        }
        return cell;
    }

    /**
     * 座標でセルの値を設定する（参照ヒント付き）
     * @param row 行インデックス（0始まり、列ヘッダー行を含む）
     * @param column 列インデックス（0始まり、行ヘッダーセルを含む）
     * @param value セルの値
     */
    setCellValueAt(row: number, column: number, value: string): void {
        const cell = this.getCell(row, column);
        const dataColumnIndex = column - 1;
        this.setCellValue(cell, value, dataColumnIndex, row);

        // 変更された列に依存する動的参照列のヒントを再評価する（二段リスト対応）
        this.updateDependentColumnsInRow(row, dataColumnIndex);

        // 表示列の変更時に同一行の参照ヒントを同期更新する（逆参照チェーン対応）
        this.updateReferenceHintsOnDisplayColumnChange(row, dataColumnIndex, value);
    }

    /**
     * セルの値を設定する（参照ヒント付き）
     * @param cell セル要素
     * @param value セルの値
     * @param dataColumnIndex データ列のインデックス（0始まり）
     * @param rowIndex 行インデックス（動的参照の解決に使用）
     */
    setCellValue(cell: HTMLElement, value: string, dataColumnIndex: number, rowIndex: number): void {
        // 既存の参照ヒントを削除
        const existingHint = cell.querySelector('.cell-reference-hint');
        if (existingHint) {
            existingHint.remove();
        }

        // 既存の逆参照ヒントを削除
        const existingReverseHint = cell.querySelector('.cell-reverse-reference-hint');
        if (existingReverseHint) {
            existingReverseHint.remove();
        }

        // 折りたたみトグルを一時的に退避（textContent設定で消えないようにする）
        const toggle = cell.querySelector('.view-collapse-toggle');
        if (toggle) toggle.remove();

        // 参照列かどうかを判定
        const column = this.tableData.header[dataColumnIndex];
        if (!column || !column.reference) {
            // 参照列でなければ通常のテキストコンテンツを設定
            cell.textContent = value;

            // PK列の場合は逆参照ヒントを再適用
            if (column
                && column.name === config.primaryKeyColumnName) {
                this.applyReverseReferenceHint(
                    cell, value
                );
            }
            // トグルを復元
            if (toggle) cell.insertBefore(toggle, cell.firstChild);
            return;
        }

        // 値を設定
        cell.textContent = value;

        // 参照式をパース
        const expr = parseReferenceExpression(column.reference);

        if (isDynamicReference(expr)) {
            // 動的参照の場合: 非同期で参照ヒントを更新
            this.updateDynamicReferenceHintAsync(cell, value, expr, rowIndex);
            if (toggle) cell.insertBefore(toggle, cell.firstChild);
            return;
        }

        // 単純参照の場合: 同期的に参照ヒントを取得
        const displayText = this.referenceDataCache.getDisplayTextById(expr.tableName, value);

        // 参照ヒントを追加（表示テキストがある場合のみ）
        if (displayText) {
            const hintSpan = document.createElement('span');
            hintSpan.classList.add('cell-reference-hint');
            hintSpan.textContent = displayText;
            cell.appendChild(hintSpan);
        }
        // トグルを復元
        if (toggle) cell.insertBefore(toggle, cell.firstChild);
    }

    /**
     * 動的参照の参照ヒントを非同期で更新する
     */
    private updateDynamicReferenceHintAsync(
        cell: HTMLElement,
        value: string,
        expr: ReturnType<typeof parseReferenceExpression>,
        rowIndex: number
    ): void {
        if (!isDynamicReference(expr)) return;

        // 同一行の指定カラムの値を取得
        const valueColumnIndex = this.tableData.header.findIndex(col => col.name === expr.filter.valueColumn);
        if (valueColumnIndex === -1) return;

        // column=0は行ヘッダーなので、データ列インデックスに+1する
        const filterValue = this.getCellValueAt(rowIndex, valueColumnIndex + 1);
        if (filterValue === '') return;

        // フィルタテーブルからテーブル名を取得
        this.referenceDataCache.getFullDataAsync(expr.filter.tableName).then(fullData => {
            const lookupColumnIndex = fullData.header.indexOf(expr.lookupColumn);
            if (lookupColumnIndex === -1) return;

            // filterColumn で行を検索（主キー以外のカラムにも対応）
            const row = this.referenceDataCache.findRowByColumn(fullData, expr.filter.filterColumn, filterValue);
            if (!row) return;

            const targetTableName = row[lookupColumnIndex];
            if (targetTableName === '') return;

            // 参照先テーブルの表示テキストを取得
            const displayText = this.referenceDataCache.getDisplayTextById(targetTableName, value);
            if (!displayText) {
                // キャッシュにない場合は非同期で取得
                this.referenceDataCache.get(targetTableName).then(() => {
                    const resolvedDisplayText = this.referenceDataCache.getDisplayTextById(targetTableName, value);
                    if (resolvedDisplayText) {
                        this.appendReferenceHint(cell, resolvedDisplayText);
                    }
                }).catch(() => {
                    // 取得失敗時は何もしない
                });
                return;
            }

            this.appendReferenceHint(cell, displayText);
        }).catch(() => {
            // 取得失敗時は何もしない
        });
    }

    /**
     * セルに参照ヒントを追加する（既存のヒントは削除）
     */
    private appendReferenceHint(cell: HTMLElement, displayText: string): void {
        // 既存の参照ヒントを削除
        const existingHint = cell.querySelector('.cell-reference-hint');
        if (existingHint) {
            existingHint.remove();
        }

        const hintSpan = document.createElement('span');
        hintSpan.classList.add('cell-reference-hint');
        hintSpan.textContent = displayText;
        cell.appendChild(hintSpan);
    }

    /**
     * セルに逆参照ヒントを適用する
     * 逆参照マップにエントリがあればヒントspanを追加し、
     * なければ既存のヒントを削除する
     */
    private applyReverseReferenceHint(
        cell: HTMLElement,
        pkValue: string
    ): void {
        // 既存の逆参照ヒントを削除
        const existing = cell.querySelector(
            '.cell-reverse-reference-hint'
        );
        if (existing) {
            existing.remove();
        }

        if (!this.reverseReferenceMap) return;
        if (pkValue === '') return;

        const entries =
            this.reverseReferenceMap.get(pkValue);
        if (!entries || entries.length === 0) return;

        const hintText =
            formatReverseReferenceHint(entries);
        if (hintText === '') return;

        const hintSpan =
            document.createElement('span');
        hintSpan.classList.add(
            'cell-reverse-reference-hint'
        );
        hintSpan.textContent = hintText;
        cell.appendChild(hintSpan);
    }

    /**
     * 変更された列に依存する動的参照列のヒントを同一行内で再評価する
     * Excelの二段リストと同様に、親列の変更で子列の参照先を切り替える
     */
    private updateDependentColumnsInRow(rowIndex: number, changedDataColumnIndex: number): void {
        const changedColumnName = this.tableData.header[changedDataColumnIndex]?.name;
        if (!changedColumnName) return;

        const rowElement = this.element.children[rowIndex] as HTMLElement;
        for (let colIdx = 0; colIdx < this.tableData.header.length; colIdx++) {
            if (colIdx === changedDataColumnIndex) continue;

            const column = this.tableData.header[colIdx];
            if (!column.reference) continue;

            const expr = parseReferenceExpression(column.reference);
            if (!isDynamicReference(expr)) continue;

            // この動的参照が変更された列を参照元としているか確認
            if (expr.filter.valueColumn !== changedColumnName) continue;

            // 依存しているセルのヒントを再評価する
            const cell = rowElement.children[colIdx + 1] as HTMLElement;
            if (cell) {
                const cellValue = EditorTable.getCellValue(cell);
                this.setCellValue(cell, cellValue, colIdx, rowIndex);
            }
        }
    }

    /**
     * 表示列の値が変更されたとき、同一行の参照列ヒントを更新する
     *
     * 2つのケースに対応する:
     * 1. ビューJOIN列: JOIN元テーブルの表示列が編集されたとき、
     *    同じテーブルを参照するFK列のヒントを更新する
     * 2. 通常テーブル（逆参照チェーン）: 表示列の値が変更されたとき、
     *    逆参照チェーンで解決されたヒントを更新する
     */
    private updateReferenceHintsOnDisplayColumnChange(rowIndex: number, changedDataColumnIndex: number, newValue: string): void {
        const changedColumn = this.tableData.header[changedDataColumnIndex];
        if (!changedColumn) return;

        // ビューのJOIN列の場合: JOIN元テーブルのキャッシュを更新し、同テーブル参照列のヒントを再描画
        if (this.viewContext) {
            const mapping = this.viewContext.columnMappings[changedDataColumnIndex];
            if (mapping.isJoinedColumn) {
                // JOINされた列の実際の列名が表示列でなければスキップ
                if (!config.referenceDisplayColumnPriority.includes(mapping.sourceColumnName)) return;

                // JOINキーの値を取得（どのキャッシュエントリを更新するか特定するため）
                const baseKeyColumnIndex = this.viewContext.columnMappings.findIndex(
                    m => m.sourceColumnName === mapping.baseKeyColumn && !m.isJoinedColumn
                );
                if (baseKeyColumnIndex === -1) return;
                const joinKeyValue = this.getCellValueAt(rowIndex, baseKeyColumnIndex + 1);
                if (joinKeyValue === '') return;

                // JOIN元テーブルのキャッシュを更新
                this.referenceDataCache.updateDisplayText(mapping.tableName, joinKeyValue, newValue);

                // 同じテーブルを参照するFK列のヒントを再描画
                const rowElement = this.element.children[rowIndex] as HTMLElement;
                for (let colIdx = 0; colIdx < this.tableData.header.length; colIdx++) {
                    if (colIdx === changedDataColumnIndex) continue;
                    const column = this.tableData.header[colIdx];
                    if (!column.reference) continue;
                    const expr = parseReferenceExpression(column.reference);
                    if (!isSimpleReference(expr)) continue;
                    if (expr.tableName !== mapping.tableName) continue;
                    const cell = rowElement.children[colIdx + 1] as HTMLElement;
                    if (!cell) continue;
                    const fkValue = EditorTable.getCellValue(cell);
                    if (fkValue === '') continue;
                    this.setCellValue(cell, fkValue, colIdx, rowIndex);
                }
                return;
            }
        }

        // 通常テーブル（およびビューのベーステーブル列）: 逆参照チェーン対応
        // 変更された列が表示列でなければスキップ
        if (!config.referenceDisplayColumnPriority.includes(changedColumn.name)) return;

        const rowElement = this.element.children[rowIndex] as HTMLElement;
        for (let colIdx = 0; colIdx < this.tableData.header.length; colIdx++) {
            if (colIdx === changedDataColumnIndex) continue;

            const column = this.tableData.header[colIdx];
            if (!column.reference) continue;

            const expr = parseReferenceExpression(column.reference);
            if (!isSimpleReference(expr)) continue;

            // 参照先テーブルが自身の表示列を持つ場合は逆参照チェーン不使用なのでスキップ
            const refData = this.referenceDataCache.getSync(expr.tableName);
            if (!refData || refData.displayColumnName !== '') continue;

            const cell = rowElement.children[colIdx + 1] as HTMLElement;
            if (!cell) continue;
            const fkValue = EditorTable.getCellValue(cell);
            if (fkValue === '') continue;

            // キャッシュを更新し、ヒントを再描画
            this.referenceDataCache.updateDisplayText(expr.tableName, fkValue, newValue);
            this.setCellValue(cell, fkValue, colIdx, rowIndex);
        }
    }

    /**
     * 行数を取得する（列ヘッダー行を含む）
     */
    getRowCount(): number {
        return this.element.children.length;
    }

    /**
     * 列数を取得する（行ヘッダーセルを除く）
     */
    getColumnCount(): number {
        const headerRow = this.element.children[0];
        return headerRow.children.length - 1;
    }

    /**
     * 座標でセルの値を取得する（参照ヒントを除外）
     * @param row 行インデックス（0始まり、列ヘッダー行を含む）
     * @param column 列インデックス（0始まり、行ヘッダーセルを含む）
     */
    getCellValueAt(row: number, column: number): string {
        const cell = this.getCell(row, column);
        return EditorTable.getCellValue(cell);
    }

    /**
     * 列ヘッダーの値を取得する
     * @param columnIndex 列インデックス（0始まり、行ヘッダーセルを除く）
     */
    getColumnHeaderValue(columnIndex: number): string {
        const headerRow = this.element.children[0] as HTMLElement;
        const headerCell = headerRow.children[columnIndex + 1] as HTMLElement;
        // 列ヘッダーセルはTEXT_NODEとしてテキストを持つ（リサイズハンドル等の子要素がある）
        for (const node of Array.from(headerCell.childNodes)) {
            if (node.nodeType === Node.TEXT_NODE) {
                return node.textContent ?? '';
            }
        }
        return '';
    }

    /**
     * 列ヘッダーの値を設定する
     * @param columnIndex 列インデックス（0始まり、行ヘッダーセルを除く）
     * @param value 設定する値
     */
    setColumnHeaderValue(columnIndex: number, value: string): void {
        const headerRow = this.element.children[0] as HTMLElement;
        const headerCell = headerRow.children[columnIndex + 1] as HTMLElement;
        // 既存のTEXT_NODEを探して更新、なければ追加
        for (const node of Array.from(headerCell.childNodes)) {
            if (node.nodeType === Node.TEXT_NODE) {
                node.textContent = value;
                return;
            }
        }
        headerCell.insertBefore(document.createTextNode(value), headerCell.firstChild);
    }

    /**
     * 指定座標のセルのBoundingClientRectを取得する
     * @param row 行インデックス（0始まり、列ヘッダー行を含む）
     * @param column 列インデックス（0始まり、行ヘッダーセルを含む）
     */
    getCellRectAt(row: number, column: number): DOMRect {
        const cell = this.getCell(row, column);
        return cell.getBoundingClientRect();
    }

    /**
     * テキストフィールドの幅を計算する
     * 指定セルから右方向にセルの幅を合算し、テキスト幅が収まる幅を返す
     * @param row 行インデックス
     * @param column 列インデックス
     * @param textWidth テキストの幅（ピクセル）
     * @returns 計算された幅とセルの高さ
     */
    calculateTextFieldWidth(row: number, column: number, textWidth: number): { width: number; cellHeight: number } {
        const rowElement = this.element.children[row] as HTMLElement;
        const startCell = rowElement.children[column] as HTMLElement;
        const cellHeight = startCell.getBoundingClientRect().height;

        // 自分から右側にあるセルを結合する
        // box-sizing: border-boxなので、セルの幅をそのまま使用
        // テキスト幅との比較では、パディング(12px)とボーダー(2px)を考慮
        let width = 0;
        for (let i = column; i < rowElement.children.length; i++) {
            const cell = rowElement.children[i] as HTMLElement;
            width += cell.getBoundingClientRect().width;
            if (textWidth < width - 14) {
                break;
            }
        }

        return { width, cellHeight };
    }

    /**
     * テーブル要素のBoundingClientRectを取得する
     */
    getTableBoundingClientRect(): DOMRect {
        return this.element.getBoundingClientRect();
    }

    /**
     * セル要素から位置を取得する
     * @param cell セル要素
     * @returns セル位置。見つからない場合はnull
     */
    getCellPositionFromElement(cell: HTMLElement): CellPosition | null {
        return EditorTable.getCellPosition(cell, this.element);
    }

    /**
     * 行ヘッダーを含む全列数を取得する
     */
    getTotalColumnCount(): number {
        const headerRow = this.element.children[0];
        return headerRow.children.length;
    }

    /**
     * 座標でセルのBoundingClientRectを取得する（存在しない場合はnull）
     * @param row 行インデックス（0始まり、列ヘッダー行を含む）
     * @param column 列インデックス（0始まり、行ヘッダーセルを含む）
     */
    getCellRectOrNull(row: number, column: number): DOMRect | null {
        const rowElement = this.element.children[row] as HTMLElement | undefined;
        if (!rowElement) return null;
        const cell = rowElement.children[column] as HTMLElement | undefined;
        if (!cell) return null;
        return cell.getBoundingClientRect();
    }

    /**
     * 列ヘッダー行の高さを取得する
     */
    getFirstRowHeight(): number {
        const headerRow = this.element.children[0] as HTMLElement | undefined;
        if (!headerRow) return 0;
        return headerRow.getBoundingClientRect().height;
    }

    /**
     * 行ヘッダー（コーナーセル）の幅を取得する
     */
    getRowHeaderWidth(): number {
        const headerRow = this.element.children[0] as HTMLElement | undefined;
        const cornerCell = headerRow?.children[0] as HTMLElement | undefined;
        if (!cornerCell) return 0;
        return cornerCell.getBoundingClientRect().width;
    }

    /**
     * ヘッダーの選択状態を更新する
     * @param startRow 選択範囲の開始行
     * @param startColumn 選択範囲の開始列
     * @param endRow 選択範囲の終了行
     * @param endColumn 選択範囲の終了列
     */
    updateHeaderSelection(startRow: number, startColumn: number, endRow: number, endColumn: number): void {
        // 列ヘッダー行を取得
        const columnHeaderRow = this.element.children[0] as HTMLElement;

        // すべての列ヘッダーから選択状態を解除
        for (let i = 1; i < columnHeaderRow.children.length; i++) {
            const headerCell = columnHeaderRow.children[i] as HTMLElement;
            headerCell.classList.remove('selected');
        }

        // すべての行ヘッダーから選択状態を解除
        for (let i = 1; i < this.element.children.length; i++) {
            const row = this.element.children[i] as HTMLElement;
            const rowHeader = row.children[0] as HTMLElement;
            if (rowHeader.classList.contains('editor-table-row-header')) {
                rowHeader.classList.remove('selected');
            }
        }

        // 選択範囲に含まれる列ヘッダーに選択状態を追加
        for (let col = startColumn; col <= endColumn; col++) {
            const headerCell = columnHeaderRow.children[col] as HTMLElement;
            if (headerCell) {
                headerCell.classList.add('selected');
            }
        }

        // 選択範囲に含まれる行ヘッダーに選択状態を追加
        for (let row = startRow; row <= endRow; row++) {
            const rowElement = this.element.children[row] as HTMLElement;
            if (rowElement) {
                const rowHeader = rowElement.children[0] as HTMLElement;
                if (rowHeader.classList.contains('editor-table-row-header')) {
                    rowHeader.classList.add('selected');
                }
            }
        }
    }

    /**
     * 結合列の編集時に、同一JOINキーを持つ他の行の値を連動更新する
     *
     * JOINビューでは同じ結合テーブルの行が複数のビュー行に展開されるため、
     * 1つのセルを編集したら同じJOINキーを持つ全行の同列を更新する必要がある。
     *
     * @param editedRow 編集された行
     * @param editedColumn 編集された列（0始まり、行ヘッダー含む）
     * @param newValue 新しい値
     * @returns 連動更新された他行のセル変更リスト（Undo/Redo用）
     */
    synchronizeJoinedColumnValues(editedRow: number, editedColumn: number, newValue: string): CellChange[] {
        if (!this.viewContext) return [];

        const viewContext = this.viewContext;
        const columnMappings = viewContext.columnMappings;
        const dataColumnIndex = editedColumn - 1;
        if (dataColumnIndex < 0 || dataColumnIndex >= columnMappings.length) return [];

        const mapping = columnMappings[dataColumnIndex];

        // JOIN列が編集された場合: 同一JOINキーを持つ他行の同列を連動更新
        if (mapping.isJoinedColumn) {
            const baseKeyColumnIndex = columnMappings.findIndex(
                (m) => m.sourceColumnName === mapping.baseKeyColumn && !m.isJoinedColumn
            );
            if (baseKeyColumnIndex === -1) return [];

            const joinKeyValue = this.getCellValueAt(editedRow, baseKeyColumnIndex + 1);
            if (joinKeyValue === '') return [];

            const changes: CellChange[] = [];
            const rowCount = this.getRowCount();
            for (let r = 1; r < rowCount; r++) {
                if (r === editedRow) continue;
                const rowKeyValue = this.getCellValueAt(r, baseKeyColumnIndex + 1);
                if (rowKeyValue !== joinKeyValue) continue;
                const oldValue = this.getCellValueAt(r, editedColumn);
                if (oldValue === newValue) continue;
                changes.push({ row: r, column: editedColumn, oldValue, newValue });
                this.setCellValueAt(r, editedColumn, newValue);
            }
            return changes;
        }

        // FK列が編集された場合: 対応するJOIN列を新しい参照先の値でリフレッシュ
        const fkColumnName = mapping.sourceColumnName;

        // このFK列をbaseKeyColumnとするJOIN列のインデックスを収集
        const joinedColumnIndices: number[] = [];
        for (let i = 0; i < columnMappings.length; i++) {
            const m = columnMappings[i];
            if (m.isJoinedColumn && m.baseKeyColumn === fkColumnName) {
                joinedColumnIndices.push(i);
            }
        }
        if (joinedColumnIndices.length === 0) return [];

        // 戦略1: ビュー内で新しいFK値と同じ値を持つ別の行を検索（編集中の値を反映）
        const fkColumn = dataColumnIndex + 1;
        const rowCount = this.getRowCount();
        for (let r = 1; r < rowCount; r++) {
            if (r === editedRow) continue;
            if (this.getCellValueAt(r, fkColumn) === newValue) {
                return this.applyJoinedColumnValues(editedRow, joinedColumnIndices, (joinedDataIndex) => {
                    return this.getCellValueAt(r, joinedDataIndex + 1);
                });
            }
        }

        // 戦略2: ドナー行がない場合、結合テーブルのキーマップから直接ルックアップ
        return this.applyJoinedColumnValues(editedRow, joinedColumnIndices, (joinedDataIndex) => {
            const m = columnMappings[joinedDataIndex];
            const keyMap = viewContext.joinTableKeyMaps.get(m.tableName);
            if (!keyMap) return '';
            const joinRows = keyMap.get(newValue);
            if (!joinRows || joinRows.length === 0) return '';
            return joinRows[0][m.sourceColumnIndex];
        });
    }

    /**
     * JOIN列に値を適用し、変更リストを返す
     */
    private applyJoinedColumnValues(
        editedRow: number, joinedColumnIndices: number[],
        getValueForColumn: (joinedDataIndex: number) => string,
    ): CellChange[] {
        const changes: CellChange[] = [];
        for (const joinedDataIndex of joinedColumnIndices) {
            const joinedColumn = joinedDataIndex + 1;
            const newValue = getValueForColumn(joinedDataIndex);
            const oldValue = this.getCellValueAt(editedRow, joinedColumn);
            if (oldValue === newValue) continue;
            changes.push({ row: editedRow, column: joinedColumn, oldValue, newValue });
            this.setCellValueAt(editedRow, joinedColumn, newValue);
        }
        return changes;
    }

    /**
     * 指定された列範囲に結合列が含まれるかを判定する
     *
     * @param startColumn 開始列（0始まり、行ヘッダー含む）
     * @param endColumn 終了列（0始まり、行ヘッダー含む）
     * @returns 結合列が含まれる場合はtrue
     */
    containsJoinedColumn(startColumn: number, endColumn: number): boolean {
        if (!this.viewContext) return false;

        for (let c = startColumn; c <= endColumn; c++) {
            const dataColumnIndex = c - 1;
            if (dataColumnIndex < 0 || dataColumnIndex >= this.viewContext.columnMappings.length) continue;
            if (this.viewContext.columnMappings[dataColumnIndex].isJoinedColumn) return true;
        }

        return false;
    }

    /**
     * 指定セルがパディングセルかどうかを判定する
     * パディングセルは1:n展開で生成された重複データを非表示にしたセル
     *
     * @param row 行番号（1始まり、データ行）
     * @param column 列番号（0始まり、行ヘッダー含む）
     * @returns パディングセルの場合はtrue
     */
    isPaddingCell(row: number, column: number): boolean {
        if (!this.viewContext) return false;
        if (column === 0) return false;
        const metadataIndex = row - 1;
        const rowMetadata = this.viewContext.rowMetadata;
        if (metadataIndex < 0 || metadataIndex >= rowMetadata.length) return false;
        const dataColumnIndex = column - 1;
        if (dataColumnIndex < 0 || dataColumnIndex >= rowMetadata[metadataIndex].paddingColumns.length) return false;
        return rowMetadata[metadataIndex].paddingColumns[dataColumnIndex];
    }

    /**
     * 指定範囲にパディングセルが含まれるかを判定する
     */
    containsPaddingCell(startRow: number, startColumn: number, endRow: number, endColumn: number): boolean {
        if (!this.viewContext) return false;
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
     * 選択範囲に操作拒否のフィードバックアニメーションを表示する
     * 結合列への不正な操作（ペースト/削除/フィル）を視覚的に拒否する
     */
    showRejectionFeedback(): void {
        const selectionElement = this.selection.element;
        selectionElement.classList.add('selection-rejected');
        selectionElement.addEventListener('animationend', () => {
            selectionElement.classList.remove('selection-rejected');
        }, { once: true });
    }

    /**
     * データ領域の最大行を取得（データが入力されている最後の行）
     * row=0は列ヘッダーなので、データ行はrow=1から開始
     */
    getMaxDataRow(): number {
        // row=0は列ヘッダー、データ行はrow=1から
        const dataStartRow = 1;
        let maxRow = 0;

        for (let r = this.element.children.length - 1; r >= dataStartRow; r--) {
            const rowElement = this.element.children[r] as HTMLElement;
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

    // ---------------------------------------------------------
    // ビュー行の動的再構築（FK値変更時の1:n展開行数更新）
    // ---------------------------------------------------------

    /**
     * 編集されたセルがビューのJOINソース列であり、行数が変わるかを判定する
     *
     * @param editedRow DOM行インデックス（1始まり）
     * @param editedColumn DOM列インデックス（0始まり、行ヘッダー含む）
     * @param newValue 新しいFK値
     * @returns 行数が変わる場合はtrue
     */
    needsViewRowRestructure(editedRow: number, editedColumn: number, newValue: string): boolean {
        if (!this.viewContext) return false;
        const dataColumnIndex = editedColumn - 1;
        if (dataColumnIndex < 0 || dataColumnIndex >= this.viewContext.columnMappings.length) return false;
        const mapping = this.viewContext.columnMappings[dataColumnIndex];
        // JOIN列やパディングセルの編集は対象外
        if (mapping.isJoinedColumn) return false;
        // このベーステーブル列がJOINのソース列か判定
        const joinDef = this.viewContext.viewDefinition.joins.find(j => {
            const sourceTable = j.sourceTable === '' ? this.viewContext!.viewDefinition.baseTable : j.sourceTable;
            return sourceTable === mapping.tableName && j.sourceColumn === mapping.sourceColumnName;
        });
        if (!joinDef) return false;
        // 旧FK値と新FK値のマッチ行数を比較
        const keyMap = this.viewContext.joinTableKeyMaps.get(joinDef.targetTable);
        const oldValue = this.getCellValueAt(editedRow, editedColumn);
        // 値が同じなら変更なし
        if (oldValue === newValue) return false;
        const oldMatchCount = (keyMap && keyMap.has(oldValue)) ? (keyMap.get(oldValue) as string[][]).length : 0;
        const newMatchCount = (keyMap && keyMap.has(newValue)) ? (keyMap.get(newValue) as string[][]).length : 0;
        // 0件の場合はLEFT JOINで1行（空行）になるため実質1扱い
        const effectiveOld = Math.max(oldMatchCount, 1);
        const effectiveNew = Math.max(newMatchCount, 1);
        // 行数変化時は再構築が必要。行数が同じでも展開が2行以上の場合、FK値が変わればパディング行の内容が変わるため再構築が必要
        return effectiveOld !== effectiveNew || effectiveOld > 1;
    }

    /**
     * FK値変更に伴うビュー行の再構築を実行し、Undo/Redo用のCommandを返す
     *
     * @param editedRow DOM行インデックス（1始まり）
     * @param editedColumn DOM列インデックス（0始まり、行ヘッダー含む）
     * @param newValue 変更後のFK値
     * @returns 履歴に追加するCommand
     */
    buildAndExecuteViewRowRestructure(editedRow: number, editedColumn: number, newValue: string): Command {
        if (!this.viewContext) throw new Error('viewContextが未設定');
        const viewContext = this.viewContext;
        const columnMappings = viewContext.columnMappings;
        const dataColumnIndex = editedColumn - 1;
        const metaIndex = editedRow - 1;
        const baseRowIndex = viewContext.rowMetadata[metaIndex].baseRowIndex;

        // このベース行に属するメタデータ範囲を特定
        let metaStart = metaIndex;
        let metaEnd = metaIndex + 1;
        // 前方に同じbaseRowIndexの行を検索
        while (metaStart > 0 && viewContext.rowMetadata[metaStart - 1].baseRowIndex === baseRowIndex) {
            metaStart--;
        }
        // 後方に同じbaseRowIndexの行を検索
        while (metaEnd < viewContext.rowMetadata.length && viewContext.rowMetadata[metaEnd].baseRowIndex === baseRowIndex) {
            metaEnd++;
        }

        // 古い行を保存（DOMからデタッチ）
        // メタデータはsplice前にコピーするため、インデックスは先頭からずらして取得
        const domStartIndex = metaStart + 1;
        const oldRows: SavedViewRowState[] = [];
        for (let i = 0; i < metaEnd - metaStart; i++) {
            const domRow = this.element.children[domStartIndex] as HTMLElement;
            oldRows.push({ domRow, metadata: viewContext.rowMetadata[metaStart + i] });
            domRow.remove();
        }
        viewContext.rowMetadata.splice(metaStart, metaEnd - metaStart);

        // ベーステーブル列の値を構築（変更されたFK値を反映）
        const totalColumns = columnMappings.length;
        const baseColumnValues: string[] = new Array(totalColumns).fill('');
        const leaderDomRow = oldRows[0].domRow;
        for (let i = 0; i < totalColumns; i++) {
            if (i === dataColumnIndex) {
                baseColumnValues[i] = newValue;
            } else if (columnMappings[i].joinLevel === 0) {
                const cell = leaderDomRow.children[i + 1] as HTMLElement;
                baseColumnValues[i] = EditorTable.getCellValue(cell);
            }
        }

        // 新しい展開行データを計算
        const expandedRows = rebuildExpandedRowsForBaseRow(
            baseColumnValues, columnMappings, viewContext.viewDefinition, viewContext.joinTableKeyMaps
        );

        // 新しいDOM行を作成して挿入
        const newRows = this.buildAndInsertExpandedViewRows(metaStart, baseRowIndex, expandedRows);
        this.selection.clearCopyRange();
        this.selection.updateRendererAfterResize();

        return new ViewRowRestructureCommand(this, oldRows, newRows, metaStart);
    }

    /**
     * ビュー行を入れ替える（Command.execute/undo/redoから呼ばれる）
     *
     * @param metaStartIndex メタデータ開始インデックス
     * @param removeCount 削除する行数
     * @param insertRows 挿入する行の状態配列
     */
    replaceViewRows(metaStartIndex: number, removeCount: number, insertRows: SavedViewRowState[]): void {
        if (!this.viewContext) throw new Error('viewContextが未設定');
        const domStartIndex = metaStartIndex + 1;

        // DOMから行を削除
        for (let i = 0; i < removeCount; i++) {
            const row = this.element.children[domStartIndex];
            if (row) row.remove();
        }
        this.viewContext.rowMetadata.splice(metaStartIndex, removeCount);

        // 新しい行をDOMに挿入（参照ノードは挿入前に一度だけ取得し、insertBeforeで順序を維持）
        if (domStartIndex < this.element.children.length) {
            const referenceNode = this.element.children[domStartIndex] as HTMLElement;
            for (const row of insertRows) {
                this.element.insertBefore(row.domRow, referenceNode);
            }
        } else {
            for (const row of insertRows) {
                this.element.appendChild(row.domRow);
            }
        }
        this.viewContext.rowMetadata.splice(metaStartIndex, 0, ...insertRows.map(r => r.metadata));

        // 行番号を更新
        this.renumberRowsFrom(domStartIndex);

        // ビュースタイルを再適用
        this.applyViewRowStylesForRange(metaStartIndex, metaStartIndex + insertRows.length, false);

        // 選択範囲をクリア
        this.selection.clearCopyRange();
        this.selection.updateRendererAfterResize();
    }

    /**
     * 展開行データからDOM行を作成してテーブルに挿入する
     * buildAndExecuteViewRowRestructureとrefreshViewRowsの共通処理
     *
     * @param metaStart メタデータの挿入開始インデックス
     * @param baseRowIndex ベーステーブルの行インデックス
     * @param expandedRows 展開行データの配列
     * @returns 作成された行状態の配列（Undo用）
     */
    private buildAndInsertExpandedViewRows(
        metaStart: number, baseRowIndex: number, expandedRows: ExpandedRowResult[]
    ): SavedViewRowState[] {
        if (!this.viewContext) throw new Error('viewContextが未設定');
        const columnWidths = this.getColumnWidths();
        const domStartIndex = metaStart + 1;
        const referenceNode = domStartIndex < this.element.children.length
            ? this.element.children[domStartIndex] as HTMLElement : false as const;
        const newRows: SavedViewRowState[] = [];
        for (let i = 0; i < expandedRows.length; i++) {
            const expanded = expandedRows[i];
            const domRow = this.createViewDataRow(domStartIndex + i, expanded.values, columnWidths);
            if (referenceNode) {
                this.element.insertBefore(domRow, referenceNode);
            } else {
                this.element.appendChild(domRow);
            }
            const metadata: ViewRowMetadata = {
                baseRowIndex, groupInfos: expanded.groupInfos, paddingColumns: expanded.padding,
            };
            newRows.push({ domRow, metadata });
        }
        this.viewContext.rowMetadata.splice(metaStart, 0, ...newRows.map(r => r.metadata));
        this.renumberRowsFrom(domStartIndex);
        this.applyViewRowStylesForRange(metaStart, metaStart + newRows.length, true);
        return newRows;
    }

    /**
     * ビュー行のDOM要素を作成する
     * イベントハンドラ付きのセルを含む完全な行要素を返す
     */
    private createViewDataRow(rowIndex: number, values: string[], columnWidths: string[]): HTMLElement {
        const cells: HTMLElement[] = [];
        const rowHeader = this.createRowHeaderCell(String(rowIndex), rowIndex - 1);
        cells.push(rowHeader);
        for (let j = 0; j < values.length; j++) {
            const width = j < columnWidths.length ? columnWidths[j] : DEFAULT_COLUMN_WIDTH;
            const cell = EditorTable.createCell(this, values[j], j, width, DEFAULT_ROW_HEIGHT);
            cells.push(cell);
        }
        return EditorTable.createRow(cells, rowIndex);
    }

    /**
     * 指定DOM位置以降の全行の行番号を再設定する
     */
    private renumberRowsFrom(startDomIndex: number): void {
        for (let i = startDomIndex; i < this.element.children.length; i++) {
            const row = this.element.children[i] as HTMLElement;
            row.dataset.row = String(i);
            const header = row.children[0] as HTMLElement;
            if (!header.classList.contains('editor-table-row-header')) continue;
            // テキストノードを更新
            const existingTextNode = Array.from(header.childNodes).find(node => node.nodeType === Node.TEXT_NODE);
            if (existingTextNode) {
                existingTextNode.textContent = String(i);
            } else {
                header.insertBefore(document.createTextNode(String(i)), header.firstChild);
            }
            header.dataset.rowIndex = String(i - 1);
            // リサイズハンドルのイベントハンドラを再設定
            const existingHandle = header.querySelector('.row-resize-handle');
            if (existingHandle) existingHandle.remove();
            const newHandle = document.createElement('div');
            newHandle.classList.add('row-resize-handle');
            this.areaResizer.setupRowResizeHandle(newHandle, header, i);
            header.appendChild(newHandle);
        }
    }

    /**
     * 指定メタデータ範囲のビュー行スタイルを適用する
     * パディング・グループリーダー・折りたたみトグルを設定する
     */
    private applyViewRowStylesForRange(startMetaIdx: number, endMetaIdx: number, applyPadding: boolean): void {
        if (!this.viewContext) return;
        const rowMetadata = this.viewContext.rowMetadata;
        const columnMappings = this.viewContext.columnMappings;

        for (let metaIdx = startMetaIdx; metaIdx < endMetaIdx; metaIdx++) {
            const meta = rowMetadata[metaIdx];
            const domRowIndex = metaIdx + 1;
            const rowElement = this.element.children[domRowIndex] as HTMLElement;
            if (!rowElement) continue;

            // パディングセルのスタイル適用（初期レンダリング時のみ）
            if (applyPadding) {
                for (let colIdx = 0; colIdx < meta.paddingColumns.length; colIdx++) {
                    if (!meta.paddingColumns[colIdx]) continue;
                    const cellElement = rowElement.children[colIdx + 1] as HTMLElement;
                    if (!cellElement) continue;
                    cellElement.classList.add('view-padding-cell');
                    cellElement.textContent = '';
                }
            }

            // グループリーダー行の判定
            const isBaseGroupLeader = meta.groupInfos.length === 0
                || meta.groupInfos.every(g => g.groupPosition === 0);
            if (isBaseGroupLeader && metaIdx > 0) {
                const prevMeta = rowMetadata[metaIdx - 1];
                if (prevMeta.baseRowIndex !== meta.baseRowIndex) {
                    rowElement.classList.add('view-group-leader-row');
                }
            }

            // 折りたたみトグルの配置
            for (const groupInfo of meta.groupInfos) {
                if (groupInfo.groupPosition !== 0 || groupInfo.groupSize <= 1) continue;
                const joinDef = this.viewContext.viewDefinition.joins.find(j => j.targetTable === groupInfo.sourceTable);
                if (!joinDef) continue;
                const sourceTableName = joinDef.sourceTable === ''
                    ? this.viewContext.viewDefinition.baseTable : joinDef.sourceTable;
                const sourceColIdx = columnMappings.findIndex(
                    m => m.tableName === sourceTableName && m.sourceColumnName === joinDef.sourceColumn
                );
                if (sourceColIdx < 0) continue;
                const cellElement = rowElement.children[sourceColIdx + 1] as HTMLElement;
                if (!cellElement) continue;
                // 既存のトグルがあれば除去（重複防止）
                const existingToggle = cellElement.querySelector('.view-collapse-toggle');
                if (existingToggle) existingToggle.remove();
                const toggle = document.createElement('span');
                toggle.classList.add('view-collapse-toggle');
                toggle.textContent = '▼';
                toggle.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                });
                toggle.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.toggleCollapseGroup(metaIdx, groupInfo.sourceTable, toggle);
                });
                toggle.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                });
                cellElement.insertBefore(toggle, cellElement.firstChild);
            }
        }
    }

    /**
     * ビューコンテキストのjoinTableKeyMapsを再構築する
     * タブ切替時に結合テーブルの最新データを反映するために使用する
     *
     * @param openEditorTables 開かれているEditorTableの参照マップ
     */
    rebuildJoinTableKeyMaps(openEditorTables: Map<string, EditorTable>): void {
        if (!this.viewContext) return;
        const viewDefinition = this.viewContext.viewDefinition;
        const newKeyMaps = new Map<string, Map<string, string[][]>>();

        for (const join of viewDefinition.joins) {
            const editorTable = openEditorTables.get(join.targetTable);
            if (!editorTable) {
                // テーブルが開かれていない場合は既存のキーマップを保持
                const existing = this.viewContext.joinTableKeyMaps.get(join.targetTable);
                if (existing) newKeyMaps.set(join.targetTable, existing);
                continue;
            }
            // DOMからデータを読み取ってキーマップを再構築
            const columnCount = editorTable.getColumnCount();
            const rowCount = editorTable.getRowCount();
            // ターゲット列のインデックスを特定
            let keyColumnIndex = -1;
            for (let c = 0; c < columnCount; c++) {
                if (editorTable.getColumnHeaderValue(c) === join.targetColumn) {
                    keyColumnIndex = c;
                    break;
                }
            }
            if (keyColumnIndex === -1) continue;
            const keyMap = new Map<string, string[][]>();
            for (let r = 1; r < rowCount; r++) {
                const keyValue = editorTable.getCellValueAt(r, keyColumnIndex + 1);
                if (keyValue === '') continue;
                const rowValues: string[] = [];
                for (let c = 0; c < columnCount; c++) {
                    rowValues.push(editorTable.getCellValueAt(r, c + 1));
                }
                let rows = keyMap.get(keyValue);
                if (!rows) { rows = []; keyMap.set(keyValue, rows); }
                rows.push(rowValues);
            }
            newKeyMaps.set(join.targetTable, keyMap);
        }

        this.viewContext.joinTableKeyMaps = newKeyMaps;
    }

    /**
     * ビュー全体の行再構築を行う（タブ切替時用）
     * 各ベース行の展開行数が変わっていれば再構築する
     * Undo対象外（外部変更の反映）
     */
    refreshViewRows(): void {
        if (!this.viewContext) return;
        const viewContext = this.viewContext;
        const columnMappings = viewContext.columnMappings;
        const rowMetadata = viewContext.rowMetadata;

        // 各ベース行のグループをスキャンして、展開行数の差分を検出
        let metaIdx = 0;
        while (metaIdx < rowMetadata.length) {
            const baseRowIndex = rowMetadata[metaIdx].baseRowIndex;
            const metaStart = metaIdx;
            // このベース行のグループ終端を検索
            while (metaIdx < rowMetadata.length && rowMetadata[metaIdx].baseRowIndex === baseRowIndex) {
                metaIdx++;
            }
            const metaEnd = metaIdx;
            const currentCount = metaEnd - metaStart;

            // リーダー行のベーステーブル列値を取得
            const leaderDomIndex = metaStart + 1;
            const leaderDomRow = this.element.children[leaderDomIndex] as HTMLElement;
            if (!leaderDomRow) continue;
            const totalColumns = columnMappings.length;
            const baseColumnValues: string[] = new Array(totalColumns).fill('');
            for (let i = 0; i < totalColumns; i++) {
                if (columnMappings[i].joinLevel === 0) {
                    const cell = leaderDomRow.children[i + 1] as HTMLElement;
                    if (cell) baseColumnValues[i] = EditorTable.getCellValue(cell);
                }
            }

            // 新しい展開行数を計算
            const expandedRows = rebuildExpandedRowsForBaseRow(
                baseColumnValues, columnMappings, viewContext.viewDefinition, viewContext.joinTableKeyMaps
            );

            if (expandedRows.length === currentCount) {
                // 行数が同じでも値が変わっている可能性があるので、JOIN列の値を更新
                for (let i = 0; i < currentCount; i++) {
                    const domRow = this.element.children[metaStart + 1 + i] as HTMLElement;
                    for (let colIdx = 0; colIdx < totalColumns; colIdx++) {
                        if (!columnMappings[colIdx].isJoinedColumn) continue;
                        const cell = domRow.children[colIdx + 1] as HTMLElement;
                        if (!cell) continue;
                        if (rowMetadata[metaStart + i].paddingColumns[colIdx]) continue;
                        const newVal = expandedRows[i].values[colIdx];
                        const oldVal = EditorTable.getCellValue(cell);
                        if (oldVal !== newVal) this.setCellValueAt(metaStart + 1 + i, colIdx + 1, newVal);
                    }
                }
                continue;
            }

            // 行数が異なる場合: 再構築
            const domStartIndex = metaStart + 1;
            for (let i = 0; i < currentCount; i++) {
                const row = this.element.children[domStartIndex];
                if (row) row.remove();
            }
            rowMetadata.splice(metaStart, currentCount);
            this.buildAndInsertExpandedViewRows(metaStart, baseRowIndex, expandedRows);

            // metaIdxを再調整（挿入した行数分）
            metaIdx = metaStart + expandedRows.length;
        }

        this.selection.clearCopyRange();
        this.selection.updateRendererAfterResize();
    }
}
