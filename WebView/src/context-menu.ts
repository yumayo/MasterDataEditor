export type ContextMenuItemAction = () => void;

export interface ContextMenuItem {
    label: string;
    action: ContextMenuItemAction;
}

export class ContextMenu {
    readonly element: HTMLElement;

    constructor(parentElement: HTMLElement) {
        this.element = document.createElement('div');
        this.element.classList.add('context-menu');
        parentElement.appendChild(this.element);

        window.addEventListener('click', () => {
            this.hide();
        });

        window.addEventListener('contextmenu', (e) => {
            const target = e.target as HTMLElement;
            if (!this.element.contains(target)) {
                this.hide();
            }
        });
    }

    show(x: number, y: number, items: ContextMenuItem[]): void {
        this.element.innerHTML = '';

        for (const item of items) {
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
        this.element.classList.remove('visible');
    }
}
