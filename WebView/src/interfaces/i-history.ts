/**
 * History の最小インターフェース（循環参照を避けるため型だけ定義）
 * InMemoryTableStore / TableStore は History クラスをインポートせず、このインターフェースで参照する。
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
