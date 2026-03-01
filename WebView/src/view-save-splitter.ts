import {EditorTable} from "./editor-table";
import {ViewColumnMapping} from "./model/view-column-mapping";
import {ViewDefinition, ViewColumnConfig, serializeViewDefinition} from "./model/view-definition";
import {Csv} from "./csv";
import {writeFileAsync} from "./api";
import {InMemoryTableStore} from "./in-memory-table-store";
import {config} from "./config";

/**
 * ビューのデータをStoreから直接読み取り、各テーブルのCSVとして保存する
 *
 * 1. viewDefinition.baseTable と viewDefinition.joins[].targetTable でテーブル名を列挙
 * 2. 各テーブル: store.getCsv(tableName) → PK空行フィルタ → writeFileAsync
 * 3. ビュー定義JSONを保存
 */
export async function saveViewDataAsync(
    viewDefinition: ViewDefinition,
    store: InMemoryTableStore
): Promise<void> {
    // ベーステーブルとJOIN先テーブルを重複排除して列挙
    const tableNames = new Set<string>();
    tableNames.add(viewDefinition.baseTable);
    for (const join of viewDefinition.joins) {
        tableNames.add(join.targetTable);
    }

    // 各テーブルのCSV保存とビュー定義JSON保存を並行実行
    const promises: Promise<void>[] = [];
    const tableNameArray = Array.from(tableNames);
    for (const tableName of tableNameArray) {
        const csv = store.getCsv(tableName);
        if (csv === false) throw new Error('到達不可能: テーブル "' + tableName + '" がStoreに存在しません');
        // PK列インデックスを特定
        const pkColumnIndex = csv.header.indexOf(config.primaryKeyColumnName);
        if (pkColumnIndex === -1) throw new Error('到達不可能: テーブル "' + tableName + '" にPK列 "' + config.primaryKeyColumnName + '" が存在しません');
        // PK空行を除外した新しいCsvを構築（Storeの内部配列を変更しない）
        const filteredCsv = new Csv();
        filteredCsv.header = csv.header;
        filteredCsv.body = csv.body.filter(row => row[pkColumnIndex] !== '');
        promises.push(writeFileAsync('data/' + tableName + '.csv', filteredCsv.toString()));
    }
    promises.push(writeFileAsync('view/' + viewDefinition.name + '.json', serializeViewDefinition(viewDefinition)));

    await Promise.all(promises);
    console.log('Saved view: ' + viewDefinition.name);
}

/**
 * 保存前にDOMの現在の列幅を viewDefinition.columns に反映する
 * 可視列は現在のDOM幅で更新し、非表示列は既存configを保持する
 */
export function updateViewColumnConfigs(
    table: EditorTable,
    columnMappings: ViewColumnMapping[],
    viewDefinition: ViewDefinition
): void {
    const columnWidths = table.getColumnWidths();
    const newColumns: ViewColumnConfig[] = [];

    // 可視列: 現在のDOM幅で構築
    for (let i = 0; i < columnMappings.length; i++) {
        newColumns.push({
            tableName: columnMappings[i].tableName,
            columnName: columnMappings[i].sourceColumnName,
            width: parseInt(columnWidths[i]),
            hidden: false,
        });
    }

    // 非表示列: 既存configを保持
    for (const existing of viewDefinition.columns) {
        if (existing.hidden) {
            newColumns.push(existing);
        }
    }

    viewDefinition.columns.length = 0;
    for (const col of newColumns) {
        viewDefinition.columns.push(col);
    }
}
