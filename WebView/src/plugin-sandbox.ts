/**
 * プラグインバリデーション用 Web Worker サンドボックス
 *
 * Worker スコープには window / document / localStorage が存在しないため、
 * プラグインコードから DOM やストレージにアクセスすることはできない。
 *
 * メインスレッドから { plugins, tableData } を受信し、
 * 各プラグインを実行して収集したエラーを { errors } で返す。
 */

/** 行オブジェクトに埋め込むメタデータの Symbol キー */
const ROW_META = Symbol('meta');

interface RowMeta {
    tableName: string;
    rowIndex: number;
}

interface PluginEntry {
    name: string;
    content: string;
}

interface TableEntry {
    header: string[];
    rows: string[][];
}

interface WorkerInput {
    plugins: PluginEntry[];
    tableData: Record<string, TableEntry>;
}

interface PluginError {
    pluginName: string;
    message: string;
    tableName: string | null;
    rowIndex: number;
    columnName: string | null;
}

/**
 * テーブルの行データを列名→値のオブジェクト配列に変換する。
 * 各オブジェクトに ROW_META Symbol でテーブル名・行インデックスを埋め込む。
 */
function buildRows(tableName: string, header: string[], rows: string[][]): Record<string | symbol, unknown>[] {
    const result: Record<string | symbol, unknown>[] = [];
    for (let r = 0; r < rows.length; r++) {
        const obj: Record<string | symbol, unknown> = {};
        for (let i = 0; i < header.length; i++) {
            obj[header[i]] = rows[r][i];
        }
        obj[ROW_META] = { tableName, rowIndex: r } satisfies RowMeta;
        result.push(obj);
    }
    return result;
}

/**
 * tables プロキシを構築する。
 * tables.chara.all() のようにテーブル名でアクセスして ActiveRecord 風にデータを取得する。
 */
function buildTablesProxy(tableData: Record<string, TableEntry>): Record<string | symbol, unknown> {
    const emptyAccessor = {
        all(): unknown[] { return []; },
        where(): unknown[] { return []; },
        find(): null { return null; },
        count(): number { return 0; },
    };

    return new Proxy({} as Record<string, unknown>, {
        get(_: Record<string, unknown>, prop: string | symbol): unknown {
            if (typeof prop !== 'string') return undefined;
            const data = tableData[prop];
            if (data === undefined) return emptyAccessor;
            const tableName = prop;
            return {
                all(): unknown[] {
                    return buildRows(tableName, data.header, data.rows);
                },
                where(predicate: (row: Record<string, string>) => boolean): unknown[] {
                    return (buildRows(tableName, data.header, data.rows) as unknown as Record<string, string>[]).filter(predicate);
                },
                find(predicate: (row: Record<string, string>) => boolean): unknown {
                    const rows = buildRows(tableName, data.header, data.rows) as unknown as Record<string, string>[];
                    for (const row of rows) {
                        if (predicate(row)) return row;
                    }
                    return null;
                },
                count(): number {
                    return data.rows.length;
                },
            };
        },
    });
}

// Worker のメッセージハンドラ
self.onmessage = (e: MessageEvent<WorkerInput>) => {
    const { plugins, tableData } = e.data;
    const tables = buildTablesProxy(tableData);

    const allErrors: PluginError[] = [];

    for (const plugin of plugins) {
        const errors: PluginError[] = [];

        const assertFn = (condition: boolean, message: string, row?: Record<string | symbol, unknown>, columnName?: string): void => {
            if (!condition) {
                const meta = (row !== undefined && row[ROW_META] !== undefined) ? row[ROW_META] as RowMeta : null;
                errors.push({
                    pluginName: plugin.name,
                    message: String(message),
                    tableName: meta !== null ? meta.tableName : null,
                    rowIndex: meta !== null ? meta.rowIndex : -1,
                    columnName: typeof columnName === 'string' ? columnName : null,
                });
            }
        };

        try {
            const fn = new Function('tables', 'assert', plugin.content);
            fn(tables, assertFn);
        } catch (err: unknown) {
            errors.push({
                pluginName: plugin.name,
                message: String(err),
                tableName: null,
                rowIndex: -1,
                columnName: null,
            });
        }

        for (const error of errors) {
            allErrors.push(error);
        }
    }

    self.postMessage({ errors: allErrors });
};
