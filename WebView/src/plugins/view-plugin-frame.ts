import type {ViewPluginAPI, EditorDisposable} from './master-data-editor-view-plugin';
import type {NotificationToast} from '../ui/notification';
import {isWorkspaceTrusted} from '../app/workspace-trust';
import {runViewPluginSandbox} from './view-plugin-sandbox-runtime';
import type {ViewPluginDescriptor, ViewPluginMountOptions} from './view-plugin-host';

type RpcMethod = (...args: unknown[]) => unknown;

/** プラグインの窓にはデータだけを渡し、ホストの関数・DOM・ネイティブブリッジを渡さない。 */
export class ViewPluginFrame {
    private readonly frame: HTMLIFrameElement;
    private readonly channel: string;
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

    constructor(parent: HTMLElement, code: string, pluginId: string | null, api: Omit<ViewPluginAPI, 'view'>, notification: NotificationToast, options: ViewPluginMountOptions) {
        this.api = api;
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
        const timeout = window.setTimeout(() => { completion.reject(new Error('Viewプラグインの起動がタイムアウトしました')); this.dispose(); }, 15000);
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
                    this.send({type: 'rpcResult', requestId, success: true, value, snapshot: this.snapshot()});
                } catch (error: unknown) {
                    this.send({type: 'rpcResult', requestId, success: false, error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : '', snapshot: this.snapshot()});
                }
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
            if (!this.disposed && isWorkspaceTrusted()) this.send({type: 'initialize', code, pluginId, snapshot: this.snapshot()});
        }, {once: true});
        parent.appendChild(this.frame);
        this.themeObserver = new MutationObserver(() => this.send({type: 'event', name: 'theme', event: {}, snapshot: this.snapshot()}));
        this.themeObserver.observe(document.body, {attributes: true, attributeFilter: ['data-theme']});
        this.subscriptions.push({dispose: () => { clearTimeout(timeout); completion.resolve([]); }});
        if (pluginId !== null) {
            for (const name of ['onTableOpened', 'onTableClosed', 'onCellChanged', 'onTableSaved', 'onRowSelected'] as const) {
                this.subscriptions.push(api.events[name]((event: unknown) => this.send({type: 'event', name, event, snapshot: this.snapshot()})));
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

    private snapshot(): object {
        const style = getComputedStyle(document.body);
        return {
            theme: Object.fromEntries([...style].filter(name => name.startsWith('--')).map(name => [name, style.getPropertyValue(name)])),
            data: Object.fromEntries(this.api.data.getTableNames().map(name => [name, {header: this.api.data.getHeader(name) ?? [], rows: this.api.data.getRows(name) ?? []}])),
            schema: Object.fromEntries(this.api.schema.getSchemaTableNames().map(name => [name, {columns: this.api.schema.getColumns(name), primaryKeys: this.api.schema.getPrimaryKeys(name), references: this.api.schema.getReferences(name)}])),
        };
    }

    private send(message: Record<string, unknown>): void {
        if (!this.disposed && isWorkspaceTrusted()) this.frame.contentWindow?.postMessage({...message, channel: this.channel}, '*');
    }
}
