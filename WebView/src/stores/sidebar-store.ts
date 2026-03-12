import {createStore} from 'zustand/vanilla';
import {immer} from 'zustand/middleware/immer';
import {findFilesAsync, readFileAsync} from '../api';
import {Csv} from '../csv';
import {config} from '../config';
import {parseSearchQuery, matchesQuery} from '../search-query';
import {useTableStore} from './table-store';

/**
 * サイドバーのアクティブパネル種別
 */
export type SidebarPanel = 'files' | 'references' | 'search';

/**
 * 検索結果1件分
 */
export interface SearchResult {
    tableName: string;
    columnName: string;
    columnIndex: number;
    pkValue: string;
    value: string;
}

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
    /** 検索結果リスト */
    searchResults: SearchResult[];
    /** 検索実行中フラグ */
    isSearching: boolean;

    // アクション
    setActivePanel(panel: SidebarPanel): void;
    setSidebarWidth(width: number): void;
    addFileName(name: string): void;
    /** ファイル名リストを直接設定する（テスト用にも有用） */
    setFileNames(names: string[]): void;
    /** スキーマファイル一覧を取得してfileNamesに設定する */
    loadFileNamesAsync(): Promise<void>;
    setSearchText(text: string): void;
    toggleCaseSensitive(): void;
    toggleWholeWord(): void;
    toggleUseRegex(): void;
    /** searchText + オプションから全テーブル横断検索を実行する */
    executeSearchAsync(): Promise<void>;
    /** テスト用: ストア全体を初期状態にリセットする */
    _reset(): void;
}

/**
 * スキーマファイル名（.json拡張子含む）からテーブル名を取り出すヘルパー
 */
function extractTableName(fileName: string): string {
    return fileName.endsWith('.json') ? fileName.slice(0, -5) : fileName;
}

/**
 * テーブルのヘッダーとデータ行を取得する。
 * table-storeに登録済みならそちらを優先し、未登録ならファイルから読み込む。
 */
async function fetchTableDataAsync(tableName: string): Promise<{header: string[]; rows: string[][]}> {
    const storeHeader = useTableStore.getState().getHeader(tableName);
    const storeRows = useTableStore.getState().getRows(tableName);
    if (storeHeader !== false && storeRows !== false) {
        return {header: storeHeader, rows: storeRows};
    }
    // 未登録テーブルはファイルから読み込む
    const csvText = await readFileAsync('data/' + tableName + '.csv');
    const csv = new Csv();
    csv.load(csvText);
    return {header: csv.header, rows: csv.body};
}

/**
 * Sidebar状態を管理するZustandストア（vanilla）
 *
 * table-store.ts / selection-store.ts と同じ createStore + immer パターンで実装する。
 * React コンポーネント内では `useStore(useSidebarStore, selector)` で購読し、
 * React 外部では `useSidebarStore.getState().setActivePanel(...)` で直接操作する。
 */
export const useSidebarStore = createStore<SidebarStoreState>()(
    immer((set, get) => ({
        activePanel: 'files',
        sidebarWidth: 300,
        fileNames: [],
        searchText: '',
        caseSensitive: false,
        wholeWord: false,
        useRegex: false,
        searchResults: [],
        isSearching: false,

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

        setFileNames(names) {
            set(draft => {
                draft.fileNames = names;
            });
        },

        async loadFileNamesAsync() {
            const files = await findFilesAsync('schema');
            const names: string[] = [];
            for (const file of files) {
                if (file.type !== 'file') continue;
                if (!file.name.endsWith('.json')) continue;
                names.push(extractTableName(file.name));
            }
            get().setFileNames(names);
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

        async executeSearchAsync() {
            const state = get();
            const {searchText, caseSensitive, wholeWord, useRegex, fileNames} = state;

            // 検索テキストが空なら結果をクリアして即return
            if (searchText === '') {
                set(draft => { draft.searchResults = []; });
                return;
            }

            set(draft => { draft.isSearching = true; });

            try {
                // fileNamesが未取得の場合はfindFilesAsyncで取得する
                let tableNames = fileNames;
                if (tableNames.length === 0) {
                    const files = await findFilesAsync('schema');
                    tableNames = [];
                    for (const file of files) {
                        if (file.type !== 'file') continue;
                        if (!file.name.endsWith('.json')) continue;
                        tableNames.push(extractTableName(file.name));
                    }
                }

                const options = {caseSensitive, wholeWord, useRegex};
                const query = parseSearchQuery(searchText, options);
                const results: SearchResult[] = [];

                for (const tableName of tableNames) {
                    // ColumnFilterQueryなら対象テーブル以外はスキップ
                    if (query.kind === 'filter' && query.tableName !== tableName) continue;

                    const {header, rows} = await fetchTableDataAsync(tableName);
                    const pkColIndex = header.indexOf(config.primaryKeyColumnName);

                    for (const row of rows) {
                        const pkValue = pkColIndex !== -1 ? row[pkColIndex] : '';

                        if (query.kind === 'filter') {
                            // 対象列のみ検索する
                            const colIndex = header.indexOf(query.columnName);
                            if (colIndex === -1) continue;
                            const cellValue = row[colIndex];
                            if (!matchesQuery(cellValue, query.value, options)) continue;
                            results.push({tableName, columnName: query.columnName, columnIndex: colIndex, pkValue, value: cellValue});
                        } else {
                            // 全列を検索する
                            for (let c = 0; c < header.length; c++) {
                                const cellValue = row[c];
                                if (!matchesQuery(cellValue, searchText, options)) continue;
                                results.push({tableName, columnName: header[c], columnIndex: c, pkValue, value: cellValue});
                            }
                        }
                    }
                }

                set(draft => { draft.searchResults = results; });
            } finally {
                set(draft => { draft.isSearching = false; });
            }
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
                draft.searchResults = [];
                draft.isSearching = false;
            });
        },
    }))
);
