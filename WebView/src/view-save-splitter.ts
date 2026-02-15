import {EditorTable} from "./editor-table";
import {ViewColumnMapping} from "./model/view-column-mapping";
import {ViewDefinition, serializeViewDefinition} from "./model/view-definition";
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
 *
 * @param existingCsv 既存のCSVデータ
 * @param splitData ビューから抽出した分離データ
 * @returns マージ済みCSV
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
    // Csv.load() は末尾改行を空行として取り込むため、ここで除外する
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
        const existingRowIndex = existingRowMap.get(keyValue);
        if (existingRowIndex !== undefined) {
            // 既存行を上書き（ビューに含まれる列のみ）
            for (let c = 0; c < splitData.header.length; c++) {
                mergedBody[existingRowIndex][splitToMergedIndex[c]] = splitData.body[r][c];
            }
        }
    }

    resultCsv.body = mergedBody;
    return resultCsv;
}

/**
 * ビューのデータを各テーブルに分離して保存する
 *
 * アルゴリズム:
 * 1. EditorTableの全セル値を取得
 * 2. columnMappingsでテーブルごとに列をグループ化
 * 3. テーブルごとにヘッダーと行データを抽出
 * 4. 結合テーブル: キー値が空の行はスキップ、同一キー値の重複行を排除
 * 5. 各テーブルの既存CSVとマージして保存
 *    - ベーステーブル: 列マージ（従来通り）
 *    - 結合テーブル: プライマリキーベースの行マージ（未参照行を保護）
 * 6. ビュー定義JSONも保存
 */
export async function saveViewDataAsync(
    table: EditorTable,
    columnMappings: ViewColumnMapping[],
    viewDefinition: ViewDefinition
): Promise<void> {

    // テーブル名ごとに列をグループ化
    const tableGroups = new Map<string, { viewColumnIndex: number; mapping: ViewColumnMapping }[]>();

    for (let i = 0; i < columnMappings.length; i++) {
        const mapping = columnMappings[i];
        let group = tableGroups.get(mapping.tableName);
        if (!group) {
            group = [];
            tableGroups.set(mapping.tableName, group);
        }
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
            const rowData: string[] = [];
            for (const col of columns) {
                // viewColumnIndex は0始まり、column=0は行ヘッダーなので+1
                rowData.push(table.getCellValueAt(r, col.viewColumnIndex + 1));
            }

            // 結合テーブルの場合、キー値が空の行はスキップし、重複行を排除
            if (isJoinedTable) {
                const keyColMapping = columns.find(
                    (c) => c.mapping.sourceColumnName === c.mapping.joinKeyColumn
                );
                let keyValue = '';
                if (keyColMapping) {
                    // キー列がビューに表示されている場合
                    const keyIdx = columns.indexOf(keyColMapping);
                    keyValue = rowData[keyIdx];
                } else if (fkViewColumnIndex >= 0) {
                    // キー列が非表示の場合、ベーステーブルのFK列から取得
                    keyValue = table.getCellValueAt(r, fkViewColumnIndex + 1);
                }
                if (keyValue === '') continue;
                if (seenKeys.has(keyValue)) continue;
                seenKeys.add(keyValue);
                // キー列が非表示の場合、後で復元するためにキー値を記録
                if (!keyColMapping) {
                    restoredKeyValues.push(keyValue);
                }
            }

            // ベーステーブル: 最初のセルが空なら終了
            if (!isJoinedTable && rowData.length > 0 && rowData[0] === '') {
                break;
            }

            body.push(rowData);
        }

        // 結合テーブルのキー列名を取得
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

            // 結合テーブルはプライマリキーベースの行マージ、ベーステーブルは列マージ
            const mergedCsv = splitData.isJoinedTable
                ? mergeJoinedTableCsv(existingCsv, splitData)
                : mergeCsvData(existingCsv, { header: splitData.header, body: splitData.body });

            return writeFileAsync(csvPath, mergedCsv.toString());
        }).catch(() => {
            // ファイルが存在しない場合は新規CSVとして保存
            const newCsv = new Csv();
            newCsv.header = splitData.header;
            newCsv.body = splitData.body;
            return writeFileAsync(csvPath, newCsv.toString());
        });

        savePromises.push(savePromise);
    }

    // ビュー定義JSONも保存
    savePromises.push(
        writeFileAsync(
            'view/' + viewDefinition.name + '.json',
            serializeViewDefinition(viewDefinition)
        )
    );

    await Promise.all(savePromises);
    console.log('Saved view: ' + viewDefinition.name);
}
