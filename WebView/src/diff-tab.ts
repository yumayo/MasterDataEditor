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
import {SchemaJson, buildDiffRows, buildMergedData} from "./diff-rows";
import {TabReference} from "./tab-reference";
import {GridDropdownInput} from "./grid-dropdown-input";
import {NotificationToast} from "./notification";
import {ValidationPanel} from "./validation-panel";
import {ScrollbarMarkerTrack, MarkerEntry} from "./scrollbar-marker-track";

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

    /** スクロール同期の対象となるペイン要素（removeEventListener に必要） */
    private readonly leftPaneElement: HTMLElement;
    private readonly rightPaneElement: HTMLElement;

    /** 差分マーカートラック（左=削除行の赤マーカー、右=追加行の緑マーカー） */
    private readonly leftTrack: ScrollbarMarkerTrack;
    private readonly rightTrack: ScrollbarMarkerTrack;

    /**
     * DOM行インデックス（0始まり） → HEAD版のCSV値配列。
     * 空行（パディング行）や追加行（HEAD版に存在しない行）は null。
     * セル編集後のdiff-cell-added/diff-cell-deleted動的更新に使用する。
     */
    private readonly headRowValuesPerDomRow: ReadonlyArray<string[] | null>;

    /** destroy() 時のスキーマ登録解除に必要なバリデーションパネル参照（staged時は false） */
    private readonly validationPanel: ValidationPanel | false;

    /** DOM列インデックス → CSV列インデックスの順引きマップ（動的更新で使用） */
    private readonly domIndexToCsvIndex: ReadonlyMap<number, number>;

    /** HEAD版に存在しない列のDOM列インデックス集合（新規列を灰色表示するため） */
    private readonly newColumnDomIndices: ReadonlySet<number>;

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

        // 左ペインスロット（ScrollbarMarkerTrack 配置用ラッパー、.editor-left-slot と同パターン）
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

        // 差分クラスをDOM行・セルに付与する（EditorTable生成後）
        this.applyDiffClasses(
            this.leftEditorTable, this.rightEditorTable,
            leftEmptyRowIndices, rightEmptyRowIndices,
            leftDeletedRowIndices, rightAddedRowIndices,
            leftModifiedCells, rightModifiedCells,
            csvIndexToDomIndex,
            newColumnIndices
        );

        // 差分マーカートラックを各ペインスロットに配置する（.editor-left-slot と同パターン）
        this.leftTrack = new ScrollbarMarkerTrack(leftPaneSlot, leftPaneElement, 'vertical', 'scrollbar-marker-track');
        this.rightTrack = new ScrollbarMarkerTrack(rightPaneSlot, rightPaneElement, 'vertical', 'scrollbar-marker-track');

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
        const leftElement = this.leftEditorTable.getTableElement();
        const rightElement = this.rightEditorTable.getTableElement();
        const leftRow = leftElement.children.item(rowIndex) as HTMLElement | null;
        // 左ペインの対応行が diff-row-deleted を持つ場合は「削除のUndo」として処理する。
        // insertRowInternal は rowIndex 位置に新行を挿入済みのため、旧パディング化行は rowIndex+1 に存在する。
        if (leftRow !== null && leftRow.classList.contains('diff-row-deleted')) {
            // 削除のUndo: diff-row-deleted を除去して行を「元の状態」に戻す
            leftRow.classList.remove('diff-row-deleted');
            // 右ペインの旧パディング化行（insertRowInternal が押し出した位置 = rowIndex+1）を削除する
            const oldPaddingRow = rightElement.children.item(rowIndex + 1) as HTMLElement | null;
            if (oldPaddingRow !== null) oldPaddingRow.remove();
            return;
        }
        // 通常の行挿入: 左ペインの rowIndex 位置にパディング行を挿入して行数を同期する。
        // createPaddingRow() はイベントリスナーなしの軽量な空行を返すため、
        // DiffTab 固有のクラスはここで付与する（SRP: EditorTable は diff の知識を持たない）。
        const paddingRow = this.leftEditorTable.createPaddingRow(rowIndex);
        paddingRow.classList.add('diff-row-empty', 'diff-row-padding-inserted');
        // 左ペインの rowIndex 位置に挿入する（insertBefore で rowIndex の前に配置）
        const insertBefore = leftElement.children.item(rowIndex) as HTMLElement | null;
        leftElement.insertBefore(paddingRow, insertBefore);
        // 挿入したパディング行自身も含めて rowIndex 以降を再ナンバリングする
        this.renumberLeftRows(rowIndex);
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
        const leftElement = this.leftEditorTable.getTableElement();
        const leftRow = leftElement.children.item(rowIndex) as HTMLElement | null;
        // 左ペインの対応行が行挿入で追加したパディング行かどうかを確認する
        if (leftRow !== null && leftRow.classList.contains('diff-row-padding-inserted')) {
            // 行挿入のUndo: 左ペインのパディング行と右ペインのDOM行を削除する
            leftRow.remove();
            rightRow.remove();
            // 削除後のdata-row属性を再ナンバリングする
            this.renumberLeftRows(rowIndex);
        } else {
            // 通常のデータ行削除: 右ペインをパディング行に置き換え、左ペインに削除マークを付与する。
            // インプレース変換では元のイベントリスナー（dblclick, mousedown, contextmenu等）が残存するため、
            // createPaddingRow() でイベントリスナーなしの軽量な空行を生成して replaceWith() で差し替える。
            // diff-row-padding-inserted は「行挿入で生成されたパディング行」のマーカーなので付与しない（diff-row-empty のみ）。
            const newPaddingRow = this.rightEditorTable.createPaddingRow(rowIndex);
            newPaddingRow.classList.add('diff-row-empty');
            rightRow.replaceWith(newPaddingRow);
            if (leftRow !== null) leftRow.classList.add('diff-row-deleted');
        }
        this.refreshDiffMarkers();
    }

    /**
     * 左ペインの startDomIndex 以降の data-row 属性・行ヘッダーテキスト・data-rowIndex を再ナンバリングする。
     * notifyRightPaneRowInserted / notifyRightPaneRowDeleted の後に呼ぶ。
     * 差分ビュー左ペインはリサイズハンドルを持たないため、テキストノードの更新のみ行う。
     * ※ EditorTableStructure.renumberRowsFrom() への委譲は不可。
     *   あちらはリサイズハンドルを毎回 appendChild するため、差分ビューのパディング行に
     *   不要なハンドル要素が挿入される副作用がある。独自実装を維持する。
     */
    private renumberLeftRows(startDomIndex: number): void {
        const leftElement = this.leftEditorTable.getTableElement();
        for (let i = startDomIndex; i < leftElement.children.length; i++) {
            const row = leftElement.children[i] as HTMLElement;
            row.dataset.row = String(i);
            const header = row.children[0] as HTMLElement;
            if (!header.classList.contains('editor-table-row-header')) continue;
            // テキストノードを更新する（editor-table-structure.ts の renumberRowsFrom と同パターン）
            let textNode: Text | null = null;
            for (const node of Array.from(header.childNodes)) {
                if (node.nodeType === Node.TEXT_NODE) { textNode = node as Text; break; }
            }
            if (textNode !== null) {
                textNode.textContent = String(i);
            } else {
                header.insertBefore(document.createTextNode(String(i)), header.firstChild);
            }
            header.dataset.rowIndex = String(i - 1);
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
        const rightElement = this.rightEditorTable.getTableElement();
        const result: number[] = [];
        // diff-row-initial-padding クラスを持つ行のみを対象にする。
        // ユーザー削除後のパディング行はこのクラスを持たないため自動的に除外される。
        const paddingRows = rightElement.querySelectorAll('.diff-row-initial-padding');
        for (const row of paddingRows) {
            const attr = (row as HTMLElement).getAttribute('data-padding-store-index');
            if (attr === null) throw new Error('[DiffTab] 初期パディング行に data-padding-store-index 属性がありません');
            result.push(Number(attr));
        }
        return result;
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
        // 右ペインのセルにdiff-cell-addedを付与/除去する
        const rightCell = this.rightEditorTable.getCell(domRow, domColumn);
        // 左ペインの対応セルにdiff-cell-deletedを付与/除去する
        const leftCell = this.leftEditorTable.getCell(domRow, domColumn);
        // 新規列（HEAD版に存在しない列）は diff-cell-new-column を使い、通常の変更列は diff-cell-added/deleted を使う
        const isNewColumn = this.newColumnDomIndices.has(domColIndex);
        if (newValue === headValue) {
            // HEAD版と同じ値 → 差分なし。すべての差分クラスを除去する
            rightCell.classList.remove('diff-cell-added', 'diff-cell-new-column');
            leftCell.classList.remove('diff-cell-deleted', 'diff-cell-new-column');
        } else if (isNewColumn) {
            // 新規列の差分 → 左ペインは灰色（HEAD版に列が存在しない）、右ペインは緑（新データ追加）
            leftCell.classList.add('diff-cell-new-column');
            rightCell.classList.add('diff-cell-added');
        } else {
            // 既存列の差分 → 赤/緑表示（diff-cell-deleted / diff-cell-added）
            rightCell.classList.add('diff-cell-added');
            leftCell.classList.add('diff-cell-deleted');
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

    /**
     * 差分タブのラッパー要素を表示する。
     * hide() で保存したスクロール位置を復元し、行ヘッダーを現在のscrollLeftに同期する。
     * display:none → display:'' ではブラウザがscrollLeftを0にリセットするが
     * scrollイベントが発火しないため、明示的に行ヘッダー位置を補正する必要がある。
     */
    show(): void {
        this.wrapperElement.style.display = '';
        // display:none 中にブラウザがリセットしたスクロール位置を左右両ペインに復元する
        this.leftPaneElement.scrollLeft = this.savedScrollLeft;
        this.leftPaneElement.scrollTop = this.savedScrollTop;
        this.rightPaneElement.scrollLeft = this.savedScrollLeft;
        this.rightPaneElement.scrollTop = this.savedScrollTop;
        // ラベルがある場合、列ヘッダー行の top をラベルの実高さ分ずらす。
        // display:'' 直後なので getBoundingClientRect() で正確な高さを取得できる。
        this.applyLabelOffsetToColumnHeaders();
        // display:none 解除後にSelectionの視覚位置をレイアウトに基づいて更新する
        this.leftEditorTable.refreshSelectionDisplay();
        this.rightEditorTable.refreshSelectionDisplay();
        // display:none 解除後にDOMレイアウトが確定するため、差分マーカーを計算・描画する
        this.refreshDiffMarkers();
    }

    /** ラベルの高さを列ヘッダー行の top に反映する */
    private applyLabelOffsetToColumnHeaders(): void {
        const leftLabel = this.leftPaneElement.querySelector('.diff-pane-label-left') as HTMLElement | null;
        if (leftLabel !== null) {
            const headerRow = this.leftPaneElement.querySelector('.editor-table-column-header-row') as HTMLElement;
            headerRow.style.top = leftLabel.getBoundingClientRect().height + 'px';
        }
        const rightLabel = this.rightPaneElement.querySelector('.diff-pane-label-right') as HTMLElement | null;
        if (rightLabel !== null) {
            const headerRow = this.rightPaneElement.querySelector('.editor-table-column-header-row') as HTMLElement;
            headerRow.style.top = rightLabel.getBoundingClientRect().height + 'px';
        }
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
        this.savedScrollLeft = this.leftPaneElement.scrollLeft;
        this.savedScrollTop = this.leftPaneElement.scrollTop;
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

        // スクロールコンテナ（paneElement, overflow:auto）内に innerWrapper を配置する。
        // GridTextField/Selection/AreaResizer の position:absolute の含有ブロック（position:relative）となる。
        // 通常テーブル（tab.ts の wrapperElement）やミニテーブル（createMiniEditorTable の wrapperElement）と同じパターン。
        // paneElement を直接 container として渡すと、getBoundingClientRect() がスクロール分ズレるため不正確になる。
        const innerWrapper = document.createElement('div');
        innerWrapper.classList.add('diff-pane-inner');
        paneElement.appendChild(innerWrapper);

        // scrollControllerの対象はペイン要素（overflow:auto）
        const scrollController = new ScrollViewportController(paneElement);

        const selection = new Selection(editorTable, innerWrapper, scrollController);
        const history = new History(editorTable, tabButton, store, tableKey, 100);
        const editorTableHandler = new EditorTableHandler(editorTable, selection, history, scrollController, notification);
        const textField = editorTableHandler.createGridTextField(innerWrapper, editorTable, selection);
        editorTableHandler.setTextField(textField);

        const areaResizer = new AreaResizer(innerWrapper, history, selection);

        // emptyRowCount=0、isMiniTable=true で生成する（空行なし、ミニテーブル相当）
        const realEditorTable = new EditorTable(
            tableKey, tableData, referenceDataCache, store, editorTableHandler,
            selection, contextMenu, history, areaResizer,
            scrollController, sidebar, 0, 'editor-table', true
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
     * 差分クラスをEditorTableのDOMに付与する
     * EditorTable.getCell(row, col) でセル要素を取得し、直接CSSクラスを追加する
     * row は1始まり（0がヘッダー行）、col は1始まり（0が行ヘッダー）
     *
     * @param csvIndexToDomIndex CSV列インデックス → DOM列インデックスの逆引きマップ。
     *   スキーマに定義されていないCSV列はマップに含まれないためスキップされる。
     *   非連番keyスキーマではCSV列インデックス（0〜全列-1）とDOM列インデックスが一致しないため必須。
     */
    private applyDiffClasses(
        leftTable: EditorTable,
        rightTable: EditorTable,
        leftEmptyRowIndices: number[],
        rightEmptyRowIndices: number[],
        leftDeletedRowIndices: number[],
        rightAddedRowIndices: number[],
        leftModifiedCells: Array<{ row: number; col: number }>,
        rightModifiedCells: Array<{ row: number; col: number }>,
        csvIndexToDomIndex: Map<number, number>,
        newColumnIndices: ReadonlySet<number>
    ): void {
        const leftElement = leftTable.getTableElement();
        const rightElement = rightTable.getTableElement();

        // 左ペインの空白行（追加行に対応する空白）
        // buildMergedData が生成するインデックスとDOM構造は同期的に構築されるため、
        // インデックスの存在チェックは不要（防御的ガードを除去）
        for (const rowIdx of leftEmptyRowIndices) {
            const row = leftElement.children[rowIdx + 1] as HTMLElement; // +1 でヘッダー行スキップ
            row.classList.add('diff-row-empty');
        }

        // 右ペインの空白行（削除行に対応する空白）: 初期パディング行であることを明示する。
        // diff-row-initial-padding クラスと data-padding-store-index 属性を付与することで、
        // ユーザー削除後のパディング行（diff-row-empty だが初期パディングではない行）と区別できる。
        // rowIdx は rightRows 配列のインデックスであり、store.registerTable に渡したボディの行インデックスと一致する。
        for (const rowIdx of rightEmptyRowIndices) {
            const rightRow = rightElement.children[rowIdx + 1] as HTMLElement;
            rightRow.classList.add('diff-row-empty', 'diff-row-initial-padding');
            rightRow.setAttribute('data-padding-store-index', String(rowIdx));
        }

        // 左ペインの削除行
        for (const rowIdx of leftDeletedRowIndices) {
            (leftElement.children[rowIdx + 1] as HTMLElement).classList.add('diff-row-deleted');
        }

        // 右ペインの追加行: 行内の全セル（行ヘッダー含む）に diff-cell-added を付与する
        for (const rowIdx of rightAddedRowIndices) {
            const rowElement = rightElement.children[rowIdx + 1] as HTMLElement;
            for (let i = 0; i < rowElement.children.length; i++) {
                (rowElement.children[i] as HTMLElement).classList.add('diff-cell-added');
            }
        }

        // 左ペインの変更セル（新規列は灰色、それ以外は赤色）
        // colIdx はCSV列インデックスなので、DOM列インデックスへ変換する。
        // スキーマに定義されていないCSV列（csvIndexToDomIndex に存在しない）はスキップする。
        for (const { row: rowIdx, col: csvColIdx } of leftModifiedCells) {
            const domColIdx = csvIndexToDomIndex.get(csvColIdx);
            if (domColIdx === undefined) continue; // スキーマにないCSV列はスキップ
            const className = newColumnIndices.has(csvColIdx) ? 'diff-cell-new-column' : 'diff-cell-deleted';
            leftTable.getCell(rowIdx + 1, domColIdx + 1).classList.add(className);
        }

        // 右ペインの変更セル（新規列も含め緑色で統一。新規列=新しいデータが追加された意味）
        for (const { row: rowIdx, col: csvColIdx } of rightModifiedCells) {
            const domColIdx = csvIndexToDomIndex.get(csvColIdx);
            if (domColIdx === undefined) continue; // スキーマにないCSV列はスキップ
            rightTable.getCell(rowIdx + 1, domColIdx + 1).classList.add('diff-cell-added');
        }
    }

    /**
     * 差分マーカーを再計算してトラックに反映する。
     * DOM行のCSSクラスを走査して変更行を検出し、offsetTop / scrollHeight でマーカー位置を算出する。
     * 左ペイン: 削除行は赤、変更行は緑。右ペイン: 追加・変更行は緑。
     * すべて左1/3に描画し、エラーマーカー（右1/3）と位置で区別する。
     */
    private refreshDiffMarkers(): void {
        // 左ペイン: 削除行（diff-row-deleted）と変更行（diff-cell-deleted）を分離する
        const leftResult = this.collectLeftPaneMarkers();
        this.leftTrack.updateDiff(leftResult.deletedMarkers, leftResult.modifiedMarkers);
        // 右ペイン: 追加・変更行（diff-cell-added）はすべて緑
        const rightAdded = this.collectDiffRowMarkers(this.rightEditorTable, this.rightPaneElement, null, 'diff-cell-added');
        this.rightTrack.updateDiff([], rightAdded);
    }

    /**
     * 左ペインのDOM行を走査して差分マーカーを収集する。
     * 左ペインは「変更前」を表示するため、削除行（diff-row-deleted）も
     * 変更セルを含む行（diff-cell-deleted）もすべて赤マーカーとして扱う。
     */
    private collectLeftPaneMarkers(): { deletedMarkers: MarkerEntry[]; modifiedMarkers: MarkerEntry[] } {
        const leftMarkers = this.collectDiffRowMarkers(this.leftEditorTable, this.leftPaneElement, 'diff-row-deleted', 'diff-cell-deleted');
        return { deletedMarkers: leftMarkers, modifiedMarkers: [] };
    }

    /**
     * 指定ペインのDOM行を走査して差分マーカーを収集する。
     * @param rowClass 行全体の差分クラス（null の場合はセルクラスのみで判定）
     * @param cellClass セル単位の差分クラス
     */
    private collectDiffRowMarkers(editorTable: EditorTable, paneElement: HTMLElement, rowClass: string | null, cellClass: string): MarkerEntry[] {
        const scrollHeight = paneElement.scrollHeight;
        if (scrollHeight <= 0) return [];
        const tableElement = editorTable.getTableElement();
        const changedDomRows: number[] = [];
        for (let i = 1; i < tableElement.children.length; i++) {
            const row = tableElement.children[i] as HTMLElement;
            if (row.classList.contains('diff-row-empty')) continue;
            if (rowClass !== null && row.classList.contains(rowClass)) { changedDomRows.push(i); continue; }
            for (let j = 0; j < row.children.length; j++) {
                if ((row.children[j] as HTMLElement).classList.contains(cellClass)) { changedDomRows.push(i); break; }
            }
        }
        return this.buildMarkerEntries(tableElement, changedDomRows, scrollHeight);
    }

    /**
     * DOM行インデックス配列からマーカーエントリを構築する。
     * 連続する行はマージして1つのエントリにする（EditorTable.buildMarkerEntries と同パターン）。
     */
    private buildMarkerEntries(tableElement: HTMLElement, domRows: number[], scrollHeight: number): MarkerEntry[] {
        if (domRows.length === 0) return [];
        const markers: MarkerEntry[] = [];
        let rangeStart = tableElement.children[domRows[0]] as HTMLElement;
        let rangeEnd = rangeStart;
        for (let i = 1; i < domRows.length; i++) {
            if (domRows[i] === domRows[i - 1] + 1) {
                rangeEnd = tableElement.children[domRows[i]] as HTMLElement;
            } else {
                markers.push({ start: rangeStart.offsetTop / scrollHeight, size: (rangeEnd.offsetTop + rangeEnd.offsetHeight - rangeStart.offsetTop) / scrollHeight });
                rangeStart = tableElement.children[domRows[i]] as HTMLElement;
                rangeEnd = rangeStart;
            }
        }
        markers.push({ start: rangeStart.offsetTop / scrollHeight, size: (rangeEnd.offsetTop + rangeEnd.offsetHeight - rangeStart.offsetTop) / scrollHeight });
        return markers;
    }
}
