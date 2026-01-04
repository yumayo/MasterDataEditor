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

    private selectingColumn: boolean;

    private selectingRow: boolean;

    private tableElement: HTMLElement;

    private editorElement: HTMLElement;

    private selectedCells: HTMLElement[];

    private copiedCells: HTMLElement[];

    private copyRange: CellRange;

    private fillHandle: HTMLElement;

    private filling: boolean;

    private fillTarget: CellPosition;

    private fillPreviewCells: HTMLElement[];

    // 範囲選択内移動モード用（Enter/Tabキーでの移動時に範囲を維持するため）
    private lockedRange: CellRange;

    constructor(tableElement: HTMLElement, editorElement: HTMLElement) {
        // 初期位置はA1（row=1, column=1）、row=0は列ヘッダー、column=0は行ヘッダー
        this.row = 1;
        this.column = 1;
        this.anchor = { row: 1, column: 1 };
        this.focus = { row: 1, column: 1 };
        this.selecting = false;
        this.selectingColumn = false;
        this.selectingRow = false;
        this.tableElement = tableElement;
        this.editorElement = editorElement;
        this.selectedCells = [];
        this.copiedCells = [];
        this.copyRange = { startRow: -1, startColumn: -1, endRow: -1, endColumn: -1 };
        this.filling = false;
        this.fillTarget = { row: 0, column: 0 };
        this.fillPreviewCells = [];
        this.lockedRange = { startRow: -1, startColumn: -1, endRow: -1, endColumn: -1 };

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
        this.clearLockedRange();
        this.updateRenderer();
    }

    private clearLockedRange(): void {
        this.lockedRange = { startRow: -1, startColumn: -1, endRow: -1, endColumn: -1 };
    }

    private hasLockedRange(): boolean {
        return this.lockedRange.startRow >= 0;
    }

    setRange(startRow: number, startColumn: number, endRow: number, endColumn: number): void {
        this.row = startRow;
        this.column = startColumn;
        this.anchor = { row: startRow, column: startColumn };
        this.focus = { row: endRow, column: endColumn };
        this.clearLockedRange();
        this.updateRenderer();
    }

    /**
     * 範囲選択を維持したままアンカー位置だけを移動する（Enter/Tabキー用）
     * 範囲選択をlockedRangeに保存し、アンカー位置だけを移動する
     */
    moveWithinRange(row: number, column: number): void {
        // 初回呼び出し時に現在の選択範囲をロック
        if (!this.hasLockedRange()) {
            this.lockedRange = this.getSelectionRange();
        }
        this.row = row;
        this.column = column;
        this.anchor = { row, column };
        this.updateRenderer();
    }

    start(row: number, column: number): void {
        // ヘッダー（行0、列0）は選択できない
        if (row < 1 || column < 1) return;

        this.selecting = true;
        this.row = row;
        this.column = column;
        this.anchor = { row, column };
        this.focus = { row, column };
        this.clearLockedRange();
        this.updateRenderer();
    }

    update(row: number, column: number): void {
        if (!this.selecting) return;

        // ヘッダー（行0、列0）は選択できない
        if (row < 1 || column < 1) return;

        this.focus = { row, column };
        this.updateRenderer();
    }

    end(): void {
        this.selecting = false;
        this.selectingColumn = false;
        this.selectingRow = false;
    }

    /**
     * 列全体を選択する（列ヘッダークリック時）
     */
    selectColumn(column: number): void {
        const rowCount = this.tableElement.children.length;
        if (rowCount < 2) return;

        this.row = 1;
        this.column = column;
        this.anchor = { row: 1, column: column };
        this.focus = { row: rowCount - 1, column: column };
        this.selecting = true;
        this.selectingColumn = true;
        this.selectingRow = false;
        this.clearLockedRange();
        this.updateRenderer();
    }

    /**
     * 行全体を選択する（行ヘッダークリック時）
     */
    selectRow(row: number): void {
        if (row < 1) return;

        const firstRow = this.tableElement.children[0] as HTMLElement;
        if (!firstRow) return;
        const columnCount = firstRow.children.length;
        if (columnCount < 2) return;

        this.row = row;
        this.column = 1;
        this.anchor = { row: row, column: 1 };
        this.focus = { row: row, column: columnCount - 1 };
        this.selecting = true;
        this.selectingColumn = false;
        this.selectingRow = true;
        this.clearLockedRange();
        this.updateRenderer();
    }

    /**
     * 現在のアンカーから指定した列まで選択を拡張する（Shift+列ヘッダークリック時）
     */
    extendToColumn(column: number): void {
        const rowCount = this.tableElement.children.length;
        if (rowCount < 2) return;

        // アンカーを保持したまま、フォーカスを新しい列に拡張
        this.anchor = { row: 1, column: this.anchor.column };
        this.focus = { row: rowCount - 1, column: column };
        this.row = 1;
        this.column = column;
        this.clearLockedRange();
        this.updateRenderer();
    }

    /**
     * 現在のアンカーから指定した行まで選択を拡張する（Shift+行ヘッダークリック時）
     */
    extendToRow(row: number): void {
        if (row < 1) return;

        const firstRow = this.tableElement.children[0] as HTMLElement;
        if (!firstRow) return;
        const columnCount = firstRow.children.length;
        if (columnCount < 2) return;

        // アンカーを保持したまま、フォーカスを新しい行に拡張
        this.anchor = { row: this.anchor.row, column: 1 };
        this.focus = { row: row, column: columnCount - 1 };
        this.row = row;
        this.column = 1;
        this.clearLockedRange();
        this.updateRenderer();
    }

    /**
     * 現在の選択範囲に列を追加する（Ctrl+列ヘッダークリック時）
     */
    addColumn(column: number): void {
        const rowCount = this.tableElement.children.length;
        if (rowCount < 2) return;

        // 現在の選択範囲を取得
        const currentRange = this.getSelectionRange();

        // 新しい選択範囲を計算（列を含めるように拡張）
        const newStartColumn = Math.min(currentRange.startColumn, column);
        const newEndColumn = Math.max(currentRange.endColumn, column);

        // 行は全行を選択
        this.anchor = { row: 1, column: newStartColumn };
        this.focus = { row: rowCount - 1, column: newEndColumn };
        this.row = 1;
        this.column = column;
        this.selecting = true;
        this.clearLockedRange();
        this.updateRenderer();
    }

    /**
     * 全セルを選択する（左上コーナークリック時）
     */
    selectAll(): void {
        const rowCount = this.tableElement.children.length;
        if (rowCount < 2) return;

        const firstRow = this.tableElement.children[0] as HTMLElement;
        const columnCount = firstRow.children.length;
        if (columnCount < 2) return;

        this.row = 1;
        this.column = 1;
        this.anchor = { row: 1, column: 1 };
        this.focus = { row: rowCount - 1, column: columnCount - 1 };
        this.selecting = false;
        this.selectingColumn = false;
        this.selectingRow = false;
        this.clearLockedRange();
        this.updateRenderer();
    }

    /**
     * 現在の選択範囲に行を追加する（Ctrl+行ヘッダークリック時）
     */
    addRow(row: number): void {
        if (row < 1) return;

        const firstRow = this.tableElement.children[0] as HTMLElement;
        if (!firstRow) return;
        const columnCount = firstRow.children.length;
        if (columnCount < 2) return;

        // 現在の選択範囲を取得
        const currentRange = this.getSelectionRange();

        // 新しい選択範囲を計算（行を含めるように拡張）
        const newStartRow = Math.min(currentRange.startRow, row);
        const newEndRow = Math.max(currentRange.endRow, row);

        // 列は全列を選択
        this.anchor = { row: newStartRow, column: 1 };
        this.focus = { row: newEndRow, column: columnCount - 1 };
        this.row = row;
        this.column = 1;
        this.selecting = true;
        this.clearLockedRange();
        this.updateRenderer();
    }

    /**
     * フォーカスを移動して選択範囲を拡張する（Shift+矢印キー用）
     */
    extendSelection(row: number, column: number): void {
        this.focus = { row, column };
        this.row = row;
        this.column = column;
        this.clearLockedRange();
        this.updateRenderer();
    }

    isSelecting(): boolean {
        return this.selecting;
    }

    isSelectingColumn(): boolean {
        return this.selectingColumn;
    }

    isSelectingRow(): boolean {
        return this.selectingRow;
    }

    /**
     * 列選択のドラッグ更新（列ヘッダーをドラッグ中に呼ばれる）
     */
    updateColumn(column: number): void {
        if (!this.selectingColumn) return;
        if (column < 1) return;

        const rowCount = this.tableElement.children.length;
        if (rowCount < 2) return;

        const firstRow = this.tableElement.children[0] as HTMLElement;
        const columnCount = firstRow.children.length;
        if (columnCount < 2) return;
        if (column >= columnCount) return;

        this.focus = { row: rowCount - 1, column: column };
        this.column = column;
        this.updateRenderer();
    }

    /**
     * 行選択のドラッグ更新（行ヘッダーをドラッグ中に呼ばれる）
     */
    updateRow(row: number): void {
        if (!this.selectingRow) return;
        if (row < 1) return;

        const rowCount = this.tableElement.children.length;
        if (rowCount < 2) return;
        if (row >= rowCount) return;

        const firstRow = this.tableElement.children[0] as HTMLElement;
        const columnCount = firstRow.children.length;
        if (columnCount < 2) return;

        this.focus = { row: row, column: columnCount - 1 };
        this.row = row;
        this.updateRenderer();
    }

    isSingleCell(): boolean {
        // lockedRangeがある場合は、その範囲が単一セルかどうかを判定
        if (this.hasLockedRange()) {
            return this.lockedRange.startRow === this.lockedRange.endRow &&
                   this.lockedRange.startColumn === this.lockedRange.endColumn;
        }
        return this.anchor.row === this.focus.row && this.anchor.column === this.focus.column;
    }

    getAnchor(): CellPosition {
        return this.anchor;
    }

    getFocus(): CellPosition {
        return this.focus;
    }

    getSelectionRange(): CellRange {
        // lockedRangeがある場合はそれを返す（Enter/Tabキーでの範囲内移動中）
        if (this.hasLockedRange()) {
            return this.lockedRange;
        }
        return {
            startRow: Math.min(this.anchor.row, this.focus.row),
            startColumn: Math.min(this.anchor.column, this.focus.column),
            endRow: Math.max(this.anchor.row, this.focus.row),
            endColumn: Math.max(this.anchor.column, this.focus.column)
        };
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

        // システムクリップボードにコピー
        this.copyToClipboard(startRow, startColumn, endRow, endColumn);
    }

    /**
     * 選択範囲をシステムクリップボードにコピーする
     */
    private copyToClipboard(startRow: number, startColumn: number, endRow: number, endColumn: number): void {
        const rows: string[] = [];

        for (let r = startRow; r <= endRow; r++) {
            const rowElement = this.tableElement.children[r] as HTMLElement;
            if (!rowElement) continue;

            const cells: string[] = [];
            for (let c = startColumn; c <= endColumn; c++) {
                const cell = rowElement.children[c] as HTMLElement;
                cells.push(cell.textContent ?? '');
            }
            rows.push(cells.join('\t'));
        }

        const textData = rows.join('\n');

        // HTML形式も作成（Excelやスプレッドシートでより良い形式で貼り付けられる）
        const htmlRows: string[] = [];
        for (let r = startRow; r <= endRow; r++) {
            const rowElement = this.tableElement.children[r] as HTMLElement;
            if (!rowElement) continue;

            const htmlCells: string[] = [];
            for (let c = startColumn; c <= endColumn; c++) {
                const cell = rowElement.children[c] as HTMLElement;
                const content = this.escapeHtml(cell.textContent ?? '');
                htmlCells.push(`<td>${content}</td>`);
            }
            htmlRows.push(`<tr>${htmlCells.join('')}</tr>`);
        }
        const htmlData = `<table>${htmlRows.join('')}</table>`;

        // クリップボードに書き込み
        navigator.clipboard.write([
            new ClipboardItem({
                'text/plain': new Blob([textData], { type: 'text/plain' }),
                'text/html': new Blob([htmlData], { type: 'text/html' })
            })
        ]).catch(err => {
            console.error('クリップボードへの書き込みに失敗しました:', err);
        });
    }

    /**
     * HTML特殊文字をエスケープする
     */
    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
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

    /**
     * コピー範囲を設定する（Undo/Redo用）
     */
    setCopyRange(range: CellRange): void {
        if (range.startRow < 0) {
            this.clearCopyRange();
        } else {
            this.copyRange = range;
            this.updateCopyRenderer();
        }
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

        // lockedRangeがある場合はそれを使用し、なければanchor/focusから計算
        let startRow: number;
        let startColumn: number;
        let endRow: number;
        let endColumn: number;

        if (this.hasLockedRange()) {
            startRow = this.lockedRange.startRow;
            startColumn = this.lockedRange.startColumn;
            endRow = this.lockedRange.endRow;
            endColumn = this.lockedRange.endColumn;
        } else {
            startRow = Math.min(this.anchor.row, this.focus.row);
            startColumn = Math.min(this.anchor.column, this.focus.column);
            endRow = Math.max(this.anchor.row, this.focus.row);
            endColumn = Math.max(this.anchor.column, this.focus.column);
        }

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
