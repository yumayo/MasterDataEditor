import {findFilesAsync} from "./api";
import {Explorer} from "./explorer";
import {Tab} from "./tab";
import {Editor} from "./editor";
import {ContextMenu} from "./context-menu";

(async () => {
    const editor = new Editor();
    const tab = new Tab(editor);
    const contextMenu = new ContextMenu(
        editor.element
    );
    const explorer = new Explorer(
        tab, contextMenu
    );

    // ビューをExplorerに追加するコールバック
    // ExplorerDirectoryの参照を後から設定する
    let viewDirectory =
        explorer.appendDirectory('ビュー');

    tab.setAddViewCallback((viewName: string) => {
        viewDirectory.appendViewFile(viewName);
    });

    // スキーマファイルを読み込み
    const files = await findFilesAsync("schema");
    for (let i = 0; i < files.length; ++i) {
        const file = files[i];
        const tableName = file.name
            .split('.')
            .slice(0, -1)
            .join('.');
        explorer.appendFile(tableName);
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
