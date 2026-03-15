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
