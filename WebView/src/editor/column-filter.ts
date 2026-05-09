/**
 * スキーマJSON永続化用のフィルター表現（列名ベース）
 */
export interface SerializedFilters {
    [columnName: string]: string[];
}

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
                // 空文字列セルは常にフィルターを通過させる（リストに表示されない値のため）
                if (row[storeColumnIndex] === '') continue;
                if (!selectedValues.has(row[storeColumnIndex])) return false;
            }
            return true;
        });
    }

    /**
     * 指定ストア列のユニーク値リストをソートして返す。
     * 空文字列は除外する（リストに表示しないが、フィルター適用時は常に通過させる）。
     *
     * @param storeColumnIndex ストア（CSV）列インデックス（0始まり）
     * @param storeRows ストアの全行データ
     */
    getUniqueValues(storeColumnIndex: number, storeRows: string[][]): string[] {
        const valueSet = new Set<string>();
        for (const row of storeRows) {
            if (storeColumnIndex < row.length && row[storeColumnIndex] !== '') {
                valueSet.add(row[storeColumnIndex]);
            }
        }
        return Array.from(valueSet).sort((a, b) => {
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

    /**
     * 現在のフィルター状態をスキーマJSON永続化用にシリアライズする。
     * ストア列インデックスを列名に変換するため、CSVヘッダー（storeColumnNames）を受け取る。
     * フィルターがない場合は空オブジェクトを返す。
     *
     * @param storeColumnNames ストア（CSV）の列名配列（storeColumnNames[storeColIndex] = 列名）
     */
    serializeFilters(storeColumnNames: readonly string[]): SerializedFilters {
        const result: SerializedFilters = {};
        this.filterMap.forEach((selectedValues, storeColumnIndex) => {
            if (storeColumnIndex < storeColumnNames.length) {
                result[storeColumnNames[storeColumnIndex]] = Array.from(selectedValues);
            }
        });
        return result;
    }

    /**
     * スキーマJSONから読み込んだフィルター状態を復元する。
     * 列名をストア列インデックスに逆引きし、存在しない列名は無視する。
     *
     * @param serialized スキーマJSONから読み込んだフィルターオブジェクト
     * @param storeColumnNames ストア（CSV）の列名配列（storeColumnNames[storeColIndex] = 列名）
     */
    restoreFilters(serialized: SerializedFilters, storeColumnNames: readonly string[]): void {
        // 列名 → ストア列インデックスのマップを構築
        const nameToStoreIndex = new Map<string, number>();
        for (let i = 0; i < storeColumnNames.length; i++) {
            nameToStoreIndex.set(storeColumnNames[i], i);
        }
        for (const columnName of Object.keys(serialized)) {
            const storeColIdx = nameToStoreIndex.get(columnName);
            if (storeColIdx !== null && storeColIdx !== undefined) {
                this.filterMap.set(storeColIdx, new Set(serialized[columnName]));
            }
        }
    }
}
