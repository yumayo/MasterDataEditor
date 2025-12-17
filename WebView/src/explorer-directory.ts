import {Tab} from "./tab";
import {ExplorerFile} from "./explorer-file";

export class ExplorerDirectory {

    readonly tab: Tab;

    readonly element: HTMLElement;
    readonly depth: number;

    constructor(tab: Tab, element: HTMLElement, depth: number) {
        this.tab = tab;

        this.element = element;
        this.depth = depth;
    }

    appendFile(name: string) {
        const file = new ExplorerFile(this.tab, name, this.depth + 1);
        this.element.appendChild(file.element);
    }

    appendDirectory(name: string) {
        const directory = document.createElement('div');
        directory.classList.add('explorer-directory');

        const directoryName = document.createElement('div');
        directoryName.classList.add('explorer-directory-name');
        directoryName.setAttribute('style', 'padding-left: ' + this.depth * 16 + 'px');
        directoryName.textContent = name;

        directory.appendChild(directoryName);

        const ul = document.createElement('div');
        directory.appendChild(ul);

        this.element.appendChild(directory);

        return new ExplorerDirectory(this.tab, ul, this.depth + 1);
    }
}
