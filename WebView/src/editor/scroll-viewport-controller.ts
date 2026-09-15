export class ScrollViewportController {
    private container: HTMLElement;
    private logicalScrollTopFromPhysical: (physicalScrollTop: number) => number;
    private physicalScrollTopFromLogical: (logicalScrollTop: number) => number;

    constructor(container: HTMLElement) {
        this.container = container;
        this.logicalScrollTopFromPhysical = (physicalScrollTop: number) => physicalScrollTop;
        this.physicalScrollTopFromLogical = (logicalScrollTop: number) => logicalScrollTop;
    }

    setVerticalScrollMapper(
        logicalFromPhysical: (physicalScrollTop: number) => number,
        physicalFromLogical: (logicalScrollTop: number) => number,
    ): void {
        this.logicalScrollTopFromPhysical = logicalFromPhysical;
        this.physicalScrollTopFromLogical = physicalFromLogical;
    }

    getScrollLeft(): number {
        return this.container.scrollLeft;
    }

    getScrollTop(): number {
        return this.logicalScrollTopFromPhysical(this.container.scrollTop);
    }

    setScrollPosition(scrollTop: number, scrollLeft: number): void {
        const previousTop = this.container.scrollTop;
        const previousLeft = this.container.scrollLeft;
        const previousLogicalTop = this.getScrollTop();
        this.container.scrollTop = this.physicalScrollTopFromLogical(scrollTop);
        this.container.scrollLeft = scrollLeft;
        // 圧縮スクロールでは物理座標の丸めで見えない論理位置の変化も通知する。
        // 範囲制限後の位置で比較し、フォーカス復元など位置維持だけでは再描画を通知しない。
        if (this.container.scrollTop !== previousTop || this.container.scrollLeft !== previousLeft || this.getScrollTop() !== previousLogicalTop) {
            this.container.dispatchEvent(new Event('scroll'));
        }
    }

    getBoundingClientRect(): DOMRect {
        return this.container.getBoundingClientRect();
    }

    getScrollbarSize(): { scrollbarWidth: number; scrollbarHeight: number } {
        const scrollbarWidth = Math.max(0, this.container.offsetWidth - this.container.clientWidth);
        const scrollbarHeight = Math.max(0, this.container.offsetHeight - this.container.clientHeight);
        return { scrollbarWidth, scrollbarHeight };
    }
}
