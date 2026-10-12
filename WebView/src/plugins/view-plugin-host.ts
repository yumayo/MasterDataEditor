import {findFilesAsync, readFileAsync, invalidatePluginFileCaches} from '../app/api';
import {isWorkspaceTrusted, WORKSPACE_TRUST_CHANGED} from '../app/workspace-trust';
import type {BackgroundTaskTracker} from '../app/background-task-tracker';
import type {InMemoryTableStore} from '../data/in-memory-table-store';
import type {EditorAPI as InternalEditorAPI} from '../editor-api/editor-api-types';
import type {NotificationToast} from '../ui/notification';
import type {ViewPluginAPI} from './master-data-editor-view-plugin';
import {ViewPluginTablesApiImpl} from './view-plugin-table-api';
import {ViewPluginFrame} from './view-plugin-frame';

export type {ViewPluginAPI, ViewPluginMountResult, ViewPluginRegistration} from './master-data-editor-view-plugin';
export interface ViewPluginDescriptor {id: string; title: string; description: string | null;}
export interface ViewPluginMount {dispose(): void; saveAsync(): Promise<boolean>; isDirty(): boolean; setDirty(dirty: boolean): void;}
export interface ViewPluginMountOptions {onDirtyChanged?(dirty: boolean): void;}

export class ViewPluginHost {
    private readonly store: InMemoryTableStore;
    private readonly notification: NotificationToast;
    private readonly backgroundTaskTracker: BackgroundTaskTracker;
    private readonly registrations = new Map<string, {descriptor: ViewPluginDescriptor; code: string}>();
    private readonly listeners: Array<() => void> = [];
    private readonly loadedListeners: Array<() => void> = [];
    private readonly frames = new Set<ViewPluginFrame>();
    private readonly api: Omit<ViewPluginAPI, 'view'>;
    private loaded = false;
    private generation = 0;

    constructor(editorApi: InternalEditorAPI, store: InMemoryTableStore, notification: NotificationToast, backgroundTaskTracker: BackgroundTaskTracker) {
        this.notification = notification;
        this.backgroundTaskTracker = backgroundTaskTracker;
        this.store = store;
        const editor = {data: editorApi.data, schema: editorApi.schema, edit: editorApi.edit, events: editorApi.events};
        this.api = {...editor, editor, tables: new ViewPluginTablesApiImpl(store, editorApi), notification: {show: (message, status) => notification.show(message, status)}};
        window.addEventListener(WORKSPACE_TRUST_CHANGED, () => {
            void this.reloadPluginsAsync().catch((error: unknown) => this.notification.showError(error));
        });
    }

    async loadPluginsAsync(): Promise<void> {
        if (this.loaded || !isWorkspaceTrusted()) { this.notifyChanged(); return; }
        this.loaded = true;
        const generation = this.generation;
        let files: Array<{name: string; type: 'file' | 'directory'}>;
        try { files = await findFilesAsync('plugins/views'); }
        catch { this.notifyLoaded(generation); return; }
        for (const file of files) {
            if (file.type !== 'file' || !file.name.endsWith('.js')) continue;
            if (!isWorkspaceTrusted() || generation !== this.generation) return;
            const container = document.createElement('div');
            container.hidden = true;
            document.body.appendChild(container);
            try {
                const code = await readFileAsync('plugins/views/' + file.name);
                if (!isWorkspaceTrusted() || generation !== this.generation) return;
                const frame = new ViewPluginFrame(container, code, null, this.api, this.store, this.notification, {});
                this.frames.add(frame);
                try {
                    const descriptors = await frame.waitUntilReadyAsync();
                    if (!isWorkspaceTrusted() || generation !== this.generation) return;
                    for (const descriptor of descriptors) {
                        if (this.registrations.has(descriptor.id)) throw new Error('ViewプラグインのIDが重複しています: ' + descriptor.id);
                        this.registrations.set(descriptor.id, {descriptor, code});
                    }
                } finally { frame.dispose(); this.frames.delete(frame); }
            } catch (error: unknown) {
                this.notification.showError(error, 'Viewプラグインの読み込みに失敗しました: ' + file.name + ' — ' + (error instanceof Error ? error.message : String(error)));
            } finally { container.remove(); }
        }
        this.notifyLoaded(generation);
    }

    async reloadPluginsAsync(): Promise<void> {
        this.generation++;
        for (const frame of this.frames) frame.dispose();
        this.frames.clear();
        this.registrations.clear();
        this.loaded = false;
        invalidatePluginFileCaches();
        this.notifyChanged();
        await this.loadPluginsAsync();
    }

    getPlugins(): ViewPluginDescriptor[] { return [...this.registrations.values()].map(value => value.descriptor).sort((a, b) => a.title.localeCompare(b.title)); }
    getPlugin(id: string): ViewPluginDescriptor | null { return this.registrations.get(id)?.descriptor ?? null; }

    mountView(id: string, container: HTMLElement, options: ViewPluginMountOptions = {}): ViewPluginMount | null {
        if (!isWorkspaceTrusted()) return null;
        const plugin = this.registrations.get(id);
        if (!plugin) return null;
        container.textContent = '';
        const frame = new ViewPluginFrame(container, plugin.code, id, this.api, this.store, this.notification, options);
        this.frames.add(frame);
        // 初期データ同期と非同期 render の完了まで追跡し、失敗・タブ破棄でも同じ Promise の決着で終了する。
        void this.backgroundTaskTracker.trackActivityAsync('プラグイン読み込み中: ' + plugin.descriptor.title, frame.waitUntilReadyAsync()).catch(() => { frame.dispose(); this.frames.delete(frame); });
        return {dispose: () => { frame.dispose(); this.frames.delete(frame); }, saveAsync: () => frame.saveAsync(), isDirty: () => frame.isDirty(), setDirty: value => frame.setDirty(value)};
    }

    onDidChange(listener: () => void): {dispose(): void} {
        this.listeners.push(listener);
        return {dispose: () => { const index = this.listeners.indexOf(listener); if (index !== -1) this.listeners.splice(index, 1); }};
    }

    /** 読み込み途中の空一覧ではなく、現在の世代の登録が確定したときだけ通知する。 */
    onDidLoad(listener: () => void): {dispose(): void} {
        this.loadedListeners.push(listener);
        return {dispose: () => { const index = this.loadedListeners.indexOf(listener); if (index !== -1) this.loadedListeners.splice(index, 1); }};
    }

    private notifyLoaded(generation: number): void {
        if (!isWorkspaceTrusted() || generation !== this.generation) return;
        this.notifyChanged();
        for (const listener of [...this.loadedListeners]) listener();
    }

    private notifyChanged(): void { for (const listener of [...this.listeners]) listener(); }
}
