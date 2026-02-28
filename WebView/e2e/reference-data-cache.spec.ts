import { test, expect } from '@playwright/test';
import { InMemoryTableStore } from '../src/in-memory-table-store';
import { ReferenceDataCache, ReferenceTableData, ReferenceTableFullData } from '../src/reference-data-cache';

// --- テスト用ヘルパー ---

/**
 * ReferenceDataCacheのprivateフィールドにテスト用アクセスするための型
 * fullDataCacheとcacheを直接操作してテストデータを事前セットするために使用する
 */
interface TestableCacheFields {
    fullDataCache: Map<string, ReferenceTableFullData>;
    cache: Map<string, ReferenceTableData>;
}

/** テスト用のfullDataCacheにアクセスする */
function getFullDataCache(cache: ReferenceDataCache): Map<string, ReferenceTableFullData> {
    return (cache as unknown as TestableCacheFields).fullDataCache;
}

/** テスト用のcache（ReferenceTableData）にアクセスする */
function getReferenceCache(cache: ReferenceDataCache): Map<string, ReferenceTableData> {
    return (cache as unknown as TestableCacheFields).cache;
}

/** テスト用のReferenceTableFullDataを生成する */
function createTestFullData(): ReferenceTableFullData {
    const rows = new Map<string, string[]>();
    rows.set("1", ["1", "剣", "100"]);
    rows.set("2", ["2", "盾", "200"]);
    rows.set("3", ["3", "杖", "300"]);
    return {
        tableName: "items",
        header: ["id", "name", "price"],
        rows,
        displayColumnName: "name",
        displayColumnIndex: 1,
    };
}

// =====================================================
// updateFullDataCell
// =====================================================
test.describe('updateFullDataCell', () => {
    test('fullDataCacheに存在するテーブル・IDのセル値を更新できる', async () => {
        const store = new InMemoryTableStore();
        const cache = new ReferenceDataCache(store);
        // テストデータをfullDataCacheに事前セット
        const fullDataCache = getFullDataCache(cache);
        fullDataCache.set("items", createTestFullData());
        // name列（columnIndex=1）を更新
        cache.updateFullDataCell("items", "1", 1, "新しい値");
        // getFullDataAsyncはキャッシュから返す
        const result = await cache.getFullDataAsync("items");
        const row = result.rows.get("1");
        expect(row).toBeTruthy();
        // row が truthy であることを確認済みなので安全にアクセス
        expect(row![1]).toBe("新しい値");
    });

    test('fullDataCacheに存在しないテーブル名の場合は何もしない（エラーにならない）', () => {
        const store = new InMemoryTableStore();
        const cache = new ReferenceDataCache(store);
        // fullDataCacheにテーブルを登録しない状態で呼び出してもエラーにならない
        expect(() => cache.updateFullDataCell("unknown_table", "1", 0, "value")).not.toThrow();
    });

    test('fullDataCacheに存在しないIDの場合は何もしない（エラーにならない）', () => {
        const store = new InMemoryTableStore();
        const cache = new ReferenceDataCache(store);
        // テーブルは存在するがIDが存在しない
        const fullDataCache = getFullDataCache(cache);
        fullDataCache.set("items", createTestFullData());
        // 存在しないID "999" を指定してもエラーにならない
        expect(() => cache.updateFullDataCell("items", "999", 1, "value")).not.toThrow();
        // 既存データが破壊されていないことを確認
        const row1 = fullDataCache.get("items")!.rows.get("1");
        expect(row1).toBeTruthy();
        expect(row1![1]).toBe("剣");
        const row2 = fullDataCache.get("items")!.rows.get("2");
        expect(row2).toBeTruthy();
        expect(row2![1]).toBe("盾");
    });

    test('表示列を編集するとcacheのdisplayTextも更新される', () => {
        const store = new InMemoryTableStore();
        const cache = new ReferenceDataCache(store);
        // fullDataCacheに表示列がja(index=2)のテストデータをセット
        const fullDataCache = getFullDataCache(cache);
        const fullDataRows = new Map<string, string[]>();
        fullDataRows.set("1", ["1", "sword", "剣"]);
        fullDataCache.set("item", {
            tableName: "item",
            header: ["id", "name", "ja"],
            rows: fullDataRows,
            displayColumnName: "ja",
            displayColumnIndex: 2,
        });
        // cacheにも同じテーブルのReferenceTableDataをセット
        const referenceCache = getReferenceCache(cache);
        referenceCache.set("item", {
            tableName: "item",
            items: [{ id: "1", displayText: "剣" }],
            displayColumnName: "ja",
        });
        // 表示列(ja=index2)を編集
        cache.updateFullDataCell("item", "1", 2, "太刀");
        // fullDataCacheの値が更新されていること
        const row = fullDataCache.get("item")!.rows.get("1");
        expect(row).toBeTruthy();
        expect(row![2]).toBe("太刀");
        // cacheのdisplayTextも更新されていること
        const refData = referenceCache.get("item");
        expect(refData).toBeTruthy();
        expect(refData!.items[0].displayText).toBe("太刀");
    });

    test('表示列以外のカラムを編集してもdisplayTextは変更されない', () => {
        const store = new InMemoryTableStore();
        const cache = new ReferenceDataCache(store);
        // fullDataCacheに表示列がja(index=2)のテストデータをセット
        const fullDataCache = getFullDataCache(cache);
        const fullDataRows = new Map<string, string[]>();
        fullDataRows.set("1", ["1", "sword", "剣"]);
        fullDataCache.set("item", {
            tableName: "item",
            header: ["id", "name", "ja"],
            rows: fullDataRows,
            displayColumnName: "ja",
            displayColumnIndex: 2,
        });
        // cacheにもReferenceTableDataをセット
        const referenceCache = getReferenceCache(cache);
        referenceCache.set("item", {
            tableName: "item",
            items: [{ id: "1", displayText: "剣" }],
            displayColumnName: "ja",
        });
        // 表示列ではないname列(index=1)を編集
        cache.updateFullDataCell("item", "1", 1, "katana");
        // fullDataCacheの値は更新されている
        const row = fullDataCache.get("item")!.rows.get("1");
        expect(row).toBeTruthy();
        expect(row![1]).toBe("katana");
        // cacheのdisplayTextは変更されない（表示列ではないため）
        const refData = referenceCache.get("item");
        expect(refData).toBeTruthy();
        expect(refData!.items[0].displayText).toBe("剣");
    });

    test('fullDataCacheがなくcacheのみ存在する場合でもStoreヘッダーから表示列を判定してdisplayTextが更新される', () => {
        const store = new InMemoryTableStore();
        // Storeにテーブルを登録（ヘッダーにja列を含む）
        store.registerTable("item", ["id", "name", "ja"], [["1", "sword", "剣"]]);
        const cache = new ReferenceDataCache(store);
        // fullDataCacheにはセットしない（タブで開いていないテーブルのケース）
        // cacheにのみReferenceTableDataをセット
        const referenceCache = getReferenceCache(cache);
        referenceCache.set("item", {
            tableName: "item",
            items: [{ id: "1", displayText: "剣" }],
            displayColumnName: "ja",
        });
        // ja列のインデックスはheader["id","name","ja"]から2
        cache.updateFullDataCell("item", "1", 2, "太刀");
        // cacheのdisplayTextが更新されていること
        const refData = referenceCache.get("item");
        expect(refData).toBeTruthy();
        expect(refData!.items[0].displayText).toBe("太刀");
    });
});
