import {Tab} from "../tabs/tab";
import type {SearchResultInfo} from "../editor-api/editor-api-types";
import {EditorTable} from "../editor/editor-table";
import {appendHighlightedSegments} from "../search/fuzzy-search";
import {CellChange, CellChangeCommand, CompositeCommand} from "../editor/command";
import {CellRange} from "../editor/selection";
import {replaceWithQuery, shouldAutoEnableWholeWord, type SearchOptions} from "../search/search-query";
import {SearchEngine} from "../search/search-engine";
import type {InMemoryTableStore} from "../data/in-memory-table-store";

/**
 * SEARCHパネル
 * テーブル横断の全文検索とクエリ式フィルタを提供する
 * 置換モード時は開いているテーブルのセルを一括/個別置換できる
 */
export class SearchPanel {
    private readonly element: HTMLElement;
    private readonly inputElement: HTMLInputElement;
    private readonly resultsElement: HTMLElement;
    private readonly tab: Tab;
    private readonly searchEngine: SearchEngine;
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
    /** 置換入力行のコンテナ */
    private readonly replaceRowElement: HTMLElement;
    /** 置換入力欄 */
    private readonly replaceInputElement: HTMLInputElement;
    /** 1件置換ボタン */
    private readonly replaceButton: HTMLButtonElement;
    /** すべて置換ボタン */
    private readonly replaceAllButton: HTMLButtonElement;
    /** 置換モードかどうか */
    private replaceMode: boolean;
    /** 置換モード折りたたみトグル（chevronアイコンボタン） */
    private readonly chevronToggle: HTMLButtonElement;
    /** カレントマッチのインデックス（-1で未選択） */
    private focusedResultIndex: number;
    /** 最新の検索結果（置換実行時に参照する） */
    private currentResults: SearchResultInfo[];

    // SVGアイコン定数（16x16 viewBox、VSCode Codicons準拠のパスデータ）
    /** chevron-right: 折りたたみ状態（置換非表示） */
    private static readonly CHEVRON_RIGHT_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5.7 13.7L5 13l5-5-5-5 .7-.7L11.4 8l-5.7 5.7z"/></svg>';
    /** chevron-down: 展開状態（置換表示） */
    private static readonly CHEVRON_DOWN_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M2.3 5.7L3 5l5 5 5-5 .7.7L8 11.4 2.3 5.7z"/></svg>';
    /** replace: 1件置換アイコン（VSCode Codicons準拠） */
    private static readonly REPLACE_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M11.6 2.7c.3-.3.3-.8 0-1.1-.3-.3-.8-.3-1.1 0L7.4 4.7l1.1 1.1 3.1-3.1zM3 7h5.2l1.8-1.8L9.7 4.9 8.4 6.2H3c-.6 0-1 .4-1 1v2c0 .6.4 1 1 1h3v2l3-2.5L6 7.2V8H3V7zm10 2c0-.6-.4-1-1-1h-1v1h1v2H8.6l-1.3 1H12c.6 0 1-.4 1-1V9z"/></svg>';
    /** replace-all: 全置換アイコン（VSCode Codicons準拠） */
    private static readonly REPLACE_ALL_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M11.6 2.7c.3-.3.3-.8 0-1.1-.3-.3-.8-.3-1.1 0L7.4 4.7l1.1 1.1 3.1-3.1zM3 7h5.2l1.8-1.8-.3-.3-1.3 1.3H3c-.6 0-1 .4-1 1v2c0 .6.4 1 1 1h3v2l3-2.5L6 7.2V8H3V7zm10 2c0-.6-.4-1-1-1h-1v1h1v2H8.6l-1.3 1H12c.6 0 1-.4 1-1V9z"/><path d="M14.6 4.7c.3-.3.3-.8 0-1.1-.3-.3-.8-.3-1.1 0l-1.1 1.1 1.1 1.1 1.1-1.1z" opacity="0.6"/></svg>';

    constructor(tab: Tab, openEditorTables: Map<string, EditorTable>, store: InMemoryTableStore) {
        this.tab = tab;
        this.openEditorTables = openEditorTables;
        this.searchEngine = new SearchEngine(openEditorTables, store);
        this.caseSensitive = false;
        this.wholeWordManual = false;
        this.wholeWordAuto = false;
        this.useRegex = false;
        this.debounceTimer = false;
        this.searchRequestId = 0;
        this.replaceMode = false;
        this.focusedResultIndex = -1;
        this.currentResults = [];

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

        // 検索入力行（chevronトグル + 入力欄の横並び）
        const inputRow = document.createElement('div');
        inputRow.classList.add('search-panel-input-row');
        controlsElement.appendChild(inputRow);

        // 置換モード折りたたみトグル（chevronアイコン、縦長）
        this.chevronToggle = document.createElement('button');
        this.chevronToggle.classList.add('search-replace-toggle');
        this.chevronToggle.setAttribute('aria-label', '置換モードを切り替え');
        this.chevronToggle.setAttribute('aria-expanded', 'false');
        this.chevronToggle.title = '置換モードを切り替え';
        this.chevronToggle.innerHTML = SearchPanel.CHEVRON_RIGHT_SVG;
        this.chevronToggle.addEventListener('click', () => {
            if (this.replaceMode) {
                this.hideReplaceMode();
            } else {
                this.showReplaceMode();
            }
        });
        inputRow.appendChild(this.chevronToggle);

        // 検索入力欄コンテナ（入力欄 + オプションボタンを内包する）
        const inputWrapper = document.createElement('div');
        inputWrapper.classList.add('search-panel-input-wrapper');

        this.inputElement = document.createElement('input');
        this.inputElement.classList.add('search-panel-input');
        this.inputElement.type = 'text';
        this.inputElement.placeholder = '検索...';
        this.inputElement.addEventListener('input', () => {
            this.handleInputChange();
        });
        inputWrapper.appendChild(this.inputElement);

        // オプションボタン（検索入力欄の中に配置）
        const optionsRow = document.createElement('div');
        optionsRow.classList.add('search-panel-options');
        optionsRow.appendChild(this.createOptionButton('caseSensitive', 'Aa', '大文字小文字を区別'));
        this.wholeWordButton = this.createOptionButton('wholeWord', '|ab|', '単語単位で検索');
        optionsRow.appendChild(this.wholeWordButton);
        optionsRow.appendChild(this.createOptionButton('regex', '.*', '正規表現'));
        inputWrapper.appendChild(optionsRow);

        inputRow.appendChild(inputWrapper);

        // 置換入力行（初期状態では非表示）
        this.replaceRowElement = document.createElement('div');
        this.replaceRowElement.classList.add('search-panel-replace-row');
        this.replaceRowElement.style.display = 'none';
        controlsElement.appendChild(this.replaceRowElement);

        this.replaceInputElement = document.createElement('input');
        this.replaceInputElement.classList.add('search-panel-replace-input');
        this.replaceInputElement.type = 'text';
        this.replaceInputElement.placeholder = '置換...';
        this.replaceInputElement.setAttribute('aria-label', '置換後のテキスト');
        // 置換テキスト変更時にプレビューを更新する
        this.replaceInputElement.addEventListener('input', () => {
            this.updateReplacePreviews();
        });
        this.replaceRowElement.appendChild(this.replaceInputElement);

        // 1件置換ボタン（SVGアイコン）
        this.replaceButton = document.createElement('button');
        this.replaceButton.classList.add('search-replace-button');
        this.replaceButton.setAttribute('aria-label', '現在のマッチを1件置換');
        this.replaceButton.title = '置換';
        this.replaceButton.innerHTML = SearchPanel.REPLACE_SVG;
        this.replaceButton.addEventListener('click', () => {
            this.replaceCurrentMatch();
        });
        this.replaceRowElement.appendChild(this.replaceButton);

        // すべて置換ボタン（SVGアイコン）
        this.replaceAllButton = document.createElement('button');
        this.replaceAllButton.classList.add('search-replace-all-button');
        this.replaceAllButton.setAttribute('aria-label', 'すべてのマッチを一括置換');
        this.replaceAllButton.title = 'すべて置換';
        this.replaceAllButton.innerHTML = SearchPanel.REPLACE_ALL_SVG;
        this.replaceAllButton.addEventListener('click', () => {
            this.replaceAllMatches();
        });
        this.replaceRowElement.appendChild(this.replaceAllButton);

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
     * 置換モードを表示する（Ctrl+H / chevronトグルから呼ばれる）
     */
    showReplaceMode(): void {
        this.replaceMode = true;
        this.replaceRowElement.style.display = '';
        this.chevronToggle.innerHTML = SearchPanel.CHEVRON_DOWN_SVG;
        this.chevronToggle.setAttribute('aria-expanded', 'true');
        this.chevronToggle.classList.add('search-replace-toggle-expanded');
    }

    /**
     * 置換モードを非表示にする（Ctrl+Shift+F / chevronトグルから呼ばれる）
     */
    hideReplaceMode(): void {
        this.replaceMode = false;
        this.replaceRowElement.style.display = 'none';
        this.chevronToggle.innerHTML = SearchPanel.CHEVRON_RIGHT_SVG;
        this.chevronToggle.setAttribute('aria-expanded', 'false');
        this.chevronToggle.classList.remove('search-replace-toggle-expanded');
    }

    /**
     * オプションボタンを生成する
     */
    private createOptionButton(option: 'caseSensitive' | 'wholeWord' | 'regex', svgHtml: string, title: string): HTMLElement {
        const button = document.createElement('button');
        button.classList.add('search-option-button');
        button.dataset.option = option;
        button.textContent = svgHtml;
        button.title = title;
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
        this.wholeWordAuto = shouldAutoEnableWholeWord(value);
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
     * 現在の検索オプションを返す
     */
    private getCurrentSearchOptions(): SearchOptions {
        return {
            caseSensitive: this.caseSensitive,
            wholeWord: this.wholeWordManual || this.wholeWordAuto,
            useRegex: this.useRegex,
        };
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
            this.currentResults = [];
            this.focusedResultIndex = -1;
            return;
        }
        // 空文字でないことが確定してからローディング表示を開始する
        this.resultsElement.classList.add('searching');
        try {
            const results = await this.searchEngine.searchAsync(
                inputText,
                this.getCurrentSearchOptions(),
                () => requestId !== this.searchRequestId,
            );
            // await の間に新しい検索が始まっていた場合は結果を破棄する
            if (requestId !== this.searchRequestId) return;
            this.currentResults = results;
            // 検索結果再描画時にフォーカスをリセットする
            this.focusedResultIndex = -1;
            this.renderResults(results, inputText);
        } finally {
            // 自分が最新リクエストの場合のみ除去する（新しいリクエストが既に付与している場合は触らない）
            if (requestId === this.searchRequestId) {
                this.resultsElement.classList.remove('searching');
            }
        }
    }

    // =========================================================================
    // 置換ロジック
    // =========================================================================

    /**
     * カレントマッチ1件を置換する。置換後、次のマッチをフォーカスする。
     */
    private replaceCurrentMatch(): void {
        if (this.focusedResultIndex < 0 || this.focusedResultIndex >= this.currentResults.length) {
            throw new Error('replaceCurrentMatch: フォーカスされた検索結果がありません');
        }
        const result = this.currentResults[this.focusedResultIndex];
        const editorTable = this.openEditorTables.get(result.tableName);
        // 置換対象は開いているテーブルのみ
        if (!editorTable) return;
        const domRow = editorTable.findDomRowByPkValue(result.pkValue);
        if (domRow === -1) return;
        // DOM列インデックス（1始まり、行ヘッダー含む）
        const domColumn = result.columnIndex + editorTable.dataColumnOffset();
        const oldValue = editorTable.getCellValueAt(domRow, domColumn);
        const searchText = this.inputElement.value.trim();
        const replaceText = this.replaceInputElement.value;
        const options = this.getCurrentSearchOptions();
        const newValue = replaceWithQuery(oldValue, searchText, replaceText, options);
        if (oldValue === newValue) return;
        // CellChangeCommand を構築して実行する
        const change: CellChange = {row: domRow, column: domColumn, oldValue, newValue};
        const range: CellRange = {startRow: domRow, startColumn: domColumn, endRow: domRow, endColumn: domColumn};
        const command = new CellChangeCommand(editorTable, [change], range, {startRow: 0, startColumn: 0, endRow: -1, endColumn: -1});
        editorTable.executeExternalCommand(command, range);
        // 検索結果から置換済みアイテムを除去し、全件再描画してクロージャのインデックスを正しく保つ
        this.currentResults.splice(this.focusedResultIndex, 1);
        if (this.currentResults.length === 0) {
            this.focusedResultIndex = -1;
        } else if (this.focusedResultIndex >= this.currentResults.length) {
            this.focusedResultIndex = 0;
        }
        // 全件再描画（各アイテムのクリックハンドラが正しいインデックスを参照するようにする）
        this.renderResults(this.currentResults, searchText);
        if (this.focusedResultIndex >= 0) {
            this.applyFocusToResultItem(this.focusedResultIndex);
        }
        // 置換後に EditorTable にフォーカスを戻す。
        // 後続の Ctrl+Z/Ctrl+S が EditorTableHandler の keydown ハンドラに到達するようにする。
        this.tab.focusActiveEditorTable();
    }

    /**
     * 全マッチを一括置換する。CompositeCommand で実行し、Undo で一括復元できる。
     * 確認ダイアログは使わない（Undo可能なため過剰防衛。同期ブロッキングAPI window.confirm は
     * Playwright のダイアログハンドリングとタイミング問題を起こすため廃止した）。
     */
    private replaceAllMatches(): void {
        if (this.currentResults.length === 0) return;
        const searchText = this.inputElement.value.trim();
        const replaceText = this.replaceInputElement.value;
        const options = this.getCurrentSearchOptions();
        // テーブルごとに CellChangeCommand をまとめて CompositeCommand で実行する
        // 全件を1つの EditorTable の history に登録する（1回の Undo で全件戻る）
        // 複数テーブルにまたがる場合は最初のテーブルの history を使う
        const commandsByTable = new Map<string, {editorTable: EditorTable; changes: CellChange[]}>();
        for (const result of this.currentResults) {
            const editorTable = this.openEditorTables.get(result.tableName);
            if (!editorTable) continue;
            const domRow = editorTable.findDomRowByPkValue(result.pkValue);
            if (domRow === -1) continue;
            const domColumn = result.columnIndex + editorTable.dataColumnOffset();
            const oldValue = editorTable.getCellValueAt(domRow, domColumn);
            const newValue = replaceWithQuery(oldValue, searchText, replaceText, options);
            if (oldValue === newValue) continue;
            let entry = commandsByTable.get(result.tableName);
            if (!entry) {
                entry = {editorTable, changes: []};
                commandsByTable.set(result.tableName, entry);
            }
            entry.changes.push({row: domRow, column: domColumn, oldValue, newValue});
        }
        // 変更がなければ何もしない
        if (commandsByTable.size === 0) return;
        // テーブルごとに CellChangeCommand を作り、CompositeCommand でラップする
        const commands: CellChangeCommand[] = [];
        const emptyRange: CellRange = {startRow: 0, startColumn: 0, endRow: -1, endColumn: -1};
        for (const entry of commandsByTable.values()) {
            const range: CellRange = {
                startRow: entry.changes[0].row, startColumn: entry.changes[0].column,
                endRow: entry.changes[entry.changes.length - 1].row,
                endColumn: entry.changes[entry.changes.length - 1].column,
            };
            commands.push(new CellChangeCommand(entry.editorTable, entry.changes, range, emptyRange));
        }
        // 全 CellChangeCommand を CompositeCommand でラップして、最初のテーブルの history に登録する
        const compositeCommand = new CompositeCommand(commands);
        const firstEntry = commandsByTable.values().next().value;
        if (!firstEntry) return;
        // 最初のテーブルの変更範囲を range として渡す
        const compositeRange: CellRange = {
            startRow: firstEntry.changes[0].row, startColumn: firstEntry.changes[0].column,
            endRow: firstEntry.changes[firstEntry.changes.length - 1].row,
            endColumn: firstEntry.changes[firstEntry.changes.length - 1].column,
        };
        firstEntry.editorTable.executeExternalCommand(compositeCommand, compositeRange);
        // 検索結果をクリアする（全件置換済み）
        this.currentResults = [];
        this.focusedResultIndex = -1;
        this.resultsElement.replaceChildren();
        // 置換後に EditorTable にフォーカスを戻す。
        // 後続の Ctrl+Z/Ctrl+S が EditorTableHandler の keydown ハンドラに到達するようにする。
        this.tab.focusActiveEditorTable();
    }

    /**
     * 指定インデックスの検索結果アイテムにフォーカスを適用する
     */
    private applyFocusToResultItem(index: number): void {
        // 既存のフォーカスを全解除する
        const items = this.resultsElement.querySelectorAll('.search-result-item');
        for (let i = 0; i < items.length; i++) {
            items[i].classList.remove('search-result-item-focused');
        }
        // 新しいフォーカスを適用する
        if (index >= 0 && index < items.length) {
            items[index].classList.add('search-result-item-focused');
        }
    }

    /**
     * 置換プレビューを全検索結果アイテムに反映する
     */
    private updateReplacePreviews(): void {
        const replaceText = this.replaceInputElement.value;
        const searchText = this.inputElement.value.trim();
        const options = this.getCurrentSearchOptions();
        const items = this.resultsElement.querySelectorAll('.search-result-item');
        for (let i = 0; i < items.length && i < this.currentResults.length; i++) {
            const item = items[i];
            // 既存のプレビュー要素を除去する
            const existingPreview = item.querySelector('.search-result-replace-preview');
            if (existingPreview) existingPreview.remove();
            // 置換テキストが空の場合はプレビューを表示しない
            if (replaceText === '') continue;
            // 置換後の値を計算する
            const result = this.currentResults[i];
            const replacedValue = replaceWithQuery(result.value, searchText, replaceText, options);
            // プレビュー要素を追加する
            const preview = document.createElement('span');
            preview.classList.add('search-result-replace-preview');
            preview.textContent = `→ ${replacedValue}`;
            preview.setAttribute('aria-label', `置換後: ${replacedValue}`);
            item.appendChild(preview);
        }
    }

    // =========================================================================
    // 検索結果描画
    // =========================================================================

    /**
     * 検索結果をDOMに描画する
     *
     * @param results 検索結果
     * @param searchText ハイライト用の検索テキスト
     */
    private renderResults(results: SearchResultInfo[], searchText: string): void {
        this.resultsElement.replaceChildren();
        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            const resultIndex = i;
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
            // クリックで該当セルにジャンプ + カレントマッチ設定
            item.addEventListener('click', () => {
                this.focusedResultIndex = resultIndex;
                this.applyFocusToResultItem(resultIndex);
                this.tab.navigateToTableCell(result.tableName, result.pkValue, result.columnIndex);
            });
            this.resultsElement.appendChild(item);
        }
        // 置換モード時はプレビューを表示する
        if (this.replaceMode && this.replaceInputElement.value !== '') {
            this.updateReplacePreviews();
        }
    }

}
