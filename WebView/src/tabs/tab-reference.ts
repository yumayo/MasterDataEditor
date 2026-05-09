import {TabState} from "./tab";
import {EditorTable} from "../editor/editor-table";
import {EditorTableData} from "../data/models/editor-table-data";
import {ReferenceDataCache} from "../references/reference-data-cache";
import {parseReferenceExpression, isDynamicReference} from "../references/reference-expression";
import {ReverseReferenceResolver} from "../references/reverse-reference-resolver";
import {InMemoryTableStore} from "../data/in-memory-table-store";
import {NotificationToast} from "../ui/notification";

/**
 * タブ参照データ管理モジュール
 *
 * 責務:
 * - 参照先テーブルの事前読み込み（単純参照・動的参照）
 * - 逆参照の非同期解決
 * - タブ切り替え時の参照ヒント再更新
 */
export class TabReference {
    private readonly store: InMemoryTableStore;
    private readonly referenceDataCache: ReferenceDataCache;
    private readonly notification: NotificationToast;

    constructor(store: InMemoryTableStore, referenceDataCache: ReferenceDataCache, notification: NotificationToast) {
        this.store = store;
        this.referenceDataCache = referenceDataCache;
        this.notification = notification;
    }

    /**
     * タブ切り替え時に参照ヒントを再更新する
     * セル編集時にキャッシュが即時更新されるため全クリアは不要。
     * Storeから削除されたテーブル（未保存タブ閉じ等）のみキャッシュを除去し、CSVから再読み込みさせる。
     */
    refreshReferenceHints(name: string, state: TabState): void {
        // Storeから削除されたテーブルのキャッシュを除去する
        this.referenceDataCache.evictEntriesNotInStore();

        // 参照テーブルを再読み込み
        const tableData = state.editorTable.getTableData();
        this.preloadReferenceTables(tableData, state.editorTable);

        // 逆参照を再解決する
        this.resolveReverseReferencesAsync(name, state.editorTable);
    }

    /**
     * 逆参照を非同期で解決し、ヒントを更新する
     */
    resolveReverseReferencesAsync(tableName: string, editorTable: EditorTable): void {
        const resolver = new ReverseReferenceResolver(this.store, this.notification);
        resolver.resolveAsync(tableName).then(reverseMap => {
            editorTable.updateReverseReferenceHints(reverseMap);
        }).catch(error => {
            console.warn('Failed to resolve reverse references:', error);
            this.notification.show('逆参照ヒントの読み込みに失敗しました');
        });
    }

    /**
     * 参照先テーブルを事前読み込みする
     * 動的参照の場合は中間テーブルをロード後、lookupColumnの値から参照先テーブル名を解決してプリロードする
     */
    preloadReferenceTables(tableData: EditorTableData, editorTable: EditorTable): void {
        const referenceTables: string[] = [];
        // 動的参照の中間テーブル名とlookupColumn名のペア
        const dynamicLookups: Array<{ filterTableName: string; lookupColumn: string }> = [];

        for (const col of tableData.header) {
            if (!col.reference) continue;
            const expr = parseReferenceExpression(col.reference);
            if (isDynamicReference(expr)) {
                dynamicLookups.push({ filterTableName: expr.filter.tableName, lookupColumn: expr.lookupColumn });
            } else {
                referenceTables.push(expr.tableName);
            }
        }

        const uniqueRef = Array.from(new Set(referenceTables));
        const simplePromises: Promise<unknown>[] = [];
        for (const tn of uniqueRef) {
            simplePromises.push(this.referenceDataCache.get(tn));
        }

        // 動的参照: 中間テーブルをロード後、参照先テーブル名を解決してプリロードする
        const uniqueIntermediate = Array.from(new Set(dynamicLookups.map(d => d.filterTableName)));
        const dynamicPromises: Promise<unknown>[] = [];
        for (const intermediateName of uniqueIntermediate) {
            const promise = this.referenceDataCache.getFullDataAsync(intermediateName).then(fullData => {
                // 中間テーブルのlookupColumn値から全参照先テーブル名を収集する
                const targetTableNames = new Set<string>();
                for (const lookup of dynamicLookups) {
                    if (lookup.filterTableName !== intermediateName) continue;
                    const lookupColumnIndex = fullData.header.indexOf(lookup.lookupColumn);
                    if (lookupColumnIndex === -1) continue;
                    fullData.rows.forEach(row => {
                        const targetName = row[lookupColumnIndex];
                        if (targetName !== '') targetTableNames.add(targetName);
                    });
                }
                // 参照先テーブルをプリロード（存在しないテーブルの失敗は無視する）
                // get() に加えて getFullDataAsync() でもプリロードする。
                // ValidationEngine.validateDynamicReference() が getFullDataSync() で
                // fullDataCache を参照するため、通常キャッシュだけではバリデーション時に
                // ターゲットテーブルが見つからず preservableErrors にフォールバックしてしまう。
                const targetPromises: Promise<unknown>[] = [];
                targetTableNames.forEach(targetName => {
                    targetPromises.push(this.referenceDataCache.get(targetName).catch(() => {}));
                    targetPromises.push(this.referenceDataCache.getFullDataAsync(targetName).catch(() => {}));
                });
                return Promise.all(targetPromises);
            });
            dynamicPromises.push(promise);
        }

        const allPromises = [...simplePromises, ...dynamicPromises];
        if (allPromises.length > 0) {
            // バックグラウンドプリロード失敗はユーザーに通知しない（ノイズ防止）
            Promise.all(allPromises).then(() => {
                editorTable.updateReferenceHints();
            }).catch(error => {
                console.warn('Failed to preload:', error);
            });
        }
    }
}
