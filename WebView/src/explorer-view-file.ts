import {Tab} from "./tab";

/**
 * Explorerのビューファイル項目
 * クリックでビュータブを開く
 */
export class ExplorerViewFile {

    readonly tab: Tab;

    readonly name: string;
    readonly depth: number;
    readonly element: HTMLElement;

    constructor(
        tab: Tab,
        name: string,
        depth: number
    ) {
        this.tab = tab;
        this.name = name;
        this.depth = depth;

        const li = document.createElement('div');
        li.textContent = name;
        li.classList.add('explorer-file');
        li.setAttribute(
            'style',
            'padding-left: '
                + this.depth * 16 + 'px'
        );

        li.addEventListener(
            'click',
            this.onClick.bind(this)
        );

        this.element = li;
    }

    onClick() {
        const tabButton = this.tab.append(
            'view:' + this.name
        );
        tabButton.click();
    }
}
