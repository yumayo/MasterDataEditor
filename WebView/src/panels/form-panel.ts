import {InMemoryTableStore} from "../data/in-memory-table-store";
import {ReverseReferenceEntry} from "../references/reverse-reference-resolver";
import {ReverseReferenceEngine} from "../references/reverse-reference-engine";
import {determineDisplayColumnName} from "../config/config";
import {readFileAsync} from "../app/api";
import {extractFirstPrimaryKeyColumn} from "../core/schema-utils";
import {
    parseReferenceExpression,
    isSimpleReference,
    isDynamicReference,
    DynamicReference,
    DynamicReferenceSchema,
} from "../references/reference-expression";
import {Tab} from "../tabs/tab";
import {NotificationToast} from "../ui/notification";
import {ValidationError} from "../validation/validation-engine";
import {ValidationPanel} from "./validation-panel";
import {GridDropdownInput, GridDropdownItem} from "../ui/grid-dropdown-input";
import {ReferenceDataCache} from "../references/reference-data-cache";
import {EditorTableData} from "../data/models/editor-table-data";

export interface FormPanelNavEntry {
    tableName: string;
    pkValue: string;
    label: string;
    storeRowIndex?: number;
}

interface FormPage extends FormPanelNavEntry {}

interface CurrentPageData {
    nodeId: string;
    tableName: string;
    header: string[];
    rows: string[][];
    row: string[];
    rowIndex: number;
    schema: SchemaJson;
    pkColumnName: string;
    pkColumnIndex: number;
    referenceLockedColumnNames: ReadonlySet<string>;
}

interface ReferenceSection {
    relationKind: 'outgoing' | 'incoming';
    eyebrow: string;
    heading: string;
    title: string;
    badge: string;
    emptyText: string;
    items: ReferenceItem[];
    attached: boolean;
}

interface ReferenceItem {
    tableName: string;
    pkValue: string;
    storeRowIndex: number | null;
    pkColumnIndex: number;
    primaryText: string;
    metaParts: string[];
    canOpen: boolean;
    missing: boolean;
}

interface IndexedRow {
    row: string[];
    storeRowIndex: number;
}

type DisplayCandidateSource =
    | 'display-column'
    | 'reference-cache'
    | 'natural-column'
    | 'scalar-column'
    | 'pk'
    | 'none';

interface DisplayCandidate {
    text: string;
    source: DisplayCandidateSource;
    columnName: string | null;
}

interface RowReferenceSummary {
    kind: 'simple' | 'dynamic';
    primaryText: string;
    consumedColumns: Set<string>;
}

interface ReferenceFieldDropdownData {
    tableName: string;
    items: GridDropdownItem[];
}

interface ActiveReferenceField {
    nodeId: string;
    columnName: string;
    input: HTMLInputElement | HTMLTextAreaElement;
    mirror: HTMLElement;
    valueWrapper: HTMLElement;
}

interface FormNodeMeta {
    tableName: string;
    pkValue: string;
    storeRowIndex: number | null;
    parentNodeId: string | null;
    depth: number;
}

/**
 * フォームビューパネル
 *
 * 選択行を入力可能なフォームとして表示する。
 * 入力は開いている EditorTable の通常セル編集と同じ経路に流し、
 * バリデーション結果と参照一覧をフォーム内にも反映する。
 */
export class FormPanel {
    private readonly panelElement: HTMLElement;
    private readonly store: InMemoryTableStore;
    private readonly referenceDataCache: ReferenceDataCache;
    private readonly reverseReferenceEngine: ReverseReferenceEngine;
    private readonly tab: Tab;
    private readonly notification: NotificationToast;
    private readonly validationPanel: ValidationPanel | false;
    private navStack: FormPage[];
    private currentRequestId: number;
    private nextNodeRenderRequestId: number;
    private readonly nodeDataById: Map<string, CurrentPageData>;
    private readonly nodeElementsById: Map<string, HTMLElement>;
    private readonly nodeMetaById: Map<string, FormNodeMeta>;
    private readonly nodeRenderRequestIds: Map<string, number>;
    private readonly commitTimers: Map<string, number>;
    private readonly pendingCommitValues: Map<string, { nodeId: string; columnName: string; value: string }>;
    private readonly editedTableNames: Set<string>;
    private readonly registeredForEditTableNames: Set<string>;
    private readonly referenceDropdown: GridDropdownInput;
    private activeReferenceField: ActiveReferenceField | null;
    private referenceDropdownRequestId: number;

    constructor(store: InMemoryTableStore, referenceDataCache: ReferenceDataCache, reverseReferenceEngine: ReverseReferenceEngine, tab: Tab, notification: NotificationToast, validationPanel: ValidationPanel | false) {
        this.store = store;
        this.referenceDataCache = referenceDataCache;
        this.reverseReferenceEngine = reverseReferenceEngine;
        this.tab = tab;
        this.notification = notification;
        this.validationPanel = validationPanel;
        this.navStack = [];
        this.currentRequestId = 0;
        this.nextNodeRenderRequestId = 0;
        this.nodeDataById = new Map();
        this.nodeElementsById = new Map();
        this.nodeMetaById = new Map();
        this.nodeRenderRequestIds = new Map();
        this.commitTimers = new Map();
        this.pendingCommitValues = new Map();
        this.editedTableNames = new Set();
        this.registeredForEditTableNames = new Set();
        this.activeReferenceField = null;
        this.referenceDropdownRequestId = 0;

        const panel = document.createElement('div');
        panel.classList.add('form-panel');
        panel.classList.add('form-panel--preparing');
        this.panelElement = panel;

        const content = document.createElement('div');
        content.classList.add('form-panel-content');

        this.panelElement.appendChild(content);

        this.referenceDropdown = new GridDropdownInput(
            this.panelElement,
            this.panelElement,
            (id: string) => { this.applyReferenceDropdownSelection(id); },
            () => { this.activeReferenceField = null; },
            () => this.activeReferenceField?.input.value ?? '',
        );
        this.tab.connectDropdownQuickView(this.referenceDropdown);
        content.addEventListener('scroll', () => {
            if (this.referenceDropdown.isVisible()) this.hideReferenceDropdown();
        });
    }

    appendTo(parent: HTMLElement): void {
        parent.appendChild(this.panelElement);
    }

    remove(): void {
        ++this.currentRequestId;
        this.clearCommitTimers();
        this.hideReferenceDropdown();
        this.nodeDataById.clear();
        this.nodeElementsById.clear();
        this.nodeMetaById.clear();
        this.nodeRenderRequestIds.clear();
        this.releaseCleanRegisteredTables();
        this.panelElement.remove();
    }

    containsElement(element: Element | null): boolean {
        return element !== null && this.panelElement.contains(element);
    }

    isConnected(): boolean {
        return this.panelElement.isConnected;
    }

    showForRowAsync(tableName: string, pkValue: string, storeRowIndex: number | null = null): Promise<void> {
        this.navStack = [{ tableName, pkValue, label: `${tableName} / ${pkValue}`, ...this.buildOptionalStoreRowIndex(storeRowIndex) }];
        return this.renderCurrentPageAsync();
    }

    restoreNavStackAsync(navStack: Array<{tableName: string; pkValue: string; label: string; storeRowIndex?: number}>): Promise<void> {
        const root = navStack[0];
        this.navStack = root === undefined ? [] : [{
            tableName: root.tableName,
            pkValue: root.pkValue,
            label: root.label,
            ...this.buildOptionalStoreRowIndex(root.storeRowIndex ?? null),
        }];
        return this.renderCurrentPageAsync();
    }

    getNavStackSnapshot(): FormPanelNavEntry[] {
        return this.navStack.map(page => ({
            tableName: page.tableName,
            pkValue: page.pkValue,
            label: page.label,
            ...this.buildOptionalStoreRowIndex(page.storeRowIndex ?? null),
        }));
    }

    async flushPendingCommitsAsync(): Promise<void> {
        const pending = Array.from(this.pendingCommitValues.values());
        for (const entry of pending) {
            await this.commitFieldValueAsync(entry.nodeId, entry.columnName, entry.value);
        }
    }

    getEditedTableNames(): string[] {
        return [...this.editedTableNames];
    }

    markEditedTablesSaved(tableNames: readonly string[]): void {
        for (const tableName of tableNames) this.editedTableNames.delete(tableName);
    }

    private async renderCurrentPageAsync(): Promise<void> {
        const requestId = ++this.currentRequestId;
        const page = this.navStack[0];
        this.clearCommitTimers();
        this.hideReferenceDropdown();
        const content = this.getContentElement();
        const keepCurrentContentVisible = content.childElementCount > 0 && !this.panelElement.classList.contains('form-panel--preparing');

        this.nodeDataById.clear();
        this.nodeElementsById.clear();
        this.nodeMetaById.clear();
        this.nodeRenderRequestIds.clear();
        this.panelElement.classList.toggle('form-panel--updating', keepCurrentContentVisible);
        this.panelElement.setAttribute('aria-busy', 'true');
        if (!keepCurrentContentVisible) this.panelElement.classList.add('form-panel--preparing');

        const nextContent = document.createElement('div');

        if (page === undefined) {
            nextContent.replaceChildren(this.buildMessage('フォームビューを表示する行を選択してください', 'form-panel-not-found'));
            this.replaceContentIfCurrent(content, nextContent, requestId);
            return;
        }

        try {
            await this.renderNodeIntoAsync(nextContent, 'root', page.tableName, page.pkValue, page.storeRowIndex ?? null, 0, null, requestId, true, nextContent);
            if (requestId !== this.currentRequestId) return;
            this.replaceContentIfCurrent(content, nextContent, requestId);
        } catch (err) {
            if (requestId !== this.currentRequestId) return;
            this.nodeDataById.clear();
            this.nodeElementsById.clear();
            this.nodeMetaById.clear();
            this.nodeRenderRequestIds.clear();
            nextContent.replaceChildren(this.buildMessage('エラーが発生しました', 'form-panel-error'));
            this.replaceContentIfCurrent(content, nextContent, requestId);
            console.error('[FormPanel] renderCurrentPageAsync failed:', err);
            this.notification.show('フォームの表示に失敗しました');
        }
    }

    private replaceContentIfCurrent(content: HTMLElement, nextContent: HTMLElement, requestId: number): void {
        if (requestId !== this.currentRequestId) return;
        content.replaceChildren(...Array.from(nextContent.childNodes));
        this.revealIfCurrent(requestId);
    }

    private revealIfCurrent(requestId: number): void {
        if (requestId !== this.currentRequestId) return;
        this.panelElement.classList.remove('form-panel--preparing');
        this.panelElement.classList.remove('form-panel--updating');
        this.panelElement.removeAttribute('aria-busy');
    }

    private async renderNodeIntoAsync(
        container: HTMLElement,
        nodeId: string,
        tableName: string,
        pkValue: string,
        storeRowIndex: number | null,
        depth: number,
        parentNodeId: string | null,
        requestId: number,
        includeReferences: boolean = true,
        renderRoot: HTMLElement = this.panelElement,
    ): Promise<void> {
        const nodeRequestId = ++this.nextNodeRenderRequestId;
        this.nodeRenderRequestIds.set(nodeId, nodeRequestId);

        const node = document.createElement('div');
        node.classList.add('form-panel-node');
        node.classList.add(depth === 0 ? 'form-panel-node--root' : 'form-panel-node--child');
        node.dataset.nodeId = nodeId;
        node.dataset.tableName = tableName;
        node.dataset.pkValue = pkValue;
        if (storeRowIndex !== null) node.dataset.storeRowIndex = String(storeRowIndex);
        node.dataset.depth = String(depth);
        this.nodeElementsById.set(nodeId, node);
        this.nodeMetaById.set(nodeId, { tableName, pkValue, storeRowIndex, parentNodeId, depth });

        container.replaceChildren(node);
        node.replaceChildren(this.buildMessage('読み込み中...', 'form-panel-loading'));

        try {
            const [tableData, schema] = await Promise.all([
                this.resolveTableDataAsync(tableName),
                this.loadSchemaJsonAsync(tableName),
            ]);
            if (!this.isNodeRenderCurrent(nodeId, nodeRequestId, requestId)) return;

            const pkColumnName = extractFirstPrimaryKeyColumn(schema);
            const pkColumnIndex = tableData.header.indexOf(pkColumnName);
            const rowIndex = this.resolveTargetRowIndex(tableData.rows, pkColumnIndex, pkValue, storeRowIndex);

            node.replaceChildren();

            if (rowIndex === -1) {
                node.appendChild(this.buildMessage(`PK "${pkValue}" の行が見つかりません`, 'form-panel-not-found'));
                return;
            }

            const row = tableData.rows[rowIndex];
            node.dataset.storeRowIndex = String(rowIndex);
            this.nodeMetaById.set(nodeId, { tableName, pkValue, storeRowIndex: rowIndex, parentNodeId, depth });
            const referenceLockedColumnNames = await this.resolveReferenceLockedColumnNamesAsync(tableName, tableData.header, row, schema, requestId);
            if (!this.isNodeRenderCurrent(nodeId, nodeRequestId, requestId)) return;
            this.nodeDataById.set(nodeId, {
                nodeId,
                tableName,
                header: tableData.header,
                rows: tableData.rows,
                row,
                rowIndex,
                schema,
                pkColumnName,
                pkColumnIndex,
                referenceLockedColumnNames,
            });

            node.appendChild(this.buildFields(nodeId, row, tableData.header, schema, referenceLockedColumnNames));
            if (includeReferences) {
                node.appendChild(this.buildReferencesContainer());

                await Promise.all([
                    this.refreshValidationAsync(requestId, renderRoot),
                    this.renderReferencesAsync(nodeId, requestId, renderRoot),
                ]);
            } else {
                await this.refreshValidationAsync(requestId, renderRoot);
            }
        } catch (err) {
            if (!this.isNodeRenderCurrent(nodeId, nodeRequestId, requestId)) return;
            node.replaceChildren(this.buildMessage('エラーが発生しました', 'form-panel-error'));
            console.error('[FormPanel] renderNodeIntoAsync failed:', err);
            this.notification.show('フォームの表示に失敗しました');
        }
    }

    private isNodeRenderCurrent(nodeId: string, nodeRequestId: number, requestId: number): boolean {
        return requestId === this.currentRequestId
            && this.nodeRenderRequestIds.get(nodeId) === nodeRequestId;
    }

    private buildFields(nodeId: string, row: string[], header: string[], schema: SchemaJson, referenceLockedColumnNames: ReadonlySet<string>): HTMLElement {
        const fields = document.createElement('div');
        fields.classList.add('form-panel-fields');

        for (let i = 0; i < header.length; i++) {
            const columnName = header[i];
            const colSchema = schema.header.find(col => col.name === columnName);
            fields.appendChild(this.buildFieldElement(nodeId, columnName, row[i] ?? '', i, colSchema, referenceLockedColumnNames.has(columnName)));
        }

        return fields;
    }

    private buildFieldElement(nodeId: string, columnName: string, value: string, columnIndex: number, colSchema: SchemaColumn | undefined, readOnly: boolean): HTMLElement {
        const field = document.createElement('div');
        field.classList.add('form-panel-field');
        if (readOnly) {
            field.classList.add('form-panel-field--readonly');
            field.dataset.readonlyReason = 'reference-id';
        }
        field.dataset.nodeId = nodeId;
        field.dataset.columnName = columnName;
        field.dataset.columnIndex = String(columnIndex);

        const header = document.createElement('div');
        header.classList.add('form-panel-field-header');

        const labelGroup = document.createElement('div');
        labelGroup.classList.add('form-panel-field-label-group');

        const label = document.createElement('label');
        label.classList.add('form-panel-field-label');
        const inputId = `form-field-${this.currentRequestId}-${columnIndex}`;
        label.htmlFor = inputId;
        label.textContent = columnName;
        labelGroup.appendChild(label);

        const columnComment = this.getVisibleColumnComment(colSchema);
        if (columnComment !== null) {
            const comment = document.createElement('div');
            comment.classList.add('form-panel-field-comment');
            comment.textContent = columnComment;
            if (colSchema?.comment !== undefined) comment.title = colSchema.comment;
            labelGroup.appendChild(comment);
        }
        header.appendChild(labelGroup);

        const meta = document.createElement('div');
        meta.classList.add('form-panel-field-meta');
        if (colSchema?.type) {
            const type = document.createElement('span');
            type.classList.add('form-panel-field-type');
            type.textContent = colSchema.type;
            meta.appendChild(type);
        }
        if (colSchema?.reference) {
            const ref = document.createElement('span');
            ref.classList.add('form-panel-field-ref');
            ref.textContent = 'FK';
            meta.appendChild(ref);
        }
        header.appendChild(meta);

        const valueWrapper = document.createElement('div');
        valueWrapper.classList.add('form-panel-field-value');
        if (value === '') valueWrapper.classList.add('form-panel-field-value--empty');

        const input = this.createFieldInput(value, colSchema);
        input.id = inputId;
        input.dataset.columnName = columnName;
        input.dataset.columnIndex = String(columnIndex);
        if (readOnly) {
            input.readOnly = true;
            input.setAttribute('aria-readonly', 'true');
            input.title = '参照関係を固定するIDはフォームビューでは編集できません';
        }
        valueWrapper.appendChild(input);

        const mirror = document.createElement('span');
        mirror.classList.add('form-panel-field-value-text');
        mirror.textContent = value === '' ? '—' : value;
        valueWrapper.appendChild(mirror);

        const errorList = document.createElement('div');
        errorList.classList.add('form-panel-field-errors');

        const updateFieldDisplay = (nextValue: string) => {
            mirror.textContent = nextValue === '' ? '—' : nextValue;
            valueWrapper.classList.toggle('form-panel-field-value--empty', nextValue === '');
        };

        const updateValue = () => {
            const nextValue = input.value;
            updateFieldDisplay(nextValue);
            this.scheduleFieldCommit(nodeId, columnName, nextValue);
            if (colSchema?.reference) {
                if (this.isActiveReferenceInput(input) && this.referenceDropdown.isVisible()) {
                    this.referenceDropdown.onInputChanged(nextValue);
                } else {
                    this.showReferenceDropdownForInputAsync(nodeId, columnName, input, mirror, valueWrapper, true)
                        .catch(err => {
                            console.error('[FormPanel] reference dropdown input failed:', err);
                            this.notification.show('参照候補の表示に失敗しました');
                        });
                }
            }
        };
        if (!readOnly) {
            input.addEventListener('input', updateValue);
            input.addEventListener('change', () => {
                this.commitFieldValueAsync(nodeId, columnName, input.value).catch(err => {
                    console.error('[FormPanel] field change failed:', err);
                    this.notification.show('フォーム入力の反映に失敗しました');
                });
            });
            input.addEventListener('blur', () => {
                this.commitFieldValueAsync(nodeId, columnName, input.value).catch(err => {
                    console.error('[FormPanel] field blur commit failed:', err);
                    this.notification.show('フォーム入力の反映に失敗しました');
                });
                if (this.isActiveReferenceInput(input)) {
                    this.hideReferenceDropdown();
                }
            });
            input.addEventListener('keydown', (event) => {
                const keyboardEvent = event as KeyboardEvent;
                if (colSchema?.reference && this.handleReferenceDropdownKeydown(keyboardEvent, nodeId, columnName, input, mirror, valueWrapper)) {
                    return;
                }
                if (keyboardEvent.key !== 'Enter' || input instanceof HTMLTextAreaElement) return;
                keyboardEvent.preventDefault();
                input.blur();
            });
            if (colSchema?.reference) {
                input.addEventListener('focus', () => {
                    this.showReferenceDropdownForInputAsync(nodeId, columnName, input, mirror, valueWrapper, false)
                        .catch(err => {
                            console.error('[FormPanel] reference dropdown focus failed:', err);
                            this.notification.show('参照候補の表示に失敗しました');
                        });
                });
            }
        }

        field.appendChild(header);
        field.appendChild(valueWrapper);
        field.appendChild(errorList);
        return field;
    }

    private getVisibleColumnComment(colSchema: SchemaColumn | undefined): string | null {
        const comment = colSchema?.comment;
        if (comment === undefined || comment === '') return null;
        const firstLine = comment.split('\n')[0];
        return firstLine === '' ? null : firstLine;
    }

    private createFieldInput(value: string, colSchema: SchemaColumn | undefined): HTMLInputElement | HTMLTextAreaElement {
        const multiline = value.includes('\n') || value.length > 80;
        const input = multiline ? document.createElement('textarea') : document.createElement('input');
        input.classList.add('form-panel-field-input');
        input.value = value;
        if (input instanceof HTMLInputElement) {
            input.type = 'text';
            if (colSchema?.type === 'int' || colSchema?.type === 'long') input.inputMode = 'numeric';
            if (colSchema?.type === 'float' || colSchema?.type === 'double') input.inputMode = 'decimal';
        } else {
            input.rows = Math.min(8, Math.max(3, value.split('\n').length));
        }
        return input;
    }

    private buildReferencesContainer(): HTMLElement {
        const container = document.createElement('div');
        container.classList.add('form-panel-references');
        const title = document.createElement('div');
        title.classList.add('form-panel-references-title');
        title.textContent = 'REFERENCES';
        const body = document.createElement('div');
        body.classList.add('form-panel-references-body');
        body.textContent = '読み込み中...';
        container.appendChild(title);
        container.appendChild(body);
        return container;
    }

    private async commitFieldValueAsync(nodeId: string, columnName: string, value: string): Promise<void> {
        this.clearScheduledFieldCommit(nodeId, columnName);
        const data = this.nodeDataById.get(nodeId);
        if (data === undefined) return;
        if (data.referenceLockedColumnNames.has(columnName)) return;
        const columnIndex = data.header.indexOf(columnName);
        if (columnIndex === -1) return;

        const oldValue = data.row[columnIndex] ?? '';
        if (oldValue === value) {
            await this.refreshValidationAsync(this.currentRequestId);
            return;
        }
        const previousPkValue = data.pkColumnIndex !== -1 ? (data.row[data.pkColumnIndex] ?? '') : '';

        const editorTable = this.tab.getOpenEditorTables().get(data.tableName);
        const reflected = editorTable?.applyExternalCellEditByStoreIndex(data.rowIndex, columnIndex, value) ?? false;
        if (!reflected) {
            let updated = this.store.updateCellValueByRowIndex(data.tableName, data.rowIndex, columnIndex, value);
            if (!updated) {
                const wasRegistered = this.store.hasTable(data.tableName);
                await this.store.registerTableAsync(data.tableName);
                if (!wasRegistered) this.registeredForEditTableNames.add(data.tableName);
                const storeHeader = this.store.getHeader(data.tableName);
                const storeRows = this.store.getRows(data.tableName);
                if (storeHeader !== false && storeRows !== false) {
                    data.header = storeHeader;
                    data.rows = storeRows;
                    data.row = storeRows[data.rowIndex] ?? data.row;
                    updated = this.store.updateCellValueByRowIndex(data.tableName, data.rowIndex, columnIndex, value);
                }
            }
            if (!updated) {
                console.warn('[FormPanel] commitFieldValueAsync: EditorTable と store のどちらにも反映できませんでした', data.tableName, data.rowIndex, columnIndex);
            } else {
                this.store.markTableDirty(data.tableName);
                this.referenceDataCache.evictEntry(data.tableName);
            }
        }

        data.row[columnIndex] = value;
        this.editedTableNames.add(data.tableName);
        if (columnIndex === data.pkColumnIndex) {
            const meta = this.nodeMetaById.get(nodeId);
            if (meta !== undefined) meta.pkValue = value;
            if (nodeId === 'root') {
                const currentPage = this.navStack[0];
                if (currentPage !== undefined) {
                    currentPage.pkValue = value;
                    currentPage.label = `${data.tableName} / ${value}`;
                    currentPage.storeRowIndex = data.rowIndex;
                }
            }
        }

        const requestId = this.currentRequestId;
        await Promise.all([
            this.refreshValidationAsync(requestId),
            this.refreshCommittedReferenceViewsAsync(nodeId, data, previousPkValue, requestId),
        ]);
    }

    private scheduleFieldCommit(nodeId: string, columnName: string, value: string): void {
        const key = this.getCommitTimerKey(nodeId, columnName);
        const existing = this.commitTimers.get(key);
        if (existing !== undefined) window.clearTimeout(existing);
        this.pendingCommitValues.set(key, { nodeId, columnName, value });
        const timer = window.setTimeout(() => {
            this.commitTimers.delete(key);
            this.commitFieldValueAsync(nodeId, columnName, value).catch(err => {
                console.error('[FormPanel] field input commit failed:', err);
                this.notification.show('フォーム入力の反映に失敗しました');
            });
        }, 180);
        this.commitTimers.set(key, timer);
    }

    private async refreshValidationAsync(requestId: number, renderRoot: HTMLElement = this.panelElement): Promise<void> {
        if (this.validationPanel === false) {
            this.renderValidationErrors([], renderRoot);
            return;
        }

        const errors = await this.validationPanel.runAndUpdateAsync();
        if (requestId !== this.currentRequestId) return;
        this.renderValidationErrors(errors, renderRoot);
    }

    private async showReferenceDropdownForInputAsync(
        nodeId: string,
        columnName: string,
        input: HTMLInputElement | HTMLTextAreaElement,
        mirror: HTMLElement,
        valueWrapper: HTMLElement,
        filterByInput: boolean,
    ): Promise<void> {
        const data = this.nodeDataById.get(nodeId);
        if (data === undefined) return;
        const colSchema = data.schema.header.find(col => col.name === columnName);
        if (!colSchema?.reference) return;

        const requestId = this.currentRequestId;
        const dropdownRequestId = ++this.referenceDropdownRequestId;
        this.activeReferenceField = { nodeId, columnName, input, mirror, valueWrapper };

        const dropdownData = await this.resolveFieldReferenceDropdownDataAsync(data, colSchema, requestId);
        if (requestId !== this.currentRequestId || dropdownRequestId !== this.referenceDropdownRequestId) return;
        if (!this.isActiveReferenceInput(input)) return;
        if (dropdownData === null || dropdownData.items.length === 0) {
            this.referenceDropdown.hide();
            return;
        }

        const rect = input.getBoundingClientRect();
        this.referenceDropdown.show(rect, dropdownData.items, input.value, dropdownData.tableName);
        if (filterByInput) this.referenceDropdown.onInputChanged(input.value);
    }

    private handleReferenceDropdownKeydown(
        event: KeyboardEvent,
        nodeId: string,
        columnName: string,
        input: HTMLInputElement | HTMLTextAreaElement,
        mirror: HTMLElement,
        valueWrapper: HTMLElement,
    ): boolean {
        if (!this.isActiveReferenceInput(input) || !this.referenceDropdown.isVisible()) {
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                this.showReferenceDropdownForInputAsync(nodeId, columnName, input, mirror, valueWrapper, false)
                    .catch(err => {
                        console.error('[FormPanel] reference dropdown keydown failed:', err);
                        this.notification.show('参照候補の表示に失敗しました');
                    });
                return true;
            }
            return false;
        }

        if (event.isComposing) return false;

        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                this.referenceDropdown.moveSelection(1);
                return true;
            case 'ArrowUp':
                event.preventDefault();
                this.referenceDropdown.moveSelection(-1);
                return true;
            case 'Enter':
                event.preventDefault();
                this.referenceDropdown.confirmSelection();
                return true;
            case 'Escape':
                event.preventDefault();
                this.referenceDropdown.cancel();
                return true;
            case 'Tab':
                this.referenceDropdown.confirmSelection();
                return false;
            default:
                return false;
        }
    }

    private applyReferenceDropdownSelection(id: string): void {
        const active = this.activeReferenceField;
        if (active === null) return;
        active.input.value = id;
        active.mirror.textContent = id === '' ? '—' : id;
        active.valueWrapper.classList.toggle('form-panel-field-value--empty', id === '');
        this.activeReferenceField = null;
        this.commitFieldValueAsync(active.nodeId, active.columnName, id).catch(err => {
            console.error('[FormPanel] reference dropdown selection failed:', err);
            this.notification.show('参照候補の反映に失敗しました');
        });
    }

    private hideReferenceDropdown(): void {
        ++this.referenceDropdownRequestId;
        this.referenceDropdown.hide();
        this.activeReferenceField = null;
    }

    private isActiveReferenceInput(input: HTMLInputElement | HTMLTextAreaElement): boolean {
        return this.activeReferenceField?.input === input;
    }

    private async resolveFieldReferenceDropdownDataAsync(
        data: CurrentPageData,
        colSchema: SchemaColumn,
        requestId: number,
    ): Promise<ReferenceFieldDropdownData | null> {
        if (!colSchema.reference) return null;
        const expr = parseReferenceExpression(colSchema.reference);
        if (isSimpleReference(expr)) {
            const [targetData, targetSchema] = await Promise.all([
                this.resolveTableDataAsync(expr.tableName),
                this.loadSchemaJsonAsync(expr.tableName),
            ]);
            if (requestId !== this.currentRequestId) return null;
            return {
                tableName: expr.tableName,
                items: await this.buildReferenceFieldDropdownItemsAsync(expr.tableName, expr.columnName, targetData.header, targetData.rows, targetSchema),
            };
        }
        if (isDynamicReference(expr)) {
            const resolved = await this.resolveDynamicReferenceTargetAsync(expr, data, requestId);
            if (resolved === null || requestId !== this.currentRequestId) return null;
            return {
                tableName: resolved.tableName,
                items: await this.buildReferenceFieldDropdownItemsAsync(resolved.tableName, resolved.columnName, resolved.header, resolved.rows, resolved.schema),
            };
        }
        return null;
    }

    private async resolveDynamicReferenceTargetAsync(
        expr: DynamicReference,
        data: CurrentPageData,
        requestId: number,
    ): Promise<{ tableName: string; columnName: string; header: string[]; rows: string[][]; schema: SchemaJson } | null> {
        const valueColIdx = data.header.indexOf(expr.filter.valueColumn);
        if (valueColIdx === -1) return null;
        const valueColumnValue = data.row[valueColIdx];
        if (valueColumnValue === '') return null;

        const filterTableData = await this.resolveTableDataAsync(expr.filter.tableName);
        if (requestId !== this.currentRequestId) return null;
        const filterColIdx = filterTableData.header.indexOf(expr.filter.filterColumn);
        const lookupColIdx = filterTableData.header.indexOf(expr.lookupColumn);
        const targetColumnColIdx = filterTableData.header.indexOf(expr.targetColumn);
        if (filterColIdx === -1 || lookupColIdx === -1 || targetColumnColIdx === -1) return null;

        const filterRow = filterTableData.rows.find(row => row[filterColIdx] === valueColumnValue);
        if (filterRow === undefined) return null;

        const targetTableName = filterRow[lookupColIdx];
        const targetColumnName = filterRow[targetColumnColIdx];
        if (targetTableName === '' || targetColumnName === '') return null;

        const [targetData, targetSchema] = await Promise.all([
            this.resolveTableDataAsync(targetTableName),
            this.loadSchemaJsonAsync(targetTableName),
        ]);
        if (requestId !== this.currentRequestId) return null;
        return {
            tableName: targetTableName,
            columnName: targetColumnName,
            header: targetData.header,
            rows: targetData.rows,
            schema: targetSchema,
        };
    }

    private async refreshCommittedReferenceViewsAsync(
        nodeId: string,
        data: CurrentPageData,
        previousPkValue: string,
        requestId: number,
    ): Promise<void> {
        this.referenceDataCache.evictAll();
        await this.refreshOpenEditorTableReferenceHintsAsync(requestId);
        if (requestId !== this.currentRequestId) return;

        await this.renderReferencesAsync(nodeId, requestId);
        if (requestId !== this.currentRequestId) return;

        const changedItem = await this.createReferenceItemAsync(data.tableName, data.header, data.row, data.schema, false, requestId, data.rowIndex);
        if (requestId !== this.currentRequestId) return;
        await this.refreshVisibleReferenceItemsAsync(requestId, changedItem, previousPkValue);
    }

    private async refreshOpenEditorTableReferenceHintsAsync(requestId: number): Promise<void> {
        const openTables = Array.from(this.tab.getOpenEditorTables().entries());
        await Promise.all(openTables.map(([, editorTable]) => this.preloadEditorTableReferenceDataAsync(editorTable.getTableData(), requestId)));
        if (requestId !== this.currentRequestId) return;

        await Promise.all(openTables.map(async ([tableName, editorTable]) => {
            const reverseMap = await this.reverseReferenceEngine.resolveAsync(tableName);
            if (requestId !== this.currentRequestId) return;
            editorTable.updateReverseReferenceHints(reverseMap);
            editorTable.updateReferenceHints();
        }));
    }

    private async preloadEditorTableReferenceDataAsync(tableData: EditorTableData, requestId: number): Promise<void> {
        const simpleReferenceTableNames = new Set<string>();
        const dynamicLookups: Array<{ filterTableName: string; lookupColumn: string }> = [];

        for (const column of tableData.header) {
            if (!column.reference) continue;
            const expr = parseReferenceExpression(column.reference);
            if (isDynamicReference(expr)) {
                dynamicLookups.push({ filterTableName: expr.filter.tableName, lookupColumn: expr.lookupColumn });
            } else {
                simpleReferenceTableNames.add(expr.tableName);
            }
        }

        await Promise.all(Array.from(simpleReferenceTableNames).map(tableName =>
            this.referenceDataCache.get(tableName).catch(() => {})
        ));
        if (requestId !== this.currentRequestId) return;

        const intermediateTableNames = Array.from(new Set(dynamicLookups.map(lookup => lookup.filterTableName)));
        await Promise.all(intermediateTableNames.map(async tableName => {
            const fullData = await this.referenceDataCache.getFullDataAsync(tableName).catch(() => null);
            if (fullData === null || requestId !== this.currentRequestId) return;

            const targetTableNames = new Set<string>();
            for (const lookup of dynamicLookups) {
                if (lookup.filterTableName !== tableName) continue;
                const lookupColumnIndex = fullData.header.indexOf(lookup.lookupColumn);
                if (lookupColumnIndex === -1) continue;
                fullData.rows.forEach(row => {
                    const targetTableName = row[lookupColumnIndex];
                    if (targetTableName !== '') targetTableNames.add(targetTableName);
                });
            }
            await Promise.all(Array.from(targetTableNames).flatMap(targetTableName => [
                this.referenceDataCache.get(targetTableName).catch(() => {}),
                this.referenceDataCache.getFullDataAsync(targetTableName).catch(() => {}),
            ]));
        }));
    }

    private async refreshVisibleReferenceItemsAsync(
        requestId: number,
        changedItem: ReferenceItem,
        previousPkValue: string,
    ): Promise<void> {
        this.applyChangedReferenceItemToVisibleElements(changedItem, previousPkValue);

        const itemElements = Array.from(this.panelElement.querySelectorAll('.form-panel-ref-item[data-ref-table-name][data-ref-pk-value]')) as HTMLElement[];
        const itemKeys = new Map<string, { tableName: string; pkValue: string; storeRowIndex: number | null; elements: HTMLElement[] }>();
        for (const element of itemElements) {
            const tableName = element.dataset.refTableName;
            const pkValue = element.dataset.refPkValue;
            if (tableName === undefined || pkValue === undefined || pkValue === '') continue;
            const storeRowIndex = this.parseOptionalStoreRowIndex(element.dataset.refStoreRowIndex);
            const key = `${tableName}\n${pkValue}\n${storeRowIndex ?? ''}`;
            const existing = itemKeys.get(key);
            if (existing !== undefined) {
                existing.elements.push(element);
            } else {
                itemKeys.set(key, { tableName, pkValue, storeRowIndex, elements: [element] });
            }
        }

        await Promise.all(Array.from(itemKeys.values()).map(async entry => {
            const item = await this.resolveReferenceItemByIdentityAsync(entry.tableName, entry.pkValue, entry.storeRowIndex, requestId);
            if (item === null || requestId !== this.currentRequestId) return;
            for (const element of entry.elements) {
                if (!element.isConnected) continue;
                this.applyReferenceItemContent(element, item);
            }
        }));
    }

    private applyChangedReferenceItemToVisibleElements(item: ReferenceItem, previousPkValue: string): void {
        const elements = Array.from(this.panelElement.querySelectorAll('.form-panel-ref-item[data-ref-table-name][data-ref-pk-value]')) as HTMLElement[];
        for (const element of elements) {
            if (element.dataset.refTableName !== item.tableName) continue;
            const elementStoreRowIndex = this.parseOptionalStoreRowIndex(element.dataset.refStoreRowIndex);
            if (item.storeRowIndex !== null && elementStoreRowIndex !== item.storeRowIndex) continue;
            const elementPkValue = element.dataset.refPkValue;
            if (elementPkValue !== previousPkValue && elementPkValue !== item.pkValue) continue;
            element.dataset.refPkValue = item.pkValue;
            if (item.storeRowIndex !== null) element.dataset.refStoreRowIndex = String(item.storeRowIndex);
            this.applyReferenceItemContent(element, item);
        }
    }

    private async resolveReferenceItemByIdentityAsync(tableName: string, pkValue: string, storeRowIndex: number | null, requestId: number): Promise<ReferenceItem | null> {
        const [tableData, schema] = await Promise.all([
            this.resolveTableDataAsync(tableName),
            this.loadSchemaJsonAsync(tableName),
        ]);
        if (requestId !== this.currentRequestId) return null;

        const pkColumnName = extractFirstPrimaryKeyColumn(schema);
        const pkColumnIndex = tableData.header.indexOf(pkColumnName);
        if (pkColumnIndex === -1) return null;
        const rowIndex = this.resolveTargetRowIndex(tableData.rows, pkColumnIndex, pkValue, storeRowIndex);
        if (rowIndex === -1) return null;
        return this.createReferenceItemAsync(tableName, tableData.header, tableData.rows[rowIndex], schema, false, requestId, rowIndex);
    }

    private async resolveReferenceLockedColumnNamesAsync(
        tableName: string,
        header: string[],
        row: string[],
        schema: SchemaJson,
        requestId: number,
    ): Promise<Set<string>> {
        const lockedColumnNames = new Set<string>();
        const primaryKeyColumnNames = this.getPrimaryKeyColumnNames(schema);
        if (primaryKeyColumnNames.length === 1) {
            const primaryKeyColumn = schema.header.find(column => column.name === primaryKeyColumnNames[0]);
            if (primaryKeyColumn?.reference) lockedColumnNames.add(primaryKeyColumn.name);
        }

        const reverseMap = await this.reverseReferenceEngine.resolveAsync(tableName);
        if (requestId !== this.currentRequestId) return lockedColumnNames;

        for (const [parentColumnValue, entries] of reverseMap) {
            for (const entry of entries) {
                const columnIndex = header.indexOf(entry.parentColumnName);
                if (columnIndex === -1) continue;
                if ((row[columnIndex] ?? '') === parentColumnValue) lockedColumnNames.add(entry.parentColumnName);
            }
        }
        return lockedColumnNames;
    }

    private async buildReferenceFieldDropdownItemsAsync(tableName: string, referenceColumnName: string, header: string[], rows: string[][], schema: SchemaJson): Promise<GridDropdownItem[]> {
        const valueColIdx = header.indexOf(referenceColumnName);
        if (valueColIdx === -1) return [];
        const pkColumnName = extractFirstPrimaryKeyColumn(schema);
        const pkColIdx = header.indexOf(pkColumnName);
        if (referenceColumnName === pkColumnName) {
            const referenceData = await this.referenceDataCache.get(tableName);
            return referenceData.items.map(item => ({
                id: item.id,
                displayText: item.displayText,
                previewId: item.id,
            }));
        }
        const displayColIdx = this.resolveReferenceDisplayColumnIndex(header, pkColumnName);
        const result: GridDropdownItem[] = [];
        const seenValues = new Set<string>();
        for (const row of rows) {
            const value = row[valueColIdx] ?? '';
            if (value === '' || seenValues.has(value)) continue;
            seenValues.add(value);
            const displayValue = displayColIdx !== -1 ? (row[displayColIdx] ?? '') : '';
            const displayText = displayValue !== '' ? displayValue : value;
            const previewId = pkColIdx !== -1 ? (row[pkColIdx] ?? '') : value;
            result.push({
                id: value,
                displayText,
                previewId,
            });
        }
        return result;
    }

    private renderValidationErrors(errors: ValidationError[], renderRoot: HTMLElement = this.panelElement): void {
        for (const field of Array.from(renderRoot.querySelectorAll('.form-panel-field'))) {
            field.classList.remove('form-panel-field--invalid');
            const fieldErrors = field.querySelector('.form-panel-field-errors');
            if (fieldErrors !== null) fieldErrors.replaceChildren();
        }

        for (const data of this.nodeDataById.values()) {
            const nodeElement = this.nodeElementsById.get(data.nodeId);
            if (nodeElement === undefined || !renderRoot.contains(nodeElement)) continue;
            const rowErrors = errors.filter(error => error.tableName === data.tableName && error.rowIndex === data.rowIndex);

            for (const error of rowErrors) {
                if (error.columnIndex < 0) continue;
                for (const field of Array.from(nodeElement.querySelectorAll('.form-panel-field')) as HTMLElement[]) {
                    if (field.dataset.nodeId !== data.nodeId || field.dataset.columnIndex !== String(error.columnIndex)) continue;
                    const fieldErrors = field.querySelector('.form-panel-field-errors') as HTMLElement | null;
                    if (fieldErrors === null) continue;
                    field.classList.add('form-panel-field--invalid');
                    const fieldError = document.createElement('div');
                    fieldError.classList.add('form-panel-field-error');
                    fieldError.textContent = error.message;
                    fieldErrors.appendChild(fieldError);
                }
            }
        }
    }

    private async renderReferencesAsync(nodeId: string, requestId: number, renderRoot: HTMLElement = this.panelElement): Promise<void> {
        const data = this.nodeDataById.get(nodeId);
        if (data === undefined) return;
        const nodeElement = this.nodeElementsById.get(nodeId);
        if (nodeElement === undefined) return;
        const referencesContainer = nodeElement.querySelector('.form-panel-references') as HTMLElement | null;
        const body = nodeElement.querySelector('.form-panel-references-body') as HTMLElement | null;
        if (body === null) return;
        referencesContainer?.classList.remove('form-panel-references--empty');
        body.textContent = '読み込み中...';

        try {
            const [outgoing, incoming] = await Promise.all([
                this.resolveOutgoingReferenceSectionsAsync(data, requestId),
                this.resolveIncomingReferenceSectionsAsync(data, requestId),
            ]);
            if (requestId !== this.currentRequestId) return;

            this.removeNodeDescendants(nodeId);
            body.replaceChildren();
            const sections = [...outgoing, ...incoming];
            const referenceSections = sections.filter(section =>
                this.hasVisibleReferenceItems(section, nodeId)
            );

            if (referenceSections.length === 0) {
                body.appendChild(this.buildMessage('参照なし', 'form-panel-section-empty'));
                return;
            }
            for (const section of referenceSections) {
                const sectionElement = this.buildReferenceSection(section, nodeId);
                body.appendChild(sectionElement);
                if (section.attached) {
                    const attachedHost = sectionElement.querySelector('.form-panel-attached-host') as HTMLElement | null;
                    if (attachedHost !== null) {
                        await this.renderAttachedReferenceSectionAsync(attachedHost, section, nodeId, requestId, renderRoot);
                        if (requestId !== this.currentRequestId) return;
                    }
                }
            }
        } catch (err) {
            if (requestId !== this.currentRequestId) return;
            referencesContainer?.classList.remove('form-panel-references--empty');
            body.replaceChildren(this.buildMessage('参照一覧の取得に失敗しました', 'form-panel-section-empty'));
            console.error('[FormPanel] renderReferencesAsync failed:', err);
        }
    }

    private async resolveOutgoingReferenceSectionsAsync(data: CurrentPageData, requestId: number): Promise<ReferenceSection[]> {
        const sections: ReferenceSection[] = [];
        for (const column of data.schema.header) {
            if (!column.reference) continue;
            const colIdx = data.header.indexOf(column.name);
            if (colIdx === -1) continue;
            const fkValue = data.row[colIdx] ?? '';
            if (fkValue === '') continue;

            const expr = parseReferenceExpression(column.reference);
            if (isSimpleReference(expr)) {
                const targetData = await this.resolveTableDataAsync(expr.tableName);
                if (requestId !== this.currentRequestId) return sections;
                const targetSchema = await this.loadSchemaJsonAsync(expr.tableName);
                if (requestId !== this.currentRequestId) return sections;
                const matchedRows = this.filterRowsByColumnWithIndex(targetData.rows, targetData.header, expr.columnName, fkValue);
                sections.push(await this.buildOutgoingSectionAsync(
                    column.name,
                    fkValue,
                    expr.tableName,
                    targetData.header,
                    matchedRows,
                    targetSchema,
                    requestId,
                ));
            } else if (isDynamicReference(expr)) {
                const section = await this.resolveDynamicOutgoingReferenceSectionAsync(expr, column.name, fkValue, data, requestId);
                if (requestId !== this.currentRequestId) return sections;
                if (section !== null) sections.push(section);
            }
        }
        return sections;
    }

    private async resolveDynamicOutgoingReferenceSectionAsync(
        expr: DynamicReference,
        columnName: string,
        fkValue: string,
        data: CurrentPageData,
        requestId: number,
    ): Promise<ReferenceSection | null> {
        const valueColIdx = data.header.indexOf(expr.filter.valueColumn);
        if (valueColIdx === -1) return null;
        const valueColumnValue = data.row[valueColIdx];
        if (valueColumnValue === '') return null;

        const filterTableData = await this.resolveTableDataAsync(expr.filter.tableName);
        if (requestId !== this.currentRequestId) return null;
        const filterColIdx = filterTableData.header.indexOf(expr.filter.filterColumn);
        const lookupColIdx = filterTableData.header.indexOf(expr.lookupColumn);
        const targetColumnColIdx = filterTableData.header.indexOf(expr.targetColumn);
        if (filterColIdx === -1 || lookupColIdx === -1 || targetColumnColIdx === -1) return null;

        const filterRow = filterTableData.rows.find(row => row[filterColIdx] === valueColumnValue);
        if (filterRow === undefined) return null;

        const targetTableName = filterRow[lookupColIdx];
        const targetColumnName = filterRow[targetColumnColIdx];
        if (targetTableName === '' || targetColumnName === '') return null;

        const [targetData, targetSchema] = await Promise.all([
            this.resolveTableDataAsync(targetTableName),
            this.loadSchemaJsonAsync(targetTableName),
        ]);
        if (requestId !== this.currentRequestId) return null;

        const matchedRows = this.filterRowsByColumnWithIndex(targetData.rows, targetData.header, targetColumnName, fkValue);
        return this.buildOutgoingSectionAsync(columnName, fkValue, targetTableName, targetData.header, matchedRows, targetSchema, requestId);
    }

    private async buildOutgoingSectionAsync(
        sourceColumnName: string,
        fkValue: string,
        targetTableName: string,
        targetHeader: string[],
        matchedRows: IndexedRow[],
        targetSchema: SchemaJson,
        requestId: number,
    ): Promise<ReferenceSection> {
        return {
            relationKind: 'outgoing',
            eyebrow: `参照先: ${sourceColumnName}`,
            heading: targetTableName,
            title: `参照先: ${sourceColumnName} → ${targetTableName}`,
            badge: `${matchedRows.length}`,
            emptyText: `値 "${fkValue}" に一致する参照先がありません`,
            items: await Promise.all(matchedRows.map(({row, storeRowIndex}) => this.createReferenceItemAsync(targetTableName, targetHeader, row, targetSchema, false, requestId, storeRowIndex))),
            attached: false,
        };
    }

    private async resolveIncomingReferenceSectionsAsync(data: CurrentPageData, requestId: number): Promise<ReferenceSection[]> {
        const sections: ReferenceSection[] = [];
        const reverseMap = await this.reverseReferenceEngine.resolveAsync(data.tableName);
        if (requestId !== this.currentRequestId) return sections;

        const pkValue = data.pkColumnIndex !== -1 ? (data.row[data.pkColumnIndex] ?? '') : '';
        if (pkValue === '') return sections;
        const entries = reverseMap.get(pkValue) ?? [];
        const sortedEntries = [...entries].sort((a, b) => a.priority - b.priority);

        for (const entry of sortedEntries) {
            const [childData, childSchema] = await Promise.all([
                this.resolveTableDataAsync(entry.childTableName),
                this.loadSchemaJsonAsync(entry.childTableName),
            ]);
            if (requestId !== this.currentRequestId) return sections;

            const fkColIdx = childData.header.indexOf(entry.childColumnName);
            const filteredRows = fkColIdx === -1 ? [] : this.filterRowsByColumnWithIndex(childData.rows, childData.header, entry.childColumnName, pkValue);
            const items = await Promise.all(filteredRows.map(({row, storeRowIndex}) => this.createReferenceItemAsync(entry.childTableName, childData.header, row, childSchema, false, requestId, storeRowIndex)));
            sections.push({
                relationKind: 'incoming',
                eyebrow: `参照元: ${entry.childTableName}`,
                heading: entry.childTableName,
                title: `参照元: ${entry.childTableName}`,
                badge: `${filteredRows.length}`,
                emptyText: '参照元の行はありません',
                items,
                attached: this.isAttachableOneToOneReference(data, entry, childSchema, filteredRows, items),
            });
        }

        return sections;
    }

    private isAttachableOneToOneReference(
        data: CurrentPageData,
        entry: ReverseReferenceEntry,
        childSchema: SchemaJson,
        filteredRows: IndexedRow[],
        items: ReferenceItem[],
    ): boolean {
        if (entry.isDynamic) return false;
        if (entry.parentColumnName !== data.pkColumnName) return false;
        if (entry.childColumnName !== entry.childPkColumnName) return false;
        if (filteredRows.length !== 1 || items.length !== 1) return false;
        const childPrimaryKeys = this.getPrimaryKeyColumnNames(childSchema);
        if (childPrimaryKeys.length !== 1 || childPrimaryKeys[0] !== entry.childColumnName) return false;
        return !this.isReferenceInAncestorPath(data.nodeId, items[0].tableName, items[0].pkValue, items[0].storeRowIndex);
    }

    private buildAttachedReferenceHost(): HTMLElement {
        const host = document.createElement('div');
        host.classList.add('form-panel-attached-host');
        return host;
    }

    private async renderAttachedReferenceSectionAsync(
        host: HTMLElement,
        section: ReferenceSection,
        parentNodeId: string,
        requestId: number,
        renderRoot: HTMLElement = this.panelElement,
    ): Promise<void> {
        const item = section.items[0];
        if (item === undefined || !item.canOpen) return;
        if (this.isReferenceInAncestorPath(parentNodeId, item.tableName, item.pkValue, item.storeRowIndex)) return;

        const childNodeId = this.makeChildNodeId(parentNodeId, item.tableName, item.pkValue, item.storeRowIndex);
        const parentMeta = this.nodeMetaById.get(parentNodeId);
        const childDepth = parentMeta === undefined ? 1 : parentMeta.depth + 1;
        await this.renderNodeIntoAsync(host, childNodeId, item.tableName, item.pkValue, item.storeRowIndex, childDepth, parentNodeId, requestId, false, renderRoot);
    }

    private hasVisibleReferenceItems(section: ReferenceSection, parentNodeId: string): boolean {
        return section.items.length === 0 || this.getVisibleReferenceItems(section, parentNodeId).length > 0;
    }

    private getVisibleReferenceItems(section: ReferenceSection, parentNodeId: string): ReferenceItem[] {
        return section.items.filter(item => !this.isReferenceInAncestorPath(parentNodeId, item.tableName, item.pkValue, item.storeRowIndex));
    }

    private buildReferenceSection(section: ReferenceSection, parentNodeId: string): HTMLElement {
        const container = document.createElement('div');
        container.classList.add('form-panel-section');
        container.classList.add(`form-panel-section--${section.relationKind}`);

        const header = document.createElement('div');
        header.classList.add('form-panel-section-header');

        const titleWrap = document.createElement('div');
        titleWrap.classList.add('form-panel-section-title-wrap');
        const eyebrow = document.createElement('div');
        eyebrow.classList.add('form-panel-section-eyebrow');
        eyebrow.textContent = section.eyebrow;
        const title = document.createElement('div');
        title.classList.add('form-panel-section-title');
        title.textContent = section.heading;
        titleWrap.appendChild(eyebrow);
        titleWrap.appendChild(title);

        const badge = document.createElement('span');
        badge.classList.add('form-panel-section-badge');
        badge.textContent = section.badge;

        header.appendChild(titleWrap);
        header.appendChild(badge);
        container.appendChild(header);

        const list = document.createElement('div');
        list.classList.add('form-panel-reference-list');
        if (section.items.length === 0) {
            list.appendChild(this.buildMessage(section.emptyText, 'form-panel-section-empty'));
        } else if (section.attached) {
            list.appendChild(this.buildAttachedReferenceHost());
        } else {
            for (const item of this.getVisibleReferenceItems(section, parentNodeId)) {
                list.appendChild(this.buildReferenceItemElement(item, parentNodeId));
            }
        }
        container.appendChild(list);
        return container;
    }

    private buildReferenceItemElement(item: ReferenceItem, parentNodeId: string): HTMLElement {
        const wrapper = document.createElement('div');
        wrapper.classList.add('form-panel-ref-node');
        if (item.canOpen) wrapper.classList.add('form-panel-ref-node--jumpable');

        const alreadyInPath = this.isReferenceInAncestorPath(parentNodeId, item.tableName, item.pkValue, item.storeRowIndex);
        const canExpand = item.canOpen && !alreadyInPath;
        const element = document.createElement(canExpand ? 'button' : 'div');
        element.classList.add('form-panel-ref-item');
        if (canExpand) {
            (element as HTMLButtonElement).type = 'button';
            element.classList.add('form-panel-ref-item--clickable');
            element.setAttribute('aria-expanded', 'false');
            element.addEventListener('click', () => {
                const currentItem = {
                    ...item,
                    tableName: element.dataset.refTableName ?? item.tableName,
                    pkValue: element.dataset.refPkValue ?? item.pkValue,
                    storeRowIndex: this.parseOptionalStoreRowIndex(element.dataset.refStoreRowIndex) ?? item.storeRowIndex,
                };
                this.toggleReferenceExpansionAsync(wrapper, element as HTMLButtonElement, parentNodeId, currentItem).catch(err => {
                    console.error('[FormPanel] toggleReferenceExpansionAsync failed:', err);
                    this.notification.show('参照先の展開に失敗しました');
                });
            });
        } else if (alreadyInPath) {
            element.classList.add('form-panel-ref-item--cycle');
        }
        if (item.missing) element.classList.add('form-panel-ref-item--missing');
        element.dataset.refTableName = item.tableName;
        element.dataset.refPkValue = item.pkValue;
        if (item.storeRowIndex !== null) element.dataset.refStoreRowIndex = String(item.storeRowIndex);
        this.applyReferenceItemContent(element, item);

        wrapper.appendChild(element);
        if (item.canOpen) wrapper.appendChild(this.buildReferenceJumpButton(element, item));
        return wrapper;
    }

    private buildReferenceJumpButton(trigger: HTMLElement, item: ReferenceItem): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.classList.add('form-panel-ref-jump-button');
        button.title = 'EditorTableで開く';
        button.setAttribute('aria-label', 'EditorTableで開く');
        button.innerHTML = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4H3.5A1.5 1.5 0 0 0 2 5.5v7A1.5 1.5 0 0 0 3.5 14h7a1.5 1.5 0 0 0 1.5-1.5V10"/><path d="M9 2h5v5"/><path d="M8 8l6-6"/></svg>';
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.jumpToReferenceItemAsync(trigger, item).catch(err => {
                console.error('[FormPanel] jumpToReferenceItemAsync failed:', err);
                this.notification.show('EditorTableへのジャンプに失敗しました');
            });
        });
        return button;
    }

    private async jumpToReferenceItemAsync(trigger: HTMLElement, item: ReferenceItem): Promise<void> {
        const tableName = trigger.dataset.refTableName ?? item.tableName;
        const pkValue = trigger.dataset.refPkValue ?? item.pkValue;
        const storeRowIndex = this.parseOptionalStoreRowIndex(trigger.dataset.refStoreRowIndex) ?? item.storeRowIndex;
        if (tableName === '' || pkValue === '') return;
        this.hideReferenceDropdown();
        await this.flushPendingCommitsAsync();
        if (storeRowIndex !== null) {
            this.tab.navigateToTableStoreCell(tableName, storeRowIndex, item.pkColumnIndex);
            return;
        }
        if (item.pkColumnIndex !== -1) {
            this.tab.navigateToTableCell(tableName, pkValue, item.pkColumnIndex);
        } else {
            this.tab.navigateToTableRow(tableName, pkValue);
        }
    }

    private applyReferenceItemContent(element: HTMLElement, item: ReferenceItem): void {
        element.replaceChildren();
        const main = document.createElement('div');
        main.classList.add('form-panel-ref-item-main');
        main.textContent = item.primaryText;

        element.appendChild(main);
        if (item.metaParts.length > 0) {
            const meta = document.createElement('div');
            meta.classList.add('form-panel-ref-item-meta');
            for (const part of item.metaParts) {
                const chip = document.createElement('span');
                chip.classList.add('form-panel-ref-item-meta-chip');
                chip.textContent = part;
                meta.appendChild(chip);
            }
            element.appendChild(meta);
        }
    }

    private async toggleReferenceExpansionAsync(wrapper: HTMLElement, trigger: HTMLButtonElement, parentNodeId: string, item: ReferenceItem): Promise<void> {
        const childNodeId = this.makeChildNodeId(parentNodeId, item.tableName, item.pkValue, item.storeRowIndex);
        const existingHost = Array.from(wrapper.children).find(child => child.classList.contains('form-panel-child-host')) as HTMLElement | undefined;
        if (existingHost !== undefined) {
            this.removeNodeBranch(childNodeId);
            existingHost.remove();
            wrapper.classList.remove('form-panel-ref-node--expanded');
            trigger.classList.remove('form-panel-ref-item--expanded');
            trigger.setAttribute('aria-expanded', 'false');
            return;
        }

        const childHost = document.createElement('div');
        childHost.classList.add('form-panel-child-host');
        wrapper.appendChild(childHost);
        wrapper.classList.add('form-panel-ref-node--expanded');
        trigger.classList.add('form-panel-ref-item--expanded');
        trigger.setAttribute('aria-expanded', 'true');

        const parentMeta = this.nodeMetaById.get(parentNodeId);
        const childDepth = parentMeta === undefined ? 1 : parentMeta.depth + 1;
        await this.renderNodeIntoAsync(childHost, childNodeId, item.tableName, item.pkValue, item.storeRowIndex, childDepth, parentNodeId, this.currentRequestId);
    }

    private makeChildNodeId(parentNodeId: string, tableName: string, pkValue: string, storeRowIndex: number | null): string {
        const rowPart = storeRowIndex === null ? '' : `#${storeRowIndex}`;
        return `${parentNodeId}>${encodeURIComponent(tableName)}=${encodeURIComponent(pkValue)}${rowPart}`;
    }

    private isReferenceInAncestorPath(parentNodeId: string, tableName: string, pkValue: string, storeRowIndex: number | null): boolean {
        let currentNodeId: string | null = parentNodeId;
        while (currentNodeId !== null) {
            const meta = this.nodeMetaById.get(currentNodeId);
            if (meta === undefined) return false;
            if (this.isSameRowIdentity(meta, tableName, pkValue, storeRowIndex)) return true;
            currentNodeId = meta.parentNodeId;
        }
        return false;
    }

    private isSameRowIdentity(meta: FormNodeMeta, tableName: string, pkValue: string, storeRowIndex: number | null): boolean {
        if (meta.tableName !== tableName) return false;
        if (meta.storeRowIndex !== null && storeRowIndex !== null) return meta.storeRowIndex === storeRowIndex;
        return meta.pkValue === pkValue;
    }

    private async createReferenceItemAsync(
        tableName: string,
        header: string[],
        row: string[],
        schema: SchemaJson,
        missing: boolean,
        requestId: number,
        storeRowIndex: number | null = null,
    ): Promise<ReferenceItem> {
        const pkColumnName = extractFirstPrimaryKeyColumn(schema);
        const pkColIdx = header.indexOf(pkColumnName);
        const pkValue = pkColIdx !== -1 ? (row[pkColIdx] ?? '') : '';
        const display = await this.resolveRowDisplayCandidateAsync(tableName, header, row, schema, pkColumnName, pkValue, requestId);
        const summaries = missing ? [] : await this.resolveRowReferenceSummariesAsync(header, row, schema, requestId);
        const primarySummary = summaries.find(summary => summary.kind === 'dynamic') ?? summaries[0];
        const useReferenceSummary = primarySummary !== undefined && !this.isStrongDisplayCandidate(display);
        const primaryText = useReferenceSummary
            ? primarySummary.primaryText
            : display.text;
        const metaParts = this.collectScalarMetaParts(header, row, schema, display, summaries);
        return {
            tableName,
            pkValue,
            storeRowIndex,
            pkColumnIndex: pkColIdx,
            primaryText: primaryText !== '' ? primaryText : '(PK値なし)',
            metaParts,
            canOpen: pkValue !== '' && !missing,
            missing,
        };
    }

    private async resolveRowDisplayCandidateAsync(
        tableName: string,
        header: string[],
        row: string[],
        schema: SchemaJson,
        pkColumnName: string,
        pkValue: string,
        requestId: number,
    ): Promise<DisplayCandidate> {
        const displayColumnName = determineDisplayColumnName(header);
        if (displayColumnName !== '') {
            const displayColIdx = header.indexOf(displayColumnName);
            const displayValue = displayColIdx !== -1 ? (row[displayColIdx] ?? '') : '';
            if (displayValue !== '') {
                return { text: displayValue, source: 'display-column', columnName: displayColumnName };
            }
        }

        const cachedDisplayText = await this.resolveCachedDisplayTextAsync(tableName, pkValue, requestId);
        if (cachedDisplayText !== null) {
            return { text: cachedDisplayText, source: 'reference-cache', columnName: pkColumnName };
        }

        const primaryKeyColumns = new Set(this.getPrimaryKeyColumnNames(schema));
        const referenceColumns = new Set(schema.header.filter(column => column.reference).map(column => column.name));
        for (const column of schema.header) {
            if (primaryKeyColumns.has(column.name) || referenceColumns.has(column.name)) continue;
            if (!this.isNaturalDisplayColumnName(column.name)) continue;
            const colIdx = header.indexOf(column.name);
            const value = colIdx !== -1 ? (row[colIdx] ?? '') : '';
            if (value !== '') return { text: value, source: 'natural-column', columnName: column.name };
        }

        for (const column of schema.header) {
            if (primaryKeyColumns.has(column.name) || referenceColumns.has(column.name)) continue;
            const colIdx = header.indexOf(column.name);
            const value = colIdx !== -1 ? (row[colIdx] ?? '') : '';
            if (value !== '') {
                return {
                    text: this.formatColumnValue(column, value),
                    source: 'scalar-column',
                    columnName: column.name,
                };
            }
        }

        if (pkValue !== '') return { text: `${pkColumnName}=${pkValue}`, source: 'pk', columnName: pkColumnName };
        return { text: '', source: 'none', columnName: null };
    }

    private async resolveCachedDisplayTextAsync(tableName: string, pkValue: string, requestId: number): Promise<string | null> {
        if (pkValue === '') return null;
        try {
            const referenceData = await this.referenceDataCache.get(tableName);
            if (requestId !== this.currentRequestId) return null;
            const displayText = referenceData.displayTextById.get(pkValue);
            if (displayText === undefined || displayText === '' || displayText === pkValue) return null;
            return displayText;
        } catch (err) {
            console.warn(`[FormPanel] reference display cache failed: ${tableName}`, err);
            return null;
        }
    }

    private async resolveRowReferenceSummariesAsync(
        header: string[],
        row: string[],
        schema: SchemaJson,
        requestId: number,
    ): Promise<RowReferenceSummary[]> {
        const summaries: RowReferenceSummary[] = [];
        for (const column of schema.header) {
            if (!column.reference) continue;
            const colIdx = header.indexOf(column.name);
            const fkValue = colIdx !== -1 ? (row[colIdx] ?? '') : '';
            if (fkValue === '') continue;

            const expr = parseReferenceExpression(column.reference);
            const summary = isSimpleReference(expr)
                ? await this.resolveSimpleReferenceSummaryAsync(column, expr.tableName, expr.columnName, fkValue, requestId)
                : await this.resolveDynamicReferenceSummaryAsync(column, expr, header, row, requestId);
            if (requestId !== this.currentRequestId) return summaries;
            if (summary !== null) summaries.push(summary);
        }
        return summaries;
    }

    private async resolveSimpleReferenceSummaryAsync(
        sourceColumn: SchemaColumn,
        targetTableName: string,
        targetColumnName: string,
        fkValue: string,
        requestId: number,
    ): Promise<RowReferenceSummary | null> {
        const [targetData, targetSchema] = await Promise.all([
            this.resolveTableDataAsync(targetTableName),
            this.loadSchemaJsonAsync(targetTableName),
        ]);
        if (requestId !== this.currentRequestId) return null;

        const matchedRow = this.filterRowsByColumn(targetData.rows, targetData.header, targetColumnName, fkValue)[0];
        const display = matchedRow === undefined
            ? null
            : await this.resolveRowDisplayCandidateAsync(
                targetTableName,
                targetData.header,
                matchedRow,
                targetSchema,
                extractFirstPrimaryKeyColumn(targetSchema),
                this.resolveRowPrimaryKeyValue(targetData.header, matchedRow, targetSchema),
                requestId,
            );
        if (requestId !== this.currentRequestId) return null;

        const label = this.getColumnDisplayLabel(sourceColumn);
        const valueText = display?.text !== undefined && display.text !== ''
            ? display.text
            : `${targetTableName}.${targetColumnName}=${fkValue}`;
        return {
            kind: 'simple',
            primaryText: `${label}: ${valueText}`,
            consumedColumns: new Set([sourceColumn.name]),
        };
    }

    private async resolveDynamicReferenceSummaryAsync(
        sourceColumn: SchemaColumn,
        expr: DynamicReference,
        header: string[],
        row: string[],
        requestId: number,
    ): Promise<RowReferenceSummary | null> {
        const valueColIdx = header.indexOf(expr.filter.valueColumn);
        const fkColIdx = header.indexOf(sourceColumn.name);
        if (valueColIdx === -1 || fkColIdx === -1) return null;
        const valueColumnValue = row[valueColIdx] ?? '';
        const fkValue = row[fkColIdx] ?? '';
        if (valueColumnValue === '' || fkValue === '') return null;

        const [filterTableData, filterSchema] = await Promise.all([
            this.resolveTableDataAsync(expr.filter.tableName),
            this.loadSchemaJsonAsync(expr.filter.tableName),
        ]);
        if (requestId !== this.currentRequestId) return null;

        const filterColIdx = filterTableData.header.indexOf(expr.filter.filterColumn);
        const lookupColIdx = filterTableData.header.indexOf(expr.lookupColumn);
        const targetColumnColIdx = filterTableData.header.indexOf(expr.targetColumn);
        if (filterColIdx === -1 || lookupColIdx === -1 || targetColumnColIdx === -1) return null;

        const filterRow = filterTableData.rows.find(candidate => candidate[filterColIdx] === valueColumnValue);
        if (filterRow === undefined) return null;

        const targetTableName = filterRow[lookupColIdx] ?? '';
        const targetColumnName = filterRow[targetColumnColIdx] ?? '';
        if (targetTableName === '' || targetColumnName === '') return null;

        const [targetData, targetSchema] = await Promise.all([
            this.resolveTableDataAsync(targetTableName),
            this.loadSchemaJsonAsync(targetTableName),
        ]);
        if (requestId !== this.currentRequestId) return null;

        const targetRow = this.filterRowsByColumn(targetData.rows, targetData.header, targetColumnName, fkValue)[0];
        const [filterDisplay, targetDisplay] = await Promise.all([
            this.resolveRowDisplayCandidateAsync(
                expr.filter.tableName,
                filterTableData.header,
                filterRow,
                filterSchema,
                extractFirstPrimaryKeyColumn(filterSchema),
                this.resolveRowPrimaryKeyValue(filterTableData.header, filterRow, filterSchema),
                requestId,
            ),
            targetRow === undefined
                ? Promise.resolve<DisplayCandidate>({ text: '', source: 'none', columnName: null })
                : this.resolveRowDisplayCandidateAsync(
                    targetTableName,
                    targetData.header,
                    targetRow,
                    targetSchema,
                    extractFirstPrimaryKeyColumn(targetSchema),
                    this.resolveRowPrimaryKeyValue(targetData.header, targetRow, targetSchema),
                    requestId,
                ),
        ]);
        if (requestId !== this.currentRequestId) return null;

        const typeText = filterDisplay.text !== '' ? filterDisplay.text : targetTableName;
        const valueText = targetDisplay.text !== ''
            ? targetDisplay.text
            : `${targetTableName}.${targetColumnName}=${fkValue}`;
        return {
            kind: 'dynamic',
            primaryText: `${typeText}: ${valueText}`,
            consumedColumns: new Set([sourceColumn.name, expr.filter.valueColumn]),
        };
    }

    private resolveRowPrimaryKeyValue(header: string[], row: string[], schema: SchemaJson): string {
        const pkColumnName = extractFirstPrimaryKeyColumn(schema);
        const pkColIdx = header.indexOf(pkColumnName);
        return pkColIdx !== -1 ? (row[pkColIdx] ?? '') : '';
    }

    private collectScalarMetaParts(
        header: string[],
        row: string[],
        schema: SchemaJson,
        display: DisplayCandidate,
        summaries: RowReferenceSummary[],
    ): string[] {
        const excludedColumns = new Set(this.getPrimaryKeyColumnNames(schema));
        for (const column of schema.header) {
            if (column.reference) excludedColumns.add(column.name);
        }
        if (display.columnName !== null && this.isStrongDisplayCandidate(display)) {
            excludedColumns.add(display.columnName);
        }
        for (const summary of summaries) {
            for (const columnName of summary.consumedColumns) excludedColumns.add(columnName);
        }

        const parts: string[] = [];
        for (const column of schema.header) {
            if (excludedColumns.has(column.name)) continue;
            const colIdx = header.indexOf(column.name);
            const value = colIdx !== -1 ? (row[colIdx] ?? '') : '';
            if (value === '') continue;
            parts.push(this.formatColumnValue(column, value));
            if (parts.length >= 4) break;
        }
        return parts;
    }

    private formatColumnValue(column: SchemaColumn, value: string): string {
        return `${this.getColumnDisplayLabel(column)}=${value}`;
    }

    private getColumnDisplayLabel(column: SchemaColumn): string {
        return column.comment !== undefined && column.comment !== '' ? column.comment : column.name;
    }

    private isStrongDisplayCandidate(display: DisplayCandidate): boolean {
        return display.source === 'display-column'
            || display.source === 'reference-cache'
            || display.source === 'natural-column';
    }

    private isNaturalDisplayColumnName(columnName: string): boolean {
        return /(^|_)(name|title|label|enum)(_|$)/.test(columnName);
    }

    private getPrimaryKeyColumnNames(schema: SchemaJson): string[] {
        if (Array.isArray(schema.primary_key)) return schema.primary_key;
        return [schema.primary_key];
    }

    private resolveReferenceDisplayColumnIndex(header: string[], pkColumnName: string): number {
        const displayColumnName = determineDisplayColumnName(header);
        if (displayColumnName !== '') return header.indexOf(displayColumnName);
        const fallbackIndex = header.findIndex(columnName => columnName !== pkColumnName);
        return fallbackIndex !== -1 ? fallbackIndex : header.indexOf(pkColumnName);
    }

    private filterRowsByColumn(rows: string[][], header: string[], columnName: string, value: string): string[][] {
        const colIdx = header.indexOf(columnName);
        if (colIdx === -1) return [];
        return rows.filter(row => row[colIdx] === value);
    }

    private filterRowsByColumnWithIndex(rows: string[][], header: string[], columnName: string, value: string): IndexedRow[] {
        const colIdx = header.indexOf(columnName);
        if (colIdx === -1) return [];
        const result: IndexedRow[] = [];
        for (let i = 0; i < rows.length; i++) {
            if (rows[i][colIdx] === value) result.push({row: rows[i], storeRowIndex: i});
        }
        return result;
    }

    private resolveTargetRowIndex(rows: string[][], pkColumnIndex: number, pkValue: string, storeRowIndex: number | null): number {
        if (storeRowIndex !== null && storeRowIndex >= 0 && storeRowIndex < rows.length) {
            if (pkColumnIndex === -1 || (rows[storeRowIndex][pkColumnIndex] ?? '') === pkValue) return storeRowIndex;
        }
        if (pkColumnIndex === -1) return -1;
        return rows.findIndex(row => (row[pkColumnIndex] ?? '') === pkValue);
    }

    private buildOptionalStoreRowIndex(storeRowIndex: number | null): {storeRowIndex: number} | Record<string, never> {
        return storeRowIndex !== null && Number.isInteger(storeRowIndex) && storeRowIndex >= 0
            ? {storeRowIndex}
            : {};
    }

    private parseOptionalStoreRowIndex(value: string | undefined): number | null {
        if (value === undefined || value === '') return null;
        const parsed = Number(value);
        return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
    }

    private getContentElement(): HTMLElement {
        return this.panelElement.querySelector('.form-panel-content') as HTMLElement;
    }

    private buildMessage(text: string, className: string): HTMLElement {
        const element = document.createElement('div');
        element.classList.add(className);
        element.textContent = text;
        return element;
    }

    private clearCommitTimers(): void {
        for (const timer of this.commitTimers.values()) {
            window.clearTimeout(timer);
        }
        this.commitTimers.clear();
        this.pendingCommitValues.clear();
    }

    private clearScheduledFieldCommit(nodeId: string, columnName: string): void {
        const key = this.getCommitTimerKey(nodeId, columnName);
        const existing = this.commitTimers.get(key);
        if (existing !== undefined) window.clearTimeout(existing);
        this.commitTimers.delete(key);
        this.pendingCommitValues.delete(key);
    }

    private releaseCleanRegisteredTables(): void {
        for (const tableName of Array.from(this.registeredForEditTableNames)) {
            if (!this.store.hasTable(tableName) || this.store.isTableDirty(tableName)) continue;
            this.store.unregisterTable(tableName);
            this.registeredForEditTableNames.delete(tableName);
        }
    }

    private getCommitTimerKey(nodeId: string, columnName: string): string {
        return `${this.currentRequestId}:${nodeId}:${columnName}`;
    }

    private removeNodeDescendants(parentNodeId: string): void {
        for (const nodeId of Array.from(this.nodeMetaById.keys())) {
            if (nodeId === parentNodeId) continue;
            if (this.isDescendantNode(nodeId, parentNodeId)) this.removeNodeBranch(nodeId);
        }
    }

    private removeNodeBranch(nodeId: string): void {
        for (const candidateId of Array.from(this.nodeMetaById.keys())) {
            if (candidateId === nodeId || this.isDescendantNode(candidateId, nodeId)) {
                this.nodeDataById.delete(candidateId);
                this.nodeElementsById.delete(candidateId);
                this.nodeMetaById.delete(candidateId);
                this.nodeRenderRequestIds.delete(candidateId);
            }
        }
    }

    private isDescendantNode(nodeId: string, ancestorNodeId: string): boolean {
        let current = this.nodeMetaById.get(nodeId)?.parentNodeId ?? null;
        while (current !== null) {
            if (current === ancestorNodeId) return true;
            current = this.nodeMetaById.get(current)?.parentNodeId ?? null;
        }
        return false;
    }

    private async resolveTableDataAsync(tableName: string): Promise<{ header: string[]; rows: string[][] }> {
        await this.store.ensureTableLoadedAsync(tableName);
        const storeHeader = this.store.getHeader(tableName);
        const storeRows = this.store.getRows(tableName);
        if (storeHeader !== false && storeRows !== false) {
            return { header: storeHeader, rows: storeRows };
        }
        throw new Error(`[FormPanel] テーブル "${tableName}" をInMemoryTableStoreから取得できません`);
    }

    private async loadSchemaJsonAsync(tableName: string): Promise<SchemaJson> {
        const text = await readFileAsync(`schema/${tableName}.json`);
        return JSON.parse(text) as SchemaJson;
    }
}

interface SchemaColumn {
    name: string;
    type?: string;
    comment?: string;
    reference?: string | DynamicReferenceSchema;
    default?: unknown;
}

interface SchemaJson {
    header: SchemaColumn[];
    primary_key: string | string[];
    [key: string]: unknown;
}
