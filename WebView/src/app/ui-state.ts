import {readFileAsync, writeFileAsync} from "./api";
import {MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, DEFAULT_SIDEBAR_WIDTH} from "../core/constant";
import {UI_STATE_FILE, UI_STATE_FILE_OPTIONS} from "../config/masterdataeditor-path";

export type UiActivityBarItem = 'files' | 'references' | 'search' | 'bookmarks' | 'erDiagram' | 'sourceControl' | 'history';
export type UiBottomPanelTab = 'problems' | 'debug';

export interface UiSidebarState {
    width: number;
    activePanel: UiActivityBarItem;
}

export interface UiBottomPanelState {
    visible: boolean;
    height: number;
    activeTab: UiBottomPanelTab;
}

export interface UiScrollPosition {
    scrollLeft: number;
    scrollTop: number;
}

export interface UiCellPosition {
    row: number;
    column: number;
}

export interface UiCellRange {
    startRow: number;
    startColumn: number;
    endRow: number;
    endColumn: number;
}

export interface UiStoredSelectionState {
    focus: UiCellPosition;
    range: UiCellRange;
}

export interface UiStoredFormPanelNavEntry {
    tableName: string;
    pkValue: string;
    label: string;
    storeRowIndex?: number;
}

export interface UiStoredFormPanelState {
    navStack: UiStoredFormPanelNavEntry[];
}

export interface UiStoredEditorTableState {
    scroll: UiScrollPosition;
    relationsPanelVisible: boolean;
    formPanel: UiStoredFormPanelState | null;
    selection: UiStoredSelectionState;
}

export interface UiStoredTab {
    name: string;
    description: string | null;
    pinned: boolean;
    diff: UiStoredDiffTab | null;
    scroll: UiScrollPosition | null;
    editorTable: UiStoredEditorTableState | null;
}

export interface UiStoredDiffTab {
    tableName: string;
    gitPath: string;
    isStaged: boolean;
    isNew: boolean;
}

export interface UiTabsState {
    open: UiStoredTab[];
    active: string | null;
    scroll: UiScrollPosition;
}

export interface UiActivityBarState {
    order: UiActivityBarItem[];
}

export interface UiState {
    sidebar: UiSidebarState;
    activityBar: UiActivityBarState;
    bottomPanel: UiBottomPanelState;
    tabs: UiTabsState;
}

const DEFAULT_BOTTOM_PANEL_HEIGHT = 300;
const MIN_BOTTOM_PANEL_HEIGHT = 80;
const MAX_TAB_NAME_LENGTH = 256;
const MAX_TAB_DESCRIPTION_LENGTH = 512;
const MAX_STORED_TABS = 100;
const MAX_FORM_PANEL_NAV_STACK = 20;
const MAX_FORM_PANEL_LABEL_LENGTH = 512;
const MAX_SCROLL_POSITION = 1_000_000_000;
const MAX_CELL_INDEX = 1_000_000;
export const DEFAULT_ACTIVITY_BAR_ORDER: UiActivityBarItem[] = ['files', 'references', 'search', 'bookmarks', 'erDiagram', 'sourceControl', 'history'];
const BOTTOM_PANEL_TABS: UiBottomPanelTab[] = ['problems', 'debug'];
const DEFAULT_SCROLL_POSITION: UiScrollPosition = {scrollLeft: 0, scrollTop: 0};
const DEFAULT_SELECTION_STATE: UiStoredSelectionState = {
    focus: {row: 1, column: 1},
    range: {startRow: 1, startColumn: 1, endRow: 1, endColumn: 1},
};

const DEFAULT_UI_STATE: UiState = {
    sidebar: {
        width: DEFAULT_SIDEBAR_WIDTH,
        activePanel: 'files',
    },
    activityBar: {
        order: [...DEFAULT_ACTIVITY_BAR_ORDER],
    },
    bottomPanel: {
        visible: false,
        height: DEFAULT_BOTTOM_PANEL_HEIGHT,
        activeTab: 'problems',
    },
    tabs: {
        open: [],
        active: null,
        scroll: {...DEFAULT_SCROLL_POSITION},
    },
};

function cloneScrollPosition(position: UiScrollPosition): UiScrollPosition {
    return {
        scrollLeft: position.scrollLeft,
        scrollTop: position.scrollTop,
    };
}

function cloneCellPosition(position: UiCellPosition): UiCellPosition {
    return {
        row: position.row,
        column: position.column,
    };
}

function cloneCellRange(range: UiCellRange): UiCellRange {
    return {
        startRow: range.startRow,
        startColumn: range.startColumn,
        endRow: range.endRow,
        endColumn: range.endColumn,
    };
}

function cloneSelectionState(selection: UiStoredSelectionState): UiStoredSelectionState {
    return {
        focus: cloneCellPosition(selection.focus),
        range: cloneCellRange(selection.range),
    };
}

function cloneFormPanelState(state: UiStoredFormPanelState): UiStoredFormPanelState {
    return {
        navStack: state.navStack.map(page => ({...page})),
    };
}

function cloneEditorTableState(state: UiStoredEditorTableState): UiStoredEditorTableState {
    return {
        scroll: cloneScrollPosition(state.scroll),
        relationsPanelVisible: state.relationsPanelVisible,
        formPanel: state.formPanel === null ? null : cloneFormPanelState(state.formPanel),
        selection: cloneSelectionState(state.selection),
    };
}

function cloneStoredDiffTab(diff: UiStoredDiffTab): UiStoredDiffTab {
    return {...diff};
}

function cloneStoredTab(tab: UiStoredTab): UiStoredTab {
    return {
        name: tab.name,
        description: tab.description,
        pinned: tab.pinned,
        diff: tab.diff === null ? null : cloneStoredDiffTab(tab.diff),
        scroll: tab.scroll === null ? null : cloneScrollPosition(tab.scroll),
        editorTable: tab.editorTable === null ? null : cloneEditorTableState(tab.editorTable),
    };
}

function cloneState(state: UiState): UiState {
    return {
        sidebar: {...state.sidebar},
        activityBar: {
            order: [...state.activityBar.order],
        },
        bottomPanel: {...state.bottomPanel},
        tabs: {
            open: state.tabs.open.map(tab => cloneStoredTab(tab)),
            active: state.tabs.active,
            scroll: cloneScrollPosition(state.tabs.scroll),
        },
    };
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizeActivityBarItem(value: unknown, fallback: UiActivityBarItem): UiActivityBarItem {
    return typeof value === 'string' && DEFAULT_ACTIVITY_BAR_ORDER.includes(value as UiActivityBarItem)
        ? value as UiActivityBarItem
        : fallback;
}

function isActivityBarItem(value: unknown): value is UiActivityBarItem {
    return typeof value === 'string' && DEFAULT_ACTIVITY_BAR_ORDER.includes(value as UiActivityBarItem);
}

export function normalizeActivityBarOrder(rawOrder: unknown): UiActivityBarItem[] {
    const result: UiActivityBarItem[] = [];
    if (Array.isArray(rawOrder)) {
        for (const item of rawOrder) {
            if (!isActivityBarItem(item) || result.includes(item)) continue;
            result.push(item);
        }
    }
    for (const item of DEFAULT_ACTIVITY_BAR_ORDER) {
        if (!result.includes(item)) result.push(item);
    }
    return result;
}

function normalizeBottomPanelTab(value: unknown, fallback: UiBottomPanelTab): UiBottomPanelTab {
    return typeof value === 'string' && BOTTOM_PANEL_TABS.includes(value as UiBottomPanelTab)
        ? value as UiBottomPanelTab
        : fallback;
}

function normalizeTabName(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const name = value.trim();
    if (name === '' || name.length > MAX_TAB_NAME_LENGTH) return null;
    return name;
}

function normalizeTabDescription(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    if (value === '' || value.length > MAX_TAB_DESCRIPTION_LENGTH) return null;
    return value;
}

function normalizeLimitedString(value: unknown, maxLength: number): string | null {
    if (typeof value !== 'string') return null;
    if (value === '' || value.length > maxLength) return null;
    return value;
}

function normalizeScrollPosition(value: unknown, fallback: UiScrollPosition = DEFAULT_SCROLL_POSITION): UiScrollPosition {
    const record = asRecord(value);
    if (record === null) return cloneScrollPosition(fallback);
    return {
        scrollLeft: clampNumber(record['scrollLeft'], 0, MAX_SCROLL_POSITION, fallback.scrollLeft),
        scrollTop: clampNumber(record['scrollTop'], 0, MAX_SCROLL_POSITION, fallback.scrollTop),
    };
}

function normalizeOptionalScrollPosition(value: unknown): UiScrollPosition | null {
    const record = asRecord(value);
    if (record === null) return null;
    return normalizeScrollPosition(record);
}

function normalizeCellPosition(value: unknown, fallback: UiCellPosition): UiCellPosition {
    const record = asRecord(value);
    if (record === null) return cloneCellPosition(fallback);
    return {
        row: clampNumber(record['row'], 1, MAX_CELL_INDEX, fallback.row),
        column: clampNumber(record['column'], 1, MAX_CELL_INDEX, fallback.column),
    };
}

function normalizeCellRange(value: unknown, fallback: UiCellRange): UiCellRange {
    const record = asRecord(value);
    if (record === null) return cloneCellRange(fallback);
    return {
        startRow: clampNumber(record['startRow'], 1, MAX_CELL_INDEX, fallback.startRow),
        startColumn: clampNumber(record['startColumn'], 1, MAX_CELL_INDEX, fallback.startColumn),
        endRow: clampNumber(record['endRow'], 1, MAX_CELL_INDEX, fallback.endRow),
        endColumn: clampNumber(record['endColumn'], 1, MAX_CELL_INDEX, fallback.endColumn),
    };
}

function normalizeSelectionState(value: unknown): UiStoredSelectionState {
    const record = asRecord(value);
    if (record === null) return cloneSelectionState(DEFAULT_SELECTION_STATE);
    return {
        focus: normalizeCellPosition(record['focus'], DEFAULT_SELECTION_STATE.focus),
        range: normalizeCellRange(record['range'], DEFAULT_SELECTION_STATE.range),
    };
}

function normalizeStoredFormPanelNavEntry(value: unknown): UiStoredFormPanelNavEntry | null {
    const record = asRecord(value);
    if (record === null) return null;
    const tableName = normalizeTabName(record['tableName']);
    const pkValue = normalizeLimitedString(record['pkValue'], MAX_TAB_NAME_LENGTH);
    if (tableName === null || pkValue === null) return null;
    const label = normalizeLimitedString(record['label'], MAX_FORM_PANEL_LABEL_LENGTH) ?? `${tableName} / ${pkValue}`;
    const storeRowIndex = clampNumber(record['storeRowIndex'], 0, MAX_CELL_INDEX, -1);
    return storeRowIndex >= 0
        ? {tableName, pkValue, label, storeRowIndex}
        : {tableName, pkValue, label};
}

function normalizeStoredFormPanelState(value: unknown): UiStoredFormPanelState | null {
    const record = asRecord(value);
    if (record === null) return null;
    if (!Array.isArray(record['navStack'])) return null;
    const navStack: UiStoredFormPanelNavEntry[] = [];
    for (const rawPage of record['navStack']) {
        const page = normalizeStoredFormPanelNavEntry(rawPage);
        if (page === null) continue;
        navStack.push(page);
        if (navStack.length >= MAX_FORM_PANEL_NAV_STACK) break;
    }
    return navStack.length > 0 ? {navStack} : null;
}

function normalizeStoredEditorTableState(value: unknown): UiStoredEditorTableState | null {
    const record = asRecord(value);
    if (record === null) return null;
    return {
        scroll: normalizeScrollPosition(record['scroll']),
        relationsPanelVisible: record['relationsPanelVisible'] === true,
        formPanel: normalizeStoredFormPanelState(record['formPanel']),
        selection: normalizeSelectionState(record['selection']),
    };
}

function normalizeStoredDiffTab(value: unknown): UiStoredDiffTab | null {
    const record = asRecord(value);
    if (record === null) return null;
    const tableName = normalizeTabName(record['tableName']);
    const gitPath = normalizeTabName(record['gitPath']);
    if (tableName === null || gitPath === null) return null;
    return {
        tableName,
        gitPath,
        isStaged: record['isStaged'] === true,
        isNew: record['isNew'] === true,
    };
}

function normalizeStoredTab(value: unknown): UiStoredTab | null {
    const record = asRecord(value);
    if (record === null) return null;
    const name = normalizeTabName(record['name']);
    if (name === null) return null;
    const editorTable = normalizeStoredEditorTableState(record['editorTable']);
    const scroll = normalizeOptionalScrollPosition(record['scroll']) ?? (editorTable === null ? null : cloneScrollPosition(editorTable.scroll));
    return {
        name,
        description: normalizeTabDescription(record['description']),
        pinned: record['pinned'] === true,
        diff: normalizeStoredDiffTab(record['diff']),
        scroll,
        editorTable,
    };
}

function normalizeTabs(value: unknown): UiTabsState {
    const record = asRecord(value);
    if (record === null) return cloneState(DEFAULT_UI_STATE).tabs;

    const open: UiStoredTab[] = [];
    if (Array.isArray(record['open'])) {
        for (const rawTab of record['open']) {
            const tab = normalizeStoredTab(rawTab);
            if (tab === null || open.some(item => item.name === tab.name)) continue;
            open.push(tab);
            if (open.length >= MAX_STORED_TABS) break;
        }
    }

    const active = normalizeTabName(record['active']);
    return {
        open,
        active,
        scroll: normalizeScrollPosition(record['scroll']),
    };
}

function normalizeUiState(value: unknown): UiState {
    const record = asRecord(value);
    if (record === null) return cloneState(DEFAULT_UI_STATE);

    const sidebar = asRecord(record['sidebar']);
    const activityBar = asRecord(record['activityBar']);
    const bottomPanel = asRecord(record['bottomPanel']);
    const defaults = DEFAULT_UI_STATE;

    return {
        sidebar: {
            width: clampNumber(sidebar?.['width'], MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH, defaults.sidebar.width),
            activePanel: normalizeActivityBarItem(sidebar?.['activePanel'], defaults.sidebar.activePanel),
        },
        activityBar: {
            order: normalizeActivityBarOrder(activityBar?.['order']),
        },
        bottomPanel: {
            visible: typeof bottomPanel?.['visible'] === 'boolean' ? bottomPanel['visible'] as boolean : defaults.bottomPanel.visible,
            height: clampNumber(bottomPanel?.['height'], MIN_BOTTOM_PANEL_HEIGHT, window.innerHeight, defaults.bottomPanel.height),
            activeTab: normalizeBottomPanelTab(bottomPanel?.['activeTab'], defaults.bottomPanel.activeTab),
        },
        tabs: normalizeTabs(record['tabs']),
    };
}

export async function readStoredUiStateAsync(): Promise<UiState> {
    try {
        const json = await readFileAsync(UI_STATE_FILE, UI_STATE_FILE_OPTIONS);
        return normalizeUiState(JSON.parse(json) as unknown);
    } catch {
        return cloneState(DEFAULT_UI_STATE);
    }
}

export class UiStateStore {
    private state: UiState;
    private persistTimer: number | false;
    private writeInFlight: boolean;
    private dirtyDuringWrite: boolean;

    constructor(initialState: UiState) {
        this.state = cloneState(initialState);
        this.persistTimer = false;
        this.writeInFlight = false;
        this.dirtyDuringWrite = false;
    }

    getState(): UiState {
        return cloneState(this.state);
    }

    setSidebarWidth(width: number): void {
        this.state.sidebar.width = clampNumber(width, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH, DEFAULT_SIDEBAR_WIDTH);
        this.schedulePersist();
    }

    setActiveActivityBarItem(item: UiActivityBarItem): void {
        this.state.sidebar.activePanel = item;
        this.schedulePersist();
    }

    setActivityBarOrder(order: UiActivityBarItem[]): void {
        this.state.activityBar.order = normalizeActivityBarOrder(order);
        this.schedulePersist();
    }

    setBottomPanelState(state: Partial<UiBottomPanelState>): void {
        if (state.visible !== undefined) {
            this.state.bottomPanel.visible = state.visible;
        }
        if (state.height !== undefined) {
            this.state.bottomPanel.height = clampNumber(state.height, MIN_BOTTOM_PANEL_HEIGHT, window.innerHeight, DEFAULT_BOTTOM_PANEL_HEIGHT);
        }
        if (state.activeTab !== undefined) {
            this.state.bottomPanel.activeTab = state.activeTab;
        }
        this.schedulePersist();
    }

    setTabs(open: UiStoredTab[], active: string | false | null, scroll: UiScrollPosition = this.state.tabs.scroll): void {
        const normalizedOpen: UiStoredTab[] = [];
        for (const rawTab of open) {
            const tab = normalizeStoredTab(rawTab);
            if (tab === null || normalizedOpen.some(item => item.name === tab.name)) continue;
            normalizedOpen.push(tab);
            if (normalizedOpen.length >= MAX_STORED_TABS) break;
        }
        this.state.tabs.open = normalizedOpen;
        this.state.tabs.active = active === false ? null : normalizeTabName(active);
        this.state.tabs.scroll = normalizeScrollPosition(scroll, this.state.tabs.scroll);
        this.schedulePersist();
    }

    private schedulePersist(): void {
        if (this.persistTimer !== false) {
            window.clearTimeout(this.persistTimer);
        }
        this.persistTimer = window.setTimeout(() => {
            this.persistTimer = false;
            this.persistNow();
        }, 100);
    }

    private persistNow(): void {
        if (this.writeInFlight) {
            this.dirtyDuringWrite = true;
            return;
        }

        this.writeInFlight = true;
        writeFileAsync(UI_STATE_FILE, this.state, UI_STATE_FILE_OPTIONS)
            .catch((error: unknown) => {
                console.error('[UiStateStore] save failed:', String(error));
            })
            .finally(() => {
                this.writeInFlight = false;
                if (this.dirtyDuringWrite) {
                    this.dirtyDuringWrite = false;
                    this.schedulePersist();
                }
            });
    }
}
