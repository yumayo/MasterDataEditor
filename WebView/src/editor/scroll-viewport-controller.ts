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
        this.container.scrollTop = this.physicalScrollTopFromLogical(scrollTop);
        this.container.scrollLeft = scrollLeft;
        this.container.dispatchEvent(new Event('scroll'));
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
