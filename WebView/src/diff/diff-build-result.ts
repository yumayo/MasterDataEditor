/** リビジョンごとの出力時刻を固定した比較条件。通常の出力検証設定とは分離する。 */
export interface BranchCompareExportFilter {
    leftDateTime: string;
    rightDateTime: string;
    beginColumnName: string;
    endColumnName: string;
}

export interface DiffBuildResult {
    hasChanges: boolean;
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
    /** コンテキスト表示で取り除いた行数と、その直後の表示行位置。末尾は表示行数。 */
    omittedRows?: Array<{beforeRow: number; count: number}>;
}

export interface DiffBuildWorkerRequest {
    requestId: number;
    schemaJson: string;
    headCsv: string;
    currentCsv: string;
    exportFilter?: BranchCompareExportFilter;
    contextLines?: number;
}

export type DiffBuildWorkerResponse =
    | { requestId: number; success: true; data: DiffBuildResult }
    | { requestId: number; success: false; error: string };
