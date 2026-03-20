/**
 * スキーマオブジェクトから最初のPK列名を抽出する。
 * primary_key は文字列（単一PK）または文字列配列（複合PK）の両方を受け付ける。
 * primary_key が存在しないか不正な場合は例外を投げる。
 */
export function extractFirstPrimaryKeyColumn(schema: Record<string, unknown>): string {
    const pk = schema['primary_key'];
    if (typeof pk === 'string') return pk;
    if (Array.isArray(pk) && pk.length > 0) return pk[0] as string;
    throw new Error('[schema-utils] primary_key がスキーマに存在しないか不正です');
}
