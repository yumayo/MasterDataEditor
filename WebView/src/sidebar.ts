import {ExplorerDirectory} from "./explorer-directory";
import {Tab} from "./tab";
import {ContextMenu} from "./context-menu";
import {ActivityBar, ActivityBarItem} from "./activity-bar";
import {ReferencesPanel} from "./references-panel";
import {ReverseReferenceEntry} from "./reverse-reference-resolver";

/**
 * サイドバー
 * アクティビティバー（48px） + サイドバーコンテンツ（252px）の2分割構成
 * ファイルエクスプローラーとREFERENCESパネルを切り替え表示する
 */
export class Sidebar {
    private readonly activityBar: ActivityBar;
    private readonly filesPanel: HTMLElement;
    private readonly referencesPanel: ReferencesPanel;
    private readonly directory: ExplorerDirectory;

    constructor(
        explorerElement: HTMLElement,
        tab: Tab,
        contextMenu: ContextMenu
    ) {
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
        sidebarContent.appendChild(this.filesPanel);

        // REFERENCESパネル
        this.referencesPanel = new ReferencesPanel(tab);
        this.referencesPanel.appendTo(sidebarContent);

        // ExplorerDirectory をファイルパネル内に構築
        this.directory = new ExplorerDirectory(
            tab, contextMenu, this.filesPanel, 1
        );
    }

    /**
     * ファイルを追加する
     */
    appendFile(name: string): void {
        this.directory.appendFile(name);
    }

    /**
     * ディレクトリを追加する
     */
    appendDirectory(name: string): ExplorerDirectory {
        return this.directory.appendDirectory(name);
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
     * パネルを切り替える
     */
    private switchPanel(item: ActivityBarItem): void {
        if (item === 'files') {
            this.filesPanel.classList.add('sidebar-panel-active');
            this.referencesPanel.hide();
        } else {
            this.filesPanel.classList.remove('sidebar-panel-active');
            this.referencesPanel.show();
        }
    }
}
