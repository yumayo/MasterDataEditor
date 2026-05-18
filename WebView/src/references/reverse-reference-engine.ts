import {findFilesAsync, readFileAsync} from "../app/api";
import {InMemoryTableStore} from "../data/in-memory-table-store";
import {NotificationToast} from "../ui/notification";
import {isDynamicReference, isSimpleReference, parseReferenceExpression, DynamicReferenceSchema} from "./reference-expression";
import {ReverseReferenceResolver, type ReverseReferenceChildSchema, type ReverseReferenceMap} from "./reverse-reference-resolver";

interface ReverseReferenceCacheEntry {
    storeRevision: number;
    schemaIndexVersion: number;
    map: ReverseReferenceMap;
}

interface ReverseReferenceLoadingEntry {
    storeRevision: number;
    schemaIndexVersion: number;
    promise: Promise<ReverseReferenceMap>;
}

interface ReverseReferenceSchemaIndexData {
    simpleParentToChildTables: Map<string, Set<string>>;
    dynamicChildTableNames: Set<string>;
    schemasByChildTable: Map<string, Record<string, unknown>>;
}

interface ReverseReferenceSchemaContribution {
    simpleParentTableNames: Set<string>;
    hasDynamicReference: boolean;
}

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
    }

    markComplete(): void {
        this.complete = true;
        this.loadingPromise = null;
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
        this.contributionsByChildTable.delete(tableName);
    }
}

function createEmptySchemaIndexData(): ReverseReferenceSchemaIndexData {
    return {
        simpleParentToChildTables: new Map<string, Set<string>>(),
        dynamicChildTableNames: new Set<string>(),
        schemasByChildTable: new Map<string, Record<string, unknown>>(),
    };
}

function readSchemaContribution(schema: Record<string, unknown>): ReverseReferenceSchemaContribution {
    const simpleParentTableNames = new Set<string>();
    let hasDynamicReference = false;
    const header = schema['header'];
    if (!Array.isArray(header)) {
        return { simpleParentTableNames, hasDynamicReference };
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
        }
    }
    return { simpleParentTableNames, hasDynamicReference };
}

/**
 * 逆参照解決の共有エンジン。
 *
 * - スキーマから「親テーブル → 候補子テーブル」を索引化する
 * - 同じデータ更新世代では逆参照マップを再利用する
 * - 同時に走る同一テーブル解決を同じ Promise にまとめる
 */
export class ReverseReferenceEngine {
    private readonly store: InMemoryTableStore;
    private readonly notification: NotificationToast;
    private readonly schemaIndex: ReverseReferenceSchemaIndex;
    private readonly cache: Map<string, ReverseReferenceCacheEntry>;
    private readonly loading: Map<string, ReverseReferenceLoadingEntry>;
    private schemaIndexVersion: number;

    constructor(store: InMemoryTableStore, notification: NotificationToast) {
        this.store = store;
        this.notification = notification;
        this.schemaIndex = new ReverseReferenceSchemaIndex();
        this.cache = new Map();
        this.loading = new Map();
        this.schemaIndexVersion = 0;
    }

    invalidateAll(): void {
        this.schemaIndex.invalidate();
        this.schemaIndexVersion++;
        this.cache.clear();
        this.loading.clear();
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

    async resolveAsync(tableName: string): Promise<ReverseReferenceMap> {
        const storeRevision = this.store.getDataRevision();
        const schemaIndexVersion = this.schemaIndexVersion;

        const cached = this.cache.get(tableName);
        if (cached !== undefined
            && cached.storeRevision === storeRevision
            && cached.schemaIndexVersion === schemaIndexVersion) {
            return cached.map;
        }

        const currentLoading = this.loading.get(tableName);
        if (currentLoading !== undefined
            && currentLoading.storeRevision === storeRevision
            && currentLoading.schemaIndexVersion === schemaIndexVersion) {
            return currentLoading.promise;
        }

        const promise = this.resolveFreshAsync(tableName);
        const loadingEntry: ReverseReferenceLoadingEntry = {
            storeRevision,
            schemaIndexVersion,
            promise,
        };
        this.loading.set(tableName, loadingEntry);

        try {
            const map = await promise;
            if (this.loading.get(tableName) === loadingEntry
                && this.store.getDataRevision() === storeRevision
                && this.schemaIndexVersion === schemaIndexVersion) {
                this.cache.set(tableName, { storeRevision, schemaIndexVersion, map });
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
}
