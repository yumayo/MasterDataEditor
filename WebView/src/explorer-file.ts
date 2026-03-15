import {Tab} from "./tab";

export class ExplorerFile {

    private readonly tab: Tab;
    private readonly description: string | null;

    private readonly name: string;
    private readonly depth: number;
    private readonly element: HTMLElement;

    constructor(
        tab: Tab,
        name: string,
        depth: number,
        description: string | null
    ) {
        this.tab = tab;
        this.name = name;
        this.depth = depth;
        this.description = description;

        const div = document.createElement('div');
        div.classList.add('explorer-file');
        div.setAttribute('style', 'padding-left: ' + this.depth * 16 + 'px');

        // description が存在かつ空文字でない場合は2行構造（description + name）、それ以外は名前のみ
        if (description !== null && description !== '') {
            const descSpan = document.createElement('span');
            descSpan.classList.add('explorer-file-description');
            descSpan.textContent = description;
            div.appendChild(descSpan);
        }

        const nameSpan = document.createElement('span');
        nameSpan.classList.add('explorer-file-name');
        nameSpan.textContent = name;
        div.appendChild(nameSpan);

        div.addEventListener('click', this.onClick.bind(this));

        this.element = div;
    }

    /**
     * このファイルノードをアクティブ（ハイライト）状態にする
     */
    activate(): void {
        this.element.classList.add('explorer-file-active');
    }

    /**
     * このファイルノードのアクティブ状態を解除する
     */
    deactivate(): void {
        this.element.classList.remove('explorer-file-active');
    }

    /**
     * このファイルノードを親要素に追加する
     */
    appendTo(parent: HTMLElement): void {
        parent.appendChild(this.element);
    }

    private onClick(): void {
        const tabButton = this.tab.append(this.name, this.description);
        tabButton.click();
    }
}
