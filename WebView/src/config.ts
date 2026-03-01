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
     * 主キー列の列名
     */
    primaryKeyColumnName: string;

    /**
     * ソート等で使用するロケール
     */
    locale: string;
}

/**
 * 設定オブジェクト
 */
export const config: Config = configJson;
