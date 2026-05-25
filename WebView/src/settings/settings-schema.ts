export type ThemeValue = 'dark' | 'light';
export type SettingValue = ThemeValue | boolean | string | number;
export type SettingValueType = 'select' | 'boolean' | 'string' | 'number';
export type SettingControlKind = 'select' | 'toggle' | 'dateTime' | 'text' | 'number';
export type SettingRowElementName = 'div' | 'label';
export type SettingsRuntimeGroup = 'exportValidation' | 'largeFile';

export const SETTINGS_CHANGED_EVENT = 'settings-changed';

export const SETTING_SECTIONS = [
    {id: 'display', label: '表示'},
    {id: 'largeFile', label: '巨大ファイル'},
    {id: 'exportValidation', label: '出力フィルター'},
] as const;

export type SettingSectionId = typeof SETTING_SECTIONS[number]['id'];

export interface SettingOption<T extends SettingValue> {
    readonly value: T;
    readonly label: string;
}

interface SettingRuntimeMapping {
    readonly group: SettingsRuntimeGroup;
    readonly property: string;
}

interface SettingDefinition<T extends SettingValue> {
    readonly label: string;
    readonly type: SettingValueType;
    readonly defaultValue: T;
    readonly section: SettingSectionId;
    readonly control: SettingControlKind;
    readonly rowElement?: SettingRowElementName;
    readonly rootClassNames?: readonly string[];
    readonly inputClassNames?: readonly string[];
    readonly options?: readonly SettingOption<T>[];
    readonly runtime?: SettingRuntimeMapping;
    readonly min?: number;
    readonly max?: number;
    readonly step?: number;
}

function defineSetting<T extends SettingValue>(definition: SettingDefinition<T>): SettingDefinition<T> {
    return definition;
}

export const SETTING_DEFINITIONS = {
    // 新しい永続設定はここにメタデータを追加すると、読み書き・差分判定・リセット・UI生成対象に入る。
    theme: defineSetting<ThemeValue>({
        label: 'テーマ',
        type: 'select',
        defaultValue: 'dark',
        section: 'display',
        control: 'select',
        options: [
            {value: 'dark', label: 'ダーク'},
            {value: 'light', label: 'ライト'},
        ],
    }),
    tabWrapEnabled: defineSetting<boolean>({
        label: 'タブを折り返す',
        type: 'boolean',
        defaultValue: false,
        section: 'display',
        control: 'toggle',
        rootClassNames: ['settings-tab-wrap-toggle'],
        inputClassNames: ['settings-tab-wrap-checkbox'],
    }),
    referenceJumpTemporaryFilterEnabled: defineSetting<boolean>({
        label: 'ジャンプ時フィルター',
        type: 'boolean',
        defaultValue: false,
        section: 'display',
        control: 'toggle',
        rootClassNames: ['settings-reference-jump-temporary-filter-toggle'],
        inputClassNames: ['settings-reference-jump-temporary-filter-checkbox'],
    }),
    largeFileEagerDataPreloadBytes: defineSetting<number>({
        label: '起動時プリロード上限(bytes)',
        type: 'number',
        defaultValue: 1024 * 1024,
        section: 'largeFile',
        control: 'number',
        inputClassNames: ['settings-large-file-eager-data-preload-bytes-input'],
        runtime: {group: 'largeFile', property: 'eagerDataPreloadBytes'},
        min: 0,
        step: 1,
    }),
    largeFileEagerValidationCsvBytes: defineSetting<number>({
        label: '起動時検証CSV上限(bytes)',
        type: 'number',
        defaultValue: 2 * 1024 * 1024,
        section: 'largeFile',
        control: 'number',
        inputClassNames: ['settings-large-file-eager-validation-csv-bytes-input'],
        runtime: {group: 'largeFile', property: 'eagerValidationCsvBytes'},
        min: 0,
        step: 1,
    }),
    largeFileAutomaticValidationRows: defineSetting<number>({
        label: '自動バリデーション行数上限',
        type: 'number',
        defaultValue: 100000,
        section: 'largeFile',
        control: 'number',
        inputClassNames: ['settings-large-file-automatic-validation-rows-input'],
        runtime: {group: 'largeFile', property: 'automaticValidationRows'},
        min: 0,
        step: 1,
    }),
    largeFilePluginValidationRows: defineSetting<number>({
        label: 'プラグイン検証行数上限',
        type: 'number',
        defaultValue: 100000,
        section: 'largeFile',
        control: 'number',
        inputClassNames: ['settings-large-file-plugin-validation-rows-input'],
        runtime: {group: 'largeFile', property: 'pluginValidationRows'},
        min: 0,
        step: 1,
    }),
    largeFileGitDiffMarkerRows: defineSetting<number>({
        label: 'Git差分マーカー行数上限',
        type: 'number',
        defaultValue: 100000,
        section: 'largeFile',
        control: 'number',
        inputClassNames: ['settings-large-file-git-diff-marker-rows-input'],
        runtime: {group: 'largeFile', property: 'gitDiffMarkerRows'},
        min: 0,
        step: 1,
    }),
    largeFileScrollbarMarkerScanRows: defineSetting<number>({
        label: 'スクロールバーマーカー行数上限',
        type: 'number',
        defaultValue: 100000,
        section: 'largeFile',
        control: 'number',
        inputClassNames: ['settings-large-file-scrollbar-marker-scan-rows-input'],
        runtime: {group: 'largeFile', property: 'scrollbarMarkerScanRows'},
        min: 0,
        step: 1,
    }),
    exportValidationDateTime: defineSetting<string>({
        label: '出力フィルター時刻',
        type: 'string',
        defaultValue: '',
        section: 'exportValidation',
        control: 'dateTime',
        rowElement: 'label',
        rootClassNames: ['settings-export-validation-date-time-picker'],
        inputClassNames: ['settings-export-validation-datetime-input'],
        runtime: {group: 'exportValidation', property: 'dateTime'},
    }),
    exportBeginDateColumnName: defineSetting<string>({
        label: '開始日時列',
        type: 'string',
        defaultValue: 'export_begin_date',
        section: 'exportValidation',
        control: 'text',
        rowElement: 'label',
        inputClassNames: ['settings-export-begin-date-column-input'],
        runtime: {group: 'exportValidation', property: 'beginColumnName'},
    }),
    exportEndDateColumnName: defineSetting<string>({
        label: '終了日時列',
        type: 'string',
        defaultValue: 'export_end_date',
        section: 'exportValidation',
        control: 'text',
        rowElement: 'label',
        inputClassNames: ['settings-export-end-date-column-input'],
        runtime: {group: 'exportValidation', property: 'endColumnName'},
    }),
};

type SettingDefinitions = typeof SETTING_DEFINITIONS;
export type SettingsKey = keyof SettingDefinitions;
export type SettingValueFor<TKey extends SettingsKey> = SettingDefinitions[TKey] extends SettingDefinition<infer TValue> ? TValue : never;

export type SettingsValues = {
    [TKey in SettingsKey]: SettingValueFor<TKey> | null;
};

export type DefaultedSettingsValues = {
    [TKey in SettingsKey]: SettingValueFor<TKey>;
};

export type AppliedSettings = DefaultedSettingsValues;

export interface SettingsChangedEventDetail {
    settings: AppliedSettings;
    changedKeys: readonly SettingsKey[];
}

export type SettingsFile = Partial<Record<SettingsKey, SettingValue>>;

export interface ExportValidationSettings {
    dateTime: string;
    beginColumnName: string;
    endColumnName: string;
}

export interface LargeFileSettings {
    eagerDataPreloadBytes: number;
    eagerValidationCsvBytes: number;
    automaticValidationRows: number;
    pluginValidationRows: number;
    gitDiffMarkerRows: number;
    scrollbarMarkerScanRows: number;
}

export const SETTING_KEYS = Object.keys(SETTING_DEFINITIONS) as SettingsKey[];

export function getApplicationDefaultValue<TKey extends SettingsKey>(key: TKey): DefaultedSettingsValues[TKey] {
    return SETTING_DEFINITIONS[key].defaultValue as DefaultedSettingsValues[TKey];
}

export function getSettingLabel(key: SettingsKey): string {
    return SETTING_DEFINITIONS[key].label;
}

export function getSettingOptions<TKey extends SettingsKey>(key: TKey): readonly SettingOption<SettingValueFor<TKey>>[] {
    const options = SETTING_DEFINITIONS[key].options;
    if (options === undefined) throw new Error(`[SettingsPanel] ${key} does not have options`);
    return options as readonly SettingOption<SettingValueFor<TKey>>[];
}

export function getSettingOptionLabel<TKey extends SettingsKey>(key: TKey, value: SettingValueFor<TKey>): string {
    return getSettingOptions(key).find(option => option.value === value)?.label ?? String(value);
}

export function createApplicationDefaultSettings(): DefaultedSettingsValues {
    const defaultSettings = {} as DefaultedSettingsValues;
    for (const key of SETTING_KEYS) {
        defaultSettings[key] = getApplicationDefaultValue(key) as never;
    }
    return defaultSettings;
}

export function getDefaultedSettingValue<TKey extends SettingsKey>(
    settings: DefaultedSettingsValues,
    key: TKey,
): DefaultedSettingsValues[TKey] {
    return settings[key];
}

export function normalizeNumberSettingValue<TKey extends SettingsKey>(key: TKey, value: number): number {
    const definition = SETTING_DEFINITIONS[key];
    if (definition.type !== 'number') throw new Error(`[Settings] ${String(key)} is not a number setting`);
    let normalized = Number.isFinite(value) ? Math.trunc(value) : Number(definition.defaultValue);
    if (definition.min !== undefined) normalized = Math.max(definition.min, normalized);
    if (definition.max !== undefined) normalized = Math.min(definition.max, normalized);
    return normalized;
}

export function isSettingKey(value: string): value is SettingsKey {
    return SETTING_KEYS.includes(value as SettingsKey);
}

export function getSettingsKeysForRuntimeGroup(group: SettingsRuntimeGroup): SettingsKey[] {
    return SETTING_KEYS.filter(key => SETTING_DEFINITIONS[key].runtime?.group === group);
}

export function hasRuntimeGroupSettingsChange(group: SettingsRuntimeGroup, changedKeys: readonly SettingsKey[]): boolean {
    const groupKeys = getSettingsKeysForRuntimeGroup(group);
    return changedKeys.some(key => groupKeys.includes(key));
}

function getRuntimeSettingsValue(settings: AppliedSettings, group: SettingsRuntimeGroup, property: string): SettingValue {
    const key = SETTING_KEYS.find(settingKey => {
        const runtime = SETTING_DEFINITIONS[settingKey].runtime;
        return runtime?.group === group && runtime.property === property;
    });
    if (key === undefined) throw new Error(`[Settings] runtime mapping not found: ${group}.${property}`);
    return settings[key] as SettingValue;
}

export function createExportValidationSettings(settings: AppliedSettings): ExportValidationSettings {
    return {
        dateTime: String(getRuntimeSettingsValue(settings, 'exportValidation', 'dateTime')),
        beginColumnName: String(getRuntimeSettingsValue(settings, 'exportValidation', 'beginColumnName')),
        endColumnName: String(getRuntimeSettingsValue(settings, 'exportValidation', 'endColumnName')),
    };
}

export function createLargeFileSettings(settings: AppliedSettings): LargeFileSettings {
    return {
        eagerDataPreloadBytes: Number(getRuntimeSettingsValue(settings, 'largeFile', 'eagerDataPreloadBytes')),
        eagerValidationCsvBytes: Number(getRuntimeSettingsValue(settings, 'largeFile', 'eagerValidationCsvBytes')),
        automaticValidationRows: Number(getRuntimeSettingsValue(settings, 'largeFile', 'automaticValidationRows')),
        pluginValidationRows: Number(getRuntimeSettingsValue(settings, 'largeFile', 'pluginValidationRows')),
        gitDiffMarkerRows: Number(getRuntimeSettingsValue(settings, 'largeFile', 'gitDiffMarkerRows')),
        scrollbarMarkerScanRows: Number(getRuntimeSettingsValue(settings, 'largeFile', 'scrollbarMarkerScanRows')),
    };
}
