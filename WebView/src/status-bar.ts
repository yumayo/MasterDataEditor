import type {BottomPanel} from "./bottom-panel";
import type {NotificationToast} from "./notification";

/**
 * ステータスバー
 *
 * 画面最下部に常時表示される。
 * 左端: エラー件数バッジ（クリックでBottomPanelのPROBLEMSタブをトグル）
 * 右寄り: バックグラウンドタスクインジケーター（実行中タスクがある場合のみ表示、クリックでタスク一覧ポップオーバー）
 * 中央〜右寄り: 通知メッセージ欄（NotificationToastが配置される）
 * エラー0件でも "0" を表示する。
 *
 * 循環参照（StatusBar ↔ ValidationPanel → StatusBar）は Object.assign パターンで解決する。
 * main.ts で `Object.create({...})` による no-op stub を先に作り、
 * ValidationPanel・BottomPanel を生成した後、`new StatusBar(bottomPanel, notification)` で生成する。
 */
export class StatusBar {

    private readonly element: HTMLElement;
    private readonly badge: HTMLElement;
    private readonly badgeCount: HTMLElement;
    private readonly bottomPanel: BottomPanel;
    private readonly backgroundIndicator: HTMLElement;
    private readonly backgroundCount: HTMLElement;
    private readonly backgroundPopover: HTMLElement;
    private backgroundPopoverVisible: boolean;

    constructor(bottomPanel: BottomPanel, notification: NotificationToast) {
        this.bottomPanel = bottomPanel;
        this.backgroundPopoverVisible = false;

        const bar = document.createElement('div');
        bar.classList.add('status-bar');
        this.element = bar;

        // エラー件数バッジ（左端）— エラーアイコン + 件数でPROBLEMSパネルであることを示す
        // margin-right: auto で残りスペースをすべて占有し、後続要素を右端に押し出す
        const badge = document.createElement('div');
        badge.classList.add('status-bar-badge');
        badge.setAttribute('role', 'button');
        badge.setAttribute('tabindex', '0');
        badge.setAttribute('aria-label', 'PROBLEMSパネルを表示');
        badge.dataset.errorCount = '0';
        const errorIcon = document.createElement('span');
        errorIcon.classList.add('status-bar-badge-icon');
        errorIcon.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><circle cx="8" cy="8" r="6.5"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5"/></svg>`;
        badge.appendChild(errorIcon);
        const countSpan = document.createElement('span');
        countSpan.classList.add('status-bar-badge-count');
        countSpan.textContent = '0';
        badge.appendChild(countSpan);
        badge.addEventListener('click', () => { this.bottomPanel.toggleTab('problems'); });
        badge.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.bottomPanel.toggleTab('problems'); });
        bar.appendChild(badge);
        this.badge = badge;
        this.badgeCount = countSpan;

        // 通知メッセージ欄をエラーバッジとスピナーの間に配置する
        // badge の margin-right:auto によって右端グループに押し出される
        notification.appendTo(bar);

        // バックグラウンドタスクインジケーター（通知メッセージ欄の右隣、右寄り）
        // badge の margin-right:auto によって右端グループに押し出される
        const bgIndicator = document.createElement('div');
        bgIndicator.classList.add('status-bar-background-indicator');
        bgIndicator.setAttribute('role', 'button');
        bgIndicator.setAttribute('tabindex', '0');
        bgIndicator.setAttribute('aria-label', '実行中のバックグラウンド処理');
        bgIndicator.style.display = 'none';

        const spinnerSpan = document.createElement('span');
        spinnerSpan.classList.add('status-bar-background-spinner');
        spinnerSpan.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8" cy="8" r="5.5" stroke-dasharray="20 15" stroke-linecap="round"/></svg>`;
        bgIndicator.appendChild(spinnerSpan);

        const bgCountSpan = document.createElement('span');
        bgCountSpan.classList.add('status-bar-background-count');
        bgIndicator.appendChild(bgCountSpan);

        // ポップオーバー（インジケーター直上に展開）
        const bgPopover = document.createElement('div');
        bgPopover.classList.add('status-bar-background-popover');
        bgPopover.style.display = 'none';
        bgIndicator.appendChild(bgPopover);

        bgIndicator.addEventListener('click', () => { this.toggleBackgroundPopover(); });
        bgIndicator.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.toggleBackgroundPopover();
            }
        });

        bar.appendChild(bgIndicator);
        this.backgroundIndicator = bgIndicator;
        this.backgroundCount = bgCountSpan;
        this.backgroundPopover = bgPopover;
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
     * バックグラウンドタスク一覧を更新する。
     * BackgroundTaskTracker から呼ばれる。
     * タスクが0件になった場合はインジケーターを非表示にする。
     */
    updateBackgroundTasks(tasks: ReadonlyMap<number, string>): void {
        const count = tasks.size;
        this.renderPopoverContent(tasks);
        if (count === 0) {
            this.backgroundIndicator.style.display = 'none';
            this.closeBackgroundPopover();
            return;
        }
        this.backgroundIndicator.style.display = '';
        this.backgroundCount.textContent = String(count);
    }

    /**
     * ステータスバーを親要素に追加する（main.ts から呼ばれる）
     */
    appendTo(parent: HTMLElement): void {
        parent.appendChild(this.element);
    }

    private toggleBackgroundPopover(): void {
        if (this.backgroundPopoverVisible) {
            this.closeBackgroundPopover();
        } else {
            this.openBackgroundPopover();
        }
    }

    private openBackgroundPopover(): void {
        this.backgroundPopoverVisible = true;
        this.backgroundPopover.style.display = '';
    }

    private closeBackgroundPopover(): void {
        this.backgroundPopoverVisible = false;
        this.backgroundPopover.style.display = 'none';
    }

    private renderPopoverContent(tasks: ReadonlyMap<number, string>): void {
        while (this.backgroundPopover.firstChild) {
            this.backgroundPopover.removeChild(this.backgroundPopover.firstChild);
        }
        const title = document.createElement('div');
        title.classList.add('status-bar-background-popover-title');
        title.textContent = `バックグラウンド処理 (${tasks.size}件)`;
        this.backgroundPopover.appendChild(title);
        const list = document.createElement('div');
        list.classList.add('status-bar-background-popover-list');
        tasks.forEach((label) => {
            const item = document.createElement('div');
            item.classList.add('status-bar-background-popover-item');
            item.textContent = label;
            list.appendChild(item);
        });
        this.backgroundPopover.appendChild(list);
    }
}
