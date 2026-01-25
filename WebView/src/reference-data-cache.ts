import {readFileAsync} from "./api";
import {config} from "./config";
import {Csv} from "./csv";

/**
 * 参照テーブルの1項目を表す
 */
export interface ReferenceItem {
    id: string;           // 参照先のid列の値
    displayText: string;  // プルダウンに表示するテキスト
}

/**
 * 参照テーブルのデータ全体を表す
 */
export interface ReferenceTableData {
    tableName: string;
    items: ReferenceItem[];
    displayColumnName: string;  // 表示に使用している列名
}


/**
 * 参照テーブルデータのキャッシュを管理するクラス
 */
export class ReferenceDataCache {
    private cache: Map<string, ReferenceTableData>;
    private loadingPromises: Map<string, Promise<ReferenceTableData>>;

    constructor() {
        this.cache = new Map();
        this.loadingPromises = new Map();
    }

    /**
     * 指定したテーブルの参照データを取得する
     * キャッシュがあればそれを返し、なければ読み込む
     */
    async get(tableName: string): Promise<ReferenceTableData> {
        // キャッシュがあればそれを返す
        const cached = this.cache.get(tableName);
        if (cached) {
            return cached;
        }

        // すでに読み込み中であれば、そのPromiseを返す
        const loadingPromise = this.loadingPromises.get(tableName);
        if (loadingPromise) {
            return loadingPromise;
        }

        // 新しく読み込みを開始
        const promise = this.load(tableName);
        this.loadingPromises.set(tableName, promise);

        try {
            const data = await promise;
            this.cache.set(tableName, data);
            return data;
        } finally {
            this.loadingPromises.delete(tableName);
        }
    }

    /**
     * 複数のテーブルを事前読み込みする
     */
    preload(tableNames: string[]): void {
        for (const tableName of tableNames) {
            // get()を呼ぶことで非同期で読み込みが開始される
            this.get(tableName).catch(error => {
                console.warn(`Failed to preload reference table: ${tableName}`, error);
            });
        }
    }

    /**
     * キャッシュをクリアする
     */
    clear(): void {
        this.cache.clear();
    }

    /**
     * テーブルデータを読み込む
     */
    private async load(tableName: string): Promise<ReferenceTableData> {
        // スキーマを読み込む
        const schemaText = await readFileAsync(`schema/${tableName}.json`);

        // スキーマが空の場合は空のデータを返す
        if (!schemaText || schemaText.trim() === '') {
            console.warn(`Reference table schema is empty: ${tableName}`);
            return {
                tableName,
                items: [],
                displayColumnName: ''
            };
        }

        let schema;
        try {
            schema = JSON.parse(schemaText);
        } catch (e) {
            console.warn(`Failed to parse reference table schema: ${tableName}`, e);
            return {
                tableName,
                items: [],
                displayColumnName: ''
            };
        }

        // スキーマにheaderがない場合
        if (!schema.header || !Array.isArray(schema.header)) {
            console.warn(`Reference table schema has no header: ${tableName}`);
            return {
                tableName,
                items: [],
                displayColumnName: ''
            };
        }

        // CSVを読み込む
        const csvText = await readFileAsync(`data/${tableName}.csv`);

        // CSVが空の場合は空のデータを返す
        if (!csvText || csvText.trim() === '') {
            console.warn(`Reference table CSV is empty: ${tableName}`);
            return {
                tableName,
                items: [],
                displayColumnName: ''
            };
        }

        const csv = new Csv();
        csv.load(csvText);

        // 表示列を決定する
        const displayColumnName = this.determineDisplayColumn(schema.header);

        // 主キー列のインデックスを取得
        const idColumnIndex = csv.header.indexOf(config.primaryKeyColumnName);
        if (idColumnIndex === -1) {
            // id列がない場合は空のデータを返す
            return {
                tableName,
                items: [],
                displayColumnName: ''
            };
        }

        // 表示列のインデックスを取得
        const displayColumnIndex = csv.header.indexOf(displayColumnName);

        // 各行からReferenceItemを作成
        const items: ReferenceItem[] = [];
        for (const row of csv.body) {
            const id = row[idColumnIndex];
            // 表示列がない場合はidを表示テキストとして使用
            const displayText = displayColumnIndex !== -1 ? row[displayColumnIndex] : id;
            items.push({ id, displayText });
        }

        return {
            tableName,
            items,
            displayColumnName
        };
    }

    /**
     * スキーマのヘッダーから表示列を決定する
     */
    private determineDisplayColumn(headerSchema: Array<{name: string}>): string {
        const columnNames = headerSchema.map(h => h.name);

        for (const priority of config.referenceDisplayColumnPriority) {
            if (columnNames.includes(priority)) {
                return priority;
            }
        }

        // 優先順位の列がなければ空文字列を返す（表示列なし）
        return '';
    }

    /**
     * テーブルが表示列を持つかどうかを判定する
     */
    hasDisplayColumn(data: ReferenceTableData): boolean {
        return data.displayColumnName !== '';
    }
}
