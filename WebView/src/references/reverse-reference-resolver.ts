import {findFilesAsync, readFileAsync} from "../app/api";
import {determineDisplayColumnName} from "../config/config";
import {Csv} from "../data/csv";
import {InMemoryTableStore} from "../data/in-memory-table-store";
import {extractFirstPrimaryKeyColumn} from "../core/schema-utils";
import {
    parseReferenceExpression,
    isSimpleReference,
    isDynamicReference,
    DynamicReference,
    DynamicReferenceSchema
} from "./reference-expression";
import {NotificationToast} from "../ui/notification";

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
    /** 子テーブルのFK列名（単純参照・動的参照ともに設定される） */
    childColumnName: string;
    /**
     * 動的参照かどうか。
     * true の場合、FK列値だけでは参照先テーブルを一意に特定できないため、
     * filterRowsByReverseEntry では rows の PKセットでフィルタリングする。
     */
    isDynamic: boolean;
    /**
     * 参照先の親テーブル列名（逆参照マップのキーに使われた列）
     * 例: shop.shop_product_group_id が shop_product.group_id を参照する場合は "group_id"
     * PK列を参照している場合は親テーブルのPK列名（スキーマの primary_key から取得）
     * 動的参照の場合は中間テーブルの targetColumn 列の値から動的解決される
     * 例: table.csv の column 列に "code" が入っていれば parentColumnName = "code"
     */
    parentColumnName: string;
    /**
     * 子テーブルのPK列名（スキーマの primary_key から取得）
     * filterRowsByReverseEntry の動的参照パス（isDynamic === true）で使用する
     */
    childPkColumnName: string;
    /**
     * 動的参照の1段目フィルタ列名（例: "table_id"）。
     * 逆参照ジャンプ時にFK値だけでなくこの列の値も一致する行に絞り込むために使う。
     * 単純参照では空文字列。
     */
    filterColumnName: string;
    /**
     * 動的参照の1段目フィルタ値の集合（例: {"6"} = table_id=6 がこの参照先に対応する）。
     * filterColumnName が空文字列でない場合のみ有効。単純参照では空集合。
     */
    filterValues: ReadonlySet<string>;
}

/**
 * 逆参照マップ
 * キー: 参照先の親テーブル列の値（通常はPK値だが、非PK列を参照している場合はその列の値）
 * 値: そのキー値に対応するエントリの配列。各エントリは parentColumnName でキー列名を保持する
 */
export type ReverseReferenceMap =
    Map<string, ReverseReferenceEntry[]>;

/**
 * 逆参照を解決するクラス
 *
 * 親テーブルを開いたとき、どの子テーブルから参照されているかを
 * 発見し、PK値ごとにグループ化したマップを構築する。
 */
export class ReverseReferenceResolver {

    /** テーブルデータの中央ストア（インメモリデータ優先取得用） */
    private readonly store: InMemoryTableStore;
    /** エラー通知トースト */
    private readonly notification: NotificationToast;

    constructor(store: InMemoryTableStore, notification: NotificationToast) {
        this.store = store;
        this.notification = notification;
    }

    /**
     * 指定テーブルを参照している全子テーブルを走査し、
     * 逆参照マップを構築する
     * @param tableName 親テーブル名
     */
    async resolveAsync(
        tableName: string,
    ): Promise<ReverseReferenceMap> {
        const map: ReverseReferenceMap = new Map();

        // 全スキーマファイルを列挙
        const schemaFiles =
            await findFilesAsync("schema");

        // 各スキーマを読み込み、tableName を参照している列を探す
        const childPromises: Promise<void>[] = [];
        for (const file of schemaFiles) {
            if (file.type !== 'file') continue;
            // .json 拡張子のみ対象
            if (!file.name.endsWith('.json')) continue;

            const childTableName =
                file.name.replace('.json', '');
            // 自分自身は除外
            if (childTableName === tableName) continue;

            childPromises.push(
                this.processChildTableAsync(
                    childTableName,
                    tableName,
                    map
                )
            );
        }

        await Promise.all(childPromises);
        return map;
    }

    /**
     * テーブル名からCsvを読み込む
     * タブで開かれていればインメモリデータを優先、
     * なければCSVファイルから読み込む
     */
    private async loadCsvAsync(
        tableName: string
    ): Promise<Csv | false> {
        const inMemoryCsv =
            this.store.getCsv(tableName);
        if (inMemoryCsv !== false) return inMemoryCsv;
        try {
            const csvText = await readFileAsync(
                `data/${tableName}.csv`
            );
            const csv = new Csv();
            csv.load(csvText);
            return csv;
        } catch {
            return false;
        }
    }

    /**
     * グループ化された逆参照情報をマップにマージする
     * childColumnName: 子テーブルのFK列名（単純参照・動的参照ともに設定）
     * isDynamic: 動的参照かどうか
     * parentColumnName: 逆参照マップのキーに使った親テーブルの列名
     *   単純参照では expr.columnName（例: "group_id"）
     *   動的参照では中間テーブルの targetColumn 列の値から動的解決した列名
     * childPkColumnName: 子テーブルのPK列名（スキーマの primary_key から取得）
     */
    private mergeGroups(
        groups: Map<string, ReverseReferenceRow[]>,
        childTableName: string,
        priority: number,
        childColumnName: string,
        isDynamic: boolean,
        parentColumnName: string,
        childPkColumnName: string,
        filterColumnName: string,
        filterValues: ReadonlySet<string>,
        map: ReverseReferenceMap
    ): void {
        groups.forEach(
            (rows, parentColumnValue) => {
                let entries =
                    map.get(parentColumnValue);
                if (!entries) {
                    entries = [];
                    map.set(
                        parentColumnValue, entries
                    );
                }
                entries.push({
                    childTableName,
                    rows,
                    priority,
                    childColumnName,
                    isDynamic,
                    parentColumnName,
                    childPkColumnName,
                    filterColumnName,
                    filterValues,
                });
            }
        );
    }

    /**
     * 子テーブル1つを処理し、逆参照マップにマージする
     */
    private async processChildTableAsync(
        childTableName: string,
        parentTableName: string,
        map: ReverseReferenceMap
    ): Promise<void> {
        // スキーマを読み込む
        const schemaText = await readFileAsync(
            `schema/${childTableName}.json`
        );
        const schema = JSON.parse(schemaText);
        if (!schema.header
            || !Array.isArray(schema.header)) {
            return;
        }

        // スキーマから逆参照の表示優先度を読み取る
        const priority = readReverseReferencePriority(schema);

        const headerDefs = schema.header as Array<{
            name: string;
            reference?: string | DynamicReferenceSchema;
        }>;

        // parentTableName を参照しているFK列を探す
        const fkColumns: Array<{
            /** 子テーブルのFK列名（例: shop_product_group_id） */
            columnName: string;
            /** CSVヘッダー上のインデックス。後から解決する */
            index: number;
            /** 参照先の親テーブル列名（例: group_id）。逆参照マップのキーに使う列 */
            parentColumnName: string;
        }> = [];

        // 動的参照式を収集する
        const dynamicRefExprs: Array<{
            colName: string;
            expr: DynamicReference;
        }> = [];

        for (const col of headerDefs) {
            if (!col.reference) continue;
            const expr =
                parseReferenceExpression(col.reference);
            // 単純参照かつ参照先が parentTableName の場合
            if (isSimpleReference(expr)
                && expr.tableName === parentTableName) {
                fkColumns.push({
                    columnName: col.name,
                    index: -1, // CSVヘッダーで後から解決
                    parentColumnName: expr.columnName,
                });
            } else if (isDynamicReference(expr)) {
                dynamicRefExprs.push({
                    colName: col.name,
                    expr,
                });
            }
        }

        // 動的参照の中間テーブルを解決し、
        // parentTableName を参照している動的FK列を特定する
        const dynamicFkColumns: Array<{
            columnName: string;
            index: number;
            valueColumnName: string;
            valueColumnIndex: number;
            matchingFilterValues: Set<string>;
            // filterColumnValue → parentColumnName（中間テーブルの targetColumn 列の値）のマッピング
            // 行ごとに参照先列名が異なる可能性があるため、値単位でマッピングを保持する
            filterValueToParentColumnName: Map<string, string>;
        }> = [];

        for (const { colName, expr }
            of dynamicRefExprs) {
            const intermediateCsv =
                await this.loadCsvAsync(
                    expr.filter.tableName
                );
            if (intermediateCsv === false) continue;

            const lookupIdx =
                intermediateCsv.header.indexOf(
                    expr.lookupColumn
                );
            const filterIdx =
                intermediateCsv.header.indexOf(
                    expr.filter.filterColumn
                );
            // targetColumn（destColumn）の列インデックスを解決する
            // 中間テーブルのこの列の値が、参照先テーブルの実際の列名になる
            const targetColumnIdx =
                intermediateCsv.header.indexOf(
                    expr.targetColumn
                );
            if (lookupIdx === -1
                || filterIdx === -1
                || targetColumnIdx === -1) {
                // スキーマ設定ミス: 中間テーブルに動的参照式で指定された列が見つからない
                if (lookupIdx === -1) {
                    console.warn(`逆参照解決: テーブル '${expr.filter.tableName}' に列 '${expr.lookupColumn}' が見つかりません`);
                    this.notification.show(`動的参照: テーブル '${expr.filter.tableName}' に列 '${expr.lookupColumn}' が見つかりません`);
                }
                if (filterIdx === -1) {
                    console.warn(`逆参照解決: テーブル '${expr.filter.tableName}' に列 '${expr.filter.filterColumn}' が見つかりません`);
                    this.notification.show(`動的参照: テーブル '${expr.filter.tableName}' に列 '${expr.filter.filterColumn}' が見つかりません`);
                }
                if (targetColumnIdx === -1) {
                    console.warn(`逆参照解決: テーブル '${expr.filter.tableName}' に列 '${expr.targetColumn}' が見つかりません`);
                    this.notification.show(`動的参照: テーブル '${expr.filter.tableName}' に列 '${expr.targetColumn}' が見つかりません`);
                }
                continue;
            }

            // lookupColumn の値が parentTableName と一致する行について、
            // filterColumn 値を収集し、同時に targetColumn 値を parentColumnName としてマッピングする
            const matchingFilterValues =
                new Set<string>();
            const filterValueToParentColumnName =
                new Map<string, string>();
            for (const row
                of intermediateCsv.body) {
                if (row[lookupIdx]
                    === parentTableName) {
                    const filterVal =
                        row[filterIdx];
                    if (filterVal !== '') {
                        matchingFilterValues.add(
                            filterVal
                        );
                        // 中間テーブルの targetColumn 列の値を parentColumnName として記録する
                        // 例: table.csv の column 列に "code" が入っていれば parentColumnName = "code"
                        const targetColumnValue =
                            row[targetColumnIdx];
                        filterValueToParentColumnName.set(
                            filterVal, targetColumnValue
                        );
                    }
                }
            }
            if (matchingFilterValues.size === 0) {
                continue;
            }

            dynamicFkColumns.push({
                columnName: colName,
                index: -1,
                valueColumnName:
                    expr.filter.valueColumn,
                valueColumnIndex: -1,
                matchingFilterValues,
                filterValueToParentColumnName,
            });
        }

        if (fkColumns.length === 0
            && dynamicFkColumns.length === 0) {
            return;
        }

        // 子テーブルのCSVを読み込む
        const csv =
            await this.loadCsvAsync(childTableName);
        if (csv === false) return;

        // FK列のインデックスを解決
        for (const fk of fkColumns) {
            fk.index =
                csv.header.indexOf(fk.columnName);
        }

        // 動的FK列のインデックスを解決
        for (const dynFk of dynamicFkColumns) {
            dynFk.index =
                csv.header.indexOf(
                    dynFk.columnName
                );
            dynFk.valueColumnIndex =
                csv.header.indexOf(
                    dynFk.valueColumnName
                );
        }

        // 表示列を決定
        // 該当する列がない場合は空文字を使い、テーブル名(件数) 形式で表示する
        const schemaColumnNames = (schema.header as Array<{name: string}>).map(h => h.name);
        const displayColumnName = determineDisplayColumnName(schemaColumnNames);
        const displayColumnIndex = displayColumnName !== '' ? csv.header.indexOf(displayColumnName) : -1;

        // 子テーブルのPK列名をスキーマから取得してインデックスを解決する
        const childPkColumnName = extractFirstPrimaryKeyColumn(schema);
        const pkColumnIndex =
            csv.header.indexOf(childPkColumnName);

        // 単純参照: FK値でグループ化し、表示テキストとPK値を収集
        for (const fk of fkColumns) {
            if (fk.index === -1) continue;

            const groups =
                new Map<string, ReverseReferenceRow[]>();

            for (const row of csv.body) {
                const fkValue = row[fk.index];
                if (fkValue === '') continue;

                const displayText =
                    displayColumnIndex !== -1
                        ? row[displayColumnIndex]
                        : '';
                const pkValue =
                    pkColumnIndex !== -1
                        ? row[pkColumnIndex]
                        : '';

                let list = groups.get(fkValue);
                if (!list) {
                    list = [];
                    groups.set(fkValue, list);
                }
                list.push({ pkValue, displayText });
            }

            // 単純参照の parentColumnName は expr.columnName（参照先の親テーブル列名）
            // 単純参照ではフィルタ不要のため空文字列・空集合を渡す
            this.mergeGroups(
                groups, childTableName, priority, fk.columnName, false, fk.parentColumnName, childPkColumnName, '', new Set(), map
            );
        }

        // 動的参照: フィルタ値にマッチする行のみグループ化し、表示テキストとPK値を収集する。
        // parentColumnName は中間テーブルの targetColumn 列の値から行ごとに動的解決する。
        // 行によって parentColumnName が異なる可能性があるため、parentColumnName ごとにグループを分ける。
        for (const dynFk of dynamicFkColumns) {
            if (dynFk.index === -1 || dynFk.valueColumnIndex === -1) continue;

            // parentColumnName ごとのグループ: parentColumnName → (fkValue → ReverseReferenceRow[])
            const groupsByParentColumn = new Map<string, Map<string, ReverseReferenceRow[]>>();

            for (const row of csv.body) {
                const valueColumnValue = row[dynFk.valueColumnIndex];
                if (!dynFk.matchingFilterValues.has(valueColumnValue)) continue;

                const fkValue = row[dynFk.index];
                if (fkValue === '') continue;

                // valueColumnValue（例: table_id=1）に対応する parentColumnName を動的解決する
                // filterValueToParentColumnName は中間テーブル走査時に構築済み
                // マッピングが見つからない場合はフォールバックせず、この行をスキップする
                if (!dynFk.filterValueToParentColumnName.has(valueColumnValue)) continue;
                const resolvedParentColumnName = dynFk.filterValueToParentColumnName.get(valueColumnValue)!;
                if (resolvedParentColumnName === '') continue;

                const displayText = displayColumnIndex !== -1 ? row[displayColumnIndex] : '';
                const pkValue = pkColumnIndex !== -1 ? row[pkColumnIndex] : '';

                // parentColumnName ごとのグループマップを取得/作成する
                let groups = groupsByParentColumn.get(resolvedParentColumnName);
                if (!groups) {
                    groups = new Map<string, ReverseReferenceRow[]>();
                    groupsByParentColumn.set(resolvedParentColumnName, groups);
                }

                let list = groups.get(fkValue);
                if (!list) {
                    list = [];
                    groups.set(fkValue, list);
                }
                list.push({ pkValue, displayText });
            }

            // 動的参照: FK列名は dynFk.columnName（動的参照式が定義されている子テーブルの列）。
            // parentColumnName は中間テーブルの targetColumn 列の値から動的解決した値を使う。
            // フィルタ列名は dynFk.valueColumnName（例: "table_id"）で、
            // 各 resolvedParentColumnName に対応するフィルタ値を逆引きして渡す
            // （逆参照ジャンプ時に1段目の列値で行を絞り込むために使用する）
            const parentColumnToFilterValues = new Map<string, Set<string>>();
            dynFk.filterValueToParentColumnName.forEach((parentCol, filterVal) => {
                let vals = parentColumnToFilterValues.get(parentCol);
                if (!vals) { vals = new Set(); parentColumnToFilterValues.set(parentCol, vals); }
                vals.add(filterVal);
            });
            groupsByParentColumn.forEach((groups, resolvedParentColumnName) => {
                const filterVals = parentColumnToFilterValues.get(resolvedParentColumnName);
                this.mergeGroups(
                    groups, childTableName, priority, dynFk.columnName, true, resolvedParentColumnName, childPkColumnName,
                    dynFk.valueColumnName, filterVals ? filterVals : new Set(), map
                );
            });
        }
    }

}

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
export function formatReverseReferenceHint(
    entries: ReverseReferenceEntry[]
): string {
    // 表示条件を満たすエントリを抽出（1件かつ表示テキストあり）
    const displayable: ReverseReferenceEntry[] = [];
    for (const entry of entries) {
        if (entry.rows.length === 1 && entry.rows[0].displayText !== '') {
            displayable.push(entry);
        }
        // 2件以上、表示テキストなし → スキップ（REFERENCESパネルで閲覧）
    }
    if (displayable.length === 0) return '';

    // 最小の priority（最高優先度）を特定する
    let minPriority = displayable[0].priority;
    for (let i = 1; i < displayable.length; i++) {
        if (displayable[i].priority < minPriority) {
            minPriority = displayable[i].priority;
        }
    }

    // 最高優先度のエントリのみ表示テキストに含める
    const parts: string[] = [];
    for (const entry of displayable) {
        if (entry.priority === minPriority) {
            parts.push(entry.rows[0].displayText);
        }
    }
    return parts.join(', ');
}
