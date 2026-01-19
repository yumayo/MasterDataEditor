import type { History } from "./history";
import type { Selection } from "./selection";
import type { EditorTable } from "./editor-table";
import { ColumnWidthCommand, RowHeightCommand } from "./command";

export class AreaResizer {
    private editorTable!: EditorTable;
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

    private mousemoveHandler!: (e: MouseEvent) => void;
    private mouseupHandler!: (e: MouseEvent) => void;

    constructor(editorElement: HTMLElement, history: History, selection: Selection) {
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

    /**
     * EditorTableへの参照を設定
     */
    setEditorTable(editorTable: EditorTable): void {
        this.editorTable = editorTable;
    }

    private setupEventListeners(): void {
        // グローバルイベントハンドラーを定義（activate/deactivateで登録・解除）
        this.mousemoveHandler = (e: MouseEvent) => {
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
        };

        this.mouseupHandler = (e: MouseEvent) => {
            if (this.isResizingColumn) {
                const deltaX = e.clientX - this.resizeStartX;
                const newWidth = Math.max(20, this.resizeStartWidth + deltaX);
                const newWidthStr = newWidth + 'px';

                // 幅が変わった場合のみ履歴に追加
                if (this.resizeColumnOldWidth !== newWidthStr) {
                    const command = new ColumnWidthCommand(
                        this.editorTable,
                        this.resizingColumnIndex,
                        this.resizeColumnOldWidth,
                        newWidthStr
                    );
                    // マウスアップ時にセルのスタイルを更新
                    this.editorTable.setColumnWidth(this.resizingColumnIndex, newWidthStr);

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
                        this.editorTable,
                        this.resizingRowIndex,
                        this.resizeRowOldHeight,
                        newHeightStr
                    );
                    // マウスアップ時にセルのスタイルを更新
                    this.editorTable.setRowHeight(this.resizingRowIndex, newHeightStr);

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
        };
    }

    /**
     * グローバルイベントリスナーを登録する（タブがアクティブになったとき）
     */
    activate(): void {
        window.addEventListener('mousemove', this.mousemoveHandler);
        window.addEventListener('mouseup', this.mouseupHandler);
    }

    /**
     * グローバルイベントリスナーを解除する（タブが非アクティブになったとき）
     */
    deactivate(): void {
        window.removeEventListener('mousemove', this.mousemoveHandler);
        window.removeEventListener('mouseup', this.mouseupHandler);
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
            // 元の幅を保存（Undo用）- セルのスタイルから取得
            this.resizeColumnOldWidth = columnHeaderCell.style.width || '100px';

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
            // 元の高さを保存（Undo用）- セルのスタイルから取得
            this.resizeRowOldHeight = rowHeaderCell.style.height || '20px';

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
}
