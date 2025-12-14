export class EditorTableHolder {

    element: HTMLElement;

    constructor() {
        this.element = document.getElementById('table-content')!;
    }

    clear() {
        this.element.innerHTML = '';
    }
}
