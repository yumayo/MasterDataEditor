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
    /** FK列の参照ヒントを取得する。columnName → { fkValue → displayText } のマップを返す */
    getReferenceHintsAsync(tableName: string): Promise<Record<string, Record<string, string>> | null>;
    /** 関連テーブル（N:1参照先 + 1:N逆参照元）のデータを取得する */
    getRelatedTablesAsync(tableName: string): Promise<RelatedTableInfo[] | null>;
    /** 全テーブルのバリデーションエラー一覧を取得する（プラグインエラーを含む） */
    getValidationErrorsAsync(): Promise<ValidationErrorInfo[]>;
    /** SEARCHパネルと同じ検索エンジンでテーブル横断検索を行う */
    searchCellsAsync(queryText: string, caseSensitive: boolean, wholeWord: boolean, useRegex: boolean): Promise<SearchResultInfo[]>;
}

/** バリデーションエラー情報（外部API用、内部フィールドを除外した公開型） */
export interface ValidationErrorInfo {
    tableName: string;
    rowIndex: number;
    columnName: string;
    value: string;
    kind: 'pk-duplicate' | 'fk-broken' | 'type-mismatch' | 'plugin';
    message: string;
}

/** 全文検索結果（MCP API用） */
export interface SearchResultInfo {
    tableName: string;
    rowIndex: number;
    columnName: string;
    columnIndex: number;
    pkValue: string;
    value: string;
    referenceDisplayText: string;
}

/** 関連テーブル情報（MCP API用） */
export interface RelatedTableInfo {
    relationType: 'N:1' | '1:N';
    label: string;       // 例: "weapon (weapon_id → weapon.id)" or "order (order.product_id → product.id)"
    tableName: string;   // 関連テーブル名
    header: string[];    // 関連テーブルのヘッダー
    rows: string[][];    // フィルタ済み行データ
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
    /** スキーマで明示指定されたデフォルト値（文字列化済み）。未指定の場合は null（型デフォルトが使われる） */
    defaultValue: string | null;
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
    /** テーブルをアクティブ化せずにセルを更新する。未オープンのテーブルもCSVから読み込んで編集対象にする */
    setCellValueAsync(tableName: string, row: number, column: number, value: string): Promise<boolean>;
    /** テーブルをアクティブ化せずに複数セルを更新する。未オープンのテーブルもCSVから読み込んで編集対象にする */
    setCellValuesAsync(tableName: string, changes: Array<{ row: number; column: number; value: string }>): Promise<boolean>;
    insertRow(tableName: string, rowIndex: number): boolean;
    deleteRow(tableName: string, rowIndex: number): boolean;
    /** テーブルをタブで開く。既に開いている場合は即座に成功する */
    openTableAsync(tableName: string): Promise<boolean>;
    /** テーブルデータをCSVファイルに保存する */
    saveTableAsync(tableName: string): Promise<boolean>;
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
        // スキーマの default フィールドを文字列化して保持する（未指定は null）
        const defaultRaw = col['default'];
        const defaultValue = (defaultRaw !== undefined && defaultRaw !== null) ? String(defaultRaw) : null;
        columns.push({ name, type, defaultValue });
        // reference フィールドが存在し非空文字列の場合のみ FK 参照として登録する
        // 動的参照（DynamicReferenceSchema オブジェクト）はここでは EditorSchemaReference に変換できないためスキップ
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
