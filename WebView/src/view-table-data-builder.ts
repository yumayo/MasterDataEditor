import {EditorTableData} from
    "./model/editor-table-data";
import {EditorTableDataColumn} from
    "./model/editor-table-data-column";
import {EditorTableDataRow} from
    "./model/editor-table-data-row";
import {ViewDefinition} from
    "./model/view-definition";
import {ViewColumnMapping} from
    "./model/view-column-mapping";

/**
 * Join対象のテーブルデータ
 */
export interface JoinedTableLoadedData {
    tableName: string;
    tableData: EditorTableData;
}

/**
 * ビューテーブル構築結果
 */
export interface ViewTableBuildResult {
    /** 合成されたEditorTableData */
    compositeTableData: EditorTableData;
    /** ビュー列とソーステーブル列のマッピング */
    columnMappings: ViewColumnMapping[];
}

/**
 * ベーステーブルとJoin対象テーブルを結合して
 * 合成EditorTableDataを構築する
 *
 * アルゴリズム:
 * 1. ベーステーブルのヘッダーでcolumnMappingsを初期化
 * 2. joinsをinsertAfterViewColumnIndex降順でソートし
 *    右側から挿入してインデックスずれを防ぐ
 * 3. 各joinの全列をヘッダーとcolumnMappingsに挿入
 * 4. 行データ: ベーステーブルの各行に対して
 *    結合先テーブルの行をキーマッチング
 * 5. マッチしない行は空文字（LEFT JOIN）
 */
export function buildViewTableData(
    baseTableData: EditorTableData,
    joinedTables: JoinedTableLoadedData[],
    viewDefinition: ViewDefinition
): ViewTableBuildResult {

    // 結合テーブルをMap化して高速に参照する
    const tableMap = new Map<
        string, EditorTableData
    >();
    for (const jt of joinedTables) {
        tableMap.set(jt.tableName, jt.tableData);
    }

    // 1. ベーステーブルのヘッダーで初期化
    const columnMappings: ViewColumnMapping[] = [];
    const compositeHeader:
        EditorTableDataColumn[] = [];

    for (
        let i = 0;
        i < baseTableData.header.length;
        i++
    ) {
        const col = baseTableData.header[i];
        compositeHeader.push(
            new EditorTableDataColumn(
                col.key,
                col.name,
                col.type,
                col.comment,
                col.reference
            )
        );
        columnMappings.push({
            tableName: viewDefinition.baseTable,
            sourceColumnIndex: i,
            sourceColumnName: col.name,
            isJoinedColumn: false,
            joinKeyColumn: '',
            baseKeyColumn: '',
        });
    }

    // 2. joinsをinsertAfterViewColumnIndex降順でソート
    //    右側から挿入することでインデックスのずれを防ぐ
    const sortedJoins = [...viewDefinition.joins]
        .sort((a, b) =>
            b.insertAfterViewColumnIndex
            - a.insertAfterViewColumnIndex
        );

    // 各joinの挿入情報を記録（行データ構築用）
    interface JoinInsertInfo {
        insertPosition: number;
        targetTable: string;
        targetColumn: string;
        sourceColumn: string;
        columnCount: number;
    }
    const joinInsertInfos: JoinInsertInfo[] = [];

    // 3. 各joinの全列をヘッダーとmappingsに挿入
    for (const join of sortedJoins) {
        const joinTable = tableMap.get(
            join.targetTable
        );
        if (!joinTable) continue;

        const insertPos =
            join.insertAfterViewColumnIndex + 1;
        const newColumns:
            EditorTableDataColumn[] = [];
        const newMappings:
            ViewColumnMapping[] = [];

        for (
            let i = 0;
            i < joinTable.header.length;
            i++
        ) {
            const col = joinTable.header[i];
            newColumns.push(
                new EditorTableDataColumn(
                    col.key,
                    join.targetTable
                        + '.' + col.name,
                    col.type,
                    col.comment,
                    col.reference
                )
            );
            newMappings.push({
                tableName: join.targetTable,
                sourceColumnIndex: i,
                sourceColumnName: col.name,
                isJoinedColumn: true,
                joinKeyColumn: join.targetColumn,
                baseKeyColumn: join.sourceColumn,
            });
        }

        // 挿入位置に列を差し込む
        compositeHeader.splice(
            insertPos, 0, ...newColumns
        );
        columnMappings.splice(
            insertPos, 0, ...newMappings
        );

        joinInsertInfos.push({
            insertPosition: insertPos,
            targetTable: join.targetTable,
            targetColumn: join.targetColumn,
            sourceColumn: join.sourceColumn,
            columnCount: joinTable.header.length,
        });
    }

    // 4. 行データを構築
    // 結合テーブルごとにキー値→行データのMapを作成
    const keyMaps = new Map<
        string,
        Map<string, string[]>
    >();

    for (const join of viewDefinition.joins) {
        const joinTable = tableMap.get(
            join.targetTable
        );
        if (!joinTable) continue;

        const keyColumnIndex =
            joinTable.header.findIndex(
                col => col.name === join.targetColumn
            );
        if (keyColumnIndex === -1) continue;

        const keyMap = new Map<
            string, string[]
        >();
        for (const row of joinTable.body) {
            const keyValue =
                row.values[keyColumnIndex];
            if (keyValue !== '') {
                keyMap.set(keyValue, row.values);
            }
        }
        keyMaps.set(join.targetTable, keyMap);
    }

    // 合成行データを構築
    const compositeBody:
        EditorTableDataRow[] = [];

    for (const baseRow of baseTableData.body) {
        // ベーステーブルの行データをコピー
        const rowValues = [...baseRow.values];

        // joinInsertInfosを使って列を挿入
        // （降順ソートで右側から挿入するので
        //  先に処理した位置は影響を受けない）
        for (const info of joinInsertInfos) {
            // ベーステーブルの参照元列の値を取得
            const sourceColIndex =
                baseTableData.header.findIndex(
                    col =>
                        col.name
                        === info.sourceColumn
                );
            const keyValue = sourceColIndex >= 0
                ? baseRow.values[sourceColIndex]
                : '';

            // 結合先テーブルから行を検索
            const keyMap = keyMaps.get(
                info.targetTable
            );
            const joinedRow = keyMap
                ? keyMap.get(keyValue)
                : undefined;

            // 結合データを挿入（マッチしなければ空文字）
            const joinedValues: string[] = [];
            const joinTable = tableMap.get(
                info.targetTable
            );
            if (!joinTable) continue;

            for (
                let i = 0;
                i < joinTable.header.length;
                i++
            ) {
                joinedValues.push(
                    joinedRow ? joinedRow[i] : ''
                );
            }
            rowValues.splice(
                info.insertPosition,
                0,
                ...joinedValues
            );
        }

        compositeBody.push(
            new EditorTableDataRow(rowValues)
        );
    }

    // 合成EditorTableDataを生成
    const compositeTableData =
        new EditorTableData(
            baseTableData.description,
            baseTableData.primaryKey,
            compositeHeader,
            compositeBody
        );

    return {
        compositeTableData,
        columnMappings,
    };
}
