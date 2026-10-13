import {getAppliedSettings} from "./settings-panel";
import {getSettingOptionLabel} from "../settings/settings-schema";
import {isWorkspaceTrusted} from "../app/workspace-trust";
import {Terminal} from '@xterm/xterm';
import {FitAddon} from '@xterm/addon-fit';
import type {NotificationToast} from '../ui/notification';
import type {BottomPanel} from './bottom-panel';
import '@xterm/xterm/css/xterm.css';
import './terminal-panel.css';

type TerminalState = {kind: 'idle'}
    | {kind: 'checking' | 'uninstalled' | 'starting' | 'running' | 'closing' | 'failed'; sessionId: string}
    | {kind: 'exited'; sessionId: string; exitCode: number};
type TerminalOperation = 'start' | 'ai_status' | 'ai_start' | 'ai_install' | 'input' | 'resize' | 'close';

interface PendingTerminalRequest {
    sessionId: string;
    responseType: string;
    timer: number;
    resolve(response: Record<string, unknown>): void;
    reject(error: Error): void;
}

/** エディタのグローバルショートカットから端末の入力を分離する。 */
export function isTerminalKeyboardTarget(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest('.terminal-panel, .ai-terminal-panel') !== null;
}

/**
 * xtermの描画と、単一のConPTYセッションのライフサイクルを所有する。
 * キー入力やシェル出力はDEBUG CONSOLEのAPIログへ記録しない。
 * シェル操作は外部プロセスへの入力であり、エディタのUndo/Redo対象ではない。
 */
export class TerminalPanel {
    private readonly kind: 'terminal' | 'ai';
    private readonly bottomPanel: BottomPanel;
    private readonly element: HTMLElement;
    private readonly host: HTMLElement;
    private readonly status: HTMLElement;
    private readonly location: HTMLElement;
    private readonly startButton: HTMLButtonElement;
    private readonly closeButton: HTMLButtonElement;
    private readonly terminal: Terminal;
    private readonly fitAddon: FitAddon;
    private readonly notification: NotificationToast;
    private readonly themeRoot: HTMLElement;
    private readonly resizeObserver: ResizeObserver;
    private readonly themeObserver: MutationObserver;
    private readonly messageHandler: (event: MessageEvent) => void;
    private readonly unloadHandler: () => void;
    private readonly pending = new Map<string, PendingTerminalRequest>();
    private state: TerminalState = {kind: 'idle'};
    private opened = false;
    private disposed = false;
    private outbound: Promise<void> = Promise.resolve();
    private previousFocus: HTMLElement;

    constructor(notification: NotificationToast, themeRoot: HTMLElement, kind: 'terminal' | 'ai', bottomPanel: BottomPanel) {
        this.kind = kind;
        this.bottomPanel = bottomPanel;
        const prefix = kind === 'ai' ? 'ai-terminal' : 'terminal';
        this.notification = notification;
        this.themeRoot = themeRoot;
        this.previousFocus = themeRoot;
        this.element = document.createElement('section');
        this.element.className = `${prefix}-panel`;
        this.element.setAttribute('aria-label', kind === 'ai' ? 'AIターミナル' : 'ターミナル');
        const toolbar = document.createElement('div');
        toolbar.className = `${prefix}-toolbar`;
        this.status = document.createElement('span');
        this.status.className = `${prefix}-status`;
        this.status.setAttribute('role', 'status');
        this.location = document.createElement('span');
        this.location.className = `${prefix}-location`;
        this.location.textContent = kind === 'ai' ? 'AI · ai-container' : 'Windows PowerShell';
        this.startButton = document.createElement('button');
        this.startButton.type = 'button';
        this.startButton.className = `${prefix}-action`;
        this.startButton.addEventListener('click', () => { void this.startAsync(); });
        this.closeButton = document.createElement('button');
        this.closeButton.type = 'button';
        this.closeButton.className = `${prefix}-action`;
        this.closeButton.textContent = '終了';
        this.closeButton.setAttribute('aria-label', kind === 'ai' ? 'AIを終了' : 'ターミナルを終了');
        this.closeButton.title = '実行中のコマンドとシェルを終了';
        this.closeButton.addEventListener('click', async () => {
            if (this.state.kind !== 'running') return;
            const sessionId = this.state.sessionId;
            this.state = {kind: 'closing', sessionId};
            // 無効化される終了ボタンから先に移し、完了時のsetVisibleが元のフォーカスを復元できるようにする。
            if (this.element.ownerDocument.activeElement === this.closeButton) this.terminal.focus();
            this.renderState();
            try {
                await this.requestAsync('close', sessionId, {});
                if (this.disposed || this.state.sessionId !== sessionId || this.state.kind !== 'closing') return;
                if (this.kind === 'ai') {
                    this.completeAiSession();
                } else {
                    this.state = {kind: 'exited', sessionId, exitCode: 0};
                    this.renderState();
                }
            } catch (error) {
                if (this.disposed || this.state.sessionId !== sessionId || this.state.kind !== 'closing') return;
                // 終了失敗では既存セッションを保持し、終了操作をやり直せるようにする。
                this.state = {kind: 'running', sessionId};
                this.renderState();
                this.notification.showError(error);
            }
        });
        toolbar.append(this.status, this.location, this.startButton, this.closeButton);
        this.host = document.createElement('div');
        this.host.className = `${prefix}-host`;
        this.element.append(toolbar, this.host);
        this.host.addEventListener('paste', event => {
            if (this.state.kind === 'running') return;
            event.preventDefault();
            event.stopImmediatePropagation();
        }, true);

        this.terminal = new Terminal({
            cursorBlink: true,
            fontFamily: 'Cascadia Mono, Consolas, monospace',
            fontSize: 13,
            scrollback: 5000,
            disableStdin: true,
            screenReaderMode: true,
        });
        this.fitAddon = new FitAddon();
        this.terminal.loadAddon(this.fitAddon);
        this.terminal.onData(data => {
            // 起動中もDA/DSR等の自動応答をシェルへ返す。
            if (this.state.kind !== 'starting' && this.state.kind !== 'running') return;
            const sessionId = this.state.sessionId;
            // C#側のメッセージ上限を守り、UTF-16のサロゲートペアを分断しない。
            for (let offset = 0; offset < data.length;) {
                let end = Math.min(offset + 16384, data.length);
                const lastCodeUnit = data.charCodeAt(end - 1);
                if (end < data.length && lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) end--;
                this.enqueue('input', sessionId, {data: data.slice(offset, end)});
                offset = end;
            }
        });
        this.terminal.onResize(size => {
            if (this.state.kind === 'running') this.enqueue('resize', this.state.sessionId, size);
        });
        this.terminal.attachCustomKeyEventHandler(event => {
            // 選択ありCtrl+Cはコピー、選択なしはxterm標準のETX送信に任せる。
            if (event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'c' && this.terminal.hasSelection()) {
                if (event.type === 'keydown') {
                    event.preventDefault();
                    void navigator.clipboard.writeText(this.terminal.getSelection()).catch(error => this.notification.showError(error));
                }
                return false;
            }
            return this.state.kind === 'running';
        });
        this.resizeObserver = new ResizeObserver(() => {
            if (this.opened && this.host.clientWidth > 0 && this.host.clientHeight > 0) this.fitAddon.fit();
        });
        this.resizeObserver.observe(this.host);
        this.themeObserver = new MutationObserver(() => { this.applyTheme(); });
        this.themeObserver.observe(themeRoot, {attributes: true, attributeFilter: ['data-theme']});
        this.applyTheme();

        this.messageHandler = event => {
            let message: unknown;
            try {
                message = typeof event.data === 'string' ? JSON.parse(event.data) as unknown : event.data;
            } catch {
                // 他のWebView利用者が送信したJSON以外のメッセージは端末のプロトコルではない。
                return;
            }
            if (typeof message !== 'object' || message === null || !('type' in message) || typeof message.type !== 'string') return;
            if (message.type === 'workspace_trust_changed') {
                if (!isWorkspaceTrusted()) {
                    this.state = {kind: 'idle'};
                    for (const request of this.pending.values()) { window.clearTimeout(request.timer); request.reject(new Error('作業フォルダーの信頼が解除されました')); }
                    this.pending.clear();
                }
                this.renderState();
                return;
            }
            if (!message.type.startsWith('terminal_')) return;
            const data = message as Record<string, unknown>;
            if (typeof data['requestId'] === 'string' && this.pending.has(data['requestId'])) {
                const request = this.pending.get(data['requestId'])!;
                if (request.responseType !== message.type || request.sessionId !== data['sessionId']) return;
                window.clearTimeout(request.timer);
                this.pending.delete(data['requestId']);
                if (data['success'] === true) request.resolve(data);
                else request.reject(this.responseError(data));
                return;
            }
            if (this.state.kind === 'idle' || this.state.kind === 'failed' || this.state.sessionId !== data['sessionId']) return;
            const sessionId = this.state.sessionId;
            // close応答とプロセス監視の順序に関係なく、実際の終了コードを表示する。
            if (message.type === 'terminal_exit' && typeof data['exitCode'] === 'number') {
                // Ctrl+C入力だけでは終了とみなさず、実プロセスの正常終了または既知の中断コードを待つ。
                if (this.kind === 'ai' && (this.state.kind === 'closing' || data['exitCode'] === 0 || data['exitCode'] === 130 || data['exitCode'] === -1073741510)) {
                    this.completeAiSession();
                    return;
                }
                if (this.kind === 'ai' && this.state.kind !== 'closing' && this.state.kind !== 'exited' && data['exitCode'] !== 0) {
                    this.notification.show(`AI の処理が終了しました（コード ${data['exitCode']}）。端末の出力を確認してください。`, 'error');
                }
                this.state = {kind: 'exited', sessionId, exitCode: data['exitCode']};
                this.renderState();
                return;
            }
            if (this.state.kind === 'exited') return;
            if (message.type === 'terminal_output') {
                try {
                    const outputId = data['outputId'];
                    if (typeof data['data'] !== 'string' || typeof outputId !== 'string' || outputId.length === 0) throw new Error('ターミナルの出力通知が不正です');
                    // xtermの解析完了まで次の出力を待たせ、非表示中も書き込みキューを有限に保つ。
                    this.terminal.write(data['data'], () => {
                        if (this.disposed || this.state.kind === 'idle' || this.state.kind === 'failed' || this.state.sessionId !== sessionId) return;
                        try {
                            window.chrome.webview.postMessage(JSON.stringify({type: 'terminal_output_ack', sessionId, outputId}));
                        } catch (error) {
                            this.failSession(sessionId, error);
                        }
                    });
                } catch (error) {
                    this.failSession(sessionId, error);
                }
            } else if (message.type === 'terminal_error') {
                this.failSession(sessionId, this.responseError(data));
            }
        };
        window.chrome.webview.addEventListener('message', this.messageHandler);
        this.unloadHandler = () => { this.dispose(); };
        window.addEventListener('pagehide', this.unloadHandler);
        this.renderState();
    }

    appendTo(parent: HTMLElement): void {
        parent.appendChild(this.element);
    }

    /** 表示の復元やタブ切替はプロセスを起動しない。 */
    setVisible(visible: boolean): void {
        const focused = this.element.ownerDocument.activeElement;
        const closeActionFocused = focused instanceof Element && focused.closest('.bottom-panel-actions') !== null;
        // display/hiddenを先に変えるとブラウザーがフォーカスをbodyへ移し、復帰先を見失う。
        if (!visible && !this.element.hidden && (this.element.contains(focused) || closeActionFocused)) {
            this.terminal.blur();
            if (this.previousFocus.isConnected) this.previousFocus.focus();
        }
        this.element.hidden = !visible;
        if (visible && this.opened && this.host.clientWidth > 0 && this.host.clientHeight > 0) this.fitAddon.fit();
    }

    /** ユーザーの明示操作で初回起動し、以後は専用セッションの履歴へ戻る。 */
    activate(): void {
        const focused = this.element.ownerDocument.activeElement;
        if (focused instanceof HTMLElement && !this.element.contains(focused)) this.previousFocus = focused;
        this.ensureOpened();
        if (this.state.kind === 'idle') void this.startAsync();
        else if (this.state.kind === 'running' || this.state.kind === 'starting' || this.state.kind === 'checking') this.terminal.focus();
        else this.startButton.focus();
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        // WebViewの再読み込み時にもシェルを残さない。WPF終了時はC#側でも必ず破棄する。
        if (this.state.kind === 'starting' || this.state.kind === 'running' || this.state.kind === 'closing') {
            this.closeWithoutWaiting(this.state.sessionId);
        }
        window.chrome.webview.removeEventListener('message', this.messageHandler);
        window.removeEventListener('pagehide', this.unloadHandler);
        this.resizeObserver.disconnect();
        this.themeObserver.disconnect();
        for (const request of this.pending.values()) {
            window.clearTimeout(request.timer);
            request.reject(new Error('ターミナルを破棄しました'));
        }
        this.pending.clear();
        this.terminal.dispose();
    }

    private ensureOpened(): void {
        if (!this.opened) {
            this.terminal.open(this.host);
            this.opened = true;
        }
        if (this.host.clientWidth > 0 && this.host.clientHeight > 0) this.fitAddon.fit();
    }

    private async startAsync(): Promise<void> {
        if (!isWorkspaceTrusted()) { this.renderState(); return; }
        if (this.disposed || this.state.kind === 'checking' || this.state.kind === 'starting' || this.state.kind === 'running' || this.state.kind === 'closing') return;
        this.ensureOpened();
        // 明示操作の時点でフォーカスを移し、導入確認を待つ間のユーザーの移動は尊重する。
        this.terminal.focus();
        // 導入確認の応答待ちで設定が変わっても、この開始操作のツールは変えない。
        const tool = getAppliedSettings().aiTool;
        const toolLabel = getSettingOptionLabel('aiTool', tool);
        const sessionId = crypto.randomUUID();
        let operation: TerminalOperation = 'start';
        if (this.kind === 'ai') {
            this.location.textContent = `${toolLabel} · ai-container`;
            if (this.state.kind === 'uninstalled') {
                operation = 'ai_install';
            } else {
                this.state = {kind: 'checking', sessionId};
                this.renderState();
                try {
                    const response = await this.requestAsync('ai_status', sessionId, {});
                    if (this.disposed || this.state.sessionId !== sessionId || this.state.kind !== 'checking') return;
                    const data = response['data'];
                    if (typeof data !== 'object' || data === null || !('installed' in data) || typeof data.installed !== 'boolean' || !('cwd' in data) || typeof data.cwd !== 'string') throw new Error('AI の導入状態の応答が不正です');
                    this.location.textContent = `${toolLabel} · ${data.cwd}`;
                    this.location.title = data.cwd;
                    if (!data.installed) {
                        this.state = {kind: 'uninstalled', sessionId};
                        this.renderState();
                        if (this.element.contains(this.element.ownerDocument.activeElement)) this.startButton.focus();
                        return;
                    }
                    operation = 'ai_start';
                } catch (error) {
                    if (this.disposed || this.state.sessionId !== sessionId || this.state.kind !== 'checking') return;
                    this.state = {kind: 'failed', sessionId};
                    this.renderState();
                    this.notification.showError(error);
                    return;
                }
            }
        }
        this.state = {kind: 'starting', sessionId};
        this.terminal.reset();
        this.renderState();
        try {
            const dimensions = {cols: this.terminal.cols, rows: this.terminal.rows};
            const response = await this.requestAsync(operation, sessionId, this.kind === 'ai' ? {...dimensions, tool} : dimensions);
            if (this.disposed || this.state.sessionId !== sessionId || this.state.kind !== 'starting') return;
            const data = response['data'];
            if (typeof data !== 'object' || data === null || !('shell' in data) || typeof data.shell !== 'string' || !('cwd' in data) || typeof data.cwd !== 'string') {
                throw new Error('ターミナルの起動応答が不正です');
            }
            this.location.textContent = `${data.shell} · ${data.cwd}`;
            this.location.title = data.cwd;
            this.state = {kind: 'running', sessionId};
            this.renderState();
            // 起動応答を待つ間に変わった表示サイズもConPTYへ反映する。
            this.enqueue('resize', sessionId, {cols: this.terminal.cols, rows: this.terminal.rows});
        } catch (error) {
            if (this.disposed || this.state.sessionId !== sessionId || this.state.kind !== 'starting') return;
            this.failSession(sessionId, error);
        }
    }


    private completeAiSession(): void {
        // sessionIdを手放し、close応答・exit通知の順序にかかわらず遅延した旧通知を無効にする。
        this.state = {kind: 'idle'};
        // 終了ボタンをhiddenにする前に、表示を所有する親へフォーカスの復帰と保存を任せる。
        this.bottomPanel.onAiTerminalExited();
        this.renderState();
    }

    private failSession(sessionId: string, error: unknown): void {
        if (this.disposed || this.state.kind === 'idle' || this.state.kind === 'failed' || this.state.kind === 'exited' || this.state.sessionId !== sessionId) return;
        this.state = {kind: 'failed', sessionId};
        this.renderState();
        this.notification.showError(error);
        // 遅延起動の孤立セッションと、描画失敗で確認応答を待っている出力の両方を回収する。
        this.closeWithoutWaiting(sessionId);
    }

    private closeWithoutWaiting(sessionId: string): void {
        try {
            window.chrome.webview.postMessage(JSON.stringify({type: 'terminal_close_request', requestId: crypto.randomUUID(), sessionId}));
        } catch (error) {
            if (!this.disposed) this.notification.showError(error);
        }
    }

    private enqueue(operation: 'input' | 'resize', sessionId: string, data: Record<string, unknown>): void {
        this.outbound = this.outbound.then(async () => {
            if (this.disposed || (this.state.kind !== 'running' && this.state.kind !== 'starting') || this.state.sessionId !== sessionId) return;
            await this.requestAsync(operation, sessionId, data);
        }).catch(error => {
            if (this.disposed || this.state.kind === 'idle' || this.state.sessionId !== sessionId || (this.state.kind !== 'starting' && this.state.kind !== 'running')) return;
            this.failSession(sessionId, error);
        });
    }

    private requestAsync(operation: TerminalOperation, sessionId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
        const requestId = crypto.randomUUID();
        return new Promise((resolve, reject) => {
            const timer = window.setTimeout(() => {
                this.pending.delete(requestId);
                reject(new Error(`ターミナルの${operation}応答がタイムアウトしました`));
            }, 10000);
            this.pending.set(requestId, {sessionId, responseType: `terminal_${operation}_response`, timer, resolve, reject});
            try {
                window.chrome.webview.postMessage(JSON.stringify({type: `terminal_${operation}_request`, requestId, sessionId, ...data}));
            } catch (error) {
                window.clearTimeout(timer);
                this.pending.delete(requestId);
                reject(error);
            }
        });
    }


    private responseError(data: Record<string, unknown>): Error {
        const error = new Error(typeof data['error'] === 'string' ? data['error'] : 'ターミナルの応答が不正です');
        if (typeof data['stack'] === 'string') error.stack = data['stack'];
        return error;
    }

    private renderState(): void {
        const state = this.state;
        // disableStdinは端末の自動応答も停止する。起動中はtextareaとキー処理でユーザー入力だけを止める。
        this.terminal.options.disableStdin = state.kind !== 'running' && state.kind !== 'starting';
        if (this.terminal.textarea instanceof HTMLTextAreaElement) this.terminal.textarea.readOnly = state.kind !== 'running';
        this.element.dataset.state = state.kind;
        const labels = {idle: '未起動', checking: '導入状態を確認中…', uninstalled: '未インストール', starting: '起動中…', running: '実行中', closing: '終了中…', failed: '起動・接続失敗', exited: '終了'};
        this.status.textContent = state.kind === 'exited' ? `終了（コード ${state.exitCode}）` : labels[state.kind];
        this.startButton.hidden = state.kind === 'checking' || state.kind === 'running' || state.kind === 'starting' || state.kind === 'closing';
        this.startButton.textContent = state.kind === 'uninstalled' ? 'インストール' : state.kind === 'idle' ? '開始' : '再起動';
        this.startButton.setAttribute('aria-label', `${this.kind === 'ai' ? 'AI' : 'ターミナル'}を${this.startButton.textContent}`);
        this.closeButton.hidden = state.kind !== 'running' && state.kind !== 'closing';
        this.closeButton.disabled = state.kind === 'closing';
        this.startButton.disabled = !isWorkspaceTrusted();
        if (!isWorkspaceTrusted()) this.status.textContent = '制限モード：ウィンドウ上部で信頼を確認してください';
    }

    private applyTheme(): void {
        const style = getComputedStyle(this.themeRoot);
        const foreground = style.getPropertyValue('--font-color').trim();
        const background = style.getPropertyValue('--background-color').trim();
        this.terminal.options.theme = {
            foreground, background, cursor: foreground, cursorAccent: background,
            selectionBackground: style.getPropertyValue('--selection-color').trim(),
        };
    }
}
