/**
 * システムエラー通知ポップアップ
 *
 * ステータスバー右端にベルマークアイコンを配置し、
 * トーストと履歴パネルはステータスバーの上方に展開する。
 * Undo/Redo 不要（通知は副作用的UIで可逆操作なし）。
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
    /** ステータスバー内のコンテナ要素 */
    private readonly container: HTMLElement;

    /** 最大同時表示トースト数 */
    private static readonly MAX_TOASTS = 3;
    /** トーストの自動消去時間（ミリ秒） */
    private static readonly TOAST_DURATION_MS = 5000;
    /** フェードアウトアニメーション時間（ミリ秒） */
    private static readonly FADE_DURATION_MS = 400;

    constructor() {
        this.activeToasts = new Map();

        // コンテナ要素を構築する（ステータスバー内に配置される相対配置ラッパー）
        this.container = document.createElement('div');
        this.container.classList.add('notification-container');

        // ベルマークSVGアイコンを構築する
        this.bellElement = document.createElement('div');
        this.bellElement.classList.add('notification-bell');
        this.bellElement.setAttribute('role', 'button');
        this.bellElement.setAttribute('tabindex', '0');
        this.bellElement.setAttribute('aria-label', '通知履歴を表示');
        this.bellElement.setAttribute('aria-expanded', 'false');
        // SVGは装飾用のためスクリーンリーダーから隠す
        this.bellElement.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M18 16v-5c0-3.07-1.63-5.64-4.5-6.32V4a1.5 1.5 0 0 0-3 0v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;
        // クリック時に履歴パネルの表示/非表示を切り替える。開いた場合はコンテナ外クリックで閉じる（1箇所のみの使用のためインライン展開）
        this.bellElement.addEventListener('click', () => {
            const isVisible = this.historyElement.classList.toggle('visible');
            this.bellElement.setAttribute('aria-expanded', String(isVisible));
            if (isVisible) {
                const onOutsideClick = (e: MouseEvent) => {
                    if (!this.container.contains(e.target as Node)) {
                        this.historyElement.classList.remove('visible');
                        this.bellElement.setAttribute('aria-expanded', 'false');
                        document.removeEventListener('mousedown', onOutsideClick, true);
                    }
                };
                document.addEventListener('mousedown', onOutsideClick, true);
            }
        });

        // トースト表示エリアを構築する（ステータスバーの上方に展開）
        this.toastAreaElement = document.createElement('div');
        this.toastAreaElement.classList.add('notification-toast-area');

        // 履歴パネルを構築する（初期状態は非表示、ステータスバーの上方に展開）
        this.historyElement = document.createElement('div');
        this.historyElement.classList.add('notification-history');

        // コンテナ内の並び順: トーストエリア → 履歴パネル → ベル
        // トーストエリアと履歴パネルは position: absolute でステータスバー上方に展開するため
        // DOM順序はベルの前後どちらでも視覚的に変わらないが、意味的にベルを最後に配置する
        this.container.appendChild(this.toastAreaElement);
        this.container.appendChild(this.historyElement);
        this.container.appendChild(this.bellElement);
    }

    /**
     * 通知要素をステータスバーに追加する（StatusBar から呼ばれる）。
     */
    appendTo(parent: HTMLElement): void {
        if (this.container.parentElement !== null) throw new Error('NotificationToast は既にDOMに配置されています');
        parent.appendChild(this.container);
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
