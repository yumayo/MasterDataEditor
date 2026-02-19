import {EditorTable} from "./editor-table";
import {ViewColumnMapping} from "./model/view-column-mapping";
import {ViewRowMetadata} from "./model/view-row-metadata";
import {ViewDefinition, ViewColumnConfig, serializeViewDefinition} from "./model/view-definition";
import {Csv} from "./csv";
import {readFileAsync, writeFileAsync} from "./api";
import {mergeCsvData} from "./editor-actions";

/**
 * テーブルごとの分離データ
 */
interface TableSplitData {
    tableName: string;
    header: string[];
    body: string[][];
    /** 結合テーブルかどうか */
    isJoinedTable: boolean;
    /** 結合テーブルのキー列名（プライマリキーとして使用） */
    joinKeyColumn: string;
}

/**
 * 結合テーブルのCSVをプライマリキーベースでマージする
 *
 * 既存CSVの全行を保持しつつ、ビューで編集された行のみ上書きする。
 * これにより、ビューに表示されない行（未参照のレコード）が消失しない。
 */
function mergeJoinedTableCsv(existingCsv: Csv, splitData: TableSplitData): Csv {
    const resultCsv = new Csv();

    // 既存CSVのヘッダーをベースに、新しい列を追加
    const mergedHeader: string[] = [...existingCsv.header];
    const splitToMergedIndex: number[] = [];

    for (let i = 0; i < splitData.header.length; i++) {
        const columnName = splitData.header[i];
        const existingIndex = existingCsv.header.indexOf(columnName);
        if (existingIndex !== -1) {
            splitToMergedIndex.push(existingIndex);
        } else {
            splitToMergedIndex.push(mergedHeader.length);
            mergedHeader.push(columnName);
        }
    }

    resultCsv.header = mergedHeader;

    // 既存CSVのボディからキー値が空でない有効行のみを抽出する
    const keyColumnName = splitData.joinKeyColumn;
    const existingKeyIndex = existingCsv.header.indexOf(keyColumnName);
    const validExistingRows: string[][] = [];
    for (let r = 0; r < existingCsv.body.length; r++) {
        if (existingKeyIndex !== -1 && existingCsv.body[r][existingKeyIndex] === '') continue;
        validExistingRows.push(existingCsv.body[r]);
    }

    // 有効行をキー値→行インデックスのMapに格納
    const existingRowMap = new Map<string, number>();
    for (let r = 0; r < validExistingRows.length; r++) {
        if (existingKeyIndex !== -1) {
            existingRowMap.set(validExistingRows[r][existingKeyIndex], r);
        }
    }

    // 有効行をマージ後のヘッダー幅にリサイズしてコピー
    const mergedBody: string[][] = [];
    for (let r = 0; r < validExistingRows.length; r++) {
        const mergedRow: string[] = new Array(mergedHeader.length).fill('');
        for (let c = 0; c < existingCsv.header.length; c++) {
            mergedRow[c] = validExistingRows[r][c];
        }
        mergedBody.push(mergedRow);
    }

    // ビューから抽出した行でキーが一致する既存行を上書き
    const splitKeyIndex = splitData.header.indexOf(keyColumnName);
    for (let r = 0; r < splitData.body.length; r++) {
        const keyValue = splitKeyIndex !== -1 ? splitData.body[r][splitKeyIndex] : '';
        if (existingRowMap.has(keyValue)) {
            const rowIdx = existingRowMap.get(keyValue) as number;
            for (let c = 0; c < splitData.header.length; c++) {
                mergedBody[rowIdx][splitToMergedIndex[c]] = splitData.body[r][c];
            }
        }
    }

    resultCsv.body = mergedBody;
    return resultCsv;
}

/**
 * ビューのデータを各テーブルに分離して保存する
 *
 * 1:n展開対応: パディング行を考慮してベーステーブルと結合テーブルのデータを正しく抽出する。
 * - ベーステーブル: パディング行（展開で複製された行）はスキップし、グループリーダー行のみ抽出
 * - 結合テーブル: 該当列がパディングでない行のみ抽出し、同一キー値の重複を排除
 */
export async function saveViewDataAsync(
    table: EditorTable,
    columnMappings: ViewColumnMapping[],
    viewDefinition: ViewDefinition,
    rowMetadata: ViewRowMetadata[]
): Promise<void> {

    // テーブル名ごとに列をグループ化
    const tableGroups = new Map<string, { viewColumnIndex: number; mapping: ViewColumnMapping }[]>();
    for (let i = 0; i < columnMappings.length; i++) {
        const mapping = columnMappings[i];
        let group = tableGroups.get(mapping.tableName);
        if (!group) { group = []; tableGroups.set(mapping.tableName, group); }
        group.push({ viewColumnIndex: i, mapping });
    }

    // テーブルごとにデータを抽出
    const splitDataList: TableSplitData[] = [];
    const rowCount = table.getRowCount();

    const tableEntries = Array.from(tableGroups.entries());
    for (const [tableName, columns] of tableEntries) {
        const header: string[] = [];
        for (const col of columns) {
            header.push(col.mapping.sourceColumnName);
        }

        const body: string[][] = [];
        const isJoinedTable = columns[0].mapping.isJoinedColumn;

        // 結合テーブルの場合、同一キー値の重複行を排除するためのSet
        const seenKeys = new Set<string>();

        // 結合テーブルでキー列が非表示の場合、ベーステーブルのFK列からキー値を取得するための準備
        let fkViewColumnIndex = -1;
        if (isJoinedTable) {
            const baseKeyCol = columns[0].mapping.baseKeyColumn;
            for (let i = 0; i < columnMappings.length; i++) {
                const m = columnMappings[i];
                if (!m.isJoinedColumn && m.sourceColumnName === baseKeyCol) {
                    fkViewColumnIndex = i;
                    break;
                }
            }
        }

        // キー列が非表示の場合に復元するキー値のリスト
        const restoredKeyValues: string[] = [];

        for (let r = 1; r < rowCount; r++) {
            const metaIndex = r - 1;

            // 1:n展開のパディング判定
            if (metaIndex < rowMetadata.length) {
                const meta = rowMetadata[metaIndex];
                // ベーステーブル: パディング行（展開で複製された行）はスキップ
                if (!isJoinedTable && meta.paddingColumns.length > 0) {
                    const firstBaseColIdx = columns[0].viewColumnIndex;
                    if (meta.paddingColumns[firstBaseColIdx]) continue;
                }
                // 結合テーブル: 該当テーブルの列がパディングの行はスキップ
                if (isJoinedTable && meta.paddingColumns.length > 0) {
                    const firstJoinColIdx = columns[0].viewColumnIndex;
                    if (meta.paddingColumns[firstJoinColIdx]) continue;
                }
            }

            const rowData: string[] = [];
            for (const col of columns) {
                rowData.push(table.getCellValueAt(r, col.viewColumnIndex + 1));
            }

            // 結合テーブルの場合、全列が空の行はスキップし、行全体の複合キーで重複を排除
            if (isJoinedTable) {
                // 全列が空ならデータなし（LEFT JOINで未マッチ）としてスキップ
                if (rowData.every(v => v === '')) continue;

                // 行全体の複合キーで重複排除（1:nでは同一join keyに複数行があるため）
                const compositeKey = rowData.join('\t');
                if (seenKeys.has(compositeKey)) continue;
                seenKeys.add(compositeKey);

                // キー列が非表示の場合、FK列またはメタデータからキー値を復元
                const keyColMapping = columns.find(c => c.mapping.sourceColumnName === c.mapping.joinKeyColumn);
                if (!keyColMapping) {
                    let restoreKeyValue = '';
                    if (fkViewColumnIndex >= 0) {
                        restoreKeyValue = table.getCellValueAt(r, fkViewColumnIndex + 1);
                    }
                    // パディング行ではFK列が空なので、メタデータのsourceKeyValueから取得
                    if (restoreKeyValue === '' && metaIndex < rowMetadata.length) {
                        const meta = rowMetadata[metaIndex];
                        for (const info of meta.groupInfos) {
                            if (info.sourceTable === tableName) {
                                restoreKeyValue = info.sourceKeyValue;
                                break;
                            }
                        }
                    }
                    restoredKeyValues.push(restoreKeyValue);
                }
            }

            // ベーステーブル: 最初のセルが空なら終了
            if (!isJoinedTable && rowData.length > 0 && rowData[0] === '') break;

            body.push(rowData);
        }

        const joinKeyColumn = isJoinedTable ? (columns[0].mapping.joinKeyColumn) : '';

        // 結合テーブルでキー列が非表示の場合、FK列の値からキー列を復元
        if (isJoinedTable && !header.includes(joinKeyColumn) && restoredKeyValues.length > 0) {
            header.unshift(joinKeyColumn);
            for (let i = 0; i < body.length; i++) {
                body[i].unshift(restoredKeyValues[i]);
            }
        }

        splitDataList.push({ tableName, header, body, isJoinedTable, joinKeyColumn });
    }

    // 各テーブルのCSVを保存
    const savePromises: Promise<void>[] = [];

    for (const splitData of splitDataList) {
        const csvPath = 'data/' + splitData.tableName + '.csv';
        const savePromise = readFileAsync(csvPath).then((existingCsvContents) => {
            const existingCsv = new Csv();
            existingCsv.load(existingCsvContents);
            const mergedCsv = splitData.isJoinedTable
                ? mergeJoinedTableCsv(existingCsv, splitData)
                : mergeCsvData(existingCsv, { header: splitData.header, body: splitData.body });
            return writeFileAsync(csvPath, mergedCsv.toString());
        }).catch(() => {
            const newCsv = new Csv();
            newCsv.header = splitData.header;
            newCsv.body = splitData.body;
            return writeFileAsync(csvPath, newCsv.toString());
        });
        savePromises.push(savePromise);
    }

    // ビュー定義JSONも保存
    savePromises.push(writeFileAsync('view/' + viewDefinition.name + '.json', serializeViewDefinition(viewDefinition)));

    await Promise.all(savePromises);
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
