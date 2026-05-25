import {EditorTable} from "./editor-table";
import {DEFAULT_ROW_HEIGHT} from "../core/constant";
import {gitBlameAsync, gitShowAsync, gitShowFreshAsync, gitStatusAsync, BlameEntry, GitStatusResult} from "../app/api";
import {GitDiffTracker} from "../diff/git-diff-tracker";

const MAX_GIT_DIFF_MARKER_ROWS = 100000;

/**
 * blame 表示と git 差分ハイライトを担当する。
 *
 * EditorTable の Object.assign パターンに合わせ、Proxy で既存ファサードへフォールバックする。
 */
export class EditorTableGit {
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
     * blame情報が表示中かどうかを返す（コンテキストメニューのトグルラベル判定に使用）
     */
    isBlameShown(): boolean {
        return this.isBlameVisible;
    }

    /**
     * git blame を実行して各行の先頭（children[0]）に独立した blame-cell を挿入する
     */
    async showBlameAsync(): Promise<void> {
        const filename = 'data/' + this.tableName + '.csv';
        const entries = await gitBlameAsync(filename);
        this.isBlameVisible = true;
        // blame表示中クラスを付与して行ヘッダー・corner-cellのleftをCSSでずらす
        this.element.classList.add('editor-table--blame-visible');
        // 列ヘッダー行（element.children[0]）の先頭に blame-column-header を prepend する
        const headerRow = this.gridElement.children[0] as HTMLElement;
        const blameHeaderCell = document.createElement('div');
        blameHeaderCell.classList.add('blame-column-header', 'editor-table-cell');
        blameHeaderCell.textContent = 'BLAME';
        EditorTable.applyCellHeight(blameHeaderCell, DEFAULT_ROW_HEIGHT);
        headerRow.prepend(blameHeaderCell);
        // 行番号→BlameEntryの高速ルックアップマップを構築する
        const blameMap = new Map<number, BlameEntry>();
        for (let i = 0; i < entries.length; i++) {
            blameMap.set(entries[i].lineNumber, entries[i]);
        }
        // 各データ行・バッファ空行の先頭（children[0]）に blame-cell を prepend する
        const rowCount = this.getRowCount();
        for (let row = 1; row < rowCount; row++) {
            const rowElement = this.getRowElement(row);
            if (!rowElement) continue;
            const isEmptyRow = rowElement.classList.contains('editor-table-empty-row');
            const rowHeader = rowElement.querySelector('.editor-table-row-header') as HTMLElement | null;
            const rowIndexStr = rowHeader !== null ? rowHeader.dataset.rowIndex : null;
            // blame-cell は全行（バッファ空行含む）に追加してレイアウトを統一する
            const blameCell = document.createElement('div');
            blameCell.classList.add('blame-cell', 'editor-table-cell');
            EditorTable.applyCellHeight(blameCell, DEFAULT_ROW_HEIGHT);
            if (!isEmptyRow && rowIndexStr) {
                // data-rowIndex はCSVヘッダー行を除いたデータ行の0始まりインデックス。
                // git blame の lineNumber はCSVファイルの1始まり行番号で、行1がCSVヘッダー。
                // データ行0 → CSVファイル行2（ヘッダー行1行 + 0始まり→1始まり）
                const lineNumber = parseInt(rowIndexStr) + 2;
                const entry = blameMap.get(lineNumber);
                if (entry) {
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
            }
            rowElement.prepend(blameCell);
        }
        // blame列挿入でDOMインデックスが1つずれるため、フォーカス位置とSelection範囲を補正する
        if (this.lastFocusedCol >= 0) this.lastFocusedCol += 1;
        this.selection.shiftColumnsBy(1);
        // blame列挿入でデータセルの絶対座標がずれるため、選択範囲の描画を再計算する
        this.selection.updateRendererAfterResize();
        this.refreshFreezeVisualState();
    }

    /**
     * 各行の children[0] に挿入された blame-cell / blame-column-header を除去して非表示にする
     */
    hideBlame(): void {
        this.isBlameVisible = false;
        this.element.classList.remove('editor-table--blame-visible');
        // 各行の children[0]（blame-cell または blame-column-header）を除去する
        const rowCount = this.getRowCount();
        for (let row = 0; row < rowCount; row++) {
            const rowElement = this.getRowElement(row);
            if (!rowElement) continue;
            const firstChild = rowElement.children[0] as HTMLElement;
            if (firstChild && (firstChild.classList.contains('blame-cell') || firstChild.classList.contains('blame-column-header'))) {
                firstChild.remove();
            }
        }
        // blame列除去でDOMインデックスが1つ戻るため、フォーカス位置とSelection範囲を補正する
        if (this.lastFocusedCol >= 0) this.lastFocusedCol -= 1;
        this.selection.shiftColumnsBy(-1);
        // blame列除去でデータセルの絶対座標が戻るため、選択範囲の描画を再計算する
        this.selection.updateRendererAfterResize();
        this.refreshFreezeVisualState();
    }

    /**
     * blame表示中であれば自動的に非表示にする。
     * 行構造変更（ソート・フィルター・行追加/削除・行移動・タブ切替リロード）の冒頭で呼ぶ。
     * blameはgit committed dataのため、テーブル内容が変更された時点で陳腐化する。
     */
    hideBlameIfVisible(): void {
        if (this.isBlameVisible) this.hideBlame();
    }


    /**
     * git差分トラッカーを接続する
     * refreshGitDiffAsync内からのみ呼ばれる
     */
    connectGitDiffTracker(tracker: GitDiffTracker): void {
        this.gitDiffTracker = tracker;
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
        if (dataRowCount <= MAX_GIT_DIFF_MARKER_ROWS) {
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
