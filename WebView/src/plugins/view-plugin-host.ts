import {findFilesAsync, readFileAsync} from "../app/api";
import type {EditorAPI} from "../editor-api/editor-api-types";
import type {NotificationToast} from "../ui/notification";

export interface ViewPluginNotificationAPI {
    show(message: string): void;
}

export interface ViewPluginAPI {
    editor: EditorAPI;
    data: EditorAPI["data"];
    schema: EditorAPI["schema"];
    edit: EditorAPI["edit"];
    events: EditorAPI["events"];
    view: ViewPluginRuntimeAPI;
    notification: ViewPluginNotificationAPI;
}

export type ViewPluginSaveHandler = () => void | boolean | Promise<void | boolean>;

export interface ViewPluginRuntimeAPI {
    setDirty(dirty: boolean): void;
    isDirty(): boolean;
    onSave(handler: ViewPluginSaveHandler): { dispose(): void };
    saveAsync(): Promise<boolean>;
}

export interface ViewPluginRegistration {
    id: string;
    title?: string;
    description?: string;
    render(container: HTMLElement, api: ViewPluginAPI): void | ViewPluginMountResult | Promise<void | ViewPluginMountResult>;
    dispose?(): void;
}

export type ViewPluginMountResult = (() => void) | { dispose?(): void; save?(): void | boolean | Promise<void | boolean> };

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

interface MasterDataEditorPluginGlobal {
    registerViewPlugin?(registration: ViewPluginRegistration): void;
    registerView?(registration: ViewPluginRegistration): void;
    editorApi?: EditorAPI;
    api?: ViewPluginAPI;
}

interface PluginFileEntry {
    name: string;
    type: 'file' | 'directory';
}

const VIEW_PLUGIN_DIRECTORY = 'plugins/views';

export class ViewPluginHost {
    private readonly editorApi: EditorAPI;
    private readonly notification: NotificationToast;
    private readonly registrations: Map<string, ViewPluginRegistration>;
    private readonly listeners: ViewPluginChangeListener[];
    private readonly baseApi: Omit<ViewPluginAPI, 'view'>;
    private loaded: boolean;

    constructor(editorApi: EditorAPI, notification: NotificationToast) {
        this.editorApi = editorApi;
        this.notification = notification;
        this.registrations = new Map();
        this.listeners = [];
        this.loaded = false;
        this.baseApi = {
            editor: editorApi,
            data: editorApi.data,
            schema: editorApi.schema,
            edit: editorApi.edit,
            events: editorApi.events,
            notification: {
                show: (message: string) => {
                    this.notification.show(message);
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
        let mountResult: void | ViewPluginMountResult;
        const saveHandlers: ViewPluginSaveHandler[] = [];

        const setDirty = (nextDirty: boolean): void => {
            if (dirty === nextDirty) return;
            dirty = nextDirty;
            if (options.onDirtyChanged !== undefined) {
                options.onDirtyChanged(dirty);
            }
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
                this.notification.show('Viewプラグインの保存に失敗しました: ' + this.getPluginTitle(plugin));
                return false;
            }
            if (success) setDirty(false);
            return success;
        };

        const viewApi: ViewPluginRuntimeAPI = {
            setDirty,
            isDirty: () => dirty,
            onSave: (handler: ViewPluginSaveHandler) => {
                saveHandlers.push(handler);
                return {
                    dispose: () => {
                        const index = saveHandlers.indexOf(handler);
                        if (index !== -1) saveHandlers.splice(index, 1);
                    },
                };
            },
            saveAsync,
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
            const api: ViewPluginAPI = {...this.baseApi, view: viewApi};
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
                    this.notification.show('Viewプラグインの描画に失敗しました: ' + this.getPluginTitle(plugin));
                });
            } else {
                mountResult = result;
            }
        } catch (error: unknown) {
            console.error('[ViewPluginHost] render failed:', error);
            this.notification.show('Viewプラグインの描画に失敗しました: ' + this.getPluginTitle(plugin));
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
                saveHandlers.splice(0);
                setDirty(false);
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

    registerViewPlugin(registration: ViewPluginRegistration): void {
        const id = typeof registration.id === 'string' ? registration.id.trim() : '';
        if (id === '') {
            this.notification.show('Viewプラグインの登録に失敗しました: id が空です');
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
        });
        this.notifyChanged();
    }

    private async loadPluginFileAsync(fileName: string): Promise<void> {
        const path = VIEW_PLUGIN_DIRECTORY + '/' + fileName;
        try {
            const code = await readFileAsync(path);
            const execute = new Function(code + '\n//# sourceURL=master-data-editor-view-plugin://' + fileName);
            execute();
        } catch (error: unknown) {
            console.error('[ViewPluginHost] load failed:', error);
            this.notification.show('Viewプラグインの読み込みに失敗しました: ' + fileName);
        }
    }

    private installGlobalRegistrationApi(): void {
        const win = window as unknown as {
            __mde?: MasterDataEditorPluginGlobal;
            masterDataEditor?: MasterDataEditorPluginGlobal;
        };
        const globalApi: MasterDataEditorPluginGlobal = {
            ...(win.__mde ?? {}),
            registerViewPlugin: (registration: ViewPluginRegistration) => {
                this.registerViewPlugin(registration);
            },
            registerView: (registration: ViewPluginRegistration) => {
                this.registerViewPlugin(registration);
            },
            editorApi: this.editorApi,
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
        };
    }

    private toDescriptor(plugin: ViewPluginRegistration): ViewPluginDescriptor {
        return {
            id: plugin.id,
            title: this.getPluginTitle(plugin),
            description: typeof plugin.description === 'string' && plugin.description.length > 0 ? plugin.description : null,
        };
    }

    private getPluginTitle(plugin: ViewPluginRegistration): string {
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
