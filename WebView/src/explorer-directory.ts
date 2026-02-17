import {Tab} from "./tab";
import {ExplorerFile} from "./explorer-file";
import {ExplorerViewFile} from
    "./explorer-view-file";
import {ContextMenu} from "./context-menu";
import {Sidebar} from "./sidebar";

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

    appendViewFile(name: string) {
        const viewFile = new ExplorerViewFile(
            this.tab,
            name,
            this.depth + 1
        );
        this.element.appendChild(
            viewFile.element
        );
    }
}
