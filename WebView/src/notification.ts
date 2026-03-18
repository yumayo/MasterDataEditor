/**
 * システムエラー通知ポップアップ
 *
 * 右下にトーストを最大3件スタック表示し、ベルマークアイコンで
 * 全履歴を一覧できる。Undo/Redo 不要（通知は副作用的UIで可逆操作なし）。
 *
 * クラス名は window.Notification (Push Notification API) との衝突を避けるため
 * NotificationToast とする。
 */
export class NotificationToast {
    /**
     * トースト表示中の要素とそのタイマーIDのマップ（最大MAX_TOASTS件）。
     * タイマーIDを保持することで、強制削除時に clearTimeout できる。
     */
    private readonly activeToasts: Map<HTMLElement, number>;
    /** ベルマーク要素 */
    private readonly bellElement: HTMLElement;
    /** トースト表示エリア */
    private readonly toastAreaElement: HTMLElement;
    /** 履歴パネル（DOMがSSOT: 履歴メッセージは直接DOM上に追記する） */
    private readonly historyElement: HTMLElement;

    /** 最大同時表示トースト数 */
    private static readonly MAX_TOASTS = 3;
    /** トーストの自動消去時間（ミリ秒） */
    private static readonly TOAST_DURATION_MS = 5000;
    /** フェードアウトアニメーション時間（ミリ秒） */
    private static readonly FADE_DURATION_MS = 400;

    constructor() {
        this.activeToasts = new Map();

        // コンテナ要素（右下固定）を構築して body 直下に配置する
        const container = document.createElement('div');
        container.classList.add('notification-container');

        // ベルマークSVGアイコンを構築する
        this.bellElement = document.createElement('div');
        this.bellElement.classList.add('notification-bell');
        this.bellElement.setAttribute('role', 'button');
        this.bellElement.setAttribute('tabindex', '0');
        this.bellElement.setAttribute('aria-label', '通知履歴を表示');
        // SVGは装飾用のためスクリーンリーダーから隠す
        this.bellElement.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
  <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/>
</svg>`;
        // クリック時に履歴パネルの表示/非表示を切り替える（1箇所のみの使用のためインライン展開）
        this.bellElement.addEventListener('click', () => {
            this.historyElement.classList.toggle('visible');
        });

        // トースト表示エリアを構築する
        this.toastAreaElement = document.createElement('div');
        this.toastAreaElement.classList.add('notification-toast-area');

        // 履歴パネルを構築する（初期状態は非表示）
        this.historyElement = document.createElement('div');
        this.historyElement.classList.add('notification-history');

        // コンテナ内の並び順: ベル → トーストエリア → 履歴パネル
        container.appendChild(this.bellElement);
        container.appendChild(this.toastAreaElement);
        container.appendChild(this.historyElement);

        document.body.appendChild(container);
    }

    /**
     * トーストポップアップを表示する。
     * 最大3件を超える場合は最も古いトーストを即時削除する（タイマーもキャンセル）。
     */
    show(message: string): void {
        // 最大件数を超える場合は最古のトーストを強制削除する
        if (this.activeToasts.size >= NotificationToast.MAX_TOASTS) {
            const oldest = this.activeToasts.keys().next().value;
            if (oldest == null) throw new Error('アクティブトースト配列が空です');
            const timerId = this.activeToasts.get(oldest);
            if (timerId == null) throw new Error('タイマーIDが存在しません');
            clearTimeout(timerId);
            this.activeToasts.delete(oldest);
            oldest.remove();
        }

        // 新しいトースト要素を生成してトーストエリアに追加する
        const toast = document.createElement('div');
        toast.classList.add('notification-toast');
        toast.setAttribute('role', 'alert');
        toast.textContent = message;
        this.toastAreaElement.appendChild(toast);

        // 5秒後に自動フェードアウト→削除するタイマーを設定し、IDをMapで管理する
        const outerTimerId = window.setTimeout(() => {
            toast.classList.add('fading');
            window.setTimeout(() => {
                toast.remove();
                this.activeToasts.delete(toast);
            }, NotificationToast.FADE_DURATION_MS);
        }, NotificationToast.TOAST_DURATION_MS);

        this.activeToasts.set(toast, outerTimerId);

        // 履歴パネルにDOMアイテムを直接追記する（DOMがSSOTのためメンバ配列は持たない）
        const item = document.createElement('div');
        item.classList.add('notification-history-item');
        item.textContent = message;
        this.historyElement.appendChild(item);
    }

    /**
     * activeToasts から指定の要素を削除する。
     * indexOf === -1 相当の「存在しない要素を削除しようとした場合」はプログラミングエラーとして throw する。
     */
    removeToast(toast: HTMLElement): void {
        if (!this.activeToasts.has(toast)) throw new Error('指定されたトースト要素はアクティブリストに存在しません');
        const timerId = this.activeToasts.get(toast);
        if (timerId == null) throw new Error('タイマーIDが存在しません');
        clearTimeout(timerId);
        this.activeToasts.delete(toast);
        toast.remove();
    }
}
