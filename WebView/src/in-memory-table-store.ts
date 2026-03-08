import {Csv} from "./csv";
import {readFileAsync} from "./api";
import {config} from "./config";

/**
 * History の最小インターフェース（循環参照を避けるため型だけ定義）
 * InMemoryTableStore は History クラスをインポートせず、このインターフェースで参照する。
 */
export interface IHistory {
    isDirty(): boolean;
    markSaved(): void;
    /** savedIndexを更新するが通知は発火しない（markAllSavedの二相処理フェーズ1用） */
    markSavedSilent(): void;
    /** タブボタンのDirty状態を更新する（ストアからの一括通知用） */
    setTabButtonDirty(isDirty: boolean): void;
}

/**
 * テーブルデータの中央ストア
 *
 * 参照カウント方式でテーブルの登録・解除を管理し、
 * セル更新・行操作などのデータ変更APIを提供する。
 * resolveInMemoryCsvの3段階検索ロジックを置き換える。
 *
 * Dirty管理: テーブル名ごとに登録されたHistory群を追跡し、
 * いずれかのHistoryがdirtyならテーブルもdirtyと判定する。
 * これにより左ペイン・右ペインの複数箇所から同じテーブルを
 * 編集した場合も唯一の情報源としてDirty状態を管理できる。
 */
export class InMemoryTableStore {
    private readonly headers: Map<string, string[]>;
    private readonly rows: Map<string, string[][]>;
    private readonly refCounts: Map<string, number>;
    /** テーブル名ごとのHistory登録簿（Dirty管理の唯一の情報源） */
    private readonly historyRegistry: Map<string, Set<IHistory>>;

    constructor() {
        this.headers = new Map();
        this.rows = new Map();
        this.refCounts = new Map();
        this.historyRegistry = new Map();
    }

    /** テーブル登録（テスト・外部データ注入用の同期API） */
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

    /** テーブル登録（ファイルから読み込み、キャッシュ済みなら参照カウントのみ増やす） */
    async registerTableAsync(tableName: string): Promise<Csv> {
        if (this.refCounts.has(tableName)) {
            // 通常パス: 参照カウントが残っている場合はカウントのみ増加してデータを保持する
            this.refCounts.set(tableName, this.refCounts.get(tableName)! + 1);
            return this.getCsv(tableName) as Csv;
        }
        if (this.headers.has(tableName)) {
            // Dirty保持パス: 参照カウントは0だがDirtyデータが残っている場合は再利用する
            // unregisterTable でDirty時に refCounts のみ削除してデータを保持したケースに対応する
            this.refCounts.set(tableName, 1);
            return this.getCsv(tableName) as Csv;
        }
        const csvText = await readFileAsync('data/' + tableName + '.csv');
        const csv = new Csv();
        csv.load(csvText);
        this.registerTable(tableName, csv.header, csv.body);
        return csv;
    }

    /**
     * テーブルデータをCSVから再読み込みする（refCountは維持）
     * 未保存タブクローズ後もミニEditorTableのrefCountにより残っているストアデータを
     * CSV原本に巻き戻すために使用する
     */
    async reloadTableDataAsync(tableName: string): Promise<void> {
        if (!this.refCounts.has(tableName)) throw new Error('[InMemoryTableStore] reloadTableDataAsync: テーブル "' + tableName + '" は登録されていません');
        const csvText = await readFileAsync('data/' + tableName + '.csv');
        const csv = new Csv();
        csv.load(csvText);
        this.headers.set(tableName, csv.header);
        this.rows.set(tableName, csv.body);
    }

    /** 参照カウント減少、0になったら削除（ただしDirtyデータは保持する） */
    unregisterTable(tableName: string): void {
        if (!this.refCounts.has(tableName)) throw new Error('[InMemoryTableStore] unregisterTable: テーブル "' + tableName + '" は登録されていません');
        const next = this.refCounts.get(tableName)! - 1;
        if (next <= 0) {
            // Dirty状態のテーブルはデータを保持して refCounts のみ削除する。
            // registerTableAsync が呼ばれたときに headers.has() で検知して再利用する。
            // Clean状態であれば従来通り全データを削除する。
            if (this.isTableDirty(tableName)) {
                this.refCounts.delete(tableName);
            } else {
                this.headers.delete(tableName);
                this.rows.delete(tableName);
                this.refCounts.delete(tableName);
            }
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

    /** セル更新（主キー値＋列名で対象セルを特定する）。行が見つかり更新した場合true、未発見の場合false */
    updateCellValue(tableName: string, pkValue: string, columnName: string, value: string): boolean {
        if (!this.rows.has(tableName)) return false;
        const header = this.headers.get(tableName)!;
        const columnIndex = header.indexOf(columnName);
        if (columnIndex === -1) return false;
        const pkColumnIndex = header.indexOf(config.primaryKeyColumnName);
        if (pkColumnIndex === -1) return false;
        const tableRows = this.rows.get(tableName)!;
        for (let i = 0; i < tableRows.length; i++) {
            if (tableRows[i][pkColumnIndex] === pkValue) {
                tableRows[i][columnIndex] = value;
                return true;
            }
        }
        return false;
    }

    /** セル更新（行インデックス＋列インデックスで対象セルを直接特定する）。行が見つかり更新した場合true、範囲外の場合false */
    updateCellValueByRowIndex(tableName: string, rowIndex: number, columnIndex: number, value: string): boolean {
        if (!this.rows.has(tableName)) return false;
        const tableRows = this.rows.get(tableName)!;
        if (rowIndex < 0 || rowIndex >= tableRows.length) return false;
        const row = tableRows[rowIndex];
        if (columnIndex < 0 || columnIndex >= row.length) return false;
        row[columnIndex] = value;
        return true;
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

    /** 主キー値で行を削除し、削除された行データと元のインデックスを返す */
    removeRowByPk(tableName: string, pkValue: string): { rowData: string[]; rowIndex: number } | false {
        if (!this.rows.has(tableName)) return false;
        const header = this.headers.get(tableName)!;
        const pkColumnIndex = header.indexOf(config.primaryKeyColumnName);
        if (pkColumnIndex === -1) return false;
        const tableRows = this.rows.get(tableName)!;
        for (let i = 0; i < tableRows.length; i++) {
            if (tableRows[i][pkColumnIndex] === pkValue) {
                const rowData = tableRows.splice(i, 1)[0];
                return { rowData, rowIndex: i };
            }
        }
        return false;
    }

    /** 指定インデックスに行を挿入する */
    insertRowAt(tableName: string, rowIndex: number, values: string[]): void {
        if (!this.rows.has(tableName)) return;
        const tableRows = this.rows.get(tableName)!;
        tableRows.splice(rowIndex, 0, values);
    }

    /** 指定キー列の値で行をグループ化したMapを構築する */
    buildKeyMap(tableName: string, keyColumnName: string): Map<string, string[][]> {
        const result = new Map<string, string[][]>();
        if (!this.headers.has(tableName)) return result;
        const header = this.headers.get(tableName)!;
        const keyColumnIndex = header.indexOf(keyColumnName);
        if (keyColumnIndex === -1) return result;
        const tableRows = this.rows.get(tableName)!;
        for (const row of tableRows) {
            const keyValue = row[keyColumnIndex];
            if (keyValue === '') continue;
            let group = result.get(keyValue);
            if (!group) { group = []; result.set(keyValue, group); }
            group.push(row);
        }
        return result;
    }

    // =========================================================================
    // Dirty管理
    // =========================================================================

    /**
     * テーブル名にHistoryを登録する（History生成時に呼ぶ）
     * 同テーブルの複数Historyを追跡して、いずれかがdirtyならテーブルもdirtyと判定する
     */
    registerHistory(tableName: string, history: IHistory): void {
        let set = this.historyRegistry.get(tableName);
        if (!set) {
            set = new Set<IHistory>();
            this.historyRegistry.set(tableName, set);
        }
        set.add(history);
    }

    /**
     * テーブル名からHistoryを登録解除する（History破棄時に呼ぶ）
     */
    unregisterHistory(tableName: string, history: IHistory): void {
        const set = this.historyRegistry.get(tableName);
        if (!set) throw new Error('[InMemoryTableStore] unregisterHistory: テーブル "' + tableName + '" のHistoryレジストリが存在しません');
        set.delete(history);
        if (set.size === 0) this.historyRegistry.delete(tableName);
    }

    /**
     * テーブルがdirtyかどうかを判定する
     * 登録されたHistoryのいずれかがisDirty()を返せばtrueとなる
     */
    isTableDirty(tableName: string): boolean {
        const set = this.historyRegistry.get(tableName);
        if (!set) return false;
        for (const history of set) {
            if (history.isDirty()) return true;
        }
        return false;
    }

    /**
     * テーブルの全HistoryをmarkSaved状態にする（Ctrl+S保存後に呼ぶ）
     *
     * N^2問題回避のため二相処理で実装する。
     * フェーズ1: 全HistoryのsavedIndexを更新（notifyChange なし）
     * フェーズ2: 全Historyのタブボタンを一括更新（全てclean状態で通知）
     * これにより途中の中間通知で誤ったDirty表示が発生しない。
     */
    markAllSaved(tableName: string): void {
        const set = this.historyRegistry.get(tableName);
        if (!set) throw new Error('[InMemoryTableStore.markAllSaved] テーブル "' + tableName + '" のHistoryレジストリが存在しません');
        // フェーズ1: 全HistoryのsavedIndexを更新（通知なし）
        for (const history of set) {
            history.markSavedSilent();
        }
        // フェーズ2: 全Historyのタブボタンを一括更新（全てclean状態）
        for (const history of set) {
            history.setTabButtonDirty(false);
        }
    }

    /**
     * テーブルに登録された全Historyを取得する（通知用）
     * 登録がない場合はfalseを返す
     */
    getHistories(tableName: string): Set<IHistory> | false {
        const set = this.historyRegistry.get(tableName);
        if (!set) return false;
        return set;
    }
}
