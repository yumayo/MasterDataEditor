/**
 * HTMLサニタイザー
 *
 * ホワイトリスト方式でHTMLをサニタイズする。
 * `<br>` / `<br/>` / `<br />` のみ許可し、他の全タグはエスケープする。
 */

/**
 * エスケープ後の `&lt;br&gt;` パターンを `<br>` に戻す正規表現（大文字小文字不問、スラッシュ・スペース許容）
 * プレースホルダー方式は `\x00` 等の文字がCSVデータに含まれる可能性があり XSS バイパスリスクがあるため、
 * エスケープ後逆変換方式に変更した。
 */
const ESCAPED_BR_PATTERN = /&lt;br\s*\/?&gt;/gi;

/**
 * テキストをHTMLサニタイズする。
 * `<br>` / `<br/>` / `<br />` のみ HTML 改行要素として描画し、
 * それ以外の `<` `>` `&` `"` はHTMLエスケープする。
 *
 * アルゴリズム:
 * 1. 全特殊文字を一括エスケープ（`&` → `&amp;`、`<` → `&lt;`、`>` → `&gt;`、`"` → `&quot;`）
 * 2. エスケープ後に現れた `&lt;br ...&gt;` パターンのみ `<br>` に戻す
 *    （元データに `<br>` が含まれていた場合のみマッチする。`&lt;br&gt;` 等のリテラルは既に `&amp;lt;br&amp;gt;` になっているためマッチしない）
 */
export function sanitizeHtml(text: string): string {
    // 手順1: 全特殊文字をHTMLエスケープ（& → &amp; は必ず先に処理する）
    const escaped = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    // 手順2: エスケープ後の <br> 表現を <br> に戻す
    return escaped.replace(ESCAPED_BR_PATTERN, '<br>');
}
