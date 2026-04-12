type TitleBarMessage = {
    type: string;
    isMaximized?: boolean;
    title?: string;
};

/**
 * WebView2 上に描画するカスタムタイトルバー。
 * C# 側へウィンドウ操作コマンドを送信し、状態変化の通知を受けて表示を更新する。
 */
export class TitleBar {
    private static readonly dragThreshold = 4;
    private readonly dragRegion: HTMLElement;
    private readonly titleElement: HTMLElement;
    private readonly minimizeButton: HTMLButtonElement;
    private readonly maximizeButton: HTMLButtonElement;
    private readonly closeButton: HTMLButtonElement;
    private dragPending: boolean;
    private dragStartScreenX: number;
    private dragStartScreenY: number;

    constructor(
        dragRegion: HTMLElement,
        titleElement: HTMLElement,
        minimizeButton: HTMLButtonElement,
        maximizeButton: HTMLButtonElement,
        closeButton: HTMLButtonElement,
    ) {
        this.dragRegion = dragRegion;
        this.titleElement = titleElement;
        this.minimizeButton = minimizeButton;
        this.maximizeButton = maximizeButton;
        this.closeButton = closeButton;
        this.dragPending = false;
        this.dragStartScreenX = 0;
        this.dragStartScreenY = 0;

        this.dragRegion.addEventListener('mousedown', (event: MouseEvent) => {
            if (event.button !== 0) return;
            event.preventDefault();
            this.dragPending = true;
            this.dragStartScreenX = event.screenX;
            this.dragStartScreenY = event.screenY;
        });
        this.dragRegion.addEventListener('dblclick', (event: MouseEvent) => {
            if (event.button !== 0) return;
            event.preventDefault();
            this.dragPending = false;
            this.sendWindowCommand('toggle_maximize', 0, 0);
        });
        this.dragRegion.addEventListener('contextmenu', (event: MouseEvent) => {
            event.preventDefault();
            this.dragPending = false;
            this.sendWindowCommand('show_system_menu', event.screenX, event.screenY);
        });
        this.minimizeButton.addEventListener('click', () => {
            this.sendWindowCommand('minimize', 0, 0);
        });
        this.maximizeButton.addEventListener('click', () => {
            this.sendWindowCommand('toggle_maximize', 0, 0);
        });
        this.closeButton.addEventListener('click', () => {
            this.sendWindowCommand('close', 0, 0);
        });
        window.addEventListener('mousemove', (event: MouseEvent) => {
            if (!this.dragPending) return;
            if ((event.buttons & 1) === 0) {
                this.dragPending = false;
                return;
            }
            const dx = event.screenX - this.dragStartScreenX;
            const dy = event.screenY - this.dragStartScreenY;
            if (Math.abs(dx) < TitleBar.dragThreshold && Math.abs(dy) < TitleBar.dragThreshold) return;
            this.dragPending = false;
            this.sendWindowCommand('drag', event.screenX, event.screenY);
        });
        window.addEventListener('mouseup', () => {
            this.dragPending = false;
        });

        window.chrome.webview.addEventListener('message', (event: MessageEvent) => {
            if (typeof event.data !== 'string') return;

            let message: TitleBarMessage;
            try {
                message = JSON.parse(event.data) as TitleBarMessage;
            } catch {
                return;
            }
            if (message.type !== 'window_state_changed') return;
            if (typeof message.isMaximized !== 'boolean') throw new Error('window_state_changed.isMaximized が不正です。');
            if (typeof message.title !== 'string') throw new Error('window_state_changed.title が不正です。');
            this.applyWindowState(message.isMaximized, message.title);
        });

        window.chrome.webview.postMessage(JSON.stringify({type: 'window_state_request'}));
    }

    private applyWindowState(isMaximized: boolean, title: string): void {
        this.titleElement.textContent = title;
        document.title = title;
        this.maximizeButton.classList.toggle('title-bar-button-maximize', !isMaximized);
        this.maximizeButton.classList.toggle('title-bar-button-restore', isMaximized);
        this.maximizeButton.title = isMaximized ? '元のサイズに戻す' : '最大化';
        this.maximizeButton.setAttribute('aria-label', this.maximizeButton.title);
    }

    private sendWindowCommand(command: string, screenX: number, screenY: number): void {
        window.chrome.webview.postMessage(JSON.stringify({
            type: 'window_command',
            command,
            screenX,
            screenY,
        }));
    }
}
