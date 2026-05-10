import type {BottomPanel} from "../panels/bottom-panel";
import type {NotificationToast} from "./notification";

export interface StatusBarActions {
    toggleProblemsPanel(): void;
}

export function createStatusBarActions(): StatusBarActions {
    return {
        toggleProblemsPanel() {},
    };
}

export function bindStatusBarActions(actions: StatusBarActions, bottomPanel: BottomPanel): void {
    Object.assign(actions, {
        toggleProblemsPanel(): void {
            bottomPanel.toggleTab('problems');
        },
    } satisfies StatusBarActions);
}

function createStatusBarDom(notification: NotificationToast) {
    const bar = document.createElement('div');
    bar.classList.add('status-bar');

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
    bar.appendChild(badge);

    const notificationSlot = document.createElement('div');
    notificationSlot.classList.add('status-bar-notification-slot');
    notification.appendTo(notificationSlot);
    bar.appendChild(notificationSlot);

    // バックグラウンドタスクインジケーター（右寄り）
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
    bar.appendChild(bgIndicator);

    return {
        element: bar,
        badge,
        badgeCount: countSpan,
        backgroundIndicator: bgIndicator,
        backgroundCount: bgCountSpan,
        backgroundPopover: bgPopover,
    };
}

/**
 * ステータスバー
 *
 * 画面最下部に常時表示される。
 * 左端: エラー件数バッジ（クリックでBottomPanelのPROBLEMSタブをトグル）
 * 右寄り: バックグラウンドタスクインジケーター（実行中タスクがある場合のみ表示、クリックでタスク一覧ポップオーバー）
 * エラー0件でも "0" を表示する。
 *
 * constructor は固定DOMと action port を初期化する。BottomPanel 操作用の action port は
 * Object.assign で起動後段に実装する。
 */
export class StatusBar {

    private readonly element: HTMLElement;
    private readonly badge: HTMLElement;
    private readonly badgeCount: HTMLElement;
    private readonly backgroundIndicator: HTMLElement;
    private readonly backgroundCount: HTMLElement;
    private readonly backgroundPopover: HTMLElement;
    private readonly actions: StatusBarActions;

    constructor(actions: StatusBarActions, notification: NotificationToast) {
        const dom = createStatusBarDom(notification);
        this.actions = actions;
        this.element = dom.element;
        this.badge = dom.badge;
        this.badgeCount = dom.badgeCount;
        this.backgroundIndicator = dom.backgroundIndicator;
        this.backgroundCount = dom.backgroundCount;
        this.backgroundPopover = dom.backgroundPopover;
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
        if (this.element.isConnected) throw new Error('StatusBar は既にDOMに配置されています');
        this.attachEventHandlers();
        parent.appendChild(this.element);
    }

    private attachEventHandlers(): void {
        this.badge.addEventListener('click', () => { this.toggleProblemsPanel(); });
        this.badge.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.toggleProblemsPanel();
        });
        this.backgroundIndicator.addEventListener('click', () => { this.toggleBackgroundPopover(); });
        this.backgroundIndicator.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.toggleBackgroundPopover();
            }
        });
    }

    private toggleProblemsPanel(): void {
        this.actions.toggleProblemsPanel();
    }

    private toggleBackgroundPopover(): void {
        if (this.backgroundPopover.style.display !== 'none') {
            this.closeBackgroundPopover();
        } else {
            this.openBackgroundPopover();
        }
    }

    private openBackgroundPopover(): void {
        this.backgroundPopover.style.display = '';
    }

    private closeBackgroundPopover(): void {
        this.backgroundPopover.style.display = 'none';
    }

    private renderPopoverContent(tasks: ReadonlyMap<number, string>): void {
        const popover = this.backgroundPopover;
        while (popover.firstChild) {
            popover.removeChild(popover.firstChild);
        }
        const title = document.createElement('div');
        title.classList.add('status-bar-background-popover-title');
        title.textContent = `バックグラウンド処理 (${tasks.size}件)`;
        popover.appendChild(title);
        const list = document.createElement('div');
        list.classList.add('status-bar-background-popover-list');
        tasks.forEach((label) => {
            const item = document.createElement('div');
            item.classList.add('status-bar-background-popover-item');
            item.textContent = label;
            list.appendChild(item);
        });
        popover.appendChild(list);
    }
}
