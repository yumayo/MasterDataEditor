import {Tab, TabState} from "./tab";
import {EditorTable} from "./editor-table";
import {EditorTableData} from "./model/editor-table-data";
import {ReferenceDataCache} from "./reference-data-cache";
import {parseReferenceExpression, isDynamicReference} from "./reference-expression";
import {ReverseReferenceResolver} from "./reverse-reference-resolver";

/**
 * タブ参照データ管理モジュール
 *
 * 責務:
 * - 参照先テーブルの事前読み込み（単純参照・動的参照）
 * - 逆参照の非同期解決
 * - タブ切り替え時の参照ヒント再更新
 */
export class TabReference {
    private readonly tab: Tab;

    constructor(tab: Tab) {
        this.tab = tab;
    }

    /**
     * タブ切り替え時に参照ヒントを再更新する
     * 他タブでインメモリデータが編集されている可能性があるため、
     * キャッシュをクリアして参照データを再読み込みする
     */
    refreshReferenceHints(name: string, state: TabState): void {
        // キャッシュをクリアして最新のインメモリデータから再読み込みさせる
        state.referenceDataCache.clear();

        // ビュータブの場合: 結合テーブルの最新データでキーマップを再構築し、行数差分を反映する
        if (state.kind === 'view') {
            state.editorTable.rebuildJoinTableKeyMaps(this.tab.getOpenEditorTables());
            state.editorTable.refreshViewRows();
        }

        // 参照テーブルを再読み込み
        const tableData = state.editorTable.getTableData();
        this.preloadReferenceTables(tableData, state.referenceDataCache, state.editorTable);

        // 逆参照を再解決する（ビュータブはベーステーブル名で解決する）
        const reverseTableName = state.kind === 'view' ? state.viewDefinition.baseTable : name;
        this.resolveReverseReferencesAsync(reverseTableName, state.editorTable);
    }

    /**
     * 逆参照を非同期で解決し、ヒントを更新する
     */
    resolveReverseReferencesAsync(tableName: string, editorTable: EditorTable): void {
        const resolver = new ReverseReferenceResolver(this.tab.getOpenEditorTables());
        resolver.resolveAsync(tableName).then(reverseMap => {
            editorTable.updateReverseReferenceHints(reverseMap);
        }).catch(error => {
            console.warn('Failed to resolve reverse references:', error);
        });
    }

    /**
     * 参照先テーブルを事前読み込みする
     */
    preloadReferenceTables(
        tableData: EditorTableData, referenceDataCache: ReferenceDataCache, editorTable: EditorTable
    ): void {
        const referenceTables: string[] = [];
        const dynamicIntermediateTables: string[] = [];

        for (const col of tableData.header) {
            if (!col.reference) continue;
            const expr = parseReferenceExpression(col.reference);
            if (isDynamicReference(expr)) {
                dynamicIntermediateTables.push(expr.filter.tableName);
            } else {
                referenceTables.push(expr.tableName);
            }
        }

        const uniqueRef = Array.from(new Set(referenceTables));
        const uniqueInter = Array.from(new Set(dynamicIntermediateTables));

        const promises: Promise<unknown>[] = [];
        for (const tn of uniqueRef) {
            promises.push(referenceDataCache.get(tn));
        }
        for (const tn of uniqueInter) {
            promises.push(referenceDataCache.getFullDataAsync(tn));
        }

        if (promises.length > 0) {
            Promise.all(promises).then(() => {
                editorTable.updateReferenceHints();
            }).catch(error => {
                console.warn('Failed to preload:', error);
            });
        }
    }
}
