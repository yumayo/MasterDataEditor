import type {UiStoredBranchCompareListTab} from '../app/ui-state';
import {gitBranchCompareAsync, gitBranchListAsync, gitShowAtCommitAsync, type GitBranchCompareFile, type GitBranchInfo} from '../app/api';
import {Tab} from '../tabs/tab';
import type {UiStateStore} from '../app/ui-state';
import type {NotificationToast} from '../ui/notification';
import {isCommitId} from '../core/git-revision';
import {appendHighlightedSegments} from '../search/fuzzy-search';
import {getAppliedSettings} from './settings-panel';
import {SETTINGS_CHANGED_EVENT, type SettingsChangedEventDetail} from '../settings/settings-schema';
import type {BranchCompareExportFilter} from '../diff/diff-build-result';
import {parseTemporalValue} from '../core/export-window';
import {WORKSPACE_SETTINGS_FILE} from '../config/masterdataeditor-path';

type RevisionInput = HTMLInputElement;

type ExportFilterTimeState =
    | {kind: 'idle'}
    | {kind: 'ready'; leftDateTime: string; rightDateTime: string}
    | {kind: 'error'; message: string};

interface BranchCompareFileView {
    file: GitBranchCompareFile;
    leftCommit: string;
    rightCommit: string;
    item: HTMLElement;
    group: HTMLElement;
    name: HTMLElement;
    exportFilter?: BranchCompareExportFilter;
}

/**
 * ブランチまたはコミットIDを指定し、2つのリビジョン間のCSV差分を表示するサイドバーパネル。
 * 選択済みrefは各inputのdata-selected-refへ保持し、DOMを選択状態のSSOTとする。
 */
export class BranchComparePanel {
    private readonly openListButton: HTMLButtonElement;
    private listMetadata: UiStoredBranchCompareListTab | false = false;
    private listOpenController: AbortController | false = false;
    private readonly element: HTMLElement;
    private readonly baseInput: RevisionInput;
    private readonly targetInput: RevisionInput;
    private readonly suggestionsElement: HTMLElement;
    private readonly compareButton: HTMLButtonElement;
    private readonly swapButton: HTMLButtonElement;
    private readonly filterInput: HTMLInputElement;
    private readonly filterClearButton: HTMLButtonElement;
    private readonly filterEmptyElement: HTMLElement;
    private readonly exportFilterCheckbox: HTMLInputElement;
    private readonly exportFilterSummary: HTMLElement;
    private exportFilterTimeState: ExportFilterTimeState = {kind: 'idle'};
    private readonly statusElement: HTMLElement;
    private readonly notification: NotificationToast;
    private readonly resultsElement: HTMLElement;
    private readonly tab: Tab;
    private readonly uiStateStore: UiStateStore;
    private restoreComparisonPending: boolean;
    private branches: GitBranchInfo[];
    private filteredBranches: GitBranchInfo[];
    private activeInput: RevisionInput | false;
    private selectedSuggestionIndex: number;
    private branchListLoaded: boolean;
    private branchListFailed: boolean;
    private branchListRequestId: number;
    private compareRequestId: number;
    private compareBusy: boolean;
    private compareController: AbortController | false;
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
        this.compareController = false;
        this.fileOpenController = false;

        this.element = document.createElement('div');
        this.element.classList.add('sidebar-panel', 'branch-compare-panel', 'sidebar-panel-fixed-header');

        const header = document.createElement('div');
        header.classList.add('sidebar-panel-header');
        header.textContent = 'REVISION COMPARE';
        this.element.appendChild(header);

        const controls = document.createElement('div');
        controls.classList.add('branch-compare-controls');
        this.element.appendChild(controls);

        this.suggestionsElement = document.createElement('div');
        this.suggestionsElement.id = 'branch-compare-suggestions';
        this.suggestionsElement.classList.add('branch-compare-suggestions');
        this.suggestionsElement.setAttribute('role', 'listbox');

        this.baseInput = this.createRevisionInput('branch-compare-base-input', 'branch-compare-base-input', '比較元（ブランチ / コミットID）');
        this.targetInput = this.createRevisionInput('branch-compare-target-input', 'branch-compare-target-input', '比較先（ブランチ / コミットID）');
        for (const [input, ref] of [[this.baseInput, storedState.baseRef], [this.targetInput, storedState.targetRef]] as const) {
            if (ref === null) continue;
            input.setAttribute('data-selected-ref', ref);
            if (isCommitId(ref)) {
                input.value = ref;
                input.title = ref;
            }
        }
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
        const actions = document.createElement('div');
        actions.classList.add('branch-compare-actions');
        actions.append(this.swapButton, this.compareButton);
        controls.appendChild(actions);
        this.openListButton = document.createElement('button');
        this.openListButton.type = 'button';
        this.openListButton.classList.add('branch-compare-open-list');
        this.openListButton.textContent = '一覧で表示';
        this.openListButton.disabled = true;
        this.openListButton.addEventListener('click', () => {
            if (this.listMetadata === false) return;
            this.cancelFileOpen(true);
            const controller = new AbortController();
            this.fileOpenController = controller;
            this.listOpenController = controller;
            this.updateCompareButton();
            this.tab.openBranchCompareListTabAsync(this.listMetadata, controller.signal).catch((error: unknown) => {
                if (!controller.signal.aborted) this.showOperationError(error);
            }).finally(() => {
                if (this.listOpenController !== controller) return;
                this.listOpenController = false;
                if (this.fileOpenController === controller) this.fileOpenController = false;
                this.updateCompareButton();
            });
        });
        controls.appendChild(this.openListButton);
        for (const button of [this.compareButton, this.swapButton]) {
            // 候補を畳むのはclick時とし、mousedownのblurでボタンが動くことを防ぐ。
            button.addEventListener('mousedown', (event: MouseEvent) => {
                if (this.suggestionsElement.classList.contains('visible')) event.preventDefault();
            });
        }

        this.filterInput = document.createElement('input');
        this.filterInput.type = 'text';
        this.filterInput.classList.add('branch-compare-filter-input');
        this.filterInput.placeholder = 'テーブル名でフィルタ';
        this.filterInput.setAttribute('aria-label', 'テーブル名でフィルタ');
        this.filterInput.autocomplete = 'off';
        this.filterInput.spellcheck = false;
        this.filterInput.addEventListener('input', () => {
            this.applyFileFilter();
            this.resultsElement.scrollTop = 0;
        });
        this.filterClearButton = document.createElement('button');
        this.filterClearButton.type = 'button';
        this.filterClearButton.classList.add('branch-compare-filter-clear');
        this.filterClearButton.setAttribute('aria-label', 'テーブル名フィルタをクリア');
        this.filterClearButton.title = 'テーブル名フィルタをクリア';
        this.filterClearButton.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M9.35 3.35L6.71 6l2.64 2.65-.71.7L6 6.71 3.35 9.35l-.7-.7L5.29 6 2.65 3.35l.7-.7L6 5.29l2.65-2.64.7.7z" fill="currentColor"/></svg>';
        this.filterClearButton.hidden = true;
        this.filterClearButton.addEventListener('click', () => {
            this.filterInput.value = '';
            this.applyFileFilter();
            this.resultsElement.scrollTop = 0;
            this.filterInput.focus();
        });

        const filterContainer = document.createElement('div');
        filterContainer.classList.add('branch-compare-filter-container');
        filterContainer.append(this.filterInput, this.filterClearButton);
        controls.appendChild(filterContainer);

        const exportFilterLabel = document.createElement('label');
        exportFilterLabel.classList.add('settings-toggle', 'branch-compare-export-filter-label');
        exportFilterLabel.title = '出力時刻でフィルタ';
        exportFilterLabel.addEventListener('mousedown', (event: MouseEvent) => {
            if (this.suggestionsElement.classList.contains('visible')) event.preventDefault();
        });
        this.exportFilterCheckbox = document.createElement('input');
        this.exportFilterCheckbox.type = 'checkbox';
        this.exportFilterCheckbox.classList.add('settings-toggle-input');
        this.exportFilterCheckbox.setAttribute('aria-label', '出力時刻でフィルタ');
        this.exportFilterCheckbox.checked = storedState.exportFilterEnabled === true;
        this.exportFilterCheckbox.addEventListener('change', () => { this.refreshExportComparison(); });
        const exportFilterTrack = document.createElement('span');
        exportFilterTrack.classList.add('settings-toggle-track');
        exportFilterTrack.setAttribute('aria-hidden', 'true');
        const exportFilterThumb = document.createElement('span');
        exportFilterThumb.classList.add('settings-toggle-thumb');
        exportFilterTrack.appendChild(exportFilterThumb);
        const exportFilterCaption = document.createElement('span');
        exportFilterCaption.classList.add('branch-compare-export-filter-caption');
        exportFilterCaption.textContent = '出力時刻でフィルタ';
        exportFilterLabel.append(this.exportFilterCheckbox, exportFilterTrack, exportFilterCaption);
        actions.prepend(exportFilterLabel);
        this.exportFilterSummary = document.createElement('div');
        this.exportFilterSummary.classList.add('branch-compare-export-filter-summary');
        this.exportFilterSummary.setAttribute('role', 'status');
        filterContainer.before(this.exportFilterSummary);

        this.filterEmptyElement = document.createElement('div');
        this.filterEmptyElement.classList.add('branch-compare-empty-message');
        this.filterEmptyElement.setAttribute('role', 'status');
        this.filterEmptyElement.textContent = '該当するテーブルはありません';
        this.filterEmptyElement.hidden = true;

        this.statusElement = document.createElement('div');
        this.statusElement.classList.add('branch-compare-status');
        this.statusElement.setAttribute('aria-live', 'polite');
        controls.appendChild(this.statusElement);

        this.resultsElement = document.createElement('div');
        this.resultsElement.classList.add('branch-compare-results', 'sidebar-panel-scroll-content');
        this.resultsElement.setAttribute('role', 'list');
        this.element.appendChild(this.resultsElement);

        document.addEventListener('mousedown', (event: MouseEvent) => {
            if (event.target instanceof Node && !this.element.contains(event.target)) this.dismissSuggestions();
        });
        this.tab.connectBranchCompareListener(metadata => {
            for (const view of this.fileViews) {
                const active = metadata !== null && metadata.gitPath === view.file.path && metadata.leftCommit === view.leftCommit && metadata.rightCommit === view.rightCommit
                    && JSON.stringify(metadata.exportFilter) === JSON.stringify(view.exportFilter);
                view.item.classList.toggle('branch-compare-file-item-active', active);
                view.item.setAttribute('aria-current', String(active));
            }
        });
        window.addEventListener(SETTINGS_CHANGED_EVENT, (event: Event) => {
            const detail = (event as CustomEvent<SettingsChangedEventDetail>).detail;
            const filterChanged = detail.changedKeys.some(key => key === 'exportBeginDateColumnName' || key === 'exportEndDateColumnName');
            if (filterChanged && this.exportFilterCheckbox.checked) this.refreshExportComparison();
        });
        this.updateCompareButton();
    }

    appendTo(parent: HTMLElement): void {
        parent.appendChild(this.element);
    }

    /** 起動時に別パネルが開いていても保存済みの比較対象を検証・復元する。 */
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

    private createRevisionInput(id: string, className: string, ariaLabel: string): RevisionInput {
        const input = document.createElement('input');
        input.id = id;
        input.type = 'text';
        input.classList.add(className);
        input.placeholder = 'ブランチ / コミットID';
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
            this.resolveRevision(input);
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
                    this.resolveRevision(input);
                    continue;
                }
                if (isCommitId(selectedRef)) {
                    input.value = selectedRef;
                    input.title = selectedRef;
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
        }
        if (this.restoreComparisonPending && this.areRefsReady()) {
            this.restoreComparisonPending = false;
            await this.compareAsync().catch((error: unknown) => { this.handleUnexpectedCompareError(error); });
        }
    }

    private resolveRevision(input: RevisionInput): void {
        input.removeAttribute('data-selected-ref');
        const value = input.value.trim();
        if (this.branchListLoaded) {
            const matches = this.branches.filter(branch => branch.name === value || branch.ref === value);
            // 同名のlocal/remoteブランチがある場合は候補からの明示選択を必要とする。
            if (matches.length > 1) return;
            if (matches.length === 1) {
                input.setAttribute('data-selected-ref', matches[0].ref);
                return;
            }
        }
        if (isCommitId(value)) input.setAttribute('data-selected-ref', value.toLowerCase());
    }

    private persistState(compared: boolean): void {
        this.uiStateStore.setBranchCompareState({
            baseRef: this.baseInput.getAttribute('data-selected-ref'),
            targetRef: this.targetInput.getAttribute('data-selected-ref'),
            compared,
            ...(this.exportFilterCheckbox.checked ? {exportFilterEnabled: true} : {}),
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
        const query = input.value.trim().toLocaleLowerCase();
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
        const selectedRef = input.getAttribute('data-selected-ref');
        const commitSelected = selectedRef !== null && isCommitId(selectedRef);
        if (commitSelected) this.appendSuggestionStatus('コミットIDで比較します');
        if (this.filteredBranches.length === 0) {
            if (!commitSelected) this.appendSuggestionStatus('該当するブランチがありません');
            return;
        }
        if (this.selectedSuggestionIndex === -1 && !commitSelected) {
            // 完全一致したrefを優先し、TabやEnterで別ブランチへ変わることを防ぐ。
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

    private confirmBranch(input: RevisionInput, branch: GitBranchInfo): void {
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

    private areRefsReady(): boolean {
        const leftRef = this.baseInput.getAttribute('data-selected-ref');
        const rightRef = this.targetInput.getAttribute('data-selected-ref');
        return leftRef !== null && rightRef !== null && leftRef !== rightRef
            && (this.branchListLoaded || (isCommitId(leftRef) && isCommitId(rightRef)));
    }

    private updateCompareButton(): void {
        const settings = getAppliedSettings();
        const columnsConfigured = settings.exportBeginDateColumnName.trim() !== '' && settings.exportEndDateColumnName.trim() !== '';
        this.exportFilterSummary.hidden = !this.exportFilterCheckbox.checked;
        const timeState = this.exportFilterTimeState;
        if (!columnsConfigured) {
            this.exportFilterSummary.textContent = '設定画面で開始・終了日時列を設定してください';
        } else if (timeState.kind === 'error') {
            this.exportFilterSummary.textContent = timeState.message;
        } else if (timeState.kind === 'ready') {
            this.exportFilterSummary.textContent = '比較元の出力時刻: ' + timeState.leftDateTime.replace('T', ' ') + '\n比較先の出力時刻: ' + timeState.rightDateTime.replace('T', ' ');
        } else {
            this.exportFilterSummary.textContent = this.compareBusy ? '比較元・比較先の出力時刻を取得中…' : '比較すると比較元・比較先それぞれの出力時刻を取得します';
        }
        this.exportFilterSummary.title = '開始日時列: ' + settings.exportBeginDateColumnName + ' / 終了日時列: ' + settings.exportEndDateColumnName;
        this.compareButton.disabled = this.compareBusy || !this.areRefsReady() || (this.exportFilterCheckbox.checked && !columnsConfigured);
        this.swapButton.disabled = this.compareBusy;
        this.openListButton.disabled = this.compareBusy || this.listMetadata === false || this.listOpenController !== false;
    }

    private refreshExportComparison(): void {
        const compared = this.compareBusy || this.uiStateStore.getState().sidebar.branchCompare.compared;
        this.dismissSuggestions();
        this.invalidateResults(true);
        this.persistState(false);
        this.updateCompareButton();
        if (compared && !this.compareButton.disabled) this.compareAsync().catch((error: unknown) => { this.handleUnexpectedCompareError(error); });
    }

    private async compareAsync(): Promise<void> {
        const leftRef = this.baseInput.getAttribute('data-selected-ref');
        const rightRef = this.targetInput.getAttribute('data-selected-ref');
        if (this.compareButton.disabled || this.compareBusy || !this.areRefsReady() || leftRef === null || rightRef === null) return;
        const requestId = ++this.compareRequestId;
        const leftLabel = this.baseInput.value.trim();
        const rightLabel = this.targetInput.value.trim();
        this.invalidateResults(false);
        const controller = new AbortController();
        this.compareController = controller;
        const exportFilterEnabled = this.exportFilterCheckbox.checked;
        const settings = getAppliedSettings();
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
            // CSVと同じ確定コミットから左右それぞれの時刻を読み、両方が揃ってから比較条件を公開する。
            const times = exportFilterEnabled ? await Promise.all([
                this.loadExportDateTimeAsync(result.leftCommit, '比較元'),
                this.loadExportDateTimeAsync(result.rightCommit, '比較先'),
            ]) : null;
            if (requestId !== this.compareRequestId) return;
            const exportFilter: BranchCompareExportFilter | undefined = times === null ? undefined : {
                leftDateTime: times[0], rightDateTime: times[1],
                beginColumnName: settings.exportBeginDateColumnName, endColumnName: settings.exportEndDateColumnName,
            };
            if (exportFilter !== undefined) {
                this.exportFilterTimeState = {kind: 'ready', leftDateTime: exportFilter.leftDateTime, rightDateTime: exportFilter.rightDateTime};
                this.updateCompareButton();
            }
            const files = exportFilter === undefined ? result.files : await this.tab.filterBranchCompareFilesAsync(result.files, result.leftCommit, result.rightCommit, exportFilter, controller.signal);
            if (requestId !== this.compareRequestId) return;
            this.resultsElement.replaceChildren();
            if (files.length === 0) {
                const empty = document.createElement('div');
                empty.classList.add('branch-compare-empty-message');
                empty.textContent = exportFilter === undefined ? '変更されたファイルはありません' : '出力対象に差分のあるテーブルはありません';
                this.resultsElement.appendChild(empty);
            } else {
                for (const file of files) this.resultsElement.appendChild(this.createFileItem(file, result.leftCommit, result.rightCommit, leftLabel, rightLabel, exportFilter));
                this.resultsElement.appendChild(this.filterEmptyElement);
                this.applyFileFilter();
            }
            this.listMetadata = files.length === 0 ? false : {
                kind: 'branchCompareList', tableName: '一覧', gitPath: 'revision-compare-list', isStaged: true, isNew: false, fileStatus: null,
                leftCommit: result.leftCommit, rightCommit: result.rightCommit, leftLabel, rightLabel, files: files.map(file => ({...file})),
                ...(exportFilter ? {exportFilter: {...exportFilter}} : {}),
            };
            this.openListButton.title = 'テーブル名フィルタに関係なく全 ' + files.length + ' テーブルの差分を表示';
            this.statusElement.textContent = '';
            this.persistState(true);
            this.tab.notifyBranchCompareSelection();
        } catch (error: unknown) {
            if (requestId !== this.compareRequestId) return;
            if (exportFilterEnabled && this.exportFilterTimeState.kind !== 'ready') this.exportFilterTimeState = {kind: 'error', message: error instanceof Error ? error.message : String(error)};
            this.resultsElement.replaceChildren();
            this.showOperationError(error);
        }
        if (requestId !== this.compareRequestId) return;
        this.compareController = false;
        this.compareBusy = false;
        this.element.classList.remove('branch-compare-busy');
        this.resultsElement.setAttribute('aria-busy', 'false');
        this.statusElement.textContent = '';
        this.baseInput.disabled = false;
        this.targetInput.disabled = false;
        this.updateCompareButton();
    }

    private async loadExportDateTimeAsync(commit: string, sourceLabel: string): Promise<string> {
        let json: string;
        try {
            json = await gitShowAtCommitAsync(commit, WORKSPACE_SETTINGS_FILE);
        } catch {
            throw new Error(sourceLabel + 'のリビジョンから設定ファイル（' + WORKSPACE_SETTINGS_FILE + '）を読み込めませんでした。');
        }
        let settings: unknown;
        try {
            settings = JSON.parse(json);
        } catch {
            throw new Error(sourceLabel + 'のリビジョンの設定ファイルが正しいJSONではありません。');
        }
        const dateTime = settings !== null && typeof settings === 'object' && 'exportValidationDateTime' in settings ? settings.exportValidationDateTime : undefined;
        if (typeof dateTime !== 'string' || parseTemporalValue(dateTime).kind !== 'valid') {
            throw new Error(sourceLabel + 'のリビジョンに有効な出力フィルター時刻が設定されていません。');
        }
        return dateTime;
    }

    private createFileItem(file: GitBranchCompareFile, leftCommit: string, rightCommit: string, leftLabel: string, rightLabel: string, exportFilter?: BranchCompareExportFilter): HTMLElement {
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
            this.cancelFileOpen(false);
            const controller = new AbortController();
            this.fileOpenController = controller;
            this.resultsElement.setAttribute('aria-busy', 'true');
            this.tab.openBranchCompareDiffTabAsync(file, leftCommit, rightCommit, leftLabel, rightLabel, controller.signal, exportFilter)
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
        this.fileViews.push({file, leftCommit, rightCommit, item, group, name, exportFilter});
        return group;
    }

    private applyFileFilter(): void {
        this.filterClearButton.hidden = this.filterInput.value === '';
        const query = this.filterInput.value.trim().toLocaleLowerCase();
        let visibleCount = 0;
        for (const view of this.fileViews) {
            const matches = view.file.tableName.toLocaleLowerCase().includes(query);
            view.group.hidden = !matches;
            if (matches) {
                view.name.replaceChildren();
                appendHighlightedSegments(view.name, view.file.tableName, query);
                visibleCount++;
            }
        }
        this.filterEmptyElement.hidden = this.fileViews.length === 0 || visibleCount > 0;
    }

    private invalidateResults(invalidateCompare: boolean): void {
        this.listMetadata = false;
        this.openListButton.disabled = true;
        this.restoreComparisonPending = false;
        this.exportFilterTimeState = {kind: 'idle'};
        if (invalidateCompare) {
            if (this.compareController !== false) this.compareController.abort();
            this.compareController = false;
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
        this.listOpenController = false;
        this.openListButton.disabled = this.compareBusy || this.listMetadata === false;
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
        if (this.compareController !== false) this.compareController.abort();
        this.compareController = false;
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
