/**
 * 列フィルター管理クラス
 *
 * 責務:
 * - 列ごとのフィルター状態（選択された値のセット）を管理
 * - ソート済みインデックスに対してフィルター条件を適用し、表示対象行インデックスを計算する
 * - 指定列のユニーク値リストを提供する
 *
 * このクラスが扱う列インデックスはすべて「ストア（CSV）列インデックス」である。
 * DOM列インデックスからの変換は呼び出し側（FilterDropdown）が EditorTable.getStoreColumnIndex() で行う。
 */
export class ColumnFilter {
    /**
     * ストア列インデックス → 選択された値セットのマップ。
     * 値セットが存在する列は「フィルター適用中」とみなす。
     * セット内の値を持つ行のみ表示される。
     */
    private readonly filterMap: Map<number, Set<string>>;

    constructor() {
        this.filterMap = new Map();
    }

    /**
     * 指定ストア列にフィルターを適用する。
     * selectedValues に含まれる値を持つ行のみ表示対象となる。
     * selectedValues が空の場合、全行が非表示になる（空セットも有効なフィルター状態）。
     *
     * @param storeColumnIndex ストア（CSV）列インデックス（0始まり）
     */
    applyFilter(storeColumnIndex: number, selectedValues: Set<string>): void {
        this.filterMap.set(storeColumnIndex, new Set(selectedValues));
    }

    /**
     * 指定ストア列のフィルターを解除する。
     *
     * @param storeColumnIndex ストア（CSV）列インデックス（0始まり）
     */
    clearFilter(storeColumnIndex: number): void {
        this.filterMap.delete(storeColumnIndex);
    }

    /**
     * 全列のフィルターを解除する。
     */
    clearAllFilters(): void {
        this.filterMap.clear();
    }

    /**
     * いずれかの列でフィルターが適用中かどうかを返す。
     */
    hasActiveFilter(): boolean {
        return this.filterMap.size > 0;
    }

    /**
     * 指定ストア列にフィルターが適用中かどうかを返す。
     *
     * @param storeColumnIndex ストア（CSV）列インデックス（0始まり）
     */
    isColumnFiltered(storeColumnIndex: number): boolean {
        return this.filterMap.has(storeColumnIndex);
    }

    /**
     * ソート済みインデックス配列にフィルターを適用して、表示対象行インデックスの配列を返す。
     * 複数列フィルターは AND 条件で評価する。
     * フィルターが未適用の場合は sortedIndices をそのまま返す。
     *
     * @param sortedIndices ソート済みのストア行インデックス配列
     * @param storeRows ストアの全行データ（storeRows[storeRowIndex][storeColumnIndex] = 値）
     */
    computeFilteredIndices(sortedIndices: number[], storeRows: string[][]): number[] {
        if (!this.hasActiveFilter()) return sortedIndices;
        // filterMap の内容をスナップショットとして取り出す（forEach で Map を走査）
        const filterEntries: Array<{ storeColumnIndex: number; selectedValues: Set<string> }> = [];
        this.filterMap.forEach((selectedValues, storeColumnIndex) => {
            filterEntries.push({ storeColumnIndex, selectedValues });
        });
        return sortedIndices.filter(storeRowIndex => {
            const row = storeRows[storeRowIndex];
            // 全フィルター列で AND 条件を評価する
            for (const { storeColumnIndex, selectedValues } of filterEntries) {
                if (storeColumnIndex >= row.length) return false;
                if (!selectedValues.has(row[storeColumnIndex])) return false;
            }
            return true;
        });
    }

    /**
     * 指定ストア列のユニーク値リストをソートして返す。
     * 空文字列は除外しない（フィルターで空セルも選択対象にできる）。
     *
     * @param storeColumnIndex ストア（CSV）列インデックス（0始まり）
     * @param storeRows ストアの全行データ
     */
    getUniqueValues(storeColumnIndex: number, storeRows: string[][]): string[] {
        const valueSet = new Set<string>();
        for (const row of storeRows) {
            if (storeColumnIndex < row.length) {
                valueSet.add(row[storeColumnIndex]);
            }
        }
        return Array.from(valueSet).sort((a, b) => {
            // 空文字列は末尾に配置する
            if (a === '' && b === '') return 0;
            if (a === '') return 1;
            if (b === '') return -1;
            const numA = Number(a);
            const numB = Number(b);
            if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
            return a.localeCompare(b);
        });
    }

    /**
     * 指定ストア列の選択済み値セットを返す。
     * フィルター未適用の列では null を返す。
     *
     * @param storeColumnIndex ストア（CSV）列インデックス（0始まり）
     */
    getSelectedValues(storeColumnIndex: number): Set<string> | null {
        if (!this.filterMap.has(storeColumnIndex)) return null;
        return this.filterMap.get(storeColumnIndex) as Set<string>;
    }
}
