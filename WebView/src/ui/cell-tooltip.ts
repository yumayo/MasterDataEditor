import type {EditorTable} from '../editor/editor-table';

interface TooltipAnchor {
    element: HTMLElement;
    table: EditorTable;
    getText: () => string;
    scrollTop: number;
    scrollLeft: number;
    top: number;
    left: number;
    below: boolean;
}

/** セルの補足情報を、マウスで移動・選択・コピーできる共通ツールチップとして表示する。 */
export class CellTooltip {
    private static nextId = 1;
    private static readonly SHOW_DELAY_MS = 500;
    private static readonly HIDE_DELAY_MS = 250;
    private readonly element: HTMLDivElement;
    private readonly events = new AbortController();
    private showTimerId = 0;
    private hideTimerId = 0;
    private activeAnchor: TooltipAnchor | false = false;
    private pendingAnchor: TooltipAnchor | false = false;
    private selecting = false;

    constructor(parent: HTMLElement, className: string) {
        this.element = document.createElement('div');
        this.element.classList.add('cell-tooltip', className);
        this.element.id = 'cell-tooltip-' + CellTooltip.nextId++;
        this.element.setAttribute('role', 'tooltip');
        this.element.tabIndex = -1;
        this.element.hidden = true;
        parent.appendChild(this.element);

        const signal = this.events.signal;
        this.element.addEventListener('mouseenter', () => {
            // 余白で別セルに触れていても、本文へ到達したら切り替え予約を取り消す。
            this.cancelShow();
            this.cancelHide();
        }, {signal});
        this.element.addEventListener('mouseleave', (event: MouseEvent) => {
            if (this.activeAnchor !== false && event.relatedTarget instanceof Node && this.activeAnchor.element.contains(event.relatedTarget)) return;
            this.scheduleHide();
        }, {signal});
        this.element.addEventListener('mousedown', () => {
            this.selecting = true;
            this.cancelHide();
            // グリッドにコピーを横取りさせず、ブラウザの文字選択を使う。
            this.element.focus({preventScroll: true});
        }, {signal});
        parent.ownerDocument.addEventListener('mouseup', () => {
            if (!this.selecting) return;
            this.selecting = false;
            if (!this.element.matches(':hover') && !(this.activeAnchor !== false && this.activeAnchor.element.matches(':hover'))) this.scheduleHide();
        }, {signal});
        this.element.addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            const current = this.activeAnchor;
            this.hide();
            if (current !== false) current.table.focusTable();
            event.stopPropagation();
        }, {signal});
        parent.ownerDocument.addEventListener('scroll', (event: Event) => {
            // 本文のスクロールや、フォーカス復元による同じ位置の通知では閉じない。
            if (event.target instanceof Node && this.element.contains(event.target)) return;
            if (this.pendingAnchor !== false && !this.isAnchorValid(this.pendingAnchor)) this.cancelShow();
            if (this.activeAnchor !== false && !this.isAnchorValid(this.activeAnchor)) this.closeActive();
        }, {capture: true, signal});
        window.addEventListener('resize', () => { this.hide(); }, {signal});
        window.addEventListener('blur', () => { this.hide(); }, {signal});
    }

    showAfterDelay(element: HTMLElement, table: EditorTable, getText: () => string): void {
        if (this.selecting) return;
        if (this.activeAnchor !== false && this.activeAnchor.element === element) {
            this.cancelShow();
            this.cancelHide();
            return;
        }
        if (this.pendingAnchor !== false && this.pendingAnchor.element === element) return;
        this.cancelShow();
        const rect = element.getBoundingClientRect();
        const anchor: TooltipAnchor = {
            element, table, getText,
            scrollTop: table.getScrollTop(), scrollLeft: table.getScrollLeft(),
            top: rect.top, left: rect.left,
            below: window.innerHeight - rect.bottom - 14 >= Math.min(360, rect.top - 14),
        };
        this.pendingAnchor = anchor;
        this.showTimerId = window.setTimeout(() => {
            this.cancelShow();
            if (!this.isAnchorValid(anchor)) return;
            const text = anchor.getText();
            if (!text) return;
            this.closeActive();
            this.activeAnchor = anchor;
            const descriptions = element.getAttribute('aria-describedby');
            element.setAttribute('aria-describedby', descriptions ? descriptions + ' ' + this.element.id : this.element.id);
            this.render(text);
        }, CellTooltip.SHOW_DELAY_MS);
    }

    leaveCell(element: HTMLElement, relatedTarget: EventTarget | null): void {
        if (relatedTarget instanceof Node && element.contains(relatedTarget)) return;
        if (this.pendingAnchor !== false && this.pendingAnchor.element === element) this.cancelShow();
        if (this.activeAnchor === false || this.activeAnchor.element !== element) return;
        if (relatedTarget instanceof Node && this.element.contains(relatedTarget)) return;
        this.scheduleHide();
    }

    /** 非同期で本文が更新された場合も、表示方向を変えずに再描画する。 */
    refresh(): void {
        if (this.activeAnchor === false) return;
        if (!this.isAnchorValid(this.activeAnchor)) {
            this.hide();
            return;
        }
        const text = this.activeAnchor.getText();
        if (!text) this.hide();
        else if (text !== this.element.textContent) this.render(text);
    }

    hide(): void {
        this.cancelShow();
        this.closeActive();
    }

    destroy(): void {
        this.events.abort();
        this.hide();
        this.element.remove();
    }

    private isAnchorValid(anchor: TooltipAnchor): boolean {
        const rect = anchor.element.getBoundingClientRect();
        return anchor.element.isConnected && anchor.element.getClientRects().length > 0
            && anchor.table.getScrollTop() === anchor.scrollTop && anchor.table.getScrollLeft() === anchor.scrollLeft
            && rect.top === anchor.top && rect.left === anchor.left;
    }

    private render(text: string): void {
        if (this.activeAnchor === false) return;
        const rect = this.activeAnchor.element.getBoundingClientRect();
        const availableHeight = this.activeAnchor.below ? window.innerHeight - rect.bottom - 14 : rect.top - 14;
        this.element.style.maxHeight = Math.max(0, Math.min(360, availableHeight)) + 'px';
        this.element.textContent = text;
        this.element.hidden = false;
        this.element.classList.add('visible');
        const popup = this.element.getBoundingClientRect();
        this.element.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - popup.width - 8)) + 'px';
        this.element.style.top = (this.activeAnchor.below ? rect.bottom + 6 : rect.top - popup.height - 6) + 'px';
    }

    private closeActive(): void {
        this.cancelHide();
        if (this.activeAnchor !== false) {
            const element = this.activeAnchor.element;
            const descriptions = (element.getAttribute('aria-describedby') ?? '').split(' ').filter(id => id !== this.element.id).join(' ');
            if (descriptions) element.setAttribute('aria-describedby', descriptions);
            else element.removeAttribute('aria-describedby');
        }
        this.activeAnchor = false;
        this.selecting = false;
        this.element.hidden = true;
        this.element.classList.remove('visible');
        this.element.textContent = '';
    }

    private scheduleHide(): void {
        this.cancelHide();
        if (this.selecting) return;
        // セルと本文の余白を渡る間は、別セルに触れても現在の表示を維持する。
        this.hideTimerId = window.setTimeout(() => { this.closeActive(); }, CellTooltip.HIDE_DELAY_MS);
    }

    private cancelShow(): void {
        window.clearTimeout(this.showTimerId);
        this.showTimerId = 0;
        this.pendingAnchor = false;
    }

    private cancelHide(): void {
        window.clearTimeout(this.hideTimerId);
        this.hideTimerId = 0;
    }
}
