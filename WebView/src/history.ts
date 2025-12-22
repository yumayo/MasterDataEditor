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
 * 履歴に記録するアクション（複数セルの変更をまとめて1つのアクションとする）
 */
export interface HistoryAction {
    changes: CellChange[];
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
        // 変更がない場合は追加しない
        if (action.changes.length === 0) return;

        // 実際に値が変わっているchangeのみをフィルタ
        const meaningfulChanges = action.changes.filter(
            change => change.oldValue !== change.newValue
        );

        if (meaningfulChanges.length === 0) return;

        this.undoStack.push({ changes: meaningfulChanges });

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
    pushSingleChange(row: number, column: number, oldValue: string, newValue: string): void {
        this.push({
            changes: [{ row, column, oldValue, newValue }]
        });
    }

    /**
     * Undo操作
     */
    undo(): boolean {
        const action = this.undoStack.pop();
        if (!action) return false;

        // 変更を逆順で元に戻す
        for (let i = action.changes.length - 1; i >= 0; i--) {
            const change = action.changes[i];
            this.setCellValue(change.row, change.column, change.oldValue);
        }

        // Redoスタックに追加
        this.redoStack.push(action);

        return true;
    }

    /**
     * Redo操作
     */
    redo(): boolean {
        const action = this.redoStack.pop();
        if (!action) return false;

        // 変更を再適用
        for (const change of action.changes) {
            this.setCellValue(change.row, change.column, change.newValue);
        }

        // Undoスタックに追加
        this.undoStack.push(action);

        return true;
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
