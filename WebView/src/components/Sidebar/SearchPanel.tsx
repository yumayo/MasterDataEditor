import React, {useRef, useCallback} from 'react';
import {useStore} from 'zustand';
import {useSidebarStore} from '../../stores/sidebar-store';

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
 * 検索ロジックは後続フェーズで統合するため、現時点ではUIの枠組みのみ実装する。
 * 入力は150msデバウンスでstoreへ反映する。
 */
export function SearchPanel() {
    const searchText = useStore(useSidebarStore, state => state.searchText);
    const caseSensitive = useStore(useSidebarStore, state => state.caseSensitive);
    const wholeWord = useStore(useSidebarStore, state => state.wholeWord);
    const useRegex = useStore(useSidebarStore, state => state.useRegex);

    // デバウンス用タイマーIDをrefで保持する
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | false>(false);

    const handleInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        if (debounceTimerRef.current !== false) {
            clearTimeout(debounceTimerRef.current);
        }
        debounceTimerRef.current = setTimeout(() => {
            debounceTimerRef.current = false;
            useSidebarStore.getState().setSearchText(value);
        }, DEBOUNCE_DELAY_MS);
    }, []);

    return (
        <div className="sidebar-panel search-panel">
            <div className="sidebar-panel-header">SEARCH</div>
            <div className="search-panel-controls">
                <div className="search-panel-input-row">
                    <input
                        className="search-input"
                        type="text"
                        placeholder="検索..."
                        defaultValue={searchText}
                        onChange={handleInput}
                    />
                </div>
                <div className="search-panel-options">
                    <SearchOptionButton
                        label="Aa"
                        active={caseSensitive}
                        onClick={() => useSidebarStore.getState().toggleCaseSensitive()}
                    />
                    <SearchOptionButton
                        label="|ab|"
                        active={wholeWord}
                        onClick={() => useSidebarStore.getState().toggleWholeWord()}
                    />
                    <SearchOptionButton
                        label=".*"
                        active={useRegex}
                        onClick={() => useSidebarStore.getState().toggleUseRegex()}
                    />
                </div>
            </div>
            {/* 検索結果リスト: 後続フェーズで検索ロジックと統合する */}
            <div className="search-panel-results" />
        </div>
    );
}
