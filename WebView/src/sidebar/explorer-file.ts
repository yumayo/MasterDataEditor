import {Tab} from "../tabs/tab";
import {extractFirstLineFromDescription} from "../core/description-utils";
import {fuzzyMatch, appendHighlightedSegments} from "../search/fuzzy-search";

export class ExplorerFile {

    private readonly tab: Tab;
    private readonly description: string | null;

    private readonly name: string;
    private readonly depth: number;
    private readonly element: HTMLElement;
    private readonly nameSpan: HTMLElement;

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
        this.nameSpan = document.createElement('span');
        this.nameSpan.classList.add('explorer-file-name');
        this.nameSpan.textContent = name;
        div.appendChild(this.nameSpan);

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
        // 右クリックでコンテキストメニューを表示する（「テーブル定義を編集」等）
        div.addEventListener('contextmenu', (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            this.tab.showExplorerContextMenu(this.name, e.clientX, e.clientY);
        });

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

    /**
     * ファジー検索でnameがqueryにマッチするか判定する。
     * マッチした場合はハイライト付きで表示し、マッチしない場合は非表示にする。
     * @returns マッチした場合 true
     */
    matchFilter(query: string): boolean {
        const matched = fuzzyMatch(this.name, query);
        this.element.style.display = matched ? '' : 'none';
        if (matched) {
            // nameSpan の中身をクリアしてハイライト付きで再構築する
            this.nameSpan.textContent = '';
            appendHighlightedSegments(this.nameSpan, this.name, query);
        }
        return matched;
    }

    /**
     * フィルタをクリアして通常表示に戻す（display復帰 + ハイライト除去）
     */
    clearFilter(): void {
        this.element.style.display = '';
        this.nameSpan.textContent = this.name;
    }

    private onClick(): void {
        const tabButton = this.tab.append(this.name, this.description);
        tabButton.click();
    }
}
