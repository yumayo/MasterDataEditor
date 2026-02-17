import {ExplorerDirectory} from "./explorer-directory";
import {Tab} from "./tab";
import {ContextMenu} from "./context-menu";

/**
 * VIEWSパネル
 * ビューファイル一覧を専用パネルとして表示する
 */
export class ViewsPanel {
    private readonly element: HTMLElement;
    private readonly directory: ExplorerDirectory;

    constructor(tab: Tab, contextMenu: ContextMenu) {
        this.element = document.createElement('div');
        this.element.classList.add('sidebar-panel', 'views-panel');

        const headerElement = document.createElement('div');
        headerElement.classList.add('sidebar-panel-header');
        headerElement.textContent = 'VIEWS';
        this.element.appendChild(headerElement);

        const contentElement = document.createElement('div');
        contentElement.classList.add('views-panel-content');
        this.element.appendChild(contentElement);

        // depth=0 で ExplorerDirectory を作成し、ビューファイルが depth=1（padding-left: 16px）で表示される
        this.directory = new ExplorerDirectory(tab, contextMenu, contentElement, 0);
    }

    /**
     * パネルを親要素に追加する
     */
    appendTo(parent: HTMLElement): void {
        parent.appendChild(this.element);
    }

    /**
     * ビューファイルを追加する
     */
    appendViewFile(name: string): void {
        this.directory.appendViewFile(name);
    }

    /**
     * パネルを表示する
     */
    show(): void {
        this.element.classList.add('sidebar-panel-active');
    }

    /**
     * パネルを非表示にする
     */
    hide(): void {
        this.element.classList.remove('sidebar-panel-active');
    }
}
