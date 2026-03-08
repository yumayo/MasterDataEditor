import {EditorTable} from "./editor-table";
import {ReferenceDataCache, ReferenceTableFullData} from "./reference-data-cache";
import {InMemoryTableStore} from "./in-memory-table-store";
import {parseReferenceExpression, isSimpleReference} from "./reference-expression";
import {config} from "./config";
import {readFileAsync, findFilesAsync} from "./api";
import {Tab} from "./tab";

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
}

/**
 * リレーションパネル
 *
 * 選択行の参照先（N:1）と参照元（1:N）を右ペインに常時全表示する。
 * ナビゲーションスタックとパンくずリストによりドリルダウンをサポートする。
 * 各テーブルは EditorTable として表示し、セル編集が可能。
 *
 * EditorTableへの接続は connectEditorTable()/disconnectEditorTable() で動的に管理する。
 * Tab への参照は connectTab() で設定する（Object.assign パターンで相互参照を解決）。
 */
export class RelationsPanel {
    private readonly panelElement: HTMLElement;
    private readonly referenceDataCache: ReferenceDataCache;
    private readonly store: InMemoryTableStore;
    /** パネルの親要素。appendTo() で設定する。リサイズハンドルのドラッグ計算に使用 */
    private parentElement: HTMLElement | false;
    /** 現在接続中のEditorTable。未接続時はfalse */
    private currentEditorTable: EditorTable | false;
    /** ナビゲーションスタック。空の場合はプレースホルダーを表示 */
    private navStack: NavFrame[];
    /** 非同期レースコンディション防止用リクエストID */
    private currentRequestId: number;
    /**
     * ミニEditorTableの生成に使用するTab。
     * Tab コンストラクタ末尾の connectTab() で必ず設定される。
     * appendTo()/connectEditorTable() より前に connectTab() が呼ばれる保証はないため
     * false 初期値を持つが、renderAsync() が呼ばれる時点では必ず設定済みである。
     */
    private tab: Tab | false;
    /** 現在表示中のミニEditorTableインスタンス一覧（再描画前に破棄する） */
    private miniEditorTables: EditorTable[];

    constructor(referenceDataCache: ReferenceDataCache, store: InMemoryTableStore) {
        this.referenceDataCache = referenceDataCache;
        this.store = store;
        this.parentElement = false;
        this.currentEditorTable = false;
        this.navStack = [];
        this.currentRequestId = 0;
        this.tab = false;
        this.miniEditorTables = [];

        const panel = document.createElement('div');
        panel.classList.add('relations-panel');
        this.panelElement = panel;

        // リサイズハンドルをパネル先頭に配置する
        this.panelElement.prepend(this.buildResizeHandle());

        // 初期状態: プレースホルダーを表示
        this.renderMessage('行を選択してください');
    }

    /**
     * リサイズハンドルを構築する
     * mousedown でドラッグを開始し、document の mousemove/mouseup で幅を更新する
     */
    private buildResizeHandle(): HTMLElement {
        const handle = document.createElement('div');
        handle.classList.add('relations-panel-resize-handle');

        handle.addEventListener('mousedown', (e: MouseEvent) => {
            // SelectionDragController との競合を防ぐ
            e.stopPropagation();
            e.preventDefault();
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';

            const onMouseMove = (moveEvent: MouseEvent) => {
                // appendTo() で保存した親要素を参照する。mousedown はappendTo()後にのみ発生するため必ず存在する
                if (this.parentElement === false) throw new Error('[RelationsPanel] onMouseMove: parentElement が未設定です（appendTo() が呼ばれていません）');
                const parentRight = this.parentElement.getBoundingClientRect().right;
                const newWidth = parentRight - moveEvent.clientX;
                this.panelElement.style.flex = `0 0 ${newWidth}px`;
            };

            const onMouseUp = () => {
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });

        return handle;
    }

    /**
     * 親要素にパネルを追加する
     * リサイズハンドルのドラッグ計算のため親要素を保存する
     */
    appendTo(parent: HTMLElement): void {
        this.parentElement = parent;
        parent.appendChild(this.panelElement);
    }

    /**
     * Tab参照を接続する（Tab コンストラクタ末尾で呼ばれる）
     * ミニEditorTable生成のファクトリとして使用する
     */
    connectTab(tab: Tab): void {
        this.tab = tab;
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
     * 指定されたEditorTableのhandlerをアクティブ化し、他の全handlerをdeactivateする
     * セルクリック時（mousedown）にEditorTableから呼ばれる排他制御メソッド
     *
     * メインEditorTable: currentEditorTable.getHandler()
     * ミニEditorTable: miniEditorTables[i].getHandler()
     * の全handlerを対象として排他制御を行う
     */
    activateHandler(targetEditorTable: EditorTable): void {
        // メインEditorTableのhandlerを制御
        if (this.currentEditorTable !== false && this.currentEditorTable !== targetEditorTable) {
            this.currentEditorTable.getHandler().deactivate();
        }
        // 全ミニEditorTableのhandlerを制御
        for (const miniTable of this.miniEditorTables) {
            if (miniTable !== targetEditorTable) {
                miniTable.getHandler().deactivate();
            }
        }
        // 対象のhandlerをアクティブ化してフォーカスを取得する
        targetEditorTable.getHandler().activate();
    }

    /**
     * EditorTableの接続を解除する（タブが非アクティブになったとき）
     * ミニEditorTableを先に破棄してからrelationsPanelフィールドを解除する。
     * これにより、ミニテーブルがrelationsPanelを参照したまま宙に浮く状態を防ぐ。
     * destroyMiniEditorTables() 内のactivate()はdisconnect時には不要だが、
     * currentEditorTableをfalseにする前に呼ぶことで安全に実行される。
     */
    disconnectEditorTable(): void {
        this.destroyMiniEditorTables();
        if (this.currentEditorTable !== false) {
            this.currentEditorTable.relationsPanel = false;
        }
        this.currentEditorTable = false;
        this.navStack = [];
        // currentEditorTableがfalseなのでdestroyMiniEditorTables()は空操作になる
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
        }];
        await this.renderAsync();
    }

    /**
     * fullDataのrows（PK→行Map）からfkValueに対応する行を全件収集する
     *
     * columnName がPK列と一致する場合はMap.get()で1件ルックアップ（高速）。
     * columnName がPK列と異なる場合（例: shop_product.group_id）は全エントリを走査して
     * 該当列の値がfkValueと一致する行を全件返す（N:1でPK以外を参照している場合に複数件になる）。
     */
    private resolveRowsByFkValue(
        fullData: ReferenceTableFullData,
        columnName: string,
        fkValue: string
    ): string[][] {
        const colIdx = fullData.header.indexOf(columnName);
        const pkIdx = fullData.header.indexOf(config.primaryKeyColumnName);

        // columnName がPK列と一致 → PKルックアップで1件（高速パス）
        if (colIdx !== -1 && colIdx === pkIdx) {
            const row = fullData.rows.get(fkValue);
            return row ? [row] : [];
        }

        // columnName がPK列と異なる → 全エントリを線形走査して複数件収集
        if (colIdx === -1) return [];
        const matched: string[][] = [];
        fullData.rows.forEach(row => {
            if (row[colIdx] === fkValue) matched.push(row);
        });
        return matched;
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

            // columnName がPK列と一致する場合は1件ルックアップ、異なる場合は全件走査
            const rows = this.resolveRowsByFkValue(fullData, expr.columnName, fkValue);

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
        let targetRow: string[] | false = false;
        if (storeHeader !== false && storeRows !== false && pkColInStore !== -1) {
            for (const row of storeRows) {
                if (row[pkColInStore] === pkValue) { targetRow = row; break; }
            }
        }

        // N:1（FK参照先）の解決: スキーマのreference式を使ってFK値を取得
        for (let colIdx = 0; colIdx < headerDefs.length; colIdx++) {
            const col = headerDefs[colIdx];
            if (!col.reference) continue;
            const expr = parseReferenceExpression(col.reference);
            if (!isSimpleReference(expr)) continue;

            // storeから対象行のFK値を取得する
            const colIdxInStore = storeHeader !== false ? storeHeader.indexOf(col.name) : -1;
            const fkValue = (targetRow !== false && colIdxInStore !== -1)
                ? targetRow[colIdxInStore]
                : '';
            if (fkValue === '') continue;

            // referenceDataCacheからFK参照先テーブルのデータを取得する
            const syncData = this.referenceDataCache.getFullDataSync(expr.tableName);
            const fullData = syncData !== false
                ? syncData
                : await this.referenceDataCache.getFullDataAsync(expr.tableName).catch(() => false as const);
            if (fullData === false) continue;

            // columnName がPK列と一致する場合は1件ルックアップ、異なる場合は全件走査
            const rows = this.resolveRowsByFkValue(fullData, expr.columnName, fkValue);

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
        this.destroyMiniEditorTables();
        // リサイズハンドルを除いた全子要素を置き換える
        this.clearContentArea();
        const placeholder = document.createElement('div');
        placeholder.classList.add('relations-panel-placeholder');
        const span = document.createElement('span');
        span.textContent = text;
        placeholder.appendChild(span);
        this.panelElement.appendChild(placeholder);
    }

    /**
     * リサイズハンドルを除いたコンテンツ領域をクリアする
     */
    private clearContentArea(): void {
        const children = Array.from(this.panelElement.children);
        for (const child of children) {
            if (!child.classList.contains('relations-panel-resize-handle')) {
                child.remove();
            }
        }
    }

    /**
     * 現在表示中のミニEditorTableを破棄する
     * buildMiniEditorTableAsync() で設定した editorTable.relationsPanel = this と対称的に
     * relationsPanel = false で接続を解除してから deactivate() する。
     * 破棄後はメインEditorTableのhandlerをアクティブ化してキーボード操作を復元する
     */
    private destroyMiniEditorTables(): void {
        for (const miniTable of this.miniEditorTables) {
            miniTable.relationsPanel = false;
            miniTable.deactivate();
        }
        this.miniEditorTables = [];
        // ミニEditorTableが破棄された後、メインEditorTableが操作権を持つようにする
        if (this.currentEditorTable !== false) {
            this.currentEditorTable.getHandler().activate();
        }
    }

    /**
     * 現在のナビゲーション状態を非同期で描画する
     * 全エントリを縦に並べて常時表示する
     * EditorTable生成が完了してからDOMに追加するため非同期にする
     *
     * await 中に別の updateForRowAsync が割り込んだ場合、requestId の不一致で検出して即リターンする。
     * これにより新旧の DOM 要素が panelElement 上に並存するレースコンディションを防ぐ。
     */
    private async renderAsync(): Promise<void> {
        // 呼び出し元（updateForRowAsync / drillDownAsync）がすでにインクリメント済みのIDを参照する。
        // renderAsync() 自身がインクリメントすると requestId の責務が重複し、
        // 呼び出し元のガードと二重カウントになるため、ここでは現在値を読むだけにする。
        const requestId = this.currentRequestId;

        this.destroyMiniEditorTables();
        this.clearContentArea();

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

        // 全エントリを縦に並べて順次構築する（EditorTable生成を await することで表示タイミングを確定させる）
        for (const entry of currentFrame.entries) {
            const tableSection = document.createElement('div');
            tableSection.classList.add('relations-table-section');

            const tableHeader = document.createElement('div');
            tableHeader.classList.add('relations-table-header');
            const tableTitle = document.createElement('span');
            tableTitle.classList.add('relations-table-title');
            tableTitle.textContent = entry.tableKey;
            const tagEl = this.buildTag(entry.relationType);
            const rowCountEl = document.createElement('span');
            rowCountEl.classList.add('relations-table-row-count');
            rowCountEl.textContent = `${entry.rows.length} rows`;
            tableHeader.appendChild(tableTitle);
            tableHeader.appendChild(tagEl);
            tableHeader.appendChild(rowCountEl);
            tableSection.appendChild(tableHeader);

            const miniTable = await this.buildMiniTableAsync(entry);
            // await 中に新しいリクエストが来ていた場合は描画を中断する
            if (requestId !== this.currentRequestId) return;
            tableSection.appendChild(miniTable);
            content.appendChild(tableSection);
        }

        // 全エントリ構築後も割り込みがなかった場合のみ DOM に追加する
        if (requestId !== this.currentRequestId) return;
        this.panelElement.appendChild(content);
    }

    /**
     * パンくずリストを構築する
     */
    private buildBreadcrumb(): HTMLElement {
        const breadcrumb = document.createElement('div');
        breadcrumb.classList.add('relations-breadcrumb');

        for (let i = 0; i < this.navStack.length; i++) {
            const frame = this.navStack[i];
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
                    // 呼び出し元としての責務: 新しいリクエストを開始する前にIDをインクリメントして
                    // 進行中の updateForRowAsync / drillDownAsync を無効化する
                    ++this.currentRequestId;
                    this.renderAsync().catch(err => {
                        console.error('[RelationsPanel] breadcrumb render 失敗:', err);
                    });
                });
            }
            crumb.textContent = frame.label;
            breadcrumb.appendChild(crumb);
        }

        return breadcrumb;
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
     * ミニテーブルを非同期で構築する
     *
     * renderAsync() から await することで EditorTable 生成完了後に DOM 追加される。
     *
     * DOM 構造:
     *   panelElement（position:relative）← positioningContainer（grid-textfield の絶対配置基準）
     *     wrapper（position:relative; overflow:visible）
     *       scrollContainer（overflow:auto; max-height:200px）
     *         editor-table, selection 等
     *     grid-textfield（position:absolute）← panelElement を基準に配置
     */
    private async buildMiniTableAsync(entry: RelationEntry): Promise<HTMLElement> {
        const wrapper = document.createElement('div');
        wrapper.classList.add('relations-mini-table-wrapper');
        await this.buildMiniEditorTableAsync(wrapper, entry);
        return wrapper;
    }

    /**
     * EntryのスキーマをファイルからロードしてEditorTableを生成する
     *
     * grid-textfield（position:absolute）が overflow:auto のコンテナにクリッピングされるのを防ぐため、
     * wrapper（overflow:visible）と scrollContainer（overflow:auto）を分離して渡す。
     * grid-textfield は panelElement（.relations-panel、position:relative）の直接の子として配置する。
     */
    private async buildMiniEditorTableAsync(wrapper: HTMLElement, entry: RelationEntry): Promise<void> {
        const schemaText = await readFileAsync(`schema/${entry.tableKey}.json`);
        const schemaJson: Record<string, unknown> = JSON.parse(schemaText);

        // スクロール領域は wrapper の内側に作る（overflow:auto はここに閉じ込める）
        const scrollContainer = document.createElement('div');
        scrollContainer.classList.add('relations-mini-table-scroll');
        wrapper.appendChild(scrollContainer);

        // connectTab() は Tab コンストラクタ末尾で必ず呼ばれる。
        // renderAsync() は connectEditorTable() 経由でしか呼ばれないため tab は必ず設定済み。
        if (this.tab === false) throw new Error('[RelationsPanel] buildMiniEditorTableAsync: tab が未接続です');

        // scrollContainer: editor-table / selection を配置する overflow:auto のスクロール領域
        // panelElement: grid-textfield の position:absolute 基準（overflow:visible かつ position:relative）
        //   → wrapper（overflow:auto）にすると grid-textfield がクリッピングされるためパネル直下に配置する
        const editorTable = this.tab.createMiniEditorTable(scrollContainer, this.panelElement, entry.tableKey, schemaJson, entry.header, entry.rows);
        // ミニEditorTableにもRelationsPanelを接続して、セルクリック時の排他制御を有効にする
        editorTable.relationsPanel = this;
        this.miniEditorTables.push(editorTable);
        // NOTE: click イベントでドリルダウンを登録しない。
        // click は dblclick の前に2回発火するため drillDownAsync → renderAsync → destroyMiniEditorTables が
        // 呼ばれ、dblclick ハンドラが実行される前にミニEditorTableが破棄されてしまう。
        // ドリルダウン機能は将来的に専用UIで実装する。
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
        });
        await this.renderAsync();
    }
}
