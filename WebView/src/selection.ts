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

    element: HTMLElement;

    private focusColumnBackground: HTMLElement;

    private otherColumnsBackground: HTMLElement;

    copyBorderElement: HTMLElement;

    fillPreviewElement: HTMLElement;

    private range: CellRange;

    private focus: CellPosition;

    private selecting: boolean;

    private selectingColumn: boolean;

    private selectingRow: boolean;

    private tableElement: HTMLElement;

    private editorElement: HTMLElement;

    private copyRange: CellRange;

    private fillHandle: HTMLElement;

    private filling: boolean;

    private fillTarget: CellPosition;

    constructor(tableElement: HTMLElement, editorElement: HTMLElement) {
        // 初期位置はA1（row=1, column=1）、row=0は列ヘッダー、column=0は行ヘッダー
        this.range = { startRow: 1, startColumn: 1, endRow: 1, endColumn: 1 };
        this.focus = { row: 1, column: 1 }; // constructor 初期設定
        this.selecting = false;
        this.selectingColumn = false;
        this.selectingRow = false;
        this.tableElement = tableElement;
        this.editorElement = editorElement;
        this.copyRange = { startRow: -1, startColumn: -1, endRow: -1, endColumn: -1 };
        this.filling = false;
        this.fillTarget = { row: 0, column: 0 };

        // 選択範囲表示用の要素を作成
        const element = document.createElement('div');
        element.classList.add('selection');
        this.element = element;

        const focusColumnBackground = document.createElement('div');
        focusColumnBackground.classList.add('selection-background');
        this.focusColumnBackground = focusColumnBackground;
        this.element.appendChild(focusColumnBackground);

        const otherColumnsBackground = document.createElement('div');
        otherColumnsBackground.classList.add('selection-background');
        this.otherColumnsBackground = otherColumnsBackground;
        this.element.appendChild(otherColumnsBackground);

        // コピー範囲表示用の要素を作成
        const copyBorderElement = document.createElement('div');
        copyBorderElement.classList.add('copy-border');
        this.copyBorderElement = copyBorderElement;

        // フィルプレビュー範囲表示用の要素を作成
        const fillPreviewElement = document.createElement('div');
        fillPreviewElement.classList.add('fill-preview');
        this.fillPreviewElement = fillPreviewElement;

        // フィルハンドル要素を作成
        this.fillHandle = document.createElement('div');
        this.fillHandle.classList.add('fill-handle');
        this.editorElement.appendChild(this.fillHandle);
    }

    /**
     * フォーカスを移動します。範囲選択は変更しません。
     * @param row
     * @param column
     */
    move(row: number, column: number): void {
        row = Math.max(1, row);
        column = Math.max(1, column);

        this.focus = { row, column }; // move フォーカスを移動します。範囲選択の変更なし
        this.scrollFocusIntoView();
        this.updateRenderer();
    }

    /**
     * 選択範囲を設定します。フォーカスは移動しません。
     * @param startRow
     * @param startColumn
     * @param endRow
     * @param endColumn
     */
    setRange(startRow: number, startColumn: number, endRow: number, endColumn: number): void {
        startRow = Math.max(1, startRow);
        startColumn = Math.max(1, startColumn);
        endRow = Math.max(1, endRow);
        endColumn = Math.max(1, endColumn);

        this.range = { startRow, startColumn, endRow, endColumn };
        this.updateRenderer();
    }

    start(row: number, column: number): void {
        row = Math.max(1, row);
        column = Math.max(1, column);

        this.selecting = true;
        this.range = { startRow: row, startColumn: column, endRow: row, endColumn: column };
        this.focus = { row, column }; // start 選択開始位置にフォーカスを設定
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
        console.log('[selectColumn] column:', column);
        const rowCount = this.tableElement.children.length;
        if (rowCount < 2) return;

        this.range = { startRow: 1, startColumn: column, endRow: rowCount - 1, endColumn: column };
        this.focus = { row: 1, column: column }; // selectColumn 列ヘッダークリック
        this.selecting = true;
        this.selectingColumn = true;
        this.selectingRow = false;
        this.updateRenderer();
    }

    /**
     * 行全体を選択する（行ヘッダークリック時）
     */
    selectRow(row: number): void {
        console.log('[selectRow] row:', row);
        if (row < 1) return;

        const firstRow = this.tableElement.children[0] as HTMLElement;
        if (!firstRow) return;
        const columnCount = firstRow.children.length;
        if (columnCount < 2) return;

        this.range = { startRow: row, startColumn: 1, endRow: row, endColumn: columnCount - 1 };
        this.focus = { row: row, column: 1 }; // selectRow 行ヘッダークリック
        this.selecting = true;
        this.selectingColumn = false;
        this.selectingRow = true;
        this.updateRenderer();
    }

    /**
     * 現在のアンカーから指定した列まで選択を拡張する（Shift+列ヘッダークリック時）
     */
    extendToColumn(column: number): void {
        console.log('[extendToColumn] column:', column);
        const rowCount = this.tableElement.children.length;
        if (rowCount < 2) return;

        // アンカー（startColumn）を保持したまま、endColumnを新しい列に拡張
        this.range = { startRow: 1, startColumn: this.range.startColumn, endRow: rowCount - 1, endColumn: column };
        this.updateRenderer();
    }

    /**
     * 現在のアンカーから指定した行まで選択を拡張する（Shift+行ヘッダークリック時）
     */
    extendToRow(row: number): void {
        console.log('[extendToRow] row:', row);
        if (row < 1) return;

        const firstRow = this.tableElement.children[0] as HTMLElement;
        if (!firstRow) return;
        const columnCount = firstRow.children.length;
        if (columnCount < 2) return;

        // アンカー（startRow）を保持したまま、endRowを新しい行に拡張
        this.range = { startRow: this.range.startRow, startColumn: 1, endRow: row, endColumn: columnCount - 1 };
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

        this.range = { startRow: 1, startColumn: 1, endRow: rowCount - 1, endColumn: columnCount - 1 };
        this.focus = { row: 1, column: 1 }; // selectAll 左上コーナークリック
        this.selecting = false;
        this.selectingColumn = false;
        this.selectingRow = false;
        this.updateRenderer();
    }

    /**
     * 現在の選択範囲に列を追加する（Ctrl+列ヘッダークリック時）
     */
    addColumn(column: number): void {
        console.log('[addColumn] column:', column);
        const rowCount = this.tableElement.children.length;
        if (rowCount < 2) return;

        // 新しい選択範囲を計算（列を含めるように拡張）
        const newStartColumn = Math.min(this.range.startColumn, column);
        const newEndColumn = Math.max(this.range.endColumn, column);

        // 行は全行を選択
        this.range = { startRow: 1, startColumn: newStartColumn, endRow: rowCount - 1, endColumn: newEndColumn };
        this.selecting = true;
        this.updateRenderer();
    }

    /**
     * 現在の選択範囲に行を追加する（Ctrl+行ヘッダークリック時）
     */
    addRow(row: number): void {
        console.log('[addRow] row:', row);
        if (row < 1) return;

        const firstRow = this.tableElement.children[0] as HTMLElement;
        if (!firstRow) return;
        const columnCount = firstRow.children.length;
        if (columnCount < 2) return;

        // 新しい選択範囲を計算（行を含めるように拡張）
        const newStartRow = Math.min(this.range.startRow, row);
        const newEndRow = Math.max(this.range.endRow, row);

        // 列は全列を選択
        this.range = { startRow: newStartRow, startColumn: 1, endRow: newEndRow, endColumn: columnCount - 1 };
        this.selecting = true;
        this.updateRenderer();
    }

    /**
     * フォーカスを移動して選択範囲を拡張する（絶対座標用）
     * マウス操作による範囲選択は絶対座標的なものです。
     */
    extendSelection(row: number, column: number): void {
        this.range = {
            ...this.range,
            endRow: Math.max(1, row),
            endColumn: Math.max(1, column)
        };
        this.updateRenderer();
    }

    /**
     * フォーカスを移動して選択範囲を拡張する（相対座標用）
     * 矢印キーは相対的に範囲を操作します。
     */
    extendSelectionOffset(x: number, y: number): void {
        this.range = { 
            ...this.range,
            endRow: Math.max(1, this.range.endRow + y),
            endColumn: Math.max(1, this.range.endColumn + x)
        };
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
        console.log('[updateColumn] column:', column, 'selectingColumn:', this.selectingColumn);
        if (!this.selectingColumn) return;
        if (column < 1) return;

        const rowCount = this.tableElement.children.length;
        if (rowCount < 2) return;

        const firstRow = this.tableElement.children[0] as HTMLElement;
        const columnCount = firstRow.children.length;
        if (columnCount < 2) return;
        if (column >= columnCount) return;

        this.range = { ...this.range, endColumn: column };
        this.updateRenderer();
    }

    /**
     * 行選択のドラッグ更新（行ヘッダーをドラッグ中に呼ばれる）
     */
    updateRow(row: number): void {
        console.log('[updateRow] row:', row, 'selectingRow:', this.selectingRow);
        if (!this.selectingRow) return;
        if (row < 1) return;

        const rowCount = this.tableElement.children.length;
        if (rowCount < 2) return;
        if (row >= rowCount) return;

        const firstRow = this.tableElement.children[0] as HTMLElement;
        const columnCount = firstRow.children.length;
        if (columnCount < 2) return;

        this.range = { ...this.range, endRow: row };
        this.updateRenderer();
    }

    isSingleCell(): boolean {
        return this.range.startRow === this.range.endRow && this.range.startColumn === this.range.endColumn;
    }

    getAnchor(): CellPosition {
        return { row: this.range.startRow, column: this.range.startColumn };
    }

    getFocus(): CellPosition {
        return this.focus;
    }

    getRange(): CellRange {
        return this.range;
    }

    getSelectionRange(): CellRange {
        return {
            startRow: Math.min(this.range.startRow, this.range.endRow),
            startColumn: Math.min(this.range.startColumn, this.range.endColumn),
            endRow: Math.max(this.range.startRow, this.range.endRow),
            endColumn: Math.max(this.range.startColumn, this.range.endColumn)
        };
    }

    getCopyRange(): CellRange {
        return this.copyRange;
    }

    hasCopyRange(): boolean {
        return this.copyRange.startRow >= 0;
    }

    copy(): void {
        const selectionRange = this.getSelectionRange();

        this.copyRange = selectionRange;
        this.updateCopyRenderer();

        // システムクリップボードにコピー
        this.copyToClipboard(selectionRange.startRow, selectionRange.startColumn, selectionRange.endRow, selectionRange.endColumn);
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
        this.copyRange = { startRow: -1, startColumn: -1, endRow: -1, endColumn: -1 };
        this.hideCopyBorder();
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
        if (!this.hasCopyRange()) {
            this.hideCopyBorder();
            return;
        }

        const { startRow, startColumn, endRow, endColumn } = this.copyRange;

        const tableRect = this.tableElement.getBoundingClientRect();

        const startCell = this.tableElement.children[startRow]?.children[startColumn] as HTMLElement | undefined;
        const endCell = this.tableElement.children[endRow]?.children[endColumn] as HTMLElement | undefined;

        if (!startCell || !endCell) {
            this.hideCopyBorder();
            return;
        }

        const startRect = startCell.getBoundingClientRect();
        const endRect = endCell.getBoundingClientRect();

        const left = Math.round(startRect.left - tableRect.left - 1);
        const top = Math.round(startRect.top - tableRect.top - 1);
        const width = Math.round(endRect.right - startRect.left - 1);
        const height = Math.round(endRect.bottom - startRect.top - 1);

        this.copyBorderElement.style.left = left + 'px';
        this.copyBorderElement.style.top = top + 'px';
        this.copyBorderElement.style.width = width + 'px';
        this.copyBorderElement.style.height = height + 'px';
        this.copyBorderElement.style.display = 'block';
    }

    private updateRenderer(): void {
        const selectionRange = this.getSelectionRange();
        const { startRow, startColumn, endRow, endColumn } = selectionRange;

        const tableRect = this.tableElement.getBoundingClientRect();

        const startCell = this.tableElement.children[startRow]?.children[startColumn] as HTMLElement | undefined;
        const endCell = this.tableElement.children[endRow]?.children[endColumn] as HTMLElement | undefined;
        const focusCell = this.tableElement.children[this.focus.row]?.children[this.focus.column] as HTMLElement | undefined;

        if (!startCell || !endCell || !focusCell) {
            this.hideRenderer();
            return;
        }

        const startRect = startCell.getBoundingClientRect();
        const endRect = endCell.getBoundingClientRect();
        const focusRect = focusCell.getBoundingClientRect();

        const left = Math.round(startRect.left - tableRect.left - 1);
        const top = Math.round(startRect.top - tableRect.top - 1);
        const width = Math.round(endRect.right - startRect.left - 1);
        const height = Math.round(endRect.bottom - startRect.top - 1);

        this.element.style.left = left + 'px';
        this.element.style.top = top + 'px';
        this.element.style.width = width + 'px';
        this.element.style.height = height + 'px';

        // 背景要素の位置を設定（フォーカスセルを除く）
        this.updateBackgroundElements(startRect, endRect, focusRect);

        // フィルハンドルの位置を更新
        this.updateFillHandlePosition();

        // ヘッダーの選択状態を更新
        this.updateHeaderSelection(selectionRange);
    }

    private scrollFocusIntoView(): void {
        const focusCell = this.tableElement.children[this.focus.row]?.children[this.focus.column] as HTMLElement | undefined;
        if (!focusCell) return;
        focusCell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    /**
     * リサイズ後に描画領域を更新する（area-resizerから呼び出される）
     */
    updateRendererAfterResize(): void {
        // 選択範囲を更新
        this.updateRenderer();

        // コピー範囲を更新
        if (this.hasCopyRange()) {
            this.updateCopyRenderer();
        }

        // フィルプレビューを更新
        if (this.filling) {
            this.updateFillPreview();
        }
    }

    private updateFillHandlePosition(): void {
        const selectionRange = this.getSelectionRange();
        const endRow = selectionRange.endRow;
        const endColumn = selectionRange.endColumn;

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

    private updateBackgroundElements(startRect: DOMRect, endRect: DOMRect, focusRect: DOMRect): void {
        // フォーカスの位置判定はセル座標で行う（浮動小数点誤差を避ける）
        const isFocusTop = this.focus.row <= this.range.endRow;
        const isFocusLeft = this.focus.column <= this.range.endColumn;

        // 座標計算は最後にまとめて整数化する
        const focusLeftPx = Math.floor(focusRect.left - startRect.left);
        const focusTopPx = Math.floor(focusRect.top - startRect.top);
        const focusWidth = Math.ceil(focusRect.width);
        const focusHeight = Math.ceil(focusRect.height);
        const totalWidth = Math.ceil(endRect.right - startRect.left);
        const totalHeight = Math.ceil(endRect.bottom - startRect.top);

        // 単一セルの場合は背景を非表示
        if (this.isSingleCell()) {
            this.focusColumnBackground.style.display = 'none';
            this.otherColumnsBackground.style.display = 'none';
            return;
        }

        this.focusColumnBackground.style.display = 'block';
        this.otherColumnsBackground.style.display = 'block';

        if (isFocusTop && isFocusLeft) {
            // フォーカスが左上
            // focusColumn: フォーカスの下から最下部まで（フォーカス列）
            this.focusColumnBackground.style.left = '0px';
            this.focusColumnBackground.style.top = focusHeight + 'px';
            this.focusColumnBackground.style.width = focusWidth + 'px';
            this.focusColumnBackground.style.height = (totalHeight - focusHeight) + 'px';
            // otherColumns: フォーカスの右隣から右下まで
            this.otherColumnsBackground.style.left = focusWidth + 'px';
            this.otherColumnsBackground.style.top = '0px';
            this.otherColumnsBackground.style.width = (totalWidth - focusWidth) + 'px';
            this.otherColumnsBackground.style.height = totalHeight + 'px';
        } else if (isFocusTop && !isFocusLeft) {
            // フォーカスが右上
            // focusColumn: フォーカスの下から最下部まで（フォーカス列）
            this.focusColumnBackground.style.left = focusLeftPx + 'px';
            this.focusColumnBackground.style.top = focusHeight + 'px';
            this.focusColumnBackground.style.width = focusWidth + 'px';
            this.focusColumnBackground.style.height = (totalHeight - focusHeight) + 'px';
            // otherColumns: 左端からフォーカスの左隣まで
            this.otherColumnsBackground.style.left = '0px';
            this.otherColumnsBackground.style.top = '0px';
            this.otherColumnsBackground.style.width = focusLeftPx + 'px';
            this.otherColumnsBackground.style.height = totalHeight + 'px';
        } else if (!isFocusTop && isFocusLeft) {
            // フォーカスが左下
            // focusColumn: 最上部からフォーカスの上まで（フォーカス列）
            this.focusColumnBackground.style.left = '0px';
            this.focusColumnBackground.style.top = '0px';
            this.focusColumnBackground.style.width = focusWidth + 'px';
            this.focusColumnBackground.style.height = focusTopPx + 'px';
            // otherColumns: フォーカスの右隣から右下まで
            this.otherColumnsBackground.style.left = focusWidth + 'px';
            this.otherColumnsBackground.style.top = '0px';
            this.otherColumnsBackground.style.width = (totalWidth - focusWidth) + 'px';
            this.otherColumnsBackground.style.height = totalHeight + 'px';
        } else {
            // フォーカスが右下
            // focusColumn: 最上部からフォーカスの上まで（フォーカス列）
            this.focusColumnBackground.style.left = focusLeftPx + 'px';
            this.focusColumnBackground.style.top = '0px';
            this.focusColumnBackground.style.width = focusWidth + 'px';
            this.focusColumnBackground.style.height = focusTopPx + 'px';
            // otherColumns: 左端からフォーカスの左隣まで
            this.otherColumnsBackground.style.left = '0px';
            this.otherColumnsBackground.style.top = '0px';
            this.otherColumnsBackground.style.width = focusLeftPx + 'px';
            this.otherColumnsBackground.style.height = totalHeight + 'px';
        }
    }

    private hideRenderer(): void {
        this.element.style.left = '-99999px';
        this.element.style.top = '-99999px';
        this.element.style.width = '0px';
        this.element.style.height = '0px';
    }

    /**
     * 選択範囲に基づいてヘッダーの選択状態を更新する
     */
    private updateHeaderSelection(selectionRange: CellRange): void {
        const { startRow, startColumn, endRow, endColumn } = selectionRange;

        // 列ヘッダー行を取得
        const columnHeaderRow = this.tableElement.children[0] as HTMLElement;

        // すべての列ヘッダーから選択状態を解除
        for (let i = 1; i < columnHeaderRow.children.length; i++) {
            const headerCell = columnHeaderRow.children[i] as HTMLElement;
            headerCell.classList.remove('selected');
        }

        // すべての行ヘッダーから選択状態を解除
        for (let i = 1; i < this.tableElement.children.length; i++) {
            const row = this.tableElement.children[i] as HTMLElement;
            const rowHeader = row.children[0] as HTMLElement;
            if (rowHeader.classList.contains('editor-table-row-header')) {
                rowHeader.classList.remove('selected');
            }
        }

        // 選択範囲に含まれる列ヘッダーに選択状態を追加
        for (let col = startColumn; col <= endColumn; col++) {
            const headerCell = columnHeaderRow.children[col] as HTMLElement;
            if (headerCell) {
                headerCell.classList.add('selected');
            }
        }

        // 選択範囲に含まれる行ヘッダーに選択状態を追加
        for (let row = startRow; row <= endRow; row++) {
            const rowElement = this.tableElement.children[row] as HTMLElement;
            if (rowElement) {
                const rowHeader = rowElement.children[0] as HTMLElement;
                if (rowHeader.classList.contains('editor-table-row-header')) {
                    rowHeader.classList.add('selected');
                }
            }
        }
    }

    private hideCopyBorder(): void {
        this.copyBorderElement.style.display = 'none';
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
        const selectionRange = this.getSelectionRange();
        const { startRow, startColumn, endRow, endColumn } = selectionRange;

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
        const fillInfo = this.getFillInfo();
        if (!fillInfo) {
            this.clearFillPreview();
            return;
        }

        const { targetRange } = fillInfo;

        const tableRect = this.tableElement.getBoundingClientRect();

        const startCell = this.tableElement.children[targetRange.startRow]?.children[targetRange.startColumn] as HTMLElement | undefined;
        const endCell = this.tableElement.children[targetRange.endRow]?.children[targetRange.endColumn] as HTMLElement | undefined;

        if (!startCell || !endCell) {
            this.clearFillPreview();
            return;
        }

        const startRect = startCell.getBoundingClientRect();
        const endRect = endCell.getBoundingClientRect();

        const left = Math.round(startRect.left - tableRect.left - 1);
        const top = Math.round(startRect.top - tableRect.top - 1);
        const width = Math.round(endRect.right - startRect.left - 1);
        const height = Math.round(endRect.bottom - startRect.top - 1);

        this.fillPreviewElement.style.left = left + 'px';
        this.fillPreviewElement.style.top = top + 'px';
        this.fillPreviewElement.style.width = width + 'px';
        this.fillPreviewElement.style.height = height + 'px';
        this.fillPreviewElement.style.display = 'block';
    }

    private clearFillPreview(): void {
        this.fillPreviewElement.style.display = 'none';
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
