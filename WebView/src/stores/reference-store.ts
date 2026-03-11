import {createStore} from 'zustand/vanilla';
import {immer} from 'zustand/middleware/immer';
import {enableMapSet} from 'immer';
import {readFileAsync, findFilesAsync} from '../api';
import {config} from '../config';
import {Csv} from '../csv';
import {useTableStore} from './table-store';
import {parseReferenceExpression, isSimpleReference} from '../reference-expression';
import {readReverseReferencePriority} from './reverse-reference-store';

// ImmerのMap/Setサポートを有効化する
enableMapSet();

/**
 * 参照テーブルの1項目を表す
 */
export interface ReferenceItem {
    id: string;
    displayText: string;
}

/**
 * 参照テーブルのデータ全体を表す
 */
export interface ReferenceTableData {
    tableName: string;
    items: ReferenceItem[];
    displayColumnName: string;
}

/**
 * 参照テーブルの全カラムデータを保持する（動的参照用）
 */
export interface ReferenceTableFullData {
    tableName: string;
    header: string[];
    rows: Map<string, string[]>;
    displayColumnName: string;
    displayColumnIndex: number;
}

// immer の draft 内で Promise を持つとシリアライズ問題が起きるため、
// モジュールレベル変数として非同期ロード重複防止マップを保持する
const loadingPromises = new Map<string, Promise<ReferenceTableData>>();
const fullDataLoadingPromises = new Map<string, Promise<ReferenceTableFullData>>();

/**
 * スキーマのヘッダーから表示列を決定する
 */
function determineDisplayColumn(headerSchema: Array<{name: string}>): string {
    const columnNames = headerSchema.map(h => h.name);
    for (const priority of config.referenceDisplayColumnPriority) {
        if (columnNames.includes(priority)) return priority;
    }
    // 優先順位の列がなければ空文字列を返す（表示列なし）
    return '';
}

/**
 * 逆参照チェーンで表示テキストを解決する
 *
 * 対象テーブルに表示列がない場合、
 * id列で対象テーブルを参照している子テーブルを探し、
 * その子テーブルの表示列の値を使用する
 */
async function resolveReverseReferenceChainAsync(tableName: string, items: ReferenceItem[]): Promise<void> {
    const schemaFiles = await findFilesAsync('schema');

    const candidates: Array<{childTableName: string; priority: number}> = [];

    for (const file of schemaFiles) {
        if (file.type !== 'file') continue;
        if (!file.name.endsWith('.json')) continue;

        const childTableName = file.name.replace('.json', '');
        if (childTableName === tableName) continue;

        try {
            const schemaText = await readFileAsync(`schema/${childTableName}.json`);
            const childSchema = JSON.parse(schemaText);
            if (!childSchema.header || !Array.isArray(childSchema.header)) continue;

            // id列がこのテーブルを参照しているか
            const idEntry = childSchema.header.find(
                (h: {name: string; reference?: string}) => h.name === config.primaryKeyColumnName
            );
            if (!idEntry || !idEntry.reference) continue;

            const refExpr = parseReferenceExpression(idEntry.reference);
            if (!isSimpleReference(refExpr) || refExpr.tableName !== tableName) continue;

            // 子テーブルに表示列があるか
            const displayCol = determineDisplayColumn(childSchema.header);
            if (displayCol === '') continue;

            const priority = readReverseReferencePriority(childSchema);
            candidates.push({childTableName, priority});
        } catch {
            continue;
        }
    }

    if (candidates.length === 0) return;

    // 最小の priority（最高優先度）を持つ候補を選択する
    let best = candidates[0];
    for (let i = 1; i < candidates.length; i++) {
        if (candidates[i].priority < best.priority) best = candidates[i];
    }

    // 子テーブルが既にロード中の場合は循環Promiseを回避するためスキップする
    // 例: chara_name → chara → 逆参照チェーン → chara_name の循環
    if (loadingPromises.has(best.childTableName)) return;

    const childData = await useReferenceStore.getState().getAsync(best.childTableName);

    for (const item of items) {
        if (item.displayText !== item.id) continue;
        const childItem = childData.items.find(ci => ci.id === item.id);
        if (childItem && childItem.displayText !== childItem.id) {
            item.displayText = childItem.displayText;
        }
    }
}

/**
 * 参照テーブルデータを読み込む
 */
async function loadAsync(tableName: string): Promise<ReferenceTableData> {
    const schemaText = await readFileAsync(`schema/${tableName}.json`);

    if (!schemaText || schemaText.trim() === '') {
        console.warn(`Reference table schema is empty: ${tableName}`);
        return {tableName, items: [], displayColumnName: ''};
    }

    let schema;
    try {
        schema = JSON.parse(schemaText);
    } catch (e) {
        console.warn(`Failed to parse reference table schema: ${tableName}`, e);
        return {tableName, items: [], displayColumnName: ''};
    }

    if (!schema.header || !Array.isArray(schema.header)) {
        console.warn(`Reference table schema has no header: ${tableName}`);
        return {tableName, items: [], displayColumnName: ''};
    }

    // タブで開かれていればインメモリデータを優先、なければCSVファイルから読み込む
    const inMemoryCsv = useTableStore.getState().getCsv(tableName);
    let csv: Csv;
    if (inMemoryCsv !== false) {
        csv = inMemoryCsv;
    } else {
        const csvText = await readFileAsync(`data/${tableName}.csv`);
        if (!csvText || csvText.trim() === '') {
            console.warn(`Reference table CSV is empty: ${tableName}`);
            return {tableName, items: [], displayColumnName: ''};
        }
        csv = new Csv();
        csv.load(csvText);
    }

    const displayColumnName = determineDisplayColumn(schema.header);
    const idColumnIndex = csv.header.indexOf(config.primaryKeyColumnName);
    if (idColumnIndex === -1) return {tableName, items: [], displayColumnName: ''};

    const displayColumnIndex = csv.header.indexOf(displayColumnName);

    const items: ReferenceItem[] = [];
    for (const row of csv.body) {
        const id = row[idColumnIndex];
        if (id === '') continue;
        const rawDisplayText = displayColumnIndex !== -1 ? row[displayColumnIndex] : id;
        const displayText = rawDisplayText !== '' ? rawDisplayText : id;
        items.push({id, displayText});
    }

    // id列のスキーマ定義に参照がある場合、参照先テーブルから表示テキストを再帰的に解決する
    const idColumnSchemaEntry = schema.header.find(
        (h: {name: string; reference?: string}) => h.name === config.primaryKeyColumnName
    );
    if (idColumnSchemaEntry && idColumnSchemaEntry.reference) {
        const refExpr = parseReferenceExpression(idColumnSchemaEntry.reference);
        // 単純参照かつ循環参照でない場合のみ解決する
        if (isSimpleReference(refExpr) && !loadingPromises.has(refExpr.tableName)) {
            try {
                const refData = await useReferenceStore.getState().getAsync(refExpr.tableName);
                for (const item of items) {
                    if (item.displayText === item.id) {
                        const refItem = refData.items.find(ri => ri.id === item.id);
                        if (refItem && refItem.displayText !== refItem.id) {
                            item.displayText = refItem.displayText;
                        }
                    }
                }
            } catch (e) {
                console.warn(`[ref-store] Failed to resolve reference chain for ${tableName}`, e);
            }
        }
    }

    // 有意な表示テキストがない場合、逆参照チェーンで表示テキストを解決する
    const needsReverseChain = items.length > 0 && items.every(item => item.displayText === item.id);
    if (needsReverseChain) {
        await resolveReverseReferenceChainAsync(tableName, items);
    }

    return {tableName, items, displayColumnName};
}

/**
 * テーブルの全カラムデータを読み込む
 */
async function loadFullDataAsync(tableName: string): Promise<ReferenceTableFullData> {
    const schemaText = await readFileAsync(`schema/${tableName}.json`);

    if (!schemaText || schemaText.trim() === '') {
        console.warn(`Reference table schema is empty: ${tableName}`);
        return {tableName, header: [], rows: new Map(), displayColumnName: '', displayColumnIndex: -1};
    }

    let schema;
    try {
        schema = JSON.parse(schemaText);
    } catch (e) {
        console.warn(`Failed to parse reference table schema: ${tableName}`, e);
        return {tableName, header: [], rows: new Map(), displayColumnName: '', displayColumnIndex: -1};
    }

    if (!schema.header || !Array.isArray(schema.header)) {
        console.warn(`Reference table schema has no header: ${tableName}`);
        return {tableName, header: [], rows: new Map(), displayColumnName: '', displayColumnIndex: -1};
    }

    const inMemoryCsv = useTableStore.getState().getCsv(tableName);
    let csv: Csv;
    if (inMemoryCsv !== false) {
        csv = inMemoryCsv;
    } else {
        const csvText = await readFileAsync(`data/${tableName}.csv`);
        if (!csvText || csvText.trim() === '') {
            console.warn(`Reference table CSV is empty: ${tableName}`);
            return {tableName, header: [], rows: new Map(), displayColumnName: '', displayColumnIndex: -1};
        }
        csv = new Csv();
        csv.load(csvText);
    }

    const displayColumnName = determineDisplayColumn(schema.header);
    const displayColumnIndex = csv.header.indexOf(displayColumnName);
    const idColumnIndex = csv.header.indexOf(config.primaryKeyColumnName);

    const rows = new Map<string, string[]>();
    if (idColumnIndex !== -1) {
        for (const row of csv.body) {
            const id = row[idColumnIndex];
            if (id === '') continue;
            rows.set(id, row);
        }
    }

    return {tableName, header: csv.header, rows, displayColumnName, displayColumnIndex};
}

interface ReferenceStoreState {
    /** テーブル名→参照アイテムデータ */
    cache: Map<string, ReferenceTableData>;
    /** テーブル名→動的参照用全カラムデータ */
    fullDataCache: Map<string, ReferenceTableFullData>;

    // === アクション ===
    /** 参照データを非同期で取得（キャッシュあればそれを返す） */
    getAsync(tableName: string): Promise<ReferenceTableData>;
    /** キャッシュから同期取得（なければ null） */
    getSync(tableName: string): ReferenceTableData | null;
    /** ID→表示テキスト解決（キャッシュなし or 見つからない場合は null） */
    getDisplayTextById(tableName: string, id: string): string | null;
    /** 動的参照用全カラムデータを非同期取得 */
    getFullDataAsync(tableName: string): Promise<ReferenceTableFullData>;
    /** 動的参照のカラム値取得（同期） */
    getColumnValue(tableName: string, id: string, columnName: string): string | null;
    /** 全カラムデータの同期取得 */
    getFullDataSync(tableName: string): ReferenceTableFullData | null;
    /** 全カラムデータから行検索 */
    findRowByColumn(fullData: ReferenceTableFullData, columnName: string, value: string): string[] | null;
    /** セル編集時キャッシュ即時更新 */
    updateDisplayText(tableName: string, id: string, newDisplayText: string): void;
    updateFullDataCell(tableName: string, id: string, columnIndex: number, value: string): void;
    /** キャッシュ無効化 */
    evictEntry(tableName: string): void;
    evictEntriesNotInStore(): void;
    /** 事前読み込み */
    preload(tableNames: string[]): void;
    /** 全カラムデータの有無チェック */
    hasFullData(tableName: string): boolean;
    /** テスト用リセット */
    _reset(): void;
}

/**
 * 参照テーブルデータの Zustand ストア（vanilla）
 *
 * ReferenceDataCache の全ロジックを Zustand + Immer で再実装したもの。
 * 非同期ロード重複防止はモジュールレベルの loadingPromises で管理する
 * （immer の draft 内で Promise を保持するとシリアライズ問題が起きるため）。
 */
export const useReferenceStore = createStore<ReferenceStoreState>()(
    immer((set, get) => ({
        cache: new Map(),
        fullDataCache: new Map(),

        async getAsync(tableName) {
            const cached = get().cache.get(tableName);
            if (cached) return cached;

            // すでに読み込み中であれば、そのPromiseを返す
            const existing = loadingPromises.get(tableName);
            if (existing) return existing;

            const promise = loadAsync(tableName);
            loadingPromises.set(tableName, promise);

            try {
                const data = await promise;
                set(draft => { draft.cache.set(tableName, data); });
                return data;
            } finally {
                loadingPromises.delete(tableName);
            }
        },

        getSync(tableName) {
            const found = get().cache.get(tableName);
            return found !== undefined ? found : null;
        },

        getDisplayTextById(tableName, id) {
            const data = get().cache.get(tableName);
            if (!data) return null;
            const item = data.items.find(item => item.id === id);
            if (!item) return null;
            // displayText と id が同じ場合はヒントを表示しない
            if (item.displayText === item.id) return null;
            return item.displayText;
        },

        async getFullDataAsync(tableName) {
            const cached = get().fullDataCache.get(tableName);
            if (cached) return cached;

            const existing = fullDataLoadingPromises.get(tableName);
            if (existing) return existing;

            const promise = loadFullDataAsync(tableName);
            fullDataLoadingPromises.set(tableName, promise);

            try {
                const data = await promise;
                set(draft => { draft.fullDataCache.set(tableName, data); });
                return data;
            } finally {
                fullDataLoadingPromises.delete(tableName);
            }
        },

        getColumnValue(tableName, id, columnName) {
            const fullData = get().fullDataCache.get(tableName);
            if (!fullData) return null;
            const row = fullData.rows.get(id);
            if (!row) return null;
            const columnIndex = fullData.header.indexOf(columnName);
            if (columnIndex === -1) return null;
            return row[columnIndex];
        },

        getFullDataSync(tableName) {
            const found = get().fullDataCache.get(tableName);
            return found !== undefined ? found : null;
        },

        findRowByColumn(fullData, columnName, value) {
            const columnIndex = fullData.header.indexOf(columnName);
            if (columnIndex === -1) return null;

            // 主キー列の場合はMap lookupで高速に検索
            const idColumnIndex = fullData.header.indexOf(config.primaryKeyColumnName);
            if (columnIndex === idColumnIndex) {
                const found = fullData.rows.get(value);
                return found !== undefined ? found : null;
            }

            // その他の列は線形検索
            let result: string[] | null = null;
            fullData.rows.forEach(row => {
                if (result) return;
                if (row[columnIndex] === value) result = row;
            });
            return result;
        },

        updateDisplayText(tableName, id, newDisplayText) {
            set(draft => {
                const data = draft.cache.get(tableName);
                if (!data) throw new Error(`キャッシュにテーブルが存在しません: ${tableName}`);
                const item = data.items.find(item => item.id === id);
                if (!item) throw new Error(`キャッシュにIDが存在しません: tableName=${tableName}, id=${id}`);
                item.displayText = newDisplayText;
            });
        },

        updateFullDataCell(tableName, id, columnIndex, value) {
            set(draft => {
                // fullDataCache の更新
                const fullData = draft.fullDataCache.get(tableName);
                if (fullData) {
                    const row = fullData.rows.get(id);
                    if (row) row[columnIndex] = value;
                }

                // cache の displayText 更新（表示列が編集された場合のみ）
                const data = draft.cache.get(tableName);
                if (!data) return;

                let displayColIndex: number;
                if (fullData) {
                    displayColIndex = fullData.displayColumnIndex;
                } else {
                    const header = useTableStore.getState().getHeader(tableName);
                    if (header === false) return;
                    displayColIndex = header.indexOf(data.displayColumnName);
                }
                if (columnIndex !== displayColIndex) return;

                const item = data.items.find(item => item.id === id);
                if (!item) return;
                item.displayText = value;
            });
        },

        evictEntry(tableName) {
            set(draft => {
                draft.cache.delete(tableName);
                draft.fullDataCache.delete(tableName);
            });
        },

        evictEntriesNotInStore() {
            set(draft => {
                const tableStore = useTableStore.getState();
                for (const tableName of draft.cache.keys()) {
                    if (!tableStore.hasTable(tableName)) draft.cache.delete(tableName);
                }
                for (const tableName of draft.fullDataCache.keys()) {
                    if (!tableStore.hasTable(tableName)) draft.fullDataCache.delete(tableName);
                }
            });
        },

        preload(tableNames) {
            for (const tableName of tableNames) {
                get().getAsync(tableName).catch(error => {
                    console.warn(`Failed to preload reference table: ${tableName}`, error);
                });
            }
        },

        hasFullData(tableName) {
            return get().fullDataCache.has(tableName);
        },

        _reset() {
            loadingPromises.clear();
            fullDataLoadingPromises.clear();
            set(draft => {
                draft.cache.clear();
                draft.fullDataCache.clear();
            });
        },
    }))
);
