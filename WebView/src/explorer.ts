import {ExplorerDirectory} from "./explorer-directory";
import {Tab} from "./tab";

export class Explorer {

    readonly tab: Tab;

    readonly element: HTMLElement;
    readonly directory: ExplorerDirectory;

    constructor(tab: Tab) {
        this.tab = tab;

        this.element = document.getElementById('explorer')!;
        this.directory = new ExplorerDirectory(this.tab, this.element, 1);
    }

    appendFile(name: string) {
        this.directory.appendFile(name);
    }

    appendDirectory(name: string) {
        return this.directory.appendDirectory(name);
    }
}
