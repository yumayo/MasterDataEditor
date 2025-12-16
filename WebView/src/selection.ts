export interface CellPosition {
    row: number;
    column: number;
}

export class Selection {

    element: HTMLElement;

    private anchor: CellPosition | null;

    private focus: CellPosition | null;

    private selecting: boolean;

    private tableElement: HTMLElement | null;

    constructor() {
        this.anchor = null;
        this.focus = null;
        this.selecting = false;
        this.tableElement = null;

        const element = document.createElement('div');
        element.classList.add('selection');
        this.element = element;
    }

    setTableElement(tableElement: HTMLElement): void {
        this.tableElement = tableElement;
    }

    start(row: number, column: number): void {
        this.selecting = true;
        this.anchor = { row, column };
        this.focus = { row, column };
        this.updateRenderer();
    }

    update(row: number, column: number): void {
        if (!this.selecting) return;

        this.focus = { row, column };
        this.updateRenderer();
    }

    end(): void {
        this.selecting = false;
    }

    clear(): void {
        this.anchor = null;
        this.focus = null;
        this.hideRenderer();
    }

    isSelecting(): boolean {
        return this.selecting;
    }

    hasSelection(): boolean {
        return this.anchor !== null && this.focus !== null;
    }

    isSingleCell(): boolean {
        if (!this.anchor || !this.focus) return true;
        return this.anchor.row === this.focus.row && this.anchor.column === this.focus.column;
    }

    getAnchor(): CellPosition | null {
        return this.anchor;
    }

    getFocus(): CellPosition | null {
        return this.focus;
    }

    private updateRenderer(): void {
        if (!this.tableElement) return;
        if (!this.anchor || !this.focus) {
            this.hideRenderer();
            return;
        }

        const startRow = Math.min(this.anchor.row, this.focus.row);
        const startColumn = Math.min(this.anchor.column, this.focus.column);
        const endRow = Math.max(this.anchor.row, this.focus.row);
        const endColumn = Math.max(this.anchor.column, this.focus.column);

        const tableRect = this.tableElement.getBoundingClientRect();

        const startCell = this.tableElement.children[startRow]?.children[startColumn] as HTMLElement | undefined;
        const endCell = this.tableElement.children[endRow]?.children[endColumn] as HTMLElement | undefined;

        if (!startCell || !endCell) {
            this.hideRenderer();
            return;
        }

        const startRect = startCell.getBoundingClientRect();
        const endRect = endCell.getBoundingClientRect();

        const left = startRect.left - tableRect.left - 1;
        const top = startRect.top - tableRect.top - 1;
        const width = endRect.right - startRect.left - 1;
        const height = endRect.bottom - startRect.top - 1;

        this.element.style.left = left + 'px';
        this.element.style.top = top + 'px';
        this.element.style.width = width + 'px';
        this.element.style.height = height + 'px';
        this.element.classList.add('selection-active');
    }

    private hideRenderer(): void {
        this.element.style.left = '-99999px';
        this.element.style.top = '-99999px';
        this.element.style.width = '0px';
        this.element.style.height = '0px';
        this.element.classList.remove('selection-active');
    }
}
