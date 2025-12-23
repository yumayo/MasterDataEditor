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

export type FillDirection = 'down' | 'up' | 'right' | 'left';

export class Selection {

    row: number;

    column: number;

    private anchor: CellPosition;

    private focus: CellPosition;

    private selecting: boolean;

    private tableElement: HTMLElement;

    private editorElement: HTMLElement;

    private selectedCells: HTMLElement[];

    private copiedCells: HTMLElement[];

    private copyRange: CellRange;

    private fillHandle: HTMLElement;

    private filling: boolean;

    private fillTarget: CellPosition;

    private fillPreviewCells: HTMLElement[];

    constructor(tableElement: HTMLElement, editorElement: HTMLElement) {
        this.row = 0;
        this.column = 0;
        this.anchor = { row: 0, column: 0 };
        this.focus = { row: 0, column: 0 };
        this.selecting = false;
        this.tableElement = tableElement;
        this.editorElement = editorElement;
        this.selectedCells = [];
        this.copiedCells = [];
        this.copyRange = { startRow: -1, startColumn: -1, endRow: -1, endColumn: -1 };
        this.filling = false;
        this.fillTarget = { row: 0, column: 0 };
        this.fillPreviewCells = [];

        // フィルハンドル要素を作成
        this.fillHandle = document.createElement('div');
        this.fillHandle.classList.add('fill-handle');
        this.editorElement.appendChild(this.fillHandle);
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

    /**
     * フォーカスを移動して選択範囲を拡張する（Shift+矢印キー用）
     */
    extendSelection(row: number, column: number): void {
        this.focus = { row, column };
        this.row = row;
        this.column = column;
        this.updateRenderer();
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

        // フィルハンドルの位置を更新
        this.updateFillHandlePosition();
    }

    private updateFillHandlePosition(): void {
        const endRow = Math.max(this.anchor.row, this.focus.row);
        const endColumn = Math.max(this.anchor.column, this.focus.column);

        const rowElement = this.tableElement.children[endRow] as HTMLElement;
        if (!rowElement) return;

        const cell = rowElement.children[endColumn] as HTMLElement;
        if (!cell) return;

        // セルの右下にフィルハンドルを配置
        const cellRect = cell.getBoundingClientRect();
        const editorRect = this.editorElement.getBoundingClientRect();

        this.fillHandle.style.left = (cellRect.right - editorRect.left + this.editorElement.scrollLeft - 4) + 'px';
        this.fillHandle.style.top = (cellRect.bottom - editorRect.top + this.editorElement.scrollTop - 4) + 'px';
        this.fillHandle.style.display = 'block';
    }

    getFillHandle(): HTMLElement {
        return this.fillHandle;
    }

    startFill(row: number, column: number): void {
        this.filling = true;
        this.fillTarget = { row, column };
    }

    updateFill(row: number, column: number): void {
        if (!this.filling) return;

        this.fillTarget = { row, column };
        this.updateFillPreview();
    }

    endFill(): void {
        this.filling = false;
        this.clearFillPreview();
    }

    isFilling(): boolean {
        return this.filling;
    }

    /**
     * フィルの方向と範囲を取得
     */
    getFillInfo(): { direction: FillDirection; sourceRange: CellRange; targetRange: CellRange; count: number } | undefined {
        const startRow = Math.min(this.anchor.row, this.focus.row);
        const startColumn = Math.min(this.anchor.column, this.focus.column);
        const endRow = Math.max(this.anchor.row, this.focus.row);
        const endColumn = Math.max(this.anchor.column, this.focus.column);

        const targetRow = this.fillTarget.row;
        const targetColumn = this.fillTarget.column;

        // フィル方向と数を決定
        let direction: FillDirection;
        let count: number;
        let targetRange: CellRange;

        if (targetRow > endRow && targetColumn >= startColumn && targetColumn <= endColumn) {
            // 下方向
            direction = 'down';
            count = targetRow - endRow;
            targetRange = {
                startRow: endRow + 1,
                startColumn: startColumn,
                endRow: targetRow,
                endColumn: endColumn
            };
        } else if (targetRow < startRow && targetColumn >= startColumn && targetColumn <= endColumn) {
            // 上方向
            direction = 'up';
            count = startRow - targetRow;
            targetRange = {
                startRow: targetRow,
                startColumn: startColumn,
                endRow: startRow - 1,
                endColumn: endColumn
            };
        } else if (targetColumn > endColumn && targetRow >= startRow && targetRow <= endRow) {
            // 右方向
            direction = 'right';
            count = targetColumn - endColumn;
            targetRange = {
                startRow: startRow,
                startColumn: endColumn + 1,
                endRow: endRow,
                endColumn: targetColumn
            };
        } else if (targetColumn < startColumn && targetRow >= startRow && targetRow <= endRow) {
            // 左方向
            direction = 'left';
            count = startColumn - targetColumn;
            targetRange = {
                startRow: startRow,
                startColumn: targetColumn,
                endRow: endRow,
                endColumn: startColumn - 1
            };
        } else {
            return undefined;
        }

        return {
            direction,
            sourceRange: { startRow, startColumn, endRow, endColumn },
            targetRange,
            count
        };
    }

    private updateFillPreview(): void {
        this.clearFillPreview();

        const fillInfo = this.getFillInfo();
        if (!fillInfo) return;

        const { targetRange } = fillInfo;

        // プレビュー範囲内のセルにスタイルを適用
        for (let r = targetRange.startRow; r <= targetRange.endRow; r++) {
            const rowElement = this.tableElement.children[r] as HTMLElement;
            if (!rowElement) continue;

            for (let c = targetRange.startColumn; c <= targetRange.endColumn; c++) {
                const cell = rowElement.children[c] as HTMLElement;
                if (!cell) continue;

                this.fillPreviewCells.push(cell);
                cell.classList.add('cell-fill-preview');

                // 境界線のクラスを追加
                if (r === targetRange.startRow) {
                    cell.classList.add('cell-fill-border-top');
                }
                if (r === targetRange.endRow) {
                    cell.classList.add('cell-fill-border-bottom');
                }
                if (c === targetRange.startColumn) {
                    cell.classList.add('cell-fill-border-left');
                }
                if (c === targetRange.endColumn) {
                    cell.classList.add('cell-fill-border-right');
                }
            }
        }
    }

    private clearFillPreview(): void {
        for (const cell of this.fillPreviewCells) {
            cell.classList.remove(
                'cell-fill-preview',
                'cell-fill-border-top',
                'cell-fill-border-bottom',
                'cell-fill-border-left',
                'cell-fill-border-right'
            );
        }
        this.fillPreviewCells = [];
    }

    /**
     * データ領域の最大行を取得（データが入力されている最後の行）
     */
    getMaxDataRow(): number {
        let maxRow = 0;

        // データ行の開始は行インデックス6から（ヘッダー5行 + 列ヘッダー1行）
        const dataStartRow = 6;

        for (let r = this.tableElement.children.length - 1; r >= dataStartRow; r--) {
            const rowElement = this.tableElement.children[r] as HTMLElement;
            if (!rowElement) continue;

            let hasData = false;
            for (let c = 1; c < rowElement.children.length; c++) {
                const cell = rowElement.children[c] as HTMLElement;
                if (cell && cell.textContent && cell.textContent.trim() !== '') {
                    hasData = true;
                    break;
                }
            }

            if (hasData) {
                maxRow = r;
                break;
            }
        }

        return maxRow;
    }
}
