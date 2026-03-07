import {Tab} from "./tab";
import {ExplorerFile} from "./explorer-file";

export class ExplorerDirectory {

    private readonly tab: Tab;

    private readonly element: HTMLElement;
    private readonly depth: number;

    constructor(
        tab: Tab,
        element: HTMLElement,
        depth: number
    ) {
        this.tab = tab;

        this.element = element;
        this.depth = depth;
    }

    appendFile(name: string) {
        const file = new ExplorerFile(
            this.tab,
            name,
            this.depth + 1
        );
        this.element.appendChild(file.element);
    }
}
