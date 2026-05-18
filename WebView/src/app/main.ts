import {findFilesAsync, readFileAsync, configureBackgroundTracker, preloadAllFilesAsync, invalidateFileCacheEntry} from "./api";

// テスト用: ファイルキャッシュの特定エントリを無効化する関数をグローバルに公開する
(window as unknown as { __invalidateFileCacheEntry: (filename: string) => void }).__invalidateFileCacheEntry = invalidateFileCacheEntry;
import {Sidebar} from "../sidebar/sidebar";
import {Tab} from "../tabs/tab";
import {Editor} from "../editor/editor";
import {CommandPalette} from "../ui/command-palette";
import {Toolbar} from "../ui/toolbar";
import {InMemoryTableStore} from "../data/in-memory-table-store";
import {ReferenceDataCache} from "../references/reference-data-cache";
import {applyStoredSettingsAsync, EXPORT_VALIDATION_SETTINGS_CHANGED_EVENT, getAppliedExportValidationSettings, type ExportValidationSettings} from "../panels/settings-panel";
import {NotificationToast} from "../ui/notification";
import {ValidationEngine, createValidationTableSchemaFromJson, type TableSchema} from "../validation/validation-engine";
import {ValidationPanel} from "../panels/validation-panel";
import {PluginValidationRunner} from "../validation/plugin-validation-runner";
import {bindStatusBarActions, createStatusBarActions, StatusBar} from "../ui/status-bar";
import {BackgroundTaskTracker} from "./background-task-tracker";
import {DebugConsole} from "../panels/debug-console";
import {BottomPanel} from "../panels/bottom-panel";
import {EditorApiImpl} from "../editor-api/editor-api";
import {EditorApiBridge} from "../editor-api/editor-api-bridge";
import {ErrorTooltip} from "../ui/error-tooltip";
import {createSchemaEntryFromJson, type SchemaEntry} from "../editor-api/editor-api-types";
import type {BookmarkEntry} from "../panels/bookmark-panel";
import {BOOKMARKS_FILE, BOOKMARKS_FILE_OPTIONS} from "../config/masterdataeditor-path";
import {readStoredUiStateAsync, UiStateStore} from "./ui-state";
import {ViewPluginHost} from "../plugins/view-plugin-host";

(async () => {
    // ステータスバーは起動直後から予約領域を実体として描画する。
    // BottomPanel 操作用の action port は後段で Object.assign して実装する。
    const debugConsole = new DebugConsole();
    const notification = new NotificationToast(debugConsole);
    const statusBarActions = createStatusBarActions();
    const statusBar = new StatusBar(statusBarActions, notification);
    statusBar.appendTo(document.body);
    // テスト用: window.notification を公開する（e2eテストから window.notification.show() で呼び出す）
    (window as unknown as Record<string, unknown>)['notification'] = notification;

    // 保存済み設定を起動直後に適用する（body[data-theme] やタブ折り返しの初期値を上書きする）
    await applyStoredSettingsAsync();
    const storedUiState = await readStoredUiStateAsync();
    const uiStateStore = new UiStateStore(storedUiState);

    // preload 前に DEBUG CONSOLE 追跡基盤を構築する。
    // 設定ファイル未作成時の read_file 失敗は通常状態なので、設定/UI状態読み込み後に追跡を開始する。
    const backgroundTaskTracker = new BackgroundTaskTracker(statusBar, debugConsole);
    configureBackgroundTracker(backgroundTaskTracker);

    // 起動時に schema/ と data/ 以下の全ファイルをキャッシュにバックグラウンドで読み込む。
    // awaitしない: UI初期化を先に進め、schema ループ開始前に完了を待つ。
    // readFileAsync / findFilesAsync はキャッシュミス時にC#へ個別問い合わせするため機能的に問題ない。
    const preloading = preloadAllFilesAsync();

    // DOM要素を先頭で一括取得する
    const explorerElement = document.getElementById('explorer')!;
    const tabElement = document.getElementById('tab')!;
    const tabContentElement = document.getElementById('tab-content')!;
    const editorElement = document.getElementById('editor')!;

    const editor = new Editor(editorElement);

    // テーブルデータの中央ストア（アプリケーション全体で1つ）
    const store = new InMemoryTableStore();

    // 参照データキャッシュ（アプリケーション全体で1つ、中央ストア経由でインメモリデータを取得する）
    const referenceDataCache = new ReferenceDataCache(store);

    // Tab → Sidebar の循環依存を Object.assign パターンで解決する
    const sidebar = {} as Sidebar;

    const tab = new Tab(editor, sidebar, tabContentElement, tabElement, store, referenceDataCache, notification, uiStateStore);
    debugConsole.connectDetailOpenHandler((detail) => {
        tab.openDebugApiDetailTab(detail);
    });

    // schemaRegistry は Map 参照を EditorApiImpl に渡すだけなので、中身が空でも先に構築できる。
    // schema ループで後から set() すれば同じインスタンスを参照している EditorApiImpl に自然と反映される。
    const schemaRegistry = new Map<string, SchemaEntry>();
    const validationSchemas = new Map<string, TableSchema>();

    const validationEngine = new ValidationEngine(store, referenceDataCache);
    validationEngine.setExportValidationSettings(getAppliedExportValidationSettings());
    const pluginValidationRunner = new PluginValidationRunner(store);

    // EditorAPI を構築して window.editorApi として公開する。
    // ViewプラグインにもこのAPIを渡すため、Sidebar構築前に用意する。
    const editorApi = new EditorApiImpl(store, tab, schemaRegistry, validationEngine, pluginValidationRunner);
    tab.connectEditorApi(editorApi);
    (window as unknown as Record<string, unknown>)['editorApi'] = editorApi;

    const viewPluginHost = new ViewPluginHost(editorApi, notification);
    tab.connectViewPluginHost(viewPluginHost);

    const realSidebar = new Sidebar(
        explorerElement,
        tab,
        editor,
        tab.getOpenEditorTables(),
        uiStateStore,
        viewPluginHost,
    );
    Object.assign(sidebar, realSidebar);
    Object.setPrototypeOf(sidebar, Sidebar.prototype);

    // 起動直後に bookmarks.json からブックマークを復元する。
    // schema 読み込み完了を待つ必要はなく、先に復元しておくことで初回テーブル表示時の視覚マーク適用を安定させる。
    try {
        const bookmarksJson = await readFileAsync(BOOKMARKS_FILE, BOOKMARKS_FILE_OPTIONS);
        const bookmarkEntries = JSON.parse(bookmarksJson) as BookmarkEntry[];
        sidebar.restoreBookmarks(bookmarkEntries);
    } catch {
        // ファイルが存在しない場合は無視する
    }

    // ツールバーを初期化（タブ・エディタへの密結合。コンストラクタ内でDOMイベントをバインドするため変数保持不要）
    new Toolbar(document.getElementById('toolbar')!, tab, editor);

    // コマンドパレットを初期化（タブへの密結合、クエリ式検索でストアデータを参照するため openEditorTables を渡す）
    const commandPalette = new CommandPalette(tab, document.body, tab.getOpenEditorTables());

    // StatusBar は起動直後にDOMだけ先行描画済み。
    // ここで PROBLEMS パネル操作に必要な BottomPanel を接続する。
    const validationPanel = new ValidationPanel(validationEngine, tab, statusBar, store, debugConsole, pluginValidationRunner);
    const bottomPanel = new BottomPanel(validationPanel, debugConsole, uiStateStore);
    bindStatusBarActions(statusBarActions, bottomPanel);

    window.addEventListener(EXPORT_VALIDATION_SETTINGS_CHANGED_EVENT, (event: Event) => {
        const value = (event as CustomEvent<ExportValidationSettings>).detail;
        validationEngine.setExportValidationSettings(value);
        validationPanel.runAndUpdate();
    });

    tab.connectValidationPanel(validationPanel);
    // エラーツールチップを生成して Tab に接続する（全 EditorTable で共有するシングルトン）
    const errorTooltip = new ErrorTooltip(validationPanel);
    tab.connectErrorTooltip(errorTooltip);
    // ボトムパネル（PROBLEMS / DEBUG CONSOLE）を editor 下段に配置する
    editor.appendBottomPanel(bottomPanel);

    // テスト用: window.editorを公開（activeEditorTableへのアクセスを提供）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).editor = {
        get activeEditorTable() {
            const state = tab.getActiveTabState();
            if (!state) return false;
            return state.editorTable;
        },
    };

    // グローバルキーボードショートカットを登録
    document.addEventListener('keydown', (e: KeyboardEvent) => {
        const key = e.key.toLowerCase();
        if (e.ctrlKey && e.shiftKey && key === 'f') {
            e.preventDefault();
            sidebar.activateSearchPanel();
        }
        if (e.ctrlKey && !e.shiftKey && key === 'h') {
            e.preventDefault();
            sidebar.activateSearchPanelWithReplace();
        }
        if (e.ctrlKey && !e.shiftKey && key === 'p') {
            e.preventDefault();
            commandPalette.show();
        }
    });

    // グローバル Ctrl+S をキャプチャフェーズで処理する。
    // EditorTable 内にフォーカスがある場合は EditorTableHandler のバブリングハンドラに任せ、
    // それ以外（設定タブ、サイドバー、検索パネル等）はここで処理する。
    document.addEventListener('keydown', (e: KeyboardEvent) => {
        const key = e.key.toLowerCase();
        if (e.ctrlKey && !e.shiftKey && key === 's') {
            const target = e.target as HTMLElement;
            // EditorTable 内にフォーカスがある場合は既存ハンドラに委ねる
            if (target.closest('.editor-table')) return;
            e.preventDefault();
            if (tab.isSettingsTabActive()) {
                tab.saveSettings();
            } else {
                tab.saveActiveTable();
            }
        }
    }, true);

    // C# ↔ WebView ブリッジを構築する（コンストラクタでリスナー登録完了）
    const bridge = new EditorApiBridge(editorApi, debugConsole);

    // テスト用: window.__editorApiBridge を公開する（e2eテストから dispose を呼び出す）
    (window as unknown as { __editorApiBridge: EditorApiBridge })['__editorApiBridge'] = bridge;

    // 保存済みタブは、schema 一覧や全ファイル preload の完了を待たずにまずタブバーへ復元する。
    // restoreTabsFromUiStateAsync は非アクティブタブの中身を作らず、アクティブタブだけを読み込む。
    // Viewプラグインがアクティブだった場合は、プラグイン読み込み後に表示を再開する。
    await tab.restoreTabsFromUiStateAsync(storedUiState.tabs);

    // バックグラウンド preload の完了を待つ（並列読み込みがUI初期化中に進行している）
    await preloading;

    // スキーマファイルを読み込み
    // 各スキーマJSONを読み込んでdescriptionを取得し、エクスプローラーに2行表示する
    // 同時に schemaRegistry を構築する（EditorAPI.schema の情報源となる）
    const files = await findFilesAsync("schema");
    for (let i = 0; i < files.length; ++i) {
        const file = files[i];
        const tableName = file.name.split('.').slice(0, -1).join('.');
        const schemaText = await readFileAsync("schema/" + file.name);
        let schemaJson: Record<string, unknown>;
        try {
            schemaJson = JSON.parse(schemaText) as Record<string, unknown>;
        } catch (e) {
            throw new Error(`[main] スキーマファイル schema/${file.name} のJSON解析に失敗: ${e}`);
        }
        const descriptionRaw = schemaJson['description'];
        const description: string | null = typeof descriptionRaw === 'string' && descriptionRaw.length > 0 ? descriptionRaw : null;
        sidebar.appendFile(tableName, description);
        commandPalette.registerTable(tableName, description);

        // スキーマJSONから SchemaEntry を構築して schemaRegistry に登録する
        schemaRegistry.set(tableName, createSchemaEntryFromJson(schemaJson));
        validationSchemas.set(tableName, createValidationTableSchemaFromJson(schemaJson));
        referenceDataCache.registerSchema(tableName, schemaJson);
        tab.registerSchemaForReverseReferences(tableName, schemaJson);
    }
    referenceDataCache.markSchemaIndexComplete();
    tab.markReverseReferenceSchemaIndexComplete();

    await viewPluginHost.loadPluginsAsync();
    tab.restorePendingViewPluginTabFromUiState();

    const activeTabName = tab.getActiveTabName();
    if (activeTabName !== false) {
        sidebar.highlightExplorerFile(activeTabName);
    }

    // 起動時に全テーブルのバリデーションをバックグラウンドで実行する。
    // 全CSVをストアにロード（refCount=1で常駐）し、スキーマを登録して一括検証する。
    // refCountを維持することで、タブ未オープンのテーブルも継続的にバリデーション対象に含める。
    (async () => {
        for (const [tableName, validationSchema] of validationSchemas) {
            try {
                await store.registerTableAsync(tableName);
                validationPanel.registerSchema(tableName, validationSchema.primaryKeyColumns, validationSchema.columns);
            } catch (e: unknown) {
                console.error('[main] 起動時バリデーションスキャン: テーブル "' + tableName + '" のロードに失敗:', String(e));
            }
        }
        validationPanel.runAndUpdate();
    })().catch((e: unknown) => {
        console.error('[main] 起動時バリデーションスキャン失敗:', String(e));
    });
})();
