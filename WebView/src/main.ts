import Store from "./store";
import {findFilesAsync} from "./api";

(async () => {
    const files = await findFilesAsync("schema");
    for (let i = 0; i < files.length; ++i) {
        const file = files[i];
        const tableName = file.name.split('.').slice(0, -1).join('.');
        Store.explorer.append(tableName);
    }
})();
