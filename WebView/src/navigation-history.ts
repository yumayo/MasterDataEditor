import {Tab} from "./tab";

/**
 * ブラウザ History API を使ったナビゲーション履歴管理。
 * マウスサイドボタン（戻る/進む）や Alt+Left/Right で
 * タブ遷移を復元する。
 *
 * Tab との相互参照で密結合する。
 * Tab コンストラクタ末尾で生成され、Tab.enableTabButton() から pushTabSwitch() が呼ばれる。
 */
export class NavigationHistory {
    /** popstate による復元中かどうか（Tab から再 pushState されるのを防ぐ） */
    private restoring: boolean;
    /** タブ切り替えを委譲する Tab への参照 */
    private readonly tab: Tab;
    /** popstate リスナーの参照（将来の removeEventListener に備えてメンバ変数に保持） */
    private readonly popstateHandler: (e: PopStateEvent) => void;

    constructor(tab: Tab) {
        this.restoring = false;
        this.tab = tab;

        // 初期ロードのエントリを保護（全部戻りきってもページがアンロードされないようにする）
        history.replaceState({ type: 'initial' }, '');

        // popstate リスナーをメンバ変数に保持し、戻る/進む操作時に発火させる
        this.popstateHandler = (e: PopStateEvent) => {
            const state = e.state as Record<string, unknown> | null;
            // state が null の場合（ブラウザが管理するエントリ）は無視する
            if (state === null) return;

            if (state['type'] === 'tab-switch' && typeof state['tabName'] === 'string') {
                this.restoring = true;
                this.tab.switchToExistingTab(state['tabName']);
                this.restoring = false;
            }
        };
        window.addEventListener('popstate', this.popstateHandler);
    }

    /**
     * タブ遷移をブラウザ履歴に記録する。
     * restoring 中（popstate からの復元）は再 push を防ぐため無視する。
     * 現在の履歴エントリと同じタブ名なら重複 push をスキップする。
     */
    pushTabSwitch(tabName: string): void {
        if (this.restoring) return;
        // 現在の履歴エントリと同じタブなら重複 push しない
        const currentState = history.state as Record<string, unknown> | null;
        if (currentState !== null && currentState['type'] === 'tab-switch' && currentState['tabName'] === tabName) return;
        history.pushState({ type: 'tab-switch', tabName: tabName }, '');
    }
}
