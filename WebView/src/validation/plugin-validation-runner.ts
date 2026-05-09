import {InMemoryTableStore} from "../data/in-memory-table-store";
import {findFilesAsync, readFileAsync} from "../app/api";
import SandboxWorker from "./plugin-sandbox?worker&inline";

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

/** プラグインエラーの解決済み中間表現。消費者（ValidationPanel, EditorAPI）が自身の型に変換するための共通構造。 */
export interface ResolvedPluginError {
    tableName: string;
    rowIndex: number;
    columnName: string;
    value: string;
    pluginName: string;
    message: string;
}

export interface PluginValidationRunDebugPayload {
    request: unknown;
    response: unknown;
}

export interface PluginValidationRunResult {
    errors: PluginValidationError[];
    debug: PluginValidationRunDebugPayload;
}

type PluginFileEntry = { name: string; type: 'file' | 'directory' };
type PluginEntry = { name: string; content: string };
type PluginTableData = Record<string, { header: string[]; rows: string[][] }>;
type PluginTableDataDebugSnapshot = Record<string, { header: string[]; rowCount: number; rowsPreview: string[][] }>;

const DEBUG_ROW_PREVIEW_LIMIT = 5;

/**
 * PluginValidationError をストア参照で解決し、テーブル名・行・列・セル値を確定させる。
 * コンテキスト付きエラー（行オブジェクトが渡された assert）はストアから列インデックスとセル値を解決する。
 * コンテキストなしエラー（構文エラー等）は tableName='プラグイン', rowIndex=-1 として返す。
 * message にはプラグイン名プレフィックスを含めない（プラグイン名は columnName で参照可能）。
 */
export function resolvePluginErrors(pluginErrors: PluginValidationError[], store: InMemoryTableStore): ResolvedPluginError[] {
    const result: ResolvedPluginError[] = [];
    for (let i = 0; i < pluginErrors.length; ++i) {
        const pe = pluginErrors[i];
        if (pe.tableName !== null && pe.rowIndex !== -1) {
            const header = store.getHeader(pe.tableName);
            const columnName = pe.columnName !== null ? pe.columnName : '';
            let cellValue = '';
            if (header !== false && pe.columnName !== null) {
                const colIdx = header.indexOf(pe.columnName);
                if (colIdx !== -1) {
                    const rows = store.getRows(pe.tableName);
                    if (rows !== false && pe.rowIndex < rows.length) {
                        cellValue = rows[pe.rowIndex][colIdx];
                    }
                }
            }
            result.push({ tableName: pe.tableName, rowIndex: pe.rowIndex, columnName, value: cellValue, pluginName: pe.pluginName, message: pe.message });
        } else {
            result.push({ tableName: 'プラグイン', rowIndex: -1, columnName: pe.pluginName, value: '', pluginName: pe.pluginName, message: pe.message });
        }
    }
    return result;
}

/** プラグイン実行のタイムアウト（ミリ秒） */
const WORKER_TIMEOUT_MS = 10000;

/**
 * プラグインバリデーションランナー
 *
 * plugins/ ディレクトリに配置されたJSファイルを読み込み、
 * Web Worker 内のサンドボックス（plugin-sandbox.ts）で実行する。
 * Worker スコープでは window / document / localStorage にアクセスできないため、
 * プラグインが DOM を破壊したりストレージを消去するリスクがない。
 * プラグイン内の assert() で収集したエラーを PluginValidationError[] として返す。
 */
export class PluginValidationRunner {

    private readonly store: InMemoryTableStore;

    constructor(store: InMemoryTableStore) {
        this.store = store;
    }

    /**
     * 全プラグインを Web Worker 内で実行してエラーを収集する。
     * plugins/ ディレクトリが存在しない場合は空配列を返す。
     * 各プラグインの構文エラー・実行時エラーはプラグインエラーとしてキャッチし、
     * 他のプラグインの実行を妨げない。
     * 無限ループ等でWorkerが応答しない場合は WORKER_TIMEOUT_MS 後にタイムアウトエラーを返す。
     */
    async runAllPluginsAsync(): Promise<PluginValidationError[]> {
        return (await this.runAllPluginsWithDebugAsync()).errors;
    }

    async runAllPluginsWithDebugAsync(requestId: string = ''): Promise<PluginValidationRunResult> {
        const request = {
            type: 'validate_plugin_request',
            requestId,
            directory: 'plugins',
            files: [] as PluginFileEntry[],
            plugins: [] as PluginEntry[],
            tableData: {} as PluginTableDataDebugSnapshot,
        };

        // plugins/ ディレクトリのファイル一覧を取得する（存在しなければ空配列を返す）
        let files: PluginFileEntry[];
        try {
            files = await findFilesAsync("plugins");
            request.files = files;
        } catch (e: unknown) {
            const response = {
                type: 'validate_plugin_response',
                requestId,
                success: true,
                data: {
                    errors: [] as PluginValidationError[],
                    skipped: true,
                    reason: 'plugins directory not found',
                    message: String(e),
                },
            };
            return { errors: [], debug: { request, response } };
        }

        // プラグインファイルを読み込む
        const plugins: PluginEntry[] = [];
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
        request.plugins = plugins;

        if (plugins.length === 0) {
            const response = {
                type: 'validate_plugin_response',
                requestId,
                success: true,
                data: {
                    errors: readErrors,
                    readErrors,
                    workerErrors: [] as PluginValidationError[],
                },
            };
            return { errors: readErrors, debug: { request, response } };
        }

        // ストアの全テーブルデータをシリアライズする（Worker に structured clone で送信される）
        const tableData: PluginTableData = {};
        for (const tableName of this.store.getTableNames()) {
            const header = this.store.getHeader(tableName);
            const rows = this.store.getRows(tableName);
            if (header !== false && rows !== false) {
                tableData[tableName] = { header, rows };
            }
        }
        request.tableData = this.createTableDataDebugSnapshot(tableData);

        const workerErrors = await this.executeInWorkerAsync(plugins, tableData);
        const errors = [...readErrors, ...workerErrors];
        const response = {
            type: 'validate_plugin_response',
            requestId,
            success: true,
            data: {
                errors,
                readErrors,
                workerErrors,
            },
        };
        return { errors, debug: { request, response } };
    }

    private createTableDataDebugSnapshot(tableData: PluginTableData): PluginTableDataDebugSnapshot {
        const snapshot: PluginTableDataDebugSnapshot = {};
        for (const [tableName, data] of Object.entries(tableData)) {
            snapshot[tableName] = {
                header: data.header,
                rowCount: data.rows.length,
                rowsPreview: data.rows.slice(0, DEBUG_ROW_PREVIEW_LIMIT),
            };
        }
        return snapshot;
    }

    /**
     * プラグインを Web Worker 内で実行し、エラーを受信する。
     * Vite のネイティブ Worker サポートにより plugin-sandbox.ts を直接ワーカーとして起動する。
     * タイムアウト・Worker エラー時はエラー情報を返す（reject しない）。
     */
    private executeInWorkerAsync(
        plugins: PluginEntry[],
        tableData: PluginTableData,
    ): Promise<PluginValidationError[]> {
        return new Promise((resolve) => {
            const worker = new SandboxWorker();

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
