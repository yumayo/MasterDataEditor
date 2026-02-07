/**
 * 参照式（reference expression）をパース・評価するモジュール
 *
 * 対応する構文：
 * 1. 単純参照: "テーブル名.列名" (例: "table.id")
 * 2. 動的参照: "$(フィルタテーブル.フィルタ列 == $同一行の列名).取得列.対象列"
 *    (例: "$(table.id == $column).master.id")
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
 * 動的参照の型
 * 例: "$(table.id == $column).master.id"
 * → {
 *     type: 'dynamic',
 *     filter: { tableName: 'table', filterColumn: 'id', valueColumn: 'column' },
 *     lookupColumn: 'master',
 *     targetColumn: 'id'
 *   }
 */
export interface DynamicReference {
    type: 'dynamic';
    filter: {
        tableName: string;      // フィルタ対象のテーブル名
        filterColumn: string;   // フィルタに使用する列（通常は id）
        valueColumn: string;    // 同一行から取得する値の列名（$なしで格納）
    };
    lookupColumn: string;       // フィルタ結果から取得するカラム（テーブル名が入っている）
    targetColumn: string;       // 最終的に参照する列
}

export type ReferenceExpression = SimpleReference | DynamicReference;

/**
 * 動的参照の正規表現パターン
 * 形式: $(テーブル名.列名 == $変数名).取得列.対象列
 *
 * グループ:
 * 1: テーブル名 (table)
 * 2: フィルタ列 (id)
 * 3: 変数名 (column)
 * 4: 取得列 (master)
 * 5: 対象列 (id)
 */
const DYNAMIC_REFERENCE_PATTERN = /^\$\((\w+)\.(\w+)\s*==\s*\$(\w+)\)\.(\w+)\.(\w+)$/;

/**
 * 単純参照の正規表現パターン
 * 形式: テーブル名.列名
 */
const SIMPLE_REFERENCE_PATTERN = /^(\w+)\.(\w+)$/;

/**
 * 参照式をパースする
 * @param expression 参照式の文字列
 * @returns パース結果（SimpleReference または DynamicReference）。パース失敗時は警告を出力して SimpleReference として解釈を試みる
 */
export function parseReferenceExpression(expression: string): ReferenceExpression {
    // 動的参照のパターンをチェック
    const dynamicMatch = expression.match(DYNAMIC_REFERENCE_PATTERN);
    if (dynamicMatch) {
        return {
            type: 'dynamic',
            filter: {
                tableName: dynamicMatch[1],
                filterColumn: dynamicMatch[2],
                valueColumn: dynamicMatch[3]
            },
            lookupColumn: dynamicMatch[4],
            targetColumn: dynamicMatch[5]
        };
    }

    // 単純参照のパターンをチェック
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
