/**
 * 連続データを生成するためのユーティリティ
 */

/**
 * 値のパターンを解析して次の値を生成する
 */
export function generateSeriesValue(values: string[], index: number): string {
    if (values.length === 0) return '';

    // 1つの値の場合はそのままコピー
    if (values.length === 1) {
        return tryIncrementValue(values[0], index);
    }

    // 複数の値がある場合、パターンを検出
    const pattern = detectPattern(values);

    if (pattern.type === 'numeric') {
        // 数値パターン: 差分を使って次の値を計算
        const lastValue = parseFloat(values[values.length - 1]);
        return String(lastValue + pattern.step * (index + 1));
    }

    if (pattern.type === 'numericSuffix') {
        // 数値サフィックスパターン: プレフィックス + 増加する数値
        const lastMatch = values[values.length - 1].match(/^(.*?)(\d+)$/);
        if (lastMatch) {
            const prefix = lastMatch[1];
            const lastNum = parseInt(lastMatch[2], 10);
            const numLength = lastMatch[2].length;
            const nextNum = lastNum + pattern.step * (index + 1);
            return prefix + String(nextNum).padStart(numLength, '0');
        }
    }

    if (pattern.type === 'numericPrefix') {
        // 数値プレフィックスパターン: 増加する数値 + サフィックス
        const lastMatch = values[values.length - 1].match(/^(\d+)(.*)$/);
        if (lastMatch) {
            const lastNum = parseInt(lastMatch[1], 10);
            const suffix = lastMatch[2];
            const numLength = lastMatch[1].length;
            const nextNum = lastNum + pattern.step * (index + 1);
            return String(nextNum).padStart(numLength, '0') + suffix;
        }
    }

    // パターンが検出できない場合、循環して値を返す
    const cycleIndex = (values.length + index) % values.length;
    return values[cycleIndex];
}

interface Pattern {
    type: 'numeric' | 'numericSuffix' | 'numericPrefix' | 'cycle';
    step: number;
}

function detectPattern(values: string[]): Pattern {
    // すべてが数値かチェック
    const numericValues = values.map(v => parseFloat(v));
    const allNumeric = values.every(v => !isNaN(parseFloat(v)) && isFinite(parseFloat(v)));

    if (allNumeric && values.length >= 2) {
        // 等差数列かチェック
        const diffs: number[] = [];
        for (let i = 1; i < numericValues.length; i++) {
            diffs.push(numericValues[i] - numericValues[i - 1]);
        }

        const allSameDiff = diffs.every(d => Math.abs(d - diffs[0]) < 0.0001);
        if (allSameDiff) {
            return { type: 'numeric', step: diffs[0] };
        }
    }

    // 数値サフィックスパターンをチェック (例: item1, item2, item3)
    const suffixMatches = values.map(v => v.match(/^(.*?)(\d+)$/));
    if (suffixMatches.every(m => m !== null)) {
        const prefixes = suffixMatches.map(m => m![1]);
        const numbers = suffixMatches.map(m => parseInt(m![2], 10));

        if (prefixes.every(p => p === prefixes[0]) && numbers.length >= 2) {
            const diffs: number[] = [];
            for (let i = 1; i < numbers.length; i++) {
                diffs.push(numbers[i] - numbers[i - 1]);
            }

            const allSameDiff = diffs.every(d => d === diffs[0]);
            if (allSameDiff) {
                return { type: 'numericSuffix', step: diffs[0] };
            }
        }
    }

    // 数値プレフィックスパターンをチェック (例: 1st, 2nd, 3rd)
    const prefixMatches = values.map(v => v.match(/^(\d+)(.*)$/));
    if (prefixMatches.every(m => m !== null)) {
        const numbers = prefixMatches.map(m => parseInt(m![1], 10));
        const suffixes = prefixMatches.map(m => m![2]);

        if (suffixes.every(s => s === suffixes[0]) && numbers.length >= 2) {
            const diffs: number[] = [];
            for (let i = 1; i < numbers.length; i++) {
                diffs.push(numbers[i] - numbers[i - 1]);
            }

            const allSameDiff = diffs.every(d => d === diffs[0]);
            if (allSameDiff) {
                return { type: 'numericPrefix', step: diffs[0] };
            }
        }
    }

    return { type: 'cycle', step: 0 };
}

/**
 * 単一の値を増加させる試み
 */
function tryIncrementValue(value: string, index: number): string {
    // 数値の場合
    const num = parseFloat(value);
    if (!isNaN(num) && isFinite(num)) {
        return String(num + index);
    }

    // 数値サフィックスの場合 (例: item1 -> item2)
    const suffixMatch = value.match(/^(.*?)(\d+)$/);
    if (suffixMatch) {
        const prefix = suffixMatch[1];
        const numPart = parseInt(suffixMatch[2], 10);
        const numLength = suffixMatch[2].length;
        return prefix + String(numPart + index).padStart(numLength, '0');
    }

    // 数値プレフィックスの場合 (例: 1st -> 2st)
    const prefixMatch = value.match(/^(\d+)(.*)$/);
    if (prefixMatch) {
        const numPart = parseInt(prefixMatch[1], 10);
        const suffix = prefixMatch[2];
        const numLength = prefixMatch[1].length;
        return String(numPart + index).padStart(numLength, '0') + suffix;
    }

    // パターンが検出できない場合、元の値をそのまま返す
    return value;
}

/**
 * 選択範囲から連続データを生成
 * @param sourceValues 元データの2次元配列 [row][column]
 * @param direction フィルする方向
 * @param count 生成する個数
 */
export function generateSeriesData(
    sourceValues: string[][],
    direction: 'down' | 'up' | 'right' | 'left',
    count: number
): string[][] {
    const result: string[][] = [];

    if (direction === 'down' || direction === 'up') {
        // 縦方向のフィル: 各列ごとに連続データを生成
        const numRows = sourceValues.length;
        const numCols = sourceValues[0].length;

        for (let i = 0; i < count; i++) {
            const row: string[] = [];
            for (let col = 0; col < numCols; col++) {
                const colValues = sourceValues.map(r => r[col]);
                if (direction === 'up') {
                    colValues.reverse();
                }
                row.push(generateSeriesValue(colValues, i));
            }
            result.push(row);
        }
    } else {
        // 横方向のフィル: 各行ごとに連続データを生成
        const numRows = sourceValues.length;
        const numCols = sourceValues[0].length;

        for (let rowIdx = 0; rowIdx < numRows; rowIdx++) {
            const rowValues = [...sourceValues[rowIdx]];
            if (direction === 'left') {
                rowValues.reverse();
            }

            const generatedRow: string[] = [];
            for (let i = 0; i < count; i++) {
                generatedRow.push(generateSeriesValue(rowValues, i));
            }
            result.push(generatedRow);
        }
    }

    return result;
}
