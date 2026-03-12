import {createStore} from 'zustand/vanilla';
import {immer} from 'zustand/middleware/immer';
import {enableMapSet} from 'immer';
import {Csv} from '../csv';
import {readFileAsync} from '../api';
import type {IHistory} from '../interfaces/i-history';

// ImmerのMap/Setサポートを有効化する
enableMapSet();

/**
 * テーブルデータの状態定義
 *
 * InMemoryTableStore の全フィールドを Zustand state として管理する。
 * Map/Set を直接 state に持つため enableMapSet() が必須。
 */
interface TableStoreState {
    headers: Map<string, string[]>;
    rows: Map<string, string[][]>;
    refCounts: Map<string, number>;
    /** テーブル名ごとのHistory登録簿（Dirty管理の唯一の情報源） */
    historyRegistry: Map<string, Set<IHistory>>;
    /**
     * Historyが全て除去された後もDirty状態を保持するフラグセット。
     * unregisterTable でDirtyデータを保持する際に追加される。
     * markAllSaved(保存完了) または registerHistory(Historyへの引き継ぎ) で除去される。
     */
    dirtyTableNames: Set<string>;

    // === データ登録・解除 ===
    /** テーブル登録（テスト・外部データ注入用の同期API） */
    registerTable(tableName: string, header: string[], body: string[][]): void;
    /** テーブル登録（ファイルから読み込み、キャッシュ済みなら参照カウントのみ増やす） */
    registerTableAsync(tableName: string): Promise<Csv>;
    /**
     * テーブルデータをCSVから再読み込みする（refCountは維持）
     * 未保存タブクローズ後もミニEditorTableのrefCountにより残っているストアデータを
     * CSV原本に巻き戻すために使用する。
     */
    reloadTableDataAsync(tableName: string): Promise<void>;
    /** 参照カウント減少、0になったら削除（ただしDirtyデータは保持する） */
    unregisterTable(tableName: string): void;

    // === データ参照 ===
    /** 存在判定 */
    hasTable(tableName: string): boolean;
    /** header+bodyをCsvとして返す */
    getCsv(tableName: string): Csv | false;
    /** ヘッダー取得 */
    getHeader(tableName: string): string[] | false;
    /** 行データ取得 */
    getRows(tableName: string): string[][] | false;

    // === データ変更 ===
    /** セル更新（行インデックス＋列インデックスで対象セルを直接特定する）。行が見つかり更新した場合true、範囲外の場合false */
    updateCellValueByRowIndex(tableName: string, rowIndex: number, columnIndex: number, value: string): boolean;
    /** 全行置換 */
    replaceAllRows(tableName: string, newRows: string[][]): void;
    /** 行追加 */
    appendRow(tableName: string, values: string[]): void;
    /** 行削除（テーブル未登録・行インデックス範囲外の場合は何もしない） */
    removeRow(tableName: string, rowIndex: number): void;
    /** 指定インデックスに行を挿入する */
    insertRowAt(tableName: string, rowIndex: number, values: string[]): void;
    /** 指定インデックスに列を挿入する（headers + 全行の colIndex 位置に空文字列を追加） */
    insertColumnAt(tableName: string, colIndex: number, headerName: string): void;
    /** 指定インデックスの列を削除する（headers + 全行の colIndex 位置を削除） */
    removeColumn(tableName: string, colIndex: number): void;
    /** ヘッダー値を変更する */
    setHeaderValue(tableName: string, colIndex: number, value: string): void;
    /** 指定キー列の値で行をグループ化したMapを構築する */
    buildKeyMap(tableName: string, keyColumnName: string): Map<string, string[][]>;

    // === Dirty管理 ===
    /** テーブル名にHistoryを登録する（History生成時に呼ぶ） */
    registerHistory(tableName: string, history: IHistory): void;
    /** テーブル名からHistoryを登録解除する（History破棄時に呼ぶ） */
    unregisterHistory(tableName: string, history: IHistory): void;
    /** テーブルがdirtyかどうかを判定する */
    isTableDirty(tableName: string): boolean;
    /**
     * テーブルの全HistoryをmarkSaved状態にする（Ctrl+S保存後に呼ぶ）
     * N^2問題回避のため二相処理で実装する。
     */
    markAllSaved(tableName: string): void;
    /** テーブルに登録された全Historyを取得する（通知用） */
    getHistories(tableName: string): Set<IHistory> | false;
    /**
     * ストア全体を初期状態にリセットする（テスト用）
     * new InMemoryTableStore() のコンストラクタで呼ばれ、テスト間のデータ持ち越しを防ぐ。
     */
    _reset(): void;
}

/**
 * isTableDirty のロジックを draft state から直接判定するヘルパー
 *
 * set(draft => {...}) 内では get() を呼べないため、draft を直接受け取る形で実装する。
 * immer の draft は TableStoreState のサブセット（Map/Set フィールドのみ）を受け取る。
 */
function checkIsDirty(
    draft: { historyRegistry: Map<string, Set<IHistory>>; dirtyTableNames: Set<string> },
    tableName: string
): boolean {
    const historySet = draft.historyRegistry.get(tableName);
    if (historySet) {
        for (const history of historySet) {
            if (history.isDirty()) return true;
        }
        return false;
    }
    return draft.dirtyTableNames.has(tableName);
}

/**
 * テーブルデータの Zustand ストア
 *
 * InMemoryTableStore の全ロジックを Zustand + Immer で再実装したもの。
 * createStore（vanilla）を使用することで React コンポーネント外からも
 * useTableStore.getState() で呼び出し可能にする。
 *
 * 同期メソッド: set(draft => { ... }) 内で Immer の draft を直接ミューテーション
 * 非同期メソッド: Immer draft 外で get() / set() を使用（draft内でawait不可のため）
 */
export const useTableStore = createStore<TableStoreState>()(
    immer((set, get) => ({
        headers: new Map(),
        rows: new Map(),
        refCounts: new Map(),
        historyRegistry: new Map(),
        dirtyTableNames: new Set(),

        registerTable(tableName, header, body) {
            set(state => {
                if (state.refCounts.has(tableName)) {
                    // 既存テーブル: 参照カウントのみ増加、データは保持
                    state.refCounts.set(tableName, state.refCounts.get(tableName)! + 1);
                    return;
                }
                state.headers.set(tableName, header);
                state.rows.set(tableName, body);
                state.refCounts.set(tableName, 1);
            });
        },

        async registerTableAsync(tableName) {
            // 非同期メソッドは Immer draft 外で get/set を使用する
            const state = get();
            if (state.refCounts.has(tableName)) {
                // 通常パス: 参照カウントが残っている場合はカウントのみ増加してデータを保持する
                set(draft => {
                    draft.refCounts.set(tableName, draft.refCounts.get(tableName)! + 1);
                });
                return state.getCsv(tableName) as Csv;
            }
            if (state.headers.has(tableName)) {
                // Dirty保持パス: 参照カウントは0だがDirtyデータが残っている場合は再利用する
                // unregisterTable でDirty時に refCounts のみ削除してデータを保持したケースに対応する
                set(draft => {
                    draft.refCounts.set(tableName, 1);
                });
                return state.getCsv(tableName) as Csv;
            }
            const csvText = await readFileAsync('data/' + tableName + '.csv');
            const csv = new Csv();
            csv.load(csvText);
            // ファイル読み込み後に同期で registerTable を呼ぶ
            get().registerTable(tableName, csv.header, csv.body);
            return csv;
        },

        async reloadTableDataAsync(tableName) {
            if (!get().refCounts.has(tableName)) {
                throw new Error('[TableStore] reloadTableDataAsync: テーブル "' + tableName + '" は登録されていません');
            }
            const csvText = await readFileAsync('data/' + tableName + '.csv');
            const csv = new Csv();
            csv.load(csvText);
            set(draft => {
                draft.headers.set(tableName, csv.header);
                draft.rows.set(tableName, csv.body);
                // CSV巻き戻し後は補完Dirty状態をクリアする
                draft.dirtyTableNames.delete(tableName);
            });
        },

        unregisterTable(tableName) {
            set(draft => {
                if (!draft.refCounts.has(tableName)) {
                    throw new Error('[TableStore] unregisterTable: テーブル "' + tableName + '" は登録されていません');
                }
                const next = draft.refCounts.get(tableName)! - 1;
                if (next <= 0) {
                    // Dirty状態のテーブルはデータを保持して refCounts のみ削除する。
                    // registerTableAsync が呼ばれたときに headers.has() で検知して再利用する。
                    // dirtyTableNames にも記録し、全History除去後もDirty状態を引き継ぐ。
                    // Clean状態であれば従来通り全データを削除し、dirtyTableNames からも除去する。
                    // isTableDirty のロジックをインライン化（draft 内では get() を呼べないため）
                    const isDirty = checkIsDirty(draft, tableName);
                    if (isDirty) {
                        draft.refCounts.delete(tableName);
                        draft.dirtyTableNames.add(tableName);
                    } else {
                        draft.headers.delete(tableName);
                        draft.rows.delete(tableName);
                        draft.refCounts.delete(tableName);
                    }
                    return;
                }
                draft.refCounts.set(tableName, next);
            });
        },

        hasTable(tableName) {
            return get().headers.has(tableName);
        },

        getCsv(tableName) {
            const state = get();
            if (!state.headers.has(tableName)) return false;
            const csv = new Csv();
            csv.header = state.headers.get(tableName)!;
            csv.body = state.rows.get(tableName)!;
            return csv;
        },

        getHeader(tableName) {
            const state = get();
            if (!state.headers.has(tableName)) return false;
            return state.headers.get(tableName)!;
        },

        getRows(tableName) {
            const state = get();
            if (!state.rows.has(tableName)) return false;
            return state.rows.get(tableName)!;
        },

        updateCellValueByRowIndex(tableName, rowIndex, columnIndex, value) {
            const state = get();
            if (!state.rows.has(tableName)) return false;
            const tableRows = state.rows.get(tableName)!;
            if (rowIndex < 0 || rowIndex >= tableRows.length) return false;
            const row = tableRows[rowIndex];
            if (columnIndex < 0 || columnIndex >= row.length) return false;
            set(draft => {
                draft.rows.get(tableName)![rowIndex][columnIndex] = value;
            });
            return true;
        },

        replaceAllRows(tableName, newRows) {
            if (!get().rows.has(tableName)) return;
            set(draft => {
                draft.rows.set(tableName, newRows);
            });
        },

        appendRow(tableName, values) {
            if (!get().rows.has(tableName)) return;
            set(draft => {
                draft.rows.get(tableName)!.push(values);
            });
        },

        removeRow(tableName, rowIndex) {
            const tableRows = get().rows.get(tableName);
            if (!tableRows) return;
            if (rowIndex < 0 || rowIndex >= tableRows.length) return;
            set(draft => {
                draft.rows.get(tableName)!.splice(rowIndex, 1);
            });
        },

        insertRowAt(tableName, rowIndex, values) {
            if (!get().rows.has(tableName)) return;
            set(draft => {
                draft.rows.get(tableName)!.splice(rowIndex, 0, values);
            });
        },

        insertColumnAt(tableName, colIndex, headerName) {
            if (!get().rows.has(tableName)) return;
            set(draft => {
                draft.headers.get(tableName)!.splice(colIndex, 0, headerName);
                for (const row of draft.rows.get(tableName)!) {
                    row.splice(colIndex, 0, '');
                }
            });
        },

        removeColumn(tableName, colIndex) {
            if (!get().rows.has(tableName)) return;
            set(draft => {
                draft.headers.get(tableName)!.splice(colIndex, 1);
                for (const row of draft.rows.get(tableName)!) {
                    row.splice(colIndex, 1);
                }
            });
        },

        setHeaderValue(tableName, colIndex, value) {
            const state = get();
            if (!state.headers.has(tableName)) return;
            const header = state.headers.get(tableName)!;
            if (colIndex < 0 || colIndex >= header.length) return;
            set(draft => {
                draft.headers.get(tableName)![colIndex] = value;
            });
        },

        buildKeyMap(tableName, keyColumnName) {
            const result = new Map<string, string[][]>();
            const state = get();
            if (!state.headers.has(tableName)) return result;
            const header = state.headers.get(tableName)!;
            const keyColumnIndex = header.indexOf(keyColumnName);
            if (keyColumnIndex === -1) return result;
            const tableRows = state.rows.get(tableName)!;
            for (const row of tableRows) {
                const keyValue = row[keyColumnIndex];
                if (keyValue === '') continue;
                let group = result.get(keyValue);
                if (!group) { group = []; result.set(keyValue, group); }
                group.push(row);
            }
            return result;
        },

        registerHistory(tableName, history) {
            set(state => {
                let historySet = state.historyRegistry.get(tableName);
                if (!historySet) {
                    historySet = new Set<IHistory>();
                    state.historyRegistry.set(tableName, historySet);
                }
                historySet.add(history);
                // dirtyTableNames のDirty状態を History に引き継ぐ
                if (state.dirtyTableNames.has(tableName)) {
                    history.markInitiallyDirty();
                    state.dirtyTableNames.delete(tableName);
                }
            });
        },

        unregisterHistory(tableName, history) {
            set(state => {
                const historySet = state.historyRegistry.get(tableName);
                if (!historySet) {
                    throw new Error('[TableStore] unregisterHistory: テーブル "' + tableName + '" のHistoryレジストリが存在しません');
                }
                historySet.delete(history);
                if (historySet.size === 0) state.historyRegistry.delete(tableName);
            });
        },

        isTableDirty(tableName) {
            const state = get();
            const historySet = state.historyRegistry.get(tableName);
            if (historySet) {
                for (const history of historySet) {
                    if (history.isDirty()) return true;
                }
                return false;
            }
            // History 未登録の場合は dirtyTableNames で補完判定する
            return state.dirtyTableNames.has(tableName);
        },

        markAllSaved(tableName) {
            const state = get();
            const historySet = state.historyRegistry.get(tableName);
            if (!historySet) {
                throw new Error('[TableStore] markAllSaved: テーブル "' + tableName + '" のHistoryレジストリが存在しません');
            }
            // 補完Dirty状態をクリアする
            set(draft => {
                draft.dirtyTableNames.delete(tableName);
            });
            // フェーズ1: 全HistoryのsavedIndexを更新（通知なし）
            for (const history of historySet) {
                history.markSavedSilent();
            }
            // フェーズ2: 全Historyのタブボタンを一括更新（全てclean状態）
            for (const history of historySet) {
                history.setTabButtonDirty(false);
            }
        },

        getHistories(tableName) {
            const historySet = get().historyRegistry.get(tableName);
            if (!historySet) return false;
            return historySet;
        },

        _reset() {
            // テスト間のデータ持ち越しを防ぐため全stateを初期状態にクリアする
            set(draft => {
                draft.headers.clear();
                draft.rows.clear();
                draft.refCounts.clear();
                draft.historyRegistry.clear();
                draft.dirtyTableNames.clear();
            });
        },
    }))
);
