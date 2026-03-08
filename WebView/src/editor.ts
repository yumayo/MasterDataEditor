import {RelationsPanel} from "./relations-panel";
import {Tab} from "./tab";

export class Editor {

    private readonly element: HTMLElement;

    /** 左ペイン（EditorTableを包む領域） */
    private readonly leftPane: HTMLElement;

    /** 左ペインと右ペインを横並びに配置するコンテンツ領域 */
    private readonly contentArea: HTMLElement;

    /** パンくずバー（ナビゲーション履歴がないときは非表示） */
    private readonly breadcrumbBar: HTMLElement;

    /**
     * パンくずクリック処理のため Tab を直接参照する（相互参照）。
     * Tab コンストラクタ末尾の connectTab() で設定される。
     */
    private tab: Tab | false;

    constructor(editorElement: HTMLElement) {
        this.element = editorElement;
        this.tab = false;

        // パンくずバーを .editor の最初の子として作成する（初期状態は非表示）
        const breadcrumbBar = document.createElement('div');
        breadcrumbBar.classList.add('editor-breadcrumb-bar');
        breadcrumbBar.style.display = 'none';
        editorElement.appendChild(breadcrumbBar);
        this.breadcrumbBar = breadcrumbBar;

        // 左ペインと右ペインを横並びに配置するコンテンツ領域を作成する
        const contentArea = document.createElement('div');
        contentArea.classList.add('editor-content');
        editorElement.appendChild(contentArea);
        this.contentArea = contentArea;

        // 左ペインをコンテンツ領域内に作成する
        const leftPane = document.createElement('div');
        leftPane.classList.add('editor-left-pane');
        contentArea.appendChild(leftPane);
        this.leftPane = leftPane;
    }

    /**
     * Tab 参照を接続する（Tab コンストラクタ末尾で呼ばれる）
     * パンくずクリック時に Tab のナビゲーションメソッドを直接呼ぶために必要
     */
    connectTab(tab: Tab): void {
        this.tab = tab;
    }

    appendChild(element: HTMLElement): void {
        this.leftPane.appendChild(element);
    }

    /**
     * リレーションパネルをコンテンツ領域（右ペイン）に追加する
     * 左ペインではなく editor-content へ追加するため専用メソッドを用意する
     */
    appendRelationsPanel(panel: RelationsPanel): void {
        panel.appendTo(this.contentArea);
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

    /**
     * パンくずバーを更新する（Tab からナビゲーション履歴変更時に呼ばれる）
     *
     * history が空の場合: バーを非表示にする。
     * history がある場合: 遷移元テーブル名リンク + セパレータ + 現在テーブル名（太字）を描画する。
     *
     * クリックハンドラは Tab を直接呼ぶ（密結合・相互参照パターン）。
     */
    updateBreadcrumbBar(history: Array<{ tableName: string; pkValue: string }>, currentTableName: string): void {
        if (history.length === 0) {
            this.breadcrumbBar.style.display = 'none';
            this.breadcrumbBar.textContent = '';
            return;
        }

        this.breadcrumbBar.style.display = '';
        // 既存の子要素をすべて除去してから再描画する
        this.breadcrumbBar.textContent = '';

        for (let i = 0; i < history.length; i++) {
            if (i > 0) {
                const sep = document.createElement('span');
                sep.classList.add('editor-breadcrumb-sep');
                sep.textContent = '›';
                this.breadcrumbBar.appendChild(sep);
            }
            const crumb = document.createElement('span');
            crumb.classList.add('editor-breadcrumb-item');
            crumb.textContent = history[i].tableName;
            const entry = history[i];
            crumb.addEventListener('click', () => {
                // connectTab() は Tab コンストラクタ末尾で必ず呼ばれる。
                // updateBreadcrumbBar() は Tab から呼ばれるため tab は必ず設定済み。
                if (this.tab === false) throw new Error('[Editor] updateBreadcrumbBar click: tab が未接続です');
                // クリックした位置より後の履歴を切り捨ててからジャンプする
                this.tab.truncateNavigationHistory(i);
                this.tab.navigateToTableRow(entry.tableName, entry.pkValue);
            });
            this.breadcrumbBar.appendChild(crumb);
        }

        // 現在のテーブル名を末尾に太字（クリック不可）で表示する
        const sep = document.createElement('span');
        sep.classList.add('editor-breadcrumb-sep');
        sep.textContent = '›';
        this.breadcrumbBar.appendChild(sep);

        const currentCrumb = document.createElement('span');
        currentCrumb.classList.add('editor-breadcrumb-item', 'editor-breadcrumb-item--active');
        currentCrumb.textContent = currentTableName;
        this.breadcrumbBar.appendChild(currentCrumb);
    }
}
