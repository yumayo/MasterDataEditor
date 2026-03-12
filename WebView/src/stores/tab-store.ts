import {createStore} from 'zustand/vanilla';
import {immer} from 'zustand/middleware/immer';
import {enableMapSet} from 'immer';
import type {ColumnSchema} from '../hooks/useEditorTableKeyboard';
import {readFileAsync} from '../api';
import {useTableStore} from './table-store';
import {useSelectionStore} from './selection-store';
import {useHistoryStore} from './history-store';
import {useReferenceStore} from './reference-store';
import {useReverseReferenceStore} from './reverse-reference-store';
import {parseReferenceExpression, isSimpleReference} from '../reference-expression';
import {config} from '../config';

// ImmerのMap/Setサポートを有効化する（table-store.ts で既に呼ばれているが冪等なので問題なし）
enableMapSet();

/**
 * 個別タブの状態定義
 */
interface TabState {
    tableName: string;
    /** dirty状態（未保存の編集あり） */
    isDirty: boolean;
}

/**
 * タブバー全体の状態定義
 *
 * 既存 tab.ts / tab-button.ts が管理するタブ一覧・アクティブ状態を
 * Zustand + Immer で管理する React 移行版。
 * createStore（vanilla）を使用することで React コンポーネント外からも
 * useTabStore.getState() で操作可能にする。
 */
interface TabStoreState {
    /** タブの表示順リスト（tableName の配列） */
    tabOrder: string[];
    /** タブ名→状態のマップ */
    tabStates: Map<string, TabState>;
    /** アクティブタブ名（タブなしの場合は空文字をセンチネル値として使用） */
    activeTabName: string;
    /** ドラッグ中のタブ名（ドラッグなしの場合は空文字をセンチネル値として使用） */
    draggingTabName: string;
    /** テーブル名→列スキーマのマップ */
    columnSchemaMap: Map<string, ColumnSchema[]>;
    /**
     * タブ読み込み完了後の保留ナビゲーション
     * null は「保留なし」を表すセンチネル値
     */
    pendingNavigation: {tableName: string; pkValue: string; columnIndex: number} | null;

    // === アクション ===
    /** タブを追加する（既に存在する場合は何もしない） */
    addTab(tableName: string): void;
    /** タブを削除する */
    removeTab(tableName: string): void;
    /** アクティブタブを切り替える */
    activateTab(tableName: string): void;
    /** タブのdirty状態を更新する */
    setTabDirty(tableName: string, isDirty: boolean): void;
    /** タブの順序を変更する（ドラッグ並び替え用） */
    reorderTab(fromIndex: number, toIndex: number): void;
    /** ドラッグ中のタブを設定する */
    setDraggingTab(tableName: string): void;
    /** ドラッグ終了（draggingTabName を空文字センチネルに戻す） */
    clearDraggingTab(): void;
    /**
     * 指定タブの次のタブ名を返す（タブを閉じるときの遷移先候補）。
     * 右隣が存在しない場合は null を返す。
     */
    findNextTab(tableName: string): string | null;
    /**
     * 指定タブの前のタブ名を返す（タブを閉じるときの遷移先候補）。
     * 左隣が存在しない場合は null を返す。
     */
    findPrevTab(tableName: string): string | null;
    /**
     * テーブルをファイルから読み込んでタブを開く。
     * 既にタブが存在する場合はアクティブにするだけ。
     */
    openTableAsync(tableName: string): Promise<void>;
    /**
     * タブを閉じる。
     * table-store の参照カウントを減らし、history-store の履歴を削除し、
     * アクティブだった場合は隣のタブへ遷移する。
     */
    closeTab(tableName: string): void;
    /**
     * PK値で行にナビゲーションする。
     * タブが開いていない場合は openTableAsync を呼び、完了後にナビゲーションする。
     */
    navigateToTableRow(tableName: string, pkValue: string): void;
    /**
     * PK値+列インデックスでセルにナビゲーションする。
     * タブが開いていない場合は openTableAsync を呼び、完了後にナビゲーションする。
     */
    navigateToTableCell(tableName: string, pkValue: string, columnIndex: number): void;
    /** 列スキーマを取得する（未登録の場合は空配列を返す） */
    getColumnSchemas(tableName: string): ColumnSchema[];
    /** テスト用: ストア全体を初期状態にリセットする */
    _reset(): void;
}

/**
 * PK値で行を検索してフォーカスを移動するモジュールレベルヘルパー。
 * columnIndex が -1 の場合は UI列1（データ列の先頭）にフォーカスする。
 */
function navigateToRowByPkValue(tableName: string, pkValue: string, columnIndex: number): void {
    const rows = useTableStore.getState().getRows(tableName);
    const header = useTableStore.getState().getHeader(tableName);
    if (rows === false || header === false) return;
    const pkColIndex = header.indexOf(config.primaryKeyColumnName);
    if (pkColIndex === -1) return;
    for (let r = 0; r < rows.length; r++) {
        if (rows[r][pkColIndex] !== pkValue) continue;
        // UI行インデックスはデータ行インデックス+1（ヘッダー行が1行目のため）
        const uiRow = r + 1;
        // columnIndex が -1 の場合はデータ列の先頭（UI列1）にフォーカス
        const uiCol = columnIndex === -1 ? 1 : columnIndex + 1;
        const range = {startRow: uiRow, startColumn: uiCol, endRow: uiRow, endColumn: uiCol};
        useSelectionStore.getState().select(range, {row: uiRow, column: uiCol});
        return;
    }
}

/**
 * タブ状態を管理する Zustand ストア（vanilla）
 *
 * table-store.ts / selection-store.ts と同じ createStore + immer パターンで実装する。
 * React コンポーネント内では `useStore(useTabStore, selector)` で購読し、
 * React 外部では `useTabStore.getState().addTab(...)` で直接操作する。
 */
export const useTabStore = createStore<TabStoreState>()(
    immer((set, get) => ({
        tabOrder: [],
        tabStates: new Map(),
        activeTabName: '',
        draggingTabName: '',
        columnSchemaMap: new Map(),
        pendingNavigation: null,

        addTab(tableName) {
            set(draft => {
                // 既に存在するタブは追加しない（冪等性を保つ）
                if (draft.tabStates.has(tableName)) return;
                draft.tabOrder.push(tableName);
                draft.tabStates.set(tableName, {tableName, isDirty: false});
            });
        },

        removeTab(tableName) {
            set(draft => {
                const index = draft.tabOrder.indexOf(tableName);
                if (index === -1) return;
                draft.tabOrder.splice(index, 1);
                draft.tabStates.delete(tableName);
            });
        },

        activateTab(tableName) {
            set(draft => {
                draft.activeTabName = tableName;
            });
        },

        setTabDirty(tableName, isDirty) {
            set(draft => {
                const tabState = draft.tabStates.get(tableName);
                if (!tabState) return;
                tabState.isDirty = isDirty;
            });
        },

        reorderTab(fromIndex, toIndex) {
            set(draft => {
                if (fromIndex < 0 || fromIndex >= draft.tabOrder.length) return;
                if (toIndex < 0 || toIndex >= draft.tabOrder.length) return;
                // splice で fromIndex の要素を取り出し、toIndex の位置に挿入する
                const [moved] = draft.tabOrder.splice(fromIndex, 1);
                draft.tabOrder.splice(toIndex, 0, moved);
            });
        },

        setDraggingTab(tableName) {
            set(draft => {
                draft.draggingTabName = tableName;
            });
        },

        clearDraggingTab() {
            set(draft => {
                // 空文字をセンチネル値として「ドラッグなし」を表す
                draft.draggingTabName = '';
            });
        },

        findNextTab(tableName) {
            const order = get().tabOrder;
            const index = order.indexOf(tableName);
            if (index === -1 || index >= order.length - 1) return null;
            return order[index + 1];
        },

        findPrevTab(tableName) {
            const order = get().tabOrder;
            const index = order.indexOf(tableName);
            if (index <= 0) return null;
            return order[index - 1];
        },

        async openTableAsync(tableName) {
            // 既にタブが存在する場合はアクティブにするだけ
            if (get().tabStates.has(tableName)) {
                get().activateTab(tableName);
                useSelectionStore.getState().setActiveTable(tableName);
                // 保留ナビゲーションがあれば消費する
                const pending = get().pendingNavigation;
                if (pending && pending.tableName === tableName) {
                    set(draft => { draft.pendingNavigation = null; });
                    navigateToRowByPkValue(tableName, pending.pkValue, pending.columnIndex);
                }
                return;
            }

            // スキーマJSON を読み込んで列スキーマを構築する
            const schemaText = await readFileAsync('schema/' + tableName + '.json');
            const schemaJson = JSON.parse(schemaText);
            // スキーマ形式: { header: [{ name: string, reference?: string, ... }] }
            const headerDefs: Array<{name: string; reference?: string}> = schemaJson.header || [];
            const columnSchemas: ColumnSchema[] = headerDefs.map(col => {
                const schema: ColumnSchema = {name: col.name};
                if (col.reference) schema.reference = col.reference;
                return schema;
            });

            // CSV を table-store に登録する
            await useTableStore.getState().registerTableAsync(tableName);

            // タブを追加してアクティブにする
            get().addTab(tableName);
            set(draft => { draft.columnSchemaMap.set(tableName, columnSchemas); });
            get().activateTab(tableName);

            // selection-store: アクティブテーブルを設定して A1 セルにフォーカス
            useSelectionStore.getState().setActiveTable(tableName);
            useSelectionStore.getState().select(
                {startRow: 1, startColumn: 1, endRow: 1, endColumn: 1},
                {row: 1, column: 1}
            );

            // history-store: テーブルの履歴を初期化する
            useHistoryStore.getState().initHistory(tableName);

            // reference-store: FK参照先テーブルを preload する
            const fkTableNames: string[] = [];
            for (const schema of columnSchemas) {
                if (!schema.reference) continue;
                const expr = parseReferenceExpression(schema.reference);
                if (isSimpleReference(expr)) fkTableNames.push(expr.tableName);
            }
            if (fkTableNames.length > 0) useReferenceStore.getState().preload(fkTableNames);

            // reverse-reference-store: 逆参照マップを非同期で構築する（完了を待たない）
            useReverseReferenceStore.getState().resolveAsync(tableName).catch(err => {
                console.error('[openTableAsync] 逆参照マップ構築失敗:', err);
            });

            // 保留ナビゲーションを消費する
            const pending = get().pendingNavigation;
            if (pending && pending.tableName === tableName) {
                set(draft => { draft.pendingNavigation = null; });
                navigateToRowByPkValue(tableName, pending.pkValue, pending.columnIndex);
            }
        },

        closeTab(tableName) {
            if (!get().tabStates.has(tableName)) return;

            const wasActive = get().activeTabName === tableName;

            // 次/前のタブを先に取得しておく（removeTab後は取得できなくなるため）
            const nextTab = get().findNextTab(tableName);
            const prevTab = get().findPrevTab(tableName);

            // タブを削除して列スキーマをクリアする
            get().removeTab(tableName);
            set(draft => { draft.columnSchemaMap.delete(tableName); });

            // table-store: 参照カウントを減らす（0になればデータ解放）
            useTableStore.getState().unregisterTable(tableName);

            // history-store: テーブルの履歴を削除する
            useHistoryStore.getState().removeHistory(tableName);

            // アクティブタブだった場合は隣のタブへ遷移する
            if (!wasActive) return;
            if (nextTab) {
                get().activateTab(nextTab);
                useSelectionStore.getState().setActiveTable(nextTab);
            } else if (prevTab) {
                get().activateTab(prevTab);
                useSelectionStore.getState().setActiveTable(prevTab);
            } else {
                // タブがなくなった場合は空文字センチネルを設定する
                set(draft => { draft.activeTabName = ''; });
                useSelectionStore.getState().setActiveTable('');
            }
        },

        navigateToTableRow(tableName, pkValue) {
            if (get().tabStates.has(tableName)) {
                // 既存タブをアクティブにしてナビゲーション
                get().activateTab(tableName);
                useSelectionStore.getState().setActiveTable(tableName);
                navigateToRowByPkValue(tableName, pkValue, -1);
                return;
            }
            // 保留ナビゲーションを設定してからタブを開く
            set(draft => { draft.pendingNavigation = {tableName, pkValue, columnIndex: -1}; });
            get().openTableAsync(tableName).catch(err => {
                console.error('[navigateToTableRow] タブオープン失敗:', err);
            });
        },

        navigateToTableCell(tableName, pkValue, columnIndex) {
            if (get().tabStates.has(tableName)) {
                get().activateTab(tableName);
                useSelectionStore.getState().setActiveTable(tableName);
                navigateToRowByPkValue(tableName, pkValue, columnIndex);
                return;
            }
            // 保留ナビゲーションを設定してからタブを開く
            set(draft => { draft.pendingNavigation = {tableName, pkValue, columnIndex}; });
            get().openTableAsync(tableName).catch(err => {
                console.error('[navigateToTableCell] タブオープン失敗:', err);
            });
        },

        getColumnSchemas(tableName) {
            const schemas = get().columnSchemaMap.get(tableName);
            return schemas !== undefined ? schemas : [];
        },

        _reset() {
            set(draft => {
                draft.tabOrder = [];
                draft.tabStates.clear();
                draft.activeTabName = '';
                draft.draggingTabName = '';
                draft.columnSchemaMap.clear();
                draft.pendingNavigation = null;
            });
        },
    }))
);
