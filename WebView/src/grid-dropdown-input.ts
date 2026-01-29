import {ReferenceItem} from "./reference-data-cache";

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
 */
export class GridDropdownInput {
    readonly element: HTMLElement;
    private inputElement: HTMLElement;
    private dropdownElement: HTMLElement;

    private items: ReferenceItem[];
    private filteredItems: ReferenceItem[];
    private selectedIndex: number;
    private visible: boolean;

    private onSelect: DropdownSelectCallback;
    private onCancel: DropdownCancelCallback;

    constructor(parentElement: HTMLElement, onSelect: DropdownSelectCallback, onCancel: DropdownCancelCallback) {
        this.items = [];
        this.filteredItems = [];
        this.selectedIndex = 0;
        this.visible = false;
        this.onSelect = onSelect;
        this.onCancel = onCancel;

        // コンテナ要素
        this.element = document.createElement('div');
        this.element.classList.add('grid-dropdown');

        // 入力フィールド
        this.inputElement = document.createElement('div');
        this.inputElement.classList.add('grid-dropdown-input');
        this.inputElement.setAttribute('contenteditable', 'true');
        this.element.appendChild(this.inputElement);

        // ドロップダウンリスト
        this.dropdownElement = document.createElement('div');
        this.dropdownElement.classList.add('grid-dropdown-list');
        this.element.appendChild(this.dropdownElement);

        // イベントリスナー
        this.inputElement.addEventListener('input', this.onInput.bind(this));
        this.inputElement.addEventListener('keydown', this.onKeydown.bind(this));
        this.inputElement.addEventListener('focusout', this.onFocusout.bind(this));

        parentElement.appendChild(this.element);
    }

    /**
     * ドロップダウンを表示する
     */
    show(rect: DOMRect, items: ReferenceItem[], currentValue: string): void {
        console.log('[dropdown] show called', { currentValue, itemCount: items.length });

        this.items = items;
        this.visible = true;
        this.selectedIndex = 0;

        // 位置とサイズを設定
        this.element.style.left = rect.left + 'px';
        this.element.style.top = rect.top + 'px';

        this.inputElement.style.width = rect.width + 'px';
        this.inputElement.style.height = rect.height + 'px';
        this.inputElement.style.lineHeight = rect.height + 'px';

        // ドロップダウンリストを入力フィールドの下に表示
        this.dropdownElement.style.top = rect.height + 'px';
        this.dropdownElement.style.minWidth = rect.width + 'px';

        // 現在の値を設定
        this.inputElement.textContent = currentValue;

        // 現在の値に基づいて初期選択を設定
        const currentIndex = items.findIndex(item => item.id === currentValue);
        if (currentIndex !== -1) {
            this.selectedIndex = currentIndex;
        }

        // フィルタを適用（初期表示時は選択を維持）
        this.filterItems('', true);

        // 表示
        this.element.classList.add('visible');

        // フォーカスを設定
        console.log('[dropdown] setting focus to inputElement');
        this.inputElement.focus({preventScroll: true});
        console.log('[dropdown] activeElement after focus:', document.activeElement);

        // カーソルを末尾に移動
        this.moveCursorToEnd();
    }

    /**
     * ドロップダウンを非表示にする
     */
    hide(): void {
        this.visible = false;
        this.element.classList.remove('visible');
        this.inputElement.textContent = '';
        this.dropdownElement.innerHTML = '';
    }

    /**
     * ドロップダウンが表示中かどうか
     */
    isVisible(): boolean {
        return this.visible;
    }

    /**
     * 現在選択されているアイテムのIDを取得
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
     * 入力フィールドのテキストを取得
     */
    getInputText(): string {
        return this.inputElement.textContent ?? '';
    }

    /**
     * 入力イベント
     */
    private onInput(): void {
        const filterText = this.inputElement.textContent ?? '';
        this.filterItems(filterText, false);
    }

    /**
     * キーボードイベント
     */
    private onKeydown(e: KeyboardEvent): void {
        console.log('[dropdown] onKeydown', {
            key: e.key,
            code: e.code,
            isComposing: e.isComposing,
            visible: this.visible
        });

        // IME変換中は何もしない
        if (e.isComposing) {
            console.log('[dropdown] IME変換中のためスキップ');
            return;
        }

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                this.moveSelection(1);
                break;
            case 'ArrowUp':
                e.preventDefault();
                this.moveSelection(-1);
                break;
            case 'Enter':
                e.preventDefault();
                console.log('[dropdown] Enter pressed, confirming selection');
                this.confirmSelection();
                break;
            case 'Tab':
                e.preventDefault();
                console.log('[dropdown] Tab pressed, confirming selection');
                this.confirmSelection();
                break;
            case 'Escape':
                e.preventDefault();
                console.log('[dropdown] Escape pressed, canceling');
                this.cancel();
                break;
        }
    }

    /**
     * フォーカスアウトイベント
     */
    private onFocusout(): void {
        console.log('[dropdown] onFocusout', { visible: this.visible, activeElement: document.activeElement });
        // フォーカスアウト時はキャンセル（他のセルをクリックした場合など）
        if (this.visible) {
            console.log('[dropdown] canceling due to focusout');
            this.cancel();
        }
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
     * ドロップダウンを描画
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

            this.dropdownElement.appendChild(itemElement);
        }

        // 選択項目をスクロールして表示
        this.scrollToSelected();
    }

    /**
     * 選択を移動する
     */
    private moveSelection(delta: number): void {
        if (this.filteredItems.length === 0) return;

        this.selectedIndex += delta;

        // 範囲内に収める
        if (this.selectedIndex < 0) {
            this.selectedIndex = this.filteredItems.length - 1;
        } else if (this.selectedIndex >= this.filteredItems.length) {
            this.selectedIndex = 0;
        }

        this.renderDropdown();
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

    /**
     * 選択を確定する
     */
    private confirmSelection(): void {
        const id = this.getSelectedId();
        this.hide();
        this.onSelect(id);
    }

    /**
     * キャンセルする
     */
    private cancel(): void {
        this.hide();
        this.onCancel();
    }

    /**
     * カーソルを末尾に移動
     */
    private moveCursorToEnd(): void {
        const text = this.inputElement.textContent ?? '';
        if (text.length > 0) {
            const range = document.createRange();
            range.selectNodeContents(this.inputElement);
            range.collapse(false);
            const selection = window.getSelection();
            if (selection) {
                selection.removeAllRanges();
                selection.addRange(range);
            }
        }
    }
}
