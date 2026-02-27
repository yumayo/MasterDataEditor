import {EditorTableView} from "./editor-table-view";
import {EditorTable} from "./editor-table";
import {CellChange} from "./command";

/**
 * ビュー行同期モジュール
 *
 * 責務:
 * - JOIN列の値同期（FK列・結合列の編集時に他行の値を連動更新）
 */
export class EditorTableViewSync {
    private readonly view: EditorTableView;
    private readonly table: EditorTable;

    constructor(view: EditorTableView, table: EditorTable) {
        this.view = view;
        this.table = table;
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
            // FK列がパディングセルの場合: メタデータベースで同一レコードの他行を連動更新
            const metaIndex = editedRow - 1;
            const isFkColumnPadding = metaIndex >= 0 && metaIndex < viewContext.rowMetadata.length
                && viewContext.rowMetadata[metaIndex].paddingColumns[baseKeyColumnIndex];
            if (isFkColumnPadding) {
                return this.synchronizePaddingRowJoinedColumn(editedRow, editedColumn, newValue, mapping.tableName);
            }
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
            // パディング行のFK列は見かけ上空だが実際のFK値ではないのでスキップ
            const metaIndex = r - 1;
            if (metaIndex < viewContext.rowMetadata.length
                && viewContext.rowMetadata[metaIndex].paddingColumns[dataColumnIndex]) continue;
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
     * パディング行の結合列編集時にメタデータベースで同一レコードの他行を連動更新する
     *
     * パディング行のFK列はパディングセルでDOM上空文字列のため、通常のFK値マッチングが使えない。
     * 代わりにメタデータのgroupInfosからsourceTableとsourceKeyValue・groupPositionを使い、
     * 同一レコードを表示する他の行を特定して連動更新する。
     */
    private synchronizePaddingRowJoinedColumn(
        editedRow: number, editedColumn: number, newValue: string, tableName: string
    ): CellChange[] {
        const viewContext = this.view.getViewContext();
        const rowMetadata = viewContext.rowMetadata;
        const editedMetaIndex = editedRow - 1;
        if (editedMetaIndex < 0 || editedMetaIndex >= rowMetadata.length) return [];
        const editedMeta = rowMetadata[editedMetaIndex];
        // mapping.tableNameでマッチするgroupInfoを特定
        const editedGroupInfo = editedMeta.groupInfos.find(g => g.sourceTable === tableName);
        if (!editedGroupInfo) return [];
        const changes: CellChange[] = [];
        // 全行をスキャンし、同一sourceTable・sourceKeyValue・groupPositionの行を連動更新
        for (let metaIdx = 0; metaIdx < rowMetadata.length; metaIdx++) {
            const domRow = metaIdx + 1;
            if (domRow === editedRow) continue;
            const meta = rowMetadata[metaIdx];
            const groupInfo = meta.groupInfos.find(g => g.sourceTable === tableName);
            if (!groupInfo) continue;
            if (groupInfo.sourceKeyValue !== editedGroupInfo.sourceKeyValue) continue;
            if (groupInfo.groupPosition !== editedGroupInfo.groupPosition) continue;
            const oldValue = this.table.getCellValueAt(domRow, editedColumn);
            if (oldValue === newValue) continue;
            changes.push({ row: domRow, column: editedColumn, oldValue, newValue });
            this.table.setCellValueAt(domRow, editedColumn, newValue);
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
            this.table.setCellValueAt(editedRow, joinedColumn, newValue);
        }
        return changes;
    }
}
