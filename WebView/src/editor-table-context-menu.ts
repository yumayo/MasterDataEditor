import {EditorTable} from "./editor-table";
import {Selection} from "./selection";
import {ContextMenu, ContextMenuEntry} from "./context-menu";
import {History} from "./history";
import {ViewHideColumnCommand} from "./view-hide-column-command";

/**
 * コンテキストメニュー管理モジュール
 *
 * 責務:
 * - 列ヘッダーのクリック/右クリックハンドラ
 * - 行ヘッダーのクリック/右クリックハンドラ
 * - Joinメニュー項目の構築
 * - 列の表示/非表示制御
 */
export class EditorTableContextMenu {
    private readonly table: EditorTable;
    private readonly selection: Selection;
    private readonly contextMenu: ContextMenu;
    private readonly history: History;

    constructor(table: EditorTable, selection: Selection, contextMenu: ContextMenu, history: History) {
        this.table = table;
        this.selection = selection;
        this.contextMenu = contextMenu;
        this.history = history;
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
            const menuItems: ContextMenuEntry[] = [
                {label: insertLeftLabel, action: () => { this.table.insertColumns(startColumnIndex, columnCount); }},
                {label: insertRightLabel, action: () => { this.table.insertColumns(endColumnIndex + 1, columnCount); }},
                {label: deleteLabel, action: () => { this.table.removeColumns(startColumnIndex, columnCount); }},
            ];
            // ビューコンテキストがある場合
            if (this.table.hasViewContext()) {
                const viewContext = this.table.getViewContext();
                // 列を非表示メニュー
                menuItems.push({ separator: true });
                menuItems.push({
                    label: '列を非表示',
                    action: () => {
                        this.hideViewColumn(contextMenuColumnIndex);
                    },
                });
                // 非表示列を表示メニュー（非表示列がある場合のみ）
                const hiddenCols = viewContext.viewDefinition.columns.filter(c => c.hidden);
                for (const col of hiddenCols) {
                    menuItems.push({
                        label: '表示: ' + col.tableName + '.' + col.columnName,
                        action: () => {
                            this.showHiddenViewColumn(col.tableName, col.columnName);
                        },
                    });
                }
                // JOIN解除項目を追加
                const removeJoinItems = this.buildRemoveJoinMenuItems();
                if (removeJoinItems.length > 0) {
                    menuItems.push({separator: true});
                    for (const item of removeJoinItems) {
                        menuItems.push(item);
                    }
                }
                // Join項目を追加
                const joinItems = this.buildJoinMenuItems(contextMenuColumnIndex);
                if (joinItems.length > 0) {
                    menuItems.push({separator: true});
                    for (const item of joinItems) {
                        menuItems.push(item);
                    }
                }
            }
            this.contextMenu.show(e.clientX, e.clientY, menuItems);
        };
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

    /**
     * Join用メニュー項目を構築する
     * 既にJoin済みのテーブルは除外する
     */
    private buildJoinMenuItems(columnIndex: number): ContextMenuEntry[] {
        if (!this.table.hasViewContext()) return [];
        const viewContext = this.table.getViewContext();
        const items: ContextMenuEntry[] = [];
        const joinedTables = new Set(viewContext.viewDefinition.joins.map(j => j.targetTable));
        for (const target of viewContext.availableJoinTargets) {
            // 既にJoin済みなら表示しない
            if (joinedTables.has(target.targetTableName)) continue;
            const label = target.isReverse
                ? 'Join: ' + target.targetTableName + ' (reverse: ' + target.targetColumnName + ')'
                : 'Join: ' + target.targetTableName + ' (via ' + target.sourceColumnName + ')';
            items.push({
                label,
                action: () => {
                    this.table.getViewContext().onJoinAsync(target, columnIndex);
                },
            });
        }
        return items;
    }

    /**
     * ビュー列を非表示にする（ViewHideColumnCommandを実行）
     */
    private hideViewColumn(columnIndex: number): void {
        const viewContext = this.table.getViewContext();
        const command = new ViewHideColumnCommand(
            this.table, viewContext.viewDefinition,
            viewContext.columnMappings, viewContext.rowMetadata,
            columnIndex
        );
        const anchor = this.selection.getAnchor();
        const copyRange = this.selection.getCopyRange();
        this.history.executeCommand(command, {
            startRow: anchor.row, startColumn: anchor.column,
            endRow: anchor.row, endColumn: anchor.column,
        }, copyRange);
    }

    /**
     * JOIN解除用メニュー項目を構築する
     * 現在JOINされているテーブルごとに「JOINを解除」メニューを生成する
     */
    private buildRemoveJoinMenuItems(): ContextMenuEntry[] {
        if (!this.table.hasViewContext()) return [];
        const viewContext = this.table.getViewContext();
        const items: ContextMenuEntry[] = [];
        for (const join of viewContext.viewDefinition.joins) {
            items.push({
                label: 'JOINを解除: ' + join.targetTable,
                action: () => {
                    viewContext.onRemoveJoin(join.targetTable);
                },
            });
        }
        return items;
    }

    /**
     * 非表示列を再表示する（viewDefinition.columnsのhiddenをfalseに変更してビューを再構築）
     */
    private showHiddenViewColumn(tableName: string, columnName: string): void {
        this.table.getViewContext().onShowHiddenColumn(tableName, columnName);
    }
}
