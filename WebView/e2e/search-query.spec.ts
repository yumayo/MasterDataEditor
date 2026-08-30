import {test, expect} from './fixtures/test';
import {getQueryHighlightSegments, matchesQuery, SearchOptions} from '../src/search/search-query';

/**
 * matchesQuery のユニットテスト（ローマ字・全角半角対応）
 *
 * 現状の matchesQuery は toLowerCase() による大文字小文字正規化のみ行っている。
 * FEAT_0038 でローマ字変換・全角半角正規化を追加する。
 * このファイルのテストは追加前は RED になる。
 */

// =============================================================================
// ローマ字入力でマッチング（caseSensitive:false, wholeWord:false, useRegex:false）
// =============================================================================
test.describe('matchesQuery: ローマ字入力でのマッチング', () => {
    const baseOptions: SearchOptions = {caseSensitive: false, wholeWord: false, useRegex: false};

    test('"aite" が "アイテム" にマッチする', () => {
        expect(matchesQuery('アイテム', 'aite', baseOptions)).toBe(true);
    });

    test('"buki" が "ぶき" にマッチする', () => {
        expect(matchesQuery('ぶき', 'buki', baseOptions)).toBe(true);
    });

    test('"ene" が "エネミー" にマッチする（部分一致）', () => {
        expect(matchesQuery('エネミー', 'ene', baseOptions)).toBe(true);
    });

    test('"shi" が "しんぱい" にマッチする（部分一致）', () => {
        expect(matchesQuery('しんぱい', 'shi', baseOptions)).toBe(true);
    });

    test('"ka" が "カード" にマッチする', () => {
        expect(matchesQuery('カード', 'ka', baseOptions)).toBe(true);
    });

    test('"xyz" が "アイテム" にマッチしない', () => {
        expect(matchesQuery('アイテム', 'xyz', baseOptions)).toBe(false);
    });
});

// =============================================================================
// 全角半角を無視してマッチング
// =============================================================================
test.describe('matchesQuery: 全角半角無視でのマッチング', () => {
    const baseOptions: SearchOptions = {caseSensitive: false, wholeWord: false, useRegex: false};

    test('"ABC" が "ａｂｃ" にマッチする（全角小文字→半角小文字正規化）', () => {
        expect(matchesQuery('ａｂｃ', 'ABC', baseOptions)).toBe(true);
    });

    test('"abc" が "ＡＢＣ" にマッチする（全角大文字→半角小文字正規化）', () => {
        expect(matchesQuery('ＡＢＣ', 'abc', baseOptions)).toBe(true);
    });

    test('"1234" が "１２３４" にマッチする（全角数字→半角数字正規化）', () => {
        expect(matchesQuery('１２３４', '1234', baseOptions)).toBe(true);
    });

    test('"Ａ１" が "a1" にマッチする（全角英数字の混在）', () => {
        expect(matchesQuery('a1', 'Ａ１', baseOptions)).toBe(true);
    });
});

// =============================================================================
// 既存動作（回帰テスト）: 正規化前から動作していた内容が壊れていないこと
// =============================================================================
test.describe('matchesQuery: 既存動作の回帰テスト', () => {
    const baseOptions: SearchOptions = {caseSensitive: false, wholeWord: false, useRegex: false};

    test('空の検索テキストは常に false を返す', () => {
        expect(matchesQuery('anything', '', baseOptions)).toBe(false);
    });

    test('通常の部分一致: "quest_a" が "quest_a" にマッチする', () => {
        expect(matchesQuery('quest_a', 'quest_a', baseOptions)).toBe(true);
    });

    test('大文字小文字無視: "QUEST_A" が "quest_a" にマッチする', () => {
        expect(matchesQuery('quest_a', 'QUEST_A', baseOptions)).toBe(true);
    });

    test('caseSensitive:true のとき "QUEST_A" が "quest_a" にマッチしない', () => {
        const sensitiveOptions: SearchOptions = {caseSensitive: true, wholeWord: false, useRegex: false};
        expect(matchesQuery('quest_a', 'QUEST_A', sensitiveOptions)).toBe(false);
    });

    test('wholeWord:true のとき "quest" が "quest_a" にマッチしない', () => {
        const wholeWordOptions: SearchOptions = {caseSensitive: false, wholeWord: true, useRegex: false};
        expect(matchesQuery('quest_a', 'quest', wholeWordOptions)).toBe(false);
    });

    test('useRegex:true のとき正規表現でマッチする', () => {
        const regexOptions: SearchOptions = {caseSensitive: false, wholeWord: false, useRegex: true};
        expect(matchesQuery('quest_a', 'quest_[ab]', regexOptions)).toBe(true);
    });
});

test.describe('getQueryHighlightSegments: SearchOptionsと一致範囲', () => {
    test('case-sensitiveで大文字小文字を区別した断片を返す', () => {
        const options: SearchOptions = {caseSensitive: true, wholeWord: false, useRegex: false};
        expect(getQueryHighlightSegments('Category', 'teg', options)).toEqual([
            {text: 'Ca', highlight: false},
            {text: 'teg', highlight: true},
            {text: 'ory', highlight: false},
        ]);
        expect(getQueryHighlightSegments('Category', 'TEG', options)).toBeNull();
    });

    test('whole-wordは完全一致時に全体をハイライトする', () => {
        const options: SearchOptions = {caseSensitive: false, wholeWord: true, useRegex: false};
        expect(getQueryHighlightSegments('Category', 'category', options)).toEqual([
            {text: 'Category', highlight: true},
        ]);
        expect(getQueryHighlightSegments('CategoryName', 'category', options)).toBeNull();
    });

    test('regexの最初の一致範囲を返す', () => {
        const options: SearchOptions = {caseSensitive: false, wholeWord: false, useRegex: true};
        expect(getQueryHighlightSegments('item_42_name', 'item_\\d+', options)).toEqual([
            {text: 'item_42', highlight: true},
            {text: '_name', highlight: false},
        ]);
    });

    test('不正regexはnullを返す', () => {
        const options: SearchOptions = {caseSensitive: false, wholeWord: false, useRegex: true};
        expect(getQueryHighlightSegments('item', '[', options)).toBeNull();
    });

    test('zero-width regexは一致を保ちつつ空のハイライト断片を返さない', () => {
        const options: SearchOptions = {caseSensitive: false, wholeWord: false, useRegex: true};
        const segments = getQueryHighlightSegments('item', '(?=item)', options);
        expect(segments).toEqual([{text: 'item', highlight: false}]);
        if (segments === null) throw new Error('zero-width regexの一致情報がありません');
        expect(segments.some((segment) => segment.highlight && segment.text === '')).toBe(false);
    });

    test('ローマ字検索は対応する日本語断片を返す', () => {
        const options: SearchOptions = {caseSensitive: false, wholeWord: false, useRegex: false};
        expect(getQueryHighlightSegments('アイテム名', 'temu', options)).toEqual([
            {text: 'アイ', highlight: false},
            {text: 'テム', highlight: true},
            {text: '名', highlight: false},
        ]);
    });

    test('全角半角を正規化して元文字列の範囲を返す', () => {
        const options: SearchOptions = {caseSensitive: false, wholeWord: false, useRegex: false};
        expect(getQueryHighlightSegments('ＡＢＣ', 'bc', options)).toEqual([
            {text: 'Ａ', highlight: false},
            {text: 'ＢＣ', highlight: true},
        ]);
    });

    test('不一致はnullを返す', () => {
        const options: SearchOptions = {caseSensitive: false, wholeWord: false, useRegex: false};
        expect(getQueryHighlightSegments('category', 'weapon', options)).toBeNull();
    });
});
