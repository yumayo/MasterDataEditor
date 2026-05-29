import {EditorTable} from "./editor-table";
import {DEFAULT_ROW_HEIGHT} from "../core/constant";
import {RenderedRowsUpdate} from "./virtual-scroll-controller";

/**
 * EditorTable の初期DOM構築、仮想スクロール行生成、ライフサイクル操作を担当する。
 *
 * EditorTable 本体は公開APIを維持するファサードとして残し、実処理はこのクラスに委譲する。
 * 既存モジュールと同じく Proxy でファサードの内部状態へフォールバックする。
 */
export class EditorTableRenderer {
    [key: string]: any;
    private readonly table: EditorTable;

    constructor(table: EditorTable) {
        this.table = table;
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
     * DOM要素を構築し、イベントリスナーを登録する。
     * ファクトリ関数から呼び出される。
     */
    initialize(): void {
        this.element.classList.add(this.rootCssClass);
        if (this.usesInternalMainViewport) this.element.classList.add('editor-table--quadrant-layout');
        {
            const cells = [];
            // 左上隅の空セル
            const cornerCell = document.createElement('div');
            cornerCell.classList.add('editor-table-cell', 'editor-table-corner-cell');
            // comment 付き列が1つでもある場合、ヘッダー行は2行分の高さになるためコーナーセルも合わせる
            const hasComment = this.tableData.header.some((col: any) => col.comment !== null);
            if (hasComment) {
                cornerCell.style.height = `calc(${DEFAULT_ROW_HEIGHT} * 2)`;
                cornerCell.style.minHeight = `calc(${DEFAULT_ROW_HEIGHT} * 2)`;
                cornerCell.style.maxHeight = 'none';
            } else {
                EditorTable.applyCellHeight(cornerCell, DEFAULT_ROW_HEIGHT);
            }
            // コーナーセルクリックで全選択
            cornerCell.addEventListener('mousedown', (e) => {
                // マウスサイドボタン（戻る/進む）はブラウザ履歴ナビゲーション専用のため無視する
                if (e.button !== 0) return;
                this.handler.submitAndHide();
                this.selection.selectAll();
            });
            cells.push(cornerCell);
            // 列ヘッダー (A, B, C, ...)
            for (let i = 0; i < this.tableData.header.length; ++i) {
                // comment がある列は上段に変数名、下段にcommentの2行ヘッダーを生成する
                const col = this.tableData.header[i];
                const isPrimaryKey = this.tableData.primaryKeyColumns.includes(col.name);
                const columnHeaderCell = this.structure.createColumnHeaderCell(col.name, col.comment, i, col.width, isPrimaryKey, col.reference);
                cells.push(columnHeaderCell);
            }
            const columnHeaderRow = EditorTable.createRow(cells, 0);
            columnHeaderRow.classList.remove('editor-table-row');
            columnHeaderRow.classList.add('editor-table-source-column-header-row');
            this.gridElement.appendChild(columnHeaderRow);
        }
        // ヘッダー行追加直後に topSpacer をテーブル内に配置する（データ行追加前に必要）
        this.virtualScroll.attachSpacers();
        // 通常テーブルはストア、ミニテーブルは呼び出し元から渡された部分行データを初期描画のソースにする。
        // 差分タブはミニテーブル扱いだが、巨大CSVで EditorTableDataRow を全行分複製しないようストアを直接使う。
        // RelationsPanel の通常ミニテーブルは initialize() 後に setStoreRowIndices() で実ストア行へ差し替えられる。
        const initialStoreRows = (!this.isMiniTable || this.useStoreRowsForInitialRender) ? this.store.getRows(this.tableName) : false;
        const initialDataRowCount = initialStoreRows === false ? this.tableData.body.length : initialStoreRows.length;
        this.storeRowIndices = Array.from({ length: initialDataRowCount }, (_, i) => i);
        this.refreshRowHeaderWidth();
        // filteredRowIndices はフィルター未適用時は空配列のまま（applyFilterDisplay で設定される）
        // totalRowCount はバッファ行を含むDOM上の総データ行数。
        // 通常テーブル: emptyRowCount = body.length + 1（データ行 + バッファ行1行）
        // 差分テーブル: emptyRowCount = 0 だが実データ行が存在するため storeRowIndices.length を使う。
        // forceRecalculate() が totalRowCount に基づいてDOM行を管理するため、
        // バッファ行を含めないと forceRecalculate 時にバッファ行がDOMから削除される。
        this.virtualScroll.updateTotalRowCount(Math.max(this.emptyRowCount, this.storeRowIndices.length));
        if (this.virtualScroll.handlesScrollEvents()) {
            // 仮想スクロール有効時は初期化時点で全行DOMを生成しない。
            // 表示範囲だけを forceRecalculate() で動的生成する。
            this.virtualScroll.forceRecalculate();
        } else {
            for (let i = 0; i < initialDataRowCount; ++i) {
                const cells: HTMLElement[] = [];
                cells.push(this.structure.createRowHeaderCell(String(i + 1), i));
                for (let j = 0; j < this.tableData.header.length; ++j) {
                    let value = '';
                    if (initialStoreRows !== false) {
                        const storeRow = initialStoreRows[i];
                        const storeColumnIndex = this.tableData.columnMapping[j];
                        value = storeColumnIndex === -1 || storeColumnIndex >= storeRow.length ? '' : storeRow[storeColumnIndex];
                    } else {
                        value = this.tableData.body[i].values[j];
                    }
                    cells.push(EditorTable.createCell(this.table, value, j, this.tableData.header[j].width, DEFAULT_ROW_HEIGHT));
                }
                const row = EditorTable.createRow(cells, i);
                row.dataset.rowIndex = String(i);
                row.dataset.storeIndex = String(i);
                // bottomSpacer がテーブル末尾に存在するため、その直前に挿入する
                this.virtualScroll.appendDataRow(row);
            }
            for (let i = 0; i < this.emptyRowCount - initialDataRowCount; ++i) {
                const row = this.renderBufferRow(initialDataRowCount + i);
                // bottomSpacer がテーブル末尾に存在するため、その直前に挿入する
                this.virtualScroll.appendDataRow(row);
            }
        }
        // フィル中のマウス移動イベント
        this.element.addEventListener('mousemove', (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (target.classList.contains('editor-table-cell')) {
                const position = this.getCellPositionFromElement(target);
                if (position) {
                    this.selection.updateFill(position.row, position.column, e.clientX, e.clientY);
                }
            }
        });
        // 初期表示時にバリデーションを実行してセルにエラークラスを付与する
        this.runValidation();
        // 非仮想テーブルでは全行生成後に表示範囲を確立する。
        // 仮想テーブルは上で表示範囲だけを生成済み。
        if (!this.virtualScroll.handlesScrollEvents()) this.virtualScroll.forceRecalculate();
        // forceRecalculate() が初期DOMを作り直すため、その後でブックマーク視覚マークを復元する
        this.restoreBookmarkMarks();
        this.refreshFreezeVisualState();
    }

    /** バーチャルスクロールのスペーサーとDOM行を強制再計算する（タブ復帰時に使用） */
    forceVirtualScrollRecalculate(): void {
        this.virtualScroll.forceRecalculate();
        this.refreshDetachedHeaderLayout();
    }

    /** バーチャルスクロールの全行を破棄して再レンダリングする（diffTab接続後の初期装飾適用に使用） */
    forceVirtualScrollFullRerender(): void {
        this.virtualScroll.forceFullRerender();
        this.refreshDetachedHeaderLayout();
    }

    /**
     * 指定データ行インデックスのDOM行要素を生成して返す。
     * storeRowIndices 経由でストアからセル値を取得してセルを生成する。
     * バーチャルスクロールの行動的生成で再利用する。
     * テーブルへの追加（appendChild）は呼び出し側の責務。
     */
    renderDataRow(dataRowIndex: number): HTMLElement {
        const storeRowIndex = this.storeRowIndices[dataRowIndex];
        const storeRows = this.store.getRows(this.tableName);
        const columnMapping = this.tableData.columnMapping;
        const cells: HTMLElement[] = [];
        // 行ヘッダー（表示上は1始まり）
        cells.push(this.structure.createRowHeaderCell(String(dataRowIndex + 1), dataRowIndex));
        for (let j = 0; j < this.tableData.header.length; ++j) {
            // columnMapping でDOM列→ストア（CSV）列に変換してセル値を取得する
            const csvColIndex = columnMapping[j];
            let value: string = '';
            if (storeRows !== false && csvColIndex !== -1 && storeRowIndex >= 0 && storeRowIndex < storeRows.length) {
                const storeRow = storeRows[storeRowIndex];
                if (csvColIndex < storeRow.length) {
                    value = storeRow[csvColIndex];
                }
            }
            cells.push(EditorTable.createCell(this.table, value, j, this.tableData.header[j].width, DEFAULT_ROW_HEIGHT));
        }
        const row = EditorTable.createRow(cells, dataRowIndex);
        row.dataset.rowIndex = String(dataRowIndex);
        // ソート時にstoreRowIndexからDOM行要素を逆引きするためのインデックスを付与する
        row.dataset.storeIndex = String(storeRowIndex);
        return row;
    }

    /**
     * バッファ行（空行）のDOM要素を生成して返す。
     * バッファ行はユーザーが入力を開始するまで空のまま保持される待機行。
     */
    renderBufferRow(dataRowIndex: number): HTMLElement {
        const cells: HTMLElement[] = [];
        cells.push(this.structure.createRowHeaderCell(String(dataRowIndex + 1), dataRowIndex));
        for (let j = 0; j < this.tableData.header.length; ++j) {
            cells.push(EditorTable.createCell(this.table, '', j, this.tableData.header[j].width, DEFAULT_ROW_HEIGHT));
        }
        const row = EditorTable.createRow(cells, dataRowIndex);
        row.dataset.rowIndex = String(dataRowIndex);
        // バッファ行（ユーザーが直接挿入した行と区別するための識別クラス）
        row.classList.add('editor-table-empty-row');
        return row;
    }

    /**
     * バーチャルスクロールの行動的生成コールバック。
     * データ行かバッファ行かを判定し、適切なメソッドに委譲する。
     */
    renderRowForVirtualScroll(dataRowIndex: number): HTMLElement {
        const filteredCount = this.getFilteredDataRowCount();
        if (dataRowIndex < filteredCount) {
            // フィルター適用時: filteredRowIndices で storeRowIndices 上のインデックスに変換
            // フィルター未適用時: dataRowIndex をそのまま使用（storeRowIndices[dataRowIndex]）
            const mappedDataRowIndex = this.columnFilter.hasActiveFilter()
                ? this.filteredRowIndices[dataRowIndex]
                : dataRowIndex;
            const row = this.renderDataRow(mappedDataRowIndex);
            // フィルター適用時、renderDataRow は mappedDataRowIndex（storeRowIndices上のインデックス）で
            // data-row-index を設定するが、仮想スクロールの論理行インデックスは dataRowIndex であるべき。
            // getCellPosition() が data-row-index を読んで行番号を返すため、フィルター後の連続した
            // 論理行番号（0,1,2,...）に修正する。ストアアクセスは resolveStoreRowIndex() で変換する。
            if (this.columnFilter.hasActiveFilter()) {
                const rowHeader = row.querySelector('.editor-table-row-header') as HTMLElement | null;
                if (rowHeader) {
                    rowHeader.dataset.rowIndex = String(dataRowIndex);
                    // 行ヘッダーのテキストノードも仮想スクロールの論理行番号に更新する
                    for (const node of Array.from(rowHeader.childNodes)) {
                        if (node.nodeType === Node.TEXT_NODE) { node.textContent = String(dataRowIndex + 1); break; }
                    }
                }
                row.dataset.rowIndex = String(dataRowIndex);
                // 行の data-row 属性も論理行インデックスに更新する
                row.dataset.row = String(dataRowIndex + 1);
            }
            this.applyRowDecorations(row, mappedDataRowIndex);
            // 差分タブ接続時: diffクラスを適用する
            if (this.diffTab !== false) {
                this.diffTab.applyDiffDecorationsToRow(row, mappedDataRowIndex, this.table);
            }
            return row;
        }
        return this.renderBufferRow(dataRowIndex);
    }

    /**
     * バーチャルスクロールで動的生成されたデータ行に、バリデーションエラーとgit変更のクラスを適用する。
     * applyValidationErrors / applyGitDiffHighlight でキャッシュされた情報を使用する。
     */
    private applyRowDecorations(rowElement: HTMLElement, dataRowIndex: number): void {
        const storeRowIndex = this.storeRowIndices[dataRowIndex];
        const offset = this.dataColumnOffset();
        const colCount = this.getColumnCount();
        // バリデーションエラークラスの適用
        if (this.cachedPkErrorCells.size > 0 || this.cachedOtherErrorCells.size > 0) {
            for (let dataColIdx = 0; dataColIdx < colCount; dataColIdx++) {
                const cell = rowElement.children[dataColIdx + offset] as HTMLElement | null;
                if (!cell) continue;
                const storeColIdx = dataColIdx < this.cachedDomColToStoreCol.length ? this.cachedDomColToStoreCol[dataColIdx] : -1;
                if (storeColIdx === -1) continue;
                const key = `${storeRowIndex},${storeColIdx}`;
                const isPkError = this.cachedPkErrorCells.has(key);
                const isOtherError = this.cachedOtherErrorCells.has(key);
                if (isPkError || isOtherError) { cell.classList.add('cell-error'); }
            }
        }
        // git変更クラスの適用
        if (this.gitDiffTracker !== false) {
            const storeRows = this.store.getRows(this.tableName);
            if (storeRows !== false) {
                const columnMapping = this.tableData.columnMapping;
                for (let dataColIdx = 0; dataColIdx < colCount; dataColIdx++) {
                    const cell = rowElement.children[dataColIdx + offset] as HTMLElement | null;
                    if (!cell) continue;
                    const storeColIdx = dataColIdx < columnMapping.length ? columnMapping[dataColIdx] : -1;
                    if (storeColIdx === -1) continue;
                    if (this.gitDiffTracker.isCellChanged(storeRows, storeRowIndex, storeColIdx)) {
                        cell.classList.add('cell-git-changed');
                    }
                }
            }
        }
    }

    /**
     * スクロールイベント時に行入れ替えの有無にかかわらず呼ばれる。
     * 固定行・固定列のセルが選択されている場合、fillHandle の位置を更新する。
     */
    onScrollForFrozenFillHandle(): void {
        if (this.skipFrozenFillHandleRefreshOnNextScrollSync) {
            this.skipFrozenFillHandleRefreshOnNextScrollSync = false;
            return;
        }
        if (this.frozenRowCount === 0 && this.frozenColumnCount === 0) return;
        const range = this.selection.getSelectionRange();
        const isFrozenRow = this.frozenRowCount > 0 && range.endRow <= this.frozenRowCount;
        const endDataColumn = range.endColumn - this.dataColumnOffset();
        const isFrozenColumn = this.frozenColumnCount > 0 && endDataColumn < this.frozenColumnCount;
        if (!isFrozenRow && !isFrozenColumn) return;
        this.selection.refreshFillHandlePosition();
    }

    /**
     * バーチャルスクロールで行の入れ替えが完了した後に、表示中の行に装飾を再適用する。
     */
    reapplyRowDecorations(update: RenderedRowsUpdate): void {
        // ドラッグ選択中（mousedown→mousemove中）は選択クラス再適用をスキップする。
        if (this.selection.isSelecting() || this.selection.isSelectingColumn() || this.selection.isSelectingRow()) {
            this.applyFreezeVisualStateToRenderedRows();
            if (this.usesInternalMainViewport) {
                this.refreshQuadrantViewportRowHeaders(update);
                if (!update.triggeredByScroll) this.syncQuadrantStaticCellStates();
                return;
            }
            if (update.triggeredByScroll) {
                this.refreshDetachedViewportRowHeaders(update);
                return;
            }
            this.refreshDetachedHeaderLayout();
            return;
        }
        this.applyFreezeVisualStateToRenderedRows();
        this.selection.reapplySelectionClassesOnly(update.triggeredByScroll);
        const selectionRange = this.selection.getSelectionRange();
        const isFrozenRowSelection = this.frozenRowCount > 0 && selectionRange.endRow <= this.frozenRowCount;
        const endDataColumn = selectionRange.endColumn - this.dataColumnOffset();
        const isFrozenColumnSelection = this.frozenColumnCount > 0 && endDataColumn < this.frozenColumnCount;
        this.skipFrozenFillHandleRefreshOnNextScrollSync = update.triggeredByScroll && (isFrozenRowSelection || isFrozenColumnSelection);
        this.reapplyReferenceAndBookmarkDecorations(update);
        if (this.usesInternalMainViewport) {
            this.refreshQuadrantViewportRowHeaders(update);
            if (!update.triggeredByScroll) this.syncQuadrantStaticCellStates();
            return;
        }
        if (update.triggeredByScroll) {
            this.refreshDetachedViewportRowHeaders(update);
            return;
        }
        this.refreshDetachedHeaderLayout();
    }

    private reapplyReferenceAndBookmarkDecorations(update: RenderedRowsUpdate): void {
        const applyRange = (range: { start: number; end: number }): void => {
            if (range.start >= range.end) return;
            const startDomRow = this.virtualScroll.dataRowToDomIndex(range.start);
            const endDomRow = this.virtualScroll.dataRowToDomIndex(range.end - 1);
            if (startDomRow === null || endDomRow === null) return;
            this.reference.updateReferenceHintsForRows(startDomRow, endDomRow + 1);
            this.restoreBookmarkMarksForDataRowRange(range.start, range.end, false);
        };
        if (update.refreshAllRows) {
            if (this.frozenRowCount > 0) applyRange({ start: 0, end: this.frozenRowCount });
            for (const insertedRange of update.insertedRanges) applyRange(insertedRange);
            return;
        }
        for (const insertedRange of update.insertedRanges) {
            applyRange(insertedRange);
        }
    }

    /**
     * バーチャルスクロールのスペーサー要素をDOM上に配置する。
     * appendTo() 完了後（テーブル要素が親要素に追加された後）に呼ぶこと。
     */
    attachSpacers(): void {
        this.virtualScroll.attachSpacers();
    }

    /** グローバルイベントリスナーを登録する（タブがアクティブになったとき） */
    activate(): void {
        this.selectionDragController.activate();
        this.isActive = true;
        this.reattachScrollbarMarkerTrack();
        // タブ切り替え時に保持済みのマーカーデータを再描画する
        this.refreshScrollbarMarkers();
    }

    /** グローバルイベントリスナーを解除する（タブが非アクティブになったとき） */
    deactivate(): void {
        this.handler.deactivate();
        this.selectionDragController.deactivate();
        const wasActive = this.isActive;
        this.isActive = false;
        // 共有右側マーカーは、このテーブルが表示中だった場合だけクリアする。
        if (wasActive && this.scrollbarMarkerTrack !== false) this.scrollbarMarkerTrack.clear();
    }

    /** テーブルにキーボードフォーカスを戻す。 */
    focusTable(): void {
        this.handler.activate();
    }

    /** アクティブ/非アクティブの視覚状態のみを切り替える。 */
    setInactiveAppearance(inactive: boolean): void {
        if (inactive) {
            this.element.classList.add('editor-table--inactive');
        } else {
            this.element.classList.remove('editor-table--inactive');
        }
    }

    /** DOMレイアウト完了後にSelectionの視覚位置を現在の内部状態に基づいて更新する */
    refreshSelectionDisplay(): void {
        this.selection.updateRendererAfterResize();
    }

    /** 読み取り専用にする（ミニEditorTable用） */
    makeReadOnly(): void {
        this.handler.makeReadOnly();
        this.contextMenuHandler.makeReadOnly();
    }

    /** ミニEditorTableかどうかを判定する。 */
    isMiniTableInstance(): boolean {
        return this.isMiniTable;
    }

    stopAutoScrollForInput(): void {
        this.selectionDragController.stopAutoScrollForInput();
    }
}
