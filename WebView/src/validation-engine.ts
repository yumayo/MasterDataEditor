import {InMemoryTableStore} from "./in-memory-table-store";
import {parseReferenceExpression, isSimpleReference} from "./reference-expression";

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
     */
    validate(): ValidationError[] {
        const errors: ValidationError[] = [];
        for (const [tableName, schema] of this.schemas) {
            const header = this.store.getHeader(tableName);
            const rows = this.store.getRows(tableName);
            // ストアに存在しないテーブルはスキップ（タブ未オープン等）
            if (header === false || rows === false) continue;
            this.validatePkDuplicates(tableName, schema, header, rows, errors);
            this.validateFkReferences(tableName, schema, header, rows, errors);
        }
        return errors;
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
    ): void {
        for (const col of schema.columns) {
            if (col.reference === null) continue;
            const expr = parseReferenceExpression(col.reference);
            // 動的参照はバリデーション対象外（解決コストが高く、スキーマ設計上も複雑すぎる）
            if (!isSimpleReference(expr)) continue;
            const colIdx = header.indexOf(col.name);
            if (colIdx === -1) continue;
            // 参照先テーブルの値セットを構築する
            const refHeader = this.store.getHeader(expr.tableName);
            const refRows = this.store.getRows(expr.tableName);
            // 参照先テーブルがストアに存在しない場合はスキップ（未オープン状態）
            if (refHeader === false || refRows === false) continue;
            const refColIdx = refHeader.indexOf(expr.columnName);
            if (refColIdx === -1) continue;
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
                        columnName: col.name,
                        value: cellValue,
                        kind: 'fk-broken',
                        message: `参照先 ${expr.tableName}.${expr.columnName} に値 "${cellValue}" が存在しません`,
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
    columns: ReadonlyArray<{ name: string; reference: string | null }>;
}
