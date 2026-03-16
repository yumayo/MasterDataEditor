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
import {TabReference} from "./tab-reference";
import {GridDropdownInput} from "./grid-dropdown-input";

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

    /** リサイズハンドル要素（removeEventListener に必要） */
    private readonly resizeHandle: HTMLElement;

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
        tabButton: TabButton,
        tabReference: TabReference,
        openEditorTables: Map<string, EditorTable>
    ) {
        this.isSyncing = false;
        this.dragMouseMove = null;
        this.dragMouseUp = null;

        // スキーマをパースしてPK列名（配列）を取得する（単一PKは文字列→配列に正規化）
        const schema = JSON.parse(schemaJson) as SchemaJson;
        const primaryKeyNames: readonly string[] = Array.isArray(schema.primary_key)
            ? schema.primary_key
            : [schema.primary_key];

        // 差分計算（ファイル行順）
        const { diffRows, displayHeader } = buildDiffRows(headCsv, currentCsv, primaryKeyNames);
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

        // 左ペイン（HEAD版 = 変更前）— 初期50%はCSSの flex: 0 0 50% で設定済み
        const leftPaneElement = document.createElement('div');
        leftPaneElement.classList.add('diff-pane-left');
        diffTabContent.appendChild(leftPaneElement);
        this.leftPaneElement = leftPaneElement;

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
                leftPaneElement.style.flexBasis = `${percentage}%`;
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

        // 右ペイン（現在版 = 変更後）— flex: 1 のまま（残りスペースを埋める）
        const rightPaneElement = document.createElement('div');
        rightPaneElement.classList.add('diff-pane-right');
        diffTabContent.appendChild(rightPaneElement);
        this.rightPaneElement = rightPaneElement;

        // 左右ペイン用のストアキー（差分タブ専用の名前空間を使用して通常テーブルと衝突しない）
        const leftTableKey = tableName + ':diff:head';
        const rightTableKey = tableName + ':diff:current';
        this.leftTableKey = leftTableKey;
        this.rightTableKey = rightTableKey;

        // 左ペイン（HEAD版）はドロップダウン不要のため dropdownContainer=null を渡す
        const leftResult = this.buildDiffEditorTable(
            leftTableKey, schemaJson, displayHeader, leftRows,
            leftPaneElement, null, store, referenceDataCache, contextMenu, tabButton, sidebar
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
            rightPaneElement, isStaged ? null : wrapperElement, store, referenceDataCache, contextMenu, tabButton, sidebar
        );
        this.rightEditorTable = rightResult.editorTable;
        this.rightEditorTableHandler = rightResult.editorTableHandler;
        this.rightHistory = rightResult.history;
        this.rightAreaResizer = rightResult.areaResizer;
        this.rightFillController = rightResult.fillController;

        // 右ペインの参照ヒントを設定する（通常テーブルと同パターン）
        tabReference.preloadReferenceTables(rightResult.tableData, this.rightEditorTable);
        tabReference.resolveReverseReferencesAsync(tableName, this.rightEditorTable);

        // 左右EditorTableに自身（DiffTab）を接続する（排他制御のため）
        // RelationsPanel.connectEditorTable() と対称的なパターン
        this.leftEditorTable.diffTab = this;
        this.rightEditorTable.diffTab = this;

        // CSV列インデックス → DOM列インデックスの逆引きマップを構築する。
        // columnMapping[domIndex] = csvIndex なので、逆引きは Map<csvIndex, domIndex> となる。
        // スキーマに定義されていないCSV列（-1 のエントリ）はマップに含めない。
        // 左右ペインはどちらも同じスキーマ由来なので leftResult で代表する。
        const csvIndexToDomIndex = new Map<number, number>();
        for (let domIdx = 0; domIdx < leftResult.tableData.columnMapping.length; domIdx++) {
            const csvIdx = leftResult.tableData.columnMapping[domIdx];
            if (csvIdx !== -1) csvIndexToDomIndex.set(csvIdx, domIdx);
        }

        // 差分クラスをDOM行・セルに付与する（EditorTable生成後）
        this.applyDiffClasses(
            this.leftEditorTable, this.rightEditorTable,
            leftEmptyRowIndices, rightEmptyRowIndices,
            leftDeletedRowIndices, rightAddedRowIndices,
            leftModifiedCells, rightModifiedCells,
            csvIndexToDomIndex
        );

        // 左ペイン（HEAD版）は常に読み取り専用にする
        // makeReadOnly() により Ctrl+S も禁止される（不正パスへの書き込み防止）
        this.leftEditorTable.makeReadOnly();

        // 右ペイン（現在版）のストアキーは "tableName:diff:current" のような不正パスだが、
        // 元の tableName を保存先としてオーバーライドすることでファイル破壊なく保存できる。
        // staged状態では右ペインも読み取り専用にする（makeReadOnly が Ctrl+S を禁止する）。
        if (isStaged) {
            this.rightEditorTable.makeReadOnly();
        } else {
            this.rightEditorTableHandler.configureSaveTargetTableName(tableName);
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
        dropdownContainer: HTMLElement | null,
        store: InMemoryTableStore,
        referenceDataCache: ReferenceDataCache,
        contextMenu: ContextMenu,
        tabButton: TabButton,
        sidebar: Sidebar
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

        // scrollControllerの対象はペイン要素（overflow:auto）
        const scrollController = new ScrollViewportController(paneElement, () => {
            editorTable.onScroll();
        });

        const selection = new Selection(editorTable, paneElement, scrollController);
        const history = new History(editorTable, tabButton, store, tableKey, 100);
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
        csvIndexToDomIndex: Map<number, number>
    ): void {
        const leftElement = leftTable.getTableElement();
        const rightElement = rightTable.getTableElement();

        // 左ペインの空白行（追加行に対応する空白）
        // buildMergedData が生成するインデックスとDOM構造は同期的に構築されるため、
        // インデックスの存在チェックは不要（防御的ガードを除去）
        for (const rowIdx of leftEmptyRowIndices) {
            (leftElement.children[rowIdx + 1] as HTMLElement).classList.add('diff-row-empty'); // +1 でヘッダー行スキップ
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

        // 右ペインの追加行
        for (const rowIdx of rightAddedRowIndices) {
            (rightElement.children[rowIdx + 1] as HTMLElement).classList.add('diff-row-added');
        }

        // 左ペインの変更セル（.diff-cell-deleted）
        // colIdx はCSV列インデックスなので、DOM列インデックスへ変換する。
        // スキーマに定義されていないCSV列（csvIndexToDomIndex に存在しない）はスキップする。
        for (const { row: rowIdx, col: csvColIdx } of leftModifiedCells) {
            const domColIdx = csvIndexToDomIndex.get(csvColIdx);
            if (domColIdx === undefined) continue; // スキーマにないCSV列はスキップ
            leftTable.getCell(rowIdx + 1, domColIdx + 1).classList.add('diff-cell-deleted');
        }

        // 右ペインの変更セル（.diff-cell-added）
        for (const { row: rowIdx, col: csvColIdx } of rightModifiedCells) {
            const domColIdx = csvIndexToDomIndex.get(csvColIdx);
            if (domColIdx === undefined) continue; // スキーマにないCSV列はスキップ
            rightTable.getCell(rowIdx + 1, domColIdx + 1).classList.add('diff-cell-added');
        }
    }
}
