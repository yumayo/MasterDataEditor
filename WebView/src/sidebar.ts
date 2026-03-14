import {ExplorerDirectory} from "./explorer-directory";
import {Tab} from "./tab";
import {ActivityBar, ActivityBarItem} from "./activity-bar";
import {ReferencesPanel} from "./references-panel";
import {SearchPanel} from "./search-panel";
import {SourceControlPanel} from "./source-control-panel";
import {ReverseReferenceEntry} from "./reverse-reference-resolver";
import {EditorTable} from "./editor-table";
import {Editor} from "./editor";
import {DEFAULT_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH} from "./constant";

/**
 * サイドバー
 * アクティビティバー（48px） + サイドバーコンテンツ（252px）の2分割構成
 * ファイルエクスプローラー・REFERENCESパネルを切り替え表示する
 * 右端のドラッグハンドルでリサイズ可能
 */
export class Sidebar {
    private readonly explorerElement: HTMLElement;
    private readonly tab: Tab;
    private readonly editor: Editor;
    private readonly activityBar: ActivityBar;
    private readonly filesPanel: HTMLElement;
    private readonly referencesPanel: ReferencesPanel;
    private readonly searchPanel: SearchPanel;
    private readonly sourceControlPanel: SourceControlPanel;
    private readonly directory: ExplorerDirectory;
    private isDragging: boolean = false;
    private dragStartX: number = 0;
    private dragStartWidth: number = 0;
    private dragStartCursor: string = '';

    constructor(
        explorerElement: HTMLElement,
        tab: Tab,
        editor: Editor,
        openEditorTables: Map<string, EditorTable>
    ) {
        this.explorerElement = explorerElement;
        this.tab = tab;
        this.editor = editor;

        // アクティビティバー（歯車ボタンクリックで設定タブを開く）
        this.activityBar = new ActivityBar(
            (item: ActivityBarItem) => { this.switchPanel(item); },
            () => { this.tab.openSettingsTab(); }
        );
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

        // REFERENCESパネル
        this.referencesPanel = new ReferencesPanel(tab);
        this.referencesPanel.appendTo(sidebarContent);

        // SEARCHパネル
        this.searchPanel = new SearchPanel(tab, openEditorTables);
        this.searchPanel.appendTo(sidebarContent);

        // ソース管理パネル
        this.sourceControlPanel = new SourceControlPanel(editor);
        this.sourceControlPanel.appendTo(sidebarContent);

        // ExplorerDirectory をファイルパネル内に構築
        this.directory = new ExplorerDirectory(tab, this.filesPanel, 1);

        // リサイズハンドルを作成しサイドバーに追加
        const handleElement = document.createElement('div');
        handleElement.classList.add('sidebar-resize-handle');
        explorerElement.appendChild(handleElement);

        // 初期幅を適用
        this.applyWidth(DEFAULT_SIDEBAR_WIDTH);

        // ドラッグ開始
        handleElement.addEventListener('mousedown', (e: MouseEvent) => {
            e.preventDefault();
            this.isDragging = true;
            this.dragStartX = e.clientX;
            this.dragStartWidth = this.explorerElement.getBoundingClientRect().width;
            this.dragStartCursor = document.body.style.cursor;
            document.body.style.cursor = 'col-resize';
        });

        // ドラッグ中の幅更新
        window.addEventListener('mousemove', (e: MouseEvent) => {
            if (!this.isDragging) return;
            const deltaX = e.clientX - this.dragStartX;
            const newWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, this.dragStartWidth + deltaX));
            this.applyWidth(newWidth);
        });

        // ドラッグ終了
        window.addEventListener('mouseup', () => {
            if (!this.isDragging) return;
            this.isDragging = false;
            document.body.style.cursor = this.dragStartCursor;
        });
    }

    /**
     * ファイルを追加する
     */
    appendFile(name: string): void {
        this.directory.appendFile(name);
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
        this.referencesPanel.hide();
        this.searchPanel.hide();
        this.sourceControlPanel.hide();

        if (item === 'sourceControl') {
            // 差分ビューはソース管理パネル内のクリックで開くため、ここでは操作しない
            this.sourceControlPanel.show();
            return;
        }

        // ソース管理以外に切り替えた場合は差分ビューを閉じてエディターを通常状態に戻す
        this.editor.hideDiffView();

        if (item === 'files') {
            this.filesPanel.classList.add('sidebar-panel-active');
        } else if (item === 'references') {
            this.referencesPanel.show();
        } else {
            // search
            this.searchPanel.show();
        }
    }

    /** 指定幅をサイドバー・タブ・エディターに一括適用する */
    private applyWidth(width: number): void {
        this.explorerElement.style.width = width + 'px';
        this.tab.applySidebarWidth(width);
        this.editor.applySidebarWidth(width);
    }
}
