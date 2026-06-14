import {readFileAsync, writeFileAsync} from "./api";
import {COLUMN_WIDTHS_FILE, COLUMN_WIDTHS_FILE_OPTIONS} from "../config/masterdataeditor-path";

export interface ColumnWidthEntry {
    name: string;
    width: number | string;
}

interface ColumnWidthsState {
    tables: Record<string, Record<string, number>>;
}

const MAX_NAME_LENGTH = 512;
const MAX_COLUMN_WIDTH_PX = 100_000;

let cachedStatePromise: Promise<ColumnWidthsState> | null = null;

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function normalizeName(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const name = value.trim();
    if (name === '' || name.length > MAX_NAME_LENGTH) return null;
    return name;
}

function normalizeWidth(value: unknown): number | null {
    const raw = typeof value === 'number'
        ? value
        : typeof value === 'string'
            ? Number.parseFloat(value)
            : Number.NaN;
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return Math.min(MAX_COLUMN_WIDTH_PX, Math.max(1, Math.round(raw)));
}

function normalizeColumnMap(value: unknown): Record<string, number> {
    const record = asRecord(value);
    if (record === null) return {};

    const result: Record<string, number> = {};
    for (const [rawColumnName, rawWidth] of Object.entries(record)) {
        const columnName = normalizeName(rawColumnName);
        const width = normalizeWidth(rawWidth);
        if (columnName === null || width === null) continue;
        result[columnName] = width;
    }
    return result;
}

function normalizeState(value: unknown): ColumnWidthsState {
    const record = asRecord(value);
    const rawTables = record === null ? null : asRecord(record['tables']);
    if (rawTables === null) return {tables: {}};

    const tables: Record<string, Record<string, number>> = {};
    for (const [rawTableName, rawColumnMap] of Object.entries(rawTables)) {
        const tableName = normalizeName(rawTableName);
        if (tableName === null) continue;
        const columns = normalizeColumnMap(rawColumnMap);
        if (Object.keys(columns).length === 0) continue;
        tables[tableName] = columns;
    }
    return {tables};
}

function createSerializableState(state: ColumnWidthsState): ColumnWidthsState {
    const tables: Record<string, Record<string, number>> = {};
    for (const tableName of Object.keys(state.tables).sort((left, right) => left.localeCompare(right))) {
        const columns = state.tables[tableName];
        const serializableColumns: Record<string, number> = {};
        for (const columnName of Object.keys(columns).sort((left, right) => left.localeCompare(right))) {
            serializableColumns[columnName] = columns[columnName];
        }
        if (Object.keys(serializableColumns).length > 0) tables[tableName] = serializableColumns;
    }
    return {tables};
}

async function readColumnWidthsStateAsync(): Promise<ColumnWidthsState> {
    if (cachedStatePromise !== null) return cachedStatePromise;

    cachedStatePromise = readFileAsync(COLUMN_WIDTHS_FILE, COLUMN_WIDTHS_FILE_OPTIONS)
        .then((text) => normalizeState(JSON.parse(text) as unknown))
        .catch(() => ({tables: {}}));
    return cachedStatePromise;
}

export async function applyStoredColumnWidthsToSchemaAsync(tableName: string, schema: Record<string, unknown>): Promise<Record<string, unknown>> {
    const state = await readColumnWidthsStateAsync();
    const tableWidths = state.tables[tableName];
    if (tableWidths === undefined || Object.keys(tableWidths).length === 0) return schema;

    const header = schema['header'];
    if (!Array.isArray(header)) return schema;

    let changed = false;
    const nextHeader = header.map((rawColumn) => {
        const column = asRecord(rawColumn);
        if (column === null || typeof column['name'] !== 'string') return rawColumn;
        const width = tableWidths[column['name']];
        if (width === undefined) return rawColumn;
        changed = true;
        return {...column, width};
    });

    return changed ? {...schema, header: nextHeader} : schema;
}

export async function saveColumnWidthsForTableAsync(tableName: string, entries: readonly ColumnWidthEntry[]): Promise<void> {
    const normalizedTableName = normalizeName(tableName);
    if (normalizedTableName === null) return;

    const columns: Record<string, number> = {};
    for (const entry of entries) {
        const columnName = normalizeName(entry.name);
        const width = normalizeWidth(entry.width);
        if (columnName === null || width === null) continue;
        columns[columnName] = width;
    }
    if (Object.keys(columns).length === 0) return;

    const state = await readColumnWidthsStateAsync();
    state.tables[normalizedTableName] = columns;
    await writeFileAsync(COLUMN_WIDTHS_FILE, createSerializableState(state), COLUMN_WIDTHS_FILE_OPTIONS);
}
