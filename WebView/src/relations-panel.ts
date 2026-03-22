import {EditorTable} from "./editor-table";
import {InMemoryTableStore} from "./in-memory-table-store";
import {extractFirstPrimaryKeyColumn} from "./schema-utils";
import {parseReferenceExpression, isSimpleReference, isDynamicReference, DynamicReference} from "./reference-expression";
import {readFileAsync} from "./api";
import {Csv} from "./csv";
import {Tab} from "./tab";
import {FillController} from "./fill-controller";
import {AreaResizer} from "./area-resizer";
import {History} from "./history";
import {ReverseReferenceResolver, ReverseReferenceRow} from "./reverse-reference-resolver";
import {ResizeHandle} from "./resize-handle";
import {NotificationToast} from "./notification";
import {Editor} from "./editor";

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
    /** FK列名。N:1の場合は参照元テーブルのFK列名、1:Nの場合は子テーブルのFK列名 */
    fkColumnName: string;
    /** FK値。N:1の場合は参照元行のFK値、1:Nの場合は親テーブルのFK値（自動埋め込みする値） */
    fkValue: string;
    /**
     * rows[i] がストアの何行目に対応するかのインデックス配列（0始まり）
     * N:1・1:N ともにフィルタリング時に記録し、ミニEditorTableの storeRowIndices として渡す。
     * N:1は参照先テーブルのFK一致行のみ表示するためデフォルト [0,1,...] とは一致しない場合がある。
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
    private readonly store: InMemoryTableStore;
    private readonly notification: NotificationToast;
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
    /** showForTableRowAsync() で登録したベーステーブル名。ペインスタック破棄時に unregisterTable するため記録する */
    private baseTableName: string | false;
    /**
     * Editor への参照。閉じるボタンクリック時にトグルメソッドを呼ぶために使用する。
     * connectEditor() で設定される。appendTo() より後に呼ばれるため false 初期値を持つ。
     */
    private editor: Editor | false;

    constructor(store: InMemoryTableStore, notification: NotificationToast) {
        this.store = store;
        this.notification = notification;
        this.currentEditorTable = false;
        this.currentEntries = [];
        this.currentRequestId = 0;
        this.tab = false;
        this.miniEditorTables = [];
        this.miniFillControllers = [];
        this.miniAreaResizers = [];
        this.miniHistories = [];
        this.miniTableNames = [];
        this.baseTableName = false;
        this.editor = false;

        const panel = document.createElement('div');
        panel.classList.add('relations-panel');
        this.panelElement = panel;

        // リサイズハンドルをパネル先頭に配置する
        // delta が正（右移動）= ハンドルを右に動かす = 右ペイン幅縮小なので currentWidth - delta で縮小する
        const resizeHandle = new ResizeHandle('horizontal', (delta: number): number => {
            // panelElement の親要素（rightSlot）をDOMから取得する。
            // appendTo() 経由でも setVisiblePanes() 経由でも rightSlot に追加されるため、
            // appendTo() が呼ばれていないペインスタック上のRPでも正しく動作する。
            const parent = this.panelElement.parentElement;
            if (parent === null) throw new Error('[RelationsPanel] resizeHandle: panelElement が DOM に追加されていません');
            // parent（rightSlot）の親要素（contentArea）の右端を基準にクランプ幅を算出する
            const grandParent = parent.parentElement;
            if (grandParent === null) throw new Error('[RelationsPanel] resizeHandle: panelElement の祖父要素が存在しません');
            const grandParentWidth = grandParent.getBoundingClientRect().width;
            if (grandParentWidth === 0) return 0;
            // panelElement ではなく parent（rightSlot）の幅を基準にする。
            // panelElement は border-left を持つため getBoundingClientRect() が parent.width と
            // 微妙に異なり、取得対象と設定対象の不一致で倍速ドラッグになる。
            const currentWidth = parent.getBoundingClientRect().width;
            const minWidth = grandParentWidth * 0.1;
            const maxWidth = grandParentWidth * 0.9;
            const newWidth = Math.max(minWidth, Math.min(maxWidth, currentWidth - delta));
            // パーセンテージで設定する（ウィンドウリサイズ時に左右ペイン比率を維持するため）。
            // 丸めは行わない — ブラウザのCSS解釈に高精度の値を直接渡すことで蓄積誤差を防ぐ。
            const percentage = (newWidth / grandParentWidth) * 100;
            parent.style.flexGrow = '0';
            parent.style.flexShrink = '0';
            parent.style.flexBasis = `${percentage}%`;
            // 実際に変化した量を返す。ハンドル右移動(delta正)で幅縮小のため正の値になる。
            return currentWidth - newWidth;
        });
        resizeHandle.prependTo(this.panelElement);

        // 固定ヘッダー: RELATIONS ラベルと「«」閉じるボタンをコンテンツの表示状態に関わらず常に表示する。
        // renderAsync() / renderMessage() による clearContentArea() で削除されないよう
        // relations-panel-fixed-header クラスで保護する。
        const fixedHeader = document.createElement('div');
        fixedHeader.classList.add('relations-panel-section-header', 'relations-panel-fixed-header');
        const sectionLabel = document.createElement('span');
        sectionLabel.textContent = 'RELATIONS';
        fixedHeader.appendChild(sectionLabel);
        const closeButton = document.createElement('button');
        closeButton.classList.add('relations-panel-close-button');
        closeButton.textContent = '«';
        closeButton.setAttribute('aria-label', 'RelationsPanelを閉じる');
        closeButton.addEventListener('click', () => {
            if (this.editor !== false) this.editor.hideRelationsPanel();
        });
        fixedHeader.appendChild(closeButton);
        this.panelElement.appendChild(fixedHeader);

        // 初期状態: プレースホルダーを表示
        this.renderMessage('行を選択してください');
    }

    /**
     * 親要素にパネルを追加する
     * 通常のRelationsPanelはここで親要素に追加する。
     * ペインスタック上のRPはsetVisiblePanes()で直接parentElement.appendChildされるため呼ばれない。
     * リサイズハンドルはpanelElement.parentElementからDOMを辿るため、どちらでも正しく動作する。
     */
    appendTo(parent: HTMLElement): void {
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
     * Editor参照を接続する（Tab コンストラクタおよび pushRelationsPanel で呼ばれる）
     * 閉じるボタンクリック時にEditor.hideRelationsPanel()を呼ぶために使用する。
     */
    connectEditor(editor: Editor): void {
        this.editor = editor;
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
        // メインEditorTableのhandlerを制御し、視覚状態を非アクティブに更新する
        if (this.currentEditorTable !== false && this.currentEditorTable !== targetEditorTable) {
            this.currentEditorTable.getHandler().deactivate();
            this.currentEditorTable.setInactiveAppearance(true);
        }
        // 全ミニEditorTableのhandlerを制御し、視覚状態を非アクティブに更新する
        for (const miniTable of this.miniEditorTables) {
            if (miniTable !== targetEditorTable) {
                miniTable.getHandler().deactivate();
                miniTable.setInactiveAppearance(true);
            }
        }
        // 対象のhandlerをアクティブ化し、視覚状態をアクティブに更新する
        targetEditorTable.getHandler().activate();
        targetEditorTable.setInactiveAppearance(false);

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
        // currentRequestId をインクリメントして、進行中の showForTableRowAsync / renderAsync を無効化する。
        // これにより既存の requestId !== this.currentRequestId ガードが破棄後の描画を防止する。
        this.currentRequestId++;
        this.destroyMiniEditorTables();
        if (this.currentEditorTable !== false) {
            this.currentEditorTable.relationsPanel = false;
        }
        this.currentEditorTable = false;
        this.currentEntries = [];
        // showForTableRowAsync で登録したベーステーブルを解除する（ペインスタックRP用）
        // destroyMiniEditorTables() がミニテーブル分の unregister を先に行った後にベーステーブルを解除する
        if (this.baseTableName !== false) {
            this.store.unregisterTable(this.baseTableName);
            this.baseTableName = false;
        }
        this.renderMessage('行を選択してください');
    }

    /**
     * 追加RP（ペインスタック上のRP）をタブ非アクティブ時に一時停止する。
     * disconnectEditorTable() と異なり、ミニEditorTable群・currentEntries・baseTableName を保持する。
     * currentRequestId をインクリメントして進行中の非同期処理を無効化し、
     * 全ミニEditorTable / FillController / AreaResizer のグローバルリスナーを解除する。
     * resume() で対称的に再登録される。DOM構造・ストアデータ・History は保持する。
     */
    suspend(): void {
        this.currentRequestId++;
        // グローバルイベントリスナー（window mousemove/mouseup 等）を解除する。
        // タブ切替のたびにリスナーが蓄積して非表示DOMに対するイベント処理が走り続けるのを防ぐ。
        this.deactivateMiniEditorTables();
    }

    /**
     * 全ミニEditorTable / FillController / AreaResizer のグローバルリスナーを解除する。
     * suspend()（タブ非アクティブ時）と destroyMiniEditorTables()（破棄時）の両方で
     * 同一の deactivate ループが必要なため共通メソッドとして抽出する。
     */
    private deactivateMiniEditorTables(): void {
        for (const miniTable of this.miniEditorTables) {
            miniTable.deactivate();
        }
        for (const fillController of this.miniFillControllers) {
            fillController.deactivate();
        }
        for (const areaResizer of this.miniAreaResizers) {
            areaResizer.deactivate();
        }
    }

    /**
     * 追加RP（ペインスタック上のRP）をタブ復帰時に再開する。
     * suspend() で解除したグローバルリスナーを再登録する。
     * DOM構造・ストアデータ・currentEntries は保持されたままであるため、再描画は不要。
     *
     * 視覚状態の初期化: メインテーブルをアクティブ色、全ミニテーブルを非アクティブ色に戻す。
     * activate() から CSS クラス操作を分離したため、ここで明示的に setInactiveAppearance() を呼ぶ必要がある。
     * タブ切り替え前の最後の操作がミニテーブルだった場合、メインテーブルが灰色のまま残るのを防ぐ。
     */
    resume(): void {
        // メインテーブルの視覚状態をアクティブに復元する（初期状態：メインテーブルがフォーカス権を持つ）
        if (this.currentEditorTable !== false) {
            this.currentEditorTable.setInactiveAppearance(false);
        }
        for (const miniTable of this.miniEditorTables) {
            miniTable.activate();
            // ミニテーブルは初期状態として非アクティブ色にする
            miniTable.setInactiveAppearance(true);
        }
        for (const fillController of this.miniFillControllers) {
            fillController.activate();
        }
        for (const areaResizer of this.miniAreaResizers) {
            areaResizer.activate();
        }
    }

    /**
     * 選択行が変わったときに呼ばれる（editor-table.ts の notifyRowSelectionChanged 経由）。
     * 定義ジャンプで深化したペインスタックをルートにリセットしてから refreshCurrentRow() に委譲する。
     */
    updateForRow(rowIndex: number): void {
        if (this.tab === false) throw new Error('[RelationsPanel] updateForRow: tab が未接続の状態で呼ばれました');
        this.tab.resetPaneStackToRoot();
        this.refreshCurrentRow(rowIndex);
    }

    /**
     * 同一行のセル値変更後に呼ばれる（editor-table.ts の forceRefreshRelationsPanel 経由）。
     * paneStack はリセットせず関連データのみ再表示する。
     * 行を変更しない操作（セル編集後の同一行リフレッシュ）からのみ呼ぶこと。
     */
    refreshCurrentRow(rowIndex: number): void {
        if (this.currentEditorTable === false) return;
        this.updateForRowAsync(rowIndex, this.currentEditorTable).catch(err => {
            console.error('[RelationsPanel] refreshCurrentRow 失敗:', err);
            this.notification.show('関連パネルの更新に失敗しました');
        });
    }

    /**
     * 選択行の関連データを非同期で解決して表示する
     * requestId によるレースコンディション防止: 最新リクエスト以外は描画しない
     */
    private async updateForRowAsync(rowIndex: number, editorTable: EditorTable): Promise<void> {
        const requestId = ++this.currentRequestId;
        const entries = await this.resolveEntriesForEditorRowAsync(rowIndex, editorTable, requestId);
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
     * 指定テーブルのヘッダーと全行をストア優先・CSV直読みで取得する
     *
     * ストアに登録済みの場合は常に最新データを優先使用する。
     * タブ未オープンのテーブルはストアに存在しないため、その場合のみCSVファイルから直接読み込む。
     *
     * CSVパスが返す行データとストアの行順序は一致する。
     * ストア未登録テーブルはCSVのbodyをそのまま行配列として返すが、
     * 後続の buildMiniEditorTableAsync 内で registerTableAsync が呼ばれる際も同じCSVを読み込むため
     * storeRowIndices（filterRowsByReverseEntry が計算したインデックス）とストアの行順序は整合する。
     *
     * ファイルが存在しない場合は異常系（スキーマと実データの不整合）として例外を伝播させる。
     */
    private async resolveTableDataAsync(tableName: string): Promise<{ header: string[]; rows: string[][] }> {
        // ストアに登録済みの場合はストアから取得する。
        // ストアの rows は string[][] でPK重複行を含む全行を保持しているため正確。
        const storeHeader = this.store.getHeader(tableName);
        const storeRows = this.store.getRows(tableName);
        if (storeHeader !== false && storeRows !== false) {
            return { header: storeHeader, rows: storeRows };
        }
        // ストア未登録の場合はCSVファイルから直接読み込む。
        // referenceDataCache.rows は Map<pkValue, row> 形式のためPK重複行が上書きされて消える。
        // 1:Nフィルタリングには全行が必要なため、CSVのbodyをそのまま使う。
        const csvText = await readFileAsync(`data/${tableName}.csv`);
        const csv = new Csv();
        csv.load(csvText);
        return { header: csv.header, rows: csv.body };
    }

    /**
     * 動的参照を解決してRelationEntryを生成する
     *
     * EditorTableに依存せず、行データ（targetRow）とヘッダー名配列（rowHeader）から直接解決する。
     * EditorTable版（resolveEntriesForEditorRowAsync）とペインスタック版（resolveEntriesForTableRowAsync）
     * の両方から呼び出せるよう、共通インターフェースとして定義する。
     *
     * 解決ステップ:
     *   1. targetRow から expr.filter.valueColumn の値を取得（例: reward_table_id の値 "1"）
     *   2. フィルタテーブル（expr.filter.tableName）から expr.filter.filterColumn == 手順1の値 の行を線形検索
     *   3. その行の expr.lookupColumn の値を取得（= 最終テーブル名、例: "chara"）
     *   4. targetRow からこの列自身の値（= 最終テーブルの targetColumn で絞り込むFK値）を取得する
     *   5. 最終テーブルのデータを取得し、expr.targetColumn == fkValue の行を絞り込む
     *   6. RelationEntry として返す
     *
     * 解決できない場合（列が存在しない、値が空、テーブルが取得できない等）は null を返す。
     */
    private async resolveDynamicReferenceEntryAsync(
        expr: DynamicReference,
        columnLabel: string,
        targetRow: string[],
        rowHeader: string[],
        requestId: number,
    ): Promise<RelationEntry | null> {
        // 手順1: 同一行から動的解決の基準値となる列値を取得する（例: reward_table_id の値）
        const valueColIdx = rowHeader.indexOf(expr.filter.valueColumn);
        if (valueColIdx === -1) return null;
        const valueColumnValue = targetRow[valueColIdx];
        if (valueColumnValue === '') return null;

        // 手順2: フィルタテーブルのデータを取得して filterColumn == valueColumnValue の行を線形検索する
        const filterTableData = await this.resolveTableDataAsync(expr.filter.tableName);
        // await 後に別リクエストが割り込んでいないか確認する
        if (requestId !== this.currentRequestId) return null;
        const filterColIdx = filterTableData.header.indexOf(expr.filter.filterColumn);
        if (filterColIdx === -1) return null;
        const filterRowIdx = filterTableData.rows.findIndex(row => row[filterColIdx] === valueColumnValue);
        if (filterRowIdx === -1) return null;
        const filterRow = filterTableData.rows[filterRowIdx];

        // 手順3: フィルタ結果の行から lookupColumn の値を取得する（= 最終テーブル名）
        const lookupColIdx = filterTableData.header.indexOf(expr.lookupColumn);
        if (lookupColIdx === -1) return null;
        const targetTableName = filterRow[lookupColIdx];
        if (targetTableName === '') return null;

        // 手順4: 同一行からこの列自身の値（= 最終テーブルの targetColumn で絞り込むFK値）を取得する
        const fkColIdx = rowHeader.indexOf(columnLabel);
        if (fkColIdx === -1) return null;
        const fkValue = targetRow[fkColIdx];
        if (fkValue === '') return null;

        // 手順5: 最終テーブルのデータを取得して targetColumn == fkValue の行に絞り込む
        const targetTableData = await this.resolveTableDataAsync(targetTableName);
        // await 後に別リクエストが割り込んでいないか確認する
        if (requestId !== this.currentRequestId) return null;
        const targetColIdx = targetTableData.header.indexOf(expr.targetColumn);
        if (targetColIdx === -1) return null;

        // FK列値でフィルタし、実際のストアインデックスも収集する
        const { filteredRows: rows, filteredStoreRowIndices: storeRowIndices } =
            this.filterRowsByColumn(targetTableData.rows, targetTableData.header, expr.targetColumn, fkValue);

        return {
            label: columnLabel,
            relationType: 'N:1',
            tableKey: targetTableName,
            header: targetTableData.header,
            rows,
            fkColumnName: columnLabel,
            fkValue,
            storeRowIndices,
        };
    }

    /**
     * EditorTableの指定行からリレーションエントリを非同期で解決する
     *
     * requestId を受け取り、各 await 後にレースコンディションを検出した場合は空配列を返す。
     * 呼び出し元の updateForRowAsync が await 後に改めて requestId チェックを行うため、
     * ここで空配列を返しても二重チェックにはならない（呼び出し元が最終判断する）。
     */
    private async resolveEntriesForEditorRowAsync(rowIndex: number, editorTable: EditorTable, requestId: number): Promise<RelationEntry[]> {
        const entries: RelationEntry[] = [];
        const tableData = editorTable.getTableData();

        // resolveDynamicReferenceEntryAsync に渡すための行データ配列を構築する。
        // EditorTable の DOM 上の最新値（ストアより新しい可能性がある）を列名配列と対応付けて保持する。
        // DOMの列は1始まり（行ヘッダーが0列目）なのでcolIdx+1でアクセスする。
        const rowHeader = tableData.header.map(col => col.name);
        const targetRow = tableData.header.map((_, colIdx) => editorTable.getCellValueAt(rowIndex, colIdx + 1));

        // N:1（FK参照先）の解決
        for (let colIdx = 0; colIdx < tableData.header.length; colIdx++) {
            const col = tableData.header[colIdx];
            if (!col.reference) continue;
            const expr = parseReferenceExpression(col.reference);

            if (isSimpleReference(expr)) {
                // DOMの列は1始まり（行ヘッダーが0列目）なのでcolIdx+1
                const fkValue = editorTable.getCellValueAt(rowIndex, colIdx + 1);
                if (fkValue === '') continue;

                // ストア優先・CSV直読みでテーブルデータを取得する
                const refTableData = await this.resolveTableDataAsync(expr.tableName);
                if (requestId !== this.currentRequestId) return entries;
                const { header, rows: allRows } = refTableData;

                // FK列値でフィルタし、実際のストアインデックスも収集する（PK列参照なら一意前提で1件、非PK列なら複数件）
                const { filteredRows: rows, filteredStoreRowIndices: storeRowIndices } =
                    this.filterRowsByColumn(allRows, header, expr.columnName, fkValue);

                entries.push({
                    label: col.name,
                    relationType: 'N:1',
                    tableKey: expr.tableName,
                    header,
                    rows,
                    fkColumnName: col.name,
                    fkValue,
                    storeRowIndices,
                });
            } else if (isDynamicReference(expr)) {
                // resolveDynamicReferenceEntryAsync 内部で複数回 await するため、requestId を渡してガードさせる。
                // メソッド内でキャンセルが検出された場合は null が返るため、呼び出し元でも戻り後に確認する。
                const dynamicEntry = await this.resolveDynamicReferenceEntryAsync(
                    expr, col.name, targetRow, rowHeader, requestId
                );
                if (requestId !== this.currentRequestId) return entries;
                if (dynamicEntry !== null) entries.push(dynamicEntry);
            }
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

                // ストア優先・CSV直読みでテーブルデータを取得する
                const childTableData = await this.resolveTableDataAsync(reverseEntry.childTableName);
                if (requestId !== this.currentRequestId) return entries;
                const { header, rows: allRows } = childTableData;

                // 1:Nのフィルタリングは共通メソッドに委譲する
                // 子テーブルのPK列名は ReverseReferenceEntry.childPkColumnName から取得（スキーマ再読み込み不要）
                const { filteredRows, filteredStoreRowIndices } = this.filterRowsByReverseEntry(
                    allRows, header, reverseEntry.childColumnName, columnValue, reverseEntry.rows, reverseEntry.childPkColumnName,
                );

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

    /**
     * N:1参照のフィルタリング共通処理。
     * columnName 列の値が filterValue と一致する行を収集し、実際のストアインデックスも返す。
     * columnName が header に存在しない場合は空配列を返す。
     */
    private filterRowsByColumn(
        allRows: string[][],
        header: string[],
        columnName: string,
        filterValue: string,
    ): { filteredRows: string[][]; filteredStoreRowIndices: number[] } {
        const colIdx = header.indexOf(columnName);
        if (colIdx === -1) return { filteredRows: [], filteredStoreRowIndices: [] };
        const filteredWithIndices = allRows
            .map((r, i) => ({ row: r, storeIndex: i }))
            .filter(({ row }) => row[colIdx] === filterValue);
        return {
            filteredRows: filteredWithIndices.map(({ row }) => row),
            filteredStoreRowIndices: filteredWithIndices.map(({ storeIndex }) => storeIndex),
        };
    }

    /**
     * 1:N逆参照のフィルタリング共通処理。
     * - childColumnName が空でない場合: FK列値が filterValue と一致する行を収集する（単純参照）。
     * - childColumnName が空の場合: pkRows のPKセットで allRows を検索する（動的参照）。
     * - 対象列が見つからない場合は空配列を返す。
     * childPkColumnName: 子テーブルのPK列名（動的参照でのフィルタリングに使用）
     */
    private filterRowsByReverseEntry(
        allRows: string[][],
        header: string[],
        childColumnName: string,
        filterValue: string,
        pkRows: ReverseReferenceRow[],
        childPkColumnName: string,
    ): { filteredRows: string[][]; filteredStoreRowIndices: number[] } {
        if (childColumnName !== '') {
            // 単純参照: FK列値で直接フィルタ（常に最新のストアデータを反映する）
            const fkColIdx = header.indexOf(childColumnName);
            if (fkColIdx === -1) return { filteredRows: [], filteredStoreRowIndices: [] };
            const filteredWithIndices = allRows
                .map((r, i) => ({ row: r, storeIndex: i }))
                .filter(({ row }) => row[fkColIdx] === filterValue);
            return {
                filteredRows: filteredWithIndices.map(({ row }) => row),
                filteredStoreRowIndices: filteredWithIndices.map(({ storeIndex }) => storeIndex),
            };
        }
        // 動的参照: FK列名が特定できないため reverseEntry.rows のPKセットでフィルタする
        // 子テーブルのPK列名はスキーマから取得した childPkColumnName を使用する
        const pkColIdx = header.indexOf(childPkColumnName);
        if (pkColIdx === -1) return { filteredRows: [], filteredStoreRowIndices: [] };
        const pkSet = new Set(pkRows.map(r => r.pkValue));
        const filteredWithIndices = allRows
            .map((r, i) => ({ row: r, storeIndex: i }))
            .filter(({ row }) => pkSet.has(row[pkColIdx]));
        return {
            filteredRows: filteredWithIndices.map(({ row }) => row),
            filteredStoreRowIndices: filteredWithIndices.map(({ storeIndex }) => storeIndex),
        };
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
     * リサイズハンドルと固定ヘッダーを除いたコンテンツ領域をクリアする。
     * .resize-handle（リサイズハンドル）と .relations-panel-fixed-header（閉じるボタン付きヘッダー）は保護する。
     */
    private clearContentArea(): void {
        const children = Array.from(this.panelElement.children);
        for (const child of children) {
            if (!child.classList.contains('resize-handle') && !child.classList.contains('relations-panel-fixed-header')) {
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
        // relationsPanel の参照を先に解除する（deactivate 前に解除することで宙吊り状態を防ぐ）
        for (const miniTable of this.miniEditorTables) {
            miniTable.relationsPanel = false;
        }
        // deactivate ループは suspend() との共通処理として抽出したメソッドに委譲する
        this.deactivateMiniEditorTables();
        this.miniEditorTables = [];
        this.miniFillControllers = [];
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
        // ミニEditorTableが破棄された後、メインEditorTableが操作権を持つようにする。
        // setInactiveAppearance(false) でアクティブ色に戻す（destroyMiniEditorTables は
        // renderMessage 経由でも呼ばれるため、ここで視覚状態を明示的に復元する）。
        if (this.currentEditorTable !== false) {
            this.currentEditorTable.getHandler().activate();
            this.currentEditorTable.setInactiveAppearance(false);
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

        // RELATIONS セクションヘッダーと閉じるボタンは固定ヘッダー（relations-panel-fixed-header）に
        // 配置済みのため、ここでは生成しない。固定ヘッダーはコンテンツの表示状態に関わらず常に表示される。

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
            // FK条件コンテキスト（例: enemy_id=3）を表示する（N:1・1:N どちらも対応）
            if (entry.fkColumnName !== '') {
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

        // DOM追加後にSelectionの視覚位置をレイアウトに基づいて更新する
        // createMiniEditorTable 時点ではDOMがレイアウトされていないため getBoundingClientRect が0を返す
        for (const miniTable of this.miniEditorTables) {
            miniTable.refreshSelectionDisplay();
        }
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
        // すべてのミニテーブルに最低1行のバッファ行を表示する（行追加のエントリポイントとして機能させるため）
        // emptyRowCount はデータ行+バッファ行の合計最低行数なので、データ行数+1 を渡す
        const emptyRowCount = entry.rows.length + 1;
        const {editorTable, fillController, areaResizer, history} = this.tab.createMiniEditorTable(
            scrollContainer, innerWrapper, wrapper, entry.tableKey, schemaJson, entry.header, entry.rows, emptyRowCount, true
        );
        // 全ミニテーブルにフィルタリングされた行の実際のストアインデックスを設定する。
        // N:1は参照先テーブルの一致行のみ表示するため、initialize() のデフォルト [0,1,...] では実際と一致しない。
        // 1:N も同様にフィルタリングされた行のインデックスを使う。
        editorTable.setStoreRowIndices(entry.storeRowIndices);
        // 1:NエントリのFK自動埋め込み情報を設定する（行追加時にFK列が自動入力される）。N:1参照先テーブルには適用しない。
        if (entry.relationType === '1:N' && entry.fkColumnName !== '' && entry.fkValue !== '') {
            editorTable.setAutoFillEntries([{ columnName: entry.fkColumnName, value: entry.fkValue }]);
        }
        // ミニEditorTableにもRelationsPanelを接続して、セルクリック時の排他制御を有効にする
        editorTable.relationsPanel = this;
        // 生成直後は非アクティブ状態として初期化する（左ペインがアクティブになるまでグレー表示）
        editorTable.setInactiveAppearance(true);
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
     * ミニEditorTableの行選択変化をTabに転送する（EditorTableから呼ばれる）
     * ペインスタックにおいてこのRPの右隣ペインがRelationsPanelであれば、
     * そのRPをtableName/pkValueで更新する。
     * Tab側でペインスタックの位置を判断するため、このRP自身をキーとして渡す。
     */
    notifyMiniTableRowSelectionChanged(tableName: string, pkValue: string): void {
        if (this.tab === false) return;
        this.tab.updateNextPaneForMiniTableRow(this, tableName, pkValue);
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
     * パネルのDOM要素を返す（Tabのペインスタック管理で使用）
     * getter パターン（get xxx()）は禁止のため通常メソッドとして定義する
     */
    getPanelElement(): HTMLElement {
        return this.panelElement;
    }

    /**
     * 定義へジャンプ: ペインスタックに新しい RelationsPanel を追加して参照データを表示する
     * EditorTable.navigateToDefinition() から呼ばれる（ミニテーブル専用）。
     * 旧動作（Tab.navigateToTableRow で左ペインのタブを開く）から変更:
     *   新動作: Tab.pushRelationsPanel でペインスタックに追加する
     */
    navigateToDefinition(tableName: string, pkValue: string): void {
        if (this.tab === false) throw new Error('[RelationsPanel] navigateToDefinition: tab が未接続です');
        this.tab.pushRelationsPanel(tableName, pkValue);
    }

    /**
     * 指定テーブルの指定PK値に対応する参照関係を表示する（ペインスタック上のRP向け）
     * EditorTable に依存せず、ストアとスキーマから直接参照を解決する。
     *
     * 同一テーブルへの再呼び出し（行選択変化）では registerTableAsync をスキップして
     * refCountリークを防止する。別テーブルへ切り替わる場合は旧テーブルを先に unregister する。
     */
    async showForTableRowAsync(tableName: string, pkValue: string): Promise<void> {
        const requestId = ++this.currentRequestId;

        // テーブルが切り替わる場合のみ register/unregister を行う（refCountリーク防止）
        if (this.baseTableName !== tableName) {
            const oldTable = this.baseTableName;
            // baseTableName を先に false にしておくことで、await 中に disconnectEditorTable が
            // 割り込んでも旧テーブルを二重 unregister しないよう防御する
            this.baseTableName = false;
            if (oldTable !== false) {
                this.store.unregisterTable(oldTable);
            }
            await this.store.registerTableAsync(tableName);
            // await 中に disconnectEditorTable / 別リクエストが割り込んだ場合は新テーブルを
            // リークさせず unregister して返る
            if (requestId !== this.currentRequestId) {
                this.store.unregisterTable(tableName);
                return;
            }
            // ペインスタックから破棄される際（disconnectEditorTable 経由）に unregisterTable を呼ぶため記録する
            this.baseTableName = tableName;
        }

        const entries = await this.resolveEntriesForTableRowAsync(tableName, pkValue, requestId);
        if (requestId !== this.currentRequestId) return;

        if (entries.length === 0) {
            this.currentEntries = [];
            this.renderMessage('参照なし');
            return;
        }
        this.currentEntries = entries;
        await this.renderAsync();
    }

    /**
     * テーブル名とPK値からリレーションエントリを解決する（EditorTable不要版）
     * ペインスタック上のRPが使用する。ストアとスキーマから直接解決する。
     *
     * requestId を受け取り、各 await 後にレースコンディションを検出した場合は空配列を返す。
     * 呼び出し元の showForTableRowAsync が await 後に改めて requestId チェックを行うため、
     * ここで空配列を返しても二重チェックにはならない（呼び出し元が最終判断する）。
     */
    private async resolveEntriesForTableRowAsync(tableName: string, pkValue: string, requestId: number): Promise<RelationEntry[]> {
        const entries: RelationEntry[] = [];

        // スキーマを読み込む
        const schemaText = await readFileAsync(`schema/${tableName}.json`);
        if (requestId !== this.currentRequestId) return entries;
        const schemaJson: Record<string, unknown> = JSON.parse(schemaText);
        const header = schemaJson.header as Array<{name: string; type: string; reference?: string}>;

        // ストアからテーブルデータを取得する。
        // registerTableAsync が直前に成功しているためデータが取れない状態は実装バグ。
        const storeHeader = this.store.getHeader(tableName);
        const storeRows = this.store.getRows(tableName);
        if (storeHeader === false || storeRows === false) {
            throw new Error(`resolveEntriesForTableRowAsync: registerTableAsync 成功後にストアデータが取得できない（tableName=${tableName}）`);
        }

        // PK列でターゲット行を特定する。スキーマの primary_key から親テーブルのPK列名を取得する。
        // PK列が存在しないのはスキーマ定義の不整合であり実装バグ。
        const parentPkColumnName = extractFirstPrimaryKeyColumn(schemaJson);
        const pkColIdx = storeHeader.indexOf(parentPkColumnName);
        if (pkColIdx === -1) {
            throw new Error(`resolveEntriesForTableRowAsync: PK列が見つからない（tableName=${tableName}, pkColumn=${parentPkColumnName}）`);
        }
        const targetRowIdx = storeRows.findIndex(row => row[pkColIdx] === pkValue);
        // ターゲット行が見つからない場合は、ユーザーが行を削除した後にパンくずリストを
        // 辿るなどの正常なユースケースが存在するため、空配列を返して処理を終了する。
        if (targetRowIdx === -1) return entries;
        const targetRow = storeRows[targetRowIdx];

        // N:1（FK参照先）の解決
        for (const col of header) {
            if (!col.reference) continue;
            const expr = parseReferenceExpression(col.reference);

            if (isSimpleReference(expr)) {
                const fkColIdx = storeHeader.indexOf(col.name);
                if (fkColIdx === -1) continue;
                const fkValue = targetRow[fkColIdx];
                if (fkValue === '') continue;

                const refTableData = await this.resolveTableDataAsync(expr.tableName);
                if (requestId !== this.currentRequestId) return entries;

                // FK列値でフィルタし、実際のストアインデックスも収集する
                const { filteredRows: rows, filteredStoreRowIndices: storeRowIndices } =
                    this.filterRowsByColumn(refTableData.rows, refTableData.header, expr.columnName, fkValue);

                entries.push({
                    label: col.name,
                    relationType: 'N:1',
                    tableKey: expr.tableName,
                    header: refTableData.header,
                    rows,
                    fkColumnName: col.name,
                    fkValue,
                    storeRowIndices,
                });
            } else if (isDynamicReference(expr)) {
                // resolveEntriesForEditorRowAsync と同じ共通メソッドで動的参照を解決する。
                // targetRow と storeHeader はストアから取得済みのため直接渡す。
                // resolveDynamicReferenceEntryAsync 内部で複数回 await するため、requestId を渡してガードさせる。
                // メソッド内でキャンセルが検出された場合は null が返るため、呼び出し元でも戻り後に確認する。
                const dynamicEntry = await this.resolveDynamicReferenceEntryAsync(
                    expr, col.name, targetRow, storeHeader, requestId
                );
                if (requestId !== this.currentRequestId) return entries;
                if (dynamicEntry !== null) entries.push(dynamicEntry);
            }
        }

        // 1:N（逆参照）の解決: ReverseReferenceResolver で逆参照マップを構築する
        const resolver = new ReverseReferenceResolver(this.store);
        const reverseMap = await resolver.resolveAsync(tableName, parentPkColumnName);
        if (requestId !== this.currentRequestId) return entries;

        // PK値で逆参照エントリを取得する
        const reverseEntriesForPk = reverseMap.get(pkValue);
        if (reverseEntriesForPk) {
            for (const reverseEntry of reverseEntriesForPk) {
                // parentColumnName が親テーブルのPK列名と一致するエントリのみ処理する（非PK列参照の誤適用防止）
                if (reverseEntry.parentColumnName !== parentPkColumnName) continue;

                // 子テーブルのデータを取得する
                const childTableData = await this.resolveTableDataAsync(reverseEntry.childTableName);
                if (requestId !== this.currentRequestId) return entries;
                const { header: childHeader, rows: allRows } = childTableData;

                // 1:Nのフィルタリングは共通メソッドに委譲する
                // 子テーブルのPK列名は ReverseReferenceEntry.childPkColumnName から取得（スキーマ再読み込み不要）
                const { filteredRows, filteredStoreRowIndices } = this.filterRowsByReverseEntry(
                    allRows, childHeader, reverseEntry.childColumnName, pkValue, reverseEntry.rows, reverseEntry.childPkColumnName,
                );

                entries.push({
                    label: reverseEntry.childTableName,
                    relationType: '1:N',
                    tableKey: reverseEntry.childTableName,
                    header: childHeader,
                    rows: filteredRows,
                    fkColumnName: reverseEntry.childColumnName,
                    fkValue: pkValue,
                    storeRowIndices: filteredStoreRowIndices,
                });
            }
        }

        return entries;
    }

}
