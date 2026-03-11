import React, {useRef, useEffect, useState} from 'react';

/**
 * ドロップダウンの候補1件
 */
export interface DropdownItem {
    id: string;
    displayName: string;
}

/**
 * GridDropdownInput コンポーネントの Props 定義
 */
interface GridDropdownInputProps {
    /** 表示中か */
    visible: boolean;
    /** 候補リスト */
    items: DropdownItem[];
    /** 入力テキスト（フィルタリング用） */
    filterText: string;
    /** ドロップダウンの位置 */
    position: {top: number; left: number; width: number};
    /** 項目選択時 */
    onSelect: (id: string) => void;
    /** フィルタテキスト変更時 */
    onFilterChange: (text: string) => void;
    /** キャンセル時 */
    onCancel: () => void;
}

/**
 * FK列でのドロップダウン選択コンポーネント
 *
 * Vanilla側の GridDropdownInput クラスが担っていた「候補リスト表示・キーボード操作・フィルタリング」を
 * React コンポーネントとして再実装する。
 *
 * - filterText（親管理）に基づき ID・displayName で部分一致フィルタリングを行う
 * - 矢印キーで selectedIndex を循環させる
 * - Enter で選択確定（onSelect を呼ぶ）
 * - Escape でキャンセル（onCancel を呼ぶ）
 * - selectedIndex の項目に scrollIntoView で自動スクロールする
 */
export function GridDropdownInput({visible, items, filterText, position, onSelect, onFilterChange, onCancel}: GridDropdownInputProps): React.ReactElement | null {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const selectedItemRef = useRef<HTMLDivElement>(null);

    // フィルタリング: ID・displayName の部分一致（大文字小文字区別なし）
    const lowerFilter = filterText.toLowerCase();
    const filteredItems = filterText === ''
        ? items
        : items.filter(item =>
            item.id.toLowerCase().includes(lowerFilter) ||
            item.displayName.toLowerCase().includes(lowerFilter)
        );

    // filterText が変わったら selectedIndex をリセットする
    useEffect(() => {
        setSelectedIndex(0);
    }, [filterText]);

    // selectedIndex が変わったら選択項目をスクロールして表示する
    useEffect(() => {
        if (selectedItemRef.current) {
            selectedItemRef.current.scrollIntoView({block: 'nearest'});
        }
    }, [selectedIndex]);

    // 非表示のときは何も描画しない
    if (!visible) return null;

    function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex(prev => filteredItems.length === 0 ? 0 : (prev + 1) % filteredItems.length);
            return;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(prev => filteredItems.length === 0 ? 0 : (prev - 1 + filteredItems.length) % filteredItems.length);
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            if (filteredItems.length > 0 && selectedIndex < filteredItems.length) {
                onSelect(filteredItems[selectedIndex].id);
            }
            return;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
        }
    }

    function handleItemMouseDown(e: React.MouseEvent, id: string): void {
        // mousedown でフォーカスが外れるのを防ぐ
        e.preventDefault();
        onSelect(id);
    }

    return (
        <div
            className="grid-dropdown"
            style={{
                position: 'absolute',
                top: position.top,
                left: position.left,
                minWidth: position.width,
            }}
        >
            {/* フィルタ入力フィールド */}
            <input
                className="grid-dropdown-filter"
                type="text"
                value={filterText}
                autoFocus
                onChange={e => onFilterChange(e.target.value)}
                onKeyDown={handleKeyDown}
            />
            {/* 候補リスト */}
            <div className="grid-dropdown-list">
                {filteredItems.length === 0 ? (
                    <div className="grid-dropdown-empty">該当なし</div>
                ) : (
                    filteredItems.map((item, index) => {
                        const isSelected = index === selectedIndex;
                        return (
                            <div
                                key={item.id}
                                ref={isSelected ? selectedItemRef : null}
                                className={'grid-dropdown-item' + (isSelected ? ' grid-dropdown-item-selected' : '')}
                                onMouseDown={e => handleItemMouseDown(e, item.id)}
                            >
                                {/* IDを先頭に表示し、IDと異なる場合は displayName も表示する */}
                                <span className="grid-dropdown-item-id">{item.id}</span>
                                {item.id !== item.displayName && (
                                    <span className="grid-dropdown-item-name">{item.displayName}</span>
                                )}
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
