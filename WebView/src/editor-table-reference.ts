import {EditorTable} from "./editor-table";
import {EditorTableData} from "./model/editor-table-data";
import {ReferenceDataCache} from "./reference-data-cache";
import {parseReferenceExpression, isDynamicReference, isSimpleReference} from "./reference-expression";
import {ReverseReferenceEntry, ReverseReferenceMap, formatReverseReferenceHint} from "./reverse-reference-resolver";
import {config} from "./config";
import {sanitizeHtml} from "./html-sanitizer";


/**
 * 参照ヒント管理モジュール
 *
 * 責務:
 * - セル値設定時の参照ヒント（FK→表示名）の表示
 * - 逆参照ヒント（PK→参照元）の管理
 * - 動的参照（二段リスト）のヒント解決
 * - 表示列変更時の参照ヒント同期更新
 */
export class EditorTableReference {
    private readonly table: EditorTable;
    private readonly tableData: EditorTableData;
    private readonly referenceDataCache: ReferenceDataCache;
    /** 逆参照マップ（参照先列の値→逆参照エントリ配列） */
    private reverseReferenceMap: ReverseReferenceMap | false;

    constructor(table: EditorTable, tableData: EditorTableData, referenceDataCache: ReferenceDataCache) {
        this.table = table;
        this.tableData = tableData;
        this.referenceDataCache = referenceDataCache;
        this.reverseReferenceMap = false;
    }

    /**
     * 座標でセルの値を設定する（参照ヒント付き）
     * @param row 行インデックス（0始まり、列ヘッダー行を含む）
     * @param column 列インデックス（0始まり、行ヘッダーセルを含む）
     * @param value セルの値
     */
    setCellValueAt(row: number, column: number, value: string): void {
        const cell = this.table.getCell(row, column);
        const dataColumnIndex = column - 1;
        this.setCellValue(cell, value, dataColumnIndex, row);
        // 変更された列に依存する動的参照列のヒントを再評価する（二段リスト対応）
        this.updateDependentColumnsInRow(row, dataColumnIndex);
        // 表示列の変更時に同一行の参照ヒントを同期更新する（逆参照チェーン対応）
        this.updateReferenceHintsOnDisplayColumnChange(row, dataColumnIndex, value);
    }

    /**
     * セルの値を設定する（参照ヒント付き）
     * @param cell セル要素
     * @param value セルの値
     * @param dataColumnIndex データ列のインデックス（0始まり）
     * @param rowIndex 行インデックス（動的参照の解決に使用）
     */
    setCellValue(cell: HTMLElement, value: string, dataColumnIndex: number, rowIndex: number): void {
        // 既存の参照ヒントを削除
        const existingHint = cell.querySelector('.cell-reference-hint');
        if (existingHint) {
            existingHint.remove();
        }
        // 既存の逆参照ヒントを削除
        const existingReverseHint = cell.querySelector('.cell-reverse-reference-hint');
        if (existingReverseHint) {
            existingReverseHint.remove();
        }
        // 参照列かどうかを判定
        const column = this.tableData.header[dataColumnIndex];
        if (!column || !column.reference) {
            // 参照列でなければ通常のテキストコンテンツを設定
            this.applyTextOrHtml(cell, value, column ? column.renderAsHtml : false);
            // PK列の場合は逆参照ヒントを再適用（全parentColumnNameの列値でエントリを収集）
            if (column && this.tableData.primaryKeyColumns.includes(column.name)) {
                const allEntries: ReverseReferenceEntry[] = [];
                for (const colName of this.getAllParentColumnNames()) {
                    const colDataIndex = this.tableData.header.findIndex(h => h.name === colName);
                    if (colDataIndex === -1) continue;
                    const colValue = this.table.getCellValueAt(rowIndex, colDataIndex + 1);
                    if (colValue === '') continue;
                    if (!this.reverseReferenceMap) continue;
                    const entries = this.reverseReferenceMap.get(colValue);
                    if (!entries) continue;
                    for (const entry of entries) {
                        if (entry.parentColumnName === colName) allEntries.push(entry);
                    }
                }
                this.applyReverseReferenceHintFromEntries(cell, allEntries);
            }
            return;
        }
        // 値を設定（参照列でも renderAsHtml を考慮）
        this.applyTextOrHtml(cell, value, column.renderAsHtml);
        // 参照式をパース
        const expr = parseReferenceExpression(column.reference);
        if (isDynamicReference(expr)) {
            // 動的参照の場合: 同期的に参照ヒントを更新
            this.updateDynamicReferenceHint(cell, value, expr, rowIndex, dataColumnIndex);
            return;
        }
        // 単純参照の場合: 同期的に参照ヒントを取得
        const displayText = this.referenceDataCache.getDisplayTextById(expr.tableName, value);
        // 参照ヒントを追加（表示テキストがある場合のみ）
        if (displayText) {
            const hintSpan = document.createElement('span');
            hintSpan.classList.add('cell-reference-hint');
            hintSpan.textContent = displayText;
            cell.appendChild(hintSpan);
        }
    }

    /**
     * 参照データのpreload完了後にセルの参照ヒントを更新する
     */
    updateReferenceHints(): void {
        this.updateReferenceHintsForRows(1, this.table.getTableElement().children.length);
    }

    /**
     * 指定DOM行範囲のセルの参照ヒントを更新する
     * 行再構築で新しく作成されたDOM行に対して参照ヒントを適用する
     * @param startDomRow DOM行の開始インデックス（含む）
     * @param endDomRow DOM行の終了インデックス（含まない）
     */
    updateReferenceHintsForRows(startDomRow: number, endDomRow: number): void {
        const tableElement = this.table.getTableElement();
        for (let rowIndex = startDomRow; rowIndex < endDomRow; rowIndex++) {
            const row = tableElement.children[rowIndex] as HTMLElement;
            if (!row) throw new Error(`DOM行が見つかりません: rowIndex=${rowIndex}`);
            for (let colIndex = 1; colIndex < row.children.length; colIndex++) {
                const cell = row.children[colIndex] as HTMLElement;
                const dataColumnIndex = colIndex - 1;
                const value = EditorTable.getCellValue(cell);
                this.setCellValue(cell, value, dataColumnIndex, rowIndex);
            }
        }
    }

    /**
     * 指定した列のすべてのセルの参照ヒントを更新する
     */
    updateColumnReferenceHints(columnIndex: number): void {
        const tableElement = this.table.getTableElement();
        for (let rowIndex = 1; rowIndex < tableElement.children.length; rowIndex++) {
            const row = tableElement.children[rowIndex] as HTMLElement;
            const cell = row.children[columnIndex + 1] as HTMLElement;
            if (cell) {
                const value = EditorTable.getCellValue(cell);
                this.setCellValue(cell, value, columnIndex, rowIndex);
            }
        }
    }

    /**
     * 逆参照ヒントを更新する
     * ReverseReferenceResolver の結果を受け取り、PK列のセルに逆参照ヒントspanを追加する
     * 非PK列参照にも対応するため、全 parentColumnName に対応する列値でマップをルックアップし、
     * 得られた全エントリをPK列セルに適用する
     */
    updateReverseReferenceHints(map: ReverseReferenceMap): void {
        this.reverseReferenceMap = map;
        const tableElement = this.table.getTableElement();
        // PK列のインデックスを取得（ヒントの表示先は最初のPK列）
        const pkColumnIndex = this.tableData.header.findIndex(col => col.name === this.tableData.primaryKeyColumns[0]);
        if (pkColumnIndex === -1) return;
        // 逆参照マップで使われている全 parentColumnName とそのデータ列インデックスを事前計算する
        const parentColumnIndices = new Map<string, number>();
        for (const colName of this.getAllParentColumnNames()) {
            const idx = this.tableData.header.findIndex(col => col.name === colName);
            if (idx !== -1) parentColumnIndices.set(colName, idx);
        }
        // 全データ行のPK列セルに逆参照ヒントを適用する
        for (let rowIndex = 1; rowIndex < tableElement.children.length; rowIndex++) {
            const row = tableElement.children[rowIndex] as HTMLElement;
            const pkCell = row.children[pkColumnIndex + 1] as HTMLElement;
            if (!pkCell) continue;
            // 全 parentColumnName の列値でエントリを収集する
            const allEntries: ReverseReferenceEntry[] = [];
            for (const [colName, colIdx] of parentColumnIndices) {
                const colCell = row.children[colIdx + 1] as HTMLElement;
                if (!colCell) continue;
                const colValue = EditorTable.getCellValue(colCell);
                if (colValue === '') continue;
                const entries = this.reverseReferenceMap.get(colValue);
                if (!entries) continue;
                for (const entry of entries) {
                    if (entry.parentColumnName === colName) allEntries.push(entry);
                }
            }
            // 収集した全エントリでヒントを表示する
            this.applyReverseReferenceHintFromEntries(pkCell, allEntries);
        }
    }

    /**
     * 逆参照マップにエントリが存在するか判定する
     */
    hasReverseReferences(): boolean {
        if (!this.reverseReferenceMap) return false;
        return this.reverseReferenceMap.size > 0;
    }

    /**
     * 参照先列の値から逆参照エントリを取得する
     * Map.get()の戻り値がundefined許容のため ?? で空配列に変換
     */
    getReverseReferenceEntries(columnValue: string): ReverseReferenceEntry[] {
        if (!this.reverseReferenceMap) return [];
        const entries = this.reverseReferenceMap.get(columnValue);
        if (!entries) return [];
        return entries;
    }

    /**
     * 逆参照マップ内で使われている全 parentColumnName の集合を返す
     * relations-panel.ts の1:N解決で「どの列値でルックアップするか」を決定するために使用する
     */
    getAllParentColumnNames(): Set<string> {
        const result = new Set<string>();
        if (!this.reverseReferenceMap) return result;
        this.reverseReferenceMap.forEach(entries => {
            for (const entry of entries) {
                result.add(entry.parentColumnName);
            }
        });
        return result;
    }

    /**
     * 指定行の指定列名のセル値を取得する
     * 列名はヘッダー定義から検索する。列が存在しない場合は空文字列を返す
     * @param rowIndex 行インデックス（0始まり、列ヘッダー行を含む）
     * @param columnName データ列の名前
     */
    getCellValueByColumnName(rowIndex: number, columnName: string): string {
        const dataColumnIndex = this.tableData.header.findIndex(col => col.name === columnName);
        if (dataColumnIndex === -1) return '';
        return this.table.getCellValueAt(rowIndex, dataColumnIndex + 1);
    }

    /**
     * 行のPK値を取得する
     * @param rowIndex 行インデックス（0始まり、列ヘッダー行を含む）
     */
    getRowPkValue(rowIndex: number): string {
        const pkColumnIndex = this.tableData.header.findIndex(
            col => col.name === this.tableData.primaryKeyColumns[0]
        );
        if (pkColumnIndex === -1) return '';
        return this.table.getCellValueAt(rowIndex, pkColumnIndex + 1);
    }

    /**
     * 動的参照の参照ヒントを同期的に更新する
     * preloadReferenceTables() 完了後はキャッシュ済みのため同期アクセスで十分
     * キャッシュ未ヒット時はヒントを表示しない（プリロード完了後に updateReferenceHints() で再適用される）
     */
    private updateDynamicReferenceHint(cell: HTMLElement, value: string, expr: ReturnType<typeof parseReferenceExpression>, rowIndex: number, dataColumnIndex: number): void {
        if (!isDynamicReference(expr)) return;
        // 同一行の指定カラムの値を取得
        const valueColumnIndex = this.resolveValueColumnIndex(expr.filter.valueColumn, dataColumnIndex);
        if (valueColumnIndex === -1) return;
        // column=0は行ヘッダーなので、データ列インデックスに+1する
        const filterValue = this.table.getCellValueAt(rowIndex, valueColumnIndex + 1);
        if (filterValue === '') return;
        // フィルタテーブルの全データを同期的に取得
        const fullData = this.referenceDataCache.getFullDataSync(expr.filter.tableName);
        if (fullData === false) return;
        const lookupColumnIndex = fullData.header.indexOf(expr.lookupColumn);
        if (lookupColumnIndex === -1) return;
        // filterColumn で行を検索（主キー以外のカラムにも対応）
        const row = this.referenceDataCache.findRowByColumn(fullData, expr.filter.filterColumn, filterValue);
        if (!row) return;
        const targetTableName = row[lookupColumnIndex];
        if (targetTableName === '') return;
        // 参照先テーブルの表示テキストを同期的に取得
        const displayText = this.referenceDataCache.getDisplayTextById(targetTableName, value);
        if (!displayText) return;
        // 既存の参照ヒントを削除してから新しいヒントを追加
        const existingHint = cell.querySelector('.cell-reference-hint');
        if (existingHint) existingHint.remove();
        const hintSpan = document.createElement('span');
        hintSpan.classList.add('cell-reference-hint');
        hintSpan.textContent = displayText;
        cell.appendChild(hintSpan);
    }

    /**
     * エントリ配列を直接受け取りセルに逆参照ヒントを描画する
     * updateReverseReferenceHints（全行更新）とsetCellValue（PK列編集時のインクリメンタル更新）から呼ばれる
     */
    private applyReverseReferenceHintFromEntries(cell: HTMLElement, entries: ReverseReferenceEntry[]): void {
        // 既存の逆参照ヒントを削除
        const existing = cell.querySelector('.cell-reverse-reference-hint');
        if (existing) existing.remove();
        if (entries.length === 0) return;
        const hintText = formatReverseReferenceHint(entries);
        if (hintText === '') return;
        const hintSpan = document.createElement('span');
        hintSpan.classList.add('cell-reverse-reference-hint');
        hintSpan.textContent = hintText;
        cell.appendChild(hintSpan);
    }

    /**
     * renderAsHtml フラグに応じてセルにテキストまたはHTMLを設定する。
     * renderAsHtml が true の場合は `data-raw-value` に生テキストを保存し `innerHTML` で描画する。
     * getCellValue が生テキストを正しく返せるよう `data-raw-value` を使う。
     * renderAsHtml が false の場合は通常の `textContent` 設定。
     */
    applyTextOrHtml(cell: HTMLElement, value: string, renderAsHtml: boolean): void {
        if (renderAsHtml) {
            cell.dataset.rawValue = value;
            cell.innerHTML = sanitizeHtml(value);
            // HTML改行（<br>）が描画されるようにwhiteSpaceをnormalにする
            cell.style.whiteSpace = 'normal';
            // 行高さを自然なフォント行高にする（固定px指定を解除）
            cell.style.lineHeight = 'normal';
            // はみ出しはクリップのまま維持
            cell.style.overflow = 'hidden';
        } else {
            // data-raw-value が残っている場合はクリアする（モード切替時の残留防止）
            delete cell.dataset.rawValue;
            cell.textContent = value;
            // renderAsHtml モードからテキストモードに戻した場合はスタイルを元に戻す
            cell.style.whiteSpace = '';
            cell.style.lineHeight = '';
            cell.style.overflow = '';
        }
    }

    /**
     * 動的参照のvalueColumn名からヘッダー上の列インデックスを解決する
     * ヘッダーの直接名前一致で解決する
     * @param valueColumnName 動的参照式のvalueColumn名（素の列名）
     * @param currentDataColumnIndex 動的参照を持つ列自身のデータ列インデックス
     */
    resolveValueColumnIndex(valueColumnName: string, currentDataColumnIndex: number): number {
        return this.tableData.header.findIndex(col => col.name === valueColumnName);
    }

    /**
     * 変更された列に依存する動的参照列のヒントを同一行内で再評価する
     * Excelの二段リストと同様に、親列の変更で子列の参照先を切り替える
     */
    private updateDependentColumnsInRow(rowIndex: number, changedDataColumnIndex: number): void {
        const tableElement = this.table.getTableElement();
        const rowElement = tableElement.children[rowIndex] as HTMLElement;
        for (let colIdx = 0; colIdx < this.tableData.header.length; colIdx++) {
            if (colIdx === changedDataColumnIndex) continue;
            const column = this.tableData.header[colIdx];
            if (!column.reference) continue;
            const expr = parseReferenceExpression(column.reference);
            if (!isDynamicReference(expr)) continue;
            // この動的参照が変更された列を参照元としているか確認
            if (this.resolveValueColumnIndex(expr.filter.valueColumn, colIdx) !== changedDataColumnIndex) continue;
            // 依存しているセルのヒントを再評価する
            const cell = rowElement.children[colIdx + 1] as HTMLElement;
            if (cell) {
                const cellValue = EditorTable.getCellValue(cell);
                this.setCellValue(cell, cellValue, colIdx, rowIndex);
            }
        }
    }

    /**
     * 表示列の値が変更されたとき、同一行の参照列ヒントを更新する
     * 逆参照チェーンヒント更新: 通常テーブルの表示列編集時に逆参照チェーンのヒントを更新
     */
    private updateReferenceHintsOnDisplayColumnChange(rowIndex: number, changedDataColumnIndex: number, newValue: string): void {
        const changedColumn = this.tableData.header[changedDataColumnIndex];
        if (!changedColumn) return;
        // 表示列でなければ更新不要
        if (!config.referenceDisplayColumnPriority.includes(changedColumn.name)) return;
        const tableElement = this.table.getTableElement();
        const rowElement = tableElement.children[rowIndex] as HTMLElement;
        for (let colIdx = 0; colIdx < this.tableData.header.length; colIdx++) {
            if (colIdx === changedDataColumnIndex) continue;
            const column = this.tableData.header[colIdx];
            if (!column.reference) continue;
            const expr = parseReferenceExpression(column.reference);
            if (!isSimpleReference(expr)) continue;
            // 参照先テーブルが自身の表示列を持つ場合は逆参照チェーン不使用なのでスキップ
            const refData = this.referenceDataCache.getSync(expr.tableName);
            if (!refData || refData.displayColumnName !== '') continue;
            const cell = rowElement.children[colIdx + 1] as HTMLElement;
            if (!cell) continue;
            const fkValue = EditorTable.getCellValue(cell);
            if (fkValue === '') continue;
            // キャッシュを更新し、ヒントを再描画
            this.referenceDataCache.updateDisplayText(expr.tableName, fkValue, newValue);
            this.setCellValue(cell, fkValue, colIdx, rowIndex);
        }
    }

}
