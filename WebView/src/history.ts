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
    private history: HistoryEntry[];
    private currentIndex: number;
    private readonly maxHistorySize: number;
    private tableElement: HTMLElement;

    constructor(tableElement: HTMLElement, maxHistorySize: number) {
        this.history = [];
        this.currentIndex = -1;
        this.maxHistorySize = maxHistorySize;
        this.tableElement = tableElement;
    }

    /**
     * コマンドを履歴に追加して実行する
     */
    executeCommand(command: Command, range: CellRange, copyRange: CellRange): void {
        command.execute();

        // 現在の位置より後の履歴を削除
        this.history.splice(this.currentIndex + 1);

        // 新しいエントリを追加
        this.history.push({
            command,
            range,
            copyRange
        });

        // 現在のインデックスを更新
        this.currentIndex = this.history.length - 1;

        // 最大履歴数を超えた場合、古いものを削除
        if (this.history.length > this.maxHistorySize) {
            this.history.shift();
            this.currentIndex = this.currentIndex - 1;
        }
    }

    /**
     * コマンドを履歴に追加（既に実行済みの場合）
     */
    pushCommand(command: Command, range: CellRange, copyRange: CellRange): void {
        // 現在の位置より後の履歴を削除
        this.history.splice(this.currentIndex + 1);

        // 新しいエントリを追加
        this.history.push({
            command,
            range,
            copyRange
        });

        // 現在のインデックスを更新
        this.currentIndex = this.history.length - 1;

        // 最大履歴数を超えた場合、古いものを削除
        if (this.history.length > this.maxHistorySize) {
            this.history.shift();
            this.currentIndex = this.currentIndex - 1;
        }
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
        if (this.currentIndex < 0) return undefined;

        const entry = this.history[this.currentIndex];
        entry.command.undo();

        this.currentIndex = this.currentIndex - 1;

        return { range: entry.range, copyRange: entry.copyRange };
    }

    /**
     * Redo操作
     * @returns 変更されたセル範囲。Redoできなかった場合はundefined
     */
    redo(): HistoryResult | undefined {
        if (this.currentIndex >= this.history.length - 1) return undefined;

        this.currentIndex = this.currentIndex + 1;
        const entry = this.history[this.currentIndex];

        entry.command.redo();

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
        return this.currentIndex >= 0;
    }

    /**
     * Redo可能かどうか
     */
    canRedo(): boolean {
        return this.currentIndex < this.history.length - 1;
    }

    /**
     * 履歴をクリア
     */
    clear(): void {
        this.history = [];
        this.currentIndex = -1;
    }

    /**
     * テーブル要素を取得
     */
    getTableElement(): HTMLElement {
        return this.tableElement;
    }

    /**
     * 現在使用されている履歴のコピー範囲をクリアする（ESCキー対応）
     * 前後の履歴で同じコピー範囲を持つものも一緒にクリアする
     */
    clearCopyRange(): void {
        if (this.currentIndex < 0) return;

        const currentEntry = this.history[this.currentIndex];
        const targetCopyRange = currentEntry.copyRange;

        // 無効な範囲の場合は何もしない
        if (targetCopyRange.endRow < 0 || targetCopyRange.endColumn < 0) return;

        const clearedRange: CellRange = { startRow: 0, startColumn: 0, endRow: -1, endColumn: -1 };

        // 同じコピー範囲かどうかを判定する関数
        const isSameCopyRange = (range1: CellRange, range2: CellRange): boolean => {
            return range1.startRow === range2.startRow &&
                   range1.startColumn === range2.startColumn &&
                   range1.endRow === range2.endRow &&
                   range1.endColumn === range2.endColumn;
        };

        // 現在の位置から前方向に同じコピー範囲を探してクリア
        for (let i = this.currentIndex; i >= 0; i = i - 1) {
            if (isSameCopyRange(this.history[i].copyRange, targetCopyRange)) {
                this.history[i].copyRange = { ...clearedRange };
            } else {
                break;
            }
        }

        // 現在の位置から後方向に同じコピー範囲を探してクリア
        for (let i = this.currentIndex + 1; i < this.history.length; i = i + 1) {
            if (isSameCopyRange(this.history[i].copyRange, targetCopyRange)) {
                this.history[i].copyRange = { ...clearedRange };
            } else {
                break;
            }
        }
    }
}
