import type {ValidationPanel} from "./validation-panel";
import type {NotificationToast} from "./notification";

/**
 * ステータスバー
 *
 * 画面最下部に常時表示される。
 * 左端: エラー件数バッジ（クリックでバリデーションパネルの表示/非表示をトグル）
 * 右端: 通知ベルアイコン（NotificationToastが配置される）
 * エラー0件でも "0" を表示する。
 *
 * 循環参照（StatusBar ↔ ValidationPanel）は Object.assign パターンで解決する。
 * main.ts で `const statusBar = {} as StatusBar` を先に作り、
 * ValidationPanel コンストラクタに渡した後、`new StatusBar(validationPanel, notification)` で生成する。
 */
export class StatusBar {

    private readonly element: HTMLElement;
    private readonly badge: HTMLElement;
    private readonly badgeCount: HTMLElement;
    private readonly validationPanel: ValidationPanel;

    constructor(validationPanel: ValidationPanel, notification: NotificationToast) {
        this.validationPanel = validationPanel;

        const bar = document.createElement('div');
        bar.classList.add('status-bar');
        this.element = bar;

        // エラー件数バッジ（左端）— エラーアイコン + 件数でPROBLEMSパネルであることを示す
        const badge = document.createElement('div');
        badge.classList.add('status-bar-badge');
        badge.setAttribute('role', 'button');
        badge.setAttribute('tabindex', '0');
        badge.setAttribute('aria-label', 'PROBLEMSパネルを表示');
        badge.dataset.errorCount = '0';
        // ×マークSVG（エラーを示すアイコン）
        const errorIcon = document.createElement('span');
        errorIcon.classList.add('status-bar-badge-icon');
        errorIcon.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><circle cx="8" cy="8" r="6.5"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5"/></svg>`;
        badge.appendChild(errorIcon);
        // 件数テキスト
        const countSpan = document.createElement('span');
        countSpan.classList.add('status-bar-badge-count');
        countSpan.textContent = '0';
        badge.appendChild(countSpan);
        badge.addEventListener('click', () => { this.validationPanel.toggleVisibility(); });
        badge.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.validationPanel.toggleVisibility(); });
        bar.appendChild(badge);
        this.badge = badge;
        this.badgeCount = countSpan;

        // 通知ベルアイコンをステータスバー右端に配置する（badgeのmargin-right:autoでベルが右端に押し出される）
        notification.appendTo(bar);
    }

    /**
     * エラー件数を更新する。
     * ValidationPanel から呼ばれる。
     */
    updateCount(count: number): void {
        const text = String(count);
        this.badgeCount.textContent = text;
        this.badge.dataset.errorCount = text;
    }

    /**
     * ステータスバーを親要素に追加する（Editor から呼ばれる）
     */
    appendTo(parent: HTMLElement): void {
        parent.appendChild(this.element);
    }
}
