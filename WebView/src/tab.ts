import {EditorTableData} from "./model/editor-table-data";
import {Csv} from "./csv";
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
import {parseReferenceExpression, isDynamicReference} from "./reference-expression";
import {ViewDefinition, parseViewDefinition} from "./model/view-definition";
import {ViewColumnMapping} from "./model/view-column-mapping";
import {ViewRowMetadata} from "./model/view-row-metadata";
import {buildViewTableData, JoinedTableLoadedData, applyViewColumnConfig} from "./view-table-data-builder";
import {saveViewDataAsync, updateViewColumnConfigs} from "./view-save-splitter";
import {ReverseReferenceResolver} from "./reverse-reference-resolver";
import {Sidebar} from "./sidebar";

/**
 * タブごとの状態を保持する基底インターフェース
 */
interface BaseTabState {
    editorTable: EditorTable;
    selection: Selection;
    editorTableHandler: EditorTableHandler;
    history: History;
    areaResizer: AreaResizer;
    fillController: FillController;
    wrapperElement: HTMLElement;
    referenceDataCache: ReferenceDataCache;
    dropdownInput: GridDropdownInput;
    /** タブ非アクティブ時に保存された水平スクロール位置 */
    savedScrollLeft: number;
    /** タブ非アクティブ時に保存された垂直スクロール位置 */
    savedScrollTop: number;
}

/**
 * 通常テーブルのタブ状態
 */
interface NormalTabState extends BaseTabState {
    kind: 'normal';
}

/**
 * ビューテーブルのタブ状態
 */
interface ViewTabState extends BaseTabState {
    kind: 'view';
    viewDefinition: ViewDefinition;
    columnMappings: ViewColumnMapping[];
    rowMetadata: ViewRowMetadata[];
}

/**
 * タブ状態の判別共用体
 */
export type TabState = NormalTabState | ViewTabState;

/**
 * 利用可能なJoin対象の情報
 */
interface AvailableJoinTarget {
    /** 参照元列名 */
    sourceColumnName: string;
    /** 結合先テーブル名 */
    targetTableName: string;
    /** 結合先キー列名 */
    targetColumnName: string;
}

interface EditorTableFactoryResult {
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
    private activeTabName: string | undefined;

    /** コンテキストメニュー（全タブで共有） */
    private contextMenu: ContextMenu;

    /** ドラッグ中のタブ名（ドラッグアンドドロップ用） */
    private draggingTabName: string | undefined;

    /** 参照箇所を表示するサイドバー */
    private readonly sidebar: Sidebar;

    /** タブバー要素（サイドバー幅連動用） */
    private readonly tabElement: HTMLElement;

    /** タブで開かれているEditorTableの参照マップ（テーブル名→EditorTable） */
    private readonly openEditorTables: Map<string, EditorTable>;

    /** タブ読み込み完了後にナビゲーションするPK値（空文字列は無効） */
    private pendingNavigationPkValue: string;

    /** タブ読み込み完了後にナビゲーションする列インデックス（-1は無効、navigateToTableCellで使用） */
    private pendingNavigationColumnIndex: number;

    constructor(editor: Editor, sidebar: Sidebar, tabContentElement: HTMLElement, tabElement: HTMLElement) {
        this.editor = editor;
        this.element = tabContentElement;
        this.tabButtons = [];
        this.tabStates = new Map();
        this.activeTabName = undefined;
        this.contextMenu = new ContextMenu(editor.element);
        this.draggingTabName = undefined;
        this.sidebar = sidebar;
        this.tabElement = tabElement;
        this.openEditorTables = new Map();
        this.pendingNavigationPkValue = '';
        this.pendingNavigationColumnIndex = -1;
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
    private consumePendingNavigation(state: TabState): void {
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

    findNextTabButton(name: string) {
        const index = this.tabButtons.findIndex(x => x.name === name);
        if (index === -1 || index >= this.tabButtons.length - 1) return undefined;
        return this.tabButtons[index + 1];
    }

    findPrevTabButton(name: string) {
        const index = this.tabButtons.findIndex(x => x.name === name);
        if (index <= 0) return undefined;
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

            // 未保存のタブを閉じた場合、アクティブタブの参照ヒントをCSVから再読み込みする
            if (wasDirty && this.activeTabName && this.activeTabName !== name) {
                const activeState = this.tabStates.get(this.activeTabName);
                if (activeState) {
                    this.refreshReferenceHints(this.activeTabName, activeState);
                }
            }
        }

        // アクティブタブが削除された場合はクリア
        if (this.activeTabName === name) {
            this.activeTabName = undefined;
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

            // 他タブでインメモリデータが編集された可能性があるため、参照ヒントを再更新する
            this.refreshReferenceHints(name, existingState);
            return;
        }

        // 新しいタブ状態を作成
        if (name.startsWith('view:')) {
            this.createViewTabState(name, tabButton, 'load_from_file');
        } else {
            this.createTabState(name, tabButton);
        }
    }

    /**
     * タブ状態を非アクティブ化（DOMを非表示にしてイベントリスナーを解除）
     */
    private deactivateTabState(state: TabState): void {
        // スクロール位置をwrapperが表示されている間に保存する
        state.savedScrollLeft = this.editor.element.scrollLeft;
        state.savedScrollTop = this.editor.element.scrollTop;
        state.wrapperElement.style.display = 'none';
        state.editorTable.deactivate();
        state.areaResizer.deactivate();
        state.fillController.deactivate();
        state.editorTableHandler.deactivate();
    }

    /**
     * タブ状態をアクティブ化（DOMを表示してイベントリスナーを登録）
     */
    private activateTabState(state: TabState): void {
        state.wrapperElement.style.display = '';
        // スクロール位置をイベントリスナー登録前に復元する
        this.editor.element.scrollLeft = state.savedScrollLeft;
        this.editor.element.scrollTop = state.savedScrollTop;
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
        readFileAsync("schema/" + name + ".json").then((text) => {

            readFileAsync("data/" + name + ".csv").then((csvFileContents) => {

                const json = JSON.parse(text);

                const csv = new Csv();
                csv.load(csvFileContents);

                const tableData = EditorTableData.parse(json, csv);

                // ラッパー要素を作成（このタブのDOM全体を包む）
                const wrapperElement = document.createElement('div');
                wrapperElement.classList.add('tab-wrapper');
                wrapperElement.dataset.tabName = name;
                this.editor.element.appendChild(wrapperElement);

                // 参照データキャッシュを作成（インメモリデータ優先取得用にマップを渡す）
                const referenceDataCache = new ReferenceDataCache(this.openEditorTables);

                // EditorTableと関連オブジェクトをファクトリ関数で生成（相互参照を解決）
                const editorTableFactoryResult = this.createEditorTable(
                    name, tableData, referenceDataCache, wrapperElement, tabButton
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
                // 単純参照と動的参照の両方に対応
                const referenceTables: string[] = [];
                const dynamicReferenceIntermediateTables: string[] = [];

                for (const col of tableData.header) {
                    if (!col.reference) continue;

                    const expr = parseReferenceExpression(col.reference);
                    if (isDynamicReference(expr)) {
                        // 動的参照の場合: 中間テーブル（フィルタテーブル）をfullDataとして読み込み対象に追加
                        dynamicReferenceIntermediateTables.push(expr.filter.tableName);
                        // 注意: 最終的な参照先テーブルは実行時に動的に決まるため、ここではpreloadしない
                    } else {
                        // 単純参照の場合: テーブル名を抽出
                        referenceTables.push(expr.tableName);
                    }
                }

                // 重複を除去
                const uniqueReferenceTables = Array.from(new Set(referenceTables));
                const uniqueIntermediateTables = Array.from(new Set(dynamicReferenceIntermediateTables));

                // preloadを開始
                const preloadPromises: Promise<unknown>[] = [];

                // 単純参照のテーブルを読み込み
                for (const tableName of uniqueReferenceTables) {
                    preloadPromises.push(referenceDataCache.get(tableName));
                }

                // 動的参照の中間テーブルを全カラムデータとして読み込み
                for (const tableName of uniqueIntermediateTables) {
                    preloadPromises.push(referenceDataCache.getFullDataAsync(tableName));
                }

                if (preloadPromises.length > 0) {
                    // preloadが完了したら参照ヒントを更新
                    Promise.all(preloadPromises).then(() => {
                        editorTable.updateReferenceHints();
                    }).catch(error => {
                        console.warn('Failed to preload reference tables:', error);
                    });
                }

                // 逆参照を並行して解決（インメモリデータ優先取得用にマップを渡す）
                this.resolveReverseReferencesAsync(name, editorTable);

                // ドロップダウン入力コンポーネントを作成
                // 入力フィールドは EditorTableHandler.element を共有し、IME対応を統一
                const dropdownInput = new GridDropdownInput(
                    wrapperElement,
                    editorTableHandler.element,
                    (id: string) => {
                        // 選択確定時のコールバック
                        editorTableHandler.submitDropdownSelection(id);
                    },
                    () => {
                        // キャンセル時のコールバック
                        editorTableHandler.cancelDropdown();
                    }
                );

                // EditorTableHandler に参照データキャッシュとドロップダウンを設定
                editorTableHandler.setReferenceComponents(referenceDataCache, dropdownInput, tableData);

                // 初期選択をA1（row=1, column=1）に設定
                selection.setRange(1, 1, 1, 1);
                selection.move(1, 1);

                // タブ状態を保存
                const state: NormalTabState = {
                    kind: 'normal',
                    editorTable,
                    selection,
                    editorTableHandler,
                    history,
                    areaResizer,
                    fillController,
                    wrapperElement,
                    referenceDataCache,
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

        });
    }

    /**
     * ビュータブの状態を作成する
     * preloadedViewDefinition が渡された場合はファイル読み込みを迂回してメモリ上の定義を使う
     */
    private createViewTabState(
        name: string, tabButton: TabButton, preloadedViewDefinition: ViewDefinition | 'load_from_file'
    ): void {
        // "view:view_chara" から "view_chara" を抽出
        const viewName = name.substring(5);

        const viewDefPromise = preloadedViewDefinition !== 'load_from_file'
            ? Promise.resolve(preloadedViewDefinition)
            : readFileAsync('view/' + viewName + '.json').then((viewJson) => parseViewDefinition(JSON.parse(viewJson)));

        viewDefPromise.then((viewDefinition) => {
            const baseTable = viewDefinition.baseTable;

            // ベーステーブルを読み込み
            Promise.all([
                readFileAsync('schema/' + baseTable + '.json'),
                readFileAsync('data/' + baseTable + '.csv'),
            ]).then(([schemaText, csvText]) => {
                const json = JSON.parse(schemaText);
                const csv = new Csv();
                csv.load(csvText);
                const baseTableData = EditorTableData.parse(json, csv);

                // 結合テーブルを読み込み
                const joinPromises: Promise<JoinedTableLoadedData>[] = [];
                for (const join of viewDefinition.joins) {
                    const p = Promise.all([
                        readFileAsync('schema/' + join.targetTable + '.json'),
                        readFileAsync('data/' + join.targetTable + '.csv'),
                    ]).then(([sText, cText]) => {
                        const sJson = JSON.parse(sText);
                        const sCsv = new Csv();
                        sCsv.load(cText);
                        const td = EditorTableData.parse(sJson, sCsv);
                        return {tableName: join.targetTable, tableData: td} as JoinedTableLoadedData;
                    });
                    joinPromises.push(p);
                }

                Promise.all(joinPromises).then((joinedTables) => {
                    // ビューテーブルデータを構築
                    const rawBuildResult = buildViewTableData(baseTableData, joinedTables, viewDefinition);

                    // 列設定（幅オーバーライド・非表示列フィルタ）を適用
                    const buildResult = applyViewColumnConfig(rawBuildResult, viewDefinition.columns);
                    const compositeTableData = buildResult.compositeTableData;
                    const columnMappings = buildResult.columnMappings;
                    const joinTableKeyMaps = buildResult.joinTableKeyMaps;

                    // ラッパー要素を作成
                    const wrapperElement = document.createElement('div');
                    wrapperElement.classList.add('tab-wrapper');
                    wrapperElement.dataset.tabName = name;
                    this.editor.element.appendChild(wrapperElement);

                    // 参照データキャッシュを作成（インメモリデータ優先取得用にマップを渡す）
                    const referenceDataCache = new ReferenceDataCache(this.openEditorTables);

                    // EditorTable生成
                    const factoryResult = this.createEditorTable(
                        name, compositeTableData, referenceDataCache, wrapperElement, tabButton
                    );
                    const editorTable = factoryResult.editorTable;
                    const selection = factoryResult.selection;
                    const editorTableHandler = factoryResult.editorTableHandler;
                    const history = factoryResult.history;
                    const areaResizer = factoryResult.areaResizer;
                    const fillController = factoryResult.fillController;

                    // 開いているテーブルのマップに登録
                    this.openEditorTables.set(name, editorTable);

                    // ビューコンテキストを設定
                    this.setupViewContext(
                        name, editorTable, viewDefinition, columnMappings,
                        joinTableKeyMaps, buildResult.rowMetadata, baseTableData, history
                    );

                    // ファイルから読み込んだビューのJOIN列ヘッダーに背景色を適用
                    for (let i = 0; i < columnMappings.length; i++) {
                        if (columnMappings[i].isJoinedColumn) {
                            editorTable.addColumnHeaderClass(i, 'editor-table-joined-column-header');
                        }
                    }

                    // ビュー用の保存コールバック
                    editorTableHandler.setSaveCallback((_table: EditorTable) => {
                        const state = this.tabStates.get(name);
                        if (!state || state.kind !== 'view') return Promise.resolve();
                        // 保存前に列幅をViewDefinitionに反映
                        updateViewColumnConfigs(state.editorTable, state.columnMappings, state.viewDefinition);
                        return saveViewDataAsync(
                            state.editorTable, state.columnMappings, state.viewDefinition, state.rowMetadata
                        );
                    });

                    // 参照先テーブルをpreload
                    this.preloadReferenceTables(compositeTableData, referenceDataCache, editorTable);

                    // 逆参照を並行して解決（ベーステーブル名で解決する）
                    this.resolveReverseReferencesAsync(baseTable, editorTable);

                    // ドロップダウン入力を作成
                    const dropdownInput = new GridDropdownInput(
                        wrapperElement,
                        editorTableHandler.element,
                        (id: string) => { editorTableHandler.submitDropdownSelection(id); },
                        () => { editorTableHandler.cancelDropdown(); }
                    );

                    editorTableHandler.setReferenceComponents(referenceDataCache, dropdownInput, compositeTableData);

                    // 初期選択
                    selection.setRange(1, 1, 1, 1);
                    selection.move(1, 1);

                    // タブ状態を保存
                    const state: ViewTabState = {
                        kind: 'view',
                        editorTable, selection, editorTableHandler, history,
                        areaResizer, fillController, wrapperElement,
                        referenceDataCache, dropdownInput, viewDefinition,
                        columnMappings, rowMetadata: buildResult.rowMetadata,
                        savedScrollLeft: 0, savedScrollTop: 0,
                    };
                    this.tabStates.set(name, state);

                    this.activateTabState(state);
                    this.activeTabName = name;

                    this.consumePendingNavigation(state);
                });
            });
        });
    }

    /**
     * ビューコンテキストを設定する
     */
    private setupViewContext(
        name: string, editorTable: EditorTable, viewDefinition: ViewDefinition,
        columnMappings: ViewColumnMapping[], joinTableKeyMaps: Map<string, Map<string, string[][]>>,
        rowMetadata: ViewRowMetadata[], baseTableData: EditorTableData, history: History
    ): void {
        // ベーステーブルのreferenceを持つ列から利用可能なJoin対象を抽出
        const availableJoinTargets: AvailableJoinTarget[] = [];
        for (const col of baseTableData.header) {
            if (!col.reference) continue;
            const parts = col.reference.split('.');
            if (parts.length !== 2) continue;
            availableJoinTargets.push({
                sourceColumnName: col.name,
                targetTableName: parts[0],
                targetColumnName: parts[1],
            });
        }

        editorTable.setViewContext({
            viewDefinition, columnMappings, availableJoinTargets, joinTableKeyMaps, rowMetadata,
            onJoinAsync: (targetTable: string, sourceColumn: string, afterColumnIndex: number) => {
                return this.executeJoinAsync(
                    editorTable, viewDefinition, columnMappings, history,
                    targetTable, sourceColumn, afterColumnIndex
                );
            },
            onShowHiddenColumn: (tableName: string, columnName: string) => {
                this.showHiddenViewColumn(name, tableName, columnName);
            },
        });
    }

    /**
     * Join操作を実行する
     */
    private async executeJoinAsync(
        editorTable: EditorTable, viewDefinition: ViewDefinition,
        columnMappings: ViewColumnMapping[], history: History,
        targetTable: string, sourceColumn: string, afterColumnIndex: number
    ): Promise<void> {
        // 結合先テーブルを読み込み
        const [schemaText, csvText] = await Promise.all([
            readFileAsync('schema/' + targetTable + '.json'),
            readFileAsync('data/' + targetTable + '.csv'),
        ]);

        const json = JSON.parse(schemaText);
        const csv = new Csv();
        csv.load(csvText);
        const joinTableData = EditorTableData.parse(json, csv);

        // Join定義を追加
        // referenceからtargetColumnを取得
        const targetColumn = joinTableData.header.length > 0 ? joinTableData.header[0].name : 'id';
        // referenceのtargetColumnを使う
        const baseCol = editorTable.getTableData().header.find(c => c.name === sourceColumn);
        let actualTargetColumn = targetColumn;
        if (baseCol && baseCol.reference) {
            const parts = baseCol.reference.split('.');
            if (parts.length === 2) {
                actualTargetColumn = parts[1];
            }
        }

        // ViewJoinCommandを使用
        const {ViewJoinCommand} = await import("./view-join-command");
        const command = new ViewJoinCommand(
            editorTable, viewDefinition, columnMappings, joinTableData,
            targetTable, sourceColumn, actualTargetColumn, afterColumnIndex
        );

        const anchor = editorTable.getSelection().getAnchor();
        const copyRange = editorTable.getSelection().getCopyRange();
        history.executeCommand(command, {
            startRow: anchor.row, startColumn: anchor.column,
            endRow: anchor.row, endColumn: anchor.column,
        }, copyRange);
    }

    /**
     * 非表示列を再表示する
     * viewDefinition.columns の hidden を false に変更し、ビュータブを再構築する
     */
    private showHiddenViewColumn(name: string, tableName: string, columnName: string): void {
        const state = this.tabStates.get(name);
        if (!state || state.kind !== 'view') return;

        // viewDefinition.columns の該当エントリを hidden:false で置換
        const colIndex = state.viewDefinition.columns.findIndex(
            c => c.tableName === tableName && c.columnName === columnName && c.hidden
        );
        if (colIndex >= 0) {
            const old = state.viewDefinition.columns[colIndex];
            state.viewDefinition.columns.splice(colIndex, 1, {
                tableName: old.tableName, columnName: old.columnName,
                width: old.width, hidden: false,
            });
        }

        // ビュータブを再構築
        this.rebuildViewTab(name);
    }

    /**
     * ビュータブを再構築する
     * 現在のViewDefinitionを保持したまま、タブを再作成する
     */
    private rebuildViewTab(name: string): void {
        const state = this.tabStates.get(name);
        if (!state || state.kind !== 'view') return;

        const viewDefinition = state.viewDefinition;

        // 現在の列幅をViewDefinitionに反映
        updateViewColumnConfigs(state.editorTable, state.columnMappings, viewDefinition);

        // 現在のタブ状態をクリーンアップ
        state.editorTable.deactivate();
        state.areaResizer.deactivate();
        state.fillController.deactivate();
        state.editorTableHandler.deactivate();
        state.wrapperElement.remove();
        this.tabStates.delete(name);
        this.openEditorTables.delete(name);

        const tabButton = this.tabButtons.find(x => x.name === name);
        if (!tabButton) return;

        // ファイル読み込みを迂回し、メモリ上のviewDefinitionを引数として渡す
        this.activeTabName = name;
        this.createViewTabState(name, tabButton, viewDefinition);
    }

    /**
     * タブ切り替え時に参照ヒントを再更新する
     * 他タブでインメモリデータが編集されている可能性があるため、
     * キャッシュをクリアして参照データを再読み込みする
     */
    private refreshReferenceHints(name: string, state: TabState): void {
        // キャッシュをクリアして最新のインメモリデータから再読み込みさせる
        state.referenceDataCache.clear();

        // ビュータブの場合: 結合テーブルの最新データでキーマップを再構築し、行数差分を反映する
        if (state.kind === 'view') {
            state.editorTable.rebuildJoinTableKeyMaps(this.openEditorTables);
            state.editorTable.refreshViewRows();
        }

        // 参照テーブルを再読み込み
        const tableData = state.editorTable.getTableData();
        this.preloadReferenceTables(tableData, state.referenceDataCache, state.editorTable);

        // 逆参照を再解決する（ビュータブはベーステーブル名で解決する）
        const reverseTableName = state.kind === 'view' ? state.viewDefinition.baseTable : name;
        this.resolveReverseReferencesAsync(reverseTableName, state.editorTable);
    }

    /**
     * 逆参照を非同期で解決し、ヒントを更新する
     */
    private resolveReverseReferencesAsync(tableName: string, editorTable: EditorTable): void {
        const resolver = new ReverseReferenceResolver(this.openEditorTables);
        resolver.resolveAsync(tableName).then(reverseMap => {
            editorTable.updateReverseReferenceHints(reverseMap);
        }).catch(error => {
            console.warn('Failed to resolve reverse references:', error);
        });
    }

    /**
     * 参照先テーブルを事前読み込みする
     */
    private preloadReferenceTables(
        tableData: EditorTableData, referenceDataCache: ReferenceDataCache, editorTable: EditorTable
    ): void {
        const referenceTables: string[] = [];
        const dynamicIntermediateTables: string[] = [];

        for (const col of tableData.header) {
            if (!col.reference) continue;
            const expr = parseReferenceExpression(col.reference);
            if (isDynamicReference(expr)) {
                dynamicIntermediateTables.push(expr.filter.tableName);
            } else {
                referenceTables.push(expr.tableName);
            }
        }

        const uniqueRef = Array.from(new Set(referenceTables));
        const uniqueInter = Array.from(new Set(dynamicIntermediateTables));

        const promises: Promise<unknown>[] = [];
        for (const tn of uniqueRef) {
            promises.push(referenceDataCache.get(tn));
        }
        for (const tn of uniqueInter) {
            promises.push(referenceDataCache.getFullDataAsync(tn));
        }

        if (promises.length > 0) {
            Promise.all(promises).then(() => {
                editorTable.updateReferenceHints();
            }).catch(error => {
                console.warn('Failed to preload:', error);
            });
        }
    }

    /**
     * EditorTableと関連オブジェクトをファクトリ関数で生成
     * 相互参照を解決するために Object.assign + Object.setPrototypeOf を使用
     */
    private createEditorTable(
        name: string, tableData: EditorTableData, referenceDataCache: ReferenceDataCache,
        wrapperElement: HTMLElement, tabButton: TabButton
    ): EditorTableFactoryResult {
        // 相互参照を解決するため、一時的な空オブジェクトを作成
        const editorTable = {} as EditorTable;

        // ScrollViewportController を作成（editorTable.onScroll を参照）
        const scrollController = new ScrollViewportController(this.editor.element, () => {
            editorTable.onScroll();
        });

        // Selection を作成（editorTable への参照をコンストラクタで渡す）
        const selection = new Selection(editorTable, wrapperElement, scrollController);

        // History を作成（EditorTable が必要）
        const history = new History(editorTable, tabButton, 1000);

        // EditorTableHandler を作成（element を所有し、全イベントを管理）
        const editorTableHandler = new EditorTableHandler(editorTable, selection, history);

        // GridTextField を作成（EditorTableHandler の element を使用）
        const textField = new GridTextField(editorTableHandler.element, editorTable, selection);

        // EditorTableHandler に GridTextField を設定（循環依存解決）
        editorTableHandler.setTextField(textField);

        // AreaResizer を作成（History, Selection が必要）
        const areaResizer = new AreaResizer(wrapperElement, history, selection);

        // 本物の EditorTable インスタンスを作成
        const realEditorTable = new EditorTable(
            name, tableData, referenceDataCache, editorTableHandler,
            selection, this.contextMenu, history, areaResizer,
            scrollController, this.sidebar
        );

        // editorTable に本物のインスタンスの内容をコピー
        Object.assign(editorTable, realEditorTable);
        Object.setPrototypeOf(editorTable, EditorTable.prototype);

        // FillController を作成（EditorTable, Selection, History が必要）
        const fillController = new FillController(editorTable, selection, history);

        // DOM要素を追加
        editorTable.appendTo(wrapperElement);
        wrapperElement.appendChild(selection.element);
        wrapperElement.appendChild(selection.copyBorderElement);
        wrapperElement.appendChild(selection.fillPreviewElement);
        wrapperElement.appendChild(editorTableHandler.element);

        // AreaResizer に EditorTable を設定
        areaResizer.setEditorTable(editorTable);

        // DOM要素を構築
        editorTable.initialize();

        // FillController のイベントを初期化（EditorTable が初期化された後）
        fillController.initialize();

        return {editorTable, selection, editorTableHandler, history, areaResizer, fillController};
    }

    /**
     * 現在アクティブなタブの状態を取得
     */
    getActiveTabState(): TabState | undefined {
        if (!this.activeTabName) return undefined;
        return this.tabStates.get(this.activeTabName);
    }

    /**
     * タブを移動する（ドラッグアンドドロップ用）
     * @param fromName 移動元のタブ名
     * @param toName 移動先のタブ名
     * @param insertBefore trueなら移動先タブの前に挿入、falseなら後に挿入
     */
    moveTabButton(fromName: string, toName: string, insertBefore: boolean): void {
        const fromIndex = this.tabButtons.findIndex(x => x.name === fromName);
        const toIndex = this.tabButtons.findIndex(x => x.name === toName);

        if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
            return;
        }

        const fromTabButton = this.tabButtons[fromIndex];
        const toTabButton = this.tabButtons[toIndex];

        // 配列から削除
        this.tabButtons.splice(fromIndex, 1);

        // 新しい位置を計算（削除後のインデックス）
        let newIndex = this.tabButtons.findIndex(x => x.name === toName);
        if (!insertBefore) {
            newIndex = newIndex + 1;
        }

        // 配列に挿入
        this.tabButtons.splice(newIndex, 0, fromTabButton);

        // DOMを更新
        if (insertBefore) {
            this.element.insertBefore(fromTabButton.element, toTabButton.element);
        } else {
            // 移動先タブの次の要素の前に挿入（次の要素がなければ末尾に追加）
            const nextSibling = toTabButton.element.nextSibling;
            if (nextSibling) {
                this.element.insertBefore(fromTabButton.element, nextSibling);
            } else {
                this.element.appendChild(fromTabButton.element);
            }
        }
    }

    /**
     * 全タブのドロップインジケーターをクリア
     */
    clearDropIndicators(): void {
        this.tabButtons.forEach(tabButton => {
            tabButton.element.classList.remove('tab-button-drop-left', 'tab-button-drop-right');
        });
    }

    /**
     * ドラッグ中のタブ名を設定
     */
    setDraggingTabName(name: string): void {
        this.draggingTabName = name;
    }

    /**
     * ドラッグ中のタブ名を取得
     */
    getDraggingTabName(): string | undefined {
        return this.draggingTabName;
    }

    /**
     * ドラッグ中のタブ名をクリア
     */
    clearDraggingTabName(): void {
        this.draggingTabName = undefined;
    }

    /**
     * ドロップインジケーターを更新
     */
    updateDropIndicator(clientX: number): void {
        this.clearDropIndicators();

        for (const tabButton of this.tabButtons) {
            // ドラッグ中のタブはスキップ
            if (tabButton.name === this.draggingTabName) {
                continue;
            }

            const rect = tabButton.element.getBoundingClientRect();
            if (clientX >= rect.left && clientX <= rect.right) {
                const midX = rect.left + rect.width / 2;
                if (clientX < midX) {
                    tabButton.element.classList.add('tab-button-drop-left');
                } else {
                    tabButton.element.classList.add('tab-button-drop-right');
                }
                break;
            }
        }
    }

    /**
     * タブをドロップ
     */
    dropTab(clientX: number): void {
        if (!this.draggingTabName) {
            return;
        }

        for (const tabButton of this.tabButtons) {
            // ドラッグ中のタブはスキップ
            if (tabButton.name === this.draggingTabName) {
                continue;
            }

            const rect = tabButton.element.getBoundingClientRect();
            if (clientX >= rect.left && clientX <= rect.right) {
                const midX = rect.left + rect.width / 2;
                const insertBefore = clientX < midX;
                this.moveTabButton(this.draggingTabName, tabButton.name, insertBefore);
                break;
            }
        }
    }
}
