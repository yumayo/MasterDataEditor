import {findFilesAsync} from "./api";
import {Sidebar} from "./sidebar";
import {Tab} from "./tab";
import {Editor} from "./editor";
import {ContextMenu} from "./context-menu";
import {CommandPalette} from "./command-palette";
import {InMemoryTableStore} from "./in-memory-table-store";
import {ReferenceDataCache} from "./reference-data-cache";

(async () => {
    // DOM要素を先頭で一括取得する
    const explorerElement = document.getElementById('explorer')!;
    const tabElement = document.getElementById('tab')!;
    const tabContentElement = document.getElementById('tab-content')!;
    const editorElement = document.getElementById('editor')!;

    const editor = new Editor(editorElement);
    const contextMenu = new ContextMenu();

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
        contextMenu,
        tab.getOpenEditorTables()
    );
    Object.assign(sidebar, realSidebar);
    Object.setPrototypeOf(sidebar, Sidebar.prototype);

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

    // スキーマファイルを読み込み
    const files = await findFilesAsync("schema");
    for (let i = 0; i < files.length; ++i) {
        const file = files[i];
        const tableName = file.name.split('.').slice(0, -1).join('.');
        sidebar.appendFile(tableName);
        commandPalette.registerTable(tableName);
    }

    // ビューファイルを読み込み
    try {
        const viewFiles = await findFilesAsync("view");
        for (let i = 0; i < viewFiles.length; ++i) {
            const file = viewFiles[i];
            if (file.type !== 'file') continue;
            const viewName = file.name.split('.').slice(0, -1).join('.');
            sidebar.appendViewFile(viewName);
            commandPalette.registerView(viewName);
        }
    } catch {
        // viewディレクトリが存在しない場合は無視
    }
})();
