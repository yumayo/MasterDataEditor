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

interface OverlayBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

interface OverlayVisualGroup {
    bounds: OverlayBounds;
    focusBounds: OverlayBounds | null;
}

export class Selection {

    selectionOverlayElement: HTMLElement;

    fillPreviewElement: HTMLElement;

    private range: CellRange;

    private focus: CellPosition;

    private selecting: boolean;

    private selectingColumn: boolean;

    private selectingRow: boolean;

    private editorTable: EditorTable;

    private editorElement: HTMLElement;

    private copyRange: CellRange;

    fillHandle: HTMLElement;

    private filling: boolean;

    private fillTarget: CellPosition;

    private fillStartMousePosition: { x: number; y: number };

    private fillCurrentMousePosition: { x: number; y: number };

    private scrollBinding: ScrollViewportController;

    private fillHandleHostCell: HTMLElement | null;
    private fillHandleHostPreviousZIndex: string | null;
    private selectionOverlayParts: HTMLElement[];
    private copyOverlayParts: HTMLElement[];

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
        this.fillHandleHostCell = null;
        this.fillHandleHostPreviousZIndex = null;
        this.selectionOverlayParts = [];
        this.copyOverlayParts = [];

        const selectionOverlayElement = document.createElement('div');
        selectionOverlayElement.classList.add('selection-overlay');
        this.selectionOverlayElement = selectionOverlayElement;

        // フィルプレビュー範囲表示用の要素を作成（オーバーレイのまま維持）
        const fillPreviewElement = document.createElement('div');
        fillPreviewElement.classList.add('fill-preview');
        this.fillPreviewElement = fillPreviewElement;

        // フィルハンドル要素を作成（表示時に選択終端セルへ付け替える）
        this.fillHandle = document.createElement('div');
        this.fillHandle.classList.add('fill-handle');
    }

    /**
     * フォーカスを移動します。範囲選択は変更しません。
     * @param row
     * @param column
     */
    move(row: number, column: number): void {
        row = Math.max(1, row);
        column = Math.max(this.editorTable.dataColumnOffset(), column);

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
        startColumn = Math.max(this.editorTable.dataColumnOffset(), startColumn);
        endRow = Math.max(1, endRow);
        endColumn = Math.max(this.editorTable.dataColumnOffset(), endColumn);

        this.range = { startRow, startColumn, endRow, endColumn };
        this.updateRenderer();
    }

    start(row: number, column: number): void {
        row = Math.max(1, row);
        column = Math.max(this.editorTable.dataColumnOffset(), column);

        this.selecting = true;
        this.range = { startRow: row, startColumn: column, endRow: row, endColumn: column };
        this.focus = { row, column }; // start 選択開始位置にフォーカスを設定
        this.updateRenderer();
        this.scrollFocusIntoView();
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
        const rowCount = this.editorTable.getLogicalRowCount();
        if (rowCount < 2) return;

        this.range = { startRow: 1, startColumn: column, endRow: rowCount - 1, endColumn: column };
        this.focus = { row: 1, column: column }; // selectColumn 列ヘッダークリック
        this.selecting = true;
        this.selectingColumn = true;
        this.selectingRow = false;
        // 列ヘッダークリック時はビューポート位置を維持するためスクロールしない
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
        // 行ヘッダークリック時はビューポート位置を維持するためスクロールしない
        this.updateRenderer();
    }

    /**
     * 現在のアンカーから指定した列まで選択を拡張する（Shift+列ヘッダークリック時）
     */
    extendToColumn(column: number): void {
        const rowCount = this.editorTable.getLogicalRowCount();
        if (rowCount < 2) return;

        // アンカー（startColumn）を保持したまま、endColumnを新しい列に拡張
        this.range = { startRow: 1, startColumn: this.range.startColumn, endRow: rowCount - 1, endColumn: column };
        // 列ヘッダークリック時はビューポート位置を維持するためスクロールしない
        this.updateRenderer();
    }

    /**
     * 現在のアンカーから指定した行まで選択を拡張する（Shift+行ヘッダークリック時）
     */
    extendToRow(row: number): void {
        if (row < 1) return;

        const columnCount = this.editorTable.getTotalColumnCount();
        if (columnCount < 2) return;

        // アンカー（startRow）を保持したまま、endRowを新しい行に拡張
        this.range = { startRow: this.range.startRow, startColumn: 1, endRow: row, endColumn: columnCount - 1 };
        // 行ヘッダークリック時はビューポート位置を維持するためスクロールしない
        this.updateRenderer();
    }

    /**
     * 全セルを選択する（左上コーナークリック時）
     */
    selectAll(): void {
        const rowCount = this.editorTable.getLogicalRowCount();
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
     * selectingColumn を true にすることで、後続のドラッグ（updateColumn）で選択範囲を拡張できるようにする。
     */
    addColumn(column: number): void {
        const rowCount = this.editorTable.getLogicalRowCount();
        if (rowCount < 2) return;

        // 新しい選択範囲を計算（列を含めるように拡張）
        const newStartColumn = Math.min(this.range.startColumn, column);
        const newEndColumn = Math.max(this.range.endColumn, column);

        // 行は全行を選択
        this.range = { startRow: 1, startColumn: newStartColumn, endRow: rowCount - 1, endColumn: newEndColumn };
        this.selecting = true;
        this.selectingColumn = true;
        this.selectingRow = false;
        this.updateRenderer();
    }

    /**
     * 現在の選択範囲に行を追加する（Ctrl+行ヘッダークリック時）
     * selectingRow を true にすることで、後続のドラッグ（updateRow）で選択範囲を拡張できるようにする。
     */
    addRow(row: number): void {
        if (row < 1) return;

        const columnCount = this.editorTable.getTotalColumnCount();
        if (columnCount < 2) return;

        // 新しい選択範囲を計算（行を含めるように拡張）
        const newStartRow = Math.min(this.range.startRow, row);
        const newEndRow = Math.max(this.range.endRow, row);

        // 列は全列を選択
        this.range = { startRow: newStartRow, startColumn: 1, endRow: newEndRow, endColumn: columnCount - 1 };
        this.selecting = true;
        this.selectingColumn = false;
        this.selectingRow = true;
        this.updateRenderer();
    }

    /**
     * 選択範囲を拡張する（絶対座標用）
     * マウス操作による範囲選択は絶対座標的なものです。
     * フォーカスは移動しません（選択開始位置に固定）。
     */
    extendSelection(row: number, column: number): void {
        const endRow = Math.max(1, row);
        const endColumn = Math.max(this.editorTable.dataColumnOffset(), column);
        this.range = {
            ...this.range,
            endRow: endRow,
            endColumn: endColumn
        };
        this.updateRenderer();
        // Shift+クリック時のみスクロール。ドラッグ中（selecting=true）はDragControllerがスクロールを管理する
        if (!this.selecting) {
            this.scrollCellIntoView(endRow, endColumn);
        }
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
        if (!this.selectingColumn) return;
        if (column < 1) return;

        const rowCount = this.editorTable.getLogicalRowCount();
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
        if (!this.selectingRow) return;
        if (row < 1) return;

        const rowCount = this.editorTable.getLogicalRowCount();
        if (rowCount < 2) return;
        if (row >= rowCount) return;

        const columnCount = this.editorTable.getTotalColumnCount();
        if (columnCount < 2) return;

        this.range = { ...this.range, endRow: row };
        this.updateRenderer();
    }

    /**
     * blame列の挿入/除去でDOMインデックスがずれた際に、
     * Selection の range と focus の列インデックスを一括補正する。
     * updateRenderer() は呼ばない（DOM構造変更の途中で呼ぶと不整合を起こすため）。
     */
    shiftColumnsBy(delta: number): void {
        this.range.startColumn += delta;
        this.range.endColumn += delta;
        this.focus = { row: this.focus.row, column: this.focus.column + delta };
    }

    /**
     * フィルター適用/解除後に focus と range を指定した最大行数内にクランプする。
     * maxDataRow はフィルター後のデータ行数（DOM行インデックスでは maxDataRow がデータ行最終行）。
     * focus.row または range のいずれかが maxDataRow を超えている場合にクランプする。
     * Shift+クリックによる複数行選択で range.endRow > maxDataRow かつ focus.row <= maxDataRow
     * のケースにも対応する。
     * scrollFocusIntoView は呼ばない（フィルター適用直後は scrollTop が別途リセット済みのため）。
     * updateRenderer も呼ばない（呼び出し側で updateRendererAfterResize を呼ぶこと）。
     */
    clampToFilteredRowCount(maxDataRow: number): void {
        const needsClamp = this.focus.row > maxDataRow
            || this.range.startRow > maxDataRow
            || this.range.endRow > maxDataRow;
        if (!needsClamp) return;
        const clampedFocusRow = Math.min(this.focus.row, maxDataRow);
        // maxDataRow=0（全行フィルターアウト）の場合は row=1（バッファ行）にフォールバック
        const safeRow = clampedFocusRow < 1 ? 1 : clampedFocusRow;
        const col = this.focus.column;
        this.focus = { row: safeRow, column: col };
        this.range = {
            startRow: safeRow, startColumn: col,
            endRow: safeRow, endColumn: col,
        };
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

    restoreState(range: CellRange, focus: CellPosition): void {
        const maxRow = Math.max(1, this.editorTable.getLogicalRowCount() - 1);
        const minColumn = this.editorTable.dataColumnOffset();
        const maxColumn = Math.max(minColumn, this.editorTable.getTotalColumnCount() - 1);
        const clampRow = (row: number) => Math.max(1, Math.min(maxRow, Math.round(row)));
        const clampColumn = (column: number) => Math.max(minColumn, Math.min(maxColumn, Math.round(column)));

        this.range = {
            startRow: clampRow(range.startRow),
            startColumn: clampColumn(range.startColumn),
            endRow: clampRow(range.endRow),
            endColumn: clampColumn(range.endColumn),
        };
        this.focus = {
            row: clampRow(focus.row),
            column: clampColumn(focus.column),
        };
        this.selecting = false;
        this.selectingColumn = false;
        this.selectingRow = false;
        this.updateRenderer();
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
        this.clearCopyOverlay();
        if (!this.hasCopyRange()) return;
        this.updateCopyOverlay(this.copyRange);
    }

    private updateRenderer(notifyRowSelection: boolean = true): void {
        const selectionRange = this.getSelectionRange();
        const { startRow, startColumn, endRow, endColumn } = selectionRange;

        // EditorTable にセル単位でクラスを付与させる（座標計算不要）
        this.editorTable.applySelectionClasses(selectionRange, this.focus.row, this.focus.column);

        // ヘッダーの選択状態を更新
        this.editorTable.updateHeaderSelection(startRow, startColumn, endRow, endColumn);

        // フォーカス行が変化したときにRelationsPanelへ通知する（重複制御はEditorTable側で行う）
        if (notifyRowSelection) this.editorTable.notifyRowSelectionChanged(this.focus.row);

        // フォーカスセルに editor-table-cell-focused クラスを付与する（ジャンプ確認用）
        // DOM要素の流出防止のため EditorTable 側でクラスを管理する
        this.editorTable.markFocusedCell(this.focus.row, this.focus.column);
        this.editorTable.syncDetachedVisualState();
        this.updateSelectionOverlay(selectionRange);
        if (this.hasCopyRange()) {
            this.updateCopyRenderer();
        }

        // 分離レイヤー同期後に、実際に表示されているセルへフィルハンドルを配置する
        this.updateFillHandlePosition();
        this.editorTable.emitSelectionChanged();
    }

    /**
     * フォーカスセルをビューポートの縦中央にスクロールする。
     * ナビゲーション（定義ジャンプ、検索結果ジャンプ等）で呼び出され、
     * ジャンプ先の行が画面中央に来るようにする。
     */
    scrollFocusToCenterVertically(): void {
        if (this.focus.row <= this.editorTable.getFrozenRowCount()) return;
        if (this.editorTable.usesLogicalVerticalScroll()) {
            this.editorTable.centerRowVertically(this.focus.row);
            return;
        }
        // バーチャルスクロールにより対象行がDOMに存在しない場合があるため、先に確保する
        this.editorTable.ensureRowVisible(this.focus.row);
        const targetRect = this.editorTable.getCellRectOrNull(this.focus.row, this.focus.column);
        if (!targetRect) return;
        const containerRect = this.scrollBinding.getBoundingClientRect();
        const headerHeight = this.editorTable.getFirstRowHeight();
        const { scrollbarHeight } = this.scrollBinding.getScrollbarSize();
        const visibleTop = containerRect.top + headerHeight;
        const visibleBottom = containerRect.bottom - scrollbarHeight;
        const visibleHeight = visibleBottom - visibleTop;
        // セルの中心をビューポートの縦中央に配置する
        const cellCenterY = (targetRect.top + targetRect.bottom) / 2;
        const viewportCenterY = visibleTop + visibleHeight / 2;
        const scrollDelta = cellCenterY - viewportCenterY;
        const nextScrollTop = Math.max(0, this.scrollBinding.getScrollTop() + scrollDelta);
        if (nextScrollTop !== this.scrollBinding.getScrollTop()) {
            const scrollBinding = this.scrollBinding;
            scrollBinding.setScrollPosition(nextScrollTop, scrollBinding.getScrollLeft());
            window.requestAnimationFrame(() => {
                if (scrollBinding.getScrollTop() !== nextScrollTop) {
                    scrollBinding.setScrollPosition(nextScrollTop, scrollBinding.getScrollLeft());
                }
            });
        }
    }

    private scrollFocusIntoView(): void {
        this.scrollCellIntoView(this.focus.row, this.focus.column);
    }

    private scrollCellIntoView(row: number, column: number): void {
        // バーチャルスクロールにより対象行がDOMに存在しない場合があるため、先に確保する
        this.editorTable.ensureRowVisible(row);
        const useLogicalVerticalScroll = this.editorTable.usesLogicalVerticalScroll();
        const targetRect = useLogicalVerticalScroll ? null : this.editorTable.getCellRectOrNull(row, column);
        if (!useLogicalVerticalScroll && !targetRect) return;
        const containerRect = this.scrollBinding.getBoundingClientRect();
        const viewportInsets = this.editorTable.getSelectionViewportInsets();
        const targetHorizontalBounds = this.editorTable.getCellHorizontalLayoutBounds(column);
        const { scrollbarWidth, scrollbarHeight } = this.scrollBinding.getScrollbarSize();

        const visibleTop = containerRect.top + viewportInsets.top;
        const visibleBottom = containerRect.bottom - scrollbarHeight;

        let nextScrollTop = this.scrollBinding.getScrollTop();
        let nextScrollLeft = this.scrollBinding.getScrollLeft();

        if (!useLogicalVerticalScroll && targetRect !== null && row > this.editorTable.getFrozenRowCount()) {
            if (targetRect.top < visibleTop) {
                nextScrollTop += targetRect.top - visibleTop;
            } else if (targetRect.bottom > visibleBottom) {
                nextScrollTop += targetRect.bottom - visibleBottom;
            }
        }

        if (!this.editorTable.isFrozenDomColumn(column)) {
            const visibleLeft = this.scrollBinding.getScrollLeft() + viewportInsets.left;
            const visibleRight = this.scrollBinding.getScrollLeft() + containerRect.width - scrollbarWidth;
            if (targetHorizontalBounds.left < visibleLeft) {
                nextScrollLeft += targetHorizontalBounds.left - visibleLeft;
            } else if (targetHorizontalBounds.right > visibleRight) {
                nextScrollLeft += targetHorizontalBounds.right - visibleRight;
            }
        }

        if (nextScrollTop !== this.scrollBinding.getScrollTop() || nextScrollLeft !== this.scrollBinding.getScrollLeft()) {
            this.scrollBinding.setScrollPosition(nextScrollTop, nextScrollLeft);
            this.editorTable.syncScrollBoundVisualsWithPositions(nextScrollTop, nextScrollLeft);

            // ブラウザの慣性スクロール等により次フレームでスクロール位置が上書きされる場合があるため再適用
            const scrollBinding = this.scrollBinding;
            const editorTable = this.editorTable;
            window.requestAnimationFrame(() => {
                if (scrollBinding.getScrollTop() !== nextScrollTop || scrollBinding.getScrollLeft() !== nextScrollLeft) {
                    scrollBinding.setScrollPosition(nextScrollTop, nextScrollLeft);
                    editorTable.syncScrollBoundVisualsWithPositions(nextScrollTop, nextScrollLeft);
                }
            });
        }
    }

    /**
     * リサイズ後に描画領域を更新する（area-resizerから呼び出される）
     */
    updateRendererAfterResize(notifyRowSelection: boolean = true): void {
        // 選択範囲を更新
        this.updateRenderer(notifyRowSelection);

        // フィルプレビューを更新
        if (this.filling) {
            this.updateFillPreview();
        }
    }

    /**
     * 選択範囲のCSSクラスのみを再適用する（スクロール位置やフィルハンドルは変更しない）。
     * バーチャルスクロールでDOM行が入れ替わった際に、選択状態クラスとoverlayを再適用するために使う。
     * updateRendererAfterResize() と異なり、スクロール移動やRelationsPanel通知を行わないため
     * ドラッグ選択中に呼んでもドラッグを妨害しない。
     */
    reapplySelectionClassesOnly(triggeredByScroll: boolean): void {
        const selectionRange = this.getSelectionRange();
        const { startRow, startColumn, endRow, endColumn } = selectionRange;
        this.editorTable.applySelectionClasses(selectionRange, this.focus.row, this.focus.column);
        this.editorTable.markFocusedCell(this.focus.row, this.focus.column);
        // 純スクロール時はこの直後に EditorTable.reapplyRowDecorations() 側で
        // detached row header の差分同期が走るため、ここでは静的 layer の全同期を省く。
        if (triggeredByScroll) {
            this.editorTable.updateHeaderSelectionForVirtualScroll(startRow, startColumn, endRow, endColumn);
        } else {
            this.editorTable.updateHeaderSelection(startRow, startColumn, endRow, endColumn);
        }
        if (triggeredByScroll) {
            // スクロール入力ではこの直後の scroll-bound sync で overlay をまとめて更新する。
            // 行差し替え直後に getBoundingClientRect() を読むと、大量の class/DOM 更新が同期レイアウト化する。
            if (this.fillHandleHostCell === null || !this.fillHandleHostCell.isConnected) {
                this.updateFillHandlePosition();
            }
        } else {
            this.updateSelectionOverlay(selectionRange);
            // フィルハンドル位置も再計算する（バーチャルスクロールで表示範囲が変わるとクランプ先が変わるため）
            this.updateFillHandlePosition();
            if (this.hasCopyRange()) {
                this.updateCopyRenderer();
            }
        }
    }

    /**
     * スクロール位置に依存する overlay だけを再計算する。
     * 仮想スクロールの行入れ替えが発生しない微小スクロールでも、selection/copy overlay は
     * セルの getBoundingClientRect() に追従させる必要がある。
     */
    refreshScrollBoundOverlays(): void {
        this.updateSelectionOverlay(this.getSelectionRange());
        if (this.hasCopyRange()) {
            this.updateCopyRenderer();
        }
        if (this.filling) {
            this.updateFillPreview();
        }
    }

    private forEachVisibleRangeCell(range: CellRange, callback: (row: number, column: number, cell: HTMLElement) => void): boolean {
        const normalizedRange = this.normalizeCellRange(range);
        const { startRow, startColumn, endRow, endColumn } = normalizedRange;
        let hasVisibleCell = false;
        for (const [rowStart, rowEnd] of this.getVisibleSelectedRowRanges(startRow, endRow)) {
            for (let row = rowStart; row <= rowEnd; row++) {
                for (let column = startColumn; column <= endColumn; column++) {
                    const cell = this.editorTable.getVisibleCellOrNull(row, column);
                    if (cell === null) continue;
                    callback(row, column, cell);
                    hasVisibleCell = true;
                }
            }
        }
        return hasVisibleCell;
    }

    private normalizeCellRange(range: CellRange): CellRange {
        return {
            startRow: Math.min(range.startRow, range.endRow),
            startColumn: Math.min(range.startColumn, range.endColumn),
            endRow: Math.max(range.startRow, range.endRow),
            endColumn: Math.max(range.startColumn, range.endColumn),
        };
    }

    private getVisibleSelectedRowRanges(startRow: number, endRow: number): Array<[number, number]> {
        const ranges: Array<[number, number]> = [];
        const appendIntersection = (rangeStart: number, rangeEnd: number): void => {
            const intersectStart = Math.max(startRow, rangeStart);
            const intersectEnd = Math.min(endRow, rangeEnd);
            if (intersectStart <= intersectEnd) ranges.push([intersectStart, intersectEnd]);
        };

        if (startRow <= 0 && endRow >= 0) appendIntersection(0, 0);

        const frozenRowCount = this.editorTable.getFrozenRowCount();
        if (frozenRowCount > 0) appendIntersection(1, frozenRowCount);

        const renderedStartRow = this.editorTable.getVirtualScrollRenderedStart() + 1;
        const renderedEndRow = this.editorTable.getVirtualScrollRenderedEnd();
        appendIntersection(renderedStartRow, renderedEndRow);

        if (ranges.length <= 1) return ranges;
        ranges.sort((a, b) => a[0] - b[0]);
        const merged: Array<[number, number]> = [];
        for (const [rangeStart, rangeEnd] of ranges) {
            const previous = merged[merged.length - 1];
            if (previous !== undefined && rangeStart <= previous[1] + 1) {
                previous[1] = Math.max(previous[1], rangeEnd);
                continue;
            }
            merged.push([rangeStart, rangeEnd]);
        }
        return merged;
    }

    private updateSelectionOverlay(selectionRange: CellRange): void {
        this.clearSelectionOverlay();

        for (const group of this.getVisibleOverlayGroups(selectionRange)) {
            this.appendSelectionOverlayGroup(group);
        }
    }

    private appendSelectionOverlayPart(classNames: string, left: number, top: number, width: number, height: number): void {
        this.appendOverlayPart(this.selectionOverlayParts, classNames, left, top, width, height);
    }

    private updateCopyOverlay(copyRange: CellRange): void {
        for (const group of this.getVisibleOverlayGroups(copyRange)) {
            const bounds = group.bounds;
            this.appendCopyOverlayPart(
                'copy-overlay-border',
                bounds.left, bounds.top,
                bounds.right - bounds.left - 1, bounds.bottom - bounds.top - 1,
            );
        }
    }

    private getVisibleOverlayGroups(range: CellRange): OverlayVisualGroup[] {
        const hostRect = this.editorElement.getBoundingClientRect();
        const groups = new Map<string, OverlayVisualGroup>();

        this.forEachVisibleRangeCell(range, (row, column, cell) => {
            const clippedRect = this.getClippedVisibleCellRect(cell);
            if (clippedRect === null) return;
            const localBounds = {
                left: clippedRect.left - hostRect.left,
                top: clippedRect.top - hostRect.top,
                right: clippedRect.right - hostRect.left,
                bottom: clippedRect.bottom - hostRect.top,
            };
            const groupKey = this.getOverlayVisualGroupKey(row, column, cell);
            let group = groups.get(groupKey);
            if (group === undefined) {
                group = { bounds: { ...localBounds }, focusBounds: null };
                groups.set(groupKey, group);
            } else {
                this.expandOverlayBounds(group.bounds, localBounds);
            }
            if (row === this.focus.row && column === this.focus.column) {
                group.focusBounds = { ...localBounds };
            }
        });

        return this.mergeAdjacentOverlayGroups(Array.from(groups.values()));
    }

    private getClippedVisibleCellRect(cell: HTMLElement): OverlayBounds | null {
        const cellRect = cell.getBoundingClientRect();
        if (cellRect.width <= 0 || cellRect.height <= 0) return null;

        const clipRects = this.getOverlayClipRects(cell);
        const clipped: OverlayBounds = {
            left: cellRect.left,
            top: cellRect.top,
            right: cellRect.right,
            bottom: cellRect.bottom,
        };
        for (const clipRect of clipRects) {
            clipped.left = Math.max(clipped.left, clipRect.left);
            clipped.top = Math.max(clipped.top, clipRect.top);
            clipped.right = Math.min(clipped.right, clipRect.right);
            clipped.bottom = Math.min(clipped.bottom, clipRect.bottom);
            if (clipped.right <= clipped.left || clipped.bottom <= clipped.top) return null;
        }
        return clipped;
    }

    private getOverlayClipRects(cell: HTMLElement): DOMRect[] {
        const clipRects: DOMRect[] = [this.editorTable.getTableBoundingClientRect()];
        const quadrantPane = cell.closest('.editor-table-pane');
        if (quadrantPane instanceof HTMLElement) {
            clipRects.push(quadrantPane.getBoundingClientRect());
        }
        const quadrantViewport = cell.closest('.editor-table-top-viewport, .editor-table-left-viewport, .editor-table-main-viewport');
        if (quadrantViewport instanceof HTMLElement) {
            clipRects.push(quadrantViewport.getBoundingClientRect());
        }
        if (!(quadrantPane instanceof HTMLElement) && !(quadrantViewport instanceof HTMLElement)) {
            clipRects.push(this.scrollBinding.getBoundingClientRect());
        }
        return clipRects;
    }

    private getOverlayVisualGroupKey(row: number, column: number, cell: HTMLElement): string {
        const quadrantPane = cell.closest('.editor-table-pane-top-left, .editor-table-pane-top-right, .editor-table-pane-bottom-left, .editor-table-pane-bottom-right');
        if (quadrantPane instanceof HTMLElement) {
            if (quadrantPane.classList.contains('editor-table-pane-top-left')) return 'pane:top-left';
            if (quadrantPane.classList.contains('editor-table-pane-top-right')) return 'pane:top-right';
            if (quadrantPane.classList.contains('editor-table-pane-bottom-left')) return 'pane:bottom-left';
            if (quadrantPane.classList.contains('editor-table-pane-bottom-right')) return 'pane:bottom-right';
        }
        const rowGroup = row <= this.editorTable.getFrozenRowCount() ? 'frozen-row' : 'body-row';
        const columnGroup = this.editorTable.isFrozenDomColumn(column) ? 'frozen-column' : 'body-column';
        return `${rowGroup}:${columnGroup}`;
    }

    private mergeAdjacentOverlayGroups(groups: OverlayVisualGroup[]): OverlayVisualGroup[] {
        const merged: OverlayVisualGroup[] = [];
        for (const group of groups) {
            let pending: OverlayVisualGroup = {
                bounds: { ...group.bounds },
                focusBounds: group.focusBounds === null ? null : { ...group.focusBounds },
            };
            let mergedIntoExisting = true;
            while (mergedIntoExisting) {
                mergedIntoExisting = false;
                for (let index = 0; index < merged.length; index++) {
                    const existing = merged[index];
                    if (!this.canMergeOverlayBounds(existing.bounds, pending.bounds)) continue;
                    this.expandOverlayBounds(existing.bounds, pending.bounds);
                    if (existing.focusBounds === null && pending.focusBounds !== null) {
                        existing.focusBounds = pending.focusBounds;
                    }
                    pending = existing;
                    merged.splice(index, 1);
                    mergedIntoExisting = true;
                    break;
                }
            }
            merged.push(pending);
        }
        return merged;
    }

    private canMergeOverlayBounds(a: OverlayBounds, b: OverlayBounds): boolean {
        const tolerance = 1.5;
        const horizontalOverlap = Math.min(a.right, b.right) - Math.max(a.left, b.left) > tolerance;
        const verticalOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > tolerance;
        const horizontalTouch = Math.abs(a.right - b.left) <= tolerance || Math.abs(b.right - a.left) <= tolerance;
        const verticalTouch = Math.abs(a.bottom - b.top) <= tolerance || Math.abs(b.bottom - a.top) <= tolerance;
        return (horizontalOverlap && (verticalOverlap || verticalTouch))
            || (verticalOverlap && horizontalTouch);
    }

    private expandOverlayBounds(target: OverlayBounds, source: OverlayBounds): void {
        target.left = Math.min(target.left, source.left);
        target.top = Math.min(target.top, source.top);
        target.right = Math.max(target.right, source.right);
        target.bottom = Math.max(target.bottom, source.bottom);
    }

    private appendSelectionOverlayGroup(group: OverlayVisualGroup): void {
        const selectionLeft = group.bounds.left;
        const selectionTop = group.bounds.top;
        const selectionRight = group.bounds.right;
        const selectionBottom = group.bounds.bottom;
        const backgroundRight = selectionRight - 1;
        const backgroundBottom = selectionBottom - 1;
        if (selectionRight <= selectionLeft || selectionBottom <= selectionTop) return;

        const focusRect = group.focusBounds;
        if (focusRect === null) {
            this.appendSelectionOverlayPart(
                'selection-overlay-bg',
                selectionLeft, selectionTop,
                backgroundRight - selectionLeft, backgroundBottom - selectionTop,
            );
        } else {
            const visualFocusBottom = Math.min(focusRect.bottom, backgroundBottom);
            this.appendSelectionOverlayPart(
                'selection-overlay-bg',
                selectionLeft, selectionTop,
                backgroundRight - selectionLeft, focusRect.top - selectionTop,
            );
            this.appendSelectionOverlayPart(
                'selection-overlay-bg',
                selectionLeft, focusRect.bottom,
                backgroundRight - selectionLeft, backgroundBottom - focusRect.bottom,
            );
            this.appendSelectionOverlayPart(
                'selection-overlay-bg',
                selectionLeft, focusRect.top,
                focusRect.left - selectionLeft, visualFocusBottom - focusRect.top,
            );
            this.appendSelectionOverlayPart(
                'selection-overlay-bg',
                focusRect.right, focusRect.top,
                backgroundRight - focusRect.right, visualFocusBottom - focusRect.top,
            );
        }

        this.appendSelectionOverlayPart(
            'selection-overlay-border',
            selectionLeft, selectionTop,
            selectionRight - selectionLeft, selectionBottom - selectionTop,
        );
    }

    private appendCopyOverlayPart(classNames: string, left: number, top: number, width: number, height: number): void {
        this.appendOverlayPart(this.copyOverlayParts, classNames, left, top, width, height);
    }

    private appendOverlayPart(parts: HTMLElement[], classNames: string, left: number, top: number, width: number, height: number): void {
        if (width <= 0 || height <= 0) return;
        const part = document.createElement('div');
        part.className = `selection-overlay-part ${classNames}`;
        part.style.left = `${left}px`;
        part.style.top = `${top}px`;
        part.style.width = `${width}px`;
        part.style.height = `${height}px`;
        this.selectionOverlayElement.appendChild(part);
        parts.push(part);
    }

    private clearSelectionOverlay(): void {
        for (const part of this.selectionOverlayParts) {
            part.remove();
        }
        this.selectionOverlayParts = [];
    }

    private clearCopyOverlay(): void {
        for (const part of this.copyOverlayParts) {
            part.remove();
        }
        this.copyOverlayParts = [];
    }

    /**
     * フィルハンドルの位置を再計算する。
     * スクロール時に固定行（frozenRow）のフィルハンドル位置を更新するために
     * EditorTable から呼ばれる。通常は private な updateRenderer() 経由で呼ばれるが、
     * 仮想スクロールの行入れ替えが発生しない微小スクロールでは updateRenderer() が
     * 呼ばれないため、EditorTable のスクロールコールバックから直接呼ぶ必要がある。
     */
    refreshFillHandlePosition(): void {
        this.updateFillHandlePosition();
    }

    isPointInsideFillHandleHitArea(clientX: number, clientY: number): boolean {
        if (!this.fillHandleHostCell || !this.fillHandle.isConnected || this.fillHandle.style.display === 'none') {
            return false;
        }

        const hostRect = this.fillHandleHostCell.getBoundingClientRect();
        return clientX >= hostRect.right - 8
            && clientX <= hostRect.right + 4
            && clientY >= hostRect.bottom - 8
            && clientY <= hostRect.bottom + 4;
    }

    private updateFillHandlePosition(): void {
        const selectionRange = this.getSelectionRange();
        let endRow = selectionRange.endRow;
        const endColumn = selectionRange.endColumn;
        const isBottomLogicalRow = selectionRange.endRow >= this.editorTable.getLogicalRowCount() - 1;

        // バーチャルスクロールでendRowがDOM外の場合、表示範囲の最後の行にクランプする
        // renderedEnd は排他なので -1 し、ヘッダー行分の +1 でDOM行インデックスに変換する
        const renderedEnd = this.editorTable.getVirtualScrollRenderedEnd();
        if (endRow > renderedEnd) {
            endRow = renderedEnd;
        }

        const cell = this.editorTable.getVisibleCellOrNull(endRow, endColumn);
        if (!cell) {
            this.hideFillHandle();
            return;
        }

        // セルの子要素として右下に配置する。スクロール座標への変換は不要。
        // ただしテーブルセル同士の描画順には親セルのスタッキング順が効くため、
        // 既存の inline z-index に戻した状態で基準値を計算する。
        if (this.fillHandleHostCell === cell && this.fillHandleHostPreviousZIndex !== null) {
            cell.style.zIndex = this.fillHandleHostPreviousZIndex;
        }
        const baseZIndexText = window.getComputedStyle(document.documentElement).getPropertyValue('--z-index-fill-handle').trim();
        const baseZIndex = parseInt(baseZIndexText, 10);
        if (Number.isNaN(baseZIndex)) {
            throw new Error(`CSS変数 --z-index-fill-handle の値が不正です: ${baseZIndexText}`);
        }
        let effectiveCellZIndex = 0;
        let currentElement: HTMLElement | null = cell;
        while (currentElement && currentElement !== this.editorElement) {
            const currentZIndexText = window.getComputedStyle(currentElement).zIndex;
            if (currentZIndexText !== 'auto') {
                const currentZIndex = parseInt(currentZIndexText, 10);
                if (Number.isNaN(currentZIndex)) {
                    throw new Error(`fill-handle の z-index 計算に失敗しました: ${currentZIndexText}`);
                }
                effectiveCellZIndex = Math.max(effectiveCellZIndex, currentZIndex);
            }
            currentElement = currentElement.parentElement;
        }
        const fillOverlayZIndex = Math.max(baseZIndex, effectiveCellZIndex + 1);

        if (this.fillHandleHostCell !== cell) {
            this.restoreFillHandleHostCell();
            this.fillHandleHostCell = cell;
            this.fillHandleHostPreviousZIndex = cell.style.zIndex;
            cell.classList.add('fill-handle-host');
            cell.appendChild(this.fillHandle);
        }
        // 最下行では外側へ出たハンドルが scrollHeight を増やすため内側へ寄せる。
        cell.classList.toggle('fill-handle-host-bottom-edge', isBottomLogicalRow);
        cell.style.zIndex = fillOverlayZIndex.toString();
        this.fillHandle.style.zIndex = fillOverlayZIndex.toString();
        this.fillPreviewElement.style.zIndex = fillOverlayZIndex.toString();
        this.fillHandle.style.display = 'block';
    }

    private hideFillHandle(): void {
        this.restoreFillHandleHostCell();
        this.fillHandleHostCell = null;
        this.fillHandle.style.display = 'none';
    }

    private restoreFillHandleHostCell(): void {
        if (!this.fillHandleHostCell) return;
        this.fillHandleHostCell.classList.remove('fill-handle-host');
        this.fillHandleHostCell.classList.remove('fill-handle-host-bottom-edge');
        if (this.fillHandleHostPreviousZIndex !== null) {
            this.fillHandleHostCell.style.zIndex = this.fillHandleHostPreviousZIndex;
        }
        this.fillHandleHostPreviousZIndex = null;
    }

    private hideCopyBorder(): void {
        this.clearCopyOverlay();
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
