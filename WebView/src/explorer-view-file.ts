import {Tab} from "./tab";
import {ContextMenu} from "./context-menu";
import {deleteFileAsync} from "./api";

/**
 * Explorerのビューファイル項目
 * クリックでビュータブを開く
 * 右クリックでビューを削除できる
 */
export class ExplorerViewFile {

    private readonly tab: Tab;
    private readonly contextMenu: ContextMenu;

    readonly name: string;
    readonly depth: number;
    readonly element: HTMLElement;

    constructor(
        tab: Tab,
        contextMenu: ContextMenu,
        name: string,
        depth: number
    ) {
        this.tab = tab;
        this.contextMenu = contextMenu;
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

        li.addEventListener('click', this.onClick.bind(this));
        li.addEventListener('contextmenu', this.onContextMenu.bind(this));

        this.element = li;
    }

    private onClick() {
        const tabButton = this.tab.append(
            'view:' + this.name
        );
        tabButton.click();
    }

    /**
     * 右クリックメニュー「ビューを削除」
     */
    private onContextMenu(e: MouseEvent) {
        e.preventDefault();
        e.stopPropagation();

        this.contextMenu.show(
            e.clientX,
            e.clientY,
            [
                {
                    label: 'ビューを削除',
                    action: () => {
                        this.deleteViewAsync();
                    },
                },
            ]
        );
    }

    /**
     * ビューファイルを削除し、タブとDOMからも除去する
     */
    private async deleteViewAsync() {
        await deleteFileAsync('view/' + this.name + '.json');
        this.tab.closeTab('view:' + this.name);
        this.element.remove();
    }
}
