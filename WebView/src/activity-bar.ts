/**
 * アクティビティバーの項目種別
 * erDiagram はサイドバーパネルではなく専用タブを開く特別なアイテム
 */
export type ActivityBarItem = 'files' | 'references' | 'search' | 'bookmarks' | 'erDiagram' | 'sourceControl';

/**
 * ファイルアイコン（SVG）
 */
const FILES_ICON_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M17.5 0H8.5L7 1.5V6H2.5L1 7.5V22.5699L2.5 24H14.5699L16 22.5699V18H20.7L22 16.5699V4.5L17.5 0ZM17.5 2.12L19.88 4.5H17.5V2.12ZM14.5 22.5H2.5V7.5H7V16.5699L8.5 18H14.5V22.5ZM20.5 16.5H8.5V1.5H16V6H20.5V16.5Z" fill="currentColor"/>
</svg>`;

/**
 * リファレンスアイコン（SVG）
 */
const REFERENCES_ICON_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M11 3H13V11.17L15.59 8.58L17 10L12 15L7 10L8.41 8.58L11 11.17V3Z" fill="currentColor"/>
  <path d="M4 17V19H20V17H4Z" fill="currentColor"/>
  <path d="M4 21V23H20V21H4Z" fill="currentColor"/>
</svg>`;

/**
 * 検索アイコン（SVG虫眼鏡）
 */
const SEARCH_ICON_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M15.25 1C11.528 1 8.5 4.028 8.5 7.75C8.5 9.295 9.04 10.713 9.94 11.83L2.22 19.56L3.64 20.98L11.37 13.25C12.487 14.15 13.905 14.5 15.25 14.5C18.972 14.5 22 11.472 22 7.75C22 4.028 18.972 1 15.25 1ZM15.25 12.5C12.632 12.5 10.5 10.368 10.5 7.75C10.5 5.132 12.632 3 15.25 3C17.868 3 20 5.132 20 7.75C20 10.368 17.868 12.5 15.25 12.5Z" fill="currentColor"/>
</svg>`;

/**
 * ブックマークアイコン（SVG — 旗/しおり形状）
 */
const BOOKMARKS_ICON_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M17 3H7C5.9 3 5 3.9 5 5V21L12 18L19 21V5C19 3.9 18.1 3 17 3ZM17 18L12 15.82L7 18V5H17V18Z" fill="currentColor"/>
</svg>`;

/**
 * ER図アイコン（SVG — ノード＋エッジ形状）
 * 2つの矩形ノードを線で結んだER図を表現する
 */
const ER_DIAGRAM_ICON_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="2" y="3" width="8" height="6" rx="1" stroke="currentColor" stroke-width="1.5"/>
  <rect x="14" y="15" width="8" height="6" rx="1" stroke="currentColor" stroke-width="1.5"/>
  <path d="M6 9V12H18V15" stroke="currentColor" stroke-width="1.5"/>
</svg>`;

/**
 * ソース管理アイコン（SVG — gitブランチ形状）
 * 上部1ノード（コミット元）から下部2ノード（ブランチ先）への分岐をcircleと線で表現する
 */
const SOURCE_CONTROL_ICON_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="12" cy="4" r="2.5" stroke="currentColor" stroke-width="1.5"/>
  <circle cx="6" cy="20" r="2.5" stroke="currentColor" stroke-width="1.5"/>
  <circle cx="18" cy="20" r="2.5" stroke="currentColor" stroke-width="1.5"/>
  <path d="M12 6.5V11M12 11C12 15 6 15 6 17.5M12 11C12 15 18 15 18 17.5" stroke="currentColor" stroke-width="1.5" fill="none"/>
</svg>`;

/**
 * 歯車アイコン（SVG）
 */
const SETTINGS_ICON_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M19.14 12.94C19.18 12.64 19.2 12.33 19.2 12C19.2 11.68 19.18 11.36 19.13 11.06L21.16 9.48C21.34 9.34 21.39 9.07 21.28 8.87L19.36 5.55C19.24 5.33 18.99 5.26 18.77 5.33L16.38 6.29C15.88 5.91 15.35 5.59 14.76 5.35L14.4 2.81C14.36 2.57 14.16 2.4 13.92 2.4H10.08C9.84 2.4 9.65 2.57 9.61 2.81L9.25 5.35C8.66 5.59 8.12 5.92 7.63 6.29L5.24 5.33C5.02 5.25 4.77 5.33 4.65 5.55L2.74 8.87C2.62 9.08 2.66 9.34 2.86 9.48L4.89 11.06C4.84 11.36 4.8 11.69 4.8 12C4.8 12.31 4.82 12.64 4.87 12.94L2.84 14.52C2.66 14.66 2.61 14.93 2.72 15.13L4.64 18.45C4.76 18.67 5.01 18.74 5.23 18.67L7.62 17.71C8.12 18.09 8.65 18.41 9.24 18.65L9.6 21.19C9.65 21.43 9.84 21.6 10.08 21.6H13.92C14.16 21.6 14.36 21.43 14.39 21.19L14.75 18.65C15.34 18.41 15.88 18.09 16.37 17.71L18.76 18.67C18.98 18.75 19.23 18.67 19.35 18.45L21.27 15.13C21.39 14.91 21.34 14.66 21.15 14.52L19.14 12.94ZM12 15.6C10.02 15.6 8.4 13.98 8.4 12C8.4 10.02 10.02 8.4 12 8.4C13.98 8.4 15.6 10.02 15.6 12C15.6 13.98 13.98 15.6 12 15.6Z" fill="currentColor"/>
</svg>`;

/**
 * アクティビティバー
 * 左端の48px幅のアイコン列
 */
export class ActivityBar {
    private readonly element: HTMLElement;
    private activeItem: ActivityBarItem;
    private readonly filesButton: HTMLElement;
    private readonly referencesButton: HTMLElement;
    private readonly searchButton: HTMLElement;
    private readonly bookmarksButton: HTMLElement;
    private readonly erDiagramButton: HTMLElement;
    private readonly sourceControlButton: HTMLElement;
    private readonly onItemClick: (item: ActivityBarItem) => void;
    private readonly onSettingsClick: () => void;

    constructor(onItemClick: (item: ActivityBarItem) => void, onSettingsClick: () => void) {
        this.onItemClick = onItemClick;
        this.onSettingsClick = onSettingsClick;
        this.activeItem = 'files';

        this.element = document.createElement('div');
        this.element.classList.add('activity-bar');

        this.filesButton = this.createButton(FILES_ICON_SVG, 'files');
        this.referencesButton = this.createButton(REFERENCES_ICON_SVG, 'references');
        this.searchButton = this.createButton(SEARCH_ICON_SVG, 'search');
        this.bookmarksButton = this.createButton(BOOKMARKS_ICON_SVG, 'bookmarks');
        this.erDiagramButton = this.createButton(ER_DIAGRAM_ICON_SVG, 'erDiagram');
        this.sourceControlButton = this.createButton(SOURCE_CONTROL_ICON_SVG, 'sourceControl');

        // 配置順序: files, references, search, bookmarks, erDiagram, sourceControl
        this.element.appendChild(this.filesButton);
        this.element.appendChild(this.referencesButton);
        this.element.appendChild(this.searchButton);
        this.element.appendChild(this.bookmarksButton);
        this.element.appendChild(this.erDiagramButton);
        this.element.appendChild(this.sourceControlButton);

        // 歯車ボタンは margin-top: auto で下部固定
        const settingsButton = document.createElement('div');
        settingsButton.classList.add('activity-bar-item', 'activity-bar-settings');
        settingsButton.innerHTML = SETTINGS_ICON_SVG;
        settingsButton.setAttribute('data-panel', 'settings');
        settingsButton.addEventListener('click', () => { this.onSettingsClick(); });
        this.element.appendChild(settingsButton);

        this.updateActiveState();
    }

    /**
     * アクティビティバーを親要素に追加する
     */
    appendTo(parent: HTMLElement): void {
        parent.appendChild(this.element);
    }

    /**
     * アクティブなアイテムを切り替える
     */
    activateItem(item: ActivityBarItem): void {
        this.activeItem = item;
        this.updateActiveState();
    }

    /**
     * アイコンボタンを作成する
     */
    private createButton(svgHtml: string, item: ActivityBarItem): HTMLElement {
        const button = document.createElement('div');
        button.classList.add('activity-bar-item');
        button.innerHTML = svgHtml;
        button.setAttribute('data-panel', item);
        button.addEventListener('click', () => {
            this.activateItem(item);
            this.onItemClick(item);
        });
        return button;
    }

    /**
     * ソース管理アイコンにバッジを表示/非表示する
     * count > 0: バッジ要素を作成または更新して変更ファイル数を表示する
     * count === 0: バッジ要素をDOMから除去する
     */
    updateSourceControlBadge(count: number): void {
        const existing = this.sourceControlButton.querySelector('.activity-bar-badge');
        if (count === 0) {
            if (existing) existing.remove();
            return;
        }
        if (existing) {
            existing.textContent = String(count);
            return;
        }
        // バッジ要素を新規作成してソース管理ボタンの子要素として追加する
        const badge = document.createElement('span');
        badge.classList.add('activity-bar-badge');
        badge.textContent = String(count);
        this.sourceControlButton.appendChild(badge);
    }

    /**
     * アクティブ状態の視覚表現を更新する
     */
    private updateActiveState(): void {
        this.filesButton.classList.toggle('activity-bar-item-active', this.activeItem === 'files');
        this.referencesButton.classList.toggle('activity-bar-item-active', this.activeItem === 'references');
        this.searchButton.classList.toggle('activity-bar-item-active', this.activeItem === 'search');
        this.bookmarksButton.classList.toggle('activity-bar-item-active', this.activeItem === 'bookmarks');
        this.erDiagramButton.classList.toggle('activity-bar-item-active', this.activeItem === 'erDiagram');
        this.sourceControlButton.classList.toggle('activity-bar-item-active', this.activeItem === 'sourceControl');
    }
}
