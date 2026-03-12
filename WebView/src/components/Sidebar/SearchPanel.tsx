import React, {useRef, useCallback, useEffect} from 'react';
import {useStore} from 'zustand';
import {useSidebarStore} from '../../stores/sidebar-store';
import {useTabStore} from '../../stores/tab-store';

/** デバウンス待機時間(ms) */
const DEBOUNCE_DELAY_MS = 150;

/**
 * 検索オプションボタン1件分のProps
 */
interface SearchOptionButtonProps {
    label: string;
    active: boolean;
    onClick: () => void;
}

/**
 * 検索オプションボタン（大文字小文字・単語単位・正規表現）
 */
function SearchOptionButton({label, active, onClick}: SearchOptionButtonProps) {
    return (
        <button
            className={'search-option-button' + (active ? ' search-option-active' : '')}
            onClick={onClick}
            type="button"
        >
            {label}
        </button>
    );
}

/**
 * SEARCHパネル
 * テキスト入力・検索オプション3つ・検索結果リストのUIを提供する。
 * 入力は150msデバウンスでstoreへ反映し、反映後に executeSearchAsync を呼ぶ。
 * オプション（caseSensitive / wholeWord / useRegex）トグル後にも再検索を行う。
 */
export function SearchPanel() {
    const searchText = useStore(useSidebarStore, state => state.searchText);
    const caseSensitive = useStore(useSidebarStore, state => state.caseSensitive);
    const wholeWord = useStore(useSidebarStore, state => state.wholeWord);
    const useRegex = useStore(useSidebarStore, state => state.useRegex);
    const searchResults = useStore(useSidebarStore, state => state.searchResults);
    const isSearching = useStore(useSidebarStore, state => state.isSearching);

    // デバウンス用タイマーIDをrefで保持する
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | false>(false);

    // 検索入力フィールドのref（Ctrl+Shift+Fでフォーカスを当てるため）
    const inputRef = useRef<HTMLInputElement>(null);

    // Ctrl+Shift+F でこのパネルが表示されたときに検索入力にフォーカスする
    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.focus();
        }
    }, []);

    const handleInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        if (debounceTimerRef.current !== false) {
            clearTimeout(debounceTimerRef.current);
        }
        debounceTimerRef.current = setTimeout(() => {
            debounceTimerRef.current = false;
            useSidebarStore.getState().setSearchText(value);
            // searchTextをセット後に検索を実行する
            useSidebarStore.getState().executeSearchAsync().catch(err => {
                console.error('[SearchPanel] 検索失敗:', err);
            });
        }, DEBOUNCE_DELAY_MS);
    }, []);

    // caseSensitive/wholeWord/useRegex が変化したら再検索する
    useEffect(() => {
        if (searchText === '') return;
        useSidebarStore.getState().executeSearchAsync().catch(err => {
            console.error('[SearchPanel] オプション変更後の再検索失敗:', err);
        });
    }, [caseSensitive, wholeWord, useRegex]);

    const handleToggleCaseSensitive = useCallback(() => {
        useSidebarStore.getState().toggleCaseSensitive();
    }, []);

    const handleToggleWholeWord = useCallback(() => {
        useSidebarStore.getState().toggleWholeWord();
    }, []);

    const handleToggleUseRegex = useCallback(() => {
        useSidebarStore.getState().toggleUseRegex();
    }, []);

    const handleResultClick = useCallback((tableName: string, pkValue: string, columnIndex: number) => {
        useTabStore.getState().navigateToTableCell(tableName, pkValue, columnIndex);
    }, []);

    return (
        <div className="sidebar-panel search-panel">
            <div className="sidebar-panel-header">SEARCH</div>
            <div className="search-panel-controls">
                <div className="search-panel-input-row">
                    <input
                        ref={inputRef}
                        className="search-input"
                        type="text"
                        placeholder="検索..."
                        defaultValue={searchText}
                        onChange={handleInput}
                    />
                </div>
                <div className="search-panel-options">
                    <SearchOptionButton label="Aa" active={caseSensitive} onClick={handleToggleCaseSensitive} />
                    <SearchOptionButton label="|ab|" active={wholeWord} onClick={handleToggleWholeWord} />
                    <SearchOptionButton label=".*" active={useRegex} onClick={handleToggleUseRegex} />
                </div>
            </div>
            {/* 検索結果リスト */}
            <div className="search-panel-results">
                {isSearching && (
                    <div className="search-panel-searching">検索中...</div>
                )}
                {!isSearching && searchResults.map((result, index) => (
                    <div
                        key={index}
                        className="search-result-item"
                        onClick={() => handleResultClick(result.tableName, result.pkValue, result.columnIndex)}
                    >
                        <span className="search-result-table">{result.tableName}</span>
                        <span className="search-result-separator"> &gt; </span>
                        <span className="search-result-column">{result.columnName}</span>
                        <span className="search-result-separator">: </span>
                        <span className="search-result-value">{result.value}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
