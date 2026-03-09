import {EditorTable} from "./editor-table";
import {ReferenceDataCache, ReferenceTableFullData} from "./reference-data-cache";
import {InMemoryTableStore} from "./in-memory-table-store";
import {parseReferenceExpression, isSimpleReference} from "./reference-expression";
import {config} from "./config";
import {readFileAsync} from "./api";
import {Tab} from "./tab";
import {FillController} from "./fill-controller";
import {AreaResizer} from "./area-resizer";
import {History} from "./history";

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
    /** 1:Nの場合: 親テーブルのFK列名（子テーブル側の列名）。N:1の場合は空文字列 */
    fkColumnName: string;
    /** 1:Nの場合: 親テーブルのFK値（自動埋め込みする値）。N:1の場合は空文字列 */
    fkValue: string;
    /**
     * rows[i] がストアの何行目に対応するかのインデックス配列（0始まり）
     * 1:Nフィルタリング時に記録し、ミニEditorTableの storeRowIndices として渡す。
     * N:1はストアの全行を表示するため空配列（通常テーブルと同様 [0,1,...,n-1] として初期化される）。
     */
    storeRowIndices: number[];
}

/**
 * リレーションパネル
 *
 * 選択行の参照先（N:1）と参照元（1:N）を右ペインに常時全表示する。
 * 各テーブルは編集可能なミニEditorTableとして表示する。
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
    /** 現在表示中のリレーションエントリ一覧。空の場合はプレースホルダーを表示 */
    private currentEntries: RelationEntry[];
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
    /** 現在表示中のミニEditorTableに対応するFillControllerの一覧（破棄時にdeactivateする） */
    private miniFillControllers: FillController[];
    /** 現在表示中のミニEditorTableに対応するAreaResizerの一覧（破棄時にdeactivateする） */
    private miniAreaResizers: AreaResizer[];
    /** 現在表示中のミニEditorTableに対応するHistoryの一覧（破棄時にunregisterする） */
    private miniHistories: History[];
    /** 現在表示中のミニEditorTableのテーブル名一覧（破棄時にstoreのunregisterTableを呼ぶ） */
    private miniTableNames: string[];

    constructor(referenceDataCache: ReferenceDataCache, store: InMemoryTableStore) {
        this.referenceDataCache = referenceDataCache;
        this.store = store;
        this.parentElement = false;
        this.currentEditorTable = false;
        this.currentEntries = [];
        this.currentRequestId = 0;
        this.tab = false;
        this.miniEditorTables = [];
        this.miniFillControllers = [];
        this.miniAreaResizers = [];
        this.miniHistories = [];
        this.miniTableNames = [];

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
        this.currentEntries = [];
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

        // フォーカスインジケータ: 全 .relations-table-header から --active を除去し、
        // 対象がミニEditorTableならそのヘッダーに --active を付与する
        const headers = Array.from(this.panelElement.querySelectorAll('.relations-table-header'));
        for (const header of headers) {
            header.classList.remove('relations-table-header--active');
        }
        const targetIdx = this.miniEditorTables.indexOf(targetEditorTable);
        if (targetIdx !== -1 && targetIdx < headers.length) {
            headers[targetIdx].classList.add('relations-table-header--active');
        }
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
        this.currentEntries = [];
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
            this.currentEntries = [];
            this.renderMessage('参照なし');
            return;
        }
        this.currentEntries = entries;
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
                fkColumnName: '',
                fkValue: '',
                // N:1はストア全行を表示するため storeRowIndices は不要。
                // ミニEditorTable の initialize() 時に通常テーブルとして [0,1,...] に初期化される。
                storeRowIndices: [],
            });
        }

        // 1:N（逆参照）の解決
        // 逆参照マップのキーは「参照先列の値」であり、PK値とは限らない。
        // 例: shop.shop_product_group_id が shop_product.group_id を参照している場合、
        //     マップのキーは group_id の値であるため、pkValue ではなく group_id の値でルックアップする必要がある。
        // getAllParentColumnNames() で逆参照マップに使われている全列名を取得し、
        // 各列名に対応する行の値でルックアップすることで非PK列参照にも対応する。
        const parentColumnNames = editorTable.getAllParentColumnNames();
        for (const parentColumnName of parentColumnNames) {
            const columnValue = editorTable.getCellValueByColumnName(rowIndex, parentColumnName);
            if (columnValue === '') continue;
            const reverseEntriesForColumn = editorTable.getReverseReferenceEntries(columnValue);
            for (const reverseEntry of reverseEntriesForColumn) {
                // このエントリが現在の parentColumnName に対応するものか確認する
                // （同一値でキーが衝突している別 parentColumnName のエントリを誤って取り込まない）
                if (reverseEntry.parentColumnName !== parentColumnName) continue;

                // タブ未オープンのテーブルはストアに存在しないため、キャッシュ経由でデータを取得する
                const storeHeader = this.store.getHeader(reverseEntry.childTableName);
                const storeRows = this.store.getRows(reverseEntry.childTableName);
                let header: string[];
                let allRows: string[][];
                if (storeHeader !== false && storeRows !== false) {
                    header = storeHeader;
                    allRows = storeRows;
                } else {
                    const syncData = this.referenceDataCache.getFullDataSync(reverseEntry.childTableName);
                    const fullData = syncData !== false
                        ? syncData
                        : await this.referenceDataCache.getFullDataAsync(reverseEntry.childTableName).catch(() => false as const);
                    if (fullData === false) continue;
                    header = fullData.header;
                    allRows = Array.from(fullData.rows.values());
                }

                // reverseEntry.rows は ReverseReferenceRow[]（子テーブルのPK値一覧）なので
                // 子テーブルのPKで行データをフィルタリングする。
                // 同時に filteredRows[i] がストアの何行目かのインデックスを記録する。
                // PK重複時でも正しいストア行を更新できるよう storeRowIndices をミニEditorTableに渡す。
                const pkColIdx = header.indexOf(config.primaryKeyColumnName);
                let filteredRows: string[][];
                let filteredStoreRowIndices: number[];
                if (pkColIdx !== -1) {
                    const pkSet = new Set(reverseEntry.rows.map(r => r.pkValue));
                    const filteredWithIndices = allRows
                        .map((r, i) => ({ row: r, storeIndex: i }))
                        .filter(({ row }) => pkSet.has(row[pkColIdx]));
                    filteredRows = filteredWithIndices.map(({ row }) => row);
                    filteredStoreRowIndices = filteredWithIndices.map(({ storeIndex }) => storeIndex);
                } else {
                    filteredRows = [];
                    filteredStoreRowIndices = [];
                }

                const fkColName = reverseEntry.childColumnName;

                entries.push({
                    label: reverseEntry.childTableName,
                    relationType: '1:N',
                    tableKey: reverseEntry.childTableName,
                    header,
                    rows: filteredRows,
                    fkColumnName: fkColName,
                    // fkValue: 逆参照マップのキー（= 参照先列の実際の値）を使う
                    // PK列参照なら pkValue と同じだが、非PK列参照では異なる
                    fkValue: columnValue,
                    storeRowIndices: filteredStoreRowIndices,
                });
            }
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
     * 現在表示中のミニEditorTableとFillControllerを破棄する
     * buildMiniEditorTableAsync() で設定した editorTable.relationsPanel = this と対称的に
     * relationsPanel = false で接続を解除してから deactivate() する。
     * FillControllerのグローバルmouseupリスナーも解除する。
     * 破棄後はメインEditorTableのhandlerをアクティブ化してキーボード操作を復元する
     */
    private destroyMiniEditorTables(): void {
        for (const miniTable of this.miniEditorTables) {
            miniTable.relationsPanel = false;
            miniTable.deactivate();
        }
        this.miniEditorTables = [];
        for (const fillController of this.miniFillControllers) {
            fillController.deactivate();
        }
        this.miniFillControllers = [];
        for (const areaResizer of this.miniAreaResizers) {
            areaResizer.deactivate();
        }
        this.miniAreaResizers = [];
        // ミニテーブルのストア参照カウントを減らす（registerTableAsync と対称的な解除）
        // unregisterTable は isTableDirty() で Dirty 判定するため、
        // History が登録されている状態で呼ぶ必要がある。
        // そのため history.unregister() より先に unregisterTable を呼ぶ。
        for (const tableName of this.miniTableNames) {
            this.store.unregisterTable(tableName);
        }
        this.miniTableNames = [];
        // ミニテーブルの Dirty レジストリ登録解除（Store から History を除去する）
        for (const history of this.miniHistories) {
            history.unregister();
        }
        this.miniHistories = [];
        // ミニEditorTableが破棄された後、メインEditorTableが操作権を持つようにする
        if (this.currentEditorTable !== false) {
            this.currentEditorTable.getHandler().activate();
        }
    }

    /**
     * currentEntries を非同期で描画する
     * 全エントリを縦に並べて常時表示する
     * EditorTable生成が完了してからDOMに追加するため非同期にする
     *
     * await 中に別の updateForRowAsync が割り込んだ場合、requestId の不一致で検出して即リターンする。
     * これにより新旧の DOM 要素が panelElement 上に並存するレースコンディションを防ぐ。
     */
    private async renderAsync(): Promise<void> {
        // 呼び出し元（updateForRowAsync）がすでにインクリメント済みのIDを参照する。
        // renderAsync() 自身がインクリメントすると requestId の責務が重複し、
        // 呼び出し元のガードと二重カウントになるため、ここでは現在値を読むだけにする。
        const requestId = this.currentRequestId;

        this.destroyMiniEditorTables();
        this.clearContentArea();

        if (this.currentEntries.length === 0) {
            this.renderMessage('行を選択してください');
            return;
        }

        const content = document.createElement('div');
        content.classList.add('relations-panel-content');

        // RELATIONS セクションヘッダー
        const sectionHeader = document.createElement('div');
        sectionHeader.classList.add('relations-panel-section-header');
        sectionHeader.textContent = 'RELATIONS';
        content.appendChild(sectionHeader);

        // 全エントリを縦に並べて順次構築する（EditorTable生成を await することで表示タイミングを確定させる）
        for (const entry of this.currentEntries) {
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
            // Dirtyマーク要素（初期はストアのDirty状態に合わせる）
            const dirtyMark = document.createElement('span');
            dirtyMark.classList.add('relations-table-dirty');
            dirtyMark.textContent = '●';
            if (this.store.isTableDirty(entry.tableKey)) {
                dirtyMark.classList.add('relations-table-dirty-visible');
            }
            tableHeader.appendChild(tableTitle);
            tableHeader.appendChild(dirtyMark);
            tableHeader.appendChild(tagEl);
            // 1:Nエントリの場合はFK条件コンテキスト（例: enemy_id=3）を表示する
            if (entry.relationType === '1:N' && entry.fkColumnName !== '') {
                const contextEl = document.createElement('span');
                contextEl.classList.add('relations-table-context');
                contextEl.textContent = `${entry.fkColumnName}=${entry.fkValue}`;
                tableHeader.appendChild(contextEl);
            }
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
     * 左ペインと同じスクロール追従動作にするため、grid-textfield / grid-dropdown の
     * positioningContainer は scrollContainer（overflow:auto, position:relative）にする。
     * 左ペインでは .editor-left-pane が overflow:auto かつ position:relative で
     * テーブルとテキストフィールドの両方を内包し、スクロールに追従する。
     * 右ペインでも同じ構造にするため scrollContainer を positioningContainer として渡す。
     *
     * すべての列（FK列・PK列を含む）をそのまま表示する。列の物理除去もCSS非表示も行わない。
     */
    private async buildMiniEditorTableAsync(wrapper: HTMLElement, entry: RelationEntry): Promise<void> {
        const schemaText = await readFileAsync(`schema/${entry.tableKey}.json`);
        const schemaJson: Record<string, unknown> = JSON.parse(schemaText);

        // 左ペインと同じDOM構造:
        //   scrollContainer（overflow:auto）→ innerWrapper（通常フロー）→ EditorTable + テキストフィールド + ドロップダウン
        // 左ペインでは .editor-left-pane（overflow:auto）→ .tab-wrapper（通常フロー）→ 全要素
        // innerWrapper.getBoundingClientRect() がスクロール量を反映するため座標計算が正しくなり、
        // テキストフィールドはスクロールに追従しつつ scrollContainer の overflow にクリッピングされない
        const scrollContainer = document.createElement('div');
        scrollContainer.classList.add('relations-mini-table-scroll');
        wrapper.appendChild(scrollContainer);

        const innerWrapper = document.createElement('div');
        scrollContainer.appendChild(innerWrapper);

        // connectTab() は Tab コンストラクタ末尾で必ず呼ばれる。
        // renderAsync() は connectEditorTable() 経由でしか呼ばれないため tab は必ず設定済み。
        if (this.tab === false) throw new Error('[RelationsPanel] buildMiniEditorTableAsync: tab が未接続です');

        // N:1参照テーブルはタブで開かれていない場合ストアに未登録のため、ここで登録する。
        // タブ開放済みの場合は参照カウントのみインクリメントされ、データは保持される。
        // destroyMiniEditorTables() で対称的に unregisterTable() を呼んで参照カウントを戻す。
        await this.store.registerTableAsync(entry.tableKey);
        this.miniTableNames.push(entry.tableKey);

        // scrollContainer: スクロール担当（overflow:auto）
        // innerWrapper: EditorTable・テキストフィールドの配置先（通常フロー、座標基準）
        // wrapper: ドロップダウンの配置先（overflow:visible、クリッピング回避）
        const {editorTable, fillController, areaResizer, history} = this.tab.createMiniEditorTable(
            scrollContainer, innerWrapper, wrapper, entry.tableKey, schemaJson, entry.header, entry.rows
        );
        // 全ミニテーブルは initialize() で storeRowIndices = [0, 1, ...] に初期化される。
        // 1:Nの場合のみ filteredStoreRowIndices で上書きする（フィルタリングされた行のストアインデックス）。
        // N:1はストア全行をそのまま表示するため initialize() の初期値で正しい。
        if (entry.relationType === '1:N') {
            editorTable.setStoreRowIndices(entry.storeRowIndices);
        }
        // 1:NエントリのFK自動埋め込み情報を設定する（行追加時にFK列が自動入力される）
        if (entry.fkColumnName !== '' && entry.fkValue !== '') {
            editorTable.setAutoFillEntries([{ columnName: entry.fkColumnName, value: entry.fkValue }]);
        }
        // ミニEditorTableにもRelationsPanelを接続して、セルクリック時の排他制御を有効にする
        editorTable.relationsPanel = this;
        this.miniEditorTables.push(editorTable);
        this.miniFillControllers.push(fillController);
        this.miniAreaResizers.push(areaResizer);
        // HistoryをminiHistoriesに追加して破棄時にunregister()できるようにする
        this.miniHistories.push(history);
    }

    /**
     * ミニEditorTableのセル編集後に左ペインの参照ヒントを再描画する
     * ミニテーブルの変更によって左ペインのFK参照ヒントが古くなるため更新する。
     * forceRefreshRelationsPanel() はパネル全体を再構築して編集中のミニEditorTable自身を
     * 破棄してしまうため、代わりにこのメソッドで参照ヒントのみ更新する。
     */
    notifyMiniTableCellChanged(): void {
        if (this.currentEditorTable === false) return;
        this.currentEditorTable.updateReferenceHints();
    }

    /**
     * 指定テーブル名に対応するDirtyマーク要素を更新する
     * History.notifyChange() からストア経由で呼ばれる。
     * panelElement内の全 .relations-table-section を走査して、
     * .relations-table-title が tableName に一致するセクションのDirtyマークを更新する。
     */
    updateDirtyMark(tableName: string, isDirty: boolean): void {
        const sections = Array.from(this.panelElement.querySelectorAll('.relations-table-section'));
        for (const section of sections) {
            const titleEl = section.querySelector('.relations-table-title');
            if (!titleEl || titleEl.textContent !== tableName) continue;
            const dirtyMarkEl = section.querySelector('.relations-table-dirty');
            if (!dirtyMarkEl) continue;
            if (isDirty) {
                dirtyMarkEl.classList.add('relations-table-dirty-visible');
            } else {
                dirtyMarkEl.classList.remove('relations-table-dirty-visible');
            }
        }
    }

    /**
     * 定義へジャンプ: 参照先テーブルの該当行に左ペインのタブで遷移する
     * EditorTable.navigateToDefinition() から呼ばれる（ミニテーブル専用）。
     */
    navigateToDefinition(tableName: string, pkValue: string): void {
        if (this.tab === false) throw new Error('[RelationsPanel] navigateToDefinition: tab が未接続です');
        this.tab.navigateToTableRow(tableName, pkValue);
    }

}
