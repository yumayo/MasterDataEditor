/** EditorAPI 内部API統合インターフェース */
export interface EditorAPI {
    data: EditorDataAPI;
    schema: EditorSchemaAPI;
    edit: EditorEditAPI;
    events: EditorEventsAPI;
    /** テーブルオープンイベントを発火する（Tab から呼ばれる） */
    emitTableOpened(tableName: string): void;
    /** テーブルクローズイベントを発火する（Tab から呼ばれる） */
    emitTableClosed(tableName: string): void;
}

/** データ読み取りAPI */
export interface EditorDataAPI {
    getTableNames(): string[];
    getHeader(tableName: string): string[] | null;
    getRows(tableName: string): string[][] | null;
    getRowCount(tableName: string): number | null;
    getCellValue(tableName: string, row: number, column: number): string | null;
}

/** スキーマAPI */
export interface EditorSchemaAPI {
    getSchemaTableNames(): string[];
    getColumns(tableName: string): EditorSchemaColumn[] | null;
    getPrimaryKeys(tableName: string): string[] | null;
    getReferences(tableName: string): EditorSchemaReference[] | null;
}

/** スキーマカラム定義 */
export interface EditorSchemaColumn {
    name: string;
    type: string;
}

/** スキーマFK参照定義 */
export interface EditorSchemaReference {
    columnName: string;
    targetTable: string;
    targetColumn: string;
}

/** データ書き込みAPI */
export interface EditorEditAPI {
    setCellValue(tableName: string, row: number, column: number, value: string): boolean;
    setCellValues(tableName: string, changes: Array<{ row: number; column: number; value: string }>): boolean;
    insertRow(tableName: string, rowIndex: number): boolean;
    deleteRow(tableName: string, rowIndex: number): boolean;
}

/** イベントAPI */
export interface EditorEventsAPI {
    onTableOpened(handler: (event: { tableName: string }) => void): EditorDisposable;
    onTableClosed(handler: (event: { tableName: string }) => void): EditorDisposable;
    onCellChanged(handler: (event: EditorCellChangeEvent) => void): EditorDisposable;
}

/** セル変更イベント */
export interface EditorCellChangeEvent {
    tableName: string;
    row: number;
    column: number;
    oldValue: string;
    newValue: string;
}

/** イベント購読解除ハンドル */
export interface EditorDisposable {
    dispose(): void;
}

/** スキーマレジストリのエントリ（スキーマJSONから必要情報を抽出したもの） */
export interface SchemaEntry {
    columns: EditorSchemaColumn[];
    primaryKeys: string[];
    references: EditorSchemaReference[];
}
