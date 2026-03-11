import {createStore} from 'zustand/vanilla';
import {immer} from 'zustand/middleware/immer';
import {enableMapSet} from 'immer';
import {findFilesAsync, readFileAsync} from '../api';
import {config} from '../config';
import {Csv} from '../csv';
import {useTableStore} from './table-store';
import {
    parseReferenceExpression,
    isSimpleReference,
    isDynamicReference,
    DynamicReference,
} from '../reference-expression';

enableMapSet();

/**
 * 逆参照の子行1つ分の情報
 */
export interface ReverseReferenceRow {
    /** 子行のPK値 */
    pkValue: string;
    /** 子行の表示テキスト（表示列がない場合は空文字列） */
    displayText: string;
}

/**
 * 逆参照の1エントリ
 * あるPK値を参照している子テーブル1つ分の情報
 */
export interface ReverseReferenceEntry {
    /** 子テーブル名 */
    childTableName: string;
    /** 子行の情報一覧 */
    rows: ReverseReferenceRow[];
    /** 逆参照の表示優先度（小さいほど高優先、未設定は Number.MAX_SAFE_INTEGER） */
    priority: number;
    /** 子テーブルのFK列名（単純参照の場合のみ設定される。動的参照の場合は空文字列） */
    childColumnName: string;
    /**
     * 参照先の親テーブル列名（逆参照マップのキーに使われた列）
     * 例: shop.shop_product_group_id が shop_product.group_id を参照する場合は "group_id"
     * PK列を参照している場合は config.primaryKeyColumnName（通常 "id"）
     * 動的参照の場合も config.primaryKeyColumnName を設定する
     */
    parentColumnName: string;
}

/**
 * 逆参照マップ
 * キー: 参照先の親テーブル列の値（通常はPK値だが、非PK列を参照している場合はその列の値）
 * 値: そのキー値に対応するエントリの配列。各エントリは parentColumnName でキー列名を保持する
 */
export type ReverseReferenceMap = Map<string, ReverseReferenceEntry[]>;

/**
 * スキーマオブジェクトから逆参照の表示優先度を読み取る
 * 未設定の場合は最低優先度（Number.MAX_SAFE_INTEGER）を返す
 */
export function readReverseReferencePriority(schema: Record<string, unknown>): number {
    return typeof schema.reverseReferencePriority === 'number'
        ? schema.reverseReferencePriority
        : Number.MAX_SAFE_INTEGER;
}

/**
 * 逆参照マップからセルにインライン表示するヒントテキストを生成する
 *
 * 表示仕様:
 * - 1件かつ表示テキストがある場合のみインライン表示
 * - 2件以上、または表示テキストなし → スキップ（REFERENCESパネルで閲覧）
 *
 * @param entries PK値に対応する逆参照エントリ配列
 */
export function formatReverseReferenceHint(entries: ReverseReferenceEntry[]): string {
    // 表示条件を満たすエントリを抽出（1件かつ表示テキストあり）
    const displayable: ReverseReferenceEntry[] = [];
    for (const entry of entries) {
        if (entry.rows.length === 1 && entry.rows[0].displayText !== '') {
            displayable.push(entry);
        }
    }
    if (displayable.length === 0) return '';

    // 最小の priority（最高優先度）を特定する
    let minPriority = displayable[0].priority;
    for (let i = 1; i < displayable.length; i++) {
        if (displayable[i].priority < minPriority) minPriority = displayable[i].priority;
    }

    // 最高優先度のエントリのみ表示テキストに含める
    const parts: string[] = [];
    for (const entry of displayable) {
        if (entry.priority === minPriority) parts.push(entry.rows[0].displayText);
    }
    return parts.join(', ');
}

/**
 * 逆参照マップストアの状態定義
 */
interface ReverseReferenceStoreState {
    /** テーブル名→逆参照マップ */
    reverseReferenceMaps: Map<string, ReverseReferenceMap>;

    /** 指定テーブルの逆参照マップを構築する（キャッシュあれば即返す） */
    resolveAsync(tableName: string): Promise<ReverseReferenceMap>;
    /** 構築済みの逆参照マップを同期取得（なければ null） */
    getSync(tableName: string): ReverseReferenceMap | null;
    /** キャッシュ無効化 */
    evict(tableName: string): void;
    /** テスト用リセット */
    _reset(): void;
}

/**
 * Promise の重複防止用モジュールレベルマップ
 * 同じテーブルの resolveAsync が並行で呼ばれても1つの Promise を共有する
 */
const resolvingPromises = new Map<string, Promise<ReverseReferenceMap>>();

/**
 * テーブル名からCsvを読み込む
 * useTableStore にキャッシュがあればインメモリデータを優先し、
 * なければCSVファイルから読み込む
 */
async function loadCsvAsync(tableName: string): Promise<Csv | false> {
    const tableStore = useTableStore.getState();
    const inMemoryCsv = tableStore.getCsv(tableName);
    if (inMemoryCsv !== false) return inMemoryCsv;
    try {
        const csvText = await readFileAsync(`data/${tableName}.csv`);
        const csv = new Csv();
        csv.load(csvText);
        return csv;
    } catch {
        return false;
    }
}

/**
 * グループ化された逆参照情報をマップにマージする
 * childColumnName: 単純参照のFK列名。動的参照の場合は空文字列を渡す
 * parentColumnName: 逆参照マップのキーに使った親テーブルの列名
 */
function mergeGroups(
    groups: Map<string, ReverseReferenceRow[]>,
    childTableName: string,
    priority: number,
    childColumnName: string,
    parentColumnName: string,
    map: ReverseReferenceMap
): void {
    groups.forEach((rows, parentColumnValue) => {
        let entries = map.get(parentColumnValue);
        if (!entries) {
            entries = [];
            map.set(parentColumnValue, entries);
        }
        entries.push({childTableName, rows, priority, childColumnName, parentColumnName});
    });
}

/**
 * スキーマヘッダーとCSVヘッダーから表示列のインデックスを決定する
 */
function determineDisplayColumnIndex(
    schemaHeader: Array<{name: string}>,
    csvHeader: string[]
): number {
    const columnNames = schemaHeader.map(h => h.name);
    for (const priority of config.referenceDisplayColumnPriority) {
        if (columnNames.includes(priority)) return csvHeader.indexOf(priority);
    }
    return -1;
}

/**
 * 子テーブル1つを処理し、逆参照マップにマージする
 */
async function processChildTableAsync(
    childTableName: string,
    parentTableName: string,
    map: ReverseReferenceMap
): Promise<void> {
    const schemaText = await readFileAsync(`schema/${childTableName}.json`);
    const schema = JSON.parse(schemaText);
    if (!schema.header || !Array.isArray(schema.header)) return;

    const priority = readReverseReferencePriority(schema);
    const headerDefs = schema.header as Array<{name: string; reference?: string}>;

    // parentTableName を参照しているFK列を探す
    const fkColumns: Array<{columnName: string; index: number; parentColumnName: string}> = [];
    // 動的参照式を収集する
    const dynamicRefExprs: Array<{colName: string; expr: DynamicReference}> = [];

    for (const col of headerDefs) {
        if (!col.reference) continue;
        const expr = parseReferenceExpression(col.reference);
        if (isSimpleReference(expr) && expr.tableName === parentTableName) {
            fkColumns.push({columnName: col.name, index: -1, parentColumnName: expr.columnName});
        } else if (isDynamicReference(expr)) {
            dynamicRefExprs.push({colName: col.name, expr});
        }
    }

    // 動的参照の中間テーブルを解決し、parentTableName を参照している動的FK列を特定する
    const dynamicFkColumns: Array<{
        columnName: string;
        index: number;
        valueColumnName: string;
        valueColumnIndex: number;
        matchingFilterValues: Set<string>;
    }> = [];

    for (const {colName, expr} of dynamicRefExprs) {
        const intermediateCsv = await loadCsvAsync(expr.filter.tableName);
        if (intermediateCsv === false) continue;

        const lookupIdx = intermediateCsv.header.indexOf(expr.lookupColumn);
        const filterIdx = intermediateCsv.header.indexOf(expr.filter.filterColumn);
        if (lookupIdx === -1 || filterIdx === -1) continue;

        // lookupColumn の値が parentTableName と一致する行の filterColumn 値を収集する
        const matchingFilterValues = new Set<string>();
        for (const row of intermediateCsv.body) {
            if (row[lookupIdx] === parentTableName) {
                const filterVal = row[filterIdx];
                if (filterVal !== '') matchingFilterValues.add(filterVal);
            }
        }
        if (matchingFilterValues.size === 0) continue;

        dynamicFkColumns.push({
            columnName: colName,
            index: -1,
            valueColumnName: expr.filter.valueColumn,
            valueColumnIndex: -1,
            matchingFilterValues,
        });
    }

    if (fkColumns.length === 0 && dynamicFkColumns.length === 0) return;

    // 子テーブルのCSVを読み込む
    const csv = await loadCsvAsync(childTableName);
    if (csv === false) return;

    // FK列のインデックスを解決
    for (const fk of fkColumns) {
        fk.index = csv.header.indexOf(fk.columnName);
    }

    // 動的FK列のインデックスを解決
    for (const dynFk of dynamicFkColumns) {
        dynFk.index = csv.header.indexOf(dynFk.columnName);
        dynFk.valueColumnIndex = csv.header.indexOf(dynFk.valueColumnName);
    }

    // 表示列を決定
    const displayColumnIndex = determineDisplayColumnIndex(schema.header, csv.header);
    // PK列のインデックスを取得
    const pkColumnIndex = csv.header.indexOf(config.primaryKeyColumnName);

    // 単純参照: FK値でグループ化し、表示テキストとPK値を収集
    for (const fk of fkColumns) {
        if (fk.index === -1) continue;
        const groups = new Map<string, ReverseReferenceRow[]>();
        for (const row of csv.body) {
            const fkValue = row[fk.index];
            if (fkValue === '') continue;
            const displayText = displayColumnIndex !== -1 ? row[displayColumnIndex] : '';
            const pkValue = pkColumnIndex !== -1 ? row[pkColumnIndex] : '';
            let list = groups.get(fkValue);
            if (!list) { list = []; groups.set(fkValue, list); }
            list.push({pkValue, displayText});
        }
        // 単純参照の parentColumnName は expr.columnName（参照先の親テーブル列名）
        mergeGroups(groups, childTableName, priority, fk.columnName, fk.parentColumnName, map);
    }

    // 動的参照: フィルタ値にマッチする行のみグループ化し、表示テキストとPK値を収集
    for (const dynFk of dynamicFkColumns) {
        if (dynFk.index === -1 || dynFk.valueColumnIndex === -1) continue;
        const groups = new Map<string, ReverseReferenceRow[]>();
        for (const row of csv.body) {
            const valueColumnValue = row[dynFk.valueColumnIndex];
            if (!dynFk.matchingFilterValues.has(valueColumnValue)) continue;
            const fkValue = row[dynFk.index];
            if (fkValue === '') continue;
            const displayText = displayColumnIndex !== -1 ? row[displayColumnIndex] : '';
            const pkValue = pkColumnIndex !== -1 ? row[pkColumnIndex] : '';
            let list = groups.get(fkValue);
            if (!list) { list = []; groups.set(fkValue, list); }
            list.push({pkValue, displayText});
        }
        // 動的参照: FK列名は特定できないため空文字列。
        // lookupColumn は常に参照先テーブルのPK列を指すため parentColumnName は primaryKeyColumnName
        mergeGroups(groups, childTableName, priority, '', config.primaryKeyColumnName, map);
    }
}

/**
 * 指定テーブルを参照している全子テーブルを走査し、逆参照マップを構築する
 * ストアへの保存は呼び出し元（resolveAsync アクション内）で行う
 */
async function buildReverseReferenceMapAsync(tableName: string): Promise<ReverseReferenceMap> {
    const map: ReverseReferenceMap = new Map();
    const schemaFiles = await findFilesAsync('schema');

    const childPromises: Promise<void>[] = [];
    for (const file of schemaFiles) {
        if (file.type !== 'file') continue;
        if (!file.name.endsWith('.json')) continue;
        const childTableName = file.name.replace('.json', '');
        if (childTableName === tableName) continue;
        childPromises.push(processChildTableAsync(childTableName, tableName, map));
    }

    await Promise.all(childPromises);
    return map;
}

/**
 * 逆参照マップを管理する Zustand ストア（vanilla）
 *
 * テーブル名をキーに逆参照マップをキャッシュする。
 * resolveAsync は Promise 重複防止のため resolvingPromises でガードする。
 */
export const useReverseReferenceStore = createStore<ReverseReferenceStoreState>()(
    immer((set, get) => ({
        reverseReferenceMaps: new Map(),

        async resolveAsync(tableName) {
            // キャッシュ済みであれば即返す
            const cached = get().reverseReferenceMaps.get(tableName);
            if (cached) return cached;

            // 同じテーブルへの並行リクエストは同一 Promise を共有する
            const existing = resolvingPromises.get(tableName);
            if (existing) return existing;

            const promise = buildReverseReferenceMapAsync(tableName).then(map => {
                // 計算完了後にストアに保存する
                set(draft => {
                    draft.reverseReferenceMaps.set(tableName, map);
                });
                resolvingPromises.delete(tableName);
                return map;
            });
            resolvingPromises.set(tableName, promise);
            return promise;
        },

        getSync(tableName) {
            const map = get().reverseReferenceMaps.get(tableName);
            return map !== undefined ? map : null;
        },

        evict(tableName) {
            set(draft => {
                draft.reverseReferenceMaps.delete(tableName);
            });
            resolvingPromises.delete(tableName);
        },

        _reset() {
            set(draft => {
                draft.reverseReferenceMaps.clear();
            });
            resolvingPromises.clear();
        },
    }))
);
