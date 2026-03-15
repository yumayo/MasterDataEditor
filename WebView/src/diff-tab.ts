import {EditorTable} from "./editor-table";
import {Selection} from "./selection";
import {EditorTableHandler} from "./editor-table-handler";
import {History} from "./history";
import {AreaResizer} from "./area-resizer";
import {FillController} from "./fill-controller";
import {ScrollViewportController} from "./scroll-viewport-controller";
import {ReferenceDataCache} from "./reference-data-cache";
import {InMemoryTableStore} from "./in-memory-table-store";
import {EditorTableData} from "./model/editor-table-data";
import {Csv} from "./csv";
import {ContextMenu} from "./context-menu";
import {TabButton} from "./tab-button";
import {Editor} from "./editor";
import {Sidebar} from "./sidebar";
import {SchemaColumn, SchemaJson, buildDiffRows, buildMergedData} from "./diff-rows";

/**
 * DiffTab — 差分ビューを EditorTable ベースで表示する特別タブ
 *
 * 設定タブ（SettingsPanel）と同様に Tab クラスから管理される特別タブ。
 * 左ペイン（HEAD版）と右ペイン（現在版）にそれぞれ EditorTable を生成して差分を表示する。
 * changes状態では左ペインが読み取り専用、staged状態では両ペインが読み取り専用。
 */
export class DiffTab {
    private readonly wrapperElement: HTMLElement;

    /** destroy() 時のストア登録解除に必要なテーブルキー */
    private readonly leftTableKey: string;
    private readonly rightTableKey: string;

    /** 左ペインのEditorTable関連オブジェクト（クリーンアップ用） */
    private readonly leftEditorTable: EditorTable;
    private readonly leftEditorTableHandler: EditorTableHandler;
    private readonly leftHistory: History;
    private readonly leftAreaResizer: AreaResizer;
    private readonly leftFillController: FillController;

    /** 右ペインのEditorTable関連オブジェクト（クリーンアップ用） */
    private readonly rightEditorTable: EditorTable;
    private readonly rightEditorTableHandler: EditorTableHandler;
    private readonly rightHistory: History;
    private readonly rightAreaResizer: AreaResizer;
    private readonly rightFillController: FillController;

    /** スクロール同期の再帰ループ防止フラグ */
    private isSyncing: boolean;

    /** destroy() 時にスクロールリスナーを解除するためのバインド済み関数 */
    private readonly boundLeftScroll: () => void;
    private readonly boundRightScroll: () => void;

    /** スクロール同期の対象となるペイン要素（removeEventListener に必要） */
    private readonly leftPaneElement: HTMLElement;
    private readonly rightPaneElement: HTMLElement;

    constructor(
        tableName: string,
        schemaJson: string,
        headCsv: string,
        currentCsv: string,
        isStaged: boolean,
        editor: Editor,
        sidebar: Sidebar,
        store: InMemoryTableStore,
        referenceDataCache: ReferenceDataCache,
        contextMenu: ContextMenu,
        dummyTabButton: TabButton
    ) {
        this.isSyncing = false;

        // スキーマをパースしてPK列名（配列）を取得する（単一PKは文字列→配列に正規化）
        const schema = JSON.parse(schemaJson) as SchemaJson;
        const primaryKeyNames: readonly string[] = Array.isArray(schema.primary_key)
            ? schema.primary_key
            : [schema.primary_key];
        const columnCount = schema.header.length;

        // 差分計算（ファイル行順）
        const { diffRows, displayHeader } = buildDiffRows(headCsv, currentCsv, primaryKeyNames);
        const {
            leftRows, rightRows,
            leftEmptyRowIndices, rightEmptyRowIndices,
            leftDeletedRowIndices, rightAddedRowIndices,
            leftModifiedCells, rightModifiedCells,
        } = buildMergedData(diffRows, columnCount);

        // ルートラッパー要素（初期は非表示にして activateDiffTab() で表示する）
        const wrapperElement = document.createElement('div');
        wrapperElement.classList.add('tab-wrapper', 'diff-tab-wrapper');
        wrapperElement.style.display = 'none';
        editor.appendChild(wrapperElement);
        this.wrapperElement = wrapperElement;

        // 差分タブのコンテンツ領域（左右ペインを横並び）
        const diffTabContent = document.createElement('div');
        diffTabContent.classList.add('diff-tab');
        wrapperElement.appendChild(diffTabContent);

        // 左ペイン（HEAD版 = 変更前）
        const leftPaneElement = document.createElement('div');
        leftPaneElement.classList.add('diff-pane-left');
        diffTabContent.appendChild(leftPaneElement);
        this.leftPaneElement = leftPaneElement;

        // 右ペイン（現在版 = 変更後）
        const rightPaneElement = document.createElement('div');
        rightPaneElement.classList.add('diff-pane-right');
        diffTabContent.appendChild(rightPaneElement);
        this.rightPaneElement = rightPaneElement;

        // 左右ペイン用のストアキー（差分タブ専用の名前空間を使用して通常テーブルと衝突しない）
        const leftTableKey = tableName + ':diff:head';
        const rightTableKey = tableName + ':diff:current';
        this.leftTableKey = leftTableKey;
        this.rightTableKey = rightTableKey;

        const leftResult = this.buildDiffEditorTable(
            leftTableKey, schemaJson, displayHeader, leftRows,
            leftPaneElement, store, referenceDataCache, contextMenu, dummyTabButton, sidebar
        );
        this.leftEditorTable = leftResult.editorTable;
        this.leftEditorTableHandler = leftResult.editorTableHandler;
        this.leftHistory = leftResult.history;
        this.leftAreaResizer = leftResult.areaResizer;
        this.leftFillController = leftResult.fillController;

        const rightResult = this.buildDiffEditorTable(
            rightTableKey, schemaJson, displayHeader, rightRows,
            rightPaneElement, store, referenceDataCache, contextMenu, dummyTabButton, sidebar
        );
        this.rightEditorTable = rightResult.editorTable;
        this.rightEditorTableHandler = rightResult.editorTableHandler;
        this.rightHistory = rightResult.history;
        this.rightAreaResizer = rightResult.areaResizer;
        this.rightFillController = rightResult.fillController;

        // 左右EditorTableに自身（DiffTab）を接続する（排他制御のため）
        // RelationsPanel.connectEditorTable() と対称的なパターン
        this.leftEditorTable.diffTab = this;
        this.rightEditorTable.diffTab = this;

        // 差分クラスをDOM行・セルに付与する（EditorTable生成後）
        this.applyDiffClasses(
            this.leftEditorTable, this.rightEditorTable,
            leftEmptyRowIndices, rightEmptyRowIndices,
            leftDeletedRowIndices, rightAddedRowIndices,
            leftModifiedCells, rightModifiedCells
        );

        // 左ペイン（HEAD版）は常に読み取り専用にする
        this.leftEditorTable.makeReadOnly();

        // 差分タブのtableNameは "test:diff:head/current" のような不正パスになるため
        // Ctrl+Sによるファイル保存を両ペインで禁止する
        this.leftEditorTableHandler.disableSave();
        this.rightEditorTableHandler.disableSave();

        // staged状態では右ペイン（現在版）も読み取り専用にする
        if (isStaged) {
            this.rightEditorTable.makeReadOnly();
        }

        // スクロール同期（左→右、右→左の双方向）—— destroy() で解除するためバインド済み関数をフィールドに保持する
        this.boundLeftScroll = () => {
            if (this.isSyncing) return;
            this.isSyncing = true;
            rightPaneElement.scrollTop = leftPaneElement.scrollTop;
            rightPaneElement.scrollLeft = leftPaneElement.scrollLeft;
            this.isSyncing = false;
        };
        this.boundRightScroll = () => {
            if (this.isSyncing) return;
            this.isSyncing = true;
            leftPaneElement.scrollTop = rightPaneElement.scrollTop;
            leftPaneElement.scrollLeft = rightPaneElement.scrollLeft;
            this.isSyncing = false;
        };
        leftPaneElement.addEventListener('scroll', this.boundLeftScroll);
        rightPaneElement.addEventListener('scroll', this.boundRightScroll);
    }

    /**
     * 差分タブ内の左右EditorTable間での排他制御を行う
     * RelationsPanel.activateHandler() と対称的な設計:
     * - 対象テーブルを activate + setInactiveAppearance(false)
     * - 非対象テーブルを deactivate + setInactiveAppearance(true)
     */
    activateHandler(targetEditorTable: EditorTable): void {
        if (targetEditorTable === this.leftEditorTable) {
            this.leftEditorTable.getHandler().activate();
            this.leftEditorTable.setInactiveAppearance(false);
            this.rightEditorTable.getHandler().deactivate();
            this.rightEditorTable.setInactiveAppearance(true);
        } else if (targetEditorTable === this.rightEditorTable) {
            this.rightEditorTable.getHandler().activate();
            this.rightEditorTable.setInactiveAppearance(false);
            this.leftEditorTable.getHandler().deactivate();
            this.leftEditorTable.setInactiveAppearance(true);
        } else {
            throw new Error('activateHandler: targetEditorTableはDiffTabに属していません');
        }
    }

    /**
     * 差分タブのラッパー要素を表示する
     */
    show(): void {
        this.wrapperElement.style.display = '';
    }

    /**
     * 差分タブのラッパー要素を非表示にする
     */
    hide(): void {
        this.wrapperElement.style.display = 'none';
    }

    /**
     * 差分タブのDOMを削除してリソースを解放する
     * ストアのテーブルデータとHistoryを解除してからDOMを削除する
     */
    destroy(store: InMemoryTableStore): void {
        // スクロールリスナーを解除する（DOM除去後もガベージコレクションされるよう明示的に解除）
        this.leftPaneElement.removeEventListener('scroll', this.boundLeftScroll);
        this.rightPaneElement.removeEventListener('scroll', this.boundRightScroll);
        // EditorTableのdiffTab参照をリセットする（RelationsPanel.disconnectEditorTable() と対称）
        this.leftEditorTable.diffTab = false;
        this.rightEditorTable.diffTab = false;
        // EditorTableHandler のキーボードリスナー（グローバル登録）を解除する
        this.leftEditorTableHandler.deactivate();
        this.rightEditorTableHandler.deactivate();
        this.leftEditorTable.deactivate();
        this.leftAreaResizer.deactivate();
        this.leftFillController.deactivate();
        this.rightEditorTable.deactivate();
        this.rightAreaResizer.deactivate();
        this.rightFillController.deactivate();
        // Historyをストアのhistoryレジストリから登録解除する
        this.leftHistory.unregister();
        this.rightHistory.unregister();
        // ストアのテーブルデータも削除する（差分タブ専用キーなのでDirty状態は無視して強制削除）
        store.unregisterTable(this.leftTableKey);
        store.unregisterTable(this.rightTableKey);
        this.wrapperElement.remove();
    }

    /**
     * 差分タブ用のEditorTableを生成する内部メソッド
     * createMiniEditorTable と同パターン（RelationsPanel連携・FillController有効化不要部分は省略）
     */
    private buildDiffEditorTable(
        tableKey: string,
        schemaJson: string,
        displayHeader: string[],
        dataRows: string[][],
        paneElement: HTMLElement,
        store: InMemoryTableStore,
        referenceDataCache: ReferenceDataCache,
        contextMenu: ContextMenu,
        dummyTabButton: TabButton,
        sidebar: Sidebar
    ): { editorTable: EditorTable; editorTableHandler: EditorTableHandler; history: History; areaResizer: AreaResizer; fillController: FillController } {
        // スキーマをパースしてEditorTableDataを構築する
        const schemaObj = JSON.parse(schemaJson) as Record<string, unknown>;
        const csv = new Csv();
        csv.header = displayHeader;
        csv.body = dataRows;
        const tableData = EditorTableData.parse(schemaObj, csv);

        // ストアに登録する（History コンストラクタで registerHistory が呼ばれるためストア登録が先）
        store.registerTable(tableKey, csv.header, csv.body);

        // 相互参照解決のため一時的な空オブジェクトを作成（Tab.createEditorTable・createMiniEditorTable と同パターン）
        const editorTable = {} as EditorTable;

        // scrollControllerの対象はペイン要素（overflow:auto）
        const scrollController = new ScrollViewportController(paneElement, () => {
            editorTable.onScroll();
        });

        const selection = new Selection(editorTable, paneElement, scrollController);
        const history = new History(editorTable, dummyTabButton, store, tableKey, 100);
        const editorTableHandler = new EditorTableHandler(editorTable, selection, history, scrollController);
        const textField = editorTableHandler.createGridTextField(paneElement, editorTable, selection);
        editorTableHandler.setTextField(textField);

        const areaResizer = new AreaResizer(paneElement, history, selection);

        // emptyRowCount=0、isMiniTable=true で生成する（空行なし、ミニテーブル相当）
        const realEditorTable = new EditorTable(
            tableKey, tableData, referenceDataCache, store, editorTableHandler,
            selection, contextMenu, history, areaResizer,
            scrollController, sidebar, 0, 'editor-table', true
        );

        Object.assign(editorTable, realEditorTable);
        Object.setPrototypeOf(editorTable, EditorTable.prototype);
        editorTable.initializeModules();

        editorTable.appendTo(paneElement);
        paneElement.appendChild(selection.element);
        paneElement.appendChild(selection.copyBorderElement);
        paneElement.appendChild(selection.fillPreviewElement);
        editorTableHandler.appendTo(paneElement);

        areaResizer.setEditorTable(editorTable);
        editorTable.initialize();

        const fillController = new FillController(editorTable, selection, history);
        fillController.initialize();

        areaResizer.activate();
        editorTable.activate();

        return { editorTable, editorTableHandler, history, areaResizer, fillController };
    }

    /**
     * 差分クラスをEditorTableのDOMに付与する
     * EditorTable.getCell(row, col) でセル要素を取得し、直接CSSクラスを追加する
     * row は1始まり（0がヘッダー行）、col は1始まり（0が行ヘッダー）
     */
    private applyDiffClasses(
        leftTable: EditorTable,
        rightTable: EditorTable,
        leftEmptyRowIndices: number[],
        rightEmptyRowIndices: number[],
        leftDeletedRowIndices: number[],
        rightAddedRowIndices: number[],
        leftModifiedCells: Array<{ row: number; col: number }>,
        rightModifiedCells: Array<{ row: number; col: number }>
    ): void {
        const leftElement = leftTable.getTableElement();
        const rightElement = rightTable.getTableElement();

        // 左ペインの空白行（追加行に対応する空白）
        // buildMergedData が生成するインデックスとDOM構造は同期的に構築されるため、
        // インデックスの存在チェックは不要（防御的ガードを除去）
        for (const rowIdx of leftEmptyRowIndices) {
            (leftElement.children[rowIdx + 1] as HTMLElement).classList.add('diff-row-empty'); // +1 でヘッダー行スキップ
        }

        // 右ペインの空白行（削除行に対応する空白）
        for (const rowIdx of rightEmptyRowIndices) {
            (rightElement.children[rowIdx + 1] as HTMLElement).classList.add('diff-row-empty');
        }

        // 左ペインの削除行
        for (const rowIdx of leftDeletedRowIndices) {
            (leftElement.children[rowIdx + 1] as HTMLElement).classList.add('diff-row-deleted');
        }

        // 右ペインの追加行
        for (const rowIdx of rightAddedRowIndices) {
            (rightElement.children[rowIdx + 1] as HTMLElement).classList.add('diff-row-added');
        }

        // 左ペインの変更セル（.diff-cell-deleted）
        // EditorTable.getCell は row=1始まり、col=1始まりで取得する
        // buildMergedData で生成したインデックスはDOMと同期しているためtry-catchは不要
        for (const { row: rowIdx, col: colIdx } of leftModifiedCells) {
            leftTable.getCell(rowIdx + 1, colIdx + 1).classList.add('diff-cell-deleted');
        }

        // 右ペインの変更セル（.diff-cell-added）
        for (const { row: rowIdx, col: colIdx } of rightModifiedCells) {
            rightTable.getCell(rowIdx + 1, colIdx + 1).classList.add('diff-cell-added');
        }
    }
}
