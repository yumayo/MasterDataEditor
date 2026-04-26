import {EditorTableData} from "./model/editor-table-data";
import {Selection, CellPosition, CellRange} from "./selection";
import {EditorTableHandler} from "./editor-table-handler";
import {ContextMenu, ContextMenuEntry} from "./context-menu";
import {History} from "./history";
import {Command, CellChange, RenderAsHtmlToggleCommand, SortCommand, FilterCommand} from "./command";
import {AreaResizer} from "./area-resizer";
import {DEFAULT_ROW_HEIGHT, CELL_FONT, REFERENCE_HINT_FONT, REFERENCE_HINT_MARGIN_PX, CELL_HORIZONTAL_EXTRA, MIN_COLUMN_WIDTH_PX, ROW_TOTAL_HEIGHT_PX, ROW_HEADER_WIDTH_PX, BLAME_COLUMN_WIDTH_PX} from "./constant";
import {ScrollViewportController} from "./scroll-viewport-controller";
import {SelectionDragController} from "./selection-drag-controller";
import {RowDragController} from "./row-drag-controller";
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
import {gitStatusAsync, gitShowAsync, gitShowFreshAsync, gitBlameAsync, GitStatusResult, BlameEntry} from "./api";
import {ColumnSorter, SerializedSortKey} from "./column-sorter";
import {ColumnFilter, SerializedFilters} from "./column-filter";
import {FilterDropdown} from "./filter-dropdown";
import {Utility} from "./utility";
import {Tab} from "./tab";
import {NotificationToast} from "./notification";
import {ErrorTooltip} from "./error-tooltip";
import {saveSchemaDataAsync} from "./editor-actions";
import {parseReferenceExpression, isSimpleReference, isDynamicReference, DynamicReference} from "./reference-expression";
import {ReverseReferenceJumpDialog} from "./reverse-reference-jump-dialog";
import {ScrollbarMarkerTrack, MarkerEntry} from "./scrollbar-marker-track";
import {VirtualScrollController, RenderedRowsUpdate} from "./virtual-scroll-controller";

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
    private readonly gridElement: HTMLElement;
    private readonly selection: Selection;
    private readonly areaResizer: AreaResizer;
    private readonly handler: EditorTableHandler;
    private readonly contextMenu: ContextMenu;
    private readonly history: History;
    private readonly selectionDragController: SelectionDragController;
    /** 行ドラッグ移動コントローラー（initializeModulesで再作成されるためreadonlyではない） */
    private rowDragController: RowDragController;
    private readonly referenceDataCache: ReferenceDataCache;
    /** テーブルデータの中央ストア（セル編集の同期用） */
    private readonly store: InMemoryTableStore;
    /** 参照箇所を表示するサイドバー（コンテキストメニュー・ブックマーク操作で使用） */
    private readonly sidebar: Sidebar;
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

    /** 固定列数（0=未固定） */
    private frozenColumnCount: number;
    /** 固定行数（0=未固定） */
    private frozenRowCount: number;
    /** blame情報の表示状態（false: 非表示、true: 表示中） */
    private isBlameVisible: boolean;

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
     * 前回 applySelectionClasses() でクラスを付与したセルの記録。
     * clearSelectionClasses() でクラスを除去するために使用する。
     */
    private lastSelectionCells: { row: number; col: number; classes: string[] }[];
    /**
     * 前回 applyCopyClasses() でクラスを付与したセルの記録。
     * clearCopyClasses() でクラスを除去するために使用する。
     */
    private lastCopyCells: { row: number; col: number; classes: string[] }[];
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
    /**
     * フィルター適用時のデータ行インデックス配列。
     * filteredRowIndices[i] は storeRowIndices 上のインデックスを指す。
     * フィルター適用時のみ有効な値を持ち、仮想スクロールのレンダリングで使用する。
     * フィルター未適用時は空配列 []（使用しない — storeRowIndices を直接参照する）。
     * applyFilterDisplay() でフィルター適用・解除時に更新される。
     */
    private filteredRowIndices: number[];
    /** スクロールバーマーカートラック（connectScrollbarMarkerTrackで設定される。未設定はfalse） */
    private scrollbarMarkerTrack: ScrollbarMarkerTrack | false;
    /** 通常テーブルの共有右側マーカーを更新できるアクティブ状態 */
    private isActive: boolean;
    /** 直近のバリデーションで検出されたエラーがあるデータ行インデックス（0始まり）の集合 */
    private currentErrorDomRows: Set<number>;
    /** 直近のgit差分で検出された変更があるデータ行インデックス（0始まり）の集合 */
    private currentGitChangedDomRows: Set<number>;
    /** バリデーションエラーのストア座標キャッシュ（renderRowForVirtualScroll でクラス適用に使用） */
    private cachedPkErrorCells: Set<string>;
    private cachedOtherErrorCells: Set<string>;
    /** DOM列→ストア列のマッピングキャッシュ（バリデーションエラークラス適用用） */
    private cachedDomColToStoreCol: number[];
    /** バーチャルスクロールコントローラー */
    private readonly virtualScroll: VirtualScrollController;
    /** 同一スクロール内で fillHandle 再配置を二重実行しないための抑止フラグ */
    private skipFrozenFillHandleRefreshOnNextScrollSync: boolean;

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
            this.scrollContainer.appendChild(this.mainContent);
            this.mainContent.appendChild(this.gridElement);
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
        this.lastNotifiedRow = -1;
        this.lastFocusedRow = -1;
        this.lastFocusedCol = -1;
        this.lastSelectionCells = [];
        this.lastCopyCells = [];
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
            (dataRowIndex: number) => this.renderRowForVirtualScroll(dataRowIndex),
            (update: RenderedRowsUpdate) => this.reapplyRowDecorations(update),
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

    private getHeaderRowHeightPx(): number {
        return this.virtualScroll.getActualHeaderHeightPx();
    }

    private getDataRowHeightPx(): number {
        return this.virtualScroll.getActualRowHeightPx();
    }

    private getColumnLayoutWidthPx(columnIndex: number): number {
        const column = this.tableData.header[columnIndex];
        if (!column) throw new Error(`列定義が見つかりません: columnIndex=${columnIndex}`);
        return parseFloat(column.width);
    }

    private getRenderedDataColumnWidthPx(columnIndex: number): number {
        const start = this.getRenderedDataBoundaryOffsetPx(columnIndex);
        const end = this.getRenderedDataBoundaryOffsetPx(columnIndex + 1);
        const width = end - start;
        return width > 0 ? width : this.getColumnLayoutWidthPx(columnIndex);
    }

    /**
     * 列ヘッダーの実レイアウトから、データ列先頭を基準にした境界位置を返す。
     * コメント付きヘッダーでは padding / badge / icon により schema.width より実幅が広がるため、
     * 4領域分割の境界は render 後の offset 位置をSSOTにする。
     */
    private getRenderedDataBoundaryOffsetPx(dataColumnExclusiveEnd: number): number {
        if (dataColumnExclusiveEnd <= 0) return 0;
        const headerRow = this.getRowElement(0);
        if (headerRow !== null) {
            const firstDataCell = headerRow.children[this.dataColumnOffset()];
            if (firstDataCell instanceof HTMLElement) {
                if (dataColumnExclusiveEnd < this.getColumnCount()) {
                    const boundaryCell = headerRow.children[this.dataColumnOffset() + dataColumnExclusiveEnd];
                    if (boundaryCell instanceof HTMLElement) {
                        const renderedWidth = boundaryCell.offsetLeft - firstDataCell.offsetLeft;
                        if (renderedWidth > 0) return renderedWidth;
                    }
                } else {
                    const lastDataCell = headerRow.children[headerRow.children.length - 1];
                    if (lastDataCell instanceof HTMLElement) {
                        const renderedWidth = (lastDataCell.offsetLeft + lastDataCell.offsetWidth) - firstDataCell.offsetLeft;
                        if (renderedWidth > 0) return renderedWidth;
                    }
                }
            }
        }
        let width = 0;
        for (let dataColumnIndex = 0; dataColumnIndex < Math.min(dataColumnExclusiveEnd, this.getColumnCount()); dataColumnIndex++) {
            width += this.getColumnLayoutWidthPx(dataColumnIndex);
        }
        return width;
    }

    private getDetachedPrefixWidthPx(): number {
        const headerRow = this.getRowElement(0);
        if (!headerRow) {
            return ROW_HEADER_WIDTH_PX + (this.isBlameVisible ? BLAME_COLUMN_WIDTH_PX : 0);
        }
        const firstDataCell = headerRow.children[this.dataColumnOffset()] as HTMLElement | null;
        if (!firstDataCell) {
            return ROW_HEADER_WIDTH_PX + (this.isBlameVisible ? BLAME_COLUMN_WIDTH_PX : 0);
        }
        return firstDataCell.offsetLeft;
    }

    private getDataAreaWidthPx(): number {
        return this.getRenderedDataBoundaryOffsetPx(this.getColumnCount());
    }

    private getFrozenColumnAreaWidthPx(): number {
        return this.getRenderedDataBoundaryOffsetPx(this.frozenColumnCount);
    }

    private getFixedLeftWidthPx(): number {
        return this.getDetachedPrefixWidthPx() + this.getFrozenColumnAreaWidthPx();
    }

    private getFixedTopHeightPx(): number {
        return this.getHeaderRowHeightPx() + (this.frozenRowCount * this.getDataRowHeightPx());
    }

    private getLogicalRowIndexFromElement(rowElement: HTMLElement): number | null {
        if (rowElement.classList.contains('editor-table-column-header-row')
            || rowElement.classList.contains('editor-table-source-column-header-row')) return 0;
        const rowIndexText = rowElement.dataset.rowIndex;
        if (rowIndexText === undefined) return null;
        return Number(rowIndexText) + 1;
    }

    private forwardClonedCellPointerInteractions(cloneCell: HTMLElement, sourceCell: HTMLElement): void {
        const relayEvent = (event: MouseEvent, type: 'mousedown' | 'dblclick' | 'contextmenu') => {
            const forwarded = new MouseEvent(type, {
                bubbles: true,
                cancelable: true,
                button: event.button,
                buttons: event.buttons,
                clientX: event.clientX,
                clientY: event.clientY,
                ctrlKey: event.ctrlKey,
                shiftKey: event.shiftKey,
                altKey: event.altKey,
                metaKey: event.metaKey,
            });
            sourceCell.dispatchEvent(forwarded);
            event.preventDefault();
            event.stopPropagation();
        };
        cloneCell.addEventListener('mousedown', (event) => relayEvent(event, 'mousedown'));
        cloneCell.addEventListener('dblclick', (event) => relayEvent(event, 'dblclick'));
        cloneCell.addEventListener('contextmenu', (event) => relayEvent(event, 'contextmenu'));
    }

    private cloneDetachedCell(sourceCell: HTMLElement): HTMLElement {
        const cloneCell = sourceCell.cloneNode(true) as HTMLElement;
        cloneCell.style.visibility = '';
        cloneCell.style.flex = '0 0 auto';
        {
            // detached layer は flex レイアウトなので、table レイアウトで確定した実幅をそのまま引き継ぐ。
            const computedStyle = window.getComputedStyle(sourceCell);
            const renderedWidth = sourceCell.getBoundingClientRect().width;
            const width = computedStyle.boxSizing === 'border-box'
                ? renderedWidth
                : renderedWidth
                    - parseFloat(computedStyle.paddingLeft)
                    - parseFloat(computedStyle.paddingRight)
                    - parseFloat(computedStyle.borderLeftWidth)
                    - parseFloat(computedStyle.borderRightWidth);
            if (width > 0) {
                cloneCell.style.width = `${width}px`;
                cloneCell.style.minWidth = `${width}px`;
                cloneCell.style.maxWidth = `${width}px`;
            }
        }
        if (cloneCell.classList.contains('editor-table-column-header')) {
            cloneCell.addEventListener('mousedown', this.contextMenuHandler.createColumnHeaderClickHandler(cloneCell));
            cloneCell.addEventListener('contextmenu', this.contextMenuHandler.createColumnHeaderContextMenuHandler(cloneCell));
            const resizeHandle = cloneCell.querySelector('.column-resize-handle') as HTMLElement | null;
            if (resizeHandle !== null) {
                const columnIndexText = cloneCell.dataset.columnIndex;
                if (columnIndexText === undefined) throw new Error('分離列ヘッダーに columnIndex がありません');
                this.areaResizer.setupColumnResizeHandle(resizeHandle, cloneCell, Number(columnIndexText));
            }
            const filterIcon = cloneCell.querySelector('.filter-icon') as HTMLElement | null;
            if (filterIcon !== null) {
                filterIcon.addEventListener('mousedown', (e) => { e.stopPropagation(); });
                filterIcon.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const headerCell = (e.currentTarget as HTMLElement).parentElement as HTMLElement;
                    const colIdx = Number(headerCell.dataset.columnIndex);
                    this.openFilterDropdown(colIdx, e.currentTarget as HTMLElement);
                });
            }
            const sortIndicator = cloneCell.querySelector('.sort-indicator') as HTMLElement | null;
            if (sortIndicator !== null) {
                sortIndicator.addEventListener('mousedown', (e) => { e.stopPropagation(); });
                sortIndicator.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const headerCell = (e.currentTarget as HTMLElement).parentElement as HTMLElement;
                    const colIdx = Number(headerCell.dataset.columnIndex);
                    this.applySortForColumn(colIdx);
                });
            }
        }
        if (cloneCell.classList.contains('editor-table-row-header')) {
            cloneCell.addEventListener('mousedown', (e: MouseEvent) => {
                if (e.button !== 0) return;
                const rowIndexText = cloneCell.dataset.rowIndex;
                if (rowIndexText === undefined) throw new Error('分離行ヘッダーに rowIndex がありません');
                this.getRowDragController().onRowHeaderMouseDown(Number(rowIndexText), e.clientY, cloneCell, e);
            });
            cloneCell.addEventListener('mousedown', this.contextMenuHandler.createRowHeaderClickHandler(cloneCell));
            cloneCell.addEventListener('contextmenu', this.contextMenuHandler.createRowHeaderContextMenuHandler(cloneCell));
        }
        if (cloneCell.classList.contains('editor-table-corner-cell')) {
            cloneCell.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                this.handler.submitAndHide();
                this.selection.selectAll();
            });
        }
        if (!cloneCell.classList.contains('editor-table-column-header')
            && !cloneCell.classList.contains('editor-table-row-header')
            && !cloneCell.classList.contains('editor-table-corner-cell')) {
            this.forwardClonedCellPointerInteractions(cloneCell, sourceCell);
        }
        return cloneCell;
    }

    private syncDetachedCellVisualState(sourceCell: HTMLElement, detachedCell: HTMLElement): void {
        if (detachedCell.innerHTML !== sourceCell.innerHTML) {
            const replacement = this.cloneDetachedCell(sourceCell);
            detachedCell.replaceWith(replacement);
            detachedCell = replacement;
        }
        detachedCell.className = sourceCell.className;
        if (sourceCell.hasAttribute('data-bookmarked')) {
            detachedCell.setAttribute('data-bookmarked', '');
        } else {
            detachedCell.removeAttribute('data-bookmarked');
        }
    }

    private syncDetachedRowVisualState(sourceRow: HTMLElement, detachedRow: HTMLElement): void {
        detachedRow.classList.toggle('freeze-row', sourceRow.classList.contains('freeze-row'));
        detachedRow.classList.toggle('freeze-row-border', sourceRow.classList.contains('freeze-row-border'));
    }

    private refreshDetachedHeaderLayers(): void {
        this.virtualScroll.refreshMeasuredGeometry();
        if (this.usesInternalMainViewport) {
            this.refreshQuadrantPaneLayers();
            return;
        }
        const renderedRows = this.getRenderedRowElements();
        for (const renderedRow of renderedRows) {
            const cellCount = renderedRow.children.length;
            if (renderedRow.classList.contains('editor-table-column-header-row')
                || renderedRow.classList.contains('editor-table-source-column-header-row')) {
                for (let col = 0; col < cellCount; col++) {
                    (renderedRow.children[col] as HTMLElement).style.visibility = '';
                }
                continue;
            }
            for (let col = 0; col < Math.min(this.dataColumnOffset(), cellCount); col++) {
                (renderedRow.children[col] as HTMLElement).style.visibility = '';
            }
        }
        this.detachedColumnHeaderLayer.replaceChildren();
        this.detachedRowHeaderLayer.replaceChildren();
        this.detachedFrozenRowBackgroundLayer.replaceChildren();
        this.detachedCornerLayer.replaceChildren();
        this.detachedFrozenRowDataLayer.replaceChildren();

        const headerRow = this.getRowElement(0);
        if (headerRow === null) return;
        const prefixWidth = this.getDetachedPrefixWidthPx();
        const dataAreaWidth = this.getDataAreaWidthPx();
        const headerHeight = this.getHeaderRowHeightPx();
        const rowHeight = this.getDataRowHeightPx();
        this.detachedColumnHeaderLayer.style.top = `${this.detachedHeaderTopOffset}px`;
        this.detachedFrozenRowBackgroundLayer.style.top = `${this.detachedHeaderTopOffset}px`;
        this.detachedCornerLayer.style.top = `${this.detachedHeaderTopOffset}px`;
        this.detachedColumnHeaderLayer.style.left = `${prefixWidth}px`;
        this.detachedFrozenRowBackgroundLayer.style.left = `${prefixWidth}px`;
        this.detachedFrozenRowDataLayer.style.left = `${prefixWidth}px`;
        this.detachedFrozenRowBackgroundLayer.style.width = `${dataAreaWidth}px`;
        this.detachedFrozenRowDataLayer.style.width = `${dataAreaWidth}px`;
        this.detachedRowHeaderLayer.style.width = `${prefixWidth}px`;
        this.detachedCornerLayer.style.width = `${prefixWidth}px`;
        this.detachedColumnHeaderLayer.style.height = `${headerHeight}px`;
        this.detachedFrozenRowBackgroundLayer.style.height = `${this.frozenRowCount * rowHeight}px`;
        this.detachedFrozenRowDataLayer.style.top = `${this.detachedHeaderTopOffset}px`;
        this.detachedFrozenRowDataLayer.style.height = `${this.frozenRowCount * rowHeight}px`;
        this.detachedCornerLayer.style.height = `${headerHeight}px`;

        for (let i = 0; i < headerRow.children.length; i++) {
            (headerRow.children[i] as HTMLElement).style.visibility = 'hidden';
        }

        const detachedCornerRow = document.createElement('div');
        detachedCornerRow.classList.add('editor-table-detached-row');
        detachedCornerRow.style.top = '0px';
        for (let col = 0; col < this.dataColumnOffset(); col++) {
            const sourceCell = headerRow.children[col] as HTMLElement | null;
            if (sourceCell === null) continue;
            detachedCornerRow.appendChild(this.cloneDetachedCell(sourceCell));
        }
        this.detachedCornerLayer.appendChild(detachedCornerRow);

        const detachedHeaderRow = document.createElement('div');
        detachedHeaderRow.classList.add('editor-table-detached-row', 'editor-table-column-header-row');
        detachedHeaderRow.style.top = '0px';
        for (let col = this.dataColumnOffset(); col < headerRow.children.length; col++) {
            const sourceCell = headerRow.children[col] as HTMLElement | null;
            if (sourceCell === null) continue;
            detachedHeaderRow.appendChild(this.cloneDetachedCell(sourceCell));
        }
        this.detachedColumnHeaderLayer.appendChild(detachedHeaderRow);

        const dataRowEnd = this.getDataRowEndChildIndex();
        for (let childIndex = this.getDataRowChildOffset(); childIndex < dataRowEnd; childIndex++) {
            if (this.virtualScroll.isSpacerIndex(childIndex)) continue;
            const rowElement = this.gridElement.children[childIndex] as HTMLElement | null;
            if (rowElement === null) continue;
            const detachedRow = document.createElement('div');
            detachedRow.classList.add('editor-table-detached-row');
            const rowHeader = rowElement.querySelector('.editor-table-row-header') as HTMLElement | null;
            if (rowHeader !== null) {
                const rowIndexText = rowHeader.dataset.rowIndex;
                if (rowIndexText !== undefined) {
                    detachedRow.dataset.rowIndex = rowIndexText;
                    const logicalRowIndex = Number(rowIndexText) + 1;
                    detachedRow.style.top = logicalRowIndex <= this.frozenRowCount
                        ? `${headerHeight + ((logicalRowIndex - 1) * rowHeight)}px`
                        : `${rowElement.offsetTop}px`;
                    if (logicalRowIndex <= this.frozenRowCount) {
                        const backgroundPlate = document.createElement('div');
                        backgroundPlate.classList.add('editor-table-detached-frozen-row-background');
                        if (logicalRowIndex === this.frozenRowCount) backgroundPlate.classList.add('freeze-row-border');
                        backgroundPlate.dataset.rowIndex = rowIndexText;
                        backgroundPlate.style.top = `${headerHeight + ((logicalRowIndex - 1) * rowHeight)}px`;
                        backgroundPlate.style.width = `${dataAreaWidth}px`;
                        this.detachedFrozenRowBackgroundLayer.appendChild(backgroundPlate);

                        const detachedDataRow = document.createElement('div');
                        detachedDataRow.classList.add('editor-table-detached-row', 'freeze-row');
                        if (logicalRowIndex === this.frozenRowCount) detachedDataRow.classList.add('freeze-row-border');
                        detachedDataRow.dataset.rowIndex = rowIndexText;
                        detachedDataRow.style.top = `${headerHeight + ((logicalRowIndex - 1) * rowHeight)}px`;
                        for (let col = this.dataColumnOffset(); col < rowElement.children.length; col++) {
                            const sourceCell = rowElement.children[col] as HTMLElement | null;
                            if (sourceCell === null) continue;
                            detachedDataRow.appendChild(this.cloneDetachedCell(sourceCell));
                        }
                        this.detachedFrozenRowDataLayer.appendChild(detachedDataRow);
                    }
                }
            }
            if (detachedRow.style.top === '') detachedRow.style.top = `${rowElement.offsetTop}px`;
            if (rowElement.classList.contains('freeze-row')) detachedRow.classList.add('freeze-row');
            if (rowElement.classList.contains('freeze-row-border')) detachedRow.classList.add('freeze-row-border');
            for (let col = 0; col < this.dataColumnOffset(); col++) {
                const sourceCell = rowElement.children[col] as HTMLElement | null;
                if (sourceCell === null) continue;
                sourceCell.style.visibility = 'hidden';
                const detachedCell = this.cloneDetachedCell(sourceCell);
                const rowIndexText = detachedRow.dataset.rowIndex;
                if (rowIndexText !== undefined && (Number(rowIndexText) + 1) <= this.frozenRowCount) {
                    detachedCell.style.zIndex = 'var(--z-index-freeze-corner)';
                }
                detachedRow.appendChild(detachedCell);
            }
            this.detachedRowHeaderLayer.appendChild(detachedRow);
        }
        this.syncDetachedHeaderScrollOffset();
    }

    private refreshQuadrantPaneLayers(): void {
        this.virtualScroll.refreshMeasuredGeometry();
        this.detachedColumnHeaderLayer.replaceChildren();
        this.detachedRowHeaderLayer.replaceChildren();
        this.detachedFrozenRowBackgroundLayer.replaceChildren();
        this.detachedCornerLayer.replaceChildren();
        this.detachedFrozenRowDataLayer.replaceChildren();
        this.detachedFrozenCornerDataLayer.replaceChildren();

        const headerRow = this.getRowElement(0);
        if (headerRow === null) return;
        const fixedLeftColumnCount = this.dataColumnOffset() + this.frozenColumnCount;
        const actualFixedLeftWidth = this.getFixedLeftWidthPx();
        const availableWidth = this.element.clientWidth > 0 ? this.element.clientWidth : actualFixedLeftWidth;
        const visibleFixedLeftWidth = Math.min(actualFixedLeftWidth, Math.max(0, availableWidth - 1));
        const fixedTopHeight = this.getFixedTopHeightPx();
        const rowHeight = this.getDataRowHeightPx();
        this.virtualScroll.setScrollTopCompensationPx(fixedTopHeight);
        const frozenColumnWidth = this.getFrozenColumnAreaWidthPx();
        const dataAreaWidth = this.getDataAreaWidthPx();
        const mainContentWidth = Math.max(0, dataAreaWidth - frozenColumnWidth);
        const mainContentHeight = Math.max(0, (this.getLogicalRowCount() - 1 - this.frozenRowCount) * rowHeight);
        const paneTop = this.detachedHeaderTopOffset;

        this.topLeftPane.style.top = `${paneTop}px`;
        this.topLeftPane.style.left = '0px';
        this.topLeftPane.style.width = `${visibleFixedLeftWidth}px`;
        this.topLeftPane.style.height = `${fixedTopHeight}px`;
        this.topRightPane.style.top = `${paneTop}px`;
        this.topRightPane.style.left = `${visibleFixedLeftWidth}px`;
        this.topRightPane.style.height = `${fixedTopHeight}px`;
        this.bottomLeftPane.style.top = `${paneTop + fixedTopHeight}px`;
        this.bottomLeftPane.style.left = '0px';
        this.bottomLeftPane.style.width = `${visibleFixedLeftWidth}px`;
        this.bottomRightPane.style.top = `${paneTop + fixedTopHeight}px`;
        this.bottomRightPane.style.left = `${visibleFixedLeftWidth}px`;
        this.bottomRightPane.style.right = '0px';
        this.bottomRightPane.style.bottom = '0px';
        this.topLeftContent.style.width = `${actualFixedLeftWidth}px`;
        this.topLeftContent.style.height = `${fixedTopHeight}px`;
        this.topRightContent.style.width = `${mainContentWidth}px`;
        this.topRightContent.style.height = `${fixedTopHeight}px`;
        this.leftBottomContent.style.width = `${actualFixedLeftWidth}px`;
        this.leftBottomContent.style.height = `${mainContentHeight}px`;
        this.mainContent.style.width = `${mainContentWidth}px`;
        this.mainContent.style.height = `${mainContentHeight}px`;
        this.gridElement.style.position = 'absolute';
        this.gridElement.style.left = `${-actualFixedLeftWidth}px`;
        this.gridElement.style.top = `${-fixedTopHeight}px`;

        // 右下だけが実スクロール担当なので、そこで消費されるガター幅・高さを
        // 右上ヘッダー領域と左下行ヘッダー領域にも反映して見た目の列幅・行高を揃える。
        const mainViewportScrollbarWidth = Math.max(0, this.scrollContainer.offsetWidth - this.scrollContainer.clientWidth);
        const mainViewportScrollbarHeight = Math.max(0, this.scrollContainer.offsetHeight - this.scrollContainer.clientHeight);
        this.topRightPane.style.right = `${mainViewportScrollbarWidth}px`;
        this.bottomLeftPane.style.bottom = `${mainViewportScrollbarHeight}px`;

        const detachedCornerRow = document.createElement('div');
        detachedCornerRow.classList.add('editor-table-detached-row');
        detachedCornerRow.style.top = '0px';
        for (let col = 0; col < Math.min(fixedLeftColumnCount, headerRow.children.length); col++) {
            const sourceCell = headerRow.children[col] as HTMLElement | null;
            if (sourceCell === null) continue;
            detachedCornerRow.appendChild(this.cloneDetachedCell(sourceCell));
        }
        this.detachedCornerLayer.appendChild(detachedCornerRow);

        const detachedHeaderRow = document.createElement('div');
        detachedHeaderRow.classList.add('editor-table-detached-row', 'editor-table-column-header-row');
        detachedHeaderRow.style.top = '0px';
        for (let col = fixedLeftColumnCount; col < headerRow.children.length; col++) {
            const sourceCell = headerRow.children[col] as HTMLElement | null;
            if (sourceCell === null) continue;
            detachedHeaderRow.appendChild(this.cloneDetachedCell(sourceCell));
        }
        this.detachedColumnHeaderLayer.appendChild(detachedHeaderRow);

        const renderedRows = this.getRenderedRowElements();
        for (const rowElement of renderedRows) {
            const logicalRowIndex = this.getLogicalRowIndexFromElement(rowElement);
            if (logicalRowIndex === null || logicalRowIndex === 0) continue;
            const rowHeader = rowElement.querySelector('.editor-table-row-header') as HTMLElement | null;
            if (rowHeader === null) continue;
            const rowIndexText = rowHeader.dataset.rowIndex;
            if (rowIndexText === undefined) continue;
            const rowTop = this.getQuadrantViewportRowTopPx(logicalRowIndex);

            if (logicalRowIndex <= this.frozenRowCount) {
                const backgroundPlate = document.createElement('div');
                backgroundPlate.classList.add('editor-table-detached-frozen-row-background');
                if (logicalRowIndex === this.frozenRowCount) backgroundPlate.classList.add('freeze-row-border');
                backgroundPlate.dataset.rowIndex = rowIndexText;
                backgroundPlate.style.top = `${rowTop}px`;
                backgroundPlate.style.width = `${mainContentWidth}px`;
                this.detachedFrozenRowBackgroundLayer.appendChild(backgroundPlate);

                const frozenCornerRow = document.createElement('div');
                frozenCornerRow.classList.add('editor-table-detached-row', 'freeze-row');
                if (logicalRowIndex === this.frozenRowCount) frozenCornerRow.classList.add('freeze-row-border');
                frozenCornerRow.dataset.rowIndex = rowIndexText;
                frozenCornerRow.style.top = `${rowTop}px`;
                for (let col = 0; col < Math.min(fixedLeftColumnCount, rowElement.children.length); col++) {
                    const sourceCell = rowElement.children[col] as HTMLElement | null;
                    if (sourceCell === null) continue;
                    frozenCornerRow.appendChild(this.cloneDetachedCell(sourceCell));
                }
                this.detachedFrozenCornerDataLayer.appendChild(frozenCornerRow);

                const frozenDataRow = document.createElement('div');
                frozenDataRow.classList.add('editor-table-detached-row', 'freeze-row');
                if (logicalRowIndex === this.frozenRowCount) frozenDataRow.classList.add('freeze-row-border');
                frozenDataRow.dataset.rowIndex = rowIndexText;
                frozenDataRow.style.top = `${rowTop}px`;
                for (let col = fixedLeftColumnCount; col < rowElement.children.length; col++) {
                    const sourceCell = rowElement.children[col] as HTMLElement | null;
                    if (sourceCell === null) continue;
                    frozenDataRow.appendChild(this.cloneDetachedCell(sourceCell));
                }
                this.detachedFrozenRowDataLayer.appendChild(frozenDataRow);
                continue;
            }
        }
        this.refreshQuadrantViewportRowHeaders(null);
        this.emitScrollMetricsChanged();
    }

    private refreshQuadrantViewportRowHeaders(update: RenderedRowsUpdate | null): void {
        if (!this.usesInternalMainViewport) return;
        const scrollTop = update !== null ? update.scrollTop : this.scrollContainer.scrollTop;
        const scrollLeft = update !== null ? update.scrollLeft : this.scrollContainer.scrollLeft;
        const fixedLeftColumnCount = this.dataColumnOffset() + this.frozenColumnCount;
        const rebuildAll = (): void => {
            const renderedRows = this.getRenderedRowElements();
            const fragment = document.createDocumentFragment();
            for (const rowElement of renderedRows) {
                const rowHeader = rowElement.querySelector('.editor-table-row-header') as HTMLElement | null;
                if (rowHeader === null) continue;
                const rowIndexText = rowHeader.dataset.rowIndex;
                if (rowIndexText === undefined) continue;
                const logicalRowIndex = Number(rowIndexText) + 1;
                if (logicalRowIndex <= this.frozenRowCount) continue;
                const detachedLeftRow = document.createElement('div');
                detachedLeftRow.classList.add('editor-table-detached-row');
                detachedLeftRow.dataset.rowIndex = rowIndexText;
                detachedLeftRow.style.top = `${this.getQuadrantViewportRowTopPx(logicalRowIndex)}px`;
                for (let col = 0; col < Math.min(fixedLeftColumnCount, rowElement.children.length); col++) {
                    const sourceCell = rowElement.children[col] as HTMLElement | null;
                    if (sourceCell === null) continue;
                    detachedLeftRow.appendChild(this.cloneDetachedCell(sourceCell));
                }
                fragment.appendChild(detachedLeftRow);
            }
            this.detachedRowHeaderLayer.replaceChildren(fragment);
            this.syncDetachedHeaderScrollOffsetWithPositions(scrollTop, scrollLeft);
        };
        if (update === null || update.refreshAllRows || this.detachedRowHeaderLayer.childElementCount === 0) {
            rebuildAll();
            return;
        }
        const renderedRows = this.getRenderedRowElements();
        let firstNonFrozenSourceRow: HTMLElement | null = null;
        let lastNonFrozenSourceRow: HTMLElement | null = null;
        for (const rowElement of renderedRows) {
            const logicalRowIndex = this.getLogicalRowIndexFromElement(rowElement);
            if (logicalRowIndex === null || logicalRowIndex <= this.frozenRowCount) continue;
            if (firstNonFrozenSourceRow === null) firstNonFrozenSourceRow = rowElement;
            lastNonFrozenSourceRow = rowElement;
        }
        if (firstNonFrozenSourceRow === null || lastNonFrozenSourceRow === null) {
            rebuildAll();
            return;
        }
        const firstSourceRowHeader = firstNonFrozenSourceRow.querySelector('.editor-table-row-header') as HTMLElement | null;
        const lastSourceRowHeader = lastNonFrozenSourceRow.querySelector('.editor-table-row-header') as HTMLElement | null;
        if (firstSourceRowHeader === null || lastSourceRowHeader === null) {
            rebuildAll();
            return;
        }
        const firstCurrentRowIndexText = firstSourceRowHeader.dataset.rowIndex;
        const lastCurrentRowIndexText = lastSourceRowHeader.dataset.rowIndex;
        if (firstCurrentRowIndexText === undefined || lastCurrentRowIndexText === undefined) {
            rebuildAll();
            return;
        }
        const firstCurrentRowIndex = Number(firstCurrentRowIndexText);
        const lastCurrentRowIndex = Number(lastCurrentRowIndexText);
        while (this.detachedRowHeaderLayer.firstElementChild instanceof HTMLElement) {
            const firstDetachedRow = this.detachedRowHeaderLayer.firstElementChild;
            const rowIndexText = firstDetachedRow.dataset.rowIndex;
            if (rowIndexText !== undefined && Number(rowIndexText) >= firstCurrentRowIndex) break;
            this.detachedRowHeaderLayer.removeChild(firstDetachedRow);
        }
        while (this.detachedRowHeaderLayer.lastElementChild instanceof HTMLElement) {
            const lastDetachedRow = this.detachedRowHeaderLayer.lastElementChild;
            const rowIndexText = lastDetachedRow.dataset.rowIndex;
            if (rowIndexText !== undefined && Number(rowIndexText) <= lastCurrentRowIndex) break;
            this.detachedRowHeaderLayer.removeChild(lastDetachedRow);
        }
        for (const insertedRange of update.insertedRanges) {
            if (insertedRange.start >= insertedRange.end) continue;
            const fragment = document.createDocumentFragment();
            for (let dataRowIndex = insertedRange.start; dataRowIndex < insertedRange.end; dataRowIndex++) {
                const logicalRowIndex = dataRowIndex + 1;
                if (logicalRowIndex <= this.frozenRowCount) continue;
                const sourceRow = this.getRowElement(logicalRowIndex);
                if (sourceRow === null) continue;
                const rowHeader = sourceRow.querySelector('.editor-table-row-header') as HTMLElement | null;
                if (rowHeader === null) continue;
                const rowIndexText = rowHeader.dataset.rowIndex;
                if (rowIndexText === undefined) continue;
                const detachedLeftRow = document.createElement('div');
                detachedLeftRow.classList.add('editor-table-detached-row');
                detachedLeftRow.dataset.rowIndex = rowIndexText;
                detachedLeftRow.style.top = `${this.getQuadrantViewportRowTopPx(logicalRowIndex)}px`;
                for (let col = 0; col < Math.min(fixedLeftColumnCount, sourceRow.children.length); col++) {
                    const sourceCell = sourceRow.children[col] as HTMLElement | null;
                    if (sourceCell === null) continue;
                    detachedLeftRow.appendChild(this.cloneDetachedCell(sourceCell));
                }
                fragment.appendChild(detachedLeftRow);
            }
            if (insertedRange.start <= firstCurrentRowIndex) {
                this.detachedRowHeaderLayer.insertBefore(fragment, this.detachedRowHeaderLayer.firstChild);
                continue;
            }
            this.detachedRowHeaderLayer.appendChild(fragment);
        }
        this.syncDetachedHeaderScrollOffsetWithPositions(scrollTop, scrollLeft);
    }

    /** legacy detached-layer 用: row header clone の top 座標を旧 full rebuild と同じ規則で返す */
    private getDetachedViewportRowTopPx(sourceRow: HTMLElement, logicalRowIndex: number): string {
        if (logicalRowIndex <= this.frozenRowCount) {
            return `${this.getHeaderRowHeightPx() + ((logicalRowIndex - 1) * this.getDataRowHeightPx())}px`;
        }
        return `${sourceRow.offsetTop}px`;
    }

    /** legacy detached-layer 用: 行ヘッダー clone を1行分生成する */
    private createDetachedViewportRowClone(sourceRow: HTMLElement): HTMLElement | null {
        const rowHeader = sourceRow.querySelector('.editor-table-row-header') as HTMLElement | null;
        if (rowHeader === null) return null;
        const rowIndexText = rowHeader.dataset.rowIndex;
        if (rowIndexText === undefined) return null;
        const logicalRowIndex = Number(rowIndexText) + 1;
        const detachedRow = document.createElement('div');
        detachedRow.classList.add('editor-table-detached-row');
        detachedRow.dataset.rowIndex = rowIndexText;
        detachedRow.style.top = this.getDetachedViewportRowTopPx(sourceRow, logicalRowIndex);
        this.syncDetachedRowVisualState(sourceRow, detachedRow);
        const prefixColumnCount = Math.min(this.dataColumnOffset(), sourceRow.children.length);
        for (let col = 0; col < prefixColumnCount; col++) {
            const sourceCell = sourceRow.children[col] as HTMLElement | null;
            if (sourceCell === null) continue;
            detachedRow.appendChild(this.cloneDetachedCell(sourceCell));
        }
        return detachedRow;
    }

    /** legacy detached-layer 用: 表示中の row header clone の見た目だけを同期する */
    private syncDetachedViewportRowHeaderStates(): void {
        if (this.usesInternalMainViewport) return;
        const prefixColumnCount = this.dataColumnOffset();
        const detachedViewportRows = this.detachedRowHeaderLayer.children;
        for (let rowIndex = 0; rowIndex < detachedViewportRows.length; rowIndex++) {
            const detachedRow = detachedViewportRows[rowIndex] as HTMLElement;
            const rowIndexText = detachedRow.dataset.rowIndex;
            if (rowIndexText === undefined) continue;
            const sourceRow = this.getRowElement(Number(rowIndexText) + 1);
            if (sourceRow === null) continue;
            detachedRow.style.top = this.getDetachedViewportRowTopPx(sourceRow, Number(rowIndexText) + 1);
            this.syncDetachedRowVisualState(sourceRow, detachedRow);
            const syncCount = Math.min(prefixColumnCount, sourceRow.children.length, detachedRow.children.length);
            for (let col = 0; col < syncCount; col++) {
                this.syncDetachedCellVisualState(sourceRow.children[col] as HTMLElement, detachedRow.children[col] as HTMLElement);
            }
        }
    }

    /** legacy detached-layer 用: 静的レイヤーを壊さず、表示中 row header のみ差分更新する */
    private refreshDetachedViewportRowHeaders(update: RenderedRowsUpdate | null): void {
        if (this.usesInternalMainViewport) return;
        const scrollTop = update !== null ? update.scrollTop : this.scrollContainer.scrollTop;
        const scrollLeft = update !== null ? update.scrollLeft : this.scrollContainer.scrollLeft;
        const rebuildAll = (): void => {
            const renderedRows = this.getRenderedRowElements();
            const fragment = document.createDocumentFragment();
            for (const rowElement of renderedRows) {
                const logicalRowIndex = this.getLogicalRowIndexFromElement(rowElement);
                if (logicalRowIndex === null || logicalRowIndex === 0) continue;
                const detachedRow = this.createDetachedViewportRowClone(rowElement);
                if (detachedRow !== null) fragment.appendChild(detachedRow);
            }
            this.detachedRowHeaderLayer.replaceChildren(fragment);
            this.syncDetachedHeaderScrollOffsetWithPositions(scrollTop, scrollLeft);
        };
        if (update === null || update.refreshAllRows || this.detachedRowHeaderLayer.childElementCount === 0) {
            rebuildAll();
            return;
        }
        const renderedRows = this.getRenderedRowElements();
        let firstSourceRow: HTMLElement | null = null;
        let lastSourceRow: HTMLElement | null = null;
        for (const rowElement of renderedRows) {
            const logicalRowIndex = this.getLogicalRowIndexFromElement(rowElement);
            if (logicalRowIndex === null || logicalRowIndex <= this.frozenRowCount) continue;
            if (firstSourceRow === null) firstSourceRow = rowElement;
            lastSourceRow = rowElement;
        }
        if (firstSourceRow === null || lastSourceRow === null) {
            rebuildAll();
            return;
        }
        const firstSourceRowHeader = firstSourceRow.querySelector('.editor-table-row-header') as HTMLElement | null;
        const lastSourceRowHeader = lastSourceRow.querySelector('.editor-table-row-header') as HTMLElement | null;
        if (firstSourceRowHeader === null || lastSourceRowHeader === null) {
            rebuildAll();
            return;
        }
        const firstCurrentRowIndexText = firstSourceRowHeader.dataset.rowIndex;
        const lastCurrentRowIndexText = lastSourceRowHeader.dataset.rowIndex;
        if (firstCurrentRowIndexText === undefined || lastCurrentRowIndexText === undefined) {
            rebuildAll();
            return;
        }
        const firstCurrentRowIndex = Number(firstCurrentRowIndexText);
        const lastCurrentRowIndex = Number(lastCurrentRowIndexText);
        while (this.detachedRowHeaderLayer.firstElementChild instanceof HTMLElement) {
            const firstDetachedRow = this.detachedRowHeaderLayer.firstElementChild;
            const rowIndexText = firstDetachedRow.dataset.rowIndex;
            if (rowIndexText !== undefined && (Number(rowIndexText) < this.frozenRowCount || Number(rowIndexText) >= firstCurrentRowIndex)) break;
            this.detachedRowHeaderLayer.removeChild(firstDetachedRow);
        }
        while (this.detachedRowHeaderLayer.lastElementChild instanceof HTMLElement) {
            const lastDetachedRow = this.detachedRowHeaderLayer.lastElementChild;
            const rowIndexText = lastDetachedRow.dataset.rowIndex;
            if (rowIndexText !== undefined && Number(rowIndexText) <= lastCurrentRowIndex) break;
            this.detachedRowHeaderLayer.removeChild(lastDetachedRow);
        }
        for (const insertedRange of update.insertedRanges) {
            if (insertedRange.start >= insertedRange.end) continue;
            const fragment = document.createDocumentFragment();
            for (let dataRowIndex = insertedRange.start; dataRowIndex < insertedRange.end; dataRowIndex++) {
                const sourceRow = this.getRowElement(dataRowIndex + 1);
                if (sourceRow === null) continue;
                const detachedRow = this.createDetachedViewportRowClone(sourceRow);
                if (detachedRow !== null) fragment.appendChild(detachedRow);
            }
            if (insertedRange.start <= firstCurrentRowIndex) {
                let firstViewportDetachedRow: Element | null = null;
                for (let childIndex = 0; childIndex < this.detachedRowHeaderLayer.children.length; childIndex++) {
                    const child = this.detachedRowHeaderLayer.children[childIndex] as HTMLElement;
                    const rowIndexText = child.dataset.rowIndex;
                    if (rowIndexText === undefined) continue;
                    if (Number(rowIndexText) < this.frozenRowCount) continue;
                    firstViewportDetachedRow = child;
                    break;
                }
                if (firstViewportDetachedRow === null) {
                    this.detachedRowHeaderLayer.appendChild(fragment);
                } else {
                    this.detachedRowHeaderLayer.insertBefore(fragment, firstViewportDetachedRow);
                }
                continue;
            }
            this.detachedRowHeaderLayer.appendChild(fragment);
        }
        this.syncDetachedHeaderScrollOffsetWithPositions(scrollTop, scrollLeft);
    }

    /** legacy detached-layer 用: static clone の選択状態だけを同期する */
    private syncDetachedLegacyStaticCellStates(): void {
        if (this.usesInternalMainViewport) return;
        const headerRow = this.getRowElement(0);
        if (headerRow === null) return;
        const prefixColumnCount = this.dataColumnOffset();
        const detachedCornerRow = this.detachedCornerLayer.firstElementChild as HTMLElement | null;
        if (detachedCornerRow !== null) {
            const syncCount = Math.min(prefixColumnCount, headerRow.children.length, detachedCornerRow.children.length);
            for (let col = 0; col < syncCount; col++) {
                this.syncDetachedCellVisualState(headerRow.children[col] as HTMLElement, detachedCornerRow.children[col] as HTMLElement);
            }
        }
        const detachedHeaderRow = this.detachedColumnHeaderLayer.firstElementChild as HTMLElement | null;
        if (detachedHeaderRow !== null) {
            const availableColumnCount = Math.min(headerRow.children.length - prefixColumnCount, detachedHeaderRow.children.length);
            for (let col = 0; col < availableColumnCount; col++) {
                const detachedChild = detachedHeaderRow.children[col] as HTMLElement | undefined;
                if (detachedChild === undefined) continue;
                this.syncDetachedCellVisualState(
                    headerRow.children[prefixColumnCount + col] as HTMLElement,
                    detachedChild
                );
            }
        }
        for (let logicalRowIndex = 1; logicalRowIndex <= this.frozenRowCount; logicalRowIndex++) {
            const sourceRow = this.getRowElement(logicalRowIndex);
            if (sourceRow === null) continue;
            const dataRowIndex = logicalRowIndex - 1;
            const detachedFrozenDataRow =
                this.detachedFrozenRowDataLayer.querySelector<HTMLElement>(`.editor-table-detached-row[data-row-index="${dataRowIndex}"]`);
            if (detachedFrozenDataRow === null) continue;
            this.syncDetachedRowVisualState(sourceRow, detachedFrozenDataRow);
            const syncCount = Math.min(sourceRow.children.length - prefixColumnCount, detachedFrozenDataRow.children.length);
            for (let col = 0; col < syncCount; col++) {
                this.syncDetachedCellVisualState(
                    sourceRow.children[prefixColumnCount + col] as HTMLElement,
                    detachedFrozenDataRow.children[col] as HTMLElement
                );
            }
        }
    }

    private syncQuadrantStaticCellStates(): void {
        if (!this.usesInternalMainViewport) return;
        const headerRow = this.getRowElement(0);
        if (headerRow === null) return;
        const fixedLeftColumnCount = this.dataColumnOffset() + this.frozenColumnCount;
        const detachedCornerRow = this.detachedCornerLayer.firstElementChild as HTMLElement | null;
        if (detachedCornerRow !== null) {
            const syncCount = Math.min(fixedLeftColumnCount, headerRow.children.length, detachedCornerRow.children.length);
            for (let col = 0; col < syncCount; col++) {
                this.syncDetachedCellVisualState(headerRow.children[col] as HTMLElement, detachedCornerRow.children[col] as HTMLElement);
            }
        }
        const detachedHeaderRow = this.detachedColumnHeaderLayer.firstElementChild as HTMLElement | null;
        if (detachedHeaderRow !== null) {
            const availableColumnCount = Math.min(headerRow.children.length - fixedLeftColumnCount, detachedHeaderRow.children.length);
            for (let col = 0; col < availableColumnCount; col++) {
                const detachedChild = detachedHeaderRow.children[col] as HTMLElement | undefined;
                if (detachedChild === undefined) continue;
                this.syncDetachedCellVisualState(
                    headerRow.children[fixedLeftColumnCount + col] as HTMLElement,
                    detachedChild
                );
            }
        }
        const detachedViewportRows = this.detachedRowHeaderLayer.children;
        for (let rowIndex = 0; rowIndex < detachedViewportRows.length; rowIndex++) {
            const detachedRow = detachedViewportRows[rowIndex] as HTMLElement;
            const rowIndexText = detachedRow.dataset.rowIndex;
            if (rowIndexText === undefined) continue;
            const sourceRow = this.getRowElement(Number(rowIndexText) + 1);
            if (sourceRow === null) continue;
            this.syncDetachedRowVisualState(sourceRow, detachedRow);
            const syncCount = Math.min(fixedLeftColumnCount, sourceRow.children.length, detachedRow.children.length);
            for (let col = 0; col < syncCount; col++) {
                this.syncDetachedCellVisualState(sourceRow.children[col] as HTMLElement, detachedRow.children[col] as HTMLElement);
            }
        }
        for (let logicalRowIndex = 1; logicalRowIndex <= this.frozenRowCount; logicalRowIndex++) {
            const sourceRow = this.getRowElement(logicalRowIndex);
            if (sourceRow === null) continue;
            const dataRowIndex = logicalRowIndex - 1;
            const detachedFrozenCornerRow =
                this.detachedFrozenCornerDataLayer.querySelector<HTMLElement>(`.editor-table-detached-row[data-row-index="${dataRowIndex}"]`);
            if (detachedFrozenCornerRow !== null) {
                this.syncDetachedRowVisualState(sourceRow, detachedFrozenCornerRow);
                const syncCount = Math.min(fixedLeftColumnCount, sourceRow.children.length, detachedFrozenCornerRow.children.length);
                for (let col = 0; col < syncCount; col++) {
                    this.syncDetachedCellVisualState(sourceRow.children[col] as HTMLElement, detachedFrozenCornerRow.children[col] as HTMLElement);
                }
            }
            const detachedFrozenDataRow =
                this.detachedFrozenRowDataLayer.querySelector<HTMLElement>(`.editor-table-detached-row[data-row-index="${dataRowIndex}"]`);
            if (detachedFrozenDataRow !== null) {
                this.syncDetachedRowVisualState(sourceRow, detachedFrozenDataRow);
                const syncCount = Math.min(sourceRow.children.length - fixedLeftColumnCount, detachedFrozenDataRow.children.length);
                for (let col = 0; col < syncCount; col++) {
                    this.syncDetachedCellVisualState(
                        sourceRow.children[fixedLeftColumnCount + col] as HTMLElement,
                        detachedFrozenDataRow.children[col] as HTMLElement
                    );
                }
            }
        }
    }

    private syncDetachedHeaderScrollOffset(): void {
        this.syncDetachedHeaderScrollOffsetWithPositions(this.scrollContainer.scrollTop, this.scrollContainer.scrollLeft);
    }

    private setInlineTransformIfChanged(element: HTMLElement, transform: string): void {
        if (element.style.transform === transform) return;
        element.style.transform = transform;
    }

    private setInlineZIndexIfChanged(element: HTMLElement, zIndex: string): void {
        if (element.style.zIndex === zIndex) return;
        element.style.zIndex = zIndex;
    }

    private syncDetachedHeaderScrollOffsetWithPositions(scrollTop: number, scrollLeft: number): void {
        if (this.usesInternalMainViewport) {
            this.topRightViewport.scrollLeft = scrollLeft;
            this.leftBottomViewport.scrollTop = scrollTop;
            return;
        }
        this.virtualScroll.setScrollTopCompensationPx(0);
        this.setInlineTransformIfChanged(this.detachedColumnHeaderLayer, `translateY(${scrollTop}px)`);
        this.setInlineTransformIfChanged(this.detachedRowHeaderLayer, `translateX(${scrollLeft}px)`);
        this.setInlineTransformIfChanged(this.detachedFrozenRowBackgroundLayer, `translateY(${scrollTop}px)`);
        this.setInlineTransformIfChanged(this.detachedCornerLayer, `translate(${scrollLeft}px, ${scrollTop}px)`);
        this.setInlineTransformIfChanged(this.detachedFrozenRowDataLayer, `translateY(${scrollTop}px)`);
        const detachedHeaderRow = this.detachedColumnHeaderLayer.firstElementChild as HTMLElement | null;
        if (detachedHeaderRow !== null && this.frozenColumnCount > 0) {
            const frozenColumnTransform = `translateX(${scrollLeft}px)`;
            const syncCount = Math.min(this.frozenColumnCount, detachedHeaderRow.children.length);
            for (let col = 0; col < syncCount; col++) {
                const headerCell = detachedHeaderRow.children[col] as HTMLElement;
                this.setInlineTransformIfChanged(headerCell, frozenColumnTransform);
            }
        }
        if (this.frozenColumnCount > 0) {
            const detachedFrozenDataRows = this.detachedFrozenRowDataLayer.children;
            const frozenColumnTransform = `translateX(${scrollLeft}px)`;
            for (let rowIndex = 0; rowIndex < detachedFrozenDataRows.length; rowIndex++) {
                const detachedDataRow = detachedFrozenDataRows[rowIndex] as HTMLElement;
                const syncCount = Math.min(this.frozenColumnCount, detachedDataRow.children.length);
                for (let col = 0; col < syncCount; col++) {
                    const cell = detachedDataRow.children[col] as HTMLElement;
                    this.setInlineTransformIfChanged(cell, frozenColumnTransform);
                }
            }
        }
        if (this.frozenRowCount > 0) {
            const detachedRows = this.detachedRowHeaderLayer.children;
            const frozenRowTransform = `translateY(${scrollTop}px)`;
            for (let i = 0; i < detachedRows.length; i++) {
                const detachedRow = detachedRows[i] as HTMLElement;
                const rowIndexText = detachedRow.dataset.rowIndex;
                if (rowIndexText === undefined) continue;
                const logicalRowIndex = Number(rowIndexText) + 1;
                if (logicalRowIndex > this.frozenRowCount) continue;
                this.setInlineTransformIfChanged(detachedRow, frozenRowTransform);
            }
        }
    }

    private syncScrollBoundVisuals(): void {
        this.syncScrollBoundVisualsWithPositions(this.scrollContainer.scrollTop, this.scrollContainer.scrollLeft);
    }

    private syncScrollBoundVisualsWithPositions(scrollTop: number, scrollLeft: number): void {
        this.syncDetachedHeaderScrollOffsetWithPositions(scrollTop, scrollLeft);
        this.syncFreezeTransforms(scrollTop, scrollLeft);
        this.onScrollForFrozenFillHandle();
        this.emitScrollMetricsChanged();
    }

    refreshDetachedHeaderLayout(): void {
        this.refreshDetachedHeaderLayers();
        this.syncScrollBoundVisuals();
    }

    syncDetachedVisualState(): void {
        if (this.usesInternalMainViewport) {
            this.syncQuadrantStaticCellStates();
            return;
        }
        this.syncDetachedLegacyStaticCellStates();
        this.syncDetachedViewportRowHeaderStates();
        this.syncScrollBoundVisuals();
    }

    setDetachedHeaderTopOffset(offsetPx: number): void {
        this.detachedHeaderTopOffset = offsetPx;
        this.refreshDetachedHeaderLayout();
    }

    private refreshFreezeVisualState(): void {
        // 固定数変更や構造変更では、既存DOMに残った古い固定クラスを一度すべて落とす。
        this.syncFreezeStateCssClasses();
        this.clearAllFreezeStyles();
        this.applyFreezeVisualStateToRenderedRows();
        this.refreshDetachedHeaderLayout();
    }

    private syncFreezeStateCssClasses(): void {
        this.element.classList.toggle('editor-table--has-frozen-columns', this.frozenColumnCount > 0);
        this.element.classList.toggle('editor-table--has-frozen-rows', this.frozenRowCount > 0);
    }

    private getQuadrantViewportRowTopPx(logicalRowIndex: number): number {
        const rowHeight = this.getDataRowHeightPx();
        if (logicalRowIndex <= this.frozenRowCount) {
            return this.getHeaderRowHeightPx() + ((logicalRowIndex - 1) * rowHeight);
        }
        return (logicalRowIndex - 1 - this.frozenRowCount) * rowHeight;
    }

    private applyFreezeVisualStateToRenderedRows(): void {
        // 仮想スクロール時は差し替えられた行だけが新規DOMになるため、ここでは add-only で十分。
        // 全掃除を入れると可視行・可視セルすべてに class remove が走り、スクロールコストが跳ね上がる。
        const renderedRows = this.getRenderedRowElements();
        const dataColumnOffset = this.dataColumnOffset();
        for (const rowElement of renderedRows) {
            const logicalRowIndex = this.getLogicalRowIndexFromElement(rowElement);
            const isHeaderRow = logicalRowIndex === 0;
            const isFrozenRow = logicalRowIndex !== null && logicalRowIndex > 0 && logicalRowIndex <= this.frozenRowCount;
            if (isFrozenRow) {
                rowElement.classList.add('freeze-row');
                if (logicalRowIndex === this.frozenRowCount) rowElement.classList.add('freeze-row-border');
                const cellCount = rowElement.children.length;
                for (let col = dataColumnOffset; col < cellCount; col++) {
                    rowElement.children[col].classList.add('freeze-cell');
                }
            }
            if (this.frozenColumnCount === 0) continue;
            for (let dataColIndex = 0; dataColIndex < this.frozenColumnCount; dataColIndex++) {
                const cell = rowElement.children[dataColIndex + dataColumnOffset] as HTMLElement | null;
                if (cell === null) continue;
                if (dataColIndex === this.frozenColumnCount - 1) cell.classList.add('freeze-column-border');
                if (!isHeaderRow) cell.classList.add('freeze-cell');
            }
        }
    }

    private syncFreezeTransforms(scrollTop: number, scrollLeft: number): void {
        if (this.usesInternalMainViewport) return;
        if (this.frozenRowCount === 0 && this.frozenColumnCount === 0) return;
        const renderedRows = this.getRenderedRowElements();
        const dataColumnOffset = this.dataColumnOffset();
        const rowHeight = this.getDataRowHeightPx();
        const frozenColumnTransform = `translate(${scrollLeft}px, 0px)`;
        for (const rowElement of renderedRows) {
            const logicalRowIndex = this.getLogicalRowIndexFromElement(rowElement);
            const isFrozenRow = logicalRowIndex !== null && logicalRowIndex > 0 && logicalRowIndex <= this.frozenRowCount;
            const frozenRowTranslateY = isFrozenRow
                ? scrollTop + this.getHeaderRowHeightPx() + ((logicalRowIndex - 1) * rowHeight) - rowElement.offsetTop
                : 0;
            const cellCount = rowElement.children.length;
            if (isFrozenRow) {
                const frozenRowOnlyTransform = `translate(0px, ${frozenRowTranslateY}px)`;
                const frozenCornerTransform = `translate(${scrollLeft}px, ${frozenRowTranslateY}px)`;
                for (let col = 0; col < cellCount; col++) {
                    const cell = rowElement.children[col] as HTMLElement;
                    const dataColIndex = col - dataColumnOffset;
                    const isFrozenColumn = dataColIndex >= 0 && dataColIndex < this.frozenColumnCount;
                    this.setInlineTransformIfChanged(cell, isFrozenColumn ? frozenCornerTransform : frozenRowOnlyTransform);
                    this.setInlineZIndexIfChanged(cell, isFrozenColumn ? 'var(--z-index-freeze-corner)' : 'var(--z-index-freeze-row)');
                }
                continue;
            }
            if (this.frozenColumnCount === 0) continue;
            const frozenColumnEnd = Math.min(cellCount, dataColumnOffset + this.frozenColumnCount);
            for (let col = dataColumnOffset; col < frozenColumnEnd; col++) {
                const cell = rowElement.children[col] as HTMLElement;
                this.setInlineTransformIfChanged(cell, frozenColumnTransform);
                this.setInlineZIndexIfChanged(cell, 'var(--z-index-freeze-column)');
            }
        }
    }

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

    /** 内部モジュール用: バーチャルスクロールの総行数をデータ行数で同期する。
     * フィルター適用時はフィルター後の行数を使用する。
     * バッファ行は含まない。ensureTrailingBufferRow() がバッファ行追加後に別途+1を加算する。 */
    syncVirtualScrollTotalRowCount(): void {
        this.virtualScroll.updateTotalRowCount(this.getFilteredDataRowCount());
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

    /** 現在のソート状態をスキーマJSON永続化用にシリアライズする */
    serializeSortKeys(): SerializedSortKey[] { return this.columnSorter.serializeSortKeys(); }

    /**
     * 現在のフィルター状態をスキーマJSON永続化用にシリアライズする。
     * ストアのCSVヘッダーから列名を取得してストア列インデックスを列名に変換する。
     */
    serializeFilters(): SerializedFilters {
        const storeColumnNames = this.store.getHeader(this.tableName);
        if (storeColumnNames === false) return {};
        return this.columnFilter.serializeFilters(storeColumnNames);
    }

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
     * createCell の dblclick ハンドラから呼ばれる（デメテルの法則: getHandler().toggleBoolCell() を避ける）。
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
        this.element.classList.add(this.rootCssClass);
        if (this.usesInternalMainViewport) this.element.classList.add('editor-table--quadrant-layout');
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
            columnHeaderRow.classList.remove('editor-table-row');
            columnHeaderRow.classList.add('editor-table-source-column-header-row');
            this.gridElement.appendChild(columnHeaderRow);
        }
        // ヘッダー行追加直後に topSpacer をテーブル内に配置する（データ行追加前に必要）
        this.virtualScroll.attachSpacers();
        // 通常テーブルはストア、ミニテーブルは呼び出し元から渡された部分行データを初期描画のソースにする。
        // ミニテーブルは initialize() 後に setStoreRowIndices() で実ストア行へ差し替えられる。
        const initialStoreRows = this.isMiniTable ? false : this.store.getRows(this.tableName);
        const initialDataRowCount = initialStoreRows === false ? this.tableData.body.length : initialStoreRows.length;
        this.storeRowIndices = Array.from({ length: initialDataRowCount }, (_, i) => i);
        // filteredRowIndices はフィルター未適用時は空配列のまま（applyFilterDisplay で設定される）
        // totalRowCount はバッファ行を含むDOM上の総データ行数。
        // 通常テーブル: emptyRowCount = body.length + 1（データ行 + バッファ行1行）
        // 差分テーブル: emptyRowCount = 0 だが実データ行が存在するため storeRowIndices.length を使う。
        // forceRecalculate() が totalRowCount に基づいてDOM行を管理するため、
        // バッファ行を含めないと forceRecalculate 時にバッファ行がDOMから削除される。
        this.virtualScroll.updateTotalRowCount(Math.max(this.emptyRowCount, this.storeRowIndices.length));
        for (let i = 0; i < initialDataRowCount; ++i) {
            const cells: HTMLElement[] = [];
            cells.push(this.structure.createRowHeaderCell(String(i + 1), i));
            for (let j = 0; j < this.tableData.header.length; ++j) {
                let value = '';
                if (initialStoreRows !== false) {
                    const storeRow = initialStoreRows[i];
                    const storeColumnIndex = this.tableData.columnMapping[j];
                    value = storeColumnIndex === -1 || storeColumnIndex >= storeRow.length ? '' : storeRow[storeColumnIndex];
                } else {
                    value = this.tableData.body[i].values[j];
                }
                cells.push(EditorTable.createCell(this, value, j, this.tableData.header[j].width, DEFAULT_ROW_HEIGHT));
            }
            const row = EditorTable.createRow(cells, i);
            row.dataset.rowIndex = String(i);
            row.dataset.storeIndex = String(i);
            // bottomSpacer がテーブル末尾に存在するため、その直前に挿入する
            this.virtualScroll.appendDataRow(row);
        }
        for (let i = 0; i < this.emptyRowCount - initialDataRowCount; ++i) {
            const row = this.renderBufferRow(initialDataRowCount + i);
            // bottomSpacer がテーブル末尾に存在するため、その直前に挿入する
            this.virtualScroll.appendDataRow(row);
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
        // 全行生成後にバーチャルスクロールの初期表示範囲を確立する。
        // ビューポートに収まる行のみ残し、残りは削除してスペーサーで高さを補完する。
        this.virtualScroll.forceRecalculate();
        // forceRecalculate() が初期DOMを作り直すため、その後でブックマーク視覚マークを復元する
        this.restoreBookmarkMarks();
        this.refreshFreezeVisualState();
    }

    /** バーチャルスクロールのスペーサーとDOM行を強制再計算する（タブ復帰時に使用） */
    forceVirtualScrollRecalculate(): void {
        this.virtualScroll.forceRecalculate();
        this.refreshDetachedHeaderLayout();
    }

    /** バーチャルスクロールの全行を破棄して再レンダリングする（diffTab接続後の初期装飾適用に使用） */
    forceVirtualScrollFullRerender(): void {
        this.virtualScroll.forceFullRerender();
        this.refreshDetachedHeaderLayout();
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
        const storeRowIndex = this.storeRowIndices[dataRowIndex];
        const storeRows = this.store.getRows(this.tableName);
        const columnMapping = this.tableData.columnMapping;
        const cells: HTMLElement[] = [];
        // 行ヘッダー（表示上は1始まり）
        cells.push(this.structure.createRowHeaderCell(String(dataRowIndex + 1), dataRowIndex));
        for (let j = 0; j < this.tableData.header.length; ++j) {
            // columnMapping でDOM列→ストア（CSV）列に変換してセル値を取得する
            const csvColIndex = columnMapping[j];
            let value: string = '';
            if (storeRows !== false && csvColIndex !== -1) {
                const storeRow = storeRows[storeRowIndex];
                if (csvColIndex < storeRow.length) {
                    value = storeRow[csvColIndex];
                }
            }
            cells.push(EditorTable.createCell(this, value, j, this.tableData.header[j].width, DEFAULT_ROW_HEIGHT));
        }
        const row = EditorTable.createRow(cells, dataRowIndex);
        row.dataset.rowIndex = String(dataRowIndex);
        // ソート時にstoreRowIndexからDOM行要素を逆引きするためのインデックスを付与する
        row.dataset.storeIndex = String(storeRowIndex);
        return row;
    }

    /**
     * バッファ行（空行）のDOM要素を生成して返す。
     * バッファ行はユーザーが入力を開始するまで空のまま保持される待機行。
     *
     * @param dataRowIndex DOM上のデータ行インデックス（0始まり、ヘッダー行を除く）
     * @returns 生成された行要素（editor-table-empty-row クラス付き）
     */
    renderBufferRow(dataRowIndex: number): HTMLElement {
        const cells: HTMLElement[] = [];
        cells.push(this.structure.createRowHeaderCell(String(dataRowIndex + 1), dataRowIndex));
        for (let j = 0; j < this.tableData.header.length; ++j) {
            cells.push(EditorTable.createCell(this, '', j, this.tableData.header[j].width, DEFAULT_ROW_HEIGHT));
        }
        const row = EditorTable.createRow(cells, dataRowIndex);
        row.dataset.rowIndex = String(dataRowIndex);
        // バッファ行（ユーザーが直接挿入した行と区別するための識別クラス）
        row.classList.add('editor-table-empty-row');
        return row;
    }

    /**
     * バーチャルスクロールの行動的生成コールバック。
     * データ行かバッファ行かを判定し、適切なメソッドに委譲する。
     * filteredRowIndices の長さ（=フィルター後のデータ行数）を境界としてバッファ行を判定する。
     * フィルター適用時: dataRowIndex を filteredRowIndices 経由で storeRowIndices 上のインデックスに変換する。
     * フィルター未適用時: hasActiveFilter()=false により dataRowIndex をそのまま使用する。
     * 生成後にバリデーションエラークラスとgit変更クラスを適用する。
     *
     * フィルター適用時: data-row-index をフィルター後の論理インデックス（0,1,2,...）に上書きする。
     * getCellPosition() は data-row-index を読んで行番号を返し、Selection はこの論理行番号で動作する。
     * ストアアクセス時は resolveStoreRowIndex() で論理インデックスを storeRowIndices 上のインデックスに変換する。
     */
    private renderRowForVirtualScroll(dataRowIndex: number): HTMLElement {
        const filteredCount = this.getFilteredDataRowCount();
        if (dataRowIndex < filteredCount) {
            // フィルター適用時: filteredRowIndices で storeRowIndices 上のインデックスに変換
            // フィルター未適用時: dataRowIndex をそのまま使用（storeRowIndices[dataRowIndex]）
            const mappedDataRowIndex = this.columnFilter.hasActiveFilter()
                ? this.filteredRowIndices[dataRowIndex]
                : dataRowIndex;
            const row = this.renderDataRow(mappedDataRowIndex);
            // フィルター適用時、renderDataRow は mappedDataRowIndex（storeRowIndices上のインデックス）で
            // data-row-index を設定するが、仮想スクロールの論理行インデックスは dataRowIndex であるべき。
            // getCellPosition() が data-row-index を読んで行番号を返すため、フィルター後の連続した
            // 論理行番号（0,1,2,...）に修正する。ストアアクセスは resolveStoreRowIndex() で変換する。
            if (this.columnFilter.hasActiveFilter()) {
                const rowHeader = row.querySelector('.editor-table-row-header') as HTMLElement | null;
                if (rowHeader) {
                    rowHeader.dataset.rowIndex = String(dataRowIndex);
                    // 行ヘッダーのテキストノードも仮想スクロールの論理行番号に更新する
                    for (const node of Array.from(rowHeader.childNodes)) {
                        if (node.nodeType === Node.TEXT_NODE) { node.textContent = String(dataRowIndex + 1); break; }
                    }
                }
                row.dataset.rowIndex = String(dataRowIndex);
                // 行の data-row 属性も論理行インデックスに更新する
                row.dataset.row = String(dataRowIndex + 1);
            }
            this.applyRowDecorations(row, mappedDataRowIndex);
            // 差分タブ接続時: diffクラスを適用する
            if (this.diffTab !== false) {
                this.diffTab.applyDiffDecorationsToRow(row, mappedDataRowIndex, this);
            }
            return row;
        }
        return this.renderBufferRow(dataRowIndex);
    }

    /**
     * バーチャルスクロールで動的生成されたデータ行に、バリデーションエラーとgit変更のクラスを適用する。
     * applyValidationErrors / applyGitDiffHighlight でキャッシュされた情報を使用する。
     */
    private applyRowDecorations(rowElement: HTMLElement, dataRowIndex: number): void {
        const storeRowIndex = this.storeRowIndices[dataRowIndex];
        const offset = this.dataColumnOffset();
        const colCount = this.getColumnCount();
        // バリデーションエラークラスの適用
        if (this.cachedPkErrorCells.size > 0 || this.cachedOtherErrorCells.size > 0) {
            for (let dataColIdx = 0; dataColIdx < colCount; dataColIdx++) {
                const cell = rowElement.children[dataColIdx + offset] as HTMLElement | null;
                if (!cell) continue;
                const storeColIdx = dataColIdx < this.cachedDomColToStoreCol.length ? this.cachedDomColToStoreCol[dataColIdx] : -1;
                if (storeColIdx === -1) continue;
                const key = `${storeRowIndex},${storeColIdx}`;
                const isPkError = this.cachedPkErrorCells.has(key);
                const isOtherError = this.cachedOtherErrorCells.has(key);
                if (isPkError) { cell.classList.add('cell-pk-duplicate'); }
                if (isPkError || isOtherError) { cell.classList.add('cell-error'); }
            }
        }
        // git変更クラスの適用
        if (this.gitDiffTracker !== false) {
            const storeRows = this.store.getRows(this.tableName);
            if (storeRows !== false) {
                const columnMapping = this.tableData.columnMapping;
                for (let dataColIdx = 0; dataColIdx < colCount; dataColIdx++) {
                    const cell = rowElement.children[dataColIdx + offset] as HTMLElement | null;
                    if (!cell) continue;
                    const storeColIdx = dataColIdx < columnMapping.length ? columnMapping[dataColIdx] : -1;
                    if (storeColIdx === -1) continue;
                    if (this.gitDiffTracker.isCellChanged(storeRows, storeRowIndex, storeColIdx)) {
                        cell.classList.add('cell-git-changed');
                    }
                }
            }
        }
    }

    /**
     * スクロールイベント時に行入れ替えの有無にかかわらず呼ばれる。
     * 固定行・固定列のセルが選択されている場合、fillHandle の位置を更新する。
     * fillHandle は選択終端セルの子要素として配置されるため、通常スクロールには自然に追従する。
     * 固定行/列ではスクロールに応じて可視セルが変わる場合があるため、ホストセルを再同期する。
     * 行入れ替え発生時は reapplyRowDecorations → updateFillHandlePosition が呼ばれるので
     * 重複更新になるが、軽量な処理のためパフォーマンス影響は無視できる。
     */
    private onScrollForFrozenFillHandle(): void {
        if (this.skipFrozenFillHandleRefreshOnNextScrollSync) {
            this.skipFrozenFillHandleRefreshOnNextScrollSync = false;
            return;
        }
        if (this.frozenRowCount === 0 && this.frozenColumnCount === 0) return;
        const range = this.selection.getSelectionRange();
        // endRow が固定行内、または endColumn が固定列内にある場合のみ更新する。
        // endRow はデータ行インデックス（1始まり、ヘッダー行は0）なので frozenRowCount と比較。
        // endColumn は DOM列インデックス（dataColumnOffset() 含む）なので
        // データ列インデックスに変換して frozenColumnCount と比較する。
        const isFrozenRow = this.frozenRowCount > 0 && range.endRow <= this.frozenRowCount;
        const endDataColumn = range.endColumn - this.dataColumnOffset();
        const isFrozenColumn = this.frozenColumnCount > 0 && endDataColumn < this.frozenColumnCount;
        if (!isFrozenRow && !isFrozenColumn) return;
        this.selection.refreshFillHandlePosition();
    }

    /**
     * バーチャルスクロールで行の入れ替えが完了した後に、表示中の行に装飾を再適用する。
     * 選択クラス、コピー範囲クラス、フォーカスセル、フリーズペインスタイルを再適用する。
     * 参照ヒント（FK参照先の表示名）を新しく生成された行に適用する。
     * バリデーションエラーとgit差分は renderRowForVirtualScroll 内の applyRowDecorations で適用済み。
     */
    private reapplyRowDecorations(update: RenderedRowsUpdate): void {
        // ドラッグ選択中（mousedown→mousemove中）は選択クラス再適用をスキップする。
        // ドラッグ中に applySelectionClasses を呼ぶと lastSelectionCells のリセットで
        // 中間状態が壊れ、ドラッグ操作が途中で止まる。
        // ドラッグ終了後の mouseup → selection.end() → updateRenderer() で正しく再適用される。
        if (this.selection.isSelecting() || this.selection.isSelectingColumn() || this.selection.isSelectingRow()) {
            this.applyFreezeVisualStateToRenderedRows();
            if (this.usesInternalMainViewport) {
                this.refreshQuadrantViewportRowHeaders(update);
                if (!update.triggeredByScroll) this.syncQuadrantStaticCellStates();
                return;
            }
            if (update.triggeredByScroll) {
                this.refreshDetachedViewportRowHeaders(update);
                return;
            }
            this.refreshDetachedHeaderLayout();
            return;
        }
        this.applyFreezeVisualStateToRenderedRows();
        this.selection.reapplySelectionClassesOnly(update.triggeredByScroll);
        const selectionRange = this.selection.getSelectionRange();
        const isFrozenRowSelection = this.frozenRowCount > 0 && selectionRange.endRow <= this.frozenRowCount;
        const endDataColumn = selectionRange.endColumn - this.dataColumnOffset();
        const isFrozenColumnSelection = this.frozenColumnCount > 0 && endDataColumn < this.frozenColumnCount;
        this.skipFrozenFillHandleRefreshOnNextScrollSync = update.triggeredByScroll && (isFrozenRowSelection || isFrozenColumnSelection);
        this.reapplyReferenceAndBookmarkDecorations(update);
        if (this.usesInternalMainViewport) {
            this.refreshQuadrantViewportRowHeaders(update);
            if (!update.triggeredByScroll) this.syncQuadrantStaticCellStates();
            return;
        }
        if (update.triggeredByScroll) {
            this.refreshDetachedViewportRowHeaders(update);
            return;
        }
        this.refreshDetachedHeaderLayout();
    }

    private reapplyReferenceAndBookmarkDecorations(update: RenderedRowsUpdate): void {
        if (update.refreshAllRows) {
            this.reference.updateReferenceHints();
            this.restoreBookmarkMarks();
            return;
        }
        for (const insertedRange of update.insertedRanges) {
            if (insertedRange.start >= insertedRange.end) continue;
            const startDomRow = this.virtualScroll.dataRowToDomIndex(insertedRange.start);
            const endDomRow = this.virtualScroll.dataRowToDomIndex(insertedRange.end - 1);
            if (startDomRow === null || endDomRow === null) continue;
            this.reference.updateReferenceHintsForRows(startDomRow, endDomRow + 1);
            this.restoreBookmarkMarksForDataRowRange(insertedRange.start, insertedRange.end);
        }
    }

    /**
     * バーチャルスクロールのスペーサー要素をDOM上に配置する。
     * appendTo() 完了後（テーブル要素が親要素に追加された後）に呼ぶこと。
     */
    attachSpacers(): void {
        this.virtualScroll.attachSpacers();
    }

    /**
     * グローバルイベントリスナーを登録する（タブがアクティブになったとき）
     * 視覚状態（editor-table--inactive クラス）は setInactiveAppearance() に一本化しているため、
     * ここでは操作しない。タブ復帰時に resume() で全ミニテーブルに activate() が呼ばれても
     * 非アクティブクラスが意図せず除去されるバグを防ぐためにこの分離が必要。
     */
    activate(): void {
        this.selectionDragController.activate();
        this.isActive = true;
        // タブ切り替え時に保持済みのマーカーデータを再描画する
        this.refreshScrollbarMarkers();
    }

    /**
     * グローバルイベントリスナーを解除する（タブが非アクティブになったとき）
     * 視覚状態（editor-table--inactive クラス）は setInactiveAppearance() に一本化しているため、
     * ここでは操作しない。
     */
    deactivate(): void {
        this.handler.deactivate();
        this.selectionDragController.deactivate();
        const wasActive = this.isActive;
        this.isActive = false;
        // 共有右側マーカーは、このテーブルが表示中だった場合だけクリアする。
        if (wasActive && this.scrollbarMarkerTrack !== false) this.scrollbarMarkerTrack.clear();
    }

    /**
     * テーブルにキーボードフォーカスを戻す。
     * FilterDropdown など外部UIを閉じた後に呼ぶことで、
     * Ctrl+Z/Ctrl+S などのキーボードショートカットが EditorTableHandler に到達するようにする。
     */
    focusTable(): void {
        this.handler.activate();
    }

    /**
     * アクティブ/非アクティブの視覚状態のみを切り替える
     * activateHandler() から複数の EditorTable に対して呼ばれる。
     * selectionDragController は操作しない（handler の排他制御とは独立）。
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
    // blame（変更履歴）表示
    // =========================================================================

    /**
     * blame情報が表示中かどうかを返す（コンテキストメニューのトグルラベル判定に使用）
     */
    isBlameShown(): boolean {
        return this.isBlameVisible;
    }

    /**
     * git blame を実行して各行の先頭（children[0]）に独立した blame-cell を挿入する
     */
    async showBlameAsync(): Promise<void> {
        const filename = 'data/' + this.tableName + '.csv';
        const entries = await gitBlameAsync(filename);
        this.isBlameVisible = true;
        // blame表示中クラスを付与して行ヘッダー・corner-cellのleftをCSSでずらす
        this.element.classList.add('editor-table--blame-visible');
        // 列ヘッダー行（element.children[0]）の先頭に blame-column-header を prepend する
        const headerRow = this.gridElement.children[0] as HTMLElement;
        const blameHeaderCell = document.createElement('div');
        blameHeaderCell.classList.add('blame-column-header', 'editor-table-cell');
        blameHeaderCell.textContent = 'BLAME';
        EditorTable.applyCellHeight(blameHeaderCell, DEFAULT_ROW_HEIGHT);
        headerRow.prepend(blameHeaderCell);
        // 行番号→BlameEntryの高速ルックアップマップを構築する
        const blameMap = new Map<number, BlameEntry>();
        for (let i = 0; i < entries.length; i++) {
            blameMap.set(entries[i].lineNumber, entries[i]);
        }
        // 各データ行・バッファ空行の先頭（children[0]）に blame-cell を prepend する
        const rowCount = this.getRowCount();
        for (let row = 1; row < rowCount; row++) {
            const rowElement = this.getRowElement(row);
            if (!rowElement) continue;
            const isEmptyRow = rowElement.classList.contains('editor-table-empty-row');
            const rowHeader = rowElement.querySelector('.editor-table-row-header') as HTMLElement | null;
            const rowIndexStr = rowHeader !== null ? rowHeader.dataset.rowIndex : null;
            // blame-cell は全行（バッファ空行含む）に追加してレイアウトを統一する
            const blameCell = document.createElement('div');
            blameCell.classList.add('blame-cell', 'editor-table-cell');
            EditorTable.applyCellHeight(blameCell, DEFAULT_ROW_HEIGHT);
            if (!isEmptyRow && rowIndexStr) {
                // data-rowIndex はCSVヘッダー行を除いたデータ行の0始まりインデックス。
                // git blame の lineNumber はCSVファイルの1始まり行番号で、行1がCSVヘッダー。
                // データ行0 → CSVファイル行2（ヘッダー行1行 + 0始まり→1始まり）
                const lineNumber = parseInt(rowIndexStr) + 2;
                const entry = blameMap.get(lineNumber);
                if (entry) {
                    blameCell.title = '最終変更: ' + entry.author + '（' + entry.date + '）';
                    blameCell.setAttribute('role', 'note');
                    blameCell.setAttribute('aria-label', '最終変更: ' + entry.author + '（' + entry.date + '）');
                    const authorSpan = document.createElement('span');
                    authorSpan.classList.add('blame-author');
                    authorSpan.textContent = entry.author;
                    blameCell.appendChild(authorSpan);
                    const dateSpan = document.createElement('span');
                    dateSpan.classList.add('blame-date');
                    dateSpan.textContent = entry.date;
                    blameCell.appendChild(dateSpan);
                }
            }
            rowElement.prepend(blameCell);
        }
        // blame列挿入でDOMインデックスが1つずれるため、フォーカス位置とSelection範囲を補正する
        if (this.lastFocusedCol >= 0) this.lastFocusedCol += 1;
        this.selection.shiftColumnsBy(1);
        // blame列挿入でデータセルの絶対座標がずれるため、選択範囲の描画を再計算する
        this.selection.updateRendererAfterResize();
        this.refreshFreezeVisualState();
    }

    /**
     * 各行の children[0] に挿入された blame-cell / blame-column-header を除去して非表示にする
     */
    hideBlame(): void {
        this.isBlameVisible = false;
        this.element.classList.remove('editor-table--blame-visible');
        // 各行の children[0]（blame-cell または blame-column-header）を除去する
        const rowCount = this.getRowCount();
        for (let row = 0; row < rowCount; row++) {
            const rowElement = this.getRowElement(row);
            if (!rowElement) continue;
            const firstChild = rowElement.children[0] as HTMLElement;
            if (firstChild && (firstChild.classList.contains('blame-cell') || firstChild.classList.contains('blame-column-header'))) {
                firstChild.remove();
            }
        }
        // blame列除去でDOMインデックスが1つ戻るため、フォーカス位置とSelection範囲を補正する
        if (this.lastFocusedCol >= 0) this.lastFocusedCol -= 1;
        this.selection.shiftColumnsBy(-1);
        // blame列除去でデータセルの絶対座標が戻るため、選択範囲の描画を再計算する
        this.selection.updateRendererAfterResize();
        this.refreshFreezeVisualState();
    }

    /**
     * blame表示中であれば自動的に非表示にする。
     * 行構造変更（ソート・フィルター・行追加/削除・行移動・タブ切替リロード）の冒頭で呼ぶ。
     * blameはgit committed dataのため、テーブル内容が変更された時点で陳腐化する。
     */
    private hideBlameIfVisible(): void {
        if (this.isBlameVisible) this.hideBlame();
    }

    // =========================================================================
    // スクロール
    // =========================================================================

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
            const firstCell = cells.length > 0 ? cells[0] : null;
            if (firstCell !== null && firstCell.classList.contains('editor-table-row-header')) {
                const rowIndexText = firstCell.dataset.rowIndex;
                if (rowIndexText !== undefined) row.dataset.rowIndex = rowIndexText;
            }
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
            // bool型（FK参照なし）の場合はトグル操作を行い、テキスト編集モードには入らない
            if (table.getColumnType(columnIndex) === 'bool' && !table.hasColumnReference(columnIndex)) {
                table.toggleBoolCell();
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
            console.log('[SelectionDrag] cell mousedown button=' + e.button);
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
            // メインテーブルのCtrl+クリックでFK列の参照先 / PK列の逆参照先テーブルを開く（RelationsPanel非表示時のみ）
            // start()でセルを選択した後、end()でドラッグ状態を即解除する。
            // end()を呼ばないとmouseupが発火しないままselecting=trueが残り、戻ったときに範囲選択になる。
            if ((e.ctrlKey || e.metaKey) && !table.isMiniTable
                && (table.navigateToReferenceTable(position.row, position.column)
                    || table.navigateToReverseReferenceTable(position.row, position.column))) {
                table.selection.start(position.row, position.column);
                table.selection.end();
                e.preventDefault();
                return;
            }
            if (e.shiftKey) {
                table.selection.extendSelection(position.row, position.column);
            } else {
                // SelectionDragController を有効化する（window mousemove/mouseup によるドラッグ選択に必要）。
                // activateTabState 経由で activate が呼ばれるべきだが、HMRリロード後など
                // タイミングによっては呼ばれないケースがあるため、mousedown 時にも確実に有効化する。
                // addEventListener の重複登録は SelectionDragController 側でガードする。
                table.selectionDragController.activate();
                console.log('[SelectionDrag] selection.start row=' + position.row + ' col=' + position.column);
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
            // ブックマーク追加/解除はPK値が取れる通常テーブル（タブあり）でのみ表示する
            // ミニテーブル（RelationsPanel内）やDiffTabではtab===falseなので抑制される
            const canShowBookmark = pkValue !== '' && table.tab !== false;
            // 表示するメニュー項目がない場合はメニューを出さない
            if (allEntries.length === 0 && !canShowFormView && !canShowBookmark) return;
            e.preventDefault();
            e.stopPropagation();
            // ドラグ状態をリセット
            table.selection.end();
            const menuItems: ContextMenuEntry[] = [];
            if (allEntries.length > 0) {
                menuItems.push({
                    label: '参照箇所を表示',
                    action: () => { table.showReferences(pkValue, allEntries); },
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
            // セルレベルのブックマーク追加/解除メニュー（修正10: PK列/非PK列のコードを共通化）
            if (canShowBookmark) {
                const clickedCol = table.tableData.header[columnIndex];
                const clickedColumnName = clickedCol ? clickedCol.name : '';
                if (clickedColumnName !== '') {
                    // PK列は行レベル判定、非PK列はセルレベル判定
                    const isBookmarked = isPkColumn
                        ? table.hasBookmarkForRow(table.tableName, pkValue)
                        : table.hasBookmark(table.tableName, pkValue, clickedColumnName);
                    if (isBookmarked) {
                        menuItems.push({
                            label: 'ブックマークを解除',
                            action: () => {
                                if (isPkColumn) {
                                    // 行内の全ブックマークを削除し、該当行全セルの視覚マークも除去する
                                    table.removeBookmarksForRow(table.tableName, pkValue);
                                    table.removeBookmarkMarksForRow(position.row);
                                } else {
                                    table.removeBookmark(table.tableName, pkValue, clickedColumnName);
                                    cell.removeAttribute('data-bookmarked');
                                }
                            },
                        });
                    } else {
                        const cellValue = table.getCellValueAt(position.row, columnIndex + table.dataColumnOffset());
                        menuItems.push({
                            label: 'ブックマークに追加',
                            action: () => {
                                table.addBookmark(table.tableName, pkValue, clickedColumnName, cellValue);
                                cell.setAttribute('data-bookmarked', '');
                            },
                        });
                    }
                }
            }
            table.contextMenu.show(e.clientX, e.clientY, menuItems);
        });
        // renderAsHtml を考慮してセル値を設定する（初期レンダリング時にHTML描画を正しく適用）
        // value の実際の型は string のみ（body.values は string[]、バッファ行は '' を渡す）
        const strValue = value as string;
        // バッファ空行挿入時等で columnIndex がヘッダー範囲外になる場合は false（テキスト描画）でフォールバック
        const cellCol = table.tableData.header[columnIndex];
        table.reference.applyTextOrHtml(cell, strValue, cellCol ? cellCol.renderAsHtml : false);
        // データ型に基づいたスタイル適用（bool型チェックマーク、数値型右寄せ）
        table.reference.applyTypedCellStyle(cell, strValue, columnIndex);
        return cell;
    }

    public static getCellPosition(cell: HTMLElement, tableElement: HTMLElement): CellPosition | null {
        const rowElement = cell.parentElement;
        if (!rowElement) return null;
        // 行インデックスの取得: ヘッダー行は常に children[0]。
        // データ行はバーチャルスクロールにより children のインデックスが論理インデックスとずれるため、
        // 行要素または行ヘッダーの data-row-index 属性（renumberRowsFrom で設定される 0始まりの
        // データ行インデックス）から算出する。固定行 clone は行要素自身が data-row-index を持つ。
        // ヘッダー行は data-row-index を持たないため children インデックスを使う。
        let row: number = -1;
        if (rowElement.classList.contains('editor-table-column-header-row')
            || rowElement.classList.contains('editor-table-source-column-header-row')) {
            row = 0;
        } else if (rowElement.dataset.rowIndex !== undefined) {
            // data-row-index は 0始まりのデータ行インデックス。DOM行インデックスは +1（ヘッダー行分）。
            row = Number(rowElement.dataset.rowIndex) + 1;
        } else {
            const rowHeader = rowElement.querySelector('.editor-table-row-header') as HTMLElement | null;
            if (rowHeader && rowHeader.dataset.rowIndex !== undefined) {
                // data-row-index は 0始まりのデータ行インデックス。DOM行インデックスは +1（ヘッダー行分）。
                row = Number(rowHeader.dataset.rowIndex) + 1;
            } else {
                // ヘッダー行または data-row-index がない行: children のインデックスで探索する
                for (let i = 0; i < tableElement.children.length; ++i) {
                    if (tableElement.children[i] === rowElement) {
                        row = i;
                        break;
                    }
                }
            }
        }
        if (row === -1) return null;
        const dataColText = cell.dataset.col;
        if (dataColText !== undefined) {
            const dataColumn = Number(dataColText);
            if (!Number.isNaN(dataColumn)) {
                const dataColumnOffset = tableElement.classList.contains('editor-table--blame-visible') ? 2 : 1;
                return { row, column: dataColumnOffset + dataColumn };
            }
        }
        let column: number = -1;
        for (let i = 0; i < rowElement.children.length; ++i) {
            if (rowElement.children[i] === cell) {
                column = i;
                break;
            }
        }
        if (column === -1) return null;
        return {row, column};
    }

    /**
     * セルの値を取得する（参照ヒントを除外）
     * renderAsHtml モードのセルや bool型セル（SVG表示）は innerHTML/textContent から直接値を取れないため、
     * data-raw-value に保存した生テキストを返す。
     */
    static getCellValue(cell: HTMLElement): string {
        // renderAsHtml モードおよび bool型セルは data-raw-value に生テキストが保存されている
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
     * 選択範囲のセルにクラスを付与する（Selection から呼ばれる）。
     * 前回付与したクラスを除去してから新しいクラスを付与する。
     * フォーカスセルには sel-bg を付与しない（Excel同様に白背景で表示）。
     *
     * @param range 正規化済みの選択範囲（startRow <= endRow, startColumn <= endColumn）
     * @param focusRow フォーカスセルのDOM行インデックス
     * @param focusCol フォーカスセルのDOM列インデックス
     */
    applySelectionClasses(range: CellRange, focusRow: number, focusCol: number): void {
        // 前回のクラスを除去する
        for (const entry of this.lastSelectionCells) {
            const cell = this.getCellOrNull(entry.row, entry.col);
            if (cell !== null) cell.classList.remove(...entry.classes);
        }
        this.lastSelectionCells = [];

        const { startRow, startColumn, endRow, endColumn } = range;

        // 選択範囲内のセルにクラスを付与する
        for (let row = startRow; row <= endRow; row++) {
            for (let col = startColumn; col <= endColumn; col++) {
                const cell = this.getCellOrNull(row, col);
                if (cell === null) continue;
                const classes: string[] = [];
                // フォーカスセル以外に背景色を付与
                if (row !== focusRow || col !== focusCol) classes.push('sel-bg');
                if (row === startRow) classes.push('sel-top');
                if (row === endRow) classes.push('sel-bottom');
                if (col === startColumn) classes.push('sel-left');
                if (col === endColumn) classes.push('sel-right');
                if (classes.length > 0) {
                    cell.classList.add(...classes);
                    this.lastSelectionCells.push({ row, col, classes });
                }
            }
        }

        // 隣接セルのボーダーを透明にする（灰色セルボーダーが青枠を隠す問題を解消）
        // 上辺: 1つ上の行のセルの border-bottom を透明にする
        if (startRow > 0) {
            for (let col = startColumn; col <= endColumn; col++) {
                const cell = this.getCellOrNull(startRow - 1, col);
                if (cell === null) continue;
                cell.classList.add('sel-adj-bottom');
                this.lastSelectionCells.push({ row: startRow - 1, col, classes: ['sel-adj-bottom'] });
            }
        }
        // 左辺: 1つ左の列のセルの border-right を透明にする
        if (startColumn > 0) {
            for (let row = startRow; row <= endRow; row++) {
                const cell = this.getCellOrNull(row, startColumn - 1);
                if (cell === null) continue;
                cell.classList.add('sel-adj-right');
                this.lastSelectionCells.push({ row, col: startColumn - 1, classes: ['sel-adj-right'] });
            }
        }
    }

    /**
     * コピー範囲のセルにクラスを付与する（Selection から呼ばれる）。
     * 前回付与したクラスを除去してから新しいクラスを付与する。
     *
     * @param range 正規化済みのコピー範囲
     */
    applyCopyClasses(range: CellRange): void {
        // 前回のクラスを除去する
        for (const entry of this.lastCopyCells) {
            const cell = this.getCellOrNull(entry.row, entry.col);
            if (cell !== null) cell.classList.remove(...entry.classes);
        }
        this.lastCopyCells = [];

        const { startRow, startColumn, endRow, endColumn } = range;
        for (let row = startRow; row <= endRow; row++) {
            for (let col = startColumn; col <= endColumn; col++) {
                const cell = this.getCellOrNull(row, col);
                if (cell === null) continue;
                const classes: string[] = [];
                if (row === startRow) classes.push('copy-top');
                if (row === endRow) classes.push('copy-bottom');
                if (col === startColumn) classes.push('copy-left');
                if (col === endColumn) classes.push('copy-right');
                if (classes.length > 0) {
                    cell.classList.add(...classes);
                    this.lastCopyCells.push({ row, col, classes });
                }
            }
        }
    }

    /**
     * 選択クラスを全セルから除去する（Selection.hideRenderer() から呼ばれる）。
     */
    clearSelectionClasses(): void {
        for (const entry of this.lastSelectionCells) {
            const cell = this.getCellOrNull(entry.row, entry.col);
            if (cell !== null) cell.classList.remove(...entry.classes);
        }
        this.lastSelectionCells = [];
    }

    /**
     * コピークラスを全セルから除去する（Selection.hideCopyBorder() から呼ばれる）。
     */
    clearCopyClasses(): void {
        for (const entry of this.lastCopyCells) {
            const cell = this.getCellOrNull(entry.row, entry.col);
            if (cell !== null) cell.classList.remove(...entry.classes);
        }
        this.lastCopyCells = [];
    }

    /**
     * ValidationPanel を接続する（Tab.createEditorTable 内から呼ばれる）。
     * セッター禁止のため connectXxx パターンで相互参照を構築する。
     */
    connectValidationPanel(panel: ValidationPanel): void {
        this.validationPanel = panel;
    }

    /**
     * ScrollbarMarkerTrack を接続する（Tab.createEditorTable 内から呼ばれる）。
     * ミニテーブルでは呼ばない（マーカートラックは左ペインの通常テーブル専用）。
     */
    connectScrollbarMarkerTrack(track: ScrollbarMarkerTrack): void {
        this.scrollbarMarkerTrack = track;
        // 接続前にデータが蓄積されている場合に即座にマーカーを描画する
        this.refreshScrollbarMarkers();
    }

    getScrollLeft(): number {
        return this.scrollContainer.scrollLeft;
    }

    getScrollTop(): number {
        return this.scrollContainer.scrollTop;
    }

    getScrollMetrics(): { scrollTop: number; scrollLeft: number; scrollHeight: number; scrollWidth: number; clientHeight: number; clientWidth: number } {
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

    usesInternalScrollLayout(): boolean {
        return this.usesInternalMainViewport;
    }

    scrollByInput(deltaTopPx: number, deltaLeftPx: number): void {
        if (deltaTopPx === 0 && deltaLeftPx === 0) return;
        this.scrollContainer.scrollTop += deltaTopPx;
        this.scrollContainer.scrollLeft += deltaLeftPx;
        this.syncScrollBoundVisuals();
    }

    restoreScrollPosition(scrollTop: number, scrollLeft: number): void {
        this.scrollContainer.scrollTop = scrollTop;
        this.scrollContainer.scrollLeft = scrollLeft;
        this.syncScrollBoundVisuals();
        this.emitScrollMetricsChanged();
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
    private clearAllFreezeStyles(): void {
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
        let left = this.getDetachedPrefixWidthPx();
        for (let dataColumnIdx = 0; dataColumnIdx < this.frozenColumnCount; dataColumnIdx++) {
            left += this.getColumnLayoutWidthPx(dataColumnIdx);
        }
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
        let left = this.usesInternalMainViewport ? 0 : this.getDetachedPrefixWidthPx();
        const startIndex = this.usesInternalMainViewport ? this.frozenColumnCount : 0;
        for (let index = startIndex; index < dataColumnIndex; index++) {
            left += this.getColumnLayoutWidthPx(index);
        }
        const width = this.getColumnLayoutWidthPx(dataColumnIndex);
        return { left, right: left + width };
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

    /**
     * ヘッダーの選択状態を更新する
     */
    updateHeaderSelection(startRow: number, startColumn: number, endRow: number, endColumn: number): void {
        this.applyHeaderSelection(startRow, startColumn, endRow, endColumn, true);
    }

    /**
     * 仮想スクロールの純スクロール時に、静的 detached layer の全同期を避けつつ
     * source DOM 側の行・列ヘッダー選択状態だけを更新する。
     */
    updateHeaderSelectionForVirtualScroll(startRow: number, startColumn: number, endRow: number, endColumn: number): void {
        this.applyHeaderSelection(startRow, startColumn, endRow, endColumn, false);
    }

    private applyHeaderSelection(startRow: number, startColumn: number, endRow: number, endColumn: number, syncDetachedLayers: boolean): void {
        const columnHeaderRow = this.gridElement.children[0] as HTMLElement;
        // すべての列ヘッダーから選択状態を解除
        for (let i = 1; i < columnHeaderRow.children.length; i++) {
            const headerCell = columnHeaderRow.children[i] as HTMLElement;
            headerCell.classList.remove('selected');
        }
        // すべての行ヘッダーから選択状態を解除する。
        // DOM子要素を直接走査する（仮想スクロール時は論理インデックスとDOMインデックスが一致しないため）。
        // bottomSpacer は行ヘッダーを持たないためデータ行終了位置まで走査する。
        const dataRowEnd = this.getDataRowEndChildIndex();
        for (let i = 1; i < dataRowEnd; i++) {
            if (this.virtualScroll.isSpacerIndex(i)) continue;
            const row = this.gridElement.children[i] as HTMLElement;
            const rowHeader = row.querySelector('.editor-table-row-header') as HTMLElement | null;
            if (rowHeader) rowHeader.classList.remove('selected');
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
            const rowElement = this.getRowElement(row);
            if (rowElement) {
                const rowHeader = rowElement.querySelector('.editor-table-row-header') as HTMLElement | null;
                if (rowHeader) rowHeader.classList.add('selected');
            }
        }
        if (!syncDetachedLayers) return;
        if (this.usesInternalMainViewport) {
            this.syncQuadrantStaticCellStates();
            return;
        }
        this.syncDetachedLegacyStaticCellStates();
        this.syncDetachedViewportRowHeaderStates();
    }

    /**
     * ストアからセルデータを再読み込みし、DOMの行数・セル値をストアに完全同期する。
     * タブ切替時に呼び出され、他タブ（またはミニテーブル）でストアが変更された結果を反映する。
     *
     * 通常テーブルでは、まずDOMの行数をストアの行数に合わせて増減し storeRowIndices を [0..n-1] に更新する。
     * ミニテーブルはフィルタ条件を持つため DOM 行数同期は行わず、セル値の更新のみ行う。
     */
    reloadCellsFromStore(): void {
        // blameはgit committed dataのため、ストアからの全面リロードで陳腐化する
        this.hideBlameIfVisible();
        const storeRows = this.store.getRows(this.tableName);
        if (storeRows === false) return;

        // DOM列インデックス → ストア列インデックスのマッピングを columnMapping から構築する。
        const domColumnCount = this.getColumnCount();
        const storeColumnIndices = this.tableData.columnMapping.slice(0, domColumnCount);

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
                    const existingRow = this.getRowElement(domRowIndex);
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
                        const insertTarget = this.getRowElement(domRowIndex);
                        if (insertTarget) {
                            this.gridElement.insertBefore(newRow, insertTarget);
                            // DOM行が挿入されたため renderedEnd を同期する
                            this.virtualScroll.notifyRowAppended();
                        } else {
                            // bottomSpacerの手前に挿入する（enabled=false なら通常の appendChild）
                            this.virtualScroll.appendDataRow(newRow);
                            // 新しい行がDOMに追加されたため renderedEnd を同期する
                            this.virtualScroll.notifyRowAppended();
                        }
                    }
                    this.storeRowIndices.push(i);
                }
                domRowCountChanged = true;
            } else if (storeRows.length < currentDataRowCount) {
                // ストアの方が少ない: 末尾のデータ行をDOMから除去する（バッファ空行は維持する）
                for (let i = currentDataRowCount - 1; i >= storeRows.length; i--) {
                    const domRowIndex = i + 1; // 列ヘッダー行を含む DOM インデックス
                    const rowToRemove = this.getRowElement(domRowIndex);
                    // 通常テーブルで削除対象がnullまたはバッファ空行である場合は設計上の不整合
                    if (!rowToRemove || rowToRemove.classList.contains('editor-table-empty-row')) {
                        throw new Error('[EditorTable.reloadCellsFromStore] DOM行とストアの不整合: 削除対象行が存在しないか空行です。 domRowIndex=' + domRowIndex);
                    }
                    rowToRemove.remove();
                    // DOM行が削除されたため renderedEnd を同期する
                    this.virtualScroll.notifyRowRemoved();
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
        // DOM行数が変化した場合にバーチャルスクロールの総行数を同期する。
        if (domRowCountChanged) {
            // getRowCount() は仮想スクロール時にDOM行数しか返さないため、
            // 論理的な総行数（storeRowIndices + バッファ1行）を使う。
            this.virtualScroll.updateTotalRowCount(this.storeRowIndices.length + 1);
        }

        // storeRowIndices[domDataRow] → storeRow のマッピングで各DOMデータ行のセル値を更新する。
        // 通常テーブルは上記の同期後に storeRowIndices[i]=i が保証される。
        // ミニテーブルは filteredRows のストアインデックスを正しく参照できる。
        for (let domDataRow = 0; domDataRow < this.storeRowIndices.length; domDataRow++) {
            const domRow = domDataRow + 1; // DOMは1始まり（列ヘッダー行がある）
            const storeRowIndex = this.storeRowIndices[domDataRow];
            if (storeRowIndex < 0 || storeRowIndex >= storeRows.length) continue;
            const rowElement = this.getRowElement(domRow);
            if (rowElement === null) continue;
            const storeRowData = storeRows[storeRowIndex];

            for (let domCol = 0; domCol < domColumnCount; domCol++) {
                const storeColIdx = storeColumnIndices[domCol];
                if (storeColIdx === -1) continue;
                const storeValue = storeColIdx < storeRowData.length ? storeRowData[storeColIdx] : '';
                const cell = rowElement.children[domCol + this.dataColumnOffset()] as HTMLElement | null;
                if (cell === null) continue;
                this.reference.setCellValue(cell, storeValue, domCol, domRow);
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
        // セル再作成パス（ソート・行操作等）で消失した data-bookmarked 属性を復元する
        this.restoreBookmarkMarks();
        this.refreshFreezeVisualState();
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
            const domRow = this.getRowElement(i + 1);
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
            const domRow = this.getRowElement(i + 1);
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
        return domDataRowIndex >= this.getFilteredDataRowCount();
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
        // バーチャルスクロールでバッファ行がDOM外（表示範囲外）に存在する場合はスキップする。
        // バッファ行はフィルター後のデータ行の直後に位置する。
        // 表示範囲終端がバッファ行位置より手前にある場合、バッファ行はDOM外に存在するが
        // 論理的には存在し続けるため、重複追加してはならない。
        // 非仮想スクロール時は renderedEnd が全行をカバーするためこの条件は成立しない。
        const bufferDataRowIndex = this.getFilteredDataRowCount();
        const rendered = this.virtualScroll.getRenderedRange();
        if (rendered.end < bufferDataRowIndex) return;

        // 列ヘッダー行を除いたデータ行の総数（ストア行 + 既存バッファ行。スペーサー行は除外済み）
        const totalDataRows = this.getRowCount() - 1;
        // 末尾のDOM行がバッファ行かどうかを確認する（children[0]は列ヘッダーなので+1オフセット）
        if (totalDataRows > 0) {
            const lastRow = this.getRowElement(totalDataRows);
            if (lastRow && lastRow.classList.contains('editor-table-empty-row')) return;
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
        // bottomSpacerの手前に挿入する（enabled=false なら通常の appendChild）
        this.virtualScroll.appendDataRow(row);
        // 新しい行がDOMに追加されたため renderedEnd を同期する（dataRowToDomIndex のインデックス変換に必要）
        this.virtualScroll.notifyRowAppended();
        // バッファ行追加によりデータ行総数が変化したため、バーチャルスクロールの総行数を更新する。
        this.virtualScroll.updateTotalRowCount(this.getFilteredDataRowCount() + 1);
        // 行追加後に行ヘッダーの番号（data-row属性・行番号テキスト）を振り直す
        this.structure.renumberRowsFrom(0);
        // FK列を持つ場合に新バッファ行へ参照ヒント（ドロップダウン等）を適用する
        // データ行の children 開始オフセット（ヘッダー行 + topSpacer 分）を考慮する
        const newDomRow = newRowIndex + this.getDataRowChildOffset();
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
        // getRowCount() はスペーサー行を除外した値を返すため安全にループできる
        const toRemove: HTMLElement[] = [];
        let bufferRowCount = 0;
        const rowCount = this.getRowCount();
        for (let i = rowCount - 1; i >= 1; i--) {
            const row = this.getRowElement(i);
            if (!row || !row.classList.contains('editor-table-empty-row')) break;
            bufferRowCount++;
            // 2行目以降の余分なバッファ行を削除対象に追加する（末尾の1行は残す）
            if (bufferRowCount > 1) toRemove.push(row);
        }
        for (const row of toRemove) {
            this.gridElement.removeChild(row);
            // DOM行が削除されたため renderedEnd を同期する
            this.virtualScroll.notifyRowRemoved();
        }
        // バッファ行削除によりデータ行総数が変化したため、バーチャルスクロールの総行数を更新する
        if (toRemove.length > 0) this.virtualScroll.updateTotalRowCount(this.getRowCount() - 1);
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
     * スキーマJSONから読み込んだソートキーを復元する。
     * tab.ts の createTabState() からテーブルオープン時に呼ばれる。
     * saveSchemaDataAsync は呼ばない（復元時の保存は不要）。
     */
    restoreSortState(serializedSortKeys: SerializedSortKey[]): void {
        const newIndices = this.columnSorter.restoreSortKeys(serializedSortKeys, this.storeRowIndices);
        if (newIndices === this.storeRowIndices) return; // 復元するソートキーがなかった
        this.storeRowIndices = newIndices;
        this.rearrangeDomRowsByStoreIndices(newIndices);
        this.structure.renumberRowsFrom(1);
        this.selection.updateRendererAfterResize();
        this.updateAllSortIndicators();
    }

    /**
     * スキーマJSONから読み込んだフィルター状態を復元する。
     * tab.ts の createTabState() からテーブルオープン時に呼ばれる。
     * saveSchemaDataAsync は呼ばない（復元時の保存は不要）。
     */
    restoreFilterState(serializedFilters: SerializedFilters): void {
        const storeColumnNames = this.store.getHeader(this.tableName);
        if (storeColumnNames === false) return;
        this.columnFilter.restoreFilters(serializedFilters, storeColumnNames);
        if (this.columnFilter.hasActiveFilter()) this.applyFilterDisplay();
    }

    /**
     * 指定列のソートをトグルし、DOMの行順を更新する。
     * ソートはView変換のみ（ストア順序は変えない）。
     * ミニテーブルでは呼ばれない（ソートインジケーターが存在しないため）。
     *
     * ソート前後のシリアライズ済みソートキーを SortCommand に記録し、
     * History に pushCommand で履歴に積む（Undo/Redo対応）。
     *
     * @param columnIndex DOMの列インデックス（0始まり、行ヘッダーなし）
     */
    applySortForColumn(columnIndex: number): void {
        // blameはgit committed dataのため、ソートによるDOM行並び替えで陳腐化する
        this.hideBlameIfVisible();
        // ソート前の状態を記録する（Undo時に復元するため）
        const oldSortKeys = this.columnSorter.serializeSortKeys();
        // ColumnSorterにソートを委譲して新しいstoreRowIndicesを取得する
        const newIndices = this.columnSorter.toggleSort(columnIndex, this.storeRowIndices);
        this.storeRowIndices = newIndices;
        // ソート後の状態を記録する
        const newSortKeys = this.columnSorter.serializeSortKeys();

        // DOM行の並び替え
        this.rearrangeDomRowsByStoreIndices(newIndices);

        // 並び替え後に全データ行の data-row 属性・行ヘッダーテキスト・リサイズハンドルを再設定する
        this.structure.renumberRowsFrom(1);
        // DOM行順序が変わったため選択オーバーレイの描画位置を再計算する
        this.selection.updateRendererAfterResize();
        // 全列ヘッダーのソートインジケーターを更新する
        this.updateAllSortIndicators();
        // ソート後もフィルター状態を維持する（フィルター適用中の場合は表示/非表示を再計算する）
        this.refreshFilterDisplayIfActive();

        // ソート状態をスキーマJSONに永続化する（fire-and-forget）
        saveSchemaDataAsync(this);

        // SortCommand を履歴に積む（既に実行済みのため pushCommand を使う）
        const command = new SortCommand(this, oldSortKeys, newSortKeys);
        const anchor = this.selection.getAnchor();
        const copyRange = this.selection.getCopyRange();
        const range = {startRow: anchor.row, startColumn: anchor.column, endRow: anchor.row, endColumn: anchor.column};
        this.history.pushCommand(command, range, copyRange);
    }

    /**
     * シリアライズ済みソートキーからソート状態を適用する（SortCommand の execute/undo 用）。
     *
     * restoreSortState() はタブ復元専用（saveSchemaDataAsync を呼ばない）であるのに対し、
     * このメソッドはコマンドの undo/redo から呼ばれ、saveSchemaDataAsync も呼ぶ。
     */
    applySortState(sortKeys: SerializedSortKey[]): void {
        // blameはgit committed dataのため、ソート変更でDOM行並び替えが発生し陳腐化する
        this.hideBlameIfVisible();
        // 既存のソート状態をリセットしてから復元する
        this.columnSorter.clearAllSorts();
        if (sortKeys.length > 0) {
            // ソートキーを復元して新しい storeRowIndices を取得する
            const newIndices = this.columnSorter.restoreSortKeys(sortKeys, this.storeRowIndices);
            this.storeRowIndices = newIndices;
            this.rearrangeDomRowsByStoreIndices(newIndices);
        } else {
            // ソート解除: storeRowIndices を元の順序（0, 1, 2, ...）に戻す
            const naturalOrder: number[] = [];
            for (let i = 0; i < this.storeRowIndices.length; i++) naturalOrder.push(i);
            this.storeRowIndices = naturalOrder;
            this.rearrangeDomRowsByStoreIndices(naturalOrder);
        }
        this.structure.renumberRowsFrom(1);
        this.selection.updateRendererAfterResize();
        this.updateAllSortIndicators();
        this.refreshFilterDisplayIfActive();
        // ソート状態をスキーマJSONに永続化する（fire-and-forget）
        saveSchemaDataAsync(this);
    }

    /**
     * シリアライズ済みフィルターからフィルター状態を適用する（FilterCommand の execute/undo 用）。
     *
     * restoreFilterState() はタブ復元専用（saveSchemaDataAsync を呼ばない）であるのに対し、
     * このメソッドはコマンドの undo/redo から呼ばれ、saveSchemaDataAsync も呼ぶ。
     */
    applyFilterState(filters: SerializedFilters): void {
        const storeColumnNames = this.store.getHeader(this.tableName);
        if (storeColumnNames === false) return;
        // 既存のフィルター状態をリセットしてから復元する
        this.columnFilter.clearAllFilters();
        const hasFilters = Object.keys(filters).length > 0;
        if (hasFilters) {
            this.columnFilter.restoreFilters(filters, storeColumnNames);
        }
        // フィルター有無に関わらず applyFilterDisplay() を呼ぶ
        // （フィルター解除時に全行を再表示し、行数カウンターを非表示にするため）
        this.applyFilterDisplay();
        // フィルター状態をスキーマJSONに永続化する（fire-and-forget）
        saveSchemaDataAsync(this);
    }

    /**
     * FilterDropdown からフィルター変更をコマンドとして履歴に積む。
     * FilterDropdown は History を直接参照しないため、このメソッドを経由する（デメテルの法則）。
     *
     * @param oldFilters フィルター変更前のシリアライズ済みフィルター
     * @param newFilters フィルター変更後のシリアライズ済みフィルター
     */
    pushFilterCommand(oldFilters: SerializedFilters, newFilters: SerializedFilters): void {
        const command = new FilterCommand(this, oldFilters, newFilters);
        const anchor = this.selection.getAnchor();
        const copyRange = this.selection.getCopyRange();
        const range = {startRow: anchor.row, startColumn: anchor.column, endRow: anchor.row, endColumn: anchor.column};
        this.history.pushCommand(command, range, copyRange);
    }

    /**
     * storeRowIndices の順序に従って DOM のデータ行を並び替える。
     * applySortForColumn / applySortState から共通で使われる。
     */
    private rearrangeDomRowsByStoreIndices(indices: number[]): void {
        // バーチャルスクロール有効時: DOM上にはビューポート分の行しか存在しないため
        // DOM要素の物理的な並び替えは不可能。storeRowIndices は呼び出し元で更新済みなので、
        // 全行を破棄して renderRowForVirtualScroll 経由で再レンダリングする。
        const range = this.virtualScroll.getRenderedRange();
        if (range.end - range.start < indices.length) {
            console.log(`[VirtualScroll] rearrangeDomRows: 仮想スクロール有効のため全行再レンダリング (DOM=${range.end - range.start}行, 全体=${indices.length}行)`);
            this.virtualScroll.forceFullRerender();
            return;
        }
        // ミニテーブル・非仮想スクロール時: 全行がDOMに存在するため従来の並び替え
        // data-store-index 属性を使ってストアインデックス → DOM行要素のマップを構築する
        const storeIndexToRowElement = new Map<number, HTMLElement>();
        const totalRows = this.getRowCount();
        for (let domIdx = 1; domIdx < totalRows; domIdx++) {
            const row = this.getRowElement(domIdx);
            if (!row) continue;
            if (row.classList.contains('editor-table-empty-row')) continue;
            if (!row.hasAttribute('data-store-index')) continue;
            storeIndexToRowElement.set(Number(row.dataset.storeIndex), row);
        }
        // バッファ行の先頭要素を取得しておく（insertBefore の基準点として使用）
        const firstEmptyRow = this.gridElement.querySelector('.editor-table-empty-row');
        // indices の順序でデータ行を親に再挿入する（insertBefore でバッファ行の前に配置）
        for (const storeIdx of indices) {
            const row = storeIndexToRowElement.get(storeIdx);
            if (!row) throw new Error('[EditorTable.rearrangeDomRowsByStoreIndices] storeIdx に対応するDOM行が存在しません: ' + storeIdx);
            if (firstEmptyRow) {
                this.gridElement.insertBefore(row, firstEmptyRow);
            } else {
                // bottomSpacerの手前に挿入する（enabled=false なら通常の appendChild）
                this.virtualScroll.appendDataRow(row);
            }
        }
    }

    /**
     * 現在の ColumnFilter 状態に基づいてデータ行の表示を制御する。
     *
     * 仮想スクロール有効時: filteredRowIndices を更新して forceFullRerender() で再描画する。
     *   DOM に存在しない行に display=none を適用できないため、filteredRowIndices で
     *   レンダリング対象を制限し、totalRowCount をフィルター後の行数に更新する。
     *
     * 仮想スクロール無効時（ミニテーブル）: 従来通り display=none で行を制御する。
     *
     * FilterDropdown の適用・クリア時と、ソート変更時・行挿入削除時に呼ばれる。
     */
    applyFilterDisplay(): void {
        const storeRows = this.store.getRows(this.tableName);
        if (storeRows === false) return;

        const isVirtualScrollActive = !this.isMiniTable;

        // フィルター未適用時
        if (!this.columnFilter.hasActiveFilter()) {
            // filteredRowIndices を空配列にリセットする（フィルター未適用状態）
            this.filteredRowIndices = [];
            if (isVirtualScrollActive) {
                // 仮想スクロール: totalRowCount を全行数+バッファ行に戻して再描画
                this.virtualScroll.updateTotalRowCount(this.storeRowIndices.length + 1);
                this.virtualScroll.forceFullRerender();
            } else {
                // ミニテーブル: 従来通り display を復元
                for (let domDataRow = 0; domDataRow < this.storeRowIndices.length; domDataRow++) {
                    const rowEl = this.getRowElement(domDataRow + 1);
                    if (rowEl) rowEl.style.display = '';
                }
            }
            this.updateFilterActiveClasses();
            this.filterRowCountElement.style.display = 'none';
            this.selection.updateRendererAfterResize();
            this.refreshFreezeVisualState();
            return;
        }

        // フィルター条件に一致するストアインデックスのセットを構築する
        const filteredStoreIndices = this.columnFilter.computeFilteredIndices(this.storeRowIndices, storeRows);
        const filteredSet = new Set(filteredStoreIndices);
        const totalCount = this.storeRowIndices.length;

        // filteredRowIndices を構築: storeRowIndices 上のインデックスのうちフィルタ条件を満たすもの
        this.filteredRowIndices = [];
        for (let i = 0; i < this.storeRowIndices.length; i++) {
            if (filteredSet.has(this.storeRowIndices[i])) {
                this.filteredRowIndices.push(i);
            }
        }
        const visibleCount = this.filteredRowIndices.length;

        if (isVirtualScrollActive) {
            // 仮想スクロール: totalRowCount をフィルター後の行数+バッファ1行に更新して全行再描画
            this.virtualScroll.updateTotalRowCount(visibleCount + 1);
            // フィルター前の scrollTop がフィルター後のコンテンツ高さを超えている場合、
            // recalculateCore() で firstVisibleRow > totalRowCount となり何も描画されなくなる。
            // forceFullRerender() の前に scrollTop を先頭にリセットする。
            this.virtualScroll.resetScrollTop();
            this.virtualScroll.forceFullRerender();
        } else {
            // ミニテーブル: 従来通り display で行を制御する（全行がDOMに存在するため）
            for (let domDataRow = 0; domDataRow < this.storeRowIndices.length; domDataRow++) {
                const storeRowIndex = this.storeRowIndices[domDataRow];
                const domRow = this.getRowElement(domDataRow + 1);
                if (!domRow) continue;
                if (filteredSet.has(storeRowIndex)) {
                    domRow.style.display = '';
                } else {
                    domRow.style.display = 'none';
                }
            }
        }

        // フィルターアクティブクラスをヘッダーセルに付与/除去する
        this.updateFilterActiveClasses();

        // 行数カウンターを更新する
        this.filterRowCountElement.textContent = `${visibleCount} / ${totalCount} 行`;
        this.filterRowCountElement.style.display = 'block';

        // フィルター適用後の行数内に selection をクランプする
        // focus.row がフィルター後の行数を超えている場合、scrollFocusIntoView() が
        // 無効な行位置でスクロール計算を行い画面が異常な位置に飛ぶ
        this.clampSelectionToFilteredRange();

        // 行の display 変更後に選択オーバーレイの描画位置を再計算する（非表示行にまたがる選択を解消）
        this.selection.updateRendererAfterResize();
        this.refreshFreezeVisualState();
    }

    /**
     * フィルター適用/解除後に selection の focus/range がフィルター後の行数内に収まるようクランプする。
     * focus.row がフィルター後のデータ行数を超えている場合、先頭データ行（row=1）にリセットする。
     * selection.start() は scrollFocusIntoView() を呼ぶため使わない。
     * scrollFocusIntoView() が forceFullRerender() 直後のレイアウト確定前に呼ばれると
     * getBoundingClientRect() が不正な値を返し、スクロールが異常な位置に飛ぶ。
     */
    private clampSelectionToFilteredRange(): void {
        const maxRow = this.getFilteredDataRowCount();
        // focus/range を直接クランプする。scrollFocusIntoView は呼ばない。
        // 後続の updateRendererAfterResize() で選択オーバーレイの描画位置が再計算される。
        this.selection.clampToFilteredRowCount(maxRow);
    }

    /**
     * 全列ヘッダーのフィルタークラス（.filter-active）を現在のフィルター状態に合わせて更新する。
     * ColumnFilter はストア列インデックスで管理しているため、DOM列インデックスを変換してから参照する。
     */
    private updateFilterActiveClasses(): void {
        const headerRow = this.gridElement.children[0];
        const columnCount = this.getColumnCount();
        for (let colIdx = 0; colIdx < columnCount; colIdx++) {
            const headerCell = headerRow.children[colIdx + this.dataColumnOffset()] as HTMLElement;
            const storeColIdx = this.getStoreColumnIndex(colIdx);
            if (storeColIdx !== -1 && this.columnFilter.isColumnFiltered(storeColIdx)) {
                headerCell.classList.add('filter-active');
            } else {
                headerCell.classList.remove('filter-active');
            }
        }
        this.refreshDetachedHeaderLayout();
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
        const headerRow = this.gridElement.children[0];
        const columnCount = this.getColumnCount();
        const totalSortKeyCount = this.columnSorter.getSortKeyCount();
        for (let colIdx = 0; colIdx < columnCount; colIdx++) {
            const headerCell = headerRow.children[colIdx + this.dataColumnOffset()] as HTMLElement;
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
        this.refreshDetachedHeaderLayout();
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
        // フィルター適用時は論理行インデックスのため resolveStoreRowIndex で変換する
        const domDataRowIndex = rowIndex - 1;
        const storeRowIndex = this.resolveStoreRowIndex(domDataRowIndex);
        // 照合失敗（-1）の場合はストア更新不可。DOM更新は継続する。
        const canUpdateStore = storeRowIndex >= 0;
        for (const entry of this.autoFillEntries) {
            const colCount = this.getColumnCount();
            for (let c = 0; c < colCount; c++) {
                if (this.getColumnHeaderValue(c) !== entry.columnName) continue;
                // DOMセルを更新（参照ヒント適用のためreference.setCellValueAt()を使用）
                this.reference.setCellValueAt(rowIndex, c + this.dataColumnOffset(), entry.value);
                // ストアをインデックスベースで更新（PK未入力でも動作する）
                if (canUpdateStore) {
                    const storeColIndex = this.getStoreColumnIndex(c);
                    if (storeColIndex !== -1) this.store.updateCellValueByRowIndex(this.tableName, storeRowIndex, storeColIndex, entry.value);
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

    /**
     * メインテーブル専用: Ctrl+クリックまたはF12でFK列の参照先テーブルをタブで開く。
     * RelationsPanelが非表示の場合のみ動作する（表示中はRelationsPanelで参照できるため不要）。
     * 単純参照（"table.column"形式）と動的参照（二段リスト）の両方に対応する。
     * @returns ナビゲーションが実行された場合 true
     */
    navigateToReferenceTable(row: number, column: number): boolean {
        if (this.tab === false) return false;
        // RelationsPanelが表示中なら何もしない
        if (this.tab.editor.isRelationsPanelVisible()) return false;
        const dataColumnIndex = column - this.dataColumnOffset();
        if (dataColumnIndex < 0 || dataColumnIndex >= this.tableData.header.length) return false;
        const reference = this.tableData.header[dataColumnIndex].reference;
        if (reference === null) return false;
        const expr = parseReferenceExpression(reference);
        const cellValue = this.getCellValueAt(row, column);
        if (cellValue === '') return false;
        if (isSimpleReference(expr)) {
            // 単純参照: 参照先テーブルの参照列の値で行を検索し、その列にフォーカスする
            // 例: shop.shop_product_group_id(=1) → shop_productテーブルで group_id=1 の行を開き group_id 列を選択
            // 順方向ジャンプではフィルタ不要のため空文字列・空Setを渡す
            this.tab.navigateToTableColumnValue(expr.tableName, expr.columnName, cellValue, '', new Set());
            return true;
        }
        if (isDynamicReference(expr)) {
            // 動的参照（二段リスト）: 中間テーブルからジャンプ先テーブル名と列名を解決する
            // 順方向ジャンプではジャンプ先が一意に解決されるためフィルタ不要
            const resolved = this.resolveDynamicReferenceTarget(row, expr);
            if (resolved === null) return false;
            this.tab.navigateToTableColumnValue(resolved.tableName, resolved.columnName, cellValue, '', new Set());
            return true;
        }
        return false;
    }

    /**
     * 動的参照の中間テーブルを検索し、ジャンプ先のテーブル名と列名を解決する。
     * 同一行の sourceMatchValue 列の値で中間テーブルを検索し、
     * destTable 列からテーブル名、destColumn 列から列名を取得する。
     */
    private resolveDynamicReferenceTarget(row: number, expr: DynamicReference): { tableName: string; columnName: string } | null {
        // 同一行の sourceMatchValue 列の値を取得する
        const valueColumnIndex = this.reference.resolveValueColumnIndex(expr.filter.valueColumn, 0);
        if (valueColumnIndex === -1) return null;
        const filterValue = this.getCellValueAt(row, valueColumnIndex + this.dataColumnOffset());
        if (filterValue === '') return null;
        // 中間テーブルの全データをキャッシュから同期取得する
        const fullData = this.referenceDataCache.getFullDataSync(expr.filter.tableName);
        if (fullData === false) return null;
        const lookupColumnIndex = fullData.header.indexOf(expr.lookupColumn);
        if (lookupColumnIndex === -1) return null;
        const targetColumnIndex = fullData.header.indexOf(expr.targetColumn);
        if (targetColumnIndex === -1) return null;
        // filterColumn の値で中間テーブルの行を検索する
        const matchedRow = this.referenceDataCache.findRowByColumn(fullData, expr.filter.filterColumn, filterValue);
        if (!matchedRow) return null;
        const tableName = matchedRow[lookupColumnIndex];
        if (tableName === '') return null;
        const columnName = matchedRow[targetColumnIndex];
        if (columnName === '') return null;
        return { tableName, columnName };
    }

    /**
     * メインテーブル専用: Ctrl+クリックまたはF12でPK列の逆参照先テーブルをタブで開く。
     * RelationsPanelが非表示の場合のみ動作する（表示中はRelationsPanelで参照できるため不要）。
     * 逆参照が1つなら直接ジャンプ、複数ならモーダルで選択させる。
     * @returns ナビゲーションが実行された（またはモーダル表示された）場合 true
     */
    navigateToReverseReferenceTable(row: number, column: number): boolean {
        if (this.tab === false) return false;
        if (this.tab.editor.isRelationsPanelVisible()) return false;
        const dataColumnIndex = column - this.dataColumnOffset();
        if (dataColumnIndex < 0 || dataColumnIndex >= this.tableData.header.length) return false;
        const colName = this.tableData.header[dataColumnIndex].name;
        if (!this.tableData.primaryKeyColumns.includes(colName)) return false;
        if (!this.hasReverseReferences()) return false;
        const pkValue = this.getRowPkValue(row);
        if (pkValue === '') return false;
        // PK値に対する逆参照エントリを収集する（parentColumnName でフィルタリング）
        const allEntries: ReverseReferenceEntry[] = [];
        for (const parentColName of this.getAllParentColumnNames()) {
            const colValue = this.getCellValueByColumnName(row, parentColName);
            if (colValue === '') continue;
            const entries = this.getReverseReferenceEntries(colValue);
            for (const entry of entries) {
                if (entry.parentColumnName === parentColName) allEntries.push(entry);
            }
        }
        if (allEntries.length === 0) return false;
        if (allEntries.length === 1) {
            const entry = allEntries[0];
            // 逆参照ジャンプ: 動的参照の場合は1段目フィルタ情報を渡して正しい行に着地させる
            this.tab.navigateToTableColumnValue(entry.childTableName, entry.childColumnName, pkValue, entry.filterColumnName, entry.filterValues);
            return true;
        }
        // 複数の逆参照: モーダルで選択させる
        const tab = this.tab;
        ReverseReferenceJumpDialog.open(allEntries, (selected) => {
            tab.navigateToTableColumnValue(selected.childTableName, selected.childColumnName, pkValue, selected.filterColumnName, selected.filterValues);
        });
        return true;
    }

    // =========================================================================
    // ブックマーク操作ファサード（デメテルの法則: sidebar を直接公開せずファサードで中継する）
    // =========================================================================

    /**
     * セルレベルでブックマークが存在するか確認する
     */
    hasBookmark(tableName: string, pkValue: string, columnName: string): boolean {
        return this.sidebar.hasBookmark(tableName, pkValue, columnName);
    }

    /**
     * 行レベルでブックマークが1件以上存在するか確認する（PK列右クリック用）
     */
    hasBookmarkForRow(tableName: string, pkValue: string): boolean {
        return this.sidebar.hasBookmarkForRow(tableName, pkValue);
    }

    /**
     * セルレベルでブックマークを追加する
     */
    addBookmark(tableName: string, pkValue: string, columnName: string, label: string): void {
        this.sidebar.addBookmark(tableName, pkValue, columnName, label);
    }

    /**
     * セルレベルでブックマークを削除する
     */
    removeBookmark(tableName: string, pkValue: string, columnName: string): void {
        this.sidebar.removeBookmark(tableName, pkValue, columnName);
    }

    /**
     * 既に開いているテーブルに対してブックマーク視覚マークを再適用する
     * 起動後に bookmarks.json を復元したタイミングなど、BookmarkPanel の内容が後から揃う経路で使用する
     */
    reapplyBookmarkMarks(): void {
        this.restoreBookmarkMarks();
    }

    /**
     * 行レベルで全ブックマークを削除する（PK列右クリック「ブックマークを解除」用）
     */
    removeBookmarksForRow(tableName: string, pkValue: string): void {
        this.sidebar.removeBookmarksForRow(tableName, pkValue);
    }

    /**
     * REFERENCESパネルに逆参照エントリを表示する（コンテキストメニュー「参照箇所を表示」用）
     */
    showReferences(pkValue: string, entries: ReverseReferenceEntry[]): void {
        this.sidebar.showReferences(pkValue, entries);
    }

    /**
     * 指定行の全データセルから data-bookmarked 属性を除去する
     * PK列右クリックの「ブックマークを解除」（行レベル一括削除）で使用する
     */
    private removeBookmarkMarksForRow(row: number): void {
        const rowElement = this.getRowElement(row);
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
    private restoreBookmarkMarks(): void {
        // ミニテーブルや差分タブではブックマーク不要
        if (this.isMiniTable) return;
        if (this.tab === false) return;
        const pkColIndex = this.tableData.primaryKeyColumns.length > 0
            ? this.tableData.header.findIndex(h => h.name === this.tableData.primaryKeyColumns[0])
            : -1;
        if (pkColIndex === -1) return;
        // DOMに存在する行のみ処理する。
        // 固定行（0〜frozenRowCount-1）は常にDOMに存在し、ビューポート行（rendered.start〜rendered.end）も
        // DOMに存在する。その間の行（frozenRowCount〜rendered.start）はDOMに存在しないためスキップする。
        const rendered = this.virtualScroll.getRenderedRange();
        const loopEnd = Math.min(this.storeRowIndices.length, rendered.end);
        for (let domDataRow = 0; domDataRow < loopEnd; domDataRow++) {
            // 固定行とビューポート行の間のギャップはDOMに存在しないためスキップする
            if (domDataRow >= this.frozenRowCount && domDataRow < rendered.start) continue;
            const domRow = domDataRow + 1;
            const pkValue = this.getCellValueAt(domRow, pkColIndex + this.dataColumnOffset());
            if (pkValue === '') continue;
            for (let domCol = 0; domCol < this.getColumnCount(); domCol++) {
                const columnName = this.tableData.header[domCol].name;
                const cell = this.getCellOrNull(domRow, domCol + this.dataColumnOffset());
                if (cell === null) continue;
                if (this.sidebar.hasBookmark(this.tableName, pkValue, columnName)) {
                    cell.setAttribute('data-bookmarked', '');
                } else {
                    cell.removeAttribute('data-bookmarked');
                }
            }
        }
    }

    private restoreBookmarkMarksForDataRowRange(startDataRowIndex: number, endDataRowIndex: number): void {
        if (this.isMiniTable) return;
        if (this.tab === false) return;
        const pkColIndex = this.tableData.primaryKeyColumns.length > 0
            ? this.tableData.header.findIndex(h => h.name === this.tableData.primaryKeyColumns[0])
            : -1;
        if (pkColIndex === -1) return;
        for (let dataRowIndex = startDataRowIndex; dataRowIndex < endDataRowIndex; dataRowIndex++) {
            const domRow = dataRowIndex + 1;
            const rowElement = this.getRowElement(domRow);
            if (rowElement === null) continue;
            const pkValue = this.getCellValueAt(domRow, pkColIndex + this.dataColumnOffset());
            if (pkValue === '') continue;
            for (let domCol = 0; domCol < this.getColumnCount(); domCol++) {
                const columnName = this.tableData.header[domCol].name;
                const cell = rowElement.children[domCol + this.dataColumnOffset()];
                if (!(cell instanceof HTMLElement)) continue;
                if (this.sidebar.hasBookmark(this.tableName, pkValue, columnName)) {
                    cell.setAttribute('data-bookmarked', '');
                } else {
                    cell.removeAttribute('data-bookmarked');
                }
            }
        }
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
        // フィルター適用時は論理行インデックスのため resolveStoreRowIndex で変換する
        if (this.tab !== false) {
            const domDataRow = rowIndex - 1;
            const storeRowIndex = this.resolveStoreRowIndex(domDataRow);
            if (storeRowIndex >= 0) {
                this.tab.emitRowSelected(this.tableName, storeRowIndex);
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
            // git差分トラッカーが未接続 or 差分なし → DOMに存在する全セルからハイライトを除去する
            // （保存後にgit statusから差分が消えたケースに対応）
            const offset = this.dataColumnOffset();
            for (let row = 1; row < rowCount; row++) {
                const rowElement = this.getRowElement(row);
                if (!rowElement) continue;
                if (rowElement.classList.contains('editor-table-empty-row')) continue;
                for (let col = offset; col < totalColCount; col++) {
                    this.getCell(row, col).classList.remove('cell-git-changed');
                }
            }
            // git変更なし → スクロールバーマーカーもクリアする
            this.currentGitChangedDomRows = new Set();
            this.refreshScrollbarMarkers();
            return;
        }
        const storeRows = this.store.getRows(this.tableName);
        if (storeRows === false) {
            // ストアデータが存在しない場合はgit変更マーカーをクリアする
            this.currentGitChangedDomRows = new Set();
            this.refreshScrollbarMarkers();
            return;
        }
        // DOM列インデックス（0始まり）→ ストア（CSV）列インデックスのマッピングを取得する。
        // 非連番keyスキーマではDOMインデックスとCSVインデックスが一致しないため変換が必須。
        const columnMapping = this.tableData.columnMapping;
        const offset2 = this.dataColumnOffset();
        // ストアベースで全データ行を走査し、git変更行・列のデータ行インデックスを収集する。
        // 仮想スクロール時はDOMに表示範囲の行しか存在しないため、DOM走査では全行を検出できない。
        // マーカー描画にはDOMに存在しない行のインデックスも必要なのでストア全行を走査する。
        const changedDataRows = new Set<number>();
        const dataRowCount = this.storeRowIndices.length;
        for (let dataRowIndex = 0; dataRowIndex < dataRowCount; dataRowIndex++) {
            const storeRowIndex = this.storeRowIndices[dataRowIndex];
            let hasChanged = false;
            for (let domColIndex = 0; domColIndex < columnMapping.length; domColIndex++) {
                const storeColIndex = columnMapping[domColIndex];
                if (storeColIndex === -1) continue;
                if (this.gitDiffTracker.isCellChanged(storeRows, storeRowIndex, storeColIndex)) {
                    if (!hasChanged) hasChanged = true;
                }
            }
            if (hasChanged) changedDataRows.add(dataRowIndex);
        }
        // DOMに存在する行にのみ cell-git-changed クラスを適用/除去する
        for (let row = 1; row < rowCount; row++) {
            const rowElement = this.getRowElement(row);
            if (!rowElement) continue;
            if (rowElement.classList.contains('editor-table-empty-row')) continue;
            if (rowElement.classList.contains('diff-row-empty')) continue;
            // フィルター適用時は論理行インデックスのため resolveStoreRowIndex で変換する
            const domDataRowIndex = row - 1;
            if (domDataRowIndex >= dataRowCount) continue;
            const storeRowIndex = this.resolveStoreRowIndex(domDataRowIndex);
            if (storeRowIndex < 0) continue;
            for (let col = offset2; col < totalColCount; col++) {
                const domColIndex = col - offset2;
                const storeColIndex = columnMapping[domColIndex];
                if (storeColIndex === -1) continue;
                const cell = this.getCell(row, col);
                this.updateSingleCellGitHighlight(cell, storeRows, storeRowIndex, storeColIndex);
            }
        }
        // git変更行・列をスクロールバーマーカーに反映する
        this.currentGitChangedDomRows = changedDataRows;
        this.refreshScrollbarMarkers();
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
            // git変更マーカーをクリアする（古いマーカーが残存するのを防止）
            this.currentGitChangedDomRows = new Set();
            this.refreshScrollbarMarkers();
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
            const headRowMap = GitDiffTracker.buildHeadRowMap(headCsv, pkColumnIndices, storeHeader);
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
        // 保存直後の再取得のためキャッシュをバイパスしてC#へ直接問い合わせる。
        // キャッシュ済みの古いHEAD版CSVを返すと、保存後のエラー注入や
        // HEAD版の変化を検出できなくなるため gitShowFreshAsync を使用する。
        let headCsv: string;
        try {
            headCsv = await gitShowFreshAsync(gitPath);
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
        const headRowMap = GitDiffTracker.buildHeadRowMap(headCsv, pkColumnIndices, storeHeader);
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
    updateReverseReferenceHints(map: ReverseReferenceMap): void {
        this.reference.updateReverseReferenceHints(map);
        this.syncDetachedFrozenClonesAfterVisualContentChange();
        if (!this.isMiniTable) {
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
        // ストアの行を移動する
        const fromStoreIndex = this.storeRowIndices[fromDomDataRowIndex];
        // 移動先のストアインデックスを計算する:
        // from を抜いた後に to の位置に挿入するため、store.moveRow に渡すインデックスは
        // storeRowIndices[toDomDataRowIndex] を基準に、fromStoreIndex との前後関係で補正する
        let toStoreIndex: number;
        if (toDomDataRowIndex < this.storeRowIndices.length) {
            // from を抜く前のインデックスから補正する
            // ただし storeRowIndices は from の行を抜く前の状態なので注意が必要
            // from < to の場合: from を抜くとインデックスが1つずれるため toDomDataRowIndex + 1 番目の値を使う
            //                   が、storeRowIndices はまだ更新前なので toDomDataRowIndex の値がそのまま
            //                   store.moveRow の「抜いた後のインデックス」になる
            // from > to の場合: to の位置は from を抜いても変わらない
            const originalToStoreIndex = this.storeRowIndices[toDomDataRowIndex];
            if (fromStoreIndex < originalToStoreIndex) {
                // from を抜くとストア上で originalToStoreIndex が1つ前にずれる
                toStoreIndex = originalToStoreIndex - 1;
            } else {
                toStoreIndex = originalToStoreIndex;
            }
        } else {
            // 末尾に挿入する場合: ストアの最終行の次
            const lastStoreIndex = this.storeRowIndices[this.storeRowIndices.length - 1];
            if (fromStoreIndex <= lastStoreIndex) {
                toStoreIndex = lastStoreIndex;
            } else {
                toStoreIndex = lastStoreIndex + 1;
            }
        }
        this.store.moveRow(this.tableName, fromStoreIndex, toStoreIndex);
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
     *   通常ミニテーブル: PK重複のみ検出して自身のDOMに適用する。
     *   DiffTab右ペイン: PK重複 + 型不一致を検出して自身のDOMに適用する。
     *   runAndUpdate() は呼ばない（全テーブル再バリデーションのコストを避けるため）。
     *
     * ValidationPanel 未接続: 何もしない。
     */
    runValidation(): void {
        if (this.validationPanel === false) return;
        if (this.isMiniTable) {
            // DiffTab右ペインはPK重複 + 型不一致の全バリデーションを実行する。
            // 通常ミニテーブル（RelationsPanel配下）はPK重複のみで十分。
            const errors = this.diffTab !== false
                ? this.validationPanel.validateForTable(this.tableName)
                : this.validationPanel.validatePkDuplicatesForTable(this.tableName);
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
        const colCount = this.getColumnCount();
        const offset = this.dataColumnOffset();
        // DOM列→ストア列のマッピングを columnMapping から事前構築する。
        const domColToStoreCol: number[] = [];
        for (let dataColIdx = 0; dataColIdx < colCount; dataColIdx++) {
            domColToStoreCol.push(this.getStoreColumnIndex(dataColIdx));
        }
        // バーチャルスクロールで新規生成される行にもエラークラスを適用できるようキャッシュに保存する
        this.cachedPkErrorCells = pkErrorCells;
        this.cachedOtherErrorCells = otherErrorCells;
        this.cachedDomColToStoreCol = domColToStoreCol;
        // storeRowIndices に記録されたデータ行のみ走査する（バッファ空行はスキップ）
        // フィルター適用時は getFilteredDataRowCount() でフィルター後の行数を使う
        const validationRowCount = this.getFilteredDataRowCount();
        for (let rowIdx = 1; rowIdx <= validationRowCount; rowIdx++) {
            const row = this.getRowElement(rowIdx);
            if (!row) continue;
            // フィルター適用時は論理行インデックスのため resolveStoreRowIndex で変換する
            const storeRowIdx = this.resolveStoreRowIndex(rowIdx - 1);
            if (storeRowIdx < 0) continue;
            for (let dataColIdx = 0; dataColIdx < colCount; dataColIdx++) {
                const cell = row.children[dataColIdx + offset] as HTMLElement | null;
                if (!cell) continue;
                const storeColIdx = domColToStoreCol[dataColIdx];
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
        // エラー行をスクロールバーマーカーに反映する（ストア行→DOM行に変換）
        const errorDomRows = new Set<number>();
        for (const error of errors) {
            const domDataRow = this.storeRowIndices.indexOf(error.rowIndex);
            if (domDataRow !== -1) errorDomRows.add(domDataRow);
        }
        this.currentErrorDomRows = errorDomRows;
        this.refreshScrollbarMarkers();
    }

    // =========================================================================
    // スクロールバーマーカー
    // =========================================================================

    /**
     * スクロールバーマーカートラックにエラー行・git変更行を反映する。
     * ミニテーブルではマーカー不要のため何もしない。
     * データ行インデックスと総データ行数の比率でマーカー位置を算出する。
     * DOMの表示範囲に依存しないため、仮想スクロール時もすべてのマーカーを描画できる。
     */
    private refreshScrollbarMarkers(): void {
        if (this.scrollbarMarkerTrack === false) return;
        if (this.isMiniTable) return;
        if (!this.isActive) return;
        // 総データ行数（バッファ行を含む）をマーカー位置の分母にする。
        // storeRowIndices.length はデータ行数、+1 でバッファ行1行を考慮する。
        // ミニテーブルでは呼ばれない（上のガードで早期リターン済み）。
        const totalDataRowCount = this.storeRowIndices.length + 1;
        const errorMarkers = this.buildMarkerEntries(this.currentErrorDomRows, totalDataRowCount);
        const gitMarkers = this.buildMarkerEntries(this.currentGitChangedDomRows, totalDataRowCount);
        this.scrollbarMarkerTrack.updateNormal(errorMarkers, gitMarkers);
    }

    /**
     * データ行インデックスの集合からマーカー描画エントリを構築する。
     * 各行のマーカー位置を dataRowIndex / totalDataRowCount で比率算出する。
     * DOM要素の座標に依存しないため、仮想スクロールで表示範囲外の行もマーカーを生成できる。
     * 連続する行はまとめて1つのエントリにマージする。
     */
    private buildMarkerEntries(dataRows: Set<number>, totalDataRowCount: number): MarkerEntry[] {
        if (dataRows.size === 0) return [];
        const markers: MarkerEntry[] = [];
        const sorted = Array.from(dataRows).sort((a, b) => a - b);
        const rowSize = 1 / totalDataRowCount;
        let rangeStartIdx = sorted[0];
        let rangeEndIdx = sorted[0];
        for (let i = 1; i < sorted.length; i++) {
            if (sorted[i] === sorted[i - 1] + 1) {
                // 連続する行はマージする
                rangeEndIdx = sorted[i];
            } else {
                // 非連続 → 前のレンジを確定して新しいレンジを開始する
                markers.push({
                    start: rangeStartIdx / totalDataRowCount,
                    size: (rangeEndIdx - rangeStartIdx + 1) * rowSize,
                });
                rangeStartIdx = sorted[i];
                rangeEndIdx = sorted[i];
            }
        }
        // 最後のレンジを確定する
        markers.push({
            start: rangeStartIdx / totalDataRowCount,
            size: (rangeEndIdx - rangeStartIdx + 1) * rowSize,
        });
        return markers;
    }

    /**
     * 列幅が変更されたことを通知する（AreaResizer / ColumnWidthCommand から呼ばれる）。
     * 通常テーブルではスキーマJSONへ即時保存する。
     */
    notifyColumnWidthChanged(): void {
        if (!this.isMiniTable) saveSchemaDataAsync(this);
    }

}
