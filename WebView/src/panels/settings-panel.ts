import {readFileAsync, writeFileAsync} from "../app/api";
import {TabButton} from "../tabs/tab-button";
import {SETTINGS_FILE} from "../config/userdata-path";
import {DateTimePicker, normalizeDateTimeInputToSeconds} from "../ui/date-time-picker";

/**
 * 設定画面パネル
 * テーマ選択とタブ折り返し設定を提供する。
 * - change イベントで body[data-theme] を即時更新し、自動的に userdata/settings.json へ保存する
 * - Ctrl+S による手動保存も引き続き動作する（冪等）
 */

type ThemeValue = 'dark' | 'light';

const DEFAULT_TAB_WRAP_ENABLED = false;
const DEFAULT_EXPORT_VALIDATION_DATE_TIME = '';
const DEFAULT_EXPORT_BEGIN_DATE_COLUMN_NAME = 'export_begin_date';
const DEFAULT_EXPORT_END_DATE_COLUMN_NAME = 'export_end_date';
const TAB_WRAP_ENABLED_CSS_VAR = '--tab-wrap-enabled';
const TAB_WRAP_ENABLED_CHANGED_EVENT = 'tab-wrap-enabled-changed';
export const EXPORT_VALIDATION_SETTINGS_CHANGED_EVENT = 'export-validation-settings-changed';

export interface ExportValidationSettings {
    dateTime: string;
    beginColumnName: string;
    endColumnName: string;
}

interface SettingsFile {
    theme?: ThemeValue;
    tabWrapEnabled: boolean;
    exportValidationDateTime: string;
    exportBeginDateColumnName: string;
    exportEndDateColumnName: string;
}

interface StoredSettings {
    theme: ThemeValue | null;
    tabWrapEnabled: boolean | null;
    exportValidationDateTime: string | null;
    exportBeginDateColumnName: string | null;
    exportEndDateColumnName: string | null;
}

function isThemeValue(value: unknown): value is ThemeValue {
    return value === 'dark' || value === 'light';
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
}

async function readSettingsRecordAsync(path: string): Promise<Record<string, unknown> | null> {
    try {
        const json = await readFileAsync(path);
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

async function readStoredSettingsAsync(): Promise<StoredSettings> {
    const settingsRecord = await readSettingsRecordAsync(SETTINGS_FILE);
    return {
        theme: readThemeFromRecord(settingsRecord),
        tabWrapEnabled: readTabWrapEnabledFromRecord(settingsRecord),
        exportValidationDateTime: readExportValidationDateTimeFromRecord(settingsRecord),
        exportBeginDateColumnName: readStringSettingFromRecord(settingsRecord, 'exportBeginDateColumnName'),
        exportEndDateColumnName: readStringSettingFromRecord(settingsRecord, 'exportEndDateColumnName'),
    };
}

async function writeSettingsFileAsync(settings: SettingsFile): Promise<void> {
    const data: Record<string, unknown> = {...(await readSettingsRecordAsync(SETTINGS_FILE) ?? {})};
    data['theme'] = settings.theme;
    data['tabWrapEnabled'] = settings.tabWrapEnabled;
    data['exportValidationDateTime'] = settings.exportValidationDateTime;
    data['exportBeginDateColumnName'] = settings.exportBeginDateColumnName;
    data['exportEndDateColumnName'] = settings.exportEndDateColumnName;
    await writeFileAsync(SETTINGS_FILE, data);
}

let settingsWriteChain: Promise<void> = Promise.resolve();

function enqueueSettingsWriteAsync(settings: SettingsFile): Promise<void> {
    const writePromise = settingsWriteChain
        .catch(() => undefined)
        .then(() => writeSettingsFileAsync(settings));
    settingsWriteChain = writePromise;
    return writePromise;
}

function parseAppliedTabWrapEnabled(): boolean {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(TAB_WRAP_ENABLED_CSS_VAR).trim();
    return raw === '1' || raw === 'true';
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
    private readonly collapsedSections = new Set<string>();
    private nextSectionId = 0;

    constructor(tabButton: TabButton) {
        this.tabButton = tabButton;

        // 設定パネル全体のコンテナ
        this.element = document.createElement('div');
        this.element.classList.add('settings-panel');

        // 表示設定セクション
        const displaySection = this.createSection('表示');
        const displaySectionItems = this.getSectionItemsElement(displaySection);

        const label = document.createElement('div');
        label.classList.add('settings-label');
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

        const options: Array<{ value: ThemeValue; text: string }> = [
            { value: 'dark', text: 'ダーク' },
            { value: 'light', text: 'ライト' },
        ];
        for (const opt of options) {
            const item = document.createElement('div');
            item.classList.add('settings-dropdown-item');
            item.dataset.value = opt.value;
            item.textContent = opt.text;
            item.addEventListener('click', () => {
                this.selectTheme(opt.value, opt.text);
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

        // 現在の body[data-theme] を初期値として反映する
        // index.html の <body data-theme="dark"> で初期値が設定され、applyStoredSettingsAsync() が
        // main.ts で SettingsPanel 生成前に必ず呼ばれるため、getAttribute は常に非 null を返す
        const currentTheme = document.body.getAttribute('data-theme')!;
        const currentOption = options.find(o => o.value === currentTheme)!;
        this.selectedTheme = currentOption.value;
        this.selectedLabel.textContent = currentOption.text;
        this.updateItemStyles();

        label.appendChild(dropdown);
        displaySectionItems.appendChild(label);

        const tabWrapLabel = document.createElement('div');
        tabWrapLabel.classList.add('settings-label');
        const tabWrapLabelText = document.createElement('span');
        tabWrapLabelText.classList.add('settings-label-text');
        tabWrapLabelText.textContent = 'タブを折り返す';
        tabWrapLabel.appendChild(tabWrapLabelText);

        const tabWrapControl = document.createElement('label');
        tabWrapControl.classList.add('settings-toggle', 'settings-tab-wrap-toggle');

        this.selectedTabWrapEnabled = parseAppliedTabWrapEnabled();
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
        displaySectionItems.appendChild(tabWrapLabel);
        this.element.appendChild(displaySection);

        // export_begin_date / export_end_date を使った出力フィルター時刻
        const exportValidationSection = this.createSection('出力フィルター');
        const exportValidationSectionItems = this.getSectionItemsElement(exportValidationSection);

        const exportValidationLabel = document.createElement('label');
        exportValidationLabel.classList.add('settings-label');
        const exportValidationLabelText = document.createElement('span');
        exportValidationLabelText.classList.add('settings-label-text');
        exportValidationLabelText.textContent = '出力フィルター時刻';
        exportValidationLabel.appendChild(exportValidationLabelText);

        const currentExportValidationSettings = getAppliedExportValidationSettings();
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
        exportValidationSectionItems.appendChild(exportValidationLabel);

        const exportBeginDateColumnLabel = document.createElement('label');
        exportBeginDateColumnLabel.classList.add('settings-label');
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
        exportValidationSectionItems.appendChild(exportBeginDateColumnLabel);

        const exportEndDateColumnLabel = document.createElement('label');
        exportEndDateColumnLabel.classList.add('settings-label');
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
        exportValidationSectionItems.appendChild(exportEndDateColumnLabel);

        this.element.appendChild(exportValidationSection);
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

    private selectTheme(value: ThemeValue, text: string): void {
        this.selectedTheme = value;
        this.selectedLabel.textContent = text;
        document.body.dataset.theme = value;
        this.updateItemStyles();
        this.saveTheme();
    }

    private selectTabWrapEnabled(value: boolean): void {
        this.selectedTabWrapEnabled = value;
        applyTabWrapEnabled(value);
        this.saveTabLayout();
    }

    private selectExportValidationDateTime(value: string): void {
        this.selectedExportValidationDateTime = normalizeDateTimeInputToSeconds(value) ?? value.trim();
        this.exportValidationDateTimePicker.setValue(this.selectedExportValidationDateTime);
        applyExportValidationDateTime(this.selectedExportValidationDateTime);
        this.saveExportValidationDateTime();
    }

    private selectExportValidationColumnNames(beginColumnName: string, endColumnName: string): void {
        this.selectedExportBeginDateColumnName = beginColumnName.trim();
        this.selectedExportEndDateColumnName = endColumnName.trim();
        this.exportBeginDateColumnNameInput.value = this.selectedExportBeginDateColumnName;
        this.exportEndDateColumnNameInput.value = this.selectedExportEndDateColumnName;
        applyExportValidationColumnNames(this.selectedExportBeginDateColumnName, this.selectedExportEndDateColumnName);
        this.saveExportValidationColumnNames();
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
    }

    /**
     * 現在の設定を保存し、dirty 状態を解除する
     * change イベント（自動保存）および Ctrl+S（手動保存）の両方から呼ばれる
     */
    save(): void {
        this.writeSettingsAsync()
            .then(() => { this.tabButton.setDirty(false); })
            .catch((error: unknown) => {
                console.error('[SettingsPanel] save failed:', String(error));
                this.tabButton.setDirty(true);
            });
    }

    private saveTheme(): void {
        this.writeSettingsAsync()
            .then(() => { this.tabButton.setDirty(false); })
            .catch((error: unknown) => {
                console.error('[SettingsPanel] save theme failed:', String(error));
                this.tabButton.setDirty(true);
            });
    }

    private saveTabLayout(): void {
        this.writeSettingsAsync()
            .then(() => { this.tabButton.setDirty(false); })
            .catch((error: unknown) => {
                console.error('[SettingsPanel] save tab layout failed:', String(error));
                this.tabButton.setDirty(true);
            });
    }

    private saveExportValidationDateTime(): void {
        this.writeSettingsAsync()
            .then(() => { this.tabButton.setDirty(false); })
            .catch((error: unknown) => {
                console.error('[SettingsPanel] save export validation date time failed:', String(error));
                this.tabButton.setDirty(true);
            });
    }

    private saveExportValidationColumnNames(): void {
        this.writeSettingsAsync()
            .then(() => { this.tabButton.setDirty(false); })
            .catch((error: unknown) => {
                console.error('[SettingsPanel] save export validation column names failed:', String(error));
                this.tabButton.setDirty(true);
            });
    }

    private async writeSettingsAsync(): Promise<void> {
        await enqueueSettingsWriteAsync({
            theme: this.selectedTheme,
            tabWrapEnabled: this.selectedTabWrapEnabled,
            exportValidationDateTime: this.selectedExportValidationDateTime,
            exportBeginDateColumnName: this.selectedExportBeginDateColumnName,
            exportEndDateColumnName: this.selectedExportEndDateColumnName,
        });
    }
}

/**
 * アプリケーション起動時に userdata/settings.json から保存済みテーマを読み込んで適用する
 */
export async function applyStoredThemeAsync(): Promise<void> {
    const settings = await readStoredSettingsAsync();
    if (settings.theme !== null) {
        document.body.dataset.theme = settings.theme;
    }
}

/**
 * アプリケーション起動時に保存済み設定を読み込んで適用する
 */
export async function applyStoredSettingsAsync(): Promise<void> {
    const settings = await readStoredSettingsAsync();
    if (settings.theme !== null) {
        document.body.dataset.theme = settings.theme;
    }
    applyTabWrapEnabled(settings.tabWrapEnabled ?? DEFAULT_TAB_WRAP_ENABLED);
    applyExportValidationSettings({
        dateTime: settings.exportValidationDateTime ?? DEFAULT_EXPORT_VALIDATION_DATE_TIME,
        beginColumnName: settings.exportBeginDateColumnName ?? DEFAULT_EXPORT_BEGIN_DATE_COLUMN_NAME,
        endColumnName: settings.exportEndDateColumnName ?? DEFAULT_EXPORT_END_DATE_COLUMN_NAME,
    });
}
