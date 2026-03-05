import {EditorTableData} from "./model/editor-table-data";
import {Selection, CellPosition} from "./selection";
import {EditorTableHandler} from "./editor-table-handler";
import {ContextMenu} from "./context-menu";
import {History} from "./history";
import {Command, CellChange} from "./command";
import {AreaResizer} from "./area-resizer";
import {DEFAULT_ROW_HEIGHT} from "./constant";
import {ScrollViewportController} from "./scroll-viewport-controller";
import {SelectionDragController} from "./selection-drag-controller";
import {ReferenceDataCache} from "./reference-data-cache";
import {ReverseReferenceEntry, ReverseReferenceMap} from "./reverse-reference-resolver";
import {Sidebar} from "./sidebar";
import {ViewDefinition} from "./model/view-definition";
import {ViewColumnMapping} from "./model/view-column-mapping";
import {SavedViewRowState} from "./view-row-restructure-command";
import {EditorTableReference} from "./editor-table-reference";
import {EditorTableView} from "./editor-table-view";
import {EditorTableContextMenu} from "./editor-table-context-menu";
import {EditorTableStructure} from "./editor-table-structure";
import {InMemoryTableStore} from "./in-memory-table-store";
import {readCellValue} from "./view-group-query";

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
    /** 逆参照JOINかどうか */
    isReverse: boolean;
}

/**
 * ビューコンテキスト
 * ビュータブでのみ設定される
 */
export interface ViewContext {
    viewDefinition: ViewDefinition;
    columnMappings: ViewColumnMapping[];
    availableJoinTargets: AvailableJoinTarget[];
    /** 開いているEditorTableのマップ（ソーステーブル伝搬用） */
    openEditorTables: Map<string, EditorTable>;
    onJoinAsync: (target: AvailableJoinTarget, afterColumnIndex: number) => Promise<void>;
    /** 非表示列を再表示するコールバック（ビュータブの再構築を行う） */
    onShowHiddenColumn: (tableName: string, columnName: string) => void;
    /** JOINを解除するコールバック（ビュータブの再構築を行う） */
    onRemoveJoin: (targetTable: string) => void;
}

/**
 * EditorTable — マスターデータ編集テーブルのファサード
 *
 * 個別の責務は以下のモジュールに委譲する:
 * - EditorTableReference: 参照ヒント管理
 * - EditorTableView: ビュー行管理
 * - EditorTableContextMenu: コンテキストメニュー
 * - EditorTableStructure: 列/行の構造操作
 */
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
    /** テーブルデータの中央ストア（セル編集の同期用） */
    private readonly store: InMemoryTableStore;
    /** 参照箇所を表示するサイドバー */
    private readonly sidebar: Sidebar;

    /** 参照ヒント管理モジュール */
    reference!: EditorTableReference;
    /** ビュー行管理モジュール */
    view!: EditorTableView;
    /** コンテキストメニュー管理モジュール */
    contextMenuHandler!: EditorTableContextMenu;
    /** テーブル構造操作モジュール */
    structure!: EditorTableStructure;

    constructor(
        tableName: string,
        tableData: EditorTableData,
        referenceDataCache: ReferenceDataCache,
        store: InMemoryTableStore,
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
        this.store = store;
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
    }

    /**
     * 分割先モジュールを生成・注入する
     * Object.assign後に呼び出すことで、thisがプロキシオブジェクトを指す
     */
    initializeModules(): void {
        this.reference = new EditorTableReference(this, this.tableData, this.referenceDataCache);
        this.view = new EditorTableView(this, this.selection, this.areaResizer, this.store, this.referenceDataCache);
        this.contextMenuHandler = new EditorTableContextMenu(this, this.selection, this.contextMenu, this.history);
        this.structure = new EditorTableStructure(this, this.selection, this.history, this.areaResizer);
    }

    // =========================================================================
    // 内部モジュール用アクセサ
    // =========================================================================

    /** 内部モジュール用: テーブルDOM要素を取得する */
    getTableElement(): HTMLElement { return this.element; }

    /** 内部モジュール用: テーブルデータを取得する */
    getTableData(): EditorTableData { return this.tableData; }

    /** 内部モジュール用: 中央ストアを取得する */
    getStore(): InMemoryTableStore { return this.store; }

    /** 内部モジュール用: Selection を取得する */
    getSelection(): Selection { return this.selection; }

    /** 内部モジュール用: EditorTableHandler を取得する */
    getHandler(): EditorTableHandler { return this.handler; }

    // =========================================================================
    // ライフサイクル
    // =========================================================================

    /**
     * テーブル要素を親要素に追加する
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
                const columnHeaderCell = this.structure.createColumnHeaderCell(this.tableData.header[i].name, i, this.tableData.header[i].width);
                cells.push(columnHeaderCell);
            }
            const columnHeaderRow = EditorTable.createRow(cells, 0);
            columnHeaderRow.classList.add('editor-table-column-header-row');
            this.element.appendChild(columnHeaderRow);
        }
        for (let i = 0; i < this.tableData.body.length; ++i) {
            const cells = [];
            const rowIndex = i;
            const rowHeaderCell = this.structure.createRowHeaderCell(String(i + 1), i);
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
            const rowIndex = this.tableData.body.length + i;
            const rowHeaderCell = this.structure.createRowHeaderCell(String(this.tableData.body.length + i + 1), this.tableData.body.length + i);
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

    // =========================================================================
    // スクロール
    // =========================================================================

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

    // =========================================================================
    // static メソッド
    // =========================================================================

    static createRow(cells: HTMLElement[], rowIndex?: number) {
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

    /**
     * セルのDOM要素を作成する
     *
     * textContentに値を設定し、イベントリスナーを登録した状態のセル要素を返す。
     * 参照ヒント(.cell-reference-hint)はこのメソッドでは適用されない。
     *
     * 初期描画パス: TabReference.preloadReferenceTables() 完了後に updateReferenceHints() で一括適用
     * ビュー行作成パス: 行挿入後に updateReferenceHintsForRows() で適用
     */
    static createCell(table: EditorTable, value: number | string | string[] | undefined, columnIndex: number, width: string, height: string) {
        const cell = document.createElement('div');
        cell.classList.add('editor-table-cell');
        cell.dataset.col = String(columnIndex);
        EditorTable.applyCellWidth(cell, width);
        EditorTable.applyCellHeight(cell, height);
        cell.addEventListener('dblclick', () => {
            // 参照列の場合はドロップダウンを表示（isCellEditBlockedガードは各編集メソッド内で実行）
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
                table.selection.extendSelection(position.row, position.column);
            } else {
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
     * セルの値を取得する（参照ヒント・折りたたみトグルを除外）
     * 実装はview-group-query.tsのreadCellValueに委譲する
     */
    static getCellValue(cell: HTMLElement): string {
        return readCellValue(cell);
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

    // =========================================================================
    // DOMゲッター
    // =========================================================================

    /**
     * 座標からセル要素を取得する
     * @param row 行インデックス（0始まり、列ヘッダー行を含む）
     * @param column 列インデックス（0始まり、行ヘッダーセルを含む）
     */
    getCell(row: number, column: number): HTMLElement {
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
     */
    getCellValueAt(row: number, column: number): string {
        const cell = this.getCell(row, column);
        return EditorTable.getCellValue(cell);
    }

    /**
     * 列ヘッダーの値を取得する
     */
    getColumnHeaderValue(columnIndex: number): string {
        const headerRow = this.element.children[0] as HTMLElement;
        const headerCell = headerRow.children[columnIndex + 1] as HTMLElement;
        for (const node of Array.from(headerCell.childNodes)) {
            if (node.nodeType === Node.TEXT_NODE) {
                return node.textContent ?? '';
            }
        }
        return '';
    }

    /**
     * 列ヘッダーの値を設定する
     */
    setColumnHeaderValue(columnIndex: number, value: string): void {
        const headerRow = this.element.children[0] as HTMLElement;
        const headerCell = headerRow.children[columnIndex + 1] as HTMLElement;
        for (const node of Array.from(headerCell.childNodes)) {
            if (node.nodeType === Node.TEXT_NODE) {
                node.textContent = value;
                return;
            }
        }
        headerCell.insertBefore(document.createTextNode(value), headerCell.firstChild);
    }

    /**
     * 列ヘッダーにCSSクラスを追加する
     */
    addColumnHeaderClass(columnIndex: number, className: string): void {
        const headerRow = this.element.children[0];
        const headerCell = headerRow.children[columnIndex + 1] as HTMLElement;
        if (headerCell) {
            headerCell.classList.add(className);
        }
    }

    /**
     * 指定列の幅を取得（列ヘッダーセルから取得）
     */
    getColumnWidth(columnIndex: number): string {
        const columnHeaderRow = this.element.children[0];
        const headerCell = columnHeaderRow.children[columnIndex + 1] as HTMLElement;
        if (headerCell.style.width === '') {
            throw new Error(`列ヘッダーセル(columnIndex=${columnIndex})にwidthが設定されていません`);
        }
        return headerCell.style.width;
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
        for (let i = 0; i < this.element.children.length; ++i) {
            const row = this.element.children[i] as HTMLElement;
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
        const row = this.element.children[rowIndex] as HTMLElement;
        if (row) {
            for (let i = 0; i < row.children.length; ++i) {
                const cell = row.children[i] as HTMLElement;
                EditorTable.applyCellHeight(cell, height);
            }
        }
    }

    /**
     * 指定座標のセルのBoundingClientRectを取得する
     */
    getCellRectAt(row: number, column: number): DOMRect {
        const cell = this.getCell(row, column);
        return cell.getBoundingClientRect();
    }

    /**
     * 座標でセルのBoundingClientRectを取得する（存在しない場合はnull）
     */
    getCellRectOrNull(row: number, column: number): DOMRect | null {
        const rowElement = this.element.children[row] as HTMLElement | undefined;
        if (!rowElement) return null;
        const cell = rowElement.children[column] as HTMLElement | undefined;
        if (!cell) return null;
        return cell.getBoundingClientRect();
    }

    /**
     * テキストフィールドの幅を計算する
     */
    calculateTextFieldWidth(row: number, column: number, textWidth: number): { width: number; cellHeight: number } {
        const rowElement = this.element.children[row] as HTMLElement;
        const startCell = rowElement.children[column] as HTMLElement;
        const cellHeight = startCell.getBoundingClientRect().height;
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

    // =========================================================================
    // UI
    // =========================================================================

    /**
     * ヘッダーの選択状態を更新する
     */
    updateHeaderSelection(startRow: number, startColumn: number, endRow: number, endColumn: number): void {
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
     * 選択範囲に操作拒否のフィードバックアニメーションを表示する
     */
    showRejectionFeedback(): void {
        const selectionElement = this.selection.element;
        selectionElement.classList.add('selection-rejected');
        selectionElement.addEventListener('animationend', () => {
            selectionElement.classList.remove('selection-rejected');
        }, { once: true });
    }

    /**
     * ストアからセルデータを再読み込みし、DOMの値と差分があるセルのみ更新する
     * タブ切替時に呼び出され、他タブでストアが変更されたセルのDOMを同期する
     */
    reloadCellsFromStore(): void {
        // ビュータブはrefreshViewRows()で既に対応済みのためスキップ
        if (this.view.hasViewContext()) return;

        const storeRows = this.store.getRows(this.tableName);
        const storeHeader = this.store.getHeader(this.tableName);
        if (storeRows === false || storeHeader === false) return;

        // DOMの列ヘッダー名 → ストアの列インデックスのマッピングを構築
        const domColumnCount = this.getColumnCount();
        const storeColumnIndices: number[] = [];
        for (let domCol = 0; domCol < domColumnCount; domCol++) {
            const headerName = this.getColumnHeaderValue(domCol);
            storeColumnIndices.push(storeHeader.indexOf(headerName));
        }

        for (let storeRow = 0; storeRow < storeRows.length; storeRow++) {
            const domRow = storeRow + 1; // DOMは1始まり（列ヘッダー行がある）
            if (domRow >= this.getRowCount()) break;

            const storeRowData = storeRows[storeRow];

            for (let domCol = 0; domCol < domColumnCount; domCol++) {
                const storeColIdx = storeColumnIndices[domCol];
                if (storeColIdx === -1) continue;
                const storeValue = storeColIdx < storeRowData.length ? storeRowData[storeColIdx] : '';
                const domValue = this.getCellValueAt(domRow, domCol + 1);

                if (domValue !== storeValue) {
                    const cell = this.getCell(domRow, domCol + 1);
                    this.reference.setCellValue(cell, storeValue, domCol, domRow);
                }
            }
        }
    }

    // =========================================================================
    // ファサード: EditorTableReference
    // =========================================================================

    /** 座標でセルのDOMと参照ヒントのみ更新する（ソーステーブルへの伝搬は行わない） */
    updateCellValueAt(row: number, column: number, value: string): void {
        this.reference.setCellValueAt(row, column, value);
        // 通常タブの場合のみ中央ストアとfullDataCacheを同期する
        // ビュータブはpropagateJoinedColumnToSourceTableでソーステーブルのStoreを更新する
        if (!this.view.hasViewContext()) {
            const id = this.reference.getRowPkValue(row);
            // column: DOMの列インデックス（1始まり、行ヘッダー含む）→ 0始まりのデータ列インデックスに変換
            const columnName = this.getColumnHeaderValue(column - 1);
            this.store.updateCellValue(this.tableName, id, columnName, value);
            // 動的参照用のfullDataCacheも同期する（キャッシュが存在する場合のみ更新される）
            this.referenceDataCache.updateFullDataCell(this.tableName, id, column - 1, value);
        }
    }

    /** 変更リストをまとめてソーステーブルに伝搬する */
    propagateToSourceTable(changes: CellChange[]): void {
        for (const change of changes) {
            this.view.propagateJoinedColumnToSourceTable(change.row, change.column, change.newValue, change.oldValue);
        }
    }

    /** 参照データのpreload完了後にセルの参照ヒントを更新する */
    updateReferenceHints(): void {
        this.reference.updateReferenceHints();
    }

    /** 指定DOM行範囲のセルの参照ヒントを更新する */
    updateReferenceHintsForRows(startDomRow: number, endDomRow: number): void {
        this.reference.updateReferenceHintsForRows(startDomRow, endDomRow);
    }

    /** 指定した列のすべてのセルの参照ヒントを更新する */
    updateColumnReferenceHints(columnIndex: number): void {
        this.reference.updateColumnReferenceHints(columnIndex);
    }

    /** 逆参照ヒントを更新する */
    updateReverseReferenceHints(map: ReverseReferenceMap): void {
        this.reference.updateReverseReferenceHints(map);
    }

    /** 逆参照ヒントの表示テキストを更新する（他テーブルからの伝搬用） */
    updateReverseReferenceDisplayText(pkValue: string, childTableName: string, groupPosition: number, newDisplayText: string): void {
        this.reference.updateReverseReferenceDisplayText(pkValue, childTableName, groupPosition, newDisplayText);
    }

    /** 逆参照マップにエントリが存在するか判定する */
    hasReverseReferences(): boolean {
        return this.reference.hasReverseReferences();
    }

    /** PK値から逆参照エントリを取得する */
    getReverseReferenceEntries(pkValue: string): ReverseReferenceEntry[] {
        return this.reference.getReverseReferenceEntries(pkValue);
    }

    /** 行のPK値を取得する */
    getRowPkValue(rowIndex: number): string {
        return this.reference.getRowPkValue(rowIndex);
    }

    /**
     * 動的参照のvalueColumn名から合成ヘッダー上の列インデックスを解決する
     * 通常テーブルはヘッダーの直接名前一致、ビューはcolumnMappingsで同一テーブル内を検索する
     */
    resolveValueColumnIndex(valueColumnName: string, currentDataColumnIndex: number): number {
        return this.reference.resolveValueColumnIndex(valueColumnName, currentDataColumnIndex);
    }

    // =========================================================================
    // ファサード: EditorTableView
    // =========================================================================

    /** ビュー行のスタイルを指定範囲に適用する */
    applyViewRowStylesForRange(startMetaIndex: number, endMetaIndex: number, applyPadding: boolean): void {
        this.view.applyViewRowStylesForRange(startMetaIndex, endMetaIndex, applyPadding);
    }

    /** ビューコンテキストを設定する */
    setViewContext(context: ViewContext): void {
        this.view.setViewContext(context);
    }

    /** ビューコンテキストが設定されているかを返す */
    hasViewContext(): boolean {
        return this.view.hasViewContext();
    }

    /** ビューコンテキストを取得する */
    getViewContext(): ViewContext {
        return this.view.getViewContext();
    }

    /** 指定行がビューグループのリーダー行かどうかを判定する */
    isViewLeaderRow(row: number): boolean {
        return this.view.isViewLeaderRow(row);
    }

    /** 指定セルがパディングセルかどうかを判定する */
    isPaddingCell(row: number, column: number): boolean {
        return this.view.isPaddingCell(row, column);
    }

    /** 指定範囲にパディングセルが含まれるかを判定する */
    containsPaddingCell(startRow: number, startColumn: number, endRow: number, endColumn: number): boolean {
        return this.view.containsPaddingCell(startRow, startColumn, endRow, endColumn);
    }

    /** 指定範囲に編集不可セルが含まれるかを判定する */
    containsReadOnlyCell(startRow: number, startColumn: number, endRow: number, endColumn: number): boolean {
        return this.view.containsReadOnlyCell(startRow, startColumn, endRow, endColumn);
    }

    /** 選択範囲が完全なFKグループ単位で構成されているかを判定する */
    isSelectionCoveringCompleteGroups(startRow: number, endRow: number): boolean {
        return this.view.isSelectionCoveringCompleteGroups(startRow, endRow);
    }

    /** 単一セル編集のガード（文字入力・ダブルクリック・ドロップダウン） */
    isCellEditBlocked(row: number, column: number): boolean {
        return this.view.isCellEditBlocked(row, column);
    }

    /** 範囲編集のガード（Paste・Fill） */
    isRangeEditBlocked(startRow: number, startColumn: number, endRow: number, endColumn: number): boolean {
        return this.view.isRangeEditBlocked(startRow, startColumn, endRow, endColumn);
    }

    /** Delete操作のガード（パディングセル + FKグループ完全性チェック） */
    isDeleteBlocked(startRow: number, startColumn: number, endRow: number, endColumn: number): boolean {
        return this.view.isDeleteBlocked(startRow, startColumn, endRow, endColumn);
    }

    /** 指定された列範囲に結合列が含まれるかを判定する */
    containsJoinedColumn(startColumn: number, endColumn: number): boolean {
        return this.view.containsJoinedColumn(startColumn, endColumn);
    }

    /** データ領域の最大行を取得 */
    getMaxDataRow(): number {
        return this.view.getMaxDataRow();
    }

    /** FK値変更で行数が変わるかを判定する */
    needsViewRowRestructure(editedRow: number, editedColumn: number, newValue: string): boolean {
        return this.view.needsViewRowRestructure(editedRow, editedColumn, newValue);
    }

    /** FK値変更に伴うビュー行の再構築を実行する */
    buildAndExecuteViewRowRestructure(editedRow: number, editedColumn: number, newValue: string, keyMaps: Map<string, Map<string, string[][]>>): Command {
        return this.view.buildAndExecuteViewRowRestructure(editedRow, editedColumn, newValue, keyMaps);
    }

    /** ビュー行を入れ替える（Command.execute/undo/redoから呼ばれる） */
    replaceViewRows(metaStartIndex: number, removeCount: number, insertRows: SavedViewRowState[]): void {
        this.view.replaceViewRows(metaStartIndex, removeCount, insertRows);
    }

    /** 結合列の編集時に同一JOINキーを持つ他の行の値を連動更新する */
    synchronizeJoinedColumnValues(editedRow: number, editedColumn: number, newValue: string): CellChange[] {
        return this.view.synchronizeJoinedColumnValues(editedRow, editedColumn, newValue);
    }

    /** ビュー全体の行再構築を行う */
    refreshViewRows(): void {
        this.view.refreshViewRows();
    }

    // =========================================================================
    // ファサード: EditorTableStructure
    // =========================================================================

    /** 列挿入（Commandを使用してhistoryに追加） */
    public insertColumn(columnIndex: number): void {
        this.structure.insertColumn(columnIndex);
    }

    /** 複数列挿入（Commandを使用してhistoryに追加） */
    public insertColumns(columnIndex: number, count: number): void {
        this.structure.insertColumns(columnIndex, count);
    }

    /** 列挿入の内部実装（Commandから呼び出される） */
    public insertColumnInternal(columnIndex: number): void {
        this.structure.insertColumnInternal(columnIndex);
    }

    /** 行挿入（Commandを使用してhistoryに追加） */
    public insertRow(rowIndex: number): void {
        this.structure.insertRow(rowIndex);
    }

    /** 複数行挿入（Commandを使用してhistoryに追加） */
    public insertRows(rowIndex: number, count: number): void {
        this.structure.insertRows(rowIndex, count);
    }

    /** 行挿入の内部実装（Commandから呼び出される） */
    public insertRowInternal(rowIndex: number): void {
        this.structure.insertRowInternal(rowIndex);
    }

    /** 列削除（Commandを使用してhistoryに追加） */
    public removeColumn(columnIndex: number): void {
        this.structure.removeColumn(columnIndex);
    }

    /** 複数列削除（Commandを使用してhistoryに追加） */
    public removeColumns(startColumnIndex: number, count: number): void {
        this.structure.removeColumns(startColumnIndex, count);
    }

    /** 行削除（Commandを使用してhistoryに追加） */
    public removeRow(rowIndex: number): void {
        this.structure.removeRow(rowIndex);
    }

    /** 複数行削除（Commandを使用してhistoryに追加） */
    public removeRows(startRowIndex: number, count: number): void {
        this.structure.removeRows(startRowIndex, count);
    }

    /** 列を削除する（Undo用） */
    public deleteColumn(columnIndex: number): void {
        this.structure.deleteColumn(columnIndex);
    }

    /** 行を削除する（Undo用） */
    public deleteRow(rowIndex: number): void {
        this.structure.deleteRow(rowIndex);
    }
}
