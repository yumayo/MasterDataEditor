import {findFilesAsync, readFileAsync} from "./api";
import {config} from "./config";
import {Csv} from "./csv";
import {InMemoryTableStore} from "./in-memory-table-store";
import {
    parseReferenceExpression,
    isSimpleReference,
    isDynamicReference,
    DynamicReference
} from "./reference-expression";

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
}

/**
 * 逆参照マップ
 * キー: 親テーブルのPK値
 * 値: そのPK値を参照しているエントリの配列
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

    constructor(store: InMemoryTableStore) {
        this.store = store;
    }

    /**
     * 指定テーブルを参照している全子テーブルを走査し、
     * 逆参照マップを構築する
     * @param tableName 親テーブル名
     */
    async resolveAsync(
        tableName: string
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
     * childColumnName: 単純参照のFK列名。動的参照の場合は空文字列を渡す
     */
    private mergeGroups(
        groups: Map<string, ReverseReferenceRow[]>,
        childTableName: string,
        priority: number,
        childColumnName: string,
        map: ReverseReferenceMap
    ): void {
        groups.forEach(
            (rows, parentPkValue) => {
                let entries =
                    map.get(parentPkValue);
                if (!entries) {
                    entries = [];
                    map.set(
                        parentPkValue, entries
                    );
                }
                entries.push({
                    childTableName,
                    rows,
                    priority,
                    childColumnName,
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
            reference?: string;
        }>;

        // parentTableName を参照しているFK列を探す
        const fkColumns: Array<{
            columnName: string;
            index: number;
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
            if (lookupIdx === -1
                || filterIdx === -1) {
                continue;
            }

            // lookupColumn の値が parentTableName と
            // 一致する行の filterColumn 値を収集する
            const matchingFilterValues =
                new Set<string>();
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
        // 該当する列がない場合は空文字を使い、
        // テーブル名(件数) 形式で表示する
        const displayColumnIndex =
            this.determineDisplayColumnIndex(
                schema.header, csv.header
            );

        // PK列のインデックスを取得
        const pkColumnIndex =
            csv.header.indexOf(
                config.primaryKeyColumnName
            );

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

            this.mergeGroups(
                groups, childTableName, priority, fk.columnName, map
            );
        }

        // 動的参照: フィルタ値にマッチする行のみ
        // グループ化し、表示テキストとPK値を収集
        for (const dynFk of dynamicFkColumns) {
            if (dynFk.index === -1
                || dynFk.valueColumnIndex === -1) {
                continue;
            }

            const groups =
                new Map<string, ReverseReferenceRow[]>();

            for (const row of csv.body) {
                const valueColumnValue =
                    row[dynFk.valueColumnIndex];
                if (!dynFk.matchingFilterValues
                    .has(valueColumnValue)) {
                    continue;
                }

                const fkValue = row[dynFk.index];
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

            // 動的参照はFK列名を特定できないため空文字列を設定する
            this.mergeGroups(
                groups, childTableName, priority, '', map
            );
        }
    }

    /**
     * スキーマヘッダーとCSVヘッダーから表示列のインデックスを決定する
     */
    private determineDisplayColumnIndex(
        schemaHeader: Array<{ name: string }>,
        csvHeader: string[]
    ): number {
        const columnNames =
            schemaHeader.map(h => h.name);

        for (
            const priority
            of config.referenceDisplayColumnPriority
        ) {
            if (columnNames.includes(priority)) {
                return csvHeader.indexOf(priority);
            }
        }
        return -1;
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
