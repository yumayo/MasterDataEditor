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

/**
 * タブごとの状態を保持するインターフェース
 */
export interface TabState {
    editorTable: EditorTable;
    selection: Selection;
    textField: GridTextField;
    history: History;
    areaResizer: AreaResizer;
    wrapperElement: HTMLElement;
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

    constructor(editor: Editor) {
        this.editor = editor;
        this.element = document.getElementById('tab-content')!;
        this.tabButtons = [];
        this.tabStates = new Map();
        this.activeTabName = undefined;
        this.contextMenu = new ContextMenu(editor.element);
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
            state.textField.deactivate();

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
        this.createTabState(name);
    }

    /**
     * タブ状態を非アクティブ化（DOMを非表示にしてイベントリスナーを解除）
     */
    private deactivateTabState(state: TabState): void {
        state.wrapperElement.style.display = 'none';
        state.editorTable.deactivate();
        state.areaResizer.deactivate();
        state.textField.deactivate();
    }

    /**
     * タブ状態をアクティブ化（DOMを表示してイベントリスナーを登録）
     */
    private activateTabState(state: TabState): void {
        state.wrapperElement.style.display = '';
        state.editorTable.activate();
        state.areaResizer.activate();
        state.textField.activate();

        // テキストフィールドを有効化（IME対応）
        state.textField.enable();
    }

    /**
     * 新しいタブ状態を作成
     */
    private createTabState(name: string): void {
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

                // EditorTableを作成
                const editorTable = new EditorTable(name, tableData);
                wrapperElement.appendChild(editorTable.element);

                // Selectionを作成
                const selection = new Selection(editorTable.element, wrapperElement);
                wrapperElement.appendChild(selection.element);
                wrapperElement.appendChild(selection.copyBorderElement);
                wrapperElement.appendChild(selection.fillPreviewElement);

                // 履歴管理（最大1000件）
                const history = new History(editorTable.element, 1000);

                // 履歴変更時にタブのdirty状態を更新
                const tabButton = this.tabButtons.find(x => x.name === name);
                if (tabButton) {
                    history.setOnChangeCallback(() => {
                        tabButton.setDirty(true);
                    });
                }

                // GridTextFieldを作成
                const textField = new GridTextField(editorTable, selection, history);
                wrapperElement.appendChild(textField.element);

                // 保存完了時にタブのdirty状態をクリア
                if (tabButton) {
                    textField.setOnSaveCallback(() => {
                        tabButton.setDirty(false);
                    });
                }

                // AreaResizerを作成
                const areaResizer = new AreaResizer(wrapperElement, history, selection);

                // EditorTableをセットアップ
                editorTable.setup(textField, selection, this.contextMenu, history, areaResizer);

                // AreaResizerにEditorTableを設定（循環参照を避けるため、setup後に設定）
                areaResizer.setEditorTable(editorTable);

                // 初期選択をA1（row=1, column=1）に設定
                selection.setRange(1, 1, 1, 1);
                selection.move(1, 1);

                // タブ状態を保存
                const state: TabState = {
                    editorTable,
                    selection,
                    textField,
                    history,
                    areaResizer,
                    wrapperElement
                };
                this.tabStates.set(name, state);

                // アクティブ化
                this.activateTabState(state);
                this.activeTabName = name;
            });

        });
    }

    /**
     * 現在アクティブなタブの状態を取得
     */
    getActiveTabState(): TabState | undefined {
        if (!this.activeTabName) return undefined;
        return this.tabStates.get(this.activeTabName);
    }
}
