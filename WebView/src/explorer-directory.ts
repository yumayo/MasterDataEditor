import {Tab} from "./tab";
import {ExplorerFile} from "./explorer-file";
import {ExplorerViewFile} from
    "./explorer-view-file";
import {ContextMenu} from "./context-menu";
import {Sidebar} from "./sidebar";
import {config} from "./config";

export class ExplorerDirectory {

    private readonly tab: Tab;
    private readonly contextMenu: ContextMenu;

    private readonly element: HTMLElement;
    private readonly depth: number;

    constructor(
        tab: Tab,
        contextMenu: ContextMenu,
        element: HTMLElement,
        depth: number
    ) {
        this.tab = tab;
        this.contextMenu = contextMenu;

        this.element = element;
        this.depth = depth;
    }

    appendFile(name: string, sidebar: Sidebar) {
        const file = new ExplorerFile(
            this.tab,
            this.contextMenu,
            sidebar,
            name,
            this.depth + 1
        );
        this.element.appendChild(file.element);
    }

    /**
     * ビューファイルをソート順の正しい位置に挿入する
     * Windows Explorerと同じ自然順ソート（数字部分を数値比較）
     */
    appendViewFile(name: string) {
        const viewFile = new ExplorerViewFile(
            this.tab,
            this.contextMenu,
            name,
            this.depth + 1
        );
        const children = this.element.children;
        for (let i = 0; i < children.length; ++i) {
            const existing = children[i].textContent!;
            if (name.localeCompare(existing, config.locale, { numeric: true }) < 0) {
                this.element.insertBefore(viewFile.element, children[i]);
                return;
            }
        }
        this.element.appendChild(viewFile.element);
    }

    /**
     * 指定名のビューファイルがDOM上に存在するか判定する
     */
    hasViewFile(name: string): boolean {
        const children = this.element.children;
        for (let i = 0; i < children.length; ++i) {
            if (children[i].textContent === name) return true;
        }
        return false;
    }
}
