import {EditorTableData} from "./model/editor-table-data";
import {Selection, CellPosition} from "./selection";
import {EditorTableHandler} from "./editor-table-handler";
import {ContextMenu} from "./context-menu";
import {History} from "./history";
import {CellChange} from "./command";
import {AreaResizer} from "./area-resizer";
import {DEFAULT_ROW_HEIGHT} from "./constant";
import {ScrollViewportController} from "./scroll-viewport-controller";
import {SelectionDragController} from "./selection-drag-controller";
import {ReferenceDataCache} from "./reference-data-cache";
import {ReverseReferenceEntry, ReverseReferenceMap} from "./reverse-reference-resolver";
import {Sidebar} from "./sidebar";
import {EditorTableReference} from "./editor-table-reference";
import {EditorTableContextMenu} from "./editor-table-context-menu";
import {EditorTableStructure} from "./editor-table-structure";
import {InMemoryTableStore} from "./in-memory-table-store";
import {RelationsPanel} from "./relations-panel";
import {parseReferenceExpression, isSimpleReference} from "./reference-expression";

/**
 * EditorTable — マスターデータ編集テーブルのファサード
 *
 * 個別の責務は以下のモジュールに委譲する:
 * - EditorTableReference: 参照ヒント管理
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
    /** コンテキストメニュー管理モジュール */
    contextMenuHandler!: EditorTableContextMenu;
    /** テーブル構造操作モジュール */
    structure!: EditorTableStructure;
    /** リレーションパネル（RelationsPanelのconnectEditorTableで設定される。未設定はfalse） */
    relationsPanel: RelationsPanel | false;

    /** 空行数（通常は100行、ミニテーブルは0行） */
    private readonly emptyRowCount: number;
    /** ルート要素に付与するCSSクラス名（通常は 'editor-table'、ミニテーブルは別クラス） */
    private readonly rootCssClass: string;
    /**
     * ミニEditorTableフラグ。RelationsPanelのミニテーブルとして生成された場合はtrue。
     * trueの場合、行選択変化をRelationsPanelに通知しない（自分自身の再描画による自己破棄を防止）。
     */
    private readonly isMiniTable: boolean;
    /** 行追加時に自動埋め込みするFK列名と値のペア配列（1:Nミニテーブルで使用） */
    private autoFillEntries: Array<{ columnName: string; value: string }>;
    /**
     * DOMのデータ行インデックス（0始まり）からストアの行インデックスへのマッピング。
     * 通常テーブル: storeRowIndices[i] = i（DOM行i+1 → ストア行i）。
     * ミニテーブル: filteredRows作成時に各filteredRow がストアの何行目かを記録する。
     * 行挿入・削除時に同期される。
     */
    private storeRowIndices: number[];

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
        sidebar: Sidebar,
        emptyRowCount: number,
        rootCssClass: string,
        isMiniTable: boolean
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
        this.emptyRowCount = emptyRowCount;
        this.rootCssClass = rootCssClass;
        this.isMiniTable = isMiniTable;
        this.element = document.createElement('div');
        this.relationsPanel = false;
        this.autoFillEntries = [];
        // initialize() で初期化される
        this.storeRowIndices = [];
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
        this.contextMenuHandler = new EditorTableContextMenu(this, this.selection, this.contextMenu);
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
        this.element.classList.add(this.rootCssClass);
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
        // 全テーブルで storeRowIndices を初期化する（ミニテーブルは1:Nの場合のみ setStoreRowIndices() で上書き）
        this.storeRowIndices = Array.from({ length: this.tableData.body.length }, (_, i) => i);
        for (let i = 0; i < this.emptyRowCount - this.tableData.body.length; ++i) {
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
        this.handler.deactivate();
        this.selectionDragController.deactivate();
        this.scrollBinding.deactivate();
    }

    /**
     * 読み取り専用にする（ミニEditorTable用）
     * セル編集UIの表示を禁止してストア汚染を防ぎ、Ctrl+Sも禁止してCSV破壊を防ぐ
     */
    makeReadOnly(): void {
        this.handler.makeReadOnly();
        this.contextMenuHandler.makeReadOnly();
    }

    /**
     * ミニEditorTableかどうかを判定する（EditorTableHandlerのCtrl+S禁止判定に使用）
     * RelationsPanelのcreateMinEditorTable()で生成された場合にtrueを返す。
     */
    isMiniTableInstance(): boolean {
        return this.isMiniTable;
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
     */
    static createCell(table: EditorTable, value: number | string | string[] | undefined, columnIndex: number, width: string, height: string) {
        const cell = document.createElement('div');
        cell.classList.add('editor-table-cell');
        cell.dataset.col = String(columnIndex);
        EditorTable.applyCellWidth(cell, width);
        EditorTable.applyCellHeight(cell, height);
        cell.addEventListener('dblclick', () => {
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
            // Ctrl+クリックで参照先テーブルへ定義ジャンプする
            if (e.ctrlKey || e.metaKey) {
                table.navigateToDefinition(position.row, position.column);
                e.preventDefault();
                return;
            }
            table.handler.submitAndHide();
            // RelationsPanelが接続されている場合: このEditorTableのhandlerをアクティブ化し
            // 他の全EditorTableのhandlerをdeactivateする（フォーカスの排他制御）
            if (table.relationsPanel !== false) {
                table.relationsPanel.activateHandler(table);
            }
            if (e.shiftKey) {
                table.selection.extendSelection(position.row, position.column);
            } else {
                table.selection.start(position.row, position.column);
            }
        });
        cell.addEventListener('contextmenu', (e) => {
            const position = EditorTable.getCellPosition(cell, table.element);
            if (!position) return;
            // 全 parentColumnName の列値でエントリを収集する（非PK列参照にも対応）
            const allEntries: ReverseReferenceEntry[] = [];
            for (const colName of table.getAllParentColumnNames()) {
                const colValue = table.getCellValueByColumnName(position.row, colName);
                if (colValue === '') continue;
                const entries = table.getReverseReferenceEntries(colValue);
                for (const entry of entries) {
                    if (entry.parentColumnName === colName) allEntries.push(entry);
                }
            }
            if (allEntries.length === 0) return;
            const pkValue = table.getRowPkValue(position.row);
            if (pkValue === '') return;
            e.preventDefault();
            e.stopPropagation();
            // ドラグ状態をリセット
            table.selection.end();
            table.contextMenu.show(e.clientX, e.clientY, [{
                label: '参照箇所を表示',
                action: () => {
                    table.sidebar.showReferences(pkValue, allEntries);
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
     * セルの値を取得する（参照ヒントを除外）
     */
    static getCellValue(cell: HTMLElement): string {
        // .cell-value 要素があればそこから取得
        const valueElement = cell.querySelector('.cell-value');
        if (valueElement) return valueElement.textContent ?? '';
        // ヒント要素がある場合、直下のテキストノードのみを結合して返す
        const hasChildElements = cell.querySelector('.cell-reference-hint, .cell-reverse-reference-hint');
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

    /**
     * データ領域の最大行を取得（データが入力されている最後の行）
     */
    getMaxDataRow(): number {
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
     * ストアからセルデータを再読み込みし、DOMの値と差分があるセルのみ更新する
     * タブ切替時に呼び出され、他タブでストアが変更されたセルのDOMを同期する
     */
    reloadCellsFromStore(): void {
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

        // storeRowIndices[domDataRow] → storeRow のマッピングで各DOMデータ行を更新する
        // 通常テーブルは storeRowIndices[i]=i なので従来と同様の動作となる
        // ミニテーブルは filteredRows のストアインデックスを正しく参照できる
        const domRowCount = this.getRowCount();
        for (let domDataRow = 0; domDataRow < this.storeRowIndices.length; domDataRow++) {
            const domRow = domDataRow + 1; // DOMは1始まり（列ヘッダー行がある）
            if (domRow >= domRowCount) break;
            const storeRowIndex = this.storeRowIndices[domDataRow];
            if (storeRowIndex < 0 || storeRowIndex >= storeRows.length) continue;
            const storeRowData = storeRows[storeRowIndex];

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
    // FK自動埋め込み
    // =========================================================================

    /**
     * 行追加時に自動埋め込みするFK列名と値のペアを設定する
     * 1:Nミニテーブルの buildMiniEditorTableAsync() から呼ばれる
     */
    setAutoFillEntries(entries: Array<{ columnName: string; value: string }>): void {
        this.autoFillEntries = entries;
    }

    /**
     * DOMデータ行インデックスからストア行インデックスへのマッピングを設定する
     * ミニテーブルのfilteredRows構築後に buildMiniEditorTableAsync() から呼ばれる。
     * storeRowIndices[i] = ストア内の実際の行インデックス（0始まり）。
     */
    setStoreRowIndices(indices: number[]): void {
        this.storeRowIndices = indices;
    }

    /**
     * storeRowIndices を内部モジュール（EditorTableStructure）から取得するためのアクセサ
     * 行挿入・削除時に同期するために使用する
     */
    getStoreRowIndices(): number[] { return this.storeRowIndices; }

    /**
     * FK自動埋め込み情報を取得する（InsertRowCommand / InsertRowsCommand から参照）
     */
    getAutoFillEntries(): Array<{ columnName: string; value: string }> {
        return this.autoFillEntries;
    }

    /**
     * 指定行にautoFillEntriesのFK値を書き込む（InsertRowCommand / InsertRowsCommand から使用）
     *
     * insertRowInternal() がストアにも空行を挿入済みであることを前提とする。
     * DOMセルの更新と、ストアのインデックスベース更新を両方行う。
     * PK検索（updateCellValueAt）ではなく行インデックスで直接更新するため、
     * 新規行（PK未入力）でも正しくFK値が書き込まれる。
     *
     * @param rowIndex DOMの行インデックス（列ヘッダー行を含む。データ行は1始まり）
     */
    applyAutoFillToRow(rowIndex: number): void {
        // storeRowIndicesを使ってストア行インデックスを取得する（PK重複時でも正しい行を更新できる）
        const domDataRowIndex = rowIndex - 1;
        if (domDataRowIndex < 0 || domDataRowIndex >= this.storeRowIndices.length) return;
        const storeRowIndex = this.storeRowIndices[domDataRowIndex];
        // 照合失敗（-1）の場合はストア更新不可。DOM更新は継続する。
        const canUpdateStore = storeRowIndex >= 0;
        const storeHeader = canUpdateStore ? this.store.getHeader(this.tableName) : false;
        for (const entry of this.autoFillEntries) {
            const colCount = this.getColumnCount();
            for (let c = 0; c < colCount; c++) {
                if (this.getColumnHeaderValue(c) !== entry.columnName) continue;
                // DOMセルを更新（参照ヒント適用のためreference.setCellValueAt()を使用）
                this.reference.setCellValueAt(rowIndex, c + 1, entry.value);
                // ストアをインデックスベースで更新（PK未入力でも動作する）
                if (canUpdateStore && storeHeader !== false) {
                    const storeColIndex = storeHeader.indexOf(entry.columnName);
                    if (storeColIndex !== -1) {
                        this.store.updateCellValueByRowIndex(this.tableName, storeRowIndex, storeColIndex, entry.value);
                    }
                }
                break;
            }
        }
    }

    // =========================================================================
    // 定義ジャンプ
    // =========================================================================

    /**
     * 参照セルのFK値から参照先テーブルの該当行へジャンプする
     * Ctrl+クリックまたはF12から呼ばれる。
     * relationsPanel 経由で Tab.navigateToTableRow() を実行する。
     *
     * @param row  DOM行インデックス（0始まり、列ヘッダー行を含む）
     * @param column DOM列インデックス（1始まり、行ヘッダーが0列目）
     */
    navigateToDefinition(row: number, column: number): void {
        if (this.relationsPanel === false) return;
        // データ列インデックスに変換（行ヘッダーが0列目のため -1）
        const dataColIdx = column - 1;
        if (dataColIdx < 0 || dataColIdx >= this.tableData.header.length) return;
        const ref = this.tableData.header[dataColIdx].reference;
        if (!ref) return;
        const expr = parseReferenceExpression(ref);
        if (!isSimpleReference(expr)) return;
        const fkValue = this.getCellValueAt(row, column);
        if (fkValue === '') return;
        // RelationsPanel.navigateToDefinition() 経由でジャンプ元を履歴に積んでからTabを切り替える
        this.relationsPanel.navigateToDefinition(expr.tableName, fkValue);
    }

    // =========================================================================
    // RelationsPanel 連携
    // =========================================================================

    /** 行選択が変化したときにRelationsPanelへ通知する（Selectionから呼ばれる） */
    notifyRowSelectionChanged(rowIndex: number): void {
        if (this.relationsPanel === false) return;
        // ミニEditorTableはRelationsPanelへの通知を行わない。
        // ミニテーブルのセルをクリックしたとき行選択変化がRelationsPanelに通知されると
        // updateForRowAsync → destroyMiniEditorTables で自分自身が破棄されてしまうため。
        if (this.isMiniTable) return;
        this.relationsPanel.updateForRow(rowIndex);
    }

    /**
     * セル値変更後にRelationsPanelを強制再描画する
     * Selection.forceNotifyRelationsPanel() 経由でlastNotifiedRowをリセットしてから通知する
     */
    forceRefreshRelationsPanel(): void {
        if (this.relationsPanel === false) return;
        this.selection.forceNotifyRelationsPanel();
    }

    // =========================================================================
    // ファサード: EditorTableReference
    // =========================================================================

    /**
     * 座標でセルのDOMと参照ヒントを更新し、ストアをインデックスベースで同期する
     *
     * row: DOMの行インデックス（1始まり、列ヘッダー行を含む）
     * column: DOMの列インデックス（1始まり、行ヘッダーを含む）
     *
     * PK値ベース検索（旧: updateCellValue）を廃止し、storeRowIndices による
     * インデックスベースで更新する。PK重複があっても正しい行を更新できる。
     */
    updateCellValueAt(row: number, column: number, value: string): void {
        this.reference.setCellValueAt(row, column, value);
        // DOMデータ行インデックス（0始まり）= DOM行インデックス - 1（列ヘッダー行分）
        const domDataRowIndex = row - 1;
        if (domDataRowIndex < 0 || domDataRowIndex >= this.storeRowIndices.length) return;
        const storeRowIndex = this.storeRowIndices[domDataRowIndex];
        // データ行外（空行等）・照合失敗（-1）の場合はストア更新をスキップ
        if (storeRowIndex < 0) return;
        const storeHeader = this.store.getHeader(this.tableName);
        if (storeHeader === false) return;
        // DOMの列インデックス（1始まり、行ヘッダー含む）→ ストアの列インデックス（0始まり）
        const columnName = this.getColumnHeaderValue(column - 1);
        const storeColIndex = storeHeader.indexOf(columnName);
        if (storeColIndex === -1) return;
        this.store.updateCellValueByRowIndex(this.tableName, storeRowIndex, storeColIndex, value);
        // 動的参照用のfullDataCacheも同期する（PKベース: 参照先テーブルはPK重複のないテーブルが前提）
        const id = this.reference.getRowPkValue(row);
        this.referenceDataCache.updateFullDataCell(this.tableName, id, column - 1, value);
    }

    /**
     * ユーザー編集時のセル変更を適用する（DOM更新 + ストア同期）
     * ループ完了後に1回だけRelationsPanelを更新する（毎セル発火を防止）
     * ミニEditorTableの場合はパネル全体再構築を避け、参照ヒントのみ更新する
     */
    applyCellChanges(changes: CellChange[]): CellChange[] {
        for (const change of changes) this.updateCellValueAt(change.row, change.column, change.newValue);
        if (this.isMiniTable) {
            // forceRefreshRelationsPanel() はパネル全体を再構築して編集中のミニEditorTable自身を
            // 破棄してしまうため、左ペインの参照ヒントのみ更新する
            if (this.relationsPanel !== false) this.relationsPanel.notifyMiniTableCellChanged();
        } else {
            this.forceRefreshRelationsPanel();
        }
        return changes;
    }

    /**
     * 変更リストをDOMに再適用する（Undo/Redo/Fill用）
     * ループ完了後に1回だけRelationsPanelを更新する（毎セル発火を防止）
     * ミニEditorTableの場合はパネル全体再構築を避け、参照ヒントのみ更新する
     */
    replayCellChanges(changes: CellChange[]): void {
        for (const change of changes) this.updateCellValueAt(change.row, change.column, change.newValue);
        if (this.isMiniTable) {
            // forceRefreshRelationsPanel() はパネル全体を再構築して編集中のミニEditorTable自身を
            // 破棄してしまうため、左ペインの参照ヒントのみ更新する
            if (this.relationsPanel !== false) this.relationsPanel.notifyMiniTableCellChanged();
        } else {
            this.forceRefreshRelationsPanel();
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

    /** 逆参照ヒントを更新する。解決完了後にRelationsPanelも再描画する */
    updateReverseReferenceHints(map: ReverseReferenceMap): void {
        this.reference.updateReverseReferenceHints(map);
        // 逆参照マップの非同期解決が完了した時点で、RelationsPanelの1:Nエントリを描画できるようになる。
        // 初回テーブル展開時は forceNotifyRelationsPanel() が先に走り、逆参照マップが未設定のため
        // 1:Nエントリが0件になる。ここで再描画することで1:Nも表示される。
        this.forceRefreshRelationsPanel();
    }

    /** 逆参照マップにエントリが存在するか判定する */
    hasReverseReferences(): boolean {
        return this.reference.hasReverseReferences();
    }

    /** 参照先列の値から逆参照エントリを取得する */
    getReverseReferenceEntries(columnValue: string): ReverseReferenceEntry[] {
        return this.reference.getReverseReferenceEntries(columnValue);
    }

    /** 逆参照マップ内で使われている全 parentColumnName の集合を返す */
    getAllParentColumnNames(): Set<string> {
        return this.reference.getAllParentColumnNames();
    }

    /** 指定行の指定列名のセル値を取得する。列が存在しない場合は空文字列を返す */
    getCellValueByColumnName(rowIndex: number, columnName: string): string {
        return this.reference.getCellValueByColumnName(rowIndex, columnName);
    }

    /** 行のPK値を取得する */
    getRowPkValue(rowIndex: number): string {
        return this.reference.getRowPkValue(rowIndex);
    }

    /**
     * 指定した列名の列をCSSで視覚的に非表示にする（N:1リレーションのPK列隠蔽に使用）
     *
     * データ構造（tableData.header・ストア）は変更しないため、
     * getRowPkValue() や updateCellValueAt() が引き続き正常に動作する。
     *
     * 実装: 列ヘッダー行から列名で対象の列インデックス（1始まり、行ヘッダーが0）を特定し、
     * テーブルの全行の該当セルに display:none を適用する。
     * display:table-cell を none にするとテーブルレイアウトが自動再計算され列が消える。
     */
    hideColumnsByName(columnNames: string[]): void {
        const tableElement = this.element;
        if (tableElement.children.length === 0) return;
        // 列ヘッダー行（children[0]）から対象列のDOM列インデックス（行ヘッダー含む1始まり）を収集する
        const headerRow = tableElement.children[0] as HTMLElement;
        const hiddenDomIndices: number[] = [];
        for (let domCol = 1; domCol < headerRow.children.length; domCol++) {
            const headerCell = headerRow.children[domCol] as HTMLElement;
            // テキストノードのみを連結してヘッダーテキストを取得する（参照ヒントspanを無視）
            const headerText = Array.from(headerCell.childNodes)
                .filter(n => n.nodeType === Node.TEXT_NODE)
                .map(n => String(n.textContent))
                .join('');
            if (columnNames.includes(headerText)) {
                hiddenDomIndices.push(domCol);
            }
        }
        if (hiddenDomIndices.length === 0) return;
        // 全行（ヘッダー行含む）の該当DOM列インデックスのセルを非表示にする
        for (let rowIdx = 0; rowIdx < tableElement.children.length; rowIdx++) {
            const row = tableElement.children[rowIdx] as HTMLElement;
            for (const domCol of hiddenDomIndices) {
                const cell = row.children[domCol] as HTMLElement;
                if (cell) cell.style.display = 'none';
            }
        }
    }

    /**
     * 動的参照のvalueColumn名から列インデックスを解決する
     */
    resolveValueColumnIndex(valueColumnName: string, currentDataColumnIndex: number): number {
        return this.reference.resolveValueColumnIndex(valueColumnName, currentDataColumnIndex);
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
