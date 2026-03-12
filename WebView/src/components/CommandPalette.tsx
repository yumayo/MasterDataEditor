import React, {useEffect, useMemo, useRef, useState} from 'react';
import ReactDOM from 'react-dom';
import {useStore} from 'zustand';
import {useSidebarStore} from '../stores/sidebar-store';
import {useTabStore} from '../stores/tab-store';

interface CommandPaletteProps {
    visible: boolean;
    onClose: () => void;
}

/**
 * コマンドパレットコンポーネント。
 * Ctrl+P で表示され、テーブル名のファジー検索でタブを開く。
 * document.body に Portal でレンダリングすることで z-index 問題を回避する。
 * DOM は常に存在し、.visible クラスの付与/削除で表示を切り替える（CSSで display 制御）。
 */
export function CommandPalette({visible, onClose}: CommandPaletteProps): React.ReactPortal {
    const fileNames = useStore(useSidebarStore, state => state.fileNames);
    const [filterText, setFilterText] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    // visible が false→true に変わるたびに入力欄をリセットしてフォーカスを当てる
    useEffect(() => {
        if (!visible) return;
        setFilterText('');
        setSelectedIndex(0);
        // DOM反映後にフォーカスを当てる
        requestAnimationFrame(() => {
            inputRef.current?.focus();
        });
    }, [visible]);

    // フィルタテキストから候補リストを計算する（大文字小文字区別なし部分一致）
    const filteredItems = useMemo(() => {
        const lower = filterText.toLowerCase();
        return fileNames.filter(name => name.toLowerCase().includes(lower));
    }, [fileNames, filterText]);

    // selectedIndex をフィルタ結果の範囲内に収める
    useEffect(() => {
        setSelectedIndex(prev => {
            if (filteredItems.length === 0) return 0;
            return Math.min(prev, filteredItems.length - 1);
        });
    }, [filteredItems]);

    // 選択項目でタブを開いてパレットを閉じる
    function confirmSelection(index: number): void {
        if (filteredItems.length === 0) return;
        if (index < 0 || index >= filteredItems.length) return;
        const tableName = filteredItems[index];
        useTabStore.getState().openTableAsync(tableName).catch(err => {
            console.error('[CommandPalette] テーブルオープン失敗:', err);
        });
        onClose();
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
        if (e.key === 'Escape') {
            onClose();
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            confirmSelection(selectedIndex);
            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (filteredItems.length === 0) return;
            setSelectedIndex(prev => (prev + 1) % filteredItems.length);
            return;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (filteredItems.length === 0) return;
            setSelectedIndex(prev => (prev - 1 + filteredItems.length) % filteredItems.length);
            return;
        }
    }

    function handleOverlayMouseDown(e: React.MouseEvent<HTMLDivElement>): void {
        // オーバーレイ背景部分のクリックでのみ閉じる（パレット本体のクリックは無視）
        if (e.target === e.currentTarget) onClose();
    }

    // visible クラスの付与/削除で表示を制御する（DOMは常に存在する）
    const overlayClassName = visible ? 'command-palette-overlay visible' : 'command-palette-overlay';

    return ReactDOM.createPortal(
        <div
            className={overlayClassName}
            onMouseDown={handleOverlayMouseDown}
        >
            <div className="command-palette">
                <input
                    ref={inputRef}
                    className="command-palette-input"
                    type="text"
                    placeholder="テーブル名を入力..."
                    value={filterText}
                    onChange={e => { setFilterText(e.target.value); setSelectedIndex(0); }}
                    onKeyDown={handleKeyDown}
                />
                <div className="command-palette-list">
                    {filteredItems.length === 0 ? (
                        <div className="command-palette-empty">該当する項目がありません</div>
                    ) : (
                        filteredItems.map((name, index) => (
                            <div
                                key={name}
                                className={`command-palette-item${index === selectedIndex ? ' selected' : ''}`}
                                onMouseDown={e => { e.preventDefault(); confirmSelection(index); }}
                            >
                                <span className="command-palette-item-name">{name}</span>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
}
