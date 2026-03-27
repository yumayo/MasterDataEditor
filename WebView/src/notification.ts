/**
 * システムエラー通知（メッセージバー）
 *
 * ステータスバー内にメッセージ欄（.notification-message）を配置し、
 * show() 呼び出し時に最新メッセージを1行表示する。
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
    /** ステータスバー内のメッセージ欄（最新メッセージを1行表示） */
    private readonly messageElement: HTMLElement;
    /** ステータスバー内のコンテナ要素 */
    private readonly container: HTMLElement;
    /** DebugConsole への記録用参照 */
    private readonly debugConsole: DebugConsole;

    /** parseCallerInfo でスキップするフレームパターン（自身のファイル名 + 共通モジュール） */
    private static readonly SKIP_PATTERNS: ReadonlyArray<string> = ['notification.', 'caller-info'];

    constructor(debugConsole: DebugConsole) {
        this.debugConsole = debugConsole;

        // コンテナ要素を構築する（ステータスバー内に配置されるラッパー）
        this.container = document.createElement('div');
        this.container.classList.add('notification-container');

        // メッセージ欄を構築する（最新メッセージを1行表示、初期状態は空テキスト）
        this.messageElement = document.createElement('div');
        this.messageElement.classList.add('notification-message');

        this.container.appendChild(this.messageElement);
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
     * メッセージ欄のテキストを更新し、DebugConsole に記録する。
     */
    show(message: string): void {
        // スタックトレースは show() の呼び出し元を特定するため、最初に取得する
        const caller = parseCallerInfo(NotificationToast.SKIP_PATTERNS);

        // ステータスバーのメッセージ欄を最新メッセージで上書きする
        this.messageElement.textContent = message;

        // DebugConsole にエントリを追記する（通知は瞬時の操作なので duration=0）
        this.debugConsole.appendEntry(message, 0, 'error', caller);
    }
}
