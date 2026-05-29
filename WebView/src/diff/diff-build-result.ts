export interface DiffBuildResult {
    displayHeader: string[];
    newColumnIndices: number[];
    leftRows: string[][];
    rightRows: string[][];
    leftEmptyRowIndices: number[];
    rightEmptyRowIndices: number[];
    leftDeletedRowIndices: number[];
    rightAddedRowIndices: number[];
    leftModifiedCells: Array<{ row: number; col: number }>;
    rightModifiedCells: Array<{ row: number; col: number }>;
    headRowValuesPerDomRow: Array<string[] | null>;
}

export interface DiffBuildWorkerRequest {
    requestId: number;
    schemaJson: string;
    headCsv: string;
    currentCsv: string;
}

export type DiffBuildWorkerResponse =
    | { requestId: number; success: true; data: DiffBuildResult }
    | { requestId: number; success: false; error: string };
