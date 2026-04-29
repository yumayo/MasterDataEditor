import type {EditorTable} from "./editor-table";

/**
 * EditorTable と RelationsPanel / EditorAPI の連携を担当する。
 *
 * 表の編集・描画そのものではなく、選択行やセル変更を外側の関係表示へ通知する境界。
 */
export class EditorTableRelations {
    [key: string]: any;

    /**
     * 最後にRelationsPanelへ通知したフォーカス行インデックス（重複通知防止用）。
     * 非ミニテーブルのみ使用する（ミニテーブルは常に通知する）。
     * forceRefreshRelationsPanel() は refreshCurrentRow() を直接呼ぶためこの値を変更しない。
     */
    private lastNotifiedRow: number;

    constructor(table: EditorTable) {
        this.lastNotifiedRow = -1;
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

    /** 行選択が変化したときにRelationsPanelへ通知し、EditorAPI に行選択イベントを発火する。 */
    notifyRowSelectionChanged(rowIndex: number): void {
        if (this.relationsPanel === false) return;
        if (this.isMiniTable) {
            // ミニテーブルの場合: 常に通知する（異なるミニテーブル間の切り替えを正しく検知するため、
            // 行番号による重複スキップは行わない）
            const pkValue = this.getRowPkValue(rowIndex);
            if (pkValue === '') return;
            this.relationsPanel.notifyMiniTableRowSelectionChanged(this.tableName, pkValue);
            return;
        }
        // 非ミニテーブルの場合: 同一行インデックスへの重複通知を防止してパフォーマンスを保護する
        if (rowIndex === this.lastNotifiedRow) return;
        this.lastNotifiedRow = rowIndex;
        // 重複チェック通過後に EditorAPI へ行選択イベントを発火する（ストアインデックス0始まりで通知）
        // フィルター適用時は論理行インデックスのため resolveStoreRowIndex で変換する
        if (this.tab !== false) {
            const domDataRow = rowIndex - 1;
            const storeRowIndex = this.resolveStoreRowIndex(domDataRow);
            if (storeRowIndex >= 0) {
                this.tab.emitRowSelected(this.tableName, storeRowIndex);
            }
        }
        this.relationsPanel.updateForRow(rowIndex);
        if (this.tab !== false) this.tab.refreshFormPanelForSelectedRow(this.tableName, rowIndex);
    }

    /**
     * セル値変更後にRelationsPanel側へ通知する。
     * 通常テーブルは同一行のRelationsPanelを更新し、ミニテーブルは左ペインの参照ヒントだけを更新する。
     */
    refreshAfterCellChanges(): void {
        if (this.isMiniTable) {
            // forceRefreshRelationsPanel() はパネル全体を再構築して編集中のミニEditorTable自身を
            // 破棄してしまうため、左ペインの参照ヒントのみ更新する
            if (this.relationsPanel !== false) this.relationsPanel.notifyMiniTableCellChanged();
            return;
        }
        this.forceRefreshRelationsPanel();
    }

    /**
     * セル値変更後にRelationsPanelを強制再描画する（同一行リフレッシュ）。
     * paneStack はリセットしない。lastNotifiedRow も更新しない（次の行変更で正しく検知するため維持する）。
     * 行を変更しない操作（セル編集後・逆参照マップ更新後など同一行のリフレッシュ）からのみ呼ぶこと。
     */
    forceRefreshRelationsPanel(): void {
        if (this.relationsPanel === false) return;
        // refreshCurrentRow は paneStack をリセットしないため、
        // セル編集後に定義ジャンプで開いた追加RPが破棄されない
        this.relationsPanel.refreshCurrentRow(this.selection.getFocus().row);
    }
}
