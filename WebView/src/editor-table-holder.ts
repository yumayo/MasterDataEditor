export class EditorTableHolder {

    element: HTMLElement;

    constructor() {
        this.element = document.getElementById('editor-table-content')!;
    }

    clear() {
        this.element.innerHTML = '';
    }
}
