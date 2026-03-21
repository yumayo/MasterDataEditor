import {Tab} from "./tab";
import {extractFirstLineFromDescription} from "./description-utils";

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
        div.style.paddingLeft = (this.depth * 16) + 'px';

        // name を1行目（主情報）、description を2行目（補助情報）として表示する
        const nameSpan = document.createElement('span');
        nameSpan.classList.add('explorer-file-name');
        nameSpan.textContent = name;
        div.appendChild(nameSpan);

        // description が存在する場合は1行目のみ使用。表示する行がない場合は生成しない
        if (description !== null) {
            const firstLine = extractFirstLineFromDescription(description);
            if (firstLine !== null) {
                const descSpan = document.createElement('span');
                descSpan.classList.add('explorer-file-description');
                descSpan.textContent = firstLine;
                div.appendChild(descSpan);
            }
        }

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
