import type {DebugConsole} from "./debug-console";
import type {EditorAPI} from "./editor-api-types";

/**
 * C# ↔ WebView ブリッジ
 *
 * C# 側から postMessage で送信された editor_api_request を受信し、
 * EditorAPI のメソッドを呼び出してレスポンスを返す。
 * コンストラクタで window.chrome.webview にリスナーを登録する。
 * MCP経由の呼び出しも DebugConsole に記録する。
 */
export class EditorApiBridge {
    private readonly api: EditorAPI;
    private readonly debugConsole: DebugConsole;
    /** リスナー関数。dispose() 後は false（センチネル値） */
    private listener: ((event: MessageEvent) => void) | false;

    constructor(api: EditorAPI, debugConsole: DebugConsole) {
        this.api = api;
        this.debugConsole = debugConsole;
        // コンストラクタ完了時に有効な状態を保証する（生焼けオブジェクト防止）
        this.listener = (event: MessageEvent) => {
            let data: Record<string, unknown>;
            try {
                data = JSON.parse(event.data as string) as Record<string, unknown>;
            } catch {
                return;
            }
            if (data['type'] !== 'editor_api_request') return;
            this.handleRequestAsync(
                data['requestId'] as string,
                data['method'] as string,
                data['params'] as Record<string, unknown>,
            );
        };
        window.chrome.webview.addEventListener('message', this.listener);
    }

    /** リスナーを解除してブリッジを無効化する。dispose 済みの場合はエラー */
    dispose(): void {
        if (this.listener === false) throw new Error('EditorApiBridge.dispose() は既に dispose 済みです。');
        window.chrome.webview.removeEventListener('message', this.listener);
        this.listener = false;
    }

    /** リクエストをディスパッチしてレスポンスを返す（非同期メソッドにも対応） */
    private async handleRequestAsync(requestId: string, method: string, params: Record<string, unknown>): Promise<void> {
        const startTime = performance.now();
        try {
            const result = await this.dispatch(method, params);
            const elapsedUs = Math.round((performance.now() - startTime) * 1000);
            this.debugConsole.appendEntry('[MCP] ' + method, elapsedUs, 'success', 'C#→WebView');
            // awaitポイント後にdispose済みの場合は応答を捨てる（WebView2ライフサイクル保護）
            if (this.listener === false) return;
            window.chrome.webview.postMessage(JSON.stringify({
                type: 'editor_api_response',
                requestId,
                success: true,
                data: result,
            }));
        } catch (e) {
            const elapsedUs = Math.round((performance.now() - startTime) * 1000);
            this.debugConsole.appendEntry('[MCP] ' + method, elapsedUs, 'error', 'C#→WebView');
            if (this.listener === false) return;
            window.chrome.webview.postMessage(JSON.stringify({
                type: 'editor_api_response',
                requestId,
                success: false,
                error: e instanceof Error ? e.message : String(e),
            }));
        }
    }

    /** メソッド名を名前空間.メソッド名に分割してディスパッチする */
    private dispatch(method: string, params: Record<string, unknown>): unknown | Promise<unknown> {
        const dotIndex = method.indexOf('.');
        if (dotIndex === -1) throw new Error('Invalid API method format: ' + method);
        const namespace = method.substring(0, dotIndex);
        const methodName = method.substring(dotIndex + 1);
        switch (namespace) {
            case 'data': return this.dispatchData(methodName, params);
            case 'schema': return this.dispatchSchema(methodName, params);
            case 'edit': return this.dispatchEdit(methodName, params);
            default: throw new Error('Unknown API namespace: ' + namespace);
        }
    }

    /** data 名前空間のディスパッチ */
    private dispatchData(methodName: string, params: Record<string, unknown>): unknown | Promise<unknown> {
        switch (methodName) {
            case 'getTableNames': return this.api.data.getTableNames();
            case 'getHeader': return this.api.data.getHeader(this.requireString(params, 'tableName'));
            case 'getRows': return this.api.data.getRows(this.requireString(params, 'tableName'));
            case 'getRowCount': return this.api.data.getRowCount(this.requireString(params, 'tableName'));
            case 'getCellValue': return this.api.data.getCellValue(this.requireString(params, 'tableName'), this.requireNumber(params, 'row'), this.requireNumber(params, 'column'));
            case 'readTableDataAsync': return this.api.data.readTableDataAsync(this.requireString(params, 'tableName'));
            case 'getReferenceHintsAsync': return this.api.data.getReferenceHintsAsync(this.requireString(params, 'tableName'));
            case 'getRelatedTablesAsync': return this.api.data.getRelatedTablesAsync(this.requireString(params, 'tableName'));
            case 'getValidationErrorsAsync': return this.api.data.getValidationErrorsAsync();
            default: throw new Error('Unknown data method: ' + methodName);
        }
    }

    /** schema 名前空間のディスパッチ */
    private dispatchSchema(methodName: string, params: Record<string, unknown>): unknown {
        switch (methodName) {
            case 'getSchemaTableNames': return this.api.schema.getSchemaTableNames();
            case 'getColumns': return this.api.schema.getColumns(this.requireString(params, 'tableName'));
            case 'getPrimaryKeys': return this.api.schema.getPrimaryKeys(this.requireString(params, 'tableName'));
            case 'getReferences': return this.api.schema.getReferences(this.requireString(params, 'tableName'));
            default: throw new Error('Unknown schema method: ' + methodName);
        }
    }

    /** edit 名前空間のディスパッチ */
    private dispatchEdit(methodName: string, params: Record<string, unknown>): unknown | Promise<unknown> {
        switch (methodName) {
            case 'setCellValue': return this.api.edit.setCellValue(this.requireString(params, 'tableName'), this.requireNumber(params, 'row'), this.requireNumber(params, 'column'), this.requireString(params, 'value'));
            case 'setCellValues': return this.api.edit.setCellValues(this.requireString(params, 'tableName'), this.requireArray(params, 'changes'));
            case 'insertRow': return this.api.edit.insertRow(this.requireString(params, 'tableName'), this.requireNumber(params, 'rowIndex'));
            case 'deleteRow': return this.api.edit.deleteRow(this.requireString(params, 'tableName'), this.requireNumber(params, 'rowIndex'));
            case 'openTableAsync': return this.api.edit.openTableAsync(this.requireString(params, 'tableName'));
            case 'saveTableAsync': return this.api.edit.saveTableAsync(this.requireString(params, 'tableName'));
            default: throw new Error('Unknown edit method: ' + methodName);
        }
    }

    /** params から string 型のパラメータを取り出す。型が異なる場合は Error をスローする */
    private requireString(params: Record<string, unknown>, key: string): string {
        const value = params[key];
        if (typeof value !== 'string') throw new Error('Parameter "' + key + '" must be a string, got ' + typeof value);
        return value;
    }

    /** params から number 型のパラメータを取り出す。型が異なる場合は Error をスローする */
    private requireNumber(params: Record<string, unknown>, key: string): number {
        const value = params[key];
        if (typeof value !== 'number') throw new Error('Parameter "' + key + '" must be a number, got ' + typeof value);
        return value;
    }

    /** params から配列型のパラメータを取り出す。配列でない場合は Error をスローする */
    private requireArray(params: Record<string, unknown>, key: string): Array<{ row: number; column: number; value: string }> {
        const value = params[key];
        if (!Array.isArray(value)) throw new Error('Parameter "' + key + '" must be an array, got ' + typeof value);
        return value as Array<{ row: number; column: number; value: string }>;
    }
}
