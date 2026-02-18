import {EditorTableData} from "./model/editor-table-data";
import {EditorTableDataColumn} from "./model/editor-table-data-column";
import {EditorTableDataRow} from "./model/editor-table-data-row";
import {ViewDefinition, ViewJoinDefinition} from "./model/view-definition";
import {ViewColumnMapping} from "./model/view-column-mapping";
import {ViewRowMetadata, ViewRowGroupInfo} from "./model/view-row-metadata";

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
    /** 結合テーブルのキーマップ（テーブル名 → キー値 → 行の配列） */
    joinTableKeyMaps: Map<string, Map<string, string[][]>>;
    /** 各行のメタデータ（1:n展開のパディング・グループ情報） */
    rowMetadata: ViewRowMetadata[];
}

/**
 * 各JOINの行展開処理に必要な情報
 */
interface JoinExpandInfo {
    /** composite上のソース列インデックス（キー値取得用） */
    sourceCompositeIndex: number;
    /** 結合先テーブル名 */
    targetTable: string;
    /** composite上の結合列開始インデックス */
    compositeColumnStart: number;
    /** composite上の結合列終了インデックス（排他的） */
    compositeColumnEnd: number;
    /** 結合先テーブル内の元列インデックス（composite列と並行） */
    rawSourceIndices: number[];
    /** JOINレベル */
    joinLevel: number;
}

/**
 * 展開中の行データ
 */
interface ExpandingRow {
    values: string[];
    padding: boolean[];
    groupInfos: ViewRowGroupInfo[];
}

/**
 * JOIN定義のレベルを解決する
 * sourceTable='' → レベル1（ベーステーブルからの直接JOIN）
 * sourceTableが他JOINのtargetTableと一致 → 親レベル+1
 */
function resolveJoinLevels(viewDefinition: ViewDefinition): Map<ViewJoinDefinition, number> {
    const levels = new Map<ViewJoinDefinition, number>();

    function getLevel(join: ViewJoinDefinition): number {
        if (levels.has(join)) return levels.get(join) as number;

        if (join.sourceTable === '') {
            levels.set(join, 1);
            return 1;
        }

        for (const other of viewDefinition.joins) {
            if (other !== join && other.targetTable === join.sourceTable) {
                const parentLevel = getLevel(other);
                const level = parentLevel + 1;
                levels.set(join, level);
                return level;
            }
        }

        levels.set(join, 1);
        return 1;
    }

    for (const join of viewDefinition.joins) {
        getLevel(join);
    }
    return levels;
}

/**
 * composite列マッピングからJOINのソース列インデックスを検索する
 * ソース列が非表示（targetColumnとして除外済み）の場合は親JOINのFK列をフォールバックに使用する
 */
function findSourceCompositeIndex(
    join: ViewJoinDefinition, baseTable: string,
    allJoins: ViewJoinDefinition[], columnMappings: ViewColumnMapping[]
): number {
    const sourceTableName = join.sourceTable === '' ? baseTable : join.sourceTable;

    // 直接検索
    for (let i = 0; i < columnMappings.length; i++) {
        const m = columnMappings[i];
        if (m.tableName === sourceTableName && m.sourceColumnName === join.sourceColumn) return i;
    }

    // チェーンJOIN: ソース列がtargetColumnとして非表示の場合、親JOINのFK列から間接的に解決する
    if (join.sourceTable !== '') {
        for (const parentJoin of allJoins) {
            if (parentJoin.targetTable === join.sourceTable && parentJoin.targetColumn === join.sourceColumn) {
                const parentSource = parentJoin.sourceTable === '' ? baseTable : parentJoin.sourceTable;
                for (let i = 0; i < columnMappings.length; i++) {
                    const m = columnMappings[i];
                    if (m.tableName === parentSource && m.sourceColumnName === parentJoin.sourceColumn) return i;
                }
            }
        }
    }
    return -1;
}

/**
 * 1つのJOINに対する列範囲をcolumnMappingsから特定する
 */
function findJoinColumnRange(
    join: ViewJoinDefinition, columnMappings: ViewColumnMapping[]
): { start: number; end: number; rawIndices: number[] } {
    let start = -1;
    let end = -1;
    const rawIndices: number[] = [];
    for (let i = 0; i < columnMappings.length; i++) {
        const m = columnMappings[i];
        if (m.isJoinedColumn && m.tableName === join.targetTable
            && m.joinKeyColumn === join.targetColumn && m.baseKeyColumn === join.sourceColumn) {
            if (start === -1) start = i;
            end = i + 1;
            rawIndices.push(m.sourceColumnIndex);
        }
    }
    return {start, end, rawIndices};
}

/**
 * ベーステーブルとJoin対象テーブルを結合して合成EditorTableDataを構築する
 *
 * 1:n展開対応: 同一キーに複数行がマッチする場合、行を展開して全子行を表示する。
 * チェーンJOIN対応: sourceTableを辿って再帰的にJOINレベルを解決する。
 *
 * アルゴリズム:
 * 1. JOINレベルを解決し、ヘッダーと列マッピングを構築
 * 2. 1:nキーマップを構築（キー値→行配列の配列）
 * 3. 各ベース行をレベル順にJOIN展開し、パディングフラグとメタデータを生成
 */
export function buildViewTableData(
    baseTableData: EditorTableData,
    joinedTables: JoinedTableLoadedData[],
    viewDefinition: ViewDefinition
): ViewTableBuildResult {

    const tableMap = new Map<string, EditorTableData>();
    for (const jt of joinedTables) {
        tableMap.set(jt.tableName, jt.tableData);
    }

    // --- Phase 1: JOINレベル解決とヘッダー・列マッピング構築 ---
    const joinLevels = resolveJoinLevels(viewDefinition);

    const columnMappings: ViewColumnMapping[] = [];
    const compositeHeader: EditorTableDataColumn[] = [];

    for (let i = 0; i < baseTableData.header.length; i++) {
        const col = baseTableData.header[i];
        compositeHeader.push(new EditorTableDataColumn(col.key, col.name, col.type, col.comment, col.reference, col.width));
        columnMappings.push({
            tableName: viewDefinition.baseTable, sourceColumnIndex: i, sourceColumnName: col.name,
            isJoinedColumn: false, joinKeyColumn: '', baseKeyColumn: '', joinLevel: 0,
        });
    }

    // 降順ソートで右側から列を挿入（インデックスずれ防止）
    const sortedJoins = [...viewDefinition.joins].sort(
        (a, b) => b.insertAfterViewColumnIndex - a.insertAfterViewColumnIndex
    );

    for (const join of sortedJoins) {
        const joinTable = tableMap.get(join.targetTable);
        if (!joinTable) continue;
        const insertPos = join.insertAfterViewColumnIndex + 1;
        const level = joinLevels.get(join) as number;
        const newColumns: EditorTableDataColumn[] = [];
        const newMappings: ViewColumnMapping[] = [];

        for (let i = 0; i < joinTable.header.length; i++) {
            const col = joinTable.header[i];
            if (col.name === join.targetColumn) continue;
            newColumns.push(new EditorTableDataColumn(
                col.key, join.targetTable + '.' + col.name, col.type, col.comment, col.reference, col.width
            ));
            newMappings.push({
                tableName: join.targetTable, sourceColumnIndex: i, sourceColumnName: col.name,
                isJoinedColumn: true, joinKeyColumn: join.targetColumn, baseKeyColumn: join.sourceColumn,
                joinLevel: level,
            });
        }
        compositeHeader.splice(insertPos, 0, ...newColumns);
        columnMappings.splice(insertPos, 0, ...newMappings);
    }

    // --- Phase 2: JoinExpandInfo構築 ---
    const { expandInfosByLevel, maxLevel } = buildJoinExpandInfos(viewDefinition, joinLevels, columnMappings);

    // --- Phase 3: 1:nキーマップ構築 ---
    const keyMaps = new Map<string, Map<string, string[][]>>();
    for (const join of viewDefinition.joins) {
        const joinTable = tableMap.get(join.targetTable);
        if (!joinTable) continue;
        const keyColumnIndex = joinTable.header.findIndex(col => col.name === join.targetColumn);
        if (keyColumnIndex === -1) continue;
        const keyMap = new Map<string, string[][]>();
        for (const row of joinTable.body) {
            const keyValue = row.values[keyColumnIndex];
            if (keyValue === '') continue;
            let rows = keyMap.get(keyValue);
            if (!rows) { rows = []; keyMap.set(keyValue, rows); }
            rows.push(row.values);
        }
        keyMaps.set(join.targetTable, keyMap);
    }

    // --- Phase 4: 行展開 ---
    const totalColumns = columnMappings.length;
    const compositeBody: EditorTableDataRow[] = [];
    const rowMetadata: ViewRowMetadata[] = [];

    for (let baseRowIdx = 0; baseRowIdx < baseTableData.body.length; baseRowIdx++) {
        const baseRow = baseTableData.body[baseRowIdx];

        // 初期composite行（ベーステーブル値のみ、JOIN列は空）
        const initialValues = new Array<string>(totalColumns).fill('');
        for (let i = 0; i < totalColumns; i++) {
            if (columnMappings[i].joinLevel === 0) {
                const srcIdx = columnMappings[i].sourceColumnIndex;
                initialValues[i] = srcIdx < baseRow.values.length ? baseRow.values[srcIdx] : '';
            }
        }

        const expandedRows = expandBaseRow(initialValues, expandInfosByLevel, maxLevel, keyMaps, columnMappings, totalColumns);
        for (const row of expandedRows) {
            compositeBody.push(new EditorTableDataRow(row.values));
            rowMetadata.push({ baseRowIndex: baseRowIdx, groupInfos: row.groupInfos, paddingColumns: row.padding });
        }
    }

    const compositeTableData = new EditorTableData(
        baseTableData.description, baseTableData.primaryKey, compositeHeader, compositeBody
    );

    return { compositeTableData, columnMappings, joinTableKeyMaps: keyMaps, rowMetadata };
}

/**
 * JoinExpandInfoの構築とレベルグループ化を行う
 * buildViewTableDataとrebuildExpandedRowsForBaseRowの共通処理
 */
function buildJoinExpandInfos(
    viewDefinition: ViewDefinition,
    joinLevels: Map<ViewJoinDefinition, number>,
    columnMappings: ViewColumnMapping[]
): { expandInfosByLevel: Map<number, JoinExpandInfo[]>; maxLevel: number } {
    const joinExpandInfos: JoinExpandInfo[] = [];
    for (const join of viewDefinition.joins) {
        const level = joinLevels.get(join) as number;
        const sourceIdx = findSourceCompositeIndex(join, viewDefinition.baseTable, viewDefinition.joins, columnMappings);
        const range = findJoinColumnRange(join, columnMappings);
        if (sourceIdx >= 0 && range.start >= 0) {
            joinExpandInfos.push({
                sourceCompositeIndex: sourceIdx, targetTable: join.targetTable,
                compositeColumnStart: range.start, compositeColumnEnd: range.end,
                rawSourceIndices: range.rawIndices, joinLevel: level,
            });
        }
    }
    joinExpandInfos.sort((a, b) => a.joinLevel - b.joinLevel);
    const expandInfosByLevel = new Map<number, JoinExpandInfo[]>();
    for (const info of joinExpandInfos) {
        let group = expandInfosByLevel.get(info.joinLevel);
        if (!group) { group = []; expandInfosByLevel.set(info.joinLevel, group); }
        group.push(info);
    }
    const maxLevel = joinExpandInfos.length > 0 ? Math.max(...joinExpandInfos.map(j => j.joinLevel)) : 0;
    return { expandInfosByLevel, maxLevel };
}

/**
 * 単一ベース行の値からJOIN展開を行い、展開済み行リストを返す
 * buildViewTableDataとrebuildExpandedRowsForBaseRowの共通処理
 */
function expandBaseRow(
    initialValues: string[], expandInfosByLevel: Map<number, JoinExpandInfo[]>,
    maxLevel: number, keyMaps: Map<string, Map<string, string[][]>>,
    columnMappings: ViewColumnMapping[], totalColumns: number
): ExpandedRowResult[] {
    let currentRows: ExpandingRow[] = [{
        values: [...initialValues], padding: new Array<boolean>(totalColumns).fill(false), groupInfos: [],
    }];
    for (let level = 1; level <= maxLevel; level++) {
        const infosAtLevel = expandInfosByLevel.get(level);
        if (!infosAtLevel) continue;
        const nextRows: ExpandingRow[] = [];
        for (const row of currentRows) {
            let expandedFromRow: ExpandingRow[] = [row];
            for (const info of infosAtLevel) {
                expandedFromRow = expandSingleJoin(expandedFromRow, info, keyMaps, columnMappings, totalColumns, level);
            }
            nextRows.push(...expandedFromRow);
        }
        currentRows = nextRows;
    }
    return currentRows.map(row => ({ values: row.values, padding: row.padding, groupInfos: row.groupInfos }));
}

function expandSingleJoin(
    rows: ExpandingRow[], info: JoinExpandInfo,
    keyMaps: Map<string, Map<string, string[][]>>,
    columnMappings: ViewColumnMapping[], totalColumns: number, level: number
): ExpandingRow[] {
    const result: ExpandingRow[] = [];
    const keyMap = keyMaps.get(info.targetTable);

    for (const existing of rows) {
        const keyValue = existing.values[info.sourceCompositeIndex];
        const matchedRows = keyMap && keyMap.has(keyValue) ? keyMap.get(keyValue) as string[][] : [];

        if (matchedRows.length === 0) {
            // LEFT JOIN: 空値のまま、グループ情報を追加
            result.push({
                values: [...existing.values],
                padding: [...existing.padding],
                groupInfos: [...existing.groupInfos, {
                    groupPosition: 0, groupSize: 1, sourceTable: info.targetTable, sourceKeyValue: keyValue,
                }],
            });
            continue;
        }

        for (let matchIdx = 0; matchIdx < matchedRows.length; matchIdx++) {
            const matchedRow = matchedRows[matchIdx];
            const newValues = [...existing.values];
            for (let ci = 0; ci < info.rawSourceIndices.length; ci++) {
                newValues[info.compositeColumnStart + ci] = matchedRow[info.rawSourceIndices[ci]];
            }
            const newPadding = [...existing.padding];
            if (matchIdx > 0) {
                // 2行目以降: 現レベルより低いレベルの列をパディングに設定
                for (let ci = 0; ci < totalColumns; ci++) {
                    if (columnMappings[ci].joinLevel < level) newPadding[ci] = true;
                }
            }
            result.push({
                values: newValues, padding: newPadding,
                groupInfos: [...existing.groupInfos, {
                    groupPosition: matchIdx, groupSize: matchedRows.length,
                    sourceTable: info.targetTable, sourceKeyValue: keyValue,
                }],
            });
        }
    }
    return result;
}

/**
 * 単一ベース行のJOIN展開結果
 */
export interface ExpandedRowResult {
    values: string[];
    padding: boolean[];
    groupInfos: ViewRowGroupInfo[];
}

/**
 * 単一ベース行のJOIN展開を再計算する
 * FK値変更時に行数を動的に更新するために使用される
 *
 * @param baseColumnValues ベーステーブル列のみ値が入り、JOIN列は空文字の配列（totalColumns長）
 * @param columnMappings ビュー列マッピング
 * @param viewDefinition ビュー定義
 * @param keyMaps 結合テーブルのキーマップ
 * @returns 展開された行データの配列
 */
export function rebuildExpandedRowsForBaseRow(
    baseColumnValues: string[], columnMappings: ViewColumnMapping[],
    viewDefinition: ViewDefinition, keyMaps: Map<string, Map<string, string[][]>>
): ExpandedRowResult[] {
    const joinLevels = resolveJoinLevels(viewDefinition);
    const { expandInfosByLevel, maxLevel } = buildJoinExpandInfos(viewDefinition, joinLevels, columnMappings);
    const totalColumns = columnMappings.length;
    return expandBaseRow(baseColumnValues, expandInfosByLevel, maxLevel, keyMaps, columnMappings, totalColumns);
}
