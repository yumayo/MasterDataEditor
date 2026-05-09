import {RelationsPanel} from "../panels/relations-panel";
import {Tab} from "../tabs/tab";
import {DiffView} from "../diff/diff-view";
import {StatusBar} from "../ui/status-bar";
import {BottomPanel} from "../panels/bottom-panel";
import {ScrollbarMarkerTrack} from "../ui/scrollbar-marker-track";

/**
 * RelationsPanel の表示/非表示トグル状態変更を通知するリスナー型。
 * Toolbar のアクティブ状態更新に使用する。
 */
export type RelationsPanelVisibilityListener = (visible: boolean) => void;

export class Editor {

    private readonly element: HTMLElement;

    /** 左ペイン（EditorTableを包む領域） */
    private readonly leftPane: HTMLElement;

    /** 内部スクロール viewport と旧 .editor-left-pane スクロールAPIを同期するための不可視スペーサー */
    private readonly leftPaneScrollProxy: HTMLElement;

    /** 左スロット（表示中の左ペインを格納するラッパー） */
    private readonly leftSlot: HTMLElement;

    /** 右スロット（表示中のRelationsPanelを格納するラッパー） */
    private readonly rightSlot: HTMLElement;

    /** ナビゲーションバー（ペインが3つ以上のとき表示） */
    private readonly navigationBar: HTMLElement;

    /** ←ボタン */
    private readonly navLeftButton: HTMLButtonElement;

    /** →ボタン */
    private readonly navRightButton: HTMLButtonElement;

    /** "2 / 3" のようなページインジケーター */
    private readonly navIndicator: HTMLElement;

    /** Tab への参照。connectTab() で設定される（ボタンクリック時にナビゲーション呼び出し用） */
    private tab: Tab | false;

    /** RelationsPanel の表示/非表示状態（SSOT） */
    private relationsPanelVisible: boolean;

    /** FormPanel 表示中に rightSlot を一時的に表示するためのフラグ */
    private formPanelForcesRightSlotVisible: boolean;

    /** FormPanel 表示中に退避した右スロット直下ペインの display 値 */
    private readonly formPanelHiddenRightSlotDisplays: Map<HTMLElement, string>;

    /** 折りたたみ前の右スロットの flex-basis 値（展開時に復元するため記憶する） */
    private savedRightSlotFlexBasis: string;

    /** RelationsPanel 表示/非表示変更時のリスナー（Toolbar のアクティブ状態連動用） */
    private visibilityListener: RelationsPanelVisibilityListener | false;

    /** RelationsPanelへの参照。appendRelationsPanel() で設定される */
    private relationsPanel: RelationsPanel | false;

    /** 垂直スクロールバーマーカートラック（エラー・git変更行の可視化） */
    private readonly scrollbarMarkerTrack: ScrollbarMarkerTrack;

    private isSyncingLeftPaneFromTable: boolean;
    private isSyncingTableFromLeftPane: boolean;

    constructor(editorElement: HTMLElement) {
        this.element = editorElement;
        this.tab = false;
        this.relationsPanelVisible = false;
        this.formPanelForcesRightSlotVisible = false;
        this.formPanelHiddenRightSlotDisplays = new Map();
        this.savedRightSlotFlexBasis = '';
        this.visibilityListener = false;
        this.relationsPanel = false;
        this.isSyncingLeftPaneFromTable = false;
        this.isSyncingTableFromLeftPane = false;

        // ナビゲーションバーを editor の先頭に配置する（editor-content の上）
        const navigationBar = document.createElement('div');
        navigationBar.classList.add('editor-navigation-bar');
        navigationBar.style.display = 'none';
        editorElement.appendChild(navigationBar);
        this.navigationBar = navigationBar;

        const navLeft = document.createElement('button');
        navLeft.classList.add('nav-left');
        navLeft.textContent = '←';
        navLeft.addEventListener('click', () => {
            if (this.tab !== false) this.tab.navigateLeft();
        });
        navigationBar.appendChild(navLeft);
        this.navLeftButton = navLeft;

        const navIndicator = document.createElement('span');
        navIndicator.classList.add('nav-indicator');
        navigationBar.appendChild(navIndicator);
        this.navIndicator = navIndicator;

        const navRight = document.createElement('button');
        navRight.classList.add('nav-right');
        navRight.textContent = '→';
        navRight.addEventListener('click', () => {
            if (this.tab !== false) this.tab.navigateRight();
        });
        navigationBar.appendChild(navRight);
        this.navRightButton = navRight;

        // 左ペインと右ペインを横並びに配置するコンテンツ領域を作成する
        const contentArea = document.createElement('div');
        contentArea.classList.add('editor-content');
        editorElement.appendChild(contentArea);

        // 左スロット（editor-left-pane のラッパー）
        const leftSlot = document.createElement('div');
        leftSlot.classList.add('editor-left-slot');
        contentArea.appendChild(leftSlot);
        this.leftSlot = leftSlot;

        // leftPane を leftSlot の中に入れる（後方互換性: .editor-left-pane は .editor-left-slot の子として存在し続ける）
        const leftPane = document.createElement('div');
        leftPane.classList.add('editor-left-pane');
        leftPane.addEventListener('wheel', (event) => { this.redirectOuterWheelToMainViewport(event); }, { passive: false });
        leftPane.addEventListener('scroll', () => { this.forwardLeftPaneScrollToActiveTable(); });
        leftPane.addEventListener('editor-table-scroll-metrics-changed', () => { this.syncActiveTableScrollState(); });
        leftSlot.appendChild(leftPane);
        this.leftPane = leftPane;

        const leftPaneScrollProxy = document.createElement('div');
        leftPaneScrollProxy.classList.add('editor-left-pane-scroll-proxy');
        leftPane.appendChild(leftPaneScrollProxy);
        this.leftPaneScrollProxy = leftPaneScrollProxy;

        // 右スロット（RelationsPanel のラッパー）
        const rightSlot = document.createElement('div');
        rightSlot.classList.add('editor-right-slot');
        contentArea.appendChild(rightSlot);
        this.rightSlot = rightSlot;

        // スクロールバーマーカートラックを左スロットに配置する
        this.scrollbarMarkerTrack = new ScrollbarMarkerTrack(leftSlot, leftPane, 'scrollbar-marker-track');
    }

    /** Tab を接続する（ナビゲーションボタンのクリックハンドラ用） */
    connectTab(tab: Tab): void {
        this.tab = tab;
    }

    /** RelationsPanel 表示/非表示変更時のリスナーを設定する（Toolbar から呼ばれる） */
    connectVisibilityListener(listener: RelationsPanelVisibilityListener): void {
        this.visibilityListener = listener;
    }

    /** leftPane への要素追加（TabからEditorTableのwrapperを追加する） */
    appendChild(element: HTMLElement): void {
        this.leftPane.appendChild(element);
    }

    syncActiveTableScrollState(): void {
        if (this.tab === false) return;
        const activeState = this.tab.getActiveTabState();
        if (activeState === false) {
            this.leftPaneScrollProxy.style.height = '100%';
            this.leftPaneScrollProxy.style.width = '1px';
            return;
        }
        if (!activeState.editorTable.usesInternalScrollLayout()) return;
        const metrics = activeState.editorTable.getScrollMetrics();
        const maxScrollTop = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
        const proxyHeight = maxScrollTop + this.leftPane.clientHeight;
        this.leftPaneScrollProxy.style.height = `${proxyHeight}px`;
        this.leftPaneScrollProxy.style.width = `${Math.max(metrics.scrollWidth, 1)}px`;

        if (this.isSyncingTableFromLeftPane) return;
        this.isSyncingLeftPaneFromTable = true;
        try {
            if (this.leftPane.scrollTop !== metrics.scrollTop) this.leftPane.scrollTop = metrics.scrollTop;
            if (this.leftPane.scrollLeft !== metrics.scrollLeft) this.leftPane.scrollLeft = metrics.scrollLeft;
        } finally {
            this.isSyncingLeftPaneFromTable = false;
        }
    }

    private forwardLeftPaneScrollToActiveTable(): void {
        if (this.isSyncingLeftPaneFromTable) return;
        if (this.tab === false) return;
        const activeState = this.tab.getActiveTabState();
        if (activeState === false) return;
        if (!activeState.editorTable.usesInternalScrollLayout()) return;
        const metrics = activeState.editorTable.getScrollMetrics();
        if (this.leftPane.scrollTop === metrics.scrollTop) return;
        this.isSyncingTableFromLeftPane = true;
        try {
            activeState.editorTable.restoreScrollPosition(this.leftPane.scrollTop, metrics.scrollLeft);
        } finally {
            this.isSyncingTableFromLeftPane = false;
        }
    }

    /**
     * リレーションパネルをコンテンツ領域（右スロット）に追加する。
     * 追加後に初期表示状態（デフォルト非表示）を DOM に反映する。
     */
    appendRelationsPanel(panel: RelationsPanel): void {
        this.relationsPanel = panel;
        panel.appendTo(this.rightSlot);
        this.applyRelationsPanelVisibility();
    }

    /**
     * 表示中の左右スロットの内容を入れ替える（ペインスタックナビゲーション用）
     * 既存の子要素を全て取り除いてから新しい要素を追加する
     */
    setVisiblePanes(leftElement: HTMLElement, rightElement: HTMLElement): void {
        // 左スロットの全子要素を取り除いてから新しい左ペインを追加する
        while (this.leftSlot.firstChild) {
            this.leftSlot.removeChild(this.leftSlot.firstChild);
        }
        this.leftSlot.appendChild(leftElement);
        this.reattachActiveScrollbarMarkerTrack();

        // 右スロットの全子要素を取り除いてから新しい右ペインを追加する
        while (this.rightSlot.firstChild) {
            this.rightSlot.removeChild(this.rightSlot.firstChild);
        }
        this.rightSlot.appendChild(rightElement);

        // ペインスタックナビゲーションで右スロットの内容が差し替わるため、
        // 現在のトグル状態（表示/非表示）を反映する
        this.applyRelationsPanelVisibility();
    }

    /**
     * ナビゲーションバーの表示・インジケーター・ボタン有効状態を更新する
     * totalPanes <= 2 のとき非表示、3以上のとき表示する
     * インジケーター: "${viewIndex + 1} / ${totalPanes}"
     */
    updateNavigationBar(viewIndex: number, totalPanes: number): void {
        if (totalPanes <= 2) {
            this.navigationBar.style.display = 'none';
            return;
        }
        this.navigationBar.style.display = '';
        this.navIndicator.textContent = `${viewIndex + 1} / ${totalPanes}`;
        // viewIndex=0 のとき ← ボタンを無効化する
        this.navLeftButton.disabled = viewIndex <= 0;
        // viewIndex が最右ペアのとき → ボタンを無効化する
        this.navRightButton.disabled = viewIndex >= totalPanes - 2;
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

    private redirectOuterWheelToMainViewport(event: WheelEvent): void {
        if (event.ctrlKey) return;
        if (!(event.target instanceof Element)) return;
        if (this.tab === false) return;
        const activeState = this.tab.getActiveTabState();
        if (activeState === false) return;
        if (!activeState.editorTable.usesInternalScrollLayout()) return;
        if (!activeState.wrapperElement.contains(event.target)) return;
        const mainViewport = activeState.wrapperElement.querySelector('.editor-table-main-viewport');
        if (!(mainViewport instanceof HTMLElement)) return;
        if (mainViewport.contains(event.target)) return;

        let deltaX = event.deltaX;
        let deltaY = event.deltaY;
        if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
            deltaX *= 16;
            deltaY *= 16;
        } else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
            deltaX *= this.leftPane.clientWidth;
            deltaY *= this.leftPane.clientHeight;
        }
        if (event.shiftKey && deltaX === 0 && deltaY !== 0) {
            deltaX = deltaY;
            deltaY = 0;
        }

        event.preventDefault();
        activeState.editorTable.scrollByInput(deltaY, deltaX);
    }

    /** 垂直スクロールバーマーカートラックを返す（EditorTable への接続用） */
    getScrollbarMarkerTrack(): ScrollbarMarkerTrack {
        return this.scrollbarMarkerTrack;
    }

    /**
     * 差分ビューが現在表示中かどうかを返す
     * leftSlot に diff-view-wrapper クラスの要素が存在するかで判定する
     */
    hasDiffView(): boolean {
        return this.leftSlot.querySelector('.diff-view-wrapper') !== null;
    }

    /**
     * 差分ビューを左ペインに表示する
     * leftSlot の内容を差分ビュー専用ラッパーに置き換える
     * leftPane はフィールドで保持しているため hideDiffView() で復元できる
     */
    showDiffView(diffView: DiffView): void {
        // leftSlot の全子要素を除去する（leftPane はフィールドで保持されているため復元可能）
        while (this.leftSlot.firstChild) {
            this.leftSlot.removeChild(this.leftSlot.firstChild);
        }
        // 差分ビューをラッパーに包んで leftSlot に追加する
        const wrapper = document.createElement('div');
        wrapper.classList.add('editor-left-pane', 'diff-view-wrapper');
        diffView.appendTo(wrapper);
        this.leftSlot.appendChild(wrapper);
        this.reattachActiveScrollbarMarkerTrack();

        // 右スロットを非表示にして差分ビューを全幅で表示する
        this.rightSlot.style.display = 'none';
    }

    /**
     * 差分ビューを閉じてエディターを通常状態に戻す
     * leftSlot を全クリアして元の leftPane を復元し、右スロットを再表示する
     */
    hideDiffView(): void {
        if (!this.hasDiffView()) return;
        // 差分ビューラッパーを除去して元の leftPane を復元する
        while (this.leftSlot.firstChild) {
            this.leftSlot.removeChild(this.leftSlot.firstChild);
        }
        this.leftSlot.appendChild(this.leftPane);
        this.reattachActiveScrollbarMarkerTrack();
        // RelationsPanel のトグル状態を尊重して右スロットの表示を復元する
        this.applyRelationsPanelVisibility();
    }

    /**
     * 設定タブ表示モードに切り替える。
     * editor-right-slot（RelationsPanel）を非表示にし、設定画面を全幅表示する。
     * 設定モード中はナビゲーションバーが不要なため非表示にする。
     */
    enterSettingsMode(): void {
        this.rightSlot.style.display = 'none';
        this.navigationBar.style.display = 'none';
    }

    /**
     * 設定タブ表示モードを解除して通常のエディター状態に戻す。
     * RelationsPanel のトグル状態を尊重して右スロットの表示を復元する。
     * 後続の updateNavigationBar() が paneStack.length に基づいて適切に表示制御するため、
     * ナビゲーションバーは非表示のまま維持する。
     */
    leaveSettingsMode(): void {
        this.applyRelationsPanelVisibility();
        this.navigationBar.style.display = 'none';
    }

    /**
     * ボトムパネル（PROBLEMS / DEBUG CONSOLE）を editor 直下に追加する。
     * editor は flex-direction: column のため、contentArea の下段に配置される。
     */
    appendBottomPanel(panel: BottomPanel): void {
        panel.appendTo(this.element);
    }

    /**
     * ステータスバーを editor 直下の最下部に追加する。
     */
    appendStatusBar(statusBar: StatusBar): void {
        statusBar.appendTo(this.element);
    }

    /** サイドバー幅に応じてエディター領域の位置と幅を更新する */
    applySidebarWidth(sidebarWidth: number): void {
        const widthPx = sidebarWidth + 'px';
        this.element.style.left = widthPx;
        this.element.style.width = 'calc(100vw - ' + widthPx + ')';
    }

    // =========================================================================
    // RelationsPanel 表示/非表示トグル
    // =========================================================================

    /**
     * RelationsPanel の表示/非表示をトグルする。
     * ツールバーのトグルボタンやリサイズハンドルのダブルクリックから呼ばれる。
     */
    isRelationsPanelVisible(): boolean { return this.relationsPanelVisible; }

    /**
     * RelationsPanel がトグルで非表示でも、FormPanel 表示中だけ右スロットを表示する。
     * RelationsPanel の表示状態自体は変更しないため、ツールバーのトグル状態は維持される。
     */
    showRightSlotForFormPanel(): HTMLElement {
        if (this.formPanelForcesRightSlotVisible) return this.rightSlot;
        this.formPanelForcesRightSlotVisible = true;
        this.applyRelationsPanelVisibility();
        this.hideRightSlotChildrenForFormPanel();
        return this.rightSlot;
    }

    /**
     * FormPanel 用の一時表示を解除し、RelationsPanel トグル状態に従って右スロットを戻す。
     */
    restoreRightSlotAfterFormPanel(): void {
        if (!this.formPanelForcesRightSlotVisible) return;
        this.restoreRightSlotChildrenAfterFormPanel();
        this.formPanelForcesRightSlotVisible = false;
        this.applyRelationsPanelVisibility();
    }

    private hideRightSlotChildrenForFormPanel(): void {
        for (const child of Array.from(this.rightSlot.children)) {
            if (!(child instanceof HTMLElement)) continue;
            if (child.classList.contains('form-panel')) continue;
            if (!this.formPanelHiddenRightSlotDisplays.has(child)) {
                this.formPanelHiddenRightSlotDisplays.set(child, child.style.display);
            }
            child.style.display = 'none';
        }
    }

    private restoreRightSlotChildrenAfterFormPanel(): void {
        for (const [element, display] of this.formPanelHiddenRightSlotDisplays.entries()) {
            if (element.isConnected) element.style.display = display;
        }
        this.formPanelHiddenRightSlotDisplays.clear();
    }

    toggleRelationsPanel(): void {
        if (this.relationsPanelVisible) {
            this.hideRelationsPanel();
        } else {
            this.showRelationsPanel();
        }
    }

    /**
     * RelationsPanel を非表示にする。
     * 右スロットの現在の flex-basis を記憶してから非表示にし、左ペインを全幅化する。
     */
    hideRelationsPanel(): void {
        if (!this.relationsPanelVisible) return;
        // 現在の flex-basis を記憶する（展開時に復元するため）
        this.savedRightSlotFlexBasis = this.rightSlot.style.flexBasis;
        this.relationsPanelVisible = false;
        this.applyRelationsPanelVisibility();
        this.notifyVisibilityListener();
        // RelationsPanelにミニテーブル破棄を通知してリソースを解放する
        if (this.relationsPanel !== false) this.relationsPanel.notifyVisibilityChanged(false);
    }

    /**
     * RelationsPanel を表示する。
     * 記憶した flex-basis を復元して右スロットを再表示し、左ペインを元の幅に戻す。
     */
    showRelationsPanel(): void {
        if (this.relationsPanelVisible) return;
        this.relationsPanelVisible = true;
        this.applyRelationsPanelVisibility();
        this.notifyVisibilityListener();
        // RelationsPanelに表示を通知して、接続中のEditorTableがあれば自動リフレッシュする
        if (this.relationsPanel !== false) this.relationsPanel.notifyVisibilityChanged(true);
    }

    /**
     * 現在の relationsPanelVisible 状態に基づいて右スロットの CSS を更新する。
     * showRelationsPanel / hideRelationsPanel / hideDiffView / leaveSettingsMode から呼ばれる共通メソッド。
     *
     * 非表示時は visibility:hidden + flex-basis:0 にする。
     * これにより .relations-panel は Playwright の toBeVisible() で not visible と判定され、
     * リサイズハンドルも visibility が継承されて当たり判定がなくなる。
     */
    private applyRelationsPanelVisibility(): void {
        if (this.relationsPanelVisible || this.formPanelForcesRightSlotVisible) {
            // 右スロットを表示する（showDiffView/enterSettingsMode で display:none になっている可能性があるためリセット）
            this.rightSlot.style.display = '';
            this.rightSlot.style.visibility = '';
            this.rightSlot.style.flexGrow = '';
            this.rightSlot.style.flexShrink = '';
            // 記憶していた flex-basis を復元する（空文字の場合は CSS のデフォルト値が適用される）
            this.rightSlot.style.flexBasis = this.savedRightSlotFlexBasis;
        } else {
            // 右スロットを visibility:hidden にして完全に隠す。
            // flex-basis を 0 にして右端の無駄な空きスペースをなくす。
            this.rightSlot.style.display = '';
            this.rightSlot.style.visibility = 'hidden';
            this.rightSlot.style.flexGrow = '0';
            this.rightSlot.style.flexShrink = '0';
            this.rightSlot.style.flexBasis = '0';
        }
    }

    private reattachActiveScrollbarMarkerTrack(): void {
        if (this.tab === false) return;
        const activeState = this.tab.getActiveTabState();
        if (activeState === false) return;
        activeState.editorTable.reattachScrollbarMarkerTrack();
    }

    /** リスナーに表示/非表示の変更を通知する */
    private notifyVisibilityListener(): void {
        if (this.visibilityListener !== false) {
            this.visibilityListener(this.relationsPanelVisible);
        }
    }
}
