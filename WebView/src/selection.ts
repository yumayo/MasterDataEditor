export interface CellPosition {
    row: number;
    column: number;
}

export class Selection {

    element: HTMLElement;

    row: number;

    column: number;

    private anchor: CellPosition;

    private focus: CellPosition;

    private selecting: boolean;

    private tableElement: HTMLElement;

    constructor(tableElement: HTMLElement) {
        this.row = 0;
        this.column = 0;
        this.anchor = { row: 0, column: 0 };
        this.focus = { row: 0, column: 0 };
        this.selecting = false;
        this.tableElement = tableElement;

        const element = document.createElement('div');
        element.classList.add('selection');
        this.element = element;
    }

    move(row: number, column: number): void {
        this.row = row;
        this.column = column;
        this.anchor = { row, column };
        this.focus = { row, column };
        this.updateRenderer();
    }

    start(row: number, column: number): void {
        this.selecting = true;
        this.row = row;
        this.column = column;
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

    isSelecting(): boolean {
        return this.selecting;
    }

    isSingleCell(): boolean {
        return this.anchor.row === this.focus.row && this.anchor.column === this.focus.column;
    }

    getAnchor(): CellPosition {
        return this.anchor;
    }

    getFocus(): CellPosition {
        return this.focus;
    }

    private updateRenderer(): void {
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
