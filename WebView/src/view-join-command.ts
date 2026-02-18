import {Command} from "./command";
import {EditorTable} from "./editor-table";
import {EditorTableData} from
    "./model/editor-table-data";
import {
    ViewDefinition,
    ViewJoinDefinition
} from "./model/view-definition";
import {ViewColumnMapping} from
    "./model/view-column-mapping";

/**
 * Join操作のCommand（Undo/Redo対応）
 *
 * execute: 列を挿入し、ヘッダーとセル値を設定、
 *          columnMappingsとviewDefinitionを更新
 * undo: 挿入した列を削除し、
 *        columnMappingsとviewDefinitionを復元
 */
export class ViewJoinCommand implements Command {
    private readonly editorTable: EditorTable;
    private readonly viewDefinition: ViewDefinition;
    private readonly columnMappings:
        ViewColumnMapping[];
    private readonly joinTableData:
        EditorTableData;
    private readonly targetTable: string;
    private readonly sourceColumn: string;
    private readonly targetColumn: string;
    private readonly afterColumnIndex: number;

    /** 挿入した列数（undo時に削除） */
    private insertedColumnCount: number;
    /** 保存した join 定義（undo/redo用） */
    private savedJoinDef:
        ViewJoinDefinition | undefined;

    constructor(
        editorTable: EditorTable,
        viewDefinition: ViewDefinition,
        columnMappings: ViewColumnMapping[],
        joinTableData: EditorTableData,
        targetTable: string,
        sourceColumn: string,
        targetColumn: string,
        afterColumnIndex: number
    ) {
        this.editorTable = editorTable;
        this.viewDefinition = viewDefinition;
        this.columnMappings = columnMappings;
        this.joinTableData = joinTableData;
        this.targetTable = targetTable;
        this.sourceColumn = sourceColumn;
        this.targetColumn = targetColumn;
        this.afterColumnIndex = afterColumnIndex;
        this.insertedColumnCount = 0;
        this.savedJoinDef = undefined;
    }

    execute(): void {
        // 結合キー列のインデックスを特定
        const keyColumnIndex = this.joinTableData.header.findIndex(
            col => col.name === this.targetColumn
        );

        // キー列を除外した列数
        const colCount = this.joinTableData.header.length - 1;
        this.insertedColumnCount = colCount;

        // 挿入位置（afterColumnIndexの右側）
        const insertPos = this.afterColumnIndex + 1;

        // 列を挿入（空列を挿入後にデータを設定）
        for (let i = 0; i < colCount; i++) {
            this.editorTable.insertColumnInternal(insertPos);
        }

        // ヘッダーを設定（キー列をスキップ）
        let viewColOffset = 0;
        for (let i = 0; i < this.joinTableData.header.length; i++) {
            if (i === keyColumnIndex) continue;
            const col = this.joinTableData.header[i];
            const headerName = this.targetTable + '.' + col.name;
            this.editorTable.setColumnHeaderValue(insertPos + viewColOffset, headerName);
            viewColOffset++;
        }

        // キー値→行データのMapを構築
        const keyMap = new Map<string, string[]>();
        if (keyColumnIndex >= 0) {
            for (const row of this.joinTableData.body) {
                const keyVal = row.values[keyColumnIndex];
                if (keyVal !== '') {
                    keyMap.set(keyVal, row.values);
                }
            }
        }

        // ベーステーブルの参照元列インデックスを取得
        const sourceColIdx = this.findSourceColumnIndex();

        // セル値を設定
        const rowCount = this.editorTable.getRowCount();
        for (let r = 1; r < rowCount; r++) {
            let keyValue = '';
            if (sourceColIdx >= 0) {
                keyValue = this.editorTable.getCellValueAt(r, sourceColIdx + 1);
            }
            const joinedRow = keyMap.get(keyValue);
            let offset = 0;
            for (let i = 0; i < this.joinTableData.header.length; i++) {
                if (i === keyColumnIndex) continue;
                const value = joinedRow ? joinedRow[i] : '';
                this.editorTable.setCellValueAt(r, insertPos + offset + 1, value);
                offset++;
            }
        }

        // columnMappingsを更新（キー列をスキップ）
        const newMappings: ViewColumnMapping[] = [];
        for (let i = 0; i < this.joinTableData.header.length; i++) {
            if (i === keyColumnIndex) continue;
            const col = this.joinTableData.header[i];
            newMappings.push({
                tableName: this.targetTable,
                sourceColumnIndex: i,
                sourceColumnName: col.name,
                isJoinedColumn: true,
                joinKeyColumn: this.targetColumn,
                baseKeyColumn: this.sourceColumn,
                joinLevel: 1, // UIからの動的JOINは常にベーステーブルからの直接JOIN（レベル1）のみ対応
            });
        }
        this.columnMappings.splice(insertPos, 0, ...newMappings);

        // viewDefinitionにjoinを追加
        const joinDef: ViewJoinDefinition = {
            sourceColumn: this.sourceColumn,
            targetTable: this.targetTable,
            targetColumn: this.targetColumn,
            insertAfterViewColumnIndex: this.afterColumnIndex,
            sourceTable: '',
        };
        this.savedJoinDef = joinDef;
        this.viewDefinition.joins.push(joinDef);

        // 結合列ヘッダーにCSSクラスを追加
        this.applyJoinedHeaderStyle(
            insertPos, colCount
        );
    }

    undo(): void {
        const insertPos =
            this.afterColumnIndex + 1;

        // 挿入した列を削除
        // 常にinsertPosの列を削除
        // （左の列が消えて繰り上がる）
        for (
            let i = 0;
            i < this.insertedColumnCount;
            i++
        ) {
            this.editorTable.deleteColumn(
                insertPos
            );
        }

        // columnMappingsから削除
        this.columnMappings.splice(
            insertPos,
            this.insertedColumnCount
        );

        // viewDefinitionからjoinを削除
        if (this.savedJoinDef) {
            const idx =
                this.viewDefinition.joins
                    .indexOf(this.savedJoinDef);
            if (idx >= 0) {
                this.viewDefinition.joins
                    .splice(idx, 1);
            }
        }
    }

    redo(): void {
        this.execute();
    }

    getDescription(): string {
        return 'ViewJoin: '
            + this.targetTable;
    }

    /**
     * ベーステーブル内での参照元列インデックスを探す
     */
    private findSourceColumnIndex(): number {
        for (
            let i = 0;
            i < this.columnMappings.length;
            i++
        ) {
            const m = this.columnMappings[i];
            if (
                !m.isJoinedColumn
                && m.sourceColumnName
                    === this.sourceColumn
            ) {
                return i;
            }
        }
        return -1;
    }

    /**
     * 結合列ヘッダーに視覚スタイルを適用
     */
    private applyJoinedHeaderStyle(
        startIndex: number,
        count: number
    ): void {
        for (
            let i = startIndex;
            i < startIndex + count;
            i++
        ) {
            this.editorTable
                .addColumnHeaderClass(
                    i,
                    'editor-table-joined-column-header'
                );
        }
    }
}
