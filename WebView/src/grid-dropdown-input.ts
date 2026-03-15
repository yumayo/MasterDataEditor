import {ReferenceItem, ReferenceDataCache} from "./reference-data-cache";
import {DropdownQuickView} from "./dropdown-quick-view";

/**
 * ドロップダウンでの選択完了時のコールバック
 */
export type DropdownSelectCallback = (id: string) => void;

/**
 * ドロップダウンのキャンセル時のコールバック
 */
export type DropdownCancelCallback = () => void;

/**
 * 参照列用のドロップダウン付き入力コンポーネント
 *
 * 入力フィールドは EditorTableHandler.element を使用し、
 * ドロップダウンリストとクイックビューパネルを管理する
 */
export class GridDropdownInput {
    readonly element: HTMLElement;
    private readonly inputElement: HTMLElement;
    private readonly parentElement: HTMLElement;
    private dropdownElement: HTMLElement;
    private readonly quickView: DropdownQuickView;
    /** show() で受け取った参照先テーブル名。mouseenter/moveSelection時にQuickViewへ渡す */
    private referenceTableName: string;

    private items: ReferenceItem[];
    private filteredItems: ReferenceItem[];
    private selectedIndex: number;
    private visible: boolean;

    private onSelect: DropdownSelectCallback;
    private onCancel: DropdownCancelCallback;

    constructor(
        parentElement: HTMLElement,
        inputElement: HTMLElement,
        onSelect: DropdownSelectCallback,
        onCancel: DropdownCancelCallback,
        referenceDataCache: ReferenceDataCache
    ) {
        this.items = [];
        this.filteredItems = [];
        this.selectedIndex = 0;
        this.visible = false;
        this.referenceTableName = '';
        this.onSelect = onSelect;
        this.onCancel = onCancel;

        // EditorTableHandler.element への参照を保持
        this.inputElement = inputElement;

        // コンテナ要素（ドロップダウンリストの位置決め用）
        this.element = document.createElement('div');
        this.element.classList.add('grid-dropdown');

        // ドロップダウンリスト
        this.dropdownElement = document.createElement('div');
        this.dropdownElement.classList.add('grid-dropdown-list');
        this.element.appendChild(this.dropdownElement);

        // クイックビューパネル（コンテナとドロップダウンリストを渡して構築）
        this.quickView = new DropdownQuickView(this.element, this.dropdownElement, referenceDataCache);

        this.parentElement = parentElement;
        parentElement.appendChild(this.element);
    }

    /**
     * ドロップダウンを表示する。
     * 入力フィールドの表示は呼び出し側（EditorTableHandler）が行う。
     * @param referenceTableName 参照先テーブル名（クイックビュー用）
     */
    show(rect: DOMRect, items: ReferenceItem[], currentValue: string, referenceTableName: string): void {
        console.log('[dropdown] show called', { currentValue, itemCount: items.length });

        this.items = items;
        this.visible = true;
        this.selectedIndex = 0;

        // ビューポート絶対座標をparentElement基準の相対座標に変換する
        // GridTextField.show() と同じ変換ロジック
        const containerRect = this.parentElement.getBoundingClientRect();
        this.element.style.left = (rect.left - containerRect.left) + 'px';
        this.element.style.top = (rect.top + rect.height - containerRect.top) + 'px';
        this.dropdownElement.style.minWidth = rect.width + 'px';

        // 現在の値に基づいて初期選択を設定
        const currentIndex = items.findIndex(item => item.id === currentValue);
        if (currentIndex !== -1) {
            this.selectedIndex = currentIndex;
        }

        // 参照先テーブル名を保持（mouseenter/moveSelection時にQuickViewへ渡す）
        this.referenceTableName = referenceTableName;
        // 表示前にQuickViewをリセット（タイマー・表示・キャッシュをクリア）
        this.quickView.cleanup();

        // フィルタを適用（初期表示時は選択を維持）
        this.filterItems('', true);

        // 表示
        this.element.classList.add('visible');
    }

    /**
     * ドロップダウンを非表示にする
     */
    hide(): void {
        this.visible = false;
        this.element.classList.remove('visible');
        this.dropdownElement.innerHTML = '';
        // クイックビューもクリーンアップ
        this.quickView.cleanup();
    }

    /**
     * ドロップダウンが表示中かどうか
     */
    isVisible(): boolean {
        return this.visible;
    }

    /**
     * 現在選択されているアイテムのIDを取得。
     * フィルタ結果が空の場合は入力フィールドのテキストを返す。
     */
    getSelectedId(): string {
        if (this.filteredItems.length === 0) {
            return this.inputElement.textContent ?? '';
        }
        if (this.selectedIndex >= 0 && this.selectedIndex < this.filteredItems.length) {
            return this.filteredItems[this.selectedIndex].id;
        }
        return this.inputElement.textContent ?? '';
    }

    /**
     * 入力テキストが変更された時に呼び出す（EditorTableHandler.onInputから）
     */
    onInputChanged(filterText: string): void {
        this.filterItems(filterText, false);
    }

    /**
     * 矢印キーで選択を移動する。
     * キーボード選択時はクイックビューを即時更新する。
     */
    moveSelection(delta: number): void {
        if (this.filteredItems.length === 0) return;

        this.selectedIndex += delta;

        // 範囲内に収める
        if (this.selectedIndex < 0) {
            this.selectedIndex = this.filteredItems.length - 1;
        } else if (this.selectedIndex >= this.filteredItems.length) {
            this.selectedIndex = 0;
        }

        this.renderDropdown();

        // キーボード選択時はクイックビューを即時更新（ディレイなし）
        const selectedItem = this.filteredItems[this.selectedIndex];
        const selectedElement = this.dropdownElement.querySelector('.grid-dropdown-item.selected');
        if (selectedElement instanceof HTMLElement) {
            this.quickView.showPreviewImmediate(this.referenceTableName, selectedItem.id, selectedElement);
        }
    }

    /**
     * 選択を確定する
     */
    confirmSelection(): void {
        const id = this.getSelectedId();
        this.hide();
        this.onSelect(id);
    }

    /**
     * キャンセルする
     */
    cancel(): void {
        this.hide();
        this.onCancel();
    }

    /**
     * 項目をフィルタリングする
     * @param filterText フィルタ文字列
     * @param preserveSelection trueの場合、選択インデックスを維持する（初期表示時用）
     */
    private filterItems(filterText: string, preserveSelection: boolean): void {
        const lowerFilter = filterText.toLowerCase();

        if (filterText === '') {
            this.filteredItems = [...this.items];
        } else {
            this.filteredItems = this.items.filter(item => {
                return item.id.toLowerCase().includes(lowerFilter) ||
                       item.displayText.toLowerCase().includes(lowerFilter);
            });
        }

        // 選択インデックスをリセット（preserveSelectionがfalseの場合のみ）
        if (!preserveSelection) {
            this.selectedIndex = 0;
        }

        // ドロップダウンを更新
        this.renderDropdown();
    }

    /**
     * ドロップダウンを描画する。
     * 各アイテムにマウスオーバー/マウスリーブイベントを設定してクイックビュー連携する。
     */
    private renderDropdown(): void {
        this.dropdownElement.innerHTML = '';

        if (this.filteredItems.length === 0) {
            const emptyMessage = document.createElement('div');
            emptyMessage.classList.add('grid-dropdown-empty');
            emptyMessage.textContent = '該当なし';
            this.dropdownElement.appendChild(emptyMessage);
            return;
        }

        for (let i = 0; i < this.filteredItems.length; i++) {
            const item = this.filteredItems[i];
            const itemElement = document.createElement('div');
            itemElement.classList.add('grid-dropdown-item');

            if (i === this.selectedIndex) {
                itemElement.classList.add('selected');
            }

            // IDを先に表示
            const idSpan = document.createElement('span');
            idSpan.classList.add('grid-dropdown-item-id');
            idSpan.textContent = item.id;
            itemElement.appendChild(idSpan);

            // IDが表示テキストと異なる場合は名前も表示
            if (item.id !== item.displayText) {
                const displaySpan = document.createElement('span');
                displaySpan.classList.add('grid-dropdown-item-name');
                displaySpan.textContent = item.displayText;
                itemElement.appendChild(displaySpan);
            }

            // クリックイベント
            itemElement.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this.selectedIndex = i;
                this.confirmSelection();
            });

            // マウスオーバー: 300msディレイ付きクイックビュー表示
            itemElement.addEventListener('mouseenter', () => {
                this.quickView.showPreviewWithDelay(this.referenceTableName, item.id, itemElement);
            });

            // マウスリーブ: 短いディレイ後にクイックビュー非表示
            // クイックビュー自体へマウスが移動した場合はhideをキャンセルする
            itemElement.addEventListener('mouseleave', () => {
                this.quickView.hidePreviewWithDelay();
            });

            this.dropdownElement.appendChild(itemElement);
        }

        // 選択項目をスクロールして表示
        this.scrollToSelected();
    }

    /**
     * 選択項目をスクロールして表示
     */
    private scrollToSelected(): void {
        const selectedElement = this.dropdownElement.querySelector('.grid-dropdown-item.selected');
        if (selectedElement) {
            selectedElement.scrollIntoView({block: 'nearest'});
        }
    }
}
