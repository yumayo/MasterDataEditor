import {EditorTable} from "../editor/editor-table";
import {Selection} from "../editor/selection";
import {EditorTableHandler} from "../editor/editor-table-handler";
import {History} from "../editor/history";
import {AreaResizer} from "../editor/area-resizer";
import {FillController} from "../editor/fill-controller";
import {ScrollViewportController} from "../editor/scroll-viewport-controller";
import {ReferenceDataCache} from "../references/reference-data-cache";
import {InMemoryTableStore} from "../data/in-memory-table-store";
import {EditorTableData} from "../data/models/editor-table-data";
import {Csv} from "../data/csv";
import {ContextMenu} from "../ui/context-menu";
import {TabButton} from "./tab-button";
import {Editor} from "../editor/editor";
import {Sidebar} from "../sidebar/sidebar";
import {SchemaJson, buildDiffRows, buildMergedData} from "../diff/diff-rows";
import {TabReference} from "./tab-reference";
import {GridDropdownInput} from "../ui/grid-dropdown-input";
import {NotificationToast} from "../ui/notification";
import {ValidationPanel} from "../panels/validation-panel";
import {ScrollbarMarkerTrack, MarkerEntry} from "../ui/scrollbar-marker-track";

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
    private readonly boundLeftWheel: (e: WheelEvent) => void;
    private readonly boundRightWheel: (e: WheelEvent) => void;

    /** destroy() 時にリサイズハンドルのリスナーを解除するためのバインド済み関数 */
    private readonly boundResizeMouseDown: (e: MouseEvent) => void;

    /** ドラッグ操作中のリスナー参照（destroy() 時に強制解除するため保持） */
    private dragMouseMove: ((e: MouseEvent) => void) | null;
    private dragMouseUp: (() => void) | null;

    /** hide() 時に保存するスクロール位置（show() で復元して行ヘッダーずれを防止） */
    private savedScrollLeft: number;
    private savedScrollTop: number;

    /** リサイズハンドル要素（removeEventListener に必要） */
    private readonly resizeHandle: HTMLElement;

    /** スクロール同期のイベントを受けるペイン要素（removeEventListener に必要） */
    private readonly leftPaneElement: HTMLElement;
    private readonly rightPaneElement: HTMLElement;

    /** 差分マーカートラック（左=削除行の赤マーカー、右=追加行の緑マーカー） */
    private readonly leftTrack: ScrollbarMarkerTrack;
    private readonly rightTrack: ScrollbarMarkerTrack;

    /**
     * データ行インデックス（0始まり） → HEAD版のCSV値配列。
     * 空行（パディング行）や追加行（HEAD版に存在しない行）は null。
     * セル編集後のdiff-cell-added/diff-cell-deleted動的更新に使用する。
     * 行挿入・削除時にインデックスを同期するため readonly ではない。
     */
    private readonly headRowValuesPerDomRow: Array<string[] | null>;

    /** destroy() 時のスキーマ登録解除に必要なバリデーションパネル参照（staged時は false） */
    private readonly validationPanel: ValidationPanel | false;

    /** DOM列インデックス → CSV列インデックスの順引きマップ（動的更新で使用） */
    private readonly domIndexToCsvIndex: ReadonlyMap<number, number>;

    /** HEAD版に存在しない列のDOM列インデックス集合（新規列を灰色表示するため） */
    private readonly newColumnDomIndices: ReadonlySet<number>;

    /** 左ペインの各データ行に付与すべきdiffクラス集合（データ行インデックス 0始まり → クラス名配列） */
    private readonly leftRowClasses: Map<number, string[]>;
    /** 右ペインの各データ行に付与すべきdiffクラス集合 */
    private readonly rightRowClasses: Map<number, string[]>;
    /** 左ペインのセルdiffクラス（"dataRow,domCol" → クラス名） */
    private readonly leftCellClasses: Map<string, string>;
    /** 右ペインのセルdiffクラス（"dataRow,domCol" → クラス名） */
    private readonly rightCellClasses: Map<string, string>;
    /** 右ペインの追加行（行内全セルに diff-cell-added を付与すべき行）のデータ行インデックス集合 */
    private readonly rightAddedRows: Set<number>;
    /** 右ペインの初期パディング行のデータ行インデックス → ストア行インデックス */
    private readonly rightPaddingStoreIndices: Map<number, number>;
    /** ui-state 永続化を呼び出すためのリスナー */
    private uiStateChangeListener: (() => void) | false;

    constructor(
        tableName: string,
        schemaJson: string,
        headCsv: string,
        currentCsv: string,
        isStaged: boolean,
        gitPath: string,
        editor: Editor,
        sidebar: Sidebar,
        store: InMemoryTableStore,
        referenceDataCache: ReferenceDataCache,
        contextMenu: ContextMenu,
        tabButton: TabButton,
        tabReference: TabReference,
        openEditorTables: Map<string, EditorTable>,
        notification: NotificationToast,
        validationPanel: ValidationPanel | false,
        leftLabel: string | null,
        rightLabel: string | null
    ) {
        this.isSyncing = false;
        this.dragMouseMove = null;
        this.dragMouseUp = null;
        this.savedScrollLeft = 0;
        this.savedScrollTop = 0;
        // diffクラスデータモデルを初期化する（applyDiffClassesで構築される）
        this.leftRowClasses = new Map();
        this.rightRowClasses = new Map();
        this.leftCellClasses = new Map();
        this.rightCellClasses = new Map();
        this.rightAddedRows = new Set();
        this.rightPaddingStoreIndices = new Map();
        this.uiStateChangeListener = false;

        // スキーマをパースしてPK列名（配列）を取得する
        const schema = JSON.parse(schemaJson) as SchemaJson;
        const primaryKeyNames: readonly string[] = schema.primary_key;

        // 差分計算（ファイル行順）
        const { diffRows, displayHeader, newColumnIndices } = buildDiffRows(headCsv, currentCsv, primaryKeyNames);
        // columnCount はスキーマ列数ではなくCSV全列数（displayHeader.length）を使う。
        // スキーマが非連番keyの場合、changedColumnIndices はCSV列インデックス（0〜N-1）を持つため、
        // CSV全列数で切り詰めないと applyDiffClasses でインデックス範囲外になる。
        const columnCount = displayHeader.length;
        const {
            leftRows, rightRows,
            leftEmptyRowIndices, rightEmptyRowIndices,
            leftDeletedRowIndices, rightAddedRowIndices,
            leftModifiedCells, rightModifiedCells,
        } = buildMergedData(diffRows, columnCount);

        // DOM行インデックス → HEAD版のCSV値配列を構築する。
        // buildMergedData のループと同じ順序で走査し、各DOM行のHEAD版値を保持する。
        // 追加行（HEAD版に存在しない行）はnull、空行（パディング行）もnull。
        const headRowValuesPerDomRow: Array<string[] | null> = [];
        for (const diffRow of diffRows) {
            if (diffRow.kind === 'deleted' || diffRow.kind === 'modified' || diffRow.kind === 'unchanged') {
                headRowValuesPerDomRow.push(diffRow.headValues);
            } else {
                // added行: HEAD版に存在しないためnull
                headRowValuesPerDomRow.push(null);
            }
        }
        this.headRowValuesPerDomRow = headRowValuesPerDomRow;

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

        // 左ペインスロット（差分ペインの配置ラッパー）
        const leftPaneSlot = document.createElement('div');
        leftPaneSlot.classList.add('diff-pane-left-slot');
        diffTabContent.appendChild(leftPaneSlot);

        // 左ペイン（HEAD版 = 変更前）
        const leftPaneElement = document.createElement('div');
        leftPaneElement.classList.add('diff-pane-left');
        leftPaneSlot.appendChild(leftPaneElement);
        this.leftPaneElement = leftPaneElement;

        // 左ペインラベル（バージョン比較時のコミット情報表示。nullの場合は非表示）
        if (leftLabel !== null) {
            const leftLabelElement = document.createElement('div');
            leftLabelElement.classList.add('diff-pane-label-left');
            leftLabelElement.textContent = leftLabel;
            leftPaneElement.appendChild(leftLabelElement);
        }

        // リサイズハンドル — 左右ペイン間に配置してドラッグで幅を調整する
        const resizeHandle = document.createElement('div');
        resizeHandle.classList.add('diff-resize-handle');
        diffTabContent.appendChild(resizeHandle);
        this.resizeHandle = resizeHandle;

        // バインド済み関数としてフィールドに保持する（destroy() での解除のため）
        this.boundResizeMouseDown = (e: MouseEvent) => {
            // SelectionDragController との競合を防ぐ
            e.stopPropagation();
            e.preventDefault();
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';

            const onMouseMove = (moveEvent: MouseEvent) => {
                // diffTabContent の左端を基準にマウス位置から左ペイン幅パーセンテージを計算する
                const rect = diffTabContent.getBoundingClientRect();
                if (rect.width === 0) throw new Error('差分ビューのコンテナ幅が0です');
                const newWidth = moveEvent.clientX - rect.left;
                // 20%〜80%にクランプし、小数点1桁に丸める
                const percentage = Math.round(Math.max(20, Math.min(80, (newWidth / rect.width) * 100)) * 10) / 10;
                leftPaneSlot.style.flexBasis = `${percentage}%`;
            };

            const onMouseUp = () => {
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                // ドラッグ終了時に参照をクリアする
                this.dragMouseMove = null;
                this.dragMouseUp = null;
            };

            // ドラッグ中のリスナー参照を保持する（destroy() 時の強制解除のため）
            this.dragMouseMove = onMouseMove;
            this.dragMouseUp = onMouseUp;

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };
        resizeHandle.addEventListener('mousedown', this.boundResizeMouseDown);

        // 右ペインスロット（ScrollbarMarkerTrack 配置用ラッパー）
        const rightPaneSlot = document.createElement('div');
        rightPaneSlot.classList.add('diff-pane-right-slot');
        diffTabContent.appendChild(rightPaneSlot);

        // 右ペイン（現在版 = 変更後）
        const rightPaneElement = document.createElement('div');
        rightPaneElement.classList.add('diff-pane-right');
        rightPaneSlot.appendChild(rightPaneElement);
        this.rightPaneElement = rightPaneElement;

        // 右ペインラベル（バージョン比較時のコミット情報表示。nullの場合は非表示）
        if (rightLabel !== null) {
            const rightLabelElement = document.createElement('div');
            rightLabelElement.classList.add('diff-pane-label-right');
            rightLabelElement.textContent = rightLabel;
            rightPaneElement.appendChild(rightLabelElement);
        }

        // 左右ペイン用のストアキー（差分タブ専用の名前空間を使用して通常テーブルと衝突しない）
        const leftTableKey = tableName + ':diff:head';
        const rightTableKey = tableName + ':diff:current';
        this.leftTableKey = leftTableKey;
        this.rightTableKey = rightTableKey;

        // 左ペイン（HEAD版）はドロップダウン不要のため dropdownContainer=null を渡す
        const leftResult = this.buildDiffEditorTable(
            leftTableKey, schemaJson, displayHeader, leftRows,
            leftPaneElement, null, store, referenceDataCache, contextMenu, tabButton, sidebar, notification
        );
        this.leftEditorTable = leftResult.editorTable;
        this.leftEditorTableHandler = leftResult.editorTableHandler;
        this.leftHistory = leftResult.history;
        this.leftAreaResizer = leftResult.areaResizer;
        this.leftFillController = leftResult.fillController;

        // 左ペインの参照ヒントを設定する（通常テーブルと同パターン）
        tabReference.preloadReferenceTables(leftResult.tableData, this.leftEditorTable);
        tabReference.resolveReverseReferencesAsync(tableName, this.leftEditorTable);

        // 右ペイン（現在版）: staged=falseのときのみドロップダウンを有効化する。
        // overflow:auto のスクロールコンテナ（rightPaneElement）の外側に配置することでクリッピングを防ぐ。
        // staged=trueの場合は makeReadOnly() が呼ばれるためドロップダウンDOMは不要（null を渡す）。
        const rightResult = this.buildDiffEditorTable(
            rightTableKey, schemaJson, displayHeader, rightRows,
            rightPaneElement, isStaged ? null : wrapperElement, store, referenceDataCache, contextMenu, tabButton, sidebar, notification
        );
        this.rightEditorTable = rightResult.editorTable;
        this.rightEditorTableHandler = rightResult.editorTableHandler;
        this.rightHistory = rightResult.history;
        this.rightAreaResizer = rightResult.areaResizer;
        this.rightFillController = rightResult.fillController;

        // 右ペインの参照ヒントを設定する（通常テーブルと同パターン）
        tabReference.preloadReferenceTables(rightResult.tableData, this.rightEditorTable);
        tabReference.resolveReverseReferencesAsync(tableName, this.rightEditorTable);

        // ValidationPanel が接続されており、かつ staged でない場合のみ右ペインにバリデーションを接続する。
        // staged 状態では右ペインも makeReadOnly() で読み取り専用のためバリデーション不要。
        // 左ペインは常に読み取り専用のためバリデーション不要。
        if (validationPanel !== false && !isStaged) {
            validationPanel.registerSchema(
                rightTableKey,
                rightResult.tableData.primaryKeyColumns,
                rightResult.tableData.header.map(col => ({ name: col.name, type: col.type, reference: col.reference, defaultValue: col.defaultValue }))
            );
            this.rightEditorTable.connectValidationPanel(validationPanel);
            this.validationPanel = validationPanel;
        } else {
            this.validationPanel = false;
        }

        // 左右EditorTableに自身（DiffTab）を接続する（排他制御のため）
        // RelationsPanel.connectEditorTable() と対称的なパターン
        this.leftEditorTable.diffTab = this;
        this.rightEditorTable.diffTab = this;

        // CSV列インデックス ↔ DOM列インデックスの双方向マップを構築する。
        // columnMapping[domIndex] = csvIndex なので、逆引きは Map<csvIndex, domIndex> となる。
        // スキーマに定義されていないCSV列（-1 のエントリ）はマップに含めない。
        // 左右ペインはどちらも同じスキーマ由来なので leftResult で代表する。
        const csvIndexToDomIndex = new Map<number, number>();
        const domIndexToCsvIndex = new Map<number, number>();
        for (let domIdx = 0; domIdx < leftResult.tableData.columnMapping.length; domIdx++) {
            const csvIdx = leftResult.tableData.columnMapping[domIdx];
            if (csvIdx !== -1) {
                csvIndexToDomIndex.set(csvIdx, domIdx);
                domIndexToCsvIndex.set(domIdx, csvIdx);
            }
        }
        this.domIndexToCsvIndex = domIndexToCsvIndex;

        // newColumnIndices（displayHeader/CSVインデックス）をDOM列インデックスに変換する
        const newColumnDomIndices = new Set<number>();
        for (const csvIdx of newColumnIndices) {
            if (csvIndexToDomIndex.has(csvIdx)) {
                newColumnDomIndices.add(csvIndexToDomIndex.get(csvIdx)!);
            }
        }
        this.newColumnDomIndices = newColumnDomIndices;

        // 差分クラスのデータモデルを構築する（仮想スクロールの renderRow フックで適用される）
        this.buildDiffClassData(
            leftEmptyRowIndices, rightEmptyRowIndices,
            leftDeletedRowIndices, rightAddedRowIndices,
            leftModifiedCells, rightModifiedCells,
            csvIndexToDomIndex,
            newColumnIndices
        );

        // diffTab 接続と diffClassData 構築が完了した後、仮想スクロールの全行を再生成する。
        // initialize() 時点では diffTab 未接続のため diffフックが通らず、
        // diffクラスが適用されていない行がDOMに存在する。全行を破棄して renderRowForVirtualScroll 経由で
        // 再生成することで、buildDiffClassData で構築したデータに基づくdiffクラスが正しく適用される。
        this.leftEditorTable.forceVirtualScrollFullRerender();
        this.rightEditorTable.forceVirtualScrollFullRerender();

        // 差分マーカートラックを各EditorTableの実スクロール領域に配置する。
        this.leftTrack = this.leftEditorTable.createScrollbarMarkerTrack('scrollbar-marker-track');
        this.rightTrack = this.rightEditorTable.createScrollbarMarkerTrack('scrollbar-marker-track');

        // 左ペイン（HEAD版）は常に読み取り専用にする
        // makeReadOnly() により Ctrl+S も禁止される（不正パスへの書き込み防止）
        this.leftEditorTable.makeReadOnly();

        // 右ペイン（現在版）のストアキーは "tableName:diff:current" のような不正パスだが、
        // 元の tableName を保存先としてオーバーライドすることでファイル破壊なく保存できる。
        // staged状態では右ペインも読み取り専用にする（makeReadOnly が Ctrl+S を禁止する）。
        if (isStaged) {
            this.rightEditorTable.makeReadOnly();
        } else {
            this.rightEditorTableHandler.configureDiffRightPane(tableName, gitPath);
            // 差分タブ保存後に通常タブが開かれている場合にDOMを同期するため openEditorTables を設定する。
            // connectOpenEditorTables に Tab.getOpenEditorTables() の参照を渡すことで、
            // 保存時点でそのタブが開かれているかどうかを動的に確認できる。
            this.rightEditorTableHandler.connectOpenEditorTables(openEditorTables);
        }

        this.installPaneScrollProxy(leftPaneElement, this.leftEditorTable);
        this.installPaneScrollProxy(rightPaneElement, this.rightEditorTable);
        this.boundLeftWheel = (e: WheelEvent) => this.redirectPaneWheelToEditorTable(e, this.leftEditorTable);
        this.boundRightWheel = (e: WheelEvent) => this.redirectPaneWheelToEditorTable(e, this.rightEditorTable);
        leftPaneElement.addEventListener('wheel', this.boundLeftWheel, { passive: false });
        rightPaneElement.addEventListener('wheel', this.boundRightWheel, { passive: false });

        // スクロール同期（左→右、右→左の双方向）—— destroy() で解除するためバインド済み関数をフィールドに保持する
        // 差分タブも通常テーブルと同じ内部スクロールレイアウトを使うため、
        // 外側ペインではなく EditorTable から bubbled する scroll metrics イベントで同期する。
        this.boundLeftScroll = () => {
            if (this.isSyncing) return;
            this.isSyncing = true;
            try {
                const metrics = this.leftEditorTable.getScrollMetrics();
                this.rightEditorTable.restoreScrollPosition(metrics.scrollTop, metrics.scrollLeft);
                this.savedScrollTop = metrics.scrollTop;
                this.savedScrollLeft = metrics.scrollLeft;
                this.notifyUiStateChange();
            } finally {
                this.isSyncing = false;
            }
        };
        this.boundRightScroll = () => {
            if (this.isSyncing) return;
            this.isSyncing = true;
            try {
                const metrics = this.rightEditorTable.getScrollMetrics();
                this.leftEditorTable.restoreScrollPosition(metrics.scrollTop, metrics.scrollLeft);
                this.savedScrollTop = metrics.scrollTop;
                this.savedScrollLeft = metrics.scrollLeft;
                this.notifyUiStateChange();
            } finally {
                this.isSyncing = false;
            }
        };
        leftPaneElement.addEventListener('editor-table-scroll-metrics-changed', this.boundLeftScroll);
        rightPaneElement.addEventListener('editor-table-scroll-metrics-changed', this.boundRightScroll);

        // 初期状態: 左ペイン（HEAD版）を非アクティブ表示にする（右ペインが操作対象）
        this.leftEditorTable.setInactiveAppearance(true);
    }

    /**
     * 右ペインで行が挿入されたことを通知する。
     * 左ペインの同一位置の行がすでに diff-row-deleted を持つ場合は「削除のUndo」として扱い、
     * パディング行挿入の代わりに diff-row-deleted クラスの除去と右ペインの旧パディング行削除を行う。
     * それ以外の場合（通常の行挿入）は左ペインの同一位置にパディング行（diff-row-empty + diff-row-padding-inserted）を挿入して行数を同期する。
     * diff-row-padding-inserted は insertRowInternal で追加したパディング行を識別するためのマーカークラスで、
     * notifyRightPaneRowDeleted がUndo文脈（挿入した空行の削除）とデータ行削除を区別するために使用する。
     * @param rowIndex DOM行インデックス（1始まり、0がヘッダー行）
     */
    notifyRightPaneRowInserted(rowIndex: number): void {
        // dataRowIndex（0始まり）に変換
        const dataRowIndex = rowIndex - 1;
        // 左ペインの対応行が diff-row-deleted を持つ場合は「削除のUndo」として処理する
        const leftRowClasses = this.leftRowClasses.get(dataRowIndex);
        if (leftRowClasses !== undefined && leftRowClasses.includes('diff-row-deleted')) {
            // 削除のUndo: データモデルから diff-row-deleted を除去
            const idx = leftRowClasses.indexOf('diff-row-deleted');
            leftRowClasses.splice(idx, 1);
            if (leftRowClasses.length === 0) this.leftRowClasses.delete(dataRowIndex);
            // 右ペインのデータモデルからパディング行マークを除去する
            const rightClasses = this.rightRowClasses.get(dataRowIndex);
            if (rightClasses !== undefined) {
                const emptyIdx = rightClasses.indexOf('diff-row-empty');
                if (emptyIdx !== -1) rightClasses.splice(emptyIdx, 1);
                if (rightClasses.length === 0) this.rightRowClasses.delete(dataRowIndex);
            }
            // DOM更新（行がDOM上に存在する場合のみ）
            const leftRow = this.leftEditorTable.getRowElementForInsert(dataRowIndex + 1);
            if (leftRow !== null) leftRow.classList.remove('diff-row-deleted');
            // 右ペインの旧パディング化行（insertRowInternal が押し出した位置 = rowIndex+1）を削除する
            const oldPaddingRow = this.rightEditorTable.getRowElementForInsert(rowIndex + 1);
            if (oldPaddingRow !== null) {
                oldPaddingRow.remove();
                // insertRowInternal で notifyVirtualScrollRowAppended 済みだが、
                // パディング行を remove したため renderedEnd を1つ戻す
                this.rightEditorTable.notifyVirtualScrollRowRemoved();
            }
            // notifyRightPaneRowDeleted の「通常データ行削除」パスでストアにパディング空行を再挿入しているため、
            // insertRowInternal がストアに行挿入した分が余剰になる。パディング空行を除去してストアを元に戻す。
            // insertRowInternal はデータ行を dataRowIndex に挿入し、パディング空行は dataRowIndex+1 に押し出されている。
            this.rightEditorTable.getStore().removeRow(this.rightTableKey, dataRowIndex + 1);
            this.rightEditorTable.rebuildStoreRowIndicesForDiff();
            this.rightEditorTable.syncVirtualScrollTotalRowCount();
            // 仮想スクロールの再計算（DOM要素が変わったため）
            this.leftEditorTable.forceVirtualScrollRecalculate();
            this.rightEditorTable.forceVirtualScrollRecalculate();
            this.refreshDiffMarkers();
            return;
        }
        // 通常の行挿入: データモデルのインデックスを dataRowIndex 以降で +1 シフトする
        this.shiftDiffDataIndices(dataRowIndex, 1);
        // 挿入位置にパディング行のデータを設定する
        this.leftRowClasses.set(dataRowIndex, ['diff-row-empty', 'diff-row-padding-inserted']);
        // headRowValuesPerDomRow に null を挿入して行インデックスを同期する
        this.headRowValuesPerDomRow.splice(dataRowIndex, 0, null);
        // 左ペインのストアにも空行を挿入して仮想スクロールの行数を同期する
        this.leftEditorTable.getStore().insertRowAt(this.leftTableKey, dataRowIndex, Array(this.leftEditorTable.getColumnCount()).fill(''));
        // 左ペインの storeRowIndices を再構築する
        this.leftEditorTable.rebuildStoreRowIndicesForDiff();
        // 左ペインの仮想スクロールの総行数を更新し、全行を再生成する。
        // storeRowIndicesが変わったため既存DOM行は無効。forceFullRerenderで再生成する。
        this.leftEditorTable.syncVirtualScrollTotalRowCount();
        this.leftEditorTable.forceVirtualScrollFullRerender();
        this.refreshDiffMarkers();
    }

    /**
     * 右ペインで行が削除されようとしていることを通知する。
     * 左ペインの対応行が diff-row-padding-inserted（insertRowInternal で追加したパディング行）の場合:
     *   - 左ペインのパディング行を DOM から削除する（行挿入のUndo）
     *   - 右ペインの該当行も DOM から削除する
     * そうでない場合（通常のデータ行削除）:
     *   - 右ペインの該当行をパディング行（diff-row-empty）に変換してDOMを残す
     *   - 左ペインの同一位置の行に diff-row-deleted クラスを付与する
     * @param rowIndex DOM行インデックス（1始まり）
     * @param rightRow 右ペインの削除対象DOM行要素
     */
    notifyRightPaneRowDeleted(rowIndex: number, rightRow: HTMLElement): void {
        const dataRowIndex = rowIndex - 1;
        // 左ペインの対応行が行挿入で追加したパディング行かどうかを確認する（データモデルで判定）
        const leftClasses = this.leftRowClasses.get(dataRowIndex);
        if (leftClasses !== undefined && leftClasses.includes('diff-row-padding-inserted')) {
            // 行挿入のUndo: 左ペインのパディング行データを削除し、右ペインのDOM行も削除する
            this.leftRowClasses.delete(dataRowIndex);
            rightRow.remove();
            // headRowValuesPerDomRow から挿入行を削除して行インデックスを同期する
            this.headRowValuesPerDomRow.splice(dataRowIndex, 1);
            // 左ペインのストアから行を削除する
            this.leftEditorTable.getStore().removeRow(this.leftTableKey, dataRowIndex);
            // データモデルのインデックスを dataRowIndex 以降で -1 シフトする
            this.shiftDiffDataIndices(dataRowIndex, -1);
            // 左ペインの storeRowIndices を再構築する
            this.leftEditorTable.rebuildStoreRowIndicesForDiff();
            this.leftEditorTable.syncVirtualScrollTotalRowCount();
            this.leftEditorTable.forceVirtualScrollFullRerender();
        } else {
            // 通常のデータ行削除: 右ペインをパディング行に置き換え、左ペインに削除マークを付与する。
            // createPaddingRow() でイベントリスナーなしの軽量な空行を生成して replaceWith() で差し替える。
            const newPaddingRow = this.rightEditorTable.createPaddingRow(rowIndex);
            newPaddingRow.classList.add('diff-row-empty');
            rightRow.replaceWith(newPaddingRow);
            // deleteRow がストアから行を削除し storeRowIndices を縮小済みだが、
            // DOM上はパディング行として残る。仮想スクロールの totalRowCount と storeRowIndices.length の
            // 不整合を解消するため、ストアにパディング行（空行）を再挿入し storeRowIndices を再構築する。
            this.rightEditorTable.getStore().insertRowAt(this.rightTableKey, dataRowIndex, Array(this.rightEditorTable.getColumnCount()).fill(''));
            this.rightEditorTable.rebuildStoreRowIndicesForDiff();
            // データモデル: 左ペインの行に diff-row-deleted を追加
            if (leftClasses !== undefined) {
                leftClasses.push('diff-row-deleted');
            } else {
                this.leftRowClasses.set(dataRowIndex, ['diff-row-deleted']);
            }
            // 右ペインのデータモデル: この行を空行として記録
            const rightClasses = this.rightRowClasses.get(dataRowIndex);
            if (rightClasses !== undefined) {
                if (!rightClasses.includes('diff-row-empty')) rightClasses.push('diff-row-empty');
            } else {
                this.rightRowClasses.set(dataRowIndex, ['diff-row-empty']);
            }
            // DOM更新（左ペインの行がDOM上に存在する場合のみ）
            const leftRow = this.leftEditorTable.getRowElementForInsert(dataRowIndex + 1);
            if (leftRow !== null) leftRow.classList.add('diff-row-deleted');
        }
        this.refreshDiffMarkers();
    }

    /**
     * diffデータモデルのインデックスをシフトする。
     * 行挿入（direction=1）時は fromDataRowIndex 以降のインデックスを +1、
     * 行削除（direction=-1）時は fromDataRowIndex+1 以降のインデックスを -1 する。
     */
    private shiftDiffDataIndices(fromDataRowIndex: number, direction: 1 | -1): void {
        // direction=1: fromDataRowIndex 以降を +1（挿入位置を空けるため）
        // direction=-1: fromDataRowIndex+1（=削除された行の次）以降を -1
        const shiftFrom = direction === 1 ? fromDataRowIndex : fromDataRowIndex + 1;
        this.shiftMapKeys(this.leftRowClasses, shiftFrom, direction);
        this.shiftMapKeys(this.rightRowClasses, shiftFrom, direction);
        this.shiftCellClassKeys(this.leftCellClasses, shiftFrom, direction);
        this.shiftCellClassKeys(this.rightCellClasses, shiftFrom, direction);
        // rightAddedRows のインデックスシフト（インライン展開: 1箇所のみ使用）
        const toShift: number[] = [];
        for (const value of this.rightAddedRows) {
            if (value >= shiftFrom) toShift.push(value);
        }
        for (const value of toShift) this.rightAddedRows.delete(value);
        for (const value of toShift) this.rightAddedRows.add(value + direction);
        this.shiftMapKeys(this.rightPaddingStoreIndices, shiftFrom, direction);
    }

    /** Map<number, V> のキーをシフトする */
    private shiftMapKeys<V>(map: Map<number, V>, fromIndex: number, direction: 1 | -1): void {
        const entries: Array<[number, V]> = [];
        for (const [key, value] of map) {
            if (key >= fromIndex) {
                entries.push([key, value]);
                map.delete(key);
            }
        }
        for (const [key, value] of entries) {
            map.set(key + direction, value);
        }
    }

    /** セルクラスMap（"row,col" キー）の行インデックスをシフトする */
    private shiftCellClassKeys(map: Map<string, string>, fromIndex: number, direction: 1 | -1): void {
        const entries: Array<[string, string]> = [];
        for (const [key, value] of map) {
            const commaIdx = key.indexOf(',');
            const rowIdx = parseInt(key.substring(0, commaIdx));
            if (rowIdx >= fromIndex) {
                entries.push([key, value]);
                map.delete(key);
            }
        }
        for (const [key, value] of entries) {
            const commaIdx = key.indexOf(',');
            const rowIdx = parseInt(key.substring(0, commaIdx));
            const col = key.substring(commaIdx);
            map.set(`${rowIdx + direction}${col}`, value);
        }
    }

    /**
     * 右ペインの初期パディング行（.diff-row-initial-padding クラスを持つ行）のストア行インデックスを返す。
     * 保存時にこれらの行をCSVから除外してパディング行の混入を防ぐために使用する。
     *
     * 右ペインの .diff-row-empty 行は2種類ある：
     * 1. 初期パディング行（左ペインにデータがあり右ペインに対応行がない差分行）:
     *    applyDiffClasses() で diff-row-initial-padding クラスと data-padding-store-index 属性が付与される。
     *    → 保存時に除外してCSVに空行が混入しないようにする必要がある。
     * 2. ユーザーが右ペインのデータ行を削除した後に生成されたパディング行:
     *    notifyRightPaneRowDeleted() で生成され、diff-row-empty のみ（diff-row-initial-padding なし）。
     *    → ストア上に既に存在しないため除外対象に含める必要がない。
     *
     * diff-row-initial-padding クラスの有無で2種類を明確に区別できるため、
     * storeRowIndices（行削除で詰まる）に依存せずに正確なインデックスを返せる。
     * 各行の data-padding-store-index 属性には生成時のストアインデックスが記録されており、
     * 行挿入・削除・Undo/Redoが発生しても属性値は変わらないため安全。
     */
    computeCurrentRightPaddingStoreRowIndices(): readonly number[] {
        // データモデルから直接取得する（DOM走査不要）
        return Array.from(this.rightPaddingStoreIndices.values());
    }

    /**
     * 右ペインのセルが編集されたときに、HEAD版と比較してdiff-cell-added / diff-cell-deleted を動的に更新する。
     * updateCellValueAt() からセル値がストア・DOMに反映された後に呼ばれる。
     *
     * @param domRow DOM行インデックス（1始まり、0がヘッダー行）
     * @param domColumn DOM列インデックス（1始まり、0が行ヘッダー）
     * @param newValue 編集後の値
     */
    notifyCellEdited(domRow: number, domColumn: number, newValue: string): void {
        // DOM行インデックス（1始まり） → データ行インデックス（0始まり）
        const dataRowIndex = domRow - 1;
        if (dataRowIndex < 0 || dataRowIndex >= this.headRowValuesPerDomRow.length) return;
        const headValues = this.headRowValuesPerDomRow[dataRowIndex];
        // HEAD版が存在しない行（追加行）は常に diff-cell-added を維持する（除去不要）
        if (headValues === null) return;
        // DOM列インデックス（1始まり、行ヘッダー含む） → DOM列インデックス（0始まり、行ヘッダー除外）
        const domColIndex = domColumn - 1;
        // DOM列インデックス → CSV列インデックスに変換する（スキーマにないCSV列はスキップ）
        if (!this.domIndexToCsvIndex.has(domColIndex)) return;
        const csvColIndex = this.domIndexToCsvIndex.get(domColIndex) as number;
        // HEAD版の該当セル値を取得する
        const headValue = csvColIndex < headValues.length ? headValues[csvColIndex] : '';
        const isNewColumn = this.newColumnDomIndices.has(domColIndex);
        const leftCellKey = `${dataRowIndex},${domColIndex}`;
        const rightCellKey = `${dataRowIndex},${domColIndex}`;
        // データモデルを更新する（常に実行。仮想スクロールでDOM外の行でもデータは最新に保つ）
        if (newValue === headValue) {
            this.leftCellClasses.delete(leftCellKey);
            this.rightCellClasses.delete(rightCellKey);
        } else if (isNewColumn) {
            this.leftCellClasses.set(leftCellKey, 'diff-cell-new-column');
            this.rightCellClasses.set(rightCellKey, 'diff-cell-added');
        } else {
            this.leftCellClasses.set(leftCellKey, 'diff-cell-deleted');
            this.rightCellClasses.set(rightCellKey, 'diff-cell-added');
        }
        // DOM更新: 右ペインの行は updateCellValueAt で getRowElement チェック済みのためDOMに存在する。
        // 左ペインは別の VirtualScrollController なので DOM 上に行が存在しない場合がある。
        const rightCell = this.rightEditorTable.getCellOrNull(domRow, domColumn);
        const leftCell = this.leftEditorTable.getCellOrNull(domRow, domColumn);
        if (rightCell !== null) {
            if (newValue === headValue) {
                rightCell.classList.remove('diff-cell-added', 'diff-cell-new-column');
            } else {
                rightCell.classList.add('diff-cell-added');
            }
        }
        if (leftCell !== null) {
            if (newValue === headValue) {
                leftCell.classList.remove('diff-cell-deleted', 'diff-cell-new-column');
            } else if (isNewColumn) {
                leftCell.classList.add('diff-cell-new-column');
            } else {
                leftCell.classList.add('diff-cell-deleted');
            }
        }
        // セル編集で差分クラスが変わるためマーカーを再計算する
        this.refreshDiffMarkers();
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
     * グローバル Ctrl+S から呼ばれる保存処理。右ペインの EditorTableHandler.save() に委譲する。
     */
    saveRightPane(): void {
        this.rightEditorTableHandler.save();
    }

    connectUiStateChangeListener(listener: () => void): void {
        this.uiStateChangeListener = listener;
    }

    getScrollPosition(): { scrollLeft: number; scrollTop: number } {
        if (this.wrapperElement.style.display === 'none') {
            return {
                scrollLeft: Math.max(0, Math.round(this.savedScrollLeft)),
                scrollTop: Math.max(0, Math.round(this.savedScrollTop)),
            };
        }
        return {
            scrollLeft: Math.max(0, Math.round(this.leftEditorTable.getScrollLeft())),
            scrollTop: Math.max(0, Math.round(this.leftEditorTable.getScrollTop())),
        };
    }

    restoreScrollPosition(scrollTop: number, scrollLeft: number): void {
        this.savedScrollTop = Math.max(0, Math.round(scrollTop));
        this.savedScrollLeft = Math.max(0, Math.round(scrollLeft));
        if (this.wrapperElement.style.display === 'none') return;
        this.leftEditorTable.restoreScrollPosition(this.savedScrollTop, this.savedScrollLeft);
        this.rightEditorTable.restoreScrollPosition(this.savedScrollTop, this.savedScrollLeft);
    }

    private notifyUiStateChange(): void {
        if (this.uiStateChangeListener !== false) this.uiStateChangeListener();
    }

    /**
     * 差分タブのラッパー要素を表示する。
     * hide() で保存したスクロール位置を復元し、行ヘッダーを現在のscrollLeftに同期する。
     * display:none → display:'' ではブラウザがscrollLeftを0にリセットするが
     * scrollイベントが発火しないため、明示的に行ヘッダー位置を補正する必要がある。
     */
    show(): void {
        this.wrapperElement.style.display = '';
        // display:none 中にブラウザがリセットしたスクロール位置を左右両ペインに復元する
        this.leftEditorTable.restoreScrollPosition(this.savedScrollTop, this.savedScrollLeft);
        this.rightEditorTable.restoreScrollPosition(this.savedScrollTop, this.savedScrollLeft);
        // ラベルはテーブルホストの外側に置くため、列ヘッダー行の追加オフセットは不要。
        this.applyLabelOffsetToColumnHeaders();
        // 仮想スクロールの再計算（display:none → display:'' でビューポートサイズが変わるため）
        this.leftEditorTable.forceVirtualScrollRecalculate();
        this.rightEditorTable.forceVirtualScrollRecalculate();
        // display:none 解除後にSelectionの視覚位置をレイアウトに基づいて更新する
        this.leftEditorTable.refreshSelectionDisplay();
        this.rightEditorTable.refreshSelectionDisplay();
        // display:none 解除後にDOMレイアウトが確定するため、差分マーカーを計算・描画する
        this.refreshDiffMarkers();
    }

    /** 差分タブではラベルをテーブル外に置くため、列ヘッダー行の追加オフセットを使わない */
    private applyLabelOffsetToColumnHeaders(): void {
        this.leftEditorTable.setDetachedHeaderTopOffset(0);
        this.rightEditorTable.setDetachedHeaderTopOffset(0);
    }

    /**
     * 差分タブのラッパー要素を非表示にする。
     * display:none 設定前にスクロール位置を保存する（ブラウザが scrollLeft を 0 にリセットするため）。
     * 全diffTabに対して forEach で呼ばれるため、既に非表示の場合は早期リターンする。
     * （display:none 後は scrollLeft が 0 にリセット済みのため、保存値を上書きしてはならない）
     */
    hide(): void {
        if (this.wrapperElement.style.display === 'none') return;
        // display:none にするとブラウザがscrollLeftを0にリセットするため、事前に保存する
        this.savedScrollLeft = this.leftEditorTable.getScrollLeft();
        this.savedScrollTop = this.leftEditorTable.getScrollTop();
        this.wrapperElement.style.display = 'none';
    }

    /**
     * 差分タブのDOMを削除してリソースを解放する
     * ストアのテーブルデータとHistoryを解除してからDOMを削除する
     */
    destroy(store: InMemoryTableStore): void {
        // スクロールリスナーを解除する（DOM除去後もガベージコレクションされるよう明示的に解除）
        this.leftPaneElement.removeEventListener('editor-table-scroll-metrics-changed', this.boundLeftScroll);
        this.rightPaneElement.removeEventListener('editor-table-scroll-metrics-changed', this.boundRightScroll);
        this.leftPaneElement.removeEventListener('wheel', this.boundLeftWheel);
        this.rightPaneElement.removeEventListener('wheel', this.boundRightWheel);
        // リサイズハンドルの mousedown リスナーを解除する
        this.resizeHandle.removeEventListener('mousedown', this.boundResizeMouseDown);
        // ドラッグ操作中に destroy() が呼ばれた場合、document に残存するリスナーを強制解除する
        if (this.dragMouseMove !== null) {
            document.removeEventListener('mousemove', this.dragMouseMove);
            this.dragMouseMove = null;
        }
        if (this.dragMouseUp !== null) {
            document.removeEventListener('mouseup', this.dragMouseUp);
            this.dragMouseUp = null;
        }
        // ドラッグ操作中に destroy() が呼ばれた場合のカーソル・ユーザー選択スタイルをリセットする
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        // 差分マーカートラックの ResizeObserver を解放する
        this.leftTrack.destroy();
        this.rightTrack.destroy();
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
        // バリデーションスキーマを登録解除する（DiffTab開閉でスキーマが残留するのを防ぐ）
        if (this.validationPanel !== false) {
            this.validationPanel.unregisterSchema(this.rightTableKey);
        }
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
        dropdownContainer: HTMLElement | null,
        store: InMemoryTableStore,
        referenceDataCache: ReferenceDataCache,
        contextMenu: ContextMenu,
        tabButton: TabButton,
        sidebar: Sidebar,
        notification: NotificationToast
    ): { editorTable: EditorTable; editorTableHandler: EditorTableHandler; history: History; areaResizer: AreaResizer; fillController: FillController; tableData: EditorTableData } {
        // スキーマをパースしてEditorTableDataを構築する
        const schemaObj = JSON.parse(schemaJson) as Record<string, unknown>;
        const csv = new Csv();
        csv.header = displayHeader;
        csv.body = dataRows;
        // 差分ビューはミニテーブルとして生成されるためフィルター・ソートアイコンは持たない。hasIcons: false
        const tableData = EditorTableData.parse(schemaObj, csv, false);

        // ストアに登録する（History コンストラクタで registerHistory が呼ばれるためストア登録が先）
        store.registerTable(tableKey, csv.header, csv.body);

        // 相互参照解決のため一時的な空オブジェクトを作成（Tab.createEditorTable・createMiniEditorTable と同パターン）
        const editorTable = {} as EditorTable;

        // ペイン内にテーブルホストを配置する。
        // GridTextField/Selection/AreaResizer の position:absolute の含有ブロック（position:relative）となる。
        // 通常テーブル（tab.ts の wrapperElement）やミニテーブル（createMiniEditorTable の wrapperElement）と同じパターン。
        const innerWrapper = document.createElement('div');
        innerWrapper.classList.add('diff-pane-inner');
        paneElement.appendChild(innerWrapper);

        const mainViewportElement = document.createElement('div');
        mainViewportElement.classList.add('editor-table-main-viewport');

        // scrollControllerの対象は EditorTable 内部の本文スクロール領域
        const scrollController = new ScrollViewportController(mainViewportElement);

        const selection = new Selection(editorTable, innerWrapper, scrollController);
        const history = new History(editorTable, tabButton, store, tableKey, 100);
        const editorTableHandler = new EditorTableHandler(editorTable, selection, history, scrollController, notification);
        const textField = editorTableHandler.createGridTextField(innerWrapper, editorTable, selection);
        editorTableHandler.setTextField(textField);

        const areaResizer = new AreaResizer(innerWrapper, history, selection);

        // isMiniTable=true（RelationsPanel連携なし）、enableVirtualScroll=true（大量行に対応）
        // emptyRowCount=0: 差分テーブルはバッファ行を持たない
        const realEditorTable = new EditorTable(
            tableKey, tableData, referenceDataCache, store, editorTableHandler,
            selection, contextMenu, history, areaResizer,
            scrollController, sidebar, mainViewportElement, 0, 'editor-table', true, true, true
        );

        Object.assign(editorTable, realEditorTable);
        Object.setPrototypeOf(editorTable, EditorTable.prototype);
        editorTable.initializeModules(notification);

        editorTable.appendTo(innerWrapper);
        innerWrapper.appendChild(selection.fillPreviewElement);
        innerWrapper.appendChild(selection.fillHandle);
        editorTableHandler.appendTo(innerWrapper);

        areaResizer.setEditorTable(editorTable);
        editorTable.initialize();

        const fillController = new FillController(editorTable, selection, history);
        fillController.initialize();

        areaResizer.activate();
        editorTable.activate();

        // ドロップダウンコンテナが指定されている場合のみドロップダウンを生成・設定する。
        // overflow:auto のスクロールコンテナ（paneElement）の外側に配置することでクリッピングを防ぐ。
        // ミニテーブル（tab.ts 1219行）と同パターン。
        if (dropdownContainer !== null) {
            // 差分タブでは DropdownQuickView は接続しない（差分は読み取り専用のためクイックビュー不要）
            const dropdownInput: GridDropdownInput = editorTableHandler.createDropdownInput(dropdownContainer);
            editorTableHandler.setReferenceComponents(referenceDataCache, dropdownInput, tableData);
        }

        return { editorTable, editorTableHandler, history, areaResizer, fillController, tableData };
    }

    /**
     * 旧実装では .diff-pane-left / .diff-pane-right 自体がスクロールコンテナだった。
     * 通常テーブルと同じ内部スクロールレイアウトへ移行しても、既存のテストや外部コードが
     * pane.scrollTop / pane.scrollLeft を使えるよう EditorTable のスクロール位置に委譲する。
     */
    private installPaneScrollProxy(paneElement: HTMLElement, editorTable: EditorTable): void {
        Object.defineProperty(paneElement, 'scrollTop', {
            configurable: true,
            get: () => editorTable.getScrollTop(),
            set: (value: number) => {
                editorTable.restoreScrollPosition(Number(value), editorTable.getScrollLeft());
            },
        });
        Object.defineProperty(paneElement, 'scrollLeft', {
            configurable: true,
            get: () => editorTable.getScrollLeft(),
            set: (value: number) => {
                editorTable.restoreScrollPosition(editorTable.getScrollTop(), Number(value));
            },
        });
    }

    private redirectPaneWheelToEditorTable(event: WheelEvent, editorTable: EditorTable): void {
        if (event.ctrlKey) return;
        if (!(event.target instanceof Element)) return;
        const mainViewport = (event.currentTarget as HTMLElement).querySelector('.editor-table-main-viewport');
        if (mainViewport instanceof HTMLElement && mainViewport.contains(event.target)) return;

        let deltaX = event.deltaX;
        let deltaY = event.deltaY;
        if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
            deltaX *= 16;
            deltaY *= 16;
        } else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
            const paneElement = event.currentTarget as HTMLElement;
            deltaX *= paneElement.clientWidth;
            deltaY *= paneElement.clientHeight;
        }
        if (event.shiftKey && deltaX === 0 && deltaY !== 0) {
            deltaX = deltaY;
            deltaY = 0;
        }

        event.preventDefault();
        editorTable.scrollByInput(deltaY, deltaX);
    }

    /**
     * 差分クラスのデータモデルを構築する。
     * DOM操作は行わず、データモデル（leftRowClasses, rightRowClasses 等）にデータを蓄積する。
     * 仮想スクロールの renderRow フック（applyDiffDecorationsToRow）経由でDOMに適用される。
     *
     * @param csvIndexToDomIndex CSV列インデックス → DOM列インデックスの逆引きマップ。
     *   スキーマに定義されていないCSV列はマップに含まれないためスキップされる。
     */
    private buildDiffClassData(
        leftEmptyRowIndices: number[],
        rightEmptyRowIndices: number[],
        leftDeletedRowIndices: number[],
        rightAddedRowIndices: number[],
        leftModifiedCells: Array<{ row: number; col: number }>,
        rightModifiedCells: Array<{ row: number; col: number }>,
        csvIndexToDomIndex: Map<number, number>,
        newColumnIndices: ReadonlySet<number>
    ): void {
        // 左ペインの空白行（追加行に対応する空白）
        for (const rowIdx of leftEmptyRowIndices) {
            this.leftRowClasses.set(rowIdx, ['diff-row-empty']);
        }
        // 右ペインの空白行（削除行に対応する空白）: 初期パディング行
        for (const rowIdx of rightEmptyRowIndices) {
            this.rightRowClasses.set(rowIdx, ['diff-row-empty', 'diff-row-initial-padding']);
            this.rightPaddingStoreIndices.set(rowIdx, rowIdx);
        }
        // 左ペインの削除行
        for (const rowIdx of leftDeletedRowIndices) {
            const existing = this.leftRowClasses.get(rowIdx);
            if (existing !== undefined) {
                existing.push('diff-row-deleted');
            } else {
                this.leftRowClasses.set(rowIdx, ['diff-row-deleted']);
            }
        }
        // 右ペインの追加行
        for (const rowIdx of rightAddedRowIndices) {
            this.rightAddedRows.add(rowIdx);
        }
        // 左ペインの変更セル（新規列は灰色、それ以外は赤色）
        for (const { row: rowIdx, col: csvColIdx } of leftModifiedCells) {
            const domColIdx = csvIndexToDomIndex.get(csvColIdx);
            if (domColIdx === undefined) continue;
            const className = newColumnIndices.has(csvColIdx) ? 'diff-cell-new-column' : 'diff-cell-deleted';
            this.leftCellClasses.set(`${rowIdx},${domColIdx}`, className);
        }
        // 右ペインの変更セル（新規列も含め緑色で統一）
        for (const { row: rowIdx, col: csvColIdx } of rightModifiedCells) {
            const domColIdx = csvIndexToDomIndex.get(csvColIdx);
            if (domColIdx === undefined) continue;
            this.rightCellClasses.set(`${rowIdx},${domColIdx}`, 'diff-cell-added');
        }
    }

    /**
     * 仮想スクロールで行が生成されたときにdiffクラスを適用する。
     * EditorTable.renderRowForVirtualScroll() から呼ばれる。
     *
     * @param rowElement 生成された行DOM要素
     * @param dataRowIndex データ行インデックス（0始まり）
     * @param editorTable 呼び出し元のEditorTable（左右どちらかの判定に使用）
     */
    applyDiffDecorationsToRow(rowElement: HTMLElement, dataRowIndex: number, editorTable: EditorTable): void {
        const isLeft = editorTable === this.leftEditorTable;
        const rowClasses = isLeft ? this.leftRowClasses : this.rightRowClasses;
        const cellClasses = isLeft ? this.leftCellClasses : this.rightCellClasses;

        // 行レベルのクラスを適用
        const classes = rowClasses.get(dataRowIndex);
        if (classes !== undefined) {
            rowElement.classList.add(...classes);
        }
        // 右ペインの初期パディング行に data-padding-store-index 属性を設定
        if (!isLeft) {
            const paddingStoreIndex = this.rightPaddingStoreIndices.get(dataRowIndex);
            if (paddingStoreIndex !== undefined) {
                rowElement.setAttribute('data-padding-store-index', String(paddingStoreIndex));
            }
        }
        // 右ペインの追加行: 全セル（行ヘッダー含む）に diff-cell-added を付与
        if (!isLeft && this.rightAddedRows.has(dataRowIndex)) {
            for (let i = 0; i < rowElement.children.length; i++) {
                (rowElement.children[i] as HTMLElement).classList.add('diff-cell-added');
            }
            return;
        }
        // セルレベルのクラスを適用
        // rowElement.children[0] = 行ヘッダー、children[1〜] = データセル
        // cellClasses のキーは "dataRowIndex,domColIdx" で domColIdx は行ヘッダーを除外した0始まり
        for (let domCol = 1; domCol < rowElement.children.length; domCol++) {
            const key = `${dataRowIndex},${domCol - 1}`;
            const className = cellClasses.get(key);
            if (className !== undefined) {
                (rowElement.children[domCol] as HTMLElement).classList.add(className);
            }
        }
    }

    /**
     * 差分マーカーを再計算してトラックに反映する。
     * データモデルから算術的にマーカー位置を計算する（DOM走査不要）。
     * 左ペイン: 削除行と変更セルを持つ行はすべて赤マーカー。
     * 右ペイン: 追加行と変更セルを持つ行はすべて緑マーカー。
     */
    private refreshDiffMarkers(): void {
        // 左ペイン: 削除行（diff-row-deleted含む行）と変更セルを持つ行を収集
        const leftChangedRows = this.collectChangedDataRows(this.leftRowClasses, this.leftCellClasses, 'diff-row-deleted');
        const leftTotalRows = this.leftEditorTable.getLogicalRowCount() - 1; // ヘッダー行を除くデータ行数
        const leftMarkers = this.buildArithmeticMarkerEntries(leftChangedRows, leftTotalRows);
        this.leftTrack.updateDiff(leftMarkers, []);
        // 右ペイン: 追加行と変更セルを持つ行を収集
        const rightChangedRows = this.collectChangedDataRows(this.rightRowClasses, this.rightCellClasses, null);
        for (const row of this.rightAddedRows) rightChangedRows.add(row);
        const rightTotalRows = this.rightEditorTable.getLogicalRowCount() - 1;
        const rightMarkers = this.buildArithmeticMarkerEntries(rightChangedRows, rightTotalRows);
        this.rightTrack.updateDiff([], rightMarkers);
    }

    /**
     * データモデルから変更のあるデータ行インデックスを収集する。
     * @param rowClasses 行レベルのクラスマップ
     * @param cellClasses セルレベルのクラスマップ
     * @param rowClassName 対象とする行クラス名（null の場合は行クラスを無視）
     */
    private collectChangedDataRows(rowClasses: Map<number, string[]>, cellClasses: Map<string, string>, rowClassName: string | null): Set<number> {
        const result = new Set<number>();
        // 行レベルのクラスから変更行を収集
        for (const [rowIdx, classes] of rowClasses) {
            // diff-row-empty 行はスキップ（パディング行はマーカー対象外）
            if (classes.includes('diff-row-empty')) continue;
            if (rowClassName !== null && classes.includes(rowClassName)) { result.add(rowIdx); continue; }
            // rowClassName=null の場合は行クラスからは収集しない（セルクラスのみ）
        }
        // セルレベルのクラスから変更行を収集（キーは "rowIdx,domColIdx"）
        for (const key of cellClasses.keys()) {
            const commaIdx = key.indexOf(',');
            result.add(parseInt(key.substring(0, commaIdx)));
        }
        return result;
    }

    /**
     * データ行インデックスの集合から算術的にマーカーエントリを構築する。
     * 行の位置は dataRowIndex / totalRows の比率で計算する（DOM要素のoffsetTopは使わない）。
     * 連続する行はマージして1つのエントリにする。
     */
    private buildArithmeticMarkerEntries(changedRows: Set<number>, totalRows: number): MarkerEntry[] {
        if (changedRows.size === 0 || totalRows <= 0) return [];
        const sorted = Array.from(changedRows).sort((a, b) => a - b);
        const rowSize = 1 / totalRows;
        const markers: MarkerEntry[] = [];
        let rangeStart = sorted[0];
        let rangeEnd = sorted[0];
        for (let i = 1; i < sorted.length; i++) {
            if (sorted[i] === rangeEnd + 1) {
                rangeEnd = sorted[i];
            } else {
                markers.push({ start: rangeStart / totalRows, size: (rangeEnd - rangeStart + 1) * rowSize });
                rangeStart = sorted[i];
                rangeEnd = sorted[i];
            }
        }
        markers.push({ start: rangeStart / totalRows, size: (rangeEnd - rangeStart + 1) * rowSize });
        return markers;
    }
}
