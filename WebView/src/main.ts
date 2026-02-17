import {findFilesAsync} from "./api";
import {Sidebar} from "./sidebar";
import {Tab} from "./tab";
import {Editor} from "./editor";
import {ContextMenu} from "./context-menu";

(async () => {
    const editor = new Editor();
    const contextMenu = new ContextMenu(
        editor.element
    );

    // Tab → Sidebar の循環依存を Object.assign パターンで解決する
    const sidebar = {} as Sidebar;

    const tab = new Tab(
        editor,
        sidebar
    );

    const realSidebar = new Sidebar(
        document.getElementById('explorer')!,
        tab,
        contextMenu
    );
    Object.assign(sidebar, realSidebar);
    Object.setPrototypeOf(sidebar, Sidebar.prototype);

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
            sidebar.appendViewFile(
                viewName
            );
        }
    } catch {
        // viewディレクトリが存在しない場合は無視
    }
})();
