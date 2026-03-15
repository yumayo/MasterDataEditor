import {EditorTable} from "./editor-table";
import {Selection} from "./selection";
import {History} from "./history";
import {Command, InsertColumnCommand, InsertColumnsCommand, InsertRowCommand, InsertRowsCommand, DeleteColumnCommand, DeleteColumnsCommand, DeleteRowCommand, DeleteRowsCommand} from "./command";
import {AreaResizer} from "./area-resizer";
import {DEFAULT_ROW_HEIGHT} from "./constant";
import {Utility} from "./utility";

/**
 * テーブル構造操作モジュール
 *
 * 責務:
 * - 列の挿入・削除のDOM操作
 * - 行の挿入・削除のDOM操作
 * - 列ヘッダーセル・行ヘッダーセルの生成
 */
export class EditorTableStructure {
    private readonly table: EditorTable;
    private readonly selection: Selection;
    private readonly history: History;
    private readonly areaResizer: AreaResizer;

    constructor(table: EditorTable, selection: Selection, history: History, areaResizer: AreaResizer) {
        this.table = table;
        this.selection = selection;
        this.history = history;
        this.areaResizer = areaResizer;
    }

    /**
     * 列挿入の公開メソッド（Commandを使用してhistoryに追加）
     */
    insertColumn(columnIndex: number): void {
        this.insertColumns(columnIndex, 1);
    }

    /**
     * 複数列挿入の公開メソッド（Commandを使用してhistoryに追加）
     */
    insertColumns(columnIndex: number, count: number): void {
        let command: Command = new InsertColumnCommand(this.table, columnIndex);
        if (count > 1) {
            command = new InsertColumnsCommand(this.table, columnIndex, count);
        }
        const copyRange = this.selection.getCopyRange();
        const anchor = this.selection.getAnchor();
        this.history.executeCommand(command, {startRow: anchor.row, startColumn: anchor.column, endRow: anchor.row, endColumn: anchor.column}, copyRange);
    }

    /**
     * 列挿入の内部実装（Commandから呼び出される）
     * comment: Undo時にcommentを復元するために使用する。新規挿入時は null を渡す。
     */
    insertColumnInternal(columnIndex: number, comment: string | null): void {
        const tableElement = this.table.getTableElement();
        // 各行に新しいセルを挿入
        for (let currentRowIndex = 0; currentRowIndex < tableElement.children.length; ++currentRowIndex) {
            const row = tableElement.children[currentRowIndex] as HTMLElement;
            if (currentRowIndex === 0) {
                // 列ヘッダー行
                // 挿入前に既存のラベルをDOMから取得
                const existingLabels: string[] = [];
                for (let i = 1; i < row.children.length; ++i) {
                    existingLabels.push(getColumnHeaderLabel(row.children[i] as HTMLElement));
                }
                // 列挿入で追加する新規列は PK でも FK でもないため false/null を渡す
                const newHeaderCell = this.createColumnHeaderCell('', comment, columnIndex, Utility.calculateColumnWidth(''), false, null);
                // 挿入位置（行ヘッダーの後、columnIndex番目）
                const insertBefore = row.children[columnIndex + 1];
                row.insertBefore(newHeaderCell, insertBefore);
                // 全列ヘッダーのラベルを更新（DOMから取得した既存ラベルを使用）
                const newColumnCount = existingLabels.length + 1;
                for (let i = 0; i < newColumnCount; ++i) {
                    const headerCell = row.children[i + 1] as HTMLElement;
                    headerCell.dataset.columnIndex = String(i);
                    headerCell.dataset.col = String(i);
                    let label = '';
                    if (i < columnIndex) {
                        label = existingLabels[i] || '';
                    } else if (i > columnIndex) {
                        label = existingLabels[i - 1] || '';
                    }
                    // comment あり（.column-header-name span）かcommentなし（TextNode）かに応じてラベルを更新
                    setColumnHeaderLabel(headerCell, label);
                    // リサイズハンドルのイベントハンドラを再設定
                    const existingResizeHandle = headerCell.querySelector('.column-resize-handle');
                    if (existingResizeHandle) {
                        existingResizeHandle.remove();
                    }
                    const newResizeHandle = document.createElement('div');
                    newResizeHandle.classList.add('column-resize-handle');
                    this.areaResizer.setupColumnResizeHandle(newResizeHandle, headerCell, i);
                    headerCell.appendChild(newResizeHandle);
                }
            } else {
                // 通常の行: 行の高さは既存のセルから取得
                const newCell = EditorTable.createCell(this.table, '', columnIndex, Utility.calculateColumnWidth(''), DEFAULT_ROW_HEIGHT);
                const insertBefore = row.children[columnIndex + 1];
                row.insertBefore(newCell, insertBefore);
                // 後続のセルのdata-colを更新
                for (let i = columnIndex + 1; i < row.children.length; ++i) {
                    const cell = row.children[i] as HTMLElement;
                    cell.dataset.col = String(i - 1);
                }
            }
        }
        // コピー範囲をクリア（列構造が変わったため）
        this.selection.clearCopyRange();
        // 選択範囲の描画を更新（ヘッダーの背景色を正しく表示するため）
        this.selection.updateRendererAfterResize();
        // 列挿入によりsortKeysのcolumnIndexが陳腐化するため、ソート状態をリセットする
        this.table.clearSortState();
        // 列挿入によりfilterMapのcolumnIndexが陳腐化するため、フィルター状態もリセットする
        this.table.clearFilterState();
    }

    /**
     * 行挿入の公開メソッド（Commandを使用してhistoryに追加）
     */
    insertRow(rowIndex: number): void {
        this.insertRows(rowIndex, 1);
    }

    /**
     * 複数行挿入の公開メソッド（Commandを使用してhistoryに追加）
     */
    insertRows(rowIndex: number, count: number): void {
        const command: Command = count > 1
            ? new InsertRowsCommand(this.table, rowIndex, count)
            : new InsertRowCommand(this.table, rowIndex);
        const copyRange = this.selection.getCopyRange();
        const anchor = this.selection.getAnchor();
        this.history.executeCommand(command, {startRow: anchor.row, startColumn: anchor.column, endRow: anchor.row, endColumn: anchor.column}, copyRange);
    }

    /**
     * 行挿入の内部実装（Commandから呼び出される）
     * DOMへの行挿入と同時にストアにも空行を挿入してデータ整合性を保つ
     */
    insertRowInternal(rowIndex: number): void {
        const tableElement = this.table.getTableElement();
        // DOM操作前にストアヘッダーを検証する。
        // これより後にDOM操作を行うため、ここで例外が発生してもDOMにゴミ行が残らない。
        // ミニテーブルはDOMの列数がストアのサブセット（スキーマの header 配列から決定）のため、DOMの列数では誤りになる場合がある。
        // ストアのヘッダー長はCSVヘッダーから決定されるため、ストアのスキーマと一致した正しい空行が挿入される。
        const storeHeader = this.table.getStore().getHeader(this.table.tableName);
        if (storeHeader === false) throw new Error('[EditorTableStructure.insertRowInternal] ストアにテーブルが登録されていません: ' + this.table.tableName);
        const storeColumnCount = storeHeader.length;
        // DOM上の列数（行ヘッダーを除く）。DOM列数はスキーマの header 配列から決定され、ストア列数はCSVヘッダーから決定される。
        // ミニテーブルではFK列を除いた表示列のみDOMに存在するため、DOM列数とストア列数は一致しない場合がある。
        const columnHeaderRow = tableElement.children[0];
        const domColumnCount = columnHeaderRow.children.length - 1;
        // 新しい行を作成
        const cells: HTMLElement[] = [];
        // 行ヘッダーを作成
        const rowHeaderCell = this.createRowHeaderCell(String(rowIndex), rowIndex - 1);
        cells.push(rowHeaderCell);
        // データセルを作成（列幅は列ヘッダーから取得）
        for (let j = 0; j < domColumnCount; ++j) {
            const cell = EditorTable.createCell(this.table, '', j, this.table.getColumnWidth(j), DEFAULT_ROW_HEIGHT);
            cells.push(cell);
        }
        const newRow = EditorTable.createRow(cells, rowIndex);
        const insertBefore = tableElement.children[rowIndex];
        tableElement.insertBefore(newRow, insertBefore);
        // ソート時のstoreRowIndex逆引きのためのインデックスは後で設定する（storeRowIndex確定後）
        // ストアにも空行を挿入する。
        // rowIndex はヘッダー行を含む DOM インデックスのため、データ行インデックスは rowIndex - 1。
        // ミニテーブルでは storeRowIndices がフィルタされたサブセット（例: [1, 2]）のため、
        // DOM データ行インデックスを直接ストアインデックスとして使うと誤った位置に挿入される。
        // 正しいストアインデックスは storeRowIndices から解決する:
        //   - domDataRowIndex が既存行の範囲内（上に挿入）: storeRowIndices[domDataRowIndex]
        //   - domDataRowIndex が末尾の外（下に挿入）: storeRowIndices[domDataRowIndex - 1] + 1
        const domDataRowIndex = rowIndex - 1;
        const indices = this.table.getStoreRowIndices();
        // 0行テーブル（indicesが空配列）の場合は先頭（0）に挿入する。
        // 既存行の範囲内（上に挿入）: storeRowIndices[domDataRowIndex] を使う。
        // 末尾の外（下に挿入）: storeRowIndices[domDataRowIndex - 1] + 1 を使う。
        let storeRowIndex: number;
        if (indices.length === 0) {
            storeRowIndex = 0;
        } else if (domDataRowIndex < indices.length) {
            storeRowIndex = indices[domDataRowIndex];
        } else {
            storeRowIndex = indices[domDataRowIndex - 1] + 1;
        }
        this.table.getStore().insertRowAt(this.table.tableName, storeRowIndex, Array(storeColumnCount).fill(''));
        // ソート時のstoreRowIndex逆引きのために新しい行にdata-store-indexを付与する
        newRow.dataset.storeIndex = String(storeRowIndex);
        // storeRowIndices にも挿入インデックスを追加し、ストア上で後ろにずれた全エントリを+1する。
        // domDataRowIndex の位置に storeRowIndex を挿入し、それより大きいストアインデックス値を持つ全エントリを+1。
        indices.splice(domDataRowIndex, 0, storeRowIndex);
        for (let i = domDataRowIndex + 1; i < indices.length; i++) {
            if (indices[i] >= storeRowIndex) {
                indices[i] += 1;
                // data-store-index DOM属性もストアインデックスに合わせて更新する
                const domRow = tableElement.children[i + 1] as HTMLElement | null;
                if (domRow) domRow.dataset.storeIndex = String(indices[i]);
            }
        }
        // ソート中の場合、originalIndices も同期する（行挿入でストアインデックスがずれるため）
        this.table.notifySortRowInserted(storeRowIndex);
        // 挿入行を含む以降の全行を再ナンバリングする（data-row 属性・行ヘッダーテキスト・リサイズハンドル）
        this.renumberRowsFrom(rowIndex);
        // コピー範囲をクリア（行構造が変わったため）
        this.selection.clearCopyRange();
        // 選択範囲の描画を更新（ヘッダーの背景色を正しく表示するため）
        this.selection.updateRendererAfterResize();
        // 行挿入後にgit差分ハイライトを全セル再評価する（新規行や後続行のストアインデックスが変化するため）
        this.table.applyGitDiffHighlight();
        // 行挿入後に参照データキャッシュを無効化する。
        // undo（deleteRow呼び出し）後も deleteRow 側でキャッシュを無効化するため、
        // insertRowInternal と deleteRow の両方で evict することで Do/Undo の対称性を保つ。
        // 新規行にIDが入力される前にキャッシュが構築されると空IDがスキップされるため問題ないが、
        // IDが入力された後は updateFullDataCell で逐次更新されるため一貫した挙動を保証する。
        this.table.evictOwnReferenceDataCache();
        // 行挿入後にPK重複バリデーションを実行する（Undo/Redo時に挿入した行のIDが重複する可能性があるため）
        this.table.validatePkDuplicates();
        // フィルター適用中の場合は行数カウンターと表示/非表示を再計算する（挿入行がフィルター条件を満たさない可能性）
        this.table.refreshFilterDisplayIfActive();
        // 差分ビューの右ペインで行挿入した場合、左ペインの同一位置にパディング行を挿入して行数を同期する
        if (this.table.diffTab !== false) {
            this.table.diffTab.notifyRightPaneRowInserted(rowIndex);
        }
    }

    /**
     * 列削除の公開メソッド（Commandを使用してhistoryに追加）
     */
    removeColumn(columnIndex: number): void {
        this.removeColumns(columnIndex, 1);
    }

    /**
     * 複数列削除の公開メソッド（Commandを使用してhistoryに追加）
     */
    removeColumns(startColumnIndex: number, count: number): void {
        const columnCount = this.table.getColumnCount();
        const maxCountFromStart = columnCount - startColumnIndex;
        const maxCountForKeepOne = columnCount - 1;
        const effectiveCount = Math.min(count, maxCountFromStart, maxCountForKeepOne);
        if (effectiveCount <= 0) return;
        let command: Command = new DeleteColumnCommand(this.table, startColumnIndex);
        if (effectiveCount > 1) {
            command = new DeleteColumnsCommand(this.table, startColumnIndex, effectiveCount);
        }
        const copyRange = this.selection.getCopyRange();
        const anchor = this.selection.getAnchor();
        this.history.executeCommand(command, {startRow: anchor.row, startColumn: anchor.column, endRow: anchor.row, endColumn: anchor.column}, copyRange);
    }

    /**
     * 行削除の公開メソッド（Commandを使用してhistoryに追加）
     */
    removeRow(rowIndex: number): void {
        this.removeRows(rowIndex, 1);
    }

    /**
     * 複数行削除の公開メソッド（Commandを使用してhistoryに追加）
     */
    removeRows(startRowIndex: number, count: number): void {
        const command: Command = count > 1
            ? new DeleteRowsCommand(this.table, startRowIndex, count)
            : new DeleteRowCommand(this.table, startRowIndex);
        const copyRange = this.selection.getCopyRange();
        const anchor = this.selection.getAnchor();
        this.history.executeCommand(command, {startRow: anchor.row, startColumn: anchor.column, endRow: anchor.row, endColumn: anchor.column}, copyRange);
    }

    /**
     * 列を削除する（Undo用）
     */
    deleteColumn(columnIndex: number): void {
        const tableElement = this.table.getTableElement();
        const columnHeaderRow = tableElement.children[0];
        const totalColumns = columnHeaderRow.children.length - 1;
        // 削除前に既存のラベルをDOMから取得
        const existingLabels: string[] = [];
        for (let i = 1; i < columnHeaderRow.children.length; ++i) {
            existingLabels.push(getColumnHeaderLabel(columnHeaderRow.children[i] as HTMLElement));
        }
        // 各行から指定位置のセルを削除
        for (let rowIdx = 0; rowIdx < tableElement.children.length; ++rowIdx) {
            const row = tableElement.children[rowIdx] as HTMLElement;
            // columnIndex + 1 は行ヘッダーを除いた位置
            const cellToRemove = row.children[columnIndex + 1];
            if (cellToRemove) {
                cellToRemove.remove();
            }
            // 列ヘッダー行の場合、ラベルを更新
            if (rowIdx === 0) {
                for (let i = 0; i < totalColumns - 1; ++i) {
                    const headerCell = row.children[i + 1] as HTMLElement;
                    headerCell.dataset.columnIndex = String(i);
                    headerCell.dataset.col = String(i);
                    let label = '';
                    if (i < columnIndex) {
                        label = existingLabels[i] || '';
                    } else {
                        label = existingLabels[i + 1] || '';
                    }
                    // comment あり（.column-header-name span）かcommentなし（TextNode）かに応じてラベルを更新
                    setColumnHeaderLabel(headerCell, label);
                    // リサイズハンドルのイベントハンドラを再設定
                    const existingResizeHandle = headerCell.querySelector('.column-resize-handle');
                    if (existingResizeHandle) {
                        existingResizeHandle.remove();
                    }
                    const newResizeHandle = document.createElement('div');
                    newResizeHandle.classList.add('column-resize-handle');
                    this.areaResizer.setupColumnResizeHandle(newResizeHandle, headerCell, i);
                    headerCell.appendChild(newResizeHandle);
                }
            } else {
                // data-colを更新
                for (let i = columnIndex; i < row.children.length - 1; ++i) {
                    const cell = row.children[i + 1] as HTMLElement;
                    cell.dataset.col = String(i);
                }
            }
        }
        // コピー範囲をクリア（列構造が変わったため）
        this.selection.clearCopyRange();
        // 選択範囲の描画を更新（ヘッダーの背景色を正しく表示するため）
        this.selection.updateRendererAfterResize();
        // 列削除によりsortKeysのcolumnIndexが陳腐化するため、ソート状態をリセットする
        this.table.clearSortState();
        // 列削除によりfilterMapのcolumnIndexが陳腐化するため、フィルター状態もリセットする
        this.table.clearFilterState();
    }

    /**
     * 行を削除する（Undo用）
     */
    deleteRow(rowIndex: number): void {
        const tableElement = this.table.getTableElement();
        // storeRowIndices から対応エントリを削除し、ストアからも行を削除する。
        // insertRowInternal と対称な処理: 挿入時に storeRowIndices と store を両方更新したように、
        // 削除時も storeRowIndices と store を両方更新してデータ整合性を保つ。
        // 削除した storeRowIndex より大きい全エントリを-1してストアのずれを補正する。
        const domDataRowIndex = rowIndex - 1;
        const indices = this.table.getStoreRowIndices();
        if (domDataRowIndex >= 0 && domDataRowIndex < indices.length) {
            const removedStoreIndex = indices[domDataRowIndex];
            this.table.getStore().removeRow(this.table.tableName, removedStoreIndex);
            indices.splice(domDataRowIndex, 1);
            for (let i = domDataRowIndex; i < indices.length; i++) {
                if (indices[i] > removedStoreIndex) {
                    indices[i] -= 1;
                    // data-store-index DOM属性もストアインデックスに合わせて更新する
                    const domRow = tableElement.children[i + 1] as HTMLElement | null;
                    if (domRow) domRow.dataset.storeIndex = String(indices[i]);
                }
            }
            // ソート中の場合、originalIndices も同期する（行削除でストアインデックスがずれるため）
            this.table.notifySortRowDeleted(removedStoreIndex);
        }
        // 差分ビューの右ペインでは DOM 行の削除を DiffTab に委譲する。
        // DiffTab.notifyRightPaneRowDeleted は以下の2つのケースを DOM 状態で判断する:
        //   - 左ペインの対応行が diff-row-padding-inserted → 行挿入のUndo → 左右のDOM行を削除
        //   - そうでない → 通常のデータ行削除 → 右ペインをパディング行変換 + 左ペインに削除マーク
        if (this.table.diffTab !== false) {
            const rowElement = tableElement.children[rowIndex] as HTMLElement;
            this.table.diffTab.notifyRightPaneRowDeleted(rowIndex, rowElement);
        } else {
            // 通常テーブルの場合は DOM 行をそのまま削除する
            tableElement.children[rowIndex].remove();
        }
        // 削除行以降の全行を再ナンバリングする（data-row 属性・行ヘッダーテキスト・リサイズハンドル）
        this.renumberRowsFrom(rowIndex);
        // コピー範囲をクリア（行構造が変わったため）
        this.selection.clearCopyRange();
        // 選択範囲の描画を更新（ヘッダーの背景色を正しく表示するため）
        this.selection.updateRendererAfterResize();
        // 行削除後にgit差分ハイライトを全セル再評価する（後続行のストアインデックスが変化するため）
        this.table.applyGitDiffHighlight();
        // 行削除後に参照データキャッシュを無効化する。
        // 削除済みIDがドロップダウン候補に残り続ける問題を防ぐ。
        // undo（insertRowInternal呼び出し）時も insertRowInternal 側でキャッシュを無効化するため、
        // deleteRow と insertRowInternal の両方で evict することで Do/Undo の対称性を保つ。
        this.table.evictOwnReferenceDataCache();
        // 行削除後にPK重複バリデーションを実行する（削除によって重複が解消される場合があるため）
        this.table.validatePkDuplicates();
        // フィルター適用中の場合は行数カウンターと表示/非表示を再計算する（行削除で表示行数が変化する）
        this.table.refreshFilterDisplayIfActive();
        // ミニテーブルはコンテキストメニューの「行を削除」でデータ行を削除した後も末尾に常に1行バッファ行を保持する。
        // ただし差分ビューのEditorTable（diffTab !== false）は isMiniTable=true で構築されているが
        // パディング行管理を DiffTab 側で行うためバッファ行の自動補充は不要。
        // deleteRow の呼び出し元（DeleteRowCommand.execute/undo）はこの区別を知らないため、ここで一元的に判定する。
        if (this.table.isMiniTableInstance() && this.table.diffTab === false) this.table.ensureTrailingBufferRow();
    }

    /**
     * 列ヘッダーセルを生成する
     * comment がある場合は .column-header-comment（上段）と .column-header-name（下段）の2要素を生成する。
     * comment がない場合は従来通り TextNode で name のみ表示する。
     * isPrimaryKey が true の場合は PK バッジを、reference が非null の場合は FK バッジを nameSpan の直後に追加する。
     */
    createColumnHeaderCell(name: string, comment: string | null, columnIndex: number, width: string, isPrimaryKey: boolean, reference: string | null): HTMLElement {
        const columnHeaderCell = document.createElement('div');
        columnHeaderCell.classList.add('editor-table-cell', 'editor-table-column-header');
        if (comment !== null) {
            // 2行構造: 上段にcomment、下段に変数名
            const commentSpan = document.createElement('span');
            commentSpan.classList.add('column-header-comment');
            commentSpan.textContent = comment;
            const nameSpan = document.createElement('span');
            nameSpan.classList.add('column-header-name');
            nameSpan.textContent = name;
            columnHeaderCell.appendChild(commentSpan);
            columnHeaderCell.appendChild(nameSpan);
        } else {
            // comment なし: TextNode で name のみ（従来通り）
            columnHeaderCell.appendChild(document.createTextNode(name));
        }
        // バッジエリアをヘッダーセルの先頭に挿入し、has-badge クラスを付与する（appendBadgeIfNeeded 内で実施）
        appendBadgeIfNeeded(columnHeaderCell, isPrimaryKey, reference);
        columnHeaderCell.dataset.columnIndex = String(columnIndex);
        columnHeaderCell.dataset.col = String(columnIndex);
        EditorTable.applyCellWidth(columnHeaderCell, width);
        if (comment !== null) {
            // comment あり: 2行分のコンテンツを持つため、maxHeight/lineHeight による単行クリップを解除する。
            // minHeight のみ設定してコンテンツに合わせて自然に伸長させる。
            columnHeaderCell.style.height = `calc(${DEFAULT_ROW_HEIGHT} * 2)`;
            columnHeaderCell.style.minHeight = `calc(${DEFAULT_ROW_HEIGHT} * 2)`;
            columnHeaderCell.style.maxHeight = 'none';
            columnHeaderCell.style.lineHeight = 'normal';
        } else {
            EditorTable.applyCellHeight(columnHeaderCell, DEFAULT_ROW_HEIGHT);
        }
        // 列ヘッダークリックで列全体を選択
        columnHeaderCell.addEventListener('mousedown', this.table.contextMenuHandler.createColumnHeaderClickHandler(columnHeaderCell));
        // 列ヘッダー右クリックでコンテキストメニュー
        columnHeaderCell.addEventListener('contextmenu', this.table.contextMenuHandler.createColumnHeaderContextMenuHandler(columnHeaderCell));
        // ミニテーブルにはフィルターアイコン・ソートインジケーターを追加しない
        if (!this.table.isMiniTableInstance()) {
            // フィルターアイコン（ソートインジケーターの左に配置）
            const filterIcon = document.createElement('span');
            filterIcon.classList.add('filter-icon');
            filterIcon.textContent = '▼';
            // mousedown は列選択ハンドラへのバブリングを防止する
            filterIcon.addEventListener('mousedown', (e) => { e.stopPropagation(); });
            // click でフィルタードロップダウンをトグルする（columnIndex はクロージャキャプチャではなく
            // DOM属性から動的取得することで列挿入/削除後の陳腐化を防ぐ）
            filterIcon.addEventListener('click', (e) => {
                e.stopPropagation();
                const headerCell = (e.currentTarget as HTMLElement).parentElement as HTMLElement;
                const colIdx = Number(headerCell.dataset.columnIndex);
                this.table.openFilterDropdown(colIdx, e.currentTarget as HTMLElement);
            });
            columnHeaderCell.appendChild(filterIcon);

            // ソートインジケーター
            const sortIndicator = document.createElement('div');
            sortIndicator.classList.add('sort-indicator');
            const ascIcon = document.createElement('span');
            ascIcon.classList.add('sort-icon-asc');
            ascIcon.textContent = '▲';
            const descIcon = document.createElement('span');
            descIcon.classList.add('sort-icon-desc');
            descIcon.textContent = '▼';
            const prioritySpan = document.createElement('span');
            prioritySpan.classList.add('sort-priority');
            sortIndicator.appendChild(ascIcon);
            sortIndicator.appendChild(descIcon);
            sortIndicator.appendChild(prioritySpan);
            // ソートインジケータークリックで列ソートをトグルする
            // mousedown は列選択ハンドラへのバブリングを防止するために停止する
            sortIndicator.addEventListener('mousedown', (e) => {
                e.stopPropagation();
            });
            // click でソートをトグルする（columnIndex はクロージャキャプチャではなく
            // DOM属性から動的取得することで列挿入/削除後の陳腐化を防ぐ）
            sortIndicator.addEventListener('click', (e) => {
                e.stopPropagation();
                const headerCell = (e.currentTarget as HTMLElement).parentElement as HTMLElement;
                const colIdx = Number(headerCell.dataset.columnIndex);
                this.table.applySortForColumn(colIdx);
            });
            columnHeaderCell.appendChild(sortIndicator);
        }
        const resizeHandle = document.createElement('div');
        resizeHandle.classList.add('column-resize-handle');
        this.areaResizer.setupColumnResizeHandle(resizeHandle, columnHeaderCell, columnIndex);
        columnHeaderCell.appendChild(resizeHandle);
        return columnHeaderCell;
    }

    /**
     * startDomIndex 以降の全行の data-row 属性・行ヘッダーテキスト・リサイズハンドルを再設定する。
     * 行挿入・削除・DOM行数変化後に必ず呼ぶこと。
     * @param startDomIndex 更新を開始する DOM インデックス（列ヘッダー行 = 0 を含む、データ行は 1 以上）
     */
    renumberRowsFrom(startDomIndex: number): void {
        const tableElement = this.table.getTableElement();
        for (let i = startDomIndex; i < tableElement.children.length; ++i) {
            const row = tableElement.children[i] as HTMLElement;
            row.dataset.row = String(i);
            const header = row.children[0] as HTMLElement;
            if (!header.classList.contains('editor-table-row-header')) continue;
            // テキストノードを更新（リサイズハンドルは保持）
            let textNode: Text | null = null;
            for (const node of Array.from(header.childNodes)) {
                if (node.nodeType === Node.TEXT_NODE) { textNode = node as Text; break; }
            }
            if (textNode) {
                textNode.textContent = String(i);
            } else {
                header.insertBefore(document.createTextNode(String(i)), header.firstChild);
            }
            header.dataset.rowIndex = String(i - 1);
            // リサイズハンドルのイベントハンドラを再設定
            const resizeHandle = header.querySelector('.row-resize-handle');
            if (resizeHandle) resizeHandle.remove();
            const newResizeHandle = document.createElement('div');
            newResizeHandle.classList.add('row-resize-handle');
            this.areaResizer.setupRowResizeHandle(newResizeHandle, header, i);
            header.appendChild(newResizeHandle);
        }
    }

    /**
     * 行ヘッダーセルを生成する
     */
    createRowHeaderCell(text: string, rowIndex: number): HTMLElement {
        const rowHeaderCell = document.createElement('div');
        rowHeaderCell.classList.add('editor-table-cell', 'editor-table-row-header');
        rowHeaderCell.textContent = text;
        rowHeaderCell.dataset.rowIndex = String(rowIndex);
        EditorTable.applyCellHeight(rowHeaderCell, DEFAULT_ROW_HEIGHT);
        // 行ヘッダークリックで行全体を選択
        rowHeaderCell.addEventListener('mousedown', this.table.contextMenuHandler.createRowHeaderClickHandler(rowHeaderCell));
        // 行ヘッダー右クリックでコンテキストメニュー
        rowHeaderCell.addEventListener('contextmenu', this.table.contextMenuHandler.createRowHeaderContextMenuHandler(rowHeaderCell));
        const resizeHandle = document.createElement('div');
        resizeHandle.classList.add('row-resize-handle');
        this.areaResizer.setupRowResizeHandle(resizeHandle, rowHeaderCell, rowIndex + 1);
        rowHeaderCell.appendChild(resizeHandle);
        return rowHeaderCell;
    }
}

/**
 * CSSモディファイア・ラベル・タイトルを受け取り、バッジ要素を生成して返す。
 * appendBadgeIfNeeded 内の PK/FK 両バッジで共通利用する。
 */
function createBadge(cssModifier: string, label: string, title: string): HTMLElement {
    const badge = document.createElement('span');
    badge.classList.add('column-header-badge', `column-header-badge--${cssModifier}`);
    badge.textContent = label;
    badge.title = title;
    return badge;
}

/**
 * isPrimaryKey が true の場合は PK バッジを、reference が非 null の場合は FK バッジを追加する。
 * バッジは .column-header-badge-area コンテナに格納し、ヘッダーセルの先頭（insertBefore）に挿入する。
 * PKかつFKの列では両バッジをコンテナ内に縦並びで表示する。どちらでもない場合は何もしない。
 * バッジが付与された場合は has-badge クラスをヘッダーセルに付与する。
 */
function appendBadgeIfNeeded(columnHeaderCell: HTMLElement, isPrimaryKey: boolean, reference: string | null): void {
    if (!isPrimaryKey && reference === null) return;
    const badgeArea = document.createElement('div');
    badgeArea.classList.add('column-header-badge-area');
    if (isPrimaryKey) {
        badgeArea.appendChild(createBadge('pk', 'PK', 'このテーブルの主キー列です'));
    }
    if (reference !== null) {
        badgeArea.appendChild(createBadge('fk', 'FK', `FK: ${reference} を参照`));
    }
    // ヘッダーセルの先頭に挿入することで、列名テキストより左（絶対配置）に表示される
    columnHeaderCell.insertBefore(badgeArea, columnHeaderCell.firstChild);
    // バッジに関するすべての処理（コンテナ生成・バッジ生成・クラス付与）をここに集約する
    columnHeaderCell.classList.add('has-badge');
}

/**
 * 列ヘッダーセルからラベル文字列を取得する。
 * comment あり（.column-header-name span）の場合はそのテキストを返し、
 * comment なし（TextNode）の場合は TextNode のテキストを返す。
 */
function getColumnHeaderLabel(headerCell: HTMLElement): string {
    const nameSpan = headerCell.querySelector<HTMLElement>('.column-header-name');
    if (nameSpan !== null) {
        return nameSpan.textContent || '';
    }
    for (const node of Array.from(headerCell.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent || '';
        }
    }
    return '';
}

/**
 * 列ヘッダーセルのラベルを更新する。
 * comment あり（.column-header-name span）の場合はそのテキストを書き換え、
 * comment なし（TextNode）の場合は TextNode を書き換える（なければ先頭に挿入）。
 */
function setColumnHeaderLabel(headerCell: HTMLElement, label: string): void {
    const nameSpan = headerCell.querySelector<HTMLElement>('.column-header-name');
    if (nameSpan !== null) {
        nameSpan.textContent = label;
        return;
    }
    for (const node of Array.from(headerCell.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE) {
            node.textContent = label;
            return;
        }
    }
    // TextNode がない場合は先頭に挿入
    headerCell.insertBefore(document.createTextNode(label), headerCell.firstChild);
}
