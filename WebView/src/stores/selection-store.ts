import {createStore} from 'zustand/vanilla';
import {immer} from 'zustand/middleware/immer';
import type {CellPosition, CellRange} from '../types/selection-types';

/**
 * Selection状態のZustandストア定義
 *
 * 既存の selection.ts の Selection クラスが管理する状態と
 * 同等のデータを Zustand + Immer で管理する。
 * createStore（vanilla）を使用することで React 外部からも
 * useSelectionStore.getState() で操作可能にする。
 */
interface SelectionStoreState {
    // === 選択状態 ===
    /** 選択範囲（startRow/endRow は逆順になることがある — 正規化は getSelectionRange 相当の計算で行う） */
    range: CellRange;
    /** フォーカスセル位置（カーソル位置） */
    focus: CellPosition;
    /** ドラッグによる範囲選択中か */
    selecting: boolean;
    /** 列ヘッダードラッグによる列選択中か */
    selectingColumn: boolean;
    /** 行ヘッダードラッグによる行選択中か */
    selectingRow: boolean;

    // === コピー状態 ===
    /** コピー範囲（startRow >= 0 のとき有効、-1 は「コピーなし」のセンチネル値） */
    copyRange: CellRange;

    // === フィル操作状態 ===
    /** フィル操作中か */
    filling: boolean;
    /** フィル先のセル位置 */
    fillTarget: CellPosition;

    // === RelationsPanel通知制御 ===
    /** 最後に RelationsPanel へ通知したフォーカス行（重複通知防止用。-1 は「未通知」） */
    lastNotifiedRow: number;

    // === テーブル識別 ===
    /**
     * 選択範囲に紐づくテーブル名（どのEditorTableの選択か識別する）。
     * 空文字列 "" は「どのテーブルにも紐づいていない」ことを意味するセンチネル値。
     */
    activeTableName: string;

    // === 編集状態 ===
    /** セル編集モードかどうか */
    editing: boolean;
    /** 編集開始時のセル初期値（F2・ダブルクリック・文字キーで設定される） */
    editingInitialValue: string;
    /**
     * 編集開始前のストア上の値（Undo/Redo 用の oldValue として使用する）。
     * F2 キー・ダブルクリック時はフォーカスセルのストア値を保存する。
     * 文字キーで編集開始した場合も編集前の値（空文字になりうる）を保存する。
     */
    editingOldValue: string;

    // === アクション ===
    /** 選択範囲とフォーカスを一括更新する（個別更新による中間状態を防ぐ） */
    select(range: CellRange, focus: CellPosition): void;
    /** 選択範囲のみ更新する（フォーカスは変更しない） */
    setRange(range: CellRange): void;
    /** フォーカスのみ更新する（選択範囲は変更しない） */
    setFocus(focus: CellPosition): void;
    /** ドラッグ選択を開始する */
    startSelecting(): void;
    /** ドラッグ選択を終了する（selecting / selectingColumn / selectingRow を全てリセット） */
    stopSelecting(): void;
    /** 列ヘッダーによる列選択を開始する */
    startSelectingColumn(): void;
    /** 行ヘッダーによる行選択を開始する */
    startSelectingRow(): void;
    /** コピー範囲を設定する */
    setCopyRange(range: CellRange): void;
    /** コピー範囲をクリアする（startRow: -1 のセンチネル状態に戻す） */
    clearCopyRange(): void;
    /** フィル操作を開始する */
    startFilling(target: CellPosition): void;
    /** フィル操作を終了する */
    stopFilling(): void;
    /** フィル先セルを更新する（マウスムーブ時に呼ぶ） */
    setFillTarget(target: CellPosition): void;
    /** アクティブテーブルを切り替える */
    setActiveTable(tableName: string): void;
    /**
     * フォーカス行をチェックし lastNotifiedRow を更新する。
     * 変更があった場合（新しい行に移動した場合）true を返す。
     * RelationsPanel への重複通知防止のために使用する。
     */
    updateLastNotifiedRow(row: number): boolean;
    /** lastNotifiedRow を -1 にリセットし、次回の updateLastNotifiedRow で必ず true を返す状態にする */
    resetLastNotifiedRow(): void;
    /**
     * セル編集モードを開始する。
     * initialValue: F2 の場合は現在値、文字キーの場合はその文字。
     * oldValue: 編集開始前のストア上の値（Undo 時に元に戻す値）。
     */
    startEditing(initialValue: string, oldValue: string): void;
    /** セル編集モードを終了する */
    stopEditing(): void;
    /** テスト用: ストア全体を初期状態にリセットする */
    _reset(): void;
}

/** 初期選択範囲: A1セル（row=1, column=1） */
const INITIAL_RANGE: CellRange = {startRow: 1, startColumn: 1, endRow: 1, endColumn: 1};

/** 初期フォーカス: A1セル */
const INITIAL_FOCUS: CellPosition = {row: 1, column: 1};

/** コピーなしのセンチネル範囲: startRow = -1 */
const EMPTY_COPY_RANGE: CellRange = {startRow: -1, startColumn: -1, endRow: -1, endColumn: -1};

/** フィル先の初期位置 */
const INITIAL_FILL_TARGET: CellPosition = {row: 0, column: 0};

/**
 * Selection状態を管理するZustandストア（vanilla）
 *
 * table-store.ts と同じ createStore + immer パターンで実装する。
 * React コンポーネント内では `useStore(useSelectionStore, selector)` で購読し、
 * React 外部では `useSelectionStore.getState().select(...)` で直接操作する。
 */
export const useSelectionStore = createStore<SelectionStoreState>()(
    immer((set, get) => ({
        range: INITIAL_RANGE,
        focus: INITIAL_FOCUS,
        selecting: false,
        selectingColumn: false,
        selectingRow: false,
        copyRange: EMPTY_COPY_RANGE,
        filling: false,
        fillTarget: INITIAL_FILL_TARGET,
        lastNotifiedRow: -1,
        activeTableName: '',
        editing: false,
        editingInitialValue: '',
        editingOldValue: '',

        select(range, focus) {
            set(draft => {
                // range と focus を一括更新して中間状態（rangeだけ変わりfocusがまだ古い）を防ぐ
                draft.range = range;
                draft.focus = focus;
            });
        },

        setRange(range) {
            set(draft => {
                draft.range = range;
            });
        },

        setFocus(focus) {
            set(draft => {
                draft.focus = focus;
            });
        },

        startSelecting() {
            set(draft => {
                draft.selecting = true;
            });
        },

        stopSelecting() {
            set(draft => {
                draft.selecting = false;
                draft.selectingColumn = false;
                draft.selectingRow = false;
            });
        },

        startSelectingColumn() {
            set(draft => {
                draft.selecting = true;
                draft.selectingColumn = true;
                draft.selectingRow = false;
            });
        },

        startSelectingRow() {
            set(draft => {
                draft.selecting = true;
                draft.selectingColumn = false;
                draft.selectingRow = true;
            });
        },

        setCopyRange(range) {
            set(draft => {
                draft.copyRange = range;
            });
        },

        clearCopyRange() {
            set(draft => {
                // startRow = -1 をセンチネル値として「コピーなし」状態にする
                draft.copyRange = {startRow: -1, startColumn: -1, endRow: -1, endColumn: -1};
            });
        },

        startFilling(target) {
            set(draft => {
                draft.filling = true;
                draft.fillTarget = target;
            });
        },

        stopFilling() {
            set(draft => {
                draft.filling = false;
            });
        },

        setFillTarget(target) {
            set(draft => {
                draft.fillTarget = target;
            });
        },

        setActiveTable(tableName) {
            set(draft => {
                draft.activeTableName = tableName;
            });
        },

        updateLastNotifiedRow(row) {
            const current = get().lastNotifiedRow;
            if (current === row) return false;
            set(draft => {
                draft.lastNotifiedRow = row;
            });
            return true;
        },

        resetLastNotifiedRow() {
            set(draft => {
                draft.lastNotifiedRow = -1;
            });
        },

        startEditing(initialValue, oldValue) {
            set(draft => {
                draft.editing = true;
                draft.editingInitialValue = initialValue;
                // 編集開始前のストア値を保存する（Undo 用の oldValue として使用）
                draft.editingOldValue = oldValue;
            });
        },

        stopEditing() {
            set(draft => {
                draft.editing = false;
                draft.editingInitialValue = '';
                draft.editingOldValue = '';
            });
        },

        _reset() {
            set(draft => {
                draft.range = {startRow: 1, startColumn: 1, endRow: 1, endColumn: 1};
                draft.focus = {row: 1, column: 1};
                draft.selecting = false;
                draft.selectingColumn = false;
                draft.selectingRow = false;
                draft.copyRange = {startRow: -1, startColumn: -1, endRow: -1, endColumn: -1};
                draft.filling = false;
                draft.fillTarget = {row: 0, column: 0};
                draft.lastNotifiedRow = -1;
                draft.activeTableName = '';
                draft.editing = false;
                draft.editingInitialValue = '';
                draft.editingOldValue = '';
            });
        },
    }))
);
