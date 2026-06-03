import type {TabState} from "../tabs/tab";
import {matchesQuery, shouldAutoEnableWholeWord, type SearchOptions} from "../search/search-query";

interface FindMatch {
    row: number;
    column: number;
}

const SEARCH_INPUT_DEBOUNCE_MS = 120;
const SEARCH_CHUNK_BUDGET_MS = 6;
const SEARCH_CHUNK_MIN_CELLS = 250;

/**
 * アクティブな通常 EditorTable タブだけを対象にする検索バー。
 */
export class EditorTableFindBar {
    private readonly element: HTMLElement;
    private readonly inputElement: HTMLInputElement;
    private readonly previousButton: HTMLButtonElement;
    private readonly nextButton: HTMLButtonElement;
    private readonly closeButton: HTMLButtonElement;
    private readonly countElement: HTMLElement;
    private readonly statusElement: HTMLElement;
    private readonly caseSensitiveButton: HTMLButtonElement;
    private readonly wholeWordButton: HTMLButtonElement;
    private readonly regexButton: HTMLButtonElement;
    private readonly handleTableViewportChanged: () => void;
    private currentState: TabState | null;
    private observedState: TabState | null;
    private tableRowsObserver: MutationObserver | null;
    private matches: FindMatch[];
    private currentIndex: number;
    private highlightedCells: HTMLElement[];
    private caseSensitive: boolean;
    private wholeWordManual: boolean;
    private wholeWordAuto: boolean;
    private useRegex: boolean;
    private searchTimerId: number | null;
    private searchRequestId: number;
    private searching: boolean;
    private searchProgressPercent: number;
    private highlightRefreshFrameId: number | null;

    constructor() {
        this.currentState = null;
        this.observedState = null;
        this.tableRowsObserver = null;
        this.matches = [];
        this.currentIndex = -1;
        this.highlightedCells = [];
        this.caseSensitive = false;
        this.wholeWordManual = false;
        this.wholeWordAuto = false;
        this.useRegex = false;
        this.searchTimerId = null;
        this.searchRequestId = 0;
        this.searching = false;
        this.searchProgressPercent = 0;
        this.highlightRefreshFrameId = null;
        this.handleTableViewportChanged = () => {
            this.scheduleHighlightRefresh();
        };

        this.element = document.createElement('div');
        this.element.classList.add('editor-table-find-bar');
        this.element.setAttribute('role', 'search');

        this.inputElement = document.createElement('input');
        this.inputElement.classList.add('editor-table-find-input');
        this.inputElement.type = 'text';
        this.inputElement.placeholder = '検索...';
        this.inputElement.setAttribute('aria-label', '現在のタブ内を検索');
        this.inputElement.addEventListener('input', () => {
            this.handleInputChange();
        });
        this.inputElement.addEventListener('keydown', (event) => {
            this.handleInputKeydown(event);
        });
        this.element.appendChild(this.inputElement);

        this.countElement = document.createElement('span');
        this.countElement.classList.add('editor-table-find-count');
        this.countElement.textContent = '0/0';
        this.element.appendChild(this.countElement);

        this.statusElement = document.createElement('span');
        this.statusElement.classList.add('editor-table-find-status');
        this.statusElement.setAttribute('aria-hidden', 'true');
        this.statusElement.setAttribute('aria-live', 'polite');
        const spinnerElement = document.createElement('span');
        spinnerElement.classList.add('editor-table-find-spinner');
        spinnerElement.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true"><circle class="loading-spinner-track" cx="8" cy="8" r="5.5" pathLength="100"/><circle class="loading-spinner-arc" cx="8" cy="8" r="5.5" pathLength="100"/></svg>';
        const statusTextElement = document.createElement('span');
        statusTextElement.textContent = '検索中';
        this.statusElement.appendChild(spinnerElement);
        this.statusElement.appendChild(statusTextElement);
        this.element.appendChild(this.statusElement);

        this.previousButton = this.createIconButton('前の検索結果', '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 4.2l-4.3 4.3.7.7L8 5.6l3.6 3.6.7-.7L8 4.2z"/></svg>');
        this.previousButton.addEventListener('click', () => {
            this.moveToPrevious();
        });
        this.element.appendChild(this.previousButton);

        this.nextButton = this.createIconButton('次の検索結果', '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 11.8l4.3-4.3-.7-.7L8 10.4 4.4 6.8l-.7.7L8 11.8z"/></svg>');
        this.nextButton.addEventListener('click', () => {
            this.moveToNext();
        });
        this.element.appendChild(this.nextButton);

        this.caseSensitiveButton = this.createOptionButton('Aa', '大文字小文字を区別');
        this.caseSensitiveButton.addEventListener('click', () => {
            this.caseSensitive = !this.caseSensitive;
            this.caseSensitiveButton.classList.toggle('editor-table-find-option-active', this.caseSensitive);
            this.scheduleSearch(0);
        });
        this.element.appendChild(this.caseSensitiveButton);

        this.wholeWordButton = this.createOptionButton('|ab|', '単語単位で検索');
        this.wholeWordButton.addEventListener('click', () => {
            this.wholeWordManual = !this.wholeWordManual;
            this.updateWholeWordButtonState();
            this.scheduleSearch(0);
        });
        this.element.appendChild(this.wholeWordButton);

        this.regexButton = this.createOptionButton('.*', '正規表現');
        this.regexButton.addEventListener('click', () => {
            this.useRegex = !this.useRegex;
            this.regexButton.classList.toggle('editor-table-find-option-active', this.useRegex);
            this.scheduleSearch(0);
        });
        this.element.appendChild(this.regexButton);

        this.closeButton = this.createIconButton('検索バーを閉じる', '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3.4 2.7L2.7 3.4 7.3 8l-4.6 4.6.7.7L8 8.7l4.6 4.6.7-.7L8.7 8l4.6-4.6-.7-.7L8 7.3 3.4 2.7z"/></svg>');
        this.closeButton.addEventListener('click', () => {
            this.hide(true);
        });
        this.element.appendChild(this.closeButton);

        this.updateNavigationButtons();
    }

    show(state: TabState): void {
        if (this.currentState !== state) {
            this.unobserveState();
            this.cancelSearch();
            this.clearHighlights();
            this.currentState = state;
            this.matches = [];
            this.currentIndex = -1;
        }
        if (this.element.parentElement !== state.wrapperElement) {
            state.wrapperElement.appendChild(this.element);
        }
        this.element.classList.add('editor-table-find-bar-visible');
        this.observeState(state);
        this.scheduleSearch(0);
        this.inputElement.focus();
        this.inputElement.select();
    }

    hideForState(state: TabState): void {
        if (this.currentState !== state) return;
        this.hide(false);
    }

    private hide(focusTable: boolean): void {
        this.element.classList.remove('editor-table-find-bar-visible');
        this.unobserveState();
        this.cancelSearch();
        this.clearHighlights();
        if (focusTable && this.currentState !== null) {
            this.currentState.editorTableHandler.activate();
        }
    }

    private createIconButton(label: string, svgHtml: string): HTMLButtonElement {
        const button = document.createElement('button');
        button.classList.add('editor-table-find-button');
        button.type = 'button';
        button.title = label;
        button.setAttribute('aria-label', label);
        button.innerHTML = svgHtml;
        return button;
    }

    private createOptionButton(text: string, title: string): HTMLButtonElement {
        const button = document.createElement('button');
        button.classList.add('editor-table-find-button', 'editor-table-find-option-button');
        button.type = 'button';
        button.title = title;
        button.textContent = text;
        return button;
    }

    private handleInputChange(): void {
        const value = this.inputElement.value;
        this.wholeWordAuto = shouldAutoEnableWholeWord(value);
        this.updateWholeWordButtonState();
        this.scheduleSearch(SEARCH_INPUT_DEBOUNCE_MS);
    }

    private handleInputKeydown(event: KeyboardEvent): void {
        if (event.key === 'Enter') {
            event.preventDefault();
            if (event.shiftKey) {
                this.moveToPrevious();
            } else {
                this.moveToNext();
            }
            return;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            this.hide(true);
        }
    }

    private updateWholeWordButtonState(): void {
        const effective = this.wholeWordManual || this.wholeWordAuto;
        this.wholeWordButton.classList.toggle('editor-table-find-option-active', effective);
        if (this.wholeWordAuto) {
            this.wholeWordButton.title = '数値入力のため単語単位検索を自動でONにしました';
            this.wholeWordButton.dataset['autoActive'] = 'true';
        } else {
            this.wholeWordButton.title = '単語単位で検索';
            delete this.wholeWordButton.dataset['autoActive'];
        }
    }

    private getCurrentSearchOptions(): SearchOptions {
        return {
            caseSensitive: this.caseSensitive,
            wholeWord: this.wholeWordManual || this.wholeWordAuto,
            useRegex: this.useRegex,
        };
    }

    private scheduleSearch(delayMs: number): void {
        if (this.searchTimerId !== null) {
            window.clearTimeout(this.searchTimerId);
            this.searchTimerId = null;
        }
        const requestId = ++this.searchRequestId;
        this.clearHighlights();
        this.matches = [];
        this.currentIndex = -1;
        this.searchProgressPercent = 0;
        this.updateCount();
        const state = this.currentState;
        if (state === null) {
            this.setSearching(false);
            this.updateNavigationButtons();
            return;
        }
        const query = this.inputElement.value.trim();
        if (query === '') {
            this.setSearching(false);
            this.updateNavigationButtons();
            return;
        }

        const options = this.getCurrentSearchOptions();
        this.setSearching(true);
        this.searchTimerId = window.setTimeout(() => {
            this.searchTimerId = null;
            void this.searchAsync(requestId, query, options).catch((error: unknown) => {
                if (requestId !== this.searchRequestId) return;
                console.error('EditorTable tab search failed.', error);
                this.setSearching(false);
                this.updateNavigationButtons();
            });
        }, delayMs);
    }

    private async searchAsync(requestId: number, query: string, options: SearchOptions): Promise<void> {
        const state = this.currentState;
        if (state === null) {
            if (requestId === this.searchRequestId) {
                this.setSearching(false);
                this.updateNavigationButtons();
            }
            return;
        }
        const editorTable = state.editorTable;
        const rowCount = editorTable.getLogicalRowCount();
        const offset = editorTable.dataColumnOffset();
        const columnCount = editorTable.getColumnCount();
        const totalCells = Math.max(1, (rowCount - 1) * columnCount);
        let scannedCells = 0;
        let cellsSinceYield = 0;
        let chunkStartTime = performance.now();
        for (let row = 1; row < rowCount; row++) {
            if (requestId !== this.searchRequestId) return;
            for (let dataColumn = 0; dataColumn < columnCount; dataColumn++) {
                const column = dataColumn + offset;
                const value = editorTable.getCellValueAt(row, column);
                if (matchesQuery(value, query, options)) {
                    this.matches.push({row, column});
                }
                scannedCells++;
                cellsSinceYield++;
                if (cellsSinceYield >= SEARCH_CHUNK_MIN_CELLS
                    && performance.now() - chunkStartTime >= SEARCH_CHUNK_BUDGET_MS) {
                    this.updateSearchProgress(scannedCells, totalCells);
                    await this.yieldToBrowser();
                    if (requestId !== this.searchRequestId) return;
                    cellsSinceYield = 0;
                    chunkStartTime = performance.now();
                }
            }
        }
        if (requestId !== this.searchRequestId) return;
        this.setSearching(false);
        if (this.matches.length > 0) {
            this.setCurrentIndex(0, true);
        } else {
            this.updateCount();
            this.updateNavigationButtons();
        }
    }

    private yieldToBrowser(): Promise<void> {
        return new Promise((resolve) => {
            window.setTimeout(resolve, 0);
        });
    }

    private cancelSearch(): void {
        if (this.searchTimerId !== null) {
            window.clearTimeout(this.searchTimerId);
            this.searchTimerId = null;
        }
        this.searchRequestId++;
        this.setSearching(false);
    }

    private setSearching(searching: boolean): void {
        this.searching = searching;
        this.element.classList.toggle('editor-table-find-bar-searching', searching);
        this.statusElement.setAttribute('aria-hidden', searching ? 'false' : 'true');
        this.updateCount();
        this.updateNavigationButtons();
    }

    private updateSearchProgress(scannedCells: number, totalCells: number): void {
        const percent = Math.min(99, Math.floor((scannedCells / totalCells) * 100));
        if (percent === this.searchProgressPercent) return;
        this.searchProgressPercent = percent;
        this.updateCount();
    }

    private observeState(state: TabState): void {
        if (this.observedState === state) return;
        this.unobserveState();
        this.observedState = state;
        state.wrapperElement.addEventListener('editor-table-scroll-metrics-changed', this.handleTableViewportChanged);
        this.tableRowsObserver = new MutationObserver(this.handleTableViewportChanged);
        this.tableRowsObserver.observe(state.editorTable.getTableElement(), {childList: true});
    }

    private unobserveState(): void {
        if (this.observedState !== null) {
            this.observedState.wrapperElement.removeEventListener('editor-table-scroll-metrics-changed', this.handleTableViewportChanged);
            this.observedState = null;
        }
        if (this.tableRowsObserver !== null) {
            this.tableRowsObserver.disconnect();
            this.tableRowsObserver = null;
        }
        if (this.highlightRefreshFrameId !== null) {
            window.cancelAnimationFrame(this.highlightRefreshFrameId);
            this.highlightRefreshFrameId = null;
        }
    }

    private scheduleHighlightRefresh(): void {
        if (this.highlightRefreshFrameId !== null) return;
        if (!this.element.classList.contains('editor-table-find-bar-visible')) return;
        if (this.searching || this.currentIndex < 0 || this.matches.length === 0) return;
        this.highlightRefreshFrameId = window.requestAnimationFrame(() => {
            this.highlightRefreshFrameId = null;
            if (!this.element.classList.contains('editor-table-find-bar-visible')) return;
            if (this.searching || this.currentIndex < 0 || this.matches.length === 0) return;
            this.applyHighlights();
        });
    }

    private moveToNext(): void {
        if (this.matches.length === 0) return;
        const nextIndex = this.currentIndex === -1 ? 0 : (this.currentIndex + 1) % this.matches.length;
        this.setCurrentIndex(nextIndex, true);
    }

    private moveToPrevious(): void {
        if (this.matches.length === 0) return;
        const nextIndex = this.currentIndex === -1
            ? this.matches.length - 1
            : (this.currentIndex - 1 + this.matches.length) % this.matches.length;
        this.setCurrentIndex(nextIndex, true);
    }

    private setCurrentIndex(index: number, scrollToMatch: boolean): void {
        const state = this.currentState;
        if (state === null || this.matches.length === 0) return;
        this.currentIndex = index;
        const match = this.matches[index];
        if (scrollToMatch) {
            state.selection.setRange(match.row, match.column, match.row, match.column);
            state.selection.move(match.row, match.column);
            state.selection.scrollFocusToCenterVertically();
        }
        this.updateCount();
        this.updateNavigationButtons();
        this.applyHighlights();
    }

    private updateCount(): void {
        if (this.searching) {
            this.countElement.textContent = `${this.searchProgressPercent}%`;
            return;
        }
        const current = this.currentIndex >= 0 ? this.currentIndex + 1 : 0;
        this.countElement.textContent = `${current}/${this.matches.length}`;
    }

    private updateNavigationButtons(): void {
        const disabled = this.searching || this.matches.length === 0;
        this.previousButton.disabled = disabled;
        this.nextButton.disabled = disabled;
    }

    private applyHighlights(): void {
        this.clearHighlights();
        const state = this.currentState;
        if (state === null) return;
        if (this.matches.length === 0) return;
        const editorTable = state.editorTable;
        const renderedStart = editorTable.getVirtualScrollRenderedStart();
        const renderedEnd = editorTable.getVirtualScrollRenderedEnd();
        const frozenRowCount = editorTable.getFrozenRowCount();
        for (let i = 0; i < this.matches.length; i++) {
            const match = this.matches[i];
            const dataRowIndex = match.row - 1;
            if (dataRowIndex >= frozenRowCount
                && (dataRowIndex < renderedStart || dataRowIndex >= renderedEnd)) {
                continue;
            }
            const visibleCell = editorTable.getVisibleCellOrNull(match.row, match.column);
            const sourceCell = editorTable.getCellOrNull(match.row, match.column);
            const current = i === this.currentIndex;
            this.addHighlightCell(visibleCell, current);
            if (sourceCell !== visibleCell) {
                this.addHighlightCell(sourceCell, current);
            }
        }
    }

    private addHighlightCell(cell: HTMLElement | null, current: boolean): void {
        if (cell === null) return;
        cell.classList.add('editor-table-cell-find-match');
        if (current) cell.classList.add('editor-table-cell-find-current');
        this.highlightedCells.push(cell);
    }

    private clearHighlights(): void {
        for (const cell of this.highlightedCells) {
            cell.classList.remove('editor-table-cell-find-match', 'editor-table-cell-find-current');
        }
        this.highlightedCells = [];
    }
}
