import {ScrollViewportController} from "./scroll-viewport-controller";
import type {EditorTable} from "./editor-table";

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

    /** フォーカスセルの上の領域（選択範囲の全幅） */
    private topBackground: HTMLElement;

    /** フォーカスセルの下の領域（選択範囲の全幅） */
    private bottomBackground: HTMLElement;

    /** フォーカスセルの左の領域（フォーカス行のみ） */
    private leftBackground: HTMLElement;

    /** フォーカスセルの右の領域（フォーカス行のみ） */
    private rightBackground: HTMLElement;

    copyBorderElement: HTMLElement;

    fillPreviewElement: HTMLElement;

    private range: CellRange;

    private focus: CellPosition;

    private selecting: boolean;

    private selectingColumn: boolean;

    private selectingRow: boolean;

    private editorTable: EditorTable;

    private editorElement: HTMLElement;

    private copyRange: CellRange;

    private fillHandle: HTMLElement;

    private filling: boolean;

    private fillTarget: CellPosition;

    private fillStartMousePosition: { x: number; y: number };

    private fillCurrentMousePosition: { x: number; y: number };

    private scrollBinding: ScrollViewportController;

    constructor(editorTable: EditorTable, editorElement: HTMLElement, scrollBinding: ScrollViewportController) {
        // 初期位置はA1（row=1, column=1）、row=0は列ヘッダー、column=0は行ヘッダー
        this.range = { startRow: 1, startColumn: 1, endRow: 1, endColumn: 1 };
        this.focus = { row: 1, column: 1 }; // constructor 初期設定
        this.selecting = false;
        this.selectingColumn = false;
        this.selectingRow = false;
        this.editorTable = editorTable;
        this.editorElement = editorElement;
        this.scrollBinding = scrollBinding;
        this.copyRange = { startRow: -1, startColumn: -1, endRow: -1, endColumn: -1 };
        this.filling = false;
        this.fillTarget = { row: 0, column: 0 };
        this.fillStartMousePosition = { x: 0, y: 0 };
        this.fillCurrentMousePosition = { x: 0, y: 0 };

        // 選択範囲表示用の要素を作成
        const element = document.createElement('div');
        element.classList.add('selection');
        this.element = element;

        // 4つの背景要素を作成（フォーカスセルを囲む上・下・左・右の領域）
        const topBackground = document.createElement('div');
        topBackground.classList.add('selection-background');
        this.topBackground = topBackground;
        this.element.appendChild(topBackground);

        const bottomBackground = document.createElement('div');
        bottomBackground.classList.add('selection-background');
        this.bottomBackground = bottomBackground;
        this.element.appendChild(bottomBackground);

        const leftBackground = document.createElement('div');
        leftBackground.classList.add('selection-background');
        this.leftBackground = leftBackground;
        this.element.appendChild(leftBackground);

        const rightBackground = document.createElement('div');
        rightBackground.classList.add('selection-background');
        this.rightBackground = rightBackground;
        this.element.appendChild(rightBackground);

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
        const rowCount = this.editorTable.getRowCount();
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
        if (row < 1) return;

        const columnCount = this.editorTable.getTotalColumnCount();
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
        const rowCount = this.editorTable.getRowCount();
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

        const columnCount = this.editorTable.getTotalColumnCount();
        if (columnCount < 2) return;

        // アンカー（startRow）を保持したまま、endRowを新しい行に拡張
        this.range = { startRow: this.range.startRow, startColumn: 1, endRow: row, endColumn: columnCount - 1 };
        this.updateRenderer();
    }

    /**
     * 全セルを選択する（左上コーナークリック時）
     */
    selectAll(): void {
        const rowCount = this.editorTable.getRowCount();
        if (rowCount < 2) return;

        const columnCount = this.editorTable.getTotalColumnCount();
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
        const rowCount = this.editorTable.getRowCount();
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

        const columnCount = this.editorTable.getTotalColumnCount();
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
     * 選択範囲を拡張する（絶対座標用）
     * マウス操作による範囲選択は絶対座標的なものです。
     * フォーカスは移動しません（選択開始位置に固定）。
     */
    extendSelection(row: number, column: number): void {
        const endRow = Math.max(1, row);
        const endColumn = Math.max(1, column);
        this.range = {
            ...this.range,
            endRow: endRow,
            endColumn: endColumn
        };
        this.updateRenderer();
    }

    /**
     * 選択範囲を拡張する（相対座標用）
     * 矢印キーは相対的に範囲を操作します。
     * フォーカスは移動しません（選択開始位置に固定）。
     * @param x 列方向のオフセット
     * @param y 行方向のオフセット
     * @param maxRow 最大行インデックス（テーブルの行数-1）
     * @param maxColumn 最大列インデックス（テーブルの列数-1）
     */
    extendSelectionOffset(x: number, y: number, maxRow: number, maxColumn: number): void {
        const nextEndRow = this.range.endRow + y;
        const nextEndColumn = this.range.endColumn + x;

        const endRow = Math.max(1, Math.min(nextEndRow, maxRow));
        const endColumn = Math.max(1, Math.min(nextEndColumn, maxColumn));
        this.range = {
            ...this.range,
            endRow: endRow,
            endColumn: endColumn
        };
        this.updateRenderer();
        this.scrollCellIntoView(endRow, endColumn);
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

        const rowCount = this.editorTable.getRowCount();
        if (rowCount < 2) return;

        const columnCount = this.editorTable.getTotalColumnCount();
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

        const rowCount = this.editorTable.getRowCount();
        if (rowCount < 2) return;
        if (row >= rowCount) return;

        const columnCount = this.editorTable.getTotalColumnCount();
        if (columnCount < 2) return;

        this.range = { ...this.range, endRow: row };
        this.updateRenderer();
    }

    /**
     * focus行のRelationsPanel通知を強制発火する。
     * - タブ切り替え時・新規オープン時（tab.ts enableTabButton / createTabState から呼ばれる）
     * - セル値変更後に同一行のままパネルを再描画するとき（editor-table.ts から呼ばれる）
     */
    forceNotifyRelationsPanel(): void {
        this.editorTable.notifyRowSelectionChanged(this.focus.row);
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
            const cells: string[] = [];
            for (let c = startColumn; c <= endColumn; c++) {
                const value = this.editorTable.getCellValueAt(r, c);
                cells.push(value);
            }
            rows.push(cells.join('\t'));
        }

        const textData = rows.join('\n');

        // HTML形式も作成（Excelやスプレッドシートでより良い形式で貼り付けられる）
        const htmlRows: string[] = [];
        for (let r = startRow; r <= endRow; r++) {
            const htmlCells: string[] = [];
            for (let c = startColumn; c <= endColumn; c++) {
                const value = this.editorTable.getCellValueAt(r, c);
                const content = this.escapeHtml(value);
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

        const tableRect = this.editorTable.getTableBoundingClientRect();

        const startRect = this.editorTable.getCellRectOrNull(startRow, startColumn);
        const endRect = this.editorTable.getCellRectOrNull(endRow, endColumn);

        if (!startRect || !endRect) {
            this.hideCopyBorder();
            return;
        }

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

        const tableRect = this.editorTable.getTableBoundingClientRect();

        const startRect = this.editorTable.getCellRectOrNull(startRow, startColumn);
        const endRect = this.editorTable.getCellRectOrNull(endRow, endColumn);
        const focusRect = this.editorTable.getCellRectOrNull(this.focus.row, this.focus.column);

        if (!startRect || !endRect || !focusRect) {
            this.hideRenderer();
            return;
        }

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
        this.editorTable.updateHeaderSelection(startRow, startColumn, endRow, endColumn);

        // フォーカス行が変化したときにRelationsPanelへ通知する（重複制御はEditorTable側で行う）
        this.editorTable.notifyRowSelectionChanged(this.focus.row);
    }

    private scrollFocusIntoView(): void {
        this.scrollCellIntoView(this.focus.row, this.focus.column);
    }

    private scrollCellIntoView(row: number, column: number): void {
        const targetRect = this.editorTable.getCellRectOrNull(row, column);
        if (!targetRect) return;
        const containerRect = this.scrollBinding.getBoundingClientRect();
        const headerHeight = this.editorTable.getFirstRowHeight();
        const rowHeaderWidth = this.editorTable.getRowHeaderWidth();
        const { scrollbarWidth, scrollbarHeight } = this.scrollBinding.getScrollbarSize();

        const visibleTop = containerRect.top + headerHeight;
        const visibleBottom = containerRect.bottom - scrollbarHeight;
        const visibleLeft = containerRect.left + rowHeaderWidth;
        const visibleRight = containerRect.right - scrollbarWidth;

        let nextScrollTop = this.scrollBinding.getScrollTop();
        let nextScrollLeft = this.scrollBinding.getScrollLeft();
        console.log('[scroll] before', {
            row,
            column,
            scrollTop: nextScrollTop,
            scrollLeft: nextScrollLeft,
            visibleTop,
            visibleBottom,
            visibleLeft,
            visibleRight,
            targetTop: targetRect.top,
            targetBottom: targetRect.bottom,
            targetLeft: targetRect.left,
            targetRight: targetRect.right
        });

        if (targetRect.top < visibleTop) {
            nextScrollTop += targetRect.top - visibleTop;
        } else if (targetRect.bottom > visibleBottom) {
            nextScrollTop += targetRect.bottom - visibleBottom;
        }

        if (targetRect.left < visibleLeft) {
            nextScrollLeft += targetRect.left - visibleLeft;
        } else if (targetRect.right > visibleRight) {
            nextScrollLeft += targetRect.right - visibleRight;
        }

        if (nextScrollTop !== this.scrollBinding.getScrollTop() || nextScrollLeft !== this.scrollBinding.getScrollLeft()) {
            console.log('[scroll] apply', {
                row,
                column,
                nextScrollTop,
                nextScrollLeft
            });
            this.scrollBinding.setScrollPosition(nextScrollTop, nextScrollLeft);

            // ブラウザの慣性スクロール等により次フレームでスクロール位置が上書きされる場合があるため再適用
            const scrollBinding = this.scrollBinding;
            window.requestAnimationFrame(() => {
                console.log('[scroll] raf', {
                    row,
                    column,
                    expectedScrollTop: nextScrollTop,
                    expectedScrollLeft: nextScrollLeft,
                    actualScrollTop: scrollBinding.getScrollTop(),
                    actualScrollLeft: scrollBinding.getScrollLeft()
                });
                if (scrollBinding.getScrollTop() !== nextScrollTop || scrollBinding.getScrollLeft() !== nextScrollLeft) {
                    scrollBinding.setScrollPosition(nextScrollTop, nextScrollLeft);
                }
            });
        }
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

        const cellRect = this.editorTable.getCellRectOrNull(endRow, endColumn);
        if (!cellRect) return;

        // セルの右下にフィルハンドルを配置
        const editorRect = this.editorElement.getBoundingClientRect();

        this.fillHandle.style.left = (cellRect.right - editorRect.left + this.editorElement.scrollLeft - 4) + 'px';
        this.fillHandle.style.top = (cellRect.bottom - editorRect.top + this.editorElement.scrollTop - 4) + 'px';
        this.fillHandle.style.display = 'block';
    }

    private updateBackgroundElements(startRect: DOMRect, endRect: DOMRect, focusRect: DOMRect): void {
        // 座標計算は最後にまとめて整数化する
        const focusLeftPx = Math.floor(focusRect.left - startRect.left);
        const focusTopPx = Math.floor(focusRect.top - startRect.top);
        const focusWidth = Math.ceil(focusRect.width);
        const focusHeight = Math.ceil(focusRect.height);
        const totalWidth = Math.ceil(endRect.right - startRect.left);
        const totalHeight = Math.ceil(endRect.bottom - startRect.top);

        // 単一セルの場合は背景を非表示
        if (this.isSingleCell()) {
            this.hideBackgroundElements();
            return;
        }

        const topHeight = focusTopPx;
        const bottomTop = focusTopPx + focusHeight;
        const bottomHeight = totalHeight - bottomTop;
        const leftWidth = focusLeftPx;
        const rightLeft = focusLeftPx + focusWidth;
        const rightWidth = totalWidth - rightLeft;

        this.updateBackgroundElement(this.topBackground, 0, 0, totalWidth, topHeight);
        this.updateBackgroundElement(this.bottomBackground, 0, bottomTop, totalWidth, bottomHeight);
        this.updateBackgroundElement(this.leftBackground, 0, focusTopPx, leftWidth, focusHeight);
        this.updateBackgroundElement(this.rightBackground, rightLeft, focusTopPx, rightWidth, focusHeight);
    }

    private updateBackgroundElement(element: HTMLElement, left: number, top: number, width: number, height: number): void {
        if (width <= 0 || height <= 0) {
            element.style.display = 'none';
            return;
        }

        element.style.display = 'block';
        element.style.left = left + 'px';
        element.style.top = top + 'px';
        element.style.width = width + 'px';
        element.style.height = height + 'px';
    }

    private hideBackgroundElements(): void {
        this.topBackground.style.display = 'none';
        this.bottomBackground.style.display = 'none';
        this.leftBackground.style.display = 'none';
        this.rightBackground.style.display = 'none';
    }

    private hideRenderer(): void {
        this.element.style.left = '-99999px';
        this.element.style.top = '-99999px';
        this.element.style.width = '0px';
        this.element.style.height = '0px';
    }

    private hideCopyBorder(): void {
        this.copyBorderElement.style.display = 'none';
    }

    getFillHandle(): HTMLElement {
        return this.fillHandle;
    }

    startFill(row: number, column: number, mouseX: number, mouseY: number): void {
        this.filling = true;
        this.fillTarget = { row, column };
        this.fillStartMousePosition = { x: mouseX, y: mouseY };
        this.fillCurrentMousePosition = { x: mouseX, y: mouseY };
    }

    updateFill(row: number, column: number, mouseX: number, mouseY: number): void {
        if (!this.filling) return;

        this.fillTarget = { row, column };
        this.fillCurrentMousePosition = { x: mouseX, y: mouseY };
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
     * 斜めにドラッグした場合は45度を基準に、マウスのピクセル移動量で縦方向か横方向かを判定する
     */
    getFillInfo(): { direction: FillDirection; sourceRange: CellRange; targetRange: CellRange; count: number } | undefined {
        const selectionRange = this.getSelectionRange();
        const { startRow, startColumn, endRow, endColumn } = selectionRange;

        const targetRow = this.fillTarget.row;
        const targetColumn = this.fillTarget.column;

        // セル位置の変化量を計算
        const rowDelta = targetRow > endRow
            ? targetRow - endRow
            : targetRow < startRow
                ? startRow - targetRow
                : 0;
        const columnDelta = targetColumn > endColumn
            ? targetColumn - endColumn
            : targetColumn < startColumn
                ? startColumn - targetColumn
                : 0;

        // セル位置に変化がない場合は早期リターン
        if (rowDelta === 0 && columnDelta === 0) {
            return undefined;
        }

        // 縦横どちらの方向にフィルするか決定
        let useVertical = false;
        let useHorizontal = false;

        if (rowDelta > 0 && columnDelta > 0) {
            // 斜めにドラッグした場合は45度を基準に、マウスのピクセル移動量で判定
            const mouseDx = Math.abs(this.fillCurrentMousePosition.x - this.fillStartMousePosition.x);
            const mouseDy = Math.abs(this.fillCurrentMousePosition.y - this.fillStartMousePosition.y);
            useVertical = mouseDy >= mouseDx;
            useHorizontal = mouseDx > mouseDy;
        } else if (rowDelta > 0) {
            useVertical = true;
        } else if (columnDelta > 0) {
            useHorizontal = true;
        }

        let direction: FillDirection;
        let count: number;
        let targetRange: CellRange;

        if (useVertical) {
            if (targetRow > endRow) {
                // 下方向
                direction = 'down';
                count = targetRow - endRow;
                targetRange = {
                    startRow: endRow + 1,
                    startColumn: startColumn,
                    endRow: targetRow,
                    endColumn: endColumn
                };
            } else {
                // 上方向
                direction = 'up';
                count = startRow - targetRow;
                targetRange = {
                    startRow: targetRow,
                    startColumn: startColumn,
                    endRow: startRow - 1,
                    endColumn: endColumn
                };
            }
        } else if (useHorizontal) {
            if (targetColumn > endColumn) {
                // 右方向
                direction = 'right';
                count = targetColumn - endColumn;
                targetRange = {
                    startRow: startRow,
                    startColumn: endColumn + 1,
                    endRow: endRow,
                    endColumn: targetColumn
                };
            } else {
                // 左方向
                direction = 'left';
                count = startColumn - targetColumn;
                targetRange = {
                    startRow: startRow,
                    startColumn: targetColumn,
                    endRow: endRow,
                    endColumn: startColumn - 1
                };
            }
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

        const tableRect = this.editorTable.getTableBoundingClientRect();

        const startRect = this.editorTable.getCellRectOrNull(targetRange.startRow, targetRange.startColumn);
        const endRect = this.editorTable.getCellRectOrNull(targetRange.endRow, targetRange.endColumn);

        if (!startRect || !endRect) {
            this.clearFillPreview();
            return;
        }

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
}
