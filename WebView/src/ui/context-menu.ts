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
export type ContextMenuEntry =
    ContextMenuItem | ContextMenuSeparator;

/**
 * セパレーターかどうかを判定する
 */
function isSeparator(
    entry: ContextMenuEntry
): entry is ContextMenuSeparator {
    return 'separator' in entry
        && entry.separator === true;
}

export class ContextMenu {
    readonly element: HTMLElement;
    private readonly overlay: HTMLElement;

    constructor() {
        // オーバーレイ: メニュー表示中に背面の操作をすべてブロックする
        this.overlay = document.createElement('div');
        this.overlay.classList.add('context-menu-overlay');
        document.body.appendChild(this.overlay);

        this.element = document.createElement('div');
        this.element.classList.add('context-menu');
        document.body.appendChild(this.element);

        // オーバーレイのクリック・右クリックでメニューを閉じる
        this.overlay.addEventListener('click', (e) => {
            e.stopPropagation();
            this.hide();
        });
        this.overlay.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.hide();
            // オーバーレイの下にある要素にcontextmenuイベントを再送する
            const target = document.elementFromPoint(e.clientX, e.clientY);
            if (target) {
                target.dispatchEvent(new MouseEvent('contextmenu', {
                    bubbles: true, clientX: e.clientX, clientY: e.clientY,
                    button: 2, buttons: 2,
                }));
            }
        });

        // Escキーでメニューを閉じる
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hide();
            }
        });
    }

    show(
        x: number,
        y: number,
        items: ContextMenuEntry[]
    ): void {
        this.element.innerHTML = '';

        for (const item of items) {
            if (isSeparator(item)) {
                const sep =
                    document.createElement('div');
                sep.classList.add(
                    'context-menu-separator'
                );
                this.element.appendChild(sep);
                continue;
            }

            const menuItem = document.createElement('div');
            menuItem.classList.add('context-menu-item');
            menuItem.textContent = item.label;
            menuItem.addEventListener('click', (e) => {
                e.stopPropagation();
                item.action();
                this.hide();
            });
            this.element.appendChild(menuItem);
        }

        this.element.style.left = x + 'px';
        this.element.style.top = y + 'px';
        this.overlay.classList.add('visible');
        this.element.classList.add('visible');

        const rect = this.element.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            this.element.style.left = (window.innerWidth - rect.width) + 'px';
        }
        if (rect.bottom > window.innerHeight) {
            this.element.style.top = (window.innerHeight - rect.height) + 'px';
        }
    }

    hide(): void {
        this.overlay.classList.remove('visible');
        this.element.classList.remove('visible');
    }
}
