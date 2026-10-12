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
    /** 二重ドラッグ防止フラグ（全インスタンス共有） */
    private static dragging = false;

    constructor(direction: 'horizontal' | 'vertical', onResize: (delta: number) => number) {
        const el = document.createElement('div');
        el.classList.add('resize-handle');
        el.setAttribute('data-direction', direction);
        el.addEventListener('pointerdown', (event: PointerEvent) => {
            // 左ボタンの主ポインターだけが、全ハンドルで一つのドラッグを所有する。
            if (event.button !== 0 || !event.isPrimary || ResizeHandle.dragging) return;
            event.stopPropagation();
            event.preventDefault();

            // iframeへ入っても親documentへ移動と解放が届くよう、開始要素が捕捉する。
            // 捕捉できなかった場合に、共有フラグやbodyの操作状態を残さない。
            const pointerId = event.pointerId;
            el.setPointerCapture(pointerId);
            ResizeHandle.dragging = true;
            const previousCursor = document.body.style.cursor;
            const previousUserSelect = document.body.style.userSelect;
            document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
            document.body.style.userSelect = 'none';

            let active = true;
            let prevCoord = direction === 'horizontal' ? event.clientX : event.clientY;
            const finishDrag = () => {
                if (!active) return;
                active = false;
                document.removeEventListener('pointermove', onPointerMove);
                document.removeEventListener('pointerup', onPointerEnd);
                document.removeEventListener('pointercancel', onPointerEnd);
                document.removeEventListener('lostpointercapture', onPointerEnd);
                window.removeEventListener('blur', finishDrag);
                document.body.style.cursor = previousCursor;
                document.body.style.userSelect = previousUserSelect;
                ResizeHandle.dragging = false;
                if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
            };
            const onPointerMove = (moveEvent: PointerEvent) => {
                if (moveEvent.pointerId !== pointerId) return;
                // 左ボタンだけ先に離した場合も、別ボタンの解放を待たず終了する。
                if ((moveEvent.buttons & 1) === 0) {
                    finishDrag();
                    return;
                }
                const currentCoord = direction === 'horizontal' ? moveEvent.clientX : moveEvent.clientY;
                const delta = currentCoord - prevCoord;
                // クランプで消費しなかった分は進めず、逆方向で超過分を解消させる。
                prevCoord += onResize(delta);
            };
            const onPointerEnd = (endEvent: PointerEvent) => {
                if (endEvent.pointerId === pointerId) finishDrag();
            };

            // 要素が除去された場合のlostpointercaptureもdocumentで受け取る。
            document.addEventListener('pointermove', onPointerMove);
            document.addEventListener('pointerup', onPointerEnd);
            document.addEventListener('pointercancel', onPointerEnd);
            document.addEventListener('lostpointercapture', onPointerEnd);
            window.addEventListener('blur', finishDrag);
        });
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
}
