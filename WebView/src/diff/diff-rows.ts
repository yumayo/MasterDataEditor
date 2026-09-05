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
 * 比較用キーを構築する。
 * 通常はPKのみで照合し、HEAD/Current のどちらかでPKが重複している値だけ
 * CSVデータ行インデックスも含めて照合する。
 */
function buildComparisonKey(rawPk: string, rowIndex: number, duplicatePkValues: ReadonlySet<string>): string {
    if (duplicatePkValues.has(rawPk)) return JSON.stringify(['row', rawPk, rowIndex]);
    return JSON.stringify(['pk', rawPk]);
}

interface KeyedRow {
    key: string;
    row: string[];
    rawPk: string;
    rowIndex: number;
}

interface DiffRowWithSortKey {
    diffRow: DiffRow;
    rawPk: string;
    leftOriginalRowIndex: number;
    rightOriginalRowIndex: number;
}

/**
 * CSV行を比較用キーのMapに変換する（順序はarrayで保持する）
 */
function buildKeyedRowMap(rows: string[][], pkIndices: number[], duplicatePkValues: ReadonlySet<string>): { map: Map<string, KeyedRow>; order: KeyedRow[] } {
    const map = new Map<string, KeyedRow>();
    const order: KeyedRow[] = [];
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rawPk = GitDiffTracker.buildCompositeKey(row, pkIndices);
        const key = buildComparisonKey(rawPk, i, duplicatePkValues);
        const keyedRow = { key, row, rawPk, rowIndex: i };
        map.set(key, keyedRow);
        order.push(keyedRow);
    }
    return { map, order };
}

/**
 * HEAD/Current のどちらか一方で重複しているPK値を収集する。
 * 両方に1行ずつ存在する通常の一致は重複扱いにしない。
 */
function findDuplicatePkValues(
    headRows: string[][],
    headPkIndices: number[],
    currentRows: string[][],
    currentPkIndices: number[]
): Set<string> {
    const duplicatePkValues = new Set<string>();

    const collectDuplicates = (rows: string[][], pkIndices: number[]): void => {
        const counts = new Map<string, number>();
        for (const row of rows) {
            const rawPk = GitDiffTracker.buildCompositeKey(row, pkIndices);
            const next = (counts.get(rawPk) ?? 0) + 1;
            counts.set(rawPk, next);
            if (next === 2) duplicatePkValues.add(rawPk);
        }
    };

    collectDuplicates(headRows, headPkIndices);
    collectDuplicates(currentRows, currentPkIndices);
    return duplicatePkValues;
}

function comparePkForDisplay(a: string, b: string): number {
    const aParts = a.split('\t');
    const bParts = b.split('\t');
    const length = Math.max(aParts.length, bParts.length);
    for (let i = 0; i < length; i++) {
        const aValue = i < aParts.length ? aParts[i] : '';
        const bValue = i < bParts.length ? bParts[i] : '';
        if (aValue === bValue) continue;

        const aNumber = Number(aValue);
        const bNumber = Number(bValue);
        if (aValue !== '' && bValue !== '' && Number.isFinite(aNumber) && Number.isFinite(bNumber) && aNumber !== bNumber) {
            return aNumber - bNumber;
        }

        return aValue.localeCompare(bValue);
    }
    return 0;
}

function insertAddedRowByPrimaryKey(diffRows: DiffRowWithSortKey[], addedRow: DiffRowWithSortKey): void {
    const insertIndex = diffRows.findIndex(row => comparePkForDisplay(row.rawPk, addedRow.rawPk) > 0);
    if (insertIndex === -1) {
        diffRows.push(addedRow);
    } else {
        diffRows.splice(insertIndex, 0, addedRow);
    }
}

/**
 * HEAD版とCurrent版のCSVを行順でマージして差分行リストを構築する
 *
 * アルゴリズム:
 * 1. HEAD版の order 順にループする
 *    - Current版にも存在する行 → modified/unchanged（元の位置に配置）
 *    - Current版に存在しない行 → deleted（HEAD版の元の位置に配置される）
 * 2. Current版の order 順にループし、HEAD版に存在しない行を added として主キー順の位置に挿入する
 * これにより、削除行は HEAD版の元の位置に配置しつつ、追加行は主キー順の位置に表示される。
 */
export function buildDiffRows(headCsvText: string, currentCsvText: string, primaryKeyNames: readonly string[]): { diffRows: DiffRow[]; displayHeader: string[]; newColumnIndices: ReadonlySet<number>; leftOriginalRowIndices: Int32Array; rightOriginalRowIndices: Int32Array } {
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

    const duplicatePkValues = findDuplicatePkValues(head.rows, pkIndicesInHead, current.rows, pkIndicesInCurrent);
    const { map: headMap, order: headOrder } = buildKeyedRowMap(head.rows, pkIndicesInHead, duplicatePkValues);
    const { map: currentMap, order: currentOrder } = buildKeyedRowMap(current.rows, pkIndicesInCurrent, duplicatePkValues);

    // HEAD版の order 順に処理する（削除行を元の位置に配置するため）
    const processedCurrentKeys = new Set<string>();
    const rowsWithSortKey: DiffRowWithSortKey[] = [];

    for (const headEntry of headOrder) {
        const headRow = headEntry.row;
        const currentEntry = currentMap.has(headEntry.key) ? currentMap.get(headEntry.key)! : null;

        if (currentEntry !== null) {
            processedCurrentKeys.add(headEntry.key);
            // 両方に存在 → 表示ヘッダー順に並べ替えてからセル単位で比較する
            const remappedHead = GitDiffTracker.remapRow(headRow, headHeaderMap, displayHeader);
            const remappedCurrent = GitDiffTracker.remapRow(currentEntry.row, currentHeaderMap, displayHeader);
            const changedIndices = new Set<number>();
            for (let i = 0; i < displayHeader.length; i++) {
                if (remappedHead[i] !== remappedCurrent[i]) changedIndices.add(i);
            }
            if (changedIndices.size > 0) {
                rowsWithSortKey.push({ rawPk: headEntry.rawPk, leftOriginalRowIndex: headEntry.rowIndex, rightOriginalRowIndex: currentEntry.rowIndex, diffRow: { kind: 'modified', headValues: remappedHead, currentValues: remappedCurrent, changedColumnIndices: changedIndices } });
            } else {
                rowsWithSortKey.push({ rawPk: headEntry.rawPk, leftOriginalRowIndex: headEntry.rowIndex, rightOriginalRowIndex: currentEntry.rowIndex, diffRow: { kind: 'unchanged', headValues: remappedHead, currentValues: remappedCurrent } });
            }
        } else {
            // Current版に存在しない → HEAD版の元の位置に削除行を配置する（表示ヘッダー順に並べ替える）
            rowsWithSortKey.push({ rawPk: headEntry.rawPk, leftOriginalRowIndex: headEntry.rowIndex, rightOriginalRowIndex: -1, diffRow: { kind: 'deleted', headValues: GitDiffTracker.remapRow(headRow, headHeaderMap, displayHeader) } });
        }
    }

    // Current版の order 順にループして、HEAD版に存在しない行を added として主キー順の位置に挿入する
    for (const currentEntry of currentOrder) {
        if (processedCurrentKeys.has(currentEntry.key)) continue;
        if (!headMap.has(currentEntry.key)) {
            insertAddedRowByPrimaryKey(rowsWithSortKey, {
                rawPk: currentEntry.rawPk,
                leftOriginalRowIndex: -1,
                rightOriginalRowIndex: currentEntry.rowIndex,
                diffRow: { kind: 'added', currentValues: GitDiffTracker.remapRow(currentEntry.row, currentHeaderMap, displayHeader) },
            });
        }
    }

    const diffRows = rowsWithSortKey.map(row => row.diffRow);
    return {
        diffRows, displayHeader, newColumnIndices,
        leftOriginalRowIndices: Int32Array.from(rowsWithSortKey.map(row => row.leftOriginalRowIndex)),
        rightOriginalRowIndices: Int32Array.from(rowsWithSortKey.map(row => row.rightOriginalRowIndex)),
    };
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
