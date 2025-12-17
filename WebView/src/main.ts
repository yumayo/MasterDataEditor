import {findFilesAsync} from "./api";
import {Explorer} from "./explorer";
import {Tab} from "./tab";
import {Editor} from "./editor";

(async () => {
    const editor = new Editor();
    const tab = new Tab(editor);
    const explorer = new Explorer(tab);
    const files = await findFilesAsync("schema");
    for (let i = 0; i < files.length; ++i) {
        const file = files[i];
        const tableName = file.name.split('.').slice(0, -1).join('.');
        explorer.appendFile(tableName);
    }
})();
