import {Csv} from "../data/csv";
import {GitDiffTracker} from "./git-diff-tracker";

/**
 * 差分計算結果の1行分（discriminated union）
 */
export type DiffRow =
    | { kind: 'modified';   headValues: string[]; currentValues: string[]; changedColumnIndices: Set<number> }
    | { kind: 'unchanged';  headValues: string[]; currentValues: string[] }
    | { kind: 'deleted';    headValues: string[] }
    | { kind: 'added';      currentValues: string[] };

/**
 * スキーマJSONのヘッダー列定義
 */
export interface SchemaColumn {
    key: number;
    name: string;
    type: string;
}

/**
 * スキーマJSON
 */
export interface SchemaJson {
    header: SchemaColumn[];
    primary_key: string[];
}

/**
 * CSVを行と列に分割する（ヘッダー行とデータ行に分割）
 * RFC4180準拠のCsvクラスを使い、ダブルクォートで囲まれたカンマ含有フィールドを正しくパースする。
 */
function parseCsv(csvText: string): { header: string[]; rows: string[][] } {
    const csv = new Csv();
    csv.load(csvText);
    return { header: csv.header, rows: csv.body };
}

/**
 * CSV行を複合PKキー値でMapに変換する（順序はarrayで保持する）
 * 複合PKキー = 全PK列値をタブ区切りで連結した文字列（単一PKは列値のみ）
 * PKキーが重複している行は "_row<index>" サフィックスで一意化する
 */
function buildUniqueKeyMap(rows: string[][], pkIndices: number[]): { map: Map<string, string[]>; order: string[] } {
    const map = new Map<string, string[]>();
    const order: string[] = [];
    const seenIndices = new Map<string, number>();
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        // GitDiffTracker.buildCompositeKey() で複合PKキーを生成する（コピペ排除）
        const rawPk = GitDiffTracker.buildCompositeKey(row, pkIndices);
        if (!seenIndices.has(rawPk)) {
            seenIndices.set(rawPk, i);
            map.set(rawPk, row);
            order.push(rawPk);
        } else {
            const firstIndex = seenIndices.get(rawPk)!;
            if (map.has(rawPk)) {
                // 初出エントリを "_row<初出index>" キーに移動する
                const firstRow = map.get(rawPk)!;
                map.delete(rawPk);
                const firstKey = rawPk + '_row' + firstIndex;
                map.set(firstKey, firstRow);
                const orderIdx = order.indexOf(rawPk);
                if (orderIdx !== -1) order[orderIdx] = firstKey;
                seenIndices.set(rawPk, -1);
            }
            const newKey = rawPk + '_row' + i;
            map.set(newKey, row);
            order.push(newKey);
        }
    }
    return { map, order };
}

/**
 * HEAD版とCurrent版のCSVを行順でマージして差分行リストを構築する
 * ファイル行順を維持するため PKソートは行わない。
 *
 * アルゴリズム:
 * 1. HEAD版の order 順にループする
 *    - Current版にも存在する行 → modified/unchanged（元の位置に配置）
 *    - Current版に存在しない行 → deleted（HEAD版の元の位置に配置される）
 * 2. Current版の order 順にループし、HEAD版に存在しない行を added として末尾に追加する
 * これにより、削除行が HEAD版の元の位置に配置され、added行は末尾にまとめて配置される。
 */
export function buildDiffRows(headCsvText: string, currentCsvText: string, primaryKeyNames: readonly string[]): { diffRows: DiffRow[]; displayHeader: string[]; newColumnIndices: ReadonlySet<number> } {
    const head = parseCsv(headCsvText);
    const current = parseCsv(currentCsvText);

    // 表示に使う列ヘッダーは現在版を優先し、なければHEAD版を使う
    const displayHeader = current.header.length > 0 ? current.header : head.header;

    // 列名→元ヘッダー上のインデックスのマップを構築する（GitDiffTracker.remapRow で使用）
    const headHeaderMap = GitDiffTracker.buildHeaderIndexMap(head.header);
    const currentHeaderMap = GitDiffTracker.buildHeaderIndexMap(current.header);

    // HEAD版に存在しない列のインデックス集合（新規列の識別に使用）
    const newColumnIndices = new Set<number>();
    for (let i = 0; i < displayHeader.length; i++) {
        if (!headHeaderMap.has(displayHeader[i])) newColumnIndices.add(i);
    }

    // 複合PKの各列インデックスを取得する（HEAD版・現在版でそれぞれ独立して解決する）
    const pkIndicesInHead = primaryKeyNames.map(name => head.header.indexOf(name));
    const pkIndicesInCurrent = primaryKeyNames.map(name => current.header.indexOf(name));

    const { map: headMap, order: headOrder } = buildUniqueKeyMap(head.rows, pkIndicesInHead);
    const { map: currentMap, order: currentOrder } = buildUniqueKeyMap(current.rows, pkIndicesInCurrent);

    // HEAD版の order 順に処理する（削除行を元の位置に配置するため）
    const processedCurrentKeys = new Set<string>();
    const diffRows: DiffRow[] = [];

    for (const headKey of headOrder) {
        const headRow = headMap.get(headKey)!;
        // HEAD版キーと対応するCurrent版エントリを解決する
        // "_row<index>"サフィックスの正規化を考慮して Current版 Map を検索する:
        //   1. 完全一致（重複PKでサフィックス付きキーが一致する場合）
        //   2. rawPKによる照合（HEAD版が重複なしキー、Current版も重複なしキーで一致する場合）
        const currentEntryRawPk = headKey.includes('_row') ? headKey.substring(0, headKey.lastIndexOf('_row')) : headKey;
        const currentEntry: { key: string; row: string[] } | null =
            currentMap.has(headKey) ? { key: headKey, row: currentMap.get(headKey)! } :
            currentMap.has(currentEntryRawPk) ? { key: currentEntryRawPk, row: currentMap.get(currentEntryRawPk)! } :
            null;

        if (currentEntry !== null) {
            processedCurrentKeys.add(currentEntry.key);
            // 両方に存在 → 表示ヘッダー順に並べ替えてからセル単位で比較する
            const remappedHead = GitDiffTracker.remapRow(headRow, headHeaderMap, displayHeader);
            const remappedCurrent = GitDiffTracker.remapRow(currentEntry.row, currentHeaderMap, displayHeader);
            const changedIndices = new Set<number>();
            for (let i = 0; i < displayHeader.length; i++) {
                if (remappedHead[i] !== remappedCurrent[i]) changedIndices.add(i);
            }
            if (changedIndices.size > 0) {
                diffRows.push({ kind: 'modified', headValues: remappedHead, currentValues: remappedCurrent, changedColumnIndices: changedIndices });
            } else {
                diffRows.push({ kind: 'unchanged', headValues: remappedHead, currentValues: remappedCurrent });
            }
        } else {
            // Current版に存在しない → HEAD版の元の位置に削除行を配置する（表示ヘッダー順に並べ替える）
            diffRows.push({ kind: 'deleted', headValues: GitDiffTracker.remapRow(headRow, headHeaderMap, displayHeader) });
        }
    }

    // Current版の order 順にループして、HEAD版に存在しない行を added として末尾に追加する
    for (const currentKey of currentOrder) {
        if (processedCurrentKeys.has(currentKey)) continue;
        // rawPK で HEAD版に存在しないかを確認する（"_row<index>"サフィックスを除去して照合）
        const addedRawPk = currentKey.includes('_row') ? currentKey.substring(0, currentKey.lastIndexOf('_row')) : currentKey;
        const existsInHead = headMap.has(currentKey) || headMap.has(addedRawPk);
        if (!existsInHead) {
            diffRows.push({ kind: 'added', currentValues: GitDiffTracker.remapRow(currentMap.get(currentKey)!, currentHeaderMap, displayHeader) });
        }
    }

    return { diffRows, displayHeader, newColumnIndices };
}

/**
 * 差分行リストからCSV行データ（マージ済み）を生成する
 * deleted行は空白行として挿入し、.diff-row-empty クラス付与のためインデックスを記録する
 *
 * 戻り値:
 * - leftRows: 左ペイン（HEAD版）のデータ行配列（空白行は空配列）
 * - rightRows: 右ペイン（Current版）のデータ行配列（空白行は空配列）
 * - leftEmptyRowIndices: 左ペインで .diff-row-empty を付与すべきデータ行インデックス（0始まり）
 * - rightEmptyRowIndices: 右ペインで .diff-row-empty を付与すべきデータ行インデックス（0始まり）
 * - leftDeletedRowIndices: 左ペインで .diff-row-deleted を付与すべきデータ行インデックス
 * - rightAddedRowIndices: 右ペインで全セルに .diff-cell-added を付与すべきデータ行インデックス
 * - leftModifiedCells: 左ペインで .diff-cell-deleted を付与すべき {rowIndex, colIndex} ペア
 * - rightModifiedCells: 右ペインで .diff-cell-added を付与すべき {rowIndex, colIndex} ペア
 */
export function buildMergedData(diffRows: DiffRow[], columnCount: number): {
    leftRows: string[][];
    rightRows: string[][];
    leftEmptyRowIndices: number[];
    rightEmptyRowIndices: number[];
    leftDeletedRowIndices: number[];
    rightAddedRowIndices: number[];
    leftModifiedCells: Array<{ row: number; col: number }>;
    rightModifiedCells: Array<{ row: number; col: number }>;
} {
    const leftRows: string[][] = [];
    const rightRows: string[][] = [];
    const leftEmptyRowIndices: number[] = [];
    const rightEmptyRowIndices: number[] = [];
    const leftDeletedRowIndices: number[] = [];
    const rightAddedRowIndices: number[] = [];
    const leftModifiedCells: Array<{ row: number; col: number }> = [];
    const rightModifiedCells: Array<{ row: number; col: number }> = [];

    for (const diffRow of diffRows) {
        const rowIdx = leftRows.length; // 現在の行インデックス（0始まり）

        if (diffRow.kind === 'deleted') {
            // 削除行: 左にデータ行、右に空白行を挿入する
            leftRows.push(padRow(diffRow.headValues, columnCount));
            rightRows.push(emptyRow(columnCount));
            leftDeletedRowIndices.push(rowIdx);
            rightEmptyRowIndices.push(rowIdx);
        } else if (diffRow.kind === 'added') {
            // 追加行: 左に空白行、右にデータ行を挿入する
            leftRows.push(emptyRow(columnCount));
            rightRows.push(padRow(diffRow.currentValues, columnCount));
            leftEmptyRowIndices.push(rowIdx);
            rightAddedRowIndices.push(rowIdx);
        } else if (diffRow.kind === 'modified') {
            // 変更行: 左はHEAD版、右は現在版、変更セルに差分クラスを付与する
            leftRows.push(padRow(diffRow.headValues, columnCount));
            rightRows.push(padRow(diffRow.currentValues, columnCount));
            for (const colIdx of diffRow.changedColumnIndices) {
                leftModifiedCells.push({ row: rowIdx, col: colIdx });
                rightModifiedCells.push({ row: rowIdx, col: colIdx });
            }
        } else {
            // unchanged: 両方同じデータ
            leftRows.push(padRow(diffRow.headValues, columnCount));
            rightRows.push(padRow(diffRow.currentValues, columnCount));
        }
    }

    return { leftRows, rightRows, leftEmptyRowIndices, rightEmptyRowIndices, leftDeletedRowIndices, rightAddedRowIndices, leftModifiedCells, rightModifiedCells };
}

/** 列数に合わせて行を空文字でパディングする */
function padRow(values: string[], columnCount: number): string[] {
    if (values.length >= columnCount) return values.slice(0, columnCount);
    return [...values, ...Array(columnCount - values.length).fill('')];
}

/** 指定列数の空行を生成する */
function emptyRow(columnCount: number): string[] {
    return Array(columnCount).fill('');
}
