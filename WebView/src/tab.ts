import {EditorTableData} from "./model/editor-table-data";
import Store from "./store";
import {Csv} from "./csv";
import {TabButton} from "./tab-button";
import {readFileAsync} from "./api";

/**
 * VSCodeやGoogleChromeのタブと同じものです。
 */
export class Tab {

    element: HTMLElement;

    tabButtons: TabButton[];

    constructor() {
        this.element = document.getElementById('tab-content')!;
        this.tabButtons = [];
    }

    /**
     * タブに要素を追加します。
     *
     * すでに追加されている名前だった場合は何もせず、その要素を返却します。
     *
     * @param name
     */
    append(name: string) {

        // すでに同じ名前のオブジェクトが追加されていたら何もしないです。
        let tabButton = this.tabButtons.find(x => x.name === name);
        if (tabButton) {
            return tabButton;
        }

        tabButton = new TabButton(name, this);
        this.tabButtons.push(tabButton);

        this.element.appendChild(tabButton.element);

        return tabButton;
    }

    disableAll() {
        this.tabButtons.forEach(x => x.disable());
    }

    enableTabButton(name: string) {

        // ちょっと面倒なので、一回全部無効な状態にします。
        this.disableAll();

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
                Store.createTable(name, tableData);

            });

        });
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

    clearEditor() {
        Store.tableHolder?.clear();
        Store.tableName = undefined;
        Store.tableData = undefined;
        Store.table = undefined;
        Store.cursor = undefined;
        Store.textField = undefined;
    }
}
