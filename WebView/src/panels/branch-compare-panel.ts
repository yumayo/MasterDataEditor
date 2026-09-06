import {gitBranchCompareAsync, gitBranchListAsync, type GitBranchCompareFile, type GitBranchInfo} from '../app/api';
import {Tab} from '../tabs/tab';
import type {UiStateStore} from '../app/ui-state';
import type {NotificationToast} from '../ui/notification';

type BranchInput = HTMLInputElement;

interface BranchCompareFileView {
    file: GitBranchCompareFile;
    leftCommit: string;
    rightCommit: string;
    item: HTMLElement;
}

/**
 * 2ブランチ間のCSV差分を選択・表示するサイドバーパネル。
 * 選択済みrefは各inputのdata-selected-refへ保持し、DOMを選択状態のSSOTとする。
 */
export class BranchComparePanel {
    private readonly element: HTMLElement;
    private readonly baseInput: BranchInput;
    private readonly targetInput: BranchInput;
    private readonly suggestionsElement: HTMLElement;
    private readonly compareButton: HTMLButtonElement;
    private readonly swapButton: HTMLButtonElement;
    private readonly statusElement: HTMLElement;
    private readonly notification: NotificationToast;
    private readonly resultsElement: HTMLElement;
    private readonly tab: Tab;
    private readonly uiStateStore: UiStateStore;
    private restoreComparisonPending: boolean;
    private branches: GitBranchInfo[];
    private filteredBranches: GitBranchInfo[];
    private activeInput: BranchInput | false;
    private selectedSuggestionIndex: number;
    private branchListLoaded: boolean;
    private branchListFailed: boolean;
    private branchListRequestId: number;
    private compareRequestId: number;
    private compareBusy: boolean;
    private fileOpenController: AbortController | false;
    private readonly fileViews: BranchCompareFileView[] = [];

    constructor(tab: Tab, uiStateStore: UiStateStore, notification: NotificationToast) {
        this.tab = tab;
        this.uiStateStore = uiStateStore;
        this.notification = notification;
        const storedState = uiStateStore.getState().sidebar.branchCompare;
        this.restoreComparisonPending = storedState.compared;
        this.branches = [];
        this.filteredBranches = [];
        this.activeInput = false;
        this.selectedSuggestionIndex = -1;
        this.branchListLoaded = false;
        this.branchListFailed = false;
        this.branchListRequestId = 0;
        this.compareRequestId = 0;
        this.compareBusy = false;
        this.fileOpenController = false;

        this.element = document.createElement('div');
        this.element.classList.add('sidebar-panel', 'branch-compare-panel');

        const header = document.createElement('div');
        header.classList.add('sidebar-panel-header');
        header.textContent = 'BRANCH COMPARE';
        this.element.appendChild(header);

        const controls = document.createElement('div');
        controls.classList.add('branch-compare-controls');
        this.element.appendChild(controls);

        this.suggestionsElement = document.createElement('div');
        this.suggestionsElement.id = 'branch-compare-suggestions';
        this.suggestionsElement.classList.add('branch-compare-suggestions');
        this.suggestionsElement.setAttribute('role', 'listbox');

        this.baseInput = this.createBranchInput('branch-compare-base-input', 'branch-compare-base-input', '比較元ブランチ', '比較元ブランチ');
        this.targetInput = this.createBranchInput('branch-compare-target-input', 'branch-compare-target-input', '比較先ブランチ', '比較先ブランチ');
        if (storedState.baseRef !== null) this.baseInput.setAttribute('data-selected-ref', storedState.baseRef);
        if (storedState.targetRef !== null) this.targetInput.setAttribute('data-selected-ref', storedState.targetRef);
        controls.appendChild(this.createInputLabel('branch-compare-base-input', '比較元'));
        controls.appendChild(this.baseInput);
        controls.appendChild(this.createInputLabel('branch-compare-target-input', '比較先'));
        controls.appendChild(this.targetInput);
        controls.appendChild(this.suggestionsElement);

        this.compareButton = document.createElement('button');
        this.compareButton.type = 'button';
        this.compareButton.classList.add('branch-compare-button');
        this.compareButton.textContent = '比較';
        this.compareButton.disabled = true;
        this.compareButton.addEventListener('click', () => {
            this.compareAsync().catch((error: unknown) => { this.handleUnexpectedCompareError(error); });
        });
        controls.appendChild(this.compareButton);

        this.swapButton = document.createElement('button');
        this.swapButton.type = 'button';
        this.swapButton.classList.add('branch-compare-swap-button');
        this.swapButton.setAttribute('aria-label', '入れ替え');
        this.swapButton.title = '比較元と比較先を入れ替える';
        this.swapButton.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M5 13V3m-3 3 3-3 3 3M11 3v10m-3-3 3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        this.swapButton.addEventListener('click', () => {
            const baseValue = this.baseInput.value;
            const baseRef = this.baseInput.getAttribute('data-selected-ref');
            const targetRef = this.targetInput.getAttribute('data-selected-ref');
            this.baseInput.value = this.targetInput.value;
            this.targetInput.value = baseValue;
            for (const [input, ref] of [[this.baseInput, targetRef], [this.targetInput, baseRef]] as const) {
                input.title = input.value === '' ? input.placeholder : input.value;
                if (ref === null) input.removeAttribute('data-selected-ref');
                else input.setAttribute('data-selected-ref', ref);
            }
            this.invalidateResults(true);
            this.persistState(false);
            this.dismissSuggestions();
            this.updateCompareButton();
        });
        this.baseInput.after(this.swapButton);
        for (const button of [this.compareButton, this.swapButton]) {
            // 候補を畳むのはclick時とし、mousedownのblurでボタンが動くことを防ぐ。
            button.addEventListener('mousedown', (event: MouseEvent) => {
                if (this.suggestionsElement.classList.contains('visible')) event.preventDefault();
            });
        }

        this.statusElement = document.createElement('div');
        this.statusElement.classList.add('branch-compare-status');
        this.statusElement.setAttribute('aria-live', 'polite');
        controls.appendChild(this.statusElement);

        this.resultsElement = document.createElement('div');
        this.resultsElement.classList.add('branch-compare-results');
        this.resultsElement.setAttribute('role', 'list');
        this.element.appendChild(this.resultsElement);

        document.addEventListener('mousedown', (event: MouseEvent) => {
            if (event.target instanceof Node && !this.element.contains(event.target)) this.dismissSuggestions();
        });
        this.tab.connectBranchCompareListener(metadata => {
            for (const view of this.fileViews) {
                const active = metadata !== null && metadata.gitPath === view.file.path && metadata.leftCommit === view.leftCommit && metadata.rightCommit === view.rightCommit;
                view.item.classList.toggle('branch-compare-file-item-active', active);
                view.item.setAttribute('aria-current', String(active));
            }
        });
    }

    appendTo(parent: HTMLElement): void {
        parent.appendChild(this.element);
    }

    /** 起動時に別パネルが開いていても保存済みブランチを検証・復元する。 */
    restore(): void {
        if (this.isVisible()) return;
        if (!this.baseInput.hasAttribute('data-selected-ref') && !this.targetInput.hasAttribute('data-selected-ref')) return;
        const requestId = ++this.branchListRequestId;
        this.loadBranchesAsync(requestId).catch(() => {});
    }

    show(): void {
        this.element.classList.add('sidebar-panel-active');
        this.tab.notifyBranchCompareSelection();
        const requestId = ++this.branchListRequestId;
        this.loadBranchesAsync(requestId).catch(() => {});
    }

    hide(): void {
        this.element.classList.remove('sidebar-panel-active');
        this.branchListRequestId++;
        this.dismissSuggestions();
        this.cancelFileOpen(true);
    }

    private createInputLabel(inputId: string, text: string): HTMLLabelElement {
        const label = document.createElement('label');
        label.classList.add('branch-compare-input-label');
        label.htmlFor = inputId;
        label.textContent = text;
        // 関連付けは保持し、フォーカス開始は入力枠の操作だけに限定する。
        label.addEventListener('click', (event: MouseEvent) => { event.preventDefault(); });
        return label;
    }

    private createBranchInput(id: string, className: string, placeholder: string, ariaLabel: string): BranchInput {
        const input = document.createElement('input');
        input.id = id;
        input.type = 'text';
        input.classList.add(className);
        input.placeholder = placeholder;
        input.title = ariaLabel;
        input.setAttribute('aria-label', ariaLabel);
        input.setAttribute('role', 'combobox');
        input.setAttribute('aria-autocomplete', 'list');
        input.setAttribute('aria-haspopup', 'listbox');
        input.setAttribute('aria-controls', 'branch-compare-suggestions');
        input.setAttribute('aria-expanded', 'false');
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.addEventListener('focus', () => {
            this.activeInput = input;
            this.selectedSuggestionIndex = -1;
            this.renderSuggestions();
        });
        input.addEventListener('blur', () => { this.dismissSuggestions(); });
        input.addEventListener('input', () => {
            this.resolveExactBranch(input);
            input.title = input.value === '' ? ariaLabel : input.value;
            this.invalidateResults(true);
            this.persistState(false);
            this.activeInput = input;
            this.selectedSuggestionIndex = -1;
            this.updateCompareButton();
            this.renderSuggestions();
        });
        input.addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                this.dismissSuggestions();
                return;
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                this.activeInput = input;
                if (this.filteredBranches.length === 0) return;
                if (this.selectedSuggestionIndex === -1) {
                    this.selectedSuggestionIndex = event.key === 'ArrowDown' ? 0 : this.filteredBranches.length - 1;
                } else {
                    const delta = event.key === 'ArrowDown' ? 1 : -1;
                    this.selectedSuggestionIndex = (this.selectedSuggestionIndex + delta + this.filteredBranches.length) % this.filteredBranches.length;
                }
                this.renderSuggestions();
                return;
            }
            const confirmsActiveSuggestion = event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey);
            if (confirmsActiveSuggestion && this.suggestionsElement.classList.contains('visible')) {
                if (event.key === 'Enter') event.preventDefault();
                if (this.suggestionsElement.querySelector('.branch-compare-suggestion.selected') === null) return;
                if (this.selectedSuggestionIndex < 0 || this.selectedSuggestionIndex >= this.filteredBranches.length) return;
                this.confirmBranch(input, this.filteredBranches[this.selectedSuggestionIndex]);
            }
        });
        return input;
    }

    private async loadBranchesAsync(requestId: number): Promise<void> {
        this.branchListLoaded = false;
        this.branchListFailed = false;
        this.updateCompareButton();
        try {
            const branches = await gitBranchListAsync();
            if (requestId !== this.branchListRequestId) return;
            this.branches = branches;
            this.branchListLoaded = true;
            let selectionRemoved = false;
            for (const input of [this.baseInput, this.targetInput]) {
                const selectedRef = input.getAttribute('data-selected-ref');
                if (selectedRef === null) {
                    this.resolveExactBranch(input);
                    continue;
                }
                const branch = this.branches.find(branch => branch.ref === selectedRef);
                if (branch !== undefined) {
                    input.value = branch.name;
                    input.title = branch.name;
                    continue;
                }
                input.removeAttribute('data-selected-ref');
                input.value = '';
                input.title = input.placeholder;
                selectionRemoved = true;
            }
            if (selectionRemoved) this.invalidateResults(true);
            this.persistState(selectionRemoved ? false : this.uiStateStore.getState().sidebar.branchCompare.compared);
            this.updateCompareButton();
            if (this.canRenderSuggestions()) this.renderSuggestions();
        } catch (error: unknown) {
            if (requestId !== this.branchListRequestId) return;
            this.branchListFailed = true;
            this.branchListLoaded = false;
            this.updateCompareButton();
            this.dismissSuggestions();
            this.showOperationError(error);
            return;
        }
        if (this.restoreComparisonPending) {
            this.restoreComparisonPending = false;
            await this.compareAsync().catch((error: unknown) => { this.handleUnexpectedCompareError(error); });
        }
    }

    private resolveExactBranch(input: BranchInput): void {
        input.removeAttribute('data-selected-ref');
        if (!this.branchListLoaded) return;
        const matches = this.branches.filter(branch => branch.name === input.value || branch.ref === input.value);
        // 同名のlocal/remoteブランチがある場合は候補からの明示選択を必要とする。
        if (matches.length !== 1) return;
        input.setAttribute('data-selected-ref', matches[0].ref);
    }

    private persistState(compared: boolean): void {
        this.uiStateStore.setBranchCompareState({
            baseRef: this.baseInput.getAttribute('data-selected-ref'),
            targetRef: this.targetInput.getAttribute('data-selected-ref'),
            compared,
        });
    }

    private renderSuggestions(): void {
        if (!this.canRenderSuggestions() || this.branchListFailed) {
            this.dismissSuggestions();
            return;
        }
        const input = this.activeInput;
        if (input === false) return;
        this.suggestionsElement.replaceChildren();
        this.suggestionsElement.classList.add('visible');
        this.baseInput.setAttribute('aria-expanded', 'false');
        this.targetInput.setAttribute('aria-expanded', 'false');
        this.baseInput.removeAttribute('aria-activedescendant');
        this.targetInput.removeAttribute('aria-activedescendant');
        input.setAttribute('aria-expanded', 'true');
        input.after(this.suggestionsElement);
        const query = input.value.toLocaleLowerCase();
        const matches = this.branches.filter(branch => branch.name.toLocaleLowerCase().includes(query) || branch.ref.toLocaleLowerCase().includes(query));
        this.filteredBranches = [
            ...matches.filter(branch => branch.kind === 'local'),
            ...matches.filter(branch => branch.kind === 'remote'),
        ];
        if (this.selectedSuggestionIndex >= this.filteredBranches.length) this.selectedSuggestionIndex = -1;

        if (!this.branchListLoaded) {
            this.appendSuggestionStatus('読み込み中…');
            return;
        }
        if (this.filteredBranches.length === 0) {
            this.appendSuggestionStatus('該当するブランチがありません');
            return;
        }
        if (this.selectedSuggestionIndex === -1) {
            // 完全一致したrefを優先し、TabやEnterで別ブランチへ変わることを防ぐ。
            const selectedRef = input.getAttribute('data-selected-ref');
            const matchedIndex = this.filteredBranches.findIndex(branch => branch.ref === selectedRef);
            this.selectedSuggestionIndex = matchedIndex === -1 ? 0 : matchedIndex;
        }

        let renderedIndex = 0;
        for (const kind of ['local', 'remote'] as const) {
            const branches = this.filteredBranches.filter(branch => branch.kind === kind);
            if (branches.length === 0) continue;
            const group = document.createElement('div');
            group.classList.add('branch-compare-suggestion-group');
            group.setAttribute('data-kind', kind);
            group.setAttribute('role', 'group');
            group.setAttribute('aria-label', kind === 'local' ? 'LOCAL' : 'REMOTE');
            const groupLabel = document.createElement('div');
            groupLabel.classList.add('branch-compare-suggestion-group-label');
            groupLabel.textContent = kind === 'local' ? 'LOCAL' : 'REMOTE';
            group.appendChild(groupLabel);
            for (const branch of branches) {
                const option = document.createElement('div');
                option.id = 'branch-compare-suggestion-' + String(renderedIndex);
                option.classList.add('branch-compare-suggestion');
                option.setAttribute('data-ref', branch.ref);
                option.setAttribute('role', 'option');
                option.setAttribute('aria-selected', renderedIndex === this.selectedSuggestionIndex ? 'true' : 'false');
                option.setAttribute('aria-label', branch.name + (kind === 'local' ? ' (LOCAL)' : ' (REMOTE)'));
                option.title = branch.name;
                option.textContent = branch.name;
                if (renderedIndex === this.selectedSuggestionIndex) option.classList.add('selected');
                option.addEventListener('mousedown', (event: MouseEvent) => { event.preventDefault(); });
                option.addEventListener('click', () => { this.confirmBranch(input, branch); });
                group.appendChild(option);
                renderedIndex++;
            }
            this.suggestionsElement.appendChild(group);
        }
        const activeOption = this.suggestionsElement.querySelector('.branch-compare-suggestion.selected');
        if (activeOption !== null) {
            input.setAttribute('aria-activedescendant', activeOption.id);
            activeOption.scrollIntoView({block: 'nearest'});
        }
    }

    private appendSuggestionStatus(text: string): void {
        const status = document.createElement('div');
        status.classList.add('branch-compare-suggestion-empty');
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        status.textContent = text;
        this.suggestionsElement.appendChild(status);
    }

    private confirmBranch(input: BranchInput, branch: GitBranchInfo): void {
        this.invalidateResults(true);
        input.value = branch.name;
        input.title = branch.name;
        input.setAttribute('data-selected-ref', branch.ref);
        this.persistState(false);
        this.dismissSuggestions();
        this.updateCompareButton();
    }

    private canRenderSuggestions(): boolean {
        return this.activeInput !== false
            && this.isVisible()
            && document.activeElement === this.activeInput;
    }

    private isVisible(): boolean {
        return this.element.classList.contains('sidebar-panel-active');
    }

    private dismissSuggestions(): void {
        this.activeInput = false;
        this.selectedSuggestionIndex = -1;
        this.hideSuggestions();
    }

    private hideSuggestions(): void {
        this.suggestionsElement.classList.remove('visible');
        this.baseInput.setAttribute('aria-expanded', 'false');
        this.targetInput.setAttribute('aria-expanded', 'false');
        this.baseInput.removeAttribute('aria-activedescendant');
        this.targetInput.removeAttribute('aria-activedescendant');
    }

    private updateCompareButton(): void {
        const leftRef = this.baseInput.getAttribute('data-selected-ref');
        const rightRef = this.targetInput.getAttribute('data-selected-ref');
        this.compareButton.disabled = this.compareBusy || !this.branchListLoaded || leftRef === null || rightRef === null || leftRef === rightRef;
        this.swapButton.disabled = this.compareBusy;
    }

    private async compareAsync(): Promise<void> {
        const leftRef = this.baseInput.getAttribute('data-selected-ref');
        const rightRef = this.targetInput.getAttribute('data-selected-ref');
        if (this.compareBusy || !this.branchListLoaded || leftRef === null || rightRef === null || leftRef === rightRef) return;
        const requestId = ++this.compareRequestId;
        const leftLabel = this.baseInput.value;
        const rightLabel = this.targetInput.value;
        this.invalidateResults(false);
        this.persistState(false);
        this.dismissSuggestions();
        this.compareBusy = true;
        this.updateCompareButton();
        this.baseInput.disabled = true;
        this.targetInput.disabled = true;
        this.element.classList.add('branch-compare-busy');
        this.resultsElement.setAttribute('aria-busy', 'true');
        this.statusElement.textContent = '比較中…';
        try {
            const result = await gitBranchCompareAsync(leftRef, rightRef);
            if (requestId !== this.compareRequestId) return;
            this.resultsElement.replaceChildren();
            if (result.files.length === 0) {
                const empty = document.createElement('div');
                empty.classList.add('branch-compare-empty-message');
                empty.textContent = '変更されたファイルはありません';
                this.resultsElement.appendChild(empty);
            } else {
                for (const file of result.files) this.resultsElement.appendChild(this.createFileItem(file, result.leftCommit, result.rightCommit, leftLabel, rightLabel));
            }
            this.statusElement.textContent = '';
            this.persistState(true);
            this.tab.notifyBranchCompareSelection();
        } catch (error: unknown) {
            if (requestId !== this.compareRequestId) return;
            this.resultsElement.replaceChildren();
            this.showOperationError(error);
        }
        if (requestId !== this.compareRequestId) return;
        this.compareBusy = false;
        this.element.classList.remove('branch-compare-busy');
        this.resultsElement.setAttribute('aria-busy', 'false');
        this.statusElement.textContent = '';
        this.baseInput.disabled = false;
        this.targetInput.disabled = false;
        this.updateCompareButton();
    }

    private createFileItem(file: GitBranchCompareFile, leftCommit: string, rightCommit: string, leftLabel: string, rightLabel: string): HTMLElement {
        const group = document.createElement('div');
        group.classList.add('branch-compare-file-group');
        const item = document.createElement('div');
        item.classList.add('branch-compare-file-item');
        item.setAttribute('data-status', file.status);
        item.setAttribute('role', 'listitem');
        item.setAttribute('tabindex', '0');
        item.setAttribute('aria-current', 'false');
        item.title = file.path;
        const statusLabel = file.status === 'A' ? '追加' : file.status === 'D' ? '削除' : '変更';
        item.setAttribute('aria-label', file.tableName + '、' + statusLabel + '、' + file.path);

        const title = document.createElement('div');
        title.classList.add('branch-compare-file-title');
        item.appendChild(title);

        const name = document.createElement('span');
        name.classList.add('branch-compare-file-name');
        name.textContent = file.tableName;
        name.title = file.path;
        title.appendChild(name);

        const openFileButton = document.createElement('button');
        openFileButton.type = 'button';
        openFileButton.classList.add('branch-compare-open-file');
        openFileButton.title = '実テーブルを開く';
        openFileButton.setAttribute('aria-label', file.tableName + 'の実テーブルを開く');
        openFileButton.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5h5.5l2.5 2.5v8.5H4z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M9.5 2.5V5H12" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
        openFileButton.addEventListener('click', (event: MouseEvent) => {
            event.stopPropagation();
            this.cancelFileOpen(true);
            this.tab.openTableAsync(file.tableName)
                .then(opened => {
                    if (!opened) this.showOperationError(new Error('実テーブル「' + file.tableName + '」を開けませんでした。'));
                })
                .catch((error: unknown) => { this.showOperationError(error); });
        });
        title.appendChild(openFileButton);

        const status = document.createElement('span');
        status.classList.add('branch-compare-file-status');
        status.textContent = file.status;
        title.appendChild(status);

        const openDiff = (): void => {
            this.element.querySelectorAll('.branch-compare-file-item-active').forEach(element => {
                element.classList.remove('branch-compare-file-item-active');
                element.setAttribute('aria-current', 'false');
            });
            item.classList.add('branch-compare-file-item-active');
            item.setAttribute('aria-current', 'true');
            if (this.fileOpenController !== false) this.fileOpenController.abort();
            const controller = new AbortController();
            this.fileOpenController = controller;
            this.resultsElement.setAttribute('aria-busy', 'true');
            this.tab.openBranchCompareDiffTabAsync(file, leftCommit, rightCommit, leftLabel, rightLabel, controller.signal)
                .then(() => {
                    if (this.fileOpenController !== controller || controller.signal.aborted) return;
                    this.fileOpenController = false;
                    this.resultsElement.setAttribute('aria-busy', 'false');
                    this.statusElement.textContent = '';
                })
                .catch((error: unknown) => {
                    if (this.fileOpenController !== controller || controller.signal.aborted) return;
                    this.fileOpenController = false;
                    this.resultsElement.setAttribute('aria-busy', 'false');
                    this.statusElement.textContent = '';
                    this.showOperationError(error);
                });
        };
        item.addEventListener('click', () => { openDiff(); });
        item.addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.target !== item) return;
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            openDiff();
        });
        group.appendChild(item);
        this.fileViews.push({file, leftCommit, rightCommit, item});
        return group;
    }

    private invalidateResults(invalidateCompare: boolean): void {
        this.restoreComparisonPending = false;
        if (invalidateCompare) {
            this.compareRequestId++;
            this.compareBusy = false;
            this.element.classList.remove('branch-compare-busy');
            this.baseInput.disabled = false;
            this.targetInput.disabled = false;
        }
        this.cancelFileOpen(false);
        this.fileViews.length = 0;
        this.resultsElement.replaceChildren();
        this.resultsElement.setAttribute('aria-busy', 'false');
        this.statusElement.textContent = '';
    }

    private cancelFileOpen(clearSelection: boolean): void {
        if (this.fileOpenController !== false) this.fileOpenController.abort();
        this.fileOpenController = false;
        if (!this.compareBusy) {
            this.resultsElement.setAttribute('aria-busy', 'false');
            this.statusElement.textContent = '';
        }
        if (clearSelection) {
            this.element.querySelectorAll('.branch-compare-file-item-active').forEach(element => {
                element.classList.remove('branch-compare-file-item-active');
                element.setAttribute('aria-current', 'false');
            });
        }
    }

    private showOperationError(error: unknown): void {
        this.notification.showError(error);
    }

    private handleUnexpectedCompareError(error: unknown): void {
        this.compareBusy = false;
        this.element.classList.remove('branch-compare-busy');
        this.resultsElement.setAttribute('aria-busy', 'false');
        this.baseInput.disabled = false;
        this.targetInput.disabled = false;
        this.statusElement.textContent = '';
        this.showOperationError(error);
        this.updateCompareButton();
    }
}
