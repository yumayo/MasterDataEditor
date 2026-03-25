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
import {ResizeHandle} from "./resize-handle";
import {invalidateGitStatusCache, invalidateGitShowCache} from "./api";
// Editor は sidebar の applyWidth でのみ使用する（差分ビュー制御は Tab 経由で行う）

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

        // ソース管理パネル（差分タブを開くために Tab への参照が必要）
        this.sourceControlPanel = new SourceControlPanel(tab, this.activityBar);
        this.sourceControlPanel.appendTo(sidebarContent);

        // ExplorerDirectory をファイルパネル内に構築
        this.directory = new ExplorerDirectory(tab, this.filesPanel, 0);

        // 初期幅を適用
        this.applyWidth(DEFAULT_SIDEBAR_WIDTH);

        // リサイズハンドル: ドラッグ差分を受け取り現在幅にdeltaを加算してクランプし、実際に変化した量を返す
        const resizeHandle = new ResizeHandle('horizontal', (delta: number): number => {
            const currentWidth = this.explorerElement.getBoundingClientRect().width;
            const newWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, currentWidth + delta));
            this.applyWidth(newWidth);
            // 実際に変化したピクセル数を返す（クランプで動けなかった分はゼロ寄りになる）
            return newWidth - currentWidth;
        });
        resizeHandle.appendTo(explorerElement);

        // C# FileSystemWatcher / GitWatcher からのプッシュ通知を受信してバッジとパネルを更新する
        window.chrome.webview.addEventListener('message', (event: MessageEvent) => {
            if (typeof event.data !== 'string') return;
            let data: { type: string };
            try {
                data = JSON.parse(event.data) as { type: string };
            } catch {
                return;
            }
            if (data.type !== 'file_changed' && data.type !== 'git_changed') return;
            invalidateGitStatusCache();
            invalidateGitShowCache();
            this.sourceControlPanel.refreshAsync().catch(e => { console.error('バッジ更新失敗', e); });
            // git操作によりHEADやステージが変わるため、通常テーブルのgit差分ハイライトを再計算する
            if (data.type === 'git_changed') {
                this.refreshAllGitDiffAsync().catch(e => { console.error('git差分ハイライト更新失敗', e); });
            }
        });

        // ウィンドウフォーカス時にバッジを更新する（外部ツールでのgitコミット後の反映）
        window.addEventListener('focus', () => {
            this.sourceControlPanel.refreshAsync().catch(e => { console.error('フォーカス時バッジ更新失敗', e); });
        });

        // 初回起動時にバッジを表示する（gitリポジトリ外の場合はエラーになるためスキップする）
        this.sourceControlPanel.refreshAsync().catch(e => { console.warn('初回バッジ取得をスキップ', e); });
    }

    /**
     * 開いている全通常テーブルのgit差分ハイライトを再計算する
     * コミット検知時にHEADが変わるため、全テーブルの差分状態を最新にする
     */
    private async refreshAllGitDiffAsync(): Promise<void> {
        const editorTables = this.tab.getOpenEditorTables();
        const promises: Promise<void>[] = [];
        editorTables.forEach(editorTable => {
            promises.push(editorTable.refreshGitDiffAsync());
        });
        await Promise.all(promises);
    }

    /**
     * ファイルを追加する
     */
    appendFile(name: string, description: string | null): void {
        this.directory.appendFile(name, description);
    }

    /**
     * 指定テーブル名のエクスプローラーファイルノードをアクティブ（ハイライト）状態にする
     * 他のファイルノードのハイライトは解除する
     */
    highlightExplorerFile(name: string): void {
        this.directory.highlightFile(name);
    }

    /**
     * 全エクスプローラーファイルノードのハイライトを解除する
     */
    clearExplorerHighlight(): void {
        this.directory.clearHighlight();
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
            // 差分タブはソース管理パネル内のクリックで開くため、ここでは操作しない
            this.sourceControlPanel.show();
            return;
        }

        // ソース管理以外に切り替えた場合は全差分タブを閉じる
        this.tab.closeAllDiffTabs();

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
