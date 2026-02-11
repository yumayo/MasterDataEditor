import {ExplorerDirectory} from
    "./explorer-directory";
import {Tab} from "./tab";
import {ContextMenu} from "./context-menu";

export class Explorer {

    readonly tab: Tab;
    readonly contextMenu: ContextMenu;

    readonly element: HTMLElement;
    readonly directory: ExplorerDirectory;

    constructor(
        tab: Tab,
        contextMenu: ContextMenu
    ) {
        this.tab = tab;
        this.contextMenu = contextMenu;

        this.element =
            document.getElementById('explorer')!;
        this.directory = new ExplorerDirectory(
            this.tab,
            this.contextMenu,
            this.element,
            1
        );
    }

    appendFile(name: string) {
        this.directory.appendFile(name);
    }

    appendDirectory(name: string) {
        return this.directory.appendDirectory(
            name
        );
    }
}
