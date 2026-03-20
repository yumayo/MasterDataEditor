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
    private readonly themeSelect: HTMLSelectElement;
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

        const label = document.createElement('label');
        label.classList.add('settings-label');
        label.textContent = 'テーマ';

        this.themeSelect = document.createElement('select');
        this.themeSelect.classList.add('settings-theme-select');

        const darkOption = document.createElement('option');
        darkOption.value = 'dark';
        darkOption.textContent = 'ダーク';

        const lightOption = document.createElement('option');
        lightOption.value = 'light';
        lightOption.textContent = 'ライト';

        this.themeSelect.appendChild(darkOption);
        this.themeSelect.appendChild(lightOption);

        // 現在の body[data-theme] を初期値として反映する
        // index.html の <body data-theme="dark"> で初期値が設定され、applyStoredTheme() が
        // main.ts で SettingsPanel 生成前に必ず呼ばれるため、getAttribute は常に非 null を返す
        const currentTheme = document.body.getAttribute('data-theme')!;
        this.themeSelect.value = currentTheme;

        // プルダウン変更時に即時プレビューと自動保存を行う
        this.themeSelect.addEventListener('change', () => {
            document.body.dataset.theme = this.themeSelect.value;
            this.save();
        });

        label.appendChild(this.themeSelect);
        section.appendChild(label);
        this.element.appendChild(section);
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
        localStorage.setItem(THEME_STORAGE_KEY, this.themeSelect.value);
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
