import {EditorTable} from "./editor-table";
import {BLAME_COLUMN_WIDTH_PX, DEFAULT_ROW_HEIGHT} from "../core/constant";
import {gitBlameAsync, gitShowAsync, gitShowFreshAsync, gitStatusAsync, BlameEntry, GitStatusResult, type GitBlameRange} from "../app/api";
import {GitDiffTracker} from "../diff/git-diff-tracker";
import {getApplicationDefaultValue, type LargeFileSettings} from "../settings/settings-schema";
import {recordGitBlameTiming} from "../app/git-blame-timing";

const BLAME_CHUNK_ROWS = 10000;
interface BlameChunks {
    rowCount: number;
    loaded: Set<number>;
}

/**
 * blame 表示と git 差分ハイライトを担当する。
 *
 * EditorTable の Object.assign パターンに合わせ、Proxy で既存ファサードへフォールバックする。
 */
export class EditorTableGit {
    [key: string]: any;
    private gitDiffMarkerRows = getApplicationDefaultValue('largeFileGitDiffMarkerRows');
    private blameEntriesByStoreRowIndex: Array<BlameEntry | undefined> = [];
    private blameChunks: BlameChunks | null = null;
    private isBlameLoading = false;
    private blameRequestId = 0;

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
     * blame情報が表示中かどうかを返す（コンテキストメニューのトグルラベル判定に使用）
     */
    isBlameShown(): boolean {
        return this.isBlameVisible || this.isBlameLoading;
    }

    /**
     * BLAME列の枠を先に表示し、git blame の取得完了後にセル内容を更新する
     */
    async showBlameAsync(): Promise<void> {
        if (this.isBlameVisible || this.isBlameLoading) return;
        const requestId = ++this.blameRequestId;
        this.isBlameLoading = true;
        const filename = 'data/' + this.tableName + '.csv';
        const timing = {requestId: '', filename};
        const showStartedAt = performance.now();
        const storeRows = this.store.getRows(this.tableName);
        const rowCount = storeRows === false ? this.storeRowIndices.length : storeRows.length;
        const chunks: BlameChunks | null = rowCount > BLAME_CHUNK_ROWS ? {rowCount, loaded: new Set()} : null;
        this.blameChunks = chunks;
        const firstChunk = chunks === null ? null : this.nextBlameChunk(chunks);
        const range = chunks === null || firstChunk === null ? undefined : this.blameChunkRange(chunks, firstChunk);
        // 応答を待つ前に列幅と選択位置を確定し、取得完了時の横ずれを防ぐ。
        const prepareStartedAt = performance.now();
        this.removeBlameCellsFromRenderedRows();
        this.isBlameVisible = true;
        this.blameEntriesByStoreRowIndex = [];
        const cellsStartedAt = performance.now();
        // blame表示中クラスを付与して行ヘッダー・corner-cellのleftをCSSでずらす
        this.element.classList.add('editor-table--blame-visible');
        // 列ヘッダー行（element.children[0]）の先頭に blame-column-header を prepend する
        const headerRow = this.gridElement.children[0] as HTMLElement;
        const blameHeaderCell = document.createElement('div');
        blameHeaderCell.classList.add('blame-column-header', 'editor-table-cell');
        blameHeaderCell.textContent = 'BLAME';
        EditorTable.applyCellWidth(blameHeaderCell, `${BLAME_COLUMN_WIDTH_PX}px`);
        EditorTable.applyCellHeight(blameHeaderCell, `${this.getHeaderLayoutHeightPx()}px`);
        headerRow.prepend(blameHeaderCell);
        // 各データ行・バッファ空行の先頭（children[0]）に blame-cell を prepend する
        // 仮想スクロールでは描画行数と論理行番号が一致しないため、描画済み行を直接走査する。
        let renderedRows = 0;
        for (const rowElement of this.getRenderedRowElements()) {
            const logicalRowIndex = this.getLogicalRowIndexFromElement(rowElement);
            if (logicalRowIndex === null || logicalRowIndex === 0) continue;
            const isEmptyRow = rowElement.classList.contains('editor-table-empty-row');
            const blameCell = this.createBlameCellForStoreRow(this.resolveStoreRowIndex(logicalRowIndex - 1), isEmptyRow);
            rowElement.prepend(blameCell);
            renderedRows++;
        }
        const selectionStartedAt = performance.now();
        // blame列挿入でDOMインデックスが1つずれるため、フォーカス位置とSelection範囲を補正する
        if (this.lastFocusedCol >= 0) this.lastFocusedCol += 1;
        this.selection.shiftColumnsBy(1);
        // blame列挿入でデータセルの絶対座標がずれるため、選択範囲の描画を再計算する
        this.selection.updateRendererAfterResize();
        const layoutStartedAt = performance.now();
        this.refreshFreezeVisualState();
        const placeholderCompletedAt = performance.now();
        let entries: BlameEntry[];
        try {
            entries = await gitBlameAsync(filename, undefined, timing, range);
        } catch (error) {
            if (this.blameRequestId !== requestId) return;
            this.hideBlame();
            recordGitBlameTiming(timing.requestId, 'show_total', performance.now() - showStartedAt, {filename, ...range, success: false});
            throw error;
        }
        if (this.blameRequestId !== requestId) return;
        if (chunks !== null && firstChunk !== null) chunks.loaded.add(firstChunk);
        this.isBlameLoading = false;
        const indexStartedAt = performance.now();
        for (const entry of entries) {
            const dataRowIndex = entry.lineNumber - 2;
            if (dataRowIndex >= 0) this.blameEntriesByStoreRowIndex[dataRowIndex] = entry;
        }
        const updateStartedAt = performance.now();
        // 読み込み中のスクロールで行が入れ替わるため、現在描画中のセルを更新する。
        this.updateRenderedBlameCells(null);
        const refreshStartedAt = performance.now();
        this.refreshDetachedHeaderLayout();
        const completedAt = performance.now();
        // 計測ログのDOM更新が各段階の計測に混ざらないよう、表示反映後にまとめて記録する。
        const stages: Array<[string, number]> = [
            ['prepare_rendered_rows', cellsStartedAt - prepareStartedAt],
            ['index_entries', updateStartedAt - indexStartedAt],
            ['insert_blame_cells', selectionStartedAt - cellsStartedAt],
            ['update_blame_cells', refreshStartedAt - updateStartedAt],
            ['update_selection', layoutStartedAt - selectionStartedAt],
            ['refresh_layout', placeholderCompletedAt - layoutStartedAt + completedAt - refreshStartedAt],
            ['show_total', completedAt - showStartedAt],
        ];
        for (const [stage, durationMs] of stages) {
            recordGitBlameTiming(timing.requestId, stage, durationMs, {filename, ...range, entryCount: entries.length, renderedRows});
        }
        if (chunks !== null) void this.loadRemainingBlameChunksAsync(chunks, filename, timing.requestId, showStartedAt, completedAt - showStartedAt);
    }

    private blameChunkRange(chunks: BlameChunks, chunk: number): GitBlameRange {
        return {startLine: chunk * BLAME_CHUNK_ROWS + 2, endLine: Math.min((chunk + 1) * BLAME_CHUNK_ROWS, chunks.rowCount) + 1};
    }

    /** 毎回現在の表示範囲を読み直す。ソート/フィルター後もCSVの行番号で範囲を選ぶ。 */
    private nextBlameChunk(chunks: BlameChunks): number | null {
        const chunkCount = Math.ceil(chunks.rowCount / BLAME_CHUNK_ROWS);
        const start = this.getVirtualScrollRenderedStart();
        const end = this.getVirtualScrollRenderedEnd();
        const centerRow = Math.min(Math.floor((start + end) / 2), this.getFilteredDataRowCount() - 1);
        const centerStoreRow = this.resolveStoreRowIndex(centerRow);
        const centerChunk = Math.max(0, Math.min(chunkCount - 1, Math.floor(centerStoreRow / BLAME_CHUNK_ROWS)));
        if (!chunks.loaded.has(centerChunk)) return centerChunk;
        // 表示範囲がチャンク境界をまたぐ場合と固定行も、周辺の先読みより優先する。
        for (const rowElement of this.getRenderedRowElements()) {
            const logicalRowIndex = this.getLogicalRowIndexFromElement(rowElement);
            if (logicalRowIndex === null || logicalRowIndex === 0) continue;
            const storeRowIndex = this.resolveStoreRowIndex(logicalRowIndex - 1);
            if (storeRowIndex < 0 || storeRowIndex >= chunks.rowCount) continue;
            const chunk = Math.floor(storeRowIndex / BLAME_CHUNK_ROWS);
            if (!chunks.loaded.has(chunk)) return chunk;
        }
        for (let distance = 1; distance < chunkCount; distance++) {
            const above = centerChunk - distance;
            if (above >= 0 && !chunks.loaded.has(above)) return above;
            const below = centerChunk + distance;
            if (below < chunkCount && !chunks.loaded.has(below)) return below;
        }
        return null;
    }

    private async loadRemainingBlameChunksAsync(chunks: BlameChunks, filename: string, firstRequestId: string, startedAt: number, firstShowDurationMs: number): Promise<void> {
        try {
            while (this.blameChunks === chunks && this.isBlameVisible) {
                // 画面更新と入力のために制御を返す。同時に走らせるGitコマンドは1件だけ。
                await new Promise<void>(resolve => setTimeout(resolve, 50));
                if (this.blameChunks !== chunks || !this.isBlameVisible || !this.element.isConnected) return;
                const chunk = this.nextBlameChunk(chunks);
                if (chunk === null) {
                    this.blameChunks = null;
                    recordGitBlameTiming(firstRequestId, 'load_all_chunks_total', performance.now() - startedAt, {filename, chunkCount: chunks.loaded.size, firstShowDurationMs});
                    return;
                }
                const range = this.blameChunkRange(chunks, chunk);
                const timing = {requestId: '', filename};
                const chunkStartedAt = performance.now();
                const entries = await gitBlameAsync(filename, undefined, timing, range);
                // 解除・タブ切替・行構造変更・再表示後に古いレスポンスを適用しない。
                if (this.blameChunks !== chunks || !this.isBlameVisible || !this.element.isConnected) return;
                chunks.loaded.add(chunk);
                const indexStartedAt = performance.now();
                for (const entry of entries) {
                    const storeRowIndex = entry.lineNumber - 2;
                    if (storeRowIndex >= 0) this.blameEntriesByStoreRowIndex[storeRowIndex] = entry;
                }
                const cellsStartedAt = performance.now();
                const renderedRows = this.updateRenderedBlameCells(range);
                const layoutStartedAt = performance.now();
                if (renderedRows > 0) this.refreshDetachedHeaderLayout();
                const completedAt = performance.now();
                for (const [stage, durationMs] of [
                    ['index_entries', cellsStartedAt - indexStartedAt],
                    ['update_blame_cells', layoutStartedAt - cellsStartedAt],
                    ['refresh_layout', completedAt - layoutStartedAt],
                    ['chunk_total', completedAt - chunkStartedAt],
                ] as const) {
                    recordGitBlameTiming(timing.requestId, stage, durationMs, {filename, ...range, firstRequestId, entryCount: entries.length, renderedRows});
                }
            }
        } catch (error) {
            if (this.blameChunks !== chunks) return;
            recordGitBlameTiming(firstRequestId, 'load_all_chunks_total', performance.now() - startedAt, {filename, firstShowDurationMs, success: false, error: String(error)});
            this.hideBlame();
            console.error('BLAMEのバックグラウンド取得に失敗しました。', error);
        }
    }

    /**
     * 各行の children[0] に挿入された blame-cell / blame-column-header を除去して非表示にする
     */
    hideBlame(): void {
        const wasBlameVisible = this.isBlameVisible;
        ++this.blameRequestId;
        this.isBlameLoading = false;
        this.isBlameVisible = false;
        this.blameChunks = null;
        this.blameEntriesByStoreRowIndex = [];
        this.element.classList.remove('editor-table--blame-visible');
        this.removeBlameCellsFromRenderedRows();
        // blame列除去でDOMインデックスが1つ戻るため、フォーカス位置とSelection範囲を補正する
        if (wasBlameVisible && this.lastFocusedCol >= 0) this.lastFocusedCol -= 1;
        if (wasBlameVisible) this.selection.shiftColumnsBy(-1);
        // blame列除去でデータセルの絶対座標が戻るため、選択範囲の描画を再計算する
        this.selection.updateRendererAfterResize();
        this.refreshFreezeVisualState();
    }

    createBlameCellForDataRow(dataRowIndex: number, isEmptyRow: boolean): HTMLElement {
        return this.createBlameCellForStoreRow(this.storeRowIndices[dataRowIndex], isEmptyRow);
    }

    private createBlameCellForStoreRow(storeRowIndex: number, isEmptyRow: boolean): HTMLElement {
        const blameCell = document.createElement('div');
        blameCell.classList.add('blame-cell', 'editor-table-cell');
        EditorTable.applyCellWidth(blameCell, `${BLAME_COLUMN_WIDTH_PX}px`);
        EditorTable.applyCellHeight(blameCell, DEFAULT_ROW_HEIGHT);
        if (isEmptyRow) return blameCell;
        this.updateBlameCell(blameCell, storeRowIndex);
        return blameCell;
    }

    private updateRenderedBlameCells(range: GitBlameRange | null): number {
        let renderedRows = 0;
        for (const rowElement of this.getRenderedRowElements()) {
            const logicalRowIndex = this.getLogicalRowIndexFromElement(rowElement);
            if (logicalRowIndex === null || logicalRowIndex === 0 || rowElement.classList.contains('editor-table-empty-row')) continue;
            const storeRowIndex = this.resolveStoreRowIndex(logicalRowIndex - 1);
            if (range !== null && (storeRowIndex + 2 < range.startLine || storeRowIndex + 2 > range.endLine)) continue;
            const cell = rowElement.querySelector('.blame-cell');
            if (cell === null) continue;
            this.updateBlameCell(cell, storeRowIndex);
            renderedRows++;
        }
        return renderedRows;
    }

    private updateBlameCell(blameCell: HTMLElement, storeRowIndex: number): void {
        blameCell.replaceChildren();
        blameCell.removeAttribute('title');
        blameCell.removeAttribute('role');
        blameCell.removeAttribute('aria-label');
        const entry = this.blameEntriesByStoreRowIndex[storeRowIndex];
        if (entry === undefined) {
            if (storeRowIndex >= 0 && (this.isBlameLoading || (this.blameChunks !== null && storeRowIndex < this.blameChunks.rowCount
                && !this.blameChunks.loaded.has(Math.floor(storeRowIndex / BLAME_CHUNK_ROWS))))) {
                blameCell.textContent = '…';
                blameCell.title = '変更履歴を読み込み中';
            }
            return;
        }
        blameCell.title = '最終変更: ' + entry.author + '（' + entry.date + '）';
        blameCell.setAttribute('role', 'note');
        blameCell.setAttribute('aria-label', '最終変更: ' + entry.author + '（' + entry.date + '）');
        const authorSpan = document.createElement('span');
        authorSpan.classList.add('blame-author');
        authorSpan.textContent = entry.author;
        blameCell.appendChild(authorSpan);
        const dateSpan = document.createElement('span');
        dateSpan.classList.add('blame-date');
        dateSpan.textContent = entry.date;
        blameCell.appendChild(dateSpan);
    }

    moveBlameEntry(fromDomDataRowIndex: number, toDomDataRowIndex: number): void {
        if (this.isBlameLoading || this.blameChunks !== null) {
            this.hideBlame();
            return;
        }
        if (this.blameEntriesByStoreRowIndex.length === 0) return;
        const entries = (this.storeRowIndices as number[]).map(index => this.blameEntriesByStoreRowIndex[index]);
        const [entry] = entries.splice(fromDomDataRowIndex, 1);
        entries.splice(toDomDataRowIndex, 0, entry);
        this.blameEntriesByStoreRowIndex = entries;
    }

    /**
     * blame表示中であれば自動的に非表示にする。
     * 行構造変更（ソート・フィルター・行追加/削除・行移動・タブ切替リロード）の冒頭で呼ぶ。
     * blameはgit committed dataのため、テーブル内容が変更された時点で陳腐化する。
     */
    hideBlameIfVisible(): void {
        if (this.isBlameVisible || this.isBlameLoading) this.hideBlame();
    }

    private removeBlameCellsFromRenderedRows(): void {
        // ヘッダー・固定行・表示範囲の行を対象にし、末尾までスクロールしていても取り残さない。
        for (const rowElement of this.getRenderedRowElements()) {
            for (const child of Array.from(rowElement.children)) {
                if (!(child instanceof HTMLElement)) continue;
                if (child.classList.contains('blame-cell') || child.classList.contains('blame-column-header')) child.remove();
            }
        }
    }


    /**
     * git差分トラッカーを接続する
     * refreshGitDiffAsync内からのみ呼ばれる
     */
    connectGitDiffTracker(tracker: GitDiffTracker): void {
        this.gitDiffTracker = tracker;
    }

    setLargeFileSettings(settings: LargeFileSettings): void {
        this.gitDiffMarkerRows = settings.gitDiffMarkerRows;
    }

    /**
     * 1セル分のgit差分ハイライトを更新する
     * gitDiffTracker が設定済み（false でない）であることを呼び出し側で保証すること
     */
    updateSingleCellGitHighlight(cell: HTMLElement, storeRows: string[][], storeRowIndex: number, columnIndex: number): void {
        if ((this.gitDiffTracker as GitDiffTracker).isCellChanged(storeRows, storeRowIndex, columnIndex)) {
            cell.classList.add('cell-git-changed');
        } else {
            cell.classList.remove('cell-git-changed');
        }
    }

    /**
     * 全データセルを走査し、gitのHEAD版との差分に応じて .cell-git-changed クラスを付与/除去する。
     * テーブルオープン時・行挿入・削除・バッファ行昇格・降格・保存後に呼ばれる。
     * gitDiffTracker が false（未接続またはgit差分なし）の場合は全セルからクラスを除去して返す。
     */
    applyGitDiffHighlight(): void {
        const rowCount = this.getRowCount();
        const totalColCount = this.getTotalColumnCount();
        if (this.gitDiffTracker === false) {
            // git差分トラッカーが未接続 or 差分なし → DOMに存在する全セルからハイライトを除去する
            // （保存後にgit statusから差分が消えたケースに対応）
            const offset = this.dataColumnOffset();
            for (let row = 1; row < rowCount; row++) {
                const rowElement = this.getRowElement(row);
                if (!rowElement) continue;
                if (rowElement.classList.contains('editor-table-empty-row')) continue;
                for (let col = offset; col < totalColCount; col++) {
                    this.getCell(row, col).classList.remove('cell-git-changed');
                }
            }
            // git変更なし → スクロールバーマーカーもクリアする
            this.currentGitChangedDomRows = new Set();
            this.refreshScrollbarMarkers();
            return;
        }
        const storeRows = this.store.getRows(this.tableName);
        if (storeRows === false) {
            // ストアデータが存在しない場合はgit変更マーカーをクリアする
            this.currentGitChangedDomRows = new Set();
            this.refreshScrollbarMarkers();
            return;
        }
        // DOM列インデックス（0始まり）→ ストア（CSV）列インデックスのマッピングを取得する。
        // 非連番keyスキーマではDOMインデックスとCSVインデックスが一致しないため変換が必須。
        const columnMapping = this.tableData.columnMapping;
        const offset2 = this.dataColumnOffset();
        // ストアベースで全データ行を走査し、git変更行・列のデータ行インデックスを収集する。
        // 仮想スクロール時はDOMに表示範囲の行しか存在しないため、DOM走査では全行を検出できない。
        // マーカー描画にはDOMに存在しない行のインデックスも必要なのでストア全行を走査する。
        const changedDataRows = new Set<number>();
        const dataRowCount = this.storeRowIndices.length;
        if (dataRowCount <= this.gitDiffMarkerRows) {
            for (let dataRowIndex = 0; dataRowIndex < dataRowCount; dataRowIndex++) {
                const storeRowIndex = this.storeRowIndices[dataRowIndex];
                let hasChanged = false;
                for (let domColIndex = 0; domColIndex < columnMapping.length; domColIndex++) {
                    const storeColIndex = columnMapping[domColIndex];
                    if (storeColIndex === -1) continue;
                    if (this.gitDiffTracker.isCellChanged(storeRows, storeRowIndex, storeColIndex)) {
                        if (!hasChanged) hasChanged = true;
                    }
                }
                if (hasChanged) changedDataRows.add(dataRowIndex);
            }
        }
        // 大量行ではマーカー用の全行走査を省く。表示中セルの差分ハイライトは下で通常どおり適用する。
        // DOMに存在する行にのみ cell-git-changed クラスを適用/除去する
        for (let row = 1; row < rowCount; row++) {
            const rowElement = this.getRowElement(row);
            if (!rowElement) continue;
            if (rowElement.classList.contains('editor-table-empty-row')) continue;
            if (rowElement.classList.contains('diff-row-empty')) continue;
            // フィルター適用時は論理行インデックスのため resolveStoreRowIndex で変換する
            const domDataRowIndex = row - 1;
            if (domDataRowIndex >= dataRowCount) continue;
            const storeRowIndex = this.resolveStoreRowIndex(domDataRowIndex);
            if (storeRowIndex < 0) continue;
            for (let col = offset2; col < totalColCount; col++) {
                const domColIndex = col - offset2;
                const storeColIndex = columnMapping[domColIndex];
                if (storeColIndex === -1) continue;
                const cell = this.getCell(row, col);
                this.updateSingleCellGitHighlight(cell, storeRows, storeRowIndex, storeColIndex);
            }
        }
        // git変更行・列をスクロールバーマーカーに反映する
        this.currentGitChangedDomRows = changedDataRows;
        this.refreshScrollbarMarkers();
    }

    /**
     * git statusを再問い合わせし、このテーブルの GitDiffTracker を再構築して全セルのハイライトを再適用する。
     * テーブルオープン時および保存後（markSavedAndUpdatePanel）に呼ばれ、差分状態をセルに反映する。
     * git statusの取得に失敗した場合（git管理外環境等）は何もしない。
     */
    async refreshGitDiffAsync(statusResult?: GitStatusResult | false): Promise<void> {
        const requestId = ++this.refreshGitDiffRequestId;
        let currentStatusResult = statusResult;
        if (currentStatusResult === false) {
            this.gitDiffTracker = false;
            this.applyGitDiffHighlight();
            this.currentGitChangedDomRows = new Set();
            this.refreshScrollbarMarkers();
            return;
        }
        if (currentStatusResult === undefined) {
            try {
                currentStatusResult = await gitStatusAsync();
            } catch (e) {
                // gitリポジトリでない環境や通信エラーでは差分ハイライト更新をスキップする
                console.warn('[EditorTable] refreshGitDiffAsync: git status の取得に失敗しました:', e);
                // git変更マーカーをクリアする（古いマーカーが残存するのを防止）
                this.currentGitChangedDomRows = new Set();
                this.refreshScrollbarMarkers();
                return;
            }
        }
        // awaitで中断中に新しいリクエストが来た場合は処理を破棄する
        if (requestId !== this.refreshGitDiffRequestId) return;
        const entryIndex = currentStatusResult.changes.findIndex(e => e.tableName === this.tableName);
        if (entryIndex === -1) {
            // changesに含まれない場合は差分なし → トラッカーをfalseにリセットして全ハイライトを除去する
            this.gitDiffTracker = false;
            this.applyGitDiffHighlight();
            return;
        }
        const entry = currentStatusResult.changes[entryIndex];
        // PK列が定義されていない場合はハイライト不要（空キーで全行が一致扱いになるのを防ぐ）
        if (this.tableData.primaryKeyColumns.length === 0) {
            this.gitDiffTracker = false;
            this.applyGitDiffHighlight();
            return;
        }
        // 複合PKのストア（CSV）列インデックスを取得する（いずれか1列でも見つからない場合はハイライト不可）
        // GitDiffTracker はストア行（CSV列順）に対してインデックスを使うため、DOM列インデックスではなく
        // ストア列インデックスを使う必要がある。ストアヘッダーから列名で検索する。
        const storeHeader = this.store.getHeader(this.tableName);
        if (storeHeader === false) {
            this.gitDiffTracker = false;
            this.applyGitDiffHighlight();
            return;
        }
        const pkColumnIndices: number[] = [];
        for (const pkColName of this.tableData.primaryKeyColumns) {
            const idx = storeHeader.indexOf(pkColName);
            if (idx === -1) {
                // PKカラムが見つからない場合はトラッカーをリセットして中途半端なハイライトを除去する
                this.gitDiffTracker = false;
                this.applyGitDiffHighlight();
                return;
            }
            pkColumnIndices.push(idx);
        }
        if (entry.isNew) {
            // HEADに存在しない新規テーブル → 全セルchanged
            const tracker = GitDiffTracker.createForNewTable(pkColumnIndices);
            this.connectGitDiffTracker(tracker);
        } else {
            // 既存テーブルの変更 → HEAD版CSVを取得してPKベースのマップを構築する
            let headCsv: string;
            try {
                headCsv = await gitShowAsync(entry.path);
            } catch (e) {
                // awaitで中断中に新しいリクエストが来た場合は処理を破棄する
                if (requestId !== this.refreshGitDiffRequestId) return;
                console.warn('[EditorTable] refreshGitDiffAsync: HEAD版CSVの取得に失敗しました:', e);
                this.gitDiffTracker = false;
                this.applyGitDiffHighlight();
                return;
            }
            // awaitで中断中に新しいリクエストが来た場合は処理を破棄する
            if (requestId !== this.refreshGitDiffRequestId) return;
            const headRowMap = GitDiffTracker.buildHeadRowMap(headCsv, pkColumnIndices, storeHeader);
            const tracker = new GitDiffTracker(headRowMap, pkColumnIndices, false);
            this.connectGitDiffTracker(tracker);
        }
        // トラッカー再構築後に全セルのハイライトを一括再適用する
        this.applyGitDiffHighlight();
    }

    /**
     * 差分タブの右ペイン保存後にgit差分ハイライトを更新する。
     * 通常テーブルの refreshGitDiffAsync は git status でテーブル名を検索するが、
     * 差分タブの tableName は "xxx:diff:current" という仮名のため git status では見つからない。
     * 代わりに gitPath（gitルート相対のファイルパス）を使って gitShowAsync でHEAD版CSVを取得し、
     * GitDiffTracker を再構築して全セルのハイライトを再適用する。
     *
     * gitPath: source-control-panel.ts の entry.path をそのまま引き回したもの。
     *          サブディレクトリ環境では "subdir/data/xxx.csv" 形式になる。
     */
    async refreshGitDiffForDiffTabAsync(gitPath: string): Promise<void> {
        const requestId = ++this.refreshGitDiffRequestId;
        // PK列が定義されていない場合はハイライト不要
        if (this.tableData.primaryKeyColumns.length === 0) {
            this.gitDiffTracker = false;
            this.applyGitDiffHighlight();
            return;
        }
        // ストアヘッダーからPK列インデックスを解決する
        // ストアキーは this.tableName（"xxx:diff:current"）で登録されている
        const storeHeader = this.store.getHeader(this.tableName);
        if (storeHeader === false) {
            this.gitDiffTracker = false;
            this.applyGitDiffHighlight();
            return;
        }
        const pkColumnIndices: number[] = [];
        for (const pkColName of this.tableData.primaryKeyColumns) {
            const idx = storeHeader.indexOf(pkColName);
            if (idx === -1) {
                this.gitDiffTracker = false;
                this.applyGitDiffHighlight();
                return;
            }
            pkColumnIndices.push(idx);
        }
        // gitPath（gitルート相対パス）を使ってHEAD版CSVを取得する。
        // 保存直後の再取得のためキャッシュをバイパスしてC#へ直接問い合わせる。
        // キャッシュ済みの古いHEAD版CSVを返すと、保存後のエラー注入や
        // HEAD版の変化を検出できなくなるため gitShowFreshAsync を使用する。
        let headCsv: string;
        try {
            headCsv = await gitShowFreshAsync(gitPath);
        } catch (e) {
            // awaitで中断中に新しいリクエストが来た場合は処理を破棄する
            if (requestId !== this.refreshGitDiffRequestId) return;
            const message = e instanceof Error ? e.message : String(e);
            if (message.includes('does not exist')) {
                // HEADに存在しない（新規テーブル等） → 全セルchanged
                const tracker = GitDiffTracker.createForNewTable(pkColumnIndices);
                this.connectGitDiffTracker(tracker);
            } else {
                // バリデーションエラー等その他のエラー → ハイライトなし
                this.gitDiffTracker = false;
            }
            this.applyGitDiffHighlight();
            return;
        }
        // awaitで中断中に新しいリクエストが来た場合は処理を破棄する
        if (requestId !== this.refreshGitDiffRequestId) return;
        const headRowMap = GitDiffTracker.buildHeadRowMap(headCsv, pkColumnIndices, storeHeader);
        const tracker = new GitDiffTracker(headRowMap, pkColumnIndices, false);
        this.connectGitDiffTracker(tracker);
        this.applyGitDiffHighlight();
    }


}
