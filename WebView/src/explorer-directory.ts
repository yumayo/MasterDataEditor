import {Tab} from "./tab";
import {ExplorerFile} from "./explorer-file";
import {ExplorerViewFile} from
    "./explorer-view-file";
import {ContextMenu} from "./context-menu";

export class ExplorerDirectory {

    readonly tab: Tab;
    readonly contextMenu: ContextMenu;

    readonly element: HTMLElement;
    readonly depth: number;

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

    appendFile(name: string) {
        const file = new ExplorerFile(
            this.tab,
            this.contextMenu,
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

    appendDirectory(name: string) {
        const directory =
            document.createElement('div');
        directory.classList.add(
            'explorer-directory'
        );

        const directoryName =
            document.createElement('div');
        directoryName.classList.add(
            'explorer-directory-name'
        );
        directoryName.setAttribute(
            'style',
            'padding-left: '
                + this.depth * 16 + 'px'
        );
        directoryName.textContent = name;

        directory.appendChild(directoryName);

        const ul = document.createElement('div');
        directory.appendChild(ul);

        this.element.appendChild(directory);

        return new ExplorerDirectory(
            this.tab,
            this.contextMenu,
            ul,
            this.depth + 1
        );
    }
}
