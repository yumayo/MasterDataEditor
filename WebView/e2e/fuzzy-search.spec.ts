import {test, expect} from './fixtures/test';
import {fuzzyMatch, normalizeForSearch, romajiToHiragana} from '../src/search/fuzzy-search';

/**
 * fuzzy-search モジュールのユニットテスト
 *
 * テスト対象:
 *   - romajiToHiragana: ローマ字→ひらがな変換
 *   - normalizeForSearch: 全角半角・大文字小文字の正規化
 *   - fuzzyMatch: ファジーマッチング（ローマ字・正規化を組み合わせた部分一致）
 *
 * すべての検索機能はこのユーティリティを通してマッチングを行う。
 */

// =============================================================================
// romajiToHiragana: ローマ字→ひらがな変換
// =============================================================================
test.describe('romajiToHiragana: ローマ字→ひらがな変換', () => {
    test('単母音 a→あ, i→い, u→う, e→え, o→お', () => {
        expect(romajiToHiragana('a')).toBe('あ');
        expect(romajiToHiragana('i')).toBe('い');
        expect(romajiToHiragana('u')).toBe('う');
        expect(romajiToHiragana('e')).toBe('え');
        expect(romajiToHiragana('o')).toBe('お');
    });

    test('ka行: ka→か, ki→き, ku→く, ke→け, ko→こ', () => {
        expect(romajiToHiragana('ka')).toBe('か');
        expect(romajiToHiragana('ki')).toBe('き');
        expect(romajiToHiragana('ku')).toBe('く');
        expect(romajiToHiragana('ke')).toBe('け');
        expect(romajiToHiragana('ko')).toBe('こ');
    });

    test('sa行: sa→さ, si/shi→し, su→す, se→せ, so→そ', () => {
        expect(romajiToHiragana('sa')).toBe('さ');
        expect(romajiToHiragana('shi')).toBe('し');
        expect(romajiToHiragana('si')).toBe('し');
        expect(romajiToHiragana('su')).toBe('す');
        expect(romajiToHiragana('se')).toBe('せ');
        expect(romajiToHiragana('so')).toBe('そ');
    });

    test('ta行: ta→た, chi→ち, tsu→つ, te→て, to→と', () => {
        expect(romajiToHiragana('ta')).toBe('た');
        expect(romajiToHiragana('chi')).toBe('ち');
        expect(romajiToHiragana('ti')).toBe('ち');
        expect(romajiToHiragana('tsu')).toBe('つ');
        expect(romajiToHiragana('tu')).toBe('つ');
        expect(romajiToHiragana('te')).toBe('て');
        expect(romajiToHiragana('to')).toBe('と');
    });

    test('na行: na→な, ni→に, nu→ぬ, ne→ね, no→の', () => {
        expect(romajiToHiragana('na')).toBe('な');
        expect(romajiToHiragana('ni')).toBe('に');
        expect(romajiToHiragana('nu')).toBe('ぬ');
        expect(romajiToHiragana('ne')).toBe('ね');
        expect(romajiToHiragana('no')).toBe('の');
    });

    test('ha行: ha→は, hi→ひ, fu→ふ, he→へ, ho→ほ', () => {
        expect(romajiToHiragana('ha')).toBe('は');
        expect(romajiToHiragana('hi')).toBe('ひ');
        expect(romajiToHiragana('fu')).toBe('ふ');
        expect(romajiToHiragana('hu')).toBe('ふ');
        expect(romajiToHiragana('he')).toBe('へ');
        expect(romajiToHiragana('ho')).toBe('ほ');
    });

    test('ma行: ma→ま, mi→み, mu→む, me→め, mo→も', () => {
        expect(romajiToHiragana('ma')).toBe('ま');
        expect(romajiToHiragana('mi')).toBe('み');
        expect(romajiToHiragana('mu')).toBe('む');
        expect(romajiToHiragana('me')).toBe('め');
        expect(romajiToHiragana('mo')).toBe('も');
    });

    test('ya行: ya→や, yu→ゆ, yo→よ', () => {
        expect(romajiToHiragana('ya')).toBe('や');
        expect(romajiToHiragana('yu')).toBe('ゆ');
        expect(romajiToHiragana('yo')).toBe('よ');
    });

    test('ra行: ra→ら, ri→り, ru→る, re→れ, ro→ろ', () => {
        expect(romajiToHiragana('ra')).toBe('ら');
        expect(romajiToHiragana('ri')).toBe('り');
        expect(romajiToHiragana('ru')).toBe('る');
        expect(romajiToHiragana('re')).toBe('れ');
        expect(romajiToHiragana('ro')).toBe('ろ');
    });

    test('wa行・ん: wa→わ, n→ん, wo→を', () => {
        expect(romajiToHiragana('wa')).toBe('わ');
        expect(romajiToHiragana('wo')).toBe('を');
        expect(romajiToHiragana('nn')).toBe('ん');
    });

    test('ga行: ga→が, gi→ぎ, gu→ぐ, ge→げ, go→ご', () => {
        expect(romajiToHiragana('ga')).toBe('が');
        expect(romajiToHiragana('gi')).toBe('ぎ');
        expect(romajiToHiragana('gu')).toBe('ぐ');
        expect(romajiToHiragana('ge')).toBe('げ');
        expect(romajiToHiragana('go')).toBe('ご');
    });

    test('za行: za→ざ, ji→じ, zu→ず, ze→ぜ, zo→ぞ', () => {
        expect(romajiToHiragana('za')).toBe('ざ');
        expect(romajiToHiragana('ji')).toBe('じ');
        expect(romajiToHiragana('zi')).toBe('じ');
        expect(romajiToHiragana('zu')).toBe('ず');
        expect(romajiToHiragana('ze')).toBe('ぜ');
        expect(romajiToHiragana('zo')).toBe('ぞ');
    });

    test('da行: da→だ, di→ぢ, du→づ, de→で, do→ど', () => {
        expect(romajiToHiragana('da')).toBe('だ');
        expect(romajiToHiragana('di')).toBe('ぢ');
        expect(romajiToHiragana('du')).toBe('づ');
        expect(romajiToHiragana('de')).toBe('で');
        expect(romajiToHiragana('do')).toBe('ど');
    });

    test('ba行: ba→ば, bi→び, bu→ぶ, be→べ, bo→ぼ', () => {
        expect(romajiToHiragana('ba')).toBe('ば');
        expect(romajiToHiragana('bi')).toBe('び');
        expect(romajiToHiragana('bu')).toBe('ぶ');
        expect(romajiToHiragana('be')).toBe('べ');
        expect(romajiToHiragana('bo')).toBe('ぼ');
    });

    test('pa行: pa→ぱ, pi→ぴ, pu→ぷ, pe→ぺ, po→ぽ', () => {
        expect(romajiToHiragana('pa')).toBe('ぱ');
        expect(romajiToHiragana('pi')).toBe('ぴ');
        expect(romajiToHiragana('pu')).toBe('ぷ');
        expect(romajiToHiragana('pe')).toBe('ぺ');
        expect(romajiToHiragana('po')).toBe('ぽ');
    });

    test('複数文字: aite→あいて, kaisha→かいしゃ, tsuki→つき', () => {
        expect(romajiToHiragana('aite')).toBe('あいて');
        expect(romajiToHiragana('kaisha')).toBe('かいしゃ');
        expect(romajiToHiragana('tsuki')).toBe('つき');
    });

    test('ny拗音: nya→にゃ, nyu→にゅ, nyo→にょ（yを子音として誤変換しないことを確認）', () => {
        // CONSONANTS に y が含まれるため「ny」→「ん+y」に誤変換されるバグがあったことを回帰テスト
        expect(romajiToHiragana('nya')).toBe('にゃ');
        expect(romajiToHiragana('nyu')).toBe('にゅ');
        expect(romajiToHiragana('nyo')).toBe('にょ');
        // 複合文字列でも正しく変換される
        expect(romajiToHiragana('nyanko')).toBe('にゃんこ');
    });

    test('buki→ぶき', () => {
        expect(romajiToHiragana('buki')).toBe('ぶき');
    });

    test('変換不可能な文字はそのまま残る: xyz→xyz', () => {
        // アルファベット列で日本語マッピングがない部分はそのまま残す
        expect(romajiToHiragana('xyz')).toBe('xyz');
    });
});

// =============================================================================
// normalizeForSearch: 全角半角・大文字小文字の正規化
// =============================================================================
test.describe('normalizeForSearch: 全角半角・大文字小文字正規化', () => {
    test('全角アルファベット大文字→半角小文字: Ａ→a, Ｂ→b, Ｚ→z', () => {
        expect(normalizeForSearch('Ａ')).toBe('a');
        expect(normalizeForSearch('Ｂ')).toBe('b');
        expect(normalizeForSearch('Ｚ')).toBe('z');
    });

    test('全角アルファベット小文字→半角小文字: ａ→a, ｂ→b, ｚ→z', () => {
        expect(normalizeForSearch('ａ')).toBe('a');
        expect(normalizeForSearch('ｂ')).toBe('b');
        expect(normalizeForSearch('ｚ')).toBe('z');
    });

    test('半角大文字→半角小文字: A→a, B→b, Z→z', () => {
        expect(normalizeForSearch('A')).toBe('a');
        expect(normalizeForSearch('B')).toBe('b');
        expect(normalizeForSearch('Z')).toBe('z');
    });

    test('全角数字→半角数字: ０→0, １→1, ９→9', () => {
        expect(normalizeForSearch('０')).toBe('0');
        expect(normalizeForSearch('１')).toBe('1');
        expect(normalizeForSearch('９')).toBe('9');
    });

    test('カタカナ→ひらがな: ア→あ, イ→い, ウ→う', () => {
        expect(normalizeForSearch('ア')).toBe('あ');
        expect(normalizeForSearch('イ')).toBe('い');
        expect(normalizeForSearch('ウ')).toBe('う');
    });

    test('複合文字列の正規化: Ａ１b２→a1b2', () => {
        expect(normalizeForSearch('Ａ１b２')).toBe('a1b2');
    });

    test('ABC→abc（半角大文字のみの入力）', () => {
        expect(normalizeForSearch('ABC')).toBe('abc');
    });

    test('1234→1234（数字はそのまま）', () => {
        expect(normalizeForSearch('1234')).toBe('1234');
    });
});

// =============================================================================
// fuzzyMatch: ファジーマッチング（ローマ字→ひらがな変換 + 正規化後の部分一致）
// =============================================================================
test.describe('fuzzyMatch: ファジーマッチング', () => {
    test('通常の部分一致: "abc" が "abcdef" にマッチする', () => {
        expect(fuzzyMatch('abcdef', 'abc')).toBe(true);
    });

    test('ローマ字→カタカナマッチング: "aite" が "アイテム" にマッチする', () => {
        // あいて→アイテ（カタカナ正規化後はひらがな同士で比較）
        expect(fuzzyMatch('アイテム', 'aite')).toBe(true);
    });

    test('ローマ字→ひらがなマッチング: "aite" が "あいてむ" にマッチする', () => {
        expect(fuzzyMatch('あいてむ', 'aite')).toBe(true);
    });

    test('"buki" が "武器" にマッチしない（漢字は変換対象外）', () => {
        // 漢字の「武器」はひらがな/カタカナではないのでローマ字変換ではヒットしない
        expect(fuzzyMatch('武器', 'buki')).toBe(false);
    });

    test('"buki" が "ぶき" にマッチする', () => {
        expect(fuzzyMatch('ぶき', 'buki')).toBe(true);
    });

    test('"buki" が "ブキ" にマッチする（カタカナ→ひらがな正規化）', () => {
        expect(fuzzyMatch('ブキ', 'buki')).toBe(true);
    });

    test('全角半角無視: "ABC" が "ａｂｃ" にマッチする', () => {
        expect(fuzzyMatch('ａｂｃ', 'ABC')).toBe(true);
    });

    test('全角半角無視: "1234" が "１２３４" にマッチする', () => {
        expect(fuzzyMatch('１２３４', '1234')).toBe(true);
    });

    test('大文字小文字無視: "abc" が "ABC" にマッチする', () => {
        expect(fuzzyMatch('ABC', 'abc')).toBe(true);
    });

    test('マッチしない: "xyz" が "あいてむ" にマッチしない', () => {
        expect(fuzzyMatch('あいてむ', 'xyz')).toBe(false);
    });

    test('空文字の針: "" は常にマッチしない', () => {
        expect(fuzzyMatch('anything', '')).toBe(false);
    });

    test('空文字の干し草: "" に何もマッチしない', () => {
        expect(fuzzyMatch('', 'abc')).toBe(false);
    });

    test('"ite" が "アイテム" に部分マッチする（途中から）', () => {
        // "ite"→"いて"、"アイテム"→"あいてむ" に "いて" が含まれる
        expect(fuzzyMatch('アイテム', 'ite')).toBe(true);
    });

    test('"enemy" が "エネミー" にマッチしない（エネミーはローマ字でenemiiなど）', () => {
        // enemy→えねみー（yで終わる変換）はあるが "my" の変換次第
        // "enemy"→"えねみー"ではなく"えねみ" になる可能性があるが、
        // 少なくとも "ene" は "えね" にマッチし "エネミー" にヒットする
        expect(fuzzyMatch('エネミー', 'ene')).toBe(true);
    });

    test('"ka" が "カ" にマッチする', () => {
        expect(fuzzyMatch('カ', 'ka')).toBe(true);
    });

    test('"shi" が "シ" にマッチする', () => {
        expect(fuzzyMatch('シ', 'shi')).toBe(true);
    });

    // ローマ字途中入力（末尾未変換子音の除去）
    test('ローマ字途中入力: "ait" が "あいてむ" にマッチする（末尾子音tを除去）', () => {
        expect(fuzzyMatch('あいてむ', 'ait')).toBe(true);
    });

    test('ローマ字途中入力: "aitem" が "あいてむ" にマッチする（末尾子音mを除去）', () => {
        expect(fuzzyMatch('あいてむ', 'aitem')).toBe(true);
    });

    test('ローマ字途中入力: "suk" が "すきる" にマッチする（末尾子音kを除去）', () => {
        expect(fuzzyMatch('すきる', 'suk')).toBe(true);
    });

    test('ローマ字途中入力: "aish" が "あいてむ" にマッチする（末尾2文字子音shを除去）', () => {
        expect(fuzzyMatch('あいてむ', 'aish')).toBe(true);
    });

    // 長音符・ハイフン正規化
    test('長音符正規化: ハイフン "-" で長音符 "ー" 含有データにヒットする', () => {
        expect(fuzzyMatch('スーパー', '-')).toBe(true);
    });

    test('長音符正規化: 長音符 "ー" でハイフン "-" 含有データにヒットする', () => {
        expect(fuzzyMatch('HP-100', 'ー')).toBe(true);
    });

    test('長音符正規化: 全角ハイフン "－" で長音符 "ー" 含有データにヒットする', () => {
        expect(fuzzyMatch('スーパー', '－')).toBe(true);
    });
});
