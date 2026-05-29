import type {EditorTable} from "./editor-table";
import type {ReverseReferenceEntry} from "../references/reverse-reference-resolver";
import {parseReferenceExpression, isSimpleReference, isDynamicReference, type DynamicReference} from "../references/reference-expression";
import {ReverseReferenceJumpDialog} from "../ui/reverse-reference-jump-dialog";

interface ReverseReferenceNavigationTarget {
    entry: ReverseReferenceEntry;
    value: string;
}

/**
 * EditorTable の定義ジャンプ、FK参照ジャンプ、逆参照ジャンプを担当する。
 */
export class EditorTableNavigation {
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
     * ミニテーブル専用: Ctrl+クリックまたはF12でミニテーブル自身のテーブルを左ペインで開く。
     */
    navigateToDefinition(row: number): void {
        if (this.relationsPanel === false) return;
        if (!this.isMiniTable) return;
        const pkValue = this.getRowPkValue(row);
        if (pkValue === '') return;
        this.relationsPanel.navigateToDefinition(this.tableName, pkValue);
    }

    /**
     * メインテーブル専用: Ctrl+クリックまたはF12でFK列の参照先テーブルをタブで開く。
     * RelationsPanelが非表示の場合のみ動作する（表示中はRelationsPanelで参照できるため不要）。
     */
    navigateToReferenceTable(row: number, column: number): boolean {
        if (this.tab === false) return false;
        // RelationsPanelが表示中なら何もしない
        if (this.tab.editor.isRelationsPanelVisible()) return false;
        const dataColumnIndex = column - this.dataColumnOffset();
        if (dataColumnIndex < 0 || dataColumnIndex >= this.tableData.header.length) return false;
        const reference = this.tableData.header[dataColumnIndex].reference;
        if (reference === null) return false;
        const expr = parseReferenceExpression(reference);
        const cellValue = this.getCellValueAt(row, column);
        if (cellValue === '') return false;
        if (isSimpleReference(expr)) {
            // 単純参照: 参照先テーブルの参照列の値で行を検索し、その列にフォーカスする
            // 例: shop.shop_product_group_id(=1) → shop_productテーブルで group_id=1 の行を開き group_id 列を選択
            // 順方向ジャンプではフィルタ不要のため空文字列・空Setを渡す
            this.tab.navigateToTableColumnValue(expr.tableName, expr.columnName, cellValue, '', new Set());
            return true;
        }
        if (isDynamicReference(expr)) {
            // 動的参照（二段リスト）: 中間テーブルからジャンプ先テーブル名と列名を解決する
            // 順方向ジャンプではジャンプ先が一意に解決されるためフィルタ不要
            const resolved = this.resolveDynamicReferenceTarget(row, expr);
            if (resolved === null) return false;
            this.tab.navigateToTableColumnValue(resolved.tableName, resolved.columnName, cellValue, '', new Set());
            return true;
        }
        return false;
    }

    /**
     * 動的参照の中間テーブルを検索し、ジャンプ先のテーブル名と列名を解決する。
     */
    private resolveDynamicReferenceTarget(row: number, expr: DynamicReference): { tableName: string; columnName: string } | null {
        // 同一行の sourceMatchValue 列の値を取得する
        const valueColumnIndex = this.reference.resolveValueColumnIndex(expr.filter.valueColumn, 0);
        if (valueColumnIndex === -1) return null;
        const filterValue = this.getCellValueAt(row, valueColumnIndex + this.dataColumnOffset());
        if (filterValue === '') return null;
        // 中間テーブルの全データをキャッシュから同期取得する
        const fullData = this.referenceDataCache.getFullDataSync(expr.filter.tableName);
        if (fullData === false) return null;
        const lookupColumnIndex = fullData.header.indexOf(expr.lookupColumn);
        if (lookupColumnIndex === -1) return null;
        const targetColumnIndex = fullData.header.indexOf(expr.targetColumn);
        if (targetColumnIndex === -1) return null;
        // filterColumn の値で中間テーブルの行を検索する
        const matchedRow = this.referenceDataCache.findRowByColumn(fullData, expr.filter.filterColumn, filterValue);
        if (!matchedRow) return null;
        const tableName = matchedRow[lookupColumnIndex];
        if (tableName === '') return null;
        const columnName = matchedRow[targetColumnIndex];
        if (columnName === '') return null;
        return { tableName, columnName };
    }

    /**
     * メインテーブル専用: Ctrl+クリックまたはF12で逆参照先テーブルをタブで開く。
     * PK列では行内の全逆参照候補を対象にし、非PK列ではクリック列を参照している候補だけを対象にする。
     * 逆参照が1つなら直接ジャンプ、複数ならモーダルで選択させる。
     */
    navigateToReverseReferenceTable(row: number, column: number): boolean {
        if (this.tab === false) return false;
        if (this.tab.editor.isRelationsPanelVisible()) return false;
        const dataColumnIndex = column - this.dataColumnOffset();
        if (dataColumnIndex < 0 || dataColumnIndex >= this.tableData.header.length) return false;
        const colName = this.tableData.header[dataColumnIndex].name;
        if (!this.hasReverseReferences()) return false;
        const clickedColumnIsPk = this.tableData.primaryKeyColumns.includes(colName);
        const parentColumnNames = clickedColumnIsPk
            ? this.getAllParentColumnNames()
            : new Set<string>([colName]);
        const targets: ReverseReferenceNavigationTarget[] = [];
        for (const parentColName of parentColumnNames) {
            const colValue = this.getCellValueByColumnName(row, parentColName);
            if (colValue === '') continue;
            const entries = this.getReverseReferenceEntries(colValue);
            for (const entry of entries) {
                if (entry.parentColumnName === parentColName) {
                    targets.push({ entry, value: colValue });
                }
            }
        }
        if (targets.length === 0) return false;
        if (targets.length === 1) {
            const {entry, value} = targets[0];
            // 逆参照ジャンプ: 動的参照の場合は1段目フィルタ情報を渡して正しい行に着地させる
            this.tab.navigateToTableColumnValue(entry.childTableName, entry.childColumnName, value, entry.filterColumnName, entry.filterValues);
            return true;
        }
        // 複数の逆参照: モーダルで選択させる
        const tab = this.tab;
        ReverseReferenceJumpDialog.open(targets.map(target => target.entry), (selected) => {
            const selectedTarget = targets.find(target => target.entry === selected);
            if (selectedTarget === undefined) return;
            tab.navigateToTableColumnValue(
                selected.childTableName,
                selected.childColumnName,
                selectedTarget.value,
                selected.filterColumnName,
                selected.filterValues
            );
        });
        return true;
    }
}
