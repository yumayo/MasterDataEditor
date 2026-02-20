import {ExplorerDirectory} from "./explorer-directory";
import {Tab} from "./tab";
import {ContextMenu} from "./context-menu";
import {ActivityBar, ActivityBarItem} from "./activity-bar";
import {ReferencesPanel} from "./references-panel";
import {ViewsPanel} from "./views-panel";
import {SearchPanel} from "./search-panel";
import {ReverseReferenceEntry} from "./reverse-reference-resolver";
import {EditorTable} from "./editor-table";

/**
 * サイドバー
 * アクティビティバー（48px） + サイドバーコンテンツ（252px）の2分割構成
 * ファイルエクスプローラー・VIEWSパネル・REFERENCESパネルを切り替え表示する
 */
export class Sidebar {
    private readonly explorerElement: HTMLElement;
    private readonly activityBar: ActivityBar;
    private readonly filesPanel: HTMLElement;
    private readonly viewsPanel: ViewsPanel;
    private readonly referencesPanel: ReferencesPanel;
    private readonly searchPanel: SearchPanel;
    private readonly directory: ExplorerDirectory;

    constructor(
        explorerElement: HTMLElement,
        tab: Tab,
        contextMenu: ContextMenu,
        openEditorTables: Map<string, EditorTable>
    ) {
        this.explorerElement = explorerElement;
        // アクティビティバー
        this.activityBar = new ActivityBar((item: ActivityBarItem) => {
            this.switchPanel(item);
        });
        this.activityBar.appendTo(explorerElement);

        // サイドバーコンテンツ
        const sidebarContent = document.createElement('div');
        sidebarContent.classList.add('sidebar-content');
        explorerElement.appendChild(sidebarContent);

        // ファイルパネル
        this.filesPanel = document.createElement('div');
        this.filesPanel.classList.add('sidebar-panel', 'sidebar-panel-active');
        const filesPanelHeader = document.createElement('div');
        filesPanelHeader.classList.add('sidebar-panel-header');
        filesPanelHeader.textContent = 'EXPLORER';
        this.filesPanel.appendChild(filesPanelHeader);
        sidebarContent.appendChild(this.filesPanel);

        // VIEWSパネル
        this.viewsPanel = new ViewsPanel(tab, contextMenu);
        this.viewsPanel.appendTo(sidebarContent);

        // REFERENCESパネル
        this.referencesPanel = new ReferencesPanel(tab);
        this.referencesPanel.appendTo(sidebarContent);

        // SEARCHパネル
        this.searchPanel = new SearchPanel(tab, openEditorTables);
        this.searchPanel.appendTo(sidebarContent);

        // ExplorerDirectory をファイルパネル内に構築
        this.directory = new ExplorerDirectory(tab, contextMenu, this.filesPanel, 1);
    }

    /**
     * ファイルを追加する
     */
    appendFile(name: string): void {
        this.directory.appendFile(name, this);
    }

    /**
     * ビューファイルを追加する
     */
    appendViewFile(name: string): void {
        this.viewsPanel.appendViewFile(name);
    }

    /**
     * REFERENCESパネルに逆参照エントリを表示する
     * アクティビティバーをREFERENCESに切り替える
     */
    showReferences(pkValue: string, entries: ReverseReferenceEntry[]): void {
        this.referencesPanel.showEntries(pkValue, entries);
        this.activityBar.activateItem('references');
        this.switchPanel('references');
    }

    /**
     * SEARCHパネルをアクティブにしてフォーカスする
     * Ctrl+Shift+F から呼ばれる
     */
    activateSearchPanel(): void {
        this.activityBar.activateItem('search');
        this.switchPanel('search');
        this.searchPanel.focus();
    }

    private switchPanel(item: ActivityBarItem): void {
        this.filesPanel.classList.remove('sidebar-panel-active');
        this.viewsPanel.hide();
        this.referencesPanel.hide();
        this.searchPanel.hide();

        if (item === 'files') {
            this.filesPanel.classList.add('sidebar-panel-active');
        } else if (item === 'views') {
            this.viewsPanel.show();
        } else if (item === 'references') {
            this.referencesPanel.show();
        } else {
            this.searchPanel.show();
        }
    }

    /** サイドバー幅に応じてエクスプローラー要素の幅を更新する */
    applySidebarWidth(sidebarWidth: number): void {
        this.explorerElement.style.width = sidebarWidth + 'px';
    }

    /** リサイズハンドル要素をサイドバーに追加する */
    appendResizeHandle(handleElement: HTMLElement): void {
        this.explorerElement.appendChild(handleElement);
    }

    /** サイドバーの現在の幅を取得する */
    getWidth(): number {
        return this.explorerElement.getBoundingClientRect().width;
    }
}
