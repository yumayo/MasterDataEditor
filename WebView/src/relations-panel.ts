import {EditorTable} from "./editor-table";
import {ReferenceDataCache} from "./reference-data-cache";
import {InMemoryTableStore} from "./in-memory-table-store";
import {parseReferenceExpression, isSimpleReference} from "./reference-expression";
import {config} from "./config";
import {readFileAsync, findFilesAsync} from "./api";

/**
 * リレーションパネルに表示する参照エントリ
 */
interface RelationEntry {
    /** 表示ラベル（FK列名または子テーブル名） */
    label: string;
    /** 参照種別: N:1（FK参照先）、1:N（逆参照） */
    relationType: 'N:1' | '1:N';
    /** 参照先/参照元テーブル名（ドリルダウン時の次テーブル） */
    tableKey: string;
    /** テーブルのヘッダー列名配列 */
    header: string[];
    /** 表示する行データ（各行は列値の配列） */
    rows: string[][];
}

/**
 * ナビゲーションスタックの1段分
 */
interface NavFrame {
    /** パンくず表示用ラベル */
    label: string;
    /** 表示するエントリ一覧 */
    entries: RelationEntry[];
    /** アクティブ（選択中）なエントリインデックス */
    activeIndex: number;
}

/**
 * リレーションパネル
 *
 * 選択行の参照先（N:1）と参照元（1:N）を右ペインに表示する。
 * ナビゲーションスタックとパンくずリストによりドリルダウンをサポートする。
 *
 * EditorTableへの接続は connectEditorTable()/disconnectEditorTable() で動的に管理する。
 * これによりテーブルが開かれる前からDOMに存在できる。
 */
export class RelationsPanel {
    private readonly panelElement: HTMLElement;
    private readonly referenceDataCache: ReferenceDataCache;
    private readonly store: InMemoryTableStore;
    /** 現在接続中のEditorTable。未接続時はfalse */
    private currentEditorTable: EditorTable | false;
    /** ナビゲーションスタック。空の場合はプレースホルダーを表示 */
    private navStack: NavFrame[];
    /** 非同期レースコンディション防止用リクエストID */
    private currentRequestId: number;

    constructor(referenceDataCache: ReferenceDataCache, store: InMemoryTableStore) {
        this.referenceDataCache = referenceDataCache;
        this.store = store;
        this.currentEditorTable = false;
        this.navStack = [];
        this.currentRequestId = 0;

        const panel = document.createElement('div');
        panel.classList.add('relations-panel');
        this.panelElement = panel;

        // 初期状態: プレースホルダーを表示
        this.renderMessage('行を選択してください');
    }

    /**
     * 親要素にパネルを追加する
     */
    appendTo(parent: HTMLElement): void {
        parent.appendChild(this.panelElement);
    }

    /**
     * EditorTableを接続する（タブがアクティブになったとき）
     * 相互参照パターン: EditorTable.relationsPanel フィールドをここで設定する
     */
    connectEditorTable(editorTable: EditorTable): void {
        this.currentEditorTable = editorTable;
        editorTable.relationsPanel = this;
        this.navStack = [];
        this.renderMessage('行を選択してください');
    }

    /**
     * EditorTableの接続を解除する（タブが非アクティブになったとき）
     */
    disconnectEditorTable(): void {
        if (this.currentEditorTable !== false) {
            this.currentEditorTable.relationsPanel = false;
        }
        this.currentEditorTable = false;
        this.navStack = [];
        this.renderMessage('行を選択してください');
    }

    /**
     * 選択行の関連データをすべて解決して表示する（Selectionから呼ばれる）
     * fullDataCacheが未ロードの場合は非同期でロードして再描画する
     */
    updateForRow(rowIndex: number): void {
        if (this.currentEditorTable === false) return;
        this.updateForRowAsync(rowIndex, this.currentEditorTable).catch(err => {
            console.error('[RelationsPanel] updateForRow 失敗:', err);
        });
    }

    /**
     * 選択行の関連データを非同期で解決して表示する
     * requestId によるレースコンディション防止: 最新リクエスト以外は描画しない
     */
    private async updateForRowAsync(rowIndex: number, editorTable: EditorTable): Promise<void> {
        const requestId = ++this.currentRequestId;
        const entries = await this.resolveEntriesForEditorRowAsync(rowIndex, editorTable);
        // 非同期処理中にEditorTableが切り替わっていた場合、または新しいリクエストが来ていた場合は描画しない
        if (requestId !== this.currentRequestId) return;
        if (this.currentEditorTable !== editorTable) return;
        if (entries.length === 0) {
            this.navStack = [];
            this.renderMessage('参照なし');
            return;
        }
        this.navStack = [{
            label: editorTable.tableName,
            entries,
            activeIndex: 0,
        }];
        this.render();
    }

    /**
     * EditorTableの指定行からリレーションエントリを非同期で解決する
     * fullDataCacheが未ロードの場合は getFullDataAsync() でロードする
     */
    private async resolveEntriesForEditorRowAsync(rowIndex: number, editorTable: EditorTable): Promise<RelationEntry[]> {
        const entries: RelationEntry[] = [];
        const tableData = editorTable.getTableData();

        // N:1（FK参照先）の解決
        for (let colIdx = 0; colIdx < tableData.header.length; colIdx++) {
            const col = tableData.header[colIdx];
            if (!col.reference) continue;
            const expr = parseReferenceExpression(col.reference);
            if (!isSimpleReference(expr)) continue;

            // DOMの列は1始まり（行ヘッダーが0列目）なのでcolIdx+1
            const fkValue = editorTable.getCellValueAt(rowIndex, colIdx + 1);
            if (fkValue === '') continue;

            // キャッシュ未ロードの場合は非同期でロードする
            const syncData = this.referenceDataCache.getFullDataSync(expr.tableName);
            const fullData = syncData !== false
                ? syncData
                : await this.referenceDataCache.getFullDataAsync(expr.tableName).catch(() => false as const);
            if (fullData === false) continue;

            const matchedRow = fullData.rows.get(fkValue);
            const rows: string[][] = matchedRow ? [matchedRow] : [];

            entries.push({
                label: col.name,
                relationType: 'N:1',
                tableKey: expr.tableName,
                header: fullData.header,
                rows,
            });
        }

        // 1:N（逆参照）の解決
        const pkValue = editorTable.getRowPkValue(rowIndex);
        if (pkValue !== '') {
            const reverseEntries = editorTable.getReverseReferenceEntries(pkValue);
            for (const reverseEntry of reverseEntries) {
                const header = this.store.getHeader(reverseEntry.childTableName);
                const storeRows = this.store.getRows(reverseEntry.childTableName);
                if (header === false || storeRows === false) continue;

                // reverseEntry.rows は ReverseReferenceRow[]（pkValue一覧）なので
                // PKで行データをフィルタリングする
                const pkColIdx = header.indexOf(config.primaryKeyColumnName);
                let filteredRows: string[][];
                if (pkColIdx !== -1) {
                    const pkSet = new Set(reverseEntry.rows.map(r => r.pkValue));
                    filteredRows = storeRows.filter(r => pkSet.has(r[pkColIdx]));
                } else {
                    filteredRows = [];
                }

                entries.push({
                    label: reverseEntry.childTableName,
                    relationType: '1:N',
                    tableKey: reverseEntry.childTableName,
                    header,
                    rows: filteredRows,
                });
            }
        }

        return entries;
    }

    /**
     * storeベースで指定テーブルの指定PK行のリレーションエントリを非同期で解決する
     * ドリルダウン時に使用する（EditorTableが不要なstoreベースの解決）
     *
     * N:1（FK参照先）: スキーマファイルを読み込んでreference式を取得し、referenceDataCacheで解決
     * 1:N（逆参照）: 全テーブルスキーマを走査し、tableKeyを参照しているFKカラムを持つstoreテーブルを探索
     */
    private async resolveEntriesForStoreRowAsync(tableKey: string, pkValue: string): Promise<RelationEntry[]> {
        const entries: RelationEntry[] = [];

        // スキーマファイルを読み込んで列定義を取得する
        const schemaText = await readFileAsync(`schema/${tableKey}.json`).catch(() => '');
        if (schemaText === '') return entries;

        const schema: Record<string, unknown> = JSON.parse(schemaText);
        const headerDefs = schema.header as Array<{ name: string; reference?: string }>;
        if (!Array.isArray(headerDefs)) return entries;

        // storeからこのテーブルの行データを取得してPKでフィルタリング
        const storeHeader = this.store.getHeader(tableKey);
        const storeRows = this.store.getRows(tableKey);
        const pkColInStore = storeHeader !== false ? storeHeader.indexOf(config.primaryKeyColumnName) : -1;
        const targetRow = (storeHeader !== false && storeRows !== false && pkColInStore !== -1)
            ? storeRows.find(r => r[pkColInStore] === pkValue)
            : false;

        // N:1（FK参照先）の解決: スキーマのreference式を使ってFK値を取得
        for (let colIdx = 0; colIdx < headerDefs.length; colIdx++) {
            const col = headerDefs[colIdx];
            if (!col.reference) continue;
            const expr = parseReferenceExpression(col.reference);
            if (!isSimpleReference(expr)) continue;

            // storeから対象行のFK値を取得する
            const fkValue = (targetRow !== false && storeHeader !== false)
                ? (targetRow[storeHeader.indexOf(col.name)] ?? '')
                : '';
            if (fkValue === '') continue;

            // referenceDataCacheからFK参照先テーブルのデータを取得する
            const syncData = this.referenceDataCache.getFullDataSync(expr.tableName);
            const fullData = syncData !== false
                ? syncData
                : await this.referenceDataCache.getFullDataAsync(expr.tableName).catch(() => false as const);
            if (fullData === false) continue;

            const matchedRow = fullData.rows.get(fkValue);
            const rows: string[][] = matchedRow ? [matchedRow] : [];

            entries.push({
                label: col.name,
                relationType: 'N:1',
                tableKey: expr.tableName,
                header: fullData.header,
                rows,
            });
        }

        // 1:N（逆参照）の解決: 全スキーマを走査してtableKeyを参照している子テーブルを探す
        const schemaFiles = await findFilesAsync('schema').catch(() => [] as Array<{ name: string; type: 'file' | 'directory' }>);
        for (const file of schemaFiles) {
            if (file.type !== 'file' || !file.name.endsWith('.json')) continue;
            const childTableName = file.name.replace('.json', '');
            if (childTableName === tableKey) continue;

            // storeに存在しないテーブルは逆参照解決をスキップ
            const childHeader = this.store.getHeader(childTableName);
            const childRows = this.store.getRows(childTableName);
            if (childHeader === false || childRows === false) continue;

            // 子テーブルのスキーマを読み込んでFK列を探す
            const childSchemaText = await readFileAsync(`schema/${childTableName}.json`).catch(() => '');
            if (childSchemaText === '') continue;
            const childSchema: Record<string, unknown> = JSON.parse(childSchemaText);
            const childHeaderDefs = childSchema.header as Array<{ name: string; reference?: string }>;
            if (!Array.isArray(childHeaderDefs)) continue;

            // tableKeyを参照しているFK列のインデックスを収集する
            const fkColIndices: number[] = [];
            for (const childCol of childHeaderDefs) {
                if (!childCol.reference) continue;
                const expr = parseReferenceExpression(childCol.reference);
                if (isSimpleReference(expr) && expr.tableName === tableKey) {
                    const idx = childHeader.indexOf(childCol.name);
                    if (idx !== -1) fkColIndices.push(idx);
                }
            }
            if (fkColIndices.length === 0) continue;

            // FK値がpkValueと一致する行をフィルタリングする
            const filteredRows = childRows.filter(row =>
                fkColIndices.some(fkIdx => row[fkIdx] === pkValue)
            );

            entries.push({
                label: childTableName,
                relationType: '1:N',
                tableKey: childTableName,
                header: childHeader,
                rows: filteredRows,
            });
        }

        return entries;
    }

    // =========================================================================
    // レンダリング
    // =========================================================================

    /**
     * メッセージを表示する（行未選択時・参照なし時）
     */
    private renderMessage(text: string): void {
        this.panelElement.replaceChildren();
        const placeholder = document.createElement('div');
        placeholder.classList.add('relations-panel-placeholder');
        const span = document.createElement('span');
        span.textContent = text;
        placeholder.appendChild(span);
        this.panelElement.appendChild(placeholder);
    }

    /**
     * 現在のナビゲーション状態を描画する
     */
    private render(): void {
        this.panelElement.replaceChildren();

        if (this.navStack.length === 0) {
            this.renderMessage('行を選択してください');
            return;
        }

        const currentFrame = this.navStack[this.navStack.length - 1];
        const content = document.createElement('div');
        content.classList.add('relations-panel-content');

        // パンくずリスト（2段以上のとき表示）
        if (this.navStack.length > 1) {
            content.appendChild(this.buildBreadcrumb());
        }

        // RELATIONS セクションヘッダー
        const sectionHeader = document.createElement('div');
        sectionHeader.classList.add('relations-panel-section-header');
        sectionHeader.textContent = 'RELATIONS';
        content.appendChild(sectionHeader);

        // 参照エントリリスト
        const refList = document.createElement('div');
        refList.classList.add('relations-ref-list');
        currentFrame.entries.forEach((entry, i) => {
            refList.appendChild(this.buildRefListItem(entry, i, currentFrame));
        });
        content.appendChild(refList);

        // アクティブエントリのミニテーブルセクション
        const activeEntry = currentFrame.entries[currentFrame.activeIndex];
        if (activeEntry) {
            const tableSection = document.createElement('div');
            tableSection.classList.add('relations-table-section');

            const tableHeader = document.createElement('div');
            tableHeader.classList.add('relations-table-header');
            const tableTitle = document.createElement('span');
            tableTitle.classList.add('relations-table-title');
            tableTitle.textContent = activeEntry.tableKey;
            const tagEl = this.buildTag(activeEntry.relationType);
            const rowCountEl = document.createElement('span');
            rowCountEl.classList.add('relations-table-row-count');
            rowCountEl.textContent = `${activeEntry.rows.length} rows`;
            tableHeader.appendChild(tableTitle);
            tableHeader.appendChild(tagEl);
            tableHeader.appendChild(rowCountEl);
            tableSection.appendChild(tableHeader);

            tableSection.appendChild(this.buildMiniTable(activeEntry));
            content.appendChild(tableSection);
        }

        this.panelElement.appendChild(content);
    }

    /**
     * パンくずリストを構築する
     */
    private buildBreadcrumb(): HTMLElement {
        const breadcrumb = document.createElement('div');
        breadcrumb.classList.add('relations-breadcrumb');

        this.navStack.forEach((frame, i) => {
            if (i > 0) {
                const sep = document.createElement('span');
                sep.classList.add('relations-breadcrumb-sep');
                sep.textContent = '›';
                breadcrumb.appendChild(sep);
            }
            const crumb = document.createElement('span');
            crumb.classList.add('relations-breadcrumb-item');
            const isLast = i === this.navStack.length - 1;
            if (isLast) {
                crumb.classList.add('relations-breadcrumb-item--active');
            } else {
                crumb.addEventListener('click', () => {
                    this.navStack = this.navStack.slice(0, i + 1);
                    this.render();
                });
            }
            crumb.textContent = frame.label;
            breadcrumb.appendChild(crumb);
        });

        return breadcrumb;
    }

    /**
     * 参照エントリのリストアイテムを構築する
     */
    private buildRefListItem(entry: RelationEntry, index: number, frame: NavFrame): HTMLElement {
        const item = document.createElement('button');
        item.classList.add('relations-ref-list-item');
        if (index === frame.activeIndex) {
            item.classList.add('relations-ref-list-item--active');
        }

        const labelEl = document.createElement('span');
        labelEl.classList.add('relations-ref-label');
        labelEl.textContent = entry.label;

        const tagEl = this.buildTag(entry.relationType);

        const countEl = document.createElement('span');
        countEl.classList.add('relations-ref-count');
        countEl.textContent = String(entry.rows.length);

        item.appendChild(labelEl);
        item.appendChild(tagEl);
        item.appendChild(countEl);

        item.addEventListener('click', () => {
            frame.activeIndex = index;
            this.render();
        });

        return item;
    }

    /**
     * 参照種別タグ要素を構築する
     */
    private buildTag(relationType: '1:N' | 'N:1'): HTMLElement {
        const tag = document.createElement('span');
        tag.classList.add('relations-tag');
        tag.classList.add(relationType === '1:N' ? 'relations-tag--1n' : 'relations-tag--n1');
        tag.textContent = relationType;
        return tag;
    }

    /**
     * ミニテーブルを構築する
     */
    private buildMiniTable(entry: RelationEntry): HTMLElement {
        const wrapper = document.createElement('div');
        wrapper.classList.add('relations-mini-table-wrapper');

        const table = document.createElement('table');
        table.classList.add('relations-mini-table');

        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        for (const colName of entry.header) {
            const th = document.createElement('th');
            th.textContent = colName;
            headerRow.appendChild(th);
        }
        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        if (entry.rows.length === 0) {
            const emptyTr = document.createElement('tr');
            const emptyTd = document.createElement('td');
            emptyTd.colSpan = entry.header.length;
            emptyTd.classList.add('relations-mini-table-empty');
            emptyTd.textContent = 'データなし';
            emptyTr.appendChild(emptyTd);
            tbody.appendChild(emptyTr);
        } else {
            for (const rowData of entry.rows) {
                const tr = document.createElement('tr');
                tr.classList.add('relations-mini-table-row');
                for (let ci = 0; ci < entry.header.length; ci++) {
                    const td = document.createElement('td');
                    td.textContent = rowData[ci];
                    tr.appendChild(td);
                }
                tr.addEventListener('click', () => {
                    this.drillDownAsync(entry, rowData).catch(err => {
                        console.error('[RelationsPanel] drillDown 失敗:', err);
                    });
                });
                tbody.appendChild(tr);
            }
        }
        table.appendChild(tbody);
        wrapper.appendChild(table);
        return wrapper;
    }

    /**
     * ミニテーブルの行をクリックしたときにドリルダウンする
     * クリックされた行が属する entry.tableKey のテーブルデータをstoreから取得し、
     * resolveEntriesForStoreRowAsync() でリレーションを解決して新しいNavFrameを構築する
     */
    private async drillDownAsync(parentEntry: RelationEntry, clickedRow: string[]): Promise<void> {
        // レースコンディション防止: 最新リクエスト以外は描画しない
        const requestId = ++this.currentRequestId;
        const targetTableKey = parentEntry.tableKey;

        // クリックされた行のPK値を取得（parentEntry.headerのPK列位置から取得）
        const pkColInParent = parentEntry.header.indexOf(config.primaryKeyColumnName);
        if (pkColInParent === -1) throw new Error(`[RelationsPanel] drillDown: PK列が見つかりません（tableKey=${targetTableKey}）`);
        const pkValue = clickedRow[pkColInParent];
        if (pkValue === '') throw new Error(`[RelationsPanel] drillDown: PK値が空です（tableKey=${targetTableKey}）`);

        // ドリルダウン先テーブルの行データをstoreから取得し、クリックされたPK値でフィルタリング
        const storeHeader = this.store.getHeader(targetTableKey);
        const storeRows = this.store.getRows(targetTableKey);
        if (storeHeader === false || storeRows === false) throw new Error(`[RelationsPanel] drillDown: storeにテーブルが存在しません（tableKey=${targetTableKey}）`);
        const pkColInStore = storeHeader.indexOf(config.primaryKeyColumnName);
        if (pkColInStore === -1) throw new Error(`[RelationsPanel] drillDown: storeヘッダーにPK列がありません（tableKey=${targetTableKey}）`);
        const filteredRows = storeRows.filter(r => r[pkColInStore] === pkValue);
        if (filteredRows.length === 0) throw new Error(`[RelationsPanel] drillDown: 対象行が見つかりません（tableKey=${targetTableKey}, pk=${pkValue}）`);

        // storeベースでドリルダウン先のリレーションエントリを解決する
        const entries = await this.resolveEntriesForStoreRowAsync(targetTableKey, pkValue);

        // 非同期処理中に別のリクエストが来ていた場合は描画しない
        if (requestId !== this.currentRequestId) return;

        // クリックされた行自身をエントリとして先頭に追加する（現在の行を確認できるように）
        const selfEntry: RelationEntry = {
            label: targetTableKey,
            relationType: parentEntry.relationType,
            tableKey: targetTableKey,
            header: storeHeader,
            rows: filteredRows,
        };

        this.navStack.push({
            label: `${targetTableKey}#${pkValue}`,
            entries: [selfEntry, ...entries],
            activeIndex: 0,
        });
        this.render();
    }
}
