import {EditorTable} from "./editor-table";
import {FilterCommand, SortCommand} from "./command";
import {SerializedSortKey} from "./column-sorter";
import {SerializedFilters} from "./column-filter";
import {saveSchemaDataAsync} from "./editor-actions";

/**
 * ソート・フィルター状態と表示更新を担当する。
 *
 * EditorTable の Object.assign パターンに合わせ、Proxy で既存ファサードへフォールバックする。
 */
export class EditorTableSortFilter {
    [key: string]: any;
    private readonly table: EditorTable;

    constructor(table: EditorTable) {
        this.table = table;
        return new Proxy(this, {
            get: (target, property, receiver) => {
                if (property in target) return Reflect.get(target, property, receiver);
                return Reflect.get(table as any, property);
            },
            set: (target, property, value, receiver) => {
                if (property in target) return Reflect.set(target, property, value, receiver);
                (table as any)[property] = value;
                return true;
            },
        });
    }

    /** 現在のソート状態をスキーマJSON永続化用にシリアライズする */
    serializeSortKeys(): SerializedSortKey[] { return this.columnSorter.serializeSortKeys(); }

    /**
     * 現在のフィルター状態をスキーマJSON永続化用にシリアライズする。
     * ストアのCSVヘッダーから列名を取得してストア列インデックスを列名に変換する。
     */
    serializeFilters(): SerializedFilters {
        const storeColumnNames = this.store.getHeader(this.tableName);
        if (storeColumnNames === false) return {};
        return this.columnFilter.serializeFilters(storeColumnNames);
    }


    /**
     * ソート中に行が挿入されたことをColumnSorterに通知する（EditorTableStructureから呼ばれる）
     */
    notifySortRowInserted(storeRowIndex: number): void { this.columnSorter.notifyRowInserted(storeRowIndex); }

    /**
     * ソート中に行が削除されたことをColumnSorterに通知する（EditorTableStructureから呼ばれる）
     */
    notifySortRowDeleted(storeRowIndex: number): void { this.columnSorter.notifyRowDeleted(storeRowIndex); }

    /**
     * ソート状態をリセットしてインジケーターを更新する。
     * 列挿入/削除時に列インデックスが陳腐化するためEditorTableStructureから呼ばれる。
     */
    clearSortState(): void {
        this.columnSorter.clearAllSorts();
        this.updateAllSortIndicators();
    }

    /**
     * フィルター状態をリセットして表示を更新する。
     * 列挿入/削除時（列インデックス陳腐化）やタブ切替時（前回タブの状態リセット）に呼ばれる。
     */
    clearFilterState(): void {
        // フィルターが適用されていない場合は何もしない（不要な selection.updateRendererAfterResize() を防ぐ）
        if (!this.columnFilter.hasActiveFilter()) return;
        this.columnFilter.clearAllFilters();
        this.applyFilterDisplay();
    }

    /**
     * フィルターが適用中の場合のみ applyFilterDisplay() を呼ぶ。
     * 行挿入/削除/バッファ行昇格/降格後に EditorTableStructure から呼ばれる。
     * フィルター未適用時はコストのかかる DOM 操作を行わない。
     */
    refreshFilterDisplayIfActive(): void {
        if (this.columnFilter.hasActiveFilter()) this.applyFilterDisplay();
    }

    /**
     * スキーマJSONから読み込んだソートキーを復元する。
     * tab.ts の createTabState() からテーブルオープン時に呼ばれる。
     * saveSchemaDataAsync は呼ばない（復元時の保存は不要）。
     */
    restoreSortState(serializedSortKeys: SerializedSortKey[]): void {
        const newIndices = this.columnSorter.restoreSortKeys(serializedSortKeys, this.storeRowIndices);
        if (newIndices === this.storeRowIndices) return; // 復元するソートキーがなかった
        this.storeRowIndices = newIndices;
        this.rearrangeDomRowsByStoreIndices(newIndices);
        this.structure.renumberRowsFrom(1);
        this.selection.updateRendererAfterResize();
        this.updateAllSortIndicators();
        this.refreshScrollbarMarkers();
    }

    /**
     * スキーマJSONから読み込んだフィルター状態を復元する。
     * tab.ts の createTabState() からテーブルオープン時に呼ばれる。
     * saveSchemaDataAsync は呼ばない（復元時の保存は不要）。
     */
    restoreFilterState(serializedFilters: SerializedFilters): void {
        const storeColumnNames = this.store.getHeader(this.tableName);
        if (storeColumnNames === false) return;
        this.columnFilter.restoreFilters(serializedFilters, storeColumnNames);
        if (this.columnFilter.hasActiveFilter()) this.applyFilterDisplay();
    }

    /**
     * ジャンプ操作用の一時フィルターを適用する。
     * スキーマ永続化や Undo/Redo 履歴には含めない。
     */
    applyTemporaryFilterState(filters: SerializedFilters): void {
        const storeColumnNames = this.store.getHeader(this.tableName);
        if (storeColumnNames === false) return;
        this.columnFilter.applyTemporaryFilters(filters, storeColumnNames);
        this.applyFilterDisplay();
    }

    /**
     * 指定列のソートをトグルし、DOMの行順を更新する。
     * ソートはView変換のみ（ストア順序は変えない）。
     * ミニテーブルでは呼ばれない（ソートインジケーターが存在しないため）。
     *
     * ソート前後のシリアライズ済みソートキーを SortCommand に記録し、
     * History に pushCommand で履歴に積む（Undo/Redo対応）。
     *
     * @param columnIndex DOMの列インデックス（0始まり、行ヘッダーなし）
     */
    applySortForColumn(columnIndex: number): void {
        // blameはgit committed dataのため、ソートによるDOM行並び替えで陳腐化する
        this.hideBlameIfVisible();
        // ソート前の状態を記録する（Undo時に復元するため）
        const oldSortKeys = this.columnSorter.serializeSortKeys();
        // ColumnSorterにソートを委譲して新しいstoreRowIndicesを取得する
        const newIndices = this.columnSorter.toggleSort(columnIndex, this.storeRowIndices);
        this.storeRowIndices = newIndices;
        // ソート後の状態を記録する
        const newSortKeys = this.columnSorter.serializeSortKeys();

        // DOM行の並び替え
        this.rearrangeDomRowsByStoreIndices(newIndices);

        // 並び替え後に全データ行の data-row 属性・行ヘッダーテキスト・リサイズハンドルを再設定する
        this.structure.renumberRowsFrom(1);
        // DOM行順序が変わったため選択オーバーレイの描画位置を再計算する
        this.selection.updateRendererAfterResize();
        // 全列ヘッダーのソートインジケーターを更新する
        this.updateAllSortIndicators();
        // ソート後もフィルター状態を維持する（フィルター適用中の場合は表示/非表示を再計算する）
        this.refreshFilterDisplayIfActive();
        this.refreshScrollbarMarkers();

        // ソート状態をスキーマJSONに永続化する（fire-and-forget）
        saveSchemaDataAsync(this.table);

        // SortCommand を履歴に積む（既に実行済みのため pushCommand を使う）
        const command = new SortCommand(this.table, oldSortKeys, newSortKeys);
        const anchor = this.selection.getAnchor();
        const copyRange = this.selection.getCopyRange();
        const range = {startRow: anchor.row, startColumn: anchor.column, endRow: anchor.row, endColumn: anchor.column};
        this.history.pushCommand(command, range, copyRange);
    }

    /**
     * シリアライズ済みソートキーからソート状態を適用する（SortCommand の execute/undo 用）。
     *
     * restoreSortState() はタブ復元専用（saveSchemaDataAsync を呼ばない）であるのに対し、
     * このメソッドはコマンドの undo/redo から呼ばれ、saveSchemaDataAsync も呼ぶ。
     */
    applySortState(sortKeys: SerializedSortKey[]): void {
        // blameはgit committed dataのため、ソート変更でDOM行並び替えが発生し陳腐化する
        this.hideBlameIfVisible();
        // 既存のソート状態をリセットしてから復元する
        this.columnSorter.clearAllSorts();
        if (sortKeys.length > 0) {
            // ソートキーを復元して新しい storeRowIndices を取得する
            const newIndices = this.columnSorter.restoreSortKeys(sortKeys, this.storeRowIndices);
            this.storeRowIndices = newIndices;
            this.rearrangeDomRowsByStoreIndices(newIndices);
        } else {
            // ソート解除: storeRowIndices を元の順序（0, 1, 2, ...）に戻す
            const naturalOrder: number[] = [];
            for (let i = 0; i < this.storeRowIndices.length; i++) naturalOrder.push(i);
            this.storeRowIndices = naturalOrder;
            this.rearrangeDomRowsByStoreIndices(naturalOrder);
        }
        this.structure.renumberRowsFrom(1);
        this.selection.updateRendererAfterResize();
        this.updateAllSortIndicators();
        this.refreshFilterDisplayIfActive();
        this.refreshScrollbarMarkers();
        // ソート状態をスキーマJSONに永続化する（fire-and-forget）
        saveSchemaDataAsync(this.table);
    }

    /**
     * シリアライズ済みフィルターからフィルター状態を適用する（FilterCommand の execute/undo 用）。
     *
     * restoreFilterState() はタブ復元専用（saveSchemaDataAsync を呼ばない）であるのに対し、
     * このメソッドはコマンドの undo/redo から呼ばれ、saveSchemaDataAsync も呼ぶ。
     */
    applyFilterState(filters: SerializedFilters): void {
        const storeColumnNames = this.store.getHeader(this.tableName);
        if (storeColumnNames === false) return;
        // 既存のフィルター状態をリセットしてから復元する
        this.columnFilter.clearAllFilters();
        const hasFilters = Object.keys(filters).length > 0;
        if (hasFilters) {
            this.columnFilter.restoreFilters(filters, storeColumnNames);
        }
        // フィルター有無に関わらず applyFilterDisplay() を呼ぶ
        // （フィルター解除時に全行を再表示し、行数カウンターを非表示にするため）
        this.applyFilterDisplay();
        // フィルター状態をスキーマJSONに永続化する（fire-and-forget）
        saveSchemaDataAsync(this.table);
    }

    /**
     * FilterDropdown からフィルター変更をコマンドとして履歴に積む。
     * FilterDropdown は History を直接参照しないため、このメソッドを経由する（デメテルの法則）。
     *
     * @param oldFilters フィルター変更前のシリアライズ済みフィルター
     * @param newFilters フィルター変更後のシリアライズ済みフィルター
     */
    pushFilterCommand(oldFilters: SerializedFilters, newFilters: SerializedFilters): void {
        const command = new FilterCommand(this.table, oldFilters, newFilters);
        const anchor = this.selection.getAnchor();
        const copyRange = this.selection.getCopyRange();
        const range = {startRow: anchor.row, startColumn: anchor.column, endRow: anchor.row, endColumn: anchor.column};
        this.history.pushCommand(command, range, copyRange);
    }

    /**
     * storeRowIndices の順序に従って DOM のデータ行を並び替える。
     * applySortForColumn / applySortState から共通で使われる。
     */
    rearrangeDomRowsByStoreIndices(indices: number[]): void {
        // バーチャルスクロール有効時: DOM上にはビューポート分の行しか存在しないため
        // DOM要素の物理的な並び替えは不可能。storeRowIndices は呼び出し元で更新済みなので、
        // 全行を破棄して renderRowForVirtualScroll 経由で再レンダリングする。
        const range = this.virtualScroll.getRenderedRange();
        if (range.end - range.start < indices.length) {
            this.virtualScroll.forceFullRerender();
            return;
        }
        // ミニテーブル・非仮想スクロール時: 全行がDOMに存在するため従来の並び替え
        // data-store-index 属性を使ってストアインデックス → DOM行要素のマップを構築する
        const storeIndexToRowElement = new Map<number, HTMLElement>();
        const totalRows = this.getRowCount();
        for (let domIdx = 1; domIdx < totalRows; domIdx++) {
            const row = this.getRowElement(domIdx);
            if (!row) continue;
            if (row.classList.contains('editor-table-empty-row')) continue;
            if (!row.hasAttribute('data-store-index')) continue;
            storeIndexToRowElement.set(Number(row.dataset.storeIndex), row);
        }
        // バッファ行の先頭要素を取得しておく（insertBefore の基準点として使用）
        const firstEmptyRow = this.gridElement.querySelector('.editor-table-empty-row');
        // indices の順序でデータ行を親に再挿入する（insertBefore でバッファ行の前に配置）
        for (const storeIdx of indices) {
            const row = storeIndexToRowElement.get(storeIdx);
            if (!row) throw new Error('[EditorTable.rearrangeDomRowsByStoreIndices] storeIdx に対応するDOM行が存在しません: ' + storeIdx);
            if (firstEmptyRow) {
                this.gridElement.insertBefore(row, firstEmptyRow);
            } else {
                // bottomSpacerの手前に挿入する（enabled=false なら通常の appendChild）
                this.virtualScroll.appendDataRow(row);
            }
        }
    }

    /**
     * 現在の ColumnFilter 状態に基づいてデータ行の表示を制御する。
     *
     * 仮想スクロール有効時: filteredRowIndices を更新して forceFullRerender() で再描画する。
     *   DOM に存在しない行に display=none を適用できないため、filteredRowIndices で
     *   レンダリング対象を制限し、totalRowCount をフィルター後の行数に更新する。
     *
     * 仮想スクロール無効時（ミニテーブル）: 従来通り display=none で行を制御する。
     *
     * FilterDropdown の適用・クリア時と、ソート変更時・行挿入削除時に呼ばれる。
     */
    applyFilterDisplay(): void {
        const storeRows = this.store.getRows(this.tableName);
        if (storeRows === false) return;

        const isVirtualScrollActive = !this.isMiniTable;

        // フィルター未適用時
        if (!this.columnFilter.hasActiveFilter()) {
            // filteredRowIndices を空配列にリセットする（フィルター未適用状態）
            this.filteredRowIndices = [];
            this.refreshRowHeaderWidth();
            if (isVirtualScrollActive) {
                // 仮想スクロール: totalRowCount を全行数+バッファ行に戻して再描画
                this.virtualScroll.updateTotalRowCount(this.storeRowIndices.length + 1);
                this.virtualScroll.forceFullRerender();
            } else {
                // ミニテーブル: 従来通り display を復元
                for (let domDataRow = 0; domDataRow < this.storeRowIndices.length; domDataRow++) {
                    const rowEl = this.getRowElement(domDataRow + 1);
                    if (rowEl) rowEl.style.display = '';
                }
            }
            this.updateFilterActiveClasses();
            this.filterRowCountElement.style.display = 'none';
            this.selection.updateRendererAfterResize();
            this.refreshFreezeVisualState();
            this.refreshScrollbarMarkers();
            return;
        }

        // フィルター条件に一致するストアインデックスのセットを構築する
        const filteredStoreIndices = this.columnFilter.computeFilteredIndices(this.storeRowIndices, storeRows);
        const filteredSet = new Set(filteredStoreIndices);
        const totalCount = this.storeRowIndices.length;

        // filteredRowIndices を構築: storeRowIndices 上のインデックスのうちフィルタ条件を満たすもの
        this.filteredRowIndices = [];
        for (let i = 0; i < this.storeRowIndices.length; i++) {
            if (filteredSet.has(this.storeRowIndices[i])) {
                this.filteredRowIndices.push(i);
            }
        }
        const visibleCount = this.filteredRowIndices.length;
        this.refreshRowHeaderWidth();

        if (isVirtualScrollActive) {
            // 仮想スクロール: totalRowCount をフィルター後の行数+バッファ1行に更新して全行再描画
            this.virtualScroll.updateTotalRowCount(visibleCount + 1);
            // フィルター前の scrollTop がフィルター後のコンテンツ高さを超えている場合、
            // recalculateCore() で firstVisibleRow > totalRowCount となり何も描画されなくなる。
            // forceFullRerender() の前に scrollTop を先頭にリセットする。
            this.virtualScroll.resetScrollTop();
            this.virtualScroll.forceFullRerender();
        } else {
            // ミニテーブル: 従来通り display で行を制御する（全行がDOMに存在するため）
            for (let domDataRow = 0; domDataRow < this.storeRowIndices.length; domDataRow++) {
                const storeRowIndex = this.storeRowIndices[domDataRow];
                const domRow = this.getRowElement(domDataRow + 1);
                if (!domRow) continue;
                if (filteredSet.has(storeRowIndex)) {
                    domRow.style.display = '';
                } else {
                    domRow.style.display = 'none';
                }
            }
        }

        // フィルターアクティブクラスをヘッダーセルに付与/除去する
        this.updateFilterActiveClasses();

        // 行数カウンターを更新する
        this.filterRowCountElement.textContent = `${visibleCount} / ${totalCount} 行`;
        this.filterRowCountElement.style.display = 'block';

        // フィルター適用後の行数内に selection をクランプする
        // focus.row がフィルター後の行数を超えている場合、scrollFocusIntoView() が
        // 無効な行位置でスクロール計算を行い画面が異常な位置に飛ぶ
        this.clampSelectionToFilteredRange();

        // 行の display 変更後に選択オーバーレイの描画位置を再計算する（非表示行にまたがる選択を解消）
        this.selection.updateRendererAfterResize();
        this.refreshFreezeVisualState();
        this.refreshScrollbarMarkers();
    }

    /**
     * フィルター適用/解除後に selection の focus/range がフィルター後の行数内に収まるようクランプする。
     * focus.row がフィルター後のデータ行数を超えている場合、先頭データ行（row=1）にリセットする。
     * selection.start() は scrollFocusIntoView() を呼ぶため使わない。
     * scrollFocusIntoView() が forceFullRerender() 直後のレイアウト確定前に呼ばれると
     * getBoundingClientRect() が不正な値を返し、スクロールが異常な位置に飛ぶ。
     */
    clampSelectionToFilteredRange(): void {
        const maxRow = this.getFilteredDataRowCount();
        // focus/range を直接クランプする。scrollFocusIntoView は呼ばない。
        // 後続の updateRendererAfterResize() で選択オーバーレイの描画位置が再計算される。
        this.selection.clampToFilteredRowCount(maxRow);
    }

    /**
     * 全列ヘッダーのフィルタークラス（.filter-active）を現在のフィルター状態に合わせて更新する。
     * ColumnFilter はストア列インデックスで管理しているため、DOM列インデックスを変換してから参照する。
     */
    updateFilterActiveClasses(): void {
        const headerRow = this.gridElement.children[0];
        const columnCount = this.getColumnCount();
        for (let colIdx = 0; colIdx < columnCount; colIdx++) {
            const headerCell = headerRow.children[colIdx + this.dataColumnOffset()] as HTMLElement;
            const storeColIdx = this.getStoreColumnIndex(colIdx);
            if (storeColIdx !== -1 && this.columnFilter.isColumnFiltered(storeColIdx)) {
                headerCell.classList.add('filter-active');
            } else {
                headerCell.classList.remove('filter-active');
            }
        }
        this.refreshDetachedHeaderLayout();
    }

    /**
     * フィルタードロップダウンを指定列用に開く（EditorTableStructureのフィルターアイコンクリックから使用）。
     * デメテルの法則に従い、EditorTable が FilterDropdown を隠蔽して操作する。
     *
     * @param columnIndex 対象列インデックス（0始まり、行ヘッダー除く）
     * @param anchorElement フィルターアイコン要素（位置決め用）
     */
    openFilterDropdown(columnIndex: number, anchorElement: HTMLElement): void {
        this.filterDropdown.open(columnIndex, anchorElement);
    }

    /**
     * 全列ヘッダーのソートインジケーターを現在のソート状態に合わせて更新する。
     * - ソートされていない列: sort-asc/sort-desc クラスなし、優先度なし
     * - ソートされた列: sort-asc または sort-desc クラスを付与、優先度番号を表示
     */
    updateAllSortIndicators(): void {
        const headerRow = this.gridElement.children[0];
        const columnCount = this.getColumnCount();
        const totalSortKeyCount = this.columnSorter.getSortKeyCount();
        for (let colIdx = 0; colIdx < columnCount; colIdx++) {
            const headerCell = headerRow.children[colIdx + this.dataColumnOffset()] as HTMLElement;
            const indicator = headerCell.querySelector('.sort-indicator');
            if (!indicator) continue;
            const sortKey = this.columnSorter.getSortKeyForColumn(colIdx);
            const priority = this.columnSorter.getPriorityForColumn(colIdx);
            // ソートクラスを更新
            headerCell.classList.remove('sort-asc', 'sort-desc');
            if (sortKey) {
                headerCell.classList.add(sortKey.direction === 'asc' ? 'sort-asc' : 'sort-desc');
            }
            // 優先度番号を更新（全ソートキー数が1の場合は番号なし）
            const prioritySpan = indicator.querySelector('.sort-priority');
            if (prioritySpan) {
                prioritySpan.textContent = (sortKey && totalSortKeyCount > 1) ? String(priority) : '';
            }
        }
        this.refreshDetachedHeaderLayout();
    }


}
