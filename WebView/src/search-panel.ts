import {Tab} from "./tab";
import {SearchDataProvider, TableSearchData} from "./search-data-provider";
import {parseSearchQuery, matchesQuery, SearchOptions, SearchQuery} from "./search-query";
import {EditorTable} from "./editor-table";
import {config} from "./config";

/**
 * 検索結果1件分の情報
 */
interface SearchResult {
    tableName: string;
    columnName: string;
    columnIndex: number;
    pkValue: string;
    value: string;
    referenceDisplayText: string;
}

/**
 * SEARCHパネル
 * テーブル横断の全文検索とクエリ式フィルタを提供する
 */
export class SearchPanel {
    private readonly element: HTMLElement;
    private readonly inputElement: HTMLInputElement;
    private readonly resultsElement: HTMLElement;
    private readonly tab: Tab;
    private readonly dataProvider: SearchDataProvider;
    private readonly openEditorTables: Map<string, EditorTable>;
    private caseSensitive: boolean;
    private wholeWord: boolean;
    private useRegex: boolean;
    private debounceTimer: ReturnType<typeof setTimeout> | false;

    constructor(tab: Tab, openEditorTables: Map<string, EditorTable>) {
        this.tab = tab;
        this.openEditorTables = openEditorTables;
        this.dataProvider = new SearchDataProvider(openEditorTables);
        this.caseSensitive = false;
        this.wholeWord = false;
        this.useRegex = false;
        this.debounceTimer = false;

        // パネルルート
        this.element = document.createElement('div');
        this.element.classList.add('sidebar-panel', 'search-panel');

        // ヘッダー
        const headerElement = document.createElement('div');
        headerElement.classList.add('sidebar-panel-header');
        headerElement.textContent = 'SEARCH';
        this.element.appendChild(headerElement);

        // コントロール領域
        const controlsElement = document.createElement('div');
        controlsElement.classList.add('search-panel-controls');
        this.element.appendChild(controlsElement);

        // 入力行
        const inputRow = document.createElement('div');
        inputRow.classList.add('search-panel-input-row');
        controlsElement.appendChild(inputRow);

        this.inputElement = document.createElement('input');
        this.inputElement.classList.add('search-panel-input');
        this.inputElement.type = 'text';
        this.inputElement.placeholder = '検索...';
        this.inputElement.addEventListener('input', () => {
            this.scheduleSearch();
        });
        inputRow.appendChild(this.inputElement);

        // オプションボタン
        const optionsRow = document.createElement('div');
        optionsRow.classList.add('search-panel-options');
        controlsElement.appendChild(optionsRow);

        optionsRow.appendChild(this.createOptionButton('caseSensitive', 'Aa'));
        optionsRow.appendChild(this.createOptionButton('wholeWord', '|ab|'));
        optionsRow.appendChild(this.createOptionButton('regex', '.*'));

        // 検索結果
        this.resultsElement = document.createElement('div');
        this.resultsElement.classList.add('search-panel-results');
        this.element.appendChild(this.resultsElement);
    }

    /**
     * パネルを親要素に追加する
     */
    appendTo(parent: HTMLElement): void {
        parent.appendChild(this.element);
    }

    /**
     * パネルを表示する
     */
    show(): void {
        this.element.classList.add('sidebar-panel-active');
    }

    /**
     * パネルを非表示にする
     */
    hide(): void {
        this.element.classList.remove('sidebar-panel-active');
    }

    /**
     * 入力ボックスにフォーカスする
     */
    focus(): void {
        this.inputElement.focus();
    }

    /**
     * オプションボタンを生成する
     */
    private createOptionButton(option: 'caseSensitive' | 'wholeWord' | 'regex', label: string): HTMLElement {
        const button = document.createElement('button');
        button.classList.add('search-option-button');
        button.dataset.option = option;
        button.textContent = label;
        button.addEventListener('click', () => {
            if (option === 'caseSensitive') {
                this.caseSensitive = !this.caseSensitive;
            } else if (option === 'wholeWord') {
                this.wholeWord = !this.wholeWord;
            } else {
                this.useRegex = !this.useRegex;
            }
            button.classList.toggle('search-option-active', this.getOptionValue(option));
            this.scheduleSearch();
        });
        return button;
    }

    /**
     * オプションの現在値を取得する
     */
    private getOptionValue(option: 'caseSensitive' | 'wholeWord' | 'regex'): boolean {
        if (option === 'caseSensitive') return this.caseSensitive;
        if (option === 'wholeWord') return this.wholeWord;
        return this.useRegex;
    }

    /**
     * 150msデバウンスで検索を実行する
     */
    private scheduleSearch(): void {
        if (this.debounceTimer !== false) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = false;
            this.executeSearchAsync();
        }, 150);
    }

    /**
     * 検索を実行して結果をDOMに反映する
     */
    private async executeSearchAsync(): Promise<void> {
        const inputText = this.inputElement.value.trim();
        if (inputText === '') {
            this.resultsElement.replaceChildren();
            return;
        }
        const options: SearchOptions = {
            caseSensitive: this.caseSensitive,
            wholeWord: this.wholeWord,
            useRegex: this.useRegex,
        };
        const query = parseSearchQuery(inputText, options);
        const results = await this.searchAsync(query);
        this.renderResults(results);
    }

    /**
     * 全テーブルを横断して検索する
     */
    private async searchAsync(query: SearchQuery): Promise<SearchResult[]> {
        const results: SearchResult[] = [];
        const tableNames = await this.dataProvider.loadAllTableNamesAsync();
        // フィルタクエリの場合は対象テーブルのみ検索
        const targetTables = query.kind === 'filter'
            ? tableNames.filter(name => name === query.tableName)
            : tableNames;
        for (const tableName of targetTables) {
            try {
                const tableData = await this.dataProvider.getTableDataAsync(tableName);
                this.searchInTable(query, tableData, results);
            } catch {
                // テーブル読み込みエラーは無視して次へ
                continue;
            }
        }
        return results;
    }

    /**
     * テーブル内でクエリに一致するセルを検索する
     */
    private searchInTable(query: SearchQuery, tableData: TableSearchData, results: SearchResult[]): void {
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
                // フィルタクエリの場合は対象列のみ
                if (query.kind === 'filter') {
                    const colName = tableData.csvHeader[colIndex];
                    if (colName !== query.columnName) continue;
                    if (!matchesQuery(row[colIndex], query.value, options)) continue;
                } else {
                    if (!matchesQuery(row[colIndex], query.text, options)) continue;
                }
                const columnName = colIndex < tableData.csvHeader.length
                    ? tableData.csvHeader[colIndex]
                    : '';
                // 参照列の表示テキストを解決
                const referenceDisplayText = this.resolveReferenceDisplay(tableData, colIndex, row[colIndex]);
                results.push({
                    tableName: tableData.tableName,
                    columnName,
                    columnIndex: colIndex,
                    pkValue,
                    value: row[colIndex],
                    referenceDisplayText,
                });
            }
        }
    }

    /**
     * 参照列の表示テキストを同期的に解決する
     * ReferenceDataCacheにキャッシュがあれば利用する
     */
    private resolveReferenceDisplay(tableData: TableSearchData, colIndex: number, cellValue: string): string {
        if (colIndex >= tableData.header.length) return '';
        const columnDef = tableData.header[colIndex];
        if (columnDef.reference === '') return '';
        // 参照式からテーブル名を抽出（単純参照: テーブル名.列名）
        const dotIndex = columnDef.reference.indexOf('.');
        if (dotIndex === -1) return '';
        const refTableName = columnDef.reference.substring(0, dotIndex);
        // $で始まる場合は動的参照なのでスキップ
        if (refTableName.startsWith('$')) return '';
        // openEditorTablesからReferenceDataCacheを利用する代わりに、
        // 直接参照先テーブルのインメモリデータから表示テキストを検索
        const refEditorTable = this.openEditorTables.get(refTableName);
        if (refEditorTable) {
            return this.findDisplayTextFromEditorTable(refEditorTable, cellValue);
        }
        return '';
    }

    /**
     * EditorTableから指定ID値の表示テキストを検索する
     */
    private findDisplayTextFromEditorTable(editorTable: EditorTable, idValue: string): string {
        const columnCount = editorTable.getColumnCount();
        const rowCount = editorTable.getRowCount();
        // 表示列を特定
        let displayColIndex = -1;
        for (let c = 0; c < columnCount; c++) {
            const colName = editorTable.getColumnHeaderValue(c);
            for (const priority of config.referenceDisplayColumnPriority) {
                if (colName === priority) {
                    displayColIndex = c;
                    break;
                }
            }
            if (displayColIndex !== -1) break;
        }
        if (displayColIndex === -1) return '';
        // PKColumnを特定
        let pkColIndex = -1;
        for (let c = 0; c < columnCount; c++) {
            if (editorTable.getColumnHeaderValue(c) === config.primaryKeyColumnName) {
                pkColIndex = c;
                break;
            }
        }
        if (pkColIndex === -1) return '';
        // ID値に一致する行を探す
        for (let r = 1; r < rowCount; r++) {
            if (editorTable.getCellValueAt(r, pkColIndex + 1) === idValue) {
                return editorTable.getCellValueAt(r, displayColIndex + 1);
            }
        }
        return '';
    }

    /**
     * 検索結果をDOMに描画する
     */
    private renderResults(results: SearchResult[]): void {
        this.resultsElement.replaceChildren();
        for (const result of results) {
            const item = document.createElement('div');
            item.classList.add('search-result-item');
            // 場所表示
            const location = document.createElement('div');
            location.classList.add('search-result-location');
            location.textContent = `${result.tableName}.${result.columnName}`;
            item.appendChild(location);
            // 値表示
            const value = document.createElement('div');
            value.classList.add('search-result-value');
            value.textContent = result.value;
            item.appendChild(value);
            // 参照表示テキスト（参照列の場合のみ）
            if (result.referenceDisplayText !== '') {
                const hint = document.createElement('div');
                hint.classList.add('search-result-reference-hint');
                hint.textContent = `(${result.referenceDisplayText})`;
                item.appendChild(hint);
            }
            // クリックで該当セルにジャンプ
            item.addEventListener('click', () => {
                this.tab.navigateToTableCell(result.tableName, result.pkValue, result.columnIndex);
            });
            this.resultsElement.appendChild(item);
        }
    }
}
