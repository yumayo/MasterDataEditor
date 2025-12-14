import {ExplorerDirectory} from "./explorer-directory";

export class Explorer {

    explorer: HTMLElement;

    directory: ExplorerDirectory;

    constructor() {
        this.explorer = document.getElementById('explorer')!;
        this.directory = new ExplorerDirectory(this.explorer, 1);
    }

    append(name: string) {
        this.directory.append(name);
    }

    appendDirectory(name: string) {
        return this.directory.appendDirectory(name);
    }
}
