import {EditorTable, ViewContext} from "./editor-table";
import {Selection} from "./selection";
import {AreaResizer} from "./area-resizer";
import {CellChange, Command} from "./command";
import {DEFAULT_COLUMN_WIDTH, DEFAULT_ROW_HEIGHT} from "./constant";
import {ViewRowMetadata} from "./model/view-row-metadata";
import {rebuildExpandedRowsForBaseRow, ExpandedRowResult} from "./view-table-data-builder";
import {ViewRowRestructureCommand, SavedViewRowState} from "./view-row-restructure-command";

/**
 * ビュー行管理モジュール
 *
 * 責務:
 * - ビュータブの1:n展開行管理
 * - パディング・グループ折りたたみ
 * - ビュー行再構築（FK値変更時）
 * - JOIN列の値同期
 */
export class EditorTableView {
    private readonly table: EditorTable;
    private readonly selection: Selection;
    private readonly areaResizer: AreaResizer;
    /** ビューコンテキスト（ビュータブのみ） */
    private viewContext: ViewContext | false;

    constructor(table: EditorTable, selection: Selection, areaResizer: AreaResizer) {
        this.table = table;
        this.selection = selection;
        this.areaResizer = areaResizer;
        this.viewContext = false;
    }

    /**
     * ビューコンテキストを設定する
     */
    setViewContext(context: ViewContext): void {
        this.viewContext = context;
        this.applyViewRowStyles();
    }

    /**
     * ビューコンテキストが設定されているかを返す
     * ビュータブの場合のみtrueを返す
     */
    hasViewContext(): boolean {
        return this.viewContext !== false;
    }

    /**
     * ビューコンテキストを取得する
     * hasViewContext()がtrueの場合のみ呼び出すこと
     */
    getViewContext(): ViewContext {
        if (!this.viewContext) throw new Error('viewContextが未設定');
        return this.viewContext;
    }

    /**
     * 1:n展開のパディングセル・グループリーダー行のスタイルを適用する
     * setViewContext()後に呼び出される
     */
    private applyViewRowStyles(): void {
        if (!this.viewContext) return;
        this.applyViewRowStylesForRange(0, this.viewContext.rowMetadata.length, true);
    }

    /**
     * 指定メタデータ範囲のビュー行スタイルを適用する
     * パディング・グループリーダー・折りたたみトグルを設定する
     */
    applyViewRowStylesForRange(startMetaIdx: number, endMetaIdx: number, applyPadding: boolean): void {
        if (!this.viewContext) return;
        const tableElement = this.table.getTableElement();
        const rowMetadata = this.viewContext.rowMetadata;
        const columnMappings = this.viewContext.columnMappings;
        for (let metaIdx = startMetaIdx; metaIdx < endMetaIdx; metaIdx++) {
            const meta = rowMetadata[metaIdx];
            const domRowIndex = metaIdx + 1;
            const rowElement = tableElement.children[domRowIndex] as HTMLElement;
            if (!rowElement) continue;
            // パディングセルのスタイル適用（初期レンダリング時のみ）
            if (applyPadding) {
                for (let colIdx = 0; colIdx < meta.paddingColumns.length; colIdx++) {
                    if (!meta.paddingColumns[colIdx]) continue;
                    const cellElement = rowElement.children[colIdx + 1] as HTMLElement;
                    if (!cellElement) continue;
                    cellElement.classList.add('view-padding-cell');
                    cellElement.textContent = '';
                }
            }
            // グループリーダー行の判定
            const isBaseGroupLeader = meta.groupInfos.length === 0
                || meta.groupInfos.every(g => g.groupPosition === 0);
            if (isBaseGroupLeader && metaIdx > 0) {
                const prevMeta = rowMetadata[metaIdx - 1];
                if (prevMeta.baseRowIndex !== meta.baseRowIndex) {
                    rowElement.classList.add('view-group-leader-row');
                }
            }
            // 折りたたみトグルの配置
            for (const groupInfo of meta.groupInfos) {
                if (groupInfo.groupPosition !== 0 || groupInfo.groupSize <= 1) continue;
                const joinDef = this.viewContext.viewDefinition.joins.find(j => j.targetTable === groupInfo.sourceTable);
                if (!joinDef) continue;
                const sourceTableName = joinDef.sourceTable === ''
                    ? this.viewContext.viewDefinition.baseTable : joinDef.sourceTable;
                const sourceColIdx = columnMappings.findIndex(
                    m => m.tableName === sourceTableName && m.sourceColumnName === joinDef.sourceColumn
                );
                if (sourceColIdx < 0) continue;
                const cellElement = rowElement.children[sourceColIdx + 1] as HTMLElement;
                if (!cellElement) continue;
                // 既存のトグルがあれば除去（重複防止）
                const existingToggle = cellElement.querySelector('.view-collapse-toggle');
                if (existingToggle) existingToggle.remove();
                const toggle = document.createElement('span');
                toggle.classList.add('view-collapse-toggle');
                toggle.textContent = '▼';
                toggle.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                });
                toggle.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.toggleCollapseGroup(metaIdx, groupInfo.sourceTable, toggle);
                });
                toggle.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                });
                cellElement.insertBefore(toggle, cellElement.firstChild);
            }
        }
    }

    /**
     * グループの折りたたみ/展開をトグルする
     * 表示状態の変更のみでデータ変更を伴わないため、Undo/Redo対象外
     */
    private toggleCollapseGroup(leaderMetaIndex: number, targetTable: string, toggle: HTMLElement): void {
        if (!this.viewContext) throw new Error('viewContextが未設定');
        const rowMetadata = this.viewContext.rowMetadata;
        const leaderMeta = rowMetadata[leaderMetaIndex];
        // このグループのgroupInfoを特定
        const groupInfoIndex = leaderMeta.groupInfos.findIndex(g => g.sourceTable === targetTable);
        if (groupInfoIndex === -1) return;
        const isCollapsed = toggle.textContent === '▶';
        if (isCollapsed) {
            // 展開: 子行を表示する
            toggle.textContent = '▼';
            this.setGroupRowsVisibility(leaderMetaIndex, targetTable, groupInfoIndex, true);
        } else {
            // 折りたたみ: 子行を非表示にする
            toggle.textContent = '▶';
            this.setGroupRowsVisibility(leaderMetaIndex, targetTable, groupInfoIndex, false);
        }
        // 行の表示/非表示が変わったので選択範囲の描画を再計算する
        this.selection.updateRendererAfterResize();
    }

    /**
     * グループの子行の表示/非表示を設定する
     */
    private setGroupRowsVisibility(
        leaderMetaIndex: number, targetTable: string, groupInfoIndex: number, visible: boolean
    ): void {
        if (!this.viewContext) throw new Error('viewContextが未設定');
        const tableElement = this.table.getTableElement();
        const rowMetadata = this.viewContext.rowMetadata;
        const leaderMeta = rowMetadata[leaderMetaIndex];
        const leaderGroupInfo = leaderMeta.groupInfos[groupInfoIndex];
        // リーダー行以降の同一グループの行を探す
        for (let i = leaderMetaIndex + 1; i < rowMetadata.length; i++) {
            const meta = rowMetadata[i];
            // ベース行が変わったらグループ終了
            if (meta.baseRowIndex !== leaderMeta.baseRowIndex) break;
            // このレベルのgroupInfoが同じキー値を持つか判定
            if (groupInfoIndex >= meta.groupInfos.length) break;
            const groupInfo = meta.groupInfos[groupInfoIndex];
            if (groupInfo.sourceTable !== targetTable) break;
            if (groupInfo.sourceKeyValue !== leaderGroupInfo.sourceKeyValue) break;
            const domRowIndex = i + 1;
            const rowElement = tableElement.children[domRowIndex] as HTMLElement;
            if (!rowElement) continue;
            rowElement.style.display = visible ? '' : 'none';
        }
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
        if (!this.viewContext) return false;
        const dataColumnIndex = editedColumn - 1;
        if (dataColumnIndex < 0 || dataColumnIndex >= this.viewContext.columnMappings.length) return false;
        const mapping = this.viewContext.columnMappings[dataColumnIndex];
        // JOIN列やパディングセルの編集は対象外
        if (mapping.isJoinedColumn) return false;
        // このベーステーブル列がJOINのソース列か判定
        const viewContext = this.viewContext;
        const joinDef = viewContext.viewDefinition.joins.find(j => {
            const sourceTable = j.sourceTable === '' ? viewContext.viewDefinition.baseTable : j.sourceTable;
            return sourceTable === mapping.tableName && j.sourceColumn === mapping.sourceColumnName;
        });
        if (!joinDef) return false;
        // 旧FK値と新FK値のマッチ行数を比較
        const keyMap = this.viewContext.joinTableKeyMaps.get(joinDef.targetTable);
        const oldValue = this.table.getCellValueAt(editedRow, editedColumn);
        // 値が同じなら変更なし
        if (oldValue === newValue) return false;
        const oldMatchCount = (keyMap && keyMap.has(oldValue)) ? (keyMap.get(oldValue) as string[][]).length : 0;
        const newMatchCount = (keyMap && keyMap.has(newValue)) ? (keyMap.get(newValue) as string[][]).length : 0;
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
        if (!this.viewContext) throw new Error('viewContextが未設定');
        const tableElement = this.table.getTableElement();
        const viewContext = this.viewContext;
        const columnMappings = viewContext.columnMappings;
        const dataColumnIndex = editedColumn - 1;
        const metaIndex = editedRow - 1;
        const baseRowIndex = viewContext.rowMetadata[metaIndex].baseRowIndex;
        // このベース行に属するメタデータ範囲を特定
        let metaStart = metaIndex;
        let metaEnd = metaIndex + 1;
        // 前方に同じbaseRowIndexの行を検索
        while (metaStart > 0 && viewContext.rowMetadata[metaStart - 1].baseRowIndex === baseRowIndex) {
            metaStart--;
        }
        // 後方に同じbaseRowIndexの行を検索
        while (metaEnd < viewContext.rowMetadata.length && viewContext.rowMetadata[metaEnd].baseRowIndex === baseRowIndex) {
            metaEnd++;
        }
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
        return new ViewRowRestructureCommand(this.table, oldRows, newRows, metaStart);
    }

    /**
     * ビュー行を入れ替える（Command.execute/undo/redoから呼ばれる）
     *
     * @param metaStartIndex メタデータ開始インデックス
     * @param removeCount 削除する行数
     * @param insertRows 挿入する行の状態配列
     */
    replaceViewRows(metaStartIndex: number, removeCount: number, insertRows: SavedViewRowState[]): void {
        if (!this.viewContext) throw new Error('viewContextが未設定');
        const tableElement = this.table.getTableElement();
        const domStartIndex = metaStartIndex + 1;
        // DOMから行を削除
        for (let i = 0; i < removeCount; i++) {
            const row = tableElement.children[domStartIndex];
            if (row) row.remove();
        }
        this.viewContext.rowMetadata.splice(metaStartIndex, removeCount);
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
        this.viewContext.rowMetadata.splice(metaStartIndex, 0, ...insertRows.map(r => r.metadata));
        // 行番号を更新
        this.renumberRowsFrom(domStartIndex);
        // ビュースタイルを再適用
        this.applyViewRowStylesForRange(metaStartIndex, metaStartIndex + insertRows.length, false);
        // 選択範囲をクリア
        this.selection.clearCopyRange();
        this.selection.updateRendererAfterResize();
    }

    /**
     * 展開行データからDOM行を作成してテーブルに挿入する
     * buildAndExecuteViewRowRestructureとrefreshViewRowsの共通処理
     *
     * @param metaStart メタデータの挿入開始インデックス
     * @param baseRowIndex ベーステーブルの行インデックス
     * @param expandedRows 展開行データの配列
     * @returns 作成された行状態の配列（Undo用）
     */
    private buildAndInsertExpandedViewRows(
        metaStart: number, baseRowIndex: number, expandedRows: ExpandedRowResult[]
    ): SavedViewRowState[] {
        if (!this.viewContext) throw new Error('viewContextが未設定');
        const tableElement = this.table.getTableElement();
        const columnWidths = this.table.getColumnWidths();
        const domStartIndex = metaStart + 1;
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
        this.viewContext.rowMetadata.splice(metaStart, 0, ...newRows.map(r => r.metadata));
        this.renumberRowsFrom(domStartIndex);
        this.applyViewRowStylesForRange(metaStart, metaStart + newRows.length, true);
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
     * 結合列の編集時に、同一JOINキーを持つ他の行の値を連動更新する
     *
     * @param editedRow 編集された行
     * @param editedColumn 編集された列（0始まり、行ヘッダー含む）
     * @param newValue 新しい値
     * @returns 連動更新された他行のセル変更リスト（Undo/Redo用）
     */
    synchronizeJoinedColumnValues(editedRow: number, editedColumn: number, newValue: string): CellChange[] {
        if (!this.viewContext) return [];
        const viewContext = this.viewContext;
        const columnMappings = viewContext.columnMappings;
        const dataColumnIndex = editedColumn - 1;
        if (dataColumnIndex < 0 || dataColumnIndex >= columnMappings.length) return [];
        const mapping = columnMappings[dataColumnIndex];
        // JOIN列が編集された場合: 同一JOINキーを持つ他行の同列を連動更新
        if (mapping.isJoinedColumn) {
            const baseKeyColumnIndex = columnMappings.findIndex(
                (m) => m.sourceColumnName === mapping.baseKeyColumn && !m.isJoinedColumn
            );
            if (baseKeyColumnIndex === -1) return [];
            const joinKeyValue = this.table.getCellValueAt(editedRow, baseKeyColumnIndex + 1);
            if (joinKeyValue === '') return [];
            const changes: CellChange[] = [];
            const rowCount = this.table.getRowCount();
            for (let r = 1; r < rowCount; r++) {
                if (r === editedRow) continue;
                const rowKeyValue = this.table.getCellValueAt(r, baseKeyColumnIndex + 1);
                if (rowKeyValue !== joinKeyValue) continue;
                const oldValue = this.table.getCellValueAt(r, editedColumn);
                if (oldValue === newValue) continue;
                changes.push({ row: r, column: editedColumn, oldValue, newValue });
                this.table.setCellValueAt(r, editedColumn, newValue);
            }
            return changes;
        }
        // FK列が編集された場合: 対応するJOIN列を新しい参照先の値でリフレッシュ
        const fkColumnName = mapping.sourceColumnName;
        // このFK列をbaseKeyColumnとするJOIN列のインデックスを収集
        const joinedColumnIndices: number[] = [];
        for (let i = 0; i < columnMappings.length; i++) {
            const m = columnMappings[i];
            if (m.isJoinedColumn && m.baseKeyColumn === fkColumnName) {
                joinedColumnIndices.push(i);
            }
        }
        if (joinedColumnIndices.length === 0) return [];
        // 戦略1: ビュー内で新しいFK値と同じ値を持つ別の行を検索（編集中の値を反映）
        const fkColumn = dataColumnIndex + 1;
        const rowCount = this.table.getRowCount();
        for (let r = 1; r < rowCount; r++) {
            if (r === editedRow) continue;
            if (this.table.getCellValueAt(r, fkColumn) === newValue) {
                return this.applyJoinedColumnValues(editedRow, joinedColumnIndices, (joinedDataIndex) => {
                    return this.table.getCellValueAt(r, joinedDataIndex + 1);
                });
            }
        }
        // 戦略2: ドナー行がない場合、結合テーブルのキーマップから直接ルックアップ
        return this.applyJoinedColumnValues(editedRow, joinedColumnIndices, (joinedDataIndex) => {
            const m = columnMappings[joinedDataIndex];
            const keyMap = viewContext.joinTableKeyMaps.get(m.tableName);
            if (!keyMap) return '';
            const joinRows = keyMap.get(newValue);
            if (!joinRows || joinRows.length === 0) return '';
            return joinRows[0][m.sourceColumnIndex];
        });
    }

    /**
     * JOIN列に値を適用し、変更リストを返す
     */
    private applyJoinedColumnValues(
        editedRow: number, joinedColumnIndices: number[],
        getValueForColumn: (joinedDataIndex: number) => string,
    ): CellChange[] {
        const changes: CellChange[] = [];
        for (const joinedDataIndex of joinedColumnIndices) {
            const joinedColumn = joinedDataIndex + 1;
            const newValue = getValueForColumn(joinedDataIndex);
            const oldValue = this.table.getCellValueAt(editedRow, joinedColumn);
            if (oldValue === newValue) continue;
            changes.push({ row: editedRow, column: joinedColumn, oldValue, newValue });
            this.table.setCellValueAt(editedRow, joinedColumn, newValue);
        }
        return changes;
    }

    /**
     * 指定行がビューグループのリーダー行（先頭行）かどうかを判定する
     */
    isViewLeaderRow(row: number): boolean {
        if (!this.viewContext) return true;
        const metaIndex = row - 1;
        if (metaIndex <= 0) return true;
        if (metaIndex >= this.viewContext.rowMetadata.length) return true;
        return this.viewContext.rowMetadata[metaIndex].baseRowIndex
            !== this.viewContext.rowMetadata[metaIndex - 1].baseRowIndex;
    }

    /**
     * 指定セルがパディングセルかどうかを判定する
     */
    isPaddingCell(row: number, column: number): boolean {
        if (!this.viewContext) return false;
        if (column === 0) return false;
        const metadataIndex = row - 1;
        const rowMetadata = this.viewContext.rowMetadata;
        if (metadataIndex < 0 || metadataIndex >= rowMetadata.length) return false;
        const dataColumnIndex = column - 1;
        if (dataColumnIndex < 0 || dataColumnIndex >= rowMetadata[metadataIndex].paddingColumns.length) return false;
        return rowMetadata[metadataIndex].paddingColumns[dataColumnIndex];
    }

    /**
     * 指定範囲にパディングセルが含まれるかを判定する
     */
    containsPaddingCell(startRow: number, startColumn: number, endRow: number, endColumn: number): boolean {
        if (!this.viewContext) return false;
        for (let r = startRow; r <= endRow; r++) {
            for (let c = startColumn; c <= endColumn; c++) {
                if (this.isPaddingCell(r, c)) return true;
            }
        }
        return false;
    }

    /**
     * 指定範囲に編集不可セル（結合列またはパディングセル）が含まれるかを判定する
     */
    containsReadOnlyCell(startRow: number, startColumn: number, endRow: number, endColumn: number): boolean {
        return this.containsJoinedColumn(startColumn, endColumn)
            || this.containsPaddingCell(startRow, startColumn, endRow, endColumn);
    }

    /**
     * 指定された列範囲に結合列が含まれるかを判定する
     */
    containsJoinedColumn(startColumn: number, endColumn: number): boolean {
        if (!this.viewContext) return false;
        for (let c = startColumn; c <= endColumn; c++) {
            const dataColumnIndex = c - 1;
            if (dataColumnIndex < 0 || dataColumnIndex >= this.viewContext.columnMappings.length) continue;
            if (this.viewContext.columnMappings[dataColumnIndex].isJoinedColumn) return true;
        }
        return false;
    }

    /**
     * データ領域の最大行を取得（データが入力されている最後の行）
     */
    getMaxDataRow(): number {
        const tableElement = this.table.getTableElement();
        const dataStartRow = 1;
        let maxRow = 0;
        for (let r = tableElement.children.length - 1; r >= dataStartRow; r--) {
            const rowElement = tableElement.children[r] as HTMLElement;
            if (!rowElement) continue;
            let hasData = false;
            for (let c = 1; c < rowElement.children.length; c++) {
                const cell = rowElement.children[c] as HTMLElement;
                if (cell && cell.textContent && cell.textContent.trim() !== '') {
                    hasData = true;
                    break;
                }
            }
            if (hasData) {
                maxRow = r;
                break;
            }
        }
        return maxRow;
    }

    /**
     * ビューコンテキストのjoinTableKeyMapsを再構築する
     */
    rebuildJoinTableKeyMaps(openEditorTables: Map<string, EditorTable>): void {
        if (!this.viewContext) return;
        const viewDefinition = this.viewContext.viewDefinition;
        const newKeyMaps = new Map<string, Map<string, string[][]>>();
        for (const join of viewDefinition.joins) {
            const editorTable = openEditorTables.get(join.targetTable);
            if (!editorTable) {
                // テーブルが開かれていない場合は既存のキーマップを保持
                const existing = this.viewContext.joinTableKeyMaps.get(join.targetTable);
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
        this.viewContext.joinTableKeyMaps = newKeyMaps;
    }

    /**
     * ビュー全体の行再構築を行う（タブ切替時用）
     */
    refreshViewRows(): void {
        if (!this.viewContext) return;
        const tableElement = this.table.getTableElement();
        const viewContext = this.viewContext;
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
