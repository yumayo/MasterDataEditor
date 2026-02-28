import {Csv} from "./csv";

/**
 * テーブルデータの中央ストア
 *
 * 参照カウント方式でテーブルの登録・解除を管理し、
 * セル更新・行操作などのデータ変更APIを提供する。
 * resolveInMemoryCsvの3段階検索ロジックを置き換える。
 */
export class InMemoryTableStore {
    private readonly headers: Map<string, string[]>;
    private readonly rows: Map<string, string[][]>;
    private readonly refCounts: Map<string, number>;

    constructor() {
        this.headers = new Map();
        this.rows = new Map();
        this.refCounts = new Map();
    }

    /** テーブル登録（refCount++、既存なら参照カウントのみ増やす） */
    registerTable(tableName: string, header: string[], body: string[][]): void {
        if (this.refCounts.has(tableName)) {
            // 既存テーブル: 参照カウントのみ増加、データは保持
            this.refCounts.set(tableName, this.refCounts.get(tableName)! + 1);
            return;
        }
        this.headers.set(tableName, header);
        this.rows.set(tableName, body);
        this.refCounts.set(tableName, 1);
    }

    /** 参照カウント減少、0になったら削除 */
    unregisterTable(tableName: string): void {
        if (!this.refCounts.has(tableName)) return;
        const next = this.refCounts.get(tableName)! - 1;
        if (next <= 0) {
            // 参照カウントが0になったら全データ削除
            this.headers.delete(tableName);
            this.rows.delete(tableName);
            this.refCounts.delete(tableName);
            return;
        }
        this.refCounts.set(tableName, next);
    }

    /** 存在判定 */
    hasTable(tableName: string): boolean {
        return this.headers.has(tableName);
    }

    /** header+bodyをCsvとして返す */
    getCsv(tableName: string): Csv | false {
        if (!this.headers.has(tableName)) return false;
        const csv = new Csv();
        csv.header = this.headers.get(tableName)!;
        csv.body = this.rows.get(tableName)!;
        return csv;
    }

    /** ヘッダー取得 */
    getHeader(tableName: string): string[] | false {
        if (!this.headers.has(tableName)) return false;
        return this.headers.get(tableName)!;
    }

    /** 行データ取得 */
    getRows(tableName: string): string[][] | false {
        if (!this.rows.has(tableName)) return false;
        return this.rows.get(tableName)!;
    }

    /** セル更新（テーブル未登録・行インデックス範囲外の場合は何もしない） */
    updateCellValue(tableName: string, rowIndex: number, columnIndex: number, value: string): void {
        if (!this.rows.has(tableName)) return;
        const tableRows = this.rows.get(tableName)!;
        if (rowIndex < 0 || rowIndex >= tableRows.length) return;
        tableRows[rowIndex][columnIndex] = value;
    }

    /** 全行置換 */
    replaceAllRows(tableName: string, newRows: string[][]): void {
        if (!this.rows.has(tableName)) return;
        this.rows.set(tableName, newRows);
    }

    /** 行追加 */
    appendRow(tableName: string, values: string[]): void {
        if (!this.rows.has(tableName)) return;
        this.rows.get(tableName)!.push(values);
    }

    /** 行削除（テーブル未登録・行インデックス範囲外の場合は何もしない） */
    removeRow(tableName: string, rowIndex: number): void {
        if (!this.rows.has(tableName)) return;
        const tableRows = this.rows.get(tableName)!;
        if (rowIndex < 0 || rowIndex >= tableRows.length) return;
        tableRows.splice(rowIndex, 1);
    }
}
