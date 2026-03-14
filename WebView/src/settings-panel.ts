import {TabButton} from "./tab-button";

/**
 * 設定画面パネル
 * テーマ選択プルダウンを提供する。
 * - change イベントで body[data-theme] を即時更新（プレビュー）
 * - dirty 状態は savedTheme との差分で判定し、TabButton に直接反映する
 * - save() で localStorage に永続化し dirty を解除する
 */

/** localStorage に保存するテーマ設定のキー */
const THEME_STORAGE_KEY = 'master-data-editor-theme';

export class SettingsPanel {
    private readonly element: HTMLElement;
    private readonly themeSelect: HTMLSelectElement;
    /** 最後に保存されたテーマ値（dirty 判定の基準） */
    private savedTheme: string;
    /** dirty マーク表示先の TabButton（Tab から inject される） */
    private readonly tabButton: TabButton;

    constructor(tabButton: TabButton) {
        this.tabButton = tabButton;

        // localStorage から保存済みテーマを読み込む（未保存の場合は 'dark' をデフォルトとして使用）
        const stored = localStorage.getItem(THEME_STORAGE_KEY);
        this.savedTheme = stored !== null ? stored : 'dark';

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

        // プルダウン変更時に即時プレビューと dirty 判定を行う
        this.themeSelect.addEventListener('change', () => {
            document.body.dataset.theme = this.themeSelect.value;
            this.tabButton.setDirty(this.isDirty());
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
     * Ctrl+S 時に呼ばれる
     */
    save(): void {
        const currentTheme = this.themeSelect.value;
        localStorage.setItem(THEME_STORAGE_KEY, currentTheme);
        this.savedTheme = currentTheme;
        this.tabButton.setDirty(false);
    }

    /**
     * 現在の選択値が保存済みテーマと異なるかどうかを返す
     */
    isDirty(): boolean {
        return this.themeSelect.value !== this.savedTheme;
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
