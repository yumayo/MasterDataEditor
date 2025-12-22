export interface CellPosition {
    row: number;
    column: number;
}

export interface CellRange {
    startRow: number;
    startColumn: number;
    endRow: number;
    endColumn: number;
}

export class Selection {

    row: number;

    column: number;

    private anchor: CellPosition;

    private focus: CellPosition;

    private selecting: boolean;

    private tableElement: HTMLElement;

    private selectedCells: HTMLElement[];

    private copiedCells: HTMLElement[];

    private copyRange: CellRange;

    constructor(tableElement: HTMLElement) {
        this.row = 0;
        this.column = 0;
        this.anchor = { row: 0, column: 0 };
        this.focus = { row: 0, column: 0 };
        this.selecting = false;
        this.tableElement = tableElement;
        this.selectedCells = [];
        this.copiedCells = [];
        this.copyRange = { startRow: -1, startColumn: -1, endRow: -1, endColumn: -1 };
    }

    move(row: number, column: number): void {
        this.row = row;
        this.column = column;
        this.anchor = { row, column };
        this.focus = { row, column };
        this.updateRenderer();
    }

    setRange(startRow: number, startColumn: number, endRow: number, endColumn: number): void {
        this.row = startRow;
        this.column = startColumn;
        this.anchor = { row: startRow, column: startColumn };
        this.focus = { row: endRow, column: endColumn };
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

    getCopyRange(): CellRange {
        return this.copyRange;
    }

    hasCopyRange(): boolean {
        return this.copyRange.startRow >= 0;
    }

    copy(): void {
        const startRow = Math.min(this.anchor.row, this.focus.row);
        const startColumn = Math.min(this.anchor.column, this.focus.column);
        const endRow = Math.max(this.anchor.row, this.focus.row);
        const endColumn = Math.max(this.anchor.column, this.focus.column);

        this.copyRange = { startRow, startColumn, endRow, endColumn };
        this.updateCopyRenderer();
    }

    clearCopyRange(): void {
        // 以前のコピー範囲のスタイルを削除
        for (const cell of this.copiedCells) {
            cell.classList.remove(
                'cell-copied',
                'cell-copied-border-top',
                'cell-copied-border-bottom',
                'cell-copied-border-left',
                'cell-copied-border-right'
            );
        }
        this.copiedCells = [];
        this.copyRange = { startRow: -1, startColumn: -1, endRow: -1, endColumn: -1 };
    }

    private updateCopyRenderer(): void {
        // 以前のコピー範囲のスタイルを削除
        for (const cell of this.copiedCells) {
            cell.classList.remove(
                'cell-copied',
                'cell-copied-border-top',
                'cell-copied-border-bottom',
                'cell-copied-border-left',
                'cell-copied-border-right'
            );
        }
        this.copiedCells = [];

        if (!this.hasCopyRange()) return;

        const { startRow, startColumn, endRow, endColumn } = this.copyRange;

        // コピー範囲内のすべてのセルにスタイルを適用
        for (let r = startRow; r <= endRow; r++) {
            const rowElement = this.tableElement.children[r] as HTMLElement;
            if (!rowElement) continue;

            for (let c = startColumn; c <= endColumn; c++) {
                const cell = rowElement.children[c] as HTMLElement;
                if (!cell) continue;

                this.copiedCells.push(cell);
                cell.classList.add('cell-copied');

                // 境界線のクラスを追加
                if (r === startRow) {
                    cell.classList.add('cell-copied-border-top');
                }
                if (r === endRow) {
                    cell.classList.add('cell-copied-border-bottom');
                }
                if (c === startColumn) {
                    cell.classList.add('cell-copied-border-left');
                }
                if (c === endColumn) {
                    cell.classList.add('cell-copied-border-right');
                }
            }
        }
    }

    private updateRenderer(): void {
        // 以前選択されていたセルからスタイルを削除
        for (const cell of this.selectedCells) {
            cell.classList.remove('cell-selected', 'cell-anchor', 'cell-border-top', 'cell-border-bottom', 'cell-border-left', 'cell-border-right');
        }
        this.selectedCells = [];

        const startRow = Math.min(this.anchor.row, this.focus.row);
        const startColumn = Math.min(this.anchor.column, this.focus.column);
        const endRow = Math.max(this.anchor.row, this.focus.row);
        const endColumn = Math.max(this.anchor.column, this.focus.column);

        // 選択範囲内のすべてのセルにスタイルを適用
        for (let r = startRow; r <= endRow; r++) {
            const rowElement = this.tableElement.children[r] as HTMLElement;
            if (!rowElement) continue;

            for (let c = startColumn; c <= endColumn; c++) {
                const cell = rowElement.children[c] as HTMLElement;
                if (!cell) continue;

                this.selectedCells.push(cell);

                // アンカーセル（カーソル位置）かどうか
                const isAnchor = r === this.anchor.row && c === this.anchor.column;

                if (isAnchor) {
                    cell.classList.add('cell-anchor');
                } else {
                    cell.classList.add('cell-selected');
                }

                // 境界線のクラスを追加
                if (r === startRow) {
                    cell.classList.add('cell-border-top');
                }
                if (r === endRow) {
                    cell.classList.add('cell-border-bottom');
                }
                if (c === startColumn) {
                    cell.classList.add('cell-border-left');
                }
                if (c === endColumn) {
                    cell.classList.add('cell-border-right');
                }
            }
        }
    }
}
