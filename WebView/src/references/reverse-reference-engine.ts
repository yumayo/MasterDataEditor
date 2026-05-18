import {findFilesAsync, readFileAsync} from "../app/api";
import {InMemoryTableStore} from "../data/in-memory-table-store";
import {NotificationToast} from "../ui/notification";
import {isDynamicReference, isSimpleReference, parseReferenceExpression, DynamicReferenceSchema} from "./reference-expression";
import {ReverseReferenceResolver, type ReverseReferenceChildSchema, type ReverseReferenceMap} from "./reverse-reference-resolver";

interface ReverseReferenceCacheEntry {
    schemaIndexVersion: number;
    map: ReverseReferenceMap;
}

interface ReverseReferenceLoadingEntry {
    schemaIndexVersion: number;
    dataChangeVersion: number;
    promise: Promise<ReverseReferenceMap>;
}

interface ReverseReferenceSchemaIndexData {
    simpleParentToChildTables: Map<string, Set<string>>;
    dynamicChildTableNames: Set<string>;
    dynamicIntermediateToChildTables: Map<string, Set<string>>;
    schemasByChildTable: Map<string, Record<string, unknown>>;
}

interface ReverseReferenceSchemaContribution {
    simpleParentTableNames: Set<string>;
    hasDynamicReference: boolean;
    dynamicIntermediateTableNames: Set<string>;
}

type ReverseReferenceMapUpdatedListener = (tableName: string, map: ReverseReferenceMap) => void;

class ReverseReferenceSchemaIndex {
    private data: ReverseReferenceSchemaIndexData;
    private readonly contributionsByChildTable: Map<string, ReverseReferenceSchemaContribution>;
    private loadingPromise: Promise<ReverseReferenceSchemaIndexData> | null;
    private complete: boolean;

    constructor() {
        this.data = createEmptySchemaIndexData();
        this.contributionsByChildTable = new Map();
        this.loadingPromise = null;
        this.complete = false;
    }

    invalidate(): void {
        this.data = createEmptySchemaIndexData();
        this.contributionsByChildTable.clear();
        this.loadingPromise = null;
        this.complete = false;
    }

    registerSchema(tableName: string, schema: Record<string, unknown>): void {
        this.removeContribution(tableName);
        this.data.schemasByChildTable.set(tableName, schema);
        const contribution = readSchemaContribution(schema);
        this.contributionsByChildTable.set(tableName, contribution);
        for (const parentTableName of contribution.simpleParentTableNames) {
            let childTables = this.data.simpleParentToChildTables.get(parentTableName);
            if (childTables === undefined) {
                childTables = new Set<string>();
                this.data.simpleParentToChildTables.set(parentTableName, childTables);
            }
            childTables.add(tableName);
        }
        if (contribution.hasDynamicReference) {
            this.data.dynamicChildTableNames.add(tableName);
        }
        for (const intermediateTableName of contribution.dynamicIntermediateTableNames) {
            let childTables = this.data.dynamicIntermediateToChildTables.get(intermediateTableName);
            if (childTables === undefined) {
                childTables = new Set<string>();
                this.data.dynamicIntermediateToChildTables.set(intermediateTableName, childTables);
            }
            childTables.add(tableName);
        }
    }

    markComplete(): void {
        this.complete = true;
        this.loadingPromise = null;
    }

    isComplete(): boolean {
        return this.complete;
    }

    async getCandidateChildSchemasAsync(parentTableName: string): Promise<ReverseReferenceChildSchema[]> {
        const data = this.complete ? this.data : await this.loadAsync();
        const names = new Set<string>();
        const simpleChildren = data.simpleParentToChildTables.get(parentTableName);
        if (simpleChildren !== undefined) {
            for (const childTableName of simpleChildren) names.add(childTableName);
        }
        for (const childTableName of data.dynamicChildTableNames) names.add(childTableName);
        const schemas: ReverseReferenceChildSchema[] = [];
        for (const childTableName of names) {
            const schema = data.schemasByChildTable.get(childTableName);
            if (schema !== undefined) {
                schemas.push({tableName: childTableName, schema});
            }
        }
        return schemas;
    }

    getSchema(tableName: string): Record<string, unknown> | undefined {
        return this.data.schemasByChildTable.get(tableName);
    }

    getSimpleParentTableNamesForChild(childTableName: string): string[] {
        const contribution = this.contributionsByChildTable.get(childTableName);
        if (contribution === undefined) return [];
        return [...contribution.simpleParentTableNames];
    }

    hasDynamicReference(childTableName: string): boolean {
        return this.contributionsByChildTable.get(childTableName)?.hasDynamicReference ?? false;
    }

    getDynamicChildTableNamesUsingIntermediate(tableName: string): string[] {
        return [...(this.data.dynamicIntermediateToChildTables.get(tableName) ?? [])];
    }

    private async loadAsync(): Promise<ReverseReferenceSchemaIndexData> {
        if (this.complete) return this.data;
        if (this.loadingPromise !== null) return this.loadingPromise;
        const promise = this.buildAsync();
        this.loadingPromise = promise;
        try {
            const data = await promise;
            if (this.loadingPromise === promise) {
                this.data = data;
                this.complete = true;
            }
            return data;
        } finally {
            if (this.loadingPromise === promise) this.loadingPromise = null;
        }
    }

    private async buildAsync(): Promise<ReverseReferenceSchemaIndexData> {
        this.data = createEmptySchemaIndexData();
        this.contributionsByChildTable.clear();
        const schemaFiles = await findFilesAsync("schema");

        await Promise.all(schemaFiles.map(async file => {
            if (file.type !== 'file' || !file.name.endsWith('.json')) return;
            const childTableName = file.name.replace('.json', '');
            try {
                const schemaText = await readFileAsync(`schema/${childTableName}.json`);
                const schema = JSON.parse(schemaText) as Record<string, unknown>;
                this.registerSchema(childTableName, schema);
            } catch (error) {
                console.warn('[ReverseReferenceSchemaIndex] failed to read schema:', childTableName, error);
            }
        }));

        return this.data;
    }

    private removeContribution(tableName: string): void {
        const contribution = this.contributionsByChildTable.get(tableName);
        if (contribution === undefined) return;
        for (const parentTableName of contribution.simpleParentTableNames) {
            const childTables = this.data.simpleParentToChildTables.get(parentTableName);
            if (childTables === undefined) continue;
            childTables.delete(tableName);
            if (childTables.size === 0) this.data.simpleParentToChildTables.delete(parentTableName);
        }
        if (contribution.hasDynamicReference) {
            this.data.dynamicChildTableNames.delete(tableName);
        }
        for (const intermediateTableName of contribution.dynamicIntermediateTableNames) {
            const childTables = this.data.dynamicIntermediateToChildTables.get(intermediateTableName);
            if (childTables === undefined) continue;
            childTables.delete(tableName);
            if (childTables.size === 0) this.data.dynamicIntermediateToChildTables.delete(intermediateTableName);
        }
        this.contributionsByChildTable.delete(tableName);
    }
}

function createEmptySchemaIndexData(): ReverseReferenceSchemaIndexData {
    return {
        simpleParentToChildTables: new Map<string, Set<string>>(),
        dynamicChildTableNames: new Set<string>(),
        dynamicIntermediateToChildTables: new Map<string, Set<string>>(),
        schemasByChildTable: new Map<string, Record<string, unknown>>(),
    };
}

function readSchemaContribution(schema: Record<string, unknown>): ReverseReferenceSchemaContribution {
    const simpleParentTableNames = new Set<string>();
    let hasDynamicReference = false;
    const dynamicIntermediateTableNames = new Set<string>();
    const header = schema['header'];
    if (!Array.isArray(header)) {
        return { simpleParentTableNames, hasDynamicReference, dynamicIntermediateTableNames };
    }
    for (const rawColumn of header) {
        if (typeof rawColumn !== 'object' || rawColumn === null) continue;
        const column = rawColumn as { reference?: string | DynamicReferenceSchema };
        if (!column.reference) continue;
        const expr = parseReferenceExpression(column.reference);
        if (isSimpleReference(expr)) {
            simpleParentTableNames.add(expr.tableName);
        } else if (isDynamicReference(expr)) {
            hasDynamicReference = true;
            dynamicIntermediateTableNames.add(expr.filter.tableName);
        }
    }
    return { simpleParentTableNames, hasDynamicReference, dynamicIntermediateTableNames };
}

/**
 * 逆参照解決の共有エンジン。
 *
 * - スキーマから「親テーブル → 候補子テーブル」を索引化する
 * - ストア変更を子テーブル単位で反映し、逆参照マップを再利用する
 * - 同時に走る同一テーブル解決を同じ Promise にまとめる
 */
export class ReverseReferenceEngine {
    private readonly store: InMemoryTableStore;
    private readonly notification: NotificationToast;
    private readonly schemaIndex: ReverseReferenceSchemaIndex;
    private readonly cache: Map<string, ReverseReferenceCacheEntry>;
    private readonly loading: Map<string, ReverseReferenceLoadingEntry>;
    private readonly mapUpdatedListeners: Set<ReverseReferenceMapUpdatedListener>;
    private readonly pendingChangedTables: Set<string>;
    private pendingRefreshPromise: Promise<void> | null;
    private schemaIndexVersion: number;
    private dataChangeVersion: number;

    constructor(store: InMemoryTableStore, notification: NotificationToast) {
        this.store = store;
        this.notification = notification;
        this.schemaIndex = new ReverseReferenceSchemaIndex();
        this.cache = new Map();
        this.loading = new Map();
        this.mapUpdatedListeners = new Set();
        this.pendingChangedTables = new Set();
        this.pendingRefreshPromise = null;
        this.schemaIndexVersion = 0;
        this.dataChangeVersion = 0;
        this.store.subscribeDataChange(event => {
            this.handleStoreDataChanged(event.tableName);
        });
    }

    invalidateAll(): void {
        this.schemaIndex.invalidate();
        this.schemaIndexVersion++;
        this.invalidateData();
    }

    invalidateData(): void {
        this.dataChangeVersion++;
        this.cache.clear();
        this.loading.clear();
        this.pendingChangedTables.clear();
        this.pendingRefreshPromise = null;
    }

    registerSchema(tableName: string, schema: Record<string, unknown>): void {
        this.schemaIndex.registerSchema(tableName, schema);
        this.schemaIndexVersion++;
        this.cache.clear();
        this.loading.clear();
    }

    markSchemaIndexComplete(): void {
        this.schemaIndex.markComplete();
        this.schemaIndexVersion++;
        this.cache.clear();
        this.loading.clear();
    }

    subscribeMapUpdated(listener: ReverseReferenceMapUpdatedListener): () => void {
        this.mapUpdatedListeners.add(listener);
        return () => {
            this.mapUpdatedListeners.delete(listener);
        };
    }

    async resolveAsync(tableName: string): Promise<ReverseReferenceMap> {
        await this.flushPendingStoreChangesAsync();
        const schemaIndexVersion = this.schemaIndexVersion;
        const dataChangeVersion = this.dataChangeVersion;

        const cached = this.cache.get(tableName);
        if (cached !== undefined
            && cached.schemaIndexVersion === schemaIndexVersion) {
            return cached.map;
        }

        const currentLoading = this.loading.get(tableName);
        if (currentLoading !== undefined
            && currentLoading.schemaIndexVersion === schemaIndexVersion
            && currentLoading.dataChangeVersion === dataChangeVersion) {
            return currentLoading.promise;
        }

        const promise = this.resolveFreshAsync(tableName);
        const loadingEntry: ReverseReferenceLoadingEntry = {
            schemaIndexVersion,
            dataChangeVersion,
            promise,
        };
        this.loading.set(tableName, loadingEntry);

        try {
            const map = await promise;
            if (this.loading.get(tableName) === loadingEntry
                && this.schemaIndexVersion === schemaIndexVersion
                && this.dataChangeVersion === dataChangeVersion) {
                this.cache.set(tableName, { schemaIndexVersion, map });
            }
            return map;
        } finally {
            if (this.loading.get(tableName) === loadingEntry) {
                this.loading.delete(tableName);
            }
        }
    }

    private async resolveFreshAsync(tableName: string): Promise<ReverseReferenceMap> {
        const candidateChildSchemas = await this.schemaIndex.getCandidateChildSchemasAsync(tableName);
        const resolver = new ReverseReferenceResolver(this.store, this.notification);
        return resolver.resolveAsync(tableName, candidateChildSchemas);
    }

    private handleStoreDataChanged(tableName: string): void {
        this.dataChangeVersion++;
        this.loading.clear();
        if (this.cache.size === 0) return;
        this.pendingChangedTables.add(tableName);
        this.schedulePendingRefresh();
    }

    private schedulePendingRefresh(): void {
        if (this.pendingRefreshPromise !== null) return;
        this.pendingRefreshPromise = Promise.resolve().then(() => this.runPendingStoreChangesAsync());
    }

    private async flushPendingStoreChangesAsync(): Promise<void> {
        if (this.pendingRefreshPromise !== null) {
            await this.pendingRefreshPromise;
            return;
        }
        if (this.pendingChangedTables.size === 0) return;
        this.pendingRefreshPromise = this.runPendingStoreChangesAsync();
        await this.pendingRefreshPromise;
    }

    private async runPendingStoreChangesAsync(): Promise<void> {
        try {
            while (this.pendingChangedTables.size > 0) {
                const changedTables = [...this.pendingChangedTables];
                this.pendingChangedTables.clear();

                if (this.cache.size === 0) continue;
                if (!this.schemaIndex.isComplete()) {
                    this.cache.clear();
                    this.loading.clear();
                    continue;
                }

                const cachedParentTableNames = [...this.cache.keys()];
                const childTablesByParent = new Map<string, Set<string>>();
                for (const changedTableName of changedTables) {
                    this.collectAffectedCachedParentTables(
                        changedTableName,
                        cachedParentTableNames,
                        childTablesByParent,
                    );
                }

                for (const [parentTableName, childTableNames] of childTablesByParent) {
                    try {
                        await this.refreshCachedParentContributionsAsync(parentTableName, childTableNames);
                    } catch (error) {
                        console.warn('[ReverseReferenceEngine] failed to refresh cached reverse references:', parentTableName, error);
                        this.cache.delete(parentTableName);
                    }
                }
            }
        } finally {
            this.pendingRefreshPromise = null;
        }
    }

    private collectAffectedCachedParentTables(
        changedTableName: string,
        cachedParentTableNames: readonly string[],
        childTablesByParent: Map<string, Set<string>>,
    ): void {
        const directParents = this.schemaIndex.getSimpleParentTableNamesForChild(changedTableName);
        for (const parentTableName of directParents) {
            if (!this.cache.has(parentTableName)) continue;
            this.addAffectedChildTable(childTablesByParent, parentTableName, changedTableName);
        }

        if (this.schemaIndex.hasDynamicReference(changedTableName)) {
            for (const parentTableName of cachedParentTableNames) {
                this.addAffectedChildTable(childTablesByParent, parentTableName, changedTableName);
            }
        }

        const dynamicChildTables = this.schemaIndex.getDynamicChildTableNamesUsingIntermediate(changedTableName);
        for (const childTableName of dynamicChildTables) {
            for (const parentTableName of cachedParentTableNames) {
                this.addAffectedChildTable(childTablesByParent, parentTableName, childTableName);
            }
        }
    }

    private addAffectedChildTable(
        childTablesByParent: Map<string, Set<string>>,
        parentTableName: string,
        childTableName: string,
    ): void {
        let childTables = childTablesByParent.get(parentTableName);
        if (childTables === undefined) {
            childTables = new Set<string>();
            childTablesByParent.set(parentTableName, childTables);
        }
        childTables.add(childTableName);
    }

    private async refreshCachedParentContributionsAsync(
        parentTableName: string,
        childTableNames: ReadonlySet<string>,
    ): Promise<void> {
        const cached = this.cache.get(parentTableName);
        if (cached === undefined || cached.schemaIndexVersion !== this.schemaIndexVersion) return;

        const map = cached.map;
        for (const childTableName of childTableNames) {
            this.removeChildTableEntries(map, childTableName);
        }

        const childSchemas: ReverseReferenceChildSchema[] = [];
        for (const childTableName of childTableNames) {
            if (childTableName === parentTableName) continue;
            const schema = this.schemaIndex.getSchema(childTableName);
            if (schema !== undefined) childSchemas.push({ tableName: childTableName, schema });
        }

        if (childSchemas.length > 0) {
            const resolver = new ReverseReferenceResolver(this.store, this.notification);
            const childMap = await resolver.resolveAsync(parentTableName, childSchemas);
            this.mergeMapInto(map, childMap);
        }

        this.notifyMapUpdated(parentTableName, map);
    }

    private removeChildTableEntries(map: ReverseReferenceMap, childTableName: string): void {
        for (const [parentColumnValue, entries] of map) {
            const filtered = entries.filter(entry => entry.childTableName !== childTableName);
            if (filtered.length === 0) {
                map.delete(parentColumnValue);
            } else if (filtered.length !== entries.length) {
                map.set(parentColumnValue, filtered);
            }
        }
    }

    private mergeMapInto(target: ReverseReferenceMap, source: ReverseReferenceMap): void {
        for (const [parentColumnValue, sourceEntries] of source) {
            const entries = target.get(parentColumnValue);
            if (entries === undefined) {
                target.set(parentColumnValue, [...sourceEntries]);
            } else {
                entries.push(...sourceEntries);
            }
        }
    }

    private notifyMapUpdated(tableName: string, map: ReverseReferenceMap): void {
        for (const listener of this.mapUpdatedListeners) {
            listener(tableName, map);
        }
    }
}
