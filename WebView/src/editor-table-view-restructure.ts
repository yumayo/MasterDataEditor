import {EditorTableView} from "./editor-table-view";
import {EditorTable} from "./editor-table";
import {Selection} from "./selection";
import {AreaResizer} from "./area-resizer";
import {Command, CompositeCommand} from "./command";
import {DEFAULT_ROW_HEIGHT} from "./constant";
import {ViewRowMetadata} from "./model/view-row-metadata";
import {rebuildExpandedRowsForBaseRow, ExpandedRowResult} from "./view-table-data-builder";
import {ViewRowRestructureCommand, SavedViewRowState, createMetadataExpansionCommand} from "./view-row-restructure-command";

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
        // メタデータ範囲外の行の場合、ダミーメタデータで拡張する
        // ペースト時はHandler側のMetadataExpansionCommandで事前拡張済みのため到達しない
        // 単一セル編集やドロップダウン選択時にここに到達する
        const expansionCmd = metaIndex >= viewContext.rowMetadata.length
            ? createMetadataExpansionCommand(this.table, editedRow)
            : false as const;
        if (expansionCmd) expansionCmd.execute();
        // ここから先は常にメタデータ範囲内として処理する（通常パス）
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
        // 新しいDOM行を作成して挿入
        const newRows = this.buildAndInsertExpandedViewRows(metaStart, baseRowIndex, expandedRows);
        this.selection.clearCopyRange();
        this.selection.updateRendererAfterResize();
        const restructureCmd = new ViewRowRestructureCommand(this.table, oldRows, newRows, metaStart);
        if (expansionCmd) {
            return new CompositeCommand([expansionCmd, restructureCmd]);
        }
        return restructureCmd;
    }

    /**
     * ビュー行を入れ替える（Command.execute/undo/redoから呼ばれる）
     *
     * @param metaStartIndex メタデータ開始インデックス
     * @param removeCount 削除する行数
     * @param insertRows 挿入する行の状態配列
     */
    replaceViewRows(metaStartIndex: number, removeCount: number, insertRows: SavedViewRowState[]): void {
        const domStartIndex = metaStartIndex + 1;
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
        // ビュー行挿入後の後処理を実行する（Undo/Redoで復元された行にはヒントが消失しているため）
        this.finalizeInsertedViewRows(metaStartIndex, insertRows.length, false);
        // 選択範囲をクリア
        this.selection.clearCopyRange();
        this.selection.updateRendererAfterResize();
    }

    /**
     * 展開行データからDOM行を作成してテーブルに挿入する
     * buildAndExecuteViewRowRestructureとrefreshViewRowsの共通処理
     *
     * @param metaStart メタデータの挿入開始インデックス（DOM位置はmetaStart+1で計算）
     * @param baseRowIndex ベーステーブルの行インデックス
     * @param expandedRows 展開行データの配列
     * @returns 作成された行状態の配列（Undo用）
     */
    private buildAndInsertExpandedViewRows(
        metaStart: number, baseRowIndex: number, expandedRows: ExpandedRowResult[]
    ): SavedViewRowState[] {
        const domStartIndex = metaStart + 1;
        const metaInsertIndex = metaStart;
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
        // ビュー行挿入後の後処理を実行する（行再構築で作り直されたセルにはヒントがないため）
        this.finalizeInsertedViewRows(metaInsertIndex, newRows.length, true);
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
            if (j >= columnWidths.length) {
                throw new Error(`columnWidths の長さ(${columnWidths.length})が values の長さ(${values.length})より短いです`);
            }
            const width = columnWidths[j];
            const cell = EditorTable.createCell(this.table, values[j], j, width, DEFAULT_ROW_HEIGHT);
            cells.push(cell);
        }
        return EditorTable.createRow(cells, rowIndex);
    }

    /**
     * ビュー行のDOM挿入後に必要な後処理を一括実行する
     *
     * 以下の3ステップを規定の順序で実行する:
     * 1. 行番号の再付番 (renumberRowsFrom)
     * 2. ビュー行スタイルの適用 (applyViewRowStylesForRange)
     * 3. 参照ヒントの適用 (updateReferenceHintsForRows)
     *
     * 将来新しい後処理ステップが追加される場合はこのメソッドに追記する。
     *
     * @param metaStartIndex 挿入された行のメタデータ開始インデックス
     * @param insertedCount 挿入された行数
     * @param applyPadding パディングセルのスタイルを適用するか（新規作成時true、復元時false）
     */
    private finalizeInsertedViewRows(metaStartIndex: number, insertedCount: number, applyPadding: boolean): void {
        const domStartIndex = metaStartIndex + 1;
        this.renumberRowsFrom(domStartIndex);
        this.view.applyViewRowStylesForRange(metaStartIndex, metaStartIndex + insertedCount, applyPadding);
        this.table.updateReferenceHintsForRows(domStartIndex, domStartIndex + insertedCount);
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
            this.buildAndInsertExpandedViewRows(metaStart, baseRowIndex, expandedRows);
            // metaIdxを再調整（挿入した行数分）
            metaIdx = metaStart + expandedRows.length;
        }
        this.selection.clearCopyRange();
        this.selection.updateRendererAfterResize();
    }
}
