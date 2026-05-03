import {Tab} from "./tab";

/**
 * ブラウザ History API を使ったナビゲーション履歴管理。
 * マウスサイドボタン（戻る/進む）や Alt+Left/Right で各種ナビゲーション操作を復元する。
 *
 * 対応エントリタイプ:
 *   - tab-switch:           タブ切り替え（tabName, viewIndex=0）
 *   - pane-push:            定義ジャンプ（paneStack深化）(tabName, viewIndex=N)
 *   - navigate-row:         REFERENCESパネルからのジャンプ（tableName）
 *   - navigate-cell:        検索パネルからのジャンプ（tableName）
 *   - form-panel-open:      フォームパネル開（tabName, pkValue）
 *
 * Tab との相互参照で密結合する。
 * Tab コンストラクタ末尾で生成され、Tab.enableTabButton() から pushTabSwitch() が呼ばれる。
 */
export class NavigationHistory {
    /** popstate による復元中かどうか（Tab から再 pushState されるのを防ぐ） */
    private restoring: boolean;
    /** navigate-row/cell の push 直後に enableTabButton からの tab-switch push を1回スキップするフラグ */
    private suppressNextTabSwitch: boolean;
    /** タブ切り替えを委譲する Tab への参照 */
    private readonly tab: Tab;
    /** popstate リスナーの参照（将来の removeEventListener に備えてメンバ変数に保持） */
    private readonly popstateHandler: (e: PopStateEvent) => void;

    constructor(tab: Tab) {
        this.restoring = false;
        this.suppressNextTabSwitch = false;
        this.tab = tab;

        // 初期ロードのエントリを保護（全部戻りきってもページがアンロードされないようにする）
        history.replaceState({ type: 'initial' }, '');

        // popstate リスナーをメンバ変数に保持し、戻る/進む操作時に発火させる
        this.popstateHandler = (e: PopStateEvent) => {
            const state = e.state as Record<string, unknown> | null;
            // state が null の場合（ブラウザが管理するエントリ）は無視する
            if (state === null) return;
            // initial エントリに到達した場合（全部戻りきった場合）は即座に forward で跳ね返す。
            // initial はページアンロード防止の番兵であり、ユーザーが到達すべきエントリではない。
            // ここで跳ね返すことで、戻るボタンの余分な消費を防ぎ進む履歴が破壊されない。
            if (state['type'] === 'initial') {
                history.forward();
                return;
            }

            this.restoring = true;
            try {
                const type = state['type'];
                if (type === 'form-panel-open' && typeof state['tabName'] === 'string' && typeof state['pkValue'] === 'string') {
                    // フォーム復元前にタブを切り替える（異なるタブで開いたフォームの復元に必要）
                    this.tab.switchToExistingTab(state['tabName']);
                    // フォームパネルを閉じて、ルートページで再オープンする（restoring中なので履歴pushはスキップされる）
                    this.tab.closeFormPanel();
                    this.tab.showFormPanel(state['tabName'], state['pkValue']);
                } else {
                    if (type === 'tab-switch' && typeof state['tabName'] === 'string') {
                        this.closeOrSuspendFormPanelForDestination(state['tabName']);
                        // tabName で切り替え + viewIndex は 0 に戻す
                        this.tab.switchToExistingTab(state['tabName']);
                        this.tab.restoreViewIndex(0);
                        this.tab.restoreFormPanelForActiveTab();
                    } else if (type === 'pane-push' && typeof state['tabName'] === 'string') {
                        this.closeOrSuspendFormPanelForDestination(state['tabName']);
                        // pane-push エントリには viewIndex/tableName/pkValue が必ず存在する。存在しない場合は設計ミスのため throw する
                        if (typeof state['viewIndex'] !== 'number') throw new Error('[NavigationHistory] pane-push エントリに viewIndex がありません');
                        if (typeof state['tableName'] !== 'string') throw new Error('[NavigationHistory] pane-push エントリに tableName がありません');
                        if (typeof state['pkValue'] !== 'string') throw new Error('[NavigationHistory] pane-push エントリに pkValue がありません');
                        this.tab.switchToExistingTab(state['tabName']);
                        // goForward で到達した場合、paneStack がトランケートされていることがある。
                        // その場合は pushRelationsPanel でペインスタックを再構築してから viewIndex を復元する。
                        this.tab.restoreOrRebuildPaneStack(state['viewIndex'], state['tableName'], state['pkValue']);
                    } else if ((type === 'navigate-row' || type === 'navigate-cell') && typeof state['tableName'] === 'string') {
                        this.closeOrSuspendFormPanelForDestination(state['tableName']);
                        // popstate は「移動先エントリ」の state を返すため、tableName（ジャンプ先）に切り替える
                        // goBack 時は前のエントリ（tab-switch 等）の state が返るため、tab-switch ハンドラが元のタブを自動復元する
                        this.tab.switchToExistingTab(state['tableName']);
                    } else {
                        // フォーム以外かつ移動先タブを判断できないエントリでは従来通り閉じる。
                        this.tab.closeFormPanel();
                    }
                }
            } finally {
                this.restoring = false;
            }
        };
        window.addEventListener('popstate', this.popstateHandler);
    }

    /**
     * タブ遷移をブラウザ履歴に記録する。
     * restoring 中（popstate からの復元）や suppressNextTabSwitch フラグが立っている場合はスキップする。
     * 現在の履歴エントリと同じタブ名なら重複 push をスキップする。
     */
    pushTabSwitch(tabName: string): void {
        if (this.restoring) return;
        // navigate-row/cell push 直後は enableTabButton から呼ばれる tab-switch を1回スキップする
        if (this.suppressNextTabSwitch) {
            this.suppressNextTabSwitch = false;
            return;
        }
        // 現在の履歴エントリと同じタブなら重複 push しない
        const currentState = history.state as Record<string, unknown> | null;
        if (currentState !== null && currentState['type'] === 'tab-switch' && currentState['tabName'] === tabName) return;
        history.pushState({ type: 'tab-switch', tabName, viewIndex: 0 }, '');
    }

    /**
     * 定義ジャンプ（paneStack深化）をブラウザ履歴に記録する。
     * pushRelationsPanel() 呼び出し後、viewIndex が深化した後に呼ぶこと。
     * goForward で復帰する際に pushRelationsPanel を再構築できるよう tableName/pkValue も保持する。
     */
    pushPaneChange(tabName: string, viewIndex: number, tableName: string, pkValue: string): void {
        if (this.restoring) return;
        history.pushState({ type: 'pane-push', tabName, viewIndex, tableName, pkValue }, '');
    }

    /**
     * REFERENCESパネルからのジャンプをブラウザ履歴に記録する。
     * enableTabButton が連動して pushTabSwitch を呼ぶため、suppressNextTabSwitch で抑制する。
     */
    pushNavigateRow(tableName: string): void {
        if (this.restoring) return;
        this.suppressNextTabSwitch = true;
        history.pushState({ type: 'navigate-row', tableName }, '');
    }

    /**
     * 検索パネルからのジャンプをブラウザ履歴に記録する。
     * enableTabButton が連動して pushTabSwitch を呼ぶため、suppressNextTabSwitch で抑制する。
     */
    pushNavigateCell(tableName: string): void {
        if (this.restoring) return;
        this.suppressNextTabSwitch = true;
        history.pushState({ type: 'navigate-cell', tableName }, '');
    }

    /**
     * フォームパネルを開いたことをブラウザ履歴に記録する。
     * goForward でこのエントリに到達したとき、popstate ハンドラがフォームパネルを再オープンする。
     */
    pushFormPanelOpen(tabName: string, pkValue: string): void {
        if (this.restoring) return;
        history.pushState({ type: 'form-panel-open', tabName, pkValue }, '');
    }

    private closeOrSuspendFormPanelForDestination(destinationTabName: string): void {
        const activeTabName = this.tab.getActiveTabName();
        if (activeTabName !== false && activeTabName !== destinationTabName) {
            this.tab.suspendFormPanelForActiveTab();
            return;
        }
        this.tab.closeFormPanel();
    }

}
