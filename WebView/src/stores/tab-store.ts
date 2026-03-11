import {createStore} from 'zustand/vanilla';
import {immer} from 'zustand/middleware/immer';
import {enableMapSet} from 'immer';

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
    /** テスト用: ストア全体を初期状態にリセットする */
    _reset(): void;
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

        _reset() {
            set(draft => {
                draft.tabOrder = [];
                draft.tabStates.clear();
                draft.activeTabName = '';
                draft.draggingTabName = '';
            });
        },
    }))
);
