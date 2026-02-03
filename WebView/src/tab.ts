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
    referenceDataCache: ReferenceDataCache;
    dropdownInput: GridDropdownInput;
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

    constructor(editor: Editor) {
        this.editor = editor;
        this.element = document.getElementById('tab-content')!;
        this.tabButtons = [];
        this.tabStates = new Map();
        this.activeTabName = undefined;
        this.contextMenu = new ContextMenu(editor.element);
        this.draggingTabName = undefined;
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
            // グローバルイベントリスナーを解除
            state.editorTable.deactivate();
            state.areaResizer.deactivate();
            state.fillController.deactivate();
            state.editorTableHandler.deactivate();

            // DOMを削除
            state.wrapperElement.remove();

            // 状態を削除
            this.tabStates.delete(name);
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
            return;
        }

        // 新しいタブ状態を作成
        this.createTabState(name, tabButton);
    }

    /**
     * タブ状態を非アクティブ化（DOMを非表示にしてイベントリスナーを解除）
     */
    private deactivateTabState(state: TabState): void {
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

                // 参照データキャッシュを作成
                const referenceDataCache = new ReferenceDataCache();

                // EditorTableと関連オブジェクトをファクトリ関数で生成（相互参照を解決）
                const editorTableFactoryResult = this.createEditorTable(
                    name,
                    tableData,
                    referenceDataCache,
                    wrapperElement,
                    tabButton
                );
                const editorTable = editorTableFactoryResult.editorTable;
                const selection = editorTableFactoryResult.selection;
                const editorTableHandler = editorTableFactoryResult.editorTableHandler;
                const history = editorTableFactoryResult.history;
                const areaResizer = editorTableFactoryResult.areaResizer;
                const fillController = editorTableFactoryResult.fillController;

                // 参照先テーブルを事前読み込み
                // referenceは "テーブル名.列名" の形式なので、テーブル名部分を抽出
                const referenceTables = tableData.header
                    .map(col => col.reference)
                    .filter((ref): ref is string => ref !== undefined)
                    .map(ref => {
                        const dotIndex = ref.indexOf('.');
                        return dotIndex === -1 ? ref : ref.substring(0, dotIndex);
                    });
                // 重複を除去
                const uniqueReferenceTables = Array.from(new Set(referenceTables));
                if (uniqueReferenceTables.length > 0) {
                    // preloadが完了したら参照ヒントを更新
                    Promise.all(uniqueReferenceTables.map(t => referenceDataCache.get(t))).then(() => {
                        editorTable.updateReferenceHints();
                    }).catch(error => {
                        console.warn('Failed to preload reference tables:', error);
                    });
                }

                // ドロップダウン入力コンポーネントを作成
                const dropdownInput = new GridDropdownInput(
                    wrapperElement,
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
                const state: TabState = {
                    editorTable,
                    selection,
                    editorTableHandler,
                    history,
                    areaResizer,
                    fillController,
                    wrapperElement,
                    referenceDataCache,
                    dropdownInput
                };
                this.tabStates.set(name, state);

                // アクティブ化
                this.activateTabState(state);
                this.activeTabName = name;
            });

        });
    }

    /**
     * EditorTableと関連オブジェクトをファクトリ関数で生成
     * 相互参照を解決するために Object.assign + Object.setPrototypeOf を使用
     */
    private createEditorTable(
        name: string,
        tableData: EditorTableData,
        referenceDataCache: ReferenceDataCache,
        wrapperElement: HTMLElement,
        tabButton: TabButton
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
            name,
            tableData,
            referenceDataCache,
            editorTableHandler,
            selection,
            this.contextMenu,
            history,
            areaResizer,
            scrollController
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
