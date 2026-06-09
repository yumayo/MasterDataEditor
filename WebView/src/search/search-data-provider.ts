import {readFileAsync, findFilesAsync} from "../app/api";
import {EditorTable} from "../editor/editor-table";
import {extractFirstPrimaryKeyColumn} from "../core/schema-utils";
import type {InMemoryTableStore} from "../data/in-memory-table-store";

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
 * 全テーブルのデータを非同期でロードする。
 * オープン中のテーブルはDOMから、それ以外はInMemoryTableStoreから最新値を取得する。
 */
export class SearchDataProvider {
    private readonly openEditorTables: Map<string, EditorTable>;
    private readonly store: InMemoryTableStore;
    private tableNamesCache: string[];

    constructor(openEditorTables: Map<string, EditorTable>, store: InMemoryTableStore) {
        this.openEditorTables = openEditorTables;
        this.store = store;
        this.tableNamesCache = [];
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
        return this.loadFromStoreAsync(tableName);
    }

    /**
     * EditorTableのDOMからTableSearchDataを構築する
     */
    private buildFromEditorTable(tableName: string, editorTable: EditorTable): TableSearchData {
        const tableData = editorTable.getTableData();
        const columnCount = editorTable.getColumnCount();
        const rowCount = editorTable.getLogicalRowCount();
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
     * ストアからTableSearchDataを読み込む。
     * 未ロードの場合はストアへ常駐ロードしてから読み取る。
     */
    private async loadFromStoreAsync(tableName: string): Promise<TableSearchData> {
        const [schemaText, csv] = await Promise.all([
            readFileAsync(`schema/${tableName}.json`),
            this.store.ensureTableLoadedAsync(tableName),
        ]);
        const schema = JSON.parse(schemaText);
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
            csvHeader: [...csv.header],
            csvBody: csv.body.map(row => [...row]),
            primaryKeyColumnName,
        };
    }
}
