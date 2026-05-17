import {readFileAsync, writeFileAsync, type FileScope} from "../app/api";
import {TabButton} from "../tabs/tab-button";
import {USER_SETTINGS_FILE, WORKSPACE_SETTINGS_FILE} from "../config/masterdataeditor-path";
import {DateTimePicker, normalizeDateTimeInputToSeconds} from "../ui/date-time-picker";

/**
 * 設定画面パネル
 * User / Workspace スコープ別にテーマ・タブ折り返し・出力フィルター設定を提供する。
 * - change イベントで実効設定を即時更新し、自動的に現在のスコープへ保存する
 * - Ctrl+S による手動保存も引き続き動作する（冪等）
 */

type ThemeValue = 'dark' | 'light';
type SettingsScope = 'workspace' | 'user';

const DEFAULT_THEME: ThemeValue = 'dark';
const DEFAULT_TAB_WRAP_ENABLED = false;
const DEFAULT_EXPORT_VALIDATION_DATE_TIME = '';
const DEFAULT_EXPORT_BEGIN_DATE_COLUMN_NAME = 'export_begin_date';
const DEFAULT_EXPORT_END_DATE_COLUMN_NAME = 'export_end_date';
const TAB_WRAP_ENABLED_CSS_VAR = '--tab-wrap-enabled';
const TAB_WRAP_ENABLED_CHANGED_EVENT = 'tab-wrap-enabled-changed';
export const EXPORT_VALIDATION_SETTINGS_CHANGED_EVENT = 'export-validation-settings-changed';
const SETTINGS_SCOPE_OPTIONS: Record<SettingsScope, { scope: FileScope }> = {
    workspace: {scope: 'workspace'},
    user: {scope: 'user'},
};
const SETTINGS_FILES: Record<SettingsScope, string> = {
    workspace: WORKSPACE_SETTINGS_FILE,
    user: USER_SETTINGS_FILE,
};
const SETTINGS_SCOPE_LABELS: Record<SettingsScope, string> = {
    user: 'User',
    workspace: 'Workspace',
};
const THEME_OPTIONS: Array<{ value: ThemeValue; text: string }> = [
    { value: 'dark', text: 'ダーク' },
    { value: 'light', text: 'ライト' },
];

export interface ExportValidationSettings {
    dateTime: string;
    beginColumnName: string;
    endColumnName: string;
}

interface SettingsFile {
    theme?: ThemeValue;
    tabWrapEnabled?: boolean;
    exportValidationDateTime?: string;
    exportBeginDateColumnName?: string;
    exportEndDateColumnName?: string;
}

type SettingsKey = keyof SettingsValues;
type SettingsPatch = Partial<SettingsValues>;

interface SettingsHistoryEntry {
    scope: SettingsScope;
    before: ScopedSettingsState;
    after: ScopedSettingsState;
}

interface SettingsValues {
    theme: ThemeValue | null;
    tabWrapEnabled: boolean | null;
    exportValidationDateTime: string | null;
    exportBeginDateColumnName: string | null;
    exportEndDateColumnName: string | null;
}

interface DefaultedSettingsValues {
    theme: ThemeValue;
    tabWrapEnabled: boolean;
    exportValidationDateTime: string;
    exportBeginDateColumnName: string;
    exportEndDateColumnName: string;
}

interface ScopedSettingsState {
    user: SettingsValues;
    workspace: SettingsValues;
}

const SETTING_KEYS: readonly SettingsKey[] = [
    'theme',
    'tabWrapEnabled',
    'exportValidationDateTime',
    'exportBeginDateColumnName',
    'exportEndDateColumnName',
];

function isThemeValue(value: unknown): value is ThemeValue {
    return value === 'dark' || value === 'light';
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function createEmptySettingsValues(): SettingsValues {
    return {
        theme: null,
        tabWrapEnabled: null,
        exportValidationDateTime: null,
        exportBeginDateColumnName: null,
        exportEndDateColumnName: null,
    };
}

function createEmptySettingsState(): ScopedSettingsState {
    return {
        user: createEmptySettingsValues(),
        workspace: createEmptySettingsValues(),
    };
}

function createDefaultedSettingsValues(settings: SettingsValues): DefaultedSettingsValues {
    return {
        theme: settings.theme ?? DEFAULT_THEME,
        tabWrapEnabled: settings.tabWrapEnabled ?? DEFAULT_TAB_WRAP_ENABLED,
        exportValidationDateTime: settings.exportValidationDateTime ?? DEFAULT_EXPORT_VALIDATION_DATE_TIME,
        exportBeginDateColumnName: settings.exportBeginDateColumnName ?? DEFAULT_EXPORT_BEGIN_DATE_COLUMN_NAME,
        exportEndDateColumnName: settings.exportEndDateColumnName ?? DEFAULT_EXPORT_END_DATE_COLUMN_NAME,
    };
}

function createApplicationDefaultSettings(): DefaultedSettingsValues {
    return {
        theme: DEFAULT_THEME,
        tabWrapEnabled: DEFAULT_TAB_WRAP_ENABLED,
        exportValidationDateTime: DEFAULT_EXPORT_VALIDATION_DATE_TIME,
        exportBeginDateColumnName: DEFAULT_EXPORT_BEGIN_DATE_COLUMN_NAME,
        exportEndDateColumnName: DEFAULT_EXPORT_END_DATE_COLUMN_NAME,
    };
}

function getDefaultedSettingValue(settings: DefaultedSettingsValues, key: SettingsKey): ThemeValue | boolean | string {
    switch (key) {
        case 'theme': return settings.theme;
        case 'tabWrapEnabled': return settings.tabWrapEnabled;
        case 'exportValidationDateTime': return settings.exportValidationDateTime;
        case 'exportBeginDateColumnName': return settings.exportBeginDateColumnName;
        case 'exportEndDateColumnName': return settings.exportEndDateColumnName;
    }
}

function isSettingKey(value: string): value is SettingsKey {
    return SETTING_KEYS.includes(value as SettingsKey);
}

async function readSettingsRecordAsync(scope: SettingsScope): Promise<Record<string, unknown> | null> {
    try {
        const json = await readFileAsync(SETTINGS_FILES[scope], SETTINGS_SCOPE_OPTIONS[scope]);
        return asRecord(JSON.parse(json) as unknown);
    } catch {
        return null;
    }
}

function readThemeFromRecord(record: Record<string, unknown> | null): ThemeValue | null {
    if (record === null) return null;
    return isThemeValue(record['theme']) ? record['theme'] : null;
}

function readTabWrapEnabledFromRecord(record: Record<string, unknown> | null): boolean | null {
    if (record === null) return null;
    if (typeof record['tabWrapEnabled'] === 'boolean') {
        return record['tabWrapEnabled'];
    }
    return null;
}

function readExportValidationDateTimeFromRecord(record: Record<string, unknown> | null): string | null {
    if (record === null) return null;
    return typeof record['exportValidationDateTime'] === 'string'
        ? record['exportValidationDateTime']
        : null;
}

function readStringSettingFromRecord(record: Record<string, unknown> | null, key: string): string | null {
    if (record === null) return null;
    return typeof record[key] === 'string' ? record[key] : null;
}

function readSettingsValuesFromRecord(settingsRecord: Record<string, unknown> | null): SettingsValues {
    return {
        theme: readThemeFromRecord(settingsRecord),
        tabWrapEnabled: readTabWrapEnabledFromRecord(settingsRecord),
        exportValidationDateTime: readExportValidationDateTimeFromRecord(settingsRecord),
        exportBeginDateColumnName: readStringSettingFromRecord(settingsRecord, 'exportBeginDateColumnName'),
        exportEndDateColumnName: readStringSettingFromRecord(settingsRecord, 'exportEndDateColumnName'),
    };
}

async function readScopedSettingsAsync(scope: SettingsScope): Promise<SettingsValues> {
    return readSettingsValuesFromRecord(await readSettingsRecordAsync(scope));
}

async function readStoredSettingsAsync(): Promise<ScopedSettingsState> {
    const [workspace, user] = await Promise.all([
        readScopedSettingsAsync('workspace'),
        readScopedSettingsAsync('user'),
    ]);
    return normalizeSettingsState({workspace, user});
}

function resolveEffectiveSettings(settingsState: ScopedSettingsState): SettingsValues {
    return {
        theme: settingsState.user.theme ?? settingsState.workspace.theme,
        tabWrapEnabled: settingsState.user.tabWrapEnabled ?? settingsState.workspace.tabWrapEnabled,
        exportValidationDateTime: settingsState.user.exportValidationDateTime ?? settingsState.workspace.exportValidationDateTime,
        exportBeginDateColumnName: settingsState.user.exportBeginDateColumnName ?? settingsState.workspace.exportBeginDateColumnName,
        exportEndDateColumnName: settingsState.user.exportEndDateColumnName ?? settingsState.workspace.exportEndDateColumnName,
    };
}

function resolveSettingsForScopeView(scope: SettingsScope, settingsState: ScopedSettingsState): SettingsValues {
    return {...settingsState[scope]};
}

function resolveDefaultedSettingsForScopeView(scope: SettingsScope, settingsState: ScopedSettingsState): DefaultedSettingsValues {
    return createDefaultedSettingsValues(resolveSettingsForScopeView(scope, settingsState));
}

function normalizeSettingsValueForScopeDefault<T extends ThemeValue | boolean | string>(
    value: T | null,
    defaultValue: T,
): T | null {
    if (value === null) return null;
    return value === defaultValue ? null : value;
}

function normalizeSettingsValues(settings: SettingsValues): SettingsValues {
    const defaultSettings = createApplicationDefaultSettings();
    return {
        theme: normalizeSettingsValueForScopeDefault(settings.theme, defaultSettings.theme),
        tabWrapEnabled: normalizeSettingsValueForScopeDefault(settings.tabWrapEnabled, defaultSettings.tabWrapEnabled),
        exportValidationDateTime: normalizeSettingsValueForScopeDefault(settings.exportValidationDateTime, defaultSettings.exportValidationDateTime),
        exportBeginDateColumnName: normalizeSettingsValueForScopeDefault(settings.exportBeginDateColumnName, defaultSettings.exportBeginDateColumnName),
        exportEndDateColumnName: normalizeSettingsValueForScopeDefault(settings.exportEndDateColumnName, defaultSettings.exportEndDateColumnName),
    };
}

function normalizeSettingsState(settingsState: ScopedSettingsState): ScopedSettingsState {
    return {
        workspace: normalizeSettingsValues(settingsState.workspace),
        user: normalizeSettingsValues(settingsState.user),
    };
}

function cloneSettingsValues(settings: SettingsValues): SettingsValues {
    return {...settings};
}

function cloneSettingsState(settingsState: ScopedSettingsState): ScopedSettingsState {
    return {
        workspace: cloneSettingsValues(settingsState.workspace),
        user: cloneSettingsValues(settingsState.user),
    };
}

function areSettingsValuesEqual(left: SettingsValues, right: SettingsValues): boolean {
    return left.theme === right.theme
        && left.tabWrapEnabled === right.tabWrapEnabled
        && left.exportValidationDateTime === right.exportValidationDateTime
        && left.exportBeginDateColumnName === right.exportBeginDateColumnName
        && left.exportEndDateColumnName === right.exportEndDateColumnName;
}

function areSettingsStatesEqual(left: ScopedSettingsState, right: ScopedSettingsState): boolean {
    return areSettingsValuesEqual(left.workspace, right.workspace)
        && areSettingsValuesEqual(left.user, right.user);
}

function hasAnySettingsValue(settings: SettingsValues): boolean {
    return settings.theme !== null
        || settings.tabWrapEnabled !== null
        || settings.exportValidationDateTime !== null
        || settings.exportBeginDateColumnName !== null
        || settings.exportEndDateColumnName !== null;
}

function getThemeText(value: ThemeValue): string {
    return THEME_OPTIONS.find(option => option.value === value)?.text ?? value;
}

function getDefaultedTheme(settings: SettingsValues): ThemeValue {
    return settings.theme ?? DEFAULT_THEME;
}

function getDefaultedTabWrapEnabled(settings: SettingsValues): boolean {
    return settings.tabWrapEnabled ?? DEFAULT_TAB_WRAP_ENABLED;
}

function getDefaultedExportValidationSettings(settings: SettingsValues): ExportValidationSettings {
    return {
        dateTime: settings.exportValidationDateTime ?? DEFAULT_EXPORT_VALIDATION_DATE_TIME,
        beginColumnName: settings.exportBeginDateColumnName ?? DEFAULT_EXPORT_BEGIN_DATE_COLUMN_NAME,
        endColumnName: settings.exportEndDateColumnName ?? DEFAULT_EXPORT_END_DATE_COLUMN_NAME,
    };
}

function createSettingsFileFromValues(settings: SettingsValues): SettingsFile {
    const file: SettingsFile = {};
    if (settings.theme !== null) file.theme = settings.theme;
    if (settings.tabWrapEnabled !== null) file.tabWrapEnabled = settings.tabWrapEnabled;
    if (settings.exportValidationDateTime !== null) file.exportValidationDateTime = settings.exportValidationDateTime;
    if (settings.exportBeginDateColumnName !== null) file.exportBeginDateColumnName = settings.exportBeginDateColumnName;
    if (settings.exportEndDateColumnName !== null) file.exportEndDateColumnName = settings.exportEndDateColumnName;
    return file;
}

function applySettingsStateToRuntime(settingsState: ScopedSettingsState): void {
    const effectiveSettings = resolveEffectiveSettings(settingsState);
    document.body.dataset.theme = getDefaultedTheme(effectiveSettings);
    applyTabWrapEnabled(getDefaultedTabWrapEnabled(effectiveSettings));
    applyExportValidationSettings(getDefaultedExportValidationSettings(effectiveSettings));
}

function normalizeSettingsPatch(patch: SettingsPatch): SettingsPatch {
    const defaultSettings = createApplicationDefaultSettings();
    const normalizedPatch: SettingsPatch = {};
    if (Object.prototype.hasOwnProperty.call(patch, 'theme')) {
        normalizedPatch.theme = patch.theme === defaultSettings.theme ? null : patch.theme ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'tabWrapEnabled')) {
        normalizedPatch.tabWrapEnabled = patch.tabWrapEnabled === defaultSettings.tabWrapEnabled ? null : patch.tabWrapEnabled ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'exportValidationDateTime')) {
        normalizedPatch.exportValidationDateTime = patch.exportValidationDateTime === defaultSettings.exportValidationDateTime ? null : patch.exportValidationDateTime ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'exportBeginDateColumnName')) {
        normalizedPatch.exportBeginDateColumnName = patch.exportBeginDateColumnName === defaultSettings.exportBeginDateColumnName ? null : patch.exportBeginDateColumnName ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'exportEndDateColumnName')) {
        normalizedPatch.exportEndDateColumnName = patch.exportEndDateColumnName === defaultSettings.exportEndDateColumnName ? null : patch.exportEndDateColumnName ?? null;
    }
    return normalizedPatch;
}

function applySettingsPatchToState(settingsState: ScopedSettingsState, scope: SettingsScope, patch: SettingsPatch): ScopedSettingsState {
    const nextScopeSettings = {...settingsState[scope]};
    const normalizedPatch = normalizeSettingsPatch(patch);
    if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'theme')) nextScopeSettings.theme = normalizedPatch.theme ?? null;
    if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'tabWrapEnabled')) nextScopeSettings.tabWrapEnabled = normalizedPatch.tabWrapEnabled ?? null;
    if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'exportValidationDateTime')) nextScopeSettings.exportValidationDateTime = normalizedPatch.exportValidationDateTime ?? null;
    if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'exportBeginDateColumnName')) nextScopeSettings.exportBeginDateColumnName = normalizedPatch.exportBeginDateColumnName ?? null;
    if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'exportEndDateColumnName')) nextScopeSettings.exportEndDateColumnName = normalizedPatch.exportEndDateColumnName ?? null;
    return normalizeSettingsState({
        ...settingsState,
        [scope]: nextScopeSettings,
    });
}

async function writeSettingsFileAsync(scope: SettingsScope, settings: SettingsValues): Promise<void> {
    const data: Record<string, unknown> = {...(await readSettingsRecordAsync(scope) ?? {})};
    for (const key of SETTING_KEYS) {
        delete data[key];
    }
    const settingsFile = createSettingsFileFromValues(settings);
    if (settingsFile.theme !== undefined) data['theme'] = settingsFile.theme;
    if (settingsFile.tabWrapEnabled !== undefined) data['tabWrapEnabled'] = settingsFile.tabWrapEnabled;
    if (settingsFile.exportValidationDateTime !== undefined) data['exportValidationDateTime'] = settingsFile.exportValidationDateTime;
    if (settingsFile.exportBeginDateColumnName !== undefined) {
        data['exportBeginDateColumnName'] = settingsFile.exportBeginDateColumnName;
    }
    if (settingsFile.exportEndDateColumnName !== undefined) {
        data['exportEndDateColumnName'] = settingsFile.exportEndDateColumnName;
    }
    await writeFileAsync(SETTINGS_FILES[scope], data, SETTINGS_SCOPE_OPTIONS[scope]);
}

let settingsWriteChain: Promise<void> = Promise.resolve();
let loadedSettingsState: ScopedSettingsState = createEmptySettingsState();

function enqueueSettingsWriteAsync(scope: SettingsScope, settings: SettingsValues): Promise<void> {
    const writePromise = settingsWriteChain
        .catch(() => undefined)
        .then(() => writeSettingsFileAsync(scope, settings));
    settingsWriteChain = writePromise;
    return writePromise;
}

let appliedExportValidationSettings: ExportValidationSettings = {
    dateTime: DEFAULT_EXPORT_VALIDATION_DATE_TIME,
    beginColumnName: DEFAULT_EXPORT_BEGIN_DATE_COLUMN_NAME,
    endColumnName: DEFAULT_EXPORT_END_DATE_COLUMN_NAME,
};

export function applyTabWrapEnabled(value: boolean): void {
    document.documentElement.style.setProperty(TAB_WRAP_ENABLED_CSS_VAR, value ? '1' : '0');
    window.dispatchEvent(new CustomEvent(TAB_WRAP_ENABLED_CHANGED_EVENT));
}

export function applyExportValidationSettings(value: ExportValidationSettings): void {
    appliedExportValidationSettings = {...value};
    window.dispatchEvent(new CustomEvent(EXPORT_VALIDATION_SETTINGS_CHANGED_EVENT, {
        detail: {...appliedExportValidationSettings},
    }));
}

export function applyExportValidationDateTime(value: string): void {
    applyExportValidationSettings({...appliedExportValidationSettings, dateTime: value});
}

export function applyExportValidationColumnNames(beginColumnName: string, endColumnName: string): void {
    applyExportValidationSettings({...appliedExportValidationSettings, beginColumnName, endColumnName});
}

export function getAppliedExportValidationSettings(): ExportValidationSettings {
    return {...appliedExportValidationSettings};
}

export class SettingsPanel {
    private readonly element: HTMLElement;
    private activeScope: SettingsScope;
    private readonly scopeButtons: Record<SettingsScope, HTMLButtonElement>;
    private selectedTheme: ThemeValue;
    private readonly selectedLabel: HTMLElement;
    private readonly dropdownList: HTMLElement;
    private selectedTabWrapEnabled: boolean;
    private readonly tabWrapToggle: HTMLInputElement;
    private selectedExportValidationDateTime: string;
    private readonly exportValidationDateTimePicker: DateTimePicker;
    private selectedExportBeginDateColumnName: string;
    private readonly exportBeginDateColumnNameInput: HTMLInputElement;
    private selectedExportEndDateColumnName: string;
    private readonly exportEndDateColumnNameInput: HTMLInputElement;
    /** dirty マーク表示先の TabButton（Tab から inject される） */
    private readonly tabButton: TabButton;
    private readonly documentKeydownHandler: (event: KeyboardEvent) => void;
    private readonly collapsedSections = new Set<string>();
    private readonly undoStack: SettingsHistoryEntry[];
    private readonly redoStack: SettingsHistoryEntry[];
    private nextSectionId = 0;

    constructor(tabButton: TabButton) {
        this.tabButton = tabButton;
        this.undoStack = [];
        this.redoStack = [];
        this.documentKeydownHandler = (event: KeyboardEvent) => {
            if (!this.isVisible()) return;
            this.handleKeyDown(event);
        };
        document.addEventListener('keydown', this.documentKeydownHandler, true);

        // 設定パネル全体のコンテナ
        this.element = document.createElement('div');
        this.element.classList.add('settings-panel');
        this.element.tabIndex = 0;
        this.element.addEventListener('keydown', (event: KeyboardEvent) => {
            this.handleKeyDown(event);
        });

        this.activeScope = hasAnySettingsValue(loadedSettingsState.user) ? 'user' : 'workspace';
        const userScopeButton = this.createScopeButton('user');
        const workspaceScopeButton = this.createScopeButton('workspace');
        this.scopeButtons = {
            user: userScopeButton,
            workspace: workspaceScopeButton,
        };
        const scopeTabs = document.createElement('div');
        scopeTabs.classList.add('settings-scope-tabs');
        scopeTabs.setAttribute('role', 'tablist');
        scopeTabs.appendChild(userScopeButton);
        scopeTabs.appendChild(workspaceScopeButton);
        this.element.appendChild(scopeTabs);

        const initialSettings = resolveSettingsForScopeView(this.activeScope, loadedSettingsState);

        // 表示設定セクション
        const displaySection = this.createSection('表示');
        const displaySectionItems = this.getSectionItemsElement(displaySection);

        const label = document.createElement('div');
        label.classList.add('settings-label');
        label.dataset.settingKey = 'theme';
        const labelText = document.createElement('span');
        labelText.classList.add('settings-label-text');
        labelText.textContent = 'テーマ';
        label.appendChild(labelText);

        // カスタムドロップダウン（ブラウザネイティブ<select>では選択色を制御できないため）
        const dropdown = document.createElement('div');
        dropdown.classList.add('settings-dropdown');

        // 選択表示ボタン
        const trigger = document.createElement('button');
        trigger.classList.add('settings-dropdown-trigger');
        this.selectedLabel = document.createElement('span');
        const chevron = document.createElement('span');
        chevron.classList.add('settings-dropdown-chevron');
        chevron.textContent = '\u25BC';
        trigger.appendChild(this.selectedLabel);
        trigger.appendChild(chevron);

        // ドロップダウンリスト
        this.dropdownList = document.createElement('div');
        this.dropdownList.classList.add('settings-dropdown-list');

        for (const opt of THEME_OPTIONS) {
            const item = document.createElement('div');
            item.classList.add('settings-dropdown-item');
            item.dataset.value = opt.value;
            item.textContent = opt.text;
            item.addEventListener('click', () => {
                this.selectTheme(opt.value);
                this.closeDropdown();
            });
            this.dropdownList.appendChild(item);
        }

        trigger.addEventListener('click', () => { this.toggleDropdown(); });

        // ドロップダウン外クリックで閉じる
        document.addEventListener('click', (e: MouseEvent) => {
            if (!dropdown.contains(e.target as Node)) {
                this.closeDropdown();
            }
        });

        dropdown.appendChild(trigger);
        dropdown.appendChild(this.dropdownList);

        // アクティブな設定スコープの値を初期表示に反映する
        this.selectedTheme = getDefaultedTheme(initialSettings);
        this.selectedLabel.textContent = getThemeText(this.selectedTheme);
        this.updateItemStyles();

        label.appendChild(dropdown);
        label.appendChild(this.createSettingResetButton('theme'));
        displaySectionItems.appendChild(label);

        const tabWrapLabel = document.createElement('div');
        tabWrapLabel.classList.add('settings-label');
        tabWrapLabel.dataset.settingKey = 'tabWrapEnabled';
        const tabWrapLabelText = document.createElement('span');
        tabWrapLabelText.classList.add('settings-label-text');
        tabWrapLabelText.textContent = 'タブを折り返す';
        tabWrapLabel.appendChild(tabWrapLabelText);

        const tabWrapControl = document.createElement('label');
        tabWrapControl.classList.add('settings-toggle', 'settings-tab-wrap-toggle');

        this.selectedTabWrapEnabled = getDefaultedTabWrapEnabled(initialSettings);
        this.tabWrapToggle = document.createElement('input');
        this.tabWrapToggle.classList.add('settings-toggle-input', 'settings-tab-wrap-checkbox');
        this.tabWrapToggle.type = 'checkbox';
        this.tabWrapToggle.checked = this.selectedTabWrapEnabled;
        this.tabWrapToggle.addEventListener('change', () => {
            this.selectTabWrapEnabled(this.tabWrapToggle.checked);
        });

        const tabWrapTrack = document.createElement('span');
        tabWrapTrack.classList.add('settings-toggle-track');
        const tabWrapThumb = document.createElement('span');
        tabWrapThumb.classList.add('settings-toggle-thumb');
        tabWrapTrack.appendChild(tabWrapThumb);

        tabWrapControl.appendChild(this.tabWrapToggle);
        tabWrapControl.appendChild(tabWrapTrack);
        tabWrapLabel.appendChild(tabWrapControl);
        tabWrapLabel.appendChild(this.createSettingResetButton('tabWrapEnabled'));
        displaySectionItems.appendChild(tabWrapLabel);
        this.element.appendChild(displaySection);

        // export_begin_date / export_end_date を使った出力フィルター時刻
        const exportValidationSection = this.createSection('出力フィルター');
        const exportValidationSectionItems = this.getSectionItemsElement(exportValidationSection);

        const exportValidationLabel = document.createElement('label');
        exportValidationLabel.classList.add('settings-label');
        exportValidationLabel.dataset.settingKey = 'exportValidationDateTime';
        const exportValidationLabelText = document.createElement('span');
        exportValidationLabelText.classList.add('settings-label-text');
        exportValidationLabelText.textContent = '出力フィルター時刻';
        exportValidationLabel.appendChild(exportValidationLabelText);

        const currentExportValidationSettings = getDefaultedExportValidationSettings(initialSettings);
        this.selectedExportValidationDateTime = normalizeDateTimeInputToSeconds(currentExportValidationSettings.dateTime) ?? currentExportValidationSettings.dateTime;
        this.exportValidationDateTimePicker = new DateTimePicker({
            value: this.selectedExportValidationDateTime,
            rootClassNames: ['settings-date-time-picker', 'settings-export-validation-date-time-picker'],
            inputClassNames: ['settings-datetime-input', 'settings-export-validation-datetime-input'],
            onCommit: (value: string) => {
                this.selectExportValidationDateTime(value);
            },
        });

        exportValidationLabel.appendChild(this.exportValidationDateTimePicker.getElement());
        exportValidationLabel.appendChild(this.createSettingResetButton('exportValidationDateTime'));
        exportValidationSectionItems.appendChild(exportValidationLabel);

        const exportBeginDateColumnLabel = document.createElement('label');
        exportBeginDateColumnLabel.classList.add('settings-label');
        exportBeginDateColumnLabel.dataset.settingKey = 'exportBeginDateColumnName';
        const exportBeginDateColumnLabelText = document.createElement('span');
        exportBeginDateColumnLabelText.classList.add('settings-label-text');
        exportBeginDateColumnLabelText.textContent = '開始日時列';
        exportBeginDateColumnLabel.appendChild(exportBeginDateColumnLabelText);

        this.selectedExportBeginDateColumnName = currentExportValidationSettings.beginColumnName;
        this.exportBeginDateColumnNameInput = document.createElement('input');
        this.exportBeginDateColumnNameInput.classList.add('settings-text-input', 'settings-export-begin-date-column-input');
        this.exportBeginDateColumnNameInput.type = 'text';
        this.exportBeginDateColumnNameInput.value = this.selectedExportBeginDateColumnName;
        this.exportBeginDateColumnNameInput.addEventListener('change', () => {
            this.selectExportValidationColumnNames(this.exportBeginDateColumnNameInput.value, this.exportEndDateColumnNameInput.value);
        });
        this.exportBeginDateColumnNameInput.addEventListener('blur', () => {
            if (this.exportBeginDateColumnNameInput.value !== this.selectedExportBeginDateColumnName) {
                this.selectExportValidationColumnNames(this.exportBeginDateColumnNameInput.value, this.exportEndDateColumnNameInput.value);
            }
        });
        exportBeginDateColumnLabel.appendChild(this.exportBeginDateColumnNameInput);
        exportBeginDateColumnLabel.appendChild(this.createSettingResetButton('exportBeginDateColumnName'));
        exportValidationSectionItems.appendChild(exportBeginDateColumnLabel);

        const exportEndDateColumnLabel = document.createElement('label');
        exportEndDateColumnLabel.classList.add('settings-label');
        exportEndDateColumnLabel.dataset.settingKey = 'exportEndDateColumnName';
        const exportEndDateColumnLabelText = document.createElement('span');
        exportEndDateColumnLabelText.classList.add('settings-label-text');
        exportEndDateColumnLabelText.textContent = '終了日時列';
        exportEndDateColumnLabel.appendChild(exportEndDateColumnLabelText);

        this.selectedExportEndDateColumnName = currentExportValidationSettings.endColumnName;
        this.exportEndDateColumnNameInput = document.createElement('input');
        this.exportEndDateColumnNameInput.classList.add('settings-text-input', 'settings-export-end-date-column-input');
        this.exportEndDateColumnNameInput.type = 'text';
        this.exportEndDateColumnNameInput.value = this.selectedExportEndDateColumnName;
        this.exportEndDateColumnNameInput.addEventListener('change', () => {
            this.selectExportValidationColumnNames(this.exportBeginDateColumnNameInput.value, this.exportEndDateColumnNameInput.value);
        });
        this.exportEndDateColumnNameInput.addEventListener('blur', () => {
            if (this.exportEndDateColumnNameInput.value !== this.selectedExportEndDateColumnName) {
                this.selectExportValidationColumnNames(this.exportBeginDateColumnNameInput.value, this.exportEndDateColumnNameInput.value);
            }
        });
        exportEndDateColumnLabel.appendChild(this.exportEndDateColumnNameInput);
        exportEndDateColumnLabel.appendChild(this.createSettingResetButton('exportEndDateColumnName'));
        exportValidationSectionItems.appendChild(exportEndDateColumnLabel);

        this.element.appendChild(exportValidationSection);
        this.updateScopeButtonStyles();
        this.updateSettingDifferenceMarkers();
    }

    private createScopeButton(scope: SettingsScope): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.classList.add('settings-scope-tab');
        button.dataset.scope = scope;
        button.textContent = SETTINGS_SCOPE_LABELS[scope];
        button.setAttribute('role', 'tab');
        button.addEventListener('click', () => {
            this.activateScope(scope);
        });
        return button;
    }

    private activateScope(scope: SettingsScope): void {
        if (this.activeScope === scope) return;
        this.activeScope = scope;
        this.closeDropdown();
        this.updateScopeButtonStyles();
        this.updateControlsFromActiveScope();
    }

    private updateScopeButtonStyles(): void {
        for (const scope of Object.keys(this.scopeButtons) as SettingsScope[]) {
            const selected = scope === this.activeScope;
            this.scopeButtons[scope].classList.toggle('settings-scope-tab-active', selected);
            this.scopeButtons[scope].setAttribute('aria-selected', selected ? 'true' : 'false');
            this.scopeButtons[scope].tabIndex = selected ? 0 : -1;
        }
    }

    private updateControlsFromActiveScope(): void {
        const settings = resolveSettingsForScopeView(this.activeScope, loadedSettingsState);
        this.selectedTheme = getDefaultedTheme(settings);
        this.selectedLabel.textContent = getThemeText(this.selectedTheme);
        this.updateItemStyles();

        this.selectedTabWrapEnabled = getDefaultedTabWrapEnabled(settings);
        this.tabWrapToggle.checked = this.selectedTabWrapEnabled;

        const exportValidationSettings = getDefaultedExportValidationSettings(settings);
        this.selectedExportValidationDateTime = normalizeDateTimeInputToSeconds(exportValidationSettings.dateTime) ?? exportValidationSettings.dateTime;
        this.exportValidationDateTimePicker.setValue(this.selectedExportValidationDateTime);
        this.selectedExportBeginDateColumnName = exportValidationSettings.beginColumnName;
        this.selectedExportEndDateColumnName = exportValidationSettings.endColumnName;
        this.exportBeginDateColumnNameInput.value = this.selectedExportBeginDateColumnName;
        this.exportEndDateColumnNameInput.value = this.selectedExportEndDateColumnName;
        this.updateSettingDifferenceMarkers();
    }

    private updateSettingDifferenceMarkers(): void {
        const currentSettings = resolveDefaultedSettingsForScopeView(this.activeScope, loadedSettingsState);
        const defaultSettings = createApplicationDefaultSettings();
        for (const label of Array.from(this.element.querySelectorAll<HTMLElement>('.settings-label[data-setting-key]'))) {
            const key = label.dataset.settingKey;
            if (key === undefined || !isSettingKey(key)) continue;
            const differs = getDefaultedSettingValue(currentSettings, key) !== getDefaultedSettingValue(defaultSettings, key);
            label.classList.toggle('settings-label-default-different', differs);
            label.dataset.defaultDifferent = differs ? 'true' : 'false';
        }
        for (const button of Array.from(this.element.querySelectorAll<HTMLButtonElement>('.settings-reset-setting-button[data-setting-key]'))) {
            const key = button.dataset.settingKey;
            if (key === undefined || !isSettingKey(key)) continue;
            const differs = getDefaultedSettingValue(currentSettings, key) !== getDefaultedSettingValue(defaultSettings, key);
            button.disabled = !differs;
        }
    }

    private createSection(title: string): HTMLElement {
        const section = document.createElement('div');
        section.classList.add('settings-section');
        section.setAttribute('role', 'group');
        section.dataset.sectionName = title;

        const collapsed = this.collapsedSections.has(title);
        const itemsId = `settings-section-items-${++this.nextSectionId}`;

        const header = document.createElement('button');
        header.type = 'button';
        header.classList.add('settings-section-header');
        header.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        header.setAttribute('aria-controls', itemsId);

        const chevron = document.createElement('span');
        chevron.classList.add('settings-section-chevron');
        chevron.innerHTML = `<svg viewBox="0 0 16 16" width="10" height="10" fill="currentColor" aria-hidden="true"><path d="M5.7 13.7L5 13l4.6-4.6L5 3.7l.7-.7 5.3 5.4z"/></svg>`;

        const name = document.createElement('span');
        name.classList.add('settings-section-name');
        name.textContent = title;

        header.appendChild(chevron);
        header.appendChild(name);
        header.addEventListener('click', () => { this.toggleSection(section, title); });

        const items = document.createElement('div');
        items.id = itemsId;
        items.classList.add('settings-section-items');
        items.setAttribute('aria-hidden', collapsed ? 'true' : 'false');

        section.appendChild(header);
        section.appendChild(items);
        return section;
    }

    private toggleSection(section: HTMLElement, title: string): void {
        const header = section.querySelector<HTMLElement>('.settings-section-header');
        const items = section.querySelector<HTMLElement>('.settings-section-items');
        if (header === null || items === null) return;
        const expanded = header.getAttribute('aria-expanded') === 'true';
        header.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        items.setAttribute('aria-hidden', expanded ? 'true' : 'false');
        if (expanded) {
            this.collapsedSections.add(title);
        } else {
            this.collapsedSections.delete(title);
        }
    }

    private getSectionItemsElement(section: HTMLElement): HTMLElement {
        const items = section.querySelector<HTMLElement>('.settings-section-items');
        if (items === null) throw new Error('[SettingsPanel.getSectionItemsElement] .settings-section-items が見つかりません');
        return items;
    }

    private selectTheme(value: ThemeValue): void {
        if (this.selectedTheme === value) return;
        this.selectedTheme = value;
        this.selectedLabel.textContent = getThemeText(value);
        this.updateItemStyles();
        this.applyAndSaveSettingsPatch({theme: value}, 'save theme failed');
    }

    private selectTabWrapEnabled(value: boolean): void {
        if (this.selectedTabWrapEnabled === value) return;
        this.selectedTabWrapEnabled = value;
        this.applyAndSaveSettingsPatch({tabWrapEnabled: value}, 'save tab layout failed');
    }

    private selectExportValidationDateTime(value: string): void {
        const nextValue = normalizeDateTimeInputToSeconds(value) ?? value.trim();
        if (this.selectedExportValidationDateTime === nextValue) return;
        this.selectedExportValidationDateTime = nextValue;
        this.exportValidationDateTimePicker.setValue(this.selectedExportValidationDateTime);
        this.applyAndSaveSettingsPatch({exportValidationDateTime: this.selectedExportValidationDateTime}, 'save export validation date time failed');
    }

    private selectExportValidationColumnNames(beginColumnName: string, endColumnName: string): void {
        const nextBeginColumnName = beginColumnName.trim();
        const nextEndColumnName = endColumnName.trim();
        const patch: SettingsPatch = {};
        if (this.selectedExportBeginDateColumnName !== nextBeginColumnName) {
            patch.exportBeginDateColumnName = nextBeginColumnName;
        }
        if (this.selectedExportEndDateColumnName !== nextEndColumnName) {
            patch.exportEndDateColumnName = nextEndColumnName;
        }
        if (Object.keys(patch).length === 0) return;
        this.selectedExportBeginDateColumnName = nextBeginColumnName;
        this.selectedExportEndDateColumnName = nextEndColumnName;
        this.exportBeginDateColumnNameInput.value = this.selectedExportBeginDateColumnName;
        this.exportEndDateColumnNameInput.value = this.selectedExportEndDateColumnName;
        this.applyAndSaveSettingsPatch(patch, 'save export validation column names failed');
    }

    private createSettingResetButton(key: SettingsKey): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.classList.add('settings-reset-setting-button');
        button.dataset.settingKey = key;
        button.textContent = 'デフォルト';
        button.addEventListener('click', (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            this.resetSettingToDefault(key);
        });
        return button;
    }

    private resetSettingToDefault(key: SettingsKey): void {
        const currentSettings = resolveDefaultedSettingsForScopeView(this.activeScope, loadedSettingsState);
        const defaultSettings = createApplicationDefaultSettings();
        if (getDefaultedSettingValue(currentSettings, key) === getDefaultedSettingValue(defaultSettings, key)) return;
        this.closeDropdown();
        this.applyAndSaveSettingsPatch(this.createDefaultSettingPatch(key), 'reset setting to default failed');
        this.updateControlsFromActiveScope();
    }

    private createDefaultSettingPatch(key: SettingsKey): SettingsPatch {
        const defaults = createApplicationDefaultSettings();
        switch (key) {
            case 'theme': return { theme: defaults.theme };
            case 'tabWrapEnabled': return { tabWrapEnabled: defaults.tabWrapEnabled };
            case 'exportValidationDateTime': return { exportValidationDateTime: defaults.exportValidationDateTime };
            case 'exportBeginDateColumnName': return { exportBeginDateColumnName: defaults.exportBeginDateColumnName };
            case 'exportEndDateColumnName': return { exportEndDateColumnName: defaults.exportEndDateColumnName };
        }
    }

    /** 選択中アイテムにアクティブスタイルを付与する */
    private updateItemStyles(): void {
        for (const item of Array.from(this.dropdownList.children) as HTMLElement[]) {
            if (item.dataset.value === this.selectedTheme) {
                item.classList.add('settings-dropdown-item-active');
            } else {
                item.classList.remove('settings-dropdown-item-active');
            }
        }
    }

    private toggleDropdown(): void {
        this.dropdownList.classList.toggle('visible');
    }

    private closeDropdown(): void {
        this.dropdownList.classList.remove('visible');
    }

    /**
     * 親要素にパネルを追加する
     */
    appendTo(parent: HTMLElement): void {
        parent.appendChild(this.element);
        this.element.focus({preventScroll: true});
    }

    destroy(): void {
        document.removeEventListener('keydown', this.documentKeydownHandler, true);
        this.exportValidationDateTimePicker.destroy();
        this.element.remove();
    }

    /**
     * 現在の設定を保存し、dirty 状態を解除する
     * change イベント（自動保存）および Ctrl+S（手動保存）の両方から呼ばれる
     */
    save(): void {
        this.writeSettingsAsync(loadedSettingsState[this.activeScope])
            .then(() => { this.tabButton.setDirty(false); })
            .catch((error: unknown) => {
                console.error('[SettingsPanel] save failed:', String(error));
                this.tabButton.setDirty(true);
            });
    }

    private applyAndSaveSettingsPatch(settings: SettingsPatch, errorContext: string): void {
        const before = cloneSettingsState(loadedSettingsState);
        const after = applySettingsPatchToState(loadedSettingsState, this.activeScope, settings);
        if (areSettingsStatesEqual(before, after)) return;
        this.pushUndoEntry({scope: this.activeScope, before, after: cloneSettingsState(after)});
        loadedSettingsState = after;
        applySettingsStateToRuntime(loadedSettingsState);
        this.updateSettingDifferenceMarkers();
        this.writeSettingsAsync(loadedSettingsState[this.activeScope])
            .then(() => { this.tabButton.setDirty(false); })
            .catch((error: unknown) => {
                console.error(`[SettingsPanel] ${errorContext}:`, String(error));
                this.tabButton.setDirty(true);
            });
    }

    private pushUndoEntry(entry: SettingsHistoryEntry): void {
        this.undoStack.push(entry);
        if (this.undoStack.length > 100) this.undoStack.shift();
        this.redoStack.length = 0;
    }

    private isVisible(): boolean {
        return this.element.isConnected && this.element.getClientRects().length > 0;
    }

    private handleKeyDown(event: KeyboardEvent): void {
        if (!event.ctrlKey || event.altKey) return;
        const key = event.key.toLowerCase();
        const isUndo = key === 'z' && !event.shiftKey;
        const isRedo = key === 'y' || (key === 'z' && event.shiftKey);
        if (!isUndo && !isRedo) return;
        if (this.shouldLetNativeTextHistoryHandle(event.target)) return;

        event.preventDefault();
        event.stopPropagation();
        if (isUndo) {
            this.undoSettingsChange();
        } else {
            this.redoSettingsChange();
        }
    }

    private shouldLetNativeTextHistoryHandle(target: EventTarget | null): boolean {
        if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) return false;
        if (target === this.tabWrapToggle) return false;
        if (target === this.exportBeginDateColumnNameInput) {
            return target.value !== this.selectedExportBeginDateColumnName;
        }
        if (target === this.exportEndDateColumnNameInput) {
            return target.value !== this.selectedExportEndDateColumnName;
        }
        if (target === this.exportValidationDateTimePicker.getInput()) {
            return target.value !== this.selectedExportValidationDateTime;
        }
        return true;
    }

    private undoSettingsChange(): void {
        const entry = this.undoStack.pop();
        if (entry === undefined) return;
        this.redoStack.push(entry);
        this.applyHistoryState(entry.before, entry.scope, 'undo settings failed');
    }

    private redoSettingsChange(): void {
        const entry = this.redoStack.pop();
        if (entry === undefined) return;
        this.undoStack.push(entry);
        this.applyHistoryState(entry.after, entry.scope, 'redo settings failed');
    }

    private applyHistoryState(settingsState: ScopedSettingsState, scope: SettingsScope, errorContext: string): void {
        loadedSettingsState = cloneSettingsState(settingsState);
        this.activeScope = scope;
        this.closeDropdown();
        this.exportValidationDateTimePicker.close();
        applySettingsStateToRuntime(loadedSettingsState);
        this.updateScopeButtonStyles();
        this.updateControlsFromActiveScope();
        this.writeSettingsAsync(loadedSettingsState[scope])
            .then(() => { this.tabButton.setDirty(false); })
            .catch((error: unknown) => {
                console.error(`[SettingsPanel] ${errorContext}:`, String(error));
                this.tabButton.setDirty(true);
            });
    }

    private async writeSettingsAsync(settings: SettingsValues): Promise<void> {
        await enqueueSettingsWriteAsync(this.activeScope, settings);
    }
}

/**
 * アプリケーション起動時に User / Workspace の保存済みテーマを読み込んで適用する
 */
export async function applyStoredThemeAsync(): Promise<void> {
    loadedSettingsState = await readStoredSettingsAsync();
    document.body.dataset.theme = getDefaultedTheme(resolveEffectiveSettings(loadedSettingsState));
}

/**
 * アプリケーション起動時に User / Workspace の保存済み設定を読み込んで適用する
 */
export async function applyStoredSettingsAsync(): Promise<void> {
    loadedSettingsState = await readStoredSettingsAsync();
    applySettingsStateToRuntime(loadedSettingsState);
}
