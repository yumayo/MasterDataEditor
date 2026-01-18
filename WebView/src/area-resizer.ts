import type { History } from "./history";
import type { Selection } from "./selection";
import { ColumnWidthCommand, RowHeightCommand } from "./command";

export class AreaResizer {
    private tableElement: HTMLElement;
    private editorElement: HTMLElement;
    private history: History;
    private selection: Selection;
    private resizeGuideline: HTMLElement;

    private isResizingColumn: boolean = false;
    private resizingColumnIndex: number = -1;
    private resizeStartX: number = 0;
    private resizeStartWidth: number = 0;
    private resizeColumnStartLeft: number = 0;
    private resizeColumnOldWidth: string = '100px';

    private isResizingRow: boolean = false;
    private resizingRowIndex: number = -1;
    private resizeStartY: number = 0;
    private resizeStartHeight: number = 0;
    private resizeRowStartTop: number = 0;
    private resizeRowOldHeight: string = '20px';

    constructor(tableElement: HTMLElement, editorElement: HTMLElement, history: History, selection: Selection) {
        this.tableElement = tableElement;
        this.editorElement = editorElement;
        this.history = history;
        this.selection = selection;

        // リサイズ用ガイドライン要素を作成
        this.resizeGuideline = document.createElement('div');
        this.resizeGuideline.classList.add('resize-guideline');
        this.resizeGuideline.style.display = 'none';

        // editorの親要素に追加（テーブルの外に配置）
        this.editorElement.appendChild(this.resizeGuideline);

        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        window.addEventListener('mousemove', (e) => {
            if (this.isResizingColumn) {
                const deltaX = e.clientX - this.resizeStartX;
                const newLeft = this.resizeColumnStartLeft + deltaX;

                // ガイドラインの位置を更新（実際のセルは変更しない）
                this.resizeGuideline.style.left = newLeft + 'px';
            }

            if (this.isResizingRow) {
                const deltaY = e.clientY - this.resizeStartY;
                const newTop = this.resizeRowStartTop + deltaY;

                // ガイドラインの位置を更新（実際のセルは変更しない）
                this.resizeGuideline.style.top = newTop + 'px';
            }
        });

        window.addEventListener('mouseup', (e) => {
            if (this.isResizingColumn) {
                const deltaX = e.clientX - this.resizeStartX;
                const newWidth = Math.max(20, this.resizeStartWidth + deltaX);
                const newWidthStr = newWidth + 'px';

                // 幅が変わった場合のみ履歴に追加
                if (this.resizeColumnOldWidth !== newWidthStr) {
                    const command = new ColumnWidthCommand(
                        this.tableElement,
                        this.resizingColumnIndex,
                        this.resizeColumnOldWidth,
                        newWidthStr
                    );
                    // マウスアップ時にCSS変数を更新（executeを直接呼ぶ代わりに）
                    this.tableElement.style.setProperty(`--col-${this.resizingColumnIndex}-width`, newWidthStr);

                    // 履歴に追加（既に実行済み）
                    const copyRange = this.selection.getCopyRange();
                    const anchor = this.selection.getAnchor();
                    this.history.pushCommand(command, {
                        startRow: anchor.row,
                        startColumn: anchor.column,
                        endRow: anchor.row,
                        endColumn: anchor.column
                    }, copyRange);

                    // selection の描画領域を更新
                    this.selection.updateRendererAfterResize();
                }

                // ガイドラインを非表示
                this.resizeGuideline.style.display = 'none';
                this.resizeGuideline.classList.remove('resize-guideline-column', 'resize-guideline-row');
            }

            if (this.isResizingRow) {
                const deltaY = e.clientY - this.resizeStartY;
                const newHeight = Math.max(20, this.resizeStartHeight + deltaY);
                const newHeightStr = newHeight + 'px';

                // 高さが変わった場合のみ履歴に追加
                if (this.resizeRowOldHeight !== newHeightStr) {
                    const command = new RowHeightCommand(
                        this.tableElement,
                        this.resizingRowIndex,
                        this.resizeRowOldHeight,
                        newHeightStr
                    );
                    // マウスアップ時にCSS変数を更新
                    this.tableElement.style.setProperty(`--row-${this.resizingRowIndex}-height`, newHeightStr);

                    // 履歴に追加（既に実行済み）
                    const copyRange = this.selection.getCopyRange();
                    const anchor = this.selection.getAnchor();
                    this.history.pushCommand(command, {
                        startRow: anchor.row,
                        startColumn: anchor.column,
                        endRow: anchor.row,
                        endColumn: anchor.column
                    }, copyRange);

                    // selection の描画領域を更新
                    this.selection.updateRendererAfterResize();
                }

                // ガイドラインを非表示
                this.resizeGuideline.style.display = 'none';
                this.resizeGuideline.classList.remove('resize-guideline-column', 'resize-guideline-row');
            }

            this.isResizingColumn = false;
            this.isResizingRow = false;
        });
    }

    /**
     * 列リサイズハンドルをセットアップ
     */
    public setupColumnResizeHandle(resizeHandle: HTMLElement, columnHeaderCell: HTMLElement, columnIndex: number): void {
        resizeHandle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.isResizingColumn = true;
            this.resizingColumnIndex = columnIndex;
            this.resizeStartX = e.clientX;
            const width = columnHeaderCell.offsetWidth;
            this.resizeStartWidth = width;
            // 元の幅を保存（Undo用）
            this.resizeColumnOldWidth = this.tableElement.style.getPropertyValue(`--col-${columnIndex}-width`) || '100px';

            // ガイドラインを表示（縦線）
            const rect = columnHeaderCell.getBoundingClientRect();
            const editorRect = this.editorElement.getBoundingClientRect();
            this.resizeColumnStartLeft = rect.right - editorRect.left + this.editorElement.scrollLeft;
            this.resizeGuideline.style.display = 'block';
            this.resizeGuideline.style.left = this.resizeColumnStartLeft + 'px';
            this.resizeGuideline.style.top = '0';
            this.resizeGuideline.classList.add('resize-guideline-column');
            this.resizeGuideline.classList.remove('resize-guideline-row');
        });
    }

    /**
     * 行リサイズハンドルをセットアップ
     */
    public setupRowResizeHandle(resizeHandle: HTMLElement, rowHeaderCell: HTMLElement, rowIndex: number): void {
        resizeHandle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.isResizingRow = true;
            this.resizingRowIndex = rowIndex;
            this.resizeStartY = e.clientY;
            const height = rowHeaderCell.offsetHeight;
            this.resizeStartHeight = height;
            // 元の高さを保存（Undo用）
            this.resizeRowOldHeight = this.tableElement.style.getPropertyValue(`--row-${rowIndex}-height`) || '20px';

            // ガイドラインを表示（横線）
            const rect = rowHeaderCell.getBoundingClientRect();
            const editorRect = this.editorElement.getBoundingClientRect();
            this.resizeRowStartTop = rect.bottom - editorRect.top + this.editorElement.scrollTop;
            this.resizeGuideline.style.display = 'block';
            this.resizeGuideline.style.top = this.resizeRowStartTop + 'px';
            this.resizeGuideline.style.left = '0';
            this.resizeGuideline.classList.add('resize-guideline-row');
            this.resizeGuideline.classList.remove('resize-guideline-column');
        });
    }

    /**
     * 動的に行高のCSSルールを生成
     */
    public generateRowHeightStyles(totalRows: number): void {
        // 既存のスタイルシートがあれば削除
        const existingStyle = document.getElementById('editor-table-row-heights');
        if (existingStyle) {
            existingStyle.remove();
        }

        // 新しいスタイルシートを作成
        const style = document.createElement('style');
        style.id = 'editor-table-row-heights';

        let css = '';
        for (let i = 0; i < totalRows; ++i) {
            css += `.editor-table-row[data-row="${i}"] { --row-height: var(--row-${i}-height, 20px); }\n`;
        }

        style.textContent = css;
        document.head.appendChild(style);
    }

    /**
     * 動的に列幅のCSSルールを生成
     */
    public generateColumnWidthStyles(columnCount: number): void {
        // 既存のスタイルシートがあれば削除
        const existingStyle = document.getElementById('editor-table-column-widths');
        if (existingStyle) {
            existingStyle.remove();
        }

        // 新しいスタイルシートを作成
        const style = document.createElement('style');
        style.id = 'editor-table-column-widths';

        let css = '';
        for (let i = 0; i < columnCount; ++i) {
            css += `.editor-table-cell[data-col="${i}"] { width: var(--col-${i}-width, 100px); min-width: var(--col-${i}-width, 100px); max-width: var(--col-${i}-width, 100px); }\n`;
        }

        style.textContent = css;
        document.head.appendChild(style);
    }
}
