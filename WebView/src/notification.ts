/**
 * システムエラー通知（トーストポップアップ）
 *
 * show() 呼び出し時にトーストポップアップを右下に展開する（最大3件スタック）。
 * さらに DebugConsole にエントリを追記してログを残す。
 *
 * Undo/Redo 不要（通知は副作用的UIで可逆操作なし）。
 *
 * クラス名は window.Notification (Push Notification API) との衝突を避けるため
 * NotificationToast とする。
 */
import type {DebugConsole} from "./debug-console";
import {parseCallerInfo} from "./caller-info";

export class NotificationToast {
    /**
     * トースト表示中の要素とそのタイマーIDのマップ（最大MAX_TOASTS件）。
     * タイマーIDを保持することで、強制削除時に clearTimeout できる。
     */
    private readonly activeToasts: Map<HTMLElement, number>;
    /** トースト表示エリア */
    private readonly toastAreaElement: HTMLElement;
    /** ステータスバー内のコンテナ要素 */
    private readonly container: HTMLElement;
    /** DebugConsole への記録用参照 */
    private readonly debugConsole: DebugConsole;

    /** 最大同時表示トースト数 */
    private static readonly MAX_TOASTS = 3;
    /** トーストの自動消去時間（ミリ秒） */
    private static readonly TOAST_DURATION_MS = 5000;
    /** フェードアウトアニメーション時間（ミリ秒） */
    private static readonly FADE_DURATION_MS = 400;
    /** parseCallerInfo でスキップするフレームパターン（自身のファイル名 + 共通モジュール） */
    private static readonly SKIP_PATTERNS: ReadonlyArray<string> = ['notification.', 'caller-info'];

    constructor(debugConsole: DebugConsole) {
        this.debugConsole = debugConsole;
        this.activeToasts = new Map();

        // コンテナ要素を構築する（ステータスバー内に配置される相対配置ラッパー）
        this.container = document.createElement('div');
        this.container.classList.add('notification-container');

        // トースト表示エリアを構築する（ステータスバーの上方に展開）
        this.toastAreaElement = document.createElement('div');
        this.toastAreaElement.classList.add('notification-toast-area');

        // コンテナ内にトーストエリアを配置する
        // トーストエリアは position: absolute でステータスバー上方に展開する
        this.container.appendChild(this.toastAreaElement);
    }

    /**
     * 通知要素をステータスバーに追加する（StatusBar から呼ばれる）。
     */
    appendTo(parent: HTMLElement): void {
        if (this.container.parentElement !== null) throw new Error('NotificationToast は既にDOMに配置されています');
        parent.appendChild(this.container);
    }

    /**
     * エラー通知を表示する。
     * トーストポップアップを表示し、DebugConsole に記録する。
     * 最大3件を超える場合は最も古いトーストを即時削除する（タイマーもキャンセル）。
     */
    show(message: string): void {
        // スタックトレースは show() の呼び出し元を特定するため、最初に取得する
        const caller = parseCallerInfo(NotificationToast.SKIP_PATTERNS);

        // DebugConsole にエントリを追記する（通知は瞬時の操作なので duration=0）
        this.debugConsole.appendEntry(message, 0, 'error', caller);

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
        // フェードアウト開始時点でactiveToastsから除去する（フェードアウト中のトーストがMAX_TOASTSのカウントに含まれ続ける問題を防ぐ）
        const outerTimerId = window.setTimeout(() => {
            this.activeToasts.delete(toast);
            toast.classList.add('fading');
            window.setTimeout(() => {
                toast.remove();
            }, NotificationToast.FADE_DURATION_MS);
        }, NotificationToast.TOAST_DURATION_MS);

        this.activeToasts.set(toast, outerTimerId);
    }
}
