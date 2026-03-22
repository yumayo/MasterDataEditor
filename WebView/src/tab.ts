import {EditorTableData} from "./model/editor-table-data";
import {TabButton} from "./tab-button";
import {readFileAsync} from "./api";
import {Editor} from "./editor";
import {EditorTable} from "./editor-table";
import {Selection} from "./selection";
import {History} from "./history";
import {AreaResizer} from "./area-resizer";
import {ContextMenu} from "./context-menu";
import {ScrollViewportController} from "./scroll-viewport-controller";
import {ReferenceDataCache} from "./reference-data-cache";
import {GridDropdownInput} from "./grid-dropdown-input";
import {DropdownQuickView} from "./dropdown-quick-view";
import {FillController} from "./fill-controller";
import {EditorTableHandler} from "./editor-table-handler";
import {Sidebar} from "./sidebar";
import {TabDragDrop} from "./tab-drag-drop";
import {TabReference} from "./tab-reference";
import {InMemoryTableStore} from "./in-memory-table-store";
import {RelationsPanel} from "./relations-panel";
import {ValidationPanel} from "./validation-panel";
import {Csv} from "./csv";
import {SettingsPanel} from "./settings-panel";
import {DiffTab} from "./diff-tab";
import {FormPanel} from "./form-panel";
import {NavigationHistory} from "./navigation-history";
import {NotificationToast} from "./notification";
import type {EditorAPI} from "./editor-api-types";

/** 設定タブの固定名 */
const SETTINGS_TAB_NAME = '設定';

/** 差分タブ名のプレフィックス */
const DIFF_TAB_PREFIX = '差分: ';

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
}

export interface EditorTableFactoryResult {
    editorTable: EditorTable;
    selection: Selection;
    editorTableHandler: EditorTableHandler;
    history: History;
    areaResizer: AreaResizer;
    fillController: FillController;
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

    /** タブで開かれているEditorTableの参照マップ（テーブル名→EditorTable） */
    private readonly openEditorTables: Map<string, EditorTable>;

    /** テーブルデータの中央ストア（CSVデータの一元管理用） */
    private readonly store: InMemoryTableStore;

    /** 参照データキャッシュ（全タブで共有） */
    private readonly referenceDataCache: ReferenceDataCache;

    /** タブ読み込み完了後にナビゲーションするPK値（空文字列は無効） */
    private pendingNavigationPkValue: string;

    /** タブ読み込み完了後にナビゲーションする列インデックス（-1は無効、navigateToTableCellで使用） */
    private pendingNavigationColumnIndex: number;

    /** グローバルなリレーションパネル（全タブで共有、editor.elementの右ペインに配置） */
    private readonly relationsPanel: RelationsPanel;

    /**
     * ペインスタック。
     * [0] は leftPane の HTMLElement（EditorTable群のコンテナ）、[1..] は RelationsPanel インスタンス。
     * enableTabButton → activateTabState → initPaneStack() で初期化される。
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

    /**
     * 現在表示中のフォームパネル（PKセル右クリック→「フォームビューを表示」で生成）
     * 表示中でない場合は false
     */
    private currentFormPanel: FormPanel | false;

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

    /** EditorAPI（connectEditorApi で後から接続する。未接続時は false） */
    private editorApi: EditorAPI | false;

    /** openTableAsync() で待機中の resolve 関数を保持するマップ（キー: テーブル名） */
    private readonly pendingTableOpens: Map<string, (success: boolean) => void>;

    constructor(editor: Editor, sidebar: Sidebar, tabContentElement: HTMLElement, tabElement: HTMLElement, store: InMemoryTableStore, referenceDataCache: ReferenceDataCache, notification: NotificationToast) {
        this.editor = editor;
        this.element = tabContentElement;
        this.tabButtons = [];
        this.tabStates = new Map();
        this.activeTabName = false;
        this.contextMenu = new ContextMenu();
        this.sidebar = sidebar;
        this.tabElement = tabElement;
        this.openEditorTables = new Map();
        this.store = store;
        this.referenceDataCache = referenceDataCache;
        this.notification = notification;
        this.pendingNavigationPkValue = '';
        this.pendingNavigationColumnIndex = -1;
        this.dragDrop = new TabDragDrop(this);
        this.reference = new TabReference(this.store, this.referenceDataCache, this.notification);
        this.paneStack = [];
        this.viewIndex = 0;
        this.settingsPanel = false;
        this.settingsWrapperElement = false;
        this.diffTabs = new Map();
        this.currentFormPanel = false;
        this.validationPanel = false;
        this.editorApi = false;
        this.pendingTableOpens = new Map();

        // シングルトン DropdownQuickView を生成して Tab・Store を接続する。
        // body 直下に1つだけ配置されることで、複数の GridDropdownInput が共有できる。
        this.sharedDropdownQuickView = new DropdownQuickView(this.referenceDataCache);
        this.sharedDropdownQuickView.connectTab(this, this.store);

        // グローバルなリレーションパネルをeditor.elementの右ペインとして配置する
        // editor.appendChildは左ペインへのappendなので、appendRelationsPanel経由で直接追加する
        this.relationsPanel = new RelationsPanel(this.store, this.notification);
        this.editor.appendRelationsPanel(this.relationsPanel);
        // ミニEditorTable生成のファクトリとしてTab自身を接続する（相互参照）
        this.relationsPanel.connectTab(this);
        // Editor参照を接続する（閉じるボタン・リサイズハンドルダブルクリックで使用）
        this.relationsPanel.connectEditor(this.editor);
        // Editorにこの Tab を接続してナビゲーションボタンのクリックを受け取れるようにする
        this.editor.connectTab(this);

        // NavigationHistory を生成する（Tab と相互参照）。Tab の全メンバが初期化された後で生成する。
        this.navigationHistory = new NavigationHistory(this);
    }

    /**
     * 既存タブをアクティブにする（NavigationHistory の popstate 復元から呼ばれる）。
     * 新規タブ作成は行わない。タブが存在しない場合は閉じられたタブの履歴エントリをスキップする。
     */
    switchToExistingTab(name: string): void {
        if (!this.tabStates.has(name)) {
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
    }

    /**
     * バリデーションパネルを接続する（main.ts で呼ぶ）。
     * 接続後は createEditorTable 時にスキーマ登録と validationPanel 接続が行われる。
     */
    connectValidationPanel(panel: ValidationPanel): void {
        this.validationPanel = panel;
    }

    /**
     * タブで開かれているEditorTableの参照マップを取得する
     */
    getOpenEditorTables(): Map<string, EditorTable> {
        return this.openEditorTables;
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

    /**
     * アクティブタブ名を設定する（サブモジュール用）
     */
    setActiveTabNameInternal(name: string): void {
        this.activeTabName = name;
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
            this.enableTabButton(tableName);
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
            this.enableTabButton(tableName);
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
     * EditorTableの全行を走査し、PK値が一致する行を選択状態にする
     */
    private navigateToRow(state: TabState, pkValue: string): void {
        const editorTable = state.editorTable;
        const rowCount = editorTable.getRowCount();
        for (let r = 1; r < rowCount; r++) {
            if (editorTable.getRowPkValue(r) === pkValue) {
                state.selection.setRange(r, 1, r, 1);
                state.selection.move(r, 1);
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
        const rowCount = editorTable.getRowCount();
        // columnIndex はCSVの0始まり列 → DOM上は column + 1
        const col = columnIndex + 1;
        for (let r = 1; r < rowCount; r++) {
            if (editorTable.getRowPkValue(r) === pkValue) {
                state.selection.setRange(r, col, r, col);
                state.selection.move(r, col);
                // サイドバー等からのジャンプでフォーカスが移動した場合でも確実にフォーカスを戻す
                state.editorTableHandler.activate();
                return;
            }
        }
    }

    /**
     * タブ読み込み完了後のpendingNavigationを消費する
     * navigateToTableRow / navigateToTableCell で設定された
     * 保留ナビゲーションを実行し、フィールドをリセットする
     */
    consumePendingNavigation(state: TabState): void {
        if (this.pendingNavigationPkValue === '') return;
        if (this.pendingNavigationColumnIndex !== -1) {
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
    append(name: string, description: string | null) {

        // すでに同じ名前のオブジェクトが追加されていたら何もしないです。
        let tabButton = this.tabButtons.find(x => x.name === name);
        if (tabButton) {
            return tabButton;
        }

        tabButton = new TabButton(this.editor, this, name, description);
        this.tabButtons.push(tabButton);

        this.element.appendChild(tabButton.element);

        return tabButton;
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

        // テーブルクローズイベントを発火する（設定タブ・差分タブは通常テーブルではないため除外する）
        if (this.editorApi !== false && name !== SETTINGS_TAB_NAME && !name.startsWith(DIFF_TAB_PREFIX)) {
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
            if (this.settingsWrapperElement !== false) {
                this.settingsWrapperElement.remove();
            }
            this.settingsPanel = false;
            this.settingsWrapperElement = false;
        }

        // 差分タブが閉じられた場合: 対象の DiffTab を破棄してマップから除去する
        if (name.startsWith(DIFF_TAB_PREFIX)) {
            if (wasActive) {
                this.editor.leaveSettingsMode();
                this.activeTabName = false;
            }
            // DIFF_TAB_PREFIX で始まるタブ名が closeTab に渡された時点で diffTabs に存在するのが不変条件
            const diffTabToDestroy = this.diffTabs.get(name);
            if (!diffTabToDestroy) throw new Error(`[Tab] performCloseTab: diffTabs に存在しないキーが渡された: ${name}`);
            diffTabToDestroy.destroy(this.store);
            this.diffTabs.delete(name);
        }

        if (!wasActive) return;
        if (next) { this.enableTabButton(next.name); return; }
        if (prev) { this.enableTabButton(prev.name); return; }
        // アクティブだったタブを閉じて他にタブがない場合、エクスプローラーのハイライトをクリアする
        this.sidebar.clearExplorerHighlight();
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
        const index = this.tabButtons.findIndex(x => x.name === name);
        if (index !== -1) {
            // DOMからタブボタン要素を除去する（差分タブは tabStates に登録されないため
            // state.wrapperElement.remove() が呼ばれず、ここで除去しないとDOMに残存する）
            this.tabButtons[index].element.remove();
            this.tabButtons.splice(index, 1);
        }

        // タブ状態のクリーンアップ
        const state = this.tabStates.get(name);
        if (state) {
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

    enableTabButton(name: string) {

        // ちょっと面倒なので、一回全部無効な状態にします。
        this.tabButtons.forEach(x => x.disable());

        // 同じ名前のelementをactiveにします。
        const tabButton = this.tabButtons.find(x => x.name === name);
        if (!tabButton) {
            // アクティブにする対象がいなかったら何もしないです。
            return;
        }

        // タブを有効化
        tabButton.enable();

        // エクスプローラーのハイライトを更新する
        // 設定タブ・差分タブはエクスプローラーに対応するファイルがないのでクリア、通常テーブルはハイライト
        if (name === SETTINGS_TAB_NAME || name.startsWith(DIFF_TAB_PREFIX)) {
            this.sidebar.clearExplorerHighlight();
        } else {
            this.sidebar.highlightExplorerFile(name);
        }

        // 差分タブは EditorTable を持たない特殊タブのため専用の有効化処理を行う
        if (name.startsWith(DIFF_TAB_PREFIX)) {
            this.activateDiffTab(name);
            return;
        }

        // 設定タブは EditorTable を持たない特殊タブのため専用の有効化処理を行う
        if (name === SETTINGS_TAB_NAME) {
            this.activateSettingsTab();
            return;
        }

        // 設定タブから通常テーブルタブへの復帰時: rightSlot・ナビゲーションバーを復元する
        // この判定は activateTabState() より前で行う必要がある（activateTabState 内は常に通常タブの文脈）
        if (this.activeTabName === SETTINGS_TAB_NAME) {
            this.editor.leaveSettingsMode();
        }

        // 設定タブが表示中であれば非表示にする
        if (this.settingsWrapperElement !== false) {
            this.settingsWrapperElement.style.display = 'none';
        }

        // 現在アクティブなタブが差分タブの場合のみ非表示にして leaveSettingsMode() を呼ぶ
        // （通常タブ→通常タブの切り替え時に余分な leaveSettingsMode() が呼ばれないようにする）
        if (this.activeTabName !== false && this.activeTabName.startsWith(DIFF_TAB_PREFIX)) {
            this.diffTabs.forEach(diffTab => diffTab.hide());
            this.editor.leaveSettingsMode(); // rightSlot を再表示する
        }

        // 通常テーブルタブへの切り替えをナビゲーション履歴に記録する
        // （設定タブ・差分タブはここに到達しない）
        this.navigationHistory.pushTabSwitch(name);

        // 同一タブが既にアクティブな状態で enableTabButton が呼ばれた場合（popstate復元・同一タブ再クリック等）:
        // deactivateTabState()がスキップされるため、ここで明示的にstateを更新しないと
        // activateTabState()が古いstate.paneStackを復元してpaneStack深化状態が失われる。
        if (this.activeTabName === name) {
            const currentState = this.tabStates.get(name);
            if (!currentState) throw new Error(`[Tab] enableTabButton: アクティブタブ "${name}" の状態が tabStates に存在しません`);
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
            this.activateTabState(existingState);
            this.activeTabName = name;
            // 他タブでストアが変更されたセルのDOMを同期する
            existingState.editorTable.reloadCellsFromStore();
            // 他タブでインメモリデータが編集された可能性があるため、参照ヒントを再更新する
            this.reference.refreshReferenceHints(name, existingState);
            // セルDOM・参照ヒントの更新後にRelationsPanelを強制更新する（同一行でもパネルが確実に描画される）
            existingState.editorTable.forceRefreshRelationsPanel();
            // 既存タブの再アクティブ化では emitTableOpened を発火しない（Open/Close の対称性を維持するため）
            return;
        }

        // 新しいタブ状態を作成
        this.createTabState(name, tabButton);
        // テーブルオープンイベントを発火する（EditorAPI が接続済みの場合のみ）
        if (this.editorApi !== false) this.editorApi.emitTableOpened(name);
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
     * 設定タブをアクティブ化する。
     * enableTabButton('設定') から呼ばれる。
     * SettingsPanel の初回生成・再表示を担う。
     * 通常テーブルの wrapperElement は deactivateTabState() で非表示にしない（設定タブは独立）。
     * 代わりに既存アクティブタブを非アクティブ化してから設定パネルを表示する。
     */
    private activateSettingsTab(): void {
        // 差分タブがアクティブだった場合: 全差分タブを非表示にする
        if (this.activeTabName !== false && this.activeTabName.startsWith(DIFF_TAB_PREFIX)) {
            this.diffTabs.forEach(diffTab => diffTab.hide());
        }

        // 通常テーブルタブがアクティブなら非アクティブ化する
        if (this.activeTabName && this.activeTabName !== SETTINGS_TAB_NAME) {
            const previousState = this.tabStates.get(this.activeTabName);
            if (previousState) {
                this.deactivateTabState(previousState);
            }
        }
        // アクティブ名を設定タブ名に更新する（getActiveTabName() で '設定' が返るようにする）
        this.activeTabName = SETTINGS_TAB_NAME;

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
     * 差分タブをタブバーに開く。
     * 同一テーブルの差分タブが既に開かれている場合は既存タブをアクティブ化するだけにする。
     * SourceControlPanel.openDiffTabAsync から呼ばれる。
     * gitPath: gitルート相対のファイルパス（例: "subdir/data/quest_reward.csv"）。
     *          保存後の refreshGitDiffForDiffTabAsync で HEAD版CSV取得に使用する。
     */
    openDiffTab(tableName: string, isStaged: boolean, schemaJson: string, headCsv: string, currentCsv: string, gitPath: string): void {
        const diffTabName = DIFF_TAB_PREFIX + tableName;

        // 既存の差分タブが開いている場合はアクティブ化するだけにする
        // 再作成するとタブのスクロール位置・編集状態が失われるため再利用する
        if (this.diffTabs.has(diffTabName)) {
            this.enableTabButton(diffTabName);
            return;
        }

        // 差分タブのタブボタンを追加する
        // このタブボタンを DiffTab の History に渡すことで Dirty マークが画面に反映される
        // 差分タブには description がないため null で生成する
        const tabButton = this.append(diffTabName, null);

        const diffTab = new DiffTab(
            tableName, schemaJson, headCsv, currentCsv, isStaged, gitPath,
            this.editor, this.sidebar, this.store, this.referenceDataCache, this.contextMenu, tabButton,
            this.reference, this.openEditorTables, this.notification, this.validationPanel
        );
        // 新規作成時点では diffTabs にキーが存在しないことが保証される（上の早期リターンで確認済み）
        this.diffTabs.set(diffTabName, diffTab);

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
        if (this.activeTabName && !this.activeTabName.startsWith(DIFF_TAB_PREFIX) && this.activeTabName !== SETTINGS_TAB_NAME) {
            const previousState = this.tabStates.get(this.activeTabName);
            if (previousState) {
                this.deactivateTabState(previousState);
            }
        }

        // 設定タブがアクティブだった場合: leaveSettingsMode() で rightSlot を復元しておく
        // （次の enterSettingsMode() で再び非表示にするが、内部状態を一貫させるために呼ぶ）
        if (this.activeTabName === SETTINGS_TAB_NAME) {
            this.editor.leaveSettingsMode();
        }

        // 設定タブが表示中であれば非表示にする
        if (this.settingsWrapperElement !== false) {
            this.settingsWrapperElement.style.display = 'none';
        }

        this.activeTabName = diffTabName;

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
        if (this.diffTabs.size === 0) return;
        // アクティブタブが差分タブの場合は leaveSettingsMode を一度だけ呼んで状態を復元する
        if (this.activeTabName !== false && this.activeTabName.startsWith(DIFF_TAB_PREFIX)) {
            this.editor.leaveSettingsMode();
            this.activeTabName = false;
        }
        // 全差分タブを直接破棄する（closeTab経由だと enterSettingsMode/leaveSettingsMode が中間的に呼ばれるため）
        const diffTabNames = Array.from(this.diffTabs.keys());
        for (const name of diffTabNames) {
            // diffTabNames は diffTabs.keys() のスナップショットなので存在が保証されている
            this.diffTabs.get(name)!.destroy(this.store);
            this.diffTabs.delete(name);
            this.removeTabButton(name);
        }

        // 残存する通常タブ（設定タブ・差分タブ以外）があれば最後のものをアクティブ化する。
        // 差分タブがアクティブなままだと activeTabName = false になるため、
        // Ctrl+S 等のキーボード操作が無視されるのを防ぐ。
        // enableTabButton は highlightExplorerFile / activateTabState も内包するため、
        // ハイライト・スクロール位置復元・activeTabName の更新がすべてここで完結する。
        const remainingNormal = this.tabButtons.find(
            btn => btn.name !== SETTINGS_TAB_NAME && !btn.name.startsWith(DIFF_TAB_PREFIX)
        );
        if (remainingNormal) {
            this.enableTabButton(remainingNormal.name);
        } else {
            this.sidebar.clearExplorerHighlight();
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
        // フォームパネルが表示中であれば閉じる（タブ切り替え時に残留しないようにする）
        this.closeFormPanel();
        // スクロール位置をwrapperが表示されている間に保存する（左ペインのスクロール）
        this.editor.saveScrollPosition(state);
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
        // フォーカスクラスを除去して次タブ切り替え時に前タブのハイライトが残留しないようにする
        state.editorTable.clearFocusedCell();
        state.editorTable.deactivate();
        state.areaResizer.deactivate();
        state.fillController.deactivate();
        state.editorTableHandler.deactivate();
    }

    /**
     * タブ状態をアクティブ化（DOMを表示してイベントリスナーを登録）
     * state に保存されたペインスタックを復元する（initPaneStack() は呼ばない）。
     * 初回アクティブ化（createTabState 内）では state.paneStack が初期化済みであること。
     */
    activateTabState(state: TabState): void {
        state.wrapperElement.style.display = '';
        // グローバルリレーションパネルにアクティブなEditorTableを接続する
        // connectEditorTable内でEditorTable.relationsPanel フィールドも設定される（相互参照）
        this.relationsPanel.connectEditorTable(state.editorTable);
        // スクロール位置をイベントリスナー登録前に復元する（左ペインのスクロール）
        this.editor.restoreScrollPosition(state);
        state.editorTable.activate();
        state.areaResizer.activate();
        state.fillController.activate();

        // EditorTableHandler を有効化（IME対応）
        state.editorTableHandler.enable();

        // state に保存されたペインスタックと viewIndex を復元する
        // deactivateTabState() で保存された状態であり、initPaneStack() は呼ばない
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
    }

    /**
     * ペインスタックを初期状態（EditorTable + relationsPanel の2ペイン）にリセットする
     * タブ切替時（activateTabState）に呼ばれる
     */
    private initPaneStack(): void {
        // viewIndex より右にある追加 RP を破棄してから初期化する
        this.truncateStackAfterIndex(0);
        const leftPaneElement = this.editor.getLeftPaneForScroll();
        const rpElement = this.relationsPanel.getPanelElement();
        this.paneStack = [
            { element: leftPaneElement, panel: false },
            { element: rpElement, panel: this.relationsPanel },
        ];
        this.viewIndex = 0;
        this.updateVisiblePanes();
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
        const rp = new RelationsPanel(this.store, this.notification);
        rp.connectTab(this);
        rp.connectEditor(this.editor);
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

            // 中央ストアにCSVを読み込み・登録
            const csv = await this.store.registerTableAsync(name);
            // 通常テーブルはフィルター・ソートアイコンを持つため hasIcons: true
            const tableData = EditorTableData.parse(json, csv, true);

            // ラッパー要素を作成（このタブのDOM全体を包む）
            // editor.appendChild は左ペインへのappendに変更された
            const wrapperElement = document.createElement('div');
            wrapperElement.classList.add('tab-wrapper');
            wrapperElement.dataset.tabName = name;
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

            // 開いているテーブルのマップに登録
            this.openEditorTables.set(name, editorTable);

            // ValidationPanel が接続されている場合: openEditorTables.set() 完了後に全テーブルバリデーションを実行する。
            // createEditorTable() 内ではなくここで呼ぶことで、今開いたテーブルが applyErrorClassesToAllEditorTables()
            // の対象に含まれ、初期表示時の重複PKにも cell-pk-duplicate クラスが正しく付与される。
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

            // 初期選択をA1（row=1, column=1）に設定
            selection.setRange(1, 1, 1, 1);
            selection.move(1, 1);

            // git statusを取得してこのテーブルのGitDiffTrackerを構築・接続し、全セルのハイライトを適用する
            await editorTable.refreshGitDiffAsync();

            // 初回アクティブ化の前にペインスタックを初期状態に設定する
            // activateTabState() は state.paneStack / state.viewIndex から復元するため、
            // createTabState() では initPaneStack() を呼んでフィールドを初期化してから state に格納する
            this.initPaneStack();

            // タブ状態を保存（initPaneStack() 後のフィールド値を初期値として記録する）
            const state: TabState = {
                editorTable,
                selection,
                editorTableHandler,
                history,
                areaResizer,
                fillController,
                wrapperElement,
                dropdownInput,
                savedScrollLeft: 0,
                savedScrollTop: 0,
                paneStack: this.paneStack.slice(),
                viewIndex: this.viewIndex,
            };
            this.tabStates.set(name, state);

            // openTableAsync() で待機中の呼び出し元に完了を通知する
            const pendingResolve = this.pendingTableOpens.get(name);
            if (pendingResolve !== null && pendingResolve !== undefined) {
                this.pendingTableOpens.delete(name);
                pendingResolve(true);
            }

            // アクティブ化（state.paneStack / state.viewIndex を this フィールドに復元する）
            this.activateTabState(state);
            this.activeTabName = name;

            // タブ生成時点でストアがDirty状態のテーブルは、タブボタンにDirtyマークを設定する。
            // これにより、ミニテーブルで編集→破棄→タブで開く、という操作でもDirtyマークが表示される。
            // ミニテーブルのHistory破棄時に isDirty() ならば dirtyTableNames に残るため、
            // 新しいHistoryが作られた後も isTableDirty() が true を返す。
            if (this.store.isTableDirty(name)) {
                tabButton.setDirty(true);
            }

            // 新規タブ初回表示時にRelationsPanelを強制更新する（初期フォーカス行でパネルを確実に描画）
            state.editorTable.forceRefreshRelationsPanel();

            // navigateToTableRow / navigateToTableCell / CommandPalette 経由で null で生成されたタブボタンに
            // description を後付けで適用する。ExplorerFile 経由で既に設定済みの場合は applyDescription 内でスキップされる。
            if (tableData.description !== null && tableData.description !== '') {
                tabButton.applyDescription(tableData.description);
            }

            this.consumePendingNavigation(state);
        }).catch(() => {
            // スキーマ読み込み失敗時にpending解決を通知する
            const pendingResolve = this.pendingTableOpens.get(name);
            if (pendingResolve !== null && pendingResolve !== undefined) {
                this.pendingTableOpens.delete(name);
                pendingResolve(false);
            }
        });
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

        // ScrollViewportController を作成（editorTable.onScroll を参照）
        // スクロール対象は左ペイン（editor.getLeftPaneForScroll()）に変更
        const scrollController = new ScrollViewportController(this.editor.getLeftPaneForScroll(), () => {
            editorTable.onScroll();
        });

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
        const emptyRowCount = tableData.body.length + 1;
        const realEditorTable = new EditorTable(
            name, tableData, this.referenceDataCache, this.store, editorTableHandler,
            selection, this.contextMenu, history, areaResizer,
            scrollController, this.sidebar, emptyRowCount, 'editor-table', false
        );

        // editorTable に本物のインスタンスの内容をコピー
        Object.assign(editorTable, realEditorTable);
        Object.setPrototypeOf(editorTable, EditorTable.prototype);

        // 分割先モジュールを生成・注入（Object.assign後なのでeditorTableは完全に初期化済み）
        editorTable.initializeModules();
        // Tab への参照を設定する（フォームビュー表示のための密結合）
        editorTable.tab = this;

        // FillController を作成（EditorTable, Selection, History が必要）
        const fillController = new FillController(editorTable, selection, history);

        // DOM要素を追加
        editorTable.appendTo(wrapperElement);
        wrapperElement.appendChild(selection.element);
        wrapperElement.appendChild(selection.copyBorderElement);
        wrapperElement.appendChild(selection.fillPreviewElement);
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
                tableData.header.map(col => ({ name: col.name, type: col.type, reference: col.reference }))
            );
            editorTable.connectValidationPanel(this.validationPanel);
        }

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
        const scrollController = new ScrollViewportController(scrollContainer, () => {
            editorTable.onScroll();
        });

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
            scrollController, this.sidebar, emptyRowCount, 'editor-table', true
        );

        Object.assign(editorTable, realEditorTable);
        Object.setPrototypeOf(editorTable, EditorTable.prototype);

        editorTable.initializeModules();

        // 左ペインと同じ: 全要素を wrapperElement に配置する
        editorTable.appendTo(wrapperElement);
        wrapperElement.appendChild(selection.element);
        wrapperElement.appendChild(selection.copyBorderElement);
        wrapperElement.appendChild(selection.fillPreviewElement);
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
                tableData.header.map(col => ({ name: col.name, type: col.type, reference: col.reference }))
            );
            editorTable.connectValidationPanel(this.validationPanel);
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
        // 既にTabStateが存在する場合はそのまま成功を返す
        // enableTabButton は呼ばない（reloadCellsFromStore 等の重い副作用を避けるため）
        // setCellValue / setCellValues は TabState の存在のみを要求し、アクティブタブである必要はない
        if (this.tabStates.has(tableName)) {
            return Promise.resolve(true);
        }

        return new Promise<boolean>((resolve) => {
            // pending解決を登録する
            this.pendingTableOpens.set(tableName, resolve);
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

    /** テーブル保存イベントを EditorAPI に委譲する（EditorTable から呼ばれる） */
    emitTableSaved(tableName: string): void {
        if (this.editorApi !== false) this.editorApi.emitTableSaved(tableName);
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

    updateDropIndicator(clientX: number): void {
        this.dragDrop.updateDropIndicator(clientX);
    }

    dropTab(clientX: number): void {
        this.dragDrop.dropTab(clientX);
    }

    /**
     * フォームビューを表示する（PKセル右クリックメニューから呼ばれる）
     * RelationsPanelの親要素（rightSlot）にFormPanelをオーバーレイして表示する。
     * 既存のFormPanelがあれば破棄してから新しいものを生成する。
     * 履歴 push は NavigationHistory.pushFormPanelOpen 内部の restoring フラグで自律的に制御される。
     * @param tableName 対象テーブル名
     * @param pkValue 対象行のPK値
     */
    showFormPanel(tableName: string, pkValue: string): void {
        // 履歴に記録する（pushFormPanelOpen 内部の restoring フラグで popstate 復元中は自律的にスキップされる）
        this.navigationHistory.pushFormPanelOpen(tableName, pkValue);

        // FormPanel を生成して表示する（共通処理）
        const formPanel = this.createFormPanel();
        // 指定行のフォームを非同期で描画する
        // FormPanel.renderCurrentPageAsync 内でエラー通知するため、ここでは通知しない（二重通知防止）
        formPanel.showForRowAsync(tableName, pkValue).catch(err => {
            console.error('[Tab] showFormPanel: showForRowAsync failed:', String(err));
        });
    }

    /**
     * navStack を復元してフォームビューを表示する（popstate 復元専用）
     * NavigationHistory の form-panel-drilldown ハンドラから呼ばれる。
     * 履歴への push は行わない（popstate 復元のため）。
     * @param _tabName タブ名（将来のタブ切り替え復元用。現状は未使用）
     * @param navStack 復元するナビゲーションスタック
     */
    showFormPanelWithNavStack(_tabName: string, navStack: Array<{tableName: string; pkValue: string; label: string}>): void {
        // FormPanel を生成して表示する（共通処理）
        const formPanel = this.createFormPanel();
        // navStack を復元して最後のページを描画する
        formPanel.restoreNavStackAsync(navStack).catch(err => {
            console.error('[Tab] showFormPanelWithNavStack: restoreNavStackAsync failed:', String(err));
        });
    }

    /**
     * FormPanel を生成して右スロットにオーバーレイする共通処理。
     * 既存の FormPanel があれば破棄してから新しいものを生成する。
     * showFormPanel と showFormPanelWithNavStack の両方から呼ばれる。
     */
    private createFormPanel(): FormPanel {
        // 既存のFormPanelを破棄する（新しいPK値で開き直す場合）
        if (this.currentFormPanel !== false) {
            this.currentFormPanel.remove();
            this.currentFormPanel = false;
        }
        // RelationsPanelの親要素（rightSlot または setVisiblePanes で設定された要素）を取得する
        const rpParent = this.relationsPanel.getPanelElement().parentElement;
        if (rpParent === null) {
            throw new Error('[Tab] createFormPanel: RelationsPanel が DOM に追加されていません');
        }
        // RelationsPanel を非表示にする（DOMは保持して FormPanel をオーバーレイ）
        this.relationsPanel.getPanelElement().style.display = 'none';
        // FormPanel を生成して右スロットにオーバーレイする
        const formPanel = new FormPanel(this.store, this, this.notification);
        formPanel.appendTo(rpParent);
        this.currentFormPanel = formPanel;
        return formPanel;
    }

    /**
     * フォームパネル内のドリルダウンをブラウザ履歴に記録する。
     * FormPanel.drillDownAsync から呼ばれる。
     * NavigationHistory.restoring 中は自動的にスキップされる。
     * @param navStack ドリルダウン後の完全なナビゲーションスタック
     */
    pushFormDrillDown(navStack: ReadonlyArray<{tableName: string; pkValue: string; label: string}>): void {
        if (this.activeTabName === false) throw new Error('[Tab] pushFormDrillDown: アクティブなタブが存在しない状態でドリルダウンが要求されました');
        this.navigationHistory.pushFormPanelDrillDown(this.activeTabName, navStack);
    }

    /**
     * フォームビューを閉じてRelationsPanelを再表示する
     * FormPanel.✕ボタンクリックから呼ばれる
     */
    closeFormPanel(): void {
        if (this.currentFormPanel === false) return;
        // FormPanel の DOM 要素を削除する
        this.currentFormPanel.remove();
        this.currentFormPanel = false;
        // RelationsPanelを再表示する
        this.relationsPanel.getPanelElement().style.display = '';
    }
}
