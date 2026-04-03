import {Tab} from "./tab";
import {ExplorerFile} from "./explorer-file";

export class ExplorerDirectory {

    private readonly tab: Tab;

    private readonly element: HTMLElement;
    private readonly depth: number;

    /** テーブル名 → ExplorerFile のマップ（ハイライト制御に使用） */
    private readonly files: Map<string, ExplorerFile>;

    constructor(
        tab: Tab,
        element: HTMLElement,
        depth: number
    ) {
        this.tab = tab;
        this.element = element;
        this.depth = depth;
        this.files = new Map();

        // フィルター入力欄をファイルリストの先頭に配置する
        const filterContainer = document.createElement('div');
        filterContainer.classList.add('explorer-filter-container');
        const filterInput = document.createElement('input');
        filterInput.type = 'text';
        filterInput.classList.add('explorer-filter-input');
        filterInput.placeholder = 'テーブルを検索...';
        // クリアボタン（✕）
        const clearButton = document.createElement('button');
        clearButton.classList.add('explorer-filter-clear');
        clearButton.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M9.35 3.35L6.71 6l2.64 2.65-.71.7L6 6.71 3.35 9.35l-.7-.7L5.29 6 2.65 3.35l.7-.7L6 5.29l2.65-2.64.7.7z" fill="currentColor"/></svg>';
        clearButton.style.display = 'none';
        clearButton.addEventListener('click', () => {
            filterInput.value = '';
            clearButton.style.display = 'none';
            for (const file of this.files.values()) {
                file.clearFilter();
            }
            filterInput.focus();
        });
        filterInput.addEventListener('input', () => {
            const query = filterInput.value;
            clearButton.style.display = query === '' ? 'none' : '';
            if (query === '') {
                for (const file of this.files.values()) {
                    file.clearFilter();
                }
            } else {
                for (const file of this.files.values()) {
                    file.matchFilter(query);
                }
            }
        });
        filterContainer.appendChild(filterInput);
        filterContainer.appendChild(clearButton);
        this.element.appendChild(filterContainer);
    }

    appendFile(name: string, description: string | null): void {
        if (this.files.has(name)) {
            throw new Error(`[ExplorerDirectory] appendFile: 重複登録: ${name}`);
        }
        const file = new ExplorerFile(this.tab, name, this.depth + 1, description);
        file.appendTo(this.element);
        this.files.set(name, file);
    }

    /**
     * 指定テーブル名のファイルノードをアクティブ（ハイライト）状態にし、他は解除する
     */
    highlightFile(name: string): void {
        for (const [key, file] of this.files) {
            if (key === name) {
                file.activate();
            } else {
                file.deactivate();
            }
        }
    }

    /**
     * 全ファイルノードのハイライトを解除する
     */
    clearHighlight(): void {
        for (const file of this.files.values()) {
            file.deactivate();
        }
    }
}
