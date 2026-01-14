import { Command, CellChangeCommand, CellChange } from "./command";
import { CellRange } from "./selection";

/**
 * 履歴に記録するエントリ
 */
export interface HistoryEntry {
    command: Command;
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
 * Undo/Redo履歴を管理するクラス（Commandパターン対応）
 */
export class History {
    private undoStack: HistoryEntry[];
    private redoStack: HistoryEntry[];
    private readonly maxHistorySize: number;
    private tableElement: HTMLElement;

    constructor(tableElement: HTMLElement, maxHistorySize: number) {
        this.undoStack = [];
        this.redoStack = [];
        this.maxHistorySize = maxHistorySize;
        this.tableElement = tableElement;
    }

    /**
     * コマンドを履歴に追加して実行する
     */
    executeCommand(command: Command, range: CellRange, copyRange: CellRange): void {
        command.execute();

        this.undoStack.push({
            command,
            range,
            copyRange
        });

        // 最大履歴数を超えた場合、古いものを削除
        if (this.undoStack.length > this.maxHistorySize) {
            this.undoStack.shift();
        }

        // 新しいアクションが追加されたらRedoスタックをクリア
        this.redoStack = [];
    }

    /**
     * コマンドを履歴に追加（既に実行済みの場合）
     */
    pushCommand(command: Command, range: CellRange, copyRange: CellRange): void {
        this.undoStack.push({
            command,
            range,
            copyRange
        });

        // 最大履歴数を超えた場合、古いものを削除
        if (this.undoStack.length > this.maxHistorySize) {
            this.undoStack.shift();
        }

        // 新しいアクションが追加されたらRedoスタックをクリア
        this.redoStack = [];
    }

    /**
     * 後方互換性: 旧形式のアクションを履歴に追加
     */
    push(action: { changes: CellChange[]; range: CellRange; copyRange: CellRange }): void {
        // 実際に値が変わっているchangeのみをフィルタ
        const meaningfulChanges = action.changes.filter(
            change => change.oldValue !== change.newValue
        );

        // 変更がない場合は追加しない
        if (meaningfulChanges.length === 0) return;

        const command = new CellChangeCommand(
            this.tableElement,
            meaningfulChanges,
            action.range,
            action.copyRange
        );

        // 既に実行済みなのでpushCommandを使用
        this.pushCommand(command, action.range, action.copyRange);
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
        const entry = this.undoStack.pop();
        if (!entry) return undefined;

        entry.command.undo();

        // Redoスタックに追加
        this.redoStack.push(entry);

        return { range: entry.range, copyRange: entry.copyRange };
    }

    /**
     * Redo操作
     * @returns 変更されたセル範囲。Redoできなかった場合はundefined
     */
    redo(): HistoryResult | undefined {
        const entry = this.redoStack.pop();
        if (!entry) return undefined;

        entry.command.redo();

        // Undoスタックに追加
        this.undoStack.push(entry);

        // Redo時はCellChangeCommandの場合、changesを含めた範囲を計算
        let redoRange = { ...entry.range };
        if (entry.command instanceof CellChangeCommand) {
            const changes = entry.command.getChanges();
            for (const change of changes) {
                redoRange.startRow = Math.min(redoRange.startRow, change.row);
                redoRange.endRow = Math.max(redoRange.endRow, change.row);
                redoRange.startColumn = Math.min(redoRange.startColumn, change.column);
                redoRange.endColumn = Math.max(redoRange.endColumn, change.column);
            }
        }

        return { range: redoRange, copyRange: entry.copyRange };
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
     * テーブル要素を取得
     */
    getTableElement(): HTMLElement {
        return this.tableElement;
    }
}
