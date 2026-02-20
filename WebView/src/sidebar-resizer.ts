import { DEFAULT_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH } from "./constant";

/**
 * サイドバーのリサイズ制御
 * explorerの右端にドラッグハンドルを配置し、
 * explorer・tab・editorの幅と位置を連動して変更する
 */
export class SidebarResizer {
    private readonly explorerElement: HTMLElement;
    private readonly tabElement: HTMLElement;
    private readonly editorElement: HTMLElement;
    private readonly handleElement: HTMLElement;
    private isDragging: boolean = false;
    private dragStartX: number = 0;
    private dragStartWidth: number = 0;
    private dragStartCursor: string = '';

    constructor(explorerElement: HTMLElement, tabElement: HTMLElement, editorElement: HTMLElement) {
        this.explorerElement = explorerElement;
        this.tabElement = tabElement;
        this.editorElement = editorElement;

        // 初期幅をJS側から適用し、CSSのハードコード値を上書きする
        const initialWidthPx = DEFAULT_SIDEBAR_WIDTH + 'px';
        this.explorerElement.style.width = initialWidthPx;
        this.tabElement.style.left = initialWidthPx;
        this.tabElement.style.width = 'calc(100vw - ' + initialWidthPx + ')';
        this.editorElement.style.left = initialWidthPx;
        this.editorElement.style.width = 'calc(100vw - ' + initialWidthPx + ')';

        // リサイズハンドルを作成しexplorerに追加
        this.handleElement = document.createElement('div');
        this.handleElement.classList.add('sidebar-resize-handle');
        this.explorerElement.appendChild(this.handleElement);

        this.handleElement.addEventListener('mousedown', (e: MouseEvent) => {
            e.preventDefault();
            this.isDragging = true;
            this.dragStartX = e.clientX;
            this.dragStartWidth = this.explorerElement.getBoundingClientRect().width;
            this.dragStartCursor = document.body.style.cursor;
            document.body.style.cursor = 'col-resize';
        });

        window.addEventListener('mousemove', (e: MouseEvent) => {
            if (!this.isDragging) return;
            const deltaX = e.clientX - this.dragStartX;
            const newWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, this.dragStartWidth + deltaX));
            const widthPx = newWidth + 'px';
            this.explorerElement.style.width = widthPx;
            this.tabElement.style.left = widthPx;
            this.tabElement.style.width = 'calc(100vw - ' + widthPx + ')';
            this.editorElement.style.left = widthPx;
            this.editorElement.style.width = 'calc(100vw - ' + widthPx + ')';
        });

        window.addEventListener('mouseup', () => {
            if (!this.isDragging) return;
            this.isDragging = false;
            document.body.style.cursor = this.dragStartCursor;
        });
    }
}
