import {EditorTableData} from "./model/editor-table-data";
import {TabButton} from "./tab-button";
import {readFileAsync} from "./api";
import {Editor} from "./editor";
import {EditorTable} from "./editor-table";
import {Selection} from "./selection";
import {GridTextField} from "./grid-textfield";
import {History} from "./history";
import {AreaResizer} from "./area-resizer";
import {ContextMenu} from "./context-menu";
import {ScrollViewportController} from "./scroll-viewport-controller";
import {ReferenceDataCache} from "./reference-data-cache";
import {GridDropdownInput} from "./grid-dropdown-input";
import {FillController} from "./fill-controller";
import {EditorTableHandler} from "./editor-table-handler";
import {Sidebar} from "./sidebar";
import {TabDragDrop} from "./tab-drag-drop";
import {TabReference} from "./tab-reference";
import {InMemoryTableStore} from "./in-memory-table-store";
import {RelationsPanel} from "./relations-panel";
import {Csv} from "./csv";

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

    constructor(editor: Editor, sidebar: Sidebar, tabContentElement: HTMLElement, tabElement: HTMLElement, store: InMemoryTableStore, referenceDataCache: ReferenceDataCache) {
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
        this.pendingNavigationPkValue = '';
        this.pendingNavigationColumnIndex = -1;
        this.dragDrop = new TabDragDrop(this);
        this.reference = new TabReference(this.store, this.referenceDataCache);
        this.paneStack = [];
        this.viewIndex = 0;

        // グローバルなリレーションパネルをeditor.elementの右ペインとして配置する
        // editor.appendChildは左ペインへのappendなので、appendRelationsPanel経由で直接追加する
        this.relationsPanel = new RelationsPanel(this.store);
        this.editor.appendRelationsPanel(this.relationsPanel);
        // ミニEditorTable生成のファクトリとしてTab自身を接続する（相互参照）
        this.relationsPanel.connectTab(this);
        // Editorにこの Tab を接続してナビゲーションボタンのクリックを受け取れるようにする
        this.editor.connectTab(this);
    }

    /** サイドバー幅に応じてタブバーの位置と幅を更新する */
    applySidebarWidth(sidebarWidth: number): void {
        const widthPx = sidebarWidth + 'px';
        this.tabElement.style.left = widthPx;
        this.tabElement.style.width = 'calc(100vw - ' + widthPx + ')';
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
        const existingState = this.tabStates.get(tableName);
        if (existingState) {
            // 既存タブをアクティブにして行を選択
            this.enableTabButton(tableName);
            this.navigateToRow(existingState, pkValue);
            return;
        }
        // タブが未作成の場合: pendingNavigationPkValue を設定して新規タブを開く
        this.pendingNavigationPkValue = pkValue;
        const tabButton = this.append(tableName);
        tabButton.click();
    }

    /**
     * 検索パネルからテーブルの特定セルへナビゲーションする
     * navigateToTableRow と同様だが、特定の列にフォーカスする
     */
    navigateToTableCell(tableName: string, pkValue: string, columnIndex: number): void {
        const existingState = this.tabStates.get(tableName);
        if (existingState) {
            this.enableTabButton(tableName);
            this.navigateToCell(existingState, pkValue, columnIndex);
            return;
        }
        // タブが未作成の場合: pendingNavigationを設定して新規タブを開く
        this.pendingNavigationPkValue = pkValue;
        this.pendingNavigationColumnIndex = columnIndex;
        const tabButton = this.append(tableName);
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
     */
    append(name: string) {

        // すでに同じ名前のオブジェクトが追加されていたら何もしないです。
        let tabButton = this.tabButtons.find(x => x.name === name);
        if (tabButton) {
            return tabButton;
        }

        tabButton = new TabButton(this.editor, this, name);
        this.tabButtons.push(tabButton);

        this.element.appendChild(tabButton.element);

        return tabButton;
    }

    /**
     * 指定名のタブを閉じる
     * タブが開かれていない場合は何もしない
     */
    closeTab(name: string): void {
        const tabButton = this.tabButtons.find(x => x.name === name);
        if (!tabButton) return;

        const wasActive = tabButton.element.classList.contains('tab-button-active');
        const prev = this.findPrevTabButton(name);
        const next = this.findNextTabButton(name);

        this.removeTabButton(name);
        tabButton.element.remove();

        if (!wasActive) return;
        if (next) { this.enableTabButton(next.name); return; }
        if (prev) { this.enableTabButton(prev.name); return; }
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
            return;
        }

        // 新しいタブ状態を作成
        this.createTabState(name, tabButton);
    }

    /**
     * タブ状態を非アクティブ化（DOMを非表示にしてイベントリスナーを解除）
     * ペインスタックの現在状態を state に保存し、追加RP（paneStack[2]以降）を一時停止する。
     * グローバルRP（paneStack[1]）は this.relationsPanel.disconnectEditorTable() で完全解除する。
     * 追加RPは suspend() で一時停止するのみで内部状態（ミニEditorTable群・currentEntries）を保持する。
     * これにより、タブ復帰時（activateTabState）に追加RPの内容がそのまま表示される。
     */
    private deactivateTabState(state: TabState): void {
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
     * RelationsPanel をペインスタックに追加する（ミニテーブルの Ctrl+Click 時に RelationsPanel.navigateToDefinition から呼ばれる）
     * viewIndex より右にある既存エントリを破棄して新しい RP をスタック末尾に追加し、ビューを右端にシフトする
     */
    pushRelationsPanel(tableName: string, pkValue: string): void {
        // viewIndex より右の分岐パスを破棄する（viewIndex+1 の右ペインは保持して viewIndex+2 以降を削除）
        this.truncateStackAfterIndex(this.viewIndex);

        // 新しい RelationsPanel を生成してスタックに追加する
        const rp = new RelationsPanel(this.store);
        rp.connectTab(this);
        const rpElement = rp.getPanelElement();
        this.paneStack.push({ element: rpElement, panel: rp });

        // ビューを右端（新RP が右スロットに表示される位置）にシフトする
        this.viewIndex = this.paneStack.length - 2;

        // 表示を更新する
        this.updateVisiblePanes();

        // 新 RP にテーブルの参照データを表示させる
        rp.showForTableRowAsync(tableName, pkValue).catch((err: unknown) => {
            console.error('[Tab] pushRelationsPanel: showForTableRowAsync failed:', String(err));
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
            const tableData = EditorTableData.parse(json, csv);

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

            // 参照先テーブルを事前読み込み
            this.reference.preloadReferenceTables(tableData, editorTable);

            // 逆参照を並行して解決（インメモリデータ優先取得用にマップを渡す）
            this.reference.resolveReverseReferencesAsync(name, editorTable);

            // ドロップダウン入力コンポーネントを作成
            // 入力フィールド(element)の公開を避けるため EditorTableHandler.createDropdownInput 経由で生成する
            const dropdownInput = editorTableHandler.createDropdownInput(wrapperElement);

            // EditorTableHandler に参照データキャッシュとドロップダウンを設定
            editorTableHandler.setReferenceComponents(this.referenceDataCache, dropdownInput, tableData);

            // 初期選択をA1（row=1, column=1）に設定
            selection.setRange(1, 1, 1, 1);
            selection.move(1, 1);

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

            this.consumePendingNavigation(state);
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
        const editorTableHandler = new EditorTableHandler(editorTable, selection, history);

        // GridTextField を作成（EditorTableHandler.createGridTextField 経由で element を隠蔽）
        // container は wrapperElement（position:relative）で grid-textfield の絶対配置基準になる
        const textField = editorTableHandler.createGridTextField(wrapperElement, editorTable, selection);

        // EditorTableHandler に GridTextField を設定（循環依存解決）
        editorTableHandler.setTextField(textField);

        // AreaResizer を作成（History, Selection が必要）
        const areaResizer = new AreaResizer(wrapperElement, history, selection);

        // 本物の EditorTable インスタンスを作成（空行100行で通常の編集テーブルを生成）
        const realEditorTable = new EditorTable(
            name, tableData, this.referenceDataCache, this.store, editorTableHandler,
            selection, this.contextMenu, history, areaResizer,
            scrollController, this.sidebar, 100, 'editor-table', false
        );

        // editorTable に本物のインスタンスの内容をコピー
        Object.assign(editorTable, realEditorTable);
        Object.setPrototypeOf(editorTable, EditorTable.prototype);

        // 分割先モジュールを生成・注入（Object.assign後なのでeditorTableは完全に初期化済み）
        editorTable.initializeModules();

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

        return {editorTable, selection, editorTableHandler, history, areaResizer, fillController};
    }

    /**
     * リレーションパネル用ミニEditorTableを生成する
     *
     * emptyRowCount=0 でデータ行のみ生成（空行なし）。
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
        csvRows: string[][]
    ): {editorTable: EditorTable; fillController: FillController; areaResizer: AreaResizer; history: History} {
        // CSVオブジェクトを組み立てる
        const csv = new Csv();
        csv.header = csvHeader;
        csv.body = csvRows;
        const tableData = EditorTableData.parse(schemaJson, csv);

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
        const dummyTabButton = new TabButton(this.editor, this, '[mini]');
        const history = new History(editorTable, dummyTabButton, this.store, tableKey, 100);

        const editorTableHandler = new EditorTableHandler(editorTable, selection, history);
        const textField = editorTableHandler.createGridTextField(wrapperElement, editorTable, selection);
        editorTableHandler.setTextField(textField);

        const areaResizer = new AreaResizer(wrapperElement, history, selection);

        // ミニテーブルも 'editor-table' クラスを付与してテストセレクタに対応する
        // search-panel.spec.ts では '.editor-left-pane .editor-table' で左ペインを絞り込むため競合しない
        const realEditorTable = new EditorTable(
            tableKey, tableData, this.referenceDataCache, this.store, editorTableHandler,
            selection, this.contextMenu, history, areaResizer,
            scrollController, this.sidebar, 0, 'editor-table', true
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
        // scrollContainer の外側（dropdownContainer）に配置する
        const dropdownInput = editorTableHandler.createDropdownInput(dropdownContainer);
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
}
