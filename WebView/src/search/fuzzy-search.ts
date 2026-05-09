/**
 * ローマ字→ひらがな変換テーブル
 * 長いパターンを優先して先に試みるため降順で定義する（拗音 > 通常）
 */
const ROMAJI_TABLE: Array<[string, string]> = [
    // 拗音（3文字）
    ['sha', 'しゃ'], ['shi', 'し'], ['shu', 'しゅ'], ['she', 'しぇ'], ['sho', 'しょ'],
    ['chi', 'ち'], ['tsu', 'つ'],
    ['cha', 'ちゃ'], ['chu', 'ちゅ'], ['che', 'ちぇ'], ['cho', 'ちょ'],
    ['kya', 'きゃ'], ['kyu', 'きゅ'], ['kyo', 'きょ'],
    ['nya', 'にゃ'], ['nyu', 'にゅ'], ['nyo', 'にょ'],
    ['hya', 'ひゃ'], ['hyu', 'ひゅ'], ['hyo', 'ひょ'],
    ['mya', 'みゃ'], ['myu', 'みゅ'], ['myo', 'みょ'],
    ['rya', 'りゃ'], ['ryu', 'りゅ'], ['ryo', 'りょ'],
    ['gya', 'ぎゃ'], ['gyu', 'ぎゅ'], ['gyo', 'ぎょ'],
    ['bya', 'びゃ'], ['byu', 'びゅ'], ['byo', 'びょ'],
    ['pya', 'ぴゃ'], ['pyu', 'ぴゅ'], ['pyo', 'ぴょ'],
    ['dya', 'ぢゃ'], ['dyu', 'ぢゅ'], ['dyo', 'ぢょ'],
    ['zya', 'じゃ'], ['zyu', 'じゅ'], ['zyo', 'じょ'],
    ['jya', 'じゃ'], ['jyu', 'じゅ'], ['jyo', 'じょ'],
    // 2文字（通常音節）
    ['ka', 'か'], ['ki', 'き'], ['ku', 'く'], ['ke', 'け'], ['ko', 'こ'],
    ['sa', 'さ'], ['si', 'し'], ['su', 'す'], ['se', 'せ'], ['so', 'そ'],
    ['ta', 'た'], ['ti', 'ち'], ['tu', 'つ'], ['te', 'て'], ['to', 'と'],
    ['na', 'な'], ['ni', 'に'], ['nu', 'ぬ'], ['ne', 'ね'], ['no', 'の'],
    ['ha', 'は'], ['hi', 'ひ'], ['fu', 'ふ'], ['hu', 'ふ'], ['he', 'へ'], ['ho', 'ほ'],
    ['ma', 'ま'], ['mi', 'み'], ['mu', 'む'], ['me', 'め'], ['mo', 'も'],
    ['ya', 'や'], ['yu', 'ゆ'], ['yo', 'よ'],
    ['ra', 'ら'], ['ri', 'り'], ['ru', 'る'], ['re', 'れ'], ['ro', 'ろ'],
    ['wa', 'わ'], ['wo', 'を'],
    ['ga', 'が'], ['gi', 'ぎ'], ['gu', 'ぐ'], ['ge', 'げ'], ['go', 'ご'],
    ['za', 'ざ'], ['zi', 'じ'], ['zu', 'ず'], ['ze', 'ぜ'], ['zo', 'ぞ'],
    ['da', 'だ'], ['di', 'ぢ'], ['du', 'づ'], ['de', 'で'], ['do', 'ど'],
    ['ba', 'ば'], ['bi', 'び'], ['bu', 'ぶ'], ['be', 'べ'], ['bo', 'ぼ'],
    ['pa', 'ぱ'], ['pi', 'ぴ'], ['pu', 'ぷ'], ['pe', 'ぺ'], ['po', 'ぽ'],
    ['ja', 'じゃ'], ['ji', 'じ'], ['ju', 'じゅ'], ['je', 'じぇ'], ['jo', 'じょ'],
    // 1文字母音
    ['a', 'あ'], ['i', 'い'], ['u', 'う'], ['e', 'え'], ['o', 'お'],
    // 「ん」専用（nn）
    ['nn', 'ん'],
];

/**
 * 3文字パターン一覧（優先マッチ用）
 */
const THREE_CHAR_MAP = new Map<string, string>();
/**
 * 2文字パターン一覧
 */
const TWO_CHAR_MAP = new Map<string, string>();
/**
 * 1文字パターン一覧
 */
const ONE_CHAR_MAP = new Map<string, string>();

// テーブルをマップに分類して初期化する
for (const [romaji, hiragana] of ROMAJI_TABLE) {
    if (romaji.length === 3) THREE_CHAR_MAP.set(romaji, hiragana);
    else if (romaji.length === 2) TWO_CHAR_MAP.set(romaji, hiragana);
    else ONE_CHAR_MAP.set(romaji, hiragana);
}

/**
 * 子音文字セット（促音「っ」変換判定に使用）
 */
const CONSONANTS = new Set(['k', 's', 't', 'n', 'h', 'm', 'y', 'r', 'w', 'g', 'z', 'd', 'b', 'p', 'f', 'j', 'c', 'v']);

/**
 * ローマ字をひらがなに変換する。
 * ヘボン式ローマ字に対応し、変換できない文字はそのまま残す。
 *
 * @param romaji 変換するローマ字文字列
 * @returns ひらがな変換後の文字列
 */
export function romajiToHiragana(romaji: string): string {
    // 入力をすべて小文字化してから処理する
    const lower = romaji.toLowerCase();
    let result = '';
    let i = 0;
    while (i < lower.length) {
        // 促音処理: 同じ子音が連続したら「っ」を挿入（nn は除く）
        if (
            i + 1 < lower.length &&
            lower[i] === lower[i + 1] &&
            CONSONANTS.has(lower[i]) &&
            lower[i] !== 'n'
        ) {
            result += 'っ';
            i++;
            continue;
        }
        // 「n」処理: 次が子音または末尾なら「ん」（ただし「nn」は別で処理）
        // 注意: `y` は子音セットに含まれるが「nyo/nya/nyu」等の拗音を構成するため除外する
        if (lower[i] === 'n') {
            if (i + 1 < lower.length) {
                const next = lower[i + 1];
                // 「na/ni/nu/ne/no/nn」等の音節に続く場合はそのまま（音節処理に任せる）
                // 「nb, nm」等の他子音が続く場合は「ん」と確定する
                const twoChar = lower.substring(i, i + 2);
                if (TWO_CHAR_MAP.has(twoChar) || THREE_CHAR_MAP.has(lower.substring(i, i + 3))) {
                    // 通常の音節パターンに該当する → 音節変換処理で処理する
                } else if (CONSONANTS.has(next) && next !== 'y') {
                    // `y` を除外することで「ny→ん+y」への誤変換を防ぐ
                    // （「nyo/nya/nyu」はTHREE_CHAR_MAPに登録されているが、「ny」だけで終わる等の
                    //   エッジケースでも`y`を`ん`変換のトリガーにしてはならない）
                    result += 'ん';
                    i++;
                    continue;
                }
            } else {
                // 末尾の単独「n」は「ん」に変換
                result += 'ん';
                i++;
                continue;
            }
        }
        // 3文字マッチを最初に試みる（拗音優先）
        if (i + 3 <= lower.length) {
            const three = lower.substring(i, i + 3);
            const h3 = THREE_CHAR_MAP.get(three);
            if (h3 !== undefined) {
                result += h3;
                i += 3;
                continue;
            }
        }
        // 2文字マッチ
        if (i + 2 <= lower.length) {
            const two = lower.substring(i, i + 2);
            const h2 = TWO_CHAR_MAP.get(two);
            if (h2 !== undefined) {
                result += h2;
                i += 2;
                continue;
            }
        }
        // 1文字マッチ（母音のみ）
        const one = lower[i];
        const h1 = ONE_CHAR_MAP.get(one);
        if (h1 !== undefined) {
            result += h1;
            i++;
            continue;
        }
        // 変換できない文字はそのまま残す
        result += lower[i];
        i++;
    }
    return result;
}

/**
 * 正規化の内部実装。
 * 全角英数字→半角、カタカナ→ひらがな を行い、`lowercaseAlpha` が true の場合は大文字も小文字に変換する。
 *
 * @param text 正規化するテキスト
 * @param lowercaseAlpha true の場合は英字大文字を小文字に変換する
 * @returns 正規化後のテキスト
 */
function normalizeInternal(text: string, lowercaseAlpha: boolean): string {
    let result = '';
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        // 全角英大文字（Ａ-Ｚ: U+FF21–U+FF3A）→ 半角（lowercaseAlpha なら小文字、さもなくば大文字）
        if (code >= 0xFF21 && code <= 0xFF3A) {
            result += String.fromCharCode(code - 0xFF21 + (lowercaseAlpha ? 0x61 : 0x41));
            continue;
        }
        // 全角英小文字（ａ-ｚ: U+FF41–U+FF5A）→ 半角小文字
        if (code >= 0xFF41 && code <= 0xFF5A) {
            result += String.fromCharCode(code - 0xFF41 + 0x61);
            continue;
        }
        // 全角数字（０-９: U+FF10–U+FF19）→ 半角数字
        if (code >= 0xFF10 && code <= 0xFF19) {
            result += String.fromCharCode(code - 0xFF10 + 0x30);
            continue;
        }
        // 半角英大文字（A-Z: U+0041–U+005A）→ lowercaseAlpha なら小文字に変換
        if (lowercaseAlpha && code >= 0x41 && code <= 0x5A) {
            result += String.fromCharCode(code + 0x20);
            continue;
        }
        // カタカナ（ア-ン: U+30A1–U+30F6）→ ひらがな（あ-ん: U+3041–U+3096）
        if (code >= 0x30A1 && code <= 0x30F6) {
            result += String.fromCharCode(code - 0x60);
            continue;
        }
        // 長音符（U+30FC）・全角ハイフン（U+FF0D）→ 半角ハイフン（U+002D）に統一
        if (code === 0x30FC || code === 0xFF0D) {
            result += '-';
            continue;
        }
        // その他はそのまま
        result += text[i];
    }
    return result;
}

/**
 * 検索用に文字列を正規化する（大文字小文字を区別しない版）。
 * 全角英数字→半角、大文字→小文字、カタカナ→ひらがな の順に変換する。
 *
 * @param text 正規化するテキスト
 * @returns 正規化後のテキスト
 */
export function normalizeForSearch(text: string): string {
    return normalizeInternal(text, true);
}

/**
 * 大文字小文字を区別する検索用の正規化（全角半角のみ変換、大文字小文字は維持）。
 * 全角英数字→半角、カタカナ→ひらがな の変換のみ行い、大文字小文字は変換しない。
 *
 * @param text 正規化するテキスト
 * @returns 正規化後のテキスト
 */
export function normalizeForSearchCaseSensitive(text: string): string {
    return normalizeInternal(text, false);
}

/**
 * ファジーマッチの結果（マッチ位置と長さ）
 */
interface NormalizedMatch { index: number; length: number; }

/**
 * 正規化済みのhaystack内でneedleの最初のマッチ位置と長さを返す内部ヘルパー。
 * 直接マッチ → ローマ字変換マッチ → 末尾アルファベット除去マッチ の優先順で試みる。
 *
 * @param normalizedHaystack normalizeForSearch 適用済みの検索対象文字列
 * @param needle 検索文字列（未正規化）
 * @returns マッチ情報（マッチしない場合は null）
 */
function findNormalizedMatch(normalizedHaystack: string, needle: string): NormalizedMatch | null {
    const normalizedNeedle = normalizeForSearch(needle);
    // 通常の部分一致（正規化後）
    const directIndex = normalizedHaystack.indexOf(normalizedNeedle);
    if (directIndex !== -1) return {index: directIndex, length: normalizedNeedle.length};
    // ローマ字→ひらがな変換後の部分一致
    const romajiConverted = normalizeForSearch(romajiToHiragana(needle));
    if (romajiConverted !== normalizedNeedle) {
        const romajiIndex = normalizedHaystack.indexOf(romajiConverted);
        if (romajiIndex !== -1) return {index: romajiIndex, length: romajiConverted.length};
    }
    // 末尾未変換アルファベットの除去: "aish"→"あいsh"の末尾"sh"を除いた"あい"でマッチを試みる
    const trimmed = trimTrailingAlpha(romajiConverted);
    if (trimmed.length > 0 && trimmed.length < romajiConverted.length) {
        const trimmedIndex = normalizedHaystack.indexOf(trimmed);
        if (trimmedIndex !== -1) return {index: trimmedIndex, length: trimmed.length};
    }
    return null;
}

/**
 * ローマ字変換結果の末尾に残った連続アルファベットをすべて除去する。
 * "あいsh" → "あい"、"あいてm" → "あいて" のように途中入力の未変換部分を取り除く。
 */
function trimTrailingAlpha(converted: string): string {
    let end = converted.length;
    while (end > 0 && converted.charCodeAt(end - 1) >= 0x61 && converted.charCodeAt(end - 1) <= 0x7A) end--;
    return converted.substring(0, end);
}

/**
 * ファジー検索マッチング。
 * normalizeForSearch + romajiToHiragana を組み合わせて部分一致を判定する。
 *
 * @param haystack 検索対象の文字列
 * @param needle 検索文字列（ローマ字・全角文字も対応）
 * @returns マッチすれば true
 */
export function fuzzyMatch(haystack: string, needle: string): boolean {
    if (needle === '' || haystack === '') return false;
    return findNormalizedMatch(normalizeForSearch(haystack), needle) !== null;
}

/**
 * ハイライト情報の断片
 */
export interface HighlightSegment {
    text: string;
    highlight: boolean;
}

/**
 * ファジー検索マッチングと同時にハイライト範囲を返す。
 * マッチした部分を highlight: true で返し、それ以外を highlight: false で返す。
 * マッチしない場合は全体を highlight: false で返す。
 *
 * @param haystack 検索対象の文字列
 * @param needle 検索文字列
 * @returns ハイライト情報の配列
 */
export function fuzzyMatchHighlight(haystack: string, needle: string): Array<HighlightSegment> {
    if (needle === '' || haystack === '') return [{text: haystack, highlight: false}];
    const normalizedHaystack = normalizeForSearch(haystack);
    const match = findNormalizedMatch(normalizedHaystack, needle);
    if (match === null) return [{text: haystack, highlight: false}];
    return buildSegments(haystack, match.index, match.index + match.length);
}

/**
 * fuzzyMatchHighlight の結果を元に、マッチ部分にハイライトspanを付与してコンテナに追加する。
 * マッチしない場合はそのままテキストノードとして追加する。
 * クエリが空の場合はハイライトなしでテキストのみ表示する。
 *
 * @param container 追加先のコンテナ要素
 * @param text 表示するテキスト（元の文字列）
 * @param needle 検索文字列（ハイライト用）
 */
export function appendHighlightedSegments(container: HTMLElement, text: string, needle: string): void {
    if (needle === '') {
        container.appendChild(document.createTextNode(text));
        return;
    }
    const segments = fuzzyMatchHighlight(text, needle);
    for (const segment of segments) {
        if (segment.highlight) {
            const span = document.createElement('span');
            span.classList.add('search-highlight');
            span.textContent = segment.text;
            container.appendChild(span);
        } else {
            container.appendChild(document.createTextNode(segment.text));
        }
    }
}

/**
 * マッチ位置に基づいてハイライトセグメント配列を構築する。
 * 正規化後の位置インデックスは元の文字列と同じ文字数単位なので直接使用できる。
 *
 * @param original 元の文字列
 * @param start マッチ開始インデックス
 * @param end マッチ終了インデックス（exclusive）
 * @returns ハイライトセグメント配列
 */
function buildSegments(original: string, start: number, end: number): Array<HighlightSegment> {
    const segments: Array<HighlightSegment> = [];
    if (start > 0) segments.push({text: original.substring(0, start), highlight: false});
    segments.push({text: original.substring(start, end), highlight: true});
    if (end < original.length) segments.push({text: original.substring(end), highlight: false});
    return segments;
}
