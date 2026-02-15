import {readFileAsync, findFilesAsync} from "./api";
import {config} from "./config";
import {Csv} from "./csv";
import {EditorTable} from "./editor-table";
import {parseReferenceExpression, isSimpleReference} from "./reference-expression";

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
 * 参照テーブルの全カラムデータを保持する（動的参照用）
 */
export interface ReferenceTableFullData {
    tableName: string;
    header: string[];               // 全カラム名
    rows: Map<string, string[]>;    // id → 全カラム値
    displayColumnName: string;
    displayColumnIndex: number;
}


/**
 * 参照テーブルデータのキャッシュを管理するクラス
 */
export class ReferenceDataCache {
    private cache: Map<string, ReferenceTableData>;
    private loadingPromises: Map<string, Promise<ReferenceTableData>>;

    // 動的参照用の全カラムデータキャッシュ
    private fullDataCache: Map<string, ReferenceTableFullData>;
    private fullDataLoadingPromises: Map<string, Promise<ReferenceTableFullData>>;

    /** タブで開かれているEditorTableの参照（インメモリデータ優先取得用） */
    private readonly openEditorTables: Map<string, EditorTable>;

    constructor(openEditorTables: Map<string, EditorTable>) {
        this.cache = new Map();
        this.loadingPromises = new Map();
        this.fullDataCache = new Map();
        this.fullDataLoadingPromises = new Map();
        this.openEditorTables = openEditorTables;
    }

    /**
     * タブで開かれているテーブルのインメモリデータからCsvを構築する
     * DOMから現在の値を読み取るため、未保存の編集内容も反映される
     * 開かれていなければ結果なしを返す
     */
    private getInMemoryCsv(tableName: string): Csv | false {
        const editorTable = this.openEditorTables.get(tableName);
        if (!editorTable) return false;

        const columnCount = editorTable.getColumnCount();
        const rowCount = editorTable.getRowCount();

        const csv = new Csv();

        // 列ヘッダーをDOMから取得
        const header: string[] = [];
        for (let c = 0; c < columnCount; c++) {
            header.push(editorTable.getColumnHeaderValue(c));
        }
        csv.header = header;

        // データ行をDOMから取得（セル編集はDOMのみ更新されるため）
        const body: string[][] = [];
        for (let r = 1; r < rowCount; r++) {
            const rowData: string[] = [];
            for (let c = 1; c <= columnCount; c++) {
                rowData.push(editorTable.getCellValueAt(r, c));
            }
            if (rowData.length > 0 && rowData[0] !== '') {
                body.push(rowData);
            } else {
                break;
            }
        }
        csv.body = body;
        return csv;
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
        this.fullDataCache.clear();
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

        // タブで開かれていればインメモリデータを優先、なければCSVファイルから読み込む
        const inMemoryCsv = this.getInMemoryCsv(tableName);
        let csv: Csv;
        if (inMemoryCsv !== false) {
            csv = inMemoryCsv;
        } else {
            const csvText = await readFileAsync(`data/${tableName}.csv`);

            if (!csvText || csvText.trim() === '') {
                console.warn(`Reference table CSV is empty: ${tableName}`);
                return {
                    tableName,
                    items: [],
                    displayColumnName: ''
                };
            }

            csv = new Csv();
            csv.load(csvText);
        }

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
            // idが空の行はスキップ
            if (id === undefined || id === '') {
                continue;
            }
            // 表示列がない場合、または表示列の値が空の場合はidを表示テキストとして使用
            const rawDisplayText = displayColumnIndex !== -1 ? row[displayColumnIndex] : id;
            const displayText = (rawDisplayText !== undefined && rawDisplayText !== '') ? rawDisplayText : id;
            items.push({ id, displayText });
        }

        // id列のスキーマ定義に参照がある場合、参照先テーブルから表示テキストを再帰的に解決する
        const idColumnSchemaEntry = schema.header.find(
            (h: {name: string; reference?: string}) => h.name === config.primaryKeyColumnName
        );
        if (idColumnSchemaEntry && idColumnSchemaEntry.reference) {
            const refExpr = parseReferenceExpression(idColumnSchemaEntry.reference);
            // 単純参照かつ循環参照でない場合のみ解決する
            if (isSimpleReference(refExpr) && !this.loadingPromises.has(refExpr.tableName)) {
                try {
                    const refData = await this.get(refExpr.tableName);
                    for (const item of items) {
                        // 表示テキストがIDと同じ（有意な表示列がない）場合のみ参照先で解決する
                        if (item.displayText === item.id) {
                            const refItem = refData.items.find(ri => ri.id === item.id);
                            if (refItem && refItem.displayText !== refItem.id) {
                                item.displayText = refItem.displayText;
                            }
                        }
                    }
                } catch (e) {
                    console.warn(`[ref-cache] Failed to resolve reference chain for ${tableName}`, e);
                }
            }
        }

        // 有意な表示テキストがない場合、
        // 逆参照チェーンで表示テキストを解決する
        // 例: weapon(idのみ) → weapon_name(id→weapon.id, ja)
        const needsReverseChain =
            items.length > 0
            && items.every(
                item => item.displayText === item.id
            );
        if (needsReverseChain) {
            await this.resolveReverseReferenceChainAsync(
                tableName, items
            );
        }

        return {
            tableName,
            items,
            displayColumnName
        };
    }

    /**
     * 逆参照チェーンで表示テキストを解決する
     *
     * 対象テーブルに表示列がない場合、
     * id列で対象テーブルを参照している子テーブルを探し、
     * その子テーブルの表示列の値を使用する
     */
    private async resolveReverseReferenceChainAsync(
        tableName: string,
        items: ReferenceItem[]
    ): Promise<void> {
        const schemaFiles =
            await findFilesAsync("schema");

        for (const file of schemaFiles) {
            if (file.type !== 'file') continue;
            if (!file.name.endsWith('.json')) continue;

            const childTableName =
                file.name.replace('.json', '');
            if (childTableName === tableName) continue;

            try {
                const schemaText = await readFileAsync(
                    `schema/${childTableName}.json`
                );
                const childSchema = JSON.parse(
                    schemaText
                );
                if (!childSchema.header
                    || !Array.isArray(
                        childSchema.header
                    )) {
                    continue;
                }

                // id列がこのテーブルを参照しているか
                const idEntry =
                    childSchema.header.find(
                        (h: {
                            name: string;
                            reference?: string;
                        }) =>
                            h.name
                            === config
                                .primaryKeyColumnName
                    );
                if (!idEntry
                    || !idEntry.reference) {
                    continue;
                }

                const refExpr =
                    parseReferenceExpression(
                        idEntry.reference
                    );
                if (!isSimpleReference(refExpr)
                    || refExpr.tableName
                        !== tableName) {
                    continue;
                }

                // 子テーブルに表示列があるか
                const displayCol =
                    this.determineDisplayColumn(
                        childSchema.header
                    );
                if (displayCol === '') continue;

                // 子テーブルのデータを読み込み、
                // 表示テキストを解決する
                const childData =
                    await this.get(childTableName);

                for (const item of items) {
                    if (item.displayText
                        !== item.id) {
                        continue;
                    }
                    const childItem =
                        childData.items.find(
                            ci => ci.id === item.id
                        );
                    if (childItem
                        && childItem.displayText
                            !== childItem.id) {
                        item.displayText =
                            childItem.displayText;
                    }
                }

                // 解決できたら終了
                break;
            } catch {
                continue;
            }
        }
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

    /**
     * キャッシュから同期的にテーブルデータを取得する
     * キャッシュにない場合は undefined を返す
     */
    getSync(tableName: string): ReferenceTableData | undefined {
        return this.cache.get(tableName);
    }

    /**
     * キャッシュ内の指定テーブル・指定IDの表示テキストを更新する
     * 逆参照チェーンで解決された表示テキストを即座に反映するために使用
     *
     * 呼び出し元でキャッシュの存在とIDの有効性を事前検証済みである前提
     */
    updateDisplayText(tableName: string, id: string, newDisplayText: string): void {
        const data = this.cache.get(tableName);
        if (!data) throw new Error(`キャッシュにテーブルが存在しません: ${tableName}`);
        const item = data.items.find(item => item.id === id);
        if (!item) throw new Error(`キャッシュにIDが存在しません: tableName=${tableName}, id=${id}`);
        item.displayText = newDisplayText;
    }

    /**
     * IDから表示テキストを取得する
     * @param tableName テーブル名
     * @param id 検索するID
     * @returns 表示テキスト（見つからない場合は undefined）
     */
    getDisplayTextById(tableName: string, id: string): string | undefined {
        const data = this.cache.get(tableName);
        if (!data) return undefined;

        const item = data.items.find(item => item.id === id);
        if (!item) return undefined;

        // displayText と id が同じ場合はヒントを表示しない
        if (item.displayText === item.id) return undefined;

        return item.displayText;
    }

    /**
     * 指定したテーブルの全カラムデータを取得する（動的参照用）
     * キャッシュがあればそれを返し、なければ読み込む
     */
    async getFullDataAsync(tableName: string): Promise<ReferenceTableFullData> {
        // キャッシュがあればそれを返す
        const cached = this.fullDataCache.get(tableName);
        if (cached) {
            return cached;
        }

        // すでに読み込み中であれば、そのPromiseを返す
        const loadingPromise = this.fullDataLoadingPromises.get(tableName);
        if (loadingPromise) {
            return loadingPromise;
        }

        // 新しく読み込みを開始
        const promise = this.loadFullDataAsync(tableName);
        this.fullDataLoadingPromises.set(tableName, promise);

        try {
            const data = await promise;
            this.fullDataCache.set(tableName, data);
            return data;
        } finally {
            this.fullDataLoadingPromises.delete(tableName);
        }
    }

    /**
     * テーブルの全カラムデータを読み込む
     */
    private async loadFullDataAsync(tableName: string): Promise<ReferenceTableFullData> {
        // スキーマを読み込む
        const schemaText = await readFileAsync(`schema/${tableName}.json`);

        // スキーマが空の場合は空のデータを返す
        if (!schemaText || schemaText.trim() === '') {
            console.warn(`Reference table schema is empty: ${tableName}`);
            return {
                tableName,
                header: [],
                rows: new Map(),
                displayColumnName: '',
                displayColumnIndex: -1
            };
        }

        let schema;
        try {
            schema = JSON.parse(schemaText);
        } catch (e) {
            console.warn(`Failed to parse reference table schema: ${tableName}`, e);
            return {
                tableName,
                header: [],
                rows: new Map(),
                displayColumnName: '',
                displayColumnIndex: -1
            };
        }

        // スキーマにheaderがない場合
        if (!schema.header || !Array.isArray(schema.header)) {
            console.warn(`Reference table schema has no header: ${tableName}`);
            return {
                tableName,
                header: [],
                rows: new Map(),
                displayColumnName: '',
                displayColumnIndex: -1
            };
        }

        // タブで開かれていればインメモリデータを優先、なければCSVファイルから読み込む
        const inMemoryCsv = this.getInMemoryCsv(tableName);
        let csv: Csv;
        if (inMemoryCsv !== false) {
            csv = inMemoryCsv;
        } else {
            const csvText = await readFileAsync(`data/${tableName}.csv`);

            if (!csvText || csvText.trim() === '') {
                console.warn(`Reference table CSV is empty: ${tableName}`);
                return {
                    tableName,
                    header: [],
                    rows: new Map(),
                    displayColumnName: '',
                    displayColumnIndex: -1
                };
            }

            csv = new Csv();
            csv.load(csvText);
        }

        // 表示列を決定する
        const displayColumnName = this.determineDisplayColumn(schema.header);
        const displayColumnIndex = csv.header.indexOf(displayColumnName);

        // 主キー列のインデックスを取得
        const idColumnIndex = csv.header.indexOf(config.primaryKeyColumnName);

        // 行データをMapに格納
        const rows = new Map<string, string[]>();
        if (idColumnIndex !== -1) {
            for (const row of csv.body) {
                const id = row[idColumnIndex];
                // idが空の行はスキップ
                if (id === undefined || id === '') {
                    continue;
                }
                rows.set(id, row);
            }
        }

        return {
            tableName,
            header: csv.header,
            rows,
            displayColumnName,
            displayColumnIndex
        };
    }

    /**
     * 指定テーブルの指定IDの指定カラムの値を取得する（動的参照用）
     * キャッシュがない場合は undefined を返す（同期的取得のため）
     * @param tableName テーブル名
     * @param id 検索するID
     * @param columnName 取得するカラム名
     * @returns カラムの値（見つからない場合は undefined）
     */
    getColumnValue(tableName: string, id: string, columnName: string): string | undefined {
        const fullData = this.fullDataCache.get(tableName);
        if (!fullData) return undefined;

        const row = fullData.rows.get(id);
        if (!row) return undefined;

        const columnIndex = fullData.header.indexOf(columnName);
        if (columnIndex === -1) return undefined;

        return row[columnIndex];
    }

    /**
     * 指定テーブルの全カラムデータがキャッシュされているか確認する
     */
    hasFullData(tableName: string): boolean {
        return this.fullDataCache.has(tableName);
    }

    /**
     * 全カラムデータから指定カラムの値で行を検索する
     * @param fullData 検索対象の全カラムデータ
     * @param columnName 検索するカラム名
     * @param value 検索する値
     * @returns マッチした行の全カラム値、見つからない場合は undefined
     */
    findRowByColumn(fullData: ReferenceTableFullData, columnName: string, value: string): string[] | undefined {
        const columnIndex = fullData.header.indexOf(columnName);
        if (columnIndex === -1) return undefined;

        // 主キー列の場合はMap lookupで高速に検索
        const idColumnIndex = fullData.header.indexOf(config.primaryKeyColumnName);
        if (columnIndex === idColumnIndex) {
            return fullData.rows.get(value);
        }

        // その他の列は線形検索
        let result: string[] | undefined;
        fullData.rows.forEach((row) => {
            if (result) return;
            if (row[columnIndex] === value) {
                result = row;
            }
        });
        return result;
    }
}
