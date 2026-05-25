import {EditorTableData} from "../data/models/editor-table-data";
import {Selection, CellPosition, CellRange} from "./selection";
import {EditorTableHandler} from "./editor-table-handler";
import {ContextMenu} from "../ui/context-menu";
import {History} from "./history";
import {Command, CellChange, CellChangeCommand, RenderAsHtmlToggleCommand} from "./command";
import {AreaResizer} from "./area-resizer";
import {
    DEFAULT_ROW_HEIGHT,
    CELL_FONT,
    REFERENCE_HINT_FONT,
    REFERENCE_HINT_MARGIN_PX,
    CELL_HORIZONTAL_EXTRA,
    MIN_COLUMN_WIDTH_PX,
    ROW_TOTAL_HEIGHT_PX,
    ROW_HEADER_WIDTH_PX,
    CUSTOM_VERTICAL_SCROLLBAR_WIDTH_PX,
    CUSTOM_VERTICAL_SCROLLBAR_MIN_THUMB_HEIGHT_PX,
} from "../core/constant";
import {ScrollViewportController} from "./scroll-viewport-controller";
import {SelectionDragController} from "./selection-drag-controller";
import {RowDragController} from "./row-drag-controller";
import {ReferenceDataCache} from "../references/reference-data-cache";
import {ReverseReferenceEntry, ReverseReferenceMap} from "../references/reverse-reference-resolver";
import {Sidebar} from "../sidebar/sidebar";
import {EditorTableReference} from "./editor-table-reference";
import {EditorTableContextMenu} from "./editor-table-context-menu";
import {EditorTableStructure} from "./editor-table-structure";
import {EditorTableLayout} from "./editor-table-layout";
import {EditorTableSortFilter} from "./editor-table-sort-filter";
import {EditorTableGit} from "./editor-table-git";
import {EditorTableValidationMarkers} from "./editor-table-validation-markers";
import {InMemoryTableStore} from "../data/in-memory-table-store";
import {RelationsPanel} from "../panels/relations-panel";
import {ValidationPanel} from "../panels/validation-panel";
import {ValidationError} from "../validation/validation-engine";
import {DiffTab} from "../tabs/diff-tab";
import {GitDiffTracker} from "../diff/git-diff-tracker";
import {ColumnSorter, SerializedSortKey} from "./column-sorter";
import {ColumnFilter, SerializedFilters} from "./column-filter";
import {FilterDropdown} from "../ui/filter-dropdown";
import {Utility} from "../core/utility";
import {Tab} from "../tabs/tab";
import {NotificationToast} from "../ui/notification";
import {ErrorTooltip} from "../ui/error-tooltip";
import {saveSchemaDataAsync} from "./editor-actions";
import {ScrollbarMarkerTrack, MarkerEntry} from "../ui/scrollbar-marker-track";
import {VirtualScrollController, RenderedRowsUpdate} from "./virtual-scroll-controller";
import {EditorTableCellFactory} from "./editor-table-cell-factory";
import {EditorTableSelectionView} from "./editor-table-selection-view";
import {EditorTableRenderer} from "./editor-table-renderer";
import {EditorTableStoreSync} from "./editor-table-store-sync";
import {EditorTableNavigation} from "./editor-table-navigation";
import {EditorTableBookmarks} from "./editor-table-bookmarks";
import {EditorTableRelations} from "./editor-table-relations";
import type {GitStatusResult} from "../app/api";
import type {LargeFileSettings} from "../settings/settings-schema";

/**
 * EditorTable — マスターデータ編集テーブルのファサード
 *
 * 個別の責務は以下のモジュールに委譲する:
 * - EditorTableRenderer: 初期描画・仮想スクロール行生成・ライフサイクル
 * - EditorTableReference: 参照ヒント管理
 * - EditorTableContextMenu: コンテキストメニュー
 * - EditorTableStructure: 列/行の構造操作
 * - EditorTableStoreSync: ストア同期・バッファ空行・FK自動埋め込み
 * - EditorTableNavigation: 参照/逆参照ジャンプ
 * - EditorTableBookmarks: ブックマーク操作・視覚マーク復元
 * - EditorTableRelations: RelationsPanel / EditorAPI 連携
 */
export class EditorTable {
    readonly tableName: string;
    private readonly tableData: EditorTableData;
    private readonly element: HTMLElement;
    private readonly gridElement: HTMLElement;
    private readonly selection: Selection;
    private readonly areaResizer: AreaResizer;
    private readonly handler: EditorTableHandler;
    private readonly contextMenu: ContextMenu;
    private readonly history: History;
    readonly selectionDragController: SelectionDragController;
    /** 行ドラッグ移動コントローラー（initializeModulesで再作成されるためreadonlyではない） */
    private rowDragController: RowDragController;
    private readonly referenceDataCache: ReferenceDataCache;
    /** テーブルデータの中央ストア（セル編集の同期用） */
    private readonly store: InMemoryTableStore;
    /** 参照箇所を表示するサイドバー（コンテキストメニュー・ブックマーク操作で使用） */
    readonly sidebar: Sidebar;
    private readonly scrollBinding: ScrollViewportController;
    private readonly scrollContainer: HTMLElement;
    private readonly usesInternalMainViewport: boolean;
    private readonly topLeftPane: HTMLElement;
    private readonly topRightPane: HTMLElement;
    private readonly bottomLeftPane: HTMLElement;
    private readonly bottomRightPane: HTMLElement;
    private readonly topRightViewport: HTMLElement;
    private readonly leftBottomViewport: HTMLElement;
    private readonly topLeftContent: HTMLElement;
    private readonly topRightContent: HTMLElement;
    private readonly leftBottomContent: HTMLElement;
    private readonly mainContent: HTMLElement;
    private readonly customVerticalScrollbar: HTMLElement;
    private readonly customVerticalScrollbarThumb: HTMLElement;
    private readonly detachedColumnHeaderLayer: HTMLElement;
    private readonly detachedRowHeaderLayer: HTMLElement;
    private readonly detachedFrozenRowBackgroundLayer: HTMLElement;
    private readonly detachedCornerLayer: HTMLElement;
    private readonly detachedFrozenRowDataLayer: HTMLElement;
    private readonly detachedFrozenCornerDataLayer: HTMLElement;
    private detachedHeaderTopOffset: number;

    /** 参照ヒント管理モジュール */
    reference!: EditorTableReference;
    /** コンテキストメニュー管理モジュール */
    contextMenuHandler!: EditorTableContextMenu;
    /** テーブル構造操作モジュール */
    structure!: EditorTableStructure;
    /** リレーションパネル（RelationsPanelのconnectEditorTableで設定される。未設定はfalse） */
    relationsPanel: RelationsPanel | false;
    /** バリデーションパネル（Tab.createEditorTable内でconnectValidationPanel()で設定される。未設定はfalse） */
    validationPanel: ValidationPanel | false;
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
    refreshGitDiffRequestId: number;
    /** 列ソート管理（ミニテーブルでは使用しないが、インスタンスは常に保持する） */
    readonly columnSorter: ColumnSorter;
    /** 列フィルター管理（ミニテーブルでは使用しないが、インスタンスは常に保持する） */
    private readonly columnFilter: ColumnFilter;
    /** フィルタードロップダウン UI（ミニテーブルでは使用しない。initializeModules() で再作成される） */
    private filterDropdown: FilterDropdown;
    /** 行数カウンター要素（フィルター適用中に「X / Y 行」を表示する） */
    private readonly filterRowCountElement: HTMLElement;

    /** 固定列数（0=未固定） */
    private frozenColumnCount: number;
    /** 固定行数（0=未固定） */
    private frozenRowCount: number;
    /** blame情報の表示状態（false: 非表示、true: 表示中） */
    private isBlameVisible: boolean;

    /** 空行数（データ行+バッファ1行） */
    readonly emptyRowCount: number;
    /** ルート要素に付与するCSSクラス名（通常は 'editor-table'、ミニテーブルは別クラス） */
    readonly rootCssClass: string;
    /**
     * ミニEditorTableフラグ。RelationsPanelのミニテーブルとして生成された場合はtrue。
     * trueの場合、行選択変化をRelationsPanelに通知しない（自分自身の再描画による自己破棄を防止）。
     */
    private readonly isMiniTable: boolean;
    /** 行追加時に自動埋め込みするFK列名と値のペア配列（1:Nミニテーブルで使用） */
    autoFillEntries: Array<{ columnName: string; value: string }>;
    /**
     * DOMのデータ行インデックス（0始まり）からストアの行インデックスへのマッピング。
     * 通常テーブル: storeRowIndices[i] = i（DOM行i+1 → ストア行i）。
     * ミニテーブル: filteredRows作成時に各filteredRow がストアの何行目かを記録する。
     * 行挿入・削除時に同期される。
     */
    private storeRowIndices: number[];
    /**
     * フィルター適用時のデータ行インデックス配列。
     * filteredRowIndices[i] は storeRowIndices 上のインデックスを指す。
     * フィルター適用時のみ有効な値を持ち、仮想スクロールのレンダリングで使用する。
     * フィルター未適用時は空配列 []（使用しない — storeRowIndices を直接参照する）。
     * applyFilterDisplay() でフィルター適用・解除時に更新される。
     */
    private filteredRowIndices: number[];
    /** スクロールバーマーカートラック（connectScrollbarMarkerTrackで設定される。未設定はfalse） */
    scrollbarMarkerTrack: ScrollbarMarkerTrack | false;
    /** 通常テーブルの共有右側マーカーを更新できるアクティブ状態 */
    isActive: boolean;
    /** 直近のバリデーションで検出されたエラーがあるデータ行インデックス（0始まり）の集合 */
    currentErrorDomRows: Set<number>;
    /** 直近のgit差分で検出された変更があるデータ行インデックス（0始まり）の集合 */
    currentGitChangedDomRows: Set<number>;
    /** バリデーションエラーのストア座標キャッシュ（renderRowForVirtualScroll でクラス適用に使用） */
    cachedPkErrorCells: Set<string>;
    cachedOtherErrorCells: Set<string>;
    /** DOM列→ストア列のマッピングキャッシュ（バリデーションエラークラス適用用） */
    cachedDomColToStoreCol: number[];
    /** バーチャルスクロールコントローラー */
    private readonly virtualScroll: VirtualScrollController;
    private customVerticalScrollbarDragState: { startClientY: number; startScrollTop: number } | null;
    private readonly handleCustomVerticalScrollbarPointerMoveBound: (event: PointerEvent) => void;
    private readonly handleCustomVerticalScrollbarPointerUpBound: (event: PointerEvent) => void;
    /** 固定行列・detached layer 表示同期モジュール */
    private layout: EditorTableLayout;
    /** ソート・フィルター表示制御モジュール */
    private sortFilter: EditorTableSortFilter;
    /** blame 表示・git差分ハイライトモジュール */
    private git: EditorTableGit;
    /** バリデーション適用・スクロールバーマーカー更新モジュール */
    private validationMarkers: EditorTableValidationMarkers;
    /** 選択・コピー範囲・フォーカスセルの視覚状態管理モジュール */
    private selectionView: EditorTableSelectionView;
    /** 初期描画・仮想スクロール行生成・ライフサイクル管理モジュール */
    private renderer: EditorTableRenderer;
    /** ストア同期・バッファ行・FK自動埋め込み管理モジュール */
    private storeSync: EditorTableStoreSync;
    /** 参照・逆参照ナビゲーション管理モジュール */
    private navigation: EditorTableNavigation;
    /** ブックマーク操作・視覚マーク復元モジュール */
    private bookmarks: EditorTableBookmarks;
    /** RelationsPanel / EditorAPI 連携モジュール */
    private relations: EditorTableRelations;
    /** 同一スクロール内で fillHandle 再配置を二重実行しないための抑止フラグ */
    skipFrozenFillHandleRefreshOnNextScrollSync: boolean;

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
        scrollContainer: HTMLElement,
        emptyRowCount: number,
        rootCssClass: string,
        isMiniTable: boolean,
        enableVirtualScroll: boolean,
        internalScrollLayout: boolean
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
        this.scrollContainer = scrollContainer;
        this.usesInternalMainViewport = internalScrollLayout;
        this.emptyRowCount = emptyRowCount;
        this.rootCssClass = rootCssClass;
        this.isMiniTable = isMiniTable;
        this.element = document.createElement('div');
        this.topLeftPane = document.createElement('div');
        this.topLeftPane.classList.add('editor-table-pane', 'editor-table-pane-top-left');
        this.topRightPane = document.createElement('div');
        this.topRightPane.classList.add('editor-table-pane', 'editor-table-pane-top-right');
        this.bottomLeftPane = document.createElement('div');
        this.bottomLeftPane.classList.add('editor-table-pane', 'editor-table-pane-bottom-left');
        this.bottomRightPane = document.createElement('div');
        this.bottomRightPane.classList.add('editor-table-pane', 'editor-table-pane-bottom-right');
        this.topRightViewport = document.createElement('div');
        this.topRightViewport.classList.add('editor-table-top-viewport');
        this.leftBottomViewport = document.createElement('div');
        this.leftBottomViewport.classList.add('editor-table-left-viewport');
        this.topLeftContent = document.createElement('div');
        this.topLeftContent.classList.add('editor-table-pane-content', 'editor-table-top-left-content');
        this.topRightContent = document.createElement('div');
        this.topRightContent.classList.add('editor-table-pane-content', 'editor-table-top-right-content');
        this.leftBottomContent = document.createElement('div');
        this.leftBottomContent.classList.add('editor-table-pane-content', 'editor-table-left-bottom-content');
        this.mainContent = document.createElement('div');
        this.mainContent.classList.add('editor-table-main-content');
        this.customVerticalScrollbar = document.createElement('div');
        this.customVerticalScrollbar.classList.add('editor-table-logical-vertical-scrollbar');
        this.customVerticalScrollbarThumb = document.createElement('div');
        this.customVerticalScrollbarThumb.classList.add('editor-table-logical-vertical-scrollbar-thumb');
        this.customVerticalScrollbar.appendChild(this.customVerticalScrollbarThumb);
        this.detachedColumnHeaderLayer = document.createElement('div');
        this.detachedColumnHeaderLayer.classList.add('editor-table-detached-layer', 'editor-table-detached-column-header-layer');
        this.detachedRowHeaderLayer = document.createElement('div');
        this.detachedRowHeaderLayer.classList.add('editor-table-detached-layer', 'editor-table-detached-row-header-layer');
        this.detachedFrozenRowBackgroundLayer = document.createElement('div');
        this.detachedFrozenRowBackgroundLayer.classList.add('editor-table-detached-layer', 'editor-table-detached-frozen-row-background-layer');
        this.detachedCornerLayer = document.createElement('div');
        this.detachedCornerLayer.classList.add('editor-table-detached-layer', 'editor-table-detached-corner-layer');
        this.gridElement = document.createElement('div');
        this.gridElement.classList.add('editor-table-grid');
        this.detachedFrozenRowDataLayer = document.createElement('div');
        this.detachedFrozenRowDataLayer.classList.add('editor-table-detached-layer', 'editor-table-detached-frozen-row-layer');
        this.detachedFrozenCornerDataLayer = document.createElement('div');
        this.detachedFrozenCornerDataLayer.classList.add('editor-table-detached-layer', 'editor-table-detached-frozen-corner-layer');
        this.customVerticalScrollbarDragState = null;
        this.handleCustomVerticalScrollbarPointerMoveBound = (event: PointerEvent) => this.handleCustomVerticalScrollbarPointerMove(event);
        this.handleCustomVerticalScrollbarPointerUpBound = (event: PointerEvent) => this.handleCustomVerticalScrollbarPointerUp(event);
        if (this.usesInternalMainViewport) {
            this.topLeftPane.appendChild(this.topLeftContent);
            this.topLeftContent.appendChild(this.detachedCornerLayer);
            this.topLeftContent.appendChild(this.detachedFrozenCornerDataLayer);
            this.topRightPane.appendChild(this.topRightViewport);
            this.topRightViewport.appendChild(this.topRightContent);
            this.topRightContent.appendChild(this.detachedColumnHeaderLayer);
            this.topRightContent.appendChild(this.detachedFrozenRowBackgroundLayer);
            this.topRightContent.appendChild(this.detachedFrozenRowDataLayer);
            this.bottomLeftPane.appendChild(this.leftBottomViewport);
            this.leftBottomViewport.appendChild(this.leftBottomContent);
            this.leftBottomContent.appendChild(this.detachedRowHeaderLayer);
            this.bottomRightPane.appendChild(this.scrollContainer);
            this.scrollContainer.classList.add('editor-table-main-viewport');
            this.scrollContainer.classList.add('editor-table-main-viewport--custom-vertical-scroll');
            this.scrollContainer.appendChild(this.mainContent);
            this.bottomRightPane.appendChild(this.gridElement);
            this.bottomRightPane.appendChild(this.customVerticalScrollbar);
            this.scrollContainer.addEventListener('wheel', (event) => this.handleCompressedScrollWheel(event), { passive: false });
            this.customVerticalScrollbar.addEventListener('pointerdown', (event) => this.handleCustomVerticalScrollbarPointerDown(event));
            this.customVerticalScrollbar.addEventListener('wheel', (event) => this.handleCustomVerticalScrollbarWheel(event), { passive: false });
            this.element.appendChild(this.topLeftPane);
            this.element.appendChild(this.topRightPane);
            this.element.appendChild(this.bottomLeftPane);
            this.element.appendChild(this.bottomRightPane);
        } else {
            this.element.appendChild(this.detachedColumnHeaderLayer);
            this.element.appendChild(this.detachedRowHeaderLayer);
            this.element.appendChild(this.detachedFrozenRowBackgroundLayer);
            this.element.appendChild(this.detachedCornerLayer);
            this.element.appendChild(this.gridElement);
            this.element.appendChild(this.detachedFrozenRowDataLayer);
        }
        this.detachedHeaderTopOffset = 0;
        this.relationsPanel = false;
        this.validationPanel = false;
        this.diffTab = false;
        this.tab = false;
        this.gitDiffTracker = false;
        this.refreshGitDiffRequestId = 0;
        this.autoFillEntries = [];
        this.frozenColumnCount = 0;
        this.frozenRowCount = 0;
        this.isBlameVisible = false;
        // initialize() で初期化される
        this.storeRowIndices = [];
        this.filteredRowIndices = [];
        this.scrollbarMarkerTrack = false;
        this.isActive = false;
        this.currentErrorDomRows = new Set();
        this.currentGitChangedDomRows = new Set();
        this.cachedPkErrorCells = new Set();
        this.cachedOtherErrorCells = new Set();
        this.cachedDomColToStoreCol = [];
        this.skipFrozenFillHandleRefreshOnNextScrollSync = false;
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
        this.rowDragController = new RowDragController(this, selection, history);
        // バーチャルスクロール: enableVirtualScroll=true で有効化
        // 通常テーブル: true、ミニテーブル: false、差分テーブル: true（isMiniTable=true だが仮想スクロール有効）
        // renderRow コールバックは Object.Assign 後に initializeModules() で設定する
        this.virtualScroll = new VirtualScrollController(
            this.gridElement, scrollContainer, emptyRowCount, enableVirtualScroll
        );
        this.scrollBinding.setVerticalScrollMapper(
            () => this.virtualScroll.getLogicalScrollTop(),
            (logicalScrollTop: number) => {
                this.virtualScroll.setLogicalScrollTop(logicalScrollTop);
                return this.virtualScroll.getPhysicalScrollTop(logicalScrollTop);
            },
        );
        this.layout = new EditorTableLayout(this);
        this.sortFilter = new EditorTableSortFilter(this);
        this.git = new EditorTableGit(this);
        this.validationMarkers = new EditorTableValidationMarkers(this);
        this.selectionView = new EditorTableSelectionView(this);
        this.renderer = new EditorTableRenderer(this);
        this.storeSync = new EditorTableStoreSync(this);
        this.navigation = new EditorTableNavigation(this);
        this.bookmarks = new EditorTableBookmarks(this);
        this.relations = new EditorTableRelations(this);
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
    initializeModules(notification: NotificationToast): void {
        this.reference = new EditorTableReference(this, this.tableData, this.referenceDataCache, notification);
        this.contextMenuHandler = new EditorTableContextMenu(this, this.selection, this.contextMenu);
        this.structure = new EditorTableStructure(this, this.selection, this.history, this.areaResizer);
        // Object.assign 前に生成された layout は realEditorTable を参照しているため、
        // 正しい this（プロキシオブジェクト）で再作成する。
        this.layout = new EditorTableLayout(this);
        // layout と同様に、ソート/フィルターの委譲先も正しい this で再作成する。
        this.sortFilter = new EditorTableSortFilter(this);
        // blame/git差分の委譲先も正しい this で再作成する。
        this.git = new EditorTableGit(this);
        // バリデーション/マーカーの委譲先も正しい this で再作成する。
        this.validationMarkers = new EditorTableValidationMarkers(this);
        // 選択表示の委譲先も正しい this で再作成する。
        this.selectionView = new EditorTableSelectionView(this);
        // 初期描画・行生成の委譲先も正しい this で再作成する。
        this.renderer = new EditorTableRenderer(this);
        // ストア同期の委譲先も正しい this で再作成する。
        this.storeSync = new EditorTableStoreSync(this);
        // ナビゲーション/ブックマークの委譲先も正しい this で再作成する。
        this.navigation = new EditorTableNavigation(this);
        this.bookmarks = new EditorTableBookmarks(this);
        // RelationsPanel / EditorAPI 連携の委譲先も正しい this で再作成する。
        this.relations = new EditorTableRelations(this);
        // コンストラクタで生成した旧 FilterDropdown を破棄してから正しい this（プロキシオブジェクト）で再作成する。
        // 旧インスタンスは realEditorTable（storeRowIndices=[]）を参照しているため破棄が必要。
        // destroy() を呼ばないと document.mousedown リスナーが蓄積してメモリリークになる。
        this.filterDropdown.destroy();
        this.filterDropdown = new FilterDropdown(this, this.columnFilter);
        // RowDragController も正しい this（プロキシオブジェクト）で再作成する。
        // 旧インスタンスのインジケーター要素を document.body から除去してからの再作成。
        this.rowDragController.destroy();
        this.rowDragController = new RowDragController(this, this.selection, this.history);
        // バーチャルスクロールの行生成コールバックを正しい this（プロキシオブジェクト）で設定する。
        // コンストラクタ時点の this は realEditorTable を指すためクロージャが旧オブジェクトを捕捉してしまう。
        // ミニテーブル（enabled=false）では renderRow は使用されないが、connectRenderRow 自体は安全。
        this.virtualScroll.connectRenderRow(
            (dataRowIndex: number) => this.renderer.renderRowForVirtualScroll(dataRowIndex),
            (update: RenderedRowsUpdate) => this.renderer.reapplyRowDecorations(update),
            (scrollTop: number, scrollLeft: number) => this.syncScrollBoundVisualsWithPositions(scrollTop, scrollLeft)
        );
        if (!this.virtualScroll.handlesScrollEvents()) {
            this.scrollContainer.addEventListener('scroll', () => { this.syncScrollBoundVisuals(); });
        }
    }

    // =========================================================================
    // 内部モジュール用アクセサ
    // =========================================================================

    /** 内部モジュール用: テーブルDOM要素を取得する */
    getTableElement(): HTMLElement { return this.gridElement; }

    /** 内部モジュール用: テーブルデータを取得する */
    getTableData(): EditorTableData { return this.tableData; }

    /**
     * データ列のDOMインデックスオフセットを返す。
     * 通常時: 1（children[0]=行ヘッダー、children[1]=データ列0）
     * blame表示時: 2（children[0]=blame列、children[1]=行ヘッダー、children[2]=データ列0）
     * children[dataColumnIndex + dataColumnOffset] でデータセルにアクセスする。
     */
    dataColumnOffset(): number { return this.isBlameVisible ? 2 : 1; }

    private getHeaderRowHeightPx(): number { return this.layout.getHeaderRowHeightPx(); }
    private getDataRowHeightPx(): number { return this.layout.getDataRowHeightPx(); }
    getColumnLayoutWidthPx(columnIndex: number): number { return this.layout.getColumnLayoutWidthPx(columnIndex); }
    getRenderedDataColumnWidthPx(columnIndex: number): number { return this.layout.getRenderedDataColumnWidthPx(columnIndex); }
    getRenderedDataBoundaryOffsetPx(dataColumnExclusiveEnd: number): number { return this.layout.getRenderedDataBoundaryOffsetPx(dataColumnExclusiveEnd); }
    private getDetachedPrefixWidthPx(): number { return this.layout.getDetachedPrefixWidthPx(); }
    getDataAreaWidthPx(): number { return this.layout.getDataAreaWidthPx(); }
    private getFrozenColumnAreaWidthPx(): number { return this.layout.getFrozenColumnAreaWidthPx(); }
    private getFixedLeftWidthPx(): number { return this.layout.getFixedLeftWidthPx(); }
    getFixedTopHeightPx(): number { return this.layout.getFixedTopHeightPx(); }
    getLogicalRowIndexFromElement(rowElement: HTMLElement): number | null { return this.layout.getLogicalRowIndexFromElement(rowElement); }
    forwardClonedCellPointerInteractions(cloneCell: HTMLElement, sourceCell: HTMLElement): void { this.layout.forwardClonedCellPointerInteractions(cloneCell, sourceCell); }
    cloneDetachedCell(sourceCell: HTMLElement): HTMLElement { return this.layout.cloneDetachedCell(sourceCell); }
    syncDetachedCellVisualState(sourceCell: HTMLElement, detachedCell: HTMLElement): void { this.layout.syncDetachedCellVisualState(sourceCell, detachedCell); }
    syncDetachedRowVisualState(sourceRow: HTMLElement, detachedRow: HTMLElement): void { this.layout.syncDetachedRowVisualState(sourceRow, detachedRow); }
    refreshDetachedHeaderLayers(): void { this.layout.refreshDetachedHeaderLayers(); }
    refreshQuadrantPaneLayers(): void { this.layout.refreshQuadrantPaneLayers(); }
    refreshQuadrantViewportRowHeaders(update: RenderedRowsUpdate | null): void { this.layout.refreshQuadrantViewportRowHeaders(update); }
    getDetachedViewportRowTopPx(sourceRow: HTMLElement, logicalRowIndex: number): string { return this.layout.getDetachedViewportRowTopPx(sourceRow, logicalRowIndex); }
    createDetachedViewportRowClone(sourceRow: HTMLElement): HTMLElement | null { return this.layout.createDetachedViewportRowClone(sourceRow); }
    syncDetachedViewportRowHeaderStates(): void { this.layout.syncDetachedViewportRowHeaderStates(); }
    refreshDetachedViewportRowHeaders(update: RenderedRowsUpdate | null): void { this.layout.refreshDetachedViewportRowHeaders(update); }
    syncDetachedLegacyStaticCellStates(): void { this.layout.syncDetachedLegacyStaticCellStates(); }
    private syncQuadrantStaticCellStates(): void { this.layout.syncQuadrantStaticCellStates(); }
    syncDetachedHeaderScrollOffset(): void { this.layout.syncDetachedHeaderScrollOffset(); }
    setInlineTransformIfChanged(element: HTMLElement, transform: string): void { this.layout.setInlineTransformIfChanged(element, transform); }
    setInlineZIndexIfChanged(element: HTMLElement, zIndex: string): void { this.layout.setInlineZIndexIfChanged(element, zIndex); }
    syncDetachedHeaderScrollOffsetWithPositions(scrollTop: number, scrollLeft: number): void { this.layout.syncDetachedHeaderScrollOffsetWithPositions(scrollTop, scrollLeft); }
    private syncScrollBoundVisuals(): void {
        this.layout.syncScrollBoundVisuals();
        this.updateCustomVerticalScrollbar();
    }
    syncScrollBoundVisualsWithPositions(scrollTop: number, scrollLeft: number): void {
        this.layout.syncScrollBoundVisualsWithPositions(scrollTop, scrollLeft);
        this.updateCustomVerticalScrollbar();
    }
    refreshDetachedHeaderLayout(): void { this.layout.refreshDetachedHeaderLayout(); }
    syncDetachedVisualState(): void { this.layout.syncDetachedVisualState(); }
    setDetachedHeaderTopOffset(offsetPx: number): void { this.layout.setDetachedHeaderTopOffset(offsetPx); }
    private refreshFreezeVisualState(): void { this.layout.refreshFreezeVisualState(); }
    syncFreezeStateCssClasses(): void { this.layout.syncFreezeStateCssClasses(); }
    getQuadrantViewportRowTopPx(logicalRowIndex: number): number { return this.layout.getQuadrantViewportRowTopPx(logicalRowIndex); }
    applyFreezeVisualStateToRenderedRows(): void { this.layout.applyFreezeVisualStateToRenderedRows(); }
    syncFreezeTransforms(scrollTop: number, scrollLeft: number): void { this.layout.syncFreezeTransforms(scrollTop, scrollLeft); }

    getStoreColumnIndex(domColumnIndex: number): number {
        const mapping = this.tableData.columnMapping;
        if (domColumnIndex < 0 || domColumnIndex >= mapping.length) return -1;
        return mapping[domColumnIndex];
    }

    /**
     * 内部モジュール用: 指定DOMインデックスの行要素を取得する（行挿入の insertBefore 用）。
     * getRowElement のパブリック版。スペーサーオフセットを考慮した正しい子要素を返す。
     */
    getRowElementForInsert(domRowIndex: number): HTMLElement | null {
        return this.getRowElement(domRowIndex);
    }

    /**
     * 差分テーブル用: storeRowIndices を行数ベースで再構築する。
     * 差分テーブルの左ペインで行挿入・削除後にストア行数と同期するために使用する。
     * 通常テーブルは storeRowIndices[i] = i のため、この処理で正しく初期化される。
     */
    rebuildStoreRowIndicesForDiff(): void {
        const storeRows = this.store.getRows(this.tableName);
        if (storeRows === false) return;
        this.storeRowIndices = Array.from({ length: storeRows.length }, (_, i) => i);
    }

    /**
     * 内部モジュール用: データ行をテーブル末尾（bottomSpacerの手前）に追加する。
     * バーチャルスクロール有効時はbottomSpacerの手前に挿入し、無効時は通常のappendChildを使う。
     */
    appendDataRowToTable(row: HTMLElement): void {
        this.virtualScroll.appendDataRow(row);
    }

    /** 内部モジュール用: DOMに新しい行が追加されたことをバーチャルスクロールに通知する */
    notifyVirtualScrollRowAppended(): void {
        this.virtualScroll.notifyRowAppended();
    }

    /** 内部モジュール用: DOMから行が削除されたことをバーチャルスクロールに通知する */
    notifyVirtualScrollRowRemoved(): void {
        this.virtualScroll.notifyRowRemoved();
    }

    /** 内部モジュール用: バーチャルスクロールの総行数を同期する。
     * 通常テーブルは末尾バッファ行を含め、差分テーブルは実データ行のみを使う。 */
    syncVirtualScrollTotalRowCount(): void {
        const bufferRowCount = this.diffTab === false ? 1 : 0;
        this.virtualScroll.updateTotalRowCount(this.getFilteredDataRowCount() + bufferRowCount);
    }

    /** 内部モジュール用: バーチャルスクロールで現在DOMに存在するデータ行の開始インデックス（0始まり）を返す */
    getVirtualScrollRenderedStart(): number {
        return this.virtualScroll.getRenderedRange().start;
    }

    /** 内部モジュール用: バーチャルスクロールで現在DOMに存在するデータ行の終了インデックス（排他、0始まり）を返す */
    getVirtualScrollRenderedEnd(): number {
        return this.virtualScroll.getRenderedRange().end;
    }

    /** 内部モジュール用: 中央ストアを取得する */
    getStore(): InMemoryTableStore { return this.store; }

    /** 内部モジュール用: Selection を取得する */
    getSelection(): Selection { return this.selection; }

    /** 内部モジュール用: EditorTableHandler を取得する */
    getHandler(): EditorTableHandler { return this.handler; }

    /** 内部モジュール用: RowDragController を取得する（行ヘッダー生成時のイベント接続用） */
    getRowDragController(): RowDragController { return this.rowDragController; }

    /** 内部モジュール用: 自テーブルの参照データキャッシュを無効化する（行追加・削除後に呼ぶ） */
    evictOwnReferenceDataCache(): void { this.referenceDataCache.evictEntry(this.tableName); }

    serializeSortKeys(): SerializedSortKey[] { return this.sortFilter.serializeSortKeys(); }
    serializeFilters(): SerializedFilters { return this.sortFilter.serializeFilters(); }

    /**
     * 指定データ列のスキーマ型名を返す。
     * 範囲外の場合は空文字を返す。
     * @param dataColumnIndex データ列インデックス（0始まり、行ヘッダーを除く）
     */
    getColumnType(dataColumnIndex: number): string {
        const col = this.tableData.header[dataColumnIndex];
        if (!col) return '';
        return col.type;
    }

    /**
     * 指定データ列がFK参照を持つかどうかを返す。
     * @param dataColumnIndex データ列インデックス（0始まり、行ヘッダーを除く）
     */
    hasColumnReference(dataColumnIndex: number): boolean {
        const col = this.tableData.header[dataColumnIndex];
        if (!col) return false;
        return col.reference !== null;
    }

    /**
     * bool型セルのトグル操作を handler に委譲する。
     * createCell の dblclick ハンドラや Spaceキーから呼ばれる（デメテルの法則: getHandler().toggleBoolCell() を避ける）。
     */
    toggleBoolCell(): void {
        this.handler.toggleBoolCell();
    }

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
        this.renderer.initialize();
    }

    /** バーチャルスクロールのスペーサーとDOM行を強制再計算する（タブ復帰時に使用） */
    forceVirtualScrollRecalculate(): void {
        this.renderer.forceVirtualScrollRecalculate();
    }

    /** バーチャルスクロールの全行を破棄して再レンダリングする（diffTab接続後の初期装飾適用に使用） */
    forceVirtualScrollFullRerender(): void {
        this.renderer.forceVirtualScrollFullRerender();
    }

    /**
     * 指定データ行インデックスのDOM行要素を生成して返す。
     * storeRowIndices 経由でストアからセル値を取得してセルを生成する。
     * バーチャルスクロールの行動的生成で再利用する。
     * テーブルへの追加（appendChild）は呼び出し側の責務。
     *
     * @param dataRowIndex storeRowIndices上のインデックス（0始まり）
     * @returns 生成された行要素（data-store-index 設定済み）
     */
    renderDataRow(dataRowIndex: number): HTMLElement {
        return this.renderer.renderDataRow(dataRowIndex);
    }

    /**
     * バッファ行（空行）のDOM要素を生成して返す。
     * バッファ行はユーザーが入力を開始するまで空のまま保持される待機行。
     *
     * @param dataRowIndex DOM上のデータ行インデックス（0始まり、ヘッダー行を除く）
     * @returns 生成された行要素（editor-table-empty-row クラス付き）
     */
    renderBufferRow(dataRowIndex: number): HTMLElement {
        return this.renderer.renderBufferRow(dataRowIndex);
    }

    /**
     * スクロールイベント時に行入れ替えの有無にかかわらず呼ばれる。
     * 固定行・固定列のセルが選択されている場合、fillHandle の位置を更新する。
     * fillHandle は選択終端セルの子要素として配置されるため、通常スクロールには自然に追従する。
     * 固定行/列ではスクロールに応じて可視セルが変わる場合があるため、ホストセルを再同期する。
     * 行入れ替え発生時は reapplyRowDecorations → updateFillHandlePosition が呼ばれるので
     * 重複更新になるが、軽量な処理のためパフォーマンス影響は無視できる。
     */
    onScrollForFrozenFillHandle(): void {
        this.renderer.onScrollForFrozenFillHandle();
    }

    /**
     * バーチャルスクロールのスペーサー要素をDOM上に配置する。
     * appendTo() 完了後（テーブル要素が親要素に追加された後）に呼ぶこと。
     */
    attachSpacers(): void {
        this.renderer.attachSpacers();
    }

    /**
     * グローバルイベントリスナーを登録する（タブがアクティブになったとき）
     * 視覚状態（editor-table--inactive クラス）は setInactiveAppearance() に一本化しているため、
     * ここでは操作しない。タブ復帰時に resume() で全ミニテーブルに activate() が呼ばれても
     * 非アクティブクラスが意図せず除去されるバグを防ぐためにこの分離が必要。
     */
    activate(): void {
        this.renderer.activate();
    }

    /**
     * グローバルイベントリスナーを解除する（タブが非アクティブになったとき）
     * 視覚状態（editor-table--inactive クラス）は setInactiveAppearance() に一本化しているため、
     * ここでは操作しない。
     */
    deactivate(): void {
        this.renderer.deactivate();
    }

    /**
     * テーブルにキーボードフォーカスを戻す。
     * FilterDropdown など外部UIを閉じた後に呼ぶことで、
     * Ctrl+Z/Ctrl+S などのキーボードショートカットが EditorTableHandler に到達するようにする。
     */
    focusTable(): void {
        this.renderer.focusTable();
    }

    /**
     * アクティブ/非アクティブの視覚状態のみを切り替える
     * activateHandler() から複数の EditorTable に対して呼ばれる。
     * selectionDragController は操作しない（handler の排他制御とは独立）。
     */
    setInactiveAppearance(inactive: boolean): void {
        this.renderer.setInactiveAppearance(inactive);
    }

    /** DOMレイアウト完了後にSelectionの視覚位置を現在の内部状態に基づいて更新する */
    refreshSelectionDisplay(): void {
        this.renderer.refreshSelectionDisplay();
    }

    /**
     * 読み取り専用にする（ミニEditorTable用）
     * セル編集UIの表示を禁止してストア汚染を防ぎ、Ctrl+Sも禁止してCSV破壊を防ぐ
     */
    makeReadOnly(): void {
        this.renderer.makeReadOnly();
    }

    /**
     * ミニEditorTableかどうかを判定する（EditorTableHandlerのCtrl+S禁止判定に使用）
     * RelationsPanelのcreateMinEditorTable()で生成された場合にtrueを返す。
     */
    isMiniTableInstance(): boolean {
        return this.renderer.isMiniTableInstance();
    }

    // =========================================================================
    // blame（変更履歴）表示
    // =========================================================================

    isBlameShown(): boolean { return this.git.isBlameShown(); }
    async showBlameAsync(): Promise<void> { return this.git.showBlameAsync(); }
    hideBlame(): void { this.git.hideBlame(); }
    private hideBlameIfVisible(): void { this.git.hideBlameIfVisible(); }

    // =========================================================================
    // スクロール
    // =========================================================================

    stopAutoScrollForInput(): void {
        this.renderer.stopAutoScrollForInput();
    }

    // =========================================================================
    // static メソッド
    // =========================================================================

    static createRow(cells: HTMLElement[], rowIndex?: number): HTMLElement { return EditorTableCellFactory.createRow(cells, rowIndex); }
    static createCell(table: EditorTable, value: number | string | string[] | undefined, columnIndex: number, width: string, height: string): HTMLElement { return EditorTableCellFactory.createCell(table, value, columnIndex, width, height); }
    public static getCellPosition(cell: HTMLElement, tableElement: HTMLElement): CellPosition | null { return EditorTableCellFactory.getCellPosition(cell, tableElement); }
    static getCellValue(cell: HTMLElement): string { return EditorTableCellFactory.getCellValue(cell); }
    static applyCellWidth(cell: HTMLElement, width: string): void { EditorTableCellFactory.applyCellWidth(cell, width); }
    static applyCellHeight(cell: HTMLElement, height: string): void { EditorTableCellFactory.applyCellHeight(cell, height); }

    // =========================================================================
    // DOMゲッター
    // =========================================================================

    /**
     * DOM行インデックスから行要素を取得する。
     * 0 = 列ヘッダー行、1以降 = データ行。
     *
     * domRowIndex は従来のインデックス体系（0=ヘッダー、1=データ行0、...）で呼ばれる。
     * 方式B（テーブル外スペーサー）のため、テーブル内 children のインデックスは従来と変わらない。
     * ただし仮想化有効時は表示範囲のデータ行のみがDOMに存在するため、
     * dataRowToDomIndex で実際の children インデックスに変換する。
     */
    private getRowElement(domRowIndex: number): HTMLElement | null {
        if (domRowIndex === 0) {
            // ヘッダー行は常に children[0]
            const headerRow = this.gridElement.children[0];
            return headerRow instanceof HTMLElement ? headerRow : null;
        }
        // domRowIndex は1始まりのデータ行インデックス。0始まりに変換する。
        const dataRowIndex = domRowIndex - 1;
        const actualDomIndex = this.virtualScroll.dataRowToDomIndex(dataRowIndex);
        if (actualDomIndex === null) return null;
        // bottomSpacer がテーブル末尾に存在するため、スペーサー行をデータ行として返さない
        if (this.virtualScroll.isSpacerIndex(actualDomIndex)) return null;
        const row = this.gridElement.children[actualDomIndex];
        if (!row) return null;
        return row as HTMLElement;
    }

    /**
     * 座標からセル要素を取得する
     * @param row 行インデックス（0始まり、列ヘッダー行を含む）
     * @param column 列インデックス（0始まり、行ヘッダーセルを含む）
     */
    getCell(row: number, column: number): HTMLElement {
        const rowElement = this.getRowElement(row);
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
     * 仮想スクロールでDOM外の行は null を返す。
     * DiffTab のセルクラス操作など、DOM上に行が存在しない場合を許容する呼び出しで使用する。
     */
    getCellOrNull(row: number, column: number): HTMLElement | null {
        const rowElement = this.getRowElement(row);
        if (!rowElement) return null;
        const cell = rowElement.children[column];
        // children[column] が範囲外の場合 undefined が返るため、null に正規化する
        if (!cell) return null;
        return cell as HTMLElement;
    }

    private getVisibleDetachedCellOrNull(row: number, column: number): HTMLElement | null {
        if (!this.usesInternalMainViewport) return null;
        const fixedLeftColumnCount = this.dataColumnOffset() + this.frozenColumnCount;
        if (row === 0) {
            const headerLayer = column < fixedLeftColumnCount ? this.detachedCornerLayer : this.detachedColumnHeaderLayer;
            const headerRow = headerLayer.firstElementChild as HTMLElement | null;
            if (headerRow === null) return null;
            const childIndex = column < fixedLeftColumnCount ? column : column - fixedLeftColumnCount;
            const cell = headerRow.children[childIndex];
            return cell instanceof HTMLElement ? cell : null;
        }
        const dataRowIndex = row - 1;
        if (dataRowIndex < this.frozenRowCount) {
            const layer = column < fixedLeftColumnCount ? this.detachedFrozenCornerDataLayer : this.detachedFrozenRowDataLayer;
            const detachedRow = layer.querySelector<HTMLElement>(`.editor-table-detached-row[data-row-index="${dataRowIndex}"]`);
            if (detachedRow === null) return null;
            const childIndex = column < fixedLeftColumnCount ? column : column - fixedLeftColumnCount;
            const cell = detachedRow.children[childIndex];
            return cell instanceof HTMLElement ? cell : null;
        }
        if (column >= fixedLeftColumnCount) return null;
        const detachedRow = this.detachedRowHeaderLayer.querySelector<HTMLElement>(`.editor-table-detached-row[data-row-index="${dataRowIndex}"]`);
        if (detachedRow === null) return null;
        const cell = detachedRow.children[column];
        return cell instanceof HTMLElement ? cell : null;
    }

    getVisibleCellOrNull(row: number, column: number): HTMLElement | null {
        const detachedCell = this.getVisibleDetachedCellOrNull(row, column);
        if (detachedCell !== null) return detachedCell;
        return this.getCellOrNull(row, column);
    }

    markFocusedCell(row: number, col: number): void { this.selectionView.markFocusedCell(row, col); }
    clearFocusedCell(): void { this.selectionView.clearFocusedCell(); }
    applySelectionClasses(range: CellRange, focusRow: number, focusCol: number): void { this.selectionView.applySelectionClasses(range, focusRow, focusCol); }
    clearSelectionClasses(): void { this.selectionView.clearSelectionClasses(); }

    connectValidationPanel(panel: ValidationPanel): void { this.validationMarkers.connectValidationPanel(panel); }
    connectScrollbarMarkerTrack(track: ScrollbarMarkerTrack): void { this.validationMarkers.connectScrollbarMarkerTrack(track); }
    createScrollbarMarkerTrack(cssClass: string): ScrollbarMarkerTrack { return this.validationMarkers.createScrollbarMarkerTrack(cssClass); }
    reattachScrollbarMarkerTrack(): void { this.validationMarkers.reattachScrollbarMarkerTrack(); }

    getScrollLeft(): number {
        return this.scrollContainer.scrollLeft;
    }

    getScrollTop(): number {
        return this.virtualScroll.getLogicalScrollTop();
    }

    getCustomVerticalScrollbarWidthPx(): number {
        return this.usesInternalMainViewport ? CUSTOM_VERTICAL_SCROLLBAR_WIDTH_PX : 0;
    }

    usesLogicalVerticalScroll(): boolean {
        return this.usesInternalMainViewport && this.virtualScroll.handlesScrollEvents();
    }

    getScrollMetrics(): { scrollTop: number; scrollLeft: number; scrollHeight: number; scrollWidth: number; clientHeight: number; clientWidth: number } {
        return {
            scrollTop: this.getScrollTop(),
            scrollLeft: this.scrollContainer.scrollLeft,
            scrollHeight: this.virtualScroll.getLogicalScrollHeightPx(),
            scrollWidth: this.scrollContainer.scrollWidth,
            clientHeight: this.scrollContainer.clientHeight,
            clientWidth: this.scrollContainer.clientWidth,
        };
    }

    getPhysicalScrollMetrics(): { scrollTop: number; scrollLeft: number; scrollHeight: number; scrollWidth: number; clientHeight: number; clientWidth: number } {
        return {
            scrollTop: this.scrollContainer.scrollTop,
            scrollLeft: this.scrollContainer.scrollLeft,
            scrollHeight: this.scrollContainer.scrollHeight,
            scrollWidth: this.scrollContainer.scrollWidth,
            clientHeight: this.scrollContainer.clientHeight,
            clientWidth: this.scrollContainer.clientWidth,
        };
    }

    private emitScrollMetricsChanged(): void {
        this.element.dispatchEvent(new CustomEvent('editor-table-scroll-metrics-changed', {
            bubbles: true,
            detail: this.getScrollMetrics(),
        }));
    }

    emitSelectionChanged(): void {
        this.element.dispatchEvent(new CustomEvent('editor-table-selection-changed', {
            bubbles: true,
            detail: {
                focus: {...this.selection.getFocus()},
                range: {...this.selection.getRange()},
            },
        }));
    }

    usesInternalScrollLayout(): boolean {
        return this.usesInternalMainViewport;
    }

    scrollByInput(deltaTopPx: number, deltaLeftPx: number): void {
        if (deltaTopPx === 0 && deltaLeftPx === 0) return;
        this.virtualScroll.setLogicalScrollTop(this.getScrollTop() + deltaTopPx);
        this.scrollContainer.scrollLeft += deltaLeftPx;
        this.scrollContainer.dispatchEvent(new Event('scroll'));
        this.syncScrollBoundVisuals();
        this.emitScrollMetricsChanged();
    }

    restoreScrollPosition(scrollTop: number, scrollLeft: number): void {
        this.virtualScroll.setLogicalScrollTop(scrollTop);
        this.scrollContainer.scrollLeft = scrollLeft;
        this.scrollContainer.dispatchEvent(new Event('scroll'));
        this.syncScrollBoundVisuals();
        this.emitScrollMetricsChanged();
    }

    restorePhysicalScrollPosition(scrollTop: number, scrollLeft: number): void {
        this.virtualScroll.setPhysicalScrollTop(scrollTop);
        this.scrollContainer.scrollLeft = scrollLeft;
        this.scrollContainer.dispatchEvent(new Event('scroll'));
        this.syncScrollBoundVisuals();
        this.emitScrollMetricsChanged();
    }

    private handleCompressedScrollWheel(event: WheelEvent): void {
        if (!this.virtualScroll.usesCompressedVerticalScroll()) return;
        if (event.ctrlKey) return;
        let deltaX = event.deltaX;
        let deltaY = event.deltaY;
        if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
            deltaX *= 16;
            deltaY *= 16;
        } else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
            deltaX *= this.scrollContainer.clientWidth;
            deltaY *= this.scrollContainer.clientHeight;
        }
        if (event.shiftKey && deltaX === 0 && deltaY !== 0) {
            deltaX = deltaY;
            deltaY = 0;
        }
        if (deltaX === 0 && deltaY === 0) return;
        event.preventDefault();
        this.scrollByInput(deltaY, deltaX);
    }

    private getCustomVerticalScrollbarTrackHeightPx(): number {
        const horizontalScrollbarHeight = Math.max(0, this.scrollContainer.offsetHeight - this.scrollContainer.clientHeight);
        const bottom = `${horizontalScrollbarHeight}px`;
        if (this.customVerticalScrollbar.style.bottom !== bottom) {
            this.customVerticalScrollbar.style.bottom = bottom;
        }
        return this.customVerticalScrollbar.clientHeight;
    }

    updateCustomVerticalScrollbar(): void {
        if (!this.usesInternalMainViewport) return;
        const metrics = this.getScrollMetrics();
        const maxScrollTop = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
        const trackHeight = this.getCustomVerticalScrollbarTrackHeightPx();
        if (maxScrollTop <= 0 || trackHeight <= 0) {
            this.customVerticalScrollbar.classList.add('editor-table-logical-vertical-scrollbar--disabled');
            this.customVerticalScrollbarThumb.style.height = '0px';
            this.customVerticalScrollbarThumb.style.transform = 'translateY(0px)';
            return;
        }

        this.customVerticalScrollbar.classList.remove('editor-table-logical-vertical-scrollbar--disabled');
        const proportionalThumbHeight = trackHeight * (metrics.clientHeight / metrics.scrollHeight);
        const thumbHeight = Math.min(
            trackHeight,
            Math.max(CUSTOM_VERTICAL_SCROLLBAR_MIN_THUMB_HEIGHT_PX, Math.round(proportionalThumbHeight))
        );
        const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
        const thumbTop = maxThumbTop <= 0 ? 0 : Math.round((metrics.scrollTop / maxScrollTop) * maxThumbTop);
        this.customVerticalScrollbarThumb.style.height = `${thumbHeight}px`;
        this.customVerticalScrollbarThumb.style.transform = `translateY(${thumbTop}px)`;
    }

    private getLogicalScrollTopFromCustomScrollbarPointer(clientY: number): number {
        const metrics = this.getScrollMetrics();
        const maxScrollTop = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
        if (maxScrollTop <= 0) return 0;
        const trackRect = this.customVerticalScrollbar.getBoundingClientRect();
        const trackHeight = this.getCustomVerticalScrollbarTrackHeightPx();
        const thumbHeight = this.customVerticalScrollbarThumb.offsetHeight;
        const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
        if (maxThumbTop <= 0) return 0;
        const thumbTop = Math.min(maxThumbTop, Math.max(0, clientY - trackRect.top - (thumbHeight / 2)));
        return (thumbTop / maxThumbTop) * maxScrollTop;
    }

    private handleCustomVerticalScrollbarPointerDown(event: PointerEvent): void {
        if (event.button !== 0) return;
        event.preventDefault();
        this.focusTable();
        if (event.target === this.customVerticalScrollbarThumb) {
            this.customVerticalScrollbarDragState = {
                startClientY: event.clientY,
                startScrollTop: this.getScrollTop(),
            };
        } else {
            this.restoreScrollPosition(
                this.getLogicalScrollTopFromCustomScrollbarPointer(event.clientY),
                this.getScrollLeft()
            );
            this.customVerticalScrollbarDragState = {
                startClientY: event.clientY,
                startScrollTop: this.getScrollTop(),
            };
        }
        this.customVerticalScrollbar.classList.add('editor-table-logical-vertical-scrollbar--dragging');
        this.customVerticalScrollbar.setPointerCapture(event.pointerId);
        window.addEventListener('pointermove', this.handleCustomVerticalScrollbarPointerMoveBound);
        window.addEventListener('pointerup', this.handleCustomVerticalScrollbarPointerUpBound, { once: true });
    }

    private handleCustomVerticalScrollbarPointerMove(event: PointerEvent): void {
        const dragState = this.customVerticalScrollbarDragState;
        if (dragState === null) return;
        event.preventDefault();
        const metrics = this.getScrollMetrics();
        const maxScrollTop = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
        if (maxScrollTop <= 0) return;
        const trackHeight = this.getCustomVerticalScrollbarTrackHeightPx();
        const thumbHeight = this.customVerticalScrollbarThumb.offsetHeight;
        const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
        if (maxThumbTop <= 0) return;
        const deltaRatio = (event.clientY - dragState.startClientY) / maxThumbTop;
        const nextScrollTop = dragState.startScrollTop + (deltaRatio * maxScrollTop);
        this.restoreScrollPosition(nextScrollTop, this.getScrollLeft());
    }

    private handleCustomVerticalScrollbarPointerUp(_event: PointerEvent): void {
        this.customVerticalScrollbarDragState = null;
        this.customVerticalScrollbar.classList.remove('editor-table-logical-vertical-scrollbar--dragging');
        window.removeEventListener('pointermove', this.handleCustomVerticalScrollbarPointerMoveBound);
    }

    private handleCustomVerticalScrollbarWheel(event: WheelEvent): void {
        if (event.ctrlKey) return;
        let deltaY = event.deltaY;
        if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
            deltaY *= 16;
        } else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
            deltaY *= this.scrollContainer.clientHeight;
        }
        if (deltaY === 0) return;
        event.preventDefault();
        this.scrollByInput(deltaY, 0);
    }

    /**
     * ErrorTooltip を接続する（Tab.createEditorTable 内から呼ばれる）。
     * 接続後、テーブル要素に mouseover/mouseout のイベントデリゲーションを登録する。
     *
     * イベントデリゲーション方式: セルごとにリスナーを貼るのではなくテーブル要素で一括捕捉する。
     * セルは動的に追加・削除されるため、デリゲーション方式が適切。
     */
    connectErrorTooltip(tooltip: ErrorTooltip): void {
        this.element.addEventListener('mouseover', (e) => {
            const target = e.target as HTMLElement;
            // セル要素またはその子要素（参照ヒント span 等）からセル要素を探す
            const cell = target.classList.contains('editor-table-cell') ? target : target.closest('.editor-table-cell') as HTMLElement | null;
            if (!cell) return;
            if (!cell.classList.contains('cell-error')) return;
            // DOM座標からストア座標に変換する
            const position = this.getCellPositionFromElement(cell);
            if (!position) return;
            // DOM行 position.row はヘッダー行を含む（0=ヘッダー）。データ行は1始まり。
            // フィルター適用時は論理行インデックスのため resolveStoreRowIndex で変換する
            const domDataRowIndex = position.row - 1;
            const storeRowIndex = this.resolveStoreRowIndex(domDataRowIndex);
            if (storeRowIndex < 0) return;
            // DOM列 position.column は行ヘッダーを含む（0=行ヘッダー）。データ列は1始まり。
            const domDataColIndex = position.column - this.dataColumnOffset();
            const storeColIndex = this.getStoreColumnIndex(domDataColIndex);
            if (storeColIndex === -1) return;
            tooltip.showAfterDelay(cell, this.tableName, storeRowIndex, storeColIndex);
        });

        this.element.addEventListener('mouseout', (e) => {
            const target = e.target as HTMLElement;
            const cell = target.classList.contains('editor-table-cell') ? target : target.closest('.editor-table-cell') as HTMLElement | null;
            if (!cell) return;
            // relatedTarget（移動先要素）が同一セル内の子要素であればツールチップを消さない
            const related = e.relatedTarget as HTMLElement | null;
            if (related && cell.contains(related)) return;
            tooltip.hide();
        });

        // セルクリック時にツールチップを非表示にする（編集モードに入るため邪魔になる）
        this.element.addEventListener('mousedown', () => {
            tooltip.hide();
        });

        // スクロール時にツールチップを非表示にする（位置がずれるため）
        // EditorTable の親（スクロールコンテナ）にリスナーを追加する
        const scrollParent = this.element.parentElement;
        if (scrollParent) {
            scrollParent.addEventListener('scroll', () => {
                tooltip.hide();
            });
        }
    }

    // =========================================================================
    // フリーズペイン（行/列の固定）
    // =========================================================================

    /** 現在の固定列数を返す */
    getFrozenColumnCount(): number { return this.frozenColumnCount; }

    /** 現在の固定行数を返す */
    getFrozenRowCount(): number { return this.frozenRowCount; }

    /**
     * 先頭からcount列を固定する。
     * 固定列のセルにはスクロール量を打ち消す transform を適用し、
     * 最後の固定列に freeze-column-border クラスを付与する。
     * 永続化はコンテキストメニューのaction側が saveFreezeStateAsync() を呼ぶ責務。
     */
    freezeColumns(count: number): void {
        if (count === 0) { this.unfreezeColumns(); return; }
        this.clearFreezeColumnStyles();
        this.frozenColumnCount = count;
        this.applyFreezeColumnStyles();
    }

    /**
     * 列固定を解除する。
     * 固定セルの transform をクリアし、freeze-column-border を除去する。
     */
    unfreezeColumns(): void {
        this.clearFreezeColumnStyles();
        this.frozenColumnCount = 0;
        this.refreshFreezeVisualState();
    }

    /**
     * 先頭からcount行を固定する。
     * 該当行にはスクロール量を打ち消す transform を適用し、
     * 最後の固定行に freeze-row-border クラスを付与する。
     * 永続化はコンテキストメニューのaction側が saveFreezeStateAsync() を呼ぶ責務。
     */
    freezeRows(count: number): void {
        if (count === 0) { this.unfreezeRows(); return; }
        this.clearFreezeRowStyles();
        this.frozenRowCount = count;
        // 仮想スクロールに固定行数を通知し、固定行がDOMから削除されないようにする
        this.virtualScroll.setFrozenRowCount(count);
        this.applyFreezeRowStyles();
    }

    /**
     * 行固定を解除する。
     * 固定行の transform をクリアし、freeze-row-border を除去する。
     */
    unfreezeRows(): void {
        this.clearFreezeRowStyles();
        this.frozenRowCount = 0;
        // 仮想スクロールの固定行数をリセットする
        this.virtualScroll.setFrozenRowCount(0);
        this.refreshFreezeVisualState();
    }

    /**
     * フリーズペイン状態をスキーマJSONに永続化する。
     * コンテキストメニューからのfreeze/unfreeze操作後に呼び出す。
     * テーブルオープン時の復元ではsaveSchemaDataAsyncを呼ばないよう、
     * freeze/unfreezeメソッド自体からは分離している。
     */
    saveFreezeStateAsync(): void {
        saveSchemaDataAsync(this);
    }

    /**
     * 現在DOMに存在する行要素を順番に返す。
     * 仮想スクロール有効時はスペーサー行を除外し、ヘッダー行・固定行・表示中の通常行のみを対象にする。
     */
    private getRenderedRowElements(): HTMLElement[] {
        const rows: HTMLElement[] = [];
        for (let childIndex = 0; childIndex < this.gridElement.children.length; childIndex++) {
            if (this.virtualScroll.isSpacerIndex(childIndex)) continue;
            const rowElement = this.gridElement.children[childIndex];
            if (rowElement) {
                rows.push(rowElement as HTMLElement);
            }
        }
        return rows;
    }

    /** 固定列の視覚スタイルを再構築する。 */
    applyFreezeColumnStyles(): void {
        this.refreshFreezeVisualState();
    }

    /** 固定列の視覚スタイルを全列から除去する。 */
    private clearFreezeColumnStyles(): void {
        const renderedRows = this.getRenderedRowElements();
        const dataColumnOffset = this.dataColumnOffset();
        for (const rowElement of renderedRows) {
            const logicalRowIndex = this.getLogicalRowIndexFromElement(rowElement);
            const isFrozenRow = logicalRowIndex !== null && logicalRowIndex > 0 && logicalRowIndex <= this.frozenRowCount;
            for (let col = dataColumnOffset; col < rowElement.children.length; col++) {
                const cell = rowElement.children[col] as HTMLElement;
                cell.style.transform = '';
                cell.style.zIndex = '';
                cell.classList.remove('freeze-column-border');
                if (!isFrozenRow) cell.classList.remove('freeze-cell');
            }
        }
    }

    /** 固定行の視覚スタイルを再構築する。 */
    applyFreezeRowStyles(): void {
        this.refreshFreezeVisualState();
    }

    /** 固定行の視覚スタイルを全行から除去する。 */
    private clearFreezeRowStyles(): void {
        const renderedRows = this.getRenderedRowElements();
        const dataColumnOffset = this.dataColumnOffset();
        for (const rowElement of renderedRows) {
            rowElement.style.transform = '';
            rowElement.style.zIndex = '';
            rowElement.classList.remove('freeze-row');
            rowElement.classList.remove('freeze-row-border');
            for (let col = dataColumnOffset; col < rowElement.children.length; col++) {
                if (col < dataColumnOffset + this.frozenColumnCount) continue;
                rowElement.children[col].classList.remove('freeze-cell');
            }
        }
    }

    /**
     * 行/列の構造変更後にフリーズスタイルを再適用する。
     * 一度クリアしてから再適用することで、構造変更で残った古いスタイルを確実に除去する。
     */
    private reapplyFreezeStylesAfterStructureChange(): void {
        this.refreshFreezeVisualState();
    }

    /**
     * 全セルからフリーズ関連スタイル（transform, zIndex, border/cell クラス）を除去する。
     * 構造変更後に位置がずれたセルの古いスタイル残留を防ぐため、全セルを走査する。
     */
    clearAllFreezeStyles(): void {
        const rowCount = this.getRowCount();
        for (let row = 0; row < rowCount; row++) {
            const rowElement = this.getRowElement(row);
            if (!rowElement) continue;
            rowElement.style.transform = '';
            rowElement.style.zIndex = '';
            rowElement.classList.remove('freeze-row');
            rowElement.classList.remove('freeze-row-border');
            const cellCount = rowElement.children.length;
            for (let col = 0; col < cellCount; col++) {
                const cell = rowElement.children[col] as HTMLElement;
                cell.style.transform = '';
                cell.style.zIndex = '';
                cell.classList.remove('freeze-column-border', 'freeze-row-border', 'freeze-cell');
            }
        }
    }

    /**
     * 行数を取得する（列ヘッダー行を含む、スペーサー行は除外）
     */
    getRowCount(): number {
        return this.gridElement.children.length - this.virtualScroll.totalSpacerCount();
    }

    /**
     * テーブル内のデータ行が始まる children オフセットを返す。
     * 仮想スクロール有効: 1（ヘッダー行）+ 1（topSpacer）= 2
     * 仮想スクロール無効（ミニテーブル）: 1（ヘッダー行のみ）
     * RowDragController が children[i + offset] でデータ行にアクセスするために使用する。
     */
    getDataRowChildOffset(): number {
        return 1 + this.virtualScroll.spacerCount();
    }

    /**
     * テーブル内のデータ行が終わる children インデックス（排他）を返す。
     * bottomSpacer を除外した終了インデックスを返すため、children 走査のループ終了条件に使う。
     */
    getDataRowEndChildIndex(): number {
        return this.virtualScroll.getDataRowEndChildIndex();
    }

    /**
     * フィルター適用後のデータ行数を返す。
     * フィルター適用時: filteredRowIndices.length（フィルター条件を満たす行のみ）
     * フィルター未適用時: storeRowIndices.length（全データ行）
     */
    private getFilteredDataRowCount(): number {
        return this.columnFilter.hasActiveFilter() ? this.filteredRowIndices.length : this.storeRowIndices.length;
    }

    /**
     * フィルター後の論理データ行インデックス（0始まり）からストア行インデックスを解決する。
     *
     * フィルター未適用時: storeRowIndices[dataRowIndex] をそのまま返す。
     * フィルター適用時: filteredRowIndices[dataRowIndex] で storeRowIndices 上のインデックスを取得し、
     *   storeRowIndices[mappedIndex] でストア行インデックスを返す。
     *
     * getCellPosition() が返す row（= data-row-index + 1）はフィルター適用時に論理行番号（0,1,2,...）に
     * 上書きされるため、セル編集等でストアにアクセスする際はこのメソッドで正しいストア行を解決すること。
     * -1 を返す場合はストアアクセス不可（範囲外）。
     */
    resolveStoreRowIndex(dataRowIndex: number): number {
        if (!this.columnFilter.hasActiveFilter()) {
            if (dataRowIndex < 0 || dataRowIndex >= this.storeRowIndices.length) return -1;
            return this.storeRowIndices[dataRowIndex];
        }
        if (dataRowIndex < 0 || dataRowIndex >= this.filteredRowIndices.length) return -1;
        const mappedIndex = this.filteredRowIndices[dataRowIndex];
        if (mappedIndex < 0 || mappedIndex >= this.storeRowIndices.length) return -1;
        return this.storeRowIndices[mappedIndex];
    }

    /**
     * 論理的な全行数を返す（列ヘッダー行を含む）。
     * 仮想スクロール時もDOMに存在しない行を含めた全データ行+バッファ行の数を返す。
     * フィルター適用時はフィルター後の行数に基づく（非表示行は論理行数に含めない）。
     * Selection の列全選択・行全選択など、全行を対象とする操作で使用する。
     */
    getLogicalRowCount(): number {
        // getFilteredDataRowCount() = フィルター後のデータ行数, +1 = バッファ行, +1 = 列ヘッダー行
        return this.getFilteredDataRowCount() + 1 + 1;
    }

    /**
     * 列数を取得する（行ヘッダーセルを除く）
     */
    getColumnCount(): number {
        return this.tableData.header.length;
    }

    /**
     * 座標でセルの値を取得する（参照ヒントを除外）。
     * 仮想スクロールで行がDOMに存在しない場合はストアから直接取得する。
     */
    getCellValueAt(row: number, column: number): string {
        if (row === 0) {
            if (column < this.dataColumnOffset()) return '';
            const headerColumnIndex = column - this.dataColumnOffset();
            if (headerColumnIndex < 0 || headerColumnIndex >= this.tableData.header.length) return '';
            return this.tableData.header[headerColumnIndex].name;
        }
        if (column < this.dataColumnOffset()) {
            if (!this.isBlameVisible && column === 0) return String(row);
            if (this.isBlameVisible && column === 1) return String(row);
            return '';
        }
        const dataRowIndex = row - 1;
        if (dataRowIndex < 0 || dataRowIndex >= this.getFilteredDataRowCount()) return '';
        const storeRowIndex = this.resolveStoreRowIndex(dataRowIndex);
        if (storeRowIndex < 0) return '';
        const storeRows = this.store.getRows(this.tableName);
        if (storeRows === false || storeRowIndex >= storeRows.length) return '';
        const dataColIndex = column - this.dataColumnOffset();
        if (dataColIndex < 0 || dataColIndex >= this.tableData.columnMapping.length) return '';
        const storeColIndex = this.tableData.columnMapping[dataColIndex];
        if (storeColIndex === -1 || storeColIndex >= storeRows[storeRowIndex].length) return '';
        return storeRows[storeRowIndex][storeColIndex];
    }

    /**
     * 座標で参照ヒントのテキストを取得する。
     * ストア/参照キャッシュから解決するため、DOM外の行でも取得できる。
     */
    getReferenceHintText(row: number, column: number): string | null {
        return this.reference.getHintText(row, column);
    }

    /**
     * 列ヘッダーの値を取得する。
     * comment付き2行構造では .column-header-name span から、それ以外は TextNode から取得する。
     */
    getColumnHeaderValue(columnIndex: number): string {
        const column = this.tableData.header[columnIndex];
        if (!column) throw new Error(`列定義が見つかりません: columnIndex=${columnIndex}`);
        return column.name;
    }

    /**
     * 列ヘッダーの値を設定する。
     * comment付き2行構造では .column-header-name span を、それ以外は TextNode を更新する。
     */
    setColumnHeaderValue(columnIndex: number, value: string): void {
        const column = this.tableData.header[columnIndex];
        if (!column) throw new Error(`列定義が見つかりません: columnIndex=${columnIndex}`);
        column.name = value;
        const storeColumnIndex = this.getStoreColumnIndex(columnIndex);
        if (storeColumnIndex !== -1) this.store.renameColumn(this.tableName, storeColumnIndex, value);
        const headerRow = this.gridElement.children[0] as HTMLElement;
        const headerCell = headerRow.children[columnIndex + this.dataColumnOffset()] as HTMLElement;
        // comment付き2行構造の場合は .column-header-name span を優先する
        const nameSpan = headerCell.querySelector('.column-header-name');
        if (nameSpan !== null) {
            nameSpan.textContent = value;
            this.refreshDetachedHeaderLayout();
            return;
        }
        for (const node of Array.from(headerCell.childNodes)) {
            if (node.nodeType === Node.TEXT_NODE) {
                node.textContent = value;
                this.refreshDetachedHeaderLayout();
                return;
            }
        }
        headerCell.insertBefore(document.createTextNode(value), headerCell.firstChild);
        this.refreshDetachedHeaderLayout();
    }

    /**
     * 列ヘッダーにCSSクラスを追加する
     */
    addColumnHeaderClass(columnIndex: number, className: string): void {
        const headerRow = this.gridElement.children[0];
        const headerCell = headerRow.children[columnIndex + this.dataColumnOffset()] as HTMLElement;
        if (headerCell) {
            headerCell.classList.add(className);
        }
        this.refreshDetachedHeaderLayout();
    }

    /**
     * 指定列の幅を取得（列ヘッダーセルから取得）
     */
    getColumnWidth(columnIndex: number): string {
        const column = this.tableData.header[columnIndex];
        if (!column) throw new Error(`列定義が見つかりません: columnIndex=${columnIndex}`);
        return column.width;
    }

    /**
     * 全列の幅を配列で取得する
     */
    getColumnWidths(): string[] {
        return this.tableData.header.map(column => column.width);
    }

    getColumnHeaderValues(): string[] {
        return this.tableData.header.map(column => column.name);
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
     * 外部から Command を実行して履歴に追加する（検索置換パネル等から呼ばれる）。
     * 呼び出し元が正確な range を渡す。コピー範囲は現在の Selection 状態を使う。
     */
    executeExternalCommand(command: Command, range: CellRange): void {
        const copyRange = this.selection.getCopyRange();
        this.history.executeCommand(command, range, copyRange);
    }

    /**
     * フォームビューなど、EditorTable外のUIからストア座標でセルを編集する。
     * 通常のセル編集と同じ CellChangeCommand 経由で履歴・Dirty・バリデーションを更新する。
     */
    applyExternalCellEditByStoreIndex(storeRowIndex: number, storeColumnIndex: number, newValue: string): boolean {
        const dataColumnIndex = this.tableData.columnMapping.indexOf(storeColumnIndex);
        if (dataColumnIndex === -1) return false;
        const domRow = this.storeRowToDomRow(storeRowIndex);
        if (domRow === null) return false;
        const domColumn = dataColumnIndex + this.dataColumnOffset();
        const oldValue = this.getCellValueAt(domRow, domColumn);
        if (oldValue === newValue) {
            this.runValidation();
            return true;
        }
        const range = {startRow: domRow, startColumn: domColumn, endRow: domRow, endColumn: domColumn};
        const command = new CellChangeCommand(this, [{row: domRow, column: domColumn, oldValue, newValue}], range, this.selection.getCopyRange());
        this.history.executeCommand(command, range, this.selection.getCopyRange());
        return true;
    }

    /**
     * PK値から DOM 行インデックス（1始まり）を検索する。見つからない場合は -1 を返す。
     */
    findDomRowByPkValue(pkValue: string): number {
        const rowCount = this.getRowCount();
        for (let r = 1; r < rowCount; r++) {
            if (this.getRowPkValue(r) === pkValue) return r;
        }
        return -1;
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
        const dataRowCount = this.getFilteredDataRowCount();
        for (let rowIdx = 1; rowIdx <= dataRowCount; rowIdx++) {
            const cellValue = this.getCellValueAt(rowIdx, columnIndex + this.dataColumnOffset());
            ctx.font = CELL_FONT;
            const textWidth = ctx.measureText(cellValue).width;

            // 参照ヒント幅を計測（通常参照ヒント・逆参照ヒントのどちらも対象）
            const hintText = this.getReferenceHintText(rowIdx, columnIndex);
            let hintWidth = 0;
            if (hintText !== null) {
                ctx.font = REFERENCE_HINT_FONT;
                hintWidth = ctx.measureText(hintText).width + REFERENCE_HINT_MARGIN_PX;
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
     * イベントリスナー（dblclick・mousedown・contextmenu）は不要かつ有害なため、
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
        const column = this.tableData.header[columnIndex];
        if (!column) throw new Error(`列定義が見つかりません: columnIndex=${columnIndex}`);
        column.width = width;
        for (let i = 0; i < this.getRowCount(); ++i) {
            const rowElement = this.getRowElement(i);
            if (!rowElement) continue;
            const cell = rowElement.children[columnIndex + this.dataColumnOffset()] as HTMLElement;
            if (cell) {
                EditorTable.applyCellWidth(cell, width);
            }
        }
        this.refreshFreezeVisualState();
    }

    /**
     * 指定座標のセルのBoundingClientRectを取得する
     */
    /**
     * 指定行がDOMに存在するよう保証する（バーチャルスクロール対応）。
     * row は DOM行インデックス（0始まり、列ヘッダー行=0、データ行1行目=1）。
     * セルの矩形取得やセル編集開始の前に呼んで、対象行をDOMに確保する。
     */
    ensureRowVisible(row: number): void {
        if (row < 1) return;
        this.virtualScroll.ensureRowVisible(row - 1);
        this.updateCustomVerticalScrollbar();
    }

    centerRowVertically(row: number): void {
        if (row < 1) return;
        this.virtualScroll.centerRowVertically(row - 1);
        this.updateCustomVerticalScrollbar();
    }

    getCellRectAt(row: number, column: number): DOMRect {
        const rect = this.getCellRectOrNull(row, column);
        if (rect === null) throw new Error(`セル矩形が見つかりません: row=${row}, column=${column}`);
        return rect;
    }

    /**
     * 座標でセルのBoundingClientRectを取得する（存在しない場合はnull）
     */
    getCellRectOrNull(row: number, column: number): DOMRect | null {
        const detachedCell = this.getVisibleDetachedCellOrNull(row, column);
        if (detachedCell !== null) return detachedCell.getBoundingClientRect();
        const rowElement = this.getRowElement(row);
        if (!rowElement) return null;
        const cell = rowElement.children[column] as HTMLElement | null;
        if (!cell) return null;
        return cell.getBoundingClientRect();
    }

    /**
     * テキストフィールドの幅を計算する
     */
    calculateTextFieldWidth(_row: number, column: number, textWidth: number): { width: number; cellHeight: number } {
        const dataColumnIndex = column - this.dataColumnOffset();
        if (dataColumnIndex < 0 || dataColumnIndex >= this.getColumnCount()) return { width: 0, cellHeight: 0 };
        const cellHeight = ROW_TOTAL_HEIGHT_PX;
        let width = 0;
        for (let i = dataColumnIndex; i < this.getColumnCount(); i++) {
            width += this.getRenderedDataColumnWidthPx(i);
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
     * セル要素から位置を取得する。
     * 返される column は生のDOMインデックス（blame表示時はblame列=0を含む）。
     * データ列インデックスへの変換は column - dataColumnOffset() で行うこと。
     */
    getCellPositionFromElement(cell: HTMLElement): CellPosition | null {
        return EditorTable.getCellPosition(cell, this.element);
    }

    /**
     * 行ヘッダーを含む全列数を取得する
     */
    getTotalColumnCount(): number {
        return this.dataColumnOffset() + this.getColumnCount();
    }

    /**
     * 列ヘッダー行の高さを取得する
     */
    getFirstRowHeight(): number {
        return this.usesInternalMainViewport ? 0 : this.getHeaderRowHeightPx();
    }

    /**
     * 選択セルの可視判定で避けるべき固定領域のインセットを返す。
     * 上端は列ヘッダー + 固定行、左端は blame列 + 行ヘッダー + 固定列の累積サイズとなる。
     */
    getSelectionViewportInsets(): { top: number; left: number } {
        if (this.usesInternalMainViewport) {
            return { top: 0, left: 0 };
        }
        let top = this.detachedHeaderTopOffset + this.getHeaderRowHeightPx() + (this.frozenRowCount * this.getDataRowHeightPx());
        let left = this.getDetachedPrefixWidthPx() + this.getFrozenColumnAreaWidthPx();
        return { top, left };
    }

    /**
     * 指定DOM列の水平方向レイアウト境界を返す。
     * detached layer / transform 適用後でも、列幅SSOTからスクロール計算できるようにする。
     */
    getCellHorizontalLayoutBounds(column: number): { left: number; right: number } {
        const dataColumnIndex = column - this.dataColumnOffset();
        if (dataColumnIndex < 0) {
            return this.usesInternalMainViewport
                ? { left: 0, right: this.getFixedLeftWidthPx() }
                : { left: 0, right: this.getDetachedPrefixWidthPx() };
        }
        if (dataColumnIndex >= this.getColumnCount()) {
            throw new Error(`データ列範囲外です: column=${column}`);
        }
        const startIndex = this.usesInternalMainViewport ? this.frozenColumnCount : 0;
        const prefixWidth = this.usesInternalMainViewport ? 0 : this.getDetachedPrefixWidthPx();
        const startOffset = this.getRenderedDataBoundaryOffsetPx(startIndex);
        const left = prefixWidth + this.getRenderedDataBoundaryOffsetPx(dataColumnIndex) - startOffset;
        const right = prefixWidth + this.getRenderedDataBoundaryOffsetPx(dataColumnIndex + 1) - startOffset;
        return { left, right };
    }

    /**
     * 指定DOM列が固定列かどうかを返す。
     */
    isFrozenDomColumn(column: number): boolean {
        const dataColumnIndex = column - this.dataColumnOffset();
        if (dataColumnIndex < 0) return true;
        return dataColumnIndex >= 0 && dataColumnIndex < this.frozenColumnCount;
    }

    /**
     * 行ヘッダー（コーナーセル）の幅を取得する
     */
    getRowHeaderWidth(): number {
        return ROW_HEADER_WIDTH_PX;
    }

    /**
     * データ領域の最大行を取得（データが入力されている最後の行）
     */
    getMaxDataRow(): number {
        const storeRows = this.store.getRows(this.tableName);
        if (storeRows === false) return 0;
        for (let dataRowIndex = this.getFilteredDataRowCount() - 1; dataRowIndex >= 0; dataRowIndex--) {
            const storeRowIndex = this.resolveStoreRowIndex(dataRowIndex);
            if (storeRowIndex < 0 || storeRowIndex >= storeRows.length) continue;
            const rowValues = storeRows[storeRowIndex];
            for (let dataColIndex = 0; dataColIndex < this.tableData.columnMapping.length; dataColIndex++) {
                const storeColIndex = this.tableData.columnMapping[dataColIndex];
                if (storeColIndex === -1 || storeColIndex >= rowValues.length) continue;
                if (rowValues[storeColIndex].trim() !== '') return dataRowIndex + 1;
            }
        }
        return 0;
    }

    // =========================================================================
    // UI
    // =========================================================================

    updateHeaderSelection(startRow: number, startColumn: number, endRow: number, endColumn: number): void {
        this.selectionView.updateHeaderSelection(startRow, startColumn, endRow, endColumn);
    }

    updateHeaderSelectionForVirtualScroll(startRow: number, startColumn: number, endRow: number, endColumn: number): void {
        this.selectionView.updateHeaderSelectionForVirtualScroll(startRow, startColumn, endRow, endColumn);
    }

    /**
     * ストアからセルデータを再読み込みし、DOMの行数・セル値をストアに完全同期する。
     * タブ切替時に呼び出され、他タブ（またはミニテーブル）でストアが変更された結果を反映する。
     *
     * 通常テーブルでは、まずDOMの行数をストアの行数に合わせて増減し storeRowIndices を [0..n-1] に更新する。
     * ミニテーブルはフィルタ条件を持つため DOM 行数同期は行わず、セル値の更新のみ行う。
     */
    reloadCellsFromStore(): void {
        this.storeSync.reloadCellsFromStore();
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
        this.storeSync.promoteBufferRowToStore(domDataRowIndex);
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
        this.storeSync.demoteStoreRowToBuffer(domDataRowIndex);
    }

    /**
     * 指定の domDataRowIndex がバッファ空行（ストア未登録）かどうかを判定する
     */
    isBufferRow(domDataRowIndex: number): boolean {
        return this.storeSync.isBufferRow(domDataRowIndex);
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
        return this.storeSync.storeRowToDomRow(storeRowIndex);
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
        this.storeSync.ensureTrailingBufferRow();
    }

    /**
     * バッファ行が2行以上存在する場合に末尾から余分な行を削除し、常に1行だけになるよう整理する。
     * demoteStoreRowToBuffer() のUndo後にバッファ行が蓄積するのを防ぐために使う（通常テーブル・ミニテーブル共通）。
     * demoteStoreRowToBuffer() は降格対象行に必ず editor-table-empty-row を付与するため、
     * このメソッド実行後にバッファ行が0行になることはない。
     */
    normalizeTrailingBufferRows(): void {
        this.storeSync.normalizeTrailingBufferRows();
    }

    // =========================================================================
    // FK自動埋め込み
    // =========================================================================

    /**
     * 行追加時に自動埋め込みするFK列名と値のペアを設定する
     * 1:Nミニテーブルの buildMiniEditorTableAsync() から呼ばれる
     */
    setAutoFillEntries(entries: Array<{ columnName: string; value: string }>): void {
        this.storeSync.setAutoFillEntries(entries);
    }

    /**
     * DOMデータ行インデックスからストア行インデックスへのマッピングを設定する
     * ミニテーブルのfilteredRows構築後に buildMiniEditorTableAsync() から呼ばれる。
     * storeRowIndices[i] = ストア内の実際の行インデックス（0始まり）。
     */
    setStoreRowIndices(indices: number[]): void {
        this.storeSync.setStoreRowIndices(indices);
    }

    /**
     * storeRowIndices を内部モジュール（EditorTableStructure）から取得するためのアクセサ
     * 行挿入・削除時に同期するために使用する
     */
    getStoreRowIndices(): number[] { return this.storeSync.getStoreRowIndices(); }

    /**
     * 差分タブの右ペインでのパディング行（.diff-row-empty）のストア行インデックスを返す。
     * EditorTableHandler の保存処理から呼ばれ、差分タブの DiffTab に委譲する。
     * このメソッドは差分タブの右ペイン（saveTargetTableName が設定されたコンテキスト）でのみ呼ばれる。
     * diffTab === false の場合は到達不能であり、フォールバックとして空配列を返すことはデータ破壊のリスクがあるため例外を投げる。
     */
    getDiffPaddingStoreRowIndices(): readonly number[] {
        return this.storeSync.getDiffPaddingStoreRowIndices();
    }

    notifySortRowInserted(storeRowIndex: number): void { this.sortFilter.notifySortRowInserted(storeRowIndex); }
    notifySortRowDeleted(storeRowIndex: number): void { this.sortFilter.notifySortRowDeleted(storeRowIndex); }
    clearSortState(): void { this.sortFilter.clearSortState(); }
    clearFilterState(): void { this.sortFilter.clearFilterState(); }
    refreshFilterDisplayIfActive(): void { this.sortFilter.refreshFilterDisplayIfActive(); }
    restoreSortState(serializedSortKeys: SerializedSortKey[]): void { this.sortFilter.restoreSortState(serializedSortKeys); }
    restoreFilterState(serializedFilters: SerializedFilters): void { this.sortFilter.restoreFilterState(serializedFilters); }
    applyTemporaryFilterState(filters: SerializedFilters): void { this.sortFilter.applyTemporaryFilterState(filters); }
    applySortForColumn(columnIndex: number): void { this.sortFilter.applySortForColumn(columnIndex); }
    applySortState(sortKeys: SerializedSortKey[]): void { this.sortFilter.applySortState(sortKeys); }
    applyFilterState(filters: SerializedFilters): void { this.sortFilter.applyFilterState(filters); }
    pushFilterCommand(oldFilters: SerializedFilters, newFilters: SerializedFilters): void { this.sortFilter.pushFilterCommand(oldFilters, newFilters); }
    rearrangeDomRowsByStoreIndices(indices: number[]): void { this.sortFilter.rearrangeDomRowsByStoreIndices(indices); }
    applyFilterDisplay(): void { this.sortFilter.applyFilterDisplay(); }
    clampSelectionToFilteredRange(): void { this.sortFilter.clampSelectionToFilteredRange(); }
    updateFilterActiveClasses(): void { this.sortFilter.updateFilterActiveClasses(); }
    openFilterDropdown(columnIndex: number, anchorElement: HTMLElement): void { this.sortFilter.openFilterDropdown(columnIndex, anchorElement); }
    updateAllSortIndicators(): void { this.sortFilter.updateAllSortIndicators(); }

    /**
     * FK自動埋め込み情報を取得する（InsertRowCommand / InsertRowsCommand から参照）
     */
    getAutoFillEntries(): Array<{ columnName: string; value: string }> {
        return this.storeSync.getAutoFillEntries();
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
        this.storeSync.applyAutoFillToRow(rowIndex);
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
        this.navigation.navigateToDefinition(row);
    }

    /**
     * メインテーブル専用: Ctrl+クリックまたはF12でFK列の参照先テーブルをタブで開く。
     * RelationsPanelが非表示の場合のみ動作する（表示中はRelationsPanelで参照できるため不要）。
     * 単純参照（"table.column"形式）と動的参照（二段リスト）の両方に対応する。
     * @returns ナビゲーションが実行された場合 true
     */
    navigateToReferenceTable(row: number, column: number): boolean {
        return this.navigation.navigateToReferenceTable(row, column);
    }

    /**
     * メインテーブル専用: Ctrl+クリックまたはF12でPK列の逆参照先テーブルをタブで開く。
     * RelationsPanelが非表示の場合のみ動作する（表示中はRelationsPanelで参照できるため不要）。
     * 逆参照が1つなら直接ジャンプ、複数ならモーダルで選択させる。
     * @returns ナビゲーションが実行された（またはモーダル表示された）場合 true
     */
    navigateToReverseReferenceTable(row: number, column: number): boolean {
        return this.navigation.navigateToReverseReferenceTable(row, column);
    }

    // =========================================================================
    // ブックマーク操作ファサード（デメテルの法則: sidebar を直接公開せずファサードで中継する）
    // =========================================================================

    /**
     * セルレベルでブックマークが存在するか確認する
     */
    hasBookmark(tableName: string, pkValue: string, columnName: string): boolean {
        return this.bookmarks.hasBookmark(tableName, pkValue, columnName);
    }

    /**
     * 行レベルでブックマークが1件以上存在するか確認する（PK列右クリック用）
     */
    hasBookmarkForRow(tableName: string, pkValue: string): boolean {
        return this.bookmarks.hasBookmarkForRow(tableName, pkValue);
    }

    /**
     * セルレベルでブックマークを追加する
     */
    addBookmark(tableName: string, pkValue: string, columnName: string, label: string): void {
        this.bookmarks.addBookmark(tableName, pkValue, columnName, label);
    }

    /**
     * セルレベルでブックマークを削除する
     */
    removeBookmark(tableName: string, pkValue: string, columnName: string): void {
        this.bookmarks.removeBookmark(tableName, pkValue, columnName);
    }

    /**
     * 既に開いているテーブルに対してブックマーク視覚マークを再適用する
     * 起動後に bookmarks.json を復元したタイミングなど、BookmarkPanel の内容が後から揃う経路で使用する
     */
    reapplyBookmarkMarks(): void {
        this.bookmarks.reapplyBookmarkMarks();
    }

    /**
     * 行レベルで全ブックマークを削除する（PK列右クリック「ブックマークを解除」用）
     */
    removeBookmarksForRow(tableName: string, pkValue: string): void {
        this.bookmarks.removeBookmarksForRow(tableName, pkValue);
    }

    /**
     * REFERENCESパネルに逆参照エントリを表示する（コンテキストメニュー「参照箇所を表示」用）
     */
    showReferences(pkValue: string, entries: ReverseReferenceEntry[]): void {
        this.bookmarks.showReferences(pkValue, entries);
    }

    /**
     * 指定行の全データセルから data-bookmarked 属性を除去する
     * PK列右クリックの「ブックマークを解除」（行レベル一括削除）で使用する
     */
    removeBookmarkMarksForRow(row: number): void {
        this.bookmarks.removeBookmarkMarksForRow(row);
    }

    /**
     * ストアの行データからブックマーク済みセルを検出し data-bookmarked 属性を復元する。
     * reloadCellsFromStore() 末尾から呼ばれ、セル再作成後にブックマーク視覚マークを回復する。
     */
    restoreBookmarkMarks(): void {
        this.bookmarks.restoreBookmarkMarks();
    }

    restoreBookmarkMarksForDataRowRange(startDataRowIndex: number, endDataRowIndex: number): void {
        this.bookmarks.restoreBookmarkMarksForDataRowRange(startDataRowIndex, endDataRowIndex);
    }

    // =========================================================================
    // RelationsPanel 連携
    // =========================================================================

    /** 行選択が変化したときにRelationsPanelへ通知し、EditorAPI に行選択イベントを発火する（Selectionから呼ばれる） */
    notifyRowSelectionChanged(rowIndex: number): void {
        this.relations.notifyRowSelectionChanged(rowIndex);
    }

    /**
     * セル値変更後にRelationsPanelを強制再描画する（同一行リフレッシュ）。
     * paneStack はリセットしない。lastNotifiedRow も更新しない（次の行変更で正しく検知するため維持する）。
     * 行を変更しない操作（セル編集後・逆参照マップ更新後など同一行のリフレッシュ）からのみ呼ぶこと。
     * 行変更を伴う操作では notifyRowSelectionChanged() を通じて updateForRow() を呼ぶこと。
     */
    forceRefreshRelationsPanel(): void {
        this.relations.forceRefreshRelationsPanel();
    }

    // =========================================================================
    // git差分ハイライト
    // =========================================================================

    connectGitDiffTracker(tracker: GitDiffTracker): void { this.git.connectGitDiffTracker(tracker); }
    setLargeFileSettings(settings: LargeFileSettings): void {
        this.git.setLargeFileSettings(settings);
        this.validationMarkers.setLargeFileSettings(settings);
        this.refreshScrollbarMarkers();
    }
    updateSingleCellGitHighlight(cell: HTMLElement, storeRows: string[][], storeRowIndex: number, columnIndex: number): void { this.git.updateSingleCellGitHighlight(cell, storeRows, storeRowIndex, columnIndex); }
    applyGitDiffHighlight(): void { this.git.applyGitDiffHighlight(); }
    async refreshGitDiffAsync(statusResult?: GitStatusResult | false): Promise<void> { return this.git.refreshGitDiffAsync(statusResult); }
    async refreshGitDiffForDiffTabAsync(gitPath: string): Promise<void> { return this.git.refreshGitDiffForDiffTabAsync(gitPath); }

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
        // DOMデータ行インデックス（0始まり）= 論理行インデックス - 1（列ヘッダー行分）
        // フィルター適用時は論理行インデックスのため resolveStoreRowIndex で変換する
        const domDataRowIndex = row - 1;
        const storeRowIndex = this.resolveStoreRowIndex(domDataRowIndex);
        // データ行外（空行等）・照合失敗（-1）の場合はストア更新をスキップ
        if (storeRowIndex < 0) return;
        // DOMの列インデックス → データ列インデックス（0始まり）→ ストアの列インデックス
        const dataColumnIndex = column - this.dataColumnOffset();
        if (dataColumnIndex < 0 || dataColumnIndex >= this.tableData.columnMapping.length) return;
        const storeColIndex = this.getStoreColumnIndex(dataColumnIndex);
        if (storeColIndex === -1) return;
        const rowsBeforeUpdate = this.store.getRows(this.tableName);
        const oldValue = rowsBeforeUpdate !== false
            && storeRowIndex < rowsBeforeUpdate.length
            && storeColIndex < rowsBeforeUpdate[storeRowIndex].length
            ? rowsBeforeUpdate[storeRowIndex][storeColIndex]
            : '';
        if (oldValue === value) return;
        // ストア更新はDOM有無に関わらず常に実行する
        this.store.updateCellValueByRowIndex(this.tableName, storeRowIndex, storeColIndex, value);
        // DOM上に行が存在する場合のみDOM操作（参照ヒント・git差分ハイライト等）を行う。
        // 仮想スクロールでDOM外の行はスクロールで表示される際に renderRowForVirtualScroll で再生成される。
        const rowElement = this.getRowElement(row);
        if (rowElement === null) return;
        this.reference.setCellValueAt(row, column, value);
        const fixedLeftColumnCount = this.dataColumnOffset() + this.frozenColumnCount;
        const requiresDetachedCloneSync = row <= this.frozenRowCount || column < fixedLeftColumnCount;
        // 動的参照用のfullDataCacheも同期する（PKベース: 参照先テーブルはPK重複のないテーブルが前提）
        const id = this.reference.getRowPkValue(row);
        this.referenceDataCache.updateFullDataCell(this.tableName, id, storeColIndex, value);
        // git差分ハイライトをこのセル1つ分だけ再評価する
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
        if (!requiresDetachedCloneSync) return;
        if (this.usesInternalMainViewport) {
            this.syncQuadrantStaticCellStates();
            return;
        }
        this.refreshDetachedHeaderLayout();
    }

    /**
     * ユーザー編集時のセル変更を適用する（DOM更新 + ストア同期）
     * ループ完了後に1回だけRelationsPanelを更新する（毎セル発火を防止）
     * ミニEditorTableの場合はパネル全体再構築を避け、参照ヒントのみ更新する
     */
    applyCellChanges(changes: CellChange[]): CellChange[] {
        for (const change of changes) this.updateCellValueAt(change.row, change.column, change.newValue);
        this.finalizeCellChangeBatch();
        return changes;
    }

    /**
     * 変更リストをDOMに再適用する（Undo/Redo/Fill用）
     * ループ完了後に1回だけRelationsPanelを更新する（毎セル発火を防止）
     * ミニEditorTableの場合はパネル全体再構築を避け、参照ヒントのみ更新する
     */
    replayCellChanges(changes: CellChange[]): void {
        for (const change of changes) this.updateCellValueAt(change.row, change.column, change.newValue);
        this.finalizeCellChangeBatch();
    }

    /**
     * セル変更バッチ適用後の副作用をまとめて実行する。
     * 通常編集・Undo/Redo・Fillのどの経路でも同じ順序で後処理する。
     */
    private finalizeCellChangeBatch(): void {
        this.relations.refreshAfterCellChanges();
        // セル値変更後にバリデーションを実行してパネルとエラークラスを更新する
        this.runValidation();
        // フィルター適用中にセル値が変更された場合、フィルター条件との整合性を再評価する
        this.refreshFilterDisplayIfActive();
    }

    /** 参照データのpreload完了後にセルの参照ヒントを更新する */
    updateReferenceHints(): void {
        this.reference.updateReferenceHints();
        this.syncDetachedFrozenClonesAfterVisualContentChange();
    }

    /** 指定DOM行範囲のセルの参照ヒントを更新する */
    updateReferenceHintsForRows(startDomRow: number, endDomRow: number): void {
        this.reference.updateReferenceHintsForRows(startDomRow, endDomRow);
        this.syncDetachedFrozenClonesAfterVisualContentChange();
    }

    /** 指定した列のすべてのセルの参照ヒントを更新する */
    updateColumnReferenceHints(columnIndex: number): void {
        this.reference.updateColumnReferenceHints(columnIndex);
        this.syncDetachedFrozenClonesAfterVisualContentChange();
    }

    /**
     * 逆参照ヒントを更新する。通常テーブルの場合のみRelationsPanelを再描画する。
     * ミニEditorTableの場合はパネル全体再構築を避ける（ミニテーブル自身が破棄されるため）。
     * 初回テーブル展開時は notifyRowSelectionChanged() が先に走り、逆参照マップが未設定のため
     * 1:Nエントリが0件になる。ここで forceRefreshRelationsPanel() を呼ぶことで1:Nも表示される。
     */
    updateReverseReferenceHints(map: ReverseReferenceMap, refreshRelationsPanel = true): void {
        this.reference.updateReverseReferenceHints(map);
        this.syncDetachedFrozenClonesAfterVisualContentChange();
        if (refreshRelationsPanel && !this.isMiniTable) {
            this.forceRefreshRelationsPanel();
        }
    }

    private syncDetachedFrozenClonesAfterVisualContentChange(): void {
        if (this.frozenRowCount === 0 && this.frozenColumnCount === 0) return;
        if (this.usesInternalMainViewport) {
            this.syncQuadrantStaticCellStates();
            return;
        }
        this.refreshDetachedHeaderLayout();
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

    /** ブックマーク用の行キーを取得する */
    getRowBookmarkKey(rowIndex: number): string {
        return this.reference.getRowBookmarkKey(rowIndex);
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
        return this.referenceDataCache.getDisplayTextById(tableName, id);
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
        this.reapplyFreezeStylesAfterStructureChange();
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
        const column = this.tableData.header[columnIndex];
        if (!column) throw new Error(`列定義が見つかりません: columnIndex=${columnIndex}`);
        return column.comment;
    }

    /** 行挿入（Commandを使用してhistoryに追加） */
    public insertRow(rowIndex: number): void {
        this.structure.insertRow(rowIndex);
    }

    /** 複数行挿入（Commandを使用してhistoryに追加） */
    public insertRows(rowIndex: number, count: number): void {
        if (this.isMiniTable && this.relationsPanel !== false) this.relationsPanel.invalidatePendingRenderRequests();
        this.structure.insertRows(rowIndex, count);
        this.reapplyFreezeStylesAfterStructureChange();
    }

    /** 行挿入の内部実装（Commandから呼び出される） */
    public insertRowInternal(rowIndex: number): void {
        // blameはgit committed dataのため、行挿入でDOM行構造が変化すると陳腐化する
        this.hideBlameIfVisible();
        this.structure.insertRowInternal(rowIndex);
    }

    /** 列削除（Commandを使用してhistoryに追加） */
    public removeColumn(columnIndex: number): void {
        this.structure.removeColumn(columnIndex);
    }

    /** 複数列削除（Commandを使用してhistoryに追加） */
    public removeColumns(startColumnIndex: number, count: number): void {
        this.structure.removeColumns(startColumnIndex, count);
        // 削除後に固定列数が列総数を超えていたらクランプする
        if (this.frozenColumnCount > 0) {
            this.frozenColumnCount = Math.min(this.frozenColumnCount, this.getColumnCount());
        }
        this.reapplyFreezeStylesAfterStructureChange();
    }

    /** 行削除（Commandを使用してhistoryに追加） */
    public removeRow(rowIndex: number): void {
        this.structure.removeRow(rowIndex);
    }

    /** 複数行削除（Commandを使用してhistoryに追加） */
    public removeRows(startRowIndex: number, count: number): void {
        this.structure.removeRows(startRowIndex, count);
        this.reapplyFreezeStylesAfterStructureChange();
    }

    /** 列を削除する（Undo用） */
    public deleteColumn(columnIndex: number): void {
        this.structure.deleteColumn(columnIndex);
    }

    /** 行を削除する（Undo用） */
    public deleteRow(rowIndex: number): void {
        // blameはgit committed dataのため、行削除でDOM行構造が変化すると陳腐化する
        this.hideBlameIfVisible();
        this.structure.deleteRow(rowIndex);
    }

    /**
     * 行を移動する（ドラッグ移動用）
     *
     * fromDomDataRowIndex, toDomDataRowIndex: DOMデータ行インデックス（0始まり、列ヘッダー除く）
     * toDomDataRowIndex は「fromを抜いた後の挿入位置」を指す。
     *
     * 1. ストアの行を移動する
     * 2. DOM行要素を移動する
     * 3. storeRowIndices を再構築する
     * 4. 行番号を再ナンバリングする
     */
    public moveRow(fromDomDataRowIndex: number, toDomDataRowIndex: number): void {
        if (fromDomDataRowIndex === toDomDataRowIndex) return;
        // blame-cell は各行要素の children[0] に配置されており、行要素ごとDOM移動するため陳腐化しない
        // フィルター適用中は表示行が storeRowIndices の部分列になるため、手動行移動は扱わない。
        if (this.columnFilter.hasActiveFilter()) return;
        // ストアの行順を、移動後の表示順そのものに並び替える。
        // 下方向移動では toDomDataRowIndex が「fromを抜いた後」の位置なので、
        // store.moveRow の挿入先をストアインデックスから逆算すると1行ずれるケースがある。
        const storeRows = this.store.getRows(this.tableName);
        if (storeRows === false) return;
        const movedStoreRowIndices = [...this.storeRowIndices];
        const [movedStoreRowIndex] = movedStoreRowIndices.splice(fromDomDataRowIndex, 1);
        movedStoreRowIndices.splice(toDomDataRowIndex, 0, movedStoreRowIndex);
        if (!isCompleteStoreRowPermutation(movedStoreRowIndices, storeRows.length)) return;
        this.store.replaceAllRows(this.tableName, movedStoreRowIndices.map(storeRowIndex => storeRows[storeRowIndex]));
        // DOM行要素を移動する（DOMインデックスは列ヘッダー行を含むため+1）
        const fromDomIndex = fromDomDataRowIndex + 1;
        const toDomIndex = toDomDataRowIndex + 1;
        const rowElement = this.getRowElement(fromDomIndex);
        if (!rowElement) throw new Error(`[EditorTable.moveRowInternal] 移動元のDOM行が存在しません: fromDomIndex=${fromDomIndex}`);
        rowElement.remove();
        // 挿入位置のDOM要素（fromを抜いた後のインデックス）
        const insertBefore = this.getRowElement(toDomIndex);
        if (insertBefore) {
            this.gridElement.insertBefore(rowElement, insertBefore);
        } else {
            // bottomSpacerの手前に挿入する（enabled=false なら通常の appendChild）
            this.virtualScroll.appendDataRow(rowElement);
        }
        // storeRowIndices を再構築する
        // 通常テーブル: 移動後は storeRowIndices[i] = i となる
        // ミニテーブルでは使わない前提（ドラッグ移動はミニテーブル非対応）
        for (let i = 0; i < this.storeRowIndices.length; i++) {
            this.storeRowIndices[i] = i;
        }
        // data-store-index DOM属性も更新する
        for (let i = 0; i < this.storeRowIndices.length; i++) {
            const domRow = this.getRowElement(i + 1);
            if (domRow) domRow.dataset.storeIndex = String(i);
        }
        // 行番号を再ナンバリングする
        const startIndex = Math.min(fromDomIndex, toDomIndex);
        this.structure.renumberRowsFrom(startIndex);
        // コピー範囲をクリア（行構造が変わったため）
        this.selection.clearCopyRange();
        // 選択範囲を移動先に更新する
        this.selection.updateRendererAfterResize();
        // ソート状態をリセットする（行順が手動変更されたため）
        this.clearSortState();
        // git差分ハイライトを再評価する
        this.applyGitDiffHighlight();
        // バリデーションを再実行する
        this.runValidation();
    }

    runValidation(): void { this.validationMarkers.runValidation(); }
    public applyValidationErrors(errors: ValidationError[]): void { this.validationMarkers.applyValidationErrors(errors); }
    refreshScrollbarMarkers(): void { this.validationMarkers.refreshScrollbarMarkers(); }
    buildMarkerEntries(dataRows: Set<number>, totalDataRowCount: number): MarkerEntry[] { return this.validationMarkers.buildMarkerEntries(dataRows, totalDataRowCount); }

    /**
     * 列幅が変更されたことを通知する（AreaResizer / ColumnWidthCommand から呼ばれる）。
     * 通常テーブルではスキーマJSONへ即時保存する。
     */
    notifyColumnWidthChanged(): void {
        if (!this.isMiniTable) saveSchemaDataAsync(this);
    }

}

function isCompleteStoreRowPermutation(indices: readonly number[], rowCount: number): boolean {
    if (indices.length !== rowCount) return false;
    const seen = new Set<number>();
    for (const index of indices) {
        if (index < 0 || index >= rowCount || seen.has(index)) return false;
        seen.add(index);
    }
    return true;
}
