type ResizeDirection =
    | 'left'
    | 'right'
    | 'top'
    | 'bottom'
    | 'top_left'
    | 'top_right'
    | 'bottom_left'
    | 'bottom_right';

type WindowStateMessage = {
    type: string;
    isMaximized?: boolean;
};

/**
 * WebView2 全面描画時のウィンドウ端リサイズ制御。
 * クライアント領域の内側数pxをリサイズハンドルとして扱い、C# 側でネイティブリサイズを開始する。
 */
export class WindowEdgeResizer {
    private static readonly resizeThickness = 8;
    private readonly body: HTMLElement;
    private isMaximized: boolean;

    constructor(body: HTMLElement) {
        this.body = body;
        this.isMaximized = false;

        window.addEventListener('mousemove', (event: MouseEvent) => {
            this.updateCursor(this.getResizeDirection(event.clientX, event.clientY));
        }, true);
        window.addEventListener('mouseleave', () => {
            this.updateCursor(false);
        }, true);
        window.addEventListener('mousedown', (event: MouseEvent) => {
            if (event.button !== 0) return;
            const direction = this.getResizeDirection(event.clientX, event.clientY);
            if (direction === false) return;
            event.preventDefault();
            event.stopPropagation();
            this.updateCursor(direction);
            window.chrome.webview.postMessage(JSON.stringify({
                type: 'window_command',
                command: 'resize',
                direction,
            }));
        }, true);
        window.chrome.webview.addEventListener('message', (event: MessageEvent) => {
            if (typeof event.data !== 'string') return;

            let message: WindowStateMessage;
            try {
                message = JSON.parse(event.data) as WindowStateMessage;
            } catch {
                return;
            }
            if (message.type !== 'window_state_changed') return;
            if (typeof message.isMaximized !== 'boolean') throw new Error('window_state_changed.isMaximized が不正です。');
            this.isMaximized = message.isMaximized;
            if (this.isMaximized) this.updateCursor(false);
        });
        window.chrome.webview.postMessage(JSON.stringify({type: 'window_state_request'}));
    }

    private getResizeDirection(clientX: number, clientY: number): ResizeDirection | false {
        if (this.isMaximized) return false;

        const nearLeft = clientX <= WindowEdgeResizer.resizeThickness;
        const nearRight = clientX >= window.innerWidth - WindowEdgeResizer.resizeThickness;
        const nearTop = clientY <= WindowEdgeResizer.resizeThickness;
        const nearBottom = clientY >= window.innerHeight - WindowEdgeResizer.resizeThickness;

        if (nearTop && nearLeft) return 'top_left';
        if (nearTop && nearRight) return 'top_right';
        if (nearBottom && nearLeft) return 'bottom_left';
        if (nearBottom && nearRight) return 'bottom_right';
        if (nearLeft) return 'left';
        if (nearRight) return 'right';
        if (nearTop) return 'top';
        if (nearBottom) return 'bottom';
        return false;
    }

    private updateCursor(direction: ResizeDirection | false): void {
        this.body.style.cursor = this.getCursor(direction);
    }

    private getCursor(direction: ResizeDirection | false): string {
        switch (direction) {
            case 'left':
            case 'right':
                return 'ew-resize';

            case 'top':
            case 'bottom':
                return 'ns-resize';

            case 'top_left':
            case 'bottom_right':
                return 'nwse-resize';

            case 'top_right':
            case 'bottom_left':
                return 'nesw-resize';

            case false:
                return '';
        }
    }
}
