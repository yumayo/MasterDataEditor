import {findFilesAsync} from "./api";
import {Sidebar} from "./sidebar";
import {Tab} from "./tab";
import {Editor} from "./editor";
import {ContextMenu} from "./context-menu";
import {ExplorerDirectory} from "./explorer-directory";

(async () => {
    const editor = new Editor();
    const contextMenu = new ContextMenu(
        editor.element
    );

    // Tab → Sidebar の循環依存を Object.assign パターンで解決する
    const sidebar = {} as Sidebar;
    let viewDirectory: ExplorerDirectory;

    const tab = new Tab(
        editor,
        (viewName) => { viewDirectory.appendViewFile(viewName); },
        sidebar
    );

    const realSidebar = new Sidebar(
        document.getElementById('explorer')!,
        tab,
        contextMenu
    );
    Object.assign(sidebar, realSidebar);
    Object.setPrototypeOf(sidebar, Sidebar.prototype);

    viewDirectory = sidebar.appendDirectory('ビュー');

    // スキーマファイルを読み込み
    const files = await findFilesAsync("schema");
    for (let i = 0; i < files.length; ++i) {
        const file = files[i];
        const tableName = file.name
            .split('.')
            .slice(0, -1)
            .join('.');
        sidebar.appendFile(tableName);
    }

    // ビューファイルを読み込み
    try {
        const viewFiles = await findFilesAsync(
            "view"
        );
        for (
            let i = 0;
            i < viewFiles.length;
            ++i
        ) {
            const file = viewFiles[i];
            if (file.type !== 'file') continue;
            const viewName = file.name
                .split('.')
                .slice(0, -1)
                .join('.');
            viewDirectory.appendViewFile(
                viewName
            );
        }
    } catch {
        // viewディレクトリが存在しない場合は無視
    }
})();
