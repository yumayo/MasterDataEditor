import {Csv} from "../data/csv";

/**
 * gitのHEAD版CSVとの差分を追跡するクラス
 * 主キーと公開期間などの行識別列を使い、HEAD版の対応する行と各セルを比較する
 */
export class GitDiffTracker {
    /** HEAD版データ: 行識別キー（タブ区切り連結） → 行の値配列のMap */
    private readonly headRowMap: Map<string, string[]>;
    /** 主キーと公開期間など、比較対象の行を識別する列のインデックス配列 */
    private readonly rowIdentityColumnIndices: readonly number[];
    /** 全セルが changed かどうか（isNew: true のテーブル用） */
    private readonly allChanged: boolean;

    constructor(headRowMap: Map<string, string[]>, rowIdentityColumnIndices: readonly number[], allChanged: boolean) {
        this.headRowMap = headRowMap;
        this.rowIdentityColumnIndices = rowIdentityColumnIndices;
        this.allChanged = allChanged;
    }

    /**
     * isNew: true のテーブル用の GitDiffTracker を作成する（HEAD版が存在しない）
     * 全セルが changed として判定される
     */
    static createForNewTable(rowIdentityColumnIndices: readonly number[]): GitDiffTracker {
        return new GitDiffTracker(new Map(), rowIdentityColumnIndices, true);
    }

    /** この列の編集で比較対象のHEAD行が変わるかを判定する。 */
    isRowIdentityColumn(columnIndex: number): boolean {
        return this.rowIdentityColumnIndices.includes(columnIndex);
    }

    /**
     * HEAD版CSVテキストをパースして 行識別キー → 行データ Map を構築する
     * Csv クラスを使用することでストア側の load() と同じパース挙動を保証し、
     * 空白トリムの不整合による誤差分検出を防止する
     *
     * currentHeader を渡すと、HEAD版の行データを currentHeader の列順に並べ替えて格納する。
     * これにより isCellChanged() で currentRow[columnIndex] と headRow[columnIndex] が
     * 同じ列名の値を指すことが保証される（列追加・列順序変更に対応）。
     */
    static buildHeadRowMap(headCsvText: string, rowIdentityColumnIndices: readonly number[], currentHeader: readonly string[]): Map<string, string[]> {
        const csv = new Csv();
        csv.load(headCsvText);
        // HEAD版ヘッダーの列名→インデックスマップを構築する（リマップ用）
        const headHeaderMap = GitDiffTracker.buildHeaderIndexMap(csv.header);
        // HEAD版の行識別列を列名で解決する（現在版の列インデックスは直接使えない）。
        const headIdentityIndices: number[] = [];
        for (const currentIdx of rowIdentityColumnIndices) {
            if (currentIdx >= 0 && currentIdx < currentHeader.length) {
                const colName = currentHeader[currentIdx];
                if (headHeaderMap.has(colName)) {
                    headIdentityIndices.push(headHeaderMap.get(colName)!);
                } else {
                    headIdentityIndices.push(-1);
                }
            } else {
                headIdentityIndices.push(-1);
            }
        }
        const map = new Map<string, string[]>();
        for (const row of csv.body) {
            // 主キーと公開期間の値をHEAD版の列順で取得する。
            const rowKey = GitDiffTracker.buildCompositeKey(row, headIdentityIndices);
            // HEAD行をcurrentHeader順に並べ替えて格納する
            const remapped = GitDiffTracker.remapRow(row, headHeaderMap, currentHeader);
            // 行識別列がすべて重複するときは従来どおり最初の行を採用する。
            if (!map.has(rowKey)) map.set(rowKey, remapped);
        }
        return map;
    }

    /**
     * 行データと識別列インデックス配列から複合キー文字列を生成する
     * 単一列の場合も同じロジックで処理できる（1要素配列のタブ区切り = 値そのもの）
     * idx < 0 は「列が見つからない」ケースなので空文字に落とす（idx >= 0 && idx < row.length で境界チェック）
     */
    public static buildCompositeKey(row: string[], columnIndices: readonly number[]): string {
        return columnIndices.map(idx => idx >= 0 && idx < row.length ? row[idx] : '').join('\t');
    }

    /**
     * ヘッダー配列から列名→インデックスのマップを構築する
     */
    static buildHeaderIndexMap(header: readonly string[]): Map<string, number> {
        const map = new Map<string, number>();
        for (let i = 0; i < header.length; i++) map.set(header[i], i);
        return map;
    }

    /**
     * 行の値をソースヘッダー順から表示ヘッダー順に並べ替える。
     * ソースヘッダーに存在しない表示列は空文字列になる。
     */
    static remapRow(row: string[], sourceHeaderMap: Map<string, number>, displayHeader: readonly string[]): string[] {
        const result: string[] = [];
        for (const name of displayHeader) {
            if (sourceHeaderMap.has(name)) {
                const idx = sourceHeaderMap.get(name)!;
                result.push(idx < row.length ? row[idx] : '');
            } else {
                result.push('');
            }
        }
        return result;
    }

    /**
     * 指定セルがHEAD版と異なるかを判定する
     * @param currentRows 現在のストア行データ（ストア全行）
     * @param rowIndex ストア行インデックス（0始まり）
     * @param columnIndex 列インデックス（0始まり）
     */
    isCellChanged(currentRows: string[][], rowIndex: number, columnIndex: number): boolean {
        if (this.allChanged) return true;
        if (rowIndex < 0 || rowIndex >= currentRows.length) return false;
        const currentRow = currentRows[rowIndex];
        const rowKey = GitDiffTracker.buildCompositeKey(currentRow, this.rowIdentityColumnIndices);
        // 同じ主キー・公開期間の行がHEAD版にない場合は新規追加行として扱う。
        if (!this.headRowMap.has(rowKey)) return true;
        const headRow = this.headRowMap.get(rowKey)!;
        const headValue = columnIndex < headRow.length ? headRow[columnIndex] : '';
        const currentValue = columnIndex < currentRow.length ? currentRow[columnIndex] : '';
        return headValue !== currentValue;
    }
}
