export type ExportWindowColumnIndices = { beginIndex: number; endIndex: number };

export type ExportRowWindow =
    | { kind: 'valid'; beginMs: number | null; endMs: number | null }
    | { kind: 'unknown' };

/** 出力期間の判定は検証とリビジョン比較で共用する。両端を含み、空欄は無期限。 */
export function resolveExportWindowColumns(header: readonly string[], beginColumnName: string, endColumnName: string): ExportWindowColumnIndices | null {
    if (beginColumnName === '' || endColumnName === '') return null;
    const beginIndex = header.indexOf(beginColumnName);
    const endIndex = header.indexOf(endColumnName);
    if (beginIndex === -1 || endIndex === -1) return null;
    return {beginIndex, endIndex};
}

export function resolveRowExportWindow(row: readonly string[], columns: ExportWindowColumnIndices): ExportRowWindow {
    const begin = parseTemporalValue(row[columns.beginIndex] ?? '');
    const end = parseTemporalValue(row[columns.endIndex] ?? '');
    if (begin.kind === 'invalid' || end.kind === 'invalid') return {kind: 'unknown'};
    if (begin.kind === 'valid' && end.kind === 'valid' && begin.ms > end.ms) return {kind: 'unknown'};
    return {kind: 'valid', beginMs: begin.kind === 'valid' ? begin.ms : null, endMs: end.kind === 'valid' ? end.ms : null};
}

export function isRowActiveAtExportTime(row: readonly string[], columns: ExportWindowColumnIndices | null, timeMs: number): boolean {
    if (columns === null) return true;
    const window = resolveRowExportWindow(row, columns);
    if (window.kind === 'unknown') return false;
    return (window.beginMs ?? Number.NEGATIVE_INFINITY) <= timeMs && timeMs <= (window.endMs ?? Number.POSITIVE_INFINITY);
}

type ParsedTemporalValue =
    | { kind: 'empty' }
    | { kind: 'valid'; ms: number }
    | { kind: 'invalid' };

export function parseTemporalValue(value: string): ParsedTemporalValue {
    const trimmed = value.trim();
    if (trimmed === '') return { kind: 'empty' };

    const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?(?:\s*(Z|[+-]\d{2}:?\d{2}))?$/.exec(trimmed);
    if (match !== null) {
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        const hour = match[4] === undefined ? 0 : Number(match[4]);
        const minute = match[5] === undefined ? 0 : Number(match[5]);
        const second = match[6] === undefined ? 0 : Number(match[6]);
        const millisecond = match[7] === undefined ? 0 : Number(match[7].padEnd(3, '0'));
        const timezone = match[8];

        if (timezone !== undefined) {
            const normalizedTimezone = timezone === 'Z'
                ? 'Z'
                : timezone.includes(':')
                    ? timezone
                    : `${timezone.slice(0, 3)}:${timezone.slice(3)}`;
            const normalized = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.${String(millisecond).padStart(3, '0')}${normalizedTimezone}`;
            const parsed = Date.parse(normalized);
            return Number.isFinite(parsed) ? { kind: 'valid', ms: parsed } : { kind: 'invalid' };
        }

        const date = new Date(year, month - 1, day, hour, minute, second, millisecond);
        if (
            date.getFullYear() !== year
            || date.getMonth() !== month - 1
            || date.getDate() !== day
            || date.getHours() !== hour
            || date.getMinutes() !== minute
            || date.getSeconds() !== second
            || date.getMilliseconds() !== millisecond
        ) {
            return { kind: 'invalid' };
        }
        return { kind: 'valid', ms: date.getTime() };
    }

    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? { kind: 'valid', ms: parsed } : { kind: 'invalid' };
}

