import {EditorTableData} from "./model/editor-table-data";
import {Csv} from "./csv";
import {TabButton} from "./tab-button";
import {readFileAsync} from "./api";
import {createTable} from "./editor-actions";
import {Editor} from "./editor";

/**
 * VSCodeやGoogleChromeのタブと同じものです。
 */
export class Tab {

    element: HTMLElement;

    tabButtons: TabButton[];

    readonly editor: Editor;

    constructor(editor: Editor) {
        this.editor = editor;
        this.element = document.getElementById('tab-content')!;
        this.tabButtons = [];
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

        // タブの名前から同名のマスターデータを取り出してきます。
        readFileAsync("schema/" + name + ".json").then((text) => {

            readFileAsync("data/" + name + ".csv").then((csvFileContents) => {

                const json = JSON.parse(text);

                const csv = new Csv();
                csv.load(csvFileContents);

                const tableData = EditorTableData.parse(json, csv);
                createTable(this.editor, name, tableData);
            });

        });
    }
}
