import {EditorTable} from "./editor-table";
import {DEFAULT_ROW_HEIGHT} from "../core/constant";

/**
 * EditorTable のストア同期、バッファ空行、FK自動埋め込みを担当する。
 *
 * 行のDOM表現と InMemoryTableStore の対応を扱うため、EditorTable 本体へ Proxy で
 * フォールバックし、既存の状態と公開APIを維持する。
 */
export class EditorTableStoreSync {
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
     * ストアからセルデータを再読み込みし、DOMの行数・セル値をストアに完全同期する。
     * タブ切替時に呼び出され、他タブ（またはミニテーブル）でストアが変更された結果を反映する。
     */
    reloadCellsFromStore(): void {
        // blameはgit committed dataのため、ストアからの全面リロードで陳腐化する
        this.hideBlameIfVisible();
        const storeRows = this.store.getRows(this.tableName);
        if (storeRows === false) return;

        // DOM列インデックス → ストア列インデックスのマッピングを columnMapping から構築する。
        const domColumnCount = this.getColumnCount();
        const storeColumnIndices = this.tableData.columnMapping.slice(0, domColumnCount);

        // 通常テーブルのみ: DOMの行数とストアの行数を同期し、storeRowIndices を [0..storeRows.length-1] に更新する。
        // ミニテーブルはフィルタ済みのサブセットを表示しており、ストア全行との同期は不適切なため除外する。
        // ミニテーブルは destroyMiniEditorTables()/buildMiniEditorTableAsync() で都度再構築されるため問題なし。
        let domRowCountChanged = false;
        if (!this.isMiniTable) {
            const currentDataRowCount = this.storeRowIndices.length;
            if (storeRows.length > currentDataRowCount) {
                // ストアの方が多い: バッファ空行を昇格してデータ行に変換し、足りなければ新規行を挿入する
                for (let i = currentDataRowCount; i < storeRows.length; i++) {
                    const domRowIndex = i + 1; // 列ヘッダー行を含む DOM インデックス
                    const existingRow = this.getRowElement(domRowIndex);
                    if (existingRow && existingRow.classList.contains('editor-table-empty-row')) {
                        // バッファ空行をデータ行に昇格する（editor-table-empty-row クラスを除去）
                        existingRow.classList.remove('editor-table-empty-row');
                        existingRow.dataset.row = String(domRowIndex);
                        // ソート時のstoreRowIndex逆引きのためのインデックスを付与する
                        existingRow.dataset.storeIndex = String(i);
                    } else {
                        // バッファ空行が不足している場合は新規行を生成して挿入する
                        const cells: HTMLElement[] = [this.structure.createRowHeaderCell(String(domRowIndex), i)];
                        for (let j = 0; j < domColumnCount; j++) {
                            cells.push(EditorTable.createCell(this.table, '', j, this.getColumnWidth(j), DEFAULT_ROW_HEIGHT));
                        }
                        const newRow = EditorTable.createRow(cells, domRowIndex);
                        // ソート時のstoreRowIndex逆引きのためのインデックスを付与する
                        newRow.dataset.storeIndex = String(i);
                        const insertTarget = this.getRowElement(domRowIndex);
                        if (insertTarget) {
                            this.gridElement.insertBefore(newRow, insertTarget);
                            // DOM行が挿入されたため renderedEnd を同期する
                            this.virtualScroll.notifyRowAppended();
                        } else {
                            // bottomSpacerの手前に挿入する（enabled=false なら通常の appendChild）
                            this.virtualScroll.appendDataRow(newRow);
                            // 新しい行がDOMに追加されたため renderedEnd を同期する
                            this.virtualScroll.notifyRowAppended();
                        }
                    }
                    this.storeRowIndices.push(i);
                }
                domRowCountChanged = true;
            } else if (storeRows.length < currentDataRowCount) {
                // ストアの方が少ない: 末尾のデータ行をDOMから除去する（バッファ空行は維持する）
                for (let i = currentDataRowCount - 1; i >= storeRows.length; i--) {
                    const domRowIndex = i + 1; // 列ヘッダー行を含む DOM インデックス
                    const rowToRemove = this.getRowElement(domRowIndex);
                    // 通常テーブルで削除対象がnullまたはバッファ空行である場合は設計上の不整合
                    if (!rowToRemove || rowToRemove.classList.contains('editor-table-empty-row')) {
                        throw new Error('[EditorTable.reloadCellsFromStore] DOM行とストアの不整合: 削除対象行が存在しないか空行です。 domRowIndex=' + domRowIndex);
                    }
                    rowToRemove.remove();
                    // DOM行が削除されたため renderedEnd を同期する
                    this.virtualScroll.notifyRowRemoved();
                    this.storeRowIndices.splice(i, 1);
                }
                domRowCountChanged = true;
            }
        }

        // DOM行数が変化した場合は全行の data-row 属性・行ヘッダーテキスト・リサイズハンドルを再ナンバリングする。
        // insertRowInternal/deleteRow では挿入・削除位置以降の行のみ再ナンバリングするが、
        // reloadCellsFromStore では複数行が一括で増減する可能性があるため、データ行先頭（domIndex=1）から全行を対象とする。
        if (domRowCountChanged) this.structure.renumberRowsFrom(1);
        // ストアとのDOMリロード後も末尾に1行バッファ行を保持する（他経路と同一ガード条件）。
        // ミニテーブルは都度再構築（destroyMiniEditorTables/buildMiniEditorTableAsync）のため到達しないが、
        // promoteBufferRowToStore/demoteStoreRowToBuffer/deleteRow と条件を統一する。
        if (this.diffTab === false) this.ensureTrailingBufferRow();
        // DOM行数が変化した場合にバーチャルスクロールの総行数を同期する。
        if (domRowCountChanged) {
            // getRowCount() は仮想スクロール時にDOM行数しか返さないため、
            // 論理的な総行数（storeRowIndices + バッファ1行）を使う。
            this.virtualScroll.updateTotalRowCount(this.storeRowIndices.length + 1);
        }

        // storeRowIndices[domDataRow] → storeRow のマッピングで各DOMデータ行のセル値を更新する。
        // 通常テーブルは上記の同期後に storeRowIndices[i]=i が保証される。
        // ミニテーブルは filteredRows のストアインデックスを正しく参照できる。
        for (let domDataRow = 0; domDataRow < this.storeRowIndices.length; domDataRow++) {
            const domRow = domDataRow + 1; // DOMは1始まり（列ヘッダー行がある）
            const storeRowIndex = this.storeRowIndices[domDataRow];
            if (storeRowIndex < 0 || storeRowIndex >= storeRows.length) continue;
            const rowElement = this.getRowElement(domRow);
            if (rowElement === null) continue;
            const storeRowData = storeRows[storeRowIndex];

            for (let domCol = 0; domCol < domColumnCount; domCol++) {
                const storeColIdx = storeColumnIndices[domCol];
                if (storeColIdx === -1) continue;
                const storeValue = storeColIdx < storeRowData.length ? storeRowData[storeColIdx] : '';
                const cell = rowElement.children[domCol + this.dataColumnOffset()] as HTMLElement | null;
                if (cell === null) continue;
                this.reference.setCellValue(cell, storeValue, domCol, domRow);
            }
        }

        // DOM行数が変化した場合はコピー範囲を無効化し、選択描画を更新する（範囲が行数外を指す可能性があるため）
        if (domRowCountChanged) {
            this.selection.clearCopyRange();
            this.selection.updateRendererAfterResize();
        }
        // DOM行の増減に関わらず git差分ハイライトを再評価する（ストアとDOMのマッピングが変化するため）
        this.applyGitDiffHighlight();
        // タブ切替後のDOMリロードでもバリデーションエラークラスを再適用する。
        // バリデーションを再実行すると参照先テーブルが閉じられている場合にFKエラーが消えてしまうため、
        // ValidationPanel の currentErrors から自テーブル分だけを取り出してDOMクラスを再適用する。
        // ミニテーブルは都度 buildMiniEditorTableAsync で再構築されるため対象外。
        if (this.validationPanel !== false && !this.isMiniTable) {
            this.applyValidationErrors(this.validationPanel.getErrorsForTable(this.tableName));
        }
        // reloadCellsFromStore はストアデータを全面的に上書きするため、ソート状態を維持しても
        // storeRowIndices が [0..n-1] にリセットされておりソートが無効化されている。
        // インジケーターをリセットしてUI上のソート表示と実態を一致させる。
        this.columnSorter.clearAllSorts();
        this.updateAllSortIndicators();
        // タブ切替時にフィルター状態が前回タブのままだと整合性が崩れるためリセットする。
        // ソートリセットと対称に、フィルター状態も UI と実態を一致させる。
        this.clearFilterState();
        // セル再作成パス（ソート・行操作等）で消失した data-bookmarked 属性を復元する
        this.restoreBookmarkMarks();
        this.refreshFreezeVisualState();
    }

    /**
     * バッファ空行をストアに昇格する（PromoteBufferRowCommandのexecute用）
     */
    promoteBufferRowToStore(domDataRowIndex: number): void {
        const storeHeader = this.store.getHeader(this.tableName);
        if (storeHeader === false) throw new Error('[EditorTable.promoteBufferRowToStore] ストアにテーブルが登録されていません: ' + this.tableName);
        // ストア行の列数はDOMではなくストアのヘッダー長で決定する。
        // ミニテーブルはDOM列数がストアのサブセット（FK列を除く）のため getColumnCount() では不正になる。
        const storeColumnCount = storeHeader.length;
        // domDataRowIndex が storeRowIndices の末尾を超える場合、間の行も昇格する必要がある。
        // 例: storeRowIndices=[0,1,2] で domDataRowIndex=5 の場合、3,4,5 を順に追加する。
        const currentLength = this.storeRowIndices.length;
        for (let i = currentLength; i <= domDataRowIndex; i++) {
            // ストアの末尾に空行を追加（getHeader が false でない場合 getRows も必ず存在する）
            const storeRows = this.store.getRows(this.tableName);
            if (storeRows === false) throw new Error('[EditorTable.promoteBufferRowToStore] ストア行データが存在しません: ' + this.tableName);
            const storeRowIndex = storeRows.length;
            this.store.insertRowAt(this.tableName, storeRowIndex, Array(storeColumnCount).fill(''));
            this.storeRowIndices.push(storeRowIndex);
            // ソート中の場合、originalIndices も同期する（バッファ行昇格でストア行数が増えるため）
            this.columnSorter.notifyRowInserted(storeRowIndex);
            // DOMの該当行から editor-table-empty-row クラスを除去する（data行として昇格）
            const domRow = this.getRowElement(i + 1);
            if (domRow) {
                domRow.classList.remove('editor-table-empty-row');
                // ソート時のstoreRowIndex逆引きのためのインデックスを付与する
                domRow.dataset.storeIndex = String(storeRowIndex);
            }
        }
        // バッファ行昇格後にgit差分ハイライトを再評価する（新規昇格行は新規追加行として changed になる）
        this.applyGitDiffHighlight();
        // バッファ行がストアに昇格した後、参照データキャッシュを無効化する。
        // 昇格行のIDがキャッシュ構築後に入力された場合に古いキャッシュが参照されるのを防ぐ。
        this.evictOwnReferenceDataCache();
        // バッファ行昇格後にバリデーションを実行する（新規行のIDが既存と重複する可能性があるため）
        this.runValidation();
        // フィルター適用中の場合は行数カウンターと表示/非表示を再計算する（新規昇格行がフィルター条件を満たさない可能性）
        this.refreshFilterDisplayIfActive();
        // 常に末尾にバッファ行を1行保持する（昇格で消えた場合に補充する）。差分タブでは不要。
        if (this.diffTab === false) this.ensureTrailingBufferRow();
    }

    /**
     * ストア行をバッファ空行に降格する（PromoteBufferRowCommandのundo用）
     */
    demoteStoreRowToBuffer(domDataRowIndex: number): void {
        // domDataRowIndex 以降の全ての昇格行を末尾から逆順で削除する
        const currentLength = this.storeRowIndices.length;
        for (let i = currentLength - 1; i >= domDataRowIndex; i--) {
            const storeRowIndex = this.storeRowIndices[i];
            this.store.removeRow(this.tableName, storeRowIndex);
            this.storeRowIndices.splice(i, 1);
            // ソート中の場合、originalIndices も同期する（ストア行降格でストア行数が減るため）
            this.columnSorter.notifyRowDeleted(storeRowIndex);
            // DOMの該当行に editor-table-empty-row クラスを復元し、storeIndex 属性を削除する（promoteBufferRowToStore との対称性）
            const domRow = this.getRowElement(i + 1);
            if (domRow) {
                domRow.classList.add('editor-table-empty-row');
                delete domRow.dataset.storeIndex;
            }
        }
        // 降格後にgit差分ハイライトを再評価する（降格行のストアインデックスが変化するため）
        this.applyGitDiffHighlight();
        // ストア行降格後に参照データキャッシュを無効化する（Undo時に古いIDがドロップダウンに残るのを防ぐ）。
        this.evictOwnReferenceDataCache();
        // 降格によりエラーが解消される可能性があるためバリデーションを再実行する
        this.runValidation();
        // フィルター適用中の場合は行数カウンターと表示/非表示を再計算する（降格行の除去で表示行数が変化する）
        this.refreshFilterDisplayIfActive();
        // Undoにより降格した行がバッファ行に戻ると、バッファ行が蓄積する可能性がある。
        // 蓄積したバッファ行（2行以上）は末尾から削除し、常に1行だけになるよう整理する。差分タブでは不要。
        if (this.diffTab === false) this.normalizeTrailingBufferRows();
    }

    /** 指定の domDataRowIndex がバッファ空行（ストア未登録）かどうかを判定する */
    isBufferRow(domDataRowIndex: number): boolean {
        return domDataRowIndex >= this.getFilteredDataRowCount();
    }

    /**
     * ストア行インデックスをDOM行インデックスに変換する。
     * ソート適用中は storeRowIndices の並び順が変化しているため、線形探索で逆引きする。
     */
    storeRowToDomRow(storeRowIndex: number): number | null {
        const domDataIndex = this.storeRowIndices.indexOf(storeRowIndex);
        if (domDataIndex === -1) return null;
        // DOM上は 0行目が列ヘッダーなのでデータ行は +1
        return domDataIndex + 1;
    }

    /**
     * 末尾バッファ行が存在しない場合に1行追加する（蓄積防止のため既にある場合は何もしない）。
     */
    ensureTrailingBufferRow(): void {
        // バーチャルスクロールでバッファ行がDOM外（表示範囲外）に存在する場合はスキップする。
        // バッファ行はフィルター後のデータ行の直後に位置する。
        // 表示範囲終端がバッファ行位置より手前にある場合、バッファ行はDOM外に存在するが
        // 論理的には存在し続けるため、重複追加してはならない。
        // 非仮想スクロール時は renderedEnd が全行をカバーするためこの条件は成立しない。
        const bufferDataRowIndex = this.getFilteredDataRowCount();
        const rendered = this.virtualScroll.getRenderedRange();
        if (rendered.end < bufferDataRowIndex) return;

        // 列ヘッダー行を除いたデータ行の総数（ストア行 + 既存バッファ行。スペーサー行は除外済み）
        const totalDataRows = this.getRowCount() - 1;
        // 末尾のDOM行がバッファ行かどうかを確認する（children[0]は列ヘッダーなので+1オフセット）
        if (totalDataRows > 0) {
            const lastRow = this.getRowElement(totalDataRows);
            if (lastRow && lastRow.classList.contains('editor-table-empty-row')) return;
        }
        // 新しいバッファ行の行インデックス（0始まり）
        const newRowIndex = totalDataRows;
        const cells: HTMLElement[] = [];
        cells.push(this.structure.createRowHeaderCell(String(newRowIndex + 1), newRowIndex));
        for (let j = 0; j < this.tableData.header.length; ++j) {
            cells.push(EditorTable.createCell(this.table, '', j, this.tableData.header[j].width, DEFAULT_ROW_HEIGHT));
        }
        const row = EditorTable.createRow(cells, newRowIndex);
        row.classList.add('editor-table-empty-row');
        // bottomSpacerの手前に挿入する（enabled=false なら通常の appendChild）
        this.virtualScroll.appendDataRow(row);
        // 新しい行がDOMに追加されたため renderedEnd を同期する（dataRowToDomIndex のインデックス変換に必要）
        this.virtualScroll.notifyRowAppended();
        // バッファ行追加によりデータ行総数が変化したため、バーチャルスクロールの総行数を更新する。
        this.virtualScroll.updateTotalRowCount(this.getFilteredDataRowCount() + 1);
        // 行追加後に行ヘッダーの番号（data-row属性・行番号テキスト）を振り直す
        this.structure.renumberRowsFrom(0);
        // FK列を持つ場合に新バッファ行へ参照ヒント（ドロップダウン等）を適用する
        // データ行の children 開始オフセット（ヘッダー行 + topSpacer 分）を考慮する
        const newDomRow = newRowIndex + this.getDataRowChildOffset();
        this.updateReferenceHintsForRows(newDomRow, newDomRow);
        // 行数変化後に選択オーバーレイの描画位置を再計算する
        this.selection.updateRendererAfterResize(false);
    }

    /**
     * バッファ行が2行以上存在する場合に末尾から余分な行を削除し、常に1行だけになるよう整理する。
     */
    normalizeTrailingBufferRows(): void {
        // DOM上のバッファ行（editor-table-empty-row）を末尾から数えて2行目以降を削除する
        // getRowCount() はスペーサー行を除外した値を返すため安全にループできる
        const toRemove: HTMLElement[] = [];
        let bufferRowCount = 0;
        const rowCount = this.getRowCount();
        for (let i = rowCount - 1; i >= 1; i--) {
            const row = this.getRowElement(i);
            if (!row || !row.classList.contains('editor-table-empty-row')) break;
            bufferRowCount++;
            // 2行目以降の余分なバッファ行を削除対象に追加する（末尾の1行は残す）
            if (bufferRowCount > 1) toRemove.push(row);
        }
        for (const row of toRemove) {
            this.gridElement.removeChild(row);
            // DOM行が削除されたため renderedEnd を同期する
            this.virtualScroll.notifyRowRemoved();
        }
        // バッファ行削除によりデータ行総数が変化したため、バーチャルスクロールの総行数を更新する
        if (toRemove.length > 0) this.virtualScroll.updateTotalRowCount(this.getRowCount() - 1);
        // 行削除後に行ヘッダーの番号（data-row属性・行番号テキスト）を振り直す
        this.structure.renumberRowsFrom(0);
        // 行数変化後に選択オーバーレイの描画位置を再計算する
        this.selection.updateRendererAfterResize(false);
    }

    /** 行追加時に自動埋め込みするFK列名と値のペアを設定する */
    setAutoFillEntries(entries: Array<{ columnName: string; value: string }>): void {
        this.autoFillEntries = entries;
    }

    /** DOMデータ行インデックスからストア行インデックスへのマッピングを設定する */
    setStoreRowIndices(indices: number[]): void {
        this.storeRowIndices = indices;
    }

    /** storeRowIndices を内部モジュールから取得するためのアクセサ */
    getStoreRowIndices(): number[] { return this.storeRowIndices; }

    /** 差分タブの右ペインでのパディング行（.diff-row-empty）のストア行インデックスを返す。 */
    getDiffPaddingStoreRowIndices(): readonly number[] {
        if (this.diffTab === false) throw new Error('[EditorTable] getDiffPaddingStoreRowIndices: 差分タブ以外のコンテキストで呼び出されました。呼び出し側のガード条件を確認してください。');
        return this.diffTab.computeCurrentRightPaddingStoreRowIndices();
    }

    /** FK自動埋め込み情報を取得する（InsertRowCommand / InsertRowsCommand から参照） */
    getAutoFillEntries(): Array<{ columnName: string; value: string }> {
        return this.autoFillEntries;
    }

    /**
     * 指定行にautoFillEntriesのFK値を書き込む（InsertRowCommand / InsertRowsCommand から使用）
     */
    applyAutoFillToRow(rowIndex: number): void {
        // フィルター適用時は論理行インデックスのため resolveStoreRowIndex で変換する
        const domDataRowIndex = rowIndex - 1;
        const storeRowIndex = this.resolveStoreRowIndex(domDataRowIndex);
        // 照合失敗（-1）の場合はストア更新不可。DOM更新は継続する。
        const canUpdateStore = storeRowIndex >= 0;
        for (const entry of this.autoFillEntries) {
            const colCount = this.getColumnCount();
            for (let c = 0; c < colCount; c++) {
                if (this.getColumnHeaderValue(c) !== entry.columnName) continue;
                // DOMセルを更新（参照ヒント適用のためreference.setCellValueAt()を使用）
                this.reference.setCellValueAt(rowIndex, c + this.dataColumnOffset(), entry.value);
                // ストアをインデックスベースで更新（PK未入力でも動作する）
                if (canUpdateStore) {
                    const storeColIndex = this.getStoreColumnIndex(c);
                    if (storeColIndex !== -1) this.store.updateCellValueByRowIndex(this.tableName, storeRowIndex, storeColIndex, entry.value);
                }
                break;
            }
        }
    }
}
