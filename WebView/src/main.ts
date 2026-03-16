import {findFilesAsync, readFileAsync} from "./api";
import {Sidebar} from "./sidebar";
import {Tab} from "./tab";
import {Editor} from "./editor";
import {CommandPalette} from "./command-palette";
import {Toolbar} from "./toolbar";
import {InMemoryTableStore} from "./in-memory-table-store";
import {ReferenceDataCache} from "./reference-data-cache";
import {applyStoredTheme} from "./settings-panel";

(async () => {
    // localStorage に保存されたテーマを即時適用する（body[data-theme] の初期値を上書きする）
    applyStoredTheme();

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

    const tab = new Tab(editor, sidebar, tabContentElement, tabElement, store, referenceDataCache);

    const realSidebar = new Sidebar(
        explorerElement,
        tab,
        editor,
        tab.getOpenEditorTables()
    );
    Object.assign(sidebar, realSidebar);
    Object.setPrototypeOf(sidebar, Sidebar.prototype);

    // ツールバーを初期化（タブへの密結合）
    const toolbarElement = document.getElementById('toolbar')!;
    const toolbar = new Toolbar(toolbarElement, tab);

    // コマンドパレットを初期化（タブへの密結合）
    const commandPalette = new CommandPalette(tab, document.body);

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
        if (e.ctrlKey && e.shiftKey && e.key === 'F') {
            e.preventDefault();
            sidebar.activateSearchPanel();
        }
        if (e.ctrlKey && !e.shiftKey && e.key === 'p') {
            e.preventDefault();
            commandPalette.show();
        }
    });

    // 設定タブの Ctrl+S はキャプチャフェーズで処理する。
    // 設定画面の <select> 要素にフォーカスがある場合、バブリングフェーズでは
    // select 要素がキーボードイベントを消費してしまうため、キャプチャフェーズで先に捕捉する。
    // EditorTable の Ctrl+S は EditorTableHandler 内でバブリングフェーズで処理されるため競合しない。
    document.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.ctrlKey && !e.shiftKey && e.key === 's' && tab.isSettingsTabActive()) {
            e.preventDefault();
            tab.saveSettings();
        }
    }, true);

    // スキーマファイルを読み込み
    // 各スキーマJSONを読み込んでdescriptionを取得し、エクスプローラーに2行表示する
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
    }
})();
