import {readFileAsync, writeFileAsync} from './api';
import {TABLE_VIEW_SETTINGS_FILE, TABLE_VIEW_SETTINGS_FILE_OPTIONS} from '../config/masterdataeditor-path';
import type {SerializedSortKey} from '../editor/column-sorter';
import type {SerializedFilters} from '../editor/column-filter';
import type {NotificationToast} from '../ui/notification';

export interface TableViewSettings {
    frozenColumnCount: number;
    frozenRightColumnCount: number;
    frozenRowCount: number;
    sortKeys: SerializedSortKey[];
    filters: SerializedFilters;
}

interface TableViewSettingsState {
    tables: Record<string, TableViewSettings>;
}

let cachedStatePromise: Promise<TableViewSettingsState> | false = false;
let pendingWrite: Promise<void> = Promise.resolve();

function requireRecord(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('テーブル表示設定の形式が不正です');
    return value as Record<string, unknown>;
}

function parseTableViewSettings(value: unknown): TableViewSettings {
    const record = requireRecord(value);
    const frozenColumnCount = record['frozenColumnCount'];
    const frozenRowCount = record['frozenRowCount'];
    // 右固定が追加される前に保存したユーザー設定は未固定として移行する。
    const frozenRightColumnCount = Object.hasOwn(record, 'frozenRightColumnCount') ? record['frozenRightColumnCount'] : 0;
    if (typeof frozenColumnCount !== 'number' || !Number.isSafeInteger(frozenColumnCount) || frozenColumnCount < 0
        || typeof frozenRightColumnCount !== 'number' || !Number.isSafeInteger(frozenRightColumnCount) || frozenRightColumnCount < 0
        || typeof frozenRowCount !== 'number' || !Number.isSafeInteger(frozenRowCount) || frozenRowCount < 0) {
        throw new Error('テーブル表示設定の固定列数・固定行数が不正です');
    }
    if (!Array.isArray(record['sortKeys'])) throw new Error('テーブル表示設定のソートキーが不正です');
    const sortKeys: SerializedSortKey[] = record['sortKeys'].map((value: unknown) => {
        const key = requireRecord(value);
        const columnName = key['columnName'];
        const direction = key['direction'];
        if (typeof columnName !== 'string' || (direction !== 'asc' && direction !== 'desc')) throw new Error('テーブル表示設定のソートキーが不正です');
        return {columnName, direction};
    });
    const filters: SerializedFilters = Object.fromEntries(Object.entries(requireRecord(record['filters'])).map(([columnName, values]) => {
        if (!Array.isArray(values) || !values.every((value: unknown) => typeof value === 'string')) throw new Error('テーブル表示設定のフィルターが不正です');
        return [columnName, [...values]];
    }));
    return {frozenColumnCount, frozenRightColumnCount, frozenRowCount, sortKeys, filters};
}

async function readTableViewSettingsStateAsync(): Promise<TableViewSettingsState> {
    if (cachedStatePromise !== false) return cachedStatePromise;
    cachedStatePromise = readFileAsync(TABLE_VIEW_SETTINGS_FILE, TABLE_VIEW_SETTINGS_FILE_OPTIONS).then((text) => {
        // 実バックエンドは未作成のファイルを空文字列として返す。
        if (text === '') return {tables: {}};
        const record = requireRecord(JSON.parse(text) as unknown);
        const tables = Object.fromEntries(Object.entries(requireRecord(record['tables'])).map(([name, settings]) => [name, parseTableViewSettings(settings)]));
        return {tables};
    }).catch((error: unknown) => {
        // ファイル未作成だけを許容し、読込失敗・破損を空設定として上書きしない。
        if (error instanceof Error && error.message === `File not found: user:${TABLE_VIEW_SETTINGS_FILE}`) return {tables: {}};
        cachedStatePromise = false;
        throw error;
    });
    return cachedStatePromise;
}

/** ユーザー設定を優先し、未移行のテーブルだけ旧スキーマから初期値を引き継ぐ。 */
export async function loadTableViewSettingsForTableAsync(tableName: string, schema: Record<string, unknown>, notification: NotificationToast): Promise<TableViewSettings> {
    const state = await readTableViewSettingsStateAsync();
    if (Object.hasOwn(state.tables, tableName)) return structuredClone(state.tables[tableName]);
    const defaults: TableViewSettings = {frozenColumnCount: 0, frozenRightColumnCount: 0, frozenRowCount: 0, sortKeys: [], filters: {}};
    const legacyEntries = Object.keys(defaults).filter(key => Object.hasOwn(schema, key)).map(key => [key, schema[key]]);
    if (legacyEntries.length === 0) return defaults;
    const settings = parseTableViewSettings({...defaults, ...Object.fromEntries(legacyEntries)});
    try {
        await saveTableViewSettingsForTableAsync(tableName, settings);
    } catch (error: unknown) {
        // 移行先の書き込みだけが失敗した場合は、読み取れた設定で編集を開始できる。
        notification.showError(error, 'テーブル表示設定の移行に失敗しました');
    }
    return settings;
}

/** 解除状態も明示的に保存し、別テーブルの変更や古い保存の完了で設定を失わない。 */
export async function saveTableViewSettingsForTableAsync(tableName: string, settings: TableViewSettings): Promise<void> {
    const snapshot = structuredClone(settings);
    const state = await readTableViewSettingsStateAsync();
    state.tables = {...state.tables, [tableName]: snapshot};
    const serialized = structuredClone(state);
    // 失敗した要求は呼び出し元が通知する。次の保存要求は続行して再試行できる。
    const write = pendingWrite.catch(() => {}).then(() => writeFileAsync(TABLE_VIEW_SETTINGS_FILE, serialized, TABLE_VIEW_SETTINGS_FILE_OPTIONS));
    pendingWrite = write;
    await write;
}
