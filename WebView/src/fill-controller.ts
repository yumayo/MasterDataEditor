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

    constructor(table: EditorTable, selection: Selection, history: History) {
        this.table = table;
        this.selection = selection;
        this.history = history;

        // グローバルmouseupイベントハンドラーを定義
        this.mouseupHandler = () => {
            if (!this.selection.isFilling()) return;

            const fillInfo = this.selection.getFillInfo();
            this.selection.endFill();

            if (fillInfo) {
                // 範囲編集ガード（結合列またはパディングセルを含む場合はフィルを拒否）
                if (this.table.view.isRangeEditBlocked(
                    fillInfo.sourceRange.startRow, fillInfo.sourceRange.startColumn,
                    fillInfo.sourceRange.endRow, fillInfo.sourceRange.endColumn
                )) {
                    this.table.showRejectionFeedback();
                    return;
                }

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
    }

    /**
     * フィルハンドルとテーブルのイベントを登録する
     * EditorTable.initialize() 後に呼び出す
     */
    initialize(): void {
        const fillHandle = this.selection.getFillHandle();

        // フィルハンドルのドラッグ開始
        fillHandle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const anchor = this.selection.getAnchor();
            this.selection.startFill(anchor.row, anchor.column, e.clientX, e.clientY);
        });

        // フィルハンドルのダブルクリック
        fillHandle.addEventListener('dblclick', (e) => {
            e.preventDefault();
            e.stopPropagation();

            this.fillToMaxRow();
        });
    }

    /**
     * ダブルクリックでデータ領域の最大行までフィル
     */
    private fillToMaxRow(): void {
        const maxDataRow = this.table.view.getMaxDataRow();
        const anchor = this.selection.getAnchor();
        const focus = this.selection.getFocus();

        const startRow = Math.min(anchor.row, focus.row);
        const endRow = Math.max(anchor.row, focus.row);
        const startColumn = Math.min(anchor.column, focus.column);
        const endColumn = Math.max(anchor.column, focus.column);

        // 範囲編集ガード（結合列またはパディングセルを含む場合はフィルを拒否）
        if (this.table.view.isRangeEditBlocked(startRow, startColumn, endRow, endColumn)) {
            this.table.showRejectionFeedback();
            return;
        }

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
        window.addEventListener('mouseup', this.mouseupHandler);
    }

    /**
     * グローバルイベントリスナーを解除する（タブが非アクティブになったとき）
     */
    deactivate(): void {
        window.removeEventListener('mouseup', this.mouseupHandler);
    }
}
