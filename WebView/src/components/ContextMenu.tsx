import React, {useEffect, useRef} from 'react';
import ReactDOM from 'react-dom';

export type ContextMenuItemAction = () => void;

export interface ContextMenuItem {
    label: string;
    action: ContextMenuItemAction;
}

/** セパレーター */
export interface ContextMenuSeparator {
    separator: true;
}

/** メニューエントリ（項目またはセパレーター） */
export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

/** セパレーターかどうかを判定する */
function isSeparator(entry: ContextMenuEntry): entry is ContextMenuSeparator {
    return 'separator' in entry && entry.separator === true;
}

interface ContextMenuProps {
    visible: boolean;
    x: number;
    y: number;
    items: ContextMenuEntry[];
    onClose: () => void;
}

/**
 * コンテキストメニューコンポーネント。
 * document.body に Portal でレンダリングすることで z-index 問題を回避する。
 * visible=false の場合は何もレンダリングしない。
 */
export function ContextMenu({visible, x, y, items, onClose}: ContextMenuProps): React.ReactPortal | null {
    const menuRef = useRef<HTMLDivElement>(null);

    // 画面端はみ出し補正: メニューが描画された後にBoundingRectを確認して位置を調整する
    useEffect(() => {
        if (!visible || !menuRef.current) return;
        const rect = menuRef.current.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            menuRef.current.style.left = `${window.innerWidth - rect.width}px`;
        }
        if (rect.bottom > window.innerHeight) {
            menuRef.current.style.top = `${window.innerHeight - rect.height}px`;
        }
    }, [visible, x, y, items]);

    // Escキーでメニューを閉じる
    useEffect(() => {
        if (!visible) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [visible, onClose]);

    if (!visible) return null;

    return ReactDOM.createPortal(
        <>
            {/* オーバーレイ: メニュー表示中に背面の操作をブロックする */}
            <div
                className="context-menu-overlay visible"
                onClick={e => { e.stopPropagation(); onClose(); }}
                onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onClose(); }}
            />
            {/* メニュー本体 */}
            <div
                ref={menuRef}
                className="context-menu visible"
                style={{left: x, top: y}}
            >
                {items.map((entry, index) => {
                    if (isSeparator(entry)) {
                        return <div key={index} className="context-menu-separator" />;
                    }
                    return (
                        <div
                            key={index}
                            className="context-menu-item"
                            onClick={e => { e.stopPropagation(); entry.action(); onClose(); }}
                        >
                            {entry.label}
                        </div>
                    );
                })}
            </div>
        </>,
        document.body
    );
}
