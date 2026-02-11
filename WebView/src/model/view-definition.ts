/**
 * ビューのJoin定義
 * ベーステーブルの列と結合先テーブルの列の関係を定義する
 */
export interface ViewJoinDefinition {
    /** ベーステーブルの参照元列名 */
    sourceColumn: string;
    /** 結合先テーブル名 */
    targetTable: string;
    /** 結合先テーブルのキー列名 */
    targetColumn: string;
    /** 挿入位置（ビュー上の列インデックス） */
    insertAfterViewColumnIndex: number;
}

/**
 * ビュー定義
 * 複数テーブルをJOINして表示するための定義
 */
export interface ViewDefinition {
    /** ビュー名 */
    name: string;
    /** ベーステーブル名 */
    baseTable: string;
    /** Join定義の配列 */
    joins: ViewJoinDefinition[];
}

/**
 * JSONからビュー定義をパースする
 */
export function parseViewDefinition(
    json: Record<string, unknown>
): ViewDefinition {
    const joins = json['joins'] as
        Record<string, unknown>[];
    const parsedJoins: ViewJoinDefinition[] = [];
    for (const join of joins) {
        parsedJoins.push({
            sourceColumn:
                join['sourceColumn'] as string,
            targetTable:
                join['targetTable'] as string,
            targetColumn:
                join['targetColumn'] as string,
            insertAfterViewColumnIndex:
                join[
                    'insertAfterViewColumnIndex'
                ] as number,
        });
    }
    return {
        name: json['name'] as string,
        baseTable: json['baseTable'] as string,
        joins: parsedJoins,
    };
}

/**
 * ビュー定義をJSON文字列にシリアライズする
 */
export function serializeViewDefinition(
    def: ViewDefinition
): string {
    return JSON.stringify(def, null, 4);
}
