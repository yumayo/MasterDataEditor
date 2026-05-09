/**
 * 参照式（reference expression）をパース・評価するモジュール
 *
 * 対応する構文：
 * 1. 単純参照: "テーブル名.列名" (例: "table.id") — 文字列で記述
 * 2. 動的参照: JSON オブジェクト形式
 *    {
 *      "sourceTable": "table",
 *      "sourceMatchColumn": "id",
 *      "sourceMatchValue": "reward_table_id",
 *      "destTable": "master",
 *      "destColumn": "column"
 *    }
 */

/**
 * 単純参照の型
 * 例: "table.id" → { type: 'simple', tableName: 'table', columnName: 'id' }
 */
export interface SimpleReference {
    type: 'simple';
    tableName: string;
    columnName: string;
}

/**
 * 動的参照の型（パース結果の内部表現）
 * DynamicReferenceSchema をパースした結果として生成される。
 */
export interface DynamicReference {
    type: 'dynamic';
    filter: {
        tableName: string;      // フィルタ対象のテーブル名
        filterColumn: string;   // フィルタに使用する列（通常は id）
        valueColumn: string;    // 同一行から取得する値の列名（$なしで格納）
    };
    lookupColumn: string;       // フィルタ結果から取得するカラム（テーブル名が入っている）
    targetColumn: string;       // フィルタ結果から取得する参照先列名のカラム（列名が入っている）
}

export type ReferenceExpression = SimpleReference | DynamicReference;

/**
 * スキーマJSON上の動的参照オブジェクト形式
 * 例:
 * {
 *   "sourceTable": "table",
 *   "sourceMatchColumn": "id",
 *   "sourceMatchValue": "reward_table_id",
 *   "destTable": "master",
 *   "destColumn": "column"
 * }
 */
export interface DynamicReferenceSchema {
    sourceTable: string;
    sourceMatchColumn: string;
    sourceMatchValue: string;  // "reward_table_id" 形式（列名をそのまま指定）
    destTable: string;
    destColumn: string;        // 参照先テーブルの列名を示すカラム名
}

/**
 * 値が DynamicReferenceSchema オブジェクトかどうかを判定する型ガード
 */
export function isDynamicReferenceSchema(value: unknown): value is DynamicReferenceSchema {
    if (typeof value !== 'object' || value === null) return false;
    const obj = value as Record<string, unknown>;
    return typeof obj['sourceTable'] === 'string'
        && typeof obj['sourceMatchColumn'] === 'string'
        && typeof obj['sourceMatchValue'] === 'string'
        && typeof obj['destTable'] === 'string'
        && typeof obj['destColumn'] === 'string';
}

/**
 * 単純参照の正規表現パターン
 * 形式: テーブル名.列名
 */
const SIMPLE_REFERENCE_PATTERN = /^(\w+)\.(\w+)$/;

/**
 * 参照式をパースする
 * @param expression 参照式の文字列（単純参照）または DynamicReferenceSchema オブジェクト（動的参照）
 * @returns パース結果（SimpleReference または DynamicReference）
 */
export function parseReferenceExpression(expression: string | DynamicReferenceSchema): ReferenceExpression {
    // DynamicReferenceSchema オブジェクトの場合は直接 DynamicReference に変換する
    if (typeof expression !== 'string') {
        return {
            type: 'dynamic',
            filter: {
                tableName: expression.sourceTable,
                filterColumn: expression.sourceMatchColumn,
                valueColumn: expression.sourceMatchValue
            },
            lookupColumn: expression.destTable,
            targetColumn: expression.destColumn
        };
    }

    // 文字列の場合は単純参照のパターンをチェック
    const simpleMatch = expression.match(SIMPLE_REFERENCE_PATTERN);
    if (simpleMatch) {
        return {
            type: 'simple',
            tableName: simpleMatch[1],
            columnName: simpleMatch[2]
        };
    }

    // どちらにもマッチしない場合は警告を出力し、テーブル名全体として扱う
    console.warn(`Invalid reference expression format: ${expression}`);
    return {
        type: 'simple',
        tableName: expression,
        columnName: ''
    };
}

/**
 * 動的参照かどうかを判定する
 */
export function isDynamicReference(expr: ReferenceExpression): expr is DynamicReference {
    return expr.type === 'dynamic';
}

/**
 * 単純参照かどうかを判定する
 */
export function isSimpleReference(expr: ReferenceExpression): expr is SimpleReference {
    return expr.type === 'simple';
}
