export interface DiffBuildResult {
    mode: 'full' | 'indexed';
    displayHeader: string[];
    newColumnIndices: number[];
    leftRows?: string[][];
    rightRows?: string[][];
    leftRowSourceIndices?: Int32Array;
    rightRowSourceIndices?: Int32Array;
    /** 差分表示行から元CSVのデータ行への対応（パディングは -1）。 */
    leftOriginalRowIndices?: Int32Array;
    rightOriginalRowIndices?: Int32Array;
    leftEmptyRowIndices: number[];
    rightEmptyRowIndices: number[];
    leftDeletedRowIndices: number[];
    rightAddedRowIndices: number[];
    leftModifiedCells: Array<{ row: number; col: number }>;
    rightModifiedCells: Array<{ row: number; col: number }>;
    headRowValuesPerDomRow?: Array<string[] | null>;
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
