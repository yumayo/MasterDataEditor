import {Csv} from "./csv";

/**
 * gitのHEAD版CSVとの差分を追跡するクラス
 * テーブルオープン時にHEAD版CSVを取得し、PK値ベースで各セルの差分情報を保持する
 */
export class GitDiffTracker {
    /** HEAD版データ: PK値 → 行の値配列のMap */
    private readonly headRowMap: Map<string, string[]>;
    /** PK列のインデックス（0始まり） */
    private readonly pkColumnIndex: number;
    /** 全セルが changed かどうか（isNew: true のテーブル用） */
    private readonly allChanged: boolean;

    constructor(headRowMap: Map<string, string[]>, pkColumnIndex: number, allChanged: boolean) {
        this.headRowMap = headRowMap;
        this.pkColumnIndex = pkColumnIndex;
        this.allChanged = allChanged;
    }

    /**
     * isNew: true のテーブル用の GitDiffTracker を作成する（HEAD版が存在しない）
     * 全セルが changed として判定される
     */
    static createForNewTable(pkColumnIndex: number): GitDiffTracker {
        return new GitDiffTracker(new Map(), pkColumnIndex, true);
    }

    /**
     * HEAD版CSVテキストをパースして PK値 → 行データ Map を構築する
     * Csv クラスを使用することでストア側の load() と同じパース挙動を保証し、
     * 空白トリムの不整合による誤差分検出を防止する
     */
    static buildHeadRowMap(headCsvText: string, pkColumnIndex: number): Map<string, string[]> {
        const csv = new Csv();
        csv.load(headCsvText);
        const map = new Map<string, string[]>();
        for (const row of csv.body) {
            const pk = pkColumnIndex < row.length ? row[pkColumnIndex] : '';
            // PK重複は後勝ち（HEADデータの整合性はgitが保証する前提）
            map.set(pk, row);
        }
        return map;
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
        const pk = this.pkColumnIndex < currentRow.length ? currentRow[this.pkColumnIndex] : '';
        // HEAD版に存在しないPK値 → 新規追加行 → changed
        if (!this.headRowMap.has(pk)) return true;
        const headRow = this.headRowMap.get(pk)!;
        const headValue = columnIndex < headRow.length ? headRow[columnIndex] : '';
        const currentValue = columnIndex < currentRow.length ? currentRow[columnIndex] : '';
        return headValue !== currentValue;
    }
}
