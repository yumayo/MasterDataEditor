import {buildDiffRows, buildMergedData, type DiffRow, type SchemaJson} from "./diff-rows";
import {Csv} from "../data/csv";
import {GitDiffTracker} from "./git-diff-tracker";
import type {DiffBuildResult, DiffBuildWorkerRequest, DiffBuildWorkerResponse} from "./diff-build-result";

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
    const {diffRows, displayHeader, newColumnIndices} = buildDiffRows(request.headCsv, request.currentCsv, primaryKeyNames);
    const columnCount = displayHeader.length;
    const merged = buildMergedData(diffRows, columnCount);
    return {
        mode: 'full',
        displayHeader,
        newColumnIndices: Array.from(newColumnIndices),
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

    for (const headEntry of headOrder) {
        const currentEntry = currentMap.get(headEntry.key);
        const rowIdx = leftSourceIndices.length;
        if (currentEntry !== undefined) {
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

self.onmessage = (event: MessageEvent<DiffBuildWorkerRequest>) => {
    const request = event.data;
    try {
        const data = buildDiffData(request);
        const response: DiffBuildWorkerResponse = {
            requestId: request.requestId,
            success: true,
            data,
        };
        const transfers: Transferable[] = [];
        if (data.leftRowSourceIndices !== undefined) transfers.push(data.leftRowSourceIndices.buffer as Transferable);
        if (data.rightRowSourceIndices !== undefined) transfers.push(data.rightRowSourceIndices.buffer as Transferable);
        self.postMessage(response, transfers);
    } catch (error: unknown) {
        const response: DiffBuildWorkerResponse = {
            requestId: request.requestId,
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
        self.postMessage(response);
    }
};
