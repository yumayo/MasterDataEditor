/** 差分タブ専用のストアキーかどうかを判定する。 */
export function isDiffTableKey(tableName: string): boolean {
    return tableName.includes(':diff:');
}

/** PROBLEMSパネルやMCPの全体バリデーション対象に含めるテーブルかどうかを判定する。 */
export function isGlobalValidationTargetTable(tableName: string): boolean {
    return !isDiffTableKey(tableName);
}
