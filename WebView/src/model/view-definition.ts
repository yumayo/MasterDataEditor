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
    /** チェーンJOINのソーステーブル名（空文字列=ベーステーブルからの直接JOIN） */
    sourceTable: string;
}

/**
 * ビュー列の表示設定（幅、非表示フラグ）
 */
export interface ViewColumnConfig {
    /** テーブル名（ベーステーブルまたはJoin先テーブル） */
    tableName: string;
    /** 元テーブルでの列名 */
    columnName: string;
    /** 列幅（ピクセル） */
    width: number;
    /** 非表示フラグ（trueのときのみJSON出力） */
    hidden: boolean;
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
    /** 列のオーバーライド設定 */
    columns: ViewColumnConfig[];
}

/**
 * JSONからビュー定義をパースする
 */
export function parseViewDefinition(
    json: Record<string, unknown>
): ViewDefinition {
    const joins = json['joins'] as Record<string, unknown>[];
    const parsedJoins: ViewJoinDefinition[] = [];
    for (const join of joins) {
        parsedJoins.push({
            sourceColumn: join['sourceColumn'] as string,
            targetTable: join['targetTable'] as string,
            targetColumn: join['targetColumn'] as string,
            insertAfterViewColumnIndex: join['insertAfterViewColumnIndex'] as number,
            sourceTable: 'sourceTable' in join ? join['sourceTable'] as string : '',
        });
    }

    // columns のパース（未定義時は空配列）
    const parsedColumns: ViewColumnConfig[] = [];
    if ('columns' in json && Array.isArray(json['columns'])) {
        const rawColumns = json['columns'] as Record<string, unknown>[];
        for (const col of rawColumns) {
            parsedColumns.push({
                tableName: col['tableName'] as string,
                columnName: col['columnName'] as string,
                width: col['width'] as number,
                hidden: col['hidden'] === true,
            });
        }
    }

    return {
        name: json['name'] as string,
        baseTable: json['baseTable'] as string,
        joins: parsedJoins,
        columns: parsedColumns,
    };
}

/**
 * ビュー定義をJSON文字列にシリアライズする
 * hidden: true のときのみ hidden を出力し、columns が空のときは省略する
 */
export function serializeViewDefinition(
    def: ViewDefinition
): string {
    // シリアライズ用の一時オブジェクトを構築
    const output: Record<string, unknown> = {
        name: def.name,
        baseTable: def.baseTable,
        joins: def.joins,
    };

    // columns が空でなければ出力する
    if (def.columns.length > 0) {
        const serializedColumns: Record<string, unknown>[] = [];
        for (const col of def.columns) {
            const entry: Record<string, unknown> = {
                tableName: col.tableName,
                columnName: col.columnName,
                width: col.width,
            };
            // hidden が true のときのみ出力
            if (col.hidden) {
                entry['hidden'] = true;
            }
            serializedColumns.push(entry);
        }
        output['columns'] = serializedColumns;
    }

    return JSON.stringify(output, null, 4);
}
