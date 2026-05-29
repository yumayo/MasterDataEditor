import {ExplorerDirectory} from "./explorer-directory";
import {Tab} from "../tabs/tab";
import {ActivityBar, ActivityBarItem} from "./activity-bar";
import {ReferencesPanel} from "../panels/references-panel";
import {SearchPanel} from "../panels/search-panel";
import {BookmarkPanel, BookmarkEntry} from "../panels/bookmark-panel";
import {SourceControlPanel} from "../panels/source-control-panel";
import {TimelinePanel} from "../panels/timeline-panel";
import {ViewPluginPanel} from "../panels/view-plugin-panel";
import type {ViewPluginHost} from "../plugins/view-plugin-host";
import {ReverseReferenceEntry} from "../references/reverse-reference-resolver";
import {EditorTable} from "../editor/editor-table";
import {Editor} from "../editor/editor";
import {MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH} from "../core/constant";
import {ResizeHandle} from "../ui/resize-handle";
import {consumeSuppressedSelfSaveGitRefresh, invalidateGitStatusCache, invalidateGitShowCache, invalidateMasterDataFileCaches, readFileAsync, gitShowAtCommitAsync, LogEntry, type GitStatusResult} from "../app/api";
import type {UiStateStore} from "../app/ui-state";
// Editor は sidebar の applyWidth でのみ使用する（差分ビュー制御は Tab 経由で行う）

/**
 * サイドバー
 * アクティビティバー（48px） + サイドバーコンテンツ（252px）の2分割構成
 * ファイルエクスプローラー・REFERENCESパネル・ブックマークパネルを切り替え表示する
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
    private readonly bookmarkPanel: BookmarkPanel;
    private readonly sourceControlPanel: SourceControlPanel;
    private readonly timelinePanel: TimelinePanel;
    private readonly viewPluginPanel: ViewPluginPanel;
    private readonly directory: ExplorerDirectory;
    private readonly uiStateStore: UiStateStore;
    constructor(
        explorerElement: HTMLElement,
        tab: Tab,
        editor: Editor,
        openEditorTables: Map<string, EditorTable>,
        uiStateStore: UiStateStore,
        viewPluginHost: ViewPluginHost,
    ) {
        this.explorerElement = explorerElement;
        this.tab = tab;
        this.editor = editor;
        this.uiStateStore = uiStateStore;
        const storedUiState = this.uiStateStore.getState();

        // アクティビティバー（歯車ボタンクリックで設定タブを開く）
        this.activityBar = new ActivityBar(
            (item: ActivityBarItem) => { this.switchPanel(item); },
            () => { this.tab.openSettingsTab(); },
            storedUiState.activityBar.order,
            (order: ActivityBarItem[]) => { this.uiStateStore.setActivityBarOrder(order); },
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
        // 「+」ボタン: 新しいテーブルを作成する
        const addTableButton = document.createElement('button');
        addTableButton.classList.add('explorer-add-table-button');
        addTableButton.textContent = '+';
        addTableButton.title = '新しいテーブルを作成';
        addTableButton.addEventListener('click', () => { this.tab.openTableDefinitionTab(); });
        filesPanelHeader.appendChild(addTableButton);
        this.filesPanel.appendChild(filesPanelHeader);
        sidebarContent.appendChild(this.filesPanel);

        // REFERENCESパネル
        this.referencesPanel = new ReferencesPanel(tab);
        this.referencesPanel.appendTo(sidebarContent);

        // SEARCHパネル
        this.searchPanel = new SearchPanel(tab, openEditorTables);
        this.searchPanel.appendTo(sidebarContent);

        // ブックマークパネル
        this.bookmarkPanel = new BookmarkPanel(tab);
        this.bookmarkPanel.appendTo(sidebarContent);

        // Viewプラグインパネル
        this.viewPluginPanel = new ViewPluginPanel(viewPluginHost, (pluginId: string) => {
            this.tab.openViewPluginTab(pluginId);
        }, () => {
            this.tab.reloadViewPluginTabs();
        });
        this.viewPluginPanel.appendTo(sidebarContent);

        // ソース管理パネル（差分タブを開くために Tab への参照が必要）
        this.sourceControlPanel = new SourceControlPanel(tab, this.activityBar);
        this.sourceControlPanel.appendTo(sidebarContent);

        // タイムラインパネル（git logベースのコミット履歴を表示する）
        // エントリクリック時にそのコミット1つ分の差分をDiffTabで表示する
        this.timelinePanel = new TimelinePanel(
            (tableName, entry, prevEntry) => {
                this.openTimelineDiffAsync(tableName, entry, prevEntry)
                    .catch(e => { console.error('タイムライン差分表示失敗', e); });
            }
        );
        this.timelinePanel.appendTo(sidebarContent);

        // ExplorerDirectory をファイルパネル内に構築
        this.directory = new ExplorerDirectory(tab, this.filesPanel, 0);

        const storedSidebarState = storedUiState.sidebar;
        this.applyWidth(storedSidebarState.width);

        // リサイズハンドル: ドラッグ差分を受け取り現在幅にdeltaを加算してクランプし、実際に変化した量を返す
        const resizeHandle = new ResizeHandle('horizontal', (delta: number): number => {
            const currentWidth = this.explorerElement.getBoundingClientRect().width;
            const newWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, currentWidth + delta));
            this.applyWidth(newWidth);
            this.uiStateStore.setSidebarWidth(newWidth);
            // 実際に変化したピクセル数を返す（クランプで動けなかった分はゼロ寄りになる）
            return newWidth - currentWidth;
        });
        resizeHandle.appendTo(explorerElement);

        this.activityBar.activateItem(storedSidebarState.activePanel);
        this.switchPanel(storedSidebarState.activePanel);

        // C# FileSystemWatcher / GitWatcher からのプッシュ通知を受信してバッジとパネルを更新する
        window.chrome.webview.addEventListener('message', (event: MessageEvent) => {
            if (typeof event.data !== 'string') return;
            let data: { type: string; filename?: string; filenames?: string[] };
            try {
                data = JSON.parse(event.data) as { type: string };
            } catch {
                return;
            }
            if (data.type !== 'file_changed' && data.type !== 'git_changed') return;
            let skipGitRefresh = false;
            if (data.type === 'file_changed') {
                const filenames = Array.isArray(data.filenames)
                    ? data.filenames
                    : (typeof data.filename === 'string' ? [data.filename] : undefined);
                skipGitRefresh = consumeSuppressedSelfSaveGitRefresh(filenames);
                if (!skipGitRefresh) {
                    invalidateMasterDataFileCaches();
                    this.tab.notifyExternalFileChanged(filenames);
                }
            }
            if (skipGitRefresh) return;
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

    async refreshSourceControlAsync(statusResult?: GitStatusResult): Promise<void> {
        await this.sourceControlPanel.refreshAsync(statusResult);
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
     * 指定Viewプラグインをアクティブ（ハイライト）状態にする
     * 他のViewプラグインのハイライトは解除する
     */
    highlightViewPlugin(pluginId: string): void {
        this.viewPluginPanel.setActivePlugin(pluginId);
    }

    /**
     * 全Viewプラグイン項目のハイライトを解除する
     */
    clearViewPluginHighlight(): void {
        this.viewPluginPanel.clearActivePlugin();
    }

    /**
     * REFERENCESパネルに逆参照エントリを表示する
     * アクティビティバーをREFERENCESに切り替える
     */
    showReferences(pkValue: string, entries: ReverseReferenceEntry[]): void {
        this.referencesPanel.showEntries(pkValue, entries);
        this.activityBar.activateItem('references');
        this.uiStateStore.setActiveActivityBarItem('references');
        this.switchPanel('references');
    }

    /**
     * SEARCHパネルをアクティブにしてフォーカスする
     * Ctrl+Shift+F から呼ばれる（検索のみモード）
     */
    activateSearchPanel(): void {
        this.activityBar.activateItem('search');
        this.uiStateStore.setActiveActivityBarItem('search');
        this.switchPanel('search');
        this.searchPanel.hideReplaceMode();
        this.searchPanel.focus();
    }

    /**
     * SEARCHパネルを置換モードで起動する
     * Ctrl+H から呼ばれる
     */
    activateSearchPanelWithReplace(): void {
        this.activityBar.activateItem('search');
        this.uiStateStore.setActiveActivityBarItem('search');
        this.switchPanel('search');
        this.searchPanel.showReplaceMode();
        this.searchPanel.focus();
    }

    // =========================================================================
    // ブックマーク操作（EditorTable のコンテキストメニューから呼ばれる）
    // =========================================================================

    /**
     * セルレベルでブックマークを追加する
     */
    addBookmark(tableName: string, pkValue: string, columnName: string, label: string): void {
        this.bookmarkPanel.addBookmark(tableName, pkValue, columnName, label);
    }

    /**
     * セルレベルでブックマークを削除する
     */
    removeBookmark(tableName: string, pkValue: string, columnName: string): void {
        this.bookmarkPanel.removeBookmark(tableName, pkValue, columnName);
    }

    /**
     * 指定テーブル名+PK値+列名のブックマークが存在するか確認する
     */
    hasBookmark(tableName: string, pkValue: string, columnName: string): boolean {
        return this.bookmarkPanel.hasBookmark(tableName, pkValue, columnName);
    }

    /**
     * 指定テーブル名+PK値で（列名問わず）ブックマークが1件以上存在するか確認する
     * PK列の右クリック時に使用する
     */
    hasBookmarkForRow(tableName: string, pkValue: string): boolean {
        return this.bookmarkPanel.hasBookmarkForRow(tableName, pkValue);
    }

    /**
     * 指定テーブル名+PK値の全ブックマークを削除する（行レベル一括削除）
     * PK列右クリックの「ブックマークを解除」で使用する
     */
    removeBookmarksForRow(tableName: string, pkValue: string): void {
        this.bookmarkPanel.removeBookmarksForRow(tableName, pkValue);
    }

    /**
     * ブックマーク一覧を取得する（コマンドパレット用）
     */
    getBookmarks(): BookmarkEntry[] {
        return this.bookmarkPanel.serializeBookmarks();
    }

    /**
     * 指定テーブルのブックマーク一覧を取得する（EditorTable の表示マーク復元用）
     */
    getBookmarksForTable(tableName: string): BookmarkEntry[] {
        return this.bookmarkPanel.getBookmarksForTable(tableName);
    }

    /**
     * ブックマークを復元する（起動時読み込み用）
     */
    restoreBookmarks(entries: BookmarkEntry[]): void {
        this.bookmarkPanel.restoreBookmarks(entries);
        this.tab.getOpenEditorTables().forEach((editorTable) => {
            editorTable.reapplyBookmarkMarks();
        });
    }

    /**
     * 通常テーブルタブの切り替え時に、表示中サイドバーパネルを同期する
     */
    notifyActiveTableChanged(tableName: string): void {
        if (!this.timelinePanel.isVisible()) return;
        this.timelinePanel.loadLogAsync(tableName).catch(e => { console.error('タイムラインログ取得失敗', e); });
    }

    /**
     * タイムラインエントリクリック時に、そのコミット1つ分の差分をDiffTabで表示する。
     * 左ペイン: そのファイルの1つ前のコミット時点のCSV、右ペイン: 選択コミット時点のCSV
     * prevEntry はファイル履歴上の1つ前のコミット（初回コミットの場合はnull）
     */
    private async openTimelineDiffAsync(tableName: string, entry: LogEntry, prevEntry: LogEntry | null): Promise<void> {
        const path = 'data/' + tableName + '.csv';
        const shortHash = entry.commitHash.substring(0, 7);
        // 前のコミットが存在する場合はそのCSVも取得、なければ空文字（ファイル新規追加）
        const fetches: [Promise<string>, Promise<string>, Promise<string>] = prevEntry !== null
            ? [readFileAsync('schema/' + tableName + '.json'), gitShowAtCommitAsync(prevEntry.commitHash, path), gitShowAtCommitAsync(entry.commitHash, path)]
            : [readFileAsync('schema/' + tableName + '.json'), Promise.resolve(''), gitShowAtCommitAsync(entry.commitHash, path)];
        const [schemaJson, prevCsv, commitCsv] = await Promise.all(fetches);
        // isStaged=true で両ペイン読み取り専用にする（過去コミットとの比較は編集不要）
        const leftLabel = prevEntry !== null
            ? tableName + ' (' + prevEntry.commitHash.substring(0, 7) + ' ' + prevEntry.message + ')'
            : tableName + ' (初回コミット)';
        const rightLabel = tableName + ' (' + shortHash + ' ' + entry.message + ')';
        this.tab.openDiffTab(tableName, true, schemaJson, prevCsv, commitCsv, path, leftLabel, rightLabel);
    }

    private switchPanel(item: ActivityBarItem): void {
        this.uiStateStore.setActiveActivityBarItem(item);

        this.filesPanel.classList.remove('sidebar-panel-active');
        this.referencesPanel.hide();
        this.searchPanel.hide();
        this.bookmarkPanel.hide();
        this.viewPluginPanel.hide();
        this.sourceControlPanel.hide();
        this.timelinePanel.hide();

        // history はソース管理と同様に差分タブを閉じない（closeAllDiffTabs の除外対象）
        if (item === 'sourceControl') {
            this.sourceControlPanel.show();
            return;
        }

        if (item === 'history') {
            this.timelinePanel.show();
            // アクティブテーブルの git log を読み込む
            const activeTabName = this.tab.getActiveTabName();
            if (activeTabName !== false) {
                this.notifyActiveTableChanged(activeTabName);
            }
            return;
        }

        // ソース管理・履歴以外に切り替えた場合は全差分タブを閉じる
        this.tab.closeAllDiffTabs();

        if (item === 'files') {
            this.filesPanel.classList.add('sidebar-panel-active');
        } else if (item === 'references') {
            this.referencesPanel.show();
        } else if (item === 'search') {
            this.searchPanel.show();
        } else if (item === 'bookmarks') {
            this.bookmarkPanel.show();
        } else if (item === 'views') {
            this.viewPluginPanel.show();
        }
    }

    /** 指定幅をサイドバー・タブ・エディターに一括適用する */
    private applyWidth(width: number): void {
        this.explorerElement.style.width = width + 'px';
        this.tab.applySidebarWidth(width);
        this.editor.applySidebarWidth(width);
    }
}
