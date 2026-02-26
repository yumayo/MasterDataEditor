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
