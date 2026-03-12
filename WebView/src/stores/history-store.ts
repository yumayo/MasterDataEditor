import {createStore} from 'zustand/vanilla';
import {immer} from 'zustand/middleware/immer';
import {enableMapSet} from 'immer';
import {useTableStore} from './table-store';
import {useTabStore} from './tab-store';
import type {CellRange} from '../types/selection-types';

// ImmerのMap/Setサポートを有効化する（冪等）
enableMapSet();

/** Undo/Redo 可能なコマンドのインターフェース */
export interface Command {
    execute(): void;
    undo(): void;
    redo(): void;
    readonly description: string;
}

/** セルの変更情報 */
export interface CellChange {
    tableName: string;
    /** ストア行インデックス（0始まり） */
    rowIndex: number;
    /** 列インデックス（0始まり） */
    colIndex: number;
    oldValue: string;
    newValue: string;
}

/** 履歴エントリ */
interface HistoryEntry {
    command: Command;
    /** 操作前の選択範囲（Undo時に復元） */
    range: CellRange;
    /** 操作前のコピー範囲（Undo時に復元） */
    copyRange: CellRange;
}

/** savedIndex の特殊値: 初期状態（未編集） */
const SAVED_INDEX_INITIAL = -1;
/** savedIndex の特殊値: 保存時点が履歴から削除された（常に dirty） */
const SAVED_INDEX_LOST = -2;

/** 最大履歴サイズ */
const MAX_HISTORY_SIZE = 100;

/**
 * セル値変更コマンド
 *
 * execute/redo: changes を順方向に適用（oldValue → newValue）
 * undo: changes を逆順に逆方向適用（newValue → oldValue）
 */
export class CellChangeCommand implements Command {
    constructor(private readonly changes: CellChange[]) {}

    execute(): void {
        for (const c of this.changes) {
            useTableStore.getState().updateCellValueByRowIndex(c.tableName, c.rowIndex, c.colIndex, c.newValue);
        }
    }

    undo(): void {
        // 逆順で元に戻す（複数セル変更の整合性のため）
        for (let i = this.changes.length - 1; i >= 0; i--) {
            const c = this.changes[i];
            useTableStore.getState().updateCellValueByRowIndex(c.tableName, c.rowIndex, c.colIndex, c.oldValue);
        }
    }

    redo(): void {
        this.execute();
    }

    get description(): string {
        return `CellChange: ${this.changes.length} cells`;
    }
}

/**
 * 行挿入コマンド
 *
 * execute/redo: tableName の rowIndex 位置に空行を挿入する
 * undo: 挿入した行を削除する
 */
export class InsertRowCommand implements Command {
    constructor(
        private readonly tableName: string,
        private readonly rowIndex: number,
        private readonly columnCount: number
    ) {}

    execute(): void {
        useTableStore.getState().insertRowAt(this.tableName, this.rowIndex, new Array(this.columnCount).fill(''));
    }

    undo(): void {
        useTableStore.getState().removeRow(this.tableName, this.rowIndex);
    }

    redo(): void { this.execute(); }

    get description(): string { return `InsertRow at ${this.rowIndex}`; }
}

/**
 * 行削除コマンド
 *
 * execute/redo: tableName の rowIndex 行を削除する（削除前データを保存してundoで復元）
 * undo: 削除した行を元の位置に挿入する
 */
export class DeleteRowCommand implements Command {
    private deletedValues: string[] = [];

    constructor(
        private readonly tableName: string,
        private readonly rowIndex: number
    ) {}

    execute(): void {
        const rows = useTableStore.getState().getRows(this.tableName);
        if (rows !== false) this.deletedValues = [...rows[this.rowIndex]];
        useTableStore.getState().removeRow(this.tableName, this.rowIndex);
    }

    undo(): void {
        useTableStore.getState().insertRowAt(this.tableName, this.rowIndex, this.deletedValues);
    }

    redo(): void { this.execute(); }

    get description(): string { return `DeleteRow at ${this.rowIndex}`; }
}

/**
 * 列挿入コマンド
 *
 * execute/redo: tableName の colIndex 位置に空列を挿入する
 * undo: 挿入した列を削除する
 */
export class InsertColumnCommand implements Command {
    constructor(
        private readonly tableName: string,
        private readonly colIndex: number
    ) {}

    execute(): void {
        useTableStore.getState().insertColumnAt(this.tableName, this.colIndex, '');
    }

    undo(): void {
        useTableStore.getState().removeColumn(this.tableName, this.colIndex);
    }

    redo(): void { this.execute(); }

    get description(): string { return `InsertColumn at ${this.colIndex}`; }
}

/**
 * 列削除コマンド
 *
 * execute/redo: tableName の colIndex 列を削除する（削除前データを保存してundoで復元）
 * undo: 削除した列を元の位置に挿入し、全行のセル値を復元する
 */
export class DeleteColumnCommand implements Command {
    private deletedHeaderValue: string = '';
    private deletedCellValues: string[] = [];

    constructor(
        private readonly tableName: string,
        private readonly colIndex: number
    ) {}

    execute(): void {
        const state = useTableStore.getState();
        const header = state.getHeader(this.tableName);
        const rows = state.getRows(this.tableName);
        if (header !== false) this.deletedHeaderValue = header[this.colIndex];
        if (rows !== false) this.deletedCellValues = rows.map(row => row[this.colIndex]);
        state.removeColumn(this.tableName, this.colIndex);
    }

    undo(): void {
        const state = useTableStore.getState();
        state.insertColumnAt(this.tableName, this.colIndex, this.deletedHeaderValue);
        const rows = state.getRows(this.tableName);
        if (rows !== false) {
            for (let i = 0; i < this.deletedCellValues.length && i < rows.length; i++) {
                state.updateCellValueByRowIndex(this.tableName, i, this.colIndex, this.deletedCellValues[i]);
            }
        }
    }

    redo(): void { this.execute(); }

    get description(): string { return `DeleteColumn at ${this.colIndex}`; }
}

/**
 * バッファ空行をストアに昇格するコマンド
 *
 * バッファ行（ストア行数を超えるDOM行）に初めてデータが入力されたとき、
 * ストアの末尾に空行を追加してバッファ行をストア行に昇格する。
 * targetRowIndex まで間の行も含めて空行を追加する（飛び番入力に対応）。
 */
export class PromoteBufferRowCommand implements Command {
    /** 昇格前のストア行数（undo時に何行削除するか決める基準） */
    private readonly storeRowCountBefore: number;

    constructor(
        private readonly tableName: string,
        /** バッファ行のインデックス（0始まり、ヘッダー行を除くDOM行インデックス） */
        private readonly targetRowIndex: number,
        private readonly columnCount: number
    ) {
        const rows = useTableStore.getState().getRows(tableName);
        this.storeRowCountBefore = rows === false ? 0 : rows.length;
    }

    execute(): void {
        // targetRowIndex まで（間の行も含めて）ストア末尾に空行を追加する
        const rows = useTableStore.getState().getRows(this.tableName);
        const currentLength = rows === false ? 0 : rows.length;
        for (let i = currentLength; i <= this.targetRowIndex; i++) {
            useTableStore.getState().appendRow(this.tableName, new Array(this.columnCount).fill(''));
        }
    }

    undo(): void {
        // storeRowCountBefore まで末尾から逆順で行を削除する
        const rows = useTableStore.getState().getRows(this.tableName);
        if (rows === false) return;
        for (let i = rows.length - 1; i >= this.storeRowCountBefore; i--) {
            useTableStore.getState().removeRow(this.tableName, i);
        }
    }

    redo(): void { this.execute(); }
    get description(): string { return `PromoteBufferRow at ${this.targetRowIndex}`; }
}

/**
 * 複数コマンドを1つのUndoエントリとして実行するバッチコマンド
 *
 * execute/redo: commands を順方向に実行する
 * undo: commands を逆順に Undo する
 */
export class BatchCommand implements Command {
    constructor(
        private readonly commands: Command[],
        readonly description: string
    ) {}

    execute(): void {
        for (const cmd of this.commands) cmd.execute();
    }

    undo(): void {
        for (let i = this.commands.length - 1; i >= 0; i--) this.commands[i].undo();
    }

    redo(): void { this.execute(); }
}

interface HistoryStoreState {
    /** テーブル名→履歴スタック */
    histories: Map<string, HistoryEntry[]>;
    /** テーブル名→現在のインデックス（エントリなし or Undo済みで -1 になりうる） */
    currentIndices: Map<string, number>;
    /** テーブル名→保存時点インデックス */
    savedIndices: Map<string, number>;

    // === アクション ===
    /** テーブルの履歴を初期化する */
    initHistory(tableName: string): void;
    /** テーブルの履歴を削除する */
    removeHistory(tableName: string): void;
    /**
     * コマンドを実行して履歴に追加する。
     * oldValue === newValue の変更のみの場合は履歴に追加しない。
     */
    executeCommand(tableName: string, command: Command, range: CellRange, copyRange: CellRange): void;
    /**
     * 既に実行済みのコマンドを履歴に追加する（pushCommand相当）。
     * oldValue === newValue の変更のみの場合は履歴に追加しない。
     */
    pushCommand(tableName: string, command: Command, range: CellRange, copyRange: CellRange): void;
    /** Undo（戻り値: 復元すべき range/copyRange。Undo できない場合は null） */
    undo(tableName: string): {range: CellRange; copyRange: CellRange} | null;
    /** Redo（戻り値: 復元すべき range/copyRange。Redo できない場合は null） */
    redo(tableName: string): {range: CellRange; copyRange: CellRange} | null;
    /** Undo 可能か */
    canUndo(tableName: string): boolean;
    /** Redo 可能か */
    canRedo(tableName: string): boolean;
    /** 保存済みとしてマークする */
    markSaved(tableName: string): void;
    /** Dirty 判定 */
    isDirty(tableName: string): boolean;
    /** テスト用リセット */
    _reset(): void;
}

/**
 * Undo/Redo 履歴を管理する Zustand ストア（vanilla）
 *
 * Vanilla 側の History クラスに対応するストア。
 * テーブルごとに独立した履歴スタックを持ち、Command パターンで変更を管理する。
 */
export const useHistoryStore = createStore<HistoryStoreState>()(
    immer((set, get) => ({
        histories: new Map(),
        currentIndices: new Map(),
        savedIndices: new Map(),

        initHistory(tableName) {
            set(draft => {
                // 既に存在する場合はリセットしない（冪等性のため）
                if (draft.histories.has(tableName)) return;
                draft.histories.set(tableName, []);
                draft.currentIndices.set(tableName, -1);
                draft.savedIndices.set(tableName, SAVED_INDEX_INITIAL);
            });
        },

        removeHistory(tableName) {
            set(draft => {
                draft.histories.delete(tableName);
                draft.currentIndices.delete(tableName);
                draft.savedIndices.delete(tableName);
            });
        },

        executeCommand(tableName, command, range, copyRange) {
            // 実行してから履歴に追加する
            command.execute();
            get().pushCommand(tableName, command, range, copyRange);
        },

        pushCommand(tableName, command, range, copyRange) {
            set(draft => {
                const history = draft.histories.get(tableName);
                if (!history) return;

                const currentIndex = draft.currentIndices.get(tableName) ?? -1;
                const savedIndex = draft.savedIndices.get(tableName) ?? SAVED_INDEX_INITIAL;

                // 現在位置より後の履歴を削除
                // savedIndex がこの削除範囲にある場合は無効化する
                if (savedIndex > currentIndex) {
                    draft.savedIndices.set(tableName, SAVED_INDEX_LOST);
                }
                history.splice(currentIndex + 1);

                // 新しいエントリを追加する
                history.push({command, range, copyRange});
                draft.currentIndices.set(tableName, history.length - 1);

                // 最大履歴サイズを超えた場合は先頭を削除する
                if (history.length > MAX_HISTORY_SIZE) {
                    history.shift();
                    const newCurrent = (draft.currentIndices.get(tableName) ?? 0) - 1;
                    draft.currentIndices.set(tableName, newCurrent);

                    // savedIndex も調整する（0未満になった場合は SAVED_INDEX_LOST）
                    const currentSaved = draft.savedIndices.get(tableName) ?? SAVED_INDEX_INITIAL;
                    if (currentSaved >= 0) {
                        const adjustedSaved = currentSaved - 1;
                        draft.savedIndices.set(
                            tableName,
                            adjustedSaved < 0 ? SAVED_INDEX_LOST : adjustedSaved
                        );
                    }
                }
            });

            // Dirty 表示を更新する
            useTabStore.getState().setTabDirty(tableName, get().isDirty(tableName));
        },

        undo(tableName) {
            const state = get();
            if (!state.canUndo(tableName)) return null;

            const history = state.histories.get(tableName);
            if (!history) return null;
            const currentIndex = state.currentIndices.get(tableName) ?? -1;
            const entry = history[currentIndex];

            entry.command.undo();

            set(draft => {
                draft.currentIndices.set(tableName, currentIndex - 1);
            });

            // Dirty 表示を更新する
            useTabStore.getState().setTabDirty(tableName, get().isDirty(tableName));

            return {range: entry.range, copyRange: entry.copyRange};
        },

        redo(tableName) {
            const state = get();
            if (!state.canRedo(tableName)) return null;

            const history = state.histories.get(tableName);
            if (!history) return null;
            const currentIndex = state.currentIndices.get(tableName) ?? -1;
            const nextIndex = currentIndex + 1;
            const entry = history[nextIndex];

            entry.command.redo();

            set(draft => {
                draft.currentIndices.set(tableName, nextIndex);
            });

            // Dirty 表示を更新する
            useTabStore.getState().setTabDirty(tableName, get().isDirty(tableName));

            return {range: entry.range, copyRange: entry.copyRange};
        },

        canUndo(tableName) {
            const currentIndex = get().currentIndices.get(tableName) ?? -1;
            return currentIndex >= 0;
        },

        canRedo(tableName) {
            const history = get().histories.get(tableName);
            if (!history) return false;
            const currentIndex = get().currentIndices.get(tableName) ?? -1;
            return currentIndex < history.length - 1;
        },

        markSaved(tableName) {
            set(draft => {
                const currentIndex = draft.currentIndices.get(tableName) ?? -1;
                draft.savedIndices.set(tableName, currentIndex);
            });
            useTabStore.getState().setTabDirty(tableName, false);
        },

        isDirty(tableName) {
            const state = get();
            const currentIndex = state.currentIndices.get(tableName) ?? -1;
            const savedIndex = state.savedIndices.get(tableName) ?? SAVED_INDEX_INITIAL;
            // SAVED_INDEX_LOST は常に dirty
            if (savedIndex === SAVED_INDEX_LOST) return true;
            // SAVED_INDEX_INITIAL（未編集）かつ currentIndex が -1（何も実行していない）なら clean
            return currentIndex !== savedIndex;
        },

        _reset() {
            set(draft => {
                draft.histories.clear();
                draft.currentIndices.clear();
                draft.savedIndices.clear();
            });
        },
    }))
);
