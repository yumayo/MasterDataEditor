import {findFilesAsync, readFileAsync} from "../app/api";
import {Csv} from "../data/csv";
import type {InMemoryTableStore} from "../data/in-memory-table-store";
import type {EditorTable} from "../editor/editor-table";
import type {SerializedFilters, TemporaryFilterMode} from "../editor/column-filter";
import {getAppliedSettings} from "./settings-panel";
import {SETTINGS_CHANGED_EVENT} from "../settings/settings-schema";

type ScheduleKind = 'begin' | 'end';

interface ScheduleTimelineTableData {
    header: string[];
    rows: string[][];
}

interface ScheduleTimelineTableEntry {
    tableName: string;
    beginValues: Set<string>;
    endValues: Set<string>;
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
    private readonly collapsedDates = new Set<string>();
    private requestId = 0;

    constructor(store: InMemoryTableStore, openEditorTables: Map<string, EditorTable>, onNavigate: ScheduleTimelineNavigate) {
        this.store = store;
        this.openEditorTables = openEditorTables;
        this.onNavigate = onNavigate;

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

        window.addEventListener(SETTINGS_CHANGED_EVENT, () => {
            if (!this.isVisible()) return;
            this.refreshAsync().catch((e: unknown) => {
                console.error('[ScheduleTimelinePanel] refresh after settings change failed:', e);
            });
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
        this.renderMessage('読み込み中...');
        const groups = await this.collectGroupsAsync();
        if (currentRequestId !== this.requestId) return;
        this.renderGroups(groups);
    }

    private async collectGroupsAsync(): Promise<ScheduleTimelineDateGroup[]> {
        const settings = getAppliedSettings();
        const beginColumnName = settings.exportBeginDateColumnName.trim();
        const endColumnName = settings.exportEndDateColumnName.trim();
        if (beginColumnName === '' && endColumnName === '') return [];

        const tableNames = await this.loadTableNamesAsync();
        const groups = new Map<string, ScheduleTimelineDateGroup>();
        await Promise.all(tableNames.map(async tableName => {
            const tableData = await this.loadTableDataAsync(tableName);
            if (tableData === null) return;
            this.collectTableDates(groups, tableName, tableData, beginColumnName, endColumnName);
        }));

        return Array.from(groups.values()).sort((left, right) => {
            if (left.sortTime !== right.sortTime) return left.sortTime - right.sortTime;
            return left.date.localeCompare(right.date);
        });
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
        if (this.openEditorTables.has(tableName)) {
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

    private collectTableDates(
        groups: Map<string, ScheduleTimelineDateGroup>,
        tableName: string,
        tableData: ScheduleTimelineTableData,
        beginColumnName: string,
        endColumnName: string,
    ): void {
        const beginIndex = beginColumnName === '' ? -1 : tableData.header.indexOf(beginColumnName);
        const endIndex = endColumnName === '' ? -1 : tableData.header.indexOf(endColumnName);
        if (beginIndex === -1 && endIndex === -1) return;

        for (const row of tableData.rows) {
            if (this.isEmptyRow(row)) continue;
            if (beginIndex !== -1) this.addDateValue(groups, tableName, 'begin', row[beginIndex] ?? '');
            if (endIndex !== -1) this.addDateValue(groups, tableName, 'end', row[endIndex] ?? '');
        }
    }

    private addDateValue(groups: Map<string, ScheduleTimelineDateGroup>, tableName: string, kind: ScheduleKind, value: string): void {
        const normalized = normalizeScheduleDate(value);
        if (normalized === null) return;
        let group = groups.get(normalized.date);
        if (group === undefined) {
            group = {date: normalized.date, sortTime: normalized.sortTime, tables: new Map()};
            groups.set(normalized.date, group);
        }
        let tableEntry = group.tables.get(tableName);
        if (tableEntry === undefined) {
            tableEntry = {
                tableName,
                beginValues: new Set(),
                endValues: new Set(),
                beginCount: 0,
                endCount: 0,
            };
            group.tables.set(tableName, tableEntry);
        }
        if (kind === 'begin') {
            tableEntry.beginValues.add(value.trim());
            tableEntry.beginCount++;
        } else {
            tableEntry.endValues.add(value.trim());
            tableEntry.endCount++;
        }
    }

    private renderGroups(groups: ScheduleTimelineDateGroup[]): void {
        this.contentElement.replaceChildren();
        if (groups.length === 0) {
            this.renderMessage('予定日はありません');
            return;
        }
        for (const group of groups) {
            this.contentElement.appendChild(this.createGroupElement(group));
        }
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
        count.textContent = `${group.tables.size} 件`;

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
