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

        // グローバルなリレーションパネルをeditor.elementの右ペインとして配置する
        // editor.appendChildは左ペインへのappendなので、appendRelationsPanel経由で直接追加する
        this.relationsPanel = new RelationsPanel(this.referenceDataCache, this.store);
        this.editor.appendRelationsPanel(this.relationsPanel);
        // ミニEditorTable生成のファクトリとしてTab自身を接続する（相互参照）
        this.relationsPanel.connectTab(this);
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

            // DOMを削除
            state.wrapperElement.remove();

            // 状態を削除
            this.tabStates.delete(name);

            // 開いているテーブルのマップから削除
            this.openEditorTables.delete(name);

            // 中央ストアからテーブルデータを解除
            this.store.unregisterTable(name);

            // 未保存のタブを閉じた場合、アクティブタブの参照ヒントをCSVから再読み込みする
            if (wasDirty && this.activeTabName && this.activeTabName !== name) {
                const activeState = this.tabStates.get(this.activeTabName);
                if (activeState) {
                    this.reference.refreshReferenceHints(this.activeTabName, activeState);
                }
            }
        }

        // アクティブタブが削除された場合はリレーションパネルの接続を解除してクリアする
        if (this.activeTabName === name) {
            this.relationsPanel.disconnectEditorTable();
            this.activeTabName = false;
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
            return;
        }

        // 新しいタブ状態を作成
        this.createTabState(name, tabButton);
    }

    /**
     * タブ状態を非アクティブ化（DOMを非表示にしてイベントリスナーを解除）
     */
    private deactivateTabState(state: TabState): void {
        // スクロール位置をwrapperが表示されている間に保存する（左ペインのスクロール）
        this.editor.saveScrollPosition(state);
        state.wrapperElement.style.display = 'none';
        // グローバルリレーションパネルのEditorTable接続を解除する（relationsPanel内でフィールドもリセットされる）
        this.relationsPanel.disconnectEditorTable();
        state.editorTable.deactivate();
        state.areaResizer.deactivate();
        state.fillController.deactivate();
        state.editorTableHandler.deactivate();
    }

    /**
     * タブ状態をアクティブ化（DOMを表示してイベントリスナーを登録）
     */
    activateTabState(state: TabState): void {
        state.wrapperElement.style.display = '';
        // グローバルリレーションパネルにアクティブなEditorTableを接続する
        // connectEditorTable内でEditorTable.relationsPanel フィールドも設定される（相互参照）
        this.relationsPanel.connectEditorTable(state.editorTable);
        // タブ切り替え後に同じ行にフォーカスしていてもパネルが更新されるようにリセットする
        state.selection.resetNotification();
        // スクロール位置をイベントリスナー登録前に復元する（左ペインのスクロール）
        this.editor.restoreScrollPosition(state);
        state.editorTable.activate();
        state.areaResizer.activate();
        state.fillController.activate();

        // EditorTableHandler を有効化（IME対応）
        state.editorTableHandler.enable();
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

            // タブ状態を保存
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
                savedScrollTop: 0
            };
            this.tabStates.set(name, state);

            // アクティブ化
            this.activateTabState(state);
            this.activeTabName = name;

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

        // History を作成（EditorTable が必要）
        const history = new History(editorTable, tabButton, 1000);

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
     * AreaResizer/FillController は生成するが activate() は呼ばないため
     * リサイズ・フィルのドラッグ操作はパネル内では無効になる。
     *
     * scrollContainer: editor-table / selection / areaResizer を配置する overflow:auto のスクロール領域
     * positioningContainer: grid-textfield を配置する position:relative の祖先要素
     *   → overflow:auto のスクロール領域に grid-textfield を入れると position:absolute の要素が
     *      クリッピングされるため、overflow:visible かつ position:relative の外側要素に配置する
     *   → relations-panel.ts では panelElement（.relations-panel）を渡す
     */
    createMiniEditorTable(
        scrollContainer: HTMLElement,
        positioningContainer: HTMLElement,
        tableKey: string,
        schemaJson: Record<string, unknown>,
        csvHeader: string[],
        csvRows: string[][]
    ): EditorTable {
        // CSVオブジェクトを組み立てる
        const csv = new Csv();
        csv.header = csvHeader;
        csv.body = csvRows;
        const tableData = EditorTableData.parse(schemaJson, csv);

        // 相互参照を解決するため一時的な空オブジェクトを作成（Tab.createEditorTable と同パターン）
        const editorTable = {} as EditorTable;

        // スクロールコントローラはスクロール領域（scrollContainer）をバインド対象にする
        const scrollController = new ScrollViewportController(scrollContainer, () => {
            editorTable.onScroll();
        });

        // Selection の editorElement は scrollContainer（セルの位置計算に使われる）
        const selection = new Selection(editorTable, scrollContainer, scrollController);

        // ダミーTabButton: dirty表示の通知先として使用（DOMには追加しない）
        const dummyTabButton = new TabButton(this.editor, this, '[mini]');
        const history = new History(editorTable, dummyTabButton, 100);

        const editorTableHandler = new EditorTableHandler(editorTable, selection, history);
        // grid-textfield の絶対配置基準は positioningContainer（overflow:visible）
        const textField = editorTableHandler.createGridTextField(positioningContainer, editorTable, selection);
        editorTableHandler.setTextField(textField);

        const areaResizer = new AreaResizer(scrollContainer, history, selection);

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

        // editor-table / selection / areaResizer はスクロール領域に配置する
        editorTable.appendTo(scrollContainer);
        scrollContainer.appendChild(selection.element);
        scrollContainer.appendChild(selection.copyBorderElement);
        scrollContainer.appendChild(selection.fillPreviewElement);

        // grid-textfield は positioningContainer（overflow:visible）に配置する
        // overflow:auto のスクロール領域に入れると position:absolute の要素がクリッピングされるため
        editorTableHandler.appendTo(positioningContainer);

        areaResizer.setEditorTable(editorTable);
        editorTable.initialize();

        // ミニテーブルはストア汚染とCSV破壊を防ぐため読み取り専用にする。
        // セル編集UIの表示を禁止し（ストア汚染防止）、Ctrl+S保存も禁止する（CSV破壊防止）。
        // enable() も呼ばないためメインテーブルとのフォーカス競合も発生しない。
        editorTable.makeReadOnly();

        return editorTable;
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
