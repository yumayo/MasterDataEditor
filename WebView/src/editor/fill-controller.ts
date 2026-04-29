import {EditorTable} from "./editor-table";
import {Selection} from "./selection";
import {History} from "./history";
import {applyFillSeries} from "./editor-actions";

/**
 * フィルハンドルのドラッグ操作を管理するコントローラー
 *
 * 責務:
 * - フィルハンドルのmousedown/dblclickイベント
 * - テーブル上でのmousemoveイベント（フィル中）
 * - グローバルなmouseupイベント（フィル終了）
 */
export class FillController {

    private readonly table: EditorTable;
    private readonly selection: Selection;
    private readonly history: History;

    private mouseupHandler: () => void;
    private mousedownCaptureHandler: (e: MouseEvent) => void;
    private dblclickCaptureHandler: (e: MouseEvent) => void;
    private mousemoveCaptureHandler: (e: MouseEvent) => void;
    private ownsSyntheticCursor: boolean;
    private previousBodyCursor: string;
    private previousDocumentCursor: string;

    constructor(table: EditorTable, selection: Selection, history: History) {
        this.table = table;
        this.selection = selection;
        this.history = history;
        this.ownsSyntheticCursor = false;
        this.previousBodyCursor = '';
        this.previousDocumentCursor = '';

        // グローバルmouseupイベントハンドラーを定義
        this.mouseupHandler = () => {
            if (!this.selection.isFilling()) return;

            const fillInfo = this.selection.getFillInfo();
            this.selection.endFill();

            if (fillInfo) {
                applyFillSeries(
                    this.table,
                    this.selection,
                    this.history,
                    fillInfo.direction,
                    fillInfo.sourceRange.startRow,
                    fillInfo.sourceRange.startColumn,
                    fillInfo.sourceRange.endRow,
                    fillInfo.sourceRange.endColumn,
                    fillInfo.targetRange.startRow,
                    fillInfo.targetRange.startColumn,
                    fillInfo.targetRange.endRow,
                    fillInfo.targetRange.endColumn,
                    fillInfo.count
                );
            }
        };
        this.mousedownCaptureHandler = (e: MouseEvent) => {
            if (e.button !== 0 || !this.isPointInsideFillHandle(e.clientX, e.clientY)) return;
            this.startFillFromMouseEvent(e);
        };
        this.dblclickCaptureHandler = (e: MouseEvent) => {
            if (e.button !== 0 || !this.isPointInsideFillHandle(e.clientX, e.clientY)) return;
            e.preventDefault();
            e.stopPropagation();
            this.fillToMaxRow();
        };
        this.mousemoveCaptureHandler = (e: MouseEvent) => {
            this.updateSyntheticCursor(this.isPointInsideFillHandle(e.clientX, e.clientY));
        };
    }

    /**
     * フィルハンドルとテーブルのイベントを登録する
     * EditorTable.initialize() 後に呼び出す
     */
    initialize(): void {
        const fillHandle = this.selection.fillHandle;

        // フィルハンドルのドラッグ開始
        fillHandle.addEventListener('mousedown', (e) => {
            this.startFillFromMouseEvent(e);
        });

        // フィルハンドルのダブルクリック
        fillHandle.addEventListener('dblclick', (e) => {
            e.preventDefault();
            e.stopPropagation();

            this.fillToMaxRow();
        });
    }

    private startFillFromMouseEvent(e: MouseEvent): void {
        e.preventDefault();
        e.stopPropagation();

        const anchor = this.selection.getAnchor();
        this.selection.startFill(anchor.row, anchor.column, e.clientX, e.clientY);
    }

    private isPointInsideFillHandle(clientX: number, clientY: number): boolean {
        return this.selection.isPointInsideFillHandleHitArea(clientX, clientY);
    }

    private updateSyntheticCursor(inside: boolean): void {
        if (inside) {
            if (this.ownsSyntheticCursor) return;
            this.previousBodyCursor = document.body.style.cursor;
            this.previousDocumentCursor = document.documentElement.style.cursor;
            document.body.style.cursor = 'crosshair';
            document.documentElement.style.cursor = 'crosshair';
            this.ownsSyntheticCursor = true;
            return;
        }

        this.clearSyntheticCursor();
    }

    private clearSyntheticCursor(): void {
        if (!this.ownsSyntheticCursor) return;
        document.body.style.cursor = this.previousBodyCursor;
        document.documentElement.style.cursor = this.previousDocumentCursor;
        this.previousBodyCursor = '';
        this.previousDocumentCursor = '';
        this.ownsSyntheticCursor = false;
    }

    /**
     * ダブルクリックでデータ領域の最大行までフィル
     */
    private fillToMaxRow(): void {
        const maxDataRow = this.table.getMaxDataRow();
        const anchor = this.selection.getAnchor();
        const focus = this.selection.getFocus();

        const startRow = Math.min(anchor.row, focus.row);
        const endRow = Math.max(anchor.row, focus.row);
        const startColumn = Math.min(anchor.column, focus.column);
        const endColumn = Math.max(anchor.column, focus.column);

        // 現在の選択範囲の最下行よりも下にデータがある場合のみフィル
        if (maxDataRow > endRow) {
            const count = maxDataRow - endRow;

            applyFillSeries(
                this.table,
                this.selection,
                this.history,
                'down',
                startRow,
                startColumn,
                endRow,
                endColumn,
                endRow + 1,
                startColumn,
                maxDataRow,
                endColumn,
                count
            );
        }
    }

    /**
     * グローバルイベントリスナーを登録する（タブがアクティブになったとき）
     */
    activate(): void {
        window.addEventListener('mousedown', this.mousedownCaptureHandler, true);
        window.addEventListener('dblclick', this.dblclickCaptureHandler, true);
        window.addEventListener('mousemove', this.mousemoveCaptureHandler, true);
        window.addEventListener('mouseup', this.mouseupHandler);
    }

    /**
     * グローバルイベントリスナーを解除する（タブが非アクティブになったとき）
     */
    deactivate(): void {
        window.removeEventListener('mousedown', this.mousedownCaptureHandler, true);
        window.removeEventListener('dblclick', this.dblclickCaptureHandler, true);
        window.removeEventListener('mousemove', this.mousemoveCaptureHandler, true);
        window.removeEventListener('mouseup', this.mouseupHandler);
        this.clearSyntheticCursor();
    }
}
