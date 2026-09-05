import {determineDisplayColumnName} from "../config/config";
import type {SearchResultInfo} from "../editor-api/editor-api-types";
import {EditorTable} from "../editor/editor-table";
import {matchesQuery, parseSearchQuery, type SearchOptions, type SearchQuery, shouldAutoEnableWholeWord} from "./search-query";
import {SearchDataProvider, type TableSearchData} from "./search-data-provider";
import type {InMemoryTableStore} from "../data/in-memory-table-store";

const SEARCH_CHUNK_BUDGET_MS = 8;
const SEARCH_CHUNK_MIN_CELLS = 500;

export interface SearchProgressInfo {
    completedTables: number;
    totalTables: number;
    percent: number;
    tableName: string;
    tableResults: SearchResultInfo[];
}

type LoadedTableSearchData =
    | {data: TableSearchData; error: null}
    | {data: null; error: unknown};

/**
 * SEARCHパネルとMCP公開APIで共有する検索エンジン。
 * 開いているテーブルは編集中の最新値を優先し、未オープンのテーブルはInMemoryTableStoreから読む。
 */
export class SearchEngine {
    private readonly openEditorTables: Map<string, EditorTable>;
    private readonly dataProvider: SearchDataProvider;

    constructor(openEditorTables: Map<string, EditorTable>, store: InMemoryTableStore) {
        this.openEditorTables = openEditorTables;
        this.dataProvider = new SearchDataProvider(openEditorTables, store);
    }

    async searchAsync(inputText: string, options: SearchOptions, shouldAbort: () => boolean, onProgress?: (progress: SearchProgressInfo) => void): Promise<SearchResultInfo[]> {
        const trimmedText = inputText.trim();
        if (trimmedText === '') return [];
        const effectiveOptions: SearchOptions = {
            caseSensitive: options.caseSensitive,
            wholeWord: options.wholeWord || shouldAutoEnableWholeWord(trimmedText),
            useRegex: options.useRegex,
        };
        const query = parseSearchQuery(trimmedText, effectiveOptions);
        return this.searchQueryAsync(query, shouldAbort, onProgress);
    }

    /**
     * 全テーブルを横断して検索する。
     * テーブルデータ取得は並列に開始し、検索処理はテーブルごとに
     * ブラウザへ制御を返しながら進める。
     */
    private async searchQueryAsync(query: SearchQuery, shouldAbort: () => boolean, onProgress?: (progress: SearchProgressInfo) => void): Promise<SearchResultInfo[]> {
        const tableNames = await this.dataProvider.loadAllTableNamesAsync();
        if (shouldAbort()) return [];
        const targetTables = query.kind === 'filter'
            ? tableNames.filter(name => name === query.tableName)
            : tableNames;
        const totalTables = targetTables.length;
        if (totalTables === 0) return [];
        const tableDataLoads: Array<Promise<LoadedTableSearchData>> = targetTables.map(tableName => {
            return this.dataProvider.getTableDataAsync(tableName).then(
                data => ({data, error: null}),
                error => ({data: null, error}),
            );
        });
        const loadedTables = await Promise.all(tableDataLoads);
        if (shouldAbort()) return [];
        const tableDataResults: TableSearchData[] = [];
        for (const loadedTable of loadedTables) {
            if (loadedTable.data === null) throw loadedTable.error;
            tableDataResults.push(loadedTable.data);
        }
        const totalCells = Math.max(1, tableDataResults.reduce((sum, tableData) => {
            return sum + this.countSearchCells(tableData);
        }, 0));
        const results: SearchResultInfo[] = [];
        let scannedCells = 0;
        let lastProgressPercent = -1;
        const emitProgress = (progress: SearchProgressInfo): void => {
            if (shouldAbort()) return;
            if (progress.tableResults.length === 0 && progress.percent === lastProgressPercent) return;
            lastProgressPercent = progress.percent;
            onProgress?.(progress);
        };
        for (let i = 0; i < tableDataResults.length; i++) {
            if (shouldAbort()) return [];
            if (i > 0) {
                await this.yieldToBrowser();
            }
            if (shouldAbort()) return [];
            const tableData = tableDataResults[i];
            const tableResults: SearchResultInfo[] = [];
            const tableScannedCells = await this.searchInTableAsync(query, tableData, tableResults, shouldAbort, (scannedCellsInTable) => {
                const percent = Math.min(99, Math.floor(((scannedCells + scannedCellsInTable) / totalCells) * 100));
                emitProgress({
                    completedTables: i,
                    totalTables,
                    percent,
                    tableName: tableData.tableName,
                    tableResults: [],
                });
            });
            if (shouldAbort()) return [];
            scannedCells += tableScannedCells;
            results.push(...tableResults);
            emitProgress({
                completedTables: i + 1,
                totalTables,
                percent: Math.floor((scannedCells / totalCells) * 100),
                tableName: tableData.tableName,
                tableResults,
            });
        }
        return results;
    }

    /**
     * テーブル内でクエリに一致するセルを検索する。
     */
    private async searchInTableAsync(query: SearchQuery, tableData: TableSearchData, results: SearchResultInfo[], shouldAbort: () => boolean, onProgress: (scannedCells: number) => void): Promise<number> {
        const pkColumnIndex = tableData.csvHeader.indexOf(tableData.primaryKeyColumnName);
        const options: SearchOptions = {
            caseSensitive: query.caseSensitive,
            wholeWord: query.wholeWord,
            useRegex: query.useRegex,
        };
        let scannedCells = 0;
        let cellsSinceYield = 0;
        let chunkStartTime = performance.now();
        for (let rowIndex = 0; rowIndex < tableData.csvBody.length; rowIndex++) {
            if (shouldAbort()) return scannedCells;
            const row = tableData.csvBody[rowIndex];
            const pkValue = pkColumnIndex !== -1 ? row[pkColumnIndex] : String(rowIndex);
            for (let colIndex = 0; colIndex < row.length; colIndex++) {
                let matches = false;
                if (query.kind === 'filter') {
                    const colName = tableData.csvHeader[colIndex];
                    matches = colName === query.columnName && matchesQuery(row[colIndex], query.value, options);
                } else {
                    matches = matchesQuery(row[colIndex], query.text, options);
                }
                if (matches) {
                    const columnName = colIndex < tableData.csvHeader.length ? tableData.csvHeader[colIndex] : '';
                    results.push({
                        tableName: tableData.tableName,
                        rowIndex,
                        columnName,
                        columnIndex: colIndex,
                        pkValue,
                        value: row[colIndex],
                        referenceDisplayText: this.resolveReferenceDisplay(tableData, colIndex, row[colIndex]),
                    });
                }
                scannedCells++;
                cellsSinceYield++;
                if (
                    cellsSinceYield >= SEARCH_CHUNK_MIN_CELLS
                    && performance.now() - chunkStartTime >= SEARCH_CHUNK_BUDGET_MS
                ) {
                    onProgress(scannedCells);
                    await this.yieldToBrowser();
                    if (shouldAbort()) return scannedCells;
                    cellsSinceYield = 0;
                    chunkStartTime = performance.now();
                }
            }
        }
        return scannedCells;
    }

    private yieldToBrowser(): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, 0));
    }

    private countSearchCells(tableData: TableSearchData): number {
        let cellCount = 0;
        for (const row of tableData.csvBody) {
            cellCount += row.length;
        }
        return cellCount;
    }

    /**
     * 参照列の表示テキストを同期的に解決する。
     * 参照先テーブルが開いている場合のみ最新の編集中表示を返す。
     */
    private resolveReferenceDisplay(tableData: TableSearchData, colIndex: number, cellValue: string): string {
        if (colIndex >= tableData.header.length) return '';
        const columnDef = tableData.header[colIndex];
        if (columnDef.reference === '') return '';
        const dotIndex = columnDef.reference.indexOf('.');
        if (dotIndex === -1) return '';
        const refTableName = columnDef.reference.substring(0, dotIndex);
        if (refTableName.startsWith('$')) return '';
        const refEditorTable = this.openEditorTables.get(refTableName);
        if (!refEditorTable) return '';
        return this.findDisplayTextFromEditorTable(refEditorTable, cellValue);
    }

    /**
     * EditorTableから指定ID値の表示テキストを検索する。
     */
    private findDisplayTextFromEditorTable(editorTable: EditorTable, idValue: string): string {
        const columnCount = editorTable.getColumnCount();
        const rowCount = editorTable.getLogicalRowCount();
        const headerNames: string[] = [];
        for (let c = 0; c < columnCount; c++) {
            headerNames.push(editorTable.getColumnHeaderValue(c));
        }
        const displayColName = determineDisplayColumnName(headerNames);
        if (displayColName === '') return '';
        const displayColIndex = headerNames.indexOf(displayColName);
        if (displayColIndex === -1) return '';
        const pkColumnName = editorTable.getTableData().primaryKeyColumns[0];
        let pkColIndex = -1;
        for (let c = 0; c < columnCount; c++) {
            if (editorTable.getColumnHeaderValue(c) === pkColumnName) {
                pkColIndex = c;
                break;
            }
        }
        if (pkColIndex === -1) return '';
        for (let r = 1; r < rowCount; r++) {
            if (editorTable.getCellValueAt(r, pkColIndex + editorTable.dataColumnOffset()) === idValue) {
                return editorTable.getCellValueAt(r, displayColIndex + editorTable.dataColumnOffset());
            }
        }
        return '';
    }
}
