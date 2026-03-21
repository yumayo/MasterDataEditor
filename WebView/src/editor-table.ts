import {EditorTableData} from "./model/editor-table-data";
import {Selection, CellPosition} from "./selection";
import {EditorTableHandler} from "./editor-table-handler";
import {ContextMenu, ContextMenuEntry} from "./context-menu";
import {History} from "./history";
import {CellChange, RenderAsHtmlToggleCommand} from "./command";
import {AreaResizer} from "./area-resizer";
import {DEFAULT_ROW_HEIGHT, CELL_FONT, REFERENCE_HINT_FONT, REFERENCE_HINT_MARGIN_LEFT_PX, CELL_HORIZONTAL_EXTRA, MIN_COLUMN_WIDTH_PX} from "./constant";
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
import {ValidationPanel} from "./validation-panel";
import {ValidationError} from "./validation-engine";
import {DiffTab} from "./diff-tab";
import {GitDiffTracker} from "./git-diff-tracker";
import {gitStatusAsync, gitShowAsync, GitStatusResult} from "./api";
import {ColumnSorter} from "./column-sorter";
import {ColumnFilter} from "./column-filter";
import {FilterDropdown} from "./filter-dropdown";
import {Utility} from "./utility";
import {Tab} from "./tab";

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
    /** バリデーションパネル（Tab.createEditorTable内でconnectValidationPanel()で設定される。未設定はfalse） */
    private validationPanel: ValidationPanel | false;
    /** 差分タブ（DiffTab.buildDiffEditorTableで設定される。未設定はfalse） */
    diffTab: DiffTab | false;
    /**
     * Tabへの参照（Tab.createEditorTable後にconnectTabで設定される。未設定はfalse）
     * フォームビューの表示（showFormPanel）に使用する
     */
    tab: Tab | false;
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

    /** 空行数（データ行+バッファ1行） */
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
     * 最後にフォーカスクラスを付与したセルの行列（DOM座標）。
     * -1 は「まだフォーカスが当たったことがない」状態。
     * Selection.updateFocusedCellClass の代わりにEditorTable側でクラスを管理する（DOM要素の流出防止）。
     */
    private lastFocusedRow: number;
    private lastFocusedCol: number;
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
        this.validationPanel = false;
        this.diffTab = false;
        this.tab = false;
        this.gitDiffTracker = false;
        this.refreshGitDiffRequestId = 0;
        this.autoFillEntries = [];
        this.lastNotifiedRow = -1;
        this.lastFocusedRow = -1;
        this.lastFocusedCol = -1;
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

    /**
     * DOM列インデックス（0始まり）をストア（CSV）列インデックスに変換して返す。
     * 対応するCSV列が存在しない場合、または範囲外の場合は -1 を返す。
     * ColumnSorter・ColumnFilter・FilterDropdown などが columnMapping に直接触れないようにするファサード。
     */
    getStoreColumnIndex(domColumnIndex: number): number {
        const mapping = this.tableData.columnMapping;
        if (domColumnIndex < 0 || domColumnIndex >= mapping.length) return -1;
        return mapping[domColumnIndex];
    }

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
            cornerCell.addEventListener('mousedown', (e) => {
                // マウスサイドボタン（戻る/進む）はブラウザ履歴ナビゲーション専用のため無視する
                if (e.button !== 0) return;
                this.handler.submitAndHide();
                this.selection.selectAll();
            });
            cells.push(cornerCell);
            // 列ヘッダー (A, B, C, ...)
            for (let i = 0; i < this.tableData.header.length; ++i) {
                // comment がある列は上段に変数名、下段にcommentの2行ヘッダーを生成する
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
        // 全テーブルで storeRowIndices を初期化する（ミニテーブルはN:1・1:Nいずれも setStoreRowIndices() で上書き）
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
        // 初期表示時にバリデーションを実行してセルにエラークラスを付与する
        this.runValidation();
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

    /** DOMレイアウト完了後にSelectionの視覚位置を現在の内部状態に基づいて更新する */
    refreshSelectionDisplay(): void {
        this.selection.updateRendererAfterResize();
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

    /**
     * 行ヘッダーの位置を現在のscrollLeftに強制同期する。
     * display:none → display:'' でスクロール位置がリセットされた際に
     * scrollイベントが発火しないため、外部から明示的に呼び出す。
     */
    forceRowHeaderScrollSync(): void {
        this.lastScrollLeft = -1;
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
            // マウスサイドボタン（戻る/進む）はブラウザ履歴ナビゲーション専用のため無視する
            if (e.button !== 0) return;
            const position = EditorTable.getCellPosition(cell, table.element);
            if (!position) return;
            // 編集中のセルを確定する（Ctrl+クリックでも通常クリックでも共通）
            table.handler.submitAndHide();
            // フォーカスの排他制御: 接続先に応じて適切な activateHandler を呼び出す
            // RelationsPanel 接続時: 全ミニEditorTableを含む排他制御
            // DiffTab 接続時: 左右ペイン間の排他制御
            // どちらも未接続（通常テーブル単独）: 直接このhandlerをアクティブ化する
            if (table.relationsPanel !== false) {
                table.relationsPanel.activateHandler(table);
            } else if (table.diffTab !== false) {
                table.diffTab.activateHandler(table);
            } else {
                table.handler.activate();
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
            // PKセルかどうかを判定する（columnIndex はデータ列インデックス = 行ヘッダーを除いた0始まり）
            const col = table.tableData.header[columnIndex];
            const isPkColumn = col !== undefined && table.tableData.primaryKeyColumns.includes(col.name);
            const pkValue = table.getRowPkValue(position.row);
            // フォームビュー表示はPKセルかつPK値が空でない場合のみ表示する
            const canShowFormView = isPkColumn && pkValue !== '' && table.tab !== false;
            // 逆参照なし かつ フォームビューも表示しない場合はメニューを出さない
            if (allEntries.length === 0 && !canShowFormView) return;
            e.preventDefault();
            e.stopPropagation();
            // ドラグ状態をリセット
            table.selection.end();
            const menuItems: ContextMenuEntry[] = [];
            if (allEntries.length > 0) {
                menuItems.push({
                    label: '参照箇所を表示',
                    action: () => { table.sidebar.showReferences(pkValue, allEntries); },
                });
            }
            if (canShowFormView) {
                // クロージャ内で table.tab の型を Tab として保持する（型ガード後の型を維持するため）
                const tabRef = table.tab as Tab;
                menuItems.push({
                    label: 'フォームビューを表示',
                    action: () => { tabRef.showFormPanel(table.tableName, pkValue); },
                });
            }
            table.contextMenu.show(e.clientX, e.clientY, menuItems);
        });
        // renderAsHtml を考慮してセル値を設定する（初期レンダリング時にHTML描画を正しく適用）
        // value の実際の型は string のみ（body.values は string[]、バッファ行は '' を渡す）
        const strValue = value as string;
        // バッファ空行挿入時等で columnIndex がヘッダー範囲外になる場合は false（テキスト描画）でフォールバック
        const cellCol = table.tableData.header[columnIndex];
        table.reference.applyTextOrHtml(cell, strValue, cellCol ? cellCol.renderAsHtml : false);
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
     * renderAsHtml モードのセルは innerHTML でレンダリングされているため、
     * data-raw-value に保存した生テキストを返す。
     */
    static getCellValue(cell: HTMLElement): string {
        // renderAsHtml モードのセルは data-raw-value に生テキストが保存されている
        if (cell.dataset.rawValue !== undefined) return cell.dataset.rawValue;
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
     * セル要素を取得する（存在しない場合は null を返す）。
     * 内部のクラス操作で使用する。DOM要素を外部に流出させないこと。
     */
    private getCellOrNull(row: number, column: number): HTMLElement | null {
        const rowElement = this.element.children[row] as HTMLElement | null;
        if (!rowElement) return null;
        return rowElement.children[column] as HTMLElement | null;
    }

    /**
     * 指定セルに editor-table-cell-focused クラスを付与し、前のフォーカスセルから除去する。
     * Selection から呼ばれる（DOM要素の流出防止のため Selection 側でクラスを操作しない）。
     *
     * @param row DOM行インデックス（列ヘッダー行を含む: データ行1行目 = 1）
     * @param col DOM列インデックス（行ヘッダーを含む: データ列1列目 = 1）
     */
    markFocusedCell(row: number, col: number): void {
        // 前のフォーカスセルからクラスを除去する
        if (this.lastFocusedRow !== -1) {
            const prev = this.getCellOrNull(this.lastFocusedRow, this.lastFocusedCol);
            if (prev !== null) prev.classList.remove('editor-table-cell-focused');
        }
        const cell = this.getCellOrNull(row, col);
        if (cell !== null) {
            cell.classList.add('editor-table-cell-focused');
            this.lastFocusedRow = row;
            this.lastFocusedCol = col;
        }
    }

    /**
     * フォーカスクラスを除去する（タブ切り替えや初期化時に呼ぶ）。
     */
    clearFocusedCell(): void {
        if (this.lastFocusedRow !== -1) {
            const prev = this.getCellOrNull(this.lastFocusedRow, this.lastFocusedCol);
            if (prev !== null) prev.classList.remove('editor-table-cell-focused');
        }
        this.lastFocusedRow = -1;
        this.lastFocusedCol = -1;
    }

    /**
     * ValidationPanel を接続する（Tab.createEditorTable 内から呼ばれる）。
     * セッター禁止のため connectXxx パターンで相互参照を構築する。
     */
    connectValidationPanel(panel: ValidationPanel): void {
        this.validationPanel = panel;
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
     * 指定列の renderAsHtml トグルをコマンドとして実行する（Undo/Redo対応）。
     * コンテキストメニューからの呼び出し専用。列が存在しない場合は例外を投げる。
     * @param columnIndex 列インデックス（0始まり、行ヘッダーを除く）
     */
    executeRenderAsHtmlToggle(columnIndex: number): void {
        const col = this.tableData.header[columnIndex];
        if (!col) throw new Error(`[EditorTable] 列が見つかりません: columnIndex=${columnIndex}`);
        const cmd = new RenderAsHtmlToggleCommand(col, this, columnIndex);
        const anchor = this.selection.getAnchor();
        const copyRange = this.selection.getCopyRange();
        const range = {startRow: anchor.row, startColumn: anchor.column, endRow: anchor.row, endColumn: anchor.column};
        this.history.executeCommand(cmd, range, copyRange);
    }

    /**
     * 指定列の自動フィット幅を計算する。
     * 全データ行のセルテキスト幅と参照ヒント幅を Canvas API で計測し、
     * ヘッダー幅との最大値を返す。バッファ空行（editor-table-empty-row）は計算対象外。
     * ミニテーブルかどうかは this.isMiniTable で自動判定する。
     * @param columnIndex 列インデックス（0始まり、行ヘッダーを除く）
     */
    calculateAutoColumnWidth(columnIndex: number): string {
        const ctx = Utility.canvas.getContext('2d');
        if (ctx === null) throw new Error('Canvas 2D コンテキストの取得に失敗しました');

        // ヘッダー幅を基底値として取得（ミニテーブルはアイコンなし）
        const columnName = this.getColumnHeaderValue(columnIndex);
        const headerWidthStr = Utility.calculateColumnWidth(columnName, !this.isMiniTable);
        let maxWidth = parseFloat(headerWidthStr);

        // 全データ行（バッファ空行を除く）のセル幅を計測
        const rowCount = this.element.children.length;
        for (let rowIdx = 1; rowIdx < rowCount; rowIdx++) {
            const rowElement = this.element.children[rowIdx] as HTMLElement;
            // バッファ空行はスキップ
            if (rowElement.classList.contains('editor-table-empty-row')) continue;

            // 列ヘッダーセルを除いた列インデックス（columnIndex+1 が DOM上の位置）
            const cell = rowElement.children[columnIndex + 1] as HTMLElement | undefined;
            if (!cell) continue;

            // セルテキスト値の幅を計測
            const cellValue = EditorTable.getCellValue(cell);
            ctx.font = CELL_FONT;
            const textWidth = ctx.measureText(cellValue).width;

            // 参照ヒント幅を計測（通常参照ヒント・逆参照ヒントのどちらも対象）
            const hintElement = cell.querySelector('.cell-reference-hint, .cell-reverse-reference-hint') as HTMLElement | null;
            let hintWidth = 0;
            if (hintElement !== null) {
                ctx.font = REFERENCE_HINT_FONT;
                hintWidth = ctx.measureText(hintElement.textContent as string).width + REFERENCE_HINT_MARGIN_LEFT_PX;
            }

            // セル全体の占有幅 = テキスト幅 + ヒント幅 + パディング
            const cellTotalWidth = Math.ceil(textWidth + hintWidth) + CELL_HORIZONTAL_EXTRA;
            if (cellTotalWidth > maxWidth) maxWidth = cellTotalWidth;
        }

        return `${Math.max(maxWidth, MIN_COLUMN_WIDTH_PX)}px`;
    }

    /**
     * 差分ビュー用パディング行を生成して返す。
     * 左ペインの行数を右ペインに合わせるために挿入する「穴埋め専用の空行」として使用する。
     * イベントリスナー（dblclick・mousedown・contextmenu・row-resize-handle）は不要かつ有害なため、
     * createCell / createRowHeaderCell を使わず軽量な空div を直接生成する。
     * DiffTab固有のクラス（diff-row-empty・diff-row-padding-inserted）の付与は呼び出し側の責務であり、
     * ここでは付与しない（SRP遵守）。
     * @param rowIndex DOM行インデックス（data-row 属性に設定する値）
     */
    createPaddingRow(rowIndex: number): HTMLElement {
        const columnCount = this.getColumnCount();
        const rowHeaderCell = document.createElement('div');
        rowHeaderCell.classList.add('editor-table-cell', 'editor-table-row-header');
        // 行番号テキストを設定する（renumberLeftRows のテキストノード更新対象になるため必須）
        rowHeaderCell.textContent = String(rowIndex);
        // data-rowIndex を設定する（通常行ヘッダーと同様に設定してコンテキストメニュー等が参照できるようにする）
        rowHeaderCell.dataset.rowIndex = String(rowIndex - 1);
        EditorTable.applyCellHeight(rowHeaderCell, DEFAULT_ROW_HEIGHT);
        const cells: HTMLElement[] = [rowHeaderCell];
        for (let j = 0; j < columnCount; j++) {
            const cell = document.createElement('div');
            cell.classList.add('editor-table-cell');
            cell.dataset.col = String(j);
            EditorTable.applyCellWidth(cell, this.getColumnWidth(j));
            EditorTable.applyCellHeight(cell, DEFAULT_ROW_HEIGHT);
            cells.push(cell);
        }
        return EditorTable.createRow(cells, rowIndex);
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
        // ストアとのDOMリロード後も末尾に1行バッファ行を保持する（他経路と同一ガード条件）。
        // ミニテーブルは都度再構築（destroyMiniEditorTables/buildMiniEditorTableAsync）のため到達しないが、
        // promoteBufferRowToStore/demoteStoreRowToBuffer/deleteRow と条件を統一する。
        if (this.diffTab === false) this.ensureTrailingBufferRow();

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
        // タブ切替後のDOMリロードでもバリデーションエラークラスを再適用する。
        // バリデーションを再実行すると参照先テーブルが閉じられている場合にFKエラーが消えてしまうため、
        // ValidationPanel の currentErrors から自テーブル分だけを取り出してDOMクラスを再適用する。
        // ミニテーブルは都度 buildMiniEditorTableAsync で再構築されるため対象外。
        if (this.validationPanel !== false && !this.isMiniTable) {
            this.applyValidationErrors(this.validationPanel.getErrorsForTable(this.tableName));
        }
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
        // バッファ行昇格後にバリデーションを実行する（新規行のIDが既存と重複する可能性があるため）
        this.runValidation();
        // フィルター適用中の場合は行数カウンターと表示/非表示を再計算する（新規昇格行がフィルター条件を満たさない可能性）
        this.refreshFilterDisplayIfActive();
        // 常に末尾にバッファ行を1行保持する（昇格で消えた場合に補充する）。差分タブでは不要。
        if (this.diffTab === false) this.ensureTrailingBufferRow();
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
        // 降格によりエラーが解消される可能性があるためバリデーションを再実行する
        this.runValidation();
        // フィルター適用中の場合は行数カウンターと表示/非表示を再計算する（降格行の除去で表示行数が変化する）
        this.refreshFilterDisplayIfActive();
        // Undoにより降格した行がバッファ行に戻ると、バッファ行が蓄積する可能性がある。
        // 蓄積したバッファ行（2行以上）は末尾から削除し、常に1行だけになるよう整理する。差分タブでは不要。
        if (this.diffTab === false) this.normalizeTrailingBufferRows();
    }

    /**
     * 指定の domDataRowIndex がバッファ空行（ストア未登録）かどうかを判定する
     */
    isBufferRow(domDataRowIndex: number): boolean {
        return domDataRowIndex >= this.storeRowIndices.length;
    }

    /**
     * ストア行インデックスをDOM行インデックスに変換する。
     * ソート適用中は storeRowIndices の並び順が変化しているため、線形探索で逆引きする。
     * フィルターにより非表示の行は storeRowIndices に存在しないため null を返す。
     *
     * @param storeRowIndex ストア行インデックス（0始まり）
     * @returns DOM行インデックス（列ヘッダー行を含む: データ行1行目 = 1）、非表示・未登録の場合は null
     */
    storeRowToDomRow(storeRowIndex: number): number | null {
        const domDataIndex = this.storeRowIndices.indexOf(storeRowIndex);
        if (domDataIndex === -1) return null;
        // DOM上は 0行目が列ヘッダーなのでデータ行は +1
        return domDataIndex + 1;
    }

    /**
     * 末尾バッファ行が存在しない場合に1行追加する（蓄積防止のため既にある場合は何もしない）。
     * バッファ行が昇格・削除された後に末尾に必ず1行バッファ行を保持するために使う（通常テーブル・ミニテーブル共通）。
     *
     * 行番号はDOMの現在の全データ行数（storeRowIndices.length + 現在のバッファ行数）に基づく。
     * 追加する行は editor-table-empty-row クラスを持つ。
     *
     * @internal EditorTableStructure.deleteRow() からも呼ばれる。外部からは呼ばないこと。
     */
    ensureTrailingBufferRow(): void {
        // 列ヘッダー行(children[0])を除いたデータ行の総数（ストア行 + 既存バッファ行）
        const totalDataRows = this.element.children.length - 1;
        // 末尾のDOM行がバッファ行かどうかを確認する（children[0]は列ヘッダーなので+1オフセット）
        if (totalDataRows > 0) {
            const lastRow = this.element.children[totalDataRows] as HTMLElement;
            if (lastRow.classList.contains('editor-table-empty-row')) return;
        }
        // 新しいバッファ行の行インデックス（0始まり）
        const newRowIndex = totalDataRows;
        const cells: HTMLElement[] = [];
        cells.push(this.structure.createRowHeaderCell(String(newRowIndex + 1), newRowIndex));
        for (let j = 0; j < this.tableData.header.length; ++j) {
            cells.push(EditorTable.createCell(this, '', j, this.tableData.header[j].width, DEFAULT_ROW_HEIGHT));
        }
        const row = EditorTable.createRow(cells, newRowIndex);
        row.classList.add('editor-table-empty-row');
        this.element.appendChild(row);
        // 行追加後に行ヘッダーの番号（data-row属性・行番号テキスト）を振り直す
        this.structure.renumberRowsFrom(0);
        // FK列を持つ場合に新バッファ行へ参照ヒント（ドロップダウン等）を適用する
        const newDomRow = newRowIndex + 1; // DOMインデックス（列ヘッダー行を+1でオフセット）
        this.updateReferenceHintsForRows(newDomRow, newDomRow);
        // 行数変化後に選択オーバーレイの描画位置を再計算する
        this.selection.updateRendererAfterResize();
    }

    /**
     * バッファ行が2行以上存在する場合に末尾から余分な行を削除し、常に1行だけになるよう整理する。
     * demoteStoreRowToBuffer() のUndo後にバッファ行が蓄積するのを防ぐために使う（通常テーブル・ミニテーブル共通）。
     * demoteStoreRowToBuffer() は降格対象行に必ず editor-table-empty-row を付与するため、
     * このメソッド実行後にバッファ行が0行になることはない。
     */
    private normalizeTrailingBufferRows(): void {
        // DOM上のバッファ行（editor-table-empty-row）を末尾から数えて2行目以降を削除する
        // children[0]は列ヘッダーなのでデータ行は children[1] 以降
        const toRemove: HTMLElement[] = [];
        let bufferRowCount = 0;
        for (let i = this.element.children.length - 1; i >= 1; i--) {
            const row = this.element.children[i] as HTMLElement;
            if (!row.classList.contains('editor-table-empty-row')) break;
            bufferRowCount++;
            // 2行目以降の余分なバッファ行を削除対象に追加する（末尾の1行は残す）
            if (bufferRowCount > 1) toRemove.push(row);
        }
        for (const row of toRemove) this.element.removeChild(row);
        // 行削除後に行ヘッダーの番号（data-row属性・行番号テキスト）を振り直す
        this.structure.renumberRowsFrom(0);
        // 行数変化後に選択オーバーレイの描画位置を再計算する
        this.selection.updateRendererAfterResize();
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
     * 差分タブの右ペインでのパディング行（.diff-row-empty）のストア行インデックスを返す。
     * EditorTableHandler の保存処理から呼ばれ、差分タブの DiffTab に委譲する。
     * このメソッドは差分タブの右ペイン（saveTargetTableName が設定されたコンテキスト）でのみ呼ばれる。
     * diffTab === false の場合は到達不能であり、フォールバックとして空配列を返すことはデータ破壊のリスクがあるため例外を投げる。
     */
    getDiffPaddingStoreRowIndices(): readonly number[] {
        if (this.diffTab === false) throw new Error('[EditorTable] getDiffPaddingStoreRowIndices: 差分タブ以外のコンテキストで呼び出されました。呼び出し側のガード条件を確認してください。');
        return this.diffTab.computeCurrentRightPaddingStoreRowIndices();
    }

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
     * ColumnFilter はストア列インデックスで管理しているため、DOM列インデックスを変換してから参照する。
     */
    private updateFilterActiveClasses(): void {
        const headerRow = this.element.children[0];
        const columnCount = this.getColumnCount();
        for (let colIdx = 0; colIdx < columnCount; colIdx++) {
            const headerCell = headerRow.children[colIdx + 1] as HTMLElement;
            const storeColIdx = this.getStoreColumnIndex(colIdx);
            if (storeColIdx !== -1 && this.columnFilter.isColumnFiltered(storeColIdx)) {
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

    /** 行選択が変化したときにRelationsPanelへ通知し、EditorAPI に行選択イベントを発火する（Selectionから呼ばれる） */
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
        // 重複チェック通過後に EditorAPI へ行選択イベントを発火する（ストアインデックス0始まりで通知）
        if (this.tab !== false) {
            const domDataRow = rowIndex - 1; // DOM行インデックス（1始まり）→ データ行インデックス（0始まり）
            if (domDataRow >= 0 && domDataRow < this.storeRowIndices.length) {
                this.tab.emitRowSelected(this.tableName, this.storeRowIndices[domDataRow]);
            }
        }
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
        // DOM列インデックス（0始まり）→ ストア（CSV）列インデックスのマッピングを取得する。
        // 非連番keyスキーマではDOMインデックスとCSVインデックスが一致しないため変換が必須。
        const columnMapping = this.tableData.columnMapping;
        // row=1 から開始（row=0 は列ヘッダー行のため除外）
        for (let row = 1; row < rowCount; row++) {
            const rowElement = this.element.children[row] as HTMLElement;
            // バッファ空行（editor-table-empty-row クラスあり）はハイライト対象外
            if (rowElement.classList.contains('editor-table-empty-row')) continue;
            // 差分タブのパディング行（diff-row-empty クラスあり）もハイライト対象外
            if (rowElement.classList.contains('diff-row-empty')) continue;
            const domDataRowIndex = row - 1;
            if (domDataRowIndex >= this.storeRowIndices.length) continue;
            const storeRowIndex = this.storeRowIndices[domDataRowIndex];
            // col=1 から開始（col=0 は行ヘッダーセルのため除外）
            for (let col = 1; col < totalColCount; col++) {
                const domColIndex = col - 1; // DOM列インデックス（0始まり）
                const storeColIndex = columnMapping[domColIndex]; // CSV列インデックスに変換
                if (storeColIndex === -1) continue; // 対応するCSV列がない場合はスキップ
                const cell = this.getCell(row, col);
                this.updateSingleCellGitHighlight(cell, storeRows, storeRowIndex, storeColIndex);
            }
        }
    }

    /**
     * git statusを再問い合わせし、このテーブルの GitDiffTracker を再構築して全セルのハイライトを再適用する。
     * テーブルオープン時および保存後（markSavedAndUpdatePanel）に呼ばれ、差分状態をセルに反映する。
     * git statusの取得に失敗した場合（git管理外環境等）は何もしない。
     */
    async refreshGitDiffAsync(): Promise<void> {
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
        // 複合PKのストア（CSV）列インデックスを取得する（いずれか1列でも見つからない場合はハイライト不可）
        // GitDiffTracker はストア行（CSV列順）に対してインデックスを使うため、DOM列インデックスではなく
        // ストア列インデックスを使う必要がある。ストアヘッダーから列名で検索する。
        const storeHeader = this.store.getHeader(this.tableName);
        if (storeHeader === false) {
            this.gitDiffTracker = false;
            this.applyGitDiffHighlight();
            return;
        }
        const pkColumnIndices: number[] = [];
        for (const pkColName of this.tableData.primaryKeyColumns) {
            const idx = storeHeader.indexOf(pkColName);
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
                // awaitで中断中に新しいリクエストが来た場合は処理を破棄する
                if (requestId !== this.refreshGitDiffRequestId) return;
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

    /**
     * 差分タブの右ペイン保存後にgit差分ハイライトを更新する。
     * 通常テーブルの refreshGitDiffAsync は git status でテーブル名を検索するが、
     * 差分タブの tableName は "xxx:diff:current" という仮名のため git status では見つからない。
     * 代わりに gitPath（gitルート相対のファイルパス）を使って gitShowAsync でHEAD版CSVを取得し、
     * GitDiffTracker を再構築して全セルのハイライトを再適用する。
     *
     * gitPath: source-control-panel.ts の entry.path をそのまま引き回したもの。
     *          サブディレクトリ環境では "subdir/data/xxx.csv" 形式になる。
     */
    async refreshGitDiffForDiffTabAsync(gitPath: string): Promise<void> {
        const requestId = ++this.refreshGitDiffRequestId;
        // PK列が定義されていない場合はハイライト不要
        if (this.tableData.primaryKeyColumns.length === 0) {
            this.gitDiffTracker = false;
            this.applyGitDiffHighlight();
            return;
        }
        // ストアヘッダーからPK列インデックスを解決する
        // ストアキーは this.tableName（"xxx:diff:current"）で登録されている
        const storeHeader = this.store.getHeader(this.tableName);
        if (storeHeader === false) {
            this.gitDiffTracker = false;
            this.applyGitDiffHighlight();
            return;
        }
        const pkColumnIndices: number[] = [];
        for (const pkColName of this.tableData.primaryKeyColumns) {
            const idx = storeHeader.indexOf(pkColName);
            if (idx === -1) {
                this.gitDiffTracker = false;
                this.applyGitDiffHighlight();
                return;
            }
            pkColumnIndices.push(idx);
        }
        // gitPath（gitルート相対パス）を使ってHEAD版CSVを取得する。
        // source-control-panel.ts の openDiffTabAsync で gitShowAsync(entry.path) が成功しているため、
        // 同じパスを使えばサブディレクトリ環境でも正しく動作する。
        let headCsv: string;
        try {
            headCsv = await gitShowAsync(gitPath);
        } catch (e) {
            // awaitで中断中に新しいリクエストが来た場合は処理を破棄する
            if (requestId !== this.refreshGitDiffRequestId) return;
            const message = e instanceof Error ? e.message : String(e);
            if (message.includes('does not exist')) {
                // HEADに存在しない（新規テーブル等） → 全セルchanged
                const tracker = GitDiffTracker.createForNewTable(pkColumnIndices);
                this.connectGitDiffTracker(tracker);
            } else {
                // バリデーションエラー等その他のエラー → ハイライトなし
                this.gitDiffTracker = false;
            }
            this.applyGitDiffHighlight();
            return;
        }
        // awaitで中断中に新しいリクエストが来た場合は処理を破棄する
        if (requestId !== this.refreshGitDiffRequestId) return;
        const headRowMap = GitDiffTracker.buildHeadRowMap(headCsv, pkColumnIndices);
        const tracker = new GitDiffTracker(headRowMap, pkColumnIndices, false);
        this.connectGitDiffTracker(tracker);
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
        // storeColIndex はすでにCSV列インデックスに変換済みのためそのまま渡す（column-1はDOM列インデックスなので誤り）
        const id = this.reference.getRowPkValue(row);
        this.referenceDataCache.updateFullDataCell(this.tableName, id, storeColIndex, value);
        // git差分ハイライトをこのセル1つ分だけ再評価する
        // storeColIndex はすでにストア（CSV）列インデックスに変換済みなのでそのまま使う
        if (this.gitDiffTracker !== false) {
            const latestRows = this.store.getRows(this.tableName);
            if (latestRows !== false) {
                const cell = this.getCell(row, column);
                this.updateSingleCellGitHighlight(cell, latestRows, storeRowIndex, storeColIndex);
            }
        }
        // 差分タブのdiff-cell-added/diff-cell-deletedクラスをセル単位で再評価する
        if (this.diffTab !== false) {
            this.diffTab.notifyCellEdited(row, column, value);
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
        // セル編集確定後にバリデーションを実行してパネルとエラークラスを更新する
        this.runValidation();
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
        // Undo/Redo後にバリデーションを実行してパネルとエラークラスを更新する
        this.runValidation();
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

    /**
     * 参照テーブルのIDから表示テキストを同期取得する（フィルタードロップダウン参照ヒント用）
     * 参照キャッシュの結果を null に正規化して返す
     */
    getDisplayTextById(tableName: string, id: string): string | null {
        return this.referenceDataCache.getDisplayTextById(tableName, id) ?? null;
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
     * comment がある場合は data-full-comment 属性から完全な値（\n含む）を返す。
     * comment なし（TextNode のみ）の場合は null を返す。
     */
    public getColumnHeaderComment(columnIndex: number): string | null {
        const headerRow = this.element.children[0] as HTMLElement;
        const headerCell = headerRow.children[columnIndex + 1] as HTMLElement;
        // data-full-comment があれば完全なcomment（\n含む）を返す
        // \n を含まないcommentも createColumnHeaderCell で必ず dataset.fullComment に保存されるため、
        // commentがある場合は常にここから読み取る。commentなし（TextNodeのみ）の場合は属性が存在しない。
        if ('fullComment' in headerCell.dataset) return headerCell.dataset.fullComment as string;
        return null;
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
    // バリデーション
    // =========================================================================

    /**
     * バリデーションを実行してパネルを更新する。
     *
     * 通常テーブル（ValidationPanel 接続済み）:
     *   validationPanel.runAndUpdate() で全テーブルのバリデーションを実行し、
     *   ValidationPanel 側が全 EditorTable に applyValidationErrors() を呼ぶ。
     *
     * ミニテーブル（ValidationPanel 接続済みだが openEditorTables 未登録）:
     *   validationPanel.validatePkDuplicatesForTable() でストア全体からPK重複のみを検出し、
     *   自分自身の DOM に applyValidationErrors() を適用する独立したバリデーションパス。
     *   runAndUpdate() は呼ばない（全テーブル再バリデーションのコストを避けるため）。
     *
     * ValidationPanel 未接続: 何もしない。
     */
    runValidation(): void {
        if (this.validationPanel === false) return;
        if (this.isMiniTable) {
            // ミニテーブル用独立パス: ストア全体でPK重複を検出して自身のDOMに適用する
            const errors = this.validationPanel.validatePkDuplicatesForTable(this.tableName);
            this.applyValidationErrors(errors);
        } else {
            this.validationPanel.runAndUpdate();
        }
    }

    /**
     * ValidationPanel から呼ばれる: このテーブルのバリデーションエラーをDOMに適用する。
     * PK重複エラーには cell-pk-duplicate + cell-error を付与する。
     * FK参照切れ・型不一致エラーには cell-error を付与する。
     * エラーがないセルからは両クラスを除去する。
     */
    public applyValidationErrors(errors: ValidationError[]): void {
        // ストア列インデックス → エラー種別のマップにグループ化する（key: "storeRow,storeCol"）
        const pkErrorCells = new Set<string>();
        const otherErrorCells = new Set<string>();
        for (const error of errors) {
            const key = `${error.rowIndex},${error.columnIndex}`;
            if (error.kind === 'pk-duplicate') { pkErrorCells.add(key); } else { otherErrorCells.add(key); }
        }
        // ストアヘッダーはループ外で1回だけ取得する
        const storeHeader = this.store.getHeader(this.tableName);
        if (storeHeader === false) return;
        const colCount = this.getColumnCount();
        // DOM列名→ストア列インデックスのマッピングを事前構築する（内ループでのindexOf呼び出しを排除）
        const domColToStoreCol: number[] = [];
        for (let domColIdx = 1; domColIdx <= colCount; domColIdx++) {
            domColToStoreCol.push(storeHeader.indexOf(this.getColumnHeaderValue(domColIdx - 1)));
        }
        // storeRowIndices に記録されたデータ行のみ走査する（バッファ空行はスキップ）
        for (let rowIdx = 1; rowIdx <= this.storeRowIndices.length; rowIdx++) {
            const row = this.element.children[rowIdx] as HTMLElement | null;
            if (!row) continue;
            const storeRowIdx = this.storeRowIndices[rowIdx - 1];
            for (let domColIdx = 1; domColIdx <= colCount; domColIdx++) {
                const cell = row.children[domColIdx] as HTMLElement | null;
                if (!cell) continue;
                const storeColIdx = domColToStoreCol[domColIdx - 1];
                if (storeColIdx === -1) continue;
                const key = `${storeRowIdx},${storeColIdx}`;
                const isPkError = pkErrorCells.has(key);
                const isOtherError = otherErrorCells.has(key);
                // cell-pk-duplicate: PKエラーのみ
                if (isPkError) { cell.classList.add('cell-pk-duplicate'); } else { cell.classList.remove('cell-pk-duplicate'); }
                // cell-error: PKエラー・FK参照切れ・型不一致
                if (isPkError || isOtherError) { cell.classList.add('cell-error'); } else { cell.classList.remove('cell-error'); }
            }
        }
    }

}

