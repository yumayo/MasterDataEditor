import {EditorTableData} from "../data/models/editor-table-data";
import {TabButton} from "./tab-button";
import {readFileAsync, gitShowFreshAsync, gitShowAtCommitAsync, gitStatusAsync, type GitStatusEntry, type GitStatusResult} from "../app/api";
import {CommitSelectorDialog} from "../ui/commit-selector-dialog";
import {Editor} from "../editor/editor";
import {EditorTable} from "../editor/editor-table";
import {Selection} from "../editor/selection";
import {History} from "../editor/history";
import {AreaResizer} from "../editor/area-resizer";
import {ContextMenu, type ContextMenuEntry} from "../ui/context-menu";
import {ScrollViewportController} from "../editor/scroll-viewport-controller";
import {ReferenceDataCache} from "../references/reference-data-cache";
import {ReverseReferenceEngine} from "../references/reverse-reference-engine";
import {GridDropdownInput} from "../ui/grid-dropdown-input";
import {DropdownQuickView} from "../ui/dropdown-quick-view";
import {FillController} from "../editor/fill-controller";
import {EditorTableHandler} from "../editor/editor-table-handler";
import {Sidebar} from "../sidebar/sidebar";
import type {BookmarkEntry} from "../panels/bookmark-panel";
import {TabDragDrop} from "./tab-drag-drop";
import {TabReference} from "./tab-reference";
import {InMemoryTableStore} from "../data/in-memory-table-store";
import {RelationsPanel} from "../panels/relations-panel";
import {ValidationPanel} from "../panels/validation-panel";
import {Csv} from "../data/csv";
import {SettingsPanel, getAppliedSettings} from "../panels/settings-panel";
import {createLargeFileSettings, SETTINGS_CHANGED_EVENT, type LargeFileSettings, type SettingsChangedEventDetail} from "../settings/settings-schema";
import {DiffTab} from "./diff-tab";
import {FormPanel, type FormPanelNavEntry} from "../panels/form-panel";
import {NavigationHistory} from "./navigation-history";
import {NotificationToast} from "../ui/notification";
import {ErrorTooltip} from "../ui/error-tooltip";
import type {SerializedSortKey} from "../editor/column-sorter";
import type {SerializedFilters} from "../editor/column-filter";
import type {EditorAPI} from "../editor-api/editor-api-types";
import {ErDiagramTab} from "./er-diagram-tab";
import {TableDefinitionEditor} from "./table-definition-editor";
import type {EditTarget} from "./table-definition-editor";
import {saveTableDataFromStoreAsync} from "../editor/editor-actions";
import type {UiStateStore, UiTabsState, UiStoredTab, UiStoredDiffTab, UiScrollPosition, UiStoredEditorTableState, UiStoredSelectionState, UiStoredFormPanelState} from "../app/ui-state";
import {DebugApiDetailTab} from "./debug-api-detail-tab";
import type {DebugConsoleEntryDetail} from "../panels/debug-console";
import {ViewPluginHost, type ViewPluginMount} from "../plugins/view-plugin-host";

/** 設定タブの固定名 */
const SETTINGS_TAB_NAME = '設定';

/** 差分タブ名のプレフィックス */
const DIFF_TAB_PREFIX = '差分: ';

/** ER図タブの固定名 */
const ER_DIAGRAM_TAB_NAME = 'ER Diagram';

/** テーブル定義タブの固定名 */
export const TABLE_DEFINITION_TAB_NAME = '新しいテーブル';

/** DEBUG CONSOLE のAPI詳細を表示する一時タブ名 */
const DEBUG_API_DETAIL_TAB_NAME = 'API 詳細';

/** Viewプラグインタブ名のプレフィックス */
const VIEW_PLUGIN_TAB_PREFIX = 'View: ';

type TabScrollPositionPreference =
    | { kind: 'edge'; edge: 'left' | 'right' }
    | { kind: 'middle'; ratio: number };

type FormPanelVisibilityListener = (visible: boolean) => void;

export interface FormPanelState {
    navStack: FormPanelNavEntry[];
}

/**
 * タブごとの状態を保持するインターフェース
 */
export interface TabState {
    editorTable: EditorTable;
    selection: Selection;
    editorTableHandler: EditorTableHandler;
    history: History;
    areaResizer: AreaResizer;
    fillController: FillController;
    wrapperElement: HTMLElement;
    dropdownInput: GridDropdownInput;
    /** タブ非アクティブ時に保存された水平スクロール位置 */
    savedScrollLeft: number;
    /** タブ非アクティブ時に保存された垂直スクロール位置 */
    savedScrollTop: number;
    /** タブ非アクティブ時に保存されたペインスタック（定義ジャンプ等で深化した状態を保持） */
    paneStack: Array<{ element: HTMLElement; panel: RelationsPanel | false }>;
    /** タブ非アクティブ時に保存されたビューインデックス */
    viewIndex: number;
    /** タブ非アクティブ時に保存されたソートキー（reloadCellsFromStore後に復元するため） */
    savedSortKeys: SerializedSortKey[];
    /** タブ非アクティブ時に保存されたフィルター状態（reloadCellsFromStore後に復元するため） */
    savedFilters: SerializedFilters;
    /** タブごとの RelationsPanel 表示状態 */
    relationsPanelVisible: boolean;
    /** タブ非アクティブ時に開いていたフォームビューの状態。null は閉じている状態を表す。 */
    formPanelState: FormPanelState | null;
}

export interface EditorTableFactoryResult {
    editorTable: EditorTable;
    selection: Selection;
    editorTableHandler: EditorTableHandler;
    history: History;
    areaResizer: AreaResizer;
    fillController: FillController;
}

interface MeasuredTabButton {
    element: HTMLElement;
    width: number;
    pinned: boolean;
}

interface TabLayoutRow {
    items: MeasuredTabButton[];
    width: number;
}

/**
 * VSCodeやGoogleChromeのタブと同じものです。
 */
export class Tab {

    element: HTMLElement;

    tabButtons: TabButton[];

    readonly editor: Editor;

    /** タブごとの状態を保持するマップ */
    private tabStates: Map<string, TabState>;

    /** 現在アクティブなタブ名 */
    private activeTabName: string | false;

    /** コンテキストメニュー（全タブで共有） */
    private contextMenu: ContextMenu;

    /** ドラッグアンドドロップモジュール */
    private readonly dragDrop: TabDragDrop;

    /** 参照データ管理モジュール */
    private readonly reference: TabReference;

    /** 参照箇所を表示するサイドバー */
    private readonly sidebar: Sidebar;

    /** タブバー要素（サイドバー幅連動用） */
    private readonly tabElement: HTMLElement;

    /** タブボタン配置を requestAnimationFrame でまとめるためのID */
    private tabLayoutFrame: number | false;

    /** 次回タブ配置後にアクティブタブを可視範囲へ入れるか */
    private scrollActiveTabAfterLayout: boolean;

    /** タブバーの最後の横スクロール位置。スクロールバー消失中も保持する */
    private tabScrollPositionPreference: TabScrollPositionPreference;

    /** ui-state 復元時に次回レイアウト後へ適用するタブバーのスクロール位置 */
    private pendingTabBarScrollPosition: UiScrollPosition | null;

    /** ui-state からのタブ復元中は、アクティブタブへの自動スクロールより保存位置を優先する */
    private restoringTabsFromUiState: boolean;

    /** ui-state 復元時にViewプラグイン読み込み完了後へ遅延するアクティブViewタブ名 */
    private pendingRestoredViewPluginActiveTabName: string | null;

    /** まだTabStateを構築していない復元タブのスクロール位置 */
    private readonly restoredTabScrollPositions: Map<string, UiScrollPosition>;

    /** まだTabStateを構築していない復元タブのEditorTable状態 */
    private readonly restoredEditorTableStates: Map<string, UiStoredEditorTableState>;

    /** 直近のタブ配置完了時に横スクロールが発生していたか */
    private tabScrollHadStableOverflow: boolean;

    /** 次回タブ配置後に端寄せ状態を維持するか */
    private preserveTabScrollEdgeAfterLayout: boolean;

    /** 表示倍率・viewport変化後のEditorTable再レイアウトをrequestAnimationFrameでまとめるためのID */
    private editorTableLayoutRefreshFrame: number | false;

    /** タブで開かれているEditorTableの参照マップ（テーブル名→EditorTable） */
    private readonly openEditorTables: Map<string, EditorTable>;

    /** テーブルデータの中央ストア（CSVデータの一元管理用） */
    private readonly store: InMemoryTableStore;

    /** 参照データキャッシュ（全タブで共有） */
    private readonly referenceDataCache: ReferenceDataCache;

    /** 逆参照マップの共有エンジン */
    private readonly reverseReferenceEngine: ReverseReferenceEngine;

    /** タブ読み込み完了後にナビゲーションするPK値（空文字列は無効） */
    private pendingNavigationPkValue: string;

    /** タブ読み込み完了後にナビゲーションするブックマーク行キー（空文字列は無効） */
    private pendingNavigationBookmarkKey: string;

    /** タブ読み込み完了後にナビゲーションするストア行インデックス（-1は無効、ValidationPanelで使用） */
    private pendingNavigationStoreRowIndex: number;

    /** タブ読み込み完了後にナビゲーションする列インデックス（-1は無効、navigateToTableCellで使用） */
    private pendingNavigationColumnIndex: number;

    /** タブ読み込み完了後にナビゲーションする列名（空文字列は無効、navigateToTableColumnValueで使用） */
    private pendingNavigationColumnName: string;

    /** 動的参照の逆参照ジャンプ用: 1段目フィルタ列名（空文字列は無効） */
    private pendingNavigationFilterColumnName: string;
    /** 動的参照の逆参照ジャンプ用: 1段目フィルタ値の集合 */
    private pendingNavigationFilterValues: ReadonlySet<string>;

    /** グローバルなリレーションパネル（全タブで共有、editor.elementの右ペインに配置） */
    private readonly relationsPanel: RelationsPanel;

    /**
     * ペインスタック。
     * [0] は leftPane の HTMLElement（EditorTable群のコンテナ）、[1..] は RelationsPanel インスタンス。
     * enableTabButton → activateTabState で初期化される。
     */
    private paneStack: Array<{ element: HTMLElement; panel: RelationsPanel | false }>;

    /** 現在のビューインデックス（表示ペア: paneStack[viewIndex] と paneStack[viewIndex+1]） */
    private viewIndex: number;

    /** 設定タブの SettingsPanel インスタンス（設定タブが開かれた後に生成される） */
    private settingsPanel: SettingsPanel | false;

    /** 設定タブのラッパー要素（editor の左ペインに追加するコンテナ） */
    private settingsWrapperElement: HTMLElement | false;

    /** 差分タブのDiffTabインスタンスマップ（キー: 差分タブ名 = DIFF_TAB_PREFIX + tableName） */
    private readonly diffTabs: Map<string, DiffTab>;

    /** 復元・保存用のGit差分タブメタデータ（キー: 差分タブ名） */
    private readonly diffTabMetadata: Map<string, UiStoredDiffTab>;

    /** 復元済み差分タブの実体ロード中フラグ */
    private readonly loadingDiffTabNames: Set<string>;

    /** ER図タブのラッパー要素（ER図タブが開かれた後に生成される。未生成時は false） */
    private erDiagramWrapperElement: HTMLElement | false;

    /** ER図タブのインスタンス（未生成時は false） */
    private erDiagramTab: ErDiagramTab | false;

    /** テーブル定義タブのラッパー要素（テーブル定義タブが開かれた後に生成される。未生成時は false） */
    private tableDefinitionWrapperElement: HTMLElement | false;

    /** テーブル定義タブのインスタンス（未生成時は false） */
    private tableDefinitionEditor: TableDefinitionEditor | false;

    /** DEBUG CONSOLE のAPI詳細タブのラッパー要素（一時タブ。未生成時は false） */
    private debugApiDetailWrapperElement: HTMLElement | false;

    /** DEBUG CONSOLE のAPI詳細タブのインスタンス（未生成時は false） */
    private debugApiDetailTab: DebugApiDetailTab | false;

    /** API詳細タブを次に表示するときに反映する詳細情報 */
    private pendingDebugApiDetail: DebugConsoleEntryDetail | null;

    /** Viewプラグインホスト（main.tsで接続される。未接続時はfalse） */
    private viewPluginHost: ViewPluginHost | false;

    /** ViewプラグインID -> タブ名 */
    private readonly viewPluginTabNamesById: Map<string, string>;

    /** Viewプラグインタブ名 -> プラグインID */
    private readonly viewPluginIdsByTabName: Map<string, string>;

    /** Viewプラグインタブ名 -> ラッパー要素 */
    private readonly viewPluginWrapperElements: Map<string, HTMLElement>;

    /** Viewプラグインタブ名 -> マウント解除ハンドル */
    private readonly viewPluginMounts: Map<string, ViewPluginMount>;

    /**
     * 次回 activateTableDefinitionTab 呼び出し時に使用する編集対象情報。
     * openEditTableDefinitionTabAsync で設定し、activateTableDefinitionTab で消費される。
     * 新規作成モードの場合は false。
     */
    private pendingEditTarget: EditTarget | false;

    /**
     * 現在表示中のフォームパネル（PKセル右クリック→「フォームビューを表示」で生成）
     * 表示中でない場合は false
     */
    private currentFormPanel: FormPanel | false;

    /** 通常タブがまだない状態でRelationsトグルされた場合に、新規タブへ適用する初期表示状態 */
    private defaultRelationsPanelVisible: boolean;

    /** FormPanel 表示/非表示変更時のリスナー（Toolbar のアクティブ状態連動用） */
    private formPanelVisibilityListener: FormPanelVisibilityListener | false;

    /**
     * バリデーションパネル（main.tsのconnectValidationPanelで設定される。未設定はfalse）
     * テーブルを開く際にスキーマを登録し、EditorTable に接続するために使用する。
     */
    private validationPanel: ValidationPanel | false;

    /**
     * ブラウザ History API によるナビゲーション履歴管理。
     * コンストラクタ末尾で生成され、Tab と相互参照する。
     */
    private readonly navigationHistory: NavigationHistory;

    /**
     * 全 GridDropdownInput が共有するシングルトン DropdownQuickView。
     * body 直下に1つだけ配置されることで、strict mode の複数マッチ問題を回避する。
     * Tab コンストラクタで生成し、各 GridDropdownInput へ connectDropdownQuickView() で接続する。
     */
    private readonly sharedDropdownQuickView: DropdownQuickView;

    /** エラー通知トースト（各子コンポーネントに伝播させる） */
    private readonly notification: NotificationToast;

    /** エラーツールチップ（connectErrorTooltipで設定される。未設定はfalse） */
    private errorTooltip: ErrorTooltip | false;

    /** EditorAPI（connectEditorApi で後から接続する。未接続時は false） */
    private editorApi: EditorAPI | false;

    /** TabState 構築中の通常テーブルタブ名 */
    private readonly loadingTabNames: Set<string>;

    /** openTableAsync() で待機中の resolve 関数を保持するマップ（キー: テーブル名） */
    private readonly pendingTableOpens: Map<string, Array<(success: boolean) => void>>;

    /** コミット選択ダイアログ（バージョン比較用） */
    private readonly commitSelectorDialog: CommitSelectorDialog;

    /** User スコープの ui-state.json へのUI状態保存 */
    private readonly uiStateStore: UiStateStore;

    constructor(editor: Editor, sidebar: Sidebar, tabContentElement: HTMLElement, tabElement: HTMLElement, store: InMemoryTableStore, referenceDataCache: ReferenceDataCache, notification: NotificationToast, uiStateStore: UiStateStore) {
        this.editor = editor;
        this.element = tabContentElement;
        this.tabButtons = [];
        this.tabStates = new Map();
        this.activeTabName = false;
        this.contextMenu = new ContextMenu();
        this.sidebar = sidebar;
        this.tabElement = tabElement;
        this.tabLayoutFrame = false;
        this.scrollActiveTabAfterLayout = false;
        this.tabScrollPositionPreference = { kind: 'edge', edge: 'left' };
        this.pendingTabBarScrollPosition = null;
        this.restoringTabsFromUiState = false;
        this.pendingRestoredViewPluginActiveTabName = null;
        this.restoredTabScrollPositions = new Map();
        this.restoredEditorTableStates = new Map();
        this.tabScrollHadStableOverflow = false;
        this.preserveTabScrollEdgeAfterLayout = false;
        this.editorTableLayoutRefreshFrame = false;
        this.openEditorTables = new Map();
        this.store = store;
        this.referenceDataCache = referenceDataCache;
        this.notification = notification;
        this.reverseReferenceEngine = new ReverseReferenceEngine(this.store, this.notification);
        this.pendingNavigationPkValue = '';
        this.pendingNavigationBookmarkKey = '';
        this.pendingNavigationStoreRowIndex = -1;
        this.pendingNavigationColumnIndex = -1;
        this.pendingNavigationColumnName = '';
        this.pendingNavigationFilterColumnName = '';
        this.pendingNavigationFilterValues = new Set();
        this.dragDrop = new TabDragDrop(this);
        this.reference = new TabReference(this.referenceDataCache, this.reverseReferenceEngine, this.notification);
        this.reverseReferenceEngine.subscribeMapUpdated((tableName, map) => {
            const editorTable = this.openEditorTables.get(tableName);
            if (editorTable === undefined) return;
            editorTable.updateReverseReferenceHints(map, tableName === this.activeTabName);
        });
        this.paneStack = [];
        this.viewIndex = 0;
        this.settingsPanel = false;
        this.settingsWrapperElement = false;
        this.diffTabs = new Map();
        this.diffTabMetadata = new Map();
        this.loadingDiffTabNames = new Set();
        this.erDiagramWrapperElement = false;
        this.erDiagramTab = false;
        this.tableDefinitionWrapperElement = false;
        this.tableDefinitionEditor = false;
        this.debugApiDetailWrapperElement = false;
        this.debugApiDetailTab = false;
        this.pendingDebugApiDetail = null;
        this.viewPluginHost = false;
        this.viewPluginTabNamesById = new Map();
        this.viewPluginIdsByTabName = new Map();
        this.viewPluginWrapperElements = new Map();
        this.viewPluginMounts = new Map();
        this.pendingEditTarget = false;
        this.currentFormPanel = false;
        this.defaultRelationsPanelVisible = false;
        this.formPanelVisibilityListener = false;
        this.validationPanel = false;
        this.errorTooltip = false;
        this.editorApi = false;
        this.loadingTabNames = new Set();
        this.pendingTableOpens = new Map();
        this.commitSelectorDialog = new CommitSelectorDialog();
        this.uiStateStore = uiStateStore;

        // シングルトン DropdownQuickView を生成して Tab・Store を接続する。
        // body 直下に1つだけ配置されることで、複数の GridDropdownInput が共有できる。
        this.sharedDropdownQuickView = new DropdownQuickView(this.referenceDataCache);
        this.sharedDropdownQuickView.connectTab(this, this.store);

        // グローバルなリレーションパネルをeditor.elementの右ペインとして配置する
        // editor.appendChildは左ペインへのappendなので、appendRelationsPanel経由で直接追加する
        this.relationsPanel = new RelationsPanel(this.store, this.reverseReferenceEngine, this.notification);
        this.editor.appendRelationsPanel(this.relationsPanel);
        // ミニEditorTable生成のファクトリとしてTab自身を接続する（相互参照）
        this.relationsPanel.connectTab(this);
        // Editorにこの Tab を接続してナビゲーションボタンのクリックを受け取れるようにする
        this.editor.connectTab(this);

        // NavigationHistory を生成する（Tab と相互参照）。Tab の全メンバが初期化された後で生成する。
        this.navigationHistory = new NavigationHistory(this);

        const tabScrollArea = this.element.parentElement;
        if (tabScrollArea instanceof HTMLElement) {
            tabScrollArea.addEventListener('scroll', () => {
                this.updateTabScrollPositionPreference(tabScrollArea);
                this.persistTabs();
            });
        }

        window.addEventListener('resize', () => {
            this.scheduleTabLayout(false, true);
            this.scheduleActiveEditorTableLayoutRefresh();
        });
        window.addEventListener(SETTINGS_CHANGED_EVENT, (event: Event) => {
            const detail = (event as CustomEvent<SettingsChangedEventDetail>).detail;
            if (
                detail.changedKeys.includes('tabWrapEnabled')
                || detail.changedKeys.includes('tabSeparatePinnedRowsEnabled')
                || detail.changedKeys.includes('tabButtonDescriptionHidden')
            ) {
                this.scheduleTabLayout(false, true);
                this.scheduleActiveEditorTableLayoutRefresh();
            }
        });
        this.installViewportScaleChangeListeners();
    }

    /**
     * 既存タブをアクティブにする（NavigationHistory の popstate 復元から呼ばれる）。
     * 新規タブ作成は行わない。タブが存在しない場合は閉じられたタブの履歴エントリをスキップする。
     */
    switchToExistingTab(name: string): void {
        // 特殊タブ（ER図等）は tabStates に登録されないため、tabButtons で存在を確認する
        const exists = this.tabStates.has(name) || this.tabButtons.some(b => b.name === name);
        if (!exists) {
            // 閉じられたタブの履歴エントリをスキップして次のエントリに進む
            history.back();
            return;
        }
        this.enableTabButton(name);
    }

    /** サイドバー幅に応じてタブバーの位置と幅を更新する */
    applySidebarWidth(sidebarWidth: number): void {
        const widthPx = sidebarWidth + 'px';
        this.tabElement.style.left = widthPx;
        this.tabElement.style.width = 'calc(100vw - ' + widthPx + ')';
        this.scheduleTabLayout(false, true);
    }

    /**
     * バリデーションパネルを接続する（main.ts で呼ぶ）。
     * 接続後は createEditorTable 時にスキーマ登録と validationPanel 接続が行われる。
     */
    connectValidationPanel(panel: ValidationPanel): void {
        this.validationPanel = panel;
    }

    /**
     * エラーツールチップを接続する（main.ts で呼ぶ）。
     * 接続後は createEditorTable / createMiniEditorTable で ErrorTooltip 接続が行われる。
     */
    connectErrorTooltip(tooltip: ErrorTooltip): void {
        this.errorTooltip = tooltip;
    }

    /**
     * タブで開かれているEditorTableの参照マップを取得する
     */
    getOpenEditorTables(): Map<string, EditorTable> {
        return this.openEditorTables;
    }

    applyLargeFileSettings(settings: LargeFileSettings): void {
        for (const editorTable of this.openEditorTables.values()) {
            editorTable.setLargeFileSettings(settings);
        }
        for (const diffTab of this.diffTabs.values()) {
            diffTab.setLargeFileSettings(settings);
        }
    }

    /**
     * FileSystemWatcher から外部ファイル変更通知を受けたときに呼ばれる。
     * 開いているタブは維持し、次回タブ生成時にcleanなストアキャッシュだけ再読み込みする。
     */
    notifyExternalFileChanged(filenames?: readonly string[]): void {
        this.store.markAllTablesStale();
        this.referenceDataCache.evictAll();
        if (this.isDataOnlyFileChange(filenames)) {
            this.reverseReferenceEngine.invalidateData();
            return;
        }
        this.referenceDataCache.invalidateSchemaIndex();
        this.reverseReferenceEngine.invalidateAll();
    }

    private isDataOnlyFileChange(filenames?: readonly string[]): boolean {
        if (filenames === undefined || filenames.length === 0) return false;
        return filenames.every(filename => filename.startsWith('data/') && filename.endsWith('.csv'));
    }

    registerSchemaForReverseReferences(tableName: string, schemaJson: Record<string, unknown>): void {
        this.reverseReferenceEngine.registerSchema(tableName, schemaJson);
    }

    markReverseReferenceSchemaIndexComplete(): void {
        this.reverseReferenceEngine.markSchemaIndexComplete();
    }

    /**
     * フォームビュー等の EditorTable 外コンポーネントにも、
     * EditorTable と同じ共有 DropdownQuickView を接続する。
     */
    connectDropdownQuickView(dropdownInput: GridDropdownInput): void {
        dropdownInput.connectDropdownQuickView(this.sharedDropdownQuickView);
    }

    /** FormPanel 表示/非表示変更時のリスナーを設定する（Toolbar から呼ばれる） */
    connectFormPanelVisibilityListener(listener: FormPanelVisibilityListener): void {
        this.formPanelVisibilityListener = listener;
    }

    /**
     * タブボタン配列を取得する（サブモジュール用）
     */
    getTabButtons(): TabButton[] {
        return this.tabButtons;
    }

    /**
     * タブバー要素を取得する（サブモジュール用）
     */
    getTabBarElement(): HTMLElement {
        return this.element;
    }

    /**
     * タブボタンを配置する。
     * 折り返しが無効なら1段の横スクロール、有効なら段数上限なしで必要なだけ縦に広げる。
     */
    requestTabLayout(): void {
        this.scheduleTabLayout();
    }

    private scheduleTabLayout(scrollActiveTabAfterLayout: boolean = false, preserveScrollEdgeAfterLayout: boolean = false): void {
        if (this.restoringTabsFromUiState && this.pendingTabBarScrollPosition !== null) {
            scrollActiveTabAfterLayout = false;
        }
        if (scrollActiveTabAfterLayout) {
            this.scrollActiveTabAfterLayout = true;
        }
        if (preserveScrollEdgeAfterLayout) {
            this.preserveTabScrollEdgeAfterLayout = true;
        }
        if (this.tabLayoutFrame !== false) {
            cancelAnimationFrame(this.tabLayoutFrame);
        }
        this.tabLayoutFrame = requestAnimationFrame(() => {
            this.tabLayoutFrame = false;
            const shouldScrollActiveTab = this.scrollActiveTabAfterLayout;
            const shouldPreserveScrollEdge = this.preserveTabScrollEdgeAfterLayout;
            this.scrollActiveTabAfterLayout = false;
            this.preserveTabScrollEdgeAfterLayout = false;
            this.layoutTabButtons(shouldScrollActiveTab, shouldPreserveScrollEdge);
        });
    }

    private scheduleActiveEditorTableLayoutRefresh(): void {
        if (this.editorTableLayoutRefreshFrame !== false) {
            cancelAnimationFrame(this.editorTableLayoutRefreshFrame);
        }
        this.editorTableLayoutRefreshFrame = requestAnimationFrame(() => {
            this.editorTableLayoutRefreshFrame = false;
            this.refreshActiveEditorTableLayout();
        });
    }

    private refreshActiveEditorTableLayout(): void {
        if (this.activeTabName === false) return;
        const activeState = this.tabStates.get(this.activeTabName);
        if (!activeState) return;
        const editorTable = activeState.editorTable;
        const shouldRefreshLayout = editorTable.usesInternalScrollLayout()
            || editorTable.getFrozenColumnCount() > 0
            || editorTable.getFrozenRowCount() > 0;
        if (!shouldRefreshLayout) return;
        editorTable.forceVirtualScrollRecalculate();
        editorTable.refreshSelectionDisplay();
        this.editor.syncActiveTableScrollState();
    }

    private installViewportScaleChangeListeners(): void {
        const scheduleRefresh = () => { this.scheduleActiveEditorTableLayoutRefresh(); };
        window.visualViewport?.addEventListener('resize', scheduleRefresh);
        window.visualViewport?.addEventListener('scroll', scheduleRefresh);

        const observedElements = [document.documentElement, document.body].filter((element): element is HTMLElement => element instanceof HTMLElement);
        if (observedElements.length > 0) {
            const observer = new MutationObserver(scheduleRefresh);
            for (const element of observedElements) {
                observer.observe(element, { attributes: true, attributeFilter: ['style', 'class'] });
            }
        }

        let resolutionQuery: MediaQueryList | false = false;
        const bindResolutionQuery = () => {
            if (resolutionQuery !== false) {
                resolutionQuery.removeEventListener('change', onResolutionChange);
            }
            resolutionQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
            resolutionQuery.addEventListener('change', onResolutionChange);
        };
        const onResolutionChange = () => {
            bindResolutionQuery();
            scheduleRefresh();
        };
        bindResolutionQuery();
    }

    private layoutTabButtons(scrollActiveTabAfterLayout: boolean, preserveScrollEdgeAfterLayout: boolean): void {
        const scrollArea = this.element.parentElement;
        if (!(scrollArea instanceof HTMLElement)) return;

        const rowHeight = this.getTabRowHeightPx();
        const tabRowsEnabled = this.isTabRowsLayoutEnabled();
        const separatePinnedRowsEnabled = this.shouldSeparatePinnedTabRows();
        const viewportWidth = this.getTabViewportWidthPx(scrollArea);
        const toolbarWidth = this.getToolbarWidthPx();
        const lastRowTabWidth = Math.max(1, viewportWidth - toolbarWidth);

        if (this.tabButtons.length === 0) {
            scrollArea.style.overflowX = 'hidden';
            scrollArea.scrollLeft = 0;
            this.applyVisibleTabRowCount(1);
            this.element.classList.remove('tab-list-multi-row');
            this.element.style.height = rowHeight + 'px';
            this.element.style.width = viewportWidth + 'px';
            this.updateTabScrollPositionPreference(scrollArea, true);
            return;
        }

        scrollArea.style.overflowX = tabRowsEnabled ? 'hidden' : 'auto';
        if (tabRowsEnabled && scrollArea.scrollLeft !== 0) {
            scrollArea.scrollLeft = 0;
        }
        // auto 幅の絶対配置要素は親幅で再計算されるため、測定中は親幅を固定する。
        this.element.style.width = viewportWidth + 'px';

        const measuredTabs: MeasuredTabButton[] = [];

        for (const tabButton of this.tabButtons) {
            const element = tabButton.element;
            element.style.width = '';
            element.style.left = '0px';
            element.style.top = '0px';

            const measuredWidth = Math.ceil(element.getBoundingClientRect().width);
            const maxWidth = tabRowsEnabled ? viewportWidth : lastRowTabWidth;
            const width = Math.min(maxWidth, Math.max(1, measuredWidth));
            measuredTabs.push({element, width, pinned: tabButton.isPinned()});
        }

        let visibleRowCount = 1;
        let contentWidth = 0;
        if (tabRowsEnabled) {
            const rows: TabLayoutRow[] = [];
            if (separatePinnedRowsEnabled) {
                this.appendWrappedTabRows(rows, measuredTabs.filter(item => item.pinned), viewportWidth, false);
                this.appendWrappedTabRows(rows, measuredTabs.filter(item => !item.pinned), viewportWidth, rows.length > 0);
            } else {
                this.appendWrappedTabRows(rows, measuredTabs, viewportWidth, false);
            }

            let lastRow = rows[rows.length - 1];
            if (lastRow.items.length === 1 && lastRow.width > lastRowTabWidth) {
                lastRow.items[0].width = lastRowTabWidth;
                lastRow.width = lastRowTabWidth;
            } else if (lastRow.items.length > 1 && lastRow.width > lastRowTabWidth) {
                const movedItem = lastRow.items.pop();
                if (movedItem !== undefined) {
                    lastRow.width -= movedItem.width;
                    movedItem.width = Math.min(movedItem.width, lastRowTabWidth);
                    rows.push({items: [movedItem], width: movedItem.width});
                }
            }

            rows.forEach((row, rowIndex) => {
                let left = 0;
                for (const item of row.items) {
                    item.element.style.left = left + 'px';
                    item.element.style.top = (rowIndex * rowHeight) + 'px';
                    // 親のスクロール幅を広げた後も、測定時の幅から膨らまないように固定する。
                    item.element.style.width = item.width + 'px';
                    left += item.width;
                }
                contentWidth = Math.max(contentWidth, row.width);
            });
            visibleRowCount = rows.length;
        } else {
            let left = 0;
            for (const item of measuredTabs) {
                item.element.style.left = left + 'px';
                item.element.style.top = '0px';
                // 右端のツールバーに隠れないよう、1段表示ではタブ1枚の最大幅も実効幅に収める。
                item.element.style.width = item.width + 'px';
                left += item.width;
            }
            contentWidth = left;
        }

        const height = visibleRowCount * rowHeight;
        this.applyVisibleTabRowCount(visibleRowCount);
        this.element.classList.toggle('tab-list-multi-row', visibleRowCount > 1);
        this.element.style.height = height + 'px';
        const scrollWidth = tabRowsEnabled ? viewportWidth : contentWidth + toolbarWidth;
        this.element.style.width = Math.max(viewportWidth, scrollWidth) + 'px';

        if (scrollActiveTabAfterLayout) {
            const activeTabButton = this.tabButtons.find(tabButton => tabButton.element.classList.contains('tab-button-active'));
            if (activeTabButton) {
                activeTabButton.scrollIntoViewIfNeeded('auto');
            }
        } else if (!tabRowsEnabled && preserveScrollEdgeAfterLayout) {
            this.applyTabScrollPositionPreference(scrollArea);
        }
        if (this.pendingTabBarScrollPosition !== null) {
            this.applyTabBarScrollPosition(scrollArea, this.pendingTabBarScrollPosition);
            this.pendingTabBarScrollPosition = null;
        }
        this.updateTabScrollPositionPreference(scrollArea, true);
    }

    private appendWrappedTabRows(rows: TabLayoutRow[], items: MeasuredTabButton[], viewportWidth: number, startNewRow: boolean): void {
        if (items.length === 0) return;
        let row = rows[rows.length - 1];
        if (row === undefined || startNewRow || row.items.length === 0) {
            row = {items: [], width: 0};
            rows.push(row);
        }
        for (const item of items) {
            const rowHasContent = row.width > 0;
            const wouldOverflowRow = rowHasContent && row.width + item.width > viewportWidth;
            if (wouldOverflowRow) {
                row = {items: [], width: 0};
                rows.push(row);
            }
            row.items.push(item);
            row.width += item.width;
        }
    }

    private getTabScrollRightEdge(scrollArea: HTMLElement): number {
        return Math.max(0, scrollArea.scrollWidth - scrollArea.clientWidth);
    }

    private updateTabScrollPositionPreference(scrollArea: HTMLElement, updateStableOverflow: boolean = false): void {
        if (!updateStableOverflow && (this.tabLayoutFrame !== false || this.preserveTabScrollEdgeAfterLayout)) return;
        const rightEdge = this.getTabScrollRightEdge(scrollArea);
        const hasOverflow = rightEdge > 1;
        const canUpdatePreference = hasOverflow && (this.tabScrollHadStableOverflow || updateStableOverflow);
        if (updateStableOverflow) this.tabScrollHadStableOverflow = hasOverflow;
        if (!canUpdatePreference) return;
        if (scrollArea.scrollLeft <= 1) {
            this.tabScrollPositionPreference = { kind: 'edge', edge: 'left' };
        } else if (scrollArea.scrollLeft >= rightEdge - 1) {
            this.tabScrollPositionPreference = { kind: 'edge', edge: 'right' };
        } else {
            this.tabScrollPositionPreference = {
                kind: 'middle',
                ratio: Math.min(1, Math.max(0, scrollArea.scrollLeft / rightEdge)),
            };
        }
    }

    private applyTabScrollPositionPreference(scrollArea: HTMLElement): void {
        const rightEdge = this.getTabScrollRightEdge(scrollArea);
        const preference = this.tabScrollPositionPreference;
        const targetScrollLeft = preference.kind === 'edge'
            ? (preference.edge === 'right' ? rightEdge : 0)
            : Math.round(rightEdge * preference.ratio);
        if (Math.abs(scrollArea.scrollLeft - targetScrollLeft) <= 1) return;
        scrollArea.scrollLeft = targetScrollLeft;
    }

    private applyTabBarScrollPosition(scrollArea: HTMLElement, position: UiScrollPosition): void {
        const targetScrollLeft = Math.max(0, Math.min(this.getTabScrollRightEdge(scrollArea), position.scrollLeft));
        if (Math.abs(scrollArea.scrollLeft - targetScrollLeft) > 1) {
            scrollArea.scrollLeft = targetScrollLeft;
        }
        if (Math.abs(scrollArea.scrollTop - position.scrollTop) > 1) {
            scrollArea.scrollTop = Math.max(0, position.scrollTop);
        }
    }

    private getTabBarScrollPosition(): UiScrollPosition {
        const scrollArea = this.element.parentElement;
        if (!(scrollArea instanceof HTMLElement)) return {scrollLeft: 0, scrollTop: 0};
        return {
            scrollLeft: Math.max(0, Math.round(scrollArea.scrollLeft)),
            scrollTop: Math.max(0, Math.round(scrollArea.scrollTop)),
        };
    }

    scrollTabButtonIntoView(tabButton: TabButton, behavior: ScrollBehavior = 'smooth'): void {
        if (this.isTabRowsLayoutEnabled()) return;
        const scrollArea = this.element.parentElement;
        if (!(scrollArea instanceof HTMLElement)) return;
        const visibleWidth = Math.max(1, scrollArea.clientWidth - this.getToolbarWidthPx());
        const visibleLeft = scrollArea.scrollLeft;
        const visibleRight = visibleLeft + visibleWidth;
        const tabLeft = tabButton.element.offsetLeft;
        const tabRight = tabLeft + tabButton.element.getBoundingClientRect().width;
        let targetScrollLeft = scrollArea.scrollLeft;
        if (tabLeft < visibleLeft) {
            targetScrollLeft = tabLeft;
        } else if (tabRight > visibleRight) {
            targetScrollLeft = tabRight - visibleWidth;
        }
        const clamped = Math.max(0, Math.min(this.getTabScrollRightEdge(scrollArea), Math.round(targetScrollLeft)));
        if (Math.abs(scrollArea.scrollLeft - clamped) <= 1) return;
        scrollArea.scrollTo({left: clamped, behavior});
    }

    private getTabRowHeightPx(): number {
        const raw = getComputedStyle(document.documentElement).getPropertyValue('--tab-row-height').trim();
        const value = Number.parseFloat(raw);
        return Number.isFinite(value) && value > 0 ? value : 48;
    }

    private getTabViewportWidthPx(scrollArea: HTMLElement): number {
        const tabWidth = this.tabElement.getBoundingClientRect().width;
        const measuredWidth = Math.max(tabWidth, scrollArea.clientWidth);
        return Math.max(1, Math.floor(measuredWidth));
    }

    private getToolbarWidthPx(): number {
        const toolbar = this.tabElement.querySelector('.toolbar');
        if (!(toolbar instanceof HTMLElement)) return 0;
        return Math.max(0, Math.ceil(toolbar.getBoundingClientRect().width));
    }

    private isTabWrapEnabled(): boolean {
        const raw = getComputedStyle(document.documentElement).getPropertyValue('--tab-wrap-enabled').trim();
        return raw === '1' || raw === 'true';
    }

    private isSeparatePinnedTabRowsEnabled(): boolean {
        const raw = getComputedStyle(document.documentElement).getPropertyValue('--tab-separate-pinned-rows-enabled').trim();
        return raw === '1' || raw === 'true';
    }

    private shouldSeparatePinnedTabRows(): boolean {
        if (!this.isSeparatePinnedTabRowsEnabled()) return false;
        return this.tabButtons.some(tabButton => tabButton.isPinned())
            && this.tabButtons.some(tabButton => !tabButton.isPinned());
    }

    private isTabRowsLayoutEnabled(): boolean {
        return this.isTabWrapEnabled() || this.shouldSeparatePinnedTabRows();
    }

    private applyVisibleTabRowCount(value: number): void {
        document.documentElement.style.setProperty('--tab-visible-row-count', String(value));
    }

    /**
     * タブ状態マップを取得する（サブモジュール用）
     */
    getTabStates(): Map<string, TabState> {
        return this.tabStates;
    }

    /**
     * Editorインスタンスを取得する（サブモジュール用）
     */
    getEditor(): Editor {
        return this.editor;
    }

    /**
     * 現在アクティブなタブ名を取得する（サブモジュール用）
     */
    getActiveTabName(): string | false {
        if (!this.activeTabName) return false;
        return this.activeTabName;
    }

    private cloneUiScrollPosition(position: UiScrollPosition): UiScrollPosition {
        return {scrollLeft: position.scrollLeft, scrollTop: position.scrollTop};
    }

    private cloneUiSelectionState(selection: UiStoredSelectionState): UiStoredSelectionState {
        return {
            focus: {...selection.focus},
            range: {...selection.range},
        };
    }

    private cloneUiFormPanelState(state: UiStoredFormPanelState): UiStoredFormPanelState {
        return {
            navStack: state.navStack.map(page => ({...page})),
        };
    }

    private cloneUiEditorTableState(state: UiStoredEditorTableState): UiStoredEditorTableState {
        return {
            scroll: this.cloneUiScrollPosition(state.scroll),
            relationsPanelVisible: state.relationsPanelVisible,
            formPanel: state.formPanel === null ? null : this.cloneUiFormPanelState(state.formPanel),
            selection: this.cloneUiSelectionState(state.selection),
        };
    }

    private getStoredTabScrollPosition(name: string): UiScrollPosition | null {
        const diffTab = this.diffTabs.get(name);
        if (diffTab !== undefined) {
            return diffTab.getScrollPosition();
        }
        const viewPluginWrapper = this.viewPluginWrapperElements.get(name);
        if (viewPluginWrapper !== undefined) {
            return {
                scrollLeft: Math.max(0, Math.round(viewPluginWrapper.scrollLeft)),
                scrollTop: Math.max(0, Math.round(viewPluginWrapper.scrollTop)),
            };
        }
        const state = this.tabStates.get(name);
        if (state !== undefined) {
            if (state.wrapperElement.style.display === 'none') {
                return {
                    scrollLeft: Math.max(0, Math.round(state.savedScrollLeft)),
                    scrollTop: Math.max(0, Math.round(state.savedScrollTop)),
                };
            }
            return {
                scrollLeft: Math.max(0, Math.round(state.editorTable.getScrollLeft())),
                scrollTop: Math.max(0, Math.round(state.editorTable.getScrollTop())),
            };
        }
        const restored = this.restoredTabScrollPositions.get(name);
        return restored === undefined ? null : this.cloneUiScrollPosition(restored);
    }

    private connectDiffTabUiState(diffTabName: string, diffTab: DiffTab): void {
        diffTab.connectUiStateChangeListener(() => { this.persistTabs(); });
        const restoredScroll = this.restoredTabScrollPositions.get(diffTabName);
        if (restoredScroll !== undefined) {
            diffTab.restoreScrollPosition(restoredScroll.scrollTop, restoredScroll.scrollLeft);
        }
    }

    private getFormPanelStateForPersist(name: string, state: TabState): UiStoredFormPanelState | null {
        if (state.formPanelState === null) return null;
        if (this.activeTabName === name && this.currentFormPanel !== false) {
            const navStack = this.currentFormPanel.getNavStackSnapshot();
            return navStack.length > 0 ? {navStack: navStack.map(page => ({...page}))} : null;
        }
        return this.cloneUiFormPanelState(state.formPanelState);
    }

    private serializeEditorTableUiState(name: string): UiStoredEditorTableState | null {
        const state = this.tabStates.get(name);
        if (state === undefined) {
            const restored = this.restoredEditorTableStates.get(name);
            return restored === undefined ? null : this.cloneUiEditorTableState(restored);
        }

        const isVisible = state.wrapperElement.style.display !== 'none';
        const scroll = isVisible
            ? {
                scrollLeft: Math.max(0, Math.round(state.editorTable.getScrollLeft())),
                scrollTop: Math.max(0, Math.round(state.editorTable.getScrollTop())),
            }
            : {
                scrollLeft: Math.max(0, Math.round(state.savedScrollLeft)),
                scrollTop: Math.max(0, Math.round(state.savedScrollTop)),
            };
        const editorTableState: UiStoredEditorTableState = {
            scroll,
            relationsPanelVisible: state.relationsPanelVisible,
            formPanel: this.getFormPanelStateForPersist(name, state),
            selection: {
                focus: {...state.selection.getFocus()},
                range: {...state.selection.getRange()},
            },
        };
        this.restoredEditorTableStates.set(name, this.cloneUiEditorTableState(editorTableState));
        this.restoredTabScrollPositions.set(name, this.cloneUiScrollPosition(editorTableState.scroll));
        return editorTableState;
    }

    private bindEditorTableUiStatePersistence(wrapperElement: HTMLElement): void {
        const persist = () => { this.persistTabs(); };
        wrapperElement.addEventListener('editor-table-scroll-metrics-changed', persist);
        wrapperElement.addEventListener('editor-table-selection-changed', persist);
    }

    private cloneStoredFormPanelStateAsRuntime(state: UiStoredFormPanelState | null): FormPanelState | null {
        return state === null ? null : {
            navStack: state.navStack.map(page => ({...page})),
        };
    }

    private hasPendingNavigation(): boolean {
        return this.pendingNavigationPkValue !== ''
            || this.pendingNavigationBookmarkKey !== ''
            || this.pendingNavigationStoreRowIndex !== -1
            || this.pendingNavigationColumnIndex !== -1
            || this.pendingNavigationColumnName !== '';
    }

    private restoreEditorTableScrollPositionAfterLayout(state: TabState, scroll: UiScrollPosition): void {
        const scrollTop = Math.max(0, Math.round(scroll.scrollTop));
        const scrollLeft = Math.max(0, Math.round(scroll.scrollLeft));
        const apply = () => {
            if (state.wrapperElement.style.display === 'none') return;
            state.editorTable.restoreScrollPosition(scrollTop, scrollLeft);
            state.editorTable.forceVirtualScrollRecalculate();
            state.selection.updateRendererAfterResize();
            state.savedScrollTop = scrollTop;
            state.savedScrollLeft = scrollLeft;
            this.editor.syncActiveTableScrollState();
        };
        requestAnimationFrame(() => {
            apply();
            requestAnimationFrame(apply);
        });
    }

    private persistTabs(activeTabName: string | false | null = this.activeTabName): void {
        const open: UiStoredTab[] = [];
        for (const tabButton of this.tabButtons) {
            if (this.isTemporaryTabName(tabButton.name)) continue;
            if (tabButton.name.startsWith(DIFF_TAB_PREFIX)) {
                const diff = this.diffTabMetadata.get(tabButton.name);
                if (diff === undefined) continue;
                open.push({
                    name: tabButton.name,
                    description: null,
                    pinned: tabButton.isPinned(),
                    diff: {...diff},
                    view: null,
                    scroll: this.getStoredTabScrollPosition(tabButton.name),
                    editorTable: null,
                });
                continue;
            }
            if (this.isViewPluginTabName(tabButton.name)) {
                const pluginId = this.viewPluginIdsByTabName.get(tabButton.name);
                if (pluginId === undefined) continue;
                open.push({
                    name: tabButton.name,
                    description: tabButton.getDescriptionText(),
                    pinned: tabButton.isPinned(),
                    diff: null,
                    view: {pluginId},
                    scroll: this.getStoredTabScrollPosition(tabButton.name),
                    editorTable: null,
                });
                continue;
            }
            const editorTable = this.isPersistentSpecialTabName(tabButton.name)
                ? null
                : this.serializeEditorTableUiState(tabButton.name);
            open.push({
                name: tabButton.name,
                description: tabButton.getDescriptionText(),
                pinned: tabButton.isPinned(),
                diff: null,
                view: null,
                scroll: editorTable === null ? this.getStoredTabScrollPosition(tabButton.name) : this.cloneUiScrollPosition(editorTable.scroll),
                editorTable,
            });
        }

        this.uiStateStore.setTabs(
            open,
            activeTabName !== null && activeTabName !== false && this.isTemporaryTabName(activeTabName) ? false : activeTabName,
            this.getTabBarScrollPosition()
        );
    }

    private isTemporaryTabName(name: string): boolean {
        return name === DEBUG_API_DETAIL_TAB_NAME;
    }

    private isPersistentSpecialTabName(name: string): boolean {
        return name === SETTINGS_TAB_NAME || name === ER_DIAGRAM_TAB_NAME || name === TABLE_DEFINITION_TAB_NAME;
    }

    private isViewPluginTabName(name: string): boolean {
        return name.startsWith(VIEW_PLUGIN_TAB_PREFIX);
    }

    private isFullWidthSpecialTabName(name: string): boolean {
        return name === SETTINGS_TAB_NAME
            || name === ER_DIAGRAM_TAB_NAME
            || name === TABLE_DEFINITION_TAB_NAME
            || name === DEBUG_API_DETAIL_TAB_NAME
            || this.isViewPluginTabName(name)
            || name.startsWith(DIFF_TAB_PREFIX);
    }

    private syncSidebarSelectionForTab(name: string): void {
        if (this.isViewPluginTabName(name)) {
            this.sidebar.clearExplorerHighlight();
            const pluginId = this.viewPluginIdsByTabName.get(name);
            if (pluginId === undefined) {
                this.sidebar.clearViewPluginHighlight();
            } else {
                this.sidebar.highlightViewPlugin(pluginId);
            }
            return;
        }

        this.sidebar.clearViewPluginHighlight();
        if (this.isFullWidthSpecialTabName(name)) {
            this.sidebar.clearExplorerHighlight();
            return;
        }

        this.sidebar.highlightExplorerFile(name);
    }

    private clearSidebarSelection(): void {
        this.sidebar.clearExplorerHighlight();
        this.sidebar.clearViewPluginHighlight();
    }

    notifyTabOrderChanged(): void {
        this.persistTabs();
    }

    /**
     * アクティブタブ名を設定する（サブモジュール用）
     */
    setActiveTabNameInternal(name: string): void {
        this.activeTabName = name;
        this.persistTabs();
    }

    /**
     * REFERENCESパネルから子テーブルの特定行へナビゲーションする
     * 既にタブが開かれていればそのタブをアクティブにして行を選択し、
     * 開かれていなければタブを新規作成して読み込み完了後に行を選択する
     */
    navigateToTableRow(tableName: string, pkValue: string): void {
        // ジャンプ先テーブル名をブラウザ履歴に記録する（enableTabButton より前に push する）
        // goBack 時は前のエントリ（tab-switch 等）の state が返るため、previousTabName は不要
        this.navigationHistory.pushNavigateRow(tableName);
        const existingState = this.tabStates.get(tableName);
        if (existingState) {
            // 既存タブをアクティブにして行を選択
            this.enableTabButtonForNavigationJump(tableName);
            this.navigateToRow(existingState, pkValue);
            return;
        }
        // タブが未作成の場合: pendingNavigationPkValue を設定して新規タブを開く
        // navigateToTableRow 経由の場合 description は不明なので null で生成する
        this.pendingNavigationPkValue = pkValue;
        const tabButton = this.append(tableName, null);
        tabButton.click();
    }

    /**
     * 検索パネルからテーブルの特定セルへナビゲーションする
     * navigateToTableRow と同様だが、特定の列にフォーカスする
     */
    navigateToTableCell(tableName: string, pkValue: string, columnIndex: number): void {
        // ジャンプ先テーブル名をブラウザ履歴に記録する（enableTabButton より前に push する）
        // goBack 時は前のエントリ（tab-switch 等）の state が返るため、previousTabName は不要
        this.navigationHistory.pushNavigateCell(tableName);
        const existingState = this.tabStates.get(tableName);
        if (existingState) {
            this.enableTabButtonForNavigationJump(tableName);
            this.navigateToCell(existingState, pkValue, columnIndex);
            return;
        }
        // タブが未作成の場合: pendingNavigationを設定して新規タブを開く
        // navigateToTableCell 経由の場合 description は不明なので null で生成する
        this.pendingNavigationPkValue = pkValue;
        this.pendingNavigationColumnIndex = columnIndex;
        const tabButton = this.append(tableName, null);
        tabButton.click();
    }

    /**
     * ValidationPanel 用: ストア行インデックスとストア列インデックスでセルへナビゲーションする。
     * PKが複合主キーの場合や、PK重複が存在する場合でも対象行を一意に選択できる。
     */
    navigateToTableStoreCell(tableName: string, storeRowIndex: number, storeColumnIndex: number): void {
        this.navigationHistory.pushNavigateCell(tableName);
        const existingState = this.tabStates.get(tableName);
        if (existingState) {
            this.enableTabButtonForNavigationJump(tableName);
            this.navigateToStoreCell(existingState, storeRowIndex, storeColumnIndex);
            return;
        }
        this.pendingNavigationStoreRowIndex = storeRowIndex;
        this.pendingNavigationColumnIndex = storeColumnIndex;
        const tabButton = this.append(tableName, null);
        tabButton.click();
    }

    /**
     * FK参照ジャンプ用: 参照先テーブルの特定列の値が一致する行を開き、その列にフォーカスする。
     * PK値ではなく参照先列の値（例: group_id=1）で行を検索する。
     * 動的参照の逆参照ジャンプでは filterColumnName / filterValues で1段目の列値も一致する行に絞り込む。
     * 単純参照・順方向ジャンプでは空文字列・空Setを渡すこと。
     */
    navigateToTableColumnValue(tableName: string, columnName: string, value: string, filterColumnName: string, filterValues: ReadonlySet<string>): void {
        this.navigationHistory.pushNavigateCell(tableName);
        const existingState = this.tabStates.get(tableName);
        if (existingState) {
            this.enableTabButtonForNavigationJump(tableName);
            this.navigateToCellByColumnValue(existingState, columnName, value, filterColumnName, filterValues);
            return;
        }
        // タブが未作成の場合: pendingNavigation を設定して新規タブを開く
        this.pendingNavigationPkValue = value;
        this.pendingNavigationColumnName = columnName;
        this.pendingNavigationFilterColumnName = filterColumnName;
        this.pendingNavigationFilterValues = filterValues;
        const tabButton = this.append(tableName, null);
        tabButton.click();
    }

    /**
     * EditorTableの全行を走査し、PK値が一致する行を選択状態にする
     */
    private navigateToRow(state: TabState, pkValue: string): void {
        const editorTable = state.editorTable;
        const rowCount = editorTable.getLogicalRowCount();
        for (let r = 1; r < rowCount; r++) {
            if (editorTable.getRowPkValue(r) === pkValue) {
                state.selection.setRange(r, 1, r, 1);
                state.selection.move(r, 1);
                state.selection.scrollFocusToCenterVertically();
                // サイドバー等からのジャンプでフォーカスが移動した場合でも確実にフォーカスを戻す
                state.editorTableHandler.activate();
                return;
            }
        }
    }

    /**
     * EditorTableの全行を走査し、PK値が一致する行の特定列を選択状態にする
     */
    private navigateToCell(state: TabState, pkValue: string, columnIndex: number): void {
        const editorTable = state.editorTable;
        const rowCount = editorTable.getLogicalRowCount();
        // columnIndex はCSVの0始まり列 → DOM上は column + 1
        const col = columnIndex + editorTable.dataColumnOffset();
        for (let r = 1; r < rowCount; r++) {
            if (editorTable.getRowPkValue(r) === pkValue) {
                state.selection.setRange(r, col, r, col);
                state.selection.move(r, col);
                state.selection.scrollFocusToCenterVertically();
                // サイドバー等からのジャンプでフォーカスが移動した場合でも確実にフォーカスを戻す
                state.editorTableHandler.activate();
                return;
            }
        }
    }

    /**
     * ブックマーク行キーが一致する行のセルを選択状態にする。
     * 単一PKではPK値そのもの、複合PKでは全PK構成列をタブ区切りで連結したキーを使う。
     */
    private navigateToBookmarkCell(state: TabState, rowKey: string, columnIndex: number): void {
        const editorTable = state.editorTable;
        const rowCount = editorTable.getLogicalRowCount();
        const col = columnIndex !== -1 ? columnIndex + editorTable.dataColumnOffset() : 1;
        for (let r = 1; r < rowCount; r++) {
            if (editorTable.getRowBookmarkKey(r) === rowKey) {
                state.selection.setRange(r, col, r, col);
                state.selection.move(r, col);
                state.selection.scrollFocusToCenterVertically();
                state.editorTableHandler.activate();
                return;
            }
        }
    }

    /**
     * EditorTableのストア行・列インデックスから対象セルを選択状態にする。
     */
    private navigateToStoreCell(state: TabState, storeRowIndex: number, storeColumnIndex: number): void {
        const editorTable = state.editorTable;
        const domRow = editorTable.storeRowToDomRow(storeRowIndex);
        if (domRow === null) return;
        const dataColumnIndex = storeColumnIndex >= 0
            ? editorTable.getTableData().columnMapping.indexOf(storeColumnIndex)
            : -1;
        const domCol = (dataColumnIndex !== -1 ? dataColumnIndex : 0) + editorTable.dataColumnOffset();
        state.selection.setRange(domRow, domCol, domRow, domCol);
        state.selection.move(domRow, domCol);
        state.selection.scrollFocusToCenterVertically();
        state.editorTableHandler.activate();
    }

    /**
     * EditorTableの全行を走査し、指定列名の値が一致する最初の行を見つけてその列にフォーカスする。
     * FK参照ジャンプ用（参照先列がPKでない場合にPK検索では見つからないため列値で検索する）。
     * 動的参照の逆参照ジャンプでは filterColumnName / filterValues で1段目の列値も一致する行に絞り込む。
     */
    private navigateToCellByColumnValue(state: TabState, columnName: string, value: string, filterColumnName: string, filterValues: ReadonlySet<string>): void {
        const editorTable = state.editorTable;
        if (getAppliedSettings().referenceJumpTemporaryFilterEnabled) {
            this.applyTemporaryNavigationFilter(state, columnName, value, filterColumnName, filterValues);
        }
        const rowCount = editorTable.getLogicalRowCount();
        for (let r = 1; r < rowCount; r++) {
            if (editorTable.getCellValueByColumnName(r, columnName) !== value) continue;
            // 動的参照の逆参照ジャンプ: 1段目の列値（例: table_id）もチェックして
            // 同じFK値を持つ別テーブル参照行を除外する
            if (filterColumnName !== '' && filterValues.size > 0) {
                const filterValue = editorTable.getCellValueByColumnName(r, filterColumnName);
                if (!filterValues.has(filterValue)) continue;
            }
            const columnIndex = this.resolveColumnIndex(state.editorTable.tableName, columnName);
            const col = columnIndex !== -1 ? columnIndex + editorTable.dataColumnOffset() : 1;
            state.selection.setRange(r, col, r, col);
            state.selection.move(r, col);
            state.selection.scrollFocusToCenterVertically();
            state.editorTableHandler.activate();
            return;
        }
    }

    private applyTemporaryNavigationFilter(state: TabState, columnName: string, value: string, filterColumnName: string, filterValues: ReadonlySet<string>): void {
        const filters: SerializedFilters = {};
        filters[columnName] = [value];
        if (filterColumnName !== '' && filterValues.size > 0 && filterColumnName !== columnName) {
            filters[filterColumnName] = Array.from(filterValues);
        }
        state.editorTable.applyTemporaryFilterState(filters);
    }

    /**
     * テーブルの列名からCSV列インデックス（0始まり）を解決する
     * EditorTableが開かれていればそのヘッダーから、未開であればストアのヘッダーから解決する
     * 見つからない場合は -1 を返す
     */
    resolveColumnIndex(tableName: string, columnName: string): number {
        // 開かれているEditorTableからヘッダーを取得する
        const editorTable = this.openEditorTables.get(tableName);
        if (editorTable) {
            const colCount = editorTable.getColumnCount();
            for (let i = 0; i < colCount; i++) {
                if (editorTable.getColumnHeaderValue(i) === columnName) return i;
            }
            return -1;
        }
        // ストアからヘッダーを取得する
        const header = this.store.getHeader(tableName);
        if (header !== false) {
            return header.indexOf(columnName);
        }
        return -1;
    }

    /**
     * ブックマーク一覧を取得する（コマンドパレット用）
     */
    getBookmarks(): BookmarkEntry[] {
        return this.sidebar.getBookmarks();
    }

    /**
     * ブックマーク先のテーブル・セルにジャンプする（BookmarkPanel / CommandPalette 共通ロジック）
     * columnName からテーブルヘッダーの列インデックスを解決し、ブックマーク用行キーで対象行を探す。
     * 列が見つからない場合は行単位でジャンプする（スキーマ変更でカラムが消えた場合のフォールバック）。
     */
    navigateToBookmark(tableName: string, rowKey: string, columnName: string): void {
        const columnIndex = this.resolveColumnIndex(tableName, columnName);
        if (columnIndex !== -1) {
            this.navigationHistory.pushNavigateCell(tableName);
        } else {
            this.navigationHistory.pushNavigateRow(tableName);
        }
        const existingState = this.tabStates.get(tableName);
        if (existingState) {
            this.enableTabButtonForNavigationJump(tableName);
            this.navigateToBookmarkCell(existingState, rowKey, columnIndex);
            return;
        }
        this.pendingNavigationBookmarkKey = rowKey;
        this.pendingNavigationColumnIndex = columnIndex;
        const tabButton = this.append(tableName, null);
        tabButton.click();
    }

    /**
     * タブ読み込み完了後のpendingNavigationを消費する
     * navigateToTableRow / navigateToTableCell / navigateToTableColumnValue で設定された
     * 保留ナビゲーションを実行し、フィールドをリセットする
     */
    consumePendingNavigation(state: TabState): void {
        if (this.pendingNavigationPkValue === '' && this.pendingNavigationBookmarkKey === '' && this.pendingNavigationStoreRowIndex === -1) return;
        if (this.pendingNavigationStoreRowIndex !== -1) {
            this.navigateToStoreCell(state, this.pendingNavigationStoreRowIndex, this.pendingNavigationColumnIndex);
            this.pendingNavigationStoreRowIndex = -1;
            this.pendingNavigationColumnIndex = -1;
        } else if (this.pendingNavigationBookmarkKey !== '') {
            this.navigateToBookmarkCell(state, this.pendingNavigationBookmarkKey, this.pendingNavigationColumnIndex);
            this.pendingNavigationBookmarkKey = '';
            this.pendingNavigationColumnIndex = -1;
        } else if (this.pendingNavigationColumnName !== '') {
            this.navigateToCellByColumnValue(
                state, this.pendingNavigationColumnName, this.pendingNavigationPkValue,
                this.pendingNavigationFilterColumnName, this.pendingNavigationFilterValues
            );
            this.pendingNavigationColumnName = '';
            this.pendingNavigationFilterColumnName = '';
            this.pendingNavigationFilterValues = new Set();
        } else if (this.pendingNavigationColumnIndex !== -1) {
            this.navigateToCell(state, this.pendingNavigationPkValue, this.pendingNavigationColumnIndex);
            this.pendingNavigationColumnIndex = -1;
        } else {
            this.navigateToRow(state, this.pendingNavigationPkValue);
        }
        this.pendingNavigationPkValue = '';
    }

    /**
     * タブに要素を追加します。
     *
     * すでに追加されている名前だった場合は何もせず、その要素を返却します。
     * description は TabButton の2行表示に使用します（null の場合は1行表示）。
     */
    append(name: string, description: string | null, pinned: boolean = false) {

        // すでに同じ名前のオブジェクトが追加されていたら何もしないです。
        let tabButton = this.tabButtons.find(x => x.name === name);
        if (tabButton) {
            return tabButton;
        }

        tabButton = new TabButton(this.editor, this, name, description, pinned);
        const insertIndex = this.getTabButtonInsertIndexForPinnedState(pinned);
        this.insertTabButtonAt(tabButton, insertIndex);
        this.scheduleTabLayout(true);
        this.persistTabs();

        return tabButton;
    }

    private getTabButtonInsertIndexForPinnedState(pinned: boolean): number {
        if (!pinned) return this.tabButtons.length;
        const firstUnpinnedIndex = this.tabButtons.findIndex(tabButton => !tabButton.isPinned());
        return firstUnpinnedIndex === -1 ? this.tabButtons.length : firstUnpinnedIndex;
    }

    private insertTabButtonAt(tabButton: TabButton, insertIndex: number): void {
        const index = Math.min(Math.max(0, insertIndex), this.tabButtons.length);
        this.tabButtons.splice(index, 0, tabButton);
        const referenceElement = this.tabButtons[index + 1]?.element ?? null;
        this.element.insertBefore(tabButton.element, referenceElement);
    }

    private repositionTabButtonForPinnedState(tabButton: TabButton): void {
        const currentIndex = this.tabButtons.findIndex(item => item.name === tabButton.name);
        if (currentIndex === -1) return;
        this.tabButtons.splice(currentIndex, 1);
        const insertIndex = this.getTabButtonInsertIndexForPinnedState(tabButton.isPinned());
        this.insertTabButtonAt(tabButton, insertIndex);
    }

    async restoreTabsFromUiStateAsync(tabs: UiTabsState): Promise<void> {
        this.restoringTabsFromUiState = true;
        this.pendingTabBarScrollPosition = this.cloneUiScrollPosition(tabs.scroll);
        try {
            const restoredTabs: UiStoredTab[] = tabs.open.map(tab => ({
                name: tab.name,
                description: tab.description,
                pinned: tab.pinned,
                diff: tab.diff === null ? null : {...tab.diff},
                view: tab.view === null ? null : {...tab.view},
                scroll: tab.scroll === null ? null : this.cloneUiScrollPosition(tab.scroll),
                editorTable: tab.editorTable === null ? null : this.cloneUiEditorTableState(tab.editorTable),
            }));
            if (tabs.active !== null && !restoredTabs.some(tab => tab.name === tabs.active)) {
                restoredTabs.push({ name: tabs.active, description: null, pinned: false, diff: null, view: null, scroll: null, editorTable: null });
            }

            const restoredNames = new Set<string>();
            for (const tab of restoredTabs) {
                const name = tab.name;
                if (this.isTemporaryTabName(name)) continue;
                if (tab.view !== null) {
                    if (!this.isViewPluginTabName(name) || tab.diff !== null) continue;
                    if (this.viewPluginTabNamesById.has(tab.view.pluginId)) continue;
                    if (tab.scroll !== null) {
                        this.restoredTabScrollPositions.set(name, this.cloneUiScrollPosition(tab.scroll));
                    }
                    this.viewPluginTabNamesById.set(tab.view.pluginId, name);
                    this.viewPluginIdsByTabName.set(name, tab.view.pluginId);
                    this.append(name, tab.description, tab.pinned);
                    restoredNames.add(name);
                    continue;
                }
                if (this.isViewPluginTabName(name)) continue;
                if (name.startsWith(DIFF_TAB_PREFIX) && tab.diff === null) continue;
                if (tab.diff !== null && !name.startsWith(DIFF_TAB_PREFIX)) continue;
                if (tab.scroll !== null) {
                    this.restoredTabScrollPositions.set(name, this.cloneUiScrollPosition(tab.scroll));
                }
                if (tab.editorTable !== null) {
                    this.restoredEditorTableStates.set(name, this.cloneUiEditorTableState(tab.editorTable));
                    this.restoredTabScrollPositions.set(name, this.cloneUiScrollPosition(tab.editorTable.scroll));
                }
                if (tab.diff !== null) {
                    this.diffTabMetadata.set(name, {...tab.diff});
                }
                this.append(name, tab.description, tab.pinned);
                restoredNames.add(name);
            }

            if (tabs.active !== null && restoredNames.has(tabs.active)) {
                if (tabs.active.startsWith(DIFF_TAB_PREFIX)) {
                    const opened = await this.openRestoredDiffTabAsync(tabs.active);
                    if (!opened) {
                        this.removeTabButton(tabs.active);
                    }
                    return;
                }

                if (this.viewPluginIdsByTabName.has(tabs.active)) {
                    this.pendingRestoredViewPluginActiveTabName = tabs.active;
                    return;
                }

                if (this.isPersistentSpecialTabName(tabs.active)) {
                    this.enableTabButton(tabs.active);
                    return;
                }

                const opened = await this.openTableAsync(tabs.active);
                if (!opened) {
                    this.removeTabButton(tabs.active);
                }
                return;
            }

            this.persistTabs();
        } finally {
            this.restoringTabsFromUiState = false;
            this.pendingTabBarScrollPosition = this.cloneUiScrollPosition(tabs.scroll);
            this.scheduleTabLayout(false);
        }
    }

    private async openRestoredDiffTabAsync(diffTabName: string): Promise<boolean> {
        if (this.diffTabs.has(diffTabName)) {
            this.enableTabButton(diffTabName);
            return true;
        }

        const metadata = this.diffTabMetadata.get(diffTabName);
        if (metadata === undefined) return false;
        if (this.loadingDiffTabNames.has(diffTabName)) return true;

        this.loadingDiffTabNames.add(diffTabName);
        try {
            const restored = await this.resolveRestoredGitDiffEntryAsync(metadata);
            if (restored === null) return false;

            const {entry, isStaged} = restored;
            const tableName = entry.tableName;
            if (entry.isNew) {
                const [schemaJson, currentCsv] = await Promise.all([
                    readFileAsync(`schema/${tableName}.json`),
                    readFileAsync(`data/${tableName}.csv`),
                ]);
                const headerOnlyCsv = this.buildHeaderOnlyCsv(schemaJson);
                this.openDiffTab(tableName, isStaged, schemaJson, headerOnlyCsv, currentCsv, entry.path, null, null, entry.isNew);
                return true;
            }

            const [schemaJson, currentCsv, headCsv] = await Promise.all([
                readFileAsync(`schema/${tableName}.json`),
                readFileAsync(`data/${tableName}.csv`),
                gitShowFreshAsync(entry.path),
            ]);
            this.openDiffTab(tableName, isStaged, schemaJson, headCsv, currentCsv, entry.path, null, null, entry.isNew);
            return true;
        } catch (error: unknown) {
            console.error('[Tab] openRestoredDiffTabAsync failed:', error);
            this.notification.show('Git差分タブの復元に失敗しました');
            return false;
        } finally {
            this.loadingDiffTabNames.delete(diffTabName);
        }
    }

    private async resolveRestoredGitDiffEntryAsync(metadata: UiStoredDiffTab): Promise<{entry: GitStatusEntry; isStaged: boolean} | null> {
        const status = await gitStatusAsync();
        const primary = metadata.isStaged ? status.staged : status.changes;
        const secondary = metadata.isStaged ? status.changes : status.staged;

        const primaryEntry = this.findGitStatusEntry(primary, metadata);
        if (primaryEntry !== null) return {entry: primaryEntry, isStaged: metadata.isStaged};

        const secondaryEntry = this.findGitStatusEntry(secondary, metadata);
        if (secondaryEntry !== null) return {entry: secondaryEntry, isStaged: !metadata.isStaged};

        return null;
    }

    private findGitStatusEntry(entries: GitStatusEntry[], metadata: UiStoredDiffTab): GitStatusEntry | null {
        const pathMatch = entries.find(entry => entry.path === metadata.gitPath);
        if (pathMatch !== undefined) return pathMatch;
        const tableMatch = entries.find(entry => entry.tableName === metadata.tableName);
        return tableMatch ?? null;
    }

    private buildHeaderOnlyCsv(schemaJson: string): string {
        const schema = JSON.parse(schemaJson) as { header: { name: string }[] };
        return schema.header.map(col => col.name).join(',');
    }

    /**
     * 指定名のタブを閉じる
     * タブが開かれていない場合は何もしない。
     * dirty 状態の場合は確認ダイアログを表示し、ユーザーの確認後にクローズを実行する。
     */
    closeTab(name: string): void {
        const tabButton = this.tabButtons.find(x => x.name === name);
        if (!tabButton) return;

        // ダイアログ表示中は別タブの閉じ操作を無視する（多重ダイアログ防止）
        // DOMがSSOTのため、オーバーレイ要素の存在で判定する
        if (document.querySelector('.close-confirm-overlay')) return;

        // dirty 状態のタブは確認ダイアログを表示してからクローズする
        if (tabButton.isDirty()) {
            this.showCloseConfirmDialog(name);
            return;
        }

        this.performCloseTab(name);
    }

    /**
     * タブの実際のクローズ処理。
     * closeTab() の非 dirty パスと、確認ダイアログの「閉じる」ボタンの2箇所から呼ばれるため
     * private メソッドとして抽出している。
     * name のみを受け取り、tabButton は内部で解決する。
     * ダイアログ表示中にタブが別経路で閉じられる理論的可能性を考慮し、
     * tabButton が見つからない場合は防御的に return する。
     */
    private performCloseTab(name: string): void {
        const tabButton = this.tabButtons.find(x => x.name === name);
        if (!tabButton) return;

        const wasActive = tabButton.element.classList.contains('tab-button-active');
        const prev = this.findPrevTabButton(name);
        const next = this.findNextTabButton(name);

        this.removeTabButton(name);

        // テーブルクローズイベントを発火する（特殊タブは通常テーブルではないため除外する）
        if (this.editorApi !== false && !this.isFullWidthSpecialTabName(name)) {
            this.editorApi.emitTableClosed(name);
        }

        // 設定タブが閉じられた場合: DOM からラッパー要素を除去してフィールドをリセットする
        // これにより次回 openSettingsTab() 時に新しい SettingsPanel が正しく生成される。
        // wasActive に関わらず実行する（非アクティブ状態で閉じた場合もクリーンアップが必要なため）。
        // leaveSettingsMode() は設定タブがアクティブだった場合のみ呼ぶ
        // （非アクティブなら既に通常タブが表示されており rightSlot は復元済みのため）。
        if (name === SETTINGS_TAB_NAME) {
            if (wasActive) {
                this.editor.leaveSettingsMode();
            }
            if (this.settingsPanel !== false) {
                this.settingsPanel.destroy();
            }
            if (this.settingsWrapperElement !== false) {
                this.settingsWrapperElement.remove();
            }
            this.settingsPanel = false;
            this.settingsWrapperElement = false;
        }

        // ER図タブが閉じられた場合: document リスナーを解除し DOM からラッパー要素を除去してフィールドをリセットする
        if (name === ER_DIAGRAM_TAB_NAME) {
            if (wasActive) {
                this.editor.leaveSettingsMode();
            }
            if (this.erDiagramTab !== false) {
                this.erDiagramTab.destroy();
            }
            if (this.erDiagramWrapperElement !== false) {
                this.erDiagramWrapperElement.remove();
            }
            this.erDiagramTab = false;
            this.erDiagramWrapperElement = false;
        }

        // テーブル定義タブが閉じられた場合: document リスナー・インジケーター要素を解放し DOM からラッパー要素を除去してフィールドをリセットする
        if (name === TABLE_DEFINITION_TAB_NAME) {
            if (wasActive) {
                this.editor.leaveSettingsMode();
            }
            if (this.tableDefinitionEditor !== false) {
                this.tableDefinitionEditor.destroy();
            }
            if (this.tableDefinitionWrapperElement !== false) {
                this.tableDefinitionWrapperElement.remove();
            }
            this.tableDefinitionEditor = false;
            this.tableDefinitionWrapperElement = false;
        }

        // API詳細タブが閉じられた場合: DOM からラッパー要素を除去してフィールドをリセットする
        if (name === DEBUG_API_DETAIL_TAB_NAME) {
            if (wasActive) {
                this.editor.leaveSettingsMode();
            }
            if (this.debugApiDetailTab !== false) {
                this.debugApiDetailTab.remove();
            }
            if (this.debugApiDetailWrapperElement !== false) {
                this.debugApiDetailWrapperElement.remove();
            }
            this.debugApiDetailTab = false;
            this.debugApiDetailWrapperElement = false;
            this.pendingDebugApiDetail = null;
        }

        // Viewプラグインタブが閉じられた場合: マウント解除して DOM からラッパーを除去する
        if (this.isViewPluginTabName(name)) {
            if (wasActive) {
                this.editor.leaveSettingsMode();
                this.activeTabName = false;
            }
            this.destroyViewPluginTab(name);
        }

        // 差分タブが閉じられた場合: 対象の DiffTab を破棄してマップから除去する
        if (name.startsWith(DIFF_TAB_PREFIX)) {
            if (wasActive) {
                this.editor.leaveSettingsMode();
                this.activeTabName = false;
            }
            const diffTabToDestroy = this.diffTabs.get(name);
            if (diffTabToDestroy !== undefined) {
                diffTabToDestroy.destroy(this.store);
                this.diffTabs.delete(name);
            }
            this.diffTabMetadata.delete(name);
            this.loadingDiffTabNames.delete(name);
        }

        if (!wasActive) return;
        if (next) { this.enableTabButton(next.name); return; }
        if (prev) { this.enableTabButton(prev.name); return; }
        // アクティブだったタブを閉じて他にタブがない場合、サイドバーの選択状態をクリアする
        this.clearSidebarSelection();
        this.persistTabs(false);
    }

    /**
     * dirty 状態のタブを閉じる確認ダイアログを表示する。
     * 「閉じる」で performCloseTab を実行、「キャンセル」またはオーバーレイクリックでダイアログを閉じる。
     */
    private showCloseConfirmDialog(name: string): void {
        // オーバーレイ
        const overlay = document.createElement('div');
        overlay.classList.add('close-confirm-overlay');

        // ダイアログ本体
        const dialog = document.createElement('div');
        dialog.classList.add('close-confirm-dialog');

        // メッセージ
        const message = document.createElement('div');
        message.classList.add('close-confirm-message');
        message.textContent = `「${name}」には未保存の変更があります。閉じてもよろしいですか？`;
        dialog.appendChild(message);

        // ボタンコンテナ
        const buttons = document.createElement('div');
        buttons.classList.add('close-confirm-buttons');

        // キャンセルボタン
        const cancelButton = document.createElement('button');
        cancelButton.classList.add('close-confirm-button-cancel');
        cancelButton.textContent = 'キャンセル';
        buttons.appendChild(cancelButton);

        // 閉じるボタン
        const closeButton = document.createElement('button');
        closeButton.classList.add('close-confirm-button-close');
        closeButton.textContent = '閉じる';
        buttons.appendChild(closeButton);

        dialog.appendChild(buttons);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        // ダイアログを表示する
        overlay.classList.add('visible');

        // ダイアログを閉じる共通処理（DOM除去とキャプチャフェーズのイベントリスナー解除を一括で行う）
        const dismissDialog = () => {
            document.removeEventListener('keydown', onKeyDown, true);
            overlay.remove();
        };

        // 「閉じる」ボタン: 確認後にタブをクローズする
        // Enter キーは closeButton にフォーカスが当たっているためブラウザ標準の click イベントで発火する
        closeButton.addEventListener('click', () => {
            dismissDialog();
            this.performCloseTab(name);
        });

        // 「キャンセル」ボタン: ダイアログを閉じるだけ
        cancelButton.addEventListener('click', () => {
            dismissDialog();
        });

        // オーバーレイ背景クリック: キャンセルと同じ動作
        overlay.addEventListener('click', (ev: MouseEvent) => {
            if (ev.target === overlay) {
                dismissDialog();
            }
        });

        // キーボード操作: キャプチャフェーズで全キーを遮断し、グローバルショートカット（Ctrl+S, Ctrl+P 等）の貫通を防ぐ
        // Escape のみダイアログ閉じとして処理する
        // Enter は closeButton.focus() により click イベント経由で処理されるため、ここでは遮断のみ行う
        const onKeyDown = (ev: KeyboardEvent) => {
            if (ev.key === 'Escape') {
                ev.preventDefault();
                ev.stopPropagation();
                dismissDialog();
                return;
            }
            // Escape 以外の全キーイベントを遮断してグローバルショートカットの貫通を防ぐ
            ev.preventDefault();
            ev.stopPropagation();
        };
        document.addEventListener('keydown', onKeyDown, true);

        // 「閉じる」ボタンにフォーカスを当てて Enter で確認できるようにする
        closeButton.focus();
    }

    findNextTabButton(name: string): TabButton | false {
        const index = this.tabButtons.findIndex(x => x.name === name);
        if (index === -1 || index >= this.tabButtons.length - 1) return false;
        return this.tabButtons[index + 1];
    }

    findPrevTabButton(name: string): TabButton | false {
        const index = this.tabButtons.findIndex(x => x.name === name);
        if (index <= 0) return false;
        return this.tabButtons[index - 1];
    }

    removeTabButton(name: string) {
        this.restoredTabScrollPositions.delete(name);
        this.restoredEditorTableStates.delete(name);
        const index = this.tabButtons.findIndex(x => x.name === name);
        if (index !== -1) {
            // DOMからタブボタン要素を除去する（差分タブは tabStates に登録されないため
            // state.wrapperElement.remove() が呼ばれず、ここで除去しないとDOMに残存する）
            this.tabButtons[index].element.remove();
            this.tabButtons.splice(index, 1);
            this.scheduleTabLayout();
        }

        if (name.startsWith(DIFF_TAB_PREFIX)) {
            this.diffTabMetadata.delete(name);
            this.loadingDiffTabNames.delete(name);
        }

        // タブ状態のクリーンアップ
        const state = this.tabStates.get(name);
        if (state) {
            if (this.activeTabName === name) {
                state.formPanelState = null;
                this.removeCurrentFormPanel();
            }

            // 未保存の変更があるかを閉じる前に確認
            const wasDirty = state.history.isDirty();

            // グローバルイベントリスナーを解除
            state.editorTable.deactivate();
            state.areaResizer.deactivate();
            state.fillController.deactivate();
            state.editorTableHandler.deactivate();

            // HistoryをストアのDirtyレジストリから登録解除する。
            // destroyMiniEditorTables（unregisterTable → history.unregister()）とは逆順。
            // タブ閉じ時は自分のHistoryを先に除去することで、isTableDirty() が
            // 残りのHistory（ミニテーブル等）のみを評価するようにする。
            // 「タブのみDirty、ミニテーブルなし」→ isTableDirty=false → 全データ削除（正しい）
            // 「タブもミニテーブルもDirty」→ isTableDirty=true → データ保持 → reloadTableDataAsync（正しい）
            state.history.unregister();

            // 中央ストアからテーブルデータを解除する
            this.store.unregisterTable(name);

            // DOMを削除
            state.wrapperElement.remove();

            // 状態を削除
            this.tabStates.delete(name);

            // 開いているテーブルのマップから削除
            this.openEditorTables.delete(name);

            // 未保存のタブを閉じた場合、アクティブタブの参照ヒントをCSVから再読み込みする
            if (wasDirty) {
                if (this.store.hasTable(name)) {
                    // ミニEditorTableのrefCountによりストアにデータが残っている場合：
                    // CSV原本に巻き戻してからキャッシュを除去し、参照ヒントを再構築する
                    this.store.reloadTableDataAsync(name).then(() => {
                        this.referenceDataCache.evictEntry(name);
                        if (this.activeTabName && this.activeTabName !== name) {
                            const activeState = this.tabStates.get(this.activeTabName);
                            if (activeState) {
                                this.reference.refreshReferenceHints(this.activeTabName, activeState);
                            }
                        }
                    }).catch((e: unknown) => { throw new Error('[Tab] reloadTableDataAsync failed: ' + String(e)); });
                } else if (this.activeTabName && this.activeTabName !== name) {
                    // ストアからデータが削除済みの場合はキャッシュ除去のみ行い、参照ヒントを再構築する
                    const activeState = this.tabStates.get(this.activeTabName);
                    if (activeState) {
                        this.reference.refreshReferenceHints(this.activeTabName, activeState);
                    }
                }
            }
        }

        // アクティブタブが削除された場合はリレーションパネルの接続を解除してクリアする
        if (this.activeTabName === name) {
            this.relationsPanel.disconnectEditorTable();
            // アクティブタブ閉じ時は this.paneStack に追加RP（[2]以降）が残っているため破棄する
            // （deactivateTabState() が呼ばれていないため state.paneStack には保存されていない）
            this.destroyExtraRelationsPanels(this.paneStack);
            this.paneStack = [];
            this.activeTabName = false;
        } else if (state) {
            // 非アクティブタブ閉じ時は state.paneStack に保存された追加RP（[2]以降）を破棄する
            // （deactivateTabState() で suspend() のみで保持されているため、ここで完全破棄する）
            this.destroyExtraRelationsPanels(state.paneStack);
        }

        this.persistTabs();
    }

    /**
     * ペインスタックの追加RP（[2]以降）を完全破棄する。
     * アクティブタブ閉じ時（this.paneStack）と非アクティブタブ閉じ時（state.paneStack）の
     * 両パスで同一の破棄ロジックが必要なため共通メソッドとして抽出する。
     */
    private destroyExtraRelationsPanels(stack: Array<{ element: HTMLElement; panel: RelationsPanel | false }>): void {
        for (let i = stack.length - 1; i >= 2; i--) {
            const entry = stack[i];
            if (entry.panel !== false) {
                entry.panel.disconnectEditorTable();
                if (entry.element.parentElement) {
                    entry.element.remove();
                }
            }
        }
    }

    enableTabButton(name: string): void {
        const existingState = this.activateTabButton(name);
        if (existingState === null) return;
        this.restoreEditorTableScrollPositionAfterLayout(existingState, {
            scrollLeft: existingState.savedScrollLeft,
            scrollTop: existingState.savedScrollTop,
        });
    }

    private enableTabButtonForNavigationJump(name: string): void {
        this.activateTabButton(name);
    }

    private activateTabButton(name: string): TabState | null {

        // ちょっと面倒なので、一回全部無効な状態にします。
        this.tabButtons.forEach(x => x.disable());

        // 同じ名前のelementをactiveにします。
        const tabButton = this.tabButtons.find(x => x.name === name);
        if (!tabButton) {
            // アクティブにする対象がいなかったら何もしないです。
            return null;
        }

        // タブを有効化し、タブボタンが可視領域外であればスクロールして表示する
        tabButton.enable();
        tabButton.scrollIntoViewIfNeeded();

        // サイドバーの選択状態をアクティブタブに同期する
        this.syncSidebarSelectionForTab(name);

        // 差分タブは EditorTable を持たない特殊タブのため専用の有効化処理を行う
        if (name.startsWith(DIFF_TAB_PREFIX)) {
            if (!this.diffTabs.has(name)) {
                this.openRestoredDiffTabAsync(name).then((opened) => {
                    if (!opened) this.removeTabButton(name);
                }).catch((error: unknown) => {
                    console.error('[Tab] enableTabButton: lazy diff restore failed:', error);
                    this.removeTabButton(name);
                });
                return null;
            }
            this.activateDiffTab(name);
            return null;
        }

        // ER図タブは EditorTable を持たない特殊タブのため専用の有効化処理を行う
        if (name === ER_DIAGRAM_TAB_NAME) {
            this.activateErDiagramTab();
            return null;
        }

        // 設定タブは EditorTable を持たない特殊タブのため専用の有効化処理を行う
        if (name === SETTINGS_TAB_NAME) {
            this.activateSettingsTab();
            return null;
        }

        // テーブル定義タブは EditorTable を持たない特殊タブのため専用の有効化処理を行う
        if (name === TABLE_DEFINITION_TAB_NAME) {
            this.activateTableDefinitionTab();
            return null;
        }

        // API詳細タブは EditorTable を持たない一時タブのため専用の有効化処理を行う
        if (name === DEBUG_API_DETAIL_TAB_NAME) {
            this.activateDebugApiDetailTab();
            return null;
        }

        // Viewプラグインタブは EditorTable を持たない特殊タブのため専用の有効化処理を行う
        if (this.isViewPluginTabName(name)) {
            this.activateViewPluginTab(name);
            return null;
        }

        // 設定タブ・ER図タブ・テーブル定義タブ・API詳細タブ・Viewプラグインタブから通常テーブルタブへの復帰時: rightSlot・ナビゲーションバーを復元する
        // この判定は activateTabState() より前で行う必要がある（activateTabState 内は常に通常タブの文脈）
        if (this.activeTabName !== false && this.isFullWidthSpecialTabName(this.activeTabName)) {
            this.editor.leaveSettingsMode();
        }

        this.hidePersistentSpecialTabWrappers();
        this.hideAllViewPluginTabs();

        // 現在アクティブなタブが差分タブの場合のみ非表示にして leaveSettingsMode() を呼ぶ
        // （通常タブ→通常タブの切り替え時に余分な leaveSettingsMode() が呼ばれないようにする）
        if (this.activeTabName !== false && this.activeTabName.startsWith(DIFF_TAB_PREFIX)) {
            this.diffTabs.forEach(diffTab => diffTab.hide());
            this.editor.leaveSettingsMode(); // rightSlot を再表示する
        }

        // 通常テーブルタブへの切り替えをナビゲーション履歴に記録する
        // （設定タブ・差分タブはここに到達しない）
        this.navigationHistory.pushTabSwitch(name);

        // 同一タブが既にアクティブな状態でタブ有効化が呼ばれた場合（popstate復元・同一タブ再クリック等）:
        // deactivateTabState()がスキップされるため、ここで明示的にstateを更新しないと
        // activateTabState()が古いスクロール位置やstate.paneStackを復元して現在状態が失われる。
        if (this.activeTabName === name) {
            const currentState = this.tabStates.get(name);
            if (!currentState) throw new Error(`[Tab] activateTabButton: アクティブタブ "${name}" の状態が tabStates に存在しません`);
            currentState.savedScrollLeft = currentState.editorTable.getScrollLeft();
            currentState.savedScrollTop = currentState.editorTable.getScrollTop();
            currentState.paneStack = this.paneStack.slice();
            currentState.viewIndex = this.viewIndex;
        }

        // 現在アクティブなタブがあれば非アクティブ化
        if (this.activeTabName && this.activeTabName !== name) {
            const previousState = this.tabStates.get(this.activeTabName);
            if (previousState) {
                this.deactivateTabState(previousState);
            }
        }

        // 既存のタブ状態があればそれを表示
        const existingState = this.tabStates.get(name);
        if (existingState) {
            this.activeTabName = name;
            this.persistTabs();
            this.activateTabState(existingState);
            this.sidebar.notifyActiveTableChanged(name);
            // 他タブでストアが変更されたセルのDOMを同期する
            // reloadCellsFromStore はソート/フィルター状態をクリアするため、退避した状態を復元する
            existingState.editorTable.reloadCellsFromStore();
            // タブ復帰後にバーチャルスクロールのスペーサーとDOM行を再計算する。
            // activateTabState で復元された scrollTop に基づき、正しい範囲の行を表示する。
            // これがないと、前タブのスクロール位置でDOM行が構築されたままになる。
            existingState.editorTable.forceVirtualScrollRecalculate();
            existingState.selection.updateRendererAfterResize();
            if (existingState.savedSortKeys.length > 0) {
                existingState.editorTable.restoreSortState(existingState.savedSortKeys);
            }
            if (Object.keys(existingState.savedFilters).length > 0) {
                existingState.editorTable.restoreFilterState(existingState.savedFilters);
            }
            // 他タブでインメモリデータが編集された可能性があるため、参照ヒントを再更新する
            this.reference.refreshReferenceHints(name, existingState);
            // セルDOM・参照ヒントの更新後にRelationsPanelを強制更新する（同一行でもパネルが確実に描画される）
            existingState.editorTable.forceRefreshRelationsPanel();
            this.editor.syncActiveTableScrollState();
            this.restoreFormPanelForTabState(existingState);
            // 既存タブの再アクティブ化では emitTableOpened を発火しない（Open/Close の対称性を維持するため）
            return existingState;
        }

        // 読み込み中の同名タブがある場合は、既存の非同期処理の完了を待つ。
        if (this.loadingTabNames.has(name)) {
            this.persistTabs(name);
            return null;
        }

        // 新しいタブ状態を作成
        this.loadingTabNames.add(name);
        this.persistTabs(name);
        this.createTabState(name, tabButton);
        // テーブルオープンイベントを発火する（EditorAPI が接続済みの場合のみ）
        if (this.editorApi !== false) this.editorApi.emitTableOpened(name);
        return null;
    }

    /**
     * 設定タブをタブバーに開く。
     * 既に存在する場合は単純にアクティブ化する。
     * 歯車アイコンクリック時に Sidebar 経由で呼ばれる。
     */
    openSettingsTab(): void {
        const tabButton = this.append(SETTINGS_TAB_NAME, null);
        tabButton.click();
    }

    /**
     * ER図タブをタブバーに開く。
     * 既に存在する場合は単純にアクティブ化する。
     * アクティビティバーの erDiagram アイコンクリック時に Sidebar 経由で呼ばれる。
     */
    openErDiagramTab(): void {
        const tabButton = this.append(ER_DIAGRAM_TAB_NAME, null);
        tabButton.click();
    }

    /**
     * テーブル定義タブをタブバーに開く。
     * エクスプローラーの「+」ボタンクリック時に Sidebar 経由で呼ばれる。
     * 既に存在する場合は単純にアクティブ化する。
     */
    openTableDefinitionTab(): void {
        const tabButton = this.append(TABLE_DEFINITION_TAB_NAME, null);
        tabButton.click();
    }

    /**
     * DEBUG CONSOLE のAPI詳細を一時タブに表示する。
     * 一時タブは ui-state に保存せず、別の行を開いた場合は同じタブ内容を差し替える。
     */
    openDebugApiDetailTab(detail: DebugConsoleEntryDetail): void {
        this.pendingDebugApiDetail = detail;
        const tabButton = this.append(DEBUG_API_DETAIL_TAB_NAME, null);
        tabButton.click();
        if (this.debugApiDetailTab !== false) {
            this.debugApiDetailTab.update(detail);
        }
    }

    /**
     * Viewプラグインを専用タブとして開く。
     * タブ本体はプラグインIDで管理し、表示名は "View: <title>" とする。
     */
    openViewPluginTab(pluginId: string): void {
        if (this.viewPluginHost === false) {
            this.notification.show('Viewプラグインホストが初期化されていません');
            return;
        }
        const plugin = this.viewPluginHost.getPlugin(pluginId);
        if (plugin === null) {
            this.notification.show('Viewプラグインが見つかりません: ' + pluginId);
            return;
        }

        let tabName = this.viewPluginTabNamesById.get(plugin.id);
        if (tabName === undefined) {
            tabName = this.createViewPluginTabName(plugin.title, plugin.id);
            this.viewPluginTabNamesById.set(plugin.id, tabName);
            this.viewPluginIdsByTabName.set(tabName, plugin.id);
        }

        const tabButton = this.append(tabName, plugin.description);
        tabButton.click();
    }

    reloadViewPluginTabs(): void {
        if (this.viewPluginHost === false) return;
        const openTabNames = [...this.viewPluginIdsByTabName.keys()];
        let removedActiveTab = false;
        for (const tabName of openTabNames) {
            const pluginId = this.viewPluginIdsByTabName.get(tabName);
            if (pluginId === undefined) continue;
            if (this.viewPluginHost.getPlugin(pluginId) === null) {
                if (this.activeTabName === tabName) removedActiveTab = true;
                this.destroyViewPluginTab(tabName);
                this.removeTabButton(tabName);
                continue;
            }
            this.remountViewPluginTab(tabName);
        }
        if (removedActiveTab) {
            this.activeTabName = false;
            this.activateFirstAvailableRestoredTab();
        } else if (this.activeTabName !== false && this.isViewPluginTabName(this.activeTabName)) {
            this.enableTabButton(this.activeTabName);
        }
        this.persistTabs();
    }

    /**
     * 既存テーブルの定義編集タブを開く。
     * エクスプローラー・タブ・列ヘッダーの各コンテキストメニューから呼ばれる。
     */
    openEditTableDefinitionTab(tableName: string): void {
        this.openEditTableDefinitionTabAsync(tableName)
            .catch(e => { console.error('テーブル定義編集タブオープンエラー', e); });
    }

    /**
     * エクスプローラーファイルの右クリックメニューを表示する。
     * ExplorerFile の contextmenu イベントハンドラから呼ばれる。
     */
    showExplorerContextMenu(tableName: string, x: number, y: number): void {
        this.contextMenu.show(x, y, [
            {
                label: 'テーブル定義を編集',
                action: () => {
                    this.openEditTableDefinitionTab(tableName);
                },
            },
        ]);
    }

    /**
     * API詳細タブをアクティブ化する。
     * DEBUG CONSOLE のログ行クリックから開かれる一時タブで、通常テーブルとは独立して全幅表示する。
     */
    private activateDebugApiDetailTab(): void {
        // 設定タブ・差分タブ・ER図タブ・テーブル定義タブ・Viewプラグインタブがアクティブだった場合: leaveSettingsMode() で rightSlot を復元しておく
        if (this.activeTabName !== false && this.isFullWidthSpecialTabName(this.activeTabName) && this.activeTabName !== DEBUG_API_DETAIL_TAB_NAME) {
            this.editor.leaveSettingsMode();
        }

        // 差分タブがアクティブだった場合: 全差分タブを非表示にする
        if (this.activeTabName !== false && this.activeTabName.startsWith(DIFF_TAB_PREFIX)) {
            this.diffTabs.forEach(diffTab => diffTab.hide());
        }

        // 通常テーブルタブがアクティブなら非アクティブ化する
        if (this.activeTabName && this.activeTabName !== DEBUG_API_DETAIL_TAB_NAME) {
            const previousState = this.tabStates.get(this.activeTabName);
            if (previousState) {
                this.deactivateTabState(previousState);
            }
        }

        // 他の特殊タブが表示中であれば非表示にする
        if (this.settingsWrapperElement !== false) {
            this.settingsWrapperElement.style.display = 'none';
        }
        if (this.erDiagramWrapperElement !== false) {
            this.erDiagramWrapperElement.style.display = 'none';
        }
        if (this.tableDefinitionWrapperElement !== false) {
            this.tableDefinitionWrapperElement.style.display = 'none';
        }
        this.hideAllViewPluginTabs();

        this.activeTabName = DEBUG_API_DETAIL_TAB_NAME;
        this.persistTabs();

        const detail = this.pendingDebugApiDetail;
        this.pendingDebugApiDetail = null;

        if (this.debugApiDetailWrapperElement === false) {
            if (detail === null) return;
            const wrapper = document.createElement('div');
            wrapper.classList.add('tab-wrapper', 'debug-api-detail-tab-wrapper');
            this.editor.appendChild(wrapper);
            this.debugApiDetailWrapperElement = wrapper;

            this.debugApiDetailTab = new DebugApiDetailTab(detail);
            this.debugApiDetailTab.appendTo(wrapper);
        } else if (detail !== null && this.debugApiDetailTab !== false) {
            this.debugApiDetailTab.update(detail);
        }

        this.relationsPanel.disconnectEditorTable();
        this.editor.enterSettingsMode();

        this.debugApiDetailWrapperElement.style.display = '';
        if (this.debugApiDetailTab !== false) {
            this.debugApiDetailTab.show();
        }
    }

    /**
     * Viewプラグインタブをアクティブ化する。
     * 設定タブと同じ全幅表示で、プラグインが返すDOMを左ペイン全体に描画する。
     */
    private activateViewPluginTab(tabName: string): void {
        if (this.viewPluginHost === false) {
            this.notification.show('Viewプラグインホストが初期化されていません');
            return;
        }

        // 他の全幅タブから来た場合は一度通常レイアウトへ戻して内部状態を揃える。
        if (this.activeTabName !== false && this.isFullWidthSpecialTabName(this.activeTabName)) {
            this.editor.leaveSettingsMode();
        }

        if (this.activeTabName !== false && this.activeTabName.startsWith(DIFF_TAB_PREFIX)) {
            this.diffTabs.forEach(diffTab => diffTab.hide());
        }

        if (this.activeTabName && !this.isFullWidthSpecialTabName(this.activeTabName)) {
            const previousState = this.tabStates.get(this.activeTabName);
            if (previousState) {
                this.deactivateTabState(previousState);
            }
        }

        this.hidePersistentSpecialTabWrappers();
        this.hideAllViewPluginTabs();

        this.activeTabName = tabName;
        this.persistTabs();

        const pluginId = this.viewPluginIdsByTabName.get(tabName);
        if (pluginId === undefined) {
            this.notification.show('Viewプラグインタブの情報が見つかりません: ' + tabName);
            return;
        }

        let wrapper = this.viewPluginWrapperElements.get(tabName);
        if (wrapper === undefined) {
            wrapper = document.createElement('div');
            wrapper.classList.add('tab-wrapper', 'view-plugin-tab-wrapper');
            wrapper.dataset.viewPluginId = pluginId;
            wrapper.style.display = 'none';
            this.editor.appendChild(wrapper);
            this.viewPluginWrapperElements.set(tabName, wrapper);

            const root = document.createElement('div');
            root.classList.add('view-plugin-tab-root');
            root.dataset.viewPluginId = pluginId;
            wrapper.appendChild(root);

            const tabButton = this.tabButtons.find(button => button.name === tabName);
            const mount = this.viewPluginHost.mountView(pluginId, root, {
                onDirtyChanged: (dirty: boolean) => {
                    tabButton?.setDirty(dirty);
                },
            });
            if (mount !== null) {
                this.viewPluginMounts.set(tabName, mount);
            }
        }

        this.relationsPanel.disconnectEditorTable();
        this.editor.enterSettingsMode();
        wrapper.style.display = '';
        const restoredScroll = this.restoredTabScrollPositions.get(tabName);
        if (restoredScroll !== undefined) {
            this.restoredTabScrollPositions.delete(tabName);
            requestAnimationFrame(() => {
                wrapper.scrollLeft = restoredScroll.scrollLeft;
                wrapper.scrollTop = restoredScroll.scrollTop;
            });
        }
        this.navigationHistory.pushTabSwitch(tabName);
    }

    private createViewPluginTabName(title: string, pluginId: string): string {
        const baseName = VIEW_PLUGIN_TAB_PREFIX + title;
        if (!this.tabButtons.some(button => button.name === baseName) && !this.viewPluginIdsByTabName.has(baseName)) {
            return baseName;
        }
        return VIEW_PLUGIN_TAB_PREFIX + title + ' (' + pluginId + ')';
    }

    private hidePersistentSpecialTabWrappers(): void {
        if (this.settingsWrapperElement !== false) {
            this.settingsWrapperElement.style.display = 'none';
        }
        if (this.erDiagramWrapperElement !== false) {
            this.erDiagramWrapperElement.style.display = 'none';
        }
        if (this.tableDefinitionWrapperElement !== false) {
            this.tableDefinitionWrapperElement.style.display = 'none';
        }
        if (this.debugApiDetailWrapperElement !== false) {
            this.debugApiDetailWrapperElement.style.display = 'none';
        }
    }

    private hideAllViewPluginTabs(): void {
        this.viewPluginWrapperElements.forEach(wrapper => {
            wrapper.style.display = 'none';
        });
    }

    private remountViewPluginTab(tabName: string): void {
        if (this.viewPluginHost === false) return;
        const pluginId = this.viewPluginIdsByTabName.get(tabName);
        if (pluginId === undefined) return;
        const wrapper = this.viewPluginWrapperElements.get(tabName);
        if (wrapper === undefined) return;

        const mount = this.viewPluginMounts.get(tabName);
        if (mount !== undefined) {
            mount.dispose();
            this.viewPluginMounts.delete(tabName);
        }
        wrapper.textContent = '';
        const root = document.createElement('div');
        root.classList.add('view-plugin-tab-root');
        root.dataset.viewPluginId = pluginId;
        wrapper.appendChild(root);
        const tabButton = this.tabButtons.find(button => button.name === tabName);
        const nextMount = this.viewPluginHost.mountView(pluginId, root, {
            onDirtyChanged: (dirty: boolean) => {
                tabButton?.setDirty(dirty);
            },
        });
        if (nextMount !== null) {
            this.viewPluginMounts.set(tabName, nextMount);
        }
    }

    private destroyViewPluginTab(tabName: string): void {
        const mount = this.viewPluginMounts.get(tabName);
        if (mount !== undefined) {
            mount.dispose();
            this.viewPluginMounts.delete(tabName);
        }
        const wrapper = this.viewPluginWrapperElements.get(tabName);
        if (wrapper !== undefined) {
            wrapper.remove();
            this.viewPluginWrapperElements.delete(tabName);
        }
        const pluginId = this.viewPluginIdsByTabName.get(tabName);
        if (pluginId !== undefined) {
            this.viewPluginTabNamesById.delete(pluginId);
            this.viewPluginIdsByTabName.delete(tabName);
        }
    }

    private async saveViewPluginTabAsync(tabName: string): Promise<void> {
        const mount = this.viewPluginMounts.get(tabName);
        if (mount === undefined) return;
        const saved = await mount.saveAsync();
        if (!saved) return;
        const tabButton = this.tabButtons.find(button => button.name === tabName);
        tabButton?.setDirty(false);
    }

    /**
     * テーブル定義タブをアクティブ化する。
     * enableTabButton(TABLE_DEFINITION_TAB_NAME) から呼ばれる。
     * TableDefinitionEditor の初回生成・再表示を担う。
     * 設定タブと同様に全幅表示する。
     */
    private activateTableDefinitionTab(): void {
        // 設定タブ・差分タブ・ER図タブ・API詳細タブ・Viewプラグインタブがアクティブだった場合: leaveSettingsMode() で rightSlot を復元する
        if (this.activeTabName !== false && this.isFullWidthSpecialTabName(this.activeTabName) && this.activeTabName !== TABLE_DEFINITION_TAB_NAME) {
            this.editor.leaveSettingsMode();
        }

        // 差分タブがアクティブだった場合: 全差分タブを非表示にする
        if (this.activeTabName !== false && this.activeTabName.startsWith(DIFF_TAB_PREFIX)) {
            this.diffTabs.forEach(diffTab => diffTab.hide());
        }

        // 通常テーブルタブがアクティブなら非アクティブ化する
        if (this.activeTabName && this.activeTabName !== TABLE_DEFINITION_TAB_NAME) {
            const previousState = this.tabStates.get(this.activeTabName);
            if (previousState) {
                this.deactivateTabState(previousState);
            }
        }

        // 設定タブが表示中であれば非表示にする
        if (this.settingsWrapperElement !== false) {
            this.settingsWrapperElement.style.display = 'none';
        }

        // ER図タブが表示中であれば非表示にする
        if (this.erDiagramWrapperElement !== false) {
            this.erDiagramWrapperElement.style.display = 'none';
        }

        // API詳細タブが表示中であれば非表示にする
        if (this.debugApiDetailWrapperElement !== false) {
            this.debugApiDetailWrapperElement.style.display = 'none';
        }
        this.hideAllViewPluginTabs();

        this.activeTabName = TABLE_DEFINITION_TAB_NAME;
        this.persistTabs();

        // 既存テーブル編集時はタブボタンの表示テキストをテーブル名に更新する（新規作成時は「新しいテーブル」のまま）
        if (this.pendingEditTarget !== false) {
            const tabButton = this.tabButtons.find(x => x.name === TABLE_DEFINITION_TAB_NAME);
            if (tabButton) {
                const nameSpan = tabButton.element.querySelector('.tab-button-name');
                if (nameSpan) nameSpan.textContent = this.pendingEditTarget.tableName + ' - 定義編集';
            }
        }

        // 編集モードで開き直す場合（pendingEditTarget が設定されている場合）、既存のエディタを破棄して再生成する
        if (this.pendingEditTarget !== false && this.tableDefinitionWrapperElement !== false) {
            if (this.tableDefinitionEditor !== false) {
                this.tableDefinitionEditor.destroy();
            }
            this.tableDefinitionWrapperElement.remove();
            this.tableDefinitionWrapperElement = false;
            this.tableDefinitionEditor = false;
        }

        // 初回または編集モードでの再生成: TableDefinitionEditor とラッパーを生成する
        if (this.tableDefinitionWrapperElement === false) {
            const wrapper = document.createElement('div');
            wrapper.classList.add('tab-wrapper', 'table-definition-tab-wrapper');
            this.editor.appendChild(wrapper);
            this.tableDefinitionWrapperElement = wrapper;

            // 既存テーブル名一覧を収集する（重複チェック用）
            const existingNames: string[] = [];
            this.openEditorTables.forEach((_v, key) => { existingNames.push(key); });
            // openEditorTables に含まれないがストアに登録済みのテーブルも含める
            this.store.getTableNames().forEach(name => {
                if (existingNames.indexOf(name) === -1) existingNames.push(name);
            });

            // pendingEditTarget を消費してエディタを生成する（新規の場合は false のまま）
            const editTarget = this.pendingEditTarget;
            this.pendingEditTarget = false;
            this.tableDefinitionEditor = new TableDefinitionEditor(this, existingNames, editTarget);
            this.tableDefinitionEditor.appendTo(wrapper);
        }

        // RelationsPanel を非表示にする（テーブル定義画面に不要）
        this.relationsPanel.disconnectEditorTable();

        // editor-right-slot とナビゲーションバーを非表示にする（テーブル定義画面を全幅表示するため）
        this.editor.enterSettingsMode();

        // テーブル定義パネルを表示する
        this.tableDefinitionWrapperElement.style.display = '';
    }

    /**
     * テーブル定義タブを閉じ、新テーブルをエクスプローラーに追加して通常タブで開く。
     * TableDefinitionEditor.saveAsync() から呼ばれる。
     */
    closeTableDefinitionAndOpenTable(tableName: string, description: string | null): void {
        this.referenceDataCache.invalidateSchemaIndex();
        this.reverseReferenceEngine.invalidateAll();
        // テーブル定義タブを閉じる（performCloseTab 内で destroy() + DOM除去 + フィールドリセットが行われる）
        this.performCloseTab(TABLE_DEFINITION_TAB_NAME);

        // エクスプローラーに新テーブルを追加する
        this.sidebar.appendFile(tableName, description);

        // 新テーブルを通常タブで開く
        const tabButton = this.append(tableName, description);
        tabButton.click();
    }

    /**
     * テーブル定義タブを閉じ、既存テーブルを通常タブで再オープンする。
     * TableDefinitionEditor の編集モード保存後に呼ばれる。
     * closeTableDefinitionAndOpenTable との違い: エクスプローラーへの追加を行わない（既存テーブルのため）。
     * また、既にタブが開かれている場合はストアとDOMを再読み込みして最新状態を反映する。
     */
    async closeTableDefinitionAndReopenTable(tableName: string, description: string | null): Promise<void> {
        this.referenceDataCache.invalidateSchemaIndex();
        this.reverseReferenceEngine.invalidateAll();
        // 既にテーブルタブが開かれている場合は先に閉じる。
        // 定義タブを先に閉じると前の通常タブが一瞬アクティブ化され、古いストアヘッダーが再利用されるため。
        const existingState = this.tabStates.get(tableName);
        if (existingState) {
            // タブを閉じて再オープンすることで最新のスキーマ・CSVを読み込む
            this.performCloseTab(tableName);
        }

        // 起動時バリデーションなどでストアに常駐しているCSVキャッシュも最新ファイルへ同期する。
        // これを行わないと、追加列はスキーマ上に表示されても保存時に古いCSVヘッダーで上書きされる。
        if (this.store.hasTable(tableName)) {
            await this.store.reloadTableDataAsync(tableName);
            this.referenceDataCache.evictEntry(tableName);
        }

        // テーブル定義タブを閉じる
        this.performCloseTab(TABLE_DEFINITION_TAB_NAME);

        // テーブルを通常タブで開く（既にエクスプローラーに存在するため appendFile は呼ばない）
        const tabButton = this.append(tableName, description);
        tabButton.click();
    }

    /**
     * タブボタンの右クリックコンテキストメニューを表示する。
     * TabButton.onContextMenu から呼ばれる。
     * 固定/固定解除は永続タブ全体、テーブル操作は通常テーブルタブに表示する。
     */
    showTabButtonContextMenu(tabName: string, x: number, y: number): void {
        if (this.isTemporaryTabName(tabName)) return;
        const tabButton = this.tabButtons.find(button => button.name === tabName);
        if (tabButton === undefined) return;

        const items: ContextMenuEntry[] = [
            {
                label: tabButton.isPinned() ? 'タブの固定を解除' : 'タブを固定',
                action: () => {
                    this.setTabPinned(tabName, !tabButton.isPinned());
                },
            },
        ];

        // 差分タブ・設定タブ・ER図タブ・テーブル定義タブ・API詳細タブ・Viewプラグインタブは通常テーブル操作の対象外
        if (tabName !== SETTINGS_TAB_NAME
            && tabName !== ER_DIAGRAM_TAB_NAME
            && tabName !== TABLE_DEFINITION_TAB_NAME
            && !tabName.startsWith(DIFF_TAB_PREFIX)
            && !this.isViewPluginTabName(tabName)) {
            items.push(
                { separator: true },
                {
                    label: 'テーブル定義を編集',
                    action: () => {
                        this.openEditTableDefinitionTab(tabName);
                    },
                },
                {
                    label: 'バージョン比較...',
                    action: () => {
                        this.openVersionCompareFlowAsync(tabName)
                            .catch(e => { this.notification.show('バージョン比較に失敗しました: ' + String(e)); });
                    },
                },
            );
        }

        this.contextMenu.show(x, y, items);
    }

    setTabPinned(tabName: string, pinned: boolean): void {
        if (this.isTemporaryTabName(tabName)) return;
        const tabButton = this.tabButtons.find(button => button.name === tabName);
        if (tabButton === undefined || tabButton.isPinned() === pinned) return;

        tabButton.setPinned(pinned);
        this.repositionTabButtonForPinnedState(tabButton);
        this.scheduleTabLayout(false, true);
        this.persistTabs();
    }

    isTabPinned(tabName: string): boolean {
        return this.tabButtons.find(button => button.name === tabName)?.isPinned() === true;
    }

    /**
     * バージョン比較フロー全体を制御する。
     * コミット選択ダイアログを開き、ユーザーが比較対象を選択したら差分タブを生成して表示する。
     * ダイアログがキャンセルされた場合は何もしない。
     */
    private async openVersionCompareFlowAsync(tableName: string): Promise<void> {
        const result = await this.commitSelectorDialog.openAsync(tableName);
        if (result === null) return;
        await this.openVersionCompareDiffTabAsync(tableName, result.leftCommit, result.rightCommit);
    }

    /**
     * バージョン比較差分タブを開く。
     * コミット選択ダイアログの「比較」ボタン押下時に呼ばれる。
     * 左右コミットのCSVを取得し、DiffTabを生成して表示する。
     * @param tableName テーブル名
     * @param leftCommit 左コミットハッシュ（"HEAD" | "WORKING_TREE" | コミットハッシュ）
     * @param rightCommit 右コミットハッシュ（"HEAD" | "WORKING_TREE" | コミットハッシュ）
     */
    private async openVersionCompareDiffTabAsync(tableName: string, leftCommit: string, rightCommit: string): Promise<void> {
        const path = 'data/' + tableName + '.csv';

        // 左右のCSVを並列取得する
        const [leftCsv, rightCsv, schemaJson] = await Promise.all([
            this.fetchCsvAtCommitAsync(leftCommit, path),
            this.fetchCsvAtCommitAsync(rightCommit, path),
            readFileAsync('schema/' + tableName + '.json'),
        ]);

        // タブ名のフォーマット: "{テーブル名} ({leftHash} ↔ {rightHash})"
        const leftDisplay = this.formatCommitDisplay(leftCommit);
        const rightDisplay = this.formatCommitDisplay(rightCommit);
        const diffTabName = DIFF_TAB_PREFIX + tableName + ' (' + leftDisplay + ' \u2194 ' + rightDisplay + ')';

        // 既存の同名差分タブがあれば破棄する
        if (this.diffTabs.has(diffTabName)) {
            if (this.activeTabName === diffTabName) {
                this.editor.leaveSettingsMode();
                this.activeTabName = false;
            }
            const existing = this.diffTabs.get(diffTabName)!;
            existing.destroy(this.store);
            this.diffTabs.delete(diffTabName);
            this.removeTabButton(diffTabName);
        }

        // 差分タブボタンを追加する
        const tabButton = this.append(diffTabName, null);

        // DiffTab を生成する（バージョン比較は両ペインとも読み取り専用）
        const diffTab = new DiffTab(
            tableName, schemaJson, leftCsv, rightCsv, true, '',
            this.editor, this.sidebar, this.store, this.referenceDataCache, this.contextMenu, tabButton,
            this.reference, this.openEditorTables, this.notification, false,
            createLargeFileSettings(getAppliedSettings()),
            leftDisplay, rightDisplay
        );
        this.diffTabs.set(diffTabName, diffTab);
        this.connectDiffTabUiState(diffTabName, diffTab);

        // タブボタンをクリックしてアクティブ化する
        tabButton.click();
    }

    /**
     * コミット指定に応じたCSVを取得する内部ヘルパー。
     * "HEAD" → gitShowFreshAsync, "WORKING_TREE" → readFileAsync, それ以外 → gitShowAtCommitAsync
     */
    private async fetchCsvAtCommitAsync(commit: string, path: string): Promise<string> {
        if (commit === 'HEAD') return gitShowFreshAsync(path);
        if (commit === 'WORKING_TREE') return readFileAsync(path);
        return gitShowAtCommitAsync(commit, path);
    }

    /**
     * コミットハッシュの表示文字列を生成する。
     * "HEAD" → "HEAD", "WORKING_TREE" → "作業ツリー", それ以外 → 7桁ハッシュ
     */
    private formatCommitDisplay(commit: string): string {
        if (commit === 'HEAD') return 'HEAD';
        if (commit === 'WORKING_TREE') return '作業ツリー';
        return commit.length > 7 ? commit.substring(0, 7) : commit;
    }

    /**
     * 既存テーブルのスキーマを読み込み、テーブル定義編集タブを開く。
     * showExplorerContextMenu から呼ばれる。
     */
    private async openEditTableDefinitionTabAsync(tableName: string): Promise<void> {
        // スキーマJSONを読み込んでパースする
        const schemaJson = await readFileAsync('schema/' + tableName + '.json');
        const schema = JSON.parse(schemaJson) as {
            header: Array<Record<string, unknown>>;
            primary_key: string | string[];
            description?: string;
        };

        // primary_key は文字列または文字列配列のどちらでもよい
        const primaryKeys: ReadonlyArray<string> = Array.isArray(schema.primary_key)
            ? schema.primary_key
            : [schema.primary_key];

        // 列情報を EditTargetColumn に変換する（元スキーマの列定義全体を originalSchema として保持する）
        const columns = schema.header.map(col => ({
            name: col['name'] as string,
            type: col['type'] as string,
            originalSchema: col,
        }));

        // スキーマルートから reverseReferencePriority を読み取る（存在しなければ null）
        const schemaObj = schema as Record<string, unknown>;
        const rrpValue = typeof schemaObj['reverseReferencePriority'] === 'number'
            ? schemaObj['reverseReferencePriority'] as number
            : null;

        // EditTarget を構築して pendingEditTarget にセットする
        this.pendingEditTarget = {
            tableName,
            description: 'description' in schema ? schema.description as string : '',
            columns,
            primaryKeys,
            reverseReferencePriority: rrpValue,
        };

        // テーブル定義タブを開く（activateTableDefinitionTab 内で pendingEditTarget が消費される）
        const tabButton = this.append(TABLE_DEFINITION_TAB_NAME, null);
        tabButton.click();
    }

    /**
     * ER図タブをアクティブ化する。
     * enableTabButton('ER Diagram') から呼ばれる。
     * ErDiagramTab の初回生成・再表示を担う。
     * 設定タブと同様に全幅表示する。
     */
    private activateErDiagramTab(): void {
        // 設定タブ・差分タブ・テーブル定義タブ・API詳細タブ・Viewプラグインタブがアクティブだった場合: leaveSettingsMode() で rightSlot を復元しておく
        // （次の enterSettingsMode() で再び非表示にするが、内部状態を一貫させるために呼ぶ）
        if (this.activeTabName !== false && this.isFullWidthSpecialTabName(this.activeTabName) && this.activeTabName !== ER_DIAGRAM_TAB_NAME) {
            this.editor.leaveSettingsMode();
        }

        // 差分タブがアクティブだった場合: 全差分タブを非表示にする
        if (this.activeTabName !== false && this.activeTabName.startsWith(DIFF_TAB_PREFIX)) {
            this.diffTabs.forEach(diffTab => diffTab.hide());
        }

        // 通常テーブルタブがアクティブなら非アクティブ化する
        if (this.activeTabName && this.activeTabName !== ER_DIAGRAM_TAB_NAME) {
            const previousState = this.tabStates.get(this.activeTabName);
            if (previousState) {
                this.deactivateTabState(previousState);
            }
        }

        // 設定タブが表示中であれば非表示にする
        if (this.settingsWrapperElement !== false) {
            this.settingsWrapperElement.style.display = 'none';
        }

        // テーブル定義タブが表示中であれば非表示にする
        if (this.tableDefinitionWrapperElement !== false) {
            this.tableDefinitionWrapperElement.style.display = 'none';
        }

        // API詳細タブが表示中であれば非表示にする
        if (this.debugApiDetailWrapperElement !== false) {
            this.debugApiDetailWrapperElement.style.display = 'none';
        }
        this.hideAllViewPluginTabs();

        this.activeTabName = ER_DIAGRAM_TAB_NAME;
        this.persistTabs();

        // 初回のみ ErDiagramTab とラッパーを生成する
        if (this.erDiagramWrapperElement === false) {
            const wrapper = document.createElement('div');
            wrapper.classList.add('tab-wrapper', 'er-diagram-tab-wrapper');
            this.editor.appendChild(wrapper);
            this.erDiagramWrapperElement = wrapper;

            this.erDiagramTab = new ErDiagramTab(this);
            this.erDiagramTab.appendTo(wrapper);
            // スキーマ読み込みと SVG 描画を非同期で開始する
            this.erDiagramTab.buildAsync().catch(e => { console.error('ER図構築エラー', e); });
        }

        // RelationsPanel を非表示にする（ER図画面に不要）
        this.relationsPanel.disconnectEditorTable();

        // editor-right-slot とナビゲーションバーを非表示にする（ER図を全幅表示するため）
        this.editor.enterSettingsMode();

        // ER図パネルを表示する
        this.erDiagramWrapperElement.style.display = '';

        // ER図タブへの遷移をナビゲーション履歴に記録する（マウス戻る/進むで復元可能にする）
        this.navigationHistory.pushTabSwitch(ER_DIAGRAM_TAB_NAME);
    }

    /**
     * ER図ノードクリックからテーブルタブを開く（ErDiagramTab から呼ばれる）
     * エクスプローラーのクリックと同じように、タブを作成してアクティブにする
     */
    openTableByErDiagram(tableName: string): void {
        this.append(tableName, null);
        this.enableTabButton(tableName);
    }

    /**
     * ER図タブを開き、指定テーブルのノードを画面中央にフォーカスする
     * ツールバーのER図ボタンから呼ばれる
     */
    openErDiagramAndFocusTable(tableName: string): void {
        this.openErDiagramTab();
        if (this.erDiagramTab !== false) {
            this.erDiagramTab.focusTable(tableName);
        }
    }

    /**
     * 設定タブをアクティブ化する。
     * enableTabButton('設定') から呼ばれる。
     * SettingsPanel の初回生成・再表示を担う。
     * 通常テーブルの wrapperElement は deactivateTabState() で非表示にしない（設定タブは独立）。
     * 代わりに既存アクティブタブを非アクティブ化してから設定パネルを表示する。
     */
    private activateSettingsTab(): void {
        if (this.activeTabName !== false && this.isFullWidthSpecialTabName(this.activeTabName) && this.activeTabName !== SETTINGS_TAB_NAME) {
            this.editor.leaveSettingsMode();
        }

        // 差分タブがアクティブだった場合: 全差分タブを非表示にする
        if (this.activeTabName !== false && this.activeTabName.startsWith(DIFF_TAB_PREFIX)) {
            this.diffTabs.forEach(diffTab => diffTab.hide());
        }

        // ER図タブが表示中であれば非表示にする
        if (this.erDiagramWrapperElement !== false) {
            this.erDiagramWrapperElement.style.display = 'none';
        }

        // テーブル定義タブが表示中であれば非表示にする
        if (this.tableDefinitionWrapperElement !== false) {
            this.tableDefinitionWrapperElement.style.display = 'none';
        }

        // API詳細タブが表示中であれば非表示にする
        if (this.debugApiDetailWrapperElement !== false) {
            this.debugApiDetailWrapperElement.style.display = 'none';
        }
        this.hideAllViewPluginTabs();

        // 通常テーブルタブがアクティブなら非アクティブ化する
        if (this.activeTabName && this.activeTabName !== SETTINGS_TAB_NAME) {
            const previousState = this.tabStates.get(this.activeTabName);
            if (previousState) {
                this.deactivateTabState(previousState);
            }
        }
        // アクティブ名を設定タブ名に更新する（getActiveTabName() で '設定' が返るようにする）
        this.activeTabName = SETTINGS_TAB_NAME;
        this.persistTabs();

        // SettingsPanel の TabButton を取得する
        // openSettingsTab() → append() で必ず tabButton が生成されるため、存在しない状態は論理エラー
        const tabButton = this.tabButtons.find(x => x.name === SETTINGS_TAB_NAME);
        if (!tabButton) throw new Error('[Tab] activateSettingsTab: 設定タブの TabButton が存在しない');

        // 初回のみ SettingsPanel とラッパーを生成する
        // SettingsPanel は TabButton を直接参照して dirty マークを更新する（密結合）
        if (this.settingsWrapperElement === false) {
            const wrapper = document.createElement('div');
            wrapper.classList.add('tab-wrapper', 'settings-tab-wrapper');
            this.editor.appendChild(wrapper);
            this.settingsWrapperElement = wrapper;

            this.settingsPanel = new SettingsPanel(tabButton);
            this.settingsPanel.appendTo(wrapper);
        }

        // RelationsPanel を非表示にする（設定画面に不要）
        this.relationsPanel.disconnectEditorTable();

        // editor-right-slot とナビゲーションバーを非表示にする（設定画面を全幅表示するため）
        this.editor.enterSettingsMode();

        // 設定パネルを表示する
        this.settingsWrapperElement.style.display = '';
    }

    /**
     * 現在アクティブなタブが設定タブかどうかを返す
     * main.ts の Ctrl+S ハンドラで判定するために使用する
     */
    isSettingsTabActive(): boolean {
        return this.activeTabName === SETTINGS_TAB_NAME;
    }

    /**
     * 設定パネルを保存する（Ctrl+S 時に main.ts から呼ばれる）
     * isSettingsTabActive() が true のときのみ呼ばれるため、
     * settingsPanel が false の状態は論理エラーとして throw する
     */
    saveSettings(): void {
        if (this.settingsPanel === false) throw new Error('[Tab] saveSettings: settingsPanel が未初期化の状態で呼ばれた');
        this.settingsPanel.save();
    }

    /**
     * アクティブなタブの EditorTableHandler にフォーカスを戻す。
     * 検索置換パネルからの置換実行後に呼ばれ、後続の Ctrl+Z/Ctrl+S が
     * EditorTableHandler の keydown ハンドラに自然に到達するようにする。
     * 設定タブ・ER図タブ・差分タブの場合は何もしない。
     */
    focusActiveEditorTable(): void {
        if (this.activeTabName === false) return;
        if (this.activeTabName === SETTINGS_TAB_NAME) return;
        if (this.activeTabName === ER_DIAGRAM_TAB_NAME) return;
        if (this.activeTabName === TABLE_DEFINITION_TAB_NAME) return;
        if (this.activeTabName === DEBUG_API_DETAIL_TAB_NAME) return;
        if (this.isViewPluginTabName(this.activeTabName)) return;
        if (this.activeTabName.startsWith(DIFF_TAB_PREFIX)) return;
        const state = this.tabStates.get(this.activeTabName);
        if (!state) throw new Error(`focusActiveEditorTable: タブ '${this.activeTabName}' の状態が見つかりません`);
        state.editorTableHandler.activate();
    }

    /**
     * アクティブなテーブルを保存する。
     * グローバル Ctrl+S ハンドラ（main.ts キャプチャフェーズ）から呼ばれる。
     * EditorTable 外にフォーカスがある場合に使用される。
     */
    saveActiveTable(): void {
        this.saveActiveTableAsync().catch((err: unknown) => {
            console.error('[Tab] saveActiveTableAsync failed:', err);
            this.notification.show('保存に失敗しました');
        });
    }

    private async saveActiveTableAsync(): Promise<void> {
        if (this.activeTabName === false) return;
        if (this.activeTabName === SETTINGS_TAB_NAME) return;
        if (this.activeTabName === ER_DIAGRAM_TAB_NAME) return;
        if (this.activeTabName === TABLE_DEFINITION_TAB_NAME) return;
        if (this.activeTabName === DEBUG_API_DETAIL_TAB_NAME) return;
        if (this.isViewPluginTabName(this.activeTabName)) {
            await this.saveViewPluginTabAsync(this.activeTabName);
            return;
        }
        const formPanel = this.currentFormPanel;
        if (formPanel !== false) {
            await formPanel.flushPendingCommitsAsync();
        }
        // 差分タブの場合
        if (this.activeTabName.startsWith(DIFF_TAB_PREFIX)) {
            const diffTab = this.diffTabs.get(this.activeTabName);
            if (diffTab) diffTab.saveRightPane();
            return;
        }
        // 通常テーブルの場合
        const state = this.tabStates.get(this.activeTabName);
        if (!state) throw new Error(`saveActiveTable: タブ '${this.activeTabName}' の状態が見つかりません`);
        state.editorTableHandler.save();
    }

    async saveCurrentFormPanelEditedTablesAsync(activeTableName: string): Promise<void> {
        const formPanel = this.currentFormPanel;
        if (formPanel === false) return;
        await formPanel.flushPendingCommitsAsync();
        formPanel.markEditedTablesSaved([activeTableName]);
        await this.saveFormPanelEditedTablesAsync(formPanel, activeTableName);
    }

    private async saveFormPanelEditedTablesAsync(formPanel: FormPanel, activeTableName: string): Promise<void> {
        const tableNames = formPanel.getEditedTableNames().filter(tableName => tableName !== activeTableName);
        const savedTableNames: string[] = [];
        for (const tableName of tableNames) {
            if (!this.store.hasTable(tableName)) continue;
            await saveTableDataFromStoreAsync(tableName, this.store);
            this.store.markSavedIfRegistered(tableName);
            const editorTable = this.openEditorTables.get(tableName);
            if (editorTable !== undefined) {
                editorTable.refreshGitDiffAsync()
                    .catch((e: unknown) => { console.error('[Tab] saveFormPanelEditedTablesAsync: refreshGitDiffAsync failed:', e); });
            }
            this.emitTableSaved(tableName);
            savedTableNames.push(tableName);
        }
        formPanel.markEditedTablesSaved(savedTableNames);
    }

    /**
     * 差分タブをタブバーに開く。
     * 同一テーブルの差分タブが既に開かれている場合は破棄して再作成する（最新CSVデータを反映するため）。
     * SourceControlPanel.openDiffTabAsync から呼ばれる。
     * gitPath: gitルート相対のファイルパス（例: "subdir/data/quest_reward.csv"）。
     *          保存後の refreshGitDiffForDiffTabAsync で HEAD版CSV取得に使用する。
     */
    openDiffTab(tableName: string, isStaged: boolean, schemaJson: string, headCsv: string, currentCsv: string, gitPath: string, leftLabel: string | null, rightLabel: string | null, isNew: boolean = false): void {
        const diffTabName = DIFF_TAB_PREFIX + tableName;

        // 既存の差分タブが開いている場合は破棄して再作成する（最新データで差分表示するため）
        // performCloseTab のDiffTab破棄パスと closeAllDiffTabs を参考にしたクリーンアップ
        if (this.diffTabs.has(diffTabName)) {
            // Dirty状態（右ペインに未保存の編集がある）の場合は破棄せずアクティブ化する
            const existingButton = this.tabButtons.find(btn => btn.name === diffTabName);
            if (existingButton !== undefined && existingButton.isDirty()) {
                this.enableTabButton(diffTabName);
                return;
            }
            // アクティブな差分タブの場合は leaveSettingsMode で rightSlot を復元する
            if (this.activeTabName === diffTabName) {
                this.editor.leaveSettingsMode();
                this.activeTabName = false;
            }
            const existingDiffTab = this.diffTabs.get(diffTabName)!;
            existingDiffTab.destroy(this.store);
            this.diffTabs.delete(diffTabName);
            this.removeTabButton(diffTabName);
        }

        // 差分タブのタブボタンを追加する
        // このタブボタンを DiffTab の History に渡すことで Dirty マークが画面に反映される
        // 差分タブには description がないため null で生成する
        const tabButton = this.append(diffTabName, null);

        const diffTab = new DiffTab(
            tableName, schemaJson, headCsv, currentCsv, isStaged, gitPath,
            this.editor, this.sidebar, this.store, this.referenceDataCache, this.contextMenu, tabButton,
            this.reference, this.openEditorTables, this.notification, this.validationPanel,
            createLargeFileSettings(getAppliedSettings()),
            leftLabel, rightLabel
        );
        this.diffTabs.set(diffTabName, diffTab);
        this.connectDiffTabUiState(diffTabName, diffTab);
        if (leftLabel === null && rightLabel === null) {
            this.diffTabMetadata.set(diffTabName, {tableName, gitPath, isStaged, isNew});
        } else {
            this.diffTabMetadata.delete(diffTabName);
        }

        // タブボタンをクリックしてアクティブ化する
        tabButton.click();
    }

    /**
     * 差分タブをアクティブ化する。
     * enableTabButton(差分タブ名) から呼ばれる。
     * 設定タブと同様に全幅表示するため enterSettingsMode() を流用する。
     */
    private activateDiffTab(diffTabName: string): void {
        // 通常テーブルタブがアクティブなら非アクティブ化する
        if (this.activeTabName && !this.isFullWidthSpecialTabName(this.activeTabName)) {
            const previousState = this.tabStates.get(this.activeTabName);
            if (previousState) {
                this.deactivateTabState(previousState);
            }
        }

        // 設定タブ・ER図タブ・テーブル定義タブ・API詳細タブ・Viewプラグインタブがアクティブだった場合: leaveSettingsMode() で rightSlot を復元しておく
        // （次の enterSettingsMode() で再び非表示にするが、内部状態を一貫させるために呼ぶ）
        if (this.activeTabName !== false && this.isFullWidthSpecialTabName(this.activeTabName) && !this.activeTabName.startsWith(DIFF_TAB_PREFIX)) {
            this.editor.leaveSettingsMode();
        }

        this.hidePersistentSpecialTabWrappers();
        this.hideAllViewPluginTabs();

        this.activeTabName = diffTabName;
        this.persistTabs();

        // RelationsPanel を非表示にする（差分ビューに不要）
        this.relationsPanel.disconnectEditorTable();

        // editor-right-slot とナビゲーションバーを非表示にして差分タブを全幅表示する
        this.editor.enterSettingsMode();

        // アクティブな差分タブのみ表示し、それ以外は非表示にする
        this.diffTabs.forEach((diffTab, tabName) => {
            if (tabName === diffTabName) {
                diffTab.show();
            } else {
                diffTab.hide();
            }
        });
    }

    /**
     * 開いている全差分タブを閉じる
     * ソース管理以外のパネルに切り替えた際にサイドバーから呼ばれる
     * closeTab() 経由では中間的に enterSettingsMode/leaveSettingsMode が複数回呼ばれるため、
     * 直接 destroy → Map クリーンアップ → removeTabButton の順で処理する
     */
    closeAllDiffTabs(): void {
        const diffTabNames = Array.from(new Set([
            ...this.diffTabs.keys(),
            ...this.tabButtons.map(btn => btn.name).filter(name => name.startsWith(DIFF_TAB_PREFIX)),
        ]));
        if (diffTabNames.length === 0) return;
        // アクティブタブが差分タブの場合は leaveSettingsMode を一度だけ呼んで状態を復元する
        if (this.activeTabName !== false && this.activeTabName.startsWith(DIFF_TAB_PREFIX)) {
            this.editor.leaveSettingsMode();
            this.activeTabName = false;
        }
        // 全差分タブを直接破棄する（closeTab経由だと enterSettingsMode/leaveSettingsMode が中間的に呼ばれるため）
        for (const name of diffTabNames) {
            const diffTab = this.diffTabs.get(name);
            if (diffTab !== undefined) {
                diffTab.destroy(this.store);
                this.diffTabs.delete(name);
            }
            this.removeTabButton(name);
        }

        // 残存する通常タブ（設定タブ・差分タブ以外）があれば最後のものをアクティブ化する。
        // 差分タブがアクティブなままだと activeTabName = false になるため、
        // Ctrl+S 等のキーボード操作が無視されるのを防ぐ。
        // enableTabButton は highlightExplorerFile / activateTabState も内包するため、
        // ハイライト・スクロール位置復元・activeTabName の更新がすべてここで完結する。
        const remainingNormal = this.tabButtons.find(
            btn => !this.isFullWidthSpecialTabName(btn.name)
        );
        if (remainingNormal) {
            this.enableTabButton(remainingNormal.name);
        } else {
            this.clearSidebarSelection();
            this.persistTabs(this.activeTabName);
        }
    }

    /**
     * 現在アクティブなタブが差分タブかどうかを返す
     */
    isDiffTabActive(): boolean {
        if (this.activeTabName === false) return false;
        return this.activeTabName.startsWith(DIFF_TAB_PREFIX);
    }

    /**
     * タブ状態を非アクティブ化（DOMを非表示にしてイベントリスナーを解除）
     * ペインスタックの現在状態を state に保存し、追加RP（paneStack[2]以降）を一時停止する。
     * グローバルRP（paneStack[1]）は this.relationsPanel.disconnectEditorTable() で完全解除する。
     * 追加RPは suspend() で一時停止するのみで内部状態（ミニEditorTable群・currentEntries）を保持する。
     * これにより、タブ復帰時（activateTabState）に追加RPの内容がそのまま表示される。
     */
    private deactivateTabState(state: TabState): void {
        // FormPanel 退避で右スロットが閉じると左ペイン幅が変わり、scrollLeft がクランプされる。
        // その前に、ユーザーが見ていたレイアウトでのスクロール位置を保存する。
        // NavigationHistory 経由では deactivateTabState より先に FormPanel だけ退避されるため、
        // formPanelState が残っていて currentFormPanel がない場合は、退避時に保存済みの値を維持する。
        if (this.currentFormPanel !== false || state.formPanelState === null) {
            state.savedScrollLeft = state.editorTable.getScrollLeft();
            state.savedScrollTop = state.editorTable.getScrollTop();
        }
        // フォームパネルが表示中であれば、閉じた扱いにせずタブ状態へ退避する。
        this.suspendFormPanelForTabState(state);
        state.relationsPanelVisible = this.editor.isRelationsPanelVisible();
        state.wrapperElement.style.display = 'none';
        // グローバルリレーションパネルのEditorTable接続を完全解除する（relationsPanel内でフィールドもリセットされる）
        this.relationsPanel.disconnectEditorTable();
        // 追加RP（paneStack[2]以降）は suspend() で一時停止するのみ（内部状態を保持）
        // disconnectEditorTable() ではなく suspend() を使うことで、タブ復帰時に再構築不要になる
        for (let i = 2; i < this.paneStack.length; i++) {
            const entry = this.paneStack[i];
            if (entry.panel !== false) {
                entry.panel.suspend();
            }
        }
        // 現在のペインスタックと viewIndex を state に保存する（タブ復帰時に復元するため）
        state.paneStack = this.paneStack.slice();
        state.viewIndex = this.viewIndex;
        // ソート/フィルター状態を保存する（reloadCellsFromStore がクリアするため、復元用に退避する）
        state.savedSortKeys = state.editorTable.serializeSortKeys();
        state.savedFilters = state.editorTable.serializeFilters();
        // フォーカスクラスを除去して次タブ切り替え時に前タブのハイライトが残留しないようにする
        state.editorTable.clearFocusedCell();
        state.editorTable.deactivate();
        state.areaResizer.deactivate();
        state.fillController.deactivate();
        state.editorTableHandler.deactivate();
    }

    /**
     * タブ状態をアクティブ化（DOMを表示してイベントリスナーを登録）
     * state に保存されたペインスタックを復元する。
     * 初回アクティブ化（createTabState 内）では state.paneStack が初期化済みであること。
     */
    activateTabState(state: TabState): void {
        this.applyRelationsPanelVisibilityForTabState(state);
        state.wrapperElement.style.display = '';
        // グローバルリレーションパネルにアクティブなEditorTableを接続する
        // connectEditorTable内でEditorTable.relationsPanel フィールドも設定される（相互参照）
        this.relationsPanel.connectEditorTable(state.editorTable);
        state.editorTable.restoreScrollPosition(state.savedScrollTop, state.savedScrollLeft);
        state.editorTable.activate();
        state.areaResizer.activate();
        state.fillController.activate();

        // EditorTableHandler を有効化（IME対応）
        state.editorTableHandler.enable();

        // state に保存されたペインスタックと viewIndex を復元する
        // deactivateTabState() または createTabState() で保存された状態をそのまま使用する
        // slice() でコピーを復元する（参照共有による paneStack の相互汚染を防ぐ）
        this.paneStack = state.paneStack.slice();
        this.viewIndex = state.viewIndex;
        // 追加RP（paneStack[2]以降）を resume() でグローバルリスナーを再登録する。
        // deactivateTabState() での suspend() と対称的なペアとして呼ぶ。
        // DOM構造・ストアデータは保持されているため再描画は不要。
        for (let i = 2; i < this.paneStack.length; i++) {
            const entry = this.paneStack[i];
            if (entry.panel !== false) {
                entry.panel.resume();
            }
        }
        // DOM（左右スロット）にペインスタックの状態を反映する
        this.updateVisiblePanes();
        // wrapperが display:none → 表示に復帰した後、selectionオーバーレイの位置を再計算する。
        // 非表示中は getCellRectOrNull が null を返すため、hideRenderer() で消えたままになる。
        state.selection.updateRendererAfterResize();
    }

    private createInitialPaneStack(): Array<{ element: HTMLElement; panel: RelationsPanel | false }> {
        return [
            { element: this.editor.getLeftPaneForScroll(), panel: false },
            { element: this.relationsPanel.getPanelElement(), panel: this.relationsPanel },
        ];
    }

    /**
     * 指定インデックス以降の追加 RP エントリをスタックから破棄する
     * truncateFrom: このインデックスより大きいエントリを破棄する（inclusive: truncateFrom+1 から末尾まで）
     */
    private truncateStackAfterIndex(truncateFrom: number): void {
        const removeFrom = truncateFrom + 2;
        for (let i = this.paneStack.length - 1; i >= removeFrom; i--) {
            const entry = this.paneStack[i];
            if (entry.panel !== false) {
                entry.panel.disconnectEditorTable();
                if (entry.element.parentElement) {
                    entry.element.remove();
                }
            }
        }
        this.paneStack.splice(removeFrom);
    }

    /**
     * 表示ペインを更新する（viewIndex に基づいて左右スロットを入れ替える）
     */
    private updateVisiblePanes(): void {
        const left = this.paneStack[this.viewIndex];
        const right = this.paneStack[this.viewIndex + 1];
        this.editor.setVisiblePanes(left.element, right.element);
        this.editor.updateNavigationBar(this.viewIndex, this.paneStack.length);
    }

    /**
     * ←ボタン: ビューを1つ左にシフトする
     */
    navigateLeft(): void {
        if (this.viewIndex <= 0) return;
        this.viewIndex--;
        this.updateVisiblePanes();
    }

    /**
     * →ボタン: ビューを1つ右にシフトする
     */
    navigateRight(): void {
        if (this.viewIndex >= this.paneStack.length - 2) return;
        this.viewIndex++;
        this.updateVisiblePanes();
    }

    /**
     * ブラウザ履歴の復元時に viewIndex を指定の値に直接設定する。
     * NavigationHistory の tab-switch popstate ハンドラからのみ呼ばれる。
     * 指定値が有効範囲外の場合はクランプし、viewIndex+2 以降の余分なペインを破棄する。
     * （goBack で pane-push から tab-switch に戻った場合、paneStack が長いまま残るため）
     * truncate 後は tabState にも即座に反映する（ゾンビ RP 参照防止）。
     */
    restoreViewIndex(viewIndex: number): void {
        const maxIndex = Math.max(0, this.paneStack.length - 2);
        this.viewIndex = Math.min(Math.max(0, viewIndex), maxIndex);
        // viewIndex+2 以降の余分なペインを破棄する（goBack で浅いエントリに戻ったとき paneStack を詰める）
        this.truncateStackAfterIndex(this.viewIndex);
        this.updateVisiblePanes();
        // truncate で破壊された RP がtabState.paneStack に残らないよう即座に同期する
        this.syncPaneStackToActiveTabState();
    }

    /**
     * goForward で pane-push エントリに到達した際に呼ばれる。
     * paneStack が既にトランケートされている場合は pushRelationsPanel で再構築する。
     * paneStack が十分なら restoreViewIndex に委譲する。
     * NavigationHistory の pane-push popstate ハンドラからのみ呼ばれる。
     */
    restoreOrRebuildPaneStack(viewIndex: number, tableName: string, pkValue: string): void {
        if (this.paneStack.length < viewIndex + 2) {
            // paneStack が不足しているため pushRelationsPanel でペインスタックを再構築する。
            // この呼び出しは popstateHandler の try ブロック内で実行されるため
            // NavigationHistory.restoring=true が保持されており pushPaneChange は自動的にスキップされる。
            this.pushRelationsPanel(tableName, pkValue);
            // 再構築後の paneStack/viewIndex を tabState に反映する（ゾンビ参照防止）
            this.syncPaneStackToActiveTabState();
        } else {
            this.restoreViewIndex(viewIndex);
        }
    }

    /**
     * 現在の paneStack と viewIndex をアクティブタブの tabState に同期する。
     * popstate ハンドラで paneStack を変更した後に呼ぶ（ゾンビ RP 参照防止）。
     * restoreViewIndex と restoreOrRebuildPaneStack から呼ばれる。
     */
    private syncPaneStackToActiveTabState(): void {
        if (this.activeTabName === false) return;
        const state = this.tabStates.get(this.activeTabName);
        if (!state) return;
        state.paneStack = this.paneStack.slice();
        state.viewIndex = this.viewIndex;
    }

    /**
     * ペインスタックをルート状態（EditorTable + グローバルRP の2ペイン）にリセットする
     * メインテーブルで別の行を選択したとき、RelationsPanel.updateForRow() から呼ばれる。
     * すでにルート状態（paneStack.length <= 2 && viewIndex === 0）の場合は何もしない。
     */
    resetPaneStackToRoot(): void {
        if (this.paneStack.length <= 2 && this.viewIndex === 0) return;
        this.truncateStackAfterIndex(0);
        this.viewIndex = 0;
        this.updateVisiblePanes();
    }

    /**
     * RelationsPanel をペインスタックに追加する（ミニテーブルの Ctrl+Click 時に RelationsPanel.navigateToDefinition から呼ばれる）
     * viewIndex より右にある既存エントリを破棄して新しい RP をスタック末尾に追加し、ビューを右端にシフトする
     */
    pushRelationsPanel(tableName: string, pkValue: string): void {
        // viewIndex より右の分岐パスを破棄する（viewIndex+1 の右ペインは保持して viewIndex+2 以降を削除）
        this.truncateStackAfterIndex(this.viewIndex);

        // 新しい RelationsPanel を生成してスタックに追加する
        const rp = new RelationsPanel(this.store, this.reverseReferenceEngine, this.notification);
        rp.connectTab(this);
        // ペインスタック経由で表示される RP は即座に visible にする（visibleガードを通過させるため）
        rp.notifyVisibilityChanged(true);
        const rpElement = rp.getPanelElement();
        this.paneStack.push({ element: rpElement, panel: rp });

        // ビューを右端（新RP が右スロットに表示される位置）にシフトする
        this.viewIndex = this.paneStack.length - 2;

        // 表示を更新する
        this.updateVisiblePanes();

        // paneStack 深化をブラウザ履歴に記録する（viewIndex 確定後に記録する）
        // アクティブタブなしで pushRelationsPanel が呼ばれるのは設計ミスのため throw する
        if (this.activeTabName === false) throw new Error('[Tab] pushRelationsPanel: activeTabName が false のまま pushRelationsPanel が呼ばれました');
        // goForward で復帰できるよう tableName/pkValue も記録する
        this.navigationHistory.pushPaneChange(this.activeTabName, this.viewIndex, tableName, pkValue);

        // 新 RP にテーブルの参照データを表示させる
        rp.showForTableRowAsync(tableName, pkValue).catch((err: unknown) => {
            console.error('[Tab] pushRelationsPanel: showForTableRowAsync failed:', String(err));
            this.notification.show('関連テーブルの表示に失敗しました');
        });
    }

    /**
     * ミニテーブルの行選択変化を受けて、右隣ペインのRPを更新する
     * RelationsPanel.notifyMiniTableRowSelectionChanged から呼ばれる。
     *
     * 処理:
     *   1. paneStack から sourceRP の位置を検索する
     *   2. 右隣エントリ（sourceRpIndex + 1）がRelationsPanelであれば showForTableRowAsync を呼ぶ
     *   3. 右隣がEditorTable（panel === false）または存在しない場合は何もしない
     *
     * ペインスタックの左スロット側（viewIndex）に表示中のRPのミニテーブルが操作された場合のみ
     * 右スロット側（viewIndex + 1）のRPを更新する想定だが、Tab側ではスタック全体を走査する。
     * これにより将来的に複数段階の連動も自然に対応できる。
     */
    updateNextPaneForMiniTableRow(sourceRP: RelationsPanel, tableName: string, pkValue: string): void {
        // sourceRP がスタックのどこにいるかを探す
        const sourceRpIndex = this.paneStack.findIndex(entry => entry.panel === sourceRP);
        if (sourceRpIndex === -1) return;

        // 右隣エントリを取得する（境界チェックで undefined 暗黙評価を防ぐ）
        if (sourceRpIndex + 1 >= this.paneStack.length) return;
        const nextEntry = this.paneStack[sourceRpIndex + 1];

        // 右隣がRelationsPanelでない場合（EditorTable = panel === false）は何もしない
        if (nextEntry.panel === false) return;

        // 右隣RPをtableName/pkValueで更新する（非同期レースコンディションはshowForTableRowAsyncのcurrentRequestIdでガード済み）
        nextEntry.panel.showForTableRowAsync(tableName, pkValue).catch((err: unknown) => {
            console.error('[Tab] updateNextPaneForMiniTableRow: showForTableRowAsync failed:', String(err));
            this.notification.show('関連テーブルの更新に失敗しました');
        });
    }

    /**
     * 新しいタブ状態を作成
     */
    private createTabState(name: string, tabButton: TabButton): void {
        // タブの名前から同名のマスターデータを取り出してきます。
        readFileAsync("schema/" + name + ".json").then(async (text) => {
            const json = JSON.parse(text);
            if (!this.tabButtons.includes(tabButton)) {
                this.loadingTabNames.delete(name);
                this.resolvePendingTableOpen(name, false);
                return;
            }

            // 中央ストアにCSVを読み込み・登録
            const csv = await this.store.registerTableAsync(name);
            if (!this.tabButtons.includes(tabButton)) {
                this.store.unregisterTable(name);
                this.loadingTabNames.delete(name);
                this.resolvePendingTableOpen(name, false);
                return;
            }
            // 通常テーブルはフィルター・ソートアイコンを持つため hasIcons: true
            const tableData = EditorTableData.parse(json, csv, true, { materializeBody: false });

            // ラッパー要素を作成（このタブのDOM全体を包む）
            // editor.appendChild は左ペインへのappendに変更された
            const wrapperElement = document.createElement('div');
            wrapperElement.classList.add('tab-wrapper');
            wrapperElement.dataset.tabName = name;
            wrapperElement.style.height = '100%';
            wrapperElement.style.position = 'sticky';
            wrapperElement.style.top = '0';
            wrapperElement.style.left = '0';
            wrapperElement.style.display = 'none';
            this.editor.appendChild(wrapperElement);

            // EditorTableと関連オブジェクトをファクトリ関数で生成（相互参照を解決）
            const editorTableFactoryResult = this.createEditorTable(
                name, tableData, wrapperElement, tabButton
            );
            const editorTable = editorTableFactoryResult.editorTable;
            const selection = editorTableFactoryResult.selection;
            const editorTableHandler = editorTableFactoryResult.editorTableHandler;
            const history = editorTableFactoryResult.history;
            const areaResizer = editorTableFactoryResult.areaResizer;
            const fillController = editorTableFactoryResult.fillController;

            // フリーズペイン状態の復元: スキーマJSONに保存された固定列数・固定行数を適用する
            // createEditorTable() 内で initialize() が完了しているためDOM構築済み
            if ('frozenColumnCount' in json && (json.frozenColumnCount as number) > 0) {
                editorTable.freezeColumns(json.frozenColumnCount as number);
            }
            if ('frozenRowCount' in json && (json.frozenRowCount as number) > 0) {
                editorTable.freezeRows(json.frozenRowCount as number);
            }

            // ソート状態の復元: スキーマJSONに保存されたソートキーを適用する
            // ソート復元はDOM行の再配置を行うためフリーズ復元後に実施する
            if ('sortKeys' in json && Array.isArray(json.sortKeys) && (json.sortKeys as unknown[]).length > 0) {
                editorTable.restoreSortState(json.sortKeys as { columnName: string; direction: 'asc' | 'desc' }[]);
            }

            // フィルター状態の復元: スキーマJSONに保存されたフィルターを適用する
            // ソート復元後に実施することで、ソート順を維持したままフィルターが適用される
            if ('filters' in json && typeof json.filters === 'object' && json.filters !== null && Object.keys(json.filters as object).length > 0) {
                editorTable.restoreFilterState(json.filters as { [columnName: string]: string[] });
            }

            // 開いているテーブルのマップに登録
            this.openEditorTables.set(name, editorTable);

            // ValidationPanel が接続されている場合: openEditorTables.set() 完了後に全テーブルバリデーションを実行する。
            // createEditorTable() 内ではなくここで呼ぶことで、今開いたテーブルが applyErrorClassesToAllEditorTables()
            // の対象に含まれ、初期表示時の重複PKにも cell-error クラスが正しく付与される。
            if (this.validationPanel !== false) {
                this.validationPanel.runAndUpdate();
            }

            // 参照先テーブルを事前読み込み
            this.reference.preloadReferenceTables(tableData, editorTable);

            // 逆参照を並行して解決（インメモリデータ優先取得用にマップを渡す）
            this.reference.resolveReverseReferencesAsync(name, editorTable);

            // ドロップダウン入力コンポーネントを作成。
            // 入力フィールド(element)の公開を避けるため EditorTableHandler.createDropdownInput 経由で生成する。
            const dropdownInput = editorTableHandler.createDropdownInput(wrapperElement);
            // シングルトン DropdownQuickView を接続してクイックビュー機能を有効にする
            dropdownInput.connectDropdownQuickView(this.sharedDropdownQuickView);

            // EditorTableHandler に参照データキャッシュとドロップダウンを設定
            editorTableHandler.setReferenceComponents(this.referenceDataCache, dropdownInput, tableData);

            const restoredEditorTableState = this.restoredEditorTableStates.get(name);
            if (restoredEditorTableState !== undefined) {
                selection.restoreState(restoredEditorTableState.selection.range, restoredEditorTableState.selection.focus);
            } else {
                // 初期選択をA1（row=1, column=1）に設定
                selection.setRange(1, 1, 1, 1);
                selection.move(1, 1);
            }

            // git statusを取得してこのテーブルのGitDiffTrackerを構築・接続する。
            // 巨大テーブルではHEAD版CSV取得や差分走査に時間がかかるため、初期表示はブロックしない。
            editorTable.refreshGitDiffAsync()
                .catch((e: unknown) => { console.error('[Tab] createTabState: refreshGitDiffAsync failed:', e); });

            if (!this.tabButtons.includes(tabButton)) {
                this.discardCreatedTabState(name, wrapperElement, editorTable, editorTableHandler, history, areaResizer, fillController);
                this.loadingTabNames.delete(name);
                this.resolvePendingTableOpen(name, false);
                return;
            }

            const initialPaneStack = this.createInitialPaneStack();
            const restoredScroll = restoredEditorTableState?.scroll ?? {scrollLeft: 0, scrollTop: 0};
            const restoredFormPanelState = this.cloneStoredFormPanelStateAsRuntime(restoredEditorTableState?.formPanel ?? null);

            // 初回アクティブ化の前にペインスタックの初期状態を作成する
            // activateTabState() は state.paneStack / state.viewIndex から復元するため、
            // createTabState() では現在表示中のタブを触らずに初期値だけを state に格納する
            const state: TabState = {
                editorTable,
                selection,
                editorTableHandler,
                history,
                areaResizer,
                fillController,
                wrapperElement,
                dropdownInput,
                savedScrollLeft: restoredScroll.scrollLeft,
                savedScrollTop: restoredScroll.scrollTop,
                paneStack: initialPaneStack,
                viewIndex: 0,
                savedSortKeys: [],
                savedFilters: {},
                relationsPanelVisible: restoredFormPanelState !== null ? false : (restoredEditorTableState?.relationsPanelVisible ?? this.defaultRelationsPanelVisible),
                formPanelState: restoredFormPanelState,
            };
            this.tabStates.set(name, state);
            this.bindEditorTableUiStatePersistence(wrapperElement);

            // タブ生成時点でストアがDirty状態のテーブルは、タブボタンにDirtyマークを設定する。
            // activateTabState の前にチェックする理由:
            //   activateTabState → RelationsPanel更新 → 旧ミニテーブルのHistory破棄 という流れで
            //   ミニテーブルのDirty Historyが失われるため、破棄前にチェックする必要がある。
            const isDirtyOnCreate = this.store.isTableDirty(name);

            if (isDirtyOnCreate) {
                tabButton.setDirty(true);
            }

            // 保存済みUI状態の description は実ファイル読み込み前の仮表示として使う。
            // スキーマ読み込み後は実スキーマの値で更新し、削除されていればタブボタンからも消す。
            tabButton.applyDescription(tableData.description);
            this.scheduleTabLayout(true);

            const shouldActivate = tabButton.element.classList.contains('tab-button-active');
            this.loadingTabNames.delete(name);

            if (shouldActivate) {
                // 読み込み完了時点で別の通常タブが表示中なら、ここで確実に非表示化する。
                if (this.activeTabName && this.activeTabName !== name) {
                    const previousState = this.tabStates.get(this.activeTabName);
                    if (previousState && previousState.wrapperElement.style.display !== 'none') {
                        this.deactivateTabState(previousState);
                    }
                }

                // アクティブ化（state.paneStack / state.viewIndex を this フィールドに復元する）
                this.activeTabName = name;
                this.persistTabs();
                this.activateTabState(state);
                this.sidebar.notifyActiveTableChanged(name);
                state.editorTable.forceVirtualScrollRecalculate();
                this.editor.syncActiveTableScrollState();
                state.selection.updateRendererAfterResize();

                // 新規タブ初回表示時にRelationsPanelを強制更新する（初期フォーカス行でパネルを確実に描画）
                state.editorTable.forceRefreshRelationsPanel();
                const hadPendingNavigation = this.hasPendingNavigation();
                this.consumePendingNavigation(state);
                if (!hadPendingNavigation) {
                    this.restoreFormPanelForTabState(state);
                    if (restoredEditorTableState !== undefined) {
                        this.restoreEditorTableScrollPositionAfterLayout(state, restoredEditorTableState.scroll);
                    }
                }
                this.persistTabs();
            } else {
                this.persistTabs();
            }

            // openTableAsync() で待機中の呼び出し元には、TabState の構築完了後に通知する。
            this.resolvePendingTableOpen(name, true);
        }).catch(() => {
            // スキーマ読み込み失敗時にpending解決を通知する
            this.loadingTabNames.delete(name);
            this.resolvePendingTableOpen(name, false);
        });
    }

    private resolvePendingTableOpen(name: string, success: boolean): void {
        const pendingResolves = this.pendingTableOpens.get(name);
        if (!pendingResolves) return;
        this.pendingTableOpens.delete(name);
        for (const resolve of pendingResolves) {
            resolve(success);
        }
    }

    private discardCreatedTabState(
        name: string,
        wrapperElement: HTMLElement,
        editorTable: EditorTable,
        editorTableHandler: EditorTableHandler,
        history: History,
        areaResizer: AreaResizer,
        fillController: FillController
    ): void {
        editorTable.deactivate();
        areaResizer.deactivate();
        fillController.deactivate();
        editorTableHandler.deactivate();
        history.unregister();
        this.store.unregisterTable(name);
        wrapperElement.remove();
        this.openEditorTables.delete(name);
    }

    /**
     * EditorTableと関連オブジェクトをファクトリ関数で生成
     * 相互参照を解決するために Object.assign + Object.setPrototypeOf を使用
     */
    createEditorTable(
        name: string, tableData: EditorTableData,
        wrapperElement: HTMLElement, tabButton: TabButton
    ): EditorTableFactoryResult {
        // 相互参照を解決するため、一時的な空オブジェクトを作成
        const editorTable = {} as EditorTable;

        const mainViewportElement = document.createElement('div');
        mainViewportElement.classList.add('editor-table-main-viewport');
        const scrollController = new ScrollViewportController(mainViewportElement);

        // Selection を作成（editorTable への参照をコンストラクタで渡す）
        const selection = new Selection(editorTable, wrapperElement, scrollController);

        // History を作成（EditorTable・ストア・テーブル名が必要）
        const history = new History(editorTable, tabButton, this.store, name, 1000);

        // EditorTableHandler を作成（element を所有し、全イベントを管理）
        // scrollController を渡すことで focusWithoutScrolling() がスクロール位置を保護できる
        const editorTableHandler = new EditorTableHandler(editorTable, selection, history, scrollController, this.notification);

        // GridTextField を作成（EditorTableHandler.createGridTextField 経由で element を隠蔽）
        // container は wrapperElement（position:relative）で grid-textfield の絶対配置基準になる
        const textField = editorTableHandler.createGridTextField(wrapperElement, editorTable, selection);

        // EditorTableHandler に GridTextField を設定（循環依存解決）
        editorTableHandler.setTextField(textField);

        // AreaResizer を作成（History, Selection が必要）
        const areaResizer = new AreaResizer(wrapperElement, history, selection);

        // 本物の EditorTable インスタンスを作成（データ行+バッファ1行で通常の編集テーブルを生成）
        const emptyRowCount = tableData.rowCount + 1;
        const realEditorTable = new EditorTable(
            name, tableData, this.referenceDataCache, this.store, editorTableHandler,
            selection, this.contextMenu, history, areaResizer,
            scrollController, this.sidebar, mainViewportElement, emptyRowCount, 'editor-table', false, true, true
        );

        // editorTable に本物のインスタンスの内容をコピー
        Object.assign(editorTable, realEditorTable);
        Object.setPrototypeOf(editorTable, EditorTable.prototype);

        // 分割先モジュールを生成・注入（Object.assign後なのでeditorTableは完全に初期化済み）
        editorTable.initializeModules(this.notification);
        editorTable.setLargeFileSettings(createLargeFileSettings(getAppliedSettings()));
        // Tab への参照を設定する（フォームビュー表示のための密結合）
        editorTable.tab = this;

        // FillController を作成（EditorTable, Selection, History が必要）
        const fillController = new FillController(editorTable, selection, history);

        // DOM要素を追加
        editorTable.appendTo(wrapperElement);
        wrapperElement.appendChild(selection.selectionOverlayElement);
        wrapperElement.appendChild(selection.fillPreviewElement);
        wrapperElement.appendChild(selection.fillHandle);
        editorTableHandler.appendTo(wrapperElement);

        // AreaResizer に EditorTable を設定
        areaResizer.setEditorTable(editorTable);

        // DOM要素を構築
        editorTable.initialize();

        // FillController のイベントを初期化（EditorTable が初期化された後）
        fillController.initialize();

        // ValidationPanel が接続されている場合: スキーマを登録して EditorTable に接続する。
        // runAndUpdate() は呼び出し元 createTabState() で openEditorTables.set() 完了後に呼ぶ。
        // ここで runAndUpdate() を呼ぶと openEditorTables に今開いたテーブルがまだ登録されておらず、
        // applyErrorClassesToAllEditorTables() が新テーブルのDOMに適用できないため。
        if (this.validationPanel !== false) {
            this.validationPanel.registerSchema(
                name,
                tableData.primaryKeyColumns,
                tableData.header.map(col => ({ name: col.name, type: col.type, reference: col.reference, defaultValue: col.defaultValue }))
            );
            editorTable.connectValidationPanel(this.validationPanel);
        }
        // エラーツールチップの接続
        if (this.errorTooltip !== false) {
            editorTable.connectErrorTooltip(this.errorTooltip);
        }
        // スクロールバーマーカートラックの接続（通常テーブル専用。ミニテーブルでは呼ばない）
        editorTable.connectScrollbarMarkerTrack(this.editor.getScrollbarMarkerTrack());

        return {editorTable, selection, editorTableHandler, history, areaResizer, fillController};
    }

    /**
     * リレーションパネル用ミニEditorTableを生成する
     *
     * emptyRowCount を呼び出し元から受け取り、N:1・1:Nいずれのミニテーブルでも1以上を渡してバッファ行を確保する。
     * 編集可能モードで生成し、FillControllerも有効化する。
     *
     * scrollContainer: editor-table / selection / areaResizer を配置する overflow:auto のスクロール領域
     * positioningContainer: grid-textfield を配置する position:relative の祖先要素
     *   → overflow:auto のスクロール領域に grid-textfield を入れると position:absolute の要素が
     *      クリッピングされるため、overflow:visible かつ position:relative の外側要素に配置する
     *   → relations-panel.ts では panelElement（.relations-panel）を渡す
     *
     * 戻り値: editorTable・fillController・areaResizer の3点セット。
     * fillController と areaResizer は RelationsPanel が保持し、破棄時に deactivate する。
     * areaResizer は activate() 済みで返るため、呼び出し側は deactivate() のみ管理すれば良い。
     */
    createMiniEditorTable(
        scrollContainer: HTMLElement,
        wrapperElement: HTMLElement,
        dropdownContainer: HTMLElement,
        tableKey: string,
        schemaJson: Record<string, unknown>,
        csvHeader: string[],
        csvRows: string[][],
        emptyRowCount: number,
        connectQuickView: boolean
    ): {editorTable: EditorTable; fillController: FillController; areaResizer: AreaResizer; history: History} {
        // CSVオブジェクトを組み立てる
        const csv = new Csv();
        csv.header = csvHeader;
        csv.body = csvRows;
        // ミニテーブルはフィルター・ソートアイコンを持たないため hasIcons: false
        const tableData = EditorTableData.parse(schemaJson, csv, false);

        // 相互参照を解決するため一時的な空オブジェクトを作成（Tab.createEditorTable と同パターン）
        const editorTable = {} as EditorTable;

        // 左ペインと同じ構造: scrollContainer（overflow:auto）がスクロールを担当し、
        // wrapperElement（通常フロー子要素）にEditorTable・Selection・テキストフィールド・ドロップダウンを全配置する。
        // wrapperElement.getBoundingClientRect() がスクロール量を含むため座標計算が正しくなり、
        // テキストフィールドはスクロールに追従しつつクリッピングされない。
        const scrollController = new ScrollViewportController(scrollContainer);

        const selection = new Selection(editorTable, wrapperElement, scrollController);

        // ダミーTabButton: dirty表示の通知先として使用（DOMには追加しない）
        // ストア経由の通知で更新されるためDOMへの追加は不要。コンストラクタの型制約上ダミーとして渡す。
        const dummyTabButton = new TabButton(this.editor, this, '[mini]', null);
        const history = new History(editorTable, dummyTabButton, this.store, tableKey, 100);

        // scrollController を渡すことで focusWithoutScrolling() がスクロール位置を保護できる
        const editorTableHandler = new EditorTableHandler(editorTable, selection, history, scrollController, this.notification);
        const textField = editorTableHandler.createGridTextField(wrapperElement, editorTable, selection);
        editorTableHandler.setTextField(textField);

        const areaResizer = new AreaResizer(wrapperElement, history, selection);

        // ミニテーブルも 'editor-table' クラスを付与してテストセレクタに対応する
        // search-panel.spec.ts では '.editor-left-pane .editor-table' で左ペインを絞り込むため競合しない
        const realEditorTable = new EditorTable(
            tableKey, tableData, this.referenceDataCache, this.store, editorTableHandler,
            selection, this.contextMenu, history, areaResizer,
            scrollController, this.sidebar, scrollContainer, emptyRowCount, 'editor-table', true, false, false
        );

        Object.assign(editorTable, realEditorTable);
        Object.setPrototypeOf(editorTable, EditorTable.prototype);

        editorTable.initializeModules(this.notification);
        editorTable.setLargeFileSettings(createLargeFileSettings(getAppliedSettings()));

        // 左ペインと同じ: 全要素を wrapperElement に配置する
        editorTable.appendTo(wrapperElement);
        wrapperElement.appendChild(selection.selectionOverlayElement);
        wrapperElement.appendChild(selection.fillPreviewElement);
        wrapperElement.appendChild(selection.fillHandle);
        editorTableHandler.appendTo(wrapperElement);

        areaResizer.setEditorTable(editorTable);
        editorTable.initialize();

        // ドロップダウンは scrollContainer の overflow:auto にクリッピングされないよう
        // scrollContainer の外側（dropdownContainer）に配置する。
        const dropdownInput = editorTableHandler.createDropdownInput(dropdownContainer);
        // QV内ミニテーブルは自己破棄ループを防ぐためクイックビューを接続しない。
        // RelationsPanel 等の通常ミニテーブルのみ接続する。
        if (connectQuickView) { dropdownInput.connectDropdownQuickView(this.sharedDropdownQuickView); }
        editorTableHandler.setReferenceComponents(this.referenceDataCache, dropdownInput, tableData);

        // ミニEditorTableのhandlerは初期状態では非アクティブとする。
        // enable()を呼ぶとフォーカスが奪われ、メインEditorTableのCtrl+Z等が
        // ミニEditorTableのhistoryに届いてしまうため。
        // ユーザーがセルをクリックしたとき activateHandler() → activate() でアクティブ化する。

        // FillControllerを生成・有効化（フィルハンドルによるドラッグ操作）
        // deactivate は RelationsPanel.destroyMiniEditorTables() で一括して行う
        const fillController = new FillController(editorTable, selection, history);
        fillController.initialize();
        fillController.activate();

        // AreaResizerを有効化（列幅ドラッグリサイズ）
        // deactivate は RelationsPanel.destroyMiniEditorTables() で一括して行う
        areaResizer.activate();

        // SelectionDragController（window mousemove/mouseup）と ScrollBinding を有効化する
        // これがないとミニテーブルでマウスドラッグによる範囲選択が機能しない
        // deactivate は RelationsPanel.destroyMiniEditorTables() で一括して行う
        editorTable.activate();

        // 参照先テーブルを事前読み込みし、完了後に参照ヒントを一括適用する
        this.reference.preloadReferenceTables(tableData, editorTable);

        // 逆参照ヒント（cell-reverse-reference-hint）をミニテーブルのPK列にも表示するため解決する
        this.reference.resolveReverseReferencesAsync(tableKey, editorTable);

        // ValidationPanel が接続されている場合: ミニテーブルにもスキーマを登録して ValidationPanel を接続する。
        // ミニテーブルは openEditorTables に登録されないため runAndUpdate() では適用されない。
        // 代わりに runValidation()（isMiniTable パス）で独立してPKバリデーションを実行する。
        if (this.validationPanel !== false) {
            this.validationPanel.registerSchema(
                tableKey,
                tableData.primaryKeyColumns,
                tableData.header.map(col => ({ name: col.name, type: col.type, reference: col.reference, defaultValue: col.defaultValue }))
            );
            editorTable.connectValidationPanel(this.validationPanel);
        }
        // エラーツールチップの接続
        if (this.errorTooltip !== false) {
            editorTable.connectErrorTooltip(this.errorTooltip);
        }

        // git差分ハイライト（refreshGitDiffAsync）は呼び出し元が適切なタイミングで呼ぶ。
        // RelationsPanelはsetStoreRowIndices()後に呼び、DropdownQuickViewはReadOnly専用のため呼ばない。

        return {editorTable, fillController, areaResizer, history};
    }

    /**
     * 現在アクティブなタブの状態を取得
     */
    getActiveTabState(): TabState | false {
        if (!this.activeTabName) return false;
        const state = this.tabStates.get(this.activeTabName);
        if (!state) return false;
        return state;
    }

    /**
     * テーブル名からタブ状態を取得する（EditorAPI がタブを開いていないテーブルへの操作を判定するために使用する）
     */
    getTabStateByName(tableName: string): TabState | null {
        const state = this.tabStates.get(tableName);
        if (!state) return null;
        return state;
    }

    /**
     * テーブルをプログラム的に開く。
     * 既にタブが開いている場合は即座にアクティブ化して true を返す。
     * まだ開かれていなければタブを作成し、TabState の構築完了後に true を返す。
     * スキーマ読み込み失敗時は false を返す。
     */
    openTableAsync(tableName: string): Promise<boolean> {
        // 既にTabStateが存在する場合は、API名どおり既存タブをアクティブ化して成功を返す。
        // Viewプラグインから開いた後にブラウザ履歴で戻った場合も、再実行で表示を復帰できる必要がある。
        if (this.tabStates.has(tableName)) {
            this.enableTabButton(tableName);
            return Promise.resolve(true);
        }

        const existingPendingResolves = this.pendingTableOpens.get(tableName);
        if (existingPendingResolves) {
            return new Promise<boolean>((resolve) => {
                existingPendingResolves.push(resolve);
            });
        }

        return new Promise<boolean>((resolve) => {
            // pending解決を登録する
            this.pendingTableOpens.set(tableName, [resolve]);
            // TabButton を作成（既存なら取得）して有効化する
            // description は null で良い（createTabState内でスキーマから後付けされる）
            this.append(tableName, null);
            this.enableTabButton(tableName);
        });
    }

    /** EditorAPI を後から接続する（main.ts で EditorAPI 構築後に呼ばれる） */
    connectEditorApi(api: EditorAPI): void {
        this.editorApi = api;
    }

    /** Viewプラグインホストを後から接続する（main.tsで構築後に呼ばれる） */
    connectViewPluginHost(host: ViewPluginHost): void {
        this.viewPluginHost = host;
    }

    /** ui-state復元でアクティブだったViewプラグインタブを、プラグイン読み込み後に表示する */
    restorePendingViewPluginTabFromUiState(): void {
        const tabName = this.pendingRestoredViewPluginActiveTabName;
        if (tabName === null) return;
        this.pendingRestoredViewPluginActiveTabName = null;

        const pluginId = this.viewPluginIdsByTabName.get(tabName);
        if (pluginId === undefined) return;
        if (this.viewPluginHost === false || this.viewPluginHost.getPlugin(pluginId) === null) {
            this.destroyViewPluginTab(tabName);
            this.removeTabButton(tabName);
            this.activateFirstAvailableRestoredTab();
            return;
        }

        this.enableTabButton(tabName);
    }

    private activateFirstAvailableRestoredTab(): void {
        if (this.activeTabName !== false) return;
        const tabButton = this.tabButtons[0];
        if (tabButton !== undefined) {
            tabButton.click();
            return;
        }
        this.clearSidebarSelection();
        this.persistTabs(false);
    }

    /** テーブル保存イベントを EditorAPI に委譲する（EditorTable から呼ばれる） */
    emitTableSaved(tableName: string): void {
        if (this.editorApi !== false) this.editorApi.emitTableSaved(tableName);
    }

    async refreshSourceControlAsync(statusResult?: GitStatusResult): Promise<void> {
        await this.sidebar.refreshSourceControlAsync(statusResult);
    }

    /** 行選択変更イベントを EditorAPI に委譲する（EditorTable から呼ばれる） */
    emitRowSelected(tableName: string, rowIndex: number): void {
        if (this.editorApi !== false) this.editorApi.emitRowSelected(tableName, rowIndex);
    }

    // =========================================================================
    // TabDragDrop ファサード
    // =========================================================================

    moveTabButton(fromName: string, toName: string, insertBefore: boolean): void {
        this.dragDrop.moveTabButton(fromName, toName, insertBefore);
    }

    clearDropIndicators(): void {
        this.dragDrop.clearDropIndicators();
    }

    setDraggingTabName(name: string): void {
        this.dragDrop.setDraggingTabName(name);
    }

    getDraggingTabName(): string | false {
        return this.dragDrop.getDraggingTabName();
    }

    clearDraggingTabName(): void {
        this.dragDrop.clearDraggingTabName();
    }

    updateDropIndicator(clientX: number, clientY: number): void {
        this.dragDrop.updateDropIndicator(clientX, clientY);
    }

    dropTab(clientX: number, clientY: number): void {
        this.dragDrop.dropTab(clientX, clientY);
    }

    /**
     * ツールバーのRelationsアイコンから、現在のタブだけRelationsPanelを開閉する。
     */
    toggleRelationsPanelForActiveTab(): void {
        const state = this.getActiveTabState();
        if (state === false) {
            this.defaultRelationsPanelVisible = !this.defaultRelationsPanelVisible;
            if (this.defaultRelationsPanelVisible) {
                this.editor.showRelationsPanel();
            } else {
                this.editor.hideRelationsPanel();
            }
            this.persistTabs();
            return;
        }
        state.relationsPanelVisible = !state.relationsPanelVisible;
        if (state.relationsPanelVisible) {
            this.closeFormPanel();
        }
        this.applyRelationsPanelVisibilityForTabState(state);
        if (state.relationsPanelVisible) {
            state.editorTable.forceRefreshRelationsPanel();
        }
        this.persistTabs();
    }

    private applyRelationsPanelVisibilityForTabState(state: TabState): void {
        if (state.relationsPanelVisible) {
            this.editor.showRelationsPanel();
        } else {
            this.editor.hideRelationsPanel();
        }
    }

    /**
     * ツールバーのフォームアイコンから、現在選択中の行のフォームビューを開閉する。
     * RelationsPanel と同じく「現在の選択行を右ペインで見る」操作にする。
     */
    toggleFormPanelForActiveRow(): void {
        if (this.currentFormPanel !== false) {
            this.closeFormPanel();
            return;
        }
        const target = this.resolveActiveFormPanelTarget();
        if (target === null) {
            this.notification.show('フォームビューを表示する行を選択してください');
            return;
        }
        this.showFormPanel(target.tableName, target.pkValue, target.storeRowIndex);
    }

    /**
     * FormPanel 表示中に通常テーブルの選択行が変わった場合、フォーム内容を現在行へ追従させる。
     * 選択追従は表示状態の更新であり、ブラウザ履歴には積まない。
     */
    refreshFormPanelForSelectedRow(tableName: string, rowIndex: number): void {
        if (this.currentFormPanel === false) return;
        if (this.currentFormPanel.containsElement(document.activeElement)) return;
        const state = this.tabStates.get(tableName);
        if (!state) return;
        const pkValue = state.editorTable.getRowPkValue(rowIndex);
        if (pkValue === '') return;
        const storeRowIndex = state.editorTable.resolveStoreRowIndex(rowIndex - 1);
        this.setActiveFormPanelState({
            navStack: [{ tableName, pkValue, label: `${tableName} / ${pkValue}`, ...(storeRowIndex >= 0 ? {storeRowIndex} : {}) }],
        });
        this.currentFormPanel.showForRowAsync(tableName, pkValue, storeRowIndex >= 0 ? storeRowIndex : null).catch(err => {
            console.error('[Tab] refreshFormPanelForSelectedRow: showForRowAsync failed:', String(err));
        });
    }

    private resolveActiveFormPanelTarget(): { tableName: string; pkValue: string; storeRowIndex: number | null } | null {
        const state = this.getActiveTabState();
        if (state === false) return null;
        const rowIndex = state.selection.getFocus().row;
        const pkValue = state.editorTable.getRowPkValue(rowIndex);
        if (pkValue === '') return null;
        const storeRowIndex = state.editorTable.resolveStoreRowIndex(rowIndex - 1);
        return { tableName: state.editorTable.tableName, pkValue, storeRowIndex: storeRowIndex >= 0 ? storeRowIndex : null };
    }

    /**
     * フォームビューを表示する（PKセル右クリックメニューから呼ばれる）
     * RelationsPanelの親要素（rightSlot）にFormPanelをオーバーレイして表示する。
     * 既存のFormPanelがあれば破棄してから新しいものを生成する。
     * 履歴 push は NavigationHistory.pushFormPanelOpen 内部の restoring フラグで自律的に制御される。
     * @param tableName 対象テーブル名
     * @param pkValue 対象行のPK値
     */
    showFormPanel(tableName: string, pkValue: string, storeRowIndex: number | null = null): void {
        // 履歴に記録する（pushFormPanelOpen 内部の restoring フラグで popstate 復元中は自律的にスキップされる）
        const ownerTabName = this.activeTabName !== false ? this.activeTabName : tableName;
        this.navigationHistory.pushFormPanelOpen(ownerTabName, pkValue, storeRowIndex);

        // FormPanel を生成して表示する（共通処理）
        const formPanel = this.createFormPanel();
        this.setActiveFormPanelState({
            navStack: [{ tableName, pkValue, label: `${tableName} / ${pkValue}`, ...(storeRowIndex !== null ? {storeRowIndex} : {}) }],
        });
        // 指定行のフォームを非同期で描画する
        // FormPanel.renderCurrentPageAsync 内でエラー通知するため、ここでは通知しない（二重通知防止）
        formPanel.showForRowAsync(tableName, pkValue, storeRowIndex).catch(err => {
            console.error('[Tab] showFormPanel: showForRowAsync failed:', String(err));
        });
    }

    /**
     * FormPanel を生成して右スロットにオーバーレイする共通処理。
     * 既存の FormPanel があれば破棄してから新しいものを生成する。
     * showFormPanel と restoreFormPanelForTabState の両方から呼ばれる。
     */
    private createFormPanel(): FormPanel {
        this.closeRelationsPanelForActiveTab();
        // 既存のFormPanelを破棄する（新しいPK値で開き直す場合）
        if (this.currentFormPanel !== false) {
            this.currentFormPanel.remove();
            this.currentFormPanel = false;
        }
        // FormPanel 表示中だけ右スロットを開く。
        // RelationsPanel は排他表示のため、create 前に現在タブ側で閉じておく。
        const formPanelHost = this.editor.showRightSlotForFormPanel();
        // FormPanel を生成して右スロットにオーバーレイする
        const formPanel = new FormPanel(this.store, this.referenceDataCache, this.reverseReferenceEngine, this, this.notification, this.validationPanel);
        formPanel.appendTo(formPanelHost);
        this.currentFormPanel = formPanel;
        this.notifyFormPanelVisibilityListener(true);
        return formPanel;
    }

    private closeRelationsPanelForActiveTab(): void {
        const state = this.getActiveTabState();
        if (state !== false) {
            state.relationsPanelVisible = false;
        }
        this.editor.hideRelationsPanel();
    }

    /**
     * フォームビューを閉じる
     * ツールバーのフォームビュー切り替えや履歴復元から呼ばれる
     */
    closeFormPanel(): void {
        this.removeCurrentFormPanel();
        this.setActiveFormPanelState(null);
    }

    suspendFormPanelForActiveTab(): void {
        const state = this.getActiveTabState();
        if (state === false) {
            this.removeCurrentFormPanel();
            return;
        }
        this.suspendFormPanelForTabState(state);
    }

    restoreFormPanelForActiveTab(): void {
        const state = this.getActiveTabState();
        if (state === false) return;
        this.restoreFormPanelForTabState(state);
    }

    private suspendFormPanelForTabState(state: TabState): void {
        if (this.currentFormPanel === false) return;
        // NavigationHistory の popstate では、タブ切り替え前に FormPanel だけを退避する。
        // 右スロットを戻す前に保存しないと、左ペイン幅が広がった状態で scrollLeft がクランプされる。
        state.savedScrollLeft = state.editorTable.getScrollLeft();
        state.savedScrollTop = state.editorTable.getScrollTop();
        const navStack = this.currentFormPanel.getNavStackSnapshot();
        state.formPanelState = navStack.length > 0 ? { navStack } : null;
        this.removeCurrentFormPanel();
    }

    private restoreFormPanelForTabState(state: TabState): void {
        if (state.formPanelState === null) return;
        if (this.currentFormPanel !== false) {
            if (this.currentFormPanel.isConnected()) {
                this.notifyFormPanelVisibilityListener(true);
                return;
            }
            this.currentFormPanel.remove();
            this.currentFormPanel = false;
        }
        const navStack = this.cloneFormPanelNavStack(state.formPanelState.navStack);
        const formPanel = this.createFormPanel();
        formPanel.restoreNavStackAsync(navStack).catch(err => {
            console.error('[Tab] restoreFormPanelForTabState: restoreNavStackAsync failed:', String(err));
        });
    }

    private removeCurrentFormPanel(): void {
        if (this.currentFormPanel === false) return;
        this.currentFormPanel.remove();
        this.currentFormPanel = false;
        // FormPanel表示中に一時退避していた右スロット内容のdisplay値を戻す
        this.relationsPanel.getPanelElement().style.display = '';
        // FormPanel 表示のために一時的に開いた右スロットを元のトグル状態へ戻す
        this.editor.restoreRightSlotAfterFormPanel();
        this.notifyFormPanelVisibilityListener(false);
    }

    private setActiveFormPanelState(formPanelState: FormPanelState | null): void {
        const state = this.getActiveTabState();
        if (state === false) return;
        state.formPanelState = formPanelState === null
            ? null
            : { navStack: this.cloneFormPanelNavStack(formPanelState.navStack) };
        this.persistTabs();
    }

    private cloneFormPanelNavStack(navStack: ReadonlyArray<FormPanelNavEntry>): FormPanelNavEntry[] {
        return navStack.map(page => ({ ...page }));
    }

    private notifyFormPanelVisibilityListener(visible: boolean): void {
        if (this.formPanelVisibilityListener !== false) {
            this.formPanelVisibilityListener(visible);
        }
    }
}
