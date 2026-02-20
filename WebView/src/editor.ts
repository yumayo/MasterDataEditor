export class Editor {

    readonly element: HTMLElement;

    constructor(editorElement: HTMLElement) {
        this.element = editorElement;
    }

    appendChild(element: HTMLElement): void {
        this.element.appendChild(element);
    }

    clear(): void {
        this.element.innerHTML = '';
    }

    /** サイドバー幅に応じてエディター領域の位置と幅を更新する */
    applySidebarWidth(sidebarWidth: number): void {
        const widthPx = sidebarWidth + 'px';
        this.element.style.left = widthPx;
        this.element.style.width = 'calc(100vw - ' + widthPx + ')';
    }
}
