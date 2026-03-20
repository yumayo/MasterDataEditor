import {Tab} from "./tab";
import {SearchDataProvider, TableSearchData} from "./search-data-provider";
import {parseSearchQuery, matchesQuery, SearchOptions, SearchQuery} from "./search-query";
import {EditorTable} from "./editor-table";
import {determineDisplayColumnName} from "./config";
import {appendHighlightedSegments} from "./fuzzy-search";

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
    /** ユーザーが手動でONにしたかどうか */
    private wholeWordManual: boolean;
    /** 数値入力による自動ONかどうか */
    private wholeWordAuto: boolean;
    private useRegex: boolean;
    private debounceTimer: ReturnType<typeof setTimeout> | false;
    /** レースコンディション防止用のリクエストID。非同期検索の結果が古い場合に破棄するために使う */
    private searchRequestId: number;
    /** wholeWordボタン要素（自動ON/OFFで状態更新するためフィールドで保持） */
    private readonly wholeWordButton: HTMLElement;

    constructor(tab: Tab, openEditorTables: Map<string, EditorTable>) {
        this.tab = tab;
        this.openEditorTables = openEditorTables;
        this.dataProvider = new SearchDataProvider(openEditorTables);
        this.caseSensitive = false;
        this.wholeWordManual = false;
        this.wholeWordAuto = false;
        this.useRegex = false;
        this.debounceTimer = false;
        this.searchRequestId = 0;

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
            this.handleInputChange();
        });
        inputRow.appendChild(this.inputElement);

        // オプションボタン
        const optionsRow = document.createElement('div');
        optionsRow.classList.add('search-panel-options');
        controlsElement.appendChild(optionsRow);

        optionsRow.appendChild(this.createOptionButton('caseSensitive', 'Aa'));
        this.wholeWordButton = this.createOptionButton('wholeWord', '|ab|');
        // 初期状態（OFF）のtitleを設定する
        this.wholeWordButton.title = '単語単位で検索';
        optionsRow.appendChild(this.wholeWordButton);
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
                button.classList.toggle('search-option-active', this.caseSensitive);
            } else if (option === 'wholeWord') {
                // 手動トグル
                this.wholeWordManual = !this.wholeWordManual;
                this.updateWholeWordButtonState();
            } else {
                this.useRegex = !this.useRegex;
                button.classList.toggle('search-option-active', this.useRegex);
            }
            this.scheduleSearch();
        });
        return button;
    }

    /**
     * 入力変更時の処理：数値自動wholeWordの判定 + 検索スケジュール
     */
    private handleInputChange(): void {
        const value = this.inputElement.value;
        const isNumericOnly = /^\d+$/.test(value);
        if (isNumericOnly) {
            this.wholeWordAuto = true;
        } else {
            this.wholeWordAuto = false;
        }
        this.updateWholeWordButtonState();
        this.scheduleSearch();
    }

    /**
     * wholeWordボタンの表示状態を実効値（wholeWordManual || wholeWordAuto）に同期する。
     * 自動ON時はtitleとdata-auto-active属性でユーザーに理由を伝える。
     */
    private updateWholeWordButtonState(): void {
        const effective = this.wholeWordManual || this.wholeWordAuto;
        this.wholeWordButton.classList.toggle('search-option-active', effective);
        if (this.wholeWordAuto) {
            this.wholeWordButton.title = '数値入力のため単語単位検索を自動でONにしました';
            this.wholeWordButton.dataset['autoActive'] = 'true';
        } else {
            this.wholeWordButton.title = '単語単位で検索';
            delete this.wholeWordButton.dataset['autoActive'];
        }
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
     * 検索を実行して結果をDOMに反映する。
     * searchRequestId パターンで古いリクエストの結果を破棄してレースコンディションを防ぐ。
     */
    private async executeSearchAsync(): Promise<void> {
        const requestId = ++this.searchRequestId;
        const inputText = this.inputElement.value.trim();
        if (inputText === '') {
            this.resultsElement.replaceChildren();
            return;
        }
        // 空文字でないことが確定してからローディング表示を開始する
        this.resultsElement.classList.add('searching');
        try {
            const options: SearchOptions = {
                caseSensitive: this.caseSensitive,
                wholeWord: this.wholeWordManual || this.wholeWordAuto,
                useRegex: this.useRegex,
            };
            const query = parseSearchQuery(inputText, options);
            const results = await this.searchAsync(query, requestId);
            // await の間に新しい検索が始まっていた場合は結果を破棄する
            if (requestId !== this.searchRequestId) return;
            this.renderResults(results, inputText);
        } finally {
            // 自分が最新リクエストの場合のみ除去する（新しいリクエストが既に付与している場合は触らない）
            if (requestId === this.searchRequestId) {
                this.resultsElement.classList.remove('searching');
            }
        }
    }

    /**
     * 全テーブルを横断して検索する。
     * テーブルデータ取得は Promise.all で並列化し、検索処理はテーブルごとに
     * setTimeout(0) でメインスレッドに制御を返してキー入力のカクつきを防ぐ。
     * requestId が変化した時点で中断して空配列を返す。
     */
    private async searchAsync(query: SearchQuery, requestId: number): Promise<SearchResult[]> {
        const tableNames = await this.dataProvider.loadAllTableNamesAsync();
        // テーブル名取得後に新しいリクエストが来ていれば中断する
        if (requestId !== this.searchRequestId) return [];
        // フィルタクエリの場合は対象テーブルのみ検索
        const targetTables = query.kind === 'filter'
            ? tableNames.filter(name => name === query.tableName)
            : tableNames;
        // テーブルデータをすべて並列取得する
        const tableDataResults = await Promise.all(
            targetTables.map(tableName => this.dataProvider.getTableDataAsync(tableName))
        );
        // 並列取得完了後に新しいリクエストが来ていれば中断する
        if (requestId !== this.searchRequestId) return [];
        const results: SearchResult[] = [];
        for (let i = 0; i < tableDataResults.length; i++) {
            if (requestId !== this.searchRequestId) return [];
            // 2テーブル目以降の前にメインスレッドに制御を返してキー入力のカクつきを防ぐ
            if (i > 0) await new Promise(resolve => setTimeout(resolve, 0));
            if (requestId !== this.searchRequestId) return [];
            this.searchInTable(query, tableDataResults[i], results);
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
        // 表示列を特定（EditorTableのヘッダーから列名配列を構築して共通関数で決定）
        const headerNames: string[] = [];
        for (let c = 0; c < columnCount; c++) {
            headerNames.push(editorTable.getColumnHeaderValue(c));
        }
        const displayColName = determineDisplayColumnName(headerNames);
        if (displayColName === '') return '';
        const displayColIndex = headerNames.indexOf(displayColName);
        // PKColumnを特定（テーブルスキーマのprimaryKeyColumnsから最初のPK列名を使用）
        const pkColumnName = editorTable.getTableData().primaryKeyColumns[0];
        let pkColIndex = -1;
        for (let c = 0; c < columnCount; c++) {
            if (editorTable.getColumnHeaderValue(c) === pkColumnName) {
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
     *
     * @param results 検索結果
     * @param searchText ハイライト用の検索テキスト
     */
    private renderResults(results: SearchResult[], searchText: string): void {
        this.resultsElement.replaceChildren();
        for (const result of results) {
            const item = document.createElement('div');
            item.classList.add('search-result-item');
            // 場所表示
            const location = document.createElement('div');
            location.classList.add('search-result-location');
            location.textContent = `${result.tableName}.${result.columnName}`;
            item.appendChild(location);
            // PK値表示
            const pkElement = document.createElement('span');
            pkElement.classList.add('search-result-pk');
            pkElement.textContent = result.pkValue;
            pkElement.title = '主キー値';
            item.appendChild(pkElement);
            // 値表示（ハイライト付き）
            const valueElement = document.createElement('div');
            valueElement.classList.add('search-result-value');
            appendHighlightedSegments(valueElement, result.value, searchText);
            item.appendChild(valueElement);
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
