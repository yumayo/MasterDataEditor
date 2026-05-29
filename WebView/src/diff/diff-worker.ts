import {buildDiffRows, buildMergedData, type DiffRow, type SchemaJson} from "./diff-rows";
import type {DiffBuildResult, DiffBuildWorkerRequest, DiffBuildWorkerResponse} from "./diff-build-result";

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

function buildDiffData(request: DiffBuildWorkerRequest): DiffBuildResult {
    const schema = JSON.parse(request.schemaJson) as SchemaJson;
    const primaryKeyNames: readonly string[] = schema.primary_key;
    const {diffRows, displayHeader, newColumnIndices} = buildDiffRows(request.headCsv, request.currentCsv, primaryKeyNames);
    const columnCount = displayHeader.length;
    const merged = buildMergedData(diffRows, columnCount);
    return {
        displayHeader,
        newColumnIndices: Array.from(newColumnIndices),
        headRowValuesPerDomRow: buildHeadRowValuesPerDomRow(diffRows),
        ...merged,
    };
}

self.onmessage = (event: MessageEvent<DiffBuildWorkerRequest>) => {
    const request = event.data;
    try {
        const response: DiffBuildWorkerResponse = {
            requestId: request.requestId,
            success: true,
            data: buildDiffData(request),
        };
        self.postMessage(response);
    } catch (error: unknown) {
        const response: DiffBuildWorkerResponse = {
            requestId: request.requestId,
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
        self.postMessage(response);
    }
};
