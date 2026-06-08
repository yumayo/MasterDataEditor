import {EditorTable} from "./editor-table";
import {EditorTableData} from "../data/models/editor-table-data";
import {ReferenceDataCache} from "../references/reference-data-cache";
import {parseReferenceExpression, isDynamicReference, isSimpleReference, DynamicReferenceSchema} from "../references/reference-expression";
import {ReverseReferenceEntry, ReverseReferenceMap, formatReverseReferenceHint} from "../references/reverse-reference-resolver";
import {isDisplayColumn} from "../config/config";
import {NotificationToast} from "../ui/notification";
import {Utility} from "../core/utility";
import {CELL_FONT, REFERENCE_HINT_MARGIN_PX} from "../core/constant";


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
    private readonly notification: NotificationToast;
    /** 逆参照マップ（参照先列の値→逆参照エントリ配列） */
    private reverseReferenceMap: ReverseReferenceMap | false;
    /** 逆参照マップ内で使用される親列名一覧（collectReverseReferenceEntries の再構築を避ける） */
    private reverseReferenceParentColumnNames: string[];

    constructor(table: EditorTable, tableData: EditorTableData, referenceDataCache: ReferenceDataCache, notification: NotificationToast) {
        this.table = table;
        this.tableData = tableData;
        this.referenceDataCache = referenceDataCache;
        this.notification = notification;
        this.reverseReferenceMap = false;
        this.reverseReferenceParentColumnNames = [];
    }

    /**
     * 座標でセルの値を設定する（参照ヒント付き）
     * @param row 行インデックス（0始まり、列ヘッダー行を含む）
     * @param column 列インデックス（0始まり、行ヘッダーセルを含む）
     * @param value セルの値
     */
    setCellValueAt(row: number, column: number, value: string): void {
        const cell = this.table.getCell(row, column);
        const dataColumnIndex = column - this.table.dataColumnOffset();
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
            this.applyText(cell, value);
            // データ型に基づいたスタイル適用（bool型チェックマーク、数値型右寄せ）
            this.applyTypedCellStyle(cell, value, dataColumnIndex);
            // PK列の場合は逆参照ヒントを再適用する
            if (column && this.tableData.primaryKeyColumns.includes(column.name)) this.applyReverseReferenceHintFromEntries(cell, this.collectReverseReferenceEntries(rowIndex));
            return;
        }
        this.applyText(cell, value);
        // 参照式をパース
        const expr = parseReferenceExpression(column.reference);
        if (isDynamicReference(expr)) {
            // 動的参照の場合: 同期的に参照ヒントを更新
            this.updateDynamicReferenceHint(cell, value, expr, rowIndex, dataColumnIndex);
            return;
        }
        const displayText = this.resolveReferenceHintText(value, column.reference, rowIndex, dataColumnIndex, true);
        if (displayText !== null) this.appendReferenceHint(cell, displayText);
    }

    /**
     * 参照データのpreload完了後にセルの参照ヒントを更新する
     */
    updateReferenceHints(): void {
        // データ行の開始 children オフセットから走査する（topSpacer を飛ばす）
        // bottomSpacer はデータ行ではないため getDataRowEndChildIndex() で除外する
        const startIndex = this.table.getDataRowChildOffset();
        this.updateReferenceHintsForRows(startIndex, this.table.getDataRowEndChildIndex());
    }

    /**
     * 指定DOM行範囲のセルの参照ヒントを更新する
     * 行再構築で新しく作成されたDOM行に対して参照ヒントを適用する
     * @param startDomRow DOM行の開始インデックス（含む）
     * @param endDomRow DOM行の終了インデックス（含まない）
     */
    updateReferenceHintsForRows(startDomRow: number, endDomRow: number): void {
        const decorationTargetColumnIndexes = this.getDecorationTargetColumnIndexes();
        if (decorationTargetColumnIndexes.length === 0) return;
        const tableElement = this.table.getTableElement();
        for (let domIndex = startDomRow; domIndex < endDomRow; domIndex++) {
            const row = tableElement.children[domIndex] as HTMLElement;
            if (!row) throw new Error(`DOM行が見つかりません: domIndex=${domIndex}`);
            const logicalRowIndex = this.getLogicalRowIndexFromDomRow(row);
            for (const dataColumnIndex of decorationTargetColumnIndexes) {
                const colIndex = dataColumnIndex + this.table.dataColumnOffset();
                const cell = row.children[colIndex];
                if (!(cell instanceof HTMLElement)) continue;
                const value = this.table.getCellValueAt(logicalRowIndex, colIndex);
                this.setCellValue(cell, value, dataColumnIndex, logicalRowIndex);
            }
        }
    }

    private getDecorationTargetColumnIndexes(): number[] {
        const decorationTargetColumnIndexes: number[] = [];
        for (let columnIndex = 0; columnIndex < this.tableData.header.length; columnIndex++) {
            const column = this.tableData.header[columnIndex];
            if (column.reference !== null || this.tableData.primaryKeyColumns.includes(column.name)) {
                decorationTargetColumnIndexes.push(columnIndex);
            }
        }
        return decorationTargetColumnIndexes;
    }

    /**
     * 指定した列のすべてのセルの参照ヒントを更新する
     */
    updateColumnReferenceHints(columnIndex: number): void {
        const tableElement = this.table.getTableElement();
        // データ行の開始 children オフセットから走査する（topSpacer を飛ばす）
        // bottomSpacer はデータ行ではないため getDataRowEndChildIndex() で除外する
        const dataRowChildOffset = this.table.getDataRowChildOffset();
        const dataRowEndIndex = this.table.getDataRowEndChildIndex();
        for (let domIndex = dataRowChildOffset; domIndex < dataRowEndIndex; domIndex++) {
            const row = tableElement.children[domIndex] as HTMLElement;
            const cell = row.children[columnIndex + this.table.dataColumnOffset()] as HTMLElement;
            if (cell) {
                const logicalRowIndex = this.getLogicalRowIndexFromDomRow(row);
                const value = this.table.getCellValueAt(logicalRowIndex, columnIndex + this.table.dataColumnOffset());
                this.setCellValue(cell, value, columnIndex, logicalRowIndex);
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
        this.reverseReferenceParentColumnNames = [];
        map.forEach(entries => {
            for (const entry of entries) {
                if (!this.reverseReferenceParentColumnNames.includes(entry.parentColumnName)) {
                    this.reverseReferenceParentColumnNames.push(entry.parentColumnName);
                }
            }
        });
        const tableElement = this.table.getTableElement();
        // PK列のインデックスを取得（ヒントの表示先は最初のPK列）
        const pkColumnIndex = this.tableData.header.findIndex(col => col.name === this.tableData.primaryKeyColumns[0]);
        if (pkColumnIndex === -1) return;
        // 全データ行のPK列セルに逆参照ヒントを適用する
        // データ行の開始 children オフセットから走査する（topSpacer/bottomSpacer を除外する）
        const startIndex = this.table.getDataRowChildOffset();
        const endIndex = this.table.getDataRowEndChildIndex();
        for (let rowIndex = startIndex; rowIndex < endIndex; rowIndex++) {
            const row = tableElement.children[rowIndex] as HTMLElement;
            const pkCell = row.children[pkColumnIndex + this.table.dataColumnOffset()] as HTMLElement;
            if (!pkCell) continue;
            const logicalRowIndex = this.getLogicalRowIndexFromDomRow(row);
            this.applyReverseReferenceHintFromEntries(pkCell, this.collectReverseReferenceEntries(logicalRowIndex));
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
        return new Set(this.reverseReferenceParentColumnNames);
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
        return this.table.getCellValueAt(rowIndex, dataColumnIndex + this.table.dataColumnOffset());
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
        return this.table.getCellValueAt(rowIndex, pkColumnIndex + this.table.dataColumnOffset());
    }

    /**
     * ブックマーク用の行キーを取得する。
     * 複合主キーでは全PK構成列の値をタブ区切りで連結する。
     */
    getRowBookmarkKey(rowIndex: number): string {
        const values: string[] = [];
        for (const pkColumnName of this.tableData.primaryKeyColumns) {
            const pkColumnIndex = this.tableData.header.findIndex(
                col => col.name === pkColumnName
            );
            if (pkColumnIndex === -1) return '';
            const value = this.table.getCellValueAt(rowIndex, pkColumnIndex + this.table.dataColumnOffset());
            if (value === '') return '';
            values.push(value);
        }
        return values.join('\t');
    }

    /**
     * 指定セルの参照ヒント文字列を状態から解決して返す。
     * DOM未描画行でも取得できるため、CSV出力や自動列幅計算で使用する。
     */
    getHintText(rowIndex: number, dataColumnIndex: number): string | null {
        if (rowIndex <= 0) return null;
        const column = this.tableData.header[dataColumnIndex];
        if (!column) return null;
        const value = this.table.getCellValueAt(rowIndex, dataColumnIndex + this.table.dataColumnOffset());
        if (column.reference !== null) return this.resolveReferenceHintText(value, column.reference, rowIndex, dataColumnIndex, false);
        if (!this.tableData.primaryKeyColumns.includes(column.name)) return null;
        const entries = this.collectReverseReferenceEntries(rowIndex);
        const hintText = formatReverseReferenceHint(entries);
        return hintText === '' ? null : hintText;
    }

    /**
     * 動的参照の参照ヒントを同期的に更新する
     * preloadReferenceTables() 完了後はキャッシュ済みのため同期アクセスで十分
     * キャッシュ未ヒット時はヒントを表示しない（プリロード完了後に updateReferenceHints() で再適用される）
     */
    private updateDynamicReferenceHint(cell: HTMLElement, value: string, expr: ReturnType<typeof parseReferenceExpression>, rowIndex: number, dataColumnIndex: number): void {
        if (!isDynamicReference(expr)) return;
        const displayText = this.tryResolveDynamicReferenceHintText(value, expr, rowIndex, dataColumnIndex, true);
        if (displayText !== null) this.appendReferenceHint(cell, displayText);
    }

    /**
     * DOM行要素から論理行インデックスを復元する。
     * 仮想スクロールや固定行が有効でも、行ヘッダーの data-row-index は常に
     * 現在そのDOM行が表している論理データ行を指すため、renderedStart からの逆算より信頼できる。
     */
    private getLogicalRowIndexFromDomRow(row: HTMLElement): number {
        const rowIndexText = row.dataset.rowIndex;
        if (rowIndexText === undefined) throw new Error('行要素に data-row-index がありません');
        const dataRowIndex = Number(rowIndexText);
        if (Number.isNaN(dataRowIndex)) throw new Error(`不正な data-row-index です: ${rowIndexText}`);
        return dataRowIndex + 1;
    }

    private collectReverseReferenceEntries(rowIndex: number): ReverseReferenceEntry[] {
        const allEntries: ReverseReferenceEntry[] = [];
        if (!this.reverseReferenceMap) return allEntries;
        for (const colName of this.reverseReferenceParentColumnNames) {
            const colDataIndex = this.tableData.header.findIndex(header => header.name === colName);
            if (colDataIndex === -1) continue;
            const colValue = this.table.getCellValueAt(rowIndex, colDataIndex + this.table.dataColumnOffset());
            if (colValue === '') continue;
            const entries = this.reverseReferenceMap.get(colValue);
            if (!entries) continue;
            for (const entry of entries) {
                if (entry.parentColumnName === colName) allEntries.push(entry);
            }
        }
        return allEntries;
    }

    private resolveReferenceHintText(value: string, reference: string | DynamicReferenceSchema, rowIndex: number, dataColumnIndex: number, notifyOnSchemaError: boolean): string | null {
        if (value === '') return null;
        const expr = parseReferenceExpression(reference);
        if (isDynamicReference(expr)) return this.tryResolveDynamicReferenceHintText(value, expr, rowIndex, dataColumnIndex, notifyOnSchemaError);
        const displayText = this.referenceDataCache.getDisplayTextById(expr.tableName, value);
        return displayText;
    }

    private tryResolveDynamicReferenceHintText(
        value: string,
        expr: ReturnType<typeof parseReferenceExpression>,
        rowIndex: number,
        dataColumnIndex: number,
        notifyOnSchemaError: boolean
    ): string | null {
        if (!isDynamicReference(expr)) return null;
        const valueColumnIndex = this.resolveValueColumnIndex(expr.filter.valueColumn, dataColumnIndex);
        if (valueColumnIndex === -1) {
            if (notifyOnSchemaError) {
                console.warn(`動的参照ヒント: テーブル '${this.table.tableName}' に列 '${expr.filter.valueColumn}' が見つかりません`);
                this.notification.show(`動的参照: テーブル '${this.table.tableName}' に列 '${expr.filter.valueColumn}' が見つかりません`);
            }
            return null;
        }
        const filterValue = this.table.getCellValueAt(rowIndex, valueColumnIndex + this.table.dataColumnOffset());
        if (filterValue === '') return null;
        const fullData = this.referenceDataCache.getFullDataSync(expr.filter.tableName);
        if (fullData === false) return null;
        const lookupColumnIndex = fullData.header.indexOf(expr.lookupColumn);
        if (lookupColumnIndex === -1) {
            if (notifyOnSchemaError) {
                console.warn(`動的参照ヒント: テーブル '${expr.filter.tableName}' に列 '${expr.lookupColumn}' が見つかりません`);
                this.notification.show(`動的参照: テーブル '${expr.filter.tableName}' に列 '${expr.lookupColumn}' が見つかりません`);
            }
            return null;
        }
        const targetColumnIndex = fullData.header.indexOf(expr.targetColumn);
        if (targetColumnIndex === -1) {
            if (notifyOnSchemaError) {
                console.warn(`動的参照ヒント: テーブル '${expr.filter.tableName}' に列 '${expr.targetColumn}' が見つかりません`);
                this.notification.show(`動的参照: テーブル '${expr.filter.tableName}' に列 '${expr.targetColumn}' が見つかりません`);
            }
            return null;
        }
        const row = this.referenceDataCache.findRowByColumn(fullData, expr.filter.filterColumn, filterValue);
        if (!row) return null;
        const targetTableName = row[lookupColumnIndex];
        if (targetTableName === '') return null;
        const resolvedTargetColumn = row[targetColumnIndex];
        if (resolvedTargetColumn === '') return null;
        const targetFullData = this.referenceDataCache.getFullDataSync(targetTableName);
        if (targetFullData === false) return null;
        if (resolvedTargetColumn === targetFullData.primaryKeyColumnName) {
            const displayText = this.referenceDataCache.getDisplayTextById(targetTableName, value);
            return displayText;
        }
        const matchedRow = this.referenceDataCache.findRowByColumn(targetFullData, resolvedTargetColumn, value);
        if (!matchedRow || targetFullData.displayColumnIndex === -1) return null;
        const displayText = matchedRow[targetFullData.displayColumnIndex];
        if (displayText === '' || displayText === value) return null;
        return displayText;
    }

    /**
     * セルに参照ヒントspanを追加する
     * 既存の参照ヒントがあれば削除してから追加する
     * prepend でFK値テキストの前（左側）にヒントを配置する
     * updateDynamicReferenceHint のPK列パスと非PK列パスの両方から呼ばれる
     */
    private appendReferenceHint(cell: HTMLElement, displayText: string): void {
        const existingHint = cell.querySelector('.cell-reference-hint');
        if (existingHint) existingHint.remove();
        this.reserveCellValueWidth(cell);
        const hintSpan = document.createElement('span');
        hintSpan.classList.add('cell-reference-hint');
        hintSpan.textContent = displayText;
        cell.prepend(hintSpan);
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
        this.reserveCellValueWidth(cell);
        const hintSpan = document.createElement('span');
        hintSpan.classList.add('cell-reverse-reference-hint');
        hintSpan.textContent = hintText;
        // prepend でPK値テキストの前（左側）にヒントを配置する（FK参照ヒントと同じパターン）
        cell.prepend(hintSpan);
    }

    /**
     * セルに通常テキストを設定する。
     * bool型セルは後続の applyTypedCellStyle が data-raw-value を管理する。
     */
    applyText(cell: HTMLElement, value: string): void {
        delete cell.dataset.rawValue;
        cell.textContent = value;
        cell.style.whiteSpace = '';
        cell.style.lineHeight = '';
        cell.style.overflow = '';
        cell.style.removeProperty('--cell-value-reserved-width');
    }

    private reserveCellValueWidth(cell: HTMLElement): void {
        const value = this.getCellValueText(cell);
        if (value === '') {
            cell.style.removeProperty('--cell-value-reserved-width');
            return;
        }
        const valueWidth = Math.ceil(Utility.getTextWidth(value, CELL_FONT));
        cell.style.setProperty('--cell-value-reserved-width', `${valueWidth + REFERENCE_HINT_MARGIN_PX}px`);
    }

    private getCellValueText(cell: HTMLElement): string {
        if (cell.dataset.rawValue !== undefined) return cell.dataset.rawValue;
        const valueElement = cell.querySelector('.cell-value');
        if (valueElement !== null) return valueElement.textContent ?? '';
        let text = '';
        for (const node of Array.from(cell.childNodes)) {
            if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? '';
        }
        return text;
    }

    /**
     * 列のデータ型に基づいたセルのスタイル・表示を適用する。
     *
     * - bool型（FK参照なし）: テキストの代わりにチェックマークSVGを表示し、data-raw-valueに生値を保存する
     * - 数値型（int/float/double）: .cell-numeric クラスを付与して右寄せ表示する（FK参照ありでも適用）
     * - FK参照のある列: bool型コントロール（SVGトグル）は適用しない（ドロップダウンが優先）
     *
     * setCellValue と createCell の両方から呼ばれ、セルの型別表示を一元管理する。
     */
    applyTypedCellStyle(cell: HTMLElement, value: string, dataColumnIndex: number): void {
        const column = this.tableData.header[dataColumnIndex];
        if (!column) return;
        // FK参照が設定されている列: boolコントロールは不適用だが、数値型の右揃えは適用する
        if (column.reference !== null) {
            this.removeBoolDisplay(cell);
            if (column.type === 'int' || column.type === 'long' || column.type === 'float' || column.type === 'double') {
                cell.classList.add('cell-numeric');
            } else {
                cell.classList.remove('cell-numeric');
            }
            return;
        }
        if (column.type === 'bool') {
            // bool型: テキストをSVGアイコンに置き換える
            // 0以外 → チェックマーク ✓、0 → バツ印 ×、空値 → 表示なし（バッファ空行対応）
            this.removeBoolDisplay(cell);
            cell.dataset.rawValue = value;
            cell.textContent = '';
            if (value === '') {
                // 空値（バッファ空行等）: SVGを表示せず aria-checked も設定しない
                cell.removeAttribute('aria-checked');
            } else if (value !== '0') {
                cell.setAttribute('aria-checked', 'true');
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('width', '16');
                svg.setAttribute('height', '16');
                svg.setAttribute('viewBox', '0 0 16 16');
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                // チェックマーク ✓
                path.setAttribute('d', 'M6 11.2L2.5 7.7l1.4-1.4L6 8.4l6.1-6.1 1.4 1.4L6 11.2z');
                svg.appendChild(path);
                svg.classList.add('cell-bool-check');
                cell.appendChild(svg);
            } else {
                cell.setAttribute('aria-checked', 'false');
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('width', '16');
                svg.setAttribute('height', '16');
                svg.setAttribute('viewBox', '0 0 16 16');
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                // バツ印 ×
                path.setAttribute('d', 'M12 4.7L11.3 4 8 7.3 4.7 4 4 4.7 7.3 8 4 11.3l.7.7L8 8.7l3.3 3.3.7-.7L8.7 8z');
                svg.appendChild(path);
                svg.classList.add('cell-bool-uncheck');
                cell.appendChild(svg);
            }
        } else if (column.type === 'int' || column.type === 'long' || column.type === 'float' || column.type === 'double') {
            // 数値型: 右寄せクラスを付与する
            cell.classList.add('cell-numeric');
            this.removeBoolDisplay(cell);
        } else {
            // それ以外: 型別スタイルを除去する
            cell.classList.remove('cell-numeric');
            this.removeBoolDisplay(cell);
        }
    }

    /**
     * セルからbool表示要素（SVG）と aria-checked 属性を除去する。
     * data-raw-valueのクリーンアップは不要: applyText が先に実行されて rawValue を削除済みのため。
     */
    private removeBoolDisplay(cell: HTMLElement): void {
        const check = cell.querySelector('.cell-bool-check');
        if (check) check.remove();
        const uncheck = cell.querySelector('.cell-bool-uncheck');
        if (uncheck) uncheck.remove();
        cell.removeAttribute('aria-checked');
    }

    /**
     * 動的参照のvalueColumn名からヘッダー上の列インデックスを解決する
     * ヘッダーの直接名前一致で解決する
     * @param valueColumnName 動的参照式のvalueColumn名（素の列名）
     * @param currentDataColumnIndex 動的参照を持つ列自身のデータ列インデックス
     */
    resolveValueColumnIndex(valueColumnName: string, _currentDataColumnIndex: number): number {
        return this.tableData.header.findIndex(col => col.name === valueColumnName);
    }

    /**
     * 変更された列に依存する動的参照列のヒントを同一行内で再評価する
     * Excelの二段リストと同様に、親列の変更で子列の参照先を切り替える
     */
    private updateDependentColumnsInRow(rowIndex: number, changedDataColumnIndex: number): void {
        // rowIndex は1始まりのDOM行インデックス。getRowElementForInsert で topSpacer を考慮した正しい行要素を取得する
        const rowElement = this.table.getRowElementForInsert(rowIndex);
        if (!rowElement) return;
        for (let colIdx = 0; colIdx < this.tableData.header.length; colIdx++) {
            if (colIdx === changedDataColumnIndex) continue;
            const column = this.tableData.header[colIdx];
            if (!column.reference) continue;
            const expr = parseReferenceExpression(column.reference);
            if (!isDynamicReference(expr)) continue;
            // この動的参照が変更された列を参照元としているか確認
            if (this.resolveValueColumnIndex(expr.filter.valueColumn, colIdx) !== changedDataColumnIndex) continue;
            // 依存しているセルのヒントを再評価する
            const cell = rowElement.children[colIdx + this.table.dataColumnOffset()] as HTMLElement;
            if (cell) {
                const cellValue = this.table.getCellValueAt(rowIndex, colIdx + this.table.dataColumnOffset());
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
        if (!isDisplayColumn(changedColumn.name)) return;
        // rowIndex は1始まりのDOM行インデックス。getRowElementForInsert で topSpacer を考慮した正しい行要素を取得する
        const rowElement = this.table.getRowElementForInsert(rowIndex);
        if (!rowElement) return;
        for (let colIdx = 0; colIdx < this.tableData.header.length; colIdx++) {
            if (colIdx === changedDataColumnIndex) continue;
            const column = this.tableData.header[colIdx];
            if (!column.reference) continue;
            const expr = parseReferenceExpression(column.reference);
            if (!isSimpleReference(expr)) continue;
            // 参照先テーブルが自身の表示列を持つ場合は逆参照チェーン不使用なのでスキップ
            const refData = this.referenceDataCache.getSync(expr.tableName);
            if (!refData || refData.displayColumnName !== '') continue;
            const cell = rowElement.children[colIdx + this.table.dataColumnOffset()] as HTMLElement;
            if (!cell) continue;
            const fkValue = this.table.getCellValueAt(rowIndex, colIdx + this.table.dataColumnOffset());
            if (fkValue === '') continue;
            // キャッシュを更新し、ヒントを再描画
            this.referenceDataCache.updateDisplayText(expr.tableName, fkValue, newValue);
            this.setCellValue(cell, fkValue, colIdx, rowIndex);
        }
    }

}
