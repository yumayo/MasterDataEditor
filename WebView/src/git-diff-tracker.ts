import {Csv} from "./csv";

/**
 * gitのHEAD版CSVとの差分を追跡するクラス
 * テーブルオープン時にHEAD版CSVを取得し、PK値ベースで各セルの差分情報を保持する
 */
export class GitDiffTracker {
    /** HEAD版データ: 複合PKキー（タブ区切り連結） → 行の値配列のMap */
    private readonly headRowMap: Map<string, string[]>;
    /** PK列のインデックス配列（複合PKは複数要素、単一PKは1要素） */
    private readonly pkColumnIndices: readonly number[];
    /** 全セルが changed かどうか（isNew: true のテーブル用） */
    private readonly allChanged: boolean;

    constructor(headRowMap: Map<string, string[]>, pkColumnIndices: readonly number[], allChanged: boolean) {
        this.headRowMap = headRowMap;
        this.pkColumnIndices = pkColumnIndices;
        this.allChanged = allChanged;
    }

    /**
     * isNew: true のテーブル用の GitDiffTracker を作成する（HEAD版が存在しない）
     * 全セルが changed として判定される
     */
    static createForNewTable(pkColumnIndices: readonly number[]): GitDiffTracker {
        return new GitDiffTracker(new Map(), pkColumnIndices, true);
    }

    /**
     * HEAD版CSVテキストをパースして 複合PKキー → 行データ Map を構築する
     * Csv クラスを使用することでストア側の load() と同じパース挙動を保証し、
     * 空白トリムの不整合による誤差分検出を防止する
     *
     * currentHeader を渡すと、HEAD版の行データを currentHeader の列順に並べ替えて格納する。
     * これにより isCellChanged() で currentRow[columnIndex] と headRow[columnIndex] が
     * 同じ列名の値を指すことが保証される（列追加・列順序変更に対応）。
     */
    static buildHeadRowMap(headCsvText: string, pkColumnIndices: readonly number[], currentHeader: readonly string[]): Map<string, string[]> {
        const csv = new Csv();
        csv.load(headCsvText);
        // HEAD版ヘッダーの列名→インデックスマップを構築する（リマップ用）
        const headHeaderMap = GitDiffTracker.buildHeaderIndexMap(csv.header);
        // HEAD版のPK列インデックスをHEAD版ヘッダーから解決する（pkColumnIndicesはcurrentHeader基準のため直接使えない）
        const headPkIndices: number[] = [];
        for (const currentIdx of pkColumnIndices) {
            if (currentIdx >= 0 && currentIdx < currentHeader.length) {
                const colName = currentHeader[currentIdx];
                if (headHeaderMap.has(colName)) {
                    headPkIndices.push(headHeaderMap.get(colName)!);
                } else {
                    headPkIndices.push(-1);
                }
            } else {
                headPkIndices.push(-1);
            }
        }
        const map = new Map<string, string[]>();
        for (const row of csv.body) {
            // PK値はHEAD版のインデックスで取得する
            const pk = GitDiffTracker.buildCompositeKey(row, headPkIndices);
            // HEAD行をcurrentHeader順に並べ替えて格納する
            const remapped = GitDiffTracker.remapRow(row, headHeaderMap, currentHeader);
            // PK重複は後勝ち（HEADデータの整合性はgitが保証する前提）
            map.set(pk, remapped);
        }
        return map;
    }

    /**
     * 行データとPK列インデックス配列から複合PKキー文字列を生成する
     * 単一PKの場合も同じロジックで処理できる（1要素配列のタブ区切り = 値そのもの）
     * idx < 0 は「列が見つからない」ケースなので空文字に落とす（idx >= 0 && idx < row.length で境界チェック）
     */
    public static buildCompositeKey(row: string[], pkColumnIndices: readonly number[]): string {
        return pkColumnIndices.map(idx => idx >= 0 && idx < row.length ? row[idx] : '').join('\t');
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
        const pk = GitDiffTracker.buildCompositeKey(currentRow, this.pkColumnIndices);
        // HEAD版に存在しないPK値 → 新規追加行 → changed
        if (!this.headRowMap.has(pk)) return true;
        const headRow = this.headRowMap.get(pk)!;
        const headValue = columnIndex < headRow.length ? headRow[columnIndex] : '';
        const currentValue = columnIndex < currentRow.length ? currentRow[columnIndex] : '';
        return headValue !== currentValue;
    }
}
