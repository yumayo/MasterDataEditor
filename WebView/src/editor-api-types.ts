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
    /** テーブル保存イベントを発火する（EditorTableHandler の保存完了時に呼ばれる） */
    emitTableSaved(tableName: string): void;
    /** 行選択変更イベントを発火する（EditorTable の行選択変化時に呼ばれる） */
    emitRowSelected(tableName: string, rowIndex: number): void;
}

/** データ読み取りAPI */
export interface EditorDataAPI {
    getTableNames(): string[];
    getHeader(tableName: string): string[] | null;
    getRows(tableName: string): string[][] | null;
    getRowCount(tableName: string): number | null;
    getCellValue(tableName: string, row: number, column: number): string | null;
    /** テーブルデータを読み取る。ストアにあればストアから、なければCSVファイルから読む */
    readTableDataAsync(tableName: string): Promise<{ header: string[]; rows: string[][] } | null>;
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
    onTableSaved(handler: (event: { tableName: string }) => void): EditorDisposable;
    onRowSelected(handler: (event: { tableName: string; rowIndex: number }) => void): EditorDisposable;
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

/** スキーマJSONから SchemaEntry を構築する */
export function createSchemaEntryFromJson(json: Record<string, unknown>): SchemaEntry {
    // header フィールドのバリデーション: 配列でなければスキーマとして不正
    const headerRaw = json['header'];
    if (!Array.isArray(headerRaw)) {
        throw new Error('[createSchemaEntryFromJson] スキーマJSONに "header" 配列が存在しません');
    }
    const headerArray = headerRaw as Array<Record<string, unknown>>;
    const columns: EditorSchemaColumn[] = [];
    const references: EditorSchemaReference[] = [];
    for (let i = 0; i < headerArray.length; ++i) {
        const col = headerArray[i];
        // 各カラムの name/type は文字列でなければスキーマとして不正
        const name = col['name'];
        const type = col['type'];
        if (typeof name !== 'string' || typeof type !== 'string') {
            throw new Error('[createSchemaEntryFromJson] header[' + i + '] に name または type が存在しません');
        }
        columns.push({ name, type });
        // reference フィールドが存在し非空文字列の場合のみ FK 参照として登録する
        const refRaw = col['reference'];
        if (typeof refRaw === 'string' && refRaw.length > 0) {
            const dotIndex = refRaw.indexOf('.');
            if (dotIndex !== -1) {
                references.push({
                    columnName: name,
                    targetTable: refRaw.substring(0, dotIndex),
                    targetColumn: refRaw.substring(dotIndex + 1),
                });
            }
        }
    }
    // primary_key フィールドのバリデーション: 配列でなければスキーマとして不正（フォールバック禁止）
    const primaryKeyRaw = json['primary_key'];
    if (!Array.isArray(primaryKeyRaw)) {
        throw new Error('[createSchemaEntryFromJson] スキーマJSONに "primary_key" 配列が存在しません');
    }
    const primaryKeys: string[] = primaryKeyRaw as string[];
    return { columns, primaryKeys, references };
}
