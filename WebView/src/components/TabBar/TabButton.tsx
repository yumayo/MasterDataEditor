import React from 'react';
import {useSortable} from '@dnd-kit/sortable';

/**
 * 個別タブボタンの props 定義
 */
interface TabButtonProps {
    tableName: string;
    isActive: boolean;
    isDirty: boolean;
    onClick: () => void;
    onClose: () => void;
}

/**
 * 個別タブボタンコンポーネント
 *
 * @dnd-kit/sortable の useSortable フックでドラッグ並び替えに対応する。
 * 既存 tab-button.ts の TabButton クラスと同等の UI を React で実装したもの。
 * - クリック: onClick prop を呼び出してタブをアクティブ化する
 * - 中クリック（button === 1）: onClose prop を呼び出してタブを閉じる
 * - 閉じるボタン: stopPropagation してから onClose を呼び出す
 * - dirty 表示: isDirty に応じて .tab-button-dirty-visible クラスをトグルする
 * - ドラッグ: useSortable から取得した transform/transition を style に適用する
 */
export function TabButton({tableName, isActive, isDirty, onClick, onClose}: TabButtonProps) {
    const {attributes, listeners, setNodeRef, transform, transition, isDragging} = useSortable({
        id: tableName,
    });

    // @dnd-kit/utilities の CSS.Transform.toString が使えない場合は直接 translate3d に変換する
    const transformStyle = transform
        ? `translate3d(${transform.x}px, ${transform.y}px, 0) scaleX(${transform.scaleX}) scaleY(${transform.scaleY})`
        : '';

    const style: React.CSSProperties = {
        transform: transformStyle,
        transition,
    };

    const handleAuxClick = (ev: React.MouseEvent<HTMLLIElement>) => {
        // 中クリック（ホイールクリック）でタブを閉じる
        if (ev.button !== 1) return;
        ev.preventDefault();
        onClose();
    };

    const handleCloseClick = (ev: React.MouseEvent<HTMLButtonElement>) => {
        // 閉じるボタンのクリックが li の onClick に伝播しないよう止める
        ev.stopPropagation();
        onClose();
    };

    const liClassName = [
        'tab-button',
        isActive ? 'tab-button-active' : '',
        isDragging ? 'tab-button-dragging' : '',
    ].filter(c => c !== '').join(' ');

    const dirtyClassName = [
        'tab-button-dirty',
        isDirty ? 'tab-button-dirty-visible' : '',
    ].filter(c => c !== '').join(' ');

    return (
        <li
            ref={setNodeRef}
            className={liClassName}
            style={style}
            onClick={onClick}
            onAuxClick={handleAuxClick}
            {...attributes}
            {...listeners}
        >
            {tableName}
            {/* 閉じるボタンと dirty インジケーターのコンテナ */}
            <div className="tab-button-container">
                {/* 編集中を示す丸ポッチ */}
                <div className={dirtyClassName} />
                {/* 閉じるボタン（丸ポッチの上に重なる） */}
                <button className="tab-button-close" onClick={handleCloseClick} />
            </div>
        </li>
    );
}
