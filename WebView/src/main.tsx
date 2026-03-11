import {createRoot} from 'react-dom/client';
import {App} from './App';
import {findFilesAsync} from "./api";
import {Sidebar} from "./sidebar";
import {Tab} from "./tab";
import {Editor} from "./editor";
import {CommandPalette} from "./command-palette";
import {Toolbar} from "./toolbar";
import {InMemoryTableStore} from "./in-memory-table-store";
import {ReferenceDataCache} from "./reference-data-cache";
import {EditorTable} from "./editor-table";

// テスト用グローバル変数: Playwright から activeEditorTable にアクセスするためのブリッジ
// Phase 10 で Zustand store 経由のアクセスに置き換え、この定義を削除する
declare global {
    interface Window {
        editor: {
            readonly activeEditorTable: EditorTable | false;
        };
    }
}

// React マウント
const rootElement = document.getElementById('root');
if (rootElement === null) {
    throw new Error('React mount point <div id="root"> が見つかりません。index.htmlを確認してください。');
}
createRoot(rootElement).render(<App />);

// Vanilla 初期化コード（main.ts から移植）
// Phase 10 で完全React化が完了した時点でこの IIFE を削除する。
// React render は非同期的にDOMをマウントするが、現時点では <div id="root"> 内にしか
// レンダリングしないため、以下の Vanilla DOM操作との競合は発生しない。
// Phase 3以降で Vanilla DOM要素を React管理下に移す際は、対応する getElementById() を削除すること。
(async () => {
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

    window.editor = {
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
})();
