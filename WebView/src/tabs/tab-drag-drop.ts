import {Tab} from "./tab";
import type {TabButton} from "./tab-button";

type DropIndicatorSide = 'left' | 'right';

interface TabDropPosition {
    readonly indicatorTabButton: TabButton;
    readonly indicatorSide: DropIndicatorSide;
    readonly insertBefore: boolean;
}

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
        const position = this.findDropPosition(clientX, clientY);
        if (position === false) return;
        position.indicatorTabButton.element.classList.add(
            position.indicatorSide === 'left' ? 'tab-button-drop-left' : 'tab-button-drop-right',
        );
    }

    /**
     * タブをドロップ
     */
    dropTab(clientX: number, clientY: number): void {
        if (!this.draggingTabName) {
            return;
        }

        const position = this.findDropPosition(clientX, clientY);
        if (position === false) return;
        this.moveTabButton(this.draggingTabName, position.indicatorTabButton.name, position.insertBefore);
    }

    private findDropPosition(clientX: number, clientY: number): TabDropPosition | false {
        if (!this.draggingTabName) return false;

        const tabButtons = this.tab.getTabButtons();
        for (const tabButton of tabButtons) {
            if (tabButton.name === this.draggingTabName) continue;
            const rect = tabButton.element.getBoundingClientRect();
            if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) continue;
            const insertBefore = clientX < rect.left + rect.width / 2;
            return {
                indicatorTabButton: tabButton,
                indicatorSide: insertBefore ? 'left' : 'right',
                insertBefore,
            };
        }
        return false;
    }
}
