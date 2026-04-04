import {readFileAsync, findFilesAsync} from "./api";
import {Csv} from "./csv";
import {EditorTable} from "./editor-table";
import {extractFirstPrimaryKeyColumn} from "./schema-utils";

/**
 * テーブル1つ分のスキーマ+データ
 */
export interface TableSearchData {
    tableName: string;
    header: Array<{name: string; type: string; reference: string; comment: string}>;
    csvHeader: string[];
    csvBody: string[][];
    primaryKeyColumnName: string;
}

/**
 * 全テーブルのデータを非同期でロードし、キャッシュする
 * オープン中のテーブルはインメモリデータ（DOM）から最新値を取得する
 */
export class SearchDataProvider {
    private readonly openEditorTables: Map<string, EditorTable>;
    private tableNamesCache: string[];
    private dataCache: Map<string, TableSearchData>;

    constructor(openEditorTables: Map<string, EditorTable>) {
        this.openEditorTables = openEditorTables;
        this.tableNamesCache = [];
        this.dataCache = new Map();
    }

    /**
     * 全テーブルの一覧を取得する（初回はfindFilesAsync経由）
     */
    async loadAllTableNamesAsync(): Promise<string[]> {
        if (this.tableNamesCache.length > 0) {
            return this.tableNamesCache;
        }
        const files = await findFilesAsync("schema");
        const names: string[] = [];
        for (const file of files) {
            if (file.type !== 'file') continue;
            if (!file.name.endsWith('.json')) continue;
            names.push(file.name.replace('.json', ''));
        }
        this.tableNamesCache = names;
        return names;
    }

    /**
     * テーブルデータを取得する（キャッシュorロード）
     * オープン中のテーブルはインメモリデータを優先する
     */
    async getTableDataAsync(tableName: string): Promise<TableSearchData> {
        // オープン中のテーブルは毎回インメモリから取得（編集中の値を反映するため）
        const editorTable = this.openEditorTables.get(tableName);
        if (editorTable) {
            return this.buildFromEditorTable(tableName, editorTable);
        }
        // キャッシュがあればそれを返す
        const cached = this.dataCache.get(tableName);
        if (cached) {
            return cached;
        }
        // ファイルから読み込む
        const data = await this.loadFromFileAsync(tableName);
        this.dataCache.set(tableName, data);
        return data;
    }

    /**
     * キャッシュを無効化する
     */
    invalidateCache(tableName: string): void {
        this.dataCache.delete(tableName);
    }

    /**
     * EditorTableのDOMからTableSearchDataを構築する
     */
    private buildFromEditorTable(tableName: string, editorTable: EditorTable): TableSearchData {
        const tableData = editorTable.getTableData();
        const columnCount = editorTable.getColumnCount();
        const rowCount = editorTable.getRowCount();
        const csvHeader: string[] = [];
        for (let c = 0; c < columnCount; c++) {
            csvHeader.push(editorTable.getColumnHeaderValue(c));
        }
        const csvBody: string[][] = [];
        for (let r = 1; r < rowCount; r++) {
            const rowData: string[] = [];
            for (let c = 1; c <= columnCount; c++) {
                rowData.push(editorTable.getCellValueAt(r, c));
            }
            // 空行はスキップ
            if (rowData.length > 0 && rowData[0] !== '') {
                csvBody.push(rowData);
            } else {
                break;
            }
        }
        const header: Array<{name: string; type: string; reference: string; comment: string}> = [];
        for (const col of tableData.header) {
            header.push({
                name: col.name,
                type: col.type,
                // 動的参照（オブジェクト）は検索パネルでは使わないため空文字列にする
                reference: typeof col.reference === 'string' ? col.reference : '',
                comment: col.comment !== null ? col.comment : '',
            });
        }
        return {
            tableName,
            header,
            csvHeader,
            csvBody,
            // テーブルスキーマのprimaryKeyColumnsから最初のPK列名を使用する
            primaryKeyColumnName: tableData.primaryKeyColumns[0],
        };
    }

    /**
     * ファイルからTableSearchDataを読み込む
     */
    private async loadFromFileAsync(tableName: string): Promise<TableSearchData> {
        const [schemaText, csvText] = await Promise.all([
            readFileAsync(`schema/${tableName}.json`),
            readFileAsync(`data/${tableName}.csv`),
        ]);
        const schema = JSON.parse(schemaText);
        const csv = new Csv();
        csv.load(csvText);
        const header: Array<{name: string; type: string; reference: string; comment: string}> = [];
        for (const col of schema.header) {
            header.push({
                name: col.name,
                type: col.type,
                // 動的参照（オブジェクト）は検索パネルでは使わないため空文字列にする
                reference: typeof col.reference === 'string' ? col.reference : '',
                comment: typeof col.comment === 'string' ? col.comment : '',
            });
        }
        // スキーマの primary_key から最初のPK列名を取得する
        const primaryKeyColumnName = extractFirstPrimaryKeyColumn(schema);
        return {
            tableName,
            header,
            csvHeader: csv.header,
            csvBody: csv.body,
            primaryKeyColumnName,
        };
    }
}
