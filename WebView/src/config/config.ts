import configJson from './config.json' with { type: 'json' };

/**
 * マスターデータエディターの設定
 */
export interface Config {
    /**
     * 参照列で表示に使用する列名の優先順位
     * 配列の先頭が最も優先度が高い
     */
    referenceDisplayColumnPriority: string[];

    /**
     * ソート等で使用するロケール
     */
    locale: string;
}

/**
 * 設定オブジェクト
 */
export const config: Config = configJson;

/**
 * 列名一覧から表示列を決定する
 * referenceDisplayColumnPriority の優先度順に走査し、最初に見つかった列名を返す
 * @param columnNames テーブルの列名一覧
 * @returns 優先度リストの中で最初に見つかった列名。見つからない場合は空文字列
 */
export function determineDisplayColumnName(columnNames: readonly string[]): string {
    for (const priority of config.referenceDisplayColumnPriority) {
        if (columnNames.includes(priority)) return priority;
    }
    return '';
}

/**
 * 指定された列名が表示列優先度リストに含まれるかチェックする
 * @param columnName チェック対象の列名
 */
export function isDisplayColumn(columnName: string): boolean {
    return config.referenceDisplayColumnPriority.includes(columnName);
}
