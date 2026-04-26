export class ScrollViewportController {
    private container: HTMLElement;

    constructor(container: HTMLElement) {
        this.container = container;
    }

    getScrollLeft(): number {
        return this.container.scrollLeft;
    }

    getScrollTop(): number {
        return this.container.scrollTop;
    }

    setScrollPosition(scrollTop: number, scrollLeft: number): void {
        this.container.scrollTop = scrollTop;
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
