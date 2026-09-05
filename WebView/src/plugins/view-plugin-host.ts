import {findFilesAsync, readFileAsync, invalidatePluginFileCaches} from "../app/api";
import type {InMemoryTableStore} from "../data/in-memory-table-store";
import type {EditorAPI as InternalEditorAPI} from "../editor-api/editor-api-types";
import type {NotificationStatus, NotificationToast} from "../ui/notification";
import {
    VIEW_PLUGIN_API_VERSION,
    type EditorAPI as PublicEditorAPI,
    type MasterDataEditorPluginGlobal,
    type ViewPluginAPI,
    type ViewPluginMountResult,
    type ViewPluginRegistration,
    type ViewPluginRuntimeAPI,
    type ViewPluginSaveHandler,
} from "./master-data-editor-view-plugin";
import {ViewPluginEditSessionImpl, ViewPluginTablesApiImpl} from "./view-plugin-table-api";

export type {ViewPluginAPI, ViewPluginMountResult, ViewPluginRegistration} from "./master-data-editor-view-plugin";

export interface ViewPluginDescriptor {
    id: string;
    title: string;
    description: string | null;
}

export interface ViewPluginMount {
    dispose(): void;
    saveAsync(): Promise<boolean>;
    isDirty(): boolean;
    setDirty(dirty: boolean): void;
}

export interface ViewPluginMountOptions {
    onDirtyChanged?(dirty: boolean): void;
}

type ViewPluginChangeListener = () => void;
type SupportedViewPluginApiVersion = 1 | typeof VIEW_PLUGIN_API_VERSION;
type ViewPluginRegistrationInput = Omit<ViewPluginRegistration, 'apiVersion'> & {apiVersion?: number};
type RegisteredViewPlugin = Omit<ViewPluginRegistration, 'apiVersion'> & {apiVersion: SupportedViewPluginApiVersion};

interface PluginFileEntry {
    name: string;
    type: 'file' | 'directory';
}

const VIEW_PLUGIN_DIRECTORY = 'plugins/views';

export class ViewPluginHost {
    private readonly internalEditorApi: InternalEditorAPI;
    private readonly notification: NotificationToast;
    private readonly registrations: Map<string, RegisteredViewPlugin>;
    private readonly listeners: ViewPluginChangeListener[];
    private readonly baseApi: Omit<ViewPluginAPI, 'view'>;
    private loaded: boolean;

    constructor(editorApi: InternalEditorAPI, store: InMemoryTableStore, notification: NotificationToast) {
        this.internalEditorApi = editorApi;
        this.notification = notification;
        this.registrations = new Map();
        this.listeners = [];
        this.loaded = false;
        const publicEditorApi: PublicEditorAPI = {
            data: editorApi.data,
            schema: editorApi.schema,
            edit: editorApi.edit,
            events: editorApi.events,
        };
        this.baseApi = {
            editor: publicEditorApi,
            data: editorApi.data,
            schema: editorApi.schema,
            edit: editorApi.edit,
            events: editorApi.events,
            tables: new ViewPluginTablesApiImpl(store, editorApi),
            notification: {
                show: (message: string, status?: NotificationStatus) => {
                    this.notification.show(message, status);
                },
            },
        };
        this.installGlobalRegistrationApi();
    }

    async loadPluginsAsync(): Promise<void> {
        if (this.loaded) return;
        this.loaded = true;

        let files: PluginFileEntry[];
        try {
            files = await findFilesAsync(VIEW_PLUGIN_DIRECTORY);
        } catch {
            this.notifyChanged();
            return;
        }

        for (const file of files) {
            if (file.type !== 'file') continue;
            if (!file.name.endsWith('.js')) continue;
            await this.loadPluginFileAsync(file.name);
        }
        this.notifyChanged();
    }

    async reloadPluginsAsync(): Promise<void> {
        this.disposeRegisteredPlugins();
        this.registrations.clear();
        this.loaded = false;
        invalidatePluginFileCaches();
        this.installGlobalRegistrationApi();
        await this.loadPluginsAsync();
    }

    getPlugins(): ViewPluginDescriptor[] {
        return [...this.registrations.values()]
            .map(plugin => this.toDescriptor(plugin))
            .sort((a, b) => a.title.localeCompare(b.title));
    }

    getPlugin(id: string): ViewPluginDescriptor | null {
        const plugin = this.registrations.get(id);
        if (plugin === undefined) return null;
        return this.toDescriptor(plugin);
    }

    mountView(id: string, container: HTMLElement, options: ViewPluginMountOptions = {}): ViewPluginMount | null {
        const plugin = this.registrations.get(id);
        if (plugin === undefined) return null;

        container.textContent = '';
        let disposed = false;
        let dirty = false;
        let manualDirty = false;
        let mountResult: void | ViewPluginMountResult;
        const saveHandlers: ViewPluginSaveHandler[] = [];
        const editSessions = new Set<ViewPluginEditSessionImpl>();

        const applyDirty = (nextDirty: boolean): void => {
            if (dirty === nextDirty) return;
            dirty = nextDirty;
            if (options.onDirtyChanged !== undefined) {
                options.onDirtyChanged(dirty);
            }
        };

        const refreshDirty = (): void => {
            applyDirty(manualDirty || [...editSessions].some(session => session.isDirty()));
        };

        const setDirty = (nextDirty: boolean): void => {
            manualDirty = nextDirty;
            refreshDirty();
        };

        const registerSaveHandler = (handler: ViewPluginSaveHandler): {dispose(): void} => {
            saveHandlers.push(handler);
            return {
                dispose: () => {
                    const index = saveHandlers.indexOf(handler);
                    if (index !== -1) saveHandlers.splice(index, 1);
                },
            };
        };

        const saveAsync = async (): Promise<boolean> => {
            let success = true;
            try {
                if (mountResult !== undefined && mountResult !== null && typeof mountResult !== 'function' && typeof mountResult.save === 'function') {
                    const result = await mountResult.save();
                    if (result === false) success = false;
                }

                const snapshot = [...saveHandlers];
                for (let i = 0; i < snapshot.length; ++i) {
                    const result = await snapshot[i]();
                    if (result === false) success = false;
                }
            } catch (error: unknown) {
                console.error('[ViewPluginHost] save failed:', error);
                this.notification.showError(error, 'Viewプラグインの保存に失敗しました: ' + this.getPluginTitle(plugin));
                return false;
            }
            if (success) {
                manualDirty = false;
                refreshDirty();
            }
            return success;
        };

        const viewApi: ViewPluginRuntimeAPI = {
            setDirty,
            isDirty: () => dirty,
            onSave: registerSaveHandler,
            saveAsync,
            createEditSession: () => {
                const session = new ViewPluginEditSessionImpl({
                    tables: this.baseApi.tables,
                    registerSaveHandler: handler => registerSaveHandler(handler),
                    onDirtyChanged: () => refreshDirty(),
                    onDisposed: disposedSession => {
                        editSessions.delete(disposedSession);
                    },
                });
                editSessions.add(session);
                return session;
            },
        };

        const disposeMountResult = (): void => {
            if (typeof mountResult === 'function') {
                mountResult();
                return;
            }
            if (mountResult !== undefined && mountResult !== null && typeof mountResult !== 'function' && typeof mountResult.dispose === 'function') {
                mountResult.dispose();
            }
        };

        try {
            const api: ViewPluginAPI = {
                ...this.baseApi,
                editor: plugin.apiVersion === 1 ? this.internalEditorApi : this.baseApi.editor,
                view: viewApi,
            };
            const result = plugin.render(container, api);
            if (result instanceof Promise) {
                result.then(value => {
                    if (disposed) {
                        this.disposeAsyncMountResult(value);
                        return;
                    }
                    mountResult = value;
                }).catch((error: unknown) => {
                    console.error('[ViewPluginHost] render failed:', error);
                    this.notification.showError(error, 'Viewプラグインの描画に失敗しました: ' + this.getPluginTitle(plugin));
                });
            } else {
                mountResult = result;
            }
        } catch (error: unknown) {
            console.error('[ViewPluginHost] render failed:', error);
            this.notification.showError(error, 'Viewプラグインの描画に失敗しました: ' + this.getPluginTitle(plugin));
        }

        return {
            dispose: () => {
                if (disposed) return;
                disposed = true;
                try {
                    disposeMountResult();
                } catch (error: unknown) {
                    console.error('[ViewPluginHost] dispose failed:', error);
                }
                for (const session of [...editSessions]) session.dispose();
                saveHandlers.splice(0);
                manualDirty = false;
                refreshDirty();
                container.textContent = '';
            },
            saveAsync,
            isDirty: () => dirty,
            setDirty,
        };
    }

    onDidChange(listener: ViewPluginChangeListener): { dispose(): void } {
        this.listeners.push(listener);
        return {
            dispose: () => {
                const index = this.listeners.indexOf(listener);
                if (index !== -1) this.listeners.splice(index, 1);
            },
        };
    }

    registerViewPlugin(registration: ViewPluginRegistrationInput): void {
        const id = typeof registration.id === 'string' ? registration.id.trim() : '';
        if (id === '') {
            this.notification.show('Viewプラグインの登録に失敗しました: id が空です');
            return;
        }
        const apiVersion = registration.apiVersion ?? 1;
        if (apiVersion !== 1 && apiVersion !== VIEW_PLUGIN_API_VERSION) {
            this.notification.show('Viewプラグイン "' + id + '" のAPIバージョン ' + String(apiVersion) + ' には対応していません（対応バージョン: 1, ' + VIEW_PLUGIN_API_VERSION + '）');
            return;
        }
        if (typeof registration.render !== 'function') {
            this.notification.show('Viewプラグインの登録に失敗しました: render が関数ではありません (' + id + ')');
            return;
        }
        if (this.registrations.has(id)) {
            this.notification.show('Viewプラグイン "' + id + '" は既に登録されています');
            return;
        }
        this.registrations.set(id, {
            ...registration,
            id,
            apiVersion,
        });
        this.notifyChanged();
    }

    private disposeRegisteredPlugins(): void {
        for (const plugin of this.registrations.values()) {
            if (typeof plugin.dispose !== 'function') continue;
            try {
                plugin.dispose();
            } catch (error: unknown) {
                console.error('[ViewPluginHost] registration dispose failed:', error);
            }
        }
    }

    private async loadPluginFileAsync(fileName: string): Promise<void> {
        const path = VIEW_PLUGIN_DIRECTORY + '/' + fileName;
        try {
            const code = await readFileAsync(path);
            const execute = new Function(code + '\n//# sourceURL=master-data-editor-view-plugin://' + fileName);
            execute();
        } catch (error: unknown) {
            console.error('[ViewPluginHost] load failed:', error);
            this.notification.showError(error, 'Viewプラグインの読み込みに失敗しました: ' + fileName);
        }
    }

    private installGlobalRegistrationApi(): void {
        const win = window as unknown as {
            __mde?: Partial<MasterDataEditorPluginGlobal>;
            masterDataEditor?: Partial<MasterDataEditorPluginGlobal>;
        };
        const globalApi: MasterDataEditorPluginGlobal = {
            ...(win.__mde ?? {}),
            apiVersion: VIEW_PLUGIN_API_VERSION,
            registerViewPlugin: (registration: ViewPluginRegistration) => {
                this.registerViewPlugin(registration);
            },
            registerView: (registration: ViewPluginRegistration) => {
                this.registerViewPlugin(registration);
            },
            editorApi: this.internalEditorApi,
            api: {...this.baseApi, view: this.createGlobalViewApi()},
        };
        win.__mde = globalApi;
        win.masterDataEditor = globalApi;
    }

    private disposeAsyncMountResult(result: void | ViewPluginMountResult): void {
        try {
            if (typeof result === 'function') {
                result();
                return;
            }
            if (result !== undefined && result !== null && typeof result !== 'function' && typeof result.dispose === 'function') {
                result.dispose();
            }
        } catch (error: unknown) {
            console.error('[ViewPluginHost] async dispose failed:', error);
        }
    }

    private createGlobalViewApi(): ViewPluginRuntimeAPI {
        return {
            setDirty: () => {},
            isDirty: () => false,
            onSave: () => ({ dispose: () => {} }),
            saveAsync: async () => true,
            createEditSession: () => ({
                updateRecordAsync: async () => false,
                saveAsync: async () => true,
                isDirty: () => false,
                dispose: () => {},
            }),
        };
    }

    private toDescriptor(plugin: RegisteredViewPlugin): ViewPluginDescriptor {
        return {
            id: plugin.id,
            title: this.getPluginTitle(plugin),
            description: typeof plugin.description === 'string' && plugin.description.length > 0 ? plugin.description : null,
        };
    }

    private getPluginTitle(plugin: Pick<ViewPluginRegistration, 'id' | 'title'>): string {
        return typeof plugin.title === 'string' && plugin.title.trim() !== '' ? plugin.title.trim() : plugin.id;
    }

    private notifyChanged(): void {
        const snapshot = [...this.listeners];
        for (let i = 0; i < snapshot.length; ++i) {
            try {
                snapshot[i]();
            } catch (error: unknown) {
                console.error('[ViewPluginHost] listener failed:', error);
            }
        }
    }
}
