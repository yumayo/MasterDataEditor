import {findFilesAsync} from "./api";
import {Sidebar} from "./sidebar";
import {Tab} from "./tab";
import {Editor} from "./editor";
import {ContextMenu} from "./context-menu";
import {SidebarResizer} from "./sidebar-resizer";

(async () => {
    // DOM要素を先頭で一括取得する
    const explorerElement = document.getElementById('explorer')!;
    const tabElement = document.getElementById('tab')!;
    const tabContentElement = document.getElementById('tab-content')!;
    const editorElement = document.getElementById('editor')!;

    const editor = new Editor(editorElement);
    const contextMenu = new ContextMenu(editorElement);

    // Tab → Sidebar の循環依存を Object.assign パターンで解決する
    const sidebar = {} as Sidebar;

    const tab = new Tab(editor, sidebar, tabContentElement, tabElement);

    const realSidebar = new Sidebar(
        explorerElement,
        tab,
        contextMenu,
        tab.getOpenEditorTables()
    );
    Object.assign(sidebar, realSidebar);
    Object.setPrototypeOf(sidebar, Sidebar.prototype);

    // サイドバーリサイズ機能を初期化（Sidebar実体化後に生成）
    new SidebarResizer(sidebar, tab, editor);

    // Ctrl+Shift+F で検索パネルをアクティブにする
    document.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.ctrlKey && e.shiftKey && e.key === 'F') {
            e.preventDefault();
            sidebar.activateSearchPanel();
        }
    });

    // スキーマファイルを読み込み
    const files = await findFilesAsync("schema");
    for (let i = 0; i < files.length; ++i) {
        const file = files[i];
        const tableName = file.name.split('.').slice(0, -1).join('.');
        sidebar.appendFile(tableName);
    }

    // ビューファイルを読み込み
    try {
        const viewFiles = await findFilesAsync("view");
        for (let i = 0; i < viewFiles.length; ++i) {
            const file = viewFiles[i];
            if (file.type !== 'file') continue;
            const viewName = file.name.split('.').slice(0, -1).join('.');
            sidebar.appendViewFile(viewName);
        }
    } catch {
        // viewディレクトリが存在しない場合は無視
    }
})();
