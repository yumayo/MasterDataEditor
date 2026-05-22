import type {EditorTable} from "./editor-table";
import type {CellRange} from "./selection";

/**
 * EditorTable の選択範囲・フォーカスセルの視覚状態を担当する。
 *
 * Selection 本体の状態管理とは分け、DOM クラスの付け外しだけをここへ集約する。
 */
export class EditorTableSelectionView {
    [key: string]: any;
    private lastFocusedRow: number;
    private lastFocusedCol: number;
    private lastSelectionCells: { row: number; col: number; classes: string[] }[];

    constructor(table: EditorTable) {
        this.lastFocusedRow = -1;
        this.lastFocusedCol = -1;
        this.lastSelectionCells = [];
        return new Proxy(this, {
            get: (target, property, receiver) => {
                if (property in target) return Reflect.get(target, property, receiver);
                return Reflect.get(table as any, property);
            },
            set: (target, property, value, receiver) => {
                if (property in target) return Reflect.set(target, property, value, receiver);
                (table as any)[property] = value;
                return true;
            },
        });
    }

    /**
     * 指定セルに editor-table-cell-focused クラスを付与し、前のフォーカスセルから除去する。
     * Selection から呼ばれる（DOM要素の流出防止のため Selection 側でクラスを操作しない）。
     *
     * @param row DOM行インデックス（列ヘッダー行を含む: データ行1行目 = 1）
     * @param col DOM列インデックス（行ヘッダーを含む: データ列1列目 = 1）
     */
    markFocusedCell(row: number, col: number): void {
        // 前のフォーカスセルからクラスを除去する
        if (this.lastFocusedRow !== -1) {
            const prev = this.getCellOrNull(this.lastFocusedRow, this.lastFocusedCol);
            if (prev !== null) prev.classList.remove('editor-table-cell-focused');
        }
        const cell = this.getCellOrNull(row, col);
        if (cell !== null) {
            cell.classList.add('editor-table-cell-focused');
            this.lastFocusedRow = row;
            this.lastFocusedCol = col;
        }
    }

    /** フォーカスクラスを除去する（タブ切り替えや初期化時に呼ぶ）。 */
    clearFocusedCell(): void {
        if (this.lastFocusedRow !== -1) {
            const prev = this.getCellOrNull(this.lastFocusedRow, this.lastFocusedCol);
            if (prev !== null) prev.classList.remove('editor-table-cell-focused');
        }
        this.lastFocusedRow = -1;
        this.lastFocusedCol = -1;
    }

    /**
     * 選択範囲のセルにクラスを付与する（Selection から呼ばれる）。
     * 前回付与したクラスを除去してから新しいクラスを付与する。
     * フォーカスセルには sel-bg を付与しない。
     *
     * @param range 正規化済みの選択範囲（startRow <= endRow, startColumn <= endColumn）
     * @param focusRow フォーカスセルのDOM行インデックス
     * @param focusCol フォーカスセルのDOM列インデックス
     */
    applySelectionClasses(range: CellRange, focusRow: number, focusCol: number): void {
        // 前回のクラスを除去する
        for (const entry of this.lastSelectionCells) {
            const cell = this.getCellOrNull(entry.row, entry.col);
            if (cell !== null) cell.classList.remove(...entry.classes);
        }
        this.lastSelectionCells = [];

        const { startRow, startColumn, endRow, endColumn } = range;

        // 選択範囲内のセルにクラスを付与する
        for (let row = startRow; row <= endRow; row++) {
            for (let col = startColumn; col <= endColumn; col++) {
                const cell = this.getCellOrNull(row, col);
                if (cell === null) continue;
                const classes: string[] = [];
                // フォーカスセル以外の選択状態をクラスとして保持する
                if (row !== focusRow || col !== focusCol) classes.push('sel-bg');
                if (row === startRow) classes.push('sel-top');
                if (row === endRow) classes.push('sel-bottom');
                if (col === startColumn) classes.push('sel-left');
                if (col === endColumn) classes.push('sel-right');
                if (classes.length > 0) {
                    cell.classList.add(...classes);
                    this.lastSelectionCells.push({ row, col, classes });
                }
            }
        }
    }

    /** 選択クラスを全セルから除去する（Selection.hideRenderer() から呼ばれる）。 */
    clearSelectionClasses(): void {
        for (const entry of this.lastSelectionCells) {
            const cell = this.getCellOrNull(entry.row, entry.col);
            if (cell !== null) cell.classList.remove(...entry.classes);
        }
        this.lastSelectionCells = [];
    }

    /** ヘッダーの選択状態を更新する */
    updateHeaderSelection(startRow: number, startColumn: number, endRow: number, endColumn: number): void {
        this.applyHeaderSelection(startRow, startColumn, endRow, endColumn, true);
    }

    /**
     * 仮想スクロールの純スクロール時に、静的 detached layer の全同期を避けつつ
     * source DOM 側の行・列ヘッダー選択状態だけを更新する。
     */
    updateHeaderSelectionForVirtualScroll(startRow: number, startColumn: number, endRow: number, endColumn: number): void {
        this.applyHeaderSelection(startRow, startColumn, endRow, endColumn, false);
    }

    private applyHeaderSelection(startRow: number, startColumn: number, endRow: number, endColumn: number, syncDetachedLayers: boolean): void {
        const columnHeaderRow = this.gridElement.children[0] as HTMLElement;
        // すべての列ヘッダーから選択状態を解除
        for (let i = 1; i < columnHeaderRow.children.length; i++) {
            const headerCell = columnHeaderRow.children[i] as HTMLElement;
            headerCell.classList.remove('selected', 'selected-column-end');
        }
        // すべての行ヘッダーから選択状態を解除する。
        // DOM子要素を直接走査する（仮想スクロール時は論理インデックスとDOMインデックスが一致しないため）。
        // bottomSpacer は行ヘッダーを持たないためデータ行終了位置まで走査する。
        const dataRowEnd = this.getDataRowEndChildIndex();
        for (let i = 1; i < dataRowEnd; i++) {
            if (this.virtualScroll.isSpacerIndex(i)) continue;
            const row = this.gridElement.children[i] as HTMLElement;
            const rowHeader = row.querySelector('.editor-table-row-header') as HTMLElement | null;
            if (rowHeader) rowHeader.classList.remove('selected', 'selected-row-end');
        }
        // 選択範囲に含まれる列ヘッダーに選択状態を追加
        for (let col = startColumn; col <= endColumn; col++) {
            const headerCell = columnHeaderRow.children[col] as HTMLElement;
            if (headerCell) {
                headerCell.classList.add('selected');
                if (col === endColumn) headerCell.classList.add('selected-column-end');
            }
        }
        // 選択範囲に含まれる行ヘッダーに選択状態を追加
        for (let row = startRow; row <= endRow; row++) {
            const rowElement = this.getRowElement(row);
            if (rowElement) {
                const rowHeader = rowElement.querySelector('.editor-table-row-header') as HTMLElement | null;
                if (rowHeader) {
                    rowHeader.classList.add('selected');
                    if (row === endRow) rowHeader.classList.add('selected-row-end');
                }
            }
        }
        if (!syncDetachedLayers) return;
        if (this.usesInternalMainViewport) {
            this.syncQuadrantStaticCellStates();
            return;
        }
        this.syncDetachedLegacyStaticCellStates();
        this.syncDetachedViewportRowHeaderStates();
    }
}
