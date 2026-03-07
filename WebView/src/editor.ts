import {RelationsPanel} from "./relations-panel";

export class Editor {

    private readonly element: HTMLElement;

    /** 左ペイン（既存のEditorTableを包む領域） */
    private readonly leftPane: HTMLElement;

    constructor(editorElement: HTMLElement) {
        this.element = editorElement;

        // 左ペインを作成してelement内に追加する
        const leftPane = document.createElement('div');
        leftPane.classList.add('editor-left-pane');
        editorElement.appendChild(leftPane);
        this.leftPane = leftPane;
    }

    appendChild(element: HTMLElement): void {
        this.leftPane.appendChild(element);
    }

    /**
     * リレーションパネルをeditorのルート要素（右ペイン）に追加する
     * 左ペインではなくeditor.elementへ直接追加するため専用メソッドを用意する
     */
    appendRelationsPanel(panel: RelationsPanel): void {
        panel.appendTo(this.element);
    }

    /**
     * スクロール位置を保存する（タブ非アクティブ時）
     */
    saveScrollPosition(state: { savedScrollLeft: number; savedScrollTop: number }): void {
        state.savedScrollLeft = this.leftPane.scrollLeft;
        state.savedScrollTop = this.leftPane.scrollTop;
    }

    /**
     * スクロール位置を復元する（タブアクティブ時）
     */
    restoreScrollPosition(state: { savedScrollLeft: number; savedScrollTop: number }): void {
        this.leftPane.scrollLeft = state.savedScrollLeft;
        this.leftPane.scrollTop = state.savedScrollTop;
    }

    /**
     * スクロールビューポートとして左ペイン要素を渡す（ScrollViewportController生成用）
     */
    getLeftPaneForScroll(): HTMLElement {
        return this.leftPane;
    }

    /** サイドバー幅に応じてエディター領域の位置と幅を更新する */
    applySidebarWidth(sidebarWidth: number): void {
        const widthPx = sidebarWidth + 'px';
        this.element.style.left = widthPx;
        this.element.style.width = 'calc(100vw - ' + widthPx + ')';
    }
}
