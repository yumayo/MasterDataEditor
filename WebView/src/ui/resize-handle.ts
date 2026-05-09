/**
 * ドラッグでリサイズする共通ハンドル。
 * 横方向（col-resize）と縦方向（row-resize）の両方に対応する。
 *
 * onResize コールバックはドラッグ中の差分ピクセルを受け取り、実際に消費したdeltaを返す。
 * 呼び出し元がサイズ制約（MIN/MAX クランプ）を管理し、実際の要素サイズを変更する。
 * 返り値（消費delta）を使って prevCoord を補正することで、上限/下限到達後の
 * 「超過分を戻りきるまでリサイズが始まらない」という直感的な挙動を実現する。
 */
export class ResizeHandle {
    private readonly element: HTMLElement;
    private readonly direction: 'horizontal' | 'vertical';
    private readonly onResize: (delta: number) => number;
    /** 二重ドラッグ防止フラグ（全インスタンス共有） */
    private static dragging = false;

    constructor(direction: 'horizontal' | 'vertical', onResize: (delta: number) => number) {
        this.direction = direction;
        this.onResize = onResize;

        const el = document.createElement('div');
        el.classList.add('resize-handle');
        el.setAttribute('data-direction', direction);
        el.addEventListener('mousedown', (e: MouseEvent) => { this.onMouseDown(e); });
        this.element = el;
    }

    /**
     * ハンドルを親要素の末尾に追加する（Sidebar の右端ハンドルなど）
     */
    appendTo(parent: HTMLElement): void {
        parent.appendChild(this.element);
    }

    /**
     * ハンドルを親要素の先頭に追加する（RelationsPanel の左端ハンドルなど）
     */
    prependTo(parent: HTMLElement): void {
        parent.prepend(this.element);
    }

    private onMouseDown(e: MouseEvent): void {
        // 別のResizeHandleがドラッグ中なら無視する（二重ドラッグ防止）
        if (ResizeHandle.dragging) return;
        ResizeHandle.dragging = true;

        // SelectionDragController との競合を防ぐ
        e.stopPropagation();
        e.preventDefault();

        const cursor = this.direction === 'horizontal' ? 'col-resize' : 'row-resize';
        document.body.style.cursor = cursor;
        document.body.style.userSelect = 'none';

        // 差分方式: 前フレームの座標を保持し、フレームごとの差分を onResize に渡す
        let prevCoord = this.direction === 'horizontal' ? e.clientX : e.clientY;

        const onMouseMove = (moveEvent: MouseEvent) => {
            const currentCoord = this.direction === 'horizontal' ? moveEvent.clientX : moveEvent.clientY;
            const delta = currentCoord - prevCoord;
            // onResize が返す消費deltaだけ prevCoord を進める。
            // クランプで実際に動かなかった分は prevCoord に反映されないため、
            // 逆方向に戻すときに超過分を解消するまでリサイズが始まらない。
            const consumedDelta = this.onResize(delta);
            prevCoord += consumedDelta;
        };

        const onMouseUp = () => {
            ResizeHandle.dragging = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }
}
