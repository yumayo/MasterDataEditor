import {EditorTableView} from "./editor-table-view";
import {EditorTable} from "./editor-table";
import {CellChange} from "./command";
import {InMemoryTableStore} from "./in-memory-table-store";
import {ReferenceDataCache} from "./reference-data-cache";
import {config} from "./config";

/**
 * ビュー行同期モジュール
 *
 * 責務:
 * - JOIN列の値同期（FK列・結合列の編集時に他行の値を連動更新）
 * - ビュー結合列の編集をソーステーブルのDOMとStoreに伝搬
 */
export class EditorTableViewSync {
    private readonly view: EditorTableView;
    private readonly table: EditorTable;
    private readonly store: InMemoryTableStore;
    private readonly referenceDataCache: ReferenceDataCache;

    constructor(view: EditorTableView, table: EditorTable, store: InMemoryTableStore, referenceDataCache: ReferenceDataCache) {
        this.view = view;
        this.table = table;
        this.store = store;
        this.referenceDataCache = referenceDataCache;
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
        if (!this.view.hasViewContext()) return [];
        const viewContext = this.view.getViewContext();
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
            const fkDomColumn = baseKeyColumnIndex + 1;
            // FK列のセル値を取得（空の場合は上方向に走査してグループリーダーのFK値を見つける）
            const joinKeyValue = this.table.getCellValueAt(editedRow, fkDomColumn);
            if (joinKeyValue === '') {
                return this.synchronizeGroupChildJoinedColumn(editedRow, editedColumn, newValue, fkDomColumn);
            }
            const changes: CellChange[] = [];
            const rowCount = this.table.getRowCount();
            for (let r = 1; r < rowCount; r++) {
                if (r === editedRow) continue;
                const rowKeyValue = this.table.getCellValueAt(r, fkDomColumn);
                if (rowKeyValue !== joinKeyValue) continue;
                const oldValue = this.table.getCellValueAt(r, editedColumn);
                if (oldValue === newValue) continue;
                changes.push({ row: r, column: editedColumn, oldValue, newValue });
                this.table.updateCellValueAt(r, editedColumn, newValue);
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
            // 同一列のセルに値が入っていない行はスキップ（パディング行のFK列は空文字列）
            const fkValue = this.table.getCellValueAt(r, fkColumn);
            if (fkValue === '') continue;
            if (fkValue === newValue) {
                return this.applyJoinedColumnValues(editedRow, joinedColumnIndices, (joinedDataIndex) => {
                    return this.table.getCellValueAt(r, joinedDataIndex + 1);
                });
            }
        }
        // 戦略2: ドナー行がない場合、Storeからキーマップを都度構築してルックアップ
        return this.applyJoinedColumnValues(editedRow, joinedColumnIndices, (joinedDataIndex) => {
            const m = columnMappings[joinedDataIndex];
            const keyMap = this.store.buildKeyMap(m.tableName, m.joinKeyColumn);
            const joinRows = keyMap.get(newValue);
            if (!joinRows || joinRows.length === 0) return '';
            return joinRows[0][m.sourceColumnIndex];
        });
    }

    /**
     * FK列が空の行（グループの子行・新規追加行）でJOIN列が編集された場合の同期処理
     * DOM上方向に走査してグループリーダーのFK値を取得し、
     * 同一FK値・同一グループ位置の他行を連動更新する
     */
    private synchronizeGroupChildJoinedColumn(
        editedRow: number, editedColumn: number, newValue: string, fkDomColumn: number
    ): CellChange[] {
        // 上方向に走査してグループリーダーのFK値とグループ内位置を算出
        const leader = this.findGroupLeaderByLookingUp(editedRow, fkDomColumn);
        if (leader.fkValue === '') return [];
        // 全行を1パスでスキャンし、同一FK値・同一グループ位置の行を連動更新
        const changes: CellChange[] = [];
        const rowCount = this.table.getRowCount();
        let currentLeaderValue = '';
        let currentLeaderRow = 0;
        for (let r = 1; r < rowCount; r++) {
            const cellValue = this.table.getCellValueAt(r, fkDomColumn);
            if (cellValue !== '') { currentLeaderValue = cellValue; currentLeaderRow = r; }
            if (r === editedRow) continue;
            if (currentLeaderValue !== leader.fkValue) continue;
            if (r - currentLeaderRow !== leader.groupPosition) continue;
            const oldValue = this.table.getCellValueAt(r, editedColumn);
            if (oldValue === newValue) continue;
            changes.push({ row: r, column: editedColumn, oldValue, newValue });
            this.table.updateCellValueAt(r, editedColumn, newValue);
        }
        return changes;
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
            this.table.updateCellValueAt(editedRow, joinedColumn, newValue);
        }
        return changes;
    }

    /**
     * ビュー結合列の編集をソーステーブルのDOMとStoreに伝搬する
     *
     * ビューで結合列が編集されたとき、対応するソーステーブルのDOMセルと
     * 中央ストアのデータを更新する。
     *
     * 再帰防止: ソーステーブルは通常テーブルでViewContextを持たないため、
     * ソーステーブルのupdateCellValueAtが呼ばれても、EditorTableView.propagateJoinedColumnToSourceTable内の
     * hasViewContext()チェックで即returnする。
     */
    propagateJoinedColumnToSourceTable(row: number, column: number, value: string, oldValue: string): void {
        const viewContext = this.view.getViewContext();
        const dataColumnIndex = column - 1;
        if (dataColumnIndex < 0 || dataColumnIndex >= viewContext.columnMappings.length) {
            throw new Error(`到達不可能: dataColumnIndex=${dataColumnIndex}はcolumnMappingsの範囲外です。ビュー構築済みなら必ず範囲内のはずです。`);
        }
        const mapping = viewContext.columnMappings[dataColumnIndex];
        // ベース列の場合: Lazy Store挿入ロジック付きでストアとfullDataCacheを更新する
        if (!mapping.isJoinedColumn) {
            const baseTable = viewContext.viewDefinition.baseTable;
            const id = this.table.getRowPkValue(row);
            const isPkColumn = mapping.sourceColumnName === config.primaryKeyColumnName;
            if (id === '') {
                // PK空: UndoによるPKクリア時にStore行を除去
                if (isPkColumn && oldValue !== '') {
                    this.store.removeRowByPk(baseTable, oldValue);
                }
                return;
            }
            // PK非空: Store更新を試行
            if (this.store.updateCellValue(baseTable, id, mapping.sourceColumnName, value)) {
                // 成功: 既存Store行が更新された
                const domRow = this.table.getTableElement().children[row] as HTMLElement;
                if (isPkColumn) domRow.dataset.lastSyncedPk = id;
            } else if (isPkColumn) {
                // PK列が設定されたがStore行が未存在 → DOMスナップショットからStore行を生成
                const domRow = this.table.getTableElement().children[row] as HTMLElement;
                // 新規行はInsertViewRowCommand.execute()でdataset.lastSyncedPk=''を設定済み
                // 既存行はこのパスに到達しない（Store行が存在するためupdateCellValueがtrueを返す）
                const lastSyncedPk = domRow.dataset.lastSyncedPk as string;
                if (lastSyncedPk !== '') {
                    this.store.removeRowByPk(baseTable, lastSyncedPk);
                }
                // DOMの全列値からベーステーブルのStore行を生成してappend
                const header = this.store.getHeader(baseTable);
                if (header === false) throw new Error('到達不可能: ベーステーブルのヘッダーが存在しない');
                const newRow: string[] = new Array(header.length).fill('');
                for (let i = 0; i < viewContext.columnMappings.length; i++) {
                    const m = viewContext.columnMappings[i];
                    if (m.tableName !== baseTable || m.isJoinedColumn) continue;
                    const headerIdx = header.indexOf(m.sourceColumnName);
                    if (headerIdx === -1) continue;
                    newRow[headerIdx] = this.table.getCellValueAt(row, i + 1);
                }
                this.store.appendRow(baseTable, newRow);
                domRow.dataset.lastSyncedPk = id;
            }
            this.referenceDataCache.updateFullDataCell(baseTable, id, mapping.sourceColumnIndex, value);
            return;
        }
        // JOINテーブルのPK列判定（Lazy Store挿入のトリガー）
        const isJoinPkColumn = mapping.sourceColumnName === config.primaryKeyColumnName;
        // FK列のDOM列インデックスを算出し、FK値とグループ位置をDOMから取得する
        const fkColumnIndex = viewContext.columnMappings.findIndex(
            m => m.sourceColumnName === mapping.baseKeyColumn && !m.isJoinedColumn
        );
        if (fkColumnIndex === -1) throw new Error('到達不可能: FK列が見つかりません');
        const fkDomColumn = fkColumnIndex + 1;
        let fkValue = this.table.getCellValueAt(row, fkDomColumn);
        let groupPosition = 0;
        if (fkValue === '') {
            const leader = this.findGroupLeaderByLookingUp(row, fkDomColumn);
            fkValue = leader.fkValue;
            groupPosition = leader.groupPosition;
        }
        // JOINテーブルPK列のUndoによるクリア時: Store行を除去して早期リターン
        if (isJoinPkColumn && value === '' && oldValue !== '') {
            this.store.removeRowByPk(mapping.tableName, oldValue);
            const domRowEl = this.table.getTableElement().children[row] as HTMLElement;
            domRowEl.dataset['lastSyncedJoinPk_' + mapping.tableName] = '';
            return;
        }
        if (fkValue === '') return;
        // ソーステーブルのEditorTableを取得（開かれていなければDOMへの伝搬はスキップ）
        const sourceEditorTable = viewContext.openEditorTables.get(mapping.tableName);
        // ソーステーブルのDOMセルを更新（テーブルが開かれている場合のみ）
        // ソーステーブルのupdateCellValueAt内で通常タブ用のStore同期が自動実行される
        if (sourceEditorTable) {
            const keyColumnIndex = this.findSourceTableColumn(sourceEditorTable, mapping.joinKeyColumn);
            const rowCount = sourceEditorTable.getRowCount();
            let matchCount = 0;
            for (let r = 1; r < rowCount; r++) {
                if (sourceEditorTable.getCellValueAt(r, keyColumnIndex) !== fkValue) continue;
                if (matchCount === groupPosition) {
                    const sourceColumn = this.findSourceTableColumn(sourceEditorTable, mapping.sourceColumnName);
                    sourceEditorTable.updateCellValueAt(r, sourceColumn, value);
                    break;
                }
                matchCount++;
            }
        } else {
            // ソーステーブルが開かれていない場合、中央ストアを直接更新する
            const storeHeader = this.store.getHeader(mapping.tableName);
            const storeRows = this.store.getRows(mapping.tableName);
            if (storeHeader === false || storeRows === false) throw new Error('到達不可能: JOINテーブルがStoreに登録されていません');
            const keyColIdx = storeHeader.indexOf(mapping.joinKeyColumn);
            if (keyColIdx !== -1) {
                let matchCount = 0;
                let storeUpdateSucceeded = false;
                for (let r = 0; r < storeRows.length; r++) {
                    if (storeRows[r][keyColIdx] !== fkValue) continue;
                    if (matchCount === groupPosition) {
                        const pkColIdx = storeHeader.indexOf(config.primaryKeyColumnName);
                        if (pkColIdx === -1) throw new Error(`到達不可能: テーブル'${mapping.tableName}'にPK列'${config.primaryKeyColumnName}'が存在しません`);
                        const pkValue = storeRows[r][pkColIdx];
                        this.store.updateCellValue(mapping.tableName, pkValue, mapping.sourceColumnName, value);
                        this.referenceDataCache.updateFullDataCell(mapping.tableName, pkValue, mapping.sourceColumnIndex, value);
                        storeUpdateSucceeded = true;
                        break;
                    }
                    matchCount++;
                }
                // JOINテーブルPK列が設定されたがStore行が未存在 → DOMスナップショットからStore行を生成
                if (!storeUpdateSucceeded && isJoinPkColumn) {
                    const domRowElement = this.table.getTableElement().children[row] as HTMLElement;
                    const datasetKey = 'lastSyncedJoinPk_' + mapping.tableName;
                    // PK変更時: 旧Store行を除去（datasetキーが存在し、かつ空文字列でない場合）
                    if (datasetKey in domRowElement.dataset && domRowElement.dataset[datasetKey] !== '') {
                        this.store.removeRowByPk(mapping.tableName, domRowElement.dataset[datasetKey] as string);
                    }
                    // DOMの全列値からJOINテーブルのStore行を生成
                    const newJoinRow: string[] = new Array(storeHeader.length).fill('');
                    // FK列（joinKeyColumn）にベーステーブルのPK値を設定
                    const joinDef = viewContext.viewDefinition.joins.find(j => j.targetTable === mapping.tableName);
                    if (!joinDef) throw new Error(`到達不可能: JOINテーブル'${mapping.tableName}'のjoin定義が見つかりません`);
                    const fkHeaderIdx = storeHeader.indexOf(joinDef.targetColumn);
                    if (fkHeaderIdx !== -1) newJoinRow[fkHeaderIdx] = fkValue;
                    // DOMスナップショットからJOIN列値を収集
                    for (let ci = 0; ci < viewContext.columnMappings.length; ci++) {
                        const cm = viewContext.columnMappings[ci];
                        if (cm.tableName !== mapping.tableName || !cm.isJoinedColumn || cm.baseKeyColumn !== mapping.baseKeyColumn) continue;
                        const hdrIdx = storeHeader.indexOf(cm.sourceColumnName);
                        if (hdrIdx === -1) continue;
                        newJoinRow[hdrIdx] = this.table.getCellValueAt(row, ci + 1);
                    }
                    this.store.appendRow(mapping.tableName, newJoinRow);
                    // PK値を追跡（次回のPK変更時に旧Store行を除去するため）
                    const pkHdrIdx = storeHeader.indexOf(config.primaryKeyColumnName);
                    if (pkHdrIdx !== -1) domRowElement.dataset[datasetKey] = newJoinRow[pkHdrIdx];
                }
            }
        }
        // Storeは同メソッド内で既に更新済みのため、buildKeyMapで最新のキーマップが取得できる
    }

    /**
     * DOM上で上方向に走査し、グループリーダーのFK値とグループ内位置を返す
     * synchronizeGroupChildJoinedColumnとpropagateJoinedColumnToSourceTableの両方で使用する
     */
    private findGroupLeaderByLookingUp(domRow: number, fkDomColumn: number): { fkValue: string; groupPosition: number } {
        for (let r = domRow - 1; r >= 1; r--) {
            const cellValue = this.table.getCellValueAt(r, fkDomColumn);
            if (cellValue !== '') return { fkValue: cellValue, groupPosition: domRow - r };
        }
        return { fkValue: '', groupPosition: 0 };
    }

    /**
     * ソーステーブル内で列名が一致する列インデックスを探す
     * @returns DOM列インデックス（1始まり、行ヘッダーを含む）
     * @throws ビュー構築済みなら対応する列は必ず存在するはず。見つからない場合はバグ。
     */
    private findSourceTableColumn(sourceTable: EditorTable, columnName: string): number {
        const columnCount = sourceTable.getColumnCount();
        for (let c = 0; c < columnCount; c++) {
            if (sourceTable.getColumnHeaderValue(c) === columnName) return c + 1;
        }
        throw new Error(`到達不可能: ソーステーブルに列'${columnName}'が見つかりません。ビュー構築済みなら必ず存在するはずです。`);
    }

}
