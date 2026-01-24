export class ScrollViewportController {
    private container: HTMLElement;
    private handler: () => void;

    constructor(container: HTMLElement, handler: () => void) {
        this.container = container;
        this.handler = handler;
    }

    activate(): void {
        this.container.addEventListener('scroll', this.handler);
        this.handler();
    }

    deactivate(): void {
        this.container.removeEventListener('scroll', this.handler);
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
