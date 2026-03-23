import {RelationsPanel} from "./relations-panel";
import {Tab} from "./tab";
import {DiffView} from "./diff-view";
import {ValidationPanel} from "./validation-panel";
import {StatusBar} from "./status-bar";

/**
 * RelationsPanel の表示/非表示トグル状態変更を通知するリスナー型。
 * Toolbar のアクティブ状態更新に使用する。
 */
export type RelationsPanelVisibilityListener = (visible: boolean) => void;

export class Editor {

    private readonly element: HTMLElement;

    /** 左ペイン（EditorTableを包む領域） */
    private readonly leftPane: HTMLElement;

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

    /** 折りたたみ前の右スロットの flex-basis 値（展開時に復元するため記憶する） */
    private savedRightSlotFlexBasis: string;

    /** RelationsPanel 表示/非表示変更時のリスナー（Toolbar のアクティブ状態連動用） */
    private visibilityListener: RelationsPanelVisibilityListener | false;

    constructor(editorElement: HTMLElement) {
        this.element = editorElement;
        this.tab = false;
        this.relationsPanelVisible = false;
        this.savedRightSlotFlexBasis = '';
        this.visibilityListener = false;

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
        leftSlot.appendChild(leftPane);
        this.leftPane = leftPane;

        // 右スロット（RelationsPanel のラッパー）
        const rightSlot = document.createElement('div');
        rightSlot.classList.add('editor-right-slot');
        contentArea.appendChild(rightSlot);
        this.rightSlot = rightSlot;

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

    /**
     * リレーションパネルをコンテンツ領域（右スロット）に追加する。
     * 追加後に初期表示状態（デフォルト非表示）を DOM に反映する。
     */
    appendRelationsPanel(panel: RelationsPanel): void {
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
     * バリデーションエラーパネルを editor 直下（コンテンツ領域の下）に追加する。
     * editor は flex-direction: column のため、contentArea の下段に配置される。
     */
    appendValidationPanel(panel: ValidationPanel): void {
        panel.appendTo(this.element);
    }

    /**
     * ステータスバーを editor 直下の最下部に追加する。
     * バリデーションパネルの後に追加することで最下段に配置される。
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
        if (this.relationsPanelVisible) {
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

    /** リスナーに表示/非表示の変更を通知する */
    private notifyVisibilityListener(): void {
        if (this.visibilityListener !== false) {
            this.visibilityListener(this.relationsPanelVisible);
        }
    }
}
