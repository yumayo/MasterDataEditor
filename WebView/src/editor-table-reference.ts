import {EditorTable} from "./editor-table";
import {EditorTableData} from "./model/editor-table-data";
import {ReferenceDataCache} from "./reference-data-cache";
import {parseReferenceExpression, isDynamicReference, isSimpleReference} from "./reference-expression";
import {ReverseReferenceEntry, ReverseReferenceMap, formatReverseReferenceHint} from "./reverse-reference-resolver";
import {config} from "./config";

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
    /** 逆参照マップ（PK値→逆参照エントリ配列） */
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
            cell.textContent = value;
            // PK列の場合は逆参照ヒントを再適用
            if (column && column.name === config.primaryKeyColumnName) {
                this.applyReverseReferenceHint(cell, value);
            }
            return;
        }
        // 値を設定
        cell.textContent = value;
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
     */
    updateReverseReferenceHints(map: ReverseReferenceMap): void {
        this.reverseReferenceMap = map;
        const tableElement = this.table.getTableElement();
        // PK列のインデックスを取得
        const pkColumnIndex = this.tableData.header.findIndex(col => col.name === config.primaryKeyColumnName);
        if (pkColumnIndex === -1) return;
        // 全データ行のPK列セルに逆参照ヒントを追加
        for (let rowIndex = 1; rowIndex < tableElement.children.length; rowIndex++) {
            const row = tableElement.children[rowIndex] as HTMLElement;
            const cell = row.children[pkColumnIndex + 1] as HTMLElement;
            if (!cell) continue;
            const pkValue = EditorTable.getCellValue(cell);
            this.applyReverseReferenceHint(cell, pkValue);
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
     * PK値から逆参照エントリを取得する
     * Map.get()の戻り値がundefined許容のため ?? で空配列に変換
     */
    getReverseReferenceEntries(pkValue: string): ReverseReferenceEntry[] {
        if (!this.reverseReferenceMap) return [];
        return this.reverseReferenceMap.get(pkValue) ?? [];
    }

    /**
     * 行のPK値を取得する
     * @param rowIndex 行インデックス（0始まり、列ヘッダー行を含む）
     */
    getRowPkValue(rowIndex: number): string {
        const pkColumnIndex = this.tableData.header.findIndex(
            col => col.name === config.primaryKeyColumnName
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
        this.appendReferenceHint(cell, displayText);
    }

    /**
     * セルに参照ヒントを追加する（既存のヒントは削除）
     */
    private appendReferenceHint(cell: HTMLElement, displayText: string): void {
        // 既存の参照ヒントを削除
        const existingHint = cell.querySelector('.cell-reference-hint');
        if (existingHint) {
            existingHint.remove();
        }
        const hintSpan = document.createElement('span');
        hintSpan.classList.add('cell-reference-hint');
        hintSpan.textContent = displayText;
        cell.appendChild(hintSpan);
    }

    /**
     * セルに逆参照ヒントを適用する
     * 逆参照マップにエントリがあればヒントspanを追加し、なければ既存のヒントを削除する
     */
    private applyReverseReferenceHint(cell: HTMLElement, pkValue: string): void {
        // 既存の逆参照ヒントを削除
        const existing = cell.querySelector('.cell-reverse-reference-hint');
        if (existing) existing.remove();
        if (!this.reverseReferenceMap) return;
        if (pkValue === '') return;
        const entries = this.reverseReferenceMap.get(pkValue);
        if (!entries || entries.length === 0) return;
        const hintText = formatReverseReferenceHint(entries);
        if (hintText === '') return;
        const hintSpan = document.createElement('span');
        hintSpan.classList.add('cell-reverse-reference-hint');
        hintSpan.textContent = hintText;
        cell.appendChild(hintSpan);
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

    /** 逆参照マップの表示テキストを更新し、PK列のヒントを再描画する（他テーブルからの伝搬用） */
    updateReverseReferenceDisplayText(pkValue: string, childTableName: string, groupPosition: number, newDisplayText: string): void {
        if (!this.reverseReferenceMap) return;
        const entries = this.reverseReferenceMap.get(pkValue);
        if (!entries) return;
        for (const entry of entries) {
            if (entry.childTableName !== childTableName) continue;
            if (groupPosition < entry.rows.length) {
                entry.rows[groupPosition].displayText = newDisplayText;
            }
        }
        // PK列のセルにヒントを再適用
        const pkColumnIndex = this.tableData.header.findIndex(col => col.name === config.primaryKeyColumnName);
        if (pkColumnIndex === -1) return;
        const tableElement = this.table.getTableElement();
        for (let r = 1; r < tableElement.children.length; r++) {
            const cell = (tableElement.children[r] as HTMLElement).children[pkColumnIndex + 1] as HTMLElement;
            if (!cell) continue;
            if (EditorTable.getCellValue(cell) === pkValue) {
                this.applyReverseReferenceHint(cell, pkValue);
            }
        }
    }
}
