import {EditorTableView} from "./editor-table-view";
import {EditorTable} from "./editor-table";
import {Selection} from "./selection";
import {AreaResizer} from "./area-resizer";
import {Command} from "./command";
import {DEFAULT_COLUMN_WIDTH, DEFAULT_ROW_HEIGHT} from "./constant";
import {ViewRowMetadata, ViewRowGroupInfo} from "./model/view-row-metadata";
import {rebuildExpandedRowsForBaseRow, ExpandedRowResult} from "./view-table-data-builder";
import {ViewRowRestructureCommand, SavedViewRowState} from "./view-row-restructure-command";

/**
 * ビュー行構築モジュール
 *
 * 責務:
 * - ビュー行の構築・再構築
 * - DOM行の作成・挿入・削除
 * - 行番号の再設定
 * - JOINテーブルのキーマップ再構築
 */
export class EditorTableViewRestructure {
    private readonly view: EditorTableView;
    private readonly table: EditorTable;
    private readonly selection: Selection;
    private readonly areaResizer: AreaResizer;

    constructor(view: EditorTableView, table: EditorTable, selection: Selection, areaResizer: AreaResizer) {
        this.view = view;
        this.table = table;
        this.selection = selection;
        this.areaResizer = areaResizer;
    }

    /**
     * 指定メタデータインデックスが属するベース行のメタデータ範囲を返す
     */
    private findBaseRowMetaRange(metaIndex: number): { metaStart: number; metaEnd: number } {
        const viewContext = this.view.getViewContext();
        const baseRowIndex = viewContext.rowMetadata[metaIndex].baseRowIndex;
        let metaStart = metaIndex;
        while (metaStart > 0 && viewContext.rowMetadata[metaStart - 1].baseRowIndex === baseRowIndex) metaStart--;
        let metaEnd = metaIndex + 1;
        while (metaEnd < viewContext.rowMetadata.length && viewContext.rowMetadata[metaEnd].baseRowIndex === baseRowIndex) metaEnd++;
        return { metaStart, metaEnd };
    }

    /**
     * 編集されたセルがビューのJOINソース列であり、行数が変わるかを判定する
     *
     * @param editedRow DOM行インデックス（1始まり）
     * @param editedColumn DOM列インデックス（0始まり、行ヘッダー含む）
     * @param newValue 新しいFK値
     * @returns 行数が変わる場合はtrue
     */
    needsViewRowRestructure(editedRow: number, editedColumn: number, newValue: string): boolean {
        if (!this.view.hasViewContext()) return false;
        const viewContext = this.view.getViewContext();
        const dataColumnIndex = editedColumn - 1;
        if (dataColumnIndex < 0 || dataColumnIndex >= viewContext.columnMappings.length) return false;
        const mapping = viewContext.columnMappings[dataColumnIndex];
        // JOIN列やパディングセルの編集は対象外
        if (mapping.isJoinedColumn) return false;
        // このベーステーブル列がJOINのソース列か判定
        const joinDef = viewContext.viewDefinition.joins.find(j => {
            const sourceTable = j.sourceTable === '' ? viewContext.viewDefinition.baseTable : j.sourceTable;
            return sourceTable === mapping.tableName && j.sourceColumn === mapping.sourceColumnName;
        });
        if (!joinDef) return false;
        // 旧FK値と新FK値のマッチ行数を比較
        const keyMap = viewContext.joinTableKeyMaps.get(joinDef.targetTable);
        const oldValue = this.table.getCellValueAt(editedRow, editedColumn);
        if (oldValue === newValue) {
            // FK値が同じでも現在のDOM展開行数がキーマップと一致しない場合は再構築が必要
            // （参照先テーブル更新後にビューが更新されていない場合などの不整合を修正する）
            const metaIndex = editedRow - 1;
            if (metaIndex < 0 || metaIndex >= viewContext.rowMetadata.length) return false;
            const { metaStart, metaEnd } = this.findBaseRowMetaRange(metaIndex);
            const currentCount = metaEnd - metaStart;
            const entries = keyMap ? keyMap.get(newValue) : false as const;
            const matchCount = entries ? entries.length : 0;
            const effectiveCurrent = Math.max(currentCount, 1);
            const effectiveExpected = Math.max(matchCount, 1);
            return effectiveCurrent !== effectiveExpected;
        }
        const oldEntries = keyMap ? keyMap.get(oldValue) : false as const;
        const oldMatchCount = oldEntries ? oldEntries.length : 0;
        const newEntries = keyMap ? keyMap.get(newValue) : false as const;
        const newMatchCount = newEntries ? newEntries.length : 0;
        // 0件の場合はLEFT JOINで1行（空行）になるため実質1扱い
        const effectiveOld = Math.max(oldMatchCount, 1);
        const effectiveNew = Math.max(newMatchCount, 1);
        // 行数変化時は再構築が必要。行数が同じでも展開が2行以上の場合、FK値が変わればパディング行の内容が変わるため再構築が必要
        return effectiveOld !== effectiveNew || effectiveOld > 1;
    }

    /**
     * FK値変更に伴うビュー行の再構築を実行し、Undo/Redo用のCommandを返す
     *
     * @param editedRow DOM行インデックス（1始まり）
     * @param editedColumn DOM列インデックス（0始まり、行ヘッダー含む）
     * @param newValue 変更後のFK値
     * @returns 履歴に追加するCommand
     */
    buildAndExecuteViewRowRestructure(editedRow: number, editedColumn: number, newValue: string): Command {
        const viewContext = this.view.getViewContext();
        const tableElement = this.table.getTableElement();
        const columnMappings = viewContext.columnMappings;
        const dataColumnIndex = editedColumn - 1;
        const metaIndex = editedRow - 1;
        // メタデータ範囲外の行（ペーストで空行にデータが書き込まれた場合）は専用メソッドへ委譲
        if (metaIndex >= viewContext.rowMetadata.length) {
            return this.restructureNewBaseRow(editedColumn, newValue, metaIndex);
        }
        const baseRowIndex = viewContext.rowMetadata[metaIndex].baseRowIndex;
        // このベース行に属するメタデータ範囲を特定
        const { metaStart, metaEnd } = this.findBaseRowMetaRange(metaIndex);
        // 古い行を保存（DOMからデタッチ）
        const domStartIndex = metaStart + 1;
        const oldRows: SavedViewRowState[] = [];
        for (let i = 0; i < metaEnd - metaStart; i++) {
            const domRow = tableElement.children[domStartIndex] as HTMLElement;
            oldRows.push({ domRow, metadata: viewContext.rowMetadata[metaStart + i] });
            domRow.remove();
        }
        viewContext.rowMetadata.splice(metaStart, metaEnd - metaStart);
        // ベーステーブル列の値を構築（変更されたFK値を反映）
        const totalColumns = columnMappings.length;
        const baseColumnValues: string[] = new Array(totalColumns).fill('');
        const leaderDomRow = oldRows[0].domRow;
        for (let i = 0; i < totalColumns; i++) {
            if (i === dataColumnIndex) {
                baseColumnValues[i] = newValue;
            } else if (columnMappings[i].joinLevel === 0) {
                const cell = leaderDomRow.children[i + 1] as HTMLElement;
                baseColumnValues[i] = EditorTable.getCellValue(cell);
            }
        }
        // 新しい展開行データを計算
        const expandedRows = rebuildExpandedRowsForBaseRow(
            baseColumnValues, columnMappings, viewContext.viewDefinition, viewContext.joinTableKeyMaps
        );
        // 新しいDOM行を作成して挿入（メタデータ範囲内ではDOM位置=metaStart+1、メタデータ位置=metaStart）
        const newRows = this.buildAndInsertExpandedViewRows(metaStart + 1, metaStart, baseRowIndex, expandedRows);
        this.selection.clearCopyRange();
        this.selection.updateRendererAfterResize();
        return new ViewRowRestructureCommand(this.table, oldRows, newRows, metaStart, metaStart + 1);
    }

    /**
     * メタデータ範囲外の行（新規ベース行）をFK値に基づいて再構築する
     * ペーストで空行にデータが書き込まれた後、FK値変更に伴い展開行を生成する
     *
     * メタデータ範囲外の行ではDOM位置（metaIndex+1）とメタデータ挿入位置（配列末尾）が
     * 一致しないため、buildAndInsertExpandedViewRowsにそれぞれ独立した位置を渡す
     */
    private restructureNewBaseRow(
        editedColumn: number, newValue: string, metaIndex: number
    ): Command {
        const viewContext = this.view.getViewContext();
        const tableElement = this.table.getTableElement();
        const columnMappings = viewContext.columnMappings;
        const dataColumnIndex = editedColumn - 1;
        const baseRowIndex = metaIndex;
        // 現在のDOM行を保存（デタッチ）
        const domStartIndex = metaIndex + 1;
        const domRow = tableElement.children[domStartIndex] as HTMLElement;
        // 新規行用の仮メタデータを生成（Undo復元用）
        const syntheticGroupInfos: ViewRowGroupInfo[] = [];
        for (const join of viewContext.viewDefinition.joins) {
            syntheticGroupInfos.push({
                groupPosition: 0, groupSize: 1,
                sourceTable: join.targetTable, sourceKeyValue: '',
            });
        }
        const oldMetadata: ViewRowMetadata = {
            baseRowIndex,
            groupInfos: syntheticGroupInfos,
            paddingColumns: new Array(columnMappings.length).fill(false),
        };
        const oldRows: SavedViewRowState[] = [{ domRow, metadata: oldMetadata }];
        domRow.remove();
        // ベーステーブル列の値を構築（変更されたFK値を反映）
        const totalColumns = columnMappings.length;
        const baseColumnValues: string[] = new Array(totalColumns).fill('');
        for (let i = 0; i < totalColumns; i++) {
            if (i === dataColumnIndex) {
                baseColumnValues[i] = newValue;
            } else if (columnMappings[i].joinLevel === 0) {
                const cell = domRow.children[i + 1] as HTMLElement;
                baseColumnValues[i] = EditorTable.getCellValue(cell);
            }
        }
        // 新しい展開行データを計算
        const expandedRows = rebuildExpandedRowsForBaseRow(
            baseColumnValues, columnMappings, viewContext.viewDefinition, viewContext.joinTableKeyMaps
        );
        // MetadataExpansionCommandでダミーメタデータが事前追加済みのため、
        // rowMetadata.lengthはダミーを含む値になる。FK再構築が降順で実行され
        // 各行がメタデータ末尾に追加されても、replaceViewRowsのundo/redoは
        // metaStartIndexで正確に位置を指定するため、順序の不整合は発生しない。
        // メタデータは配列末尾に追加し、DOM行はmetaIndex+1の位置に挿入する
        // （MetadataExpansionCommand適用後のrowMetadata.lengthが正しい挿入位置となり、
        //   applyViewRowStylesForRangeに正しいインデックスを渡すため明示的に末尾を使う）
        const metaInsertIndex = viewContext.rowMetadata.length;
        const newRows = this.buildAndInsertExpandedViewRows(
            domStartIndex, metaInsertIndex, baseRowIndex, expandedRows
        );
        this.selection.clearCopyRange();
        this.selection.updateRendererAfterResize();
        // DOM位置とメタデータ位置を別々に保持してUndo/Redoに渡す
        return new ViewRowRestructureCommand(this.table, oldRows, newRows, metaInsertIndex, domStartIndex);
    }

    /**
     * ビュー行を入れ替える（Command.execute/undo/redoから呼ばれる）
     *
     * @param metaStartIndex メタデータ開始インデックス
     * @param removeCount 削除する行数
     * @param insertRows 挿入する行の状態配列
     * @param domStartIndex DOM行の開始インデックス（メタデータ範囲外の再構築で使用）
     */
    replaceViewRows(metaStartIndex: number, removeCount: number, insertRows: SavedViewRowState[], domStartIndex: number): void {
        const viewContext = this.view.getViewContext();
        const tableElement = this.table.getTableElement();
        // DOMから行を削除
        for (let i = 0; i < removeCount; i++) {
            const row = tableElement.children[domStartIndex];
            if (row) row.remove();
        }
        viewContext.rowMetadata.splice(metaStartIndex, removeCount);
        // 新しい行をDOMに挿入（参照ノードは挿入前に一度だけ取得し、insertBeforeで順序を維持）
        if (domStartIndex < tableElement.children.length) {
            const referenceNode = tableElement.children[domStartIndex] as HTMLElement;
            for (const row of insertRows) {
                tableElement.insertBefore(row.domRow, referenceNode);
            }
        } else {
            for (const row of insertRows) {
                tableElement.appendChild(row.domRow);
            }
        }
        viewContext.rowMetadata.splice(metaStartIndex, 0, ...insertRows.map(r => r.metadata));
        // 行番号を更新
        this.renumberRowsFrom(domStartIndex);
        // ビュースタイルを再適用
        this.view.applyViewRowStylesForRange(metaStartIndex, metaStartIndex + insertRows.length, false);
        // 選択範囲をクリア
        this.selection.clearCopyRange();
        this.selection.updateRendererAfterResize();
    }

    /**
     * 展開行データからDOM行を作成してテーブルに挿入する
     * buildAndExecuteViewRowRestructure、restructureNewBaseRow、refreshViewRowsの共通処理
     *
     * @param domStartIndex DOM行の挿入開始位置（1始まり）
     * @param metaInsertIndex メタデータの挿入開始インデックス
     * @param baseRowIndex ベーステーブルの行インデックス
     * @param expandedRows 展開行データの配列
     * @returns 作成された行状態の配列（Undo用）
     */
    private buildAndInsertExpandedViewRows(
        domStartIndex: number, metaInsertIndex: number,
        baseRowIndex: number, expandedRows: ExpandedRowResult[]
    ): SavedViewRowState[] {
        const viewContext = this.view.getViewContext();
        const tableElement = this.table.getTableElement();
        const columnWidths = this.table.getColumnWidths();
        const referenceNode = domStartIndex < tableElement.children.length
            ? tableElement.children[domStartIndex] as HTMLElement : false as const;
        const newRows: SavedViewRowState[] = [];
        for (let i = 0; i < expandedRows.length; i++) {
            const expanded = expandedRows[i];
            const domRow = this.createViewDataRow(domStartIndex + i, expanded.values, columnWidths);
            if (referenceNode) {
                tableElement.insertBefore(domRow, referenceNode);
            } else {
                tableElement.appendChild(domRow);
            }
            const metadata: ViewRowMetadata = {
                baseRowIndex, groupInfos: expanded.groupInfos, paddingColumns: expanded.padding,
            };
            newRows.push({ domRow, metadata });
        }
        viewContext.rowMetadata.splice(metaInsertIndex, 0, ...newRows.map(r => r.metadata));
        this.renumberRowsFrom(domStartIndex);
        this.view.applyViewRowStylesForRange(metaInsertIndex, metaInsertIndex + newRows.length, true);
        return newRows;
    }

    /**
     * ビュー行のDOM要素を作成する
     * イベントハンドラ付きのセルを含む完全な行要素を返す
     */
    private createViewDataRow(rowIndex: number, values: string[], columnWidths: string[]): HTMLElement {
        const cells: HTMLElement[] = [];
        const rowHeader = this.table.structure.createRowHeaderCell(String(rowIndex), rowIndex - 1);
        cells.push(rowHeader);
        for (let j = 0; j < values.length; j++) {
            const width = j < columnWidths.length ? columnWidths[j] : DEFAULT_COLUMN_WIDTH;
            const cell = EditorTable.createCell(this.table, values[j], j, width, DEFAULT_ROW_HEIGHT);
            cells.push(cell);
        }
        return EditorTable.createRow(cells, rowIndex);
    }

    /**
     * 指定DOM位置以降の全行の行番号を再設定する
     */
    renumberRowsFrom(startDomIndex: number): void {
        const tableElement = this.table.getTableElement();
        for (let i = startDomIndex; i < tableElement.children.length; i++) {
            const row = tableElement.children[i] as HTMLElement;
            row.dataset.row = String(i);
            const header = row.children[0] as HTMLElement;
            if (!header.classList.contains('editor-table-row-header')) continue;
            // テキストノードを更新
            const existingTextNode = Array.from(header.childNodes).find(node => node.nodeType === Node.TEXT_NODE);
            if (existingTextNode) {
                existingTextNode.textContent = String(i);
            } else {
                header.insertBefore(document.createTextNode(String(i)), header.firstChild);
            }
            header.dataset.rowIndex = String(i - 1);
            // リサイズハンドルのイベントハンドラを再設定
            const existingHandle = header.querySelector('.row-resize-handle');
            if (existingHandle) existingHandle.remove();
            const newHandle = document.createElement('div');
            newHandle.classList.add('row-resize-handle');
            this.areaResizer.setupRowResizeHandle(newHandle, header, i);
            header.appendChild(newHandle);
        }
    }

    /**
     * ビューコンテキストのjoinTableKeyMapsを再構築する
     */
    rebuildJoinTableKeyMaps(openEditorTables: Map<string, EditorTable>): void {
        if (!this.view.hasViewContext()) return;
        const viewContext = this.view.getViewContext();
        const viewDefinition = viewContext.viewDefinition;
        const newKeyMaps = new Map<string, Map<string, string[][]>>();
        for (const join of viewDefinition.joins) {
            const editorTable = openEditorTables.get(join.targetTable);
            if (!editorTable) {
                // テーブルが開かれていない場合は既存のキーマップを保持
                const existing = viewContext.joinTableKeyMaps.get(join.targetTable);
                if (existing) newKeyMaps.set(join.targetTable, existing);
                continue;
            }
            // DOMからデータを読み取ってキーマップを再構築
            const columnCount = editorTable.getColumnCount();
            const rowCount = editorTable.getRowCount();
            // ターゲット列のインデックスを特定
            let keyColumnIndex = -1;
            for (let c = 0; c < columnCount; c++) {
                if (editorTable.getColumnHeaderValue(c) === join.targetColumn) {
                    keyColumnIndex = c;
                    break;
                }
            }
            if (keyColumnIndex === -1) continue;
            const keyMap = new Map<string, string[][]>();
            for (let r = 1; r < rowCount; r++) {
                const keyValue = editorTable.getCellValueAt(r, keyColumnIndex + 1);
                if (keyValue === '') continue;
                const rowValues: string[] = [];
                for (let c = 0; c < columnCount; c++) {
                    rowValues.push(editorTable.getCellValueAt(r, c + 1));
                }
                let rows = keyMap.get(keyValue);
                if (!rows) { rows = []; keyMap.set(keyValue, rows); }
                rows.push(rowValues);
            }
            newKeyMaps.set(join.targetTable, keyMap);
        }
        viewContext.joinTableKeyMaps = newKeyMaps;
    }

    /**
     * ビュー全体の行再構築を行う（タブ切替時用）
     */
    refreshViewRows(): void {
        if (!this.view.hasViewContext()) return;
        const viewContext = this.view.getViewContext();
        const tableElement = this.table.getTableElement();
        const columnMappings = viewContext.columnMappings;
        const rowMetadata = viewContext.rowMetadata;
        // 各ベース行のグループをスキャンして、展開行数の差分を検出
        let metaIdx = 0;
        while (metaIdx < rowMetadata.length) {
            const baseRowIndex = rowMetadata[metaIdx].baseRowIndex;
            const metaStart = metaIdx;
            // このベース行のグループ終端を検索
            while (metaIdx < rowMetadata.length && rowMetadata[metaIdx].baseRowIndex === baseRowIndex) {
                metaIdx++;
            }
            const metaEnd = metaIdx;
            const currentCount = metaEnd - metaStart;
            // リーダー行のベーステーブル列値を取得
            const leaderDomIndex = metaStart + 1;
            const leaderDomRow = tableElement.children[leaderDomIndex] as HTMLElement;
            if (!leaderDomRow) continue;
            const totalColumns = columnMappings.length;
            const baseColumnValues: string[] = new Array(totalColumns).fill('');
            for (let i = 0; i < totalColumns; i++) {
                if (columnMappings[i].joinLevel === 0) {
                    const cell = leaderDomRow.children[i + 1] as HTMLElement;
                    if (cell) baseColumnValues[i] = EditorTable.getCellValue(cell);
                }
            }
            // 新しい展開行数を計算
            const expandedRows = rebuildExpandedRowsForBaseRow(
                baseColumnValues, columnMappings, viewContext.viewDefinition, viewContext.joinTableKeyMaps
            );
            if (expandedRows.length === currentCount) {
                // 行数が同じでも値が変わっている可能性があるので、JOIN列の値を更新
                for (let i = 0; i < currentCount; i++) {
                    const domRow = tableElement.children[metaStart + 1 + i] as HTMLElement;
                    for (let colIdx = 0; colIdx < totalColumns; colIdx++) {
                        if (!columnMappings[colIdx].isJoinedColumn) continue;
                        const cell = domRow.children[colIdx + 1] as HTMLElement;
                        if (!cell) continue;
                        if (rowMetadata[metaStart + i].paddingColumns[colIdx]) continue;
                        const newVal = expandedRows[i].values[colIdx];
                        const oldVal = EditorTable.getCellValue(cell);
                        if (oldVal !== newVal) this.table.setCellValueAt(metaStart + 1 + i, colIdx + 1, newVal);
                    }
                }
                continue;
            }
            // 行数が異なる場合: 再構築
            const domStartIndex = metaStart + 1;
            for (let i = 0; i < currentCount; i++) {
                const row = tableElement.children[domStartIndex];
                if (row) row.remove();
            }
            rowMetadata.splice(metaStart, currentCount);
            this.buildAndInsertExpandedViewRows(metaStart + 1, metaStart, baseRowIndex, expandedRows);
            // metaIdxを再調整（挿入した行数分）
            metaIdx = metaStart + expandedRows.length;
        }
        this.selection.clearCopyRange();
        this.selection.updateRendererAfterResize();
    }
}
