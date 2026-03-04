import {EditorTableView} from "./editor-table-view";
import {EditorTable} from "./editor-table";
import {Selection} from "./selection";
import {AreaResizer} from "./area-resizer";
import {Command} from "./command";
import {DEFAULT_ROW_HEIGHT} from "./constant";
import {InMemoryTableStore} from "./in-memory-table-store";
import {setViewRowMetadata, getBaseRowIndex} from "./model/view-row-metadata";
import {rebuildExpandedRowsForBaseRow, buildAllKeyMaps, ExpandedRowResult} from "./view-table-data-builder";
import {ViewRowRestructureCommand, SavedViewRowState} from "./view-row-restructure-command";

/**
 * ビュー行構築モジュール
 *
 * 責務:
 * - ビュー行の構築・再構築
 * - DOM行の作成・挿入・削除
 * - 行番号の再設定
 */
export class EditorTableViewRestructure {
    private readonly view: EditorTableView;
    private readonly table: EditorTable;
    private readonly selection: Selection;
    private readonly areaResizer: AreaResizer;
    private readonly store: InMemoryTableStore;

    constructor(view: EditorTableView, table: EditorTable, selection: Selection, areaResizer: AreaResizer, store: InMemoryTableStore) {
        this.view = view;
        this.table = table;
        this.selection = selection;
        this.areaResizer = areaResizer;
        this.store = store;
    }

    /**
     * 指定DOM行インデックス(1始まり)が属するベース行のメタデータ範囲を返す
     * DOM行のdata-base-row-index属性を走査して同一ベース行のグループを特定する
     */
    private findBaseRowMetaRange(metaIndex: number): { metaStart: number; metaEnd: number } {
        const tableElement = this.table.getTableElement();
        const domIndex = metaIndex + 1;
        const domRow = tableElement.children[domIndex] as HTMLElement;
        const baseRowIdx = getBaseRowIndex(domRow);
        let metaStart = metaIndex;
        while (metaStart > 0) {
            const prevDomRow = tableElement.children[metaStart] as HTMLElement;
            if (!prevDomRow.hasAttribute('data-base-row-index') || getBaseRowIndex(prevDomRow) !== baseRowIdx) break;
            metaStart--;
        }
        let metaEnd = metaIndex + 1;
        while (metaEnd + 1 < tableElement.children.length) {
            const nextDomRow = tableElement.children[metaEnd + 1] as HTMLElement;
            if (!nextDomRow.hasAttribute('data-base-row-index') || getBaseRowIndex(nextDomRow) !== baseRowIdx) break;
            metaEnd++;
        }
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
        // 旧FK値と新FK値のマッチ行数を比較（Storeから都度構築）
        const keyMap = this.store.buildKeyMap(joinDef.targetTable, joinDef.targetColumn);
        const oldValue = this.table.getCellValueAt(editedRow, editedColumn);
        if (oldValue === newValue) {
            // FK値が同じでも現在のDOM展開行数がキーマップと一致しない場合は再構築が必要
            // （参照先テーブル更新後にビューが更新されていない場合などの不整合を修正する）
            const tableElement = this.table.getTableElement();
            const domRow = tableElement.children[editedRow] as HTMLElement;
            if (!domRow || !domRow.hasAttribute('data-base-row-index')) return false;
            const metaIndex = editedRow - 1;
            const { metaStart, metaEnd } = this.findBaseRowMetaRange(metaIndex);
            const currentCount = metaEnd - metaStart;
            const entries = keyMap.get(newValue);
            const matchCount = entries ? entries.length : 0;
            const effectiveCurrent = Math.max(currentCount, 1);
            const effectiveExpected = Math.max(matchCount, 1);
            return effectiveCurrent !== effectiveExpected;
        }
        const oldEntries = keyMap.get(oldValue);
        const oldMatchCount = oldEntries ? oldEntries.length : 0;
        const newEntries = keyMap.get(newValue);
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
     * @param keyMaps JOINテーブルのキーマップ（propagateToSourceTable前のスナップショットを渡すことで中間状態の影響を避ける）
     * @returns 履歴に追加するCommand
     */
    buildAndExecuteViewRowRestructure(editedRow: number, editedColumn: number, newValue: string, keyMaps: Map<string, Map<string, string[][]>>): Command {
        const viewContext = this.view.getViewContext();
        const tableElement = this.table.getTableElement();
        const columnMappings = viewContext.columnMappings;
        const dataColumnIndex = editedColumn - 1;
        const metaIndex = editedRow - 1;
        // DOM行がdata-base-row-index属性を持たない場合（メタデータ範囲外の空行）、
        // ダミーのDOM属性を設定して通常パスで処理できるようにする
        const currentDomRow = tableElement.children[editedRow] as HTMLElement;
        if (!currentDomRow.hasAttribute('data-base-row-index')) {
            const joins = viewContext.viewDefinition.joins;
            const dummyGroupInfos = joins.map(j => ({
                groupPosition: 0, groupSize: 1,
                sourceTable: j.targetTable, sourceKeyValue: '',
            }));
            setViewRowMetadata(currentDomRow, metaIndex, dummyGroupInfos);
        }
        // DOM属性からベース行インデックスを取得
        const baseRowIndex = getBaseRowIndex(currentDomRow);
        // このベース行に属するメタデータ範囲を特定（DOM走査ベース）
        const { metaStart, metaEnd } = this.findBaseRowMetaRange(metaIndex);
        // 古い行を保存（DOMからデタッチ）
        const domStartIndex = metaStart + 1;
        const oldRows: SavedViewRowState[] = [];
        for (let i = 0; i < metaEnd - metaStart; i++) {
            const domRow = tableElement.children[domStartIndex] as HTMLElement;
            oldRows.push({ domRow });
            domRow.remove();
        }
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
        // 呼び出し元から渡されたキーマップスナップショットを使用して展開行データを計算
        const expandedRows = rebuildExpandedRowsForBaseRow(
            baseColumnValues, columnMappings, viewContext.viewDefinition, keyMaps
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
        const domStartIndex = metaStartIndex + 1;
        const tableElement = this.table.getTableElement();
        // DOMから行を削除
        for (let i = 0; i < removeCount; i++) {
            const row = tableElement.children[domStartIndex];
            if (row) row.remove();
        }
        // 新しい行をDOMに挿入（参照ノードは挿入前に一度だけ取得し、insertBeforeで順序を維持）
        // DOM行自体がdata-base-row-index, data-group-infosを保持するため、メタデータの同期は不要
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
        const tableElement = this.table.getTableElement();
        const columnWidths = this.table.getColumnWidths();
        const referenceNode = domStartIndex < tableElement.children.length
            ? tableElement.children[domStartIndex] as HTMLElement : false as const;
        const newRows: SavedViewRowState[] = [];
        for (let i = 0; i < expandedRows.length; i++) {
            const expanded = expandedRows[i];
            const domRow = this.createViewDataRow(domStartIndex + i, expanded.values, columnWidths);
            // DOM属性にメタデータを設定（DOMがSSOT）
            setViewRowMetadata(domRow, baseRowIndex, expanded.groupInfos);
            // パディングセルにCSSクラスを設定（DOMがSSOT）
            for (let colIdx = 0; colIdx < expanded.padding.length; colIdx++) {
                if (!expanded.padding[colIdx]) continue;
                const cell = domRow.children[colIdx + 1] as HTMLElement;
                if (cell) {
                    cell.classList.add('view-padding-cell');
                    cell.textContent = '';
                }
            }
            if (referenceNode) {
                tableElement.insertBefore(domRow, referenceNode);
            } else {
                tableElement.appendChild(domRow);
            }
            newRows.push({ domRow });
        }
        // ビュー行挿入後の後処理を実行する（行再構築で作り直されたセルにはヒントがないため）
        this.finalizeInsertedViewRows(metaStart, newRows.length, true);
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
     * ビュー全体の行再構築を行う（タブ切替時用）
     * DOM行のdata-base-row-index属性を走査してグループを特定し、差分更新を行う
     */
    refreshViewRows(): void {
        if (!this.view.hasViewContext()) return;
        const viewContext = this.view.getViewContext();
        const tableElement = this.table.getTableElement();
        const columnMappings = viewContext.columnMappings;
        // ベーステーブルの行データをストアから取得（DOMではなくSSOTから読む）
        const baseTable = viewContext.viewDefinition.baseTable;
        const storeRows = this.store.getRows(baseTable);
        if (storeRows === false) return;
        // Storeから都度キーマップを構築（ループ外で一度だけ）
        const keyMaps = buildAllKeyMaps(this.store, viewContext.viewDefinition);
        // DOM行を走査して各ベース行のグループを特定し、展開行数の差分を検出
        let domIdx = 1; // DOM行は1始まり（0はヘッダー行）
        while (domIdx < tableElement.children.length) {
            const domRow = tableElement.children[domIdx] as HTMLElement;
            if (!domRow.hasAttribute('data-base-row-index')) break;
            const baseRowIndex = getBaseRowIndex(domRow);
            const metaStart = domIdx - 1;
            const domGroupStart = domIdx;
            // このベース行のグループ終端を検索（DOM走査）
            while (domIdx < tableElement.children.length) {
                const nextRow = tableElement.children[domIdx] as HTMLElement;
                if (!nextRow.hasAttribute('data-base-row-index') || getBaseRowIndex(nextRow) !== baseRowIndex) break;
                domIdx++;
            }
            const currentCount = domIdx - domGroupStart;
            // ベーステーブル列の値をストアから取得（タブ切替後もSSOTに同期）
            const totalColumns = columnMappings.length;
            const baseColumnValues: string[] = new Array(totalColumns).fill('');
            if (baseRowIndex < storeRows.length) {
                const storeRow = storeRows[baseRowIndex];
                for (let i = 0; i < totalColumns; i++) {
                    if (columnMappings[i].joinLevel === 0) {
                        baseColumnValues[i] = storeRow[columnMappings[i].sourceColumnIndex];
                    }
                }
            }
            // 新しい展開行数を計算
            const expandedRows = rebuildExpandedRowsForBaseRow(
                baseColumnValues, columnMappings, viewContext.viewDefinition, keyMaps
            );
            if (expandedRows.length === currentCount) {
                // 行数が同じでも値が変わっている可能性があるので、全列の値を差分更新
                for (let i = 0; i < currentCount; i++) {
                    const currentDomRow = tableElement.children[domGroupStart + i] as HTMLElement;
                    for (let colIdx = 0; colIdx < totalColumns; colIdx++) {
                        const cell = currentDomRow.children[colIdx + 1] as HTMLElement;
                        if (!cell) continue;
                        // パディングセルはスキップ（DOMのCSSクラスで判定）
                        if (cell.classList.contains('view-padding-cell')) continue;
                        const newVal = expandedRows[i].values[colIdx];
                        const oldVal = EditorTable.getCellValue(cell);
                        if (oldVal !== newVal) this.table.updateCellValueAt(domGroupStart + i, colIdx + 1, newVal);
                    }
                }
                continue;
            }
            // 行数が異なる場合: 再構築
            for (let i = 0; i < currentCount; i++) {
                const row = tableElement.children[domGroupStart];
                if (row) row.remove();
            }
            this.buildAndInsertExpandedViewRows(metaStart, baseRowIndex, expandedRows);
            // domIdxを再調整（挿入した行数分）
            domIdx = domGroupStart + expandedRows.length;
        }
        this.selection.clearCopyRange();
        this.selection.updateRendererAfterResize();
    }
}
