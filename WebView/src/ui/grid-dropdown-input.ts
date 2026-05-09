import {ReferenceItem} from "../references/reference-data-cache";
import {DropdownQuickView} from "./dropdown-quick-view";

/**
 * ドロップダウンでの選択完了時のコールバック
 */
export type DropdownSelectCallback = (id: string) => void;

/**
 * ドロップダウンのキャンセル時のコールバック
 */
export type DropdownCancelCallback = () => void;

export type DropdownTextProvider = () => string;

export type GridDropdownItem = ReferenceItem & {
    /** クイックビューで開く行のID。未指定なら id を使用する。 */
    previewId?: string;
};

/**
 * 参照列用のドロップダウン付き入力コンポーネント
 *
 * 入力フィールド自体は呼び出し側が所有し、
 * このコンポーネントはドロップダウンリストとクイックビューパネルを管理する。
 *
 * クイックビューは Tab が所有するシングルトン DropdownQuickView を
 * connectDropdownQuickView() で接続することで有効になる。
 * 接続なし（false）の場合はクイックビュー機能が無効になる（差分タブ等で使用）。
 */
export class GridDropdownInput {
    readonly element: HTMLElement;
    private readonly inputElement: HTMLElement;
    private readonly parentElement: HTMLElement;
    private readonly textProvider: DropdownTextProvider | false;
    private dropdownElement: HTMLElement;
    /** Tab から接続されるシングルトン DropdownQuickView（未接続時は false） */
    private quickView: DropdownQuickView | false;
    /** show() で受け取った参照先テーブル名。mouseenter/moveSelection時にQuickViewへ渡す */
    private referenceTableName: string;
    /** キーボード操作によるDOM再構築時にmouseenterイベントを抑制するフラグ */
    private suppressMouseEnterQuickView: boolean;

    private items: GridDropdownItem[];
    private filteredItems: GridDropdownItem[];
    private selectedIndex: number;
    private visible: boolean;

    private onSelect: DropdownSelectCallback;
    private onCancel: DropdownCancelCallback;

    constructor(
        parentElement: HTMLElement,
        inputElement: HTMLElement,
        onSelect: DropdownSelectCallback,
        onCancel: DropdownCancelCallback,
        textProvider: DropdownTextProvider | false = false,
    ) {
        this.items = [];
        this.filteredItems = [];
        this.selectedIndex = 0;
        this.visible = false;
        this.referenceTableName = '';
        this.suppressMouseEnterQuickView = false;
        this.onSelect = onSelect;
        this.onCancel = onCancel;
        this.quickView = false;

        // 入力要素への参照を保持（EditorTable は contenteditable、FormPanel は input/textarea）
        this.inputElement = inputElement;
        this.textProvider = textProvider;

        // コンテナ要素（ドロップダウンリストの位置決め用）
        this.element = document.createElement('div');
        this.element.classList.add('grid-dropdown');

        // ドロップダウンリスト
        this.dropdownElement = document.createElement('div');
        this.dropdownElement.classList.add('grid-dropdown-list');
        this.element.appendChild(this.dropdownElement);

        this.parentElement = parentElement;
        parentElement.appendChild(this.element);
    }

    /**
     * Tab が所有するシングルトン DropdownQuickView を接続する。
     * 接続後はドロップダウンアイテムにホバーしたときクイックビューが表示される。
     * Tab.createTabState / Tab.createMiniEditorTable から呼ばれる。
     * diff-tab.ts のように Tab を持たない場面では接続しない（クイックビュー無効）。
     */
    connectDropdownQuickView(quickView: DropdownQuickView): void {
        this.quickView = quickView;
    }

    /**
     * ドロップダウンを表示する。
     * 入力フィールドの表示は呼び出し側（EditorTableHandler）が行う。
     * @param referenceTableName 参照先テーブル名（クイックビュー用）
     */
    show(rect: DOMRect, items: GridDropdownItem[], currentValue: string, referenceTableName: string): void {

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
        if (this.quickView !== false) { this.quickView.cleanup(); }

        // フィルタを適用（初期表示時は選択を維持）
        this.filterItems('', true);

        // 表示してから選択項目を中央にスクロールする
        // display:none の状態では scrollIntoView が効かないため、visible 付与後に実行する
        this.element.classList.add('visible');
        this.scrollToSelected();
    }

    /**
     * ドロップダウンを非表示にする
     */
    hide(): void {
        this.visible = false;
        this.element.classList.remove('visible');
        this.dropdownElement.innerHTML = '';
        // クイックビューもクリーンアップ（接続済みの場合のみ）
        if (this.quickView !== false) { this.quickView.cleanup(); }
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
            return this.getInputText();
        }
        if (this.selectedIndex >= 0 && this.selectedIndex < this.filteredItems.length) {
            return this.filteredItems[this.selectedIndex].id;
        }
        return this.getInputText();
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

        // DOM再構築時のmouseenter抑制（キーボード操作によるDOM再構築でカーソル下の要素に
        // mouseenterが発火し、キーボード選択したアイテムのクイックビューを上書きしてしまうのを防ぐ）
        this.suppressMouseEnterQuickView = true;
        this.renderDropdown();
        requestAnimationFrame(() => { this.suppressMouseEnterQuickView = false; });

        // キーボード選択時はクイックビューを即時更新（接続済みの場合のみ）
        if (this.quickView !== false) {
            const selectedItem = this.filteredItems[this.selectedIndex];
            const selectedElement = this.dropdownElement.querySelector('.grid-dropdown-item.selected');
            if (selectedElement instanceof HTMLElement) {
                this.quickView.showPreview(this.referenceTableName, selectedItem.previewId ?? selectedItem.id, selectedElement, this.dropdownElement);
            }
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

            // マウスオーバー: クイックビュー表示（接続済みかつキーボード操作中でない場合のみ）
            // suppressMouseEnterQuickView が true の場合はキーボード操作によるDOM再構築なので無視する
            itemElement.addEventListener('mouseenter', () => {
                if (this.quickView !== false && !this.suppressMouseEnterQuickView) {
                    this.quickView.showPreview(this.referenceTableName, item.previewId ?? item.id, itemElement, this.dropdownElement);
                }
            });

            // マウスリーブ: 短いディレイ後にクイックビュー非表示（接続済みの場合のみ）
            // クイックビュー自体へマウスが移動した場合はhideをキャンセルする
            itemElement.addEventListener('mouseleave', () => {
                if (this.quickView !== false) { this.quickView.hidePreviewWithDelay(); }
            });

            this.dropdownElement.appendChild(itemElement);
        }

        // 選択項目をスクロールして表示
        this.scrollToSelected();
    }

    /**
     * 選択項目をスクロールして表示
     */
    /** 選択項目をドロップダウンリストの中央にスクロールする（親要素のスクロールには影響しない） */
    private scrollToSelected(): void {
        const selectedElement = this.dropdownElement.querySelector('.grid-dropdown-item.selected') as HTMLElement | null;
        if (selectedElement) {
            const listHeight = this.dropdownElement.clientHeight;
            const itemTop = selectedElement.offsetTop;
            const itemHeight = selectedElement.offsetHeight;
            this.dropdownElement.scrollTop = itemTop - (listHeight - itemHeight) / 2;
        }
    }

    private getInputText(): string {
        if (this.textProvider !== false) return this.textProvider();
        if (this.inputElement instanceof HTMLInputElement || this.inputElement instanceof HTMLTextAreaElement) {
            return this.inputElement.value;
        }
        return this.inputElement.textContent ?? '';
    }
}
