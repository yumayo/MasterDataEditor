import {InMemoryTableStore} from "./in-memory-table-store";
import {parseReferenceExpression, isSimpleReference, isDynamicReference, DynamicReference} from "./reference-expression";

/** バリデーションエラーの種別 */
export type ValidationErrorKind = 'pk-duplicate' | 'fk-broken';

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
}

/**
 * validate() の結果型。
 * errors: 検出されたエラーリスト。
 * skippedFkColumns: 参照先テーブルが未ロードのためFKチェックをスキップした列の情報。
 *   スキップされた列に関する前回エラーは ValidationPanel 側で引き継ぐ。
 */
export interface ValidateResult {
    errors: ValidationError[];
    skippedFkColumns: Array<{ tableName: string; columnName: string }>;
}

/**
 * バリデーションエンジン
 *
 * ストア全体を走査して PK重複 と FK参照切れ を検出する。
 * DOM 操作は行わず、エラー情報の構造体リストを返すだけの純粋ロジッククラス。
 */
export class ValidationEngine {

    private readonly store: InMemoryTableStore;

    /**
     * バリデーション対象テーブルのスキーマ情報。
     * テーブル名 → { primaryKeyColumns, columns: { name, reference | null }[] }
     */
    private readonly schemas: Map<string, TableSchema>;

    constructor(store: InMemoryTableStore) {
        this.store = store;
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
     * 指定テーブルのPK重複エラーのみをストア全体から検出して返す。
     * ミニテーブルのように ValidationPanel が接続されていない EditorTable が
     * 独立してPKバリデーションを行うための公開パス。
     * スキーマ未登録のテーブルは空配列を返す。
     */
    validatePkDuplicatesForTable(tableName: string): ValidationError[] {
        if (!this.schemas.has(tableName)) return [];
        const schema = this.schemas.get(tableName)!;
        const header = this.store.getHeader(tableName);
        const rows = this.store.getRows(tableName);
        if (header === false || rows === false) return [];
        const errors: ValidationError[] = [];
        this.validatePkDuplicates(tableName, schema, header, rows, errors);
        return errors;
    }

    /**
     * 登録済みスキーマを持つ全テーブルを対象にバリデーションを実行する。
     * PK重複エラーと FK参照切れエラーを検出して返す。
     * 参照先テーブルが未ロードのためFKチェックをスキップした列は skippedFkColumns に記録する。
     * 呼び出し元（ValidationPanel）がスキップされた列に対する前回エラーを引き継ぐ責務を持つ。
     */
    validate(): ValidateResult {
        const errors: ValidationError[] = [];
        const skippedFkColumns: Array<{ tableName: string; columnName: string }> = [];
        for (const [tableName, schema] of this.schemas) {
            const header = this.store.getHeader(tableName);
            const rows = this.store.getRows(tableName);
            // ストアに存在しないテーブルはスキップ（タブ未オープン等）
            if (header === false || rows === false) continue;
            this.validatePkDuplicates(tableName, schema, header, rows, errors);
            this.validateFkReferences(tableName, schema, header, rows, errors, skippedFkColumns);
        }
        return { errors, skippedFkColumns };
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
        skippedFkColumns: Array<{ tableName: string; columnName: string }>,
    ): void {
        for (const col of schema.columns) {
            if (col.reference === null) continue;
            const expr = parseReferenceExpression(col.reference);
            const colIdx = header.indexOf(col.name);
            if (colIdx === -1) continue;
            if (isSimpleReference(expr)) {
                this.validateSimpleReference(tableName, col.name, colIdx, expr.tableName, expr.columnName, rows, errors, skippedFkColumns);
            } else if (isDynamicReference(expr)) {
                this.validateDynamicReference(tableName, col.name, colIdx, expr, header, rows, errors, skippedFkColumns);
            }
        }
    }

    /**
     * 単純参照（SimpleReference）のFK検証。
     * 参照先テーブルの指定列に値が存在しないセルをエラーとして登録する。
     * 参照先テーブルが未ロードの場合は skippedFkColumns に追加してスキップする。
     */
    private validateSimpleReference(
        tableName: string,
        colName: string,
        colIdx: number,
        refTableName: string,
        refColumnName: string,
        rows: string[][],
        errors: ValidationError[],
        skippedFkColumns: Array<{ tableName: string; columnName: string }>,
    ): void {
        // 参照先テーブルの値セットを構築する
        const refHeader = this.store.getHeader(refTableName);
        const refRows = this.store.getRows(refTableName);
        // 参照先テーブルがストアに存在しない場合: スキップしてその旨を記録する（前回エラーを引き継ぐ）
        if (refHeader === false || refRows === false) {
            skippedFkColumns.push({ tableName, columnName: colName });
            return;
        }
        const refColIdx = refHeader.indexOf(refColumnName);
        if (refColIdx === -1) return;
        // 参照先の有効値セットを構築する
        const validValues = new Set<string>();
        for (const refRow of refRows) {
            const val = refRow[refColIdx];
            if (val !== '') validValues.add(val);
        }
        // 各行のFK値が参照先に存在するか検証する
        for (let r = 0; r < rows.length; r++) {
            const cellValue = rows[r][colIdx];
            // 空値は未入力扱いでエラー対象外
            if (cellValue === '') continue;
            if (!validValues.has(cellValue)) {
                errors.push({
                    tableName,
                    rowIndex: r,
                    columnIndex: colIdx,
                    columnName: colName,
                    value: cellValue,
                    kind: 'fk-broken',
                    message: `参照先 ${refTableName}.${refColumnName} に値 "${cellValue}" が存在しません`,
                });
            }
        }
    }

    /**
     * 動的参照（DynamicReference）のFK検証。
     * 各行ごとに以下の手順で参照先テーブルと有効値を動的に解決する：
     *   1. 同一行の filter.valueColumn 値を取得（空なら未入力としてスキップ）
     *   2. filter.tableName テーブルで filter.filterColumn == その値 の行を線形検索
     *   3. 一致行の lookupColumn 値（= 参照先テーブル名）を取得
     *   4. そのテーブルの targetColumn に cellValue が存在するか検証
     * フィルタテーブルまたは最終テーブルが未ロードの場合は skippedFkColumns に追加する。
     */
    private validateDynamicReference(
        tableName: string,
        colName: string,
        colIdx: number,
        expr: DynamicReference,
        header: string[],
        rows: string[][],
        errors: ValidationError[],
        skippedFkColumns: Array<{ tableName: string; columnName: string }>,
    ): void {
        // フィルタテーブルがストアに存在するか先に確認する
        const filterHeader = this.store.getHeader(expr.filter.tableName);
        const filterRows = this.store.getRows(expr.filter.tableName);
        if (filterHeader === false || filterRows === false) {
            // フィルタテーブル未ロードは全行スキップ相当なのでskipとして記録する
            skippedFkColumns.push({ tableName, columnName: colName });
            return;
        }
        const filterColIdx = filterHeader.indexOf(expr.filter.filterColumn);
        const lookupColIdx = filterHeader.indexOf(expr.lookupColumn);
        // フィルタ列またはlookup列がフィルタテーブルに存在しなければ検証不能
        if (filterColIdx === -1 || lookupColIdx === -1) return;
        const valueColIdx = header.indexOf(expr.filter.valueColumn);
        // valueColumn が同一テーブルのヘッダーに存在しなければ検証不能
        if (valueColIdx === -1) return;

        // 最終テーブルのキャッシュ（同一テーブルへの複数行チェックを効率化）
        const targetValidValuesCache = new Map<string, Set<string> | null>();
        let hasSkippedRow = false;

        for (let r = 0; r < rows.length; r++) {
            const cellValue = rows[r][colIdx];
            // 空値は未入力扱いでエラー対象外
            if (cellValue === '') continue;
            const filterValue = rows[r][valueColIdx];
            // 同一行のvalueColumnが空の場合は未入力なのでスキップ
            if (filterValue === '') continue;

            // フィルタテーブルで filterColumn == filterValue の行を線形検索する
            const filterRowIndex = filterRows.findIndex(row => row[filterColIdx] === filterValue);
            // 一致する行がない場合はフィルタ解決不能なのでスキップ
            if (filterRowIndex === -1) continue;

            // lookupColumn の値が参照先テーブル名
            const targetTableName = filterRows[filterRowIndex][lookupColIdx];
            if (targetTableName === '') continue;

            // キャッシュにあればそれを使う
            if (!targetValidValuesCache.has(targetTableName)) {
                const targetHeader = this.store.getHeader(targetTableName);
                const targetRows = this.store.getRows(targetTableName);
                if (targetHeader === false || targetRows === false) {
                    // 最終テーブル未ロードはこの行をスキップ
                    targetValidValuesCache.set(targetTableName, null);
                    hasSkippedRow = true;
                    continue;
                }
                const targetColIdx = targetHeader.indexOf(expr.targetColumn);
                if (targetColIdx === -1) {
                    targetValidValuesCache.set(targetTableName, null);
                    continue;
                }
                const validValues = new Set<string>();
                for (const targetRow of targetRows) {
                    const val = targetRow[targetColIdx];
                    if (val !== '') validValues.add(val);
                }
                targetValidValuesCache.set(targetTableName, validValues);
            }

            const validValues = targetValidValuesCache.get(targetTableName)!;
            // 最終テーブルが未ロードだった場合（null）はスキップ済みなので続行
            if (validValues === null) continue;

            if (!validValues.has(cellValue)) {
                errors.push({
                    tableName,
                    rowIndex: r,
                    columnIndex: colIdx,
                    columnName: colName,
                    value: cellValue,
                    kind: 'fk-broken',
                    message: `参照先 ${targetTableName}.${expr.targetColumn} に値 "${cellValue}" が存在しません`,
                });
            }
        }

        // 少なくとも1行でも最終テーブル未ロードによりスキップが発生した場合は記録する
        if (hasSkippedRow) {
            skippedFkColumns.push({ tableName, columnName: colName });
        }
    }
}

/** ValidationEngine に渡すテーブルスキーマ情報 */
export interface TableSchema {
    /** 複合主キー列名の配列 */
    primaryKeyColumns: readonly string[];
    /** 列情報の配列 */
    columns: ReadonlyArray<{ name: string; reference: string | null }>;
}
