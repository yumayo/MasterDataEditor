import type {ViewPluginAPI, EditorDisposable} from './master-data-editor-view-plugin';
import type {InMemoryTableStore, TableDataChangeEvent} from '../data/in-memory-table-store';
import type {NotificationToast} from '../ui/notification';
import {isWorkspaceTrusted} from '../app/workspace-trust';
import {runViewPluginSandbox} from './view-plugin-sandbox-runtime';
import type {ViewPluginDescriptor, ViewPluginMountOptions} from './view-plugin-host';

type RpcMethod = (...args: unknown[]) => unknown;

/** プラグインの窓にはデータだけを渡し、ホストの関数・DOM・ネイティブブリッジを渡さない。 */
export class ViewPluginFrame {
    private readonly frame: HTMLIFrameElement;
    private readonly channel: string;
    private readonly store: InMemoryTableStore;
    private readonly tables: Map<string, {header: string[]; rows: string[][]}>;
    private readonly changes: Map<string, TableDataChangeEvent[]>;
    private readonly revisions: Map<string, number>;
    private readonly eventNames: Set<string>;
    private synchronization: Promise<void>;
    private initialized: boolean;
    private schemaSignature: string;
    private readonly api: Omit<ViewPluginAPI, 'view'>;
    private readonly notification: NotificationToast;
    private readonly options: ViewPluginMountOptions;
    private readonly messageHandler: (event: MessageEvent) => void;
    private readonly subscriptions: EditorDisposable[];
    private readonly saves: Map<string, {resolve(value: boolean): void; timer: number}>;
    private readonly methods: Map<string, RpcMethod>;
    private readonly ready: Promise<ViewPluginDescriptor[]>;
    private readonly themeObserver: MutationObserver;
    private dirty: boolean;
    private disposed: boolean;

    constructor(parent: HTMLElement, code: string, pluginId: string | null, api: Omit<ViewPluginAPI, 'view'>, store: InMemoryTableStore, notification: NotificationToast, options: ViewPluginMountOptions) {
        this.api = api;
        this.store = store;
        this.tables = new Map();
        this.changes = new Map();
        this.revisions = new Map();
        this.eventNames = new Set();
        this.synchronization = Promise.resolve();
        this.initialized = false;
        this.schemaSignature = '';
        this.notification = notification;
        this.options = options;
        this.channel = crypto.randomUUID();
        this.dirty = false;
        this.disposed = false;
        this.subscriptions = [];
        this.saves = new Map();
        this.methods = new Map();
        this.frame = document.createElement('iframe');
        this.frame.className = 'view-plugin-sandbox-frame';
        this.frame.title = pluginId === null ? 'Viewプラグインの登録' : 'View: ' + pluginId;
        this.frame.setAttribute('sandbox', 'allow-scripts');
        this.frame.referrerPolicy = 'no-referrer';
        this.frame.style.cssText = 'border:0;width:100%;height:100%;display:block;min-height:0';
        // 同一 origin、外部通信、子 frame、フォーム、ポップアップ、トップ遷移を一切許可しない。
        this.frame.srcdoc = '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' \'unsafe-eval\'; style-src \'unsafe-inline\'; img-src data:; connect-src \'none\'; frame-src \'none\'; child-src \'none\'; worker-src \'none\'; object-src \'none\'; form-action \'none\'; base-uri \'none\'"><style>html,body{margin:0;height:100%;font:13px sans-serif;color:var(--font-color);background:var(--background-color)}body{box-sizing:border-box;padding:12px}button,input,select{font:inherit}.view-plugin-sandbox-root{min-height:100%;box-sizing:border-box}</style></head><body><script>(' + runViewPluginSandbox.toString().replace(/<\/script/gi, '<\\/script') + ')();</script></body></html>';
        for (const [namespace, names] of [
            ['data', ['readTableDataAsync', 'getReferenceItemsAsync', 'getReferenceDisplayTextAsync', 'getReferenceHintsAsync', 'getRelatedTablesAsync', 'getValidationErrorsAsync', 'searchCellsAsync']],
            ['edit', ['setCellValueAsync', 'setCellValuesAsync', 'openTableAsync', 'saveTableAsync']],
        ] as const) {
            for (const name of names) {
                const owner = api[namespace];
                const method = Reflect.get(owner, name) as RpcMethod;
                this.methods.set(namespace + '.' + name, (...args) => method.apply(owner, args));
            }
        }
        this.methods.set('tables.readRecordsAsync', (name) => api.tables.get(String(name)).readRecordsAsync());
        this.methods.set('tables.updateRecordAsync', (name, ref, changes) => api.tables.get(String(name)).updateRecordAsync(ref as Parameters<ReturnType<ViewPluginAPI['tables']['get']>['updateRecordAsync']>[0], changes as Record<string, string>));
        this.methods.set('tables.saveAsync', (name) => api.tables.get(String(name)).saveAsync());
        const completion = Promise.withResolvers<ViewPluginDescriptor[]>();
        this.ready = completion.promise;
        let descriptors: ViewPluginDescriptor[] = [];
        let ready = false;
        // 登録専用frameのエラー通知はHostが担当し、表示用frameでは破棄前に元の例外を通知する。
        const fail = (error: unknown): void => {
            if (this.disposed) return;
            completion.reject(error);
            if (pluginId !== null) this.notification.showError(error);
            this.dispose();
        };
        const timeout = window.setTimeout(() => fail(new Error('Viewプラグインの起動がタイムアウトしました')), 15000);
        this.messageHandler = async event => {
            if (this.disposed || !isWorkspaceTrusted() || event.source !== this.frame.contentWindow || typeof event.data !== 'object' || event.data === null) return;
            const message = event.data as Record<string, unknown>;
            if (message.channel !== this.channel) return;
            if (message.type === 'registered' && Array.isArray(message.plugins)) {
                descriptors = message.plugins.filter((value: unknown): value is ViewPluginDescriptor => typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'string' && value.id.trim() !== '' && 'title' in value && typeof value.title === 'string' && 'description' in value && (value.description === null || typeof value.description === 'string'));
            } else if (message.type === 'ready') {
                ready = true; clearTimeout(timeout); completion.resolve(descriptors);
            } else if (message.type === 'error') {
                const error = new Error(String(message.message));
                if (typeof message.stack === 'string' && message.stack !== '') error.stack = message.stack;
                clearTimeout(timeout); completion.reject(error);
                if (ready || pluginId !== null) this.notification.showError(error, 'Viewプラグインの実行に失敗しました');
                for (const request of this.saves.values()) { clearTimeout(request.timer); request.resolve(false); }
                this.saves.clear();
            } else if (pluginId !== null && message.type === 'rpc' && typeof message.requestId === 'string' && typeof message.method === 'string' && Array.isArray(message.args)) {
                const requestId = message.requestId;
                try {
                    const method = this.methods.get(message.method);
                    if (!method) throw new Error('許可されていないView APIです: ' + message.method);
                    const value = await method(...message.args);
                    if (this.disposed || !isWorkspaceTrusted()) return;
                    await this.synchronizeDataAsync();
                    this.send({type: 'rpcResult', requestId, success: true, value});
                } catch (error: unknown) {
                    try { await this.synchronizeDataAsync(); } catch (syncError: unknown) { fail(syncError); return; }
                    this.send({type: 'rpcResult', requestId, success: false, error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : ''});
                }
            } else if (pluginId !== null && message.type === 'subscribe' && typeof message.name === 'string') {
                this.eventNames.add(message.name);
            } else if (pluginId !== null && message.type === 'unsubscribe' && typeof message.name === 'string') {
                this.eventNames.delete(message.name);
            } else if (pluginId !== null && message.type === 'dirty' && typeof message.dirty === 'boolean') {
                this.setDirty(message.dirty);
            } else if (pluginId !== null && message.type === 'notification' && typeof message.message === 'string') {
                this.notification.show(message.message, message.status === 'success' ? 'success' : 'error');
            } else if (message.type === 'saved' && typeof message.requestId === 'string') {
                const request = this.saves.get(message.requestId);
                if (request) { clearTimeout(request.timer); this.saves.delete(message.requestId); request.resolve(message.success === true); }
            } else if (pluginId !== null && message.type === 'saveShortcut') {
                void this.saveAsync();
            }
        };
        window.addEventListener('message', this.messageHandler);
        this.frame.addEventListener('load', () => {
            if (this.disposed || !isWorkspaceTrusted()) return;
            this.send({type: 'initialize', code, pluginId, theme: this.theme()});
            this.initialized = true;
            // 登録コードはデータを必要としない。表示時だけ同期API用の初期データを揃える。
            if (pluginId === null) this.send({type: 'start'});
            else void this.synchronizeDataAsync().then(() => this.send({type: 'start'})).catch(fail);
        }, {once: true});
        parent.appendChild(this.frame);
        this.themeObserver = new MutationObserver(() => this.send({type: 'theme', theme: this.theme()}));
        this.themeObserver.observe(document.body, {attributes: true, attributeFilter: ['data-theme']});
        this.subscriptions.push({dispose: () => { clearTimeout(timeout); completion.resolve([]); }});
        if (pluginId !== null) {
            let scheduled = false;
            this.subscriptions.push({dispose: store.subscribeDataChange(event => {
                if (event.reason === 'stale') return; // 遅延再読込の予約では実データはまだ変化しない。
                this.revisions.set(event.tableName, (this.revisions.get(event.tableName) ?? 0) + 1);
                const changes = this.changes.get(event.tableName) ?? [];
                changes.push(event);
                this.changes.set(event.tableName, changes);
                if (!this.initialized || scheduled) return;
                scheduled = true;
                queueMicrotask(() => {
                    scheduled = false;
                    void this.synchronizeDataAsync().catch(fail);
                });
            })});
            // 開閉での表登録/削除も検出する。データ同期は購読の有無によらず必要。
            for (const name of ['onTableOpened', 'onTableClosed', 'onCellChanged', 'onTableSaved', 'onRowSelected'] as const) {
                this.subscriptions.push(api.events[name]((event: unknown) => {
                    if (!this.initialized) return;
                    void this.synchronizeDataAsync().then(() => {
                        if (this.eventNames.has(name)) this.send({type: 'event', name, event});
                    }).catch(fail);
                }));
            }
        }
    }

    waitUntilReadyAsync(): Promise<ViewPluginDescriptor[]> { return this.ready; }
    isDirty(): boolean { return this.dirty; }
    setDirty(value: boolean): void { this.dirty = value; this.options.onDirtyChanged?.(value); }

    async saveAsync(): Promise<boolean> {
        await this.ready;
        if (this.disposed || !isWorkspaceTrusted()) return false;
        return new Promise(resolve => {
            const requestId = crypto.randomUUID();
            const timer = window.setTimeout(() => {
                this.saves.delete(requestId); resolve(false);
                this.notification.show('Viewプラグインの保存がタイムアウトしました', 'error');
            }, 15000);
            this.saves.set(requestId, {resolve, timer});
            this.send({type: 'save', requestId});
        });
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        window.removeEventListener('message', this.messageHandler);
        this.themeObserver.disconnect();
        for (const subscription of this.subscriptions) subscription.dispose();
        for (const request of this.saves.values()) { clearTimeout(request.timer); request.resolve(false); }
        this.saves.clear();
        this.frame.remove();
        this.setDirty(false);
    }

    private theme(): Record<string, string> {
        const style = getComputedStyle(document.body);
        return Object.fromEntries([...style].filter(name => name.startsWith('--')).map(name => [name, style.getPropertyValue(name)]));
    }

    /** RPC応答・イベントより先に同期キャッシュを更新する。全転送を直列化し、途中の表を公開しない。 */
    private synchronizeDataAsync(): Promise<void> {
        this.synchronization = this.synchronization.then(async () => {
            if (!this.initialized || this.disposed || !isWorkspaceTrusted()) return;
            const schema = this.api.schema.getSchemaTableNames().map(name => [name, {columns: this.api.schema.getColumns(name), primaryKeys: this.api.schema.getPrimaryKeys(name), references: this.api.schema.getReferences(name)}]);
            const signature = JSON.stringify(schema);
            if (signature !== this.schemaSignature) {
                this.schemaSignature = signature;
                this.send({type: 'schema', schema});
            }
            let changed = true;
            while (changed && !this.disposed && isWorkspaceTrusted()) {
                const names = this.store.getTableNames();
                const currentNames = new Set(names);
                for (const name of this.tables.keys()) {
                    if (currentNames.has(name)) continue;
                    this.send({type: 'tableRemove', tableName: name});
                    this.tables.delete(name);
                }
                for (const name of this.changes.keys()) if (!currentNames.has(name)) this.changes.delete(name);
                for (const name of names) {
                    const header = this.store.getHeader(name);
                    const rows = this.store.getRows(name);
                    if (header === false || rows === false) continue;
                    const previous = this.tables.get(name);
                    const changes = this.changes.get(name) ?? [];
                    if (previous?.header === header && previous.rows === rows && changes.every(change => change.reason === 'cell' || change.reason === 'rowInserted' || change.reason === 'rowRemoved')) {
                        this.changes.delete(name);
                        if (changes.length > 0) this.send({type: 'dataChanges', tableName: name, changes});
                        continue;
                    }
                    // API.getRowsの全行deep cloneを避け、storeから1メッセージ分だけを取り出す。
                    // 転送中に行位置や列構造が変わった場合は、未公開のstagingを捨てて当該表をやり直す。
                    let transferring = true;
                    while (transferring && !this.disposed && isWorkspaceTrusted()) {
                        const transferHeader = this.store.getHeader(name);
                        const transferRows = this.store.getRows(name);
                        if (transferHeader === false || transferRows === false) {
                            this.send({type: 'tableRemove', tableName: name});
                            this.tables.delete(name);
                            this.changes.delete(name);
                            break;
                        }
                        const revision = this.revisions.get(name) ?? 0;
                        this.send({type: 'tableBegin', tableName: name, header: transferHeader});
                        let stable = true;
                        for (let offset = 0; offset < transferRows.length; offset += 2000) {
                            if (this.disposed || !isWorkspaceTrusted()) return;
                            this.send({type: 'tableRows', tableName: name, rows: transferRows.slice(offset, offset + 2000)});
                            // WebViewの操作とiframe側の受信を進め、巨大表でUIスレッドを占有しない。
                            await new Promise<void>(resolve => window.setTimeout(resolve, 0));
                            stable = (this.revisions.get(name) ?? 0) === revision && this.store.getRows(name) === transferRows && this.store.getHeader(name) === transferHeader;
                            if (!stable) break;
                        }
                        if (!stable) continue;
                        if (this.disposed || !isWorkspaceTrusted()) return;
                        this.send({type: 'tableEnd', tableName: name});
                        this.tables.set(name, {header: transferHeader, rows: transferRows});
                        this.changes.delete(name);
                        transferring = false;
                    }
                }
                // await中の別表変更や、通知を持たないregister/unregisterも取りこぼさない。
                const latestNames = this.store.getTableNames();
                changed = this.changes.size > 0 || latestNames.length !== this.tables.size || latestNames.some(name => {
                    const table = this.tables.get(name);
                    return !table || table.header !== this.store.getHeader(name) || table.rows !== this.store.getRows(name);
                });
            }
        });
        return this.synchronization;
    }

    private send(message: Record<string, unknown>): void {
        if (!this.disposed && isWorkspaceTrusted()) this.frame.contentWindow?.postMessage({...message, channel: this.channel}, '*');
    }
}
