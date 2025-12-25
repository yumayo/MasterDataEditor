/**
 * セルの変更を表すアクション
 */
export interface CellChange {
    row: number;
    column: number;
    oldValue: string;
    newValue: string;
}

/**
 * セル範囲
 */
export interface CellRange {
    startRow: number;
    startColumn: number;
    endRow: number;
    endColumn: number;
}

/**
 * 履歴に記録するアクション（複数セルの変更をまとめて1つのアクションとする）
 */
export interface HistoryAction {
    changes: CellChange[];
    /**
     * 操作前の選択範囲
     * Undo時に復元する。Redo時はchangesを含めた範囲を計算して使用する。
     */
    range: CellRange;
    /**
     * コピー範囲（点線表示用）
     * アクション実行前のコピー範囲を保存し、Undo時に復元する。
     */
    copyRange: CellRange;
}

/**
 * Undo/Redo操作の結果
 */
export interface HistoryResult {
    range: CellRange;
    copyRange: CellRange;
}

/**
 * Undo/Redo履歴を管理するクラス
 */
export class History {
    private undoStack: HistoryAction[];
    private redoStack: HistoryAction[];
    private readonly maxHistorySize: number;
    private tableElement: HTMLElement;

    constructor(tableElement: HTMLElement, maxHistorySize: number) {
        this.undoStack = [];
        this.redoStack = [];
        this.maxHistorySize = maxHistorySize;
        this.tableElement = tableElement;
    }

    /**
     * アクションを履歴に追加
     */
    push(action: HistoryAction): void {
        // 実際に値が変わっているchangeのみをフィルタ
        const meaningfulChanges = action.changes.filter(
            change => change.oldValue !== change.newValue
        );

        // 変更がない場合は追加しない
        if (meaningfulChanges.length === 0) return;

        this.undoStack.push({
            changes: meaningfulChanges,
            range: action.range,
            copyRange: action.copyRange
        });

        // 最大履歴数を超えた場合、古いものを削除
        if (this.undoStack.length > this.maxHistorySize) {
            this.undoStack.shift();
        }

        // 新しいアクションが追加されたらRedoスタックをクリア
        this.redoStack = [];
    }

    /**
     * 単一セルの変更を履歴に追加
     */
    pushSingleChange(row: number, column: number, oldValue: string, newValue: string, copyRange: CellRange): void {
        this.push({
            changes: [{ row, column, oldValue, newValue }],
            range: { startRow: row, startColumn: column, endRow: row, endColumn: column },
            copyRange: copyRange
        });
    }

    /**
     * Undo操作
     * @returns 変更されたセル範囲とコピー範囲。Undoできなかった場合はundefined
     */
    undo(): HistoryResult | undefined {
        const action = this.undoStack.pop();
        if (!action) return undefined;

        // 変更を逆順で元に戻す
        for (let i = action.changes.length - 1; i >= 0; i--) {
            const change = action.changes[i];
            this.setCellValue(change.row, change.column, change.oldValue);
        }

        // Redoスタックに追加
        this.redoStack.push(action);

        return { range: action.range, copyRange: action.copyRange };
    }

    /**
     * Redo操作
     * @returns 変更されたセル範囲。Redoできなかった場合はundefined
     */
    redo(): HistoryResult | undefined {
        const action = this.redoStack.pop();
        if (!action) return undefined;

        // 変更を再適用
        for (const change of action.changes) {
            this.setCellValue(change.row, change.column, change.newValue);
        }

        // Undoスタックに追加
        this.undoStack.push(action);

        // Redo時はchangesを含めた範囲を計算（操作後の選択範囲を復元）
        const redoRange = { ...action.range };
        for (const change of action.changes) {
            redoRange.startRow = Math.min(redoRange.startRow, change.row);
            redoRange.endRow = Math.max(redoRange.endRow, change.row);
            redoRange.startColumn = Math.min(redoRange.startColumn, change.column);
            redoRange.endColumn = Math.max(redoRange.endColumn, change.column);
        }

        // Redo時もコピー範囲を復元
        return { range: redoRange, copyRange: action.copyRange };
    }

    /**
     * Undo可能かどうか
     */
    canUndo(): boolean {
        return this.undoStack.length > 0;
    }

    /**
     * Redo可能かどうか
     */
    canRedo(): boolean {
        return this.redoStack.length > 0;
    }

    /**
     * 履歴をクリア
     */
    clear(): void {
        this.undoStack = [];
        this.redoStack = [];
    }

    /**
     * セルの値を設定
     */
    private setCellValue(row: number, column: number, value: string): void {
        const rowElement = this.tableElement.children[row] as HTMLElement;
        if (!rowElement) return;

        const cell = rowElement.children[column] as HTMLElement;
        if (!cell) return;

        cell.textContent = value;
    }
}
