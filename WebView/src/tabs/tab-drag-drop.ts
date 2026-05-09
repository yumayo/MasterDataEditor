import {Tab} from "./tab";

/**
 * タブドラッグアンドドロップモジュール
 *
 * 責務:
 * - タブのドラッグアンドドロップによる並び替え
 * - ドロップインジケーターの表示・クリア
 * - ドラッグ状態の管理
 */
export class TabDragDrop {
    private readonly tab: Tab;
    /** ドラッグ中のタブ名 */
    private draggingTabName: string | false;

    constructor(tab: Tab) {
        this.tab = tab;
        this.draggingTabName = false;
    }

    /**
     * タブを移動する（ドラッグアンドドロップ用）
     * @param fromName 移動元のタブ名
     * @param toName 移動先のタブ名
     * @param insertBefore trueなら移動先タブの前に挿入、falseなら後に挿入
     */
    moveTabButton(fromName: string, toName: string, insertBefore: boolean): void {
        const tabButtons = this.tab.getTabButtons();
        const fromIndex = tabButtons.findIndex(x => x.name === fromName);
        const toIndex = tabButtons.findIndex(x => x.name === toName);

        if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
            return;
        }

        const fromTabButton = tabButtons[fromIndex];
        const toTabButton = tabButtons[toIndex];

        // 配列から削除
        tabButtons.splice(fromIndex, 1);

        // 新しい位置を計算（削除後のインデックス）
        let newIndex = tabButtons.findIndex(x => x.name === toName);
        if (!insertBefore) {
            newIndex = newIndex + 1;
        }

        // 配列に挿入
        tabButtons.splice(newIndex, 0, fromTabButton);

        // DOMを更新
        const tabBarElement = this.tab.getTabBarElement();
        if (insertBefore) {
            tabBarElement.insertBefore(fromTabButton.element, toTabButton.element);
        } else {
            // 移動先タブの次の要素の前に挿入（次の要素がなければ末尾に追加）
            const nextSibling = toTabButton.element.nextSibling;
            if (nextSibling) {
                tabBarElement.insertBefore(fromTabButton.element, nextSibling);
            } else {
                tabBarElement.appendChild(fromTabButton.element);
            }
        }
        this.tab.requestTabLayout();
        this.tab.notifyTabOrderChanged();
    }

    /**
     * 全タブのドロップインジケーターをクリア
     */
    clearDropIndicators(): void {
        const tabButtons = this.tab.getTabButtons();
        tabButtons.forEach(tabButton => {
            tabButton.element.classList.remove('tab-button-drop-left', 'tab-button-drop-right');
        });
    }

    /**
     * ドラッグ中のタブ名を設定
     */
    setDraggingTabName(name: string): void {
        this.draggingTabName = name;
    }

    /**
     * ドラッグ中のタブ名を取得
     */
    getDraggingTabName(): string | false {
        return this.draggingTabName;
    }

    /**
     * ドラッグ中のタブ名をクリア
     */
    clearDraggingTabName(): void {
        this.draggingTabName = false;
    }

    /**
     * ドロップインジケーターを更新
     */
    updateDropIndicator(clientX: number, clientY: number): void {
        this.clearDropIndicators();

        const tabButtons = this.tab.getTabButtons();
        for (const tabButton of tabButtons) {
            // ドラッグ中のタブはスキップ
            if (tabButton.name === this.draggingTabName) {
                continue;
            }

            const rect = tabButton.element.getBoundingClientRect();
            if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
                const midX = rect.left + rect.width / 2;
                if (clientX < midX) {
                    tabButton.element.classList.add('tab-button-drop-left');
                } else {
                    tabButton.element.classList.add('tab-button-drop-right');
                }
                break;
            }
        }
    }

    /**
     * タブをドロップ
     */
    dropTab(clientX: number, clientY: number): void {
        if (!this.draggingTabName) {
            return;
        }

        const tabButtons = this.tab.getTabButtons();
        for (const tabButton of tabButtons) {
            // ドラッグ中のタブはスキップ
            if (tabButton.name === this.draggingTabName) {
                continue;
            }

            const rect = tabButton.element.getBoundingClientRect();
            if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
                const midX = rect.left + rect.width / 2;
                const insertBefore = clientX < midX;
                this.moveTabButton(this.draggingTabName, tabButton.name, insertBefore);
                break;
            }
        }
    }
}
