import {InMemoryTableStore} from "./in-memory-table-store";
import {findFilesAsync, readFileAsync} from "./api";

/** プラグインバリデーションエラー */
export interface PluginValidationError {
    /** プラグインファイル名（例: "balance-check.js"） */
    pluginName: string;
    /** assertメッセージ */
    message: string;
    /** ジャンプ先テーブル名（行オブジェクトから自動解決。指定なしの場合は null） */
    tableName: string | null;
    /** ジャンプ先ストア行インデックス（行オブジェクトから自動解決。指定なしの場合は -1） */
    rowIndex: number;
    /** ジャンプ先列名（assert第4引数から。指定なしの場合は null） */
    columnName: string | null;
}

/** プラグイン実行のタイムアウト（ミリ秒） */
const WORKER_TIMEOUT_MS = 10000;

/**
 * Web Worker 内で実行されるサンドボックススクリプト。
 * Worker スコープには window / document / localStorage が存在しないため、
 * プラグインコードから DOM やストレージにアクセスすることはできない。
 *
 * メインスレッドから { plugins, tableData } を受信し、
 * 各プラグインを実行して収集したエラーを { errors } で返す。
 */
const WORKER_SCRIPT = `'use strict';
var ROW_META = Symbol('meta');

function buildRows(tableName, header, rows) {
    var result = [];
    for (var r = 0; r < rows.length; r++) {
        var obj = {};
        for (var i = 0; i < header.length; i++) obj[header[i]] = rows[r][i];
        obj[ROW_META] = { tableName: tableName, rowIndex: r };
        result.push(obj);
    }
    return result;
}

self.onmessage = function(e) {
    var plugins = e.data.plugins;
    var tableData = e.data.tableData;

    var tables = new Proxy({}, {
        get: function(_, prop) {
            if (typeof prop !== 'string') return undefined;
            var data = tableData[prop];
            if (!data) return {
                all: function() { return []; },
                where: function() { return []; },
                find: function() { return null; },
                count: function() { return 0; }
            };
            return {
                all: function() { return buildRows(prop, data.header, data.rows); },
                where: function(pred) { return buildRows(prop, data.header, data.rows).filter(pred); },
                find: function(pred) {
                    var rows = buildRows(prop, data.header, data.rows);
                    for (var i = 0; i < rows.length; i++) { if (pred(rows[i])) return rows[i]; }
                    return null;
                },
                count: function() { return data.rows.length; }
            };
        }
    });

    var allErrors = [];
    for (var p = 0; p < plugins.length; p++) {
        var plugin = plugins[p];
        var errors = [];
        var assertFn = (function(pluginName, pluginErrors) {
            return function(condition, message, row, columnName) {
                if (!condition) {
                    var meta = (row && row[ROW_META]) ? row[ROW_META] : null;
                    pluginErrors.push({
                        pluginName: pluginName,
                        message: String(message),
                        tableName: meta ? meta.tableName : null,
                        rowIndex: meta ? meta.rowIndex : -1,
                        columnName: typeof columnName === 'string' ? columnName : null
                    });
                }
            };
        })(plugin.name, errors);

        try {
            var fn = new Function('tables', 'assert', plugin.content);
            fn(tables, assertFn);
        } catch (err) {
            errors.push({
                pluginName: plugin.name,
                message: String(err),
                tableName: null,
                rowIndex: -1,
                columnName: null
            });
        }
        for (var i = 0; i < errors.length; i++) allErrors.push(errors[i]);
    }

    self.postMessage({ errors: allErrors });
};
`;

/**
 * プラグインバリデーションランナー
 *
 * plugins/ ディレクトリに配置されたJSファイルを読み込み、
 * Web Worker 内のサンドボックスで実行する。
 * Worker スコープでは window / document / localStorage にアクセスできないため、
 * プラグインが DOM を破壊したりストレージを消去するリスクがない。
 * プラグイン内の assert() で収集したエラーを PluginValidationError[] として返す。
 */
export class PluginValidationRunner {

    private readonly store: InMemoryTableStore;
    /** Worker スクリプトの Blob URL（インスタンス生存期間中再利用する） */
    private readonly workerBlobUrl: string;

    constructor(store: InMemoryTableStore) {
        this.store = store;
        this.workerBlobUrl = URL.createObjectURL(new Blob([WORKER_SCRIPT], { type: 'application/javascript' }));
    }

    /**
     * 全プラグインを Web Worker 内で実行してエラーを収集する。
     * plugins/ ディレクトリが存在しない場合は空配列を返す。
     * 各プラグインの構文エラー・実行時エラーはプラグインエラーとしてキャッチし、
     * 他のプラグインの実行を妨げない。
     * 無限ループ等でWorkerが応答しない場合は WORKER_TIMEOUT_MS 後にタイムアウトエラーを返す。
     */
    async runAllPluginsAsync(): Promise<PluginValidationError[]> {
        // plugins/ ディレクトリのファイル一覧を取得する（存在しなければ空配列を返す）
        let files: { name: string; type: 'file' | 'directory' }[];
        try {
            files = await findFilesAsync("plugins");
        } catch {
            return [];
        }

        // プラグインファイルを読み込む
        const plugins: { name: string; content: string }[] = [];
        const readErrors: PluginValidationError[] = [];
        for (const file of files) {
            if (file.type !== 'file') continue;
            if (!file.name.endsWith('.js')) continue;
            try {
                const content = await readFileAsync('plugins/' + file.name);
                plugins.push({ name: file.name, content });
            } catch (e: unknown) {
                readErrors.push({
                    pluginName: file.name,
                    message: 'プラグインの読み込みに失敗しました: ' + String(e),
                    tableName: null,
                    rowIndex: -1,
                    columnName: null,
                });
            }
        }

        if (plugins.length === 0) return readErrors;

        // ストアの全テーブルデータをシリアライズする（Worker に structured clone で送信される）
        const tableData: Record<string, { header: string[]; rows: string[][] }> = {};
        for (const tableName of this.store.getTableNames()) {
            const header = this.store.getHeader(tableName);
            const rows = this.store.getRows(tableName);
            if (header !== false && rows !== false) {
                tableData[tableName] = { header, rows };
            }
        }

        const workerErrors = await this.executeInWorkerAsync(plugins, tableData);
        return [...readErrors, ...workerErrors];
    }

    /**
     * プラグインを Web Worker 内で実行し、エラーを受信する。
     * タイムアウト・Worker エラー時はエラー情報を返す（reject しない）。
     */
    private executeInWorkerAsync(
        plugins: { name: string; content: string }[],
        tableData: Record<string, { header: string[]; rows: string[][] }>,
    ): Promise<PluginValidationError[]> {
        return new Promise((resolve) => {
            const worker = new Worker(this.workerBlobUrl);

            const timeoutId = setTimeout(() => {
                worker.terminate();
                resolve([{
                    pluginName: '(system)',
                    message: 'プラグインの実行がタイムアウトしました（' + (WORKER_TIMEOUT_MS / 1000) + '秒）',
                    tableName: null,
                    rowIndex: -1,
                    columnName: null,
                }]);
            }, WORKER_TIMEOUT_MS);

            worker.onmessage = (e: MessageEvent<{ errors: PluginValidationError[] }>) => {
                clearTimeout(timeoutId);
                worker.terminate();
                resolve(e.data.errors);
            };

            worker.onerror = (e: ErrorEvent) => {
                clearTimeout(timeoutId);
                worker.terminate();
                resolve([{
                    pluginName: '(system)',
                    message: 'Worker エラー: ' + String(e.message),
                    tableName: null,
                    rowIndex: -1,
                    columnName: null,
                }]);
            };

            worker.postMessage({ plugins, tableData });
        });
    }
}
