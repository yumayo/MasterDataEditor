import {readFileAsync, writeFileAsync} from "./api";
import {MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, DEFAULT_SIDEBAR_WIDTH} from "../core/constant";
import {UI_STATE_FILE} from "../config/userdata-path";

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

export interface UiTabsState {
    open: string[];
    active: string | null;
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
const MAX_STORED_TABS = 100;
export const DEFAULT_ACTIVITY_BAR_ORDER: UiActivityBarItem[] = ['files', 'references', 'search', 'bookmarks', 'erDiagram', 'sourceControl', 'history'];
const BOTTOM_PANEL_TABS: UiBottomPanelTab[] = ['problems', 'debug'];

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
    },
};

function cloneState(state: UiState): UiState {
    return {
        sidebar: {...state.sidebar},
        activityBar: {
            order: [...state.activityBar.order],
        },
        bottomPanel: {...state.bottomPanel},
        tabs: {
            open: [...state.tabs.open],
            active: state.tabs.active,
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

function normalizeTabs(value: unknown): UiTabsState {
    const record = asRecord(value);
    if (record === null) return cloneState(DEFAULT_UI_STATE).tabs;

    const open: string[] = [];
    if (Array.isArray(record['open'])) {
        for (const rawName of record['open']) {
            const name = normalizeTabName(rawName);
            if (name === null || open.includes(name)) continue;
            open.push(name);
            if (open.length >= MAX_STORED_TABS) break;
        }
    }

    const active = normalizeTabName(record['active']);
    return {
        open,
        active,
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
        const json = await readFileAsync(UI_STATE_FILE);
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

    setTabs(open: string[], active: string | false | null): void {
        const normalizedOpen: string[] = [];
        for (const rawName of open) {
            const name = normalizeTabName(rawName);
            if (name === null || normalizedOpen.includes(name)) continue;
            normalizedOpen.push(name);
            if (normalizedOpen.length >= MAX_STORED_TABS) break;
        }
        this.state.tabs.open = normalizedOpen;
        this.state.tabs.active = active === false ? null : normalizeTabName(active);
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
        writeFileAsync(UI_STATE_FILE, this.state)
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
