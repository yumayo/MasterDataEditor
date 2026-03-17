import {EditorTable} from "./editor-table";
import {Selection} from "./selection";
import {ContextMenu, ContextMenuEntry} from "./context-menu";

/**
 * コンテキストメニュー管理モジュール
 *
 * 責務:
 * - 列ヘッダーのクリック/右クリックハンドラ
 * - 行ヘッダーのクリック/右クリックハンドラ
 */
export class EditorTableContextMenu {
    private readonly table: EditorTable;
    private readonly selection: Selection;
    private readonly contextMenu: ContextMenu;
    /** 読み取り専用フラグ。trueの場合はコンテキストメニューを表示しない */
    private readOnly: boolean;

    constructor(table: EditorTable, selection: Selection, contextMenu: ContextMenu) {
        this.table = table;
        this.selection = selection;
        this.contextMenu = contextMenu;
        this.readOnly = false;
    }

    /**
     * 列ヘッダーのクリックハンドラを生成する
     */
    createColumnHeaderClickHandler(columnHeaderCell: HTMLElement): (e: MouseEvent) => void {
        return (e: MouseEvent) => {
            // 左クリック以外は無視
            if (e.button !== 0) return;
            this.table.getHandler().submitAndHide();
            const clickedColumnIndex = parseInt(columnHeaderCell.dataset.col!) + 1;
            if (e.shiftKey) {
                this.selection.extendToColumn(clickedColumnIndex);
            } else if (e.ctrlKey || e.metaKey) {
                this.selection.addColumn(clickedColumnIndex);
            } else {
                this.selection.selectColumn(clickedColumnIndex);
            }
        };
    }

    /**
     * 列ヘッダーのコンテキストメニューハンドラ
     * 複数列選択時は選択列数分の挿入・削除に対応
     */
    createColumnHeaderContextMenuHandler(columnHeaderCell: HTMLElement): (e: MouseEvent) => void {
        return (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            // 読み取り専用の場合はコンテキストメニューを表示しない
            if (this.readOnly) return;
            const contextMenuColumnIndex = parseInt(columnHeaderCell.dataset.col!);
            const contextMenuSelectionColumnIndex = contextMenuColumnIndex + 1;
            // 選択範囲を取得
            const selRange = this.selection.getSelectionRange();
            // 列全体が選択されているか判定（行範囲がテーブル全高さか確認）
            const lastRow = this.table.getRowCount() - 1;
            const isColumnSelection = selRange.startRow === 1 && selRange.endRow === lastRow;
            // 右クリックした列が選択範囲内か判定
            const isInSelection = contextMenuSelectionColumnIndex >= selRange.startColumn
                && contextMenuSelectionColumnIndex <= selRange.endColumn;
            // 列全体選択かつ範囲内の場合のみ複数列操作とする
            const useSelectedColumns = isColumnSelection && isInSelection;
            // 複数列選択時の列情報を計算
            const columnCount = useSelectedColumns ? selRange.endColumn - selRange.startColumn + 1 : 1;
            const startColumnIndex = useSelectedColumns ? selRange.startColumn - 1 : contextMenuColumnIndex;
            const endColumnIndex = useSelectedColumns ? selRange.endColumn - 1 : contextMenuColumnIndex;
            // 選択範囲外の右クリック時は対象列を選択する
            if (!useSelectedColumns) {
                this.selection.selectColumn(contextMenuSelectionColumnIndex);
            }
            // コンテキストメニュー表示はドラグ操作ではないため、ドラグ状態フラグをリセットする
            this.selection.end();
            // ラベルを列数に応じて変更
            const insertLeftLabel = columnCount > 1 ? `左に${columnCount}列を挿入` : '左に列を挿入';
            const insertRightLabel = columnCount > 1 ? `右に${columnCount}列を挿入` : '右に列を挿入';
            const deleteLabel = columnCount > 1 ? `${columnCount}列を削除` : '列を削除';
            // renderAsHtml トグルは対象列（右クリックした列）に対して行う（複数列選択でも1列ずつ）
            // EditorTableContextMenu は EditorTable の密結合コンポーネントなので tableData.header への直接参照を許容する
            const renderAsHtmlLabel = this.table.getTableData().header[contextMenuColumnIndex]?.renderAsHtml
                ? '✓ HTMLとして表示'
                : '　HTMLとして表示';
            const menuItems: ContextMenuEntry[] = [
                {
                    label: renderAsHtmlLabel,
                    action: () => {
                        this.table.executeRenderAsHtmlToggle(contextMenuColumnIndex);
                    }
                },
                {separator: true},
                {label: insertLeftLabel, action: () => { this.table.insertColumns(startColumnIndex, columnCount); }},
                {label: insertRightLabel, action: () => { this.table.insertColumns(endColumnIndex + 1, columnCount); }},
                {label: deleteLabel, action: () => { this.table.removeColumns(startColumnIndex, columnCount); }},
            ];
            this.contextMenu.show(e.clientX, e.clientY, menuItems);
        };
    }

    /**
     * 読み取り専用にする（ミニEditorTable用）
     * 列・行ヘッダーのコンテキストメニュー（挿入・削除）を封じることでストア汚染を防ぐ。
     * クリックによる選択操作は引き続き許可する。
     */
    makeReadOnly(): void {
        this.readOnly = true;
    }

    /**
     * 行ヘッダーのクリックハンドラを生成する
     */
    createRowHeaderClickHandler(rowHeaderCell: HTMLElement): (e: MouseEvent) => void {
        return (e: MouseEvent) => {
            // 左クリック以外は無視
            if (e.button !== 0) return;
            this.table.getHandler().submitAndHide();
            const clickedRowIndex = parseInt(rowHeaderCell.dataset.rowIndex!) + 1;
            if (e.shiftKey) {
                this.selection.extendToRow(clickedRowIndex);
            } else if (e.ctrlKey || e.metaKey) {
                this.selection.addRow(clickedRowIndex);
            } else {
                this.selection.selectRow(clickedRowIndex);
            }
        };
    }

    /**
     * 行ヘッダーのコンテキストメニューハンドラ
     * 複数行選択時は選択行数分の挿入・削除に対応
     */
    createRowHeaderContextMenuHandler(rowHeaderCell: HTMLElement): (e: MouseEvent) => void {
        return (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            // 読み取り専用の場合はコンテキストメニューを表示しない
            if (this.readOnly) return;
            const contextMenuRowIndex = parseInt(rowHeaderCell.dataset.rowIndex!) + 1;
            // 選択範囲を取得
            const selRange = this.selection.getSelectionRange();
            // 行全体が選択されているか判定（カラム範囲がテーブル全幅か確認）
            const lastColumn = this.table.getTotalColumnCount() - 1;
            const isRowSelection = selRange.startColumn === 1 && selRange.endColumn === lastColumn;
            // 右クリックした行が選択範囲内か判定
            const isInSelection = contextMenuRowIndex >= selRange.startRow && contextMenuRowIndex <= selRange.endRow;
            // 行全体選択かつ範囲内の場合のみ複数行操作とする
            const useSelectedRows = isRowSelection && isInSelection;
            // 複数行選択時の行数を計算
            const rowCount = useSelectedRows ? selRange.endRow - selRange.startRow + 1 : 1;
            const startRow = useSelectedRows ? selRange.startRow : contextMenuRowIndex;
            const endRow = useSelectedRows ? selRange.endRow : contextMenuRowIndex;
            // 選択範囲外の右クリック時は対象行を選択する
            if (!useSelectedRows) {
                this.selection.selectRow(contextMenuRowIndex);
            }
            // コンテキストメニュー表示はドラグ操作ではないため、ドラグ状態フラグをリセットする
            this.selection.end();
            // ラベルを行数に応じて変更
            const insertAboveLabel = rowCount > 1 ? `上に${rowCount}行を挿入` : '上に行を挿入';
            const insertBelowLabel = rowCount > 1 ? `下に${rowCount}行を挿入` : '下に行を挿入';
            const deleteLabel = rowCount > 1 ? `${rowCount}行を削除` : '行を削除';
            this.contextMenu.show(e.clientX, e.clientY, [
                {label: insertAboveLabel, action: () => { this.table.insertRows(startRow, rowCount); }},
                {label: insertBelowLabel, action: () => { this.table.insertRows(endRow + 1, rowCount); }},
                {label: deleteLabel, action: () => { this.table.removeRows(startRow, rowCount); }},
            ]);
        };
    }
}
