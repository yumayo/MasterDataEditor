import {TabButton} from "./tab-button";

/**
 * 設定画面パネル
 * テーマ選択プルダウンを提供する。
 * - change イベントで body[data-theme] を即時更新し、自動的に localStorage へ保存する
 * - Ctrl+S による手動保存も引き続き動作する（冪等）
 */

/** localStorage に保存するテーマ設定のキー */
const THEME_STORAGE_KEY = 'master-data-editor-theme';

export class SettingsPanel {
    private readonly element: HTMLElement;
    private selectedTheme: string;
    private readonly selectedLabel: HTMLElement;
    private readonly dropdownList: HTMLElement;
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
        label.textContent = 'テーマ';

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

        const options: Array<{ value: string; text: string }> = [
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
        // index.html の <body data-theme="dark"> で初期値が設定され、applyStoredTheme() が
        // main.ts で SettingsPanel 生成前に必ず呼ばれるため、getAttribute は常に非 null を返す
        const currentTheme = document.body.getAttribute('data-theme')!;
        const currentOption = options.find(o => o.value === currentTheme)!;
        this.selectedTheme = currentOption.value;
        this.selectedLabel.textContent = currentOption.text;
        this.updateItemStyles();

        label.appendChild(dropdown);
        section.appendChild(label);
        this.element.appendChild(section);
    }

    private selectTheme(value: string, text: string): void {
        this.selectedTheme = value;
        this.selectedLabel.textContent = text;
        document.body.dataset.theme = value;
        this.updateItemStyles();
        this.save();
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
     * 現在の設定を localStorage に保存し、dirty 状態を解除する
     * change イベント（自動保存）および Ctrl+S（手動保存）の両方から呼ばれる
     */
    save(): void {
        localStorage.setItem(THEME_STORAGE_KEY, this.selectedTheme);
        this.tabButton.setDirty(false);
    }
}

/**
 * アプリケーション起動時に localStorage から保存済みテーマを読み込んで適用する
 * main.ts の初期化処理で呼ぶ
 */
export function applyStoredTheme(): void {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored !== null) {
        document.body.dataset.theme = stored;
    }
}
