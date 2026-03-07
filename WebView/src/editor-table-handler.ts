import {EditorTable} from "./editor-table";
import {GridTextField} from "./grid-textfield";
import {Selection, CellRange} from "./selection";
import {History} from "./history";
import {CellChange} from "./command";
import {ReferenceDataCache} from "./reference-data-cache";
import {GridDropdownInput} from "./grid-dropdown-input";
import {EditorTableData} from "./model/editor-table-data";
import {
    parseReferenceExpression,
    isDynamicReference,
    DynamicReference
} from "./reference-expression";
import {
    moveCell,
    extendSelectionCell,
    moveCellDownWithinSelection,
    moveCellUpWithinSelection,
    moveCellRightWithinSelection,
    moveCellLeftWithinSelection,
    saveTableData,
    saveSchemaDataAsync,
    getTarget
} from "./editor-actions";
import {config} from "./config";

/**
 * 参照解決の結果
 */
interface ResolvedReference {
    tableName: string;
    columnName: string;
}

/**
 * EditorTable の入力イベントを一元管理するクラス
 *
 * 責務：
 * - contenteditable element の所有
 * - キーボードイベントのリスニング
 * - エディタ全体のショートカット処理（Ctrl+S, Ctrl+C, Ctrl+Z, Ctrl+Y等）
 * - セル移動（矢印キー、Enter、Tab）
 * - 編集モードの開始・終了
 * - ペースト処理
 * - フォーカス管理（IME対応）
 * - 参照列のドロップダウン連携
 */
export class EditorTableHandler {

    readonly element: HTMLElement;

    private readonly table: EditorTable;
    private readonly selection: Selection;
    private readonly history: History;
    private textField: GridTextField | undefined;

    private active: boolean;
    private visible: boolean;

    // 参照列用のコンポーネント
    private referenceDataCache: ReferenceDataCache | undefined;
    private dropdownInput: GridDropdownInput | undefined;
    private tableData: EditorTableData | undefined;
    private dropdownActive: boolean;

    private readonly boundOnKeydown: (e: KeyboardEvent) => void;
    private readonly boundOnFocusout: (e: FocusEvent) => void;
    private readonly boundOnPaste: (e: ClipboardEvent) => void;

    constructor(
        table: EditorTable,
        selection: Selection,
        history: History
    ) {
        this.table = table;
        this.selection = selection;
        this.history = history;
        this.textField = undefined;

        this.active = false;
        this.visible = false;
        this.dropdownActive = false;

        // contenteditable element を作成
        const element = document.createElement('div');
        element.style.width = '0px';
        element.style.top = '-99999px';
        element.style.left = '-99999px';
        element.classList.add('grid-textfield');
        element.setAttribute('contenteditable', 'true');
        element.appendChild(document.createElement('br'));
        this.element = element;

        // イベントリスナーを登録
        this.boundOnKeydown = this.onKeydown.bind(this);
        this.boundOnFocusout = this.onFocusout.bind(this);
        this.boundOnPaste = this.onPaste.bind(this);

        this.element.addEventListener('keydown', this.boundOnKeydown);
        this.element.addEventListener('focusout', this.boundOnFocusout);
        this.element.addEventListener('paste', this.boundOnPaste);
        this.element.addEventListener('input', this.onInput.bind(this));
    }

    /**
     * ハンドラーを有効化（タブがアクティブになったとき）
     */
    enable(): void {
        if (this.active) return;

        this.active = true;
        this.element.focus({ preventScroll: true });
    }

    /**
     * ハンドラーを無効化（タブが非アクティブになったとき）
     */
    deactivate(): void {
        this.active = false;
    }

    /**
     * GridTextField を設定（循環依存解決のため、コンストラクタ後に設定）
     */
    setTextField(textField: GridTextField): void {
        this.textField = textField;
    }

    /**
     * 参照データキャッシュとドロップダウンコンポーネントを設定
     */
    setReferenceComponents(cache: ReferenceDataCache, dropdown: GridDropdownInput, tableData: EditorTableData): void {
        this.referenceDataCache = cache;
        this.dropdownInput = dropdown;
        this.tableData = tableData;
    }

    /**
     * セル編集モードを開始する（外部から呼ばれる用）
     */
    enableCellEditMode(preserveContent: boolean): void {
        if (!this.textField) return;

        const target = getTarget(this.table, this.selection);
        const tableRect = this.table.getTableBoundingClientRect();
        const cellRect = target.cellRect;
        const rect = new DOMRect(
            cellRect.left - tableRect.left - 1,
            cellRect.top - tableRect.top,
            cellRect.width + 1,
            cellRect.height
        );

        this.textField.show(rect, target.cellValue, preserveContent);
        
        this.visible = true;
    }

    /**
     * フォーカスアウト時の処理
     */
    private onFocusout(event: FocusEvent): void {
        console.log('[handler] onFocusout', {
            active: this.active,
            dropdownActive: this.dropdownActive,
            visible: this.visible,
            relatedTarget: event.relatedTarget
        });

        if (!this.active) return;

        // ドロップダウンがアクティブな場合はキャンセルして非表示にする
        if (this.dropdownActive && this.dropdownInput) {
            console.log('[handler] dropdownActive=true, cancelling dropdown');
            this.dropdownInput.cancel();
        }

        // フォーカス先がHTMLInputElement/HTMLTextAreaElementの場合は
        // 意図的な移動なのでフォーカスを奪わない（検索パネル等の入力フィールド用）
        const focusTarget = event.relatedTarget;
        if (focusTarget instanceof HTMLInputElement || focusTarget instanceof HTMLTextAreaElement) {
            console.log('[handler] focus moved to input element, not reclaiming');
            if (this.visible) {
                this.submitText();
                this.hide();
            }
            return;
        }

        // アクティブ中はセルを常に有効にし続けます。
        // IMEを使用していてキー入力の一文字目から日本語を使用できるようになります。
        console.log('[handler] reclaiming focus');
        this.element.focus({ preventScroll: true });

        // すでに非表示なら何もしないです。
        if (!this.visible) return;

        this.submitText();

        // 非表示にします。
        this.hide();
    }

    /**
     * 入力イベント時の処理（リサイズとドロップダウンフィルタリング）
     */
    private onInput(): void {
        if (!this.active) return;

        const text = this.element.textContent ?? '';

        // ドロップダウンがアクティブな場合はフィルタリング
        if (this.dropdownActive && this.dropdownInput) {
            this.dropdownInput.onInputChanged(text);
            // テキストフィールドのリサイズも行う
            if (this.textField) {
                this.textField.resizeTextField(text);
            }
            return;
        }

        if (!this.textField) return;
        this.textField.resizeTextField(text);
    }

    /**
     * キーボードイベントを処理する
     */
    private onKeydown(keyboardEvent: KeyboardEvent): void {
        // テーブルのグローバルなキー入力が見たい場合はコメントアウトしてください。
        console.log(keyboardEvent);

        if (!this.active) return;

        console.log('[input] keydown', {
            key: keyboardEvent.key,
            code: keyboardEvent.code,
            shiftKey: keyboardEvent.shiftKey,
            ctrlKey: keyboardEvent.ctrlKey,
            metaKey: keyboardEvent.metaKey
        });
        this.table.stopAutoScrollForInput();

        // ドロップダウンがアクティブな場合
        if (this.dropdownActive) {
            this.handleDropdownKeydown(keyboardEvent);
            return;
        }

        if (this.visible) {
            this.handleEditModeKeydown(keyboardEvent);
        } else {
            this.handleNavigationKeydown(keyboardEvent);
        }
    }

    /**
     * テキスト編集中のキー処理
     */
    private handleEditModeKeydown(keyboardEvent: KeyboardEvent): void {
        // IMEの入力中であれば決定しないです。
        if (!keyboardEvent.isComposing && keyboardEvent.code === 'Enter') {
            this.submitText();
            this.hide();
            if (keyboardEvent.shiftKey) {
                moveCellUpWithinSelection(this.table, this.selection);
            } else {
                moveCellDownWithinSelection(this.table, this.selection);
            }
        }

        // Tabキーの処理（編集中）
        if (keyboardEvent.key === 'Tab') {
            keyboardEvent.preventDefault();
            this.submitText();
            this.hide();
            if (keyboardEvent.shiftKey) {
                moveCellLeftWithinSelection(this.table, this.selection);
            } else {
                moveCellRightWithinSelection(this.table, this.selection);
            }
        }

        // ESCキーで入力をキャンセルして元に戻す
        if (keyboardEvent.key === 'Escape') {
            keyboardEvent.preventDefault();
            this.hide();
        }
    }

    /**
     * ドロップダウン表示中のキー処理
     */
    private handleDropdownKeydown(keyboardEvent: KeyboardEvent): void {
        if (!this.dropdownInput) return;

        // IME変換中は何もしない
        if (keyboardEvent.isComposing) {
            return;
        }

        switch (keyboardEvent.key) {
            case 'ArrowDown':
                keyboardEvent.preventDefault();
                this.dropdownInput.moveSelection(1);
                break;
            case 'ArrowUp':
                keyboardEvent.preventDefault();
                this.dropdownInput.moveSelection(-1);
                break;
            case 'Enter':
                keyboardEvent.preventDefault();
                this.dropdownInput.confirmSelection();
                break;
            case 'Tab':
                keyboardEvent.preventDefault();
                this.dropdownInput.confirmSelection();
                break;
            case 'Escape':
                keyboardEvent.preventDefault();
                this.dropdownInput.cancel();
                break;
        }
    }

    /**
     * ナビゲーションモード（編集モードではない）のキー処理
     */
    private handleNavigationKeydown(keyboardEvent: KeyboardEvent): void {
        // Ctrl+S: 保存
        if (keyboardEvent.ctrlKey && keyboardEvent.key === 's') {
            keyboardEvent.preventDefault();
            Promise.all([
                saveTableData(this.table),
                saveSchemaDataAsync(this.table)
            ]).then(() => {
                this.history.markSaved();
            });
            return;
        }

        // Ctrl+C: コピー
        if (keyboardEvent.ctrlKey && keyboardEvent.key === 'c') {
            keyboardEvent.preventDefault();
            this.selection.copy();
            return;
        }

        // Ctrl+V: ペースト（pasteイベントで処理するためpreventDefaultしない）
        if (keyboardEvent.ctrlKey && keyboardEvent.key === 'v') {
            // pasteイベントに任せる
            return;
        }

        // Ctrl+Z: Undo
        if (keyboardEvent.ctrlKey && keyboardEvent.key === 'z') {
            keyboardEvent.preventDefault();
            const result = this.history.undo();
            if (result) {
                this.selection.setRange(result.range.startRow, result.range.startColumn, result.range.endRow, result.range.endColumn);
                this.selection.move(result.range.startRow, result.range.startColumn);
                this.selection.setCopyRange(result.copyRange);
            }
            return;
        }

        // Ctrl+Y: Redo
        if (keyboardEvent.ctrlKey && keyboardEvent.key === 'y') {
            keyboardEvent.preventDefault();
            const result = this.history.redo();
            if (result) {
                this.selection.setRange(result.range.startRow, result.range.startColumn, result.range.endRow, result.range.endColumn);
                this.selection.move(result.range.startRow, result.range.startColumn);
                this.selection.setCopyRange(result.copyRange);
            }
            return;
        }

        // ESCキーでコピー範囲の点線表示を解除
        if (keyboardEvent.key === 'Escape') {
            keyboardEvent.preventDefault();
            if (this.selection.hasCopyRange()) {
                this.selection.clearCopyRange();
            } else {
                // コピー範囲が設定されていないときは履歴のコピー範囲をクリア
                this.history.clearCopyRange();
            }
            return;
        }

        // 矢印キー
        if (keyboardEvent.key === 'ArrowRight') {
            keyboardEvent.preventDefault();
            if (keyboardEvent.shiftKey) {
                extendSelectionCell(this.table, this.selection, 1, 0);
            } else {
                moveCell(this.table, this.selection, 1, 0);
            }
            return;
        }

        if (keyboardEvent.key === 'ArrowLeft') {
            keyboardEvent.preventDefault();
            if (keyboardEvent.shiftKey) {
                extendSelectionCell(this.table, this.selection, -1, 0);
            } else {
                moveCell(this.table, this.selection, -1, 0);
            }
            return;
        }

        if (keyboardEvent.key === 'ArrowUp') {
            keyboardEvent.preventDefault();
            if (keyboardEvent.shiftKey) {
                extendSelectionCell(this.table, this.selection, 0, -1);
            } else {
                moveCell(this.table, this.selection, 0, -1);
            }
            return;
        }

        if (keyboardEvent.key === 'ArrowDown') {
            keyboardEvent.preventDefault();
            if (keyboardEvent.shiftKey) {
                extendSelectionCell(this.table, this.selection, 0, 1);
            } else {
                moveCell(this.table, this.selection, 0, 1);
            }
            return;
        }

        // Enterキー
        if (keyboardEvent.key === 'Enter') {
            keyboardEvent.preventDefault();
            if (keyboardEvent.shiftKey) {
                moveCellUpWithinSelection(this.table, this.selection);
            } else {
                moveCellDownWithinSelection(this.table, this.selection);
            }
            return;
        }

        // Tabキー
        if (keyboardEvent.key === 'Tab') {
            keyboardEvent.preventDefault();
            if (keyboardEvent.shiftKey) {
                moveCellLeftWithinSelection(this.table, this.selection);
            } else {
                moveCellRightWithinSelection(this.table, this.selection);
            }
            return;
        }

        // DeleteキーまたはBackspaceキー
        if (keyboardEvent.key === 'Delete' || keyboardEvent.key === 'Backspace') {
            const deleteRange = this.selection.getSelectionRange();
            const changes: CellChange[] = [];
            for (let r = deleteRange.startRow; r <= deleteRange.endRow; r++) {
                for (let c = deleteRange.startColumn; c <= deleteRange.endColumn; c++) {
                    const oldValue = this.table.getCellValueAt(r, c);
                    if (oldValue !== '') changes.push({ row: r, column: c, oldValue, newValue: '' });
                }
            }
            if (changes.length > 0) {
                this.applyCellChangesWithHistory(changes, deleteRange, this.selection.getCopyRange());
            }
            return;
        }

        // 文字入力による編集モード開始
        // Ctrl/Meta+キーの組み合わせはショートカットなので編集モードを開始しない
        if (keyboardEvent.ctrlKey || keyboardEvent.metaKey) return;
        if (keyboardEvent.key?.match(/^\w$/g) || keyboardEvent.key === 'Process') {
            if (!this.textField) return;
            // 参照列の場合はドロップダウンを表示
            this.enableCellEditModeWithDropdownAsync(false).then((handled) => {
                if (!handled) {
                    // ドロップダウンで処理されなかった場合は通常の編集モード
                    this.enableCellEditMode(false);
                }
            });
            return;
        }
    }

    /**
     * テキスト入力フィールドの内容を確定する
     */
    private submitText(): void {
        if (!this.visible) return;
        const target = getTarget(this.table, this.selection);
        const text = this.element.textContent ?? '';
        const range = { startRow: target.row, startColumn: target.column, endRow: target.row, endColumn: target.column };
        const changes: CellChange[] = [{ row: target.row, column: target.column, oldValue: target.cellValue, newValue: text }];
        this.applyCellChangesWithHistory(changes, range, this.selection.getCopyRange());
    }

    /**
     * テキスト入力フィールドを非表示にする
     */
    private hide(): void {
        this.visible = false;
        this.element.textContent = null;
        this.element.style.width = '0px';
        this.element.style.height = '';
        this.element.style.lineHeight = '';
        this.element.style.top = '-99999px';
        this.element.style.left = '-99999px';
        this.element.appendChild(document.createElement('br'));
        this.element.classList.remove('grid-textfield-active');
    }

    /**
     * テキスト入力を確定して非表示にする（外部から呼ばれる用）
     */
    submitAndHide(): void {
        this.submitText();
        this.hide();
    }

    /**
     * システムクリップボードからのペーストイベントを処理する
     */
    private onPaste(event: ClipboardEvent): void {
        if (!this.active) return;

        // テキスト入力モード中（visible）は通常のペースト動作を許可
        if (this.visible) return;

        event.preventDefault();

        const clipboardData = event.clipboardData;
        if (!clipboardData) return;

        // クリップボードからテキストを取得
        const text = clipboardData.getData('text/plain');
        if (!text) return;

        // コピー範囲がある場合、クリップボードの内容と比較
        if (this.selection.hasCopyRange()) {
            const copyRangeText = this.getCopyRangeText();
            // 改行コードを正規化して比較（\r\nを\nに変換、末尾の改行を除去）
            const normalizedClipboardText = text.replace(/\r\n/g, '\n').replace(/\n$/, '');
            const normalizedCopyRangeText = copyRangeText.replace(/\r\n/g, '\n').replace(/\n$/, '');
            // クリップボードの内容とコピー範囲の内容が一致する場合は倍数ペースト
            if (normalizedClipboardText === normalizedCopyRangeText) {
                this.pasteFromCopyRange();
                return;
            }
        }

        // タブ区切り・改行区切りのテキストを2次元配列に解析
        const sourceData = this.parseClipboardText(text);
        if (sourceData.length === 0) return;

        this.pasteFromClipboardData(sourceData);
    }

    /**
     * コピー範囲のセル内容からテキストを生成する
     * （クリップボードと同じ形式：タブ区切り、改行区切り）
     */
    private getCopyRangeText(): string {
        const copyRange = this.selection.getCopyRange();
        const rows: string[] = [];

        for (let r = copyRange.startRow; r <= copyRange.endRow; r++) {
            const cells: string[] = [];
            for (let c = copyRange.startColumn; c <= copyRange.endColumn; c++) {
                cells.push(this.table.getCellValueAt(r, c));
            }
            rows.push(cells.join('\t'));
        }

        return rows.join('\n');
    }

    /**
     * クリップボードのテキストを2次元配列に解析する
     * タブで列区切り、改行で行区切り
     */
    private parseClipboardText(text: string): string[][] {
        // 末尾の改行を除去
        const trimmedText = text.replace(/\r?\n$/, '');

        // 行に分割（\r\nと\nの両方に対応）
        const lines = trimmedText.split(/\r?\n/);

        const result: string[][] = [];
        for (const line of lines) {
            // タブで列に分割
            const cells = line.split('\t');
            result.push(cells);
        }

        return result;
    }

    /**
     * 解析したクリップボードデータをテーブルに貼り付ける
     */
    private pasteFromClipboardData(sourceData: string[][]): void {
        const copyRange = this.selection.getCopyRange();
        this.pasteNormal(sourceData, copyRange);
    }

    /**
     * コピー範囲からソースデータを取得する
     */
    private getSourceData(copyRange: CellRange): string[][] {
        const copyRowCount = copyRange.endRow - copyRange.startRow + 1;
        const copyColumnCount = copyRange.endColumn - copyRange.startColumn + 1;

        const sourceData: string[][] = [];
        for (let r = 0; r < copyRowCount; r++) {
            const rowData: string[] = [];
            for (let c = 0; c < copyColumnCount; c++) {
                rowData.push(this.table.getCellValueAt(copyRange.startRow + r, copyRange.startColumn + c));
            }
            sourceData.push(rowData);
        }
        return sourceData;
    }

    /**
     * 通常のペースト：アンカー位置からコピー範囲と同じサイズでペースト
     */
    private pasteNormal(sourceData: string[][], copyRange: CellRange): void {
        const anchor = this.selection.getAnchor();
        const tableRowCount = this.table.getRowCount();
        const tableColumnCount = this.table.getTotalColumnCount();
        const rowCount = sourceData.length;
        const columnCount = sourceData[0].length;
        const changes: CellChange[] = [];
        for (let r = 0; r < rowCount; r++) {
            const destRow = anchor.row + r;
            if (destRow >= tableRowCount) break;
            for (let c = 0; c < columnCount; c++) {
                const destColumn = anchor.column + c;
                if (destColumn >= tableColumnCount) break;
                changes.push({ row: destRow, column: destColumn, oldValue: this.table.getCellValueAt(destRow, destColumn), newValue: sourceData[r][c] });
            }
        }
        const pasteEndRow = Math.min(anchor.row + rowCount - 1, tableRowCount - 1);
        const pasteEndColumn = Math.min(anchor.column + columnCount - 1, tableColumnCount - 1);
        const pasteRange = { startRow: anchor.row, startColumn: anchor.column, endRow: pasteEndRow, endColumn: pasteEndColumn };
        this.applyPasteChanges(changes, pasteRange, copyRange);
    }

    /**
     * 倍数ペースト：選択範囲全体にコピーデータを繰り返しfill
     */
    private pasteWithFill(sourceData: string[][], selectionRange: CellRange, copyRange: CellRange): void {
        const copyRowCount = sourceData.length;
        const copyColumnCount = sourceData[0].length;
        const tableRowCount = this.table.getRowCount();
        const tableColumnCount = this.table.getTotalColumnCount();
        const selectionRowCount = selectionRange.endRow - selectionRange.startRow + 1;
        const selectionColumnCount = selectionRange.endColumn - selectionRange.startColumn + 1;
        const changes: CellChange[] = [];
        for (let r = 0; r < selectionRowCount; r++) {
            const destRow = selectionRange.startRow + r;
            if (destRow >= tableRowCount) break;
            const srcRowIndex = r % copyRowCount;
            for (let c = 0; c < selectionColumnCount; c++) {
                const destColumn = selectionRange.startColumn + c;
                if (destColumn >= tableColumnCount) break;
                const srcColumnIndex = c % copyColumnCount;
                changes.push({ row: destRow, column: destColumn, oldValue: this.table.getCellValueAt(destRow, destColumn), newValue: sourceData[srcRowIndex][srcColumnIndex] });
            }
        }
        this.applyPasteChanges(changes, selectionRange, copyRange);
    }

    /**
     * 選択範囲がコピー範囲の倍数かどうかを判定
     */
    private shouldFillSelection(copyRange: CellRange, selectionRange: CellRange): boolean {
        const copyRowCount = copyRange.endRow - copyRange.startRow + 1;
        const copyColumnCount = copyRange.endColumn - copyRange.startColumn + 1;
        const selectionRowCount = selectionRange.endRow - selectionRange.startRow + 1;
        const selectionColumnCount = selectionRange.endColumn - selectionRange.startColumn + 1;

        const isRowMultiple = selectionRowCount >= copyRowCount && selectionRowCount % copyRowCount === 0;
        const isColumnMultiple = selectionColumnCount >= copyColumnCount && selectionColumnCount % copyColumnCount === 0;
        const isLarger = selectionRowCount > copyRowCount || selectionColumnCount > copyColumnCount;

        return isRowMultiple && isColumnMultiple && isLarger;
    }

    /**
     * コピー範囲からペースト
     */
    private pasteFromCopyRange(): void {
        if (!this.selection.hasCopyRange()) return;

        const copyRange = this.selection.getCopyRange();
        const selectionRange = this.selection.getSelectionRange();
        const sourceData = this.getSourceData(copyRange);

        if (this.shouldFillSelection(copyRange, selectionRange)) {
            this.pasteWithFill(sourceData, selectionRange, copyRange);
        } else {
            this.pasteNormal(sourceData, copyRange);
        }
    }

    /**
     * ペースト変更を適用し、選択範囲を更新する
     */
    private applyPasteChanges(changes: CellChange[], pasteRange: CellRange, copyRange: CellRange): void {
        this.applyCellChangesWithHistory(changes, pasteRange, copyRange);
        this.selection.setRange(pasteRange.startRow, pasteRange.startColumn, pasteRange.endRow, pasteRange.endColumn);
    }

    /**
     * セル値変更を適用し、履歴に記録する
     * selection.setRange()は呼ばない（呼び出し元の責任）。
     */
    private applyCellChangesWithHistory(changes: CellChange[], range: CellRange, copyRange: CellRange): void {
        const allChanges = this.table.applyCellChanges(changes);
        this.history.push({ changes: allChanges, range, copyRange });
    }



    /**
     * 現在のフォーカス列の参照を解決する（動的参照対応）
     * @returns 解決した参照情報、または参照列でない場合は undefined
     */
    private async resolveReferenceAsync(): Promise<ResolvedReference | undefined> {
        if (!this.tableData || !this.referenceDataCache) return undefined;

        const focus = this.selection.getFocus();
        // column=0は行ヘッダーなので、データ列は1から始まる
        const columnIndex = focus.column - 1;

        if (columnIndex < 0 || columnIndex >= this.tableData.header.length) {
            return undefined;
        }

        const reference = this.tableData.header[columnIndex].reference;
        if (!reference) return undefined;

        const expr = parseReferenceExpression(reference);

        if (!isDynamicReference(expr)) {
            // 単純参照の場合
            return {
                tableName: expr.tableName,
                columnName: expr.columnName
            };
        }

        // 動的参照の場合
        return this.resolveDynamicReferenceAsync(expr, focus.row, columnIndex);
    }

    /**
     * 動的参照を解決する
     * @param expr 動的参照式
     * @param rowIndex 現在の行インデックス
     * @param currentDataColumnIndex 動的参照を持つ列自身のデータ列インデックス
     * @returns 解決した参照情報、または解決できない場合は undefined
     */
    private async resolveDynamicReferenceAsync(expr: DynamicReference, rowIndex: number, currentDataColumnIndex: number): Promise<ResolvedReference | undefined> {
        if (!this.tableData || !this.referenceDataCache) return undefined;

        // 1. 同一行の指定カラムの値を取得（ビューの合成ヘッダーではプレフィックス付きのためresolveで解決）
        const valueColumnIndex = this.table.resolveValueColumnIndex(expr.filter.valueColumn, currentDataColumnIndex);
        if (valueColumnIndex === -1) {
            console.warn(`Dynamic reference: column '${expr.filter.valueColumn}' not found in table header`);
            return undefined;
        }

        // column=0は行ヘッダーなので、データ列インデックスに+1する
        const cellValue = this.table.getCellValueAt(rowIndex, valueColumnIndex + 1);
        if (cellValue === '') {
            // 値が空の場合は参照を解決できない
            return undefined;
        }

        // 2. フィルタテーブルの全データを取得
        const fullData = await this.referenceDataCache.getFullDataAsync(expr.filter.tableName);
        if (fullData.rows.size === 0) {
            console.warn(`Dynamic reference: table '${expr.filter.tableName}' has no data`);
            return undefined;
        }

        // 3. フィルタ列（filterColumn）で値を検索し、lookupColumn の値を取得
        const lookupColumnIndex = fullData.header.indexOf(expr.lookupColumn);
        if (lookupColumnIndex === -1) {
            console.warn(`Dynamic reference: column '${expr.lookupColumn}' not found in table '${expr.filter.tableName}'`);
            return undefined;
        }

        const row = this.referenceDataCache.findRowByColumn(fullData, expr.filter.filterColumn, cellValue);
        if (!row) {
            console.warn(`Dynamic reference: value '${cellValue}' not found in column '${expr.filter.filterColumn}' of table '${expr.filter.tableName}'`);
            return undefined;
        }

        const targetTableName = row[lookupColumnIndex];
        if (targetTableName === '') {
            console.warn(`Dynamic reference: column '${expr.lookupColumn}' is empty for '${expr.filter.filterColumn}'='${cellValue}'`);
            return undefined;
        }

        // 4. 解決した参照を返す
        return {
            tableName: targetTableName,
            columnName: expr.targetColumn
        };
    }

    /**
     * 参照列の場合にドロップダウンを表示してセル編集モードを開始
     * @param preserveContent trueの場合、セルの内容を保持する（ダブルクリック時）
     */
    async enableCellEditModeWithDropdownAsync(preserveContent: boolean): Promise<boolean> {
        if (!this.referenceDataCache || !this.dropdownInput || !this.textField) {
            return false;
        }

        // 参照を解決（動的参照対応）
        let resolvedReference = await this.resolveReferenceAsync();

        // 明示的な参照がない場合、逆参照されているPK列かチェック
        if (!resolvedReference && this.tableData) {
            const focus = this.selection.getFocus();
            const columnIndex = focus.column - 1;
            if (columnIndex >= 0
                && columnIndex < this.tableData.header.length
                && this.tableData.header[columnIndex].name === config.primaryKeyColumnName
                && this.table.hasReverseReferences()) {
                resolvedReference = {
                    tableName: this.table.tableName,
                    columnName: config.primaryKeyColumnName,
                };
            }
        }

        if (!resolvedReference) {
            return false;
        }

        try {
            // 参照テーブルデータを取得
            const refData = await this.referenceDataCache.get(resolvedReference.tableName);

            // アイテムが空の場合は通常入力を使用
            if (refData.items.length === 0) {
                return false;
            }

            // セルの位置を取得
            const target = getTarget(this.table, this.selection);
            const tableRect = this.table.getTableBoundingClientRect();
            const cellRect = target.cellRect;
            const rect = new DOMRect(
                cellRect.left - tableRect.left - 1,
                cellRect.top - tableRect.top,
                cellRect.width + 1,
                cellRect.height
            );

            // preserveContent=falseの場合（キー入力）はセル内容を初期化する（通常のセル編集と同様）
            const initialValue = preserveContent ? target.cellValue : '';

            // 入力フィールドを表示（GridTextFieldを使用）
            this.textField.show(rect, initialValue, preserveContent);
            this.visible = true;
            this.dropdownActive = true;

            // ドロップダウンリストを表示
            this.dropdownInput.show(rect, refData.items, initialValue);

            return true;
        } catch (e) {
            console.warn(`Failed to load reference data for ${resolvedReference.tableName}`, e);
            return false;
        }
    }

    /**
     * ドロップダウンからの選択を確定
     */
    submitDropdownSelection(id: string): void {
        if (!this.dropdownActive) return;
        const target = getTarget(this.table, this.selection);
        const range = { startRow: target.row, startColumn: target.column, endRow: target.row, endColumn: target.column };
        const changes: CellChange[] = [{ row: target.row, column: target.column, oldValue: target.cellValue, newValue: id }];
        this.applyCellChangesWithHistory(changes, range, this.selection.getCopyRange());
        this.dropdownActive = false;
        this.hide();
        moveCellDownWithinSelection(this.table, this.selection);
    }

    /**
     * ドロップダウンをキャンセル
     */
    cancelDropdown(): void {
        this.dropdownActive = false;

        // 入力フィールドを非表示
        this.hide();
    }

    /**
     * ドロップダウンがアクティブかどうか
     */
    isDropdownActive(): boolean {
        return this.dropdownActive;
    }
}
