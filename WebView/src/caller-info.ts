/**
 * スタックトレースから呼び出し元情報を解析する共通ユーティリティ
 *
 * BackgroundTaskTracker と NotificationToast の両方で使用される。
 * 指定されたスキップパターンに一致するフレームを除外し、
 * 最初の実質的な呼び出し元を "filename.ts:行番号" 形式で返す。
 */

/**
 * 現在のスタックトレースから、skipPatterns に一致するフレームを除外した
 * 最初の呼び出し元フレームを特定する。
 * 例: "editor-table.ts:123"
 */
export function parseCallerInfo(skipPatterns: ReadonlyArray<string>): string {
    const stack = new Error().stack;
    if (!stack) return '';
    for (const line of stack.split('\n')) {
        if (!line.trim().startsWith('at ')) continue;
        if (skipPatterns.some(p => line.includes(p))) continue;
        // Chromium 形式: "    at funcName (path/to/file.ts:line:col)"
        // または:       "    at path/to/file.ts:line:col"
        const parenMatch = line.match(/\((.+):(\d+):\d+\)/);
        const atMatch = line.match(/at\s+(.+):(\d+):\d+/);
        const match = parenMatch !== null ? parenMatch : atMatch;
        if (match === null) continue;
        const parts = match[1].split('/');
        const rawName = parts.length > 0 ? parts[parts.length - 1] : match[1];
        const fileName = rawName.split('?')[0];
        return `${fileName}:${match[2]}`;
    }
    return '';
}
