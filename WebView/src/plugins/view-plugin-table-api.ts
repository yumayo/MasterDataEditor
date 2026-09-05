import type {InMemoryTableStore} from "../data/in-memory-table-store";
import type {EditorAPI as InternalEditorAPI} from "../editor-api/editor-api-types";
import type {
    EditorDisposable,
    ViewPluginEditSession,
    ViewPluginRecord,
    ViewPluginRecordChanges,
    ViewPluginRowReference,
    ViewPluginTableAPI,
    ViewPluginTablesAPI,
} from "./master-data-editor-view-plugin";

export class ViewPluginTablesApiImpl implements ViewPluginTablesAPI {
    private readonly store: InMemoryTableStore;
    private readonly editorApi: InternalEditorAPI;
    private readonly tables: Map<string, ViewPluginTableAPI>;

    constructor(store: InMemoryTableStore, editorApi: InternalEditorAPI) {
        this.store = store;
        this.editorApi = editorApi;
        this.tables = new Map();
    }

    get(tableName: string): ViewPluginTableAPI {
        const normalizedName = tableName.trim();
        if (normalizedName === '') throw new Error('ViewPluginTablesAPI.get: tableName が空です');
        let table = this.tables.get(normalizedName);
        if (table !== undefined) return table;
        table = new ViewPluginTableApiImpl(normalizedName, this.store, this.editorApi);
        this.tables.set(normalizedName, table);
        return table;
    }
}

class ViewPluginTableApiImpl implements ViewPluginTableAPI {
    readonly name: string;
    private readonly store: InMemoryTableStore;
    private readonly editorApi: InternalEditorAPI;

    constructor(name: string, store: InMemoryTableStore, editorApi: InternalEditorAPI) {
        this.name = name;
        this.store = store;
        this.editorApi = editorApi;
    }

    async readRecordsAsync(): Promise<ViewPluginRecord[] | null> {
        const data = await this.editorApi.data.readTableDataAsync(this.name);
        if (data === null) return null;

        const records: ViewPluginRecord[] = [];
        for (let rowIndex = 0; rowIndex < data.rows.length; ++rowIndex) {
            const rowId = this.store.getRowId(this.name, rowIndex);
            if (rowId === null) return null;
            const entries: Array<[string, string]> = [];
            for (let columnIndex = 0; columnIndex < data.header.length; ++columnIndex) {
                entries.push([data.header[columnIndex], data.rows[rowIndex][columnIndex] ?? '']);
            }
            records.push({
                ref: Object.freeze({tableName: this.name, rowId}),
                values: Object.freeze(Object.fromEntries(entries)),
            });
        }
        return records;
    }

    async updateRecordAsync(ref: ViewPluginRowReference, changes: ViewPluginRecordChanges): Promise<boolean> {
        if (ref.tableName !== this.name) return false;
        const rowIndex = this.store.findRowIndexById(this.name, ref.rowId);
        if (rowIndex === null) return false;
        const header = this.store.getHeader(this.name);
        if (header === false) return false;

        const cellChanges: Array<{row: number; column: number; value: string}> = [];
        for (const [columnName, value] of Object.entries(changes)) {
            const columnIndex = header.indexOf(columnName);
            if (columnIndex === -1) {
                throw new Error('ViewPluginTableAPI.updateRecordAsync: テーブル "' + this.name + '" に列 "' + columnName + '" がありません');
            }
            cellChanges.push({row: rowIndex, column: columnIndex, value});
        }
        return this.editorApi.edit.setCellValuesAsync(this.name, cellChanges);
    }

    saveAsync(): Promise<boolean> {
        return this.editorApi.edit.saveTableAsync(this.name);
    }
}

interface ViewPluginEditSessionOptions {
    tables: ViewPluginTablesAPI;
    registerSaveHandler(handler: () => Promise<boolean>): EditorDisposable;
    onDirtyChanged(dirty: boolean): void;
    onDisposed(session: ViewPluginEditSessionImpl): void;
}

export class ViewPluginEditSessionImpl implements ViewPluginEditSession {
    private readonly tables: ViewPluginTablesAPI;
    private readonly onDirtyChanged: (dirty: boolean) => void;
    private readonly onDisposed: (session: ViewPluginEditSessionImpl) => void;
    private readonly dirtyTableRevisions: Map<string, number>;
    private readonly pendingEdits: Set<Promise<boolean>>;
    private readonly saveSubscription: EditorDisposable;
    private nextRevision: number;
    private disposed: boolean;

    constructor(options: ViewPluginEditSessionOptions) {
        this.tables = options.tables;
        this.onDirtyChanged = options.onDirtyChanged;
        this.onDisposed = options.onDisposed;
        this.dirtyTableRevisions = new Map();
        this.pendingEdits = new Set();
        this.nextRevision = 0;
        this.disposed = false;
        this.saveSubscription = options.registerSaveHandler(() => this.saveAsync());
    }

    async updateRecordAsync(ref: ViewPluginRowReference, changes: ViewPluginRecordChanges): Promise<boolean> {
        if (this.disposed) return false;
        const operation = this.tables.get(ref.tableName).updateRecordAsync(ref, changes);
        this.pendingEdits.add(operation);
        this.notifyDirtyChanged();
        try {
            const updated = await operation;
            if (updated && !this.disposed) {
                this.nextRevision++;
                this.dirtyTableRevisions.set(ref.tableName, this.nextRevision);
            }
            return updated;
        } finally {
            this.pendingEdits.delete(operation);
            this.notifyDirtyChanged();
        }
    }

    async saveAsync(): Promise<boolean> {
        if (this.disposed) return false;

        let editsSucceeded = true;
        while (this.pendingEdits.size > 0) {
            const results = await Promise.all([...this.pendingEdits]);
            if (results.some(result => !result)) editsSucceeded = false;
        }
        if (!editsSucceeded || this.disposed) return false;

        const revisionsToSave = new Map(this.dirtyTableRevisions);
        const results = await Promise.all([...revisionsToSave.keys()].map(async tableName => ({
            tableName,
            saved: await this.tables.get(tableName).saveAsync(),
        })));
        if (this.disposed) return false;

        for (const result of results) {
            const savedRevision = revisionsToSave.get(result.tableName);
            if (result.saved && this.dirtyTableRevisions.get(result.tableName) === savedRevision) {
                this.dirtyTableRevisions.delete(result.tableName);
            }
        }
        this.notifyDirtyChanged();
        return results.every(result => result.saved) && this.dirtyTableRevisions.size === 0;
    }

    isDirty(): boolean {
        return this.pendingEdits.size > 0 || this.dirtyTableRevisions.size > 0;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.saveSubscription.dispose();
        this.pendingEdits.clear();
        this.dirtyTableRevisions.clear();
        this.onDisposed(this);
        this.notifyDirtyChanged();
    }

    private notifyDirtyChanged(): void {
        this.onDirtyChanged(this.isDirty());
    }
}
