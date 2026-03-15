import {ColumnFilter} from "./column-filter";
import {EditorTable} from "./editor-table";

/**
 * フィルタードロップダウン UI コンポーネント
 *
 * 責務:
 * - チェックボックス付きドロップダウンの構築・表示・非表示
 * - 検索ボックスによる項目絞り込み
 * - 全選択・全解除ボタン
 * - 適用ボタンで ColumnFilter にフィルター状態を反映し EditorTable を再描画
 * - クリアボタンで当該列のフィルターを解除し EditorTable を再描画
 *
 * 表示制御は .visible クラスの付与/除去で行う。
 * EditorTable と密結合（相互参照）で、適用・クリア後に EditorTable を直接呼び出す。
 */
export class FilterDropdown {
    private readonly element: HTMLElement;
    private readonly searchInput: HTMLInputElement;
    private readonly itemList: HTMLElement;
    private readonly table: EditorTable;
    private readonly columnFilter: ColumnFilter;
    /**
     * 現在表示中の列インデックス（-1: 非表示状態）
     */
    private currentColumnIndex: number;
    /**
     * 全チェックボックス項目要素のリスト（検索絞り込み前の全量）。
     * 検索絞り込みでは DOM に対して add/remove するが、
     * チェック状態はこのリスト上の要素で維持される。
     */
    private allItemElements: HTMLElement[];
    /**
     * document の mousedown リスナー（destroy() で解除するためフィールドに保持）
     */
    private readonly outsideClickHandler: (e: MouseEvent) => void;

    constructor(table: EditorTable, columnFilter: ColumnFilter) {
        this.table = table;
        this.columnFilter = columnFilter;
        this.currentColumnIndex = -1;
        this.allItemElements = [];

        // ドロップダウンのルート要素
        this.element = document.createElement('div');
        this.element.classList.add('filter-dropdown');

        // 検索ボックス
        this.searchInput = document.createElement('input');
        this.searchInput.classList.add('filter-search-input');
        this.searchInput.type = 'text';
        this.searchInput.placeholder = '検索...';
        this.element.appendChild(this.searchInput);

        // ボタン群（全選択・全解除・クリア）
        const buttonRow = document.createElement('div');
        buttonRow.classList.add('filter-buttons');
        const selectAllBtn = document.createElement('button');
        selectAllBtn.classList.add('filter-select-all');
        selectAllBtn.textContent = '全選択';
        const deselectAllBtn = document.createElement('button');
        deselectAllBtn.classList.add('filter-deselect-all');
        deselectAllBtn.textContent = '全解除';
        const clearBtn = document.createElement('button');
        clearBtn.classList.add('filter-clear');
        clearBtn.textContent = 'クリア';
        buttonRow.appendChild(selectAllBtn);
        buttonRow.appendChild(deselectAllBtn);
        buttonRow.appendChild(clearBtn);
        this.element.appendChild(buttonRow);

        // チェックボックスリスト
        this.itemList = document.createElement('div');
        this.itemList.classList.add('filter-item-list');
        this.element.appendChild(this.itemList);

        // 適用ボタン
        const applyBtn = document.createElement('button');
        applyBtn.classList.add('filter-apply');
        applyBtn.textContent = '適用';
        this.element.appendChild(applyBtn);

        // イベント登録
        this.searchInput.addEventListener('input', () => this.filterItems());
        selectAllBtn.addEventListener('click', () => this.selectAll());
        deselectAllBtn.addEventListener('click', () => this.deselectAll());
        clearBtn.addEventListener('click', () => this.clearAndClose());
        applyBtn.addEventListener('click', () => this.applyAndClose());

        // ドロップダウン外クリックで閉じる（mousedown でキャプチャして先に処理）。
        // フィールドに保持して destroy() で解除できるようにする。
        this.outsideClickHandler = (e: MouseEvent) => {
            if (!this.element.classList.contains('visible')) return;
            if (!this.element.contains(e.target as Node)) {
                this.hide();
            }
        };
        document.addEventListener('mousedown', this.outsideClickHandler);
    }

    /**
     * リスナーを解除し DOM 要素を除去する。
     * initializeModules() で新しいインスタンスに差し替える直前に呼ぶ。
     */
    destroy(): void {
        document.removeEventListener('mousedown', this.outsideClickHandler);
        if (this.element.parentElement) {
            this.element.parentElement.removeChild(this.element);
        }
    }

    /**
     * ドロップダウンを指定列用に開く。
     * 既にその列が開いていた場合は閉じる（トグル動作）。
     *
     * @param columnIndex 対象列インデックス（0始まり、行ヘッダー除く）
     * @param anchorElement アイコン要素（位置決め用）
     */
    open(columnIndex: number, anchorElement: HTMLElement): void {
        // 同じ列を再クリックした場合はトグル（閉じる）
        if (this.element.classList.contains('visible') && this.currentColumnIndex === columnIndex) {
            this.hide();
            return;
        }
        this.currentColumnIndex = columnIndex;
        this.buildItems(columnIndex);

        // 検索ボックスをリセット
        this.searchInput.value = '';

        // 位置決め: アイコン要素の直下に表示する
        const rect = anchorElement.getBoundingClientRect();
        this.element.style.top = `${rect.bottom + window.scrollY}px`;
        this.element.style.left = `${rect.left + window.scrollX}px`;

        // body に追加されていなければ追加する
        if (!this.element.parentElement) {
            document.body.appendChild(this.element);
        }

        this.element.classList.add('visible');
    }

    /**
     * ドロップダウンを非表示にする。
     */
    hide(): void {
        this.element.classList.remove('visible');
        this.currentColumnIndex = -1;
    }

    /**
     * 指定列のユニーク値からチェックボックスリストを構築する。
     * 既存フィルター状態があれば反映する。
     * columnIndex は DOM列インデックス（0始まり）。ストア列インデックスに変換してから ColumnFilter に渡す。
     */
    private buildItems(columnIndex: number): void {
        this.itemList.innerHTML = '';
        this.allItemElements = [];
        const storeRows = this.table.getStore().getRows(this.table.tableName);
        if (storeRows === false) return;

        // DOM列インデックス → ストア（CSV）列インデックスに変換する
        const storeColumnIndex = this.table.getStoreColumnIndex(columnIndex);
        const uniqueValues = this.columnFilter.getUniqueValues(storeColumnIndex, storeRows);
        const existingSelection = this.columnFilter.getSelectedValues(storeColumnIndex);

        for (const value of uniqueValues) {
            const item = this.createCheckboxItem(value, existingSelection);
            this.allItemElements.push(item);
            this.itemList.appendChild(item);
        }
    }

    /**
     * チェックボックス付き項目要素を生成する。
     *
     * @param value 表示する値
     * @param existingSelection 既存フィルターの選択セット（null: 未適用 = 全チェック）
     */
    private createCheckboxItem(value: string, existingSelection: Set<string> | null): HTMLElement {
        const label = document.createElement('label');
        label.classList.add('filter-item');

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        // 既存フィルターがなければ全チェック、あれば選択セットに含まれているかどうか
        checkbox.checked = existingSelection === null || existingSelection.has(value);

        const labelSpan = document.createElement('span');
        labelSpan.classList.add('filter-item-label');
        labelSpan.textContent = value;

        label.appendChild(checkbox);
        label.appendChild(labelSpan);
        return label;
    }

    /**
     * 検索ボックスの入力に合わせてリストを絞り込む。
     * 絞り込みはラベルテキストへの部分一致（大文字小文字無視）。
     * 一致しない項目は DOM から除去し、一致する項目は再追加する。
     * チェック状態は allItemElements 上の要素で維持される。
     */
    private filterItems(): void {
        const query = this.searchInput.value.toLowerCase();
        this.itemList.innerHTML = '';
        for (const item of this.allItemElements) {
            // createCheckboxItem で必ず .filter-item-label が生成されるため null チェック不要
            const labelSpan = item.querySelector('.filter-item-label') as HTMLElement;
            const text = (labelSpan.textContent as string).toLowerCase();
            if (text.includes(query)) {
                this.itemList.appendChild(item);
            }
        }
    }

    /**
     * 全項目をチェックする（現在 DOM に表示されている項目のみが対象）。
     * 検索で絞り込み中の場合は絞り込まれた項目のみを対象とする。
     */
    private selectAll(): void {
        const items = this.itemList.querySelectorAll<HTMLInputElement>('.filter-item input[type="checkbox"]');
        for (const checkbox of Array.from(items)) {
            checkbox.checked = true;
        }
    }

    /**
     * 全項目のチェックを外す（現在 DOM に表示されている項目のみが対象）。
     */
    private deselectAll(): void {
        const items = this.itemList.querySelectorAll<HTMLInputElement>('.filter-item input[type="checkbox"]');
        for (const checkbox of Array.from(items)) {
            checkbox.checked = false;
        }
    }

    /**
     * 適用ボタンのハンドラ: チェックされた値でフィルターを適用してドロップダウンを閉じる。
     * currentColumnIndex は DOM列インデックスのため、ストア列インデックスに変換してから ColumnFilter に渡す。
     */
    private applyAndClose(): void {
        const storeColumnIndex = this.table.getStoreColumnIndex(this.currentColumnIndex);
        const selectedValues = this.collectCheckedValues();
        this.columnFilter.applyFilter(storeColumnIndex, selectedValues);
        this.hide();
        this.table.applyFilterDisplay();
    }

    /**
     * クリアボタンのハンドラ: 当該列のフィルターを解除してドロップダウンを閉じる。
     * currentColumnIndex は DOM列インデックスのため、ストア列インデックスに変換してから ColumnFilter に渡す。
     */
    private clearAndClose(): void {
        const storeColumnIndex = this.table.getStoreColumnIndex(this.currentColumnIndex);
        this.hide();
        this.columnFilter.clearFilter(storeColumnIndex);
        this.table.applyFilterDisplay();
    }

    /**
     * チェックされた全値のセットを収集して返す。
     * allItemElements（全量リスト）を走査するため、検索絞り込みで非表示の項目も含まれる。
     * 非表示（DOM から除去済み）の項目はチェック状態に関わらず「チェック済み」として扱う
     * （検索絞り込み中に全解除を押しても非表示項目は選択状態が維持される）。
     */
    private collectCheckedValues(): Set<string> {
        const selected = new Set<string>();
        const query = this.searchInput.value.toLowerCase();
        for (const item of this.allItemElements) {
            // createCheckboxItem で必ず checkbox と .filter-item-label が生成されるため null チェック不要
            const checkbox = item.querySelector<HTMLInputElement>('input[type="checkbox"]') as HTMLInputElement;
            const labelSpan = item.querySelector('.filter-item-label') as HTMLElement;
            const text = (labelSpan.textContent as string).toLowerCase();
            // 検索絞り込みで非表示になっている（DOM未挿入）項目はチェック済みとして扱う
            const isFilteredOut = !text.includes(query);
            if (checkbox.checked || isFilteredOut) {
                selected.add(labelSpan.textContent as string);
            }
        }
        return selected;
    }
}
