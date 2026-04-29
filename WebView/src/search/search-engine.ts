import {determineDisplayColumnName} from "../config/config";
import type {SearchResultInfo} from "../editor-api/editor-api-types";
import {EditorTable} from "../editor/editor-table";
import {matchesQuery, parseSearchQuery, type SearchOptions, type SearchQuery, shouldAutoEnableWholeWord} from "./search-query";
import {SearchDataProvider, type TableSearchData} from "./search-data-provider";

/**
 * SEARCHパネルとMCP公開APIで共有する検索エンジン。
 * 開いているテーブルは編集中の最新値を優先し、未オープンのテーブルはCSVから読む。
 */
export class SearchEngine {
    private readonly openEditorTables: Map<string, EditorTable>;
    private readonly dataProvider: SearchDataProvider;

    constructor(openEditorTables: Map<string, EditorTable>) {
        this.openEditorTables = openEditorTables;
        this.dataProvider = new SearchDataProvider(openEditorTables);
    }

    async searchAsync(inputText: string, options: SearchOptions, shouldAbort: () => boolean): Promise<SearchResultInfo[]> {
        const trimmedText = inputText.trim();
        if (trimmedText === '') return [];
        const effectiveOptions: SearchOptions = {
            caseSensitive: options.caseSensitive,
            wholeWord: options.wholeWord || shouldAutoEnableWholeWord(trimmedText),
            useRegex: options.useRegex,
        };
        const query = parseSearchQuery(trimmedText, effectiveOptions);
        return this.searchQueryAsync(query, shouldAbort);
    }

    /**
     * 全テーブルを横断して検索する。
     * テーブルデータ取得は Promise.all で並列化し、検索処理はテーブルごとに
     * setTimeout(0) でメインスレッドに制御を返してキー入力のカクつきを防ぐ。
     */
    private async searchQueryAsync(query: SearchQuery, shouldAbort: () => boolean): Promise<SearchResultInfo[]> {
        const tableNames = await this.dataProvider.loadAllTableNamesAsync();
        if (shouldAbort()) return [];
        const targetTables = query.kind === 'filter'
            ? tableNames.filter(name => name === query.tableName)
            : tableNames;
        const tableDataResults = await Promise.all(targetTables.map(tableName => this.dataProvider.getTableDataAsync(tableName)));
        if (shouldAbort()) return [];
        const results: SearchResultInfo[] = [];
        for (let i = 0; i < tableDataResults.length; i++) {
            if (shouldAbort()) return [];
            if (i > 0) {
                await new Promise<void>(resolve => setTimeout(resolve, 0));
            }
            if (shouldAbort()) return [];
            this.searchInTable(query, tableDataResults[i], results);
        }
        return results;
    }

    /**
     * テーブル内でクエリに一致するセルを検索する。
     */
    private searchInTable(query: SearchQuery, tableData: TableSearchData, results: SearchResultInfo[]): void {
        const pkColumnIndex = tableData.csvHeader.indexOf(tableData.primaryKeyColumnName);
        const options: SearchOptions = {
            caseSensitive: query.caseSensitive,
            wholeWord: query.wholeWord,
            useRegex: query.useRegex,
        };
        for (let rowIndex = 0; rowIndex < tableData.csvBody.length; rowIndex++) {
            const row = tableData.csvBody[rowIndex];
            const pkValue = pkColumnIndex !== -1 ? row[pkColumnIndex] : String(rowIndex);
            for (let colIndex = 0; colIndex < row.length; colIndex++) {
                if (query.kind === 'filter') {
                    const colName = tableData.csvHeader[colIndex];
                    if (colName !== query.columnName) continue;
                    if (!matchesQuery(row[colIndex], query.value, options)) continue;
                } else {
                    if (!matchesQuery(row[colIndex], query.text, options)) continue;
                }
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
        }
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
