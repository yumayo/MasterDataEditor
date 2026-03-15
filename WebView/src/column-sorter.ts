import {EditorTable} from "./editor-table";
import {InMemoryTableStore} from "./in-memory-table-store";

/**
 * ソート方向
 */
export type SortDirection = 'asc' | 'desc';

/**
 * ソートキー（どの列をどの方向でソートするか）
 */
export interface SortKey {
    columnIndex: number;
    direction: SortDirection;
}

/**
 * 列ソート管理クラス
 *
 * 責務:
 * - ソート状態の管理（どの列がどの方向でソートされているか、優先度）
 * - ソート適用: storeRowIndices の新しい並び順を計算する
 * - ソートのサイクル管理（昇順→降順→解除）
 * - 元のデータ順序の保存・復元
 *
 * 優先度のルール（先勝ちルール）:
 * - 新規追加は sortKeys の末尾に追加（最低優先度）
 * - 昇順: 降順に変更（位置は変えない）
 * - 降順→解除: filter() は相対順序を保持するため、除去後も追加順が維持される
 */
export class ColumnSorter {
    private readonly table: EditorTable;
    private readonly store: InMemoryTableStore;
    /**
     * ソートキーのリスト。先頭が最高優先度（先にクリックした列が先頭に来る）。
     * push() で末尾追加し、filter() で除去しても相対順序は保持される。
     */
    private sortKeys: SortKey[];
    /**
     * ソート前の元の storeRowIndices を保存しておく。
     * 全ソートが解除されたときにここから復元する。
     * ソート中に行が追加/削除された場合も notifyRowInserted/Deleted でリアルタイム更新される。
     */
    private originalIndices: number[];

    constructor(table: EditorTable, store: InMemoryTableStore) {
        this.table = table;
        this.store = store;
        this.sortKeys = [];
        this.originalIndices = [];
    }

    /**
     * 現在のソートキー数を返す（優先度番号表示のためにEditorTableが参照する）
     */
    getSortKeyCount(): number { return this.sortKeys.length; }

    /**
     * 指定列のソートキーを返す。ソートされていない場合はnullを返す。
     */
    getSortKeyForColumn(columnIndex: number): SortKey | null {
        const index = this.sortKeys.findIndex(k => k.columnIndex === columnIndex);
        if (index === -1) return null;
        return this.sortKeys[index];
    }

    /**
     * 指定列の優先度番号を返す（1始まり）。ソートされていない場合は-1を返す。
     * sortKeys[0] が優先度1（最高優先度）。
     */
    getPriorityForColumn(columnIndex: number): number {
        const index = this.sortKeys.findIndex(k => k.columnIndex === columnIndex);
        return index === -1 ? -1 : index + 1;
    }

    /**
     * 指定列のソートをトグルする（サイクル: 新規追加→昇順、昇順→降順、降順→解除）。
     * ソート適用後の新しい storeRowIndices を返す。
     *
     * 先勝ちルール:
     * - 新規追加は sortKeys の末尾に追加（最低優先度）
     * - 昇順: 降順に変更（位置は変えない）
     * - 降順→解除: filter() は相対順序を保持するため、除去後も追加順が維持される
     */
    toggleSort(columnIndex: number, currentIndices: number[]): number[] {
        const existingKey = this.sortKeys.find(k => k.columnIndex === columnIndex);

        if (!existingKey) {
            // 新規ソート: 初回時は元の順序を保存し、末尾に追加（最低優先度）
            if (this.sortKeys.length === 0) {
                this.originalIndices = [...currentIndices];
            }
            this.sortKeys.push({ columnIndex, direction: 'asc' });
        } else if (existingKey.direction === 'asc') {
            // 昇順→降順に変更（位置は変えない）
            existingKey.direction = 'desc';
        } else {
            // 降順→解除: filter() は相対順序を保持するため並べ直し不要
            this.sortKeys = this.sortKeys.filter(k => k.columnIndex !== columnIndex);
            if (this.sortKeys.length === 0) {
                // 全ソート解除: 元の順序を返して状態をリセット
                const restored = [...this.originalIndices];
                this.originalIndices = [];
                return restored;
            }
        }

        return this.computeSortedIndices();
    }

    /**
     * ソート中に行が挿入されたことを通知する。
     * originalIndices 内で storeRowIndex 以上のエントリを +1 し、
     * 新規行を originalIndices の末尾に追加してソート解除時に正しい元順序を復元できるようにする。
     *
     * ソート中でない場合（sortKeys が空）は何もしない。
     *
     * @param storeRowIndex 挿入されたストア行インデックス
     */
    notifyRowInserted(storeRowIndex: number): void {
        if (this.sortKeys.length === 0) return;
        // 既存エントリで storeRowIndex 以上のものをすべて +1（ストアインデックスのずれを補正）
        for (let i = 0; i < this.originalIndices.length; i++) {
            if (this.originalIndices[i] >= storeRowIndex) this.originalIndices[i]++;
        }
        // 新規行を末尾に追加（ソート解除時に元順序の末尾に現れる）
        this.originalIndices.push(storeRowIndex);
    }

    /**
     * ソート中に行が削除されたことを通知する。
     * originalIndices から storeRowIndex に対応するエントリを削除し、
     * それより大きいエントリを -1 してストアインデックスのずれを補正する。
     *
     * ソート中でない場合（sortKeys が空）は何もしない。
     *
     * @param storeRowIndex 削除されたストア行インデックス
     */
    notifyRowDeleted(storeRowIndex: number): void {
        if (this.sortKeys.length === 0) return;
        const idx = this.originalIndices.indexOf(storeRowIndex);
        if (idx !== -1) this.originalIndices.splice(idx, 1);
        // storeRowIndex より大きいエントリをすべて -1（ストアインデックスのずれを補正）
        for (let i = 0; i < this.originalIndices.length; i++) {
            if (this.originalIndices[i] > storeRowIndex) this.originalIndices[i]--;
        }
    }

    /**
     * 全ソート状態をリセットする。
     * reloadCellsFromStore() など外部からストアデータが大量変更された場合に呼ぶ。
     */
    clearAllSorts(): void {
        this.sortKeys = [];
        this.originalIndices = [];
    }

    /**
     * 現在の sortKeys に従って originalIndices を並び替えた新しい配列を計算して返す。
     * ストアのデータは変更しない（View変換のみ）。
     * sortKeys[0] が最高優先度（ソート時に最も重視される）。
     */
    private computeSortedIndices(): number[] {
        const storeRows = this.store.getRows(this.table.tableName);
        if (storeRows === false) throw new Error('[ColumnSorter.computeSortedIndices] ストア行データが存在しません: ' + this.table.tableName);

        // 元の順序（originalIndices）のコピーをソートする
        const indicesToSort = [...this.originalIndices];

        indicesToSort.sort((aStoreIdx, bStoreIdx) => {
            // 優先度の高い順（sortKeys[0] が最高優先度）に比較する
            for (const key of this.sortKeys) {
                // DOM列インデックス（0始まり、行ヘッダーなし）はストアの列インデックスと一致する
                const aRow = storeRows[aStoreIdx];
                const bRow = storeRows[bStoreIdx];
                const aVal = aRow[key.columnIndex];
                const bVal = bRow[key.columnIndex];
                const cmp = compareValues(aVal, bVal);
                if (cmp !== 0) {
                    return key.direction === 'asc' ? cmp : -cmp;
                }
            }
            return 0;
        });

        return indicesToSort;
    }
}

/**
 * 2つの文字列を比較する。
 * 空文字列は末尾に配置する（空セルを末尾に固定）。
 * 両方が数値として解釈可能であれば数値比較、そうでなければ文字列比較（localeCompare）。
 */
function compareValues(a: string, b: string): number {
    if (a === '' && b === '') return 0;
    if (a === '') return 1;
    if (b === '') return -1;
    const numA = Number(a);
    const numB = Number(b);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return a.localeCompare(b);
}
