import {readFileAsync, writeFileAsync} from "../app/api";
import {TabButton} from "../tabs/tab-button";
import {TAB_LAYOUT_SETTINGS_FILE, THEME_SETTINGS_FILE} from "../config/userdata-path";

/**
 * 設定画面パネル
 * テーマ選択とタブ折り返し設定を提供する。
 * - change イベントで body[data-theme] を即時更新し、自動的に userdata/theme.json へ保存する
 * - Ctrl+S による手動保存も引き続き動作する（冪等）
 */

type ThemeValue = 'dark' | 'light';

const DEFAULT_TAB_WRAP_ENABLED = false;
const TAB_WRAP_ENABLED_CSS_VAR = '--tab-wrap-enabled';
const TAB_WRAP_ENABLED_CHANGED_EVENT = 'tab-wrap-enabled-changed';

interface ThemeSettingsFile {
    theme: ThemeValue;
}

interface TabLayoutSettingsFile {
    tabWrapEnabled: boolean;
}

function isThemeValue(value: unknown): value is ThemeValue {
    return value === 'dark' || value === 'light';
}

async function readStoredThemeAsync(): Promise<ThemeValue | null> {
    try {
        const json = await readFileAsync(THEME_SETTINGS_FILE);
        const parsed = JSON.parse(json) as Record<string, unknown>;
        return isThemeValue(parsed['theme']) ? parsed['theme'] : null;
    } catch {
        return null;
    }
}

async function readStoredTabWrapEnabledAsync(): Promise<boolean | null> {
    try {
        const json = await readFileAsync(TAB_LAYOUT_SETTINGS_FILE);
        const parsed = JSON.parse(json) as Record<string, unknown>;
        if (typeof parsed['tabWrapEnabled'] === 'boolean') {
            return parsed['tabWrapEnabled'];
        }
        if (typeof parsed['tabDisplayRowCount'] === 'number') {
            return parsed['tabDisplayRowCount'] > 1;
        }
        return null;
    } catch {
        return null;
    }
}

function parseAppliedTabWrapEnabled(): boolean {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(TAB_WRAP_ENABLED_CSS_VAR).trim();
    return raw === '1' || raw === 'true';
}

export function applyTabWrapEnabled(value: boolean): void {
    document.documentElement.style.setProperty(TAB_WRAP_ENABLED_CSS_VAR, value ? '1' : '0');
    window.dispatchEvent(new CustomEvent(TAB_WRAP_ENABLED_CHANGED_EVENT));
}

export class SettingsPanel {
    private readonly element: HTMLElement;
    private selectedTheme: ThemeValue;
    private readonly selectedLabel: HTMLElement;
    private readonly dropdownList: HTMLElement;
    private selectedTabWrapEnabled: boolean;
    private readonly tabWrapToggle: HTMLInputElement;
    /** dirty マーク表示先の TabButton（Tab から inject される） */
    private readonly tabButton: TabButton;

    constructor(tabButton: TabButton) {
        this.tabButton = tabButton;

        // 設定パネル全体のコンテナ
        this.element = document.createElement('div');
        this.element.classList.add('settings-panel');

        // テーマ設定セクション
        const section = document.createElement('div');
        section.classList.add('settings-section');

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
        section.appendChild(label);
        this.element.appendChild(section);

        // タブ折り返し設定セクション
        const tabWrapSection = document.createElement('div');
        tabWrapSection.classList.add('settings-section');

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
        tabWrapSection.appendChild(tabWrapLabel);
        this.element.appendChild(tabWrapSection);
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
        Promise.all([this.writeThemeAsync(), this.writeTabLayoutAsync()])
            .then(() => { this.tabButton.setDirty(false); })
            .catch((error: unknown) => {
                console.error('[SettingsPanel] save failed:', String(error));
                this.tabButton.setDirty(true);
            });
    }

    private saveTheme(): void {
        this.writeThemeAsync()
            .then(() => { this.tabButton.setDirty(false); })
            .catch((error: unknown) => {
                console.error('[SettingsPanel] save theme failed:', String(error));
                this.tabButton.setDirty(true);
            });
    }

    private saveTabLayout(): void {
        this.writeTabLayoutAsync()
            .then(() => { this.tabButton.setDirty(false); })
            .catch((error: unknown) => {
                console.error('[SettingsPanel] save tab layout failed:', String(error));
                this.tabButton.setDirty(true);
            });
    }

    private async writeThemeAsync(): Promise<void> {
        const data: ThemeSettingsFile = {theme: this.selectedTheme};
        await writeFileAsync(THEME_SETTINGS_FILE, JSON.stringify(data));
    }

    private async writeTabLayoutAsync(): Promise<void> {
        const data: TabLayoutSettingsFile = {tabWrapEnabled: this.selectedTabWrapEnabled};
        await writeFileAsync(TAB_LAYOUT_SETTINGS_FILE, JSON.stringify(data));
    }
}

/**
 * アプリケーション起動時に userdata/theme.json から保存済みテーマを読み込んで適用する
 */
export async function applyStoredThemeAsync(): Promise<void> {
    const stored = await readStoredThemeAsync();
    if (stored !== null) {
        document.body.dataset.theme = stored;
    }
}

/**
 * アプリケーション起動時に保存済み設定を読み込んで適用する
 */
export async function applyStoredSettingsAsync(): Promise<void> {
    const [theme, tabWrapEnabled] = await Promise.all([
        readStoredThemeAsync(),
        readStoredTabWrapEnabledAsync(),
    ]);
    if (theme !== null) {
        document.body.dataset.theme = theme;
    }
    applyTabWrapEnabled(tabWrapEnabled ?? DEFAULT_TAB_WRAP_ENABLED);
}
