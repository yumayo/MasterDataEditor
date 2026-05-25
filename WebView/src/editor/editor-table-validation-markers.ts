import {EditorTable} from "./editor-table";
import {ValidationPanel} from "../panels/validation-panel";
import {ValidationError} from "../validation/validation-engine";
import {ScrollbarMarkerTrack, MarkerEntry} from "../ui/scrollbar-marker-track";

const MAX_SCROLLBAR_MARKER_SCAN_ROWS = 100000;

/**
 * バリデーション適用とスクロールバーマーカー更新を担当する。
 *
 * EditorTable の Object.assign パターンに合わせ、Proxy で既存ファサードへフォールバックする。
 */
export class EditorTableValidationMarkers {
    [key: string]: any;

    constructor(table: EditorTable) {
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
     * ValidationPanel を接続する（Tab.createEditorTable 内から呼ばれる）。
     * セッター禁止のため connectXxx パターンで相互参照を構築する。
     */
    connectValidationPanel(panel: ValidationPanel): void {
        this.validationPanel = panel;
    }

    /**
     * ScrollbarMarkerTrack を接続する（Tab.createEditorTable 内から呼ばれる）。
     * ミニテーブルでは呼ばない（マーカートラックは左ペインの通常テーブル専用）。
     */
    connectScrollbarMarkerTrack(track: ScrollbarMarkerTrack): void {
        this.scrollbarMarkerTrack = track;
        if (this.isActive) this.reattachScrollbarMarkerTrack();
        // 接続前にデータが蓄積されている場合に即座にマーカーを描画する
        this.refreshScrollbarMarkers();
    }

    createScrollbarMarkerTrack(cssClass: string): ScrollbarMarkerTrack {
        const target = this.resolveScrollbarMarkerTarget();
        return new ScrollbarMarkerTrack(target.parentElement, target.scrollContainer, cssClass);
    }

    reattachScrollbarMarkerTrack(): void {
        if (this.scrollbarMarkerTrack === false) return;
        if (this.isMiniTable) return;
        const target = this.resolveScrollbarMarkerTarget();
        this.scrollbarMarkerTrack.reattach(target.parentElement, target.scrollContainer);
    }

    resolveScrollbarMarkerTarget(): { parentElement: HTMLElement; scrollContainer: HTMLElement } {
        if (this.usesInternalMainViewport) return {parentElement: this.bottomRightPane, scrollContainer: this.scrollContainer};
        const parentElement = this.scrollContainer.parentElement;
        if (parentElement === null) throw new Error(`[EditorTable.resolveScrollbarMarkerTarget] scrollContainer の親要素がありません: table=${this.tableName}`);
        return {parentElement, scrollContainer: this.scrollContainer};
    }


    // =========================================================================
    // バリデーション
    // =========================================================================

    /**
     * バリデーションを実行してパネルを更新する。
     *
     * 通常テーブル（ValidationPanel 接続済み）:
     *   validationPanel.runAndUpdate() で全テーブルのバリデーションを実行し、
     *   ValidationPanel 側が全 EditorTable に applyValidationErrors() を呼ぶ。
     *
     * ミニテーブル（ValidationPanel 接続済みだが openEditorTables 未登録）:
     *   通常ミニテーブル: PK重複のみ検出して自身のDOMに適用する。
     *   DiffTab右ペイン: PK重複 + 型不一致を検出して自身のDOMに適用する。
     *   runAndUpdate() は呼ばない（全テーブル再バリデーションのコストを避けるため）。
     *
     * ValidationPanel 未接続: 何もしない。
     */
    runValidation(): void {
        if (this.validationPanel === false) return;
        if (this.isMiniTable) {
            // DiffTab右ペインはPK重複 + 型不一致の全バリデーションを実行する。
            // 通常ミニテーブル（RelationsPanel配下）はPK重複のみで十分。
            const errors = this.diffTab !== false
                ? this.validationPanel.validateForTable(this.tableName)
                : this.validationPanel.validatePkDuplicatesForTable(this.tableName);
            this.applyValidationErrors(errors);
        } else {
            this.validationPanel.runAndUpdate();
        }
    }

    /**
     * ValidationPanel から呼ばれる: このテーブルのバリデーションエラーをDOMに適用する。
     * PK重複・FK参照切れ・型不一致エラーには cell-error を付与する。
     * エラーがないセルからは cell-error を除去する。
     */
    applyValidationErrors(errors: ValidationError[]): void {
        // ストア列インデックス → エラー種別のマップにグループ化する（key: "storeRow,storeCol"）
        const pkErrorCells = new Set<string>();
        const otherErrorCells = new Set<string>();
        for (const error of errors) {
            const key = `${error.rowIndex},${error.columnIndex}`;
            if (error.kind === 'pk-duplicate') { pkErrorCells.add(key); } else { otherErrorCells.add(key); }
        }
        const colCount = this.getColumnCount();
        const offset = this.dataColumnOffset();
        // DOM列→ストア列のマッピングを columnMapping から事前構築する。
        const domColToStoreCol: number[] = [];
        for (let dataColIdx = 0; dataColIdx < colCount; dataColIdx++) {
            domColToStoreCol.push(this.getStoreColumnIndex(dataColIdx));
        }
        // バーチャルスクロールで新規生成される行にもエラークラスを適用できるようキャッシュに保存する
        this.cachedPkErrorCells = pkErrorCells;
        this.cachedOtherErrorCells = otherErrorCells;
        this.cachedDomColToStoreCol = domColToStoreCol;
        // storeRowIndices に記録されたデータ行のみ走査する（バッファ空行はスキップ）
        // フィルター適用時は getFilteredDataRowCount() でフィルター後の行数を使う
        const validationRowCount = this.getFilteredDataRowCount();
        let firstDomRow = 1;
        let lastDomRow = validationRowCount;
        if (this.virtualScroll.handlesScrollEvents()) {
            const rendered = this.virtualScroll.getRenderedRange();
            firstDomRow = rendered.start + 1;
            lastDomRow = Math.min(validationRowCount, rendered.end);
        }
        for (let rowIdx = firstDomRow; rowIdx <= lastDomRow; rowIdx++) {
            const row = this.getRowElement(rowIdx);
            if (!row) continue;
            // フィルター適用時は論理行インデックスのため resolveStoreRowIndex で変換する
            const storeRowIdx = this.resolveStoreRowIndex(rowIdx - 1);
            if (storeRowIdx < 0) continue;
            for (let dataColIdx = 0; dataColIdx < colCount; dataColIdx++) {
                const cell = row.children[dataColIdx + offset] as HTMLElement | null;
                if (!cell) continue;
                const storeColIdx = domColToStoreCol[dataColIdx];
                if (storeColIdx === -1) continue;
                const key = `${storeRowIdx},${storeColIdx}`;
                const isPkError = pkErrorCells.has(key);
                const isOtherError = otherErrorCells.has(key);
                // cell-error: PK重複・FK参照切れ・型不一致
                if (isPkError || isOtherError) { cell.classList.add('cell-error'); } else { cell.classList.remove('cell-error'); }
            }
        }
        this.refreshScrollbarMarkers();
        // 固定行・固定列は可視セルが detached/quadrant layer に複製されるため、
        // 元セルに付与したエラー class を複製側にも同期する。
        if (this.getFrozenRowCount() > 0 || this.getFrozenColumnCount() > 0) {
            this.syncDetachedVisualState();
        }
    }

    // =========================================================================
    // スクロールバーマーカー
    // =========================================================================

    /**
     * スクロールバーマーカートラックにエラー行・git変更行を反映する。
     * ミニテーブルではマーカー不要のため何もしない。
     * データ行インデックスと総データ行数の比率でマーカー位置を算出する。
     * DOMの表示範囲に依存しないため、仮想スクロール時もすべてのマーカーを描画できる。
     */
    refreshScrollbarMarkers(): void {
        if (this.scrollbarMarkerTrack === false) return;
        if (this.isMiniTable) return;
        if (!this.isActive) return;
        this.currentErrorDomRows = this.collectErrorMarkerRows();
        this.currentGitChangedDomRows = this.collectGitChangedMarkerRows();
        // 総データ行数（フィルター後の表示行 + バッファ行）をマーカー位置の分母にする。
        // フィルター中は非表示行をスクロール範囲に含めないため、マーカーも表示行基準で配置する。
        const totalDataRowCount = this.getFilteredDataRowCount() + 1;
        const errorMarkers = this.buildMarkerEntries(this.currentErrorDomRows, totalDataRowCount);
        const gitMarkers = this.buildMarkerEntries(this.currentGitChangedDomRows, totalDataRowCount);
        this.scrollbarMarkerTrack.updateNormal(errorMarkers, gitMarkers);
    }

    private collectErrorMarkerRows(): Set<number> {
        const errorStoreRows = new Set<number>();
        this.addStoreRowsFromErrorCache(this.cachedPkErrorCells, errorStoreRows);
        this.addStoreRowsFromErrorCache(this.cachedOtherErrorCells, errorStoreRows);
        return this.mapStoreRowsToVisibleDataRows(errorStoreRows);
    }

    private addStoreRowsFromErrorCache(cache: Set<string>, output: Set<number>): void {
        for (const key of cache) {
            const commaIndex = key.indexOf(',');
            if (commaIndex === -1) continue;
            const storeRowIndex = Number(key.slice(0, commaIndex));
            if (Number.isInteger(storeRowIndex) && storeRowIndex >= 0) output.add(storeRowIndex);
        }
    }

    private collectGitChangedMarkerRows(): Set<number> {
        if (this.gitDiffTracker === false) return new Set<number>();
        const storeRows = this.store.getRows(this.tableName);
        if (storeRows === false) return new Set<number>();
        const changedRows = new Set<number>();
        const visibleRowCount = this.getFilteredDataRowCount();
        if (visibleRowCount > MAX_SCROLLBAR_MARKER_SCAN_ROWS) return changedRows;
        const columnMapping = this.tableData.columnMapping;
        for (let dataRowIndex = 0; dataRowIndex < visibleRowCount; dataRowIndex++) {
            const storeRowIndex = this.resolveStoreRowIndex(dataRowIndex);
            if (storeRowIndex < 0) continue;
            for (let domColIndex = 0; domColIndex < columnMapping.length; domColIndex++) {
                const storeColIndex = columnMapping[domColIndex];
                if (storeColIndex === -1) continue;
                if (this.gitDiffTracker.isCellChanged(storeRows, storeRowIndex, storeColIndex)) {
                    changedRows.add(dataRowIndex);
                    break;
                }
            }
        }
        return changedRows;
    }

    private mapStoreRowsToVisibleDataRows(storeRows: Set<number>): Set<number> {
        const visibleRows = new Set<number>();
        if (storeRows.size === 0) return visibleRows;
        const visibleRowCount = this.getFilteredDataRowCount();
        if (visibleRowCount > MAX_SCROLLBAR_MARKER_SCAN_ROWS) return visibleRows;
        for (let dataRowIndex = 0; dataRowIndex < visibleRowCount; dataRowIndex++) {
            const storeRowIndex = this.resolveStoreRowIndex(dataRowIndex);
            if (storeRows.has(storeRowIndex)) visibleRows.add(dataRowIndex);
        }
        return visibleRows;
    }

    /**
     * データ行インデックスの集合からマーカー描画エントリを構築する。
     * 各行のマーカー位置を dataRowIndex / totalDataRowCount で比率算出する。
     * DOM要素の座標に依存しないため、仮想スクロールで表示範囲外の行もマーカーを生成できる。
     * 連続する行はまとめて1つのエントリにマージする。
     */
    buildMarkerEntries(dataRows: Set<number>, totalDataRowCount: number): MarkerEntry[] {
        if (dataRows.size === 0) return [];
        const markers: MarkerEntry[] = [];
        const sorted = Array.from(dataRows).sort((a, b) => a - b);
        const rowSize = 1 / totalDataRowCount;
        let rangeStartIdx = sorted[0];
        let rangeEndIdx = sorted[0];
        for (let i = 1; i < sorted.length; i++) {
            if (sorted[i] === sorted[i - 1] + 1) {
                // 連続する行はマージする
                rangeEndIdx = sorted[i];
            } else {
                // 非連続 → 前のレンジを確定して新しいレンジを開始する
                markers.push({
                    start: rangeStartIdx / totalDataRowCount,
                    size: (rangeEndIdx - rangeStartIdx + 1) * rowSize,
                });
                rangeStartIdx = sorted[i];
                rangeEndIdx = sorted[i];
            }
        }
        // 最後のレンジを確定する
        markers.push({
            start: rangeStartIdx / totalDataRowCount,
            size: (rangeEndIdx - rangeStartIdx + 1) * rowSize,
        });
        return markers;
    }


}
