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
import {GitDiffTracker} from "./git-diff-tracker";
import {gitStatusAsync, gitShowAsync, GitStatusResult} from "./api";
import {ColumnSorter} from "./column-sorter";
import {ColumnFilter} from "./column-filter";
import {FilterDropdown} from "./filter-dropdown";

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
    /** git差分トラッカー（connectGitDiffTrackerで設定される。未設定はfalse） */
    private gitDiffTracker: GitDiffTracker | false;
    /** refreshGitDiffAsync のレースコンディション防止用リクエストID */
    private refreshGitDiffRequestId: number;
    /** 列ソート管理（ミニテーブルでは使用しないが、インスタンスは常に保持する） */
    private readonly columnSorter: ColumnSorter;
    /** 列フィルター管理（ミニテーブルでは使用しないが、インスタンスは常に保持する） */
    private readonly columnFilter: ColumnFilter;
    /** フィルタードロップダウン UI（ミニテーブルでは使用しない。initializeModules() で再作成される） */
    private filterDropdown: FilterDropdown;
    /** 行数カウンター要素（フィルター適用中に「X / Y 行」を表示する） */
    private readonly filterRowCountElement: HTMLElement;

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
     * 最後にRelationsPanelへ通知したフォーカス行インデックス（重複通知防止用）。
     * 非ミニテーブルのみ使用する（ミニテーブルは常に通知する）。
     * forceRefreshRelationsPanel() は refreshCurrentRow() を直接呼ぶためこの値を変更しない。
     */
    private lastNotifiedRow: number;
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
        this.gitDiffTracker = false;
        this.refreshGitDiffRequestId = 0;
        this.autoFillEntries = [];
        this.lastNotifiedRow = -1;
        // initialize() で初期化される
        this.storeRowIndices = [];
        this.columnSorter = new ColumnSorter(this, store);
        this.columnFilter = new ColumnFilter();
        this.filterDropdown = new FilterDropdown(this, this.columnFilter);
        this.filterRowCountElement = document.createElement('div');
        this.filterRowCountElement.classList.add('filter-row-count');
        this.filterRowCountElement.style.display = 'none';
        this.selectionDragController = new SelectionDragController(
            this.element,
            selection,
            scrollBinding
        );
    }

    /**
     * 分割先モジュールを生成・注入する
     * Object.assign後に呼び出すことで、thisがプロキシオブジェクトを指す。
     *
     * FilterDropdown はコンストラクタで `this`（realEditorTable）を参照して生成される。
     * Object.assign でプロキシオブジェクト（editorTable）に内容がコピーされた後も
     * filterDropdown.table は realEditorTable を指したままになる。
     * realEditorTable は initialize() が呼ばれないため storeRowIndices = [] のままとなり、
     * applyFilterDisplay() で全行が制御されず行数カウンターが「0 / 0 行」になるバグを引き起こす。
     * そのため initializeModules() で FilterDropdown を正しい this（editorTable）で再作成する。
     */
    initializeModules(): void {
        this.reference = new EditorTableReference(this, this.tableData, this.referenceDataCache);
        this.contextMenuHandler = new EditorTableContextMenu(this, this.selection, this.contextMenu);
        this.structure = new EditorTableStructure(this, this.selection, this.history, this.areaResizer);
        // コンストラクタで生成した旧 FilterDropdown を破棄してから正しい this（プロキシオブジェクト）で再作成する。
        // 旧インスタンスは realEditorTable（storeRowIndices=[]）を参照しているため破棄が必要。
        // destroy() を呼ばないと document.mousedown リスナーが蓄積してメモリリークになる。
        this.filterDropdown.destroy();
        this.filterDropdown = new FilterDropdown(this, this.columnFilter);
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

    /** 内部モジュール用: 自テーブルの参照データキャッシュを無効化する（行追加・削除後に呼ぶ） */
    evictOwnReferenceDataCache(): void { this.referenceDataCache.evictEntry(this.tableName); }

    // =========================================================================
    // ライフサイクル
    // =========================================================================

    /**
     * テーブル要素を親要素に追加する
     */
    appendTo(parent: HTMLElement): void {
        parent.appendChild(this.element);
        // 行数カウンターはテーブルの直後に配置する
        parent.appendChild(this.filterRowCountElement);
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
            // comment 付き列が1つでもある場合、ヘッダー行は2行分の高さになるためコーナーセルも合わせる
            const hasComment = this.tableData.header.some(col => col.comment !== null);
            if (hasComment) {
                cornerCell.style.height = `calc(${DEFAULT_ROW_HEIGHT} * 2)`;
                cornerCell.style.minHeight = `calc(${DEFAULT_ROW_HEIGHT} * 2)`;
                cornerCell.style.maxHeight = 'none';
            } else {
                EditorTable.applyCellHeight(cornerCell, DEFAULT_ROW_HEIGHT);
            }
            // コーナーセルクリックで全選択
            cornerCell.addEventListener('mousedown', () => {
                this.handler.submitAndHide();
                this.selection.selectAll();
            });
            cells.push(cornerCell);
            // 列ヘッダー (A, B, C, ...)
            for (let i = 0; i < this.tableData.header.length; ++i) {
                // comment がある列は上段にcomment、下段に変数名の2行ヘッダーを生成する
                const col = this.tableData.header[i];
                const isPrimaryKey = this.tableData.primaryKeyColumns.includes(col.name);
                const columnHeaderCell = this.structure.createColumnHeaderCell(col.name, col.comment, i, col.width, isPrimaryKey, col.reference);
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
            // ソート時にstoreRowIndexからDOM行要素を逆引きするためのインデックスを付与する
            row.dataset.storeIndex = String(i);
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
            // バッファ行（ユーザーが直接挿入した行と区別するための識別クラス）
            row.classList.add('editor-table-empty-row');
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
        // 初期表示時にPK重複を検出してセルにクラスを付与する
        this.validatePkDuplicates();
    }

    /**
     * グローバルイベントリスナーを登録する（タブがアクティブになったとき）
     * 視覚状態（editor-table--inactive クラス）は setInactiveAppearance() に一本化しているため、
     * ここでは操作しない。タブ復帰時に resume() で全ミニテーブルに activate() が呼ばれても
     * 非アクティブクラスが意図せず除去されるバグを防ぐためにこの分離が必要。
     */
    activate(): void {
        this.selectionDragController.activate();
        this.scrollBinding.activate();
    }

    /**
     * グローバルイベントリスナーを解除する（タブが非アクティブになったとき）
     * 視覚状態（editor-table--inactive クラス）は setInactiveAppearance() に一本化しているため、
     * ここでは操作しない。
     */
    deactivate(): void {
        this.handler.deactivate();
        this.selectionDragController.deactivate();
        this.scrollBinding.deactivate();
    }

    /**
     * アクティブ/非アクティブの視覚状態のみを切り替える
     * activateHandler() から複数の EditorTable に対して呼ばれる。
     * selectionDragController・scrollBinding は操作しない（handler の排他制御とは独立）。
     */
    setInactiveAppearance(inactive: boolean): void {
        if (inactive) {
            this.element.classList.add('editor-table--inactive');
        } else {
            this.element.classList.remove('editor-table--inactive');
        }
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
            // 編集中のセルを確定する（Ctrl+クリックでも通常クリックでも共通）
            table.handler.submitAndHide();
            // RelationsPanelが接続されている場合: このEditorTableのhandlerをアクティブ化し
            // 他の全EditorTableのhandlerをdeactivateする（フォーカスの排他制御）
            if (table.relationsPanel !== false) {
                table.relationsPanel.activateHandler(table);
            }
            // ミニテーブルのCtrl+クリックで自テーブルを左ペインで開く（ドリルダウン）
            // ペインスタック追加（navigateToDefinition）を先に行い、正しいRPに対して選択状態を設定する。
            // 逆順（selection.start → navigateToDefinition）だと古いRPに対してnotifyが走り無駄な処理が発生する。
            if ((e.ctrlKey || e.metaKey) && table.isMiniTableInstance()) {
                table.navigateToDefinition(position.row);
                table.selection.start(position.row, position.column);
                e.preventDefault();
                return;
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
     * 列ヘッダーの値を取得する。
     * comment付き2行構造では .column-header-name span から、それ以外は TextNode から取得する。
     */
    getColumnHeaderValue(columnIndex: number): string {
        const headerRow = this.element.children[0] as HTMLElement;
        const headerCell = headerRow.children[columnIndex + 1] as HTMLElement;
        // comment付き2行構造の場合は .column-header-name span を優先する
        const nameSpan = headerCell.querySelector('.column-header-name');
        if (nameSpan !== null) return nameSpan.textContent as string;
        for (const node of Array.from(headerCell.childNodes)) {
            if (node.nodeType === Node.TEXT_NODE) return node.textContent as string;
        }
        return '';
    }

    /**
     * 列ヘッダーの値を設定する。
     * comment付き2行構造では .column-header-name span を、それ以外は TextNode を更新する。
     */
    setColumnHeaderValue(columnIndex: number, value: string): void {
        const headerRow = this.element.children[0] as HTMLElement;
        const headerCell = headerRow.children[columnIndex + 1] as HTMLElement;
        // comment付き2行構造の場合は .column-header-name span を優先する
        const nameSpan = headerCell.querySelector('.column-header-name');
        if (nameSpan !== null) {
            nameSpan.textContent = value;
            return;
        }
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
     * ストアからセルデータを再読み込みし、DOMの行数・セル値をストアに完全同期する。
     * タブ切替時に呼び出され、他タブ（またはミニテーブル）でストアが変更された結果を反映する。
     *
     * 通常テーブルでは、まずDOMの行数をストアの行数に合わせて増減し storeRowIndices を [0..n-1] に更新する。
     * ミニテーブルはフィルタ条件を持つため DOM 行数同期は行わず、セル値の更新のみ行う。
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

        // 通常テーブルのみ: DOMの行数とストアの行数を同期し、storeRowIndices を [0..storeRows.length-1] に更新する。
        // ミニテーブルはフィルタ済みのサブセットを表示しており、ストア全行との同期は不適切なため除外する。
        // ミニテーブルは destroyMiniEditorTables()/buildMiniEditorTableAsync() で都度再構築されるため問題なし。
        let domRowCountChanged = false;
        if (!this.isMiniTable) {
            const currentDataRowCount = this.storeRowIndices.length;
            if (storeRows.length > currentDataRowCount) {
                // ストアの方が多い: バッファ空行を昇格してデータ行に変換し、足りなければ新規行を挿入する
                for (let i = currentDataRowCount; i < storeRows.length; i++) {
                    const domRowIndex = i + 1; // 列ヘッダー行を含む DOM インデックス
                    const existingRow = this.element.children[domRowIndex] as HTMLElement | null;
                    if (existingRow && existingRow.classList.contains('editor-table-empty-row')) {
                        // バッファ空行をデータ行に昇格する（editor-table-empty-row クラスを除去）
                        existingRow.classList.remove('editor-table-empty-row');
                        existingRow.dataset.row = String(domRowIndex);
                        // ソート時のstoreRowIndex逆引きのためのインデックスを付与する
                        existingRow.dataset.storeIndex = String(i);
                    } else {
                        // バッファ空行が不足している場合は新規行を生成して挿入する
                        const cells: HTMLElement[] = [this.structure.createRowHeaderCell(String(domRowIndex), i)];
                        for (let j = 0; j < domColumnCount; j++) {
                            cells.push(EditorTable.createCell(this, '', j, this.getColumnWidth(j), DEFAULT_ROW_HEIGHT));
                        }
                        const newRow = EditorTable.createRow(cells, domRowIndex);
                        // ソート時のstoreRowIndex逆引きのためのインデックスを付与する
                        newRow.dataset.storeIndex = String(i);
                        const insertTarget = this.element.children[domRowIndex];
                        if (insertTarget) {
                            this.element.insertBefore(newRow, insertTarget);
                        } else {
                            this.element.appendChild(newRow);
                        }
                    }
                    this.storeRowIndices.push(i);
                }
                domRowCountChanged = true;
            } else if (storeRows.length < currentDataRowCount) {
                // ストアの方が少ない: 末尾のデータ行をDOMから除去する（バッファ空行は維持する）
                for (let i = currentDataRowCount - 1; i >= storeRows.length; i--) {
                    const domRowIndex = i + 1; // 列ヘッダー行を含む DOM インデックス
                    const rowToRemove = this.element.children[domRowIndex] as HTMLElement | null;
                    // 通常テーブルで削除対象がnullまたはバッファ空行である場合は設計上の不整合
                    if (!rowToRemove || rowToRemove.classList.contains('editor-table-empty-row')) {
                        throw new Error('[EditorTable.reloadCellsFromStore] DOM行とストアの不整合: 削除対象行が存在しないか空行です。 domRowIndex=' + domRowIndex);
                    }
                    rowToRemove.remove();
                    this.storeRowIndices.splice(i, 1);
                }
                domRowCountChanged = true;
            }
        }

        // DOM行数が変化した場合は全行の data-row 属性・行ヘッダーテキスト・リサイズハンドルを再ナンバリングする。
        // insertRowInternal/deleteRow では挿入・削除位置以降の行のみ再ナンバリングするが、
        // reloadCellsFromStore では複数行が一括で増減する可能性があるため、データ行先頭（domIndex=1）から全行を対象とする。
        if (domRowCountChanged) this.structure.renumberRowsFrom(1);

        // storeRowIndices[domDataRow] → storeRow のマッピングで各DOMデータ行のセル値を更新する。
        // 通常テーブルは上記の同期後に storeRowIndices[i]=i が保証される。
        // ミニテーブルは filteredRows のストアインデックスを正しく参照できる。
        for (let domDataRow = 0; domDataRow < this.storeRowIndices.length; domDataRow++) {
            const domRow = domDataRow + 1; // DOMは1始まり（列ヘッダー行がある）
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

        // DOM行数が変化した場合はコピー範囲を無効化し、選択描画を更新する（範囲が行数外を指す可能性があるため）
        if (domRowCountChanged) {
            this.selection.clearCopyRange();
            this.selection.updateRendererAfterResize();
        }
        // DOM行の増減に関わらず git差分ハイライトを再評価する（ストアとDOMのマッピングが変化するため）
        this.applyGitDiffHighlight();
        // タブ切替後のDOMリロードでもPK重複の赤波線を再適用する
        this.validatePkDuplicates();
        // reloadCellsFromStore はストアデータを全面的に上書きするため、ソート状態を維持しても
        // storeRowIndices が [0..n-1] にリセットされておりソートが無効化されている。
        // インジケーターをリセットしてUI上のソート表示と実態を一致させる。
        this.columnSorter.clearAllSorts();
        this.updateAllSortIndicators();
        // タブ切替時にフィルター状態が前回タブのままだと整合性が崩れるためリセットする。
        // ソートリセットと対称に、フィルター状態も UI と実態を一致させる。
        this.clearFilterState();
    }

    // =========================================================================
    // バッファ空行の昇格・降格
    // =========================================================================

    /**
     * バッファ空行をストアに昇格する（PromoteBufferRowCommandのexecute用）
     *
     * emptyRowCount 領域の行（storeRowIndices 外）に初めてデータが入力されるとき、
     * ストアに空行を追加して storeRowIndices を拡張し、editor-table-empty-row クラスを除去する。
     * 呼び出し前に domDataRowIndex が storeRowIndices.length 以上であることを確認すること。
     *
     * @param domDataRowIndex DOMデータ行インデックス（0始まり、列ヘッダー行を除く）
     */
    promoteBufferRowToStore(domDataRowIndex: number): void {
        const storeHeader = this.store.getHeader(this.tableName);
        if (storeHeader === false) throw new Error('[EditorTable.promoteBufferRowToStore] ストアにテーブルが登録されていません: ' + this.tableName);
        // ストア行の列数はDOMではなくストアのヘッダー長で決定する。
        // ミニテーブルはDOM列数がストアのサブセット（FK列を除く）のため getColumnCount() では不正になる。
        const storeColumnCount = storeHeader.length;
        // domDataRowIndex が storeRowIndices の末尾を超える場合、間の行も昇格する必要がある。
        // 例: storeRowIndices=[0,1,2] で domDataRowIndex=5 の場合、3,4,5 を順に追加する。
        const currentLength = this.storeRowIndices.length;
        for (let i = currentLength; i <= domDataRowIndex; i++) {
            // ストアの末尾に空行を追加（getHeader が false でない場合 getRows も必ず存在する）
            const storeRows = this.store.getRows(this.tableName);
            if (storeRows === false) throw new Error('[EditorTable.promoteBufferRowToStore] ストア行データが存在しません: ' + this.tableName);
            const storeRowIndex = storeRows.length;
            this.store.insertRowAt(this.tableName, storeRowIndex, Array(storeColumnCount).fill(''));
            this.storeRowIndices.push(storeRowIndex);
            // ソート中の場合、originalIndices も同期する（バッファ行昇格でストア行数が増えるため）
            this.columnSorter.notifyRowInserted(storeRowIndex);
            // DOMの該当行から editor-table-empty-row クラスを除去する（data行として昇格）
            const domRow = this.element.children[i + 1] as HTMLElement | null;
            if (domRow) {
                domRow.classList.remove('editor-table-empty-row');
                // ソート時のstoreRowIndex逆引きのためのインデックスを付与する
                domRow.dataset.storeIndex = String(storeRowIndex);
            }
        }
        // バッファ行昇格後にgit差分ハイライトを再評価する（新規昇格行は新規追加行として changed になる）
        this.applyGitDiffHighlight();
        // バッファ行がストアに昇格した後、参照データキャッシュを無効化する。
        // 昇格行のIDがキャッシュ構築後に入力された場合に古いキャッシュが参照されるのを防ぐ。
        this.evictOwnReferenceDataCache();
        // バッファ行昇格後にPK重複バリデーションを実行する（新規行のIDが既存と重複する可能性があるため）
        this.validatePkDuplicates();
        // フィルター適用中の場合は行数カウンターと表示/非表示を再計算する（新規昇格行がフィルター条件を満たさない可能性）
        this.refreshFilterDisplayIfActive();
    }

    /**
     * ストア行をバッファ空行に降格する（PromoteBufferRowCommandのundo用）
     *
     * 昇格した行を逆操作でストアから削除し、storeRowIndices を縮小し、
     * editor-table-empty-row クラスを復元する。
     * 昇格時に追加した末尾行だけを削除する（domDataRowIndex から末尾まで）。
     *
     * @param domDataRowIndex DOMデータ行インデックス（0始まり）。この行以降を降格する
     */
    demoteStoreRowToBuffer(domDataRowIndex: number): void {
        // domDataRowIndex 以降の全ての昇格行を末尾から逆順で削除する
        const currentLength = this.storeRowIndices.length;
        for (let i = currentLength - 1; i >= domDataRowIndex; i--) {
            const storeRowIndex = this.storeRowIndices[i];
            this.store.removeRow(this.tableName, storeRowIndex);
            this.storeRowIndices.splice(i, 1);
            // ソート中の場合、originalIndices も同期する（ストア行降格でストア行数が減るため）
            this.columnSorter.notifyRowDeleted(storeRowIndex);
            // DOMの該当行に editor-table-empty-row クラスを復元し、storeIndex 属性を削除する（promoteBufferRowToStore との対称性）
            const domRow = this.element.children[i + 1] as HTMLElement | null;
            if (domRow) {
                domRow.classList.add('editor-table-empty-row');
                delete domRow.dataset.storeIndex;
            }
        }
        // 降格後にgit差分ハイライトを再評価する（降格行のストアインデックスが変化するため）
        this.applyGitDiffHighlight();
        // ストア行降格後に参照データキャッシュを無効化する（Undo時に古いIDがドロップダウンに残るのを防ぐ）。
        this.evictOwnReferenceDataCache();
        // 降格によりPK重複が解消される可能性があるためバリデーションを再実行する
        this.validatePkDuplicates();
        // フィルター適用中の場合は行数カウンターと表示/非表示を再計算する（降格行の除去で表示行数が変化する）
        this.refreshFilterDisplayIfActive();
    }

    /**
     * 指定の domDataRowIndex がバッファ空行（ストア未登録）かどうかを判定する
     */
    isBufferRow(domDataRowIndex: number): boolean {
        return domDataRowIndex >= this.storeRowIndices.length;
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
     * ソート中に行が挿入されたことをColumnSorterに通知する（EditorTableStructureから呼ばれる）
     */
    notifySortRowInserted(storeRowIndex: number): void { this.columnSorter.notifyRowInserted(storeRowIndex); }

    /**
     * ソート中に行が削除されたことをColumnSorterに通知する（EditorTableStructureから呼ばれる）
     */
    notifySortRowDeleted(storeRowIndex: number): void { this.columnSorter.notifyRowDeleted(storeRowIndex); }

    /**
     * ソート状態をリセットしてインジケーターを更新する。
     * 列挿入/削除時に列インデックスが陳腐化するためEditorTableStructureから呼ばれる。
     */
    clearSortState(): void {
        this.columnSorter.clearAllSorts();
        this.updateAllSortIndicators();
    }

    /**
     * フィルター状態をリセットして表示を更新する。
     * 列挿入/削除時（列インデックス陳腐化）やタブ切替時（前回タブの状態リセット）に呼ばれる。
     */
    clearFilterState(): void {
        // フィルターが適用されていない場合は何もしない（不要な selection.updateRendererAfterResize() を防ぐ）
        if (!this.columnFilter.hasActiveFilter()) return;
        this.columnFilter.clearAllFilters();
        this.applyFilterDisplay();
    }

    /**
     * フィルターが適用中の場合のみ applyFilterDisplay() を呼ぶ。
     * 行挿入/削除/バッファ行昇格/降格後に EditorTableStructure から呼ばれる。
     * フィルター未適用時はコストのかかる DOM 操作を行わない。
     */
    refreshFilterDisplayIfActive(): void {
        if (this.columnFilter.hasActiveFilter()) this.applyFilterDisplay();
    }

    /**
     * 指定列のソートをトグルし、DOMの行順を更新する。
     * ソートはView変換のみ（ストア順序は変えない）。Undo/Redo対象外。
     * ミニテーブルでは呼ばれない（ソートインジケーターが存在しないため）。
     *
     * @param columnIndex DOMの列インデックス（0始まり、行ヘッダーなし）
     */
    applySortForColumn(columnIndex: number): void {
        // ColumnSorterにソートを委譲して新しいstoreRowIndicesを取得する
        const newIndices = this.columnSorter.toggleSort(columnIndex, this.storeRowIndices);
        this.storeRowIndices = newIndices;

        // data-store-index 属性を使ってストアインデックス → DOM行要素のマップを構築する。
        // initialize() や insertRowInternal, promoteBufferRowToStore で付与済み。
        const storeIndexToRowElement = new Map<number, HTMLElement>();
        const totalRows = this.element.children.length;
        for (let domIdx = 1; domIdx < totalRows; domIdx++) {
            const row = this.element.children[domIdx] as HTMLElement;
            if (row.classList.contains('editor-table-empty-row')) continue;
            if (!row.hasAttribute('data-store-index')) continue;
            storeIndexToRowElement.set(Number(row.dataset.storeIndex), row);
        }

        // バッファ行の先頭要素を取得しておく（insertBefore の基準点として使用）
        const firstEmptyRow = this.element.querySelector('.editor-table-empty-row');
        // newIndices の順序でデータ行を親に再挿入する（insertBefore でバッファ行の前に配置）
        for (const storeIdx of newIndices) {
            const row = storeIndexToRowElement.get(storeIdx);
            if (!row) throw new Error('[EditorTable.applySortForColumn] storeIdx に対応するDOM行が存在しません: ' + storeIdx);
            if (firstEmptyRow) {
                this.element.insertBefore(row, firstEmptyRow);
            } else {
                this.element.appendChild(row);
            }
        }

        // 並び替え後に全データ行の data-row 属性・行ヘッダーテキスト・リサイズハンドルを再設定する
        this.structure.renumberRowsFrom(1);
        // DOM行順序が変わったため選択オーバーレイの描画位置を再計算する
        this.selection.updateRendererAfterResize();

        // 全列ヘッダーのソートインジケーターを更新する
        this.updateAllSortIndicators();

        // ソート後もフィルター状態を維持する（フィルター適用中の場合は表示/非表示を再計算する）
        this.refreshFilterDisplayIfActive();
    }

    /**
     * 現在の ColumnFilter 状態に基づいてデータ行の display を切り替え、
     * フィルタークラスと行数カウンターを更新する。
     * FilterDropdown の適用・クリア時と、ソート変更時・行挿入削除時に呼ばれる。
     */
    applyFilterDisplay(): void {
        const storeRows = this.store.getRows(this.tableName);
        if (storeRows === false) return;

        // フィルター未適用時は全行表示にして行数カウンターを非表示にし早期 return する
        if (!this.columnFilter.hasActiveFilter()) {
            for (let domDataRow = 0; domDataRow < this.storeRowIndices.length; domDataRow++) {
                (this.element.children[domDataRow + 1] as HTMLElement).style.display = '';
            }
            this.updateFilterActiveClasses();
            this.filterRowCountElement.style.display = 'none';
            this.selection.updateRendererAfterResize();
            return;
        }

        // フィルター条件に一致するストアインデックスのセットを構築する
        const filteredSet = new Set(this.columnFilter.computeFilteredIndices(this.storeRowIndices, storeRows));

        let visibleCount = 0;
        const totalCount = this.storeRowIndices.length;

        // 各データ行の display を更新する（バッファ空行は対象外）
        // DOM行は initialize() と reloadCellsFromStore() でストア行と必ず対応するため null チェック不要
        for (let domDataRow = 0; domDataRow < this.storeRowIndices.length; domDataRow++) {
            const storeRowIndex = this.storeRowIndices[domDataRow];
            const domRow = this.element.children[domDataRow + 1] as HTMLElement;
            if (filteredSet.has(storeRowIndex)) {
                domRow.style.display = '';
                visibleCount++;
            } else {
                domRow.style.display = 'none';
            }
        }

        // フィルターアクティブクラスをヘッダーセルに付与/除去する
        this.updateFilterActiveClasses();

        // 行数カウンターを更新する
        this.filterRowCountElement.textContent = `${visibleCount} / ${totalCount} 行`;
        this.filterRowCountElement.style.display = 'block';

        // 行の display 変更後に選択オーバーレイの描画位置を再計算する（非表示行にまたがる選択を解消）
        this.selection.updateRendererAfterResize();
    }

    /**
     * 全列ヘッダーのフィルタークラス（.filter-active）を現在のフィルター状態に合わせて更新する。
     */
    private updateFilterActiveClasses(): void {
        const headerRow = this.element.children[0];
        const columnCount = this.getColumnCount();
        for (let colIdx = 0; colIdx < columnCount; colIdx++) {
            const headerCell = headerRow.children[colIdx + 1] as HTMLElement;
            if (this.columnFilter.isColumnFiltered(colIdx)) {
                headerCell.classList.add('filter-active');
            } else {
                headerCell.classList.remove('filter-active');
            }
        }
    }

    /**
     * フィルタードロップダウンを指定列用に開く（EditorTableStructureのフィルターアイコンクリックから使用）。
     * デメテルの法則に従い、EditorTable が FilterDropdown を隠蔽して操作する。
     *
     * @param columnIndex 対象列インデックス（0始まり、行ヘッダー除く）
     * @param anchorElement フィルターアイコン要素（位置決め用）
     */
    openFilterDropdown(columnIndex: number, anchorElement: HTMLElement): void {
        this.filterDropdown.open(columnIndex, anchorElement);
    }

    /**
     * 全列ヘッダーのソートインジケーターを現在のソート状態に合わせて更新する。
     * - ソートされていない列: sort-asc/sort-desc クラスなし、優先度なし
     * - ソートされた列: sort-asc または sort-desc クラスを付与、優先度番号を表示
     */
    private updateAllSortIndicators(): void {
        const headerRow = this.element.children[0];
        const columnCount = this.getColumnCount();
        const totalSortKeyCount = this.columnSorter.getSortKeyCount();
        for (let colIdx = 0; colIdx < columnCount; colIdx++) {
            const headerCell = headerRow.children[colIdx + 1] as HTMLElement;
            const indicator = headerCell.querySelector('.sort-indicator');
            if (!indicator) continue;
            const sortKey = this.columnSorter.getSortKeyForColumn(colIdx);
            const priority = this.columnSorter.getPriorityForColumn(colIdx);
            // ソートクラスを更新
            headerCell.classList.remove('sort-asc', 'sort-desc');
            if (sortKey) {
                headerCell.classList.add(sortKey.direction === 'asc' ? 'sort-asc' : 'sort-desc');
            }
            // 優先度番号を更新（全ソートキー数が1の場合は番号なし）
            const prioritySpan = indicator.querySelector('.sort-priority');
            if (prioritySpan) {
                prioritySpan.textContent = (sortKey && totalSortKeyCount > 1) ? String(priority) : '';
            }
        }
    }

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
     * ミニテーブル専用: Ctrl+クリックまたはF12でミニテーブル自身のテーブルを左ペインで開く。
     * 呼び出し元（mousedownハンドラ・F12キーハンドラ）でミニテーブル判定済みのため、
     * ここではrelationsPanelの存在確認とPK値取得のみ行う。
     */
    navigateToDefinition(row: number): void {
        if (this.relationsPanel === false) return;
        if (!this.isMiniTable) return;
        const pkValue = this.getRowPkValue(row);
        if (pkValue === '') return;
        this.relationsPanel.navigateToDefinition(this.tableName, pkValue);
    }

    // =========================================================================
    // RelationsPanel 連携
    // =========================================================================

    /** 行選択が変化したときにRelationsPanelへ通知する（Selectionから呼ばれる） */
    notifyRowSelectionChanged(rowIndex: number): void {
        if (this.relationsPanel === false) return;
        if (this.isMiniTable) {
            // ミニテーブルの場合: 常に通知する（異なるミニテーブル間の切り替えを正しく検知するため、
            // 行番号による重複スキップは行わない）
            const pkValue = this.getRowPkValue(rowIndex);
            if (pkValue === '') return;
            this.relationsPanel.notifyMiniTableRowSelectionChanged(this.tableName, pkValue);
            return;
        }
        // 非ミニテーブルの場合: 同一行インデックスへの重複通知を防止してパフォーマンスを保護する
        if (rowIndex === this.lastNotifiedRow) return;
        this.lastNotifiedRow = rowIndex;
        this.relationsPanel.updateForRow(rowIndex);
    }

    /**
     * セル値変更後にRelationsPanelを強制再描画する（同一行リフレッシュ）。
     * paneStack はリセットしない。lastNotifiedRow も更新しない（次の行変更で正しく検知するため維持する）。
     * 行を変更しない操作（セル編集後・逆参照マップ更新後など同一行のリフレッシュ）からのみ呼ぶこと。
     * 行変更を伴う操作では notifyRowSelectionChanged() を通じて updateForRow() を呼ぶこと。
     */
    forceRefreshRelationsPanel(): void {
        if (this.relationsPanel === false) return;
        // refreshCurrentRow は paneStack をリセットしないため、
        // セル編集後に定義ジャンプで開いた追加RPが破棄されない
        this.relationsPanel.refreshCurrentRow(this.selection.getFocus().row);
    }

    // =========================================================================
    // git差分ハイライト
    // =========================================================================

    /**
     * git差分トラッカーを接続する
     * refreshGitDiffAsync内からのみ呼ばれる
     */
    private connectGitDiffTracker(tracker: GitDiffTracker): void {
        this.gitDiffTracker = tracker;
    }

    /**
     * 1セル分のgit差分ハイライトを更新する
     * gitDiffTracker が設定済み（false でない）であることを呼び出し側で保証すること
     */
    private updateSingleCellGitHighlight(cell: HTMLElement, storeRows: string[][], storeRowIndex: number, columnIndex: number): void {
        if ((this.gitDiffTracker as GitDiffTracker).isCellChanged(storeRows, storeRowIndex, columnIndex)) {
            cell.classList.add('cell-git-changed');
        } else {
            cell.classList.remove('cell-git-changed');
        }
    }

    /**
     * 全データセルを走査し、gitのHEAD版との差分に応じて .cell-git-changed クラスを付与/除去する。
     * テーブルオープン時・行挿入・削除・バッファ行昇格・降格・保存後に呼ばれる。
     * gitDiffTracker が false（未接続またはgit差分なし）の場合は全セルからクラスを除去して返す。
     */
    applyGitDiffHighlight(): void {
        const rowCount = this.getRowCount();
        const totalColCount = this.getTotalColumnCount();
        if (this.gitDiffTracker === false) {
            // git差分トラッカーが未接続 or 差分なし → 全セルからハイライトを除去する
            // （保存後にgit statusから差分が消えたケースに対応）
            for (let row = 1; row < rowCount; row++) {
                const rowElement = this.element.children[row] as HTMLElement;
                if (rowElement.classList.contains('editor-table-empty-row')) continue;
                for (let col = 1; col < totalColCount; col++) {
                    this.getCell(row, col).classList.remove('cell-git-changed');
                }
            }
            return;
        }
        const storeRows = this.store.getRows(this.tableName);
        if (storeRows === false) return;
        // row=1 から開始（row=0 は列ヘッダー行のため除外）
        for (let row = 1; row < rowCount; row++) {
            const rowElement = this.element.children[row] as HTMLElement;
            // バッファ空行（editor-table-empty-row クラスあり）はハイライト対象外
            if (rowElement.classList.contains('editor-table-empty-row')) continue;
            const domDataRowIndex = row - 1;
            if (domDataRowIndex >= this.storeRowIndices.length) continue;
            const storeRowIndex = this.storeRowIndices[domDataRowIndex];
            // col=1 から開始（col=0 は行ヘッダーセルのため除外）
            for (let col = 1; col < totalColCount; col++) {
                const cell = this.getCell(row, col);
                this.updateSingleCellGitHighlight(cell, storeRows, storeRowIndex, col - 1);
            }
        }
    }

    /**
     * git statusを再問い合わせし、このテーブルの GitDiffTracker を再構築して全セルのハイライトを再適用する。
     * テーブルオープン時および保存後（markSavedAndUpdatePanel）に呼ばれ、差分状態をセルに反映する。
     * ミニテーブルはgit diffハイライト不要のためスキップする。
     * git statusの取得に失敗した場合（git管理外環境等）は何もしない。
     */
    async refreshGitDiffAsync(): Promise<void> {
        // ミニテーブルはgit差分ハイライトを持たないため何もしない
        if (this.isMiniTable) return;
        const requestId = ++this.refreshGitDiffRequestId;
        let statusResult: GitStatusResult;
        try {
            statusResult = await gitStatusAsync();
        } catch (e) {
            // gitリポジトリでない環境や通信エラーでは差分ハイライト更新をスキップする
            console.warn('[EditorTable] refreshGitDiffAsync: git status の取得に失敗しました:', e);
            return;
        }
        // awaitで中断中に新しいリクエストが来た場合は処理を破棄する
        if (requestId !== this.refreshGitDiffRequestId) return;
        const entryIndex = statusResult.changes.findIndex(e => e.tableName === this.tableName);
        if (entryIndex === -1) {
            // changesに含まれない場合は差分なし → トラッカーをfalseにリセットして全ハイライトを除去する
            this.gitDiffTracker = false;
            this.applyGitDiffHighlight();
            return;
        }
        const entry = statusResult.changes[entryIndex];
        // PK列が定義されていない場合はハイライト不要（空キーで全行が一致扱いになるのを防ぐ）
        if (this.tableData.primaryKeyColumns.length === 0) {
            this.gitDiffTracker = false;
            this.applyGitDiffHighlight();
            return;
        }
        // 複合PKの全列インデックスを取得する（いずれか1列でも見つからない場合はハイライト不可）
        const pkColumnIndices: number[] = [];
        for (const pkColName of this.tableData.primaryKeyColumns) {
            const idx = this.tableData.header.findIndex(col => col.name === pkColName);
            if (idx === -1) {
                // PKカラムが見つからない場合はトラッカーをリセットして中途半端なハイライトを除去する
                this.gitDiffTracker = false;
                this.applyGitDiffHighlight();
                return;
            }
            pkColumnIndices.push(idx);
        }
        if (entry.isNew) {
            // HEADに存在しない新規テーブル → 全セルchanged
            const tracker = GitDiffTracker.createForNewTable(pkColumnIndices);
            this.connectGitDiffTracker(tracker);
        } else {
            // 既存テーブルの変更 → HEAD版CSVを取得してPKベースのマップを構築する
            let headCsv: string;
            try {
                headCsv = await gitShowAsync(entry.path);
            } catch (e) {
                console.warn('[EditorTable] refreshGitDiffAsync: HEAD版CSVの取得に失敗しました:', e);
                this.gitDiffTracker = false;
                this.applyGitDiffHighlight();
                return;
            }
            // awaitで中断中に新しいリクエストが来た場合は処理を破棄する
            if (requestId !== this.refreshGitDiffRequestId) return;
            const headRowMap = GitDiffTracker.buildHeadRowMap(headCsv, pkColumnIndices);
            const tracker = new GitDiffTracker(headRowMap, pkColumnIndices, false);
            this.connectGitDiffTracker(tracker);
        }
        // トラッカー再構築後に全セルのハイライトを一括再適用する
        this.applyGitDiffHighlight();
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
        // git差分ハイライトをこのセル1つ分だけ再評価する
        if (this.gitDiffTracker !== false) {
            const latestRows = this.store.getRows(this.tableName);
            if (latestRows !== false) {
                const cell = this.getCell(row, column);
                this.updateSingleCellGitHighlight(cell, latestRows, storeRowIndex, column - 1);
            }
        }
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
        // セル編集確定後にPK重複バリデーションを実行する（ストア全体で重複判定）
        this.validatePkDuplicates();
        // フィルター適用中にセル値が変更された場合、フィルター条件との整合性を再評価する
        this.refreshFilterDisplayIfActive();
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
        // Undo/Redo後にPK重複バリデーションを実行する（ストア全体で重複判定）
        this.validatePkDuplicates();
        // Undo/Redo後にフィルター条件との整合性を再評価する
        this.refreshFilterDisplayIfActive();
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

    /**
     * 逆参照ヒントを更新する。通常テーブルの場合のみRelationsPanelを再描画する。
     * ミニEditorTableの場合はパネル全体再構築を避ける（ミニテーブル自身が破棄されるため）。
     * 初回テーブル展開時は notifyRowSelectionChanged() が先に走り、逆参照マップが未設定のため
     * 1:Nエントリが0件になる。ここで forceRefreshRelationsPanel() を呼ぶことで1:Nも表示される。
     */
    updateReverseReferenceHints(map: ReverseReferenceMap): void {
        this.reference.updateReverseReferenceHints(map);
        if (!this.isMiniTable) {
            this.forceRefreshRelationsPanel();
        }
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
    public insertColumnInternal(columnIndex: number, comment: string | null): void {
        this.structure.insertColumnInternal(columnIndex, comment);
    }

    /**
     * 列ヘッダーのcommentを取得する。
     * 2行構造（comment付き）の場合は .column-header-comment span の textContent を返す。
     * comment なし（TextNode のみ）の場合は null を返す。
     */
    public getColumnHeaderComment(columnIndex: number): string | null {
        const headerRow = this.element.children[0] as HTMLElement;
        const headerCell = headerRow.children[columnIndex + 1] as HTMLElement;
        const commentSpan = headerCell.querySelector('.column-header-comment');
        if (commentSpan === null) return null;
        return commentSpan.textContent as string;
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

    // =========================================================================
    // PKバリデーション
    // =========================================================================

    /**
     * ストア全体のPK値を走査して重複を検出し、表示中のPKセルに cell-pk-duplicate クラスを適用する。
     *
     * ミニテーブルのフィルタで非表示になっている行も含め、ストア全体のデータで重複判定する。
     * これにより「ミニテーブルに表示されていない行」との重複も正しく検出できる。
     *
     * 空のPK値は重複チェックの対象外（未入力行は無視する）。
     */
    public validatePkDuplicates(): void {
        // PK列が定義されていない場合はバリデーション不要（全行が空キーで重複扱いになるのを防ぐ）
        if (this.tableData.primaryKeyColumns.length === 0) return;
        // ストアからPK列の全値を取得してカウントマップを構築する
        const storeHeader = this.store.getHeader(this.tableName);
        const storeRows = this.store.getRows(this.tableName);
        // 編集操作後にストアが存在しないのは設計上ありえないため例外を投げる
        if (storeHeader === false || storeRows === false) throw new Error('[EditorTable.validatePkDuplicates] ストアにテーブルが登録されていません: ' + this.tableName);

        // tableData.primaryKeyColumns を使い複合PKに対応する
        // 各PK列のストアインデックスを取得し、いずれか1つでも存在しなければバリデーション不要
        const pkColIndices: number[] = [];
        for (const pkColName of this.tableData.primaryKeyColumns) {
            const idx = storeHeader.indexOf(pkColName);
            if (idx === -1) return;
            pkColIndices.push(idx);
        }

        // 複合PKキー = GitDiffTracker.buildCompositeKey() で生成する（コピペ排除）
        // PK構成列のいずれかが空文字の場合はその行をスキップする（未入力行）
        const pkCounts = new Map<string, number>();
        for (const row of storeRows) {
            // PK構成列に空文字が含まれる行はカウント対象外（未入力行）
            let hasEmpty = false;
            for (const idx of pkColIndices) {
                if (row[idx] === '') { hasEmpty = true; break; }
            }
            if (hasEmpty) continue;
            const compositeKey = GitDiffTracker.buildCompositeKey(row, pkColIndices);
            if (pkCounts.has(compositeKey)) {
                pkCounts.set(compositeKey, pkCounts.get(compositeKey)! + 1);
            } else {
                pkCounts.set(compositeKey, 1);
            }
        }

        // getColumnHeaderValue() を使ってDOM上の各PK列インデックスを特定する
        // （手動でのDOM走査は .column-header-name span 付きのcomment列で誤マッチする危険があるため使わない）
        const domPkColIndices: number[] = [];
        const colCount = this.getColumnCount();
        for (const pkColName of this.tableData.primaryKeyColumns) {
            let found = -1;
            for (let c = 0; c < colCount; c++) {
                if (this.getColumnHeaderValue(c) === pkColName) {
                    found = c + 1; // 行ヘッダーを含むDOMインデックス
                    break;
                }
            }
            // PK列がDOMに存在しない（非表示テーブル等）はバリデーション不要
            if (found === -1) return;
            domPkColIndices.push(found);
        }

        // ループ上限をデータ行のみに制限してバッファ空行への不要なDOM走査を排除する
        // （rowIdx=1から開始するのは children[0] が列ヘッダー行のため）
        for (let rowIdx = 1; rowIdx <= this.storeRowIndices.length; rowIdx++) {
            const row = this.element.children[rowIdx] as HTMLElement | null;
            if (!row) continue;
            // この行の複合PKキーを構築する（空値があればスキップ）
            const pkParts: string[] = [];
            let hasEmpty = false;
            for (const domColIdx of domPkColIndices) {
                const cell = row.children[domColIdx] as HTMLElement | null;
                if (!cell) { hasEmpty = true; break; }
                const val = EditorTable.getCellValue(cell);
                if (val === '') { hasEmpty = true; break; }
                pkParts.push(val);
            }
            // 全PK構成列のセルを取得して重複クラスを更新する
            // pkParts はDOM上のPK列値のみを順番に持つ配列なので、インデックス [0,1,2,...] で buildCompositeKey に渡す
            const compositeKey = GitDiffTracker.buildCompositeKey(pkParts, pkParts.map((_, i) => i));
            const isDuplicate = !hasEmpty && pkCounts.has(compositeKey) && pkCounts.get(compositeKey)! > 1;
            for (const domColIdx of domPkColIndices) {
                const pkCell = row.children[domColIdx] as HTMLElement | null;
                if (!pkCell) continue;
                if (isDuplicate) {
                    pkCell.classList.add('cell-pk-duplicate');
                } else {
                    pkCell.classList.remove('cell-pk-duplicate');
                }
            }
        }
    }
}
