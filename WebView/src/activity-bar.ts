/**
 * アクティビティバーの項目種別
 */
export type ActivityBarItem = 'files' | 'views' | 'references';

/**
 * ファイルアイコン（SVG）
 */
const FILES_ICON_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M17.5 0H8.5L7 1.5V6H2.5L1 7.5V22.5699L2.5 24H14.5699L16 22.5699V18H20.7L22 16.5699V4.5L17.5 0ZM17.5 2.12L19.88 4.5H17.5V2.12ZM14.5 22.5H2.5V7.5H7V16.5699L8.5 18H14.5V22.5ZM20.5 16.5H8.5V1.5H16V6H20.5V16.5Z" fill="currentColor"/>
</svg>`;

/**
 * ビューアイコン（SVG）— 重なった2つの矩形で複数テーブルのビュー合成を表現
 */
const VIEWS_ICON_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="2" y="4" width="14" height="10" rx="1" stroke="currentColor" stroke-width="1.5" fill="none"/>
  <rect x="8" y="10" width="14" height="10" rx="1" stroke="currentColor" stroke-width="1.5" fill="none"/>
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
 * アクティビティバー
 * 左端の48px幅のアイコン列
 */
export class ActivityBar {
    private readonly element: HTMLElement;
    private activeItem: ActivityBarItem;
    private readonly filesButton: HTMLElement;
    private readonly viewsButton: HTMLElement;
    private readonly referencesButton: HTMLElement;
    private readonly onItemClick: (item: ActivityBarItem) => void;

    constructor(onItemClick: (item: ActivityBarItem) => void) {
        this.onItemClick = onItemClick;
        this.activeItem = 'files';

        this.element = document.createElement('div');
        this.element.classList.add('activity-bar');

        this.filesButton = this.createButton(FILES_ICON_SVG, 'files');
        this.viewsButton = this.createButton(VIEWS_ICON_SVG, 'views');
        this.referencesButton = this.createButton(REFERENCES_ICON_SVG, 'references');

        this.element.appendChild(this.filesButton);
        this.element.appendChild(this.viewsButton);
        this.element.appendChild(this.referencesButton);

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
     * アクティブ状態の視覚表現を更新する
     */
    private updateActiveState(): void {
        this.filesButton.classList.toggle('activity-bar-item-active', this.activeItem === 'files');
        this.viewsButton.classList.toggle('activity-bar-item-active', this.activeItem === 'views');
        this.referencesButton.classList.toggle('activity-bar-item-active', this.activeItem === 'references');
    }
}
