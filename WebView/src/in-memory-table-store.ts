import {Csv} from "./csv";
import {useTableStore} from "./stores/table-store";
import type {IHistory} from "./interfaces/i-history";

// IHistory の定義は interfaces/i-history.ts に移動した。
// 既存コードの import パスを壊さないよう re-export する。
export type {IHistory} from "./interfaces/i-history";

/**
 * テーブルデータの中央ストア（Zustand ストアへの委譲アダプター）
 *
 * 外部 API は一切変更しない。既存の Vanilla コードは new InMemoryTableStore() で
 * このクラスを使い続ける。内部実装は全て Zustand ストア（useTableStore）に委譲する。
 *
 * useTableStore.getState() は React コンポーネント外からも呼び出し可能なため、
 * このアダプターパターンが成立する。
 */
export class InMemoryTableStore {
    constructor() {
        // Zustand ストアはシングルトンのため、新しいインスタンス生成時にリセットして
        // テスト間のデータ持ち越しを防ぐ。本番では main.tsx で1回だけ呼ばれるため問題なし。
        useTableStore.getState()._reset();
    }

    /** テーブル登録（テスト・外部データ注入用の同期API） */
    registerTable(tableName: string, header: string[], body: string[][]): void {
        useTableStore.getState().registerTable(tableName, header, body);
    }

    /** テーブル登録（ファイルから読み込み、キャッシュ済みなら参照カウントのみ増やす） */
    async registerTableAsync(tableName: string): Promise<Csv> {
        return useTableStore.getState().registerTableAsync(tableName);
    }

    /**
     * テーブルデータをCSVから再読み込みする（refCountは維持）
     * 未保存タブクローズ後もミニEditorTableのrefCountにより残っているストアデータを
     * CSV原本に巻き戻すために使用する。
     * 巻き戻し後は補完Dirty状態もクリアする（CSVが正とする状態に戻るため）。
     */
    async reloadTableDataAsync(tableName: string): Promise<void> {
        return useTableStore.getState().reloadTableDataAsync(tableName);
    }

    /** 参照カウント減少、0になったら削除（ただしDirtyデータは保持する） */
    unregisterTable(tableName: string): void {
        useTableStore.getState().unregisterTable(tableName);
    }

    /** 存在判定 */
    hasTable(tableName: string): boolean {
        return useTableStore.getState().hasTable(tableName);
    }

    /** header+bodyをCsvとして返す */
    getCsv(tableName: string): Csv | false {
        return useTableStore.getState().getCsv(tableName);
    }

    /** ヘッダー取得 */
    getHeader(tableName: string): string[] | false {
        return useTableStore.getState().getHeader(tableName);
    }

    /** 行データ取得 */
    getRows(tableName: string): string[][] | false {
        return useTableStore.getState().getRows(tableName);
    }

    /** セル更新（行インデックス＋列インデックスで対象セルを直接特定する）。行が見つかり更新した場合true、範囲外の場合false */
    updateCellValueByRowIndex(tableName: string, rowIndex: number, columnIndex: number, value: string): boolean {
        return useTableStore.getState().updateCellValueByRowIndex(tableName, rowIndex, columnIndex, value);
    }

    /** 全行置換 */
    replaceAllRows(tableName: string, newRows: string[][]): void {
        useTableStore.getState().replaceAllRows(tableName, newRows);
    }

    /** 行追加 */
    appendRow(tableName: string, values: string[]): void {
        useTableStore.getState().appendRow(tableName, values);
    }

    /** 行削除（テーブル未登録・行インデックス範囲外の場合は何もしない） */
    removeRow(tableName: string, rowIndex: number): void {
        useTableStore.getState().removeRow(tableName, rowIndex);
    }

    /** 指定インデックスに行を挿入する */
    insertRowAt(tableName: string, rowIndex: number, values: string[]): void {
        useTableStore.getState().insertRowAt(tableName, rowIndex, values);
    }

    /** 指定キー列の値で行をグループ化したMapを構築する */
    buildKeyMap(tableName: string, keyColumnName: string): Map<string, string[][]> {
        return useTableStore.getState().buildKeyMap(tableName, keyColumnName);
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
        useTableStore.getState().registerHistory(tableName, history);
    }

    /**
     * テーブル名からHistoryを登録解除する（History破棄時に呼ぶ）
     */
    unregisterHistory(tableName: string, history: IHistory): void {
        useTableStore.getState().unregisterHistory(tableName, history);
    }

    /**
     * テーブルがdirtyかどうかを判定する
     * Historyが登録されている場合はHistory群のisDirty()を優先判定とする（Undoで Clean 復帰が可能）。
     * Historyが未登録の場合は dirtyTableNames で補完判定する
     * （ミニテーブルのHistory破棄後・タブで開く前の中間状態を正しく扱うため）。
     */
    isTableDirty(tableName: string): boolean {
        return useTableStore.getState().isTableDirty(tableName);
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
        useTableStore.getState().markAllSaved(tableName);
    }

    /**
     * テーブルに登録された全Historyを取得する（通知用）
     * 登録がない場合はfalseを返す
     */
    getHistories(tableName: string): Set<IHistory> | false {
        return useTableStore.getState().getHistories(tableName);
    }
}
