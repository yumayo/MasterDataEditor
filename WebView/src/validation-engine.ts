import {InMemoryTableStore} from "./in-memory-table-store";
import {ReferenceDataCache} from "./reference-data-cache";
import {parseReferenceExpression, isSimpleReference, isDynamicReference, DynamicReference, DynamicReferenceSchema} from "./reference-expression";

/** バリデーションエラーの種別 */
export type ValidationErrorKind = 'pk-duplicate' | 'fk-broken' | 'type-mismatch' | 'plugin';

/** バリデーションエラー情報 */
export interface ValidationError {
    /** エラーが発生したテーブル名 */
    tableName: string;
    /** ストア上の行インデックス（0始まり） */
    rowIndex: number;
    /** ストア上の列インデックス（0始まり） */
    columnIndex: number;
    /** 列名 */
    columnName: string;
    /** セル値 */
    value: string;
    /** エラー種別 */
    kind: ValidationErrorKind;
    /** エラーメッセージ */
    message: string;
    /**
     * 動的参照エラーの場合、エラー生成時の依存カラム値（filterValue）。
     * preservableErrors の引き継ぎ判定で、依存カラムが変更されたかを検出するために使用する。
     * 単純参照・PK重複エラーでは null。
     */
    filterValue: string | null;
    /**
     * エラー生成時点でのPK値（primaryKeyColumns[0] の値）。
     * タブ閉じ後にエラー項目クリックでジャンプする際、ストアデータが消去されていても
     * navigateToTableCell に PK値を渡せるようにするため、バリデーション実行時に事前計算して保持する。
     * PK列なし・PK値空文字の場合は null。
     */
    pkValue: string | null;
}

/**
 * validate() の結果型。
 * errors: 検出されたエラーリスト。
 * preservableErrors: スキップされた列・行について、現在のストア値がエラー発生時の値と同じエラー。
 *   ValidationPanel 側で前回 currentErrors と照合して引き継ぐ対象を絞り込む際に使用する。
 *   「値が変わっていないのに参照先テーブルが未ロードでスキップされた」行のエラーのみを保持する。
 */
export interface ValidateResult {
    errors: ValidationError[];
    preservableErrors: ValidationError[];
}

/**
 * バリデーションエンジン
 *
 * ストア全体を走査して PK重複、FK参照切れ、型不一致 を検出する。
 * DOM 操作は行わず、エラー情報の構造体リストを返すだけの純粋ロジッククラス。
 */
export class ValidationEngine {

    private readonly store: InMemoryTableStore;
    private readonly referenceDataCache: ReferenceDataCache;

    /**
     * バリデーション対象テーブルのスキーマ情報。
     * テーブル名 → { primaryKeyColumns, columns: { name, reference | null }[] }
     */
    private readonly schemas: Map<string, TableSchema>;

    constructor(store: InMemoryTableStore, referenceDataCache: ReferenceDataCache) {
        this.store = store;
        this.referenceDataCache = referenceDataCache;
        this.schemas = new Map();
    }

    /**
     * テーブルのスキーマ情報を登録する。
     * Tab がテーブルを開いた際に呼ばれる想定。
     * 既に登録済みの場合は上書きする。
     */
    registerSchema(tableName: string, schema: TableSchema): void {
        this.schemas.set(tableName, schema);
    }

    /**
     * テーブルのスキーマ情報を登録解除する。
     * DiffTab.destroy() でスキーマ残留を防ぐために呼ばれる。
     */
    unregisterSchema(tableName: string): void {
        this.schemas.delete(tableName);
    }

    /**
     * 行のPK値を取得する（エラー生成時の事前計算用）。
     * header と rows は呼び出し元で既に取得済みなので引数で受け取る。
     * PK列なし・PK値が空文字の場合は null を返す。
     */
    private resolvePkValueForRow(schema: TableSchema, header: string[], rows: string[][], rowIndex: number): string | null {
        if (schema.primaryKeyColumns.length === 0) return null;
        const pkColIdx = header.indexOf(schema.primaryKeyColumns[0]);
        if (pkColIdx === -1) return null;
        const pkValue = rows[rowIndex][pkColIdx];
        if (pkValue === '') return null;
        return pkValue;
    }

    /**
     * 指定テーブル・行のPK値を取得する。
     * プラグインバリデーションエラーのジャンプ先PK値を解決するために使用する。
     * スキーマ未登録・PK列なし・PK値空文字の場合は null を返す。
     */
    resolvePkValue(tableName: string, rowIndex: number): string | null {
        const resolved = this.resolveSchemaAndData(tableName);
        if (resolved === null) return null;
        return this.resolvePkValueForRow(resolved.schema, resolved.header, resolved.rows, rowIndex);
    }

    /**
     * 指定テーブルのスキーマとストアデータを解決する共通ヘルパー。
     * スキーマ未登録またはストアにデータがない場合は null を返す。
     */
    private resolveSchemaAndData(tableName: string): { schema: TableSchema; header: string[]; rows: string[][] } | null {
        const schema = this.schemas.get(tableName);
        if (schema === undefined) return null;
        const header = this.store.getHeader(tableName);
        const rows = this.store.getRows(tableName);
        if (header === false || rows === false) return null;
        return { schema, header, rows };
    }

    /**
     * 指定テーブルのPK重複エラーのみをストア全体から検出して返す。
     * ミニテーブルのように ValidationPanel が接続されていない EditorTable が
     * 独立してPKバリデーションを行うための公開パス。
     * スキーマ未登録のテーブルは空配列を返す。
     */
    validatePkDuplicatesForTable(tableName: string): ValidationError[] {
        const resolved = this.resolveSchemaAndData(tableName);
        if (resolved === null) return [];
        const errors: ValidationError[] = [];
        this.validatePkDuplicates(tableName, resolved.schema, resolved.header, resolved.rows, errors);
        return errors;
    }

    /**
     * 指定テーブルのPK重複 + 型不一致エラーをストアから検出して返す。
     * DiffTab右ペインのように openEditorTables に登録されないが全バリデーションが必要な
     * ミニテーブル（isMiniTable=true）が独立してバリデーションを行うための公開パス。
     * FK参照切れは参照先テーブルのロード状態に依存するため含めない。
     */
    validateForTable(tableName: string): ValidationError[] {
        const resolved = this.resolveSchemaAndData(tableName);
        if (resolved === null) return [];
        const errors: ValidationError[] = [];
        this.validatePkDuplicates(tableName, resolved.schema, resolved.header, resolved.rows, errors);
        this.validateTypeMatch(tableName, resolved.schema, resolved.header, resolved.rows, errors);
        return errors;
    }

    /**
     * 登録済みスキーマを持つ全テーブルを対象にバリデーションを実行する。
     * PK重複エラー、FK参照切れエラー、型不一致エラーを検出して返す。
     *
     * preservableErrors: 参照先テーブルが未ロードのためスキップされた列・行について、
     * 現在のストア値が previousErrors のエラー値と一致するエラーを返す。
     * 呼び出し元（ValidationPanel）は previousErrors と照合して引き継ぐ対象を絞り込む。
     */
    validate(previousErrors: ValidationError[]): ValidateResult {
        const errors: ValidationError[] = [];
        // スキップされた列・行についてストア上の現在値を照合して引き継ぎ可能なエラーを収集する
        const preservableErrors: ValidationError[] = [];
        for (const [tableName, schema] of this.schemas) {
            const header = this.store.getHeader(tableName);
            const rows = this.store.getRows(tableName);
            // ストアに存在しないテーブルはスキップ（タブ未オープン等）
            if (header === false || rows === false) continue;
            this.validatePkDuplicates(tableName, schema, header, rows, errors);
            this.validateFkReferences(tableName, schema, header, rows, errors, previousErrors, preservableErrors);
            this.validateTypeMatch(tableName, schema, header, rows, errors);
        }
        return { errors, preservableErrors };
    }

    // -------------------------------------------------------------------------
    // PK重複検出
    // -------------------------------------------------------------------------

    private validatePkDuplicates(
        tableName: string,
        schema: TableSchema,
        header: string[],
        rows: string[][],
        errors: ValidationError[],
    ): void {
        if (schema.primaryKeyColumns.length === 0) return;
        // PK列のストアインデックスを取得する
        const pkColIndices: number[] = [];
        for (const pkColName of schema.primaryKeyColumns) {
            const idx = header.indexOf(pkColName);
            if (idx === -1) return; // PK列がヘッダーに存在しない場合はスキップ
            pkColIndices.push(idx);
        }
        // 各PK値の出現行インデックスを記録する（空値はスキップ）
        const pkToRows = new Map<string, number[]>();
        for (let r = 0; r < rows.length; r++) {
            const row = rows[r];
            let hasEmpty = false;
            for (const idx of pkColIndices) {
                if (row[idx] === '') { hasEmpty = true; break; }
            }
            if (hasEmpty) continue;
            const compositeKey = pkColIndices.map(idx => row[idx]).join('\0');
            if (pkToRows.has(compositeKey)) {
                pkToRows.get(compositeKey)!.push(r);
            } else {
                pkToRows.set(compositeKey, [r]);
            }
        }
        // 2件以上の行が同じPK値を持つ場合、すべての行をエラーとして登録する
        for (const [, rowIndices] of pkToRows) {
            if (rowIndices.length < 2) continue;
            for (const rowIndex of rowIndices) {
                const row = rows[rowIndex];
                for (const colIdx of pkColIndices) {
                    errors.push({
                        tableName,
                        rowIndex,
                        columnIndex: colIdx,
                        columnName: header[colIdx],
                        value: row[colIdx],
                        kind: 'pk-duplicate',
                        message: `主キー値 "${row[colIdx]}" が重複しています`,
                        filterValue: null,
                        pkValue: this.resolvePkValueForRow(schema, header, rows, rowIndex),
                    });
                }
            }
        }
    }

    // -------------------------------------------------------------------------
    // FK参照切れ検出
    // -------------------------------------------------------------------------

    private validateFkReferences(
        tableName: string,
        schema: TableSchema,
        header: string[],
        rows: string[][],
        errors: ValidationError[],
        previousErrors: ValidationError[],
        preservableErrors: ValidationError[],
    ): void {
        for (const col of schema.columns) {
            if (col.reference === null) continue;
            const expr = parseReferenceExpression(col.reference);
            const colIdx = header.indexOf(col.name);
            if (colIdx === -1) continue;
            if (isSimpleReference(expr)) {
                this.validateSimpleReference(tableName, schema, header, col.name, colIdx, col.type, col.defaultValue, expr.tableName, expr.columnName, rows, errors, previousErrors, preservableErrors);
            } else if (isDynamicReference(expr)) {
                this.validateDynamicReference(tableName, schema, col.name, colIdx, col.type, col.defaultValue, expr, header, rows, errors, previousErrors, preservableErrors);
            }
        }
    }

    /**
     * 単純参照（SimpleReference）のFK検証。
     * 参照先テーブルの指定列に値が存在しないセルをエラーとして登録する。
     * 空値とデフォルト値はFK検証をスキップする。
     * 参照先テーブルが未ロードの場合: previousErrors の中から現在のストア値と一致する行のエラーのみを
     * preservableErrors に追加して引き継ぐ（値が変わっていればエラーは引き継がない）。
     */
    private validateSimpleReference(
        tableName: string,
        schema: TableSchema,
        header: string[],
        colName: string,
        colIdx: number,
        colType: string,
        colDefaultValue: string | null,
        refTableName: string,
        refColumnName: string,
        rows: string[][],
        errors: ValidationError[],
        previousErrors: ValidationError[],
        preservableErrors: ValidationError[],
    ): void {
        // 参照先テーブルの有効値セットを構築する（ストア優先、未ロードならReferenceDataCacheにフォールバック）
        let refColIdx: number;
        const validValues = new Set<string>();
        const storeRefHeader = this.store.getHeader(refTableName);
        const storeRefRows = this.store.getRows(refTableName);
        if (storeRefHeader !== false && storeRefRows !== false) {
            refColIdx = storeRefHeader.indexOf(refColumnName);
            if (refColIdx === -1) return;
            for (const refRow of storeRefRows) {
                const val = refRow[refColIdx];
                if (val !== '') validValues.add(val);
            }
        } else {
            const fullData = this.referenceDataCache.getFullDataSync(refTableName);
            if (fullData === false) {
                // 参照先テーブルがストアにもキャッシュにもない: 現在のストア値と一致する前回エラーのみを引き継ぐ
                for (const prev of previousErrors) {
                    if (prev.kind !== 'fk-broken' || prev.tableName !== tableName || prev.columnName !== colName) continue;
                    if (prev.rowIndex < rows.length && rows[prev.rowIndex][colIdx] === prev.value) {
                        preservableErrors.push(prev);
                    }
                }
                return;
            }
            refColIdx = fullData.header.indexOf(refColumnName);
            if (refColIdx === -1) return;
            for (const row of fullData.rows.values()) {
                const val = row[refColIdx];
                if (val !== '') validValues.add(val);
            }
        }
        // 各行のFK値が参照先に存在するか検証する
        for (let r = 0; r < rows.length; r++) {
            const cellValue = rows[r][colIdx];
            // 空値は未入力扱いでエラー対象外
            if (cellValue === '') continue;
            // デフォルト値はFK検証をスキップする（「参照なし」を意味する値）
            if (isFkDefaultValue(cellValue, colType, colDefaultValue)) continue;
            if (!validValues.has(cellValue)) {
                errors.push({
                    tableName,
                    rowIndex: r,
                    columnIndex: colIdx,
                    columnName: colName,
                    value: cellValue,
                    kind: 'fk-broken',
                    message: `参照先 ${refTableName}.${refColumnName} に値 "${cellValue}" が存在しません`,
                    filterValue: null,
                    pkValue: this.resolvePkValueForRow(schema, header, rows, r),
                });
            }
        }
    }

    /**
     * 動的参照（DynamicReference）のFK検証。
     * 各行ごとに以下の手順で参照先テーブルと有効値を動的に解決する：
     *   1. 同一行の filter.valueColumn 値を取得（空かつセル値が非空ならエラー）
     *   2. filter.tableName テーブルで filter.filterColumn == その値 の行を線形検索
     *   3. 一致行の lookupColumn 値（= 参照先テーブル名）を取得
     *   4. そのテーブルの resolvedTargetColumn（動的解決済み列名）に cellValue が存在するか検証
     * 空値とデフォルト値はFK検証をスキップする。
     * フィルタテーブルまたは最終テーブルが未ロードの場合:
     *   現在のストア値と一致する previousErrors のエラーのみを preservableErrors に追加して引き継ぐ。
     */
    private validateDynamicReference(
        tableName: string,
        schema: TableSchema,
        colName: string,
        colIdx: number,
        colType: string,
        colDefaultValue: string | null,
        expr: DynamicReference,
        header: string[],
        rows: string[][],
        errors: ValidationError[],
        previousErrors: ValidationError[],
        preservableErrors: ValidationError[],
    ): void {
        // valueColumn のインデックスをフィルタテーブル取得より先に解決する
        // （filterValue === '' チェックはフィルタテーブルが不要なため）
        const valueColIdx = header.indexOf(expr.filter.valueColumn);
        if (valueColIdx === -1) return;

        // フィルタテーブルのヘッダーと行データを取得する（ストア優先、未ロードならReferenceDataCacheにフォールバック）
        // フィルタテーブルが取得できない場合は filterHeader/filterRows を null としてマークし、
        // filterValue が空でない行のみスキップ（filterValue が空の行はフィルタ不要でエラー検出可能）
        let filterHeader: string[] | null = null;
        let filterRows: string[][] | null = null;
        let filterColIdx = -1;
        let lookupColIdx = -1;
        let targetColumnColIdx = -1;
        const storeFilterHeader = this.store.getHeader(expr.filter.tableName);
        const storeFilterRows = this.store.getRows(expr.filter.tableName);
        if (storeFilterHeader !== false && storeFilterRows !== false) {
            filterHeader = storeFilterHeader;
            filterRows = storeFilterRows;
        } else {
            const fullData = this.referenceDataCache.getFullDataSync(expr.filter.tableName);
            if (fullData !== false) {
                filterHeader = fullData.header;
                filterRows = Array.from(fullData.rows.values());
            }
        }
        if (filterHeader !== null) {
            filterColIdx = filterHeader.indexOf(expr.filter.filterColumn);
            lookupColIdx = filterHeader.indexOf(expr.lookupColumn);
            targetColumnColIdx = filterHeader.indexOf(expr.targetColumn);
            // フィルタ列・lookup列・targetColumn列がフィルタテーブルに存在しなければフィルタ解決不能
            if (filterColIdx === -1 || lookupColIdx === -1 || targetColumnColIdx === -1) {
                filterHeader = null;
                filterRows = null;
            }
        }

        // 最終テーブルのキャッシュ（同一テーブルへの複数行チェックを効率化）
        const targetValidValuesCache = new Map<string, Set<string> | null>();

        for (let r = 0; r < rows.length; r++) {
            const cellValue = rows[r][colIdx];
            // 空値は未入力扱いでエラー対象外
            if (cellValue === '') continue;
            // デフォルト値はFK検証をスキップする（「参照なし」を意味する値）
            if (isFkDefaultValue(cellValue, colType, colDefaultValue)) continue;
            const filterValue = rows[r][valueColIdx];
            // 依存カラム（valueColumn）が空なのに動的参照カラムに値がある場合は参照解決不能のためエラー
            if (filterValue === '') {
                errors.push({
                    tableName,
                    rowIndex: r,
                    columnIndex: colIdx,
                    columnName: colName,
                    value: cellValue,
                    kind: 'fk-broken',
                    message: `参照元カラム ${expr.filter.valueColumn} が空のため、参照先を解決できません`,
                    filterValue,
                    pkValue: this.resolvePkValueForRow(schema, header, rows, r),
                });
                continue;
            }

            // フィルタテーブルが未取得の場合: filterValue が非空のこの行は検証不能
            // filterValue も一致する前回エラーのみ引き継ぐ（依存カラム変更時は引き継がない）
            if (filterRows === null) {
                const prev = previousErrors.find(e => e.kind === 'fk-broken' && e.tableName === tableName && e.columnName === colName && e.rowIndex === r && e.value === cellValue && e.filterValue === filterValue);
                if (prev) preservableErrors.push(prev);
                continue;
            }

            // フィルタテーブルで filterColumn == filterValue の行を線形検索する
            const filterRowIndex = filterRows.findIndex(row => row[filterColIdx] === filterValue);
            // 一致する行がない場合はフィルタ解決不能のためエラー
            if (filterRowIndex === -1) {
                errors.push({
                    tableName,
                    rowIndex: r,
                    columnIndex: colIdx,
                    columnName: colName,
                    value: cellValue,
                    kind: 'fk-broken',
                    message: `フィルタテーブル ${expr.filter.tableName} に ${expr.filter.filterColumn}="${filterValue}" の行が存在しないため、参照先を解決できません`,
                    filterValue,
                    pkValue: this.resolvePkValueForRow(schema, header, rows, r),
                });
                continue;
            }

            // lookupColumn / targetColumn の値をフィルタ行から動的取得する
            const targetTableName = filterRows[filterRowIndex][lookupColIdx];
            if (targetTableName === '') continue;
            const resolvedTargetColumn = filterRows[filterRowIndex][targetColumnColIdx];
            if (resolvedTargetColumn === '') continue;

            // キャッシュキーはテーブル名と列名の組み合わせ（同一テーブルでも列が異なる場合がある）
            const cacheKey = `${targetTableName}.${resolvedTargetColumn}`;
            if (!targetValidValuesCache.has(cacheKey)) {
                // まずストアを参照し、未ロードならReferenceDataCacheにフォールバックする
                const targetHeader = this.store.getHeader(targetTableName);
                const targetRows = this.store.getRows(targetTableName);
                if (targetHeader !== false && targetRows !== false) {
                    // ストアにロード済み: ストアのデータで有効値セットを構築する
                    const targetColIdx = targetHeader.indexOf(resolvedTargetColumn);
                    if (targetColIdx === -1) {
                        targetValidValuesCache.set(cacheKey, null);
                    } else {
                        const validValues = new Set<string>();
                        for (const targetRow of targetRows) {
                            const val = targetRow[targetColIdx];
                            if (val !== '') validValues.add(val);
                        }
                        targetValidValuesCache.set(cacheKey, validValues);
                    }
                } else {
                    // ストア未ロード: ReferenceDataCacheからプリロード済みデータを取得する
                    const fullData = this.referenceDataCache.getFullDataSync(targetTableName);
                    if (fullData === false) {
                        // キャッシュにも存在しない: 現在値一致チェックで前回エラーを引き継ぐ
                        targetValidValuesCache.set(cacheKey, null);
                    } else {
                        const targetColIdx = fullData.header.indexOf(resolvedTargetColumn);
                        if (targetColIdx === -1) {
                            targetValidValuesCache.set(cacheKey, null);
                        } else {
                            // ReferenceTableFullData.rows は Map<string, string[]> なので values() を走査する
                            const validValues = new Set<string>();
                            for (const row of fullData.rows.values()) {
                                const val = row[targetColIdx];
                                if (val !== '') validValues.add(val);
                            }
                            targetValidValuesCache.set(cacheKey, validValues);
                        }
                    }
                }
            }

            const validValues = targetValidValuesCache.get(cacheKey);
            // Map.get() は undefined を返しうるが、上の has() ガードで必ず set 済み。null は未解決テーブル/列を示す。
            if (validValues == null) {
                // 未解決テーブル: 現在値と filterValue の両方が一致する前回エラーのみ引き継ぐ
                // filterValue が変わっていれば参照先テーブルが切り替わったので古いエラーは引き継がない
                const prev = previousErrors.find(e => e.kind === 'fk-broken' && e.tableName === tableName && e.columnName === colName && e.rowIndex === r && e.value === cellValue && e.filterValue === filterValue);
                if (prev) preservableErrors.push(prev);
                continue;
            }

            if (!validValues.has(cellValue)) {
                errors.push({
                    tableName,
                    rowIndex: r,
                    columnIndex: colIdx,
                    columnName: colName,
                    value: cellValue,
                    kind: 'fk-broken',
                    message: `参照先 ${targetTableName}.${resolvedTargetColumn} に値 "${cellValue}" が存在しません`,
                    filterValue,
                    pkValue: this.resolvePkValueForRow(schema, header, rows, r),
                });
            }
        }
    }

    // -------------------------------------------------------------------------
    // 型不一致検出
    // -------------------------------------------------------------------------

    private validateTypeMatch(
        tableName: string,
        schema: TableSchema,
        header: string[],
        rows: string[][],
        errors: ValidationError[],
    ): void {
        for (const col of schema.columns) {
            const colIdx = header.indexOf(col.name);
            if (colIdx === -1) continue;
            // int / float / double のみ検証対象。string型や未知の型はスキップする
            const colType = col.type;
            if (colType !== 'int' && colType !== 'long' && colType !== 'float' && colType !== 'double') continue;
            for (let r = 0; r < rows.length; r++) {
                const cellValue = rows[r][colIdx];
                // 空文字は未入力扱いでエラー対象外
                if (cellValue === '') continue;
                const trimmed = cellValue.trim();
                // 型チェック: 16進・8進・2進リテラルを排除するため正規表現で10進数のみ許可する
                const isValid = colType === 'int' || colType === 'long'
                    ? /^[+-]?\d+$/.test(trimmed)
                    : /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(trimmed);
                if (!isValid) {
                    errors.push({
                        tableName,
                        rowIndex: r,
                        columnIndex: colIdx,
                        columnName: col.name,
                        value: cellValue,
                        kind: 'type-mismatch',
                        message: `値 "${cellValue}" は型 ${colType} と一致しません`,
                        filterValue: null,
                        pkValue: this.resolvePkValueForRow(schema, header, rows, r),
                    });
                }
            }
        }
    }
}

/** ValidationEngine に渡すテーブルスキーマ情報 */
export interface TableSchema {
    /** 複合主キー列名の配列 */
    primaryKeyColumns: readonly string[];
    /** 列情報の配列 */
    columns: ReadonlyArray<TableSchemaColumn>;
}

/** TableSchema 内の列定義 */
export interface TableSchemaColumn {
    name: string;
    type: string;
    /** 参照式。単純参照は文字列、動的参照は DynamicReferenceSchema オブジェクト、参照なしは null */
    reference: string | DynamicReferenceSchema | null;
    /** スキーマで明示指定されたデフォルト値（文字列化済み）。未指定の場合は null（型デフォルトが使われる） */
    defaultValue: string | null;
}

/**
 * 型ごとのデフォルト値マップ。
 * スキーマに default 指定がない場合、この型デフォルトと一致する値はFK検証をスキップする。
 * string型の空値は呼び出し元で `cellValue === ''` として既にスキップ済みのため含めない。
 */
const TYPE_DEFAULT_VALUES: Readonly<Record<string, string>> = {
    'int': '0',
    'long': '0',
    'float': '0',
    'double': '0',
    'bool': '0',
};

/**
 * セル値がFK検証をスキップすべきデフォルト値であるかを判定する。
 * スキーマに default が明示されていればそれと比較し、なければ型デフォルトと比較する。
 * 注意: string型の空値（""）は呼び出し元で既にスキップされるため、この関数では扱わない。
 */
function isFkDefaultValue(cellValue: string, type: string, schemaDefault: string | null): boolean {
    if (schemaDefault !== null) return cellValue === schemaDefault;
    const typeDefault = TYPE_DEFAULT_VALUES[type];
    if (typeDefault === undefined) return false;
    return cellValue === typeDefault;
}
