import type { History } from "./history";
import type { Selection } from "./selection";
import type { EditorTable } from "./editor-table";
import { ColumnWidthCommand, CompositeCommand } from "./command";
import { MIN_COLUMN_WIDTH_PX } from "../core/constant";

/** D&D開始と判定する最小移動距離(px) */
const DRAG_MIN_DISTANCE_PX = 3;

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
    /** mousedownからの移動距離がDRAG_MIN_DISTANCE_PX以上になったらD&D確定 */
    private columnDragConfirmed: boolean = false;

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
                // DRAG_MIN_DISTANCE_PX 以上動いたらD&D確定（ダブルクリックとの排他）
                if (!this.columnDragConfirmed && Math.abs(deltaX) >= DRAG_MIN_DISTANCE_PX) {
                    this.columnDragConfirmed = true;
                }
                const newLeft = this.resizeColumnStartLeft + deltaX;
                // ガイドラインの位置を更新（実際のセルは変更しない）
                this.resizeGuideline.style.left = newLeft + 'px';
            }
        };

        this.mouseupHandler = (e: MouseEvent) => {
            if (this.isResizingColumn) {
                // D&D確定している場合のみリサイズを実行（dblclickによるmousedownは除外）
                if (this.columnDragConfirmed) {
                    const deltaX = e.clientX - this.resizeStartX;
                    const newWidth = Math.max(MIN_COLUMN_WIDTH_PX, this.resizeStartWidth + deltaX);
                    const newWidthStr = newWidth + 'px';
                    this.applyColumnsWidthWithUndo(this.resizingColumnIndex, () => newWidthStr);
                }

                // ガイドラインを非表示
                this.resizeGuideline.style.display = 'none';
                this.resizeGuideline.classList.remove('resize-guideline-column');
            }

            this.isResizingColumn = false;
            this.columnDragConfirmed = false;
        };
    }

    /**
     * 指定列（または複数列選択中の全列）に widthFactory で算出した幅を適用し、Undo/Redo用コマンドを登録する。
     * D&Dリサイズ（全選択列に同一幅）とダブルクリック自動フィット（各列個別幅）の共通実装。
     * 複数列選択中かつ対象列が選択範囲内の場合は全選択列に適用し、1回のUndoで全列を元に戻せる複合コマンドを使用する。
     * @param targetColumnIndex 操作対象の列インデックス（0始まり、行ヘッダーを除く）
     * @param widthFactory 列インデックスを受け取り適用する幅文字列を返す関数
     */
    private applyColumnsWidthWithUndo(targetColumnIndex: number, widthFactory: (colIndex: number) => string): void {
        const copyRange = this.selection.getCopyRange();
        const anchor = this.selection.getAnchor();
        const historyRange = {
            startRow: anchor.row,
            startColumn: anchor.column,
            endRow: anchor.row,
            endColumn: anchor.column
        };

        // 選択範囲が列全体選択を表しているか判定（context-menu.ts と同じ判定方式）
        // getLogicalRowCount() は仮想スクロールのDOM行数に依存しない論理行数を返す
        const selectionRange = this.selection.getSelectionRange();
        const lastRow = this.editorTable.getLogicalRowCount() - 1;
        const isColumnSelection = selectionRange.startRow === 1 && selectionRange.endRow === lastRow;
        // targetColumnIndex は0始まり、selectionRange の column は1始まり（行ヘッダー含む）
        const targetSelectionColumn = targetColumnIndex + 1;
        const isInSelection = targetSelectionColumn >= selectionRange.startColumn && targetSelectionColumn <= selectionRange.endColumn;

        if (!isColumnSelection || !isInSelection) {
            // 単列変更: 列全体選択でないか選択範囲外の列を操作した場合
            const oldWidth = this.editorTable.getColumnWidth(targetColumnIndex);
            const newWidth = widthFactory(targetColumnIndex);
            if (oldWidth === newWidth) return;
            const command = new ColumnWidthCommand(this.editorTable, targetColumnIndex, oldWidth, newWidth);
            this.editorTable.setColumnWidth(targetColumnIndex, newWidth);
            this.history.pushCommand(command, historyRange, copyRange);
            this.selection.updateRendererAfterResize();
            this.editorTable.notifyColumnWidthChanged();
            return;
        }

        // 複数列選択中かつ対象列が選択範囲内: 選択範囲の全列に widthFactory で算出した幅を適用
        const startCol = selectionRange.startColumn;
        const endCol = selectionRange.endColumn;

        // 幅が変わる列のみコマンドを生成（変化なし列はスキップ）
        const commands: ColumnWidthCommand[] = [];
        for (let col = startCol; col <= endCol; col++) {
            // 列インデックスへの変換: selectionのcolumnはDOMのcolumn（行ヘッダーを含むため1始まり）
            // EditorTableのcolumnIndexは0始まり（行ヘッダーを除く）
            const colIndex = col - this.editorTable.dataColumnOffset();
            const oldWidth = this.editorTable.getColumnWidth(colIndex);
            const newWidth = widthFactory(colIndex);
            if (oldWidth === newWidth) continue;
            commands.push(new ColumnWidthCommand(this.editorTable, colIndex, oldWidth, newWidth));
            this.editorTable.setColumnWidth(colIndex, newWidth);
        }

        if (commands.length === 0) return;

        // 1コマンドの場合は直接使用、複数の場合はCompositeCommandでラップして1回のUndoで全列を元に戻せるようにする
        const command = commands.length === 1 ? commands[0] : new CompositeCommand(commands);
        this.history.pushCommand(command, historyRange, copyRange);
        this.selection.updateRendererAfterResize();
        this.editorTable.notifyColumnWidthChanged();
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
            this.columnDragConfirmed = false;
            this.resizingColumnIndex = columnIndex;
            this.resizeStartX = e.clientX;
            const width = Number.parseFloat(columnHeaderCell.style.width);
            this.resizeStartWidth = width;
            // ガイドラインを表示（縦線）: 列右端（境界）を基準にすることでマウス位置によらず正確な境界線を示す
            // getBoundingClientRect() は浮動小数点を返すため Math.round() でサブピクセル蓄積を防ぐ
            const headerRect = columnHeaderCell.getBoundingClientRect();
            const editorRect = this.editorElement.getBoundingClientRect();
            this.resizeColumnStartLeft = Math.round(headerRect.right - editorRect.left + this.editorElement.scrollLeft);
            this.resizeGuideline.style.display = 'block';
            this.resizeGuideline.style.left = this.resizeColumnStartLeft + 'px';
            this.resizeGuideline.style.top = '0';
            this.resizeGuideline.classList.add('resize-guideline-column');
        });

        // ダブルクリックで自動幅調整（D&Dとは排他、mouseupで既にリセット済み）
        resizeHandle.addEventListener('dblclick', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.applyColumnsWidthWithUndo(columnIndex, (col) => this.editorTable.calculateAutoColumnWidth(col));
        });
    }

}
