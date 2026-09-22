import {buildDiffRows, buildMergedData, type DiffRow, type SchemaJson} from "./diff-rows";
import {Csv} from "../data/csv";
import {GitDiffTracker} from "./git-diff-tracker";
import type {DiffBuildResult, DiffBuildWorkerRequest, DiffBuildWorkerResponse} from "./diff-build-result";
import {parseTemporalValue, resolveExportWindowColumns, isRowActiveAtExportTime} from '../core/export-window';
import type {ExportValidationSettings} from '../settings/settings-schema';

const INDEXED_DIFF_ROW_THRESHOLD = 100000;

interface ParsedCsv {
    header: string[];
    rows: string[][];
}

interface KeyedRow {
    key: string;
    rawPk: string;
    rowIndex: number;
}

function parseCsv(csvText: string): ParsedCsv {
    const csv = new Csv();
    csv.load(csvText);
    return {header: csv.header, rows: csv.body};
}

function buildComparisonKey(rawPk: string, rowIndex: number, duplicatePkValues: ReadonlySet<string>): string {
    if (duplicatePkValues.has(rawPk)) return JSON.stringify(['row', rawPk, rowIndex]);
    return JSON.stringify(['pk', rawPk]);
}

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

function buildKeyedRows(rows: string[][], pkIndices: number[], duplicatePkValues: ReadonlySet<string>): {map: Map<string, KeyedRow>; order: KeyedRow[]} {
    const map = new Map<string, KeyedRow>();
    const order: KeyedRow[] = [];
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rawPk = GitDiffTracker.buildCompositeKey(row, pkIndices);
        const key = buildComparisonKey(rawPk, i, duplicatePkValues);
        const keyedRow = {key, rawPk, rowIndex: i};
        map.set(key, keyedRow);
        order.push(keyedRow);
    }
    return {map, order};
}

function buildHeadRowValuesPerDomRow(diffRows: DiffRow[]): Array<string[] | null> {
    const headRowValuesPerDomRow: Array<string[] | null> = [];
    for (const diffRow of diffRows) {
        if (diffRow.kind === 'deleted' || diffRow.kind === 'modified' || diffRow.kind === 'unchanged') {
            headRowValuesPerDomRow.push(diffRow.headValues);
        } else {
            headRowValuesPerDomRow.push(null);
        }
    }
    return headRowValuesPerDomRow;
}

function buildFullDiffData(request: DiffBuildWorkerRequest): DiffBuildResult {
    const schema = JSON.parse(request.schemaJson) as SchemaJson;
    const primaryKeyNames: readonly string[] = schema.primary_key;
    const {diffRows, displayHeader, newColumnIndices, leftOriginalRowIndices, rightOriginalRowIndices} = buildDiffRows(request.headCsv, request.currentCsv, primaryKeyNames);
    const columnCount = displayHeader.length;
    const merged = buildMergedData(diffRows, columnCount);
    return {
        mode: 'full',
        hasChanges: diffRows.some(row => row.kind !== 'unchanged') || (diffRows.length > 0 && newColumnIndices.size > 0),
        displayHeader,
        newColumnIndices: Array.from(newColumnIndices),
        leftOriginalRowIndices,
        rightOriginalRowIndices,
        headRowValuesPerDomRow: buildHeadRowValuesPerDomRow(diffRows),
        ...merged,
    };
}

function buildIndexedDiffData(request: DiffBuildWorkerRequest): DiffBuildResult {
    const schema = JSON.parse(request.schemaJson) as SchemaJson;
    const primaryKeyNames: readonly string[] = schema.primary_key;
    const head = parseCsv(request.headCsv);
    const current = parseCsv(request.currentCsv);
    const displayHeader = current.header.length > 0 ? current.header : head.header;
    const headHeaderMap = GitDiffTracker.buildHeaderIndexMap(head.header);

    const newColumnIndices: number[] = [];
    for (let i = 0; i < displayHeader.length; i++) {
        if (!headHeaderMap.has(displayHeader[i])) newColumnIndices.push(i);
    }

    const pkIndicesInHead = primaryKeyNames.map(name => head.header.indexOf(name));
    const pkIndicesInCurrent = primaryKeyNames.map(name => current.header.indexOf(name));
    const duplicatePkValues = findDuplicatePkValues(head.rows, pkIndicesInHead, current.rows, pkIndicesInCurrent);
    const {map: headMap, order: headOrder} = buildKeyedRows(head.rows, pkIndicesInHead, duplicatePkValues);
    const {map: currentMap, order: currentOrder} = buildKeyedRows(current.rows, pkIndicesInCurrent, duplicatePkValues);

    const leftSourceIndices: number[] = [];
    const rightSourceIndices: number[] = [];
    const leftEmptyRowIndices: number[] = [];
    const rightEmptyRowIndices: number[] = [];
    const leftDeletedRowIndices: number[] = [];
    const rightAddedRowIndices: number[] = [];
    const processedCurrentKeys = new Set<string>();
    const currentHeaderMap = GitDiffTracker.buildHeaderIndexMap(current.header);
    let hasModifiedRows = false;

    for (const headEntry of headOrder) {
        const currentEntry = currentMap.get(headEntry.key);
        const rowIdx = leftSourceIndices.length;
        if (currentEntry !== undefined) {
            if (!hasModifiedRows) {
                const left = GitDiffTracker.remapRow(head.rows[headEntry.rowIndex], headHeaderMap, displayHeader);
                const right = GitDiffTracker.remapRow(current.rows[currentEntry.rowIndex], currentHeaderMap, displayHeader);
                hasModifiedRows = left.some((value, index) => value !== right[index]);
            }
            processedCurrentKeys.add(headEntry.key);
            leftSourceIndices.push(headEntry.rowIndex);
            rightSourceIndices.push(currentEntry.rowIndex);
        } else {
            leftSourceIndices.push(headEntry.rowIndex);
            rightSourceIndices.push(-1);
            leftDeletedRowIndices.push(rowIdx);
            rightEmptyRowIndices.push(rowIdx);
        }
    }

    for (const currentEntry of currentOrder) {
        if (processedCurrentKeys.has(currentEntry.key)) continue;
        if (headMap.has(currentEntry.key)) continue;
        const rowIdx = leftSourceIndices.length;
        leftSourceIndices.push(-1);
        rightSourceIndices.push(currentEntry.rowIndex);
        leftEmptyRowIndices.push(rowIdx);
        rightAddedRowIndices.push(rowIdx);
    }

    return {
        mode: 'indexed',
        hasChanges: hasModifiedRows || leftDeletedRowIndices.length > 0 || rightAddedRowIndices.length > 0 || (leftSourceIndices.length > 0 && newColumnIndices.length > 0),
        displayHeader,
        newColumnIndices,
        leftRowSourceIndices: Int32Array.from(leftSourceIndices),
        rightRowSourceIndices: Int32Array.from(rightSourceIndices),
        leftEmptyRowIndices,
        rightEmptyRowIndices,
        leftDeletedRowIndices,
        rightAddedRowIndices,
        leftModifiedCells: [],
        rightModifiedCells: [],
    };
}

function estimateLineCount(text: string): number {
    if (text === '') return 0;
    let count = 1;
    for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) === 10) count++;
    }
    return count;
}

function buildDiffData(request: DiffBuildWorkerRequest): DiffBuildResult {
    const headLineCount = estimateLineCount(request.headCsv);
    const currentLineCount = estimateLineCount(request.currentCsv);
    if (headLineCount + currentLineCount > INDEXED_DIFF_ROW_THRESHOLD) {
        return buildIndexedDiffData(request);
    }
    return buildFullDiffData(request);
}

function filterExportCsv(text: string, settings: ExportValidationSettings, timeMs: number): {text: string; originalIndices: number[]} {
    const csv = new Csv();
    csv.load(text);
    const columns = resolveExportWindowColumns(csv.header, settings.beginColumnName.trim(), settings.endColumnName.trim());
    const originalIndices: number[] = [];
    csv.body = csv.body.filter((row, index) => {
        if (!isRowActiveAtExportTime(row, columns, timeMs)) return false;
        originalIndices.push(index);
        return true;
    });
    return {text: csv.toString(), originalIndices};
}

function buildExportFilteredDiffData(request: DiffBuildWorkerRequest, settings: ExportValidationSettings): DiffBuildResult {
    const time = parseTemporalValue(settings.dateTime);
    if (time.kind !== 'valid' || settings.beginColumnName.trim() === '' || settings.endColumnName.trim() === '') {
        throw new Error('出力フィルター時刻と開始・終了日時列を設定してください');
    }
    const left = filterExportCsv(request.headCsv, settings, time.ms);
    const right = filterExportCsv(request.currentCsv, settings, time.ms);
    const result = buildDiffData({...request, headCsv: left.text, currentCsv: right.text});
    // 表示用の行と変更履歴の参照を、絞り込み前のCSVの行へ対応付ける。
    for (const [indices, originals] of [
        [result.leftOriginalRowIndices, left.originalIndices], [result.rightOriginalRowIndices, right.originalIndices],
        [result.leftRowSourceIndices, left.originalIndices], [result.rightRowSourceIndices, right.originalIndices],
    ] as const) {
        if (indices === undefined) continue;
        for (let index = 0; index < indices.length; index++) {
            if (indices[index] >= 0) indices[index] = originals[indices[index]];
        }
    }
    return result;
}

self.onmessage = (event: MessageEvent<DiffBuildWorkerRequest>) => {
    const request = event.data;
    try {
        const data = request.exportFilter === undefined ? buildDiffData(request) : buildExportFilteredDiffData(request, request.exportFilter);
        const response: DiffBuildWorkerResponse = {
            requestId: request.requestId,
            success: true,
            data,
        };
        const transfers: Transferable[] = [];
        if (data.leftRowSourceIndices !== undefined) transfers.push(data.leftRowSourceIndices.buffer as Transferable);
        if (data.rightRowSourceIndices !== undefined) transfers.push(data.rightRowSourceIndices.buffer as Transferable);
        if (data.leftOriginalRowIndices !== undefined) transfers.push(data.leftOriginalRowIndices.buffer as Transferable);
        if (data.rightOriginalRowIndices !== undefined) transfers.push(data.rightOriginalRowIndices.buffer as Transferable);
        self.postMessage(response, {transfer: transfers});
    } catch (error: unknown) {
        const response: DiffBuildWorkerResponse = {
            requestId: request.requestId,
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
        self.postMessage(response);
    }
};
