import {Csv} from "./csv";
import {readFileAsync} from "./api";

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
    /** テーブルデータがCSVと異なることを示す初期Dirty状態を設定する（registerHistoryから呼ばれる） */
    markInitiallyDirty(): void;
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
 *
 * dirtyTableNames: historyRegistryから全Historyが除去された後も
 * Dirty状態を記憶する補完フィールド。ミニテーブルのHistory破棄後に
 * 同テーブルをタブで開いた際のDirty状態引き継ぎに使用する。
 */
export class InMemoryTableStore {
    private readonly headers: Map<string, string[]>;
    private readonly rows: Map<string, string[][]>;
    private readonly refCounts: Map<string, number>;
    /** テーブル名ごとのHistory登録簿（Dirty管理の唯一の情報源） */
    private readonly historyRegistry: Map<string, Set<IHistory>>;
    /**
     * Historyが全て除去された後もDirty状態を保持するフラグセット。
     * unregisterTable でDirtyデータを保持する際に追加される。
     * markAllSaved(保存完了) または registerHistory(Historyへの引き継ぎ) で除去される。
     */
    private readonly dirtyTableNames: Set<string>;

    constructor() {
        this.headers = new Map();
        this.rows = new Map();
        this.refCounts = new Map();
        this.historyRegistry = new Map();
        this.dirtyTableNames = new Set();
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
     * 以下のシナリオで使用する:
     * 1. 未保存タブクローズ後もミニEditorTableのrefCountにより残っているストアデータをCSV原本に巻き戻す
     * 2. 差分タブ保存後に通常テーブルのストアを最新CSVに更新する（タブ再オープン時に古いデータを表示しないため）
     *
     * refCountが0でもDirtyデータ保持パス（headers.hasがtrue）の場合は更新を許可する。
     * これにより差分タブ保存後の通常テーブルのストア更新でエラーが発生しない。
     * 巻き戻し後は補完Dirty状態もクリアする（CSVが正とする状態に戻るため）。
     */
    async reloadTableDataAsync(tableName: string): Promise<void> {
        if (!this.headers.has(tableName)) throw new Error('[InMemoryTableStore] reloadTableDataAsync: テーブル "' + tableName + '" はストアに存在しません');
        const csvText = await readFileAsync('data/' + tableName + '.csv');
        const csv = new Csv();
        csv.load(csvText);
        this.headers.set(tableName, csv.header);
        this.rows.set(tableName, csv.body);
        // CSV巻き戻し後は補完Dirty状態をクリアする
        this.dirtyTableNames.delete(tableName);
    }

    /** 参照カウント減少、0になったら削除（ただしDirtyデータは保持する） */
    unregisterTable(tableName: string): void {
        if (!this.refCounts.has(tableName)) throw new Error('[InMemoryTableStore] unregisterTable: テーブル "' + tableName + '" は登録されていません');
        const next = this.refCounts.get(tableName)! - 1;
        if (next <= 0) {
            // Dirty状態のテーブルはデータを保持して refCounts のみ削除する。
            // registerTableAsync が呼ばれたときに headers.has() で検知して再利用する。
            // dirtyTableNames にも記録し、全History除去後もDirty状態を引き継ぐ。
            // Clean状態であれば従来通り全データを削除し、dirtyTableNames からも除去する。
            if (this.isTableDirty(tableName)) {
                this.refCounts.delete(tableName);
                this.dirtyTableNames.add(tableName);
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

    /** ストアに登録されている全テーブル名を返す */
    getTableNames(): string[] {
        return [...this.headers.keys()];
    }

    /** header+bodyをCsvとして返す */
    getCsv(tableName: string): Csv | false {
        if (!this.headers.has(tableName)) return false;
        const csv = new Csv();
        csv.header = this.headers.get(tableName)!;
        csv.body = this.rows.get(tableName)!;
        return csv;
    }

    /**
     * 指定ストア行インデックスを除外したCsvを返す
     * 差分タブの右ペイン保存時に、パディング行（deleted行に対応する空行）を除外するために使用する。
     * excludeStoreRowIndices はソート済みを前提としない（Set で検索する）。
     */
    getCsvWithoutRows(tableName: string, excludeStoreRowIndices: readonly number[]): Csv | false {
        if (!this.headers.has(tableName)) return false;
        const excludeSet = new Set(excludeStoreRowIndices);
        const csv = new Csv();
        // 内部配列への参照漏洩を防ぐためスプレッドコピーする
        csv.header = [...this.headers.get(tableName)!];
        csv.body = this.rows.get(tableName)!.filter((_, i) => !excludeSet.has(i));
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

    /** 指定インデックスに列を挿入する */
    insertColumnAt(tableName: string, columnIndex: number, columnName: string, valueFactory: () => string): void {
        if (!this.headers.has(tableName) || !this.rows.has(tableName)) return;
        const header = this.headers.get(tableName)!;
        const rows = this.rows.get(tableName)!;
        header.splice(columnIndex, 0, columnName);
        for (const row of rows) {
            row.splice(columnIndex, 0, valueFactory());
        }
    }

    /** 指定インデックスの列を削除する */
    removeColumnAt(tableName: string, columnIndex: number): void {
        if (!this.headers.has(tableName) || !this.rows.has(tableName)) return;
        const header = this.headers.get(tableName)!;
        const rows = this.rows.get(tableName)!;
        if (columnIndex < 0 || columnIndex >= header.length) return;
        header.splice(columnIndex, 1);
        for (const row of rows) {
            if (columnIndex < row.length) row.splice(columnIndex, 1);
        }
    }

    /** 指定インデックスの列名を更新する */
    renameColumn(tableName: string, columnIndex: number, columnName: string): void {
        if (!this.headers.has(tableName)) return;
        const header = this.headers.get(tableName)!;
        if (columnIndex < 0 || columnIndex >= header.length) return;
        header[columnIndex] = columnName;
    }

    /** 行削除（テーブル未登録・行インデックス範囲外の場合は何もしない） */
    removeRow(tableName: string, rowIndex: number): void {
        if (!this.rows.has(tableName)) return;
        const tableRows = this.rows.get(tableName)!;
        if (rowIndex < 0 || rowIndex >= tableRows.length) return;
        tableRows.splice(rowIndex, 1);
    }

    /** 指定インデックスに行を挿入する */
    insertRowAt(tableName: string, rowIndex: number, values: string[]): void {
        if (!this.rows.has(tableName)) return;
        const tableRows = this.rows.get(tableName)!;
        tableRows.splice(rowIndex, 0, values);
    }

    /** 行を移動する（fromIndex の行を取り出して toIndex に挿入する） */
    moveRow(tableName: string, fromIndex: number, toIndex: number): void {
        if (!this.rows.has(tableName)) return;
        const tableRows = this.rows.get(tableName)!;
        if (fromIndex < 0 || fromIndex >= tableRows.length) return;
        // splice で取り出して挿入先に再挿入する
        const [row] = tableRows.splice(fromIndex, 1);
        // fromIndex の行を抜いた後のインデックスに挿入する
        // toIndex が fromIndex より大きい場合、splice で1行減っているため toIndex はそのまま正しい
        // （呼び出し元が「移動後の挿入位置」を渡す前提）
        tableRows.splice(toIndex, 0, row);
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
     * 同テーブルの複数Historyを追跡して、いずれかがdirtyならテーブルもdirtyと判定する。
     * dirtyTableNames にDirty状態が残っている場合は History に引き継いで dirtyTableNames から除去する。
     * これにより Undo による Clean 復帰が可能になる（History ベースの判定に統一される）。
     */
    registerHistory(tableName: string, history: IHistory): void {
        let set = this.historyRegistry.get(tableName);
        if (!set) {
            set = new Set<IHistory>();
            this.historyRegistry.set(tableName, set);
        }
        set.add(history);
        // dirtyTableNames のDirty状態を History に引き継ぐ
        if (this.dirtyTableNames.has(tableName)) {
            history.markInitiallyDirty();
            this.dirtyTableNames.delete(tableName);
        }
    }

    /**
     * テーブル名からHistoryを登録解除する（History破棄時に呼ぶ）
     * 破棄されるHistoryがdirtyの場合は dirtyTableNames に記録して状態を保全する。
     * これにより、ミニテーブル破棄後にタブで同テーブルを開いた際、
     * registerHistory → markInitiallyDirty で新Historyに dirty 状態が引き継がれる。
     */
    unregisterHistory(tableName: string, history: IHistory): void {
        const set = this.historyRegistry.get(tableName);
        if (!set) throw new Error('[InMemoryTableStore] unregisterHistory: テーブル "' + tableName + '" のHistoryレジストリが存在しません');
        const wasDirty = history.isDirty();
        set.delete(history);
        if (set.size === 0) this.historyRegistry.delete(tableName);
        // dirty なHistoryが破棄された場合、他にdirty Historyが残っていなければ dirtyTableNames に記録する
        if (wasDirty && !this.isTableDirty(tableName)) {
            this.dirtyTableNames.add(tableName);
        }
    }

    /**
     * テーブルがdirtyかどうかを判定する
     * Historyが登録されている場合はHistory群のisDirty()を優先判定とする（Undoで Clean 復帰が可能）。
     * Historyが未登録の場合は dirtyTableNames で補完判定する
     * （ミニテーブルのHistory破棄後・タブで開く前の中間状態を正しく扱うため）。
     */
    isTableDirty(tableName: string): boolean {
        const set = this.historyRegistry.get(tableName);
        if (set) {
            for (const history of set) {
                if (history.isDirty()) return true;
            }
            return false;
        }
        // History 未登録の場合は dirtyTableNames で補完判定する
        return this.dirtyTableNames.has(tableName);
    }

    /**
     * テーブルの全HistoryをmarkSaved状態にする（Ctrl+S保存後に呼ぶ）
     *
     * N^2問題回避のため二相処理で実装する。
     * フェーズ1: 全HistoryのsavedIndexを更新（notifyChange なし）
     * フェーズ2: 全Historyのタブボタンを一括更新（全てclean状態で通知）
     * これにより途中の中間通知で誤ったDirty表示が発生しない。
     * dirtyTableNames からも除去して補完Dirty状態をクリアする。
     */
    markAllSaved(tableName: string): void {
        const set = this.historyRegistry.get(tableName);
        if (!set) throw new Error('[InMemoryTableStore.markAllSaved] テーブル "' + tableName + '" のHistoryレジストリが存在しません');
        // 補完Dirty状態をクリアする
        this.dirtyTableNames.delete(tableName);
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
