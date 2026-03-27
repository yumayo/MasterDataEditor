import {fuzzyMatch, normalizeForSearch, normalizeForSearchCaseSensitive, romajiToHiragana} from './fuzzy-search';

/**
 * 全文検索クエリ
 */
export interface FullTextQuery {
    kind: 'fulltext';
    text: string;
    caseSensitive: boolean;
    wholeWord: boolean;
    useRegex: boolean;
}

/**
 * 列フィルタクエリ（テーブル名.列名 = 値）
 */
export interface ColumnFilterQuery {
    kind: 'filter';
    tableName: string;
    columnName: string;
    value: string;
    caseSensitive: boolean;
    wholeWord: boolean;
    useRegex: boolean;
}

/**
 * 検索クエリの判別共用体
 */
export type SearchQuery = FullTextQuery | ColumnFilterQuery;

/**
 * 検索オプション
 */
export interface SearchOptions {
    caseSensitive: boolean;
    wholeWord: boolean;
    useRegex: boolean;
}

/**
 * 検索ボックスの入力文字列を解析して SearchQuery を返す
 *
 * 解析ルール:
 * - `テーブル名.列名 = 値` の形式にマッチすれば ColumnFilterQuery
 * - `=` の右側がダブルクォーテーションで囲まれていればその中身を取得
 * - それ以外は FullTextQuery
 */
export function parseSearchQuery(input: string, options: SearchOptions): SearchQuery {
    // テーブル名.列名 = 値 のパターンにマッチ
    const filterMatch = input.match(/^(\w+)\.(\w+)\s*=\s*(.+)$/);
    if (filterMatch) {
        const tableName = filterMatch[1];
        const columnName = filterMatch[2];
        const rawValue = filterMatch[3].trim();
        // ダブルクォーテーションで囲まれていればその中身を取得
        const value = rawValue.startsWith('"') && rawValue.endsWith('"')
            ? rawValue.slice(1, -1)
            : rawValue;
        return {
            kind: 'filter',
            tableName,
            columnName,
            value,
            caseSensitive: options.caseSensitive,
            wholeWord: options.wholeWord,
            useRegex: options.useRegex,
        };
    }
    return {
        kind: 'fulltext',
        text: input,
        caseSensitive: options.caseSensitive,
        wholeWord: options.wholeWord,
        useRegex: options.useRegex,
    };
}

/**
 * セル値の検索一致部分を置換テキストで置き換える。
 * 正規表現ON時はキャプチャグループ（$1, $2 等）の展開を行う。
 * 正規表現OFF時は最初に一致した部分文字列を単純置換する。
 */
export function replaceWithQuery(value: string, searchText: string, replaceText: string, options: SearchOptions): string {
    if (searchText === '') return value;
    if (options.useRegex) {
        try {
            const flags = options.caseSensitive ? 'g' : 'gi';
            const regex = new RegExp(searchText, flags);
            return value.replace(regex, replaceText);
        } catch {
            return value;
        }
    }
    // 非正規表現: wholeWord の場合はセル値全体が一致するときのみ全体を置換する
    if (options.wholeWord) {
        if (options.caseSensitive) {
            return value === searchText ? replaceText : value;
        }
        return value.toLowerCase() === searchText.toLowerCase() ? replaceText : value;
    }
    // 部分一致: 大文字小文字を区別しない場合も含めて最初の一致を置換する
    if (options.caseSensitive) {
        const idx = value.indexOf(searchText);
        if (idx === -1) return value;
        return value.substring(0, idx) + replaceText + value.substring(idx + searchText.length);
    }
    // caseSensitive=false: 大文字小文字を無視して最初の一致を検索する
    const lowerValue = value.toLowerCase();
    const lowerSearch = searchText.toLowerCase();
    const idx = lowerValue.indexOf(lowerSearch);
    if (idx === -1) return value;
    return value.substring(0, idx) + replaceText + value.substring(idx + searchText.length);
}

/**
 * セル値が検索条件に一致するかを判定する
 */
export function matchesQuery(cellValue: string, searchText: string, options: SearchOptions): boolean {
    if (searchText === '') return false;
    if (options.useRegex) {
        try {
            const flags = options.caseSensitive ? '' : 'i';
            const pattern = options.wholeWord ? `^(?:${searchText})$` : searchText;
            const regex = new RegExp(pattern, flags);
            return regex.test(cellValue);
        } catch {
            return false;
        }
    }
    // 大文字小文字を区別しない場合はfuzzyMatchを使用（全角半角・ローマ字変換を含む）
    if (!options.caseSensitive) {
        if (options.wholeWord) {
            // wholeWordの場合は完全一致でfuzzyMatch相当のロジックを適用
            const normalizedHaystack = normalizeForSearch(cellValue);
            const normalizedNeedle = normalizeForSearch(searchText);
            if (normalizedHaystack === normalizedNeedle) return true;
            const romajiConverted = normalizeForSearch(romajiToHiragana(searchText));
            return romajiConverted !== normalizedNeedle && normalizedHaystack === romajiConverted;
        }
        return fuzzyMatch(cellValue, searchText);
    }
    // caseSensitive: true の場合は全角半角正規化のみ行い大文字小文字は区別する
    const haystack = normalizeForSearchCaseSensitive(cellValue);
    const needle = normalizeForSearchCaseSensitive(searchText);
    if (options.wholeWord) {
        return haystack === needle;
    }
    return haystack.includes(needle);
}
