import Store from "./store";

export class Cursor {

    element: HTMLElement;

    column: number;

    row: number;

    visible: boolean;

    constructor() {
        this.column = 0;
        this.row = 0;
        this.visible = false;

        const element = document.createElement('div');
        element.classList.add('cursor');
        element.style.width = '20px';
        element.addEventListener('dblclick', () => {
            Store.enableCellEditMode();
        });
        this.element = element;
    }

    move(row: number, column: number, rect: DOMRect) {
        this.row = row;
        this.column = column;
        this.element.style.top = rect.top + 'px';
        this.element.style.left = rect.left + 'px';
        this.element.style.width = rect.width + 'px';
        this.element.style.height = rect.height + 'px';
    }
}
