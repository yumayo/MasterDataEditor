/**
 * ユーザーデータ永続化用のフィルター表現（列名ベース）
 */
export interface SerializedFilters {
    [columnName: string]: string[] | {values: string[]; excludeEmpty: boolean};
}

/** ジャンプやスケジュールの一時条件は、永続設定と独立した値リストとして扱う。 */
export interface TemporaryFilters {
    [columnName: string]: string[];
}

interface ColumnFilterCondition {
    selectedValues: Set<string>;
    excludeEmpty: boolean;
}

export type TemporaryFilterMode = 'and' | 'or';

/**
 * 列フィルター管理クラス
 *
 * 責務:
 * - 列ごとのフィルター状態（選択された値と空セル除外）を管理
 * - ソート済みインデックスに対してフィルター条件を適用し、表示対象行インデックスを計算する
 * - 指定列のユニーク値リストを提供する
 *
 * このクラスが扱う列インデックスはすべて「ストア（CSV）列インデックス」である。
 * DOM列インデックスからの変換は呼び出し側（FilterDropdown）が EditorTable.getStoreColumnIndex() で行う。
 */
export class ColumnFilter {
    /**
     * ストア列インデックス → 選択値と空セル除外条件のマップ。
     * 条件が存在する列は「フィルター適用中」とみなす。
     * セット内の値を持つ行のみ表示される。
     */
    private readonly filterMap: Map<number, ColumnFilterCondition>;
    /**
     * ナビゲーション等で一時的に適用するフィルター。
     * ユーザー設定の永続化対象の filterMap とは分離し、serializeFilters() には含めない。
     */
    private readonly temporaryFilterMap: Map<number, ColumnFilterCondition>;
    private temporaryFilterMode: TemporaryFilterMode;

    constructor() {
        this.filterMap = new Map();
        this.temporaryFilterMap = new Map();
        this.temporaryFilterMode = 'and';
    }

    /**
     * 指定ストア列にフィルターを適用する。
     * selectedValues に含まれる値を持つ行のみ表示対象となる。
     * selectedValues が空の場合、空セルだけを表示する。excludeEmpty も有効なら全行非表示。
     *
     * @param storeColumnIndex ストア（CSV）列インデックス（0始まり）
     */
    applyFilter(storeColumnIndex: number, selectedValues: Set<string>, excludeEmpty: boolean): void {
        this.temporaryFilterMap.clear();
        this.temporaryFilterMode = 'and';
        this.filterMap.set(storeColumnIndex, {selectedValues: new Set(selectedValues), excludeEmpty});
    }

    /**
     * 一時フィルターを列名ベースの表現から復元して適用する。
     * 既存の永続フィルターは保持するが、一時フィルター適用中の表示判定では一時側を優先する。
     */
    applyTemporaryFilters(serialized: TemporaryFilters, storeColumnNames: readonly string[], mode: TemporaryFilterMode = 'and'): void {
        this.temporaryFilterMap.clear();
        this.temporaryFilterMode = mode;
        const nameToStoreIndex = new Map<string, number>();
        for (let i = 0; i < storeColumnNames.length; i++) {
            nameToStoreIndex.set(storeColumnNames[i], i);
        }
        for (const columnName of Object.keys(serialized)) {
            const storeColIdx = nameToStoreIndex.get(columnName);
            if (storeColIdx !== null && storeColIdx !== undefined) {
                this.temporaryFilterMap.set(storeColIdx, {selectedValues: new Set(serialized[columnName]), excludeEmpty: false});
            }
        }
    }

    /**
     * 指定ストア列のフィルターを解除する。
     *
     * @param storeColumnIndex ストア（CSV）列インデックス（0始まり）
     */
    clearFilter(storeColumnIndex: number): void {
        this.temporaryFilterMap.clear();
        this.temporaryFilterMode = 'and';
        this.filterMap.delete(storeColumnIndex);
    }

    /**
     * 全列のフィルターを解除する。
     */
    clearAllFilters(): void {
        this.filterMap.clear();
        this.temporaryFilterMap.clear();
        this.temporaryFilterMode = 'and';
    }

    /**
     * いずれかの列でフィルターが適用中かどうかを返す。
     */
    hasActiveFilter(): boolean {
        return this.getEffectiveFilterMap().size > 0;
    }

    /**
     * 指定ストア列にフィルターが適用中かどうかを返す。
     *
     * @param storeColumnIndex ストア（CSV）列インデックス（0始まり）
     */
    isColumnFiltered(storeColumnIndex: number): boolean {
        return this.getEffectiveFilterMap().has(storeColumnIndex);
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
        const effectiveFilterMap = this.getEffectiveFilterMap();
        if (effectiveFilterMap.size === 0) return sortedIndices;
        // filterMap の内容をスナップショットとして取り出す（forEach で Map を走査）
        const filterEntries: Array<ColumnFilterCondition & {storeColumnIndex: number}> = [];
        effectiveFilterMap.forEach((condition, storeColumnIndex) => {
            filterEntries.push({storeColumnIndex, ...condition});
        });
        if (this.temporaryFilterMap.size > 0 && this.temporaryFilterMode === 'or') {
            return sortedIndices.filter(storeRowIndex => {
                const row = storeRows[storeRowIndex];
                for (const { storeColumnIndex, selectedValues } of filterEntries) {
                    if (storeColumnIndex < row.length && row[storeColumnIndex] !== '' && selectedValues.has(row[storeColumnIndex])) return true;
                }
                return false;
            });
        }
        return sortedIndices.filter(storeRowIndex => {
            const row = storeRows[storeRowIndex];
            // 全フィルター列で AND 条件を評価する
            for (const {storeColumnIndex, selectedValues, excludeEmpty} of filterEntries) {
                if (storeColumnIndex >= row.length) return false;
                // 空は格納値が空文字列のセルだけ。空白、0、false は通常の選択値として扱う。
                if (row[storeColumnIndex] === '') {
                    if (excludeEmpty) return false;
                    continue;
                }
                if (!selectedValues.has(row[storeColumnIndex])) return false;
            }
            return true;
        });
    }

    /**
     * 指定ストア列のユニーク値リストをソートして返す。
     * 空文字列は値リストから除外し、空セル除外条件で表示を制御する。
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
        const effectiveFilterMap = this.getEffectiveFilterMap();
        if (!effectiveFilterMap.has(storeColumnIndex)) return null;
        return (effectiveFilterMap.get(storeColumnIndex) as ColumnFilterCondition).selectedValues;
    }

    /** 当該列の適用済み条件を返し、未適用列は空セルを通す。 */
    excludesEmptyCells(storeColumnIndex: number): boolean {
        const effectiveFilterMap = this.getEffectiveFilterMap();
        if (!effectiveFilterMap.has(storeColumnIndex)) return false;
        return (effectiveFilterMap.get(storeColumnIndex) as ColumnFilterCondition).excludeEmpty;
    }

    /**
     * 現在のフィルター状態をユーザーデータ永続化用にシリアライズする。
     * ストア列インデックスを列名に変換するため、CSVヘッダー（storeColumnNames）を受け取る。
     * フィルターがない場合は空オブジェクトを返す。
     *
     * @param storeColumnNames ストア（CSV）の列名配列（storeColumnNames[storeColIndex] = 列名）
     */
    serializeFilters(storeColumnNames: readonly string[]): SerializedFilters {
        const entries: Array<[string, SerializedFilters[string]]> = [];
        this.filterMap.forEach(({selectedValues, excludeEmpty}, storeColumnIndex) => {
            if (storeColumnIndex < storeColumnNames.length) {
                const values = Array.from(selectedValues);
                // OFFは従来の配列表現を維持し、ONの列だけ追加条件を保存する。
                entries.push([storeColumnNames[storeColumnIndex], excludeEmpty ? {values, excludeEmpty} : values]);
            }
        });
        return Object.fromEntries(entries);
    }

    /**
     * ユーザーデータから読み込んだフィルター状態を復元する。
     * 列名をストア列インデックスに逆引きし、存在しない列名は無視する。
     *
     * @param serialized ユーザーデータから読み込んだフィルターオブジェクト
     * @param storeColumnNames ストア（CSV）の列名配列（storeColumnNames[storeColIndex] = 列名）
     */
    restoreFilters(serialized: SerializedFilters, storeColumnNames: readonly string[]): void {
        this.filterMap.clear();
        this.temporaryFilterMap.clear();
        this.temporaryFilterMode = 'and';
        // 列名 → ストア列インデックスのマップを構築
        const nameToStoreIndex = new Map<string, number>();
        for (let i = 0; i < storeColumnNames.length; i++) {
            nameToStoreIndex.set(storeColumnNames[i], i);
        }
        for (const columnName of Object.keys(serialized)) {
            const storeColIdx = nameToStoreIndex.get(columnName);
            if (storeColIdx !== null && storeColIdx !== undefined) {
                const condition = serialized[columnName];
                this.filterMap.set(storeColIdx, Array.isArray(condition)
                    ? {selectedValues: new Set(condition), excludeEmpty: false}
                    : {selectedValues: new Set(condition.values), excludeEmpty: condition.excludeEmpty});
            }
        }
    }

    private getEffectiveFilterMap(): Map<number, ColumnFilterCondition> {
        return this.temporaryFilterMap.size > 0 ? this.temporaryFilterMap : this.filterMap;
    }
}
