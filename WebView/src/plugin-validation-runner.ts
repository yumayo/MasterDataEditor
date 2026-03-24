import {InMemoryTableStore} from "./in-memory-table-store";
import {findFilesAsync, readFileAsync} from "./api";

/** プラグインバリデーションエラー */
export interface PluginValidationError {
    /** プラグインファイル名（例: "balance-check.js"） */
    pluginName: string;
    /** assertメッセージ */
    message: string;
}

/**
 * テーブルプロキシのメソッド群
 * tables.xxx でアクセスした際に返されるActiveRecord風API
 */
interface TableAccessor {
    /** 全行を列名→値のオブジェクト配列として返す */
    all(): Record<string, string>[];
    /** 条件に一致する行をフィルタリングする */
    where(predicate: (row: Record<string, string>) => boolean): Record<string, string>[];
    /** 条件に一致する最初の行を返す。見つからなければnull */
    find(predicate: (row: Record<string, string>) => boolean): Record<string, string> | null;
    /** 行数を返す */
    count(): number;
}

/**
 * プラグインバリデーションランナー
 *
 * plugins/ ディレクトリに配置されたJSファイルを読み込み、
 * ActiveRecord風APIでテーブルデータにアクセスしてカスタムバリデーションを実行する。
 * プラグイン内の assert() で収集したエラーを PluginValidationError[] として返す。
 */
export class PluginValidationRunner {

    private readonly store: InMemoryTableStore;

    constructor(store: InMemoryTableStore) {
        this.store = store;
    }

    /**
     * 全プラグインを実行してエラーを収集する。
     * plugins/ ディレクトリが存在しない場合は空配列を返す。
     * 各プラグインの構文エラー・実行時エラーはプラグインエラーとしてキャッチし、
     * 他のプラグインの実行を妨げない。
     */
    async runAllPluginsAsync(): Promise<PluginValidationError[]> {
        // plugins/ ディレクトリのファイル一覧を取得する（存在しなければ空配列を返す）
        let files: { name: string; type: 'file' | 'directory' }[];
        try {
            files = await findFilesAsync("plugins");
        } catch {
            // plugins/ ディレクトリが存在しない場合はエラーをスローするのでキャッチして空配列を返す
            return [];
        }

        // ActiveRecord風 tables プロキシを生成する
        const tablesProxy = this.buildTablesProxy();

        const allErrors: PluginValidationError[] = [];

        for (const file of files) {
            if (file.type !== 'file') continue;
            if (!file.name.endsWith('.js')) continue;

            const pluginName = file.name;
            try {
                const scriptContent = await readFileAsync('plugins/' + pluginName);
                const errors = this.executePlugin(pluginName, scriptContent, tablesProxy);
                for (const error of errors) {
                    allErrors.push(error);
                }
            } catch (e: unknown) {
                // ファイル読み込みエラーもプラグインエラーとして報告する
                allErrors.push({
                    pluginName,
                    message: 'プラグインの読み込みに失敗しました: ' + String(e),
                });
            }
        }

        return allErrors;
    }

    /**
     * 単一プラグインを実行してエラーを収集する。
     * 構文エラー・実行時エラーはキャッチしてプラグインエラーとして返す。
     */
    private executePlugin(
        pluginName: string,
        scriptContent: string,
        tablesProxy: Record<string, TableAccessor>,
    ): PluginValidationError[] {
        const errors: PluginValidationError[] = [];

        // assert関数: conditionがfalseの場合にエラーを収集する
        const assertFn = (condition: boolean, message: string): void => {
            if (!condition) {
                errors.push({ pluginName, message });
            }
        };

        try {
            // new Function でスクリプトを実行する（グローバルスコープへのアクセスは制限されない）
            // プラグインには tables と assert の2つの引数のみを提供する
            const fn = new Function('tables', 'assert', scriptContent);
            fn(tablesProxy, assertFn);
        } catch (e: unknown) {
            // 構文エラーまたは実行時エラーをプラグインエラーとして報告する
            errors.push({
                pluginName,
                message: 'プラグイン実行エラー: ' + String(e),
            });
        }

        return errors;
    }

    /**
     * ActiveRecord風 tables プロキシオブジェクトを構築する。
     * tables.chara のようにテーブル名でアクセスすると TableAccessor が返る。
     * Proxy を使い、任意のテーブル名に対して動的に TableAccessor を生成する。
     */
    private buildTablesProxy(): Record<string, TableAccessor> {
        const store = this.store;

        return new Proxy({} as Record<string, TableAccessor>, {
            get(_target: Record<string, TableAccessor>, prop: string | symbol): TableAccessor | undefined {
                if (typeof prop !== 'string') return undefined;
                const tableName = prop;
                return {
                    all(): Record<string, string>[] {
                        return buildRowObjects(store, tableName);
                    },
                    where(predicate: (row: Record<string, string>) => boolean): Record<string, string>[] {
                        return buildRowObjects(store, tableName).filter(predicate);
                    },
                    find(predicate: (row: Record<string, string>) => boolean): Record<string, string> | null {
                        const rows = buildRowObjects(store, tableName);
                        for (const row of rows) {
                            if (predicate(row)) return row;
                        }
                        return null;
                    },
                    count(): number {
                        const rows = store.getRows(tableName);
                        if (rows === false) return 0;
                        return rows.length;
                    },
                };
            },
        });
    }
}

/**
 * ストアのテーブルデータをRecord<string, string>[]に変換する。
 * ヘッダー配列をキーとして各行を列名→値のオブジェクトにマッピングする。
 * テーブルがストアに存在しない場合は空配列を返す。
 */
function buildRowObjects(store: InMemoryTableStore, tableName: string): Record<string, string>[] {
    const header = store.getHeader(tableName);
    const rows = store.getRows(tableName);
    if (header === false || rows === false) return [];
    const result: Record<string, string>[] = [];
    for (const row of rows) {
        const obj: Record<string, string> = {};
        for (let i = 0; i < header.length; i++) {
            obj[header[i]] = row[i];
        }
        result.push(obj);
    }
    return result;
}
