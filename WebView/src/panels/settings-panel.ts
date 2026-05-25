import {readFileAsync, writeFileAsync, type FileScope} from "../app/api";
import {TabButton} from "../tabs/tab-button";
import {USER_SETTINGS_FILE, WORKSPACE_SETTINGS_FILE} from "../config/masterdataeditor-path";
import {DateTimePicker, normalizeDateTimeInputToSeconds} from "../ui/date-time-picker";
import {
    createApplicationDefaultSettings,
    getApplicationDefaultValue,
    getDefaultedSettingValue,
    getSettingLabel,
    getSettingOptionLabel,
    getSettingOptions,
    isSettingKey,
    normalizeNumberSettingValue,
    SETTING_DEFINITIONS,
    SETTING_KEYS,
    SETTING_SECTIONS,
    SETTINGS_CHANGED_EVENT,
    type AppliedSettings,
    type DefaultedSettingsValues,
    type SettingOption,
    type SettingRowElementName,
    type SettingsChangedEventDetail,
    type SettingsFile,
    type SettingsKey,
    type SettingsValues,
    type SettingValue,
    type SettingValueFor,
} from "../settings/settings-schema";

/**
 * 設定画面パネル
 * User / Workspace スコープ別にテーマ・タブ折り返し・出力フィルター設定を提供する。
 * - change イベントで実効設定を即時更新し、自動的に現在のスコープへ保存する
 * - Ctrl+S による手動保存も引き続き動作する（冪等）
 */

type SettingsScope = 'workspace' | 'user';

const TAB_WRAP_ENABLED_CSS_VAR = '--tab-wrap-enabled';
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
const SETTING_RUNTIME_APPLIERS: Partial<Record<SettingsKey, (settings: AppliedSettings) => void>> = {
    theme: (settings: AppliedSettings) => {
        document.body.dataset.theme = settings.theme;
    },
    tabWrapEnabled: (settings: AppliedSettings) => {
        document.documentElement.style.setProperty(TAB_WRAP_ENABLED_CSS_VAR, settings.tabWrapEnabled ? '1' : '0');
    },
};
const SETTING_VALUE_READERS = {
    boolean(record: Record<string, unknown> | null, key: string): boolean | null {
        if (record === null) return null;
        return typeof record[key] === 'boolean' ? record[key] : null;
    },
    string(record: Record<string, unknown> | null, key: string): string | null {
        if (record === null) return null;
        return typeof record[key] === 'string' ? record[key] : null;
    },
    number(record: Record<string, unknown> | null, key: string): number | null {
        if (record === null) return null;
        return typeof record[key] === 'number' && Number.isFinite(record[key]) ? record[key] : null;
    },
};

type SettingsPatch = Partial<SettingsValues>;

interface SettingsHistoryEntry {
    scope: SettingsScope;
    before: ScopedSettingsState;
    after: ScopedSettingsState;
}

interface ScopedSettingsState {
    user: SettingsValues;
    workspace: SettingsValues;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function hasOwnSettingKey<T extends object>(value: T, key: SettingsKey): boolean {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function readSelectSettingValueFromRecord(
    record: Record<string, unknown> | null,
    key: string,
    options: readonly SettingOption<SettingValue>[] | undefined,
): SettingValue | null {
    if (record === null || options === undefined) return null;
    const value = record[key];
    return options.find(option => option.value === value)?.value ?? null;
}

function readSettingValueFromRecord<TKey extends SettingsKey>(
    record: Record<string, unknown> | null,
    key: TKey,
): SettingsValues[TKey] {
    const definition = SETTING_DEFINITIONS[key];
    if (definition.type === 'select') {
        return readSelectSettingValueFromRecord(
            record,
            key,
            definition.options as readonly SettingOption<SettingValue>[] | undefined,
        ) as SettingsValues[TKey];
    }
    const value = SETTING_VALUE_READERS[definition.type](record, key);
    if (value === null) return null as SettingsValues[TKey];
    if (definition.type === 'number') {
        return normalizeNumberSettingValue(key, value as number) as SettingsValues[TKey];
    }
    return value as SettingsValues[TKey];
}

function setSettingValue<TKey extends SettingsKey>(
    settings: SettingsValues,
    key: TKey,
    value: SettingsValues[TKey],
): void {
    settings[key] = value;
}

function setDefaultedSettingValue<TKey extends SettingsKey>(
    settings: DefaultedSettingsValues,
    key: TKey,
    value: DefaultedSettingsValues[TKey],
): void {
    settings[key] = value;
}

function setSettingsPatchValue<TKey extends SettingsKey>(
    patch: SettingsPatch,
    key: TKey,
    value: SettingsPatch[TKey],
): void {
    patch[key] = value;
}

function createEmptySettingsValues(): SettingsValues {
    const settings = {} as SettingsValues;
    for (const key of SETTING_KEYS) {
        setSettingValue(settings, key, null);
    }
    return settings;
}

function createEmptySettingsState(): ScopedSettingsState {
    return {
        user: createEmptySettingsValues(),
        workspace: createEmptySettingsValues(),
    };
}

function createDefaultedSettingsValues(settings: SettingsValues): DefaultedSettingsValues {
    const defaultedSettings = {} as DefaultedSettingsValues;
    for (const key of SETTING_KEYS) {
        setDefaultedSettingValue(
            defaultedSettings,
            key,
            (settings[key] ?? getApplicationDefaultValue(key)) as DefaultedSettingsValues[typeof key],
        );
    }
    return defaultedSettings;
}

async function readSettingsRecordAsync(scope: SettingsScope): Promise<Record<string, unknown> | null> {
    try {
        const json = await readFileAsync(SETTINGS_FILES[scope], SETTINGS_SCOPE_OPTIONS[scope]);
        return asRecord(JSON.parse(json) as unknown);
    } catch {
        return null;
    }
}

function readSettingsValuesFromRecord(settingsRecord: Record<string, unknown> | null): SettingsValues {
    const settings = {} as SettingsValues;
    for (const key of SETTING_KEYS) {
        setSettingValue(settings, key, readSettingValueFromRecord(settingsRecord, key));
    }
    return settings;
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
    const effectiveSettings = {} as SettingsValues;
    for (const key of SETTING_KEYS) {
        setSettingValue(
            effectiveSettings,
            key,
            (settingsState.user[key] ?? settingsState.workspace[key]) as SettingsValues[typeof key],
        );
    }
    return effectiveSettings;
}

function resolveSettingsForScopeView(scope: SettingsScope, settingsState: ScopedSettingsState): SettingsValues {
    return {...settingsState[scope]};
}

function resolveDefaultedSettingsForScopeView(scope: SettingsScope, settingsState: ScopedSettingsState): DefaultedSettingsValues {
    return createDefaultedSettingsValues(resolveSettingsForScopeView(scope, settingsState));
}

function normalizeSettingsValueForScopeDefault<TKey extends SettingsKey>(
    key: TKey,
    value: SettingsValues[TKey],
): SettingsValues[TKey] {
    if (value === null) return null;
    const definition = SETTING_DEFINITIONS[key];
    const normalizedValue = definition.type === 'number'
        ? normalizeNumberSettingValue(key, value as number)
        : value;
    const defaultValue = getApplicationDefaultValue(key);
    return normalizedValue === defaultValue ? null : normalizedValue as SettingsValues[TKey];
}

function normalizeSettingsValues(settings: SettingsValues): SettingsValues {
    const normalizedSettings = {} as SettingsValues;
    for (const key of SETTING_KEYS) {
        setSettingValue(normalizedSettings, key, normalizeSettingsValueForScopeDefault(key, settings[key]));
    }
    return normalizedSettings;
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
    return SETTING_KEYS.every(key => left[key] === right[key]);
}

function areSettingsStatesEqual(left: ScopedSettingsState, right: ScopedSettingsState): boolean {
    return areSettingsValuesEqual(left.workspace, right.workspace)
        && areSettingsValuesEqual(left.user, right.user);
}

function hasAnySettingsValue(settings: SettingsValues): boolean {
    return SETTING_KEYS.some(key => settings[key] !== null);
}

function createSettingsFileFromValues(settings: SettingsValues): SettingsFile {
    const file: SettingsFile = {};
    for (const key of SETTING_KEYS) {
        if (settings[key] !== null) {
            file[key] = settings[key] as SettingValue;
        }
    }
    return file;
}

function getChangedEffectiveSettingsKeys(before: ScopedSettingsState, after: ScopedSettingsState): SettingsKey[] {
    const beforeSettings = createDefaultedSettingsValues(resolveEffectiveSettings(before));
    const afterSettings = createDefaultedSettingsValues(resolveEffectiveSettings(after));
    return SETTING_KEYS.filter(key => beforeSettings[key] !== afterSettings[key]);
}

function applySettingsStateToRuntime(
    settingsState: ScopedSettingsState,
    changedKeys: readonly SettingsKey[] = SETTING_KEYS,
): void {
    appliedSettings = createDefaultedSettingsValues(resolveEffectiveSettings(settingsState));
    for (const key of changedKeys) {
        SETTING_RUNTIME_APPLIERS[key]?.(appliedSettings);
    }
    dispatchSettingsChangedEvent(changedKeys);
}

function normalizeSettingsPatch(patch: SettingsPatch): SettingsPatch {
    const normalizedPatch: SettingsPatch = {};
    for (const key of SETTING_KEYS) {
        if (!hasOwnSettingKey(patch, key)) continue;
        setSettingsPatchValue(
            normalizedPatch,
            key,
            normalizeSettingsValueForScopeDefault(key, (patch[key] ?? null) as SettingsValues[typeof key]),
        );
    }
    return normalizedPatch;
}

function applySettingsPatchToState(settingsState: ScopedSettingsState, scope: SettingsScope, patch: SettingsPatch): ScopedSettingsState {
    const nextScopeSettings = {...settingsState[scope]};
    const normalizedPatch = normalizeSettingsPatch(patch);
    for (const key of SETTING_KEYS) {
        if (!hasOwnSettingKey(normalizedPatch, key)) continue;
        setSettingValue(nextScopeSettings, key, (normalizedPatch[key] ?? null) as SettingsValues[typeof key]);
    }
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
    for (const key of SETTING_KEYS) {
        if (settingsFile[key] !== undefined) {
            data[key] = settingsFile[key];
        }
    }
    await writeFileAsync(SETTINGS_FILES[scope], data, SETTINGS_SCOPE_OPTIONS[scope]);
}

let settingsWriteChain: Promise<void> = Promise.resolve();
let loadedSettingsState: ScopedSettingsState = createEmptySettingsState();
let appliedSettings: AppliedSettings = createApplicationDefaultSettings();

function enqueueSettingsWriteAsync(scope: SettingsScope, settings: SettingsValues): Promise<void> {
    const writePromise = settingsWriteChain
        .catch(() => undefined)
        .then(() => writeSettingsFileAsync(scope, settings));
    settingsWriteChain = writePromise;
    return writePromise;
}

function dispatchSettingsChangedEvent(changedKeys: readonly SettingsKey[]): void {
    if (changedKeys.length === 0) return;
    const detail: SettingsChangedEventDetail = {
        settings: getAppliedSettings(),
        changedKeys: [...changedKeys],
    };
    window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT, {detail}));
}

export function getAppliedSettings(): AppliedSettings {
    return {...appliedSettings};
}

interface SettingControl {
    root: HTMLElement;
    getValue(): SettingValue;
    setValue(value: SettingValue): void;
    close?(): void;
    destroy?(): void;
    containsTarget?(target: Node): boolean;
    shouldLetNativeTextHistoryHandle?(target: EventTarget): boolean | null;
}

type SettingControlMap = {
    [TKey in SettingsKey]?: SettingControl;
};

export class SettingsPanel {
    private readonly element: HTMLElement;
    private activeScope: SettingsScope;
    private readonly scopeButtons: Record<SettingsScope, HTMLButtonElement>;
    private readonly settingControls: SettingControlMap;
    /** dirty マーク表示先の TabButton（Tab から inject される） */
    private readonly tabButton: TabButton;
    private readonly documentKeydownHandler: (event: KeyboardEvent) => void;
    private readonly documentClickHandler: (event: MouseEvent) => void;
    private readonly collapsedSections = new Set<string>();
    private readonly undoStack: SettingsHistoryEntry[];
    private readonly redoStack: SettingsHistoryEntry[];
    private nextSectionId = 0;

    constructor(tabButton: TabButton) {
        this.tabButton = tabButton;
        this.settingControls = {};
        this.undoStack = [];
        this.redoStack = [];
        this.documentKeydownHandler = (event: KeyboardEvent) => {
            if (!this.isVisible()) return;
            this.handleKeyDown(event);
        };
        document.addEventListener('keydown', this.documentKeydownHandler, true);
        this.documentClickHandler = (event: MouseEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            for (const control of this.getSettingControls()) {
                if (control.close === undefined) continue;
                if (control.containsTarget?.(target) === true) continue;
                control.close();
            }
        };
        document.addEventListener('click', this.documentClickHandler);

        // 設定パネル全体のコンテナ
        this.element = document.createElement('div');
        this.element.classList.add('settings-panel');

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

        const initialSettings = resolveDefaultedSettingsForScopeView(this.activeScope, loadedSettingsState);
        for (const settingSection of SETTING_SECTIONS) {
            const section = this.createSection(settingSection.label);
            const sectionItems = this.getSectionItemsElement(section);
            for (const key of SETTING_KEYS.filter(settingKey => SETTING_DEFINITIONS[settingKey].section === settingSection.id)) {
                const control = this.createSettingControl(key, initialSettings[key] as SettingValue);
                this.settingControls[key] = control;
                sectionItems.appendChild(this.createSettingRow(
                    key,
                    control.root,
                    SETTING_DEFINITIONS[key].rowElement ?? 'div',
                ));
            }
            this.element.appendChild(section);
        }
        this.updateScopeButtonStyles();
        this.updateSettingDifferenceMarkers();
    }

    private createSettingRow(
        key: SettingsKey,
        control: HTMLElement,
        elementName: SettingRowElementName = 'div',
    ): HTMLElement {
        const row = document.createElement(elementName);
        row.classList.add('settings-label');
        row.dataset.settingKey = key;

        const labelText = document.createElement('span');
        labelText.classList.add('settings-label-text');
        labelText.textContent = getSettingLabel(key);

        row.appendChild(labelText);
        row.appendChild(control);
        row.appendChild(this.createSettingResetButton(key));
        return row;
    }

    private getSettingControls(): SettingControl[] {
        return SETTING_KEYS
            .map(key => this.settingControls[key])
            .filter((control): control is SettingControl => control !== undefined);
    }

    private getSettingControl(key: SettingsKey): SettingControl {
        const control = this.settingControls[key];
        if (control === undefined) throw new Error(`[SettingsPanel] setting control is not initialized: ${key}`);
        return control;
    }

    private createSettingControl(key: SettingsKey, value: SettingValue): SettingControl {
        const definition = SETTING_DEFINITIONS[key];
        switch (definition.control) {
            case 'select':
                return this.createSelectSettingControl(key, value);
            case 'toggle':
                return this.createToggleSettingControl(key, value);
            case 'dateTime':
                return this.createDateTimeSettingControl(key, value);
            case 'text':
                return this.createTextSettingControl(key, value);
            case 'number':
                return this.createNumberSettingControl(key, value);
        }
    }

    private createSelectSettingControl(key: SettingsKey, value: SettingValue): SettingControl {
        const dropdown = document.createElement('div');
        dropdown.classList.add('settings-dropdown');

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.classList.add('settings-dropdown-trigger');

        const selectedLabel = document.createElement('span');
        const chevron = document.createElement('span');
        chevron.classList.add('settings-dropdown-chevron');
        chevron.textContent = '\u25BC';
        trigger.appendChild(selectedLabel);
        trigger.appendChild(chevron);

        const list = document.createElement('div');
        list.classList.add('settings-dropdown-list');
        for (const option of getSettingOptions(key)) {
            const item = document.createElement('div');
            item.classList.add('settings-dropdown-item');
            item.dataset.value = String(option.value);
            item.textContent = option.label;
            item.addEventListener('click', () => {
                this.commitSettingValue(key, option.value, `save ${String(key)} failed`);
                list.classList.remove('visible');
            });
            list.appendChild(item);
        }

        let selectedValue = value;
        const setValue = (nextValue: SettingValue): void => {
            selectedValue = nextValue;
            selectedLabel.textContent = getSettingOptionLabel(key, nextValue as SettingValueFor<typeof key>);
            this.updateSelectItemStyles(list, selectedValue);
        };

        trigger.addEventListener('click', () => { list.classList.toggle('visible'); });
        dropdown.appendChild(trigger);
        dropdown.appendChild(list);
        setValue(value);
        return {
            root: dropdown,
            getValue: () => selectedValue,
            setValue,
            close: () => { list.classList.remove('visible'); },
            containsTarget: (target: Node) => dropdown.contains(target),
        };
    }

    private createToggleSettingControl(key: SettingsKey, value: SettingValue): SettingControl {
        const definition = SETTING_DEFINITIONS[key];
        const root = document.createElement('label');
        root.classList.add('settings-toggle', ...(definition.rootClassNames ?? []));

        const input = document.createElement('input');
        input.classList.add('settings-toggle-input', ...(definition.inputClassNames ?? []));
        input.type = 'checkbox';
        let selectedValue = value === true;
        input.checked = selectedValue;
        input.addEventListener('change', () => {
            this.commitSettingValue(key, input.checked, `save ${String(key)} failed`);
        });

        const track = document.createElement('span');
        track.classList.add('settings-toggle-track');
        const thumb = document.createElement('span');
        thumb.classList.add('settings-toggle-thumb');
        track.appendChild(thumb);

        root.appendChild(input);
        root.appendChild(track);
        return {
            root,
            getValue: () => selectedValue,
            setValue: (nextValue: SettingValue) => {
                selectedValue = nextValue === true;
                input.checked = selectedValue;
            },
            shouldLetNativeTextHistoryHandle: (target: EventTarget) => target === input ? false : null,
        };
    }

    private createDateTimeSettingControl(key: SettingsKey, value: SettingValue): SettingControl {
        const definition = SETTING_DEFINITIONS[key];
        let selectedValue = normalizeDateTimeInputToSeconds(String(value)) ?? String(value);
        const picker = new DateTimePicker({
            value: selectedValue,
            rootClassNames: ['settings-date-time-picker', ...(definition.rootClassNames ?? [])],
            inputClassNames: ['settings-datetime-input', ...(definition.inputClassNames ?? [])],
            onCommit: (nextValue: string) => {
                this.commitSettingValue(
                    key,
                    normalizeDateTimeInputToSeconds(nextValue) ?? nextValue.trim(),
                    `save ${String(key)} failed`,
                );
            },
        });
        return {
            root: picker.getElement(),
            getValue: () => selectedValue,
            setValue: (nextValue: SettingValue) => {
                selectedValue = normalizeDateTimeInputToSeconds(String(nextValue)) ?? String(nextValue);
                picker.setValue(selectedValue);
            },
            close: () => { picker.close(); },
            destroy: () => { picker.destroy(); },
            containsTarget: (target: Node) => picker.getElement().contains(target),
            shouldLetNativeTextHistoryHandle: (target: EventTarget) => {
                const input = picker.getInput();
                return target === input ? input.value !== selectedValue : null;
            },
        };
    }

    private createTextSettingControl(key: SettingsKey, value: SettingValue): SettingControl {
        const definition = SETTING_DEFINITIONS[key];
        const input = document.createElement('input');
        input.classList.add('settings-text-input', ...(definition.inputClassNames ?? []));
        input.type = 'text';
        let selectedValue = String(value);
        input.value = selectedValue;
        this.addTextInputCommitHandlers(input, () => {
            this.commitSettingValue(key, input.value.trim(), `save ${String(key)} failed`);
        });
        return {
            root: input,
            getValue: () => selectedValue,
            setValue: (nextValue: SettingValue) => {
                selectedValue = String(nextValue);
                input.value = selectedValue;
            },
            shouldLetNativeTextHistoryHandle: (target: EventTarget) => target === input ? input.value !== selectedValue : null,
        };
    }

    private createNumberSettingControl(key: SettingsKey, value: SettingValue): SettingControl {
        const definition = SETTING_DEFINITIONS[key];
        const input = document.createElement('input');
        input.classList.add('settings-number-input', ...(definition.inputClassNames ?? []));
        input.type = 'number';
        if (definition.min !== undefined) input.min = String(definition.min);
        if (definition.max !== undefined) input.max = String(definition.max);
        if (definition.step !== undefined) input.step = String(definition.step);

        let selectedValue = normalizeNumberSettingValue(key, Number(value));
        input.value = String(selectedValue);
        const commit = (): void => {
            const parsed = Number(input.value);
            const nextValue = Number.isFinite(parsed)
                ? normalizeNumberSettingValue(key, parsed)
                : selectedValue;
            this.commitSettingValue(key, nextValue, `save ${String(key)} failed`);
        };
        this.addTextInputCommitHandlers(input, commit);
        return {
            root: input,
            getValue: () => selectedValue,
            setValue: (nextValue: SettingValue) => {
                selectedValue = normalizeNumberSettingValue(key, Number(nextValue));
                input.value = String(selectedValue);
            },
            shouldLetNativeTextHistoryHandle: (target: EventTarget) => target === input ? input.value !== String(selectedValue) : null,
        };
    }

    private addTextInputCommitHandlers(input: HTMLInputElement, onCommit: () => void): void {
        input.addEventListener('change', onCommit);
        input.addEventListener('blur', onCommit);
    }

    private updateSelectItemStyles(list: HTMLElement, selectedValue: SettingValue): void {
        for (const item of Array.from(list.children) as HTMLElement[]) {
            item.classList.toggle('settings-dropdown-item-active', item.dataset.value === String(selectedValue));
        }
    }

    private commitSettingValue(key: SettingsKey, value: SettingValue, errorContext: string): void {
        const control = this.getSettingControl(key);
        if (control.getValue() === value) {
            control.setValue(value);
            return;
        }
        control.setValue(value);
        const patch: SettingsPatch = {};
        setSettingsPatchValue(patch, key, value as SettingsPatch[typeof key]);
        this.applyAndSaveSettingsPatch(patch, errorContext);
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
        const settings = resolveDefaultedSettingsForScopeView(this.activeScope, loadedSettingsState);
        for (const key of SETTING_KEYS) {
            this.getSettingControl(key).setValue(settings[key] as SettingValue);
        }
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
        const patch: SettingsPatch = {};
        setSettingsPatchValue(patch, key, defaults[key]);
        return patch;
    }

    private closeDropdown(): void {
        for (const control of this.getSettingControls()) {
            control.close?.();
        }
    }

    /**
     * 親要素にパネルを追加する
     */
    appendTo(parent: HTMLElement): void {
        parent.appendChild(this.element);
    }

    destroy(): void {
        document.removeEventListener('keydown', this.documentKeydownHandler, true);
        document.removeEventListener('click', this.documentClickHandler);
        for (const control of this.getSettingControls()) {
            control.destroy?.();
        }
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
        applySettingsStateToRuntime(loadedSettingsState, getChangedEffectiveSettingsKeys(before, after));
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
        for (const control of this.getSettingControls()) {
            const result = control.shouldLetNativeTextHistoryHandle?.(target);
            if (result !== undefined && result !== null) return result;
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
        const before = cloneSettingsState(loadedSettingsState);
        loadedSettingsState = cloneSettingsState(settingsState);
        this.activeScope = scope;
        this.closeDropdown();
        applySettingsStateToRuntime(loadedSettingsState, getChangedEffectiveSettingsKeys(before, loadedSettingsState));
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
 * アプリケーション起動時に User / Workspace の保存済み設定を読み込んで適用する
 */
export async function applyStoredSettingsAsync(): Promise<void> {
    loadedSettingsState = await readStoredSettingsAsync();
    applySettingsStateToRuntime(loadedSettingsState);
}
