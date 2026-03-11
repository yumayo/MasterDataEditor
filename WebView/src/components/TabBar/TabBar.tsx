import React from 'react';
import {useStore} from 'zustand';
import {DndContext, closestCenter, DragEndEvent} from '@dnd-kit/core';
import {SortableContext, horizontalListSortingStrategy} from '@dnd-kit/sortable';
import {useTabStore} from '../../stores/tab-store';
import {TabButton} from './TabButton';

/**
 * タブバーコンポーネントの props 定義
 */
interface TabBarProps {
    /** タブクリック時（アクティブ化）のコールバック */
    onTabClick: (tableName: string) => void;
    /** タブ閉じる時のコールバック */
    onTabClose: (tableName: string) => void;
}

/**
 * タブバーコンポーネント
 *
 * useTabStore からタブ一覧・アクティブ状態を購読して TabButton を並べて描画する。
 * @dnd-kit/core の DndContext + @dnd-kit/sortable の SortableContext で
 * ドラッグ並び替えを実現する。
 * 既存の tab.ts / tab-button.ts と同等のタブバー機能を React で実装したもの。
 */
export function TabBar({onTabClick, onTabClose}: TabBarProps) {
    // タブの表示順リスト・状態マップ・アクティブ名を個別に購読してレンダリング最適化する
    const tabOrder = useStore(useTabStore, state => state.tabOrder);
    const tabStates = useStore(useTabStore, state => state.tabStates);
    const activeTabName = useStore(useTabStore, state => state.activeTabName);

    const handleDragEnd = (event: DragEndEvent) => {
        const {active, over} = event;
        // ドロップ先がなければ何もしない
        if (!over) return;
        // ドラッグ元とドロップ先が同じなら並び替え不要
        if (active.id === over.id) return;

        const fromIndex = tabOrder.indexOf(active.id as string);
        const toIndex = tabOrder.indexOf(over.id as string);
        if (fromIndex === -1 || toIndex === -1) return;

        // ストアのタブ順序を更新する
        useTabStore.getState().reorderTab(fromIndex, toIndex);
    };

    return (
        <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={tabOrder} strategy={horizontalListSortingStrategy}>
                {/* 既存 CSS の #tab と同じクラス構造を維持する */}
                <ul id="tab">
                    {tabOrder.map(tableName => {
                        const tabState = tabStates.get(tableName);
                        // tabOrder にある tableName は必ず tabStates にも存在する不変条件
                        if (!tabState) return null;
                        return (
                            <TabButton
                                key={tableName}
                                tableName={tableName}
                                isActive={tableName === activeTabName}
                                isDirty={tabState.isDirty}
                                onClick={() => onTabClick(tableName)}
                                onClose={() => onTabClose(tableName)}
                            />
                        );
                    })}
                </ul>
            </SortableContext>
        </DndContext>
    );
}
