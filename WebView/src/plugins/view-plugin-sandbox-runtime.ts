import type {TableDataChangeEvent} from '../data/in-memory-table-store';
import type {ViewPluginAPI, ViewPluginRegistration, ViewPluginMountResult, ViewPluginSaveHandler, ViewPluginEditSession, EditorDisposable} from './master-data-editor-view-plugin';

/** 関数全体を iframe に配置するため、この関数は外側の実行時変数を参照しない。 */
export function runViewPluginSandbox(): void {
    type Pending = {resolve(value: unknown): void; reject(error: Error): void};
    type TableSnapshot = {header: string[]; rows: string[][]};
    type SchemaSnapshot = {columns: unknown; primaryKeys: unknown; references: unknown};
    const pending = new Map<string, Pending>();
    const registrations = new Map<string, ViewPluginRegistration>();
    const handlers = new Map<string, Set<(event: unknown) => void>>();
    const saveHandlers = new Set<ViewPluginSaveHandler>();
    const sessions = new Set<ViewPluginEditSession>();
    let channel = '';
    let initialized = false;
    let started = false;
    let code = '';
    let pluginId: string | null = null;
    const tableData = new Map<string, TableSnapshot>();
    const staging = new Map<string, TableSnapshot>();
    let schemaData = new Map<string, SchemaSnapshot>();
    let dirty = false;
    let mountResult: void | ViewPluginMountResult;
    const applyTheme = (theme: Record<string, string>): void => { for (const [name, value] of Object.entries(theme)) document.documentElement.style.setProperty(name, value); };
    const send = (message: Record<string, unknown>): void => parent.postMessage({...message, channel}, '*');
    const rpcAsync = (method: string, args: unknown[]): Promise<unknown> => new Promise((resolve, reject) => {
        const requestId = crypto.randomUUID();
        const timer = window.setTimeout(() => { pending.delete(requestId); reject(new Error('Viewプラグイン API がタイムアウトしました: ' + method)); }, 15000);
        pending.set(requestId, {resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); }});
        send({type: 'rpc', requestId, method, args});
    });
    const refreshDirty = (): void => send({type: 'dirty', dirty: dirty || [...sessions].some(session => session.isDirty())});
    const saveAsync = async (): Promise<boolean> => {
        let success = true;
        if (mountResult && typeof mountResult !== 'function' && mountResult.save && await mountResult.save() === false) success = false;
        for (const handler of [...saveHandlers]) if (await handler() === false) success = false;
        if (success) dirty = false;
        refreshDirty();
        return success;
    };
    const unsupportedSyncEdit = (): never => { throw new Error('隔離されたViewでは同期編集APIを使用できません。setCellValueAsync / setCellValuesAsync を使用してください。'); };
    const asyncMethods = (namespace: string, names: string[]): Record<string, (...args: unknown[]) => Promise<unknown>> => Object.fromEntries(names.map(name => [name, (...args: unknown[]) => rpcAsync(namespace + '.' + name, args)]));
    const data = {
        getTableNames: () => [...tableData.keys()],
        // 呼出側のsort/splice等で差分適用先の行位置が壊れないよう、明示取得時だけコピーする。
        getHeader: (name: string) => tableData.get(name)?.header.slice() ?? null,
        getRows: (name: string) => tableData.get(name)?.rows.map(row => row.slice()) ?? null,
        getRowCount: (name: string) => tableData.get(name)?.rows.length ?? null,
        getCellValue: (name: string, row: number, column: number) => tableData.get(name)?.rows[row]?.[column] ?? null,
        ...asyncMethods('data', ['readTableDataAsync', 'getReferenceItemsAsync', 'getReferenceDisplayTextAsync', 'getReferenceHintsAsync', 'getRelatedTablesAsync', 'getValidationErrorsAsync', 'searchCellsAsync']),
    } as ViewPluginAPI['data'];
    const schema = {
        getSchemaTableNames: () => [...schemaData.keys()],
        getColumns: (name: string) => schemaData.get(name)?.columns ?? null,
        getPrimaryKeys: (name: string) => schemaData.get(name)?.primaryKeys ?? null,
        getReferences: (name: string) => schemaData.get(name)?.references ?? null,
    } as ViewPluginAPI['schema'];
    const edit: ViewPluginAPI['edit'] = {
        setCellValue: unsupportedSyncEdit, setCellValues: unsupportedSyncEdit, insertRow: unsupportedSyncEdit, deleteRow: unsupportedSyncEdit,
        setCellValueAsync: (...args) => rpcAsync('edit.setCellValueAsync', args) as Promise<boolean>,
        setCellValuesAsync: (...args) => rpcAsync('edit.setCellValuesAsync', args) as Promise<boolean>,
        openTableAsync: (...args) => rpcAsync('edit.openTableAsync', args) as Promise<boolean>,
        saveTableAsync: (...args) => rpcAsync('edit.saveTableAsync', args) as Promise<boolean>,
    };
    const events = Object.fromEntries(['onTableOpened', 'onTableClosed', 'onCellChanged', 'onTableSaved', 'onRowSelected'].map(name => [name, (handler: (event: unknown) => void): EditorDisposable => {
        let listeners = handlers.get(name);
        if (!listeners) { listeners = new Set(); handlers.set(name, listeners); }
        if (listeners.size === 0) send({type: 'subscribe', name});
        listeners.add(handler);
        return {dispose: () => { listeners.delete(handler); if (listeners.size === 0) send({type: 'unsubscribe', name}); }};
    }])) as unknown as ViewPluginAPI['events'];
    const tables: ViewPluginAPI['tables'] = {get: name => ({
        name,
        readRecordsAsync: () => rpcAsync('tables.readRecordsAsync', [name]) as ReturnType<ReturnType<ViewPluginAPI['tables']['get']>['readRecordsAsync']>,
        updateRecordAsync: (ref, changes) => rpcAsync('tables.updateRecordAsync', [name, ref, changes]) as Promise<boolean>,
        saveAsync: () => rpcAsync('tables.saveAsync', [name]) as Promise<boolean>,
    })};
    const api: ViewPluginAPI = {
        data, schema, edit, events, tables, editor: {data, schema, edit, events},
        notification: {show: (message, status) => { send({type: 'notification', message, status: status ?? 'error'}); }},
        view: {
            setDirty: value => { dirty = value; refreshDirty(); },
            isDirty: () => dirty || [...sessions].some(session => session.isDirty()),
            onSave: handler => { saveHandlers.add(handler); return {dispose: () => { saveHandlers.delete(handler); }}; },
            saveAsync,
            createEditSession: () => {
                const revisions = new Map<string, number>();
                const edits = new Set<Promise<boolean>>();
                let revision = 0;
                let disposed = false;
                const session: ViewPluginEditSession = {
                    updateRecordAsync: async (ref, changes) => {
                        if (disposed) return false;
                        const operation = tables.get(ref.tableName).updateRecordAsync(ref, changes);
                        edits.add(operation); refreshDirty();
                        try {
                            const success = await operation;
                            if (success && !disposed) revisions.set(ref.tableName, ++revision);
                            return success;
                        } finally { edits.delete(operation); refreshDirty(); }
                    },
                    saveAsync: async () => {
                        if (disposed) return false;
                        let succeeded = true;
                        while (edits.size > 0) if ((await Promise.all([...edits])).some(value => !value)) succeeded = false;
                        if (!succeeded || disposed) return false;
                        for (const [name, current] of [...revisions]) {
                            if (await tables.get(name).saveAsync()) {
                                if (revisions.get(name) === current) revisions.delete(name);
                            } else succeeded = false;
                        }
                        refreshDirty();
                        return succeeded && revisions.size === 0;
                    },
                    isDirty: () => edits.size > 0 || revisions.size > 0,
                    dispose: () => { disposed = true; revisions.clear(); sessions.delete(session); saveHandlers.delete(session.saveAsync); refreshDirty(); },
                };
                sessions.add(session); saveHandlers.add(session.saveAsync);
                return session;
            },
        },
    };
    const register = (registration: ViewPluginRegistration): void => {
        const version = (registration.apiVersion as number) ?? 1;
        if (version !== 1 && version !== 2) throw new Error('APIバージョン ' + version + ' には対応していません');
        if (typeof registration.id !== 'string' || registration.id.trim() === '' || typeof registration.render !== 'function' || registrations.has(registration.id)) throw new Error('Viewプラグインの登録が不正です');
        registrations.set(registration.id, registration);
    };
    const globalApi = {apiVersion: 2, registerViewPlugin: register, registerView: register, editorApi: api.editor, api};
    Object.assign(window, {masterDataEditor: globalApi, __mde: globalApi});
    window.addEventListener('pagehide', () => {
        try {
            if (typeof mountResult === 'function') mountResult();
            else if (mountResult?.dispose) mountResult.dispose();
        } finally {
            for (const session of [...sessions]) session.dispose();
            for (const plugin of registrations.values()) plugin.dispose?.();
        }
    });
    window.addEventListener('keydown', event => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
            event.preventDefault();
            send({type: 'saveShortcut'});
        }
    });
    window.addEventListener('message', (event: MessageEvent) => {
        if (event.source !== parent || typeof event.data !== 'object' || event.data === null) return;
        const message = event.data as Record<string, unknown>;
        if (!initialized && message.type === 'initialize' && typeof message.channel === 'string') {
            initialized = true;
            channel = message.channel;
            code = String(message.code);
            pluginId = typeof message.pluginId === 'string' ? message.pluginId : null;
            applyTheme(message.theme as Record<string, string>);
            return;
        }
        if (!initialized || message.channel !== channel) return;
        if (message.type === 'start' && !started) {
            started = true;
            Promise.resolve().then(async () => {
                new Function(code)();
                send({type: 'registered', plugins: [...registrations.values()].map(plugin => ({id: plugin.id, title: plugin.title ?? plugin.id, description: plugin.description ?? null}))});
                if (pluginId !== null) {
                    const plugin = registrations.get(pluginId);
                    if (!plugin) throw new Error('Viewプラグインが登録されていません');
                    const root = document.createElement('div');
                    root.className = 'view-plugin-sandbox-root';
                    document.body.append(root);
                    mountResult = await plugin.render(root, api);
                }
                send({type: 'ready'});
            }).catch((error: unknown) => send({type: 'error', message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : ''}));
            return;
        }
        if (message.type === 'tableBegin' && typeof message.tableName === 'string') {
            staging.set(message.tableName, {header: message.header as string[], rows: []});
        } else if (message.type === 'tableRows' && typeof message.tableName === 'string') {
            const table = staging.get(message.tableName);
            if (table) for (const row of message.rows as string[][]) table.rows.push(row);
        } else if (message.type === 'tableEnd' && typeof message.tableName === 'string') {
            const table = staging.get(message.tableName);
            if (table) { tableData.set(message.tableName, table); staging.delete(message.tableName); }
        } else if (message.type === 'tableRemove' && typeof message.tableName === 'string') {
            staging.delete(message.tableName);
            tableData.delete(message.tableName);
        } else if (message.type === 'dataChanges' && typeof message.tableName === 'string') {
            const table = tableData.get(message.tableName);
            if (table) for (const change of message.changes as TableDataChangeEvent[]) {
                const rowIndex = change.rowIndex as number;
                if (change.reason === 'cell') table.rows[rowIndex][change.columnIndex as number] = change.newValue as string;
                else if (change.reason === 'rowInserted') table.rows.splice(rowIndex, 0, change.rowValues as string[]);
                else if (change.reason === 'rowRemoved') table.rows.splice(rowIndex, 1);
            }
        } else if (message.type === 'schema') {
            schemaData = new Map(message.schema as Array<[string, SchemaSnapshot]>);
        } else if (message.type === 'theme') {
            applyTheme(message.theme as Record<string, string>);
        } else if (message.type === 'rpcResult' && typeof message.requestId === 'string') {
            const request = pending.get(message.requestId);
            if (!request) return;
            pending.delete(message.requestId);
            if (message.success === true) request.resolve(message.value);
            else { const error = new Error(String(message.error)); if (typeof message.stack === 'string') error.stack = message.stack; request.reject(error); }
        } else if (message.type === 'event' && typeof message.name === 'string') {
            for (const handler of handlers.get(message.name) ?? []) handler(message.event);
        } else if (message.type === 'save') {
            saveAsync().then(success => send({type: 'saved', requestId: message.requestId, success})).catch((error: unknown) => send({type: 'error', message: String(error), stack: error instanceof Error ? error.stack : ''}));
        }
    });
}
