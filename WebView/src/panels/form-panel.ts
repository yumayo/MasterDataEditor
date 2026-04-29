import {InMemoryTableStore} from "../data/in-memory-table-store";
import {ReverseReferenceResolver} from "../references/reverse-reference-resolver";
import {determineDisplayColumnName} from "../config/config";
import {readFileAsync} from "../app/api";
import {Csv} from "../data/csv";
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

interface FormPage {
    tableName: string;
    pkValue: string;
    label: string;
}

interface CurrentPageData {
    tableName: string;
    header: string[];
    rows: string[][];
    row: string[];
    rowIndex: number;
    schema: SchemaJson;
    pkColumnName: string;
    pkColumnIndex: number;
}

interface ReferenceSection {
    title: string;
    detail: string;
    badge: string;
    emptyText: string;
    items: ReferenceItem[];
}

interface ReferenceItem {
    tableName: string;
    pkValue: string;
    primaryText: string;
    secondaryText: string;
    canOpen: boolean;
    missing: boolean;
}

interface ReferenceFieldDropdownData {
    tableName: string;
    items: GridDropdownItem[];
}

interface ActiveReferenceField {
    columnName: string;
    input: HTMLInputElement | HTMLTextAreaElement;
    mirror: HTMLElement;
    valueWrapper: HTMLElement;
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
    private readonly reverseReferenceResolver: ReverseReferenceResolver;
    private readonly tab: Tab;
    private readonly notification: NotificationToast;
    private readonly validationPanel: ValidationPanel | false;
    private navStack: FormPage[];
    private currentRequestId: number;
    private currentPageData: CurrentPageData | null;
    private readonly commitTimers: Map<string, number>;
    private readonly referenceDropdown: GridDropdownInput;
    private activeReferenceField: ActiveReferenceField | null;
    private referenceDropdownRequestId: number;

    constructor(store: InMemoryTableStore, referenceDataCache: ReferenceDataCache, tab: Tab, notification: NotificationToast, validationPanel: ValidationPanel | false) {
        this.store = store;
        this.referenceDataCache = referenceDataCache;
        this.reverseReferenceResolver = new ReverseReferenceResolver(store, notification);
        this.tab = tab;
        this.notification = notification;
        this.validationPanel = validationPanel;
        this.navStack = [];
        this.currentRequestId = 0;
        this.currentPageData = null;
        this.commitTimers = new Map();
        this.activeReferenceField = null;
        this.referenceDropdownRequestId = 0;

        const panel = document.createElement('div');
        panel.classList.add('form-panel');
        this.panelElement = panel;

        const header = document.createElement('div');
        header.classList.add('form-panel-header');

        const breadcrumb = document.createElement('div');
        breadcrumb.classList.add('form-panel-breadcrumb');
        header.appendChild(breadcrumb);

        const closeButton = document.createElement('button');
        closeButton.classList.add('form-panel-close');
        closeButton.type = 'button';
        closeButton.setAttribute('aria-label', 'フォームビューを閉じる');
        closeButton.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>`;
        closeButton.addEventListener('click', () => { this.tab.closeFormPanel(); });
        header.appendChild(closeButton);

        const content = document.createElement('div');
        content.classList.add('form-panel-content');

        this.panelElement.appendChild(header);
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
        this.clearCommitTimers();
        this.hideReferenceDropdown();
        this.panelElement.remove();
    }

    containsElement(element: Element | null): boolean {
        return element !== null && this.panelElement.contains(element);
    }

    showForRowAsync(tableName: string, pkValue: string): Promise<void> {
        this.navStack = [{ tableName, pkValue, label: `${tableName} / ${pkValue}` }];
        return this.renderCurrentPageAsync();
    }

    restoreNavStackAsync(navStack: Array<{tableName: string; pkValue: string; label: string}>): Promise<void> {
        this.navStack = [...navStack];
        return this.renderCurrentPageAsync();
    }

    private drillDownAsync(tableName: string, pkValue: string, label: string): Promise<void> {
        this.navStack.push({ tableName, pkValue, label });
        this.tab.pushFormDrillDown(this.navStack);
        return this.renderCurrentPageAsync();
    }

    private async renderCurrentPageAsync(): Promise<void> {
        const requestId = ++this.currentRequestId;
        const page = this.navStack[this.navStack.length - 1];
        this.currentPageData = null;
        this.clearCommitTimers();
        this.hideReferenceDropdown();
        this.renderBreadcrumb();

        const content = this.getContentElement();
        content.replaceChildren(this.buildMessage('読み込み中...', 'form-panel-loading'));

        try {
            const [tableData, schema] = await Promise.all([
                this.resolveTableDataAsync(page.tableName),
                this.loadSchemaJsonAsync(page.tableName),
            ]);
            if (requestId !== this.currentRequestId) return;

            const pkColumnName = extractFirstPrimaryKeyColumn(schema);
            const pkColumnIndex = tableData.header.indexOf(pkColumnName);
            const rowIndex = pkColumnIndex === -1
                ? -1
                : tableData.rows.findIndex(row => row[pkColumnIndex] === page.pkValue);

            content.replaceChildren();
            content.appendChild(this.buildTitle(page.tableName, page.pkValue));

            if (rowIndex === -1) {
                content.appendChild(this.buildMessage(`PK "${page.pkValue}" の行が見つかりません`, 'form-panel-not-found'));
                return;
            }

            const row = tableData.rows[rowIndex];
            this.currentPageData = {
                tableName: page.tableName,
                header: tableData.header,
                rows: tableData.rows,
                row,
                rowIndex,
                schema,
                pkColumnName,
                pkColumnIndex,
            };

            content.appendChild(this.buildFields(row, tableData.header, schema));
            content.appendChild(this.buildReferencesContainer());

            await Promise.all([
                this.refreshValidationAsync(requestId),
                this.renderReferencesAsync(requestId),
            ]);
        } catch (err) {
            if (requestId !== this.currentRequestId) return;
            content.replaceChildren(this.buildMessage('エラーが発生しました', 'form-panel-error'));
            console.error('[FormPanel] renderCurrentPageAsync failed:', err);
            this.notification.show('フォームの表示に失敗しました');
        }
    }

    private renderBreadcrumb(): void {
        const breadcrumb = this.panelElement.querySelector('.form-panel-breadcrumb') as HTMLElement;
        breadcrumb.replaceChildren();
        for (let i = 0; i < this.navStack.length; i++) {
            if (i > 0) {
                const sep = document.createElement('span');
                sep.classList.add('form-panel-breadcrumb-sep');
                sep.textContent = '/';
                breadcrumb.appendChild(sep);
            }
            const item = document.createElement('button');
            item.type = 'button';
            item.classList.add('form-panel-breadcrumb-item');
            if (i === this.navStack.length - 1) {
                item.classList.add('form-panel-breadcrumb-item--current');
                item.disabled = true;
            } else {
                item.classList.add('form-panel-breadcrumb-item--link');
                const capturedIndex = i;
                item.addEventListener('click', () => {
                    const delta = capturedIndex - (this.navStack.length - 1);
                    history.go(delta);
                });
            }
            item.textContent = this.navStack[i].label;
            breadcrumb.appendChild(item);
        }
    }

    private buildTitle(tableName: string, pkValue: string): HTMLElement {
        const title = document.createElement('div');
        title.classList.add('form-panel-title');

        const table = document.createElement('span');
        table.classList.add('form-panel-title-table');
        table.textContent = tableName;

        const pk = document.createElement('span');
        pk.classList.add('form-panel-title-pk');
        pk.textContent = pkValue;

        title.appendChild(table);
        title.appendChild(pk);
        return title;
    }

    private buildFields(row: string[], header: string[], schema: SchemaJson): HTMLElement {
        const fields = document.createElement('div');
        fields.classList.add('form-panel-fields');

        for (let i = 0; i < header.length; i++) {
            const columnName = header[i];
            const colSchema = schema.header.find(col => col.name === columnName);
            fields.appendChild(this.buildFieldElement(columnName, row[i] ?? '', i, colSchema));
        }

        return fields;
    }

    private buildFieldElement(columnName: string, value: string, columnIndex: number, colSchema: SchemaColumn | undefined): HTMLElement {
        const field = document.createElement('div');
        field.classList.add('form-panel-field');
        field.dataset.columnName = columnName;
        field.dataset.columnIndex = String(columnIndex);

        const header = document.createElement('div');
        header.classList.add('form-panel-field-header');

        const label = document.createElement('label');
        label.classList.add('form-panel-field-label');
        const inputId = `form-field-${this.currentRequestId}-${columnIndex}`;
        label.htmlFor = inputId;
        label.textContent = columnName;
        header.appendChild(label);

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
            this.scheduleFieldCommit(columnName, nextValue);
            if (colSchema?.reference) {
                if (this.isActiveReferenceInput(input) && this.referenceDropdown.isVisible()) {
                    this.referenceDropdown.onInputChanged(nextValue);
                } else {
                    this.showReferenceDropdownForInputAsync(columnName, input, mirror, valueWrapper, true)
                        .catch(err => {
                            console.error('[FormPanel] reference dropdown input failed:', err);
                            this.notification.show('参照候補の表示に失敗しました');
                        });
                }
            }
        };
        input.addEventListener('input', updateValue);
        input.addEventListener('change', () => {
            this.commitFieldValueAsync(columnName, input.value).catch(err => {
                console.error('[FormPanel] field change failed:', err);
                this.notification.show('フォーム入力の反映に失敗しました');
            });
        });
        input.addEventListener('blur', () => {
            this.commitFieldValueAsync(columnName, input.value).catch(err => {
                console.error('[FormPanel] field blur commit failed:', err);
                this.notification.show('フォーム入力の反映に失敗しました');
            });
            if (this.isActiveReferenceInput(input)) {
                this.hideReferenceDropdown();
            }
        });
        input.addEventListener('keydown', (event) => {
            const keyboardEvent = event as KeyboardEvent;
            if (colSchema?.reference && this.handleReferenceDropdownKeydown(keyboardEvent, columnName, input, mirror, valueWrapper)) {
                return;
            }
            if (keyboardEvent.key !== 'Enter' || input instanceof HTMLTextAreaElement) return;
            keyboardEvent.preventDefault();
            input.blur();
        });
        if (colSchema?.reference) {
            input.addEventListener('focus', () => {
                this.showReferenceDropdownForInputAsync(columnName, input, mirror, valueWrapper, false)
                    .catch(err => {
                        console.error('[FormPanel] reference dropdown focus failed:', err);
                        this.notification.show('参照候補の表示に失敗しました');
                    });
            });
        }

        field.appendChild(header);
        field.appendChild(valueWrapper);
        field.appendChild(errorList);
        return field;
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

    private async commitFieldValueAsync(columnName: string, value: string): Promise<void> {
        this.clearScheduledFieldCommit(columnName);
        const data = this.currentPageData;
        if (data === null) return;
        const columnIndex = data.header.indexOf(columnName);
        if (columnIndex === -1) return;

        const oldValue = data.row[columnIndex] ?? '';
        if (oldValue === value) {
            await this.refreshValidationAsync(this.currentRequestId);
            return;
        }

        const editorTable = this.tab.getOpenEditorTables().get(data.tableName);
        const reflected = editorTable?.applyExternalCellEditByStoreIndex(data.rowIndex, columnIndex, value) ?? false;
        if (!reflected) {
            const updated = this.store.updateCellValueByRowIndex(data.tableName, data.rowIndex, columnIndex, value);
            if (!updated) {
                console.warn('[FormPanel] commitFieldValueAsync: EditorTable と store のどちらにも反映できませんでした', data.tableName, data.rowIndex, columnIndex);
            }
        }

        data.row[columnIndex] = value;
        if (columnIndex === data.pkColumnIndex) {
            const currentPage = this.navStack[this.navStack.length - 1];
            currentPage.pkValue = value;
            currentPage.label = `${data.tableName} / ${value}`;
            this.renderBreadcrumb();
            const pkTitle = this.panelElement.querySelector('.form-panel-title-pk');
            if (pkTitle !== null) pkTitle.textContent = value;
        }

        const requestId = this.currentRequestId;
        await Promise.all([
            this.refreshValidationAsync(requestId),
            this.renderReferencesAsync(requestId),
        ]);
    }

    private scheduleFieldCommit(columnName: string, value: string): void {
        const key = `${this.currentRequestId}:${columnName}`;
        const existing = this.commitTimers.get(key);
        if (existing !== undefined) window.clearTimeout(existing);
        const timer = window.setTimeout(() => {
            this.commitTimers.delete(key);
            this.commitFieldValueAsync(columnName, value).catch(err => {
                console.error('[FormPanel] field input commit failed:', err);
                this.notification.show('フォーム入力の反映に失敗しました');
            });
        }, 180);
        this.commitTimers.set(key, timer);
    }

    private async refreshValidationAsync(requestId: number): Promise<void> {
        const data = this.currentPageData;
        if (data === null) return;
        if (this.validationPanel === false) {
            this.renderValidationErrors([]);
            return;
        }

        const errors = await this.validationPanel.runAndUpdateAsync();
        if (requestId !== this.currentRequestId) return;
        this.renderValidationErrors(errors);
    }

    private async showReferenceDropdownForInputAsync(
        columnName: string,
        input: HTMLInputElement | HTMLTextAreaElement,
        mirror: HTMLElement,
        valueWrapper: HTMLElement,
        filterByInput: boolean,
    ): Promise<void> {
        const data = this.currentPageData;
        if (data === null) return;
        const colSchema = data.schema.header.find(col => col.name === columnName);
        if (!colSchema?.reference) return;

        const requestId = this.currentRequestId;
        const dropdownRequestId = ++this.referenceDropdownRequestId;
        this.activeReferenceField = { columnName, input, mirror, valueWrapper };

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
        columnName: string,
        input: HTMLInputElement | HTMLTextAreaElement,
        mirror: HTMLElement,
        valueWrapper: HTMLElement,
    ): boolean {
        if (!this.isActiveReferenceInput(input) || !this.referenceDropdown.isVisible()) {
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                this.showReferenceDropdownForInputAsync(columnName, input, mirror, valueWrapper, false)
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
        this.commitFieldValueAsync(active.columnName, id).catch(err => {
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

    private renderValidationErrors(errors: ValidationError[]): void {
        const data = this.currentPageData;
        if (data === null) return;

        const rowErrors = errors.filter(error => error.tableName === data.tableName && error.rowIndex === data.rowIndex);

        for (const field of Array.from(this.panelElement.querySelectorAll('.form-panel-field'))) {
            field.classList.remove('form-panel-field--invalid');
            const fieldErrors = field.querySelector('.form-panel-field-errors');
            if (fieldErrors !== null) fieldErrors.replaceChildren();
        }

        for (const error of rowErrors) {
            if (error.columnIndex >= 0) {
                const field = this.panelElement.querySelector(`.form-panel-field[data-column-index="${error.columnIndex}"]`) as HTMLElement | null;
                const fieldErrors = field?.querySelector('.form-panel-field-errors') as HTMLElement | null;
                if (field !== null && fieldErrors !== null) {
                    field.classList.add('form-panel-field--invalid');
                    const fieldError = document.createElement('div');
                    fieldError.classList.add('form-panel-field-error');
                    fieldError.textContent = error.message;
                    fieldErrors.appendChild(fieldError);
                }
            }
        }
    }

    private async renderReferencesAsync(requestId: number): Promise<void> {
        const data = this.currentPageData;
        if (data === null) return;
        const body = this.panelElement.querySelector('.form-panel-references-body') as HTMLElement | null;
        if (body === null) return;
        body.textContent = '読み込み中...';

        try {
            const [outgoing, incoming] = await Promise.all([
                this.resolveOutgoingReferenceSectionsAsync(data, requestId),
                this.resolveIncomingReferenceSectionsAsync(data, requestId),
            ]);
            if (requestId !== this.currentRequestId) return;

            body.replaceChildren();
            const sections = [...outgoing, ...incoming];
            if (sections.length === 0) {
                body.appendChild(this.buildMessage('参照なし', 'form-panel-section-empty'));
                return;
            }
            for (const section of sections) {
                body.appendChild(this.buildReferenceSection(section));
            }
        } catch (err) {
            if (requestId !== this.currentRequestId) return;
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
                const matchedRows = this.filterRowsByColumn(targetData.rows, targetData.header, expr.columnName, fkValue);
                sections.push(this.buildOutgoingSection(
                    column.name,
                    fkValue,
                    expr.tableName,
                    expr.columnName,
                    targetData.header,
                    matchedRows,
                    targetSchema,
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

        const matchedRows = this.filterRowsByColumn(targetData.rows, targetData.header, targetColumnName, fkValue);
        return this.buildOutgoingSection(columnName, fkValue, targetTableName, targetColumnName, targetData.header, matchedRows, targetSchema);
    }

    private buildOutgoingSection(
        sourceColumnName: string,
        fkValue: string,
        targetTableName: string,
        targetColumnName: string,
        targetHeader: string[],
        matchedRows: string[][],
        targetSchema: SchemaJson,
    ): ReferenceSection {
        return {
            title: `参照先: ${sourceColumnName} → ${targetTableName}`,
            detail: `${sourceColumnName}=${fkValue} -> ${targetTableName}.${targetColumnName}`,
            badge: `${matchedRows.length}`,
            emptyText: `値 "${fkValue}" に一致する参照先がありません`,
            items: matchedRows.map(row => this.createReferenceItem(targetTableName, targetHeader, row, targetSchema, false)),
        };
    }

    private async resolveIncomingReferenceSectionsAsync(data: CurrentPageData, requestId: number): Promise<ReferenceSection[]> {
        const sections: ReferenceSection[] = [];
        const reverseMap = await this.reverseReferenceResolver.resolveAsync(data.tableName);
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
            const filteredRows = fkColIdx === -1 ? [] : childData.rows.filter(row => row[fkColIdx] === pkValue);
            sections.push({
                title: `参照元: ${entry.childTableName}`,
                detail: `${entry.childTableName}.${entry.childColumnName}=${pkValue}`,
                badge: `${filteredRows.length}`,
                emptyText: '参照元の行はありません',
                items: filteredRows.map(row => this.createReferenceItem(entry.childTableName, childData.header, row, childSchema, false)),
            });
        }

        return sections;
    }

    private buildReferenceSection(section: ReferenceSection): HTMLElement {
        const container = document.createElement('div');
        container.classList.add('form-panel-section');

        const header = document.createElement('div');
        header.classList.add('form-panel-section-header');

        const titleWrap = document.createElement('div');
        titleWrap.classList.add('form-panel-section-title-wrap');
        const title = document.createElement('div');
        title.classList.add('form-panel-section-title');
        title.textContent = section.title;
        const detail = document.createElement('div');
        detail.classList.add('form-panel-section-detail');
        detail.textContent = section.detail;
        titleWrap.appendChild(title);
        titleWrap.appendChild(detail);

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
        } else {
            for (const item of section.items) list.appendChild(this.buildReferenceItemElement(item));
        }
        container.appendChild(list);
        return container;
    }

    private buildReferenceItemElement(item: ReferenceItem): HTMLElement {
        const element = document.createElement(item.canOpen ? 'button' : 'div');
        element.classList.add('form-panel-ref-item');
        if (item.canOpen) {
            (element as HTMLButtonElement).type = 'button';
            element.classList.add('form-panel-ref-item--clickable');
            element.addEventListener('click', () => {
                this.drillDownAsync(item.tableName, item.pkValue, item.primaryText).catch(err => {
                    console.error('[FormPanel] drillDownAsync failed:', err);
                    this.notification.show('フォームのドリルダウンに失敗しました');
                });
            });
        }
        if (item.missing) element.classList.add('form-panel-ref-item--missing');

        const main = document.createElement('div');
        main.classList.add('form-panel-ref-item-main');
        main.textContent = item.primaryText;

        const sub = document.createElement('div');
        sub.classList.add('form-panel-ref-item-sub');
        sub.textContent = item.secondaryText;

        element.appendChild(main);
        element.appendChild(sub);
        return element;
    }

    private createReferenceItem(tableName: string, header: string[], row: string[], schema: SchemaJson, missing: boolean): ReferenceItem {
        const pkColumnName = extractFirstPrimaryKeyColumn(schema);
        const pkColIdx = header.indexOf(pkColumnName);
        const displayColIdx = this.resolveReferenceDisplayColumnIndex(header, pkColumnName);
        const pkValue = pkColIdx !== -1 ? (row[pkColIdx] ?? '') : '';
        const displayValue = displayColIdx !== -1 ? (row[displayColIdx] ?? '') : '';
        const primaryText = displayValue !== '' ? displayValue : (pkValue !== '' ? `${pkColumnName}=${pkValue}` : '(PK値なし)');
        const secondaryText = pkValue !== '' && displayValue !== pkValue
            ? `${tableName}.${pkColumnName}=${pkValue}`
            : tableName;
        return {
            tableName,
            pkValue,
            primaryText,
            secondaryText,
            canOpen: pkValue !== '' && !missing,
            missing,
        };
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
    }

    private clearScheduledFieldCommit(columnName: string): void {
        const key = `${this.currentRequestId}:${columnName}`;
        const existing = this.commitTimers.get(key);
        if (existing === undefined) return;
        window.clearTimeout(existing);
        this.commitTimers.delete(key);
    }

    private async resolveTableDataAsync(tableName: string): Promise<{ header: string[]; rows: string[][] }> {
        const storeHeader = this.store.getHeader(tableName);
        const storeRows = this.store.getRows(tableName);
        if (storeHeader !== false && storeRows !== false) {
            return { header: storeHeader, rows: storeRows };
        }
        const csvText = await readFileAsync(`data/${tableName}.csv`);
        const csv = new Csv();
        csv.load(csvText);
        return { header: csv.header, rows: csv.body };
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
