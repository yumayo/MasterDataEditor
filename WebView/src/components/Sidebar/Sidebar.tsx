import React, {useRef, useEffect, useCallback} from 'react';
import {useStore} from 'zustand';
import {useSidebarStore} from '../../stores/sidebar-store';
import {ActivityBar} from './ActivityBar';
import {ExplorerPanel} from './ExplorerPanel';
import {SearchPanel} from './SearchPanel';
import {ReferencesPanel, ReferenceEntry} from './ReferencesPanel';
import {MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH} from '../../constant';

interface SidebarProps {
    /** ファイルクリック時のコールバック（タブオープン） */
    onFileClick: (tableName: string) => void;
    /** REFERENCESパネルで行クリック時のコールバック（テーブルナビゲーション） */
    onReferenceRowClick: (tableName: string, pkValue: string) => void;
    /** 表示しているPK値（REFERENCESラベル用） */
    referencesPkValue: string;
    /** 逆参照エントリリスト */
    referencesEntries: ReferenceEntry[];
    /** 幅変更時のコールバック（Tabやエディター領域の幅調整に使用） */
    onWidthChange: (width: number) => void;
}

/**
 * サイドバーコンポーネント
 * ActivityBar（アイコン列） + サイドバーコンテンツ（3パネル切替） + リサイズハンドルの構成。
 * リサイズハンドルのドラッグで幅を MIN_SIDEBAR_WIDTH〜MAX_SIDEBAR_WIDTH の範囲で変更できる。
 */
export function Sidebar({onFileClick, onReferenceRowClick, referencesPkValue, referencesEntries, onWidthChange}: SidebarProps) {
    const activePanel = useStore(useSidebarStore, state => state.activePanel);
    const sidebarWidth = useStore(useSidebarStore, state => state.sidebarWidth);

    // ドラッグ状態をrefで保持する（stateにするとmousemoveごとに再レンダリングが発生するため）
    const isDraggingRef = useRef(false);
    const dragStartXRef = useRef(0);
    const dragStartWidthRef = useRef(0);
    const dragStartCursorRef = useRef('');

    // 幅変更をstoreと外部コールバックへ同時に反映する
    const applyWidth = useCallback((width: number) => {
        useSidebarStore.getState().setSidebarWidth(width);
        onWidthChange(width);
    }, [onWidthChange]);

    // Ctrl+Shift+F でSEARCHパネルに切り替えるショートカット
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.shiftKey && e.key === 'F') {
                e.preventDefault();
                useSidebarStore.getState().setActivePanel('search');
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, []);

    // document レベルのmousemove/mouseupリスナーをuseEffectで管理する
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDraggingRef.current) return;
            const deltaX = e.clientX - dragStartXRef.current;
            const newWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, dragStartWidthRef.current + deltaX));
            applyWidth(newWidth);
        };

        const handleMouseUp = () => {
            if (!isDraggingRef.current) return;
            isDraggingRef.current = false;
            document.body.style.cursor = dragStartCursorRef.current;
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [applyWidth]);

    const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        isDraggingRef.current = true;
        dragStartXRef.current = e.clientX;
        dragStartWidthRef.current = sidebarWidth;
        dragStartCursorRef.current = document.body.style.cursor;
        document.body.style.cursor = 'col-resize';
    }, [sidebarWidth]);

    return (
        <div id="explorer" className="explorer" style={{width: sidebarWidth}}>
            {/* アクティビティバー: 左端の48px幅のアイコン列 */}
            <ActivityBar />

            {/* サイドバーコンテンツ: アクティブパネルのみ表示 */}
            <div className="sidebar-content">
                {activePanel === 'files' && (
                    <ExplorerPanel onFileClick={onFileClick} />
                )}
                {activePanel === 'references' && (
                    <ReferencesPanel
                        pkValue={referencesPkValue}
                        entries={referencesEntries}
                        onRowClick={onReferenceRowClick}
                    />
                )}
                {activePanel === 'search' && (
                    <SearchPanel />
                )}
            </div>

            {/* リサイズハンドル: ドラッグで幅を変更する */}
            <div
                className="sidebar-resize-handle"
                onMouseDown={handleResizeMouseDown}
            />
        </div>
    );
}
