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
    private readonly validationPanel: ValidationPanel;

    constructor(validationPanel: ValidationPanel, notification: NotificationToast) {
        this.validationPanel = validationPanel;

        const bar = document.createElement('div');
        bar.classList.add('status-bar');
        this.element = bar;

        // エラー件数バッジ（左端）
        const badge = document.createElement('div');
        badge.classList.add('status-bar-badge');
        badge.setAttribute('role', 'button');
        badge.setAttribute('tabindex', '0');
        badge.dataset.errorCount = '0';
        badge.textContent = '0';
        badge.addEventListener('click', () => { this.validationPanel.toggleVisibility(); });
        badge.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.validationPanel.toggleVisibility(); });
        bar.appendChild(badge);
        this.badge = badge;

        // 通知ベルアイコンをステータスバー右端に配置する（badgeのmargin-right:autoでベルが右端に押し出される）
        notification.appendTo(bar);
    }

    /**
     * エラー件数を更新する。
     * ValidationPanel から呼ばれる。
     */
    updateCount(count: number): void {
        const text = String(count);
        this.badge.textContent = text;
        this.badge.dataset.errorCount = text;
    }

    /**
     * ステータスバーを親要素に追加する（Editor から呼ばれる）
     */
    appendTo(parent: HTMLElement): void {
        parent.appendChild(this.element);
    }
}
