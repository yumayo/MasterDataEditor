import {Tab} from "./tab";
import {ContextMenu} from "./context-menu";
import {writeFileAsync} from "./api";
import {
    serializeViewDefinition,
    ViewDefinition
} from "./model/view-definition";
import {Sidebar} from "./sidebar";

export class ExplorerFile {

    private readonly tab: Tab;
    private readonly contextMenu: ContextMenu;
    private readonly sidebar: Sidebar;

    readonly name: string;
    readonly depth: number;
    readonly element: HTMLElement;

    constructor(
        tab: Tab,
        contextMenu: ContextMenu,
        sidebar: Sidebar,
        name: string,
        depth: number
    ) {
        this.tab = tab;
        this.contextMenu = contextMenu;
        this.sidebar = sidebar;
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
        li.addEventListener(
            'contextmenu',
            this.onContextMenu.bind(this)
        );

        this.element = li;
    }

    onClick() {
        const tabButton = this.tab.append(
            this.name
        );
        tabButton.click();
    }

    /**
     * 右クリックメニュー「ビューを作成」
     */
    private onContextMenu(e: MouseEvent) {
        e.preventDefault();
        e.stopPropagation();

        this.contextMenu.show(
            e.clientX,
            e.clientY,
            [
                {
                    label: 'ビューを作成',
                    action: () => {
                        this.createViewAsync();
                    },
                },
            ]
        );
    }

    /**
     * ビューを作成して保存・タブを開く
     */
    private createViewAsync() {
        const viewName =
            'view_' + this.name;
        const viewDefinition: ViewDefinition = {
            name: viewName,
            baseTable: this.name,
            joins: [],
        };
        const json = serializeViewDefinition(
            viewDefinition
        );

        writeFileAsync(
            'view/' + viewName + '.json',
            json
        ).then(() => {
            // Explorerのビューディレクトリに追加
            this.sidebar.appendViewFile(viewName);

            // タブを開く
            const tabButton = this.tab.append(
                'view:' + viewName
            );
            tabButton.click();
        });
    }
}
