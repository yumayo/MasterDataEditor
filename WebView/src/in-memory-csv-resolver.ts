import {Csv} from "./csv";
import {EditorTable} from "./editor-table";
import {ViewColumnMapping} from "./model/view-column-mapping";

/**
 * openEditorTablesからテーブル名でインメモリCSVを構築する
 *
 * 検索順序:
 * 1. テーブル名で直接登録されたEditorTableのDOMから構築
 * 2. ビュータブのjoinTableKeyMapsに含まれるソーステーブルから構築
 *
 * 開かれていなければ結果なし（false）を返す
 *
 * @param openEditorTables タブで開かれているEditorTableのマップ
 * @param tableName 検索するテーブル名
 * @returns CSVデータ、または見つからなかった場合はfalse
 */
export function resolveInMemoryCsv(openEditorTables: Map<string, EditorTable>, tableName: string): Csv | false {
    // 1. テーブル名で直接登録されたEditorTableのDOMからCSVを構築
    const directTable = openEditorTables.get(tableName);
    if (directTable) {
        const columnCount = directTable.getColumnCount();
        const rowCount = directTable.getRowCount();
        const csv = new Csv();
        const header: string[] = [];
        for (let c = 0; c < columnCount; c++) {
            header.push(directTable.getColumnHeaderValue(c));
        }
        csv.header = header;
        const body: string[][] = [];
        for (let r = 1; r < rowCount; r++) {
            const rowData: string[] = [];
            for (let c = 1; c <= columnCount; c++) {
                rowData.push(directTable.getCellValueAt(r, c));
            }
            if (rowData.length > 0 && rowData[0] !== '') {
                body.push(rowData);
            } else {
                break;
            }
        }
        csv.body = body;
        return csv;
    }
    // 2. ビュータブのjoinTableKeyMapsからソーステーブルを検索
    for (const [, editorTable] of openEditorTables) {
        if (!editorTable.hasViewContext()) continue;
        const viewContext = editorTable.getViewContext();
        const keyMap = viewContext.joinTableKeyMaps.get(tableName);
        if (!keyMap) continue;
        // columnMappingsからJOINテーブルの完全なヘッダーを復元する
        // columnMappingsにはJOINキー列が除外されているため、
        // 抜けているsourceColumnIndexをjoinKeyColumnの名前で埋める
        const header = rebuildJoinTableHeader(viewContext.columnMappings, tableName);
        if (header.length === 0) continue;
        // キーマップの全行をフラットに展開してCSVのbodyにする
        const csv = new Csv();
        csv.header = header;
        const body: string[][] = [];
        keyMap.forEach((rows: string[][]) => {
            for (let i = 0; i < rows.length; i++) {
                body.push(rows[i]);
            }
        });
        csv.body = body;
        return csv;
    }
    return false;
}

/**
 * ビューのcolumnMappingsからJOINテーブルの完全なヘッダーを復元する
 *
 * ReferenceDataCacheとReverseReferenceResolverの両方から間接的に使用されるため関数として分離する
 *
 * columnMappingsにはJOINキー列が除外されているため、
 * 抜けているsourceColumnIndexをjoinKeyColumnの名前で埋めて完全なヘッダーを構築する
 */
function rebuildJoinTableHeader(columnMappings: ViewColumnMapping[], tableName: string): string[] {
    let maxIndex = -1;
    let joinKeyColumnName = '';
    const indexToName = new Map<number, string>();
    for (let i = 0; i < columnMappings.length; i++) {
        const m = columnMappings[i];
        if (m.tableName !== tableName || !m.isJoinedColumn) continue;
        indexToName.set(m.sourceColumnIndex, m.sourceColumnName);
        if (m.sourceColumnIndex > maxIndex) {
            maxIndex = m.sourceColumnIndex;
        }
        if (joinKeyColumnName === '') {
            joinKeyColumnName = m.joinKeyColumn;
        }
    }
    if (maxIndex < 0) return [];
    const header: string[] = [];
    for (let i = 0; i <= maxIndex; i++) {
        if (indexToName.has(i)) {
            header.push(indexToName.get(i)!);
        } else {
            header.push(joinKeyColumnName);
        }
    }
    return header;
}
