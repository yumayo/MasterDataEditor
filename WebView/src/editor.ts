export class Editor {

    readonly element: HTMLElement;

    constructor() {
        this.element = document.getElementById('editor')!;
    }
    
    public appendChild(element: HTMLElement) {
        this.element.appendChild(element);
    }

    public clear() {
        this.element.innerHTML = '';
    }
}