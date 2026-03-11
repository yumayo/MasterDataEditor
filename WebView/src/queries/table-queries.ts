import {readFileAsync} from '../api';

/**
 * スキーマJSON読み込みクエリ関数
 *
 * Phase 2以降で TanStack Query の useQuery の queryFn として使用される。
 * `schema/{tableName}.json` を読み込んで JSON として返す。
 */
export function fetchSchemaJson(tableName: string): Promise<Record<string, unknown>> {
    return readFileAsync('schema/' + tableName + '.json').then(text => JSON.parse(text) as Record<string, unknown>);
}

/**
 * CSVファイル読み込みクエリ関数
 *
 * Phase 2以降で TanStack Query の useQuery の queryFn として使用される。
 * `data/{tableName}.csv` を読み込んでテキストとして返す。
 */
export function fetchCsvText(tableName: string): Promise<string> {
    return readFileAsync('data/' + tableName + '.csv');
}
