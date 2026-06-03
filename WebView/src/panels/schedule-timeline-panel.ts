import {findFilesAsync, readFileAsync} from "../app/api";
import {Csv} from "../data/csv";
import type {InMemoryTableStore, TableDataChangeEvent} from "../data/in-memory-table-store";
import type {EditorTable} from "../editor/editor-table";
import type {SerializedFilters, TemporaryFilterMode} from "../editor/column-filter";
import {getAppliedSettings} from "./settings-panel";
import {SETTINGS_CHANGED_EVENT} from "../settings/settings-schema";
import type {UiScrollPosition, UiStateStore} from "../app/ui-state";

type ScheduleKind = 'begin' | 'end';

interface ScheduleTimelineColumns {
    beginIndex: number;
    endIndex: number;
}

interface ScheduleTimelineTableData {
    header: string[];
    rows: string[][];
}

interface ScheduleTimelineTableEntry {
    tableName: string;
    beginValues: Set<string>;
    endValues: Set<string>;
    beginValueCounts: Map<string, number>;
    endValueCounts: Map<string, number>;
    beginCount: number;
    endCount: number;
}

interface ScheduleTimelineDateGroup {
    date: string;
    sortTime: number;
    tables: Map<string, ScheduleTimelineTableEntry>;
}

type ScheduleTimelineNavigate = (tableName: string, filters: SerializedFilters, mode: TemporaryFilterMode) => void;

/**
 * 出力予定日・削除予定日を全テーブル横断で日付別に表示するパネル。
 */
export class ScheduleTimelinePanel {
    private readonly element: HTMLElement;
    private readonly contentElement: HTMLElement;
    private readonly store: InMemoryTableStore;
    private readonly openEditorTables: Map<string, EditorTable>;
    private readonly onNavigate: ScheduleTimelineNavigate;
    private readonly uiStateStore: UiStateStore;
    private readonly collapsedDates: Set<string>;
    private readonly dateGroups = new Map<string, ScheduleTimelineDateGroup>();
    private readonly tableDateKeys = new Map<string, Set<string>>();
    private readonly tableScheduleColumns = new Map<string, ScheduleTimelineColumns>();
    private readonly knownTableNames = new Set<string>();
    private scrollPosition: UiScrollPosition;
    private requestId = 0;
    private renderScheduled = false;

    constructor(
        store: InMemoryTableStore,
        openEditorTables: Map<string, EditorTable>,
        onNavigate: ScheduleTimelineNavigate,
        uiStateStore: UiStateStore,
    ) {
        this.store = store;
        this.openEditorTables = openEditorTables;
        this.onNavigate = onNavigate;
        this.uiStateStore = uiStateStore;
        const storedState = this.uiStateStore.getState().sidebar.scheduleTimeline;
        this.collapsedDates = new Set(storedState.collapsedDates);
        this.scrollPosition = storedState.scroll;

        this.element = document.createElement('div');
        this.element.classList.add('sidebar-panel', 'schedule-timeline-panel');

        const headerElement = document.createElement('div');
        headerElement.classList.add('sidebar-panel-header');
        headerElement.textContent = 'SCHEDULE';
        this.element.appendChild(headerElement);

        this.contentElement = document.createElement('div');
        this.contentElement.classList.add('schedule-timeline-content');
        this.contentElement.setAttribute('role', 'list');
        this.element.appendChild(this.contentElement);
        this.renderMessage('予定日はありません');

        this.element.addEventListener('scroll', () => {
            this.saveScrollPosition();
        }, {passive: true});

        window.addEventListener(SETTINGS_CHANGED_EVENT, () => {
            if (!this.isVisible()) return;
            this.refreshAsync().catch((e: unknown) => {
                console.error('[ScheduleTimelinePanel] refresh after settings change failed:', e);
            });
        });

        this.store.subscribeDataChange(event => {
            this.handleStoreDataChanged(event);
        });
    }

    appendTo(parent: HTMLElement): void {
        parent.appendChild(this.element);
    }

    show(): void {
        this.element.classList.add('sidebar-panel-active');
        this.refreshAsync().catch((e: unknown) => {
            console.error('[ScheduleTimelinePanel] refresh failed:', e);
            this.renderMessage('予定日の読み込みに失敗しました');
        });
    }

    hide(): void {
        this.element.classList.remove('sidebar-panel-active');
    }

    isVisible(): boolean {
        return this.element.classList.contains('sidebar-panel-active');
    }

    async refreshAsync(): Promise<void> {
        const currentRequestId = ++this.requestId;
        const scrollToRestore = this.scrollPosition;
        this.renderMessage('読み込み中...');
        await this.rebuildScheduleIndexAsync();
        if (currentRequestId !== this.requestId) return;
        this.renderGroups(this.getSortedGroups(), scrollToRestore);
    }

    private async rebuildScheduleIndexAsync(): Promise<void> {
        this.dateGroups.clear();
        this.tableDateKeys.clear();
        this.tableScheduleColumns.clear();
        this.knownTableNames.clear();

        const settings = getAppliedSettings();
        const beginColumnName = settings.exportBeginDateColumnName.trim();
        const endColumnName = settings.exportEndDateColumnName.trim();
        if (beginColumnName === '' && endColumnName === '') return;

        const tableNames = await this.loadTableNamesAsync();
        for (const tableName of tableNames) this.knownTableNames.add(tableName);
        await Promise.all(tableNames.map(async tableName => {
            const tableData = await this.loadTableDataAsync(tableName);
            if (tableData === null) return;
            const columns = this.createScheduleColumns(tableData.header, beginColumnName, endColumnName);
            this.tableScheduleColumns.set(tableName, columns);
            this.addTableDataToIndex(tableName, tableData, columns);
        }));
    }

    private async loadTableNamesAsync(): Promise<string[]> {
        const files = await findFilesAsync('schema');
        const names: string[] = [];
        for (const file of files) {
            if (file.type !== 'file' || !file.name.endsWith('.json')) continue;
            names.push(file.name.split('.').slice(0, -1).join('.'));
        }
        return names.sort((left, right) => left.localeCompare(right));
    }

    private async loadTableDataAsync(tableName: string): Promise<ScheduleTimelineTableData | null> {
        if (this.openEditorTables.has(tableName) || this.store.hasTable(tableName)) {
            const header = this.store.getHeader(tableName);
            const rows = this.store.getRows(tableName);
            if (header === false || rows === false) return null;
            return {header, rows};
        }

        try {
            const csvText = await readFileAsync(`data/${tableName}.csv`);
            const csv = new Csv();
            csv.load(csvText);
            return {header: csv.header, rows: csv.body};
        } catch {
            return null;
        }
    }

    private createScheduleColumns(header: readonly string[], beginColumnName: string, endColumnName: string): ScheduleTimelineColumns {
        return {
            beginIndex: beginColumnName === '' ? -1 : header.indexOf(beginColumnName),
            endIndex: endColumnName === '' ? -1 : header.indexOf(endColumnName),
        };
    }

    private addTableDataToIndex(
        tableName: string,
        tableData: ScheduleTimelineTableData,
        columns: ScheduleTimelineColumns,
    ): boolean {
        if (columns.beginIndex === -1 && columns.endIndex === -1) return false;

        let changed = false;
        for (const row of tableData.rows) {
            changed = this.applyRowDeltaToIndex(tableName, columns, row, 1) || changed;
        }
        return changed;
    }

    private async refreshTableIndexAsync(tableName: string): Promise<void> {
        if (!this.isVisible()) return;
        if (this.knownTableNames.size > 0 && !this.knownTableNames.has(tableName)) return;

        const currentRequestId = this.requestId;
        const tableData = await this.loadTableDataAsync(tableName);
        if (!this.isVisible() || currentRequestId !== this.requestId) return;

        const previousSignature = this.getTableIndexSignature(tableName);
        this.removeTableFromDateIndex(tableName);
        if (tableData === null) {
            this.tableScheduleColumns.delete(tableName);
            if (previousSignature !== '') this.scheduleRender();
            return;
        }

        const settings = getAppliedSettings();
        const columns = this.createScheduleColumns(
            tableData.header,
            settings.exportBeginDateColumnName.trim(),
            settings.exportEndDateColumnName.trim(),
        );
        this.tableScheduleColumns.set(tableName, columns);
        this.addTableDataToIndex(tableName, tableData, columns);
        if (previousSignature !== this.getTableIndexSignature(tableName)) this.scheduleRender();
    }

    private handleStoreDataChanged(event: TableDataChangeEvent): void {
        if (!this.isVisible()) return;
        if (event.reason === 'stale' || event.reason === 'rowMoved') return;
        if (this.knownTableNames.size > 0 && !this.knownTableNames.has(event.tableName)) return;

        if (this.requiresTableReindex(event)) {
            this.refreshTableIndexAsync(event.tableName).catch((e: unknown) => {
                console.error('[ScheduleTimelinePanel] table index refresh failed:', e);
            });
            return;
        }

        const columns = this.getCurrentScheduleColumns(event.tableName);
        if (columns.beginIndex === -1 && columns.endIndex === -1) return;

        let changed = false;
        if (event.reason === 'cell') {
            if (event.columnIndex === undefined || event.oldValue === undefined || event.newValue === undefined) {
                this.refreshTableIndexAsync(event.tableName).catch((e: unknown) => {
                    console.error('[ScheduleTimelinePanel] table index refresh failed:', e);
                });
                return;
            }
            const kinds = this.getScheduleKindsForColumn(columns, event.columnIndex);
            if (kinds.length === 0) return;
            for (const kind of kinds) {
                changed = this.applyScheduleValueDelta(event.tableName, kind, event.oldValue, -1) || changed;
                changed = this.applyScheduleValueDelta(event.tableName, kind, event.newValue, 1) || changed;
            }
        } else if (event.reason === 'rowInserted') {
            if (event.rowValues === undefined) return;
            changed = this.applyRowDeltaToIndex(event.tableName, columns, event.rowValues, 1);
        } else if (event.reason === 'rowRemoved') {
            if (event.rowValues === undefined) return;
            changed = this.applyRowDeltaToIndex(event.tableName, columns, event.rowValues, -1);
        }

        if (changed) this.scheduleRender();
    }

    private requiresTableReindex(event: TableDataChangeEvent): boolean {
        return event.reason === 'reload'
            || event.reason === 'rowsReplaced'
            || event.reason === 'columnInserted'
            || event.reason === 'columnRemoved'
            || event.reason === 'columnRenamed'
            || event.reason === 'unknown';
    }

    private getCurrentScheduleColumns(tableName: string): ScheduleTimelineColumns {
        const settings = getAppliedSettings();
        const header = this.store.getHeader(tableName);
        if (header !== false) {
            const columns = this.createScheduleColumns(
                header,
                settings.exportBeginDateColumnName.trim(),
                settings.exportEndDateColumnName.trim(),
            );
            this.tableScheduleColumns.set(tableName, columns);
            return columns;
        }
        return this.tableScheduleColumns.get(tableName) ?? {beginIndex: -1, endIndex: -1};
    }

    private getScheduleKindsForColumn(columns: ScheduleTimelineColumns, columnIndex: number): ScheduleKind[] {
        const kinds: ScheduleKind[] = [];
        if (columns.beginIndex === columnIndex) kinds.push('begin');
        if (columns.endIndex === columnIndex) kinds.push('end');
        return kinds;
    }

    private applyRowDeltaToIndex(
        tableName: string,
        columns: ScheduleTimelineColumns,
        row: readonly string[],
        delta: 1 | -1,
    ): boolean {
        if (this.isEmptyRow(row)) return false;

        let changed = false;
        if (columns.beginIndex !== -1) {
            changed = this.applyScheduleValueDelta(tableName, 'begin', row[columns.beginIndex] ?? '', delta) || changed;
        }
        if (columns.endIndex !== -1) {
            changed = this.applyScheduleValueDelta(tableName, 'end', row[columns.endIndex] ?? '', delta) || changed;
        }
        return changed;
    }

    private applyScheduleValueDelta(tableName: string, kind: ScheduleKind, value: string, delta: 1 | -1): boolean {
        return delta === 1
            ? this.addScheduleValueToIndex(tableName, kind, value)
            : this.removeScheduleValueFromIndex(tableName, kind, value);
    }

    private addScheduleValueToIndex(tableName: string, kind: ScheduleKind, value: string): boolean {
        const normalized = normalizeScheduleDate(value);
        if (normalized === null) return false;

        const tableEntry = this.getOrCreateTableEntry(normalized, tableName);
        const rawValue = value.trim();
        if (kind === 'begin') {
            tableEntry.beginCount++;
            tableEntry.beginValueCounts.set(rawValue, (tableEntry.beginValueCounts.get(rawValue) ?? 0) + 1);
            tableEntry.beginValues.add(rawValue);
        } else {
            tableEntry.endCount++;
            tableEntry.endValueCounts.set(rawValue, (tableEntry.endValueCounts.get(rawValue) ?? 0) + 1);
            tableEntry.endValues.add(rawValue);
        }
        return true;
    }

    private removeScheduleValueFromIndex(tableName: string, kind: ScheduleKind, value: string): boolean {
        const normalized = normalizeScheduleDate(value);
        if (normalized === null) return false;

        const group = this.dateGroups.get(normalized.date);
        const tableEntry = group?.tables.get(tableName);
        if (group === undefined || tableEntry === undefined) return false;

        const rawValue = value.trim();
        if (kind === 'begin') {
            if (!this.decrementValueCount(tableEntry.beginValueCounts, tableEntry.beginValues, rawValue)) return false;
            tableEntry.beginCount = Math.max(0, tableEntry.beginCount - 1);
        } else {
            if (!this.decrementValueCount(tableEntry.endValueCounts, tableEntry.endValues, rawValue)) return false;
            tableEntry.endCount = Math.max(0, tableEntry.endCount - 1);
        }

        this.removeEmptyTableEntry(group, normalized.date, tableName, tableEntry);
        return true;
    }

    private decrementValueCount(counts: Map<string, number>, values: Set<string>, value: string): boolean {
        const count = counts.get(value);
        if (count === undefined) return false;
        if (count <= 1) {
            counts.delete(value);
            values.delete(value);
        } else {
            counts.set(value, count - 1);
        }
        return true;
    }

    private getOrCreateTableEntry(normalized: { date: string; sortTime: number }, tableName: string): ScheduleTimelineTableEntry {
        let group = this.dateGroups.get(normalized.date);
        if (group === undefined) {
            group = {date: normalized.date, sortTime: normalized.sortTime, tables: new Map()};
            this.dateGroups.set(normalized.date, group);
        }
        let tableEntry = group.tables.get(tableName);
        if (tableEntry === undefined) {
            tableEntry = {
                tableName,
                beginValues: new Set(),
                endValues: new Set(),
                beginValueCounts: new Map(),
                endValueCounts: new Map(),
                beginCount: 0,
                endCount: 0,
            };
            group.tables.set(tableName, tableEntry);
        }
        let dateKeys = this.tableDateKeys.get(tableName);
        if (dateKeys === undefined) {
            dateKeys = new Set<string>();
            this.tableDateKeys.set(tableName, dateKeys);
        }
        dateKeys.add(normalized.date);
        return tableEntry;
    }

    private removeEmptyTableEntry(
        group: ScheduleTimelineDateGroup,
        date: string,
        tableName: string,
        tableEntry: ScheduleTimelineTableEntry,
    ): void {
        if (tableEntry.beginCount > 0 || tableEntry.endCount > 0) return;

        group.tables.delete(tableName);
        const dateKeys = this.tableDateKeys.get(tableName);
        if (dateKeys !== undefined) {
            dateKeys.delete(date);
            if (dateKeys.size === 0) this.tableDateKeys.delete(tableName);
        }
        if (group.tables.size === 0) this.dateGroups.delete(date);
    }

    private removeTableFromDateIndex(tableName: string): boolean {
        const dateKeys = this.tableDateKeys.get(tableName);
        if (dateKeys === undefined || dateKeys.size === 0) return false;

        for (const date of dateKeys) {
            const group = this.dateGroups.get(date);
            if (group === undefined) continue;
            group.tables.delete(tableName);
            if (group.tables.size === 0) this.dateGroups.delete(date);
        }
        this.tableDateKeys.delete(tableName);
        return true;
    }

    private getSortedGroups(): ScheduleTimelineDateGroup[] {
        return Array.from(this.dateGroups.values()).sort((left, right) => {
            if (left.sortTime !== right.sortTime) return left.sortTime - right.sortTime;
            return left.date.localeCompare(right.date);
        });
    }

    private getTableIndexSignature(tableName: string): string {
        const dateKeys = this.tableDateKeys.get(tableName);
        if (dateKeys === undefined || dateKeys.size === 0) return '';

        const parts: string[] = [];
        for (const date of Array.from(dateKeys).sort((left, right) => left.localeCompare(right))) {
            const tableEntry = this.dateGroups.get(date)?.tables.get(tableName);
            if (tableEntry === undefined) continue;
            parts.push([
                date,
                tableEntry.beginCount,
                this.valueCountsSignature(tableEntry.beginValueCounts),
                tableEntry.endCount,
                this.valueCountsSignature(tableEntry.endValueCounts),
            ].join('\t'));
        }
        return parts.join('\n');
    }

    private valueCountsSignature(counts: Map<string, number>): string {
        return Array.from(counts.entries())
            .sort((left, right) => left[0].localeCompare(right[0]))
            .map(([value, count]) => `${value}:${count}`)
            .join('|');
    }

    private scheduleRender(): void {
        if (this.renderScheduled) return;
        this.renderScheduled = true;
        window.requestAnimationFrame(() => {
            this.renderScheduled = false;
            if (!this.isVisible()) return;
            this.renderGroups(this.getSortedGroups(), this.getCurrentScrollPosition());
        });
    }

    private renderGroups(groups: ScheduleTimelineDateGroup[], scrollToRestore: UiScrollPosition = this.getCurrentScrollPosition()): void {
        this.contentElement.replaceChildren();
        if (groups.length === 0) {
            this.renderMessage('予定日はありません');
            this.restoreScrollPosition(scrollToRestore);
            return;
        }
        for (const group of groups) {
            this.contentElement.appendChild(this.createGroupElement(group));
        }
        this.restoreScrollPosition(scrollToRestore);
    }

    private createGroupElement(group: ScheduleTimelineDateGroup): HTMLElement {
        const groupElement = document.createElement('div');
        groupElement.classList.add('schedule-timeline-group');
        groupElement.setAttribute('data-date', group.date);
        groupElement.setAttribute('role', 'group');

        const collapsed = this.collapsedDates.has(group.date);
        const itemsId = `schedule-timeline-items-${group.date.replaceAll(/[^a-zA-Z0-9_-]/g, '-')}`;

        const header = document.createElement('button');
        header.type = 'button';
        header.classList.add('schedule-timeline-group-header');
        header.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        header.setAttribute('aria-controls', itemsId);

        const chevron = document.createElement('span');
        chevron.classList.add('schedule-timeline-group-chevron');
        chevron.innerHTML = `<svg viewBox="0 0 16 16" width="10" height="10" fill="currentColor" aria-hidden="true"><path d="M5.7 13.7L5 13l4.6-4.6L5 3.7l.7-.7 5.3 5.4z"/></svg>`;

        const date = document.createElement('span');
        date.classList.add('schedule-timeline-group-date');
        date.textContent = group.date;

        const count = document.createElement('span');
        count.classList.add('schedule-timeline-group-count');
        count.textContent = `${this.getGroupTotalCount(group)} 件`;

        header.appendChild(chevron);
        header.appendChild(date);
        header.appendChild(count);
        header.addEventListener('click', () => {
            this.toggleGroup(groupElement, group.date);
        });

        const items = document.createElement('div');
        items.id = itemsId;
        items.classList.add('schedule-timeline-items');
        items.setAttribute('aria-hidden', collapsed ? 'true' : 'false');

        const tableEntries = Array.from(group.tables.values()).sort((left, right) => left.tableName.localeCompare(right.tableName));
        for (const tableEntry of tableEntries) {
            items.appendChild(this.createTableElement(tableEntry));
        }

        groupElement.appendChild(header);
        groupElement.appendChild(items);
        return groupElement;
    }

    private getGroupTotalCount(group: ScheduleTimelineDateGroup): number {
        let total = 0;
        for (const tableEntry of group.tables.values()) {
            total += tableEntry.beginCount + tableEntry.endCount;
        }
        return total;
    }

    private createTableElement(tableEntry: ScheduleTimelineTableEntry): HTMLElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.classList.add('schedule-timeline-table');
        button.setAttribute('data-table-name', tableEntry.tableName);
        button.setAttribute('role', 'listitem');

        const name = document.createElement('span');
        name.classList.add('schedule-timeline-table-name');
        name.textContent = tableEntry.tableName;
        button.appendChild(name);

        const meta = document.createElement('span');
        meta.classList.add('schedule-timeline-table-meta');
        if (tableEntry.beginCount > 0) meta.appendChild(this.createBadge(`出力 ${tableEntry.beginCount}`, 'schedule-timeline-badge--begin'));
        if (tableEntry.endCount > 0) meta.appendChild(this.createBadge(`削除 ${tableEntry.endCount}`, 'schedule-timeline-badge--end'));
        button.appendChild(meta);

        button.addEventListener('click', () => {
            this.selectTableElement(button);
            this.onNavigate(tableEntry.tableName, this.createFilters(tableEntry), 'or');
        });

        return button;
    }

    private createBadge(text: string, className: string): HTMLElement {
        const badge = document.createElement('span');
        badge.classList.add('schedule-timeline-badge', className);
        badge.textContent = text;
        return badge;
    }

    private createFilters(tableEntry: ScheduleTimelineTableEntry): SerializedFilters {
        const settings = getAppliedSettings();
        const filters: SerializedFilters = {};
        const beginColumnName = settings.exportBeginDateColumnName.trim();
        const endColumnName = settings.exportEndDateColumnName.trim();
        if (beginColumnName !== '' && tableEntry.beginValues.size > 0) {
            filters[beginColumnName] = Array.from(tableEntry.beginValues);
        }
        if (endColumnName !== '' && tableEntry.endValues.size > 0) {
            const existing = filters[endColumnName] ?? [];
            filters[endColumnName] = Array.from(new Set([...existing, ...tableEntry.endValues]));
        }
        return filters;
    }

    private toggleGroup(groupElement: HTMLElement, date: string): void {
        const header = groupElement.querySelector<HTMLElement>('.schedule-timeline-group-header');
        const items = groupElement.querySelector<HTMLElement>('.schedule-timeline-items');
        if (header === null || items === null) return;
        const expanded = header.getAttribute('aria-expanded') === 'true';
        header.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        items.setAttribute('aria-hidden', expanded ? 'true' : 'false');
        if (expanded) {
            this.collapsedDates.add(date);
        } else {
            this.collapsedDates.delete(date);
        }
        this.saveCollapsedDates();
    }

    private getCurrentScrollPosition(): UiScrollPosition {
        return {
            scrollLeft: this.element.scrollLeft,
            scrollTop: this.element.scrollTop,
        };
    }

    private restoreScrollPosition(position: UiScrollPosition): void {
        window.requestAnimationFrame(() => {
            this.element.scrollLeft = position.scrollLeft;
            this.element.scrollTop = position.scrollTop;
        });
    }

    private saveScrollPosition(): void {
        if (!this.isVisible()) return;
        const nextScrollPosition = this.getCurrentScrollPosition();
        if (
            nextScrollPosition.scrollLeft === this.scrollPosition.scrollLeft
            && nextScrollPosition.scrollTop === this.scrollPosition.scrollTop
        ) {
            return;
        }
        this.scrollPosition = nextScrollPosition;
        this.uiStateStore.setScheduleTimelineState({scroll: nextScrollPosition});
    }

    private saveCollapsedDates(): void {
        this.uiStateStore.setScheduleTimelineState({
            collapsedDates: Array.from(this.collapsedDates).sort((left, right) => left.localeCompare(right)),
        });
    }

    private selectTableElement(button: HTMLElement): void {
        const selected = this.contentElement.querySelectorAll('.schedule-timeline-table-selected');
        for (let i = 0; i < selected.length; i++) {
            selected[i].classList.remove('schedule-timeline-table-selected');
            selected[i].removeAttribute('aria-current');
        }
        button.classList.add('schedule-timeline-table-selected');
        button.setAttribute('aria-current', 'true');
    }

    private renderMessage(text: string): void {
        const message = document.createElement('div');
        message.classList.add('schedule-timeline-message');
        message.textContent = text;
        this.contentElement.replaceChildren(message);
    }

    private isEmptyRow(row: readonly string[]): boolean {
        return row.every(value => value === '');
    }
}

function normalizeScheduleDate(value: string): { date: string; sortTime: number } | null {
    const trimmed = value.trim();
    if (trimmed === '') return null;

    const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(trimmed);
    if (match !== null) {
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        const date = new Date(year, month - 1, day);
        if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
        return {
            date: `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`,
            sortTime: date.getTime(),
        };
    }

    const parsed = Date.parse(trimmed);
    if (!Number.isFinite(parsed)) return null;
    const date = new Date(parsed);
    return {
        date: `${String(date.getFullYear()).padStart(4, '0')}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
        sortTime: new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime(),
    };
}

function pad2(value: number): string {
    return String(value).padStart(2, '0');
}
