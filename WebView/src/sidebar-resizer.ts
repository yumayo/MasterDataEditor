import { DEFAULT_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH } from "./constant";
import { Sidebar } from "./sidebar";
import { Tab } from "./tab";
import { Editor } from "./editor";

/**
 * サイドバーのリサイズ制御
 * サイドバーの右端にドラッグハンドルを配置し、
 * Sidebar・Tab・Editorの幅と位置を連動して変更する
 */
export class SidebarResizer {
    private readonly sidebar: Sidebar;
    private readonly tab: Tab;
    private readonly editor: Editor;
    private isDragging: boolean = false;
    private dragStartX: number = 0;
    private dragStartWidth: number = 0;
    private dragStartCursor: string = '';

    constructor(sidebar: Sidebar, tab: Tab, editor: Editor) {
        this.sidebar = sidebar;
        this.tab = tab;
        this.editor = editor;

        // 初期幅を各クラスに適用する
        this.applyWidth(DEFAULT_SIDEBAR_WIDTH);

        // リサイズハンドルを作成しサイドバーに追加
        const handleElement = document.createElement('div');
        handleElement.classList.add('sidebar-resize-handle');
        this.sidebar.appendResizeHandle(handleElement);

        handleElement.addEventListener('mousedown', (e: MouseEvent) => {
            e.preventDefault();
            this.isDragging = true;
            this.dragStartX = e.clientX;
            this.dragStartWidth = this.sidebar.getWidth();
            this.dragStartCursor = document.body.style.cursor;
            document.body.style.cursor = 'col-resize';
        });

        window.addEventListener('mousemove', (e: MouseEvent) => {
            if (!this.isDragging) return;
            const deltaX = e.clientX - this.dragStartX;
            const newWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, this.dragStartWidth + deltaX));
            this.applyWidth(newWidth);
        });

        window.addEventListener('mouseup', () => {
            if (!this.isDragging) return;
            this.isDragging = false;
            document.body.style.cursor = this.dragStartCursor;
        });
    }

    /** 指定幅をSidebar・Tab・Editorに一括適用する */
    private applyWidth(width: number): void {
        this.sidebar.applySidebarWidth(width);
        this.tab.applySidebarWidth(width);
        this.editor.applySidebarWidth(width);
    }
}
