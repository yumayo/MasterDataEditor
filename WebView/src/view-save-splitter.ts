import {EditorTable} from "./editor-table";
import {ViewColumnMapping} from
    "./model/view-column-mapping";
import {
    ViewDefinition,
    serializeViewDefinition
} from "./model/view-definition";
import {Csv} from "./csv";
import {
    readFileAsync,
    writeFileAsync
} from "./api";
import {mergeCsvData} from "./editor-actions";

/**
 * テーブルごとの分離データ
 */
interface TableSplitData {
    tableName: string;
    header: string[];
    body: string[][];
}

/**
 * ビューのデータを各テーブルに分離して保存する
 *
 * アルゴリズム:
 * 1. EditorTableの全セル値を取得
 * 2. columnMappingsでテーブルごとに列をグループ化
 * 3. テーブルごとにヘッダーと行データを抽出
 * 4. 結合テーブル: キー値が空の行はスキップ
 * 5. 各テーブルの既存CSVとマージして保存
 * 6. ビュー定義JSONも保存
 */
export async function saveViewDataAsync(
    table: EditorTable,
    columnMappings: ViewColumnMapping[],
    viewDefinition: ViewDefinition
): Promise<void> {

    // テーブル名ごとに列をグループ化
    const tableGroups = new Map<
        string,
        {
            viewColumnIndex: number;
            mapping: ViewColumnMapping;
        }[]
    >();

    for (
        let i = 0;
        i < columnMappings.length;
        i++
    ) {
        const mapping = columnMappings[i];
        let group = tableGroups.get(
            mapping.tableName
        );
        if (!group) {
            group = [];
            tableGroups.set(
                mapping.tableName, group
            );
        }
        group.push({
            viewColumnIndex: i,
            mapping,
        });
    }

    // テーブルごとにデータを抽出
    const splitDataList: TableSplitData[] = [];
    const rowCount = table.getRowCount();

    const tableEntries = Array.from(
        tableGroups.entries()
    );
    for (
        const [tableName, columns]
        of tableEntries
    ) {
        const header: string[] = [];
        for (const col of columns) {
            header.push(
                col.mapping.sourceColumnName
            );
        }

        const body: string[][] = [];
        const isJoinedTable =
            columns[0].mapping.isJoinedColumn;

        for (let r = 1; r < rowCount; r++) {
            const rowData: string[] = [];
            for (const col of columns) {
                // viewColumnIndex は0始まり
                // column=0は行ヘッダーなので+1
                rowData.push(
                    table.getCellValueAt(
                        r,
                        col.viewColumnIndex + 1
                    )
                );
            }

            // 結合テーブルの場合、
            // キー値が空の行はスキップ
            if (isJoinedTable) {
                const keyColMapping =
                    columns.find(
                        (c: {
                            viewColumnIndex:
                                number;
                            mapping:
                                ViewColumnMapping;
                        }) =>
                            c.mapping
                                .sourceColumnName
                            === c.mapping
                                .joinKeyColumn
                    );
                if (keyColMapping) {
                    const keyIdx =
                        columns.indexOf(
                            keyColMapping
                        );
                    if (
                        rowData[keyIdx] === ''
                    ) continue;
                }
            }

            // ベーステーブル: 最初のセルが空なら終了
            if (
                !isJoinedTable
                && rowData.length > 0
                && rowData[0] === ''
            ) {
                break;
            }

            body.push(rowData);
        }

        splitDataList.push({
            tableName,
            header,
            body,
        });
    }

    // 各テーブルのCSVを保存
    const savePromises: Promise<void>[] = [];

    for (const splitData of splitDataList) {
        const csvPath =
            'data/' + splitData.tableName
                + '.csv';

        const savePromise = readFileAsync(
            csvPath
        ).then((existingCsvContents) => {
            const existingCsv = new Csv();
            existingCsv.load(existingCsvContents);
            const mergedCsv = mergeCsvData(
                existingCsv,
                {
                    header: splitData.header,
                    body: splitData.body,
                }
            );
            return writeFileAsync(
                csvPath,
                mergedCsv.toString()
            );
        }).catch(() => {
            // ファイルが存在しない場合は
            // 新規CSVとして保存
            const newCsv = new Csv();
            newCsv.header = splitData.header;
            newCsv.body = splitData.body;
            return writeFileAsync(
                csvPath,
                newCsv.toString()
            );
        });

        savePromises.push(savePromise);
    }

    // ビュー定義JSONも保存
    savePromises.push(
        writeFileAsync(
            'view/' + viewDefinition.name
                + '.json',
            serializeViewDefinition(
                viewDefinition
            )
        )
    );

    await Promise.all(savePromises);
    console.log(
        'Saved view: '
        + viewDefinition.name
    );
}
