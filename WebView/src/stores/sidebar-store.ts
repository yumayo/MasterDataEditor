import {createStore} from 'zustand/vanilla';
import {immer} from 'zustand/middleware/immer';

/**
 * サイドバーのアクティブパネル種別
 */
export type SidebarPanel = 'files' | 'references' | 'search';

/**
 * Sidebar状態の定義
 */
interface SidebarStoreState {
    /** 現在アクティブなパネル */
    activePanel: SidebarPanel;
    /** サイドバー幅(px) */
    sidebarWidth: number;
    /** Explorerに表示するファイル名リスト */
    fileNames: string[];
    /** 検索パネルの入力テキスト */
    searchText: string;
    /** 大文字小文字を区別するか */
    caseSensitive: boolean;
    /** 単語単位で検索するか */
    wholeWord: boolean;
    /** 正規表現を使用するか */
    useRegex: boolean;

    // アクション
    setActivePanel(panel: SidebarPanel): void;
    setSidebarWidth(width: number): void;
    addFileName(name: string): void;
    setSearchText(text: string): void;
    toggleCaseSensitive(): void;
    toggleWholeWord(): void;
    toggleUseRegex(): void;
    /** テスト用: ストア全体を初期状態にリセットする */
    _reset(): void;
}

/**
 * Sidebar状態を管理するZustandストア（vanilla）
 *
 * table-store.ts / selection-store.ts と同じ createStore + immer パターンで実装する。
 * React コンポーネント内では `useStore(useSidebarStore, selector)` で購読し、
 * React 外部では `useSidebarStore.getState().setActivePanel(...)` で直接操作する。
 */
export const useSidebarStore = createStore<SidebarStoreState>()(
    immer((set) => ({
        activePanel: 'files',
        sidebarWidth: 300,
        fileNames: [],
        searchText: '',
        caseSensitive: false,
        wholeWord: false,
        useRegex: false,

        setActivePanel(panel) {
            set(draft => {
                draft.activePanel = panel;
            });
        },

        setSidebarWidth(width) {
            set(draft => {
                draft.sidebarWidth = width;
            });
        },

        addFileName(name) {
            set(draft => {
                draft.fileNames.push(name);
            });
        },

        setSearchText(text) {
            set(draft => {
                draft.searchText = text;
            });
        },

        toggleCaseSensitive() {
            set(draft => {
                draft.caseSensitive = !draft.caseSensitive;
            });
        },

        toggleWholeWord() {
            set(draft => {
                draft.wholeWord = !draft.wholeWord;
            });
        },

        toggleUseRegex() {
            set(draft => {
                draft.useRegex = !draft.useRegex;
            });
        },

        _reset() {
            set(draft => {
                draft.activePanel = 'files';
                draft.sidebarWidth = 300;
                draft.fileNames = [];
                draft.searchText = '';
                draft.caseSensitive = false;
                draft.wholeWord = false;
                draft.useRegex = false;
            });
        },
    }))
);
