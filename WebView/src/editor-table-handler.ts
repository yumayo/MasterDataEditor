import {EditorTable} from "./editor-table";
import {GridTextField} from "./grid-textfield";
import {Selection, CellRange} from "./selection";
import {History} from "./history";
import {CellChange, CellChangeCommand, CompositeCommand, Command} from "./command";
import {createMetadataExpansionCommand} from "./view-row-restructure-command";
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

    /** ビュー用保存コールバック */
    private saveCallback:
        ((table: EditorTable) => Promise<void>)
        | undefined;

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
        this.saveCallback = undefined;

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
     * 保存コールバックを設定
     * ビュータブで使用し、Ctrl+Sで呼ばれる
     */
    setSaveCallback(
        callback: (
            table: EditorTable
        ) => Promise<void>
    ): void {
        this.saveCallback = callback;
    }

    /**
     * セル編集モードを開始する（外部から呼ばれる用）
     */
    enableCellEditMode(preserveContent: boolean): void {
        if (!this.textField) return;

        // パディングセルへの編集を拒否
        const anchor = this.selection.getAnchor();
        if (this.table.isPaddingCell(anchor.row, anchor.column)) {
            this.table.showRejectionFeedback();
            return;
        }

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
            if (this.saveCallback) {
                this.saveCallback(
                    this.table
                ).then(() => {
                    this.history.markSaved();
                });
            } else {
                Promise.all([
                    saveTableData(this.table),
                    saveSchemaDataAsync(this.table)
                ]).then(() => {
                    this.history.markSaved();
                });
            }
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

        // Deleteキー
        if (keyboardEvent.key === 'Delete') {
            const deleteRange = this.selection.getSelectionRange();
            const hasReadOnlyCell = this.table.containsReadOnlyCell(
                deleteRange.startRow, deleteRange.startColumn, deleteRange.endRow, deleteRange.endColumn
            );
            if (hasReadOnlyCell) {
                // FKグループが完全に含まれていなければ拒否
                if (!this.table.isSelectionCoveringCompleteGroups(deleteRange.startRow, deleteRange.endRow)) {
                    this.table.showRejectionFeedback();
                    return;
                }
            }
            const changes: CellChange[] = [];
            for (let r = deleteRange.startRow; r <= deleteRange.endRow; r++) {
                for (let c = deleteRange.startColumn; c <= deleteRange.endColumn; c++) {
                    // パディングセルはスキップ（変更不要）
                    // 結合列セルはapplyViewAwareCellChanges内でFK値クリアに連動して自動更新される
                    if (hasReadOnlyCell && this.table.isPaddingCell(r, c)) continue;
                    const oldValue = this.table.getCellValueAt(r, c);
                    if (oldValue !== '') changes.push({ row: r, column: c, oldValue, newValue: '' });
                }
            }
            if (changes.length > 0) {
                this.applyViewAwareCellChanges(changes, deleteRange, this.selection.getCopyRange());
            }
            return;
        }

        // 文字入力による編集モード開始
        // Ctrl/Meta+キーの組み合わせはショートカットなので編集モードを開始しない
        if (keyboardEvent.ctrlKey || keyboardEvent.metaKey) return;
        if (keyboardEvent.key?.match(/^\w$/g) || keyboardEvent.key === 'Process') {
            if (!this.textField) return;
            // パディングセルへの入力を拒否
            const anchor = this.selection.getAnchor();
            if (this.table.isPaddingCell(anchor.row, anchor.column)) {
                this.table.showRejectionFeedback();
                return;
            }
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
        this.applyViewAwareCellChanges(changes, range, this.selection.getCopyRange());
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

        // 結合列またはパディングセルを含む場合はペーストを拒否
        const selRange = this.selection.getSelectionRange();
        if (this.table.containsReadOnlyCell(
            selRange.startRow, selRange.startColumn, selRange.endRow, selRange.endColumn
        )) {
            this.table.showRejectionFeedback();
            return;
        }

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
     * ビューコンテキストがある場合、リーダー行のみ抽出してリーダー同士でマッピングする
     */
    private pasteNormal(sourceData: string[][], copyRange: CellRange): void {
        const anchor = this.selection.getAnchor();
        const tableRowCount = this.table.getRowCount();
        const tableColumnCount = this.table.getTotalColumnCount();
        const copyRowCount = copyRange.endRow - copyRange.startRow + 1;
        // データ行は1始まりのため、startRow >= 1 で内部コピーと判定（外部クリップボードの場合は-1）
        const isInternalViewPaste = this.table.hasViewContext() && copyRange.startRow >= 1 && copyRowCount === sourceData.length;
        // ビューコンテキストがあり内部コピーの場合、リーダー行のみ抽出してリーダー同士でマッピングする
        let filteredSource = sourceData;
        const destLeaderRows: number[] = [];
        if (isInternalViewPaste) {
            // ソースデータからリーダー行のみ抽出（パディング行はFK再構築で自動生成される）
            filteredSource = [];
            for (let r = 0; r < sourceData.length; r++) {
                if (this.table.isViewLeaderRow(copyRange.startRow + r)) {
                    filteredSource.push(sourceData[r]);
                }
            }
            // 宛先のリーダー行を必要数収集（パディング行をスキップ）
            for (let row = anchor.row; row < tableRowCount && destLeaderRows.length < filteredSource.length; row++) {
                if (this.table.isViewLeaderRow(row)) {
                    destLeaderRows.push(row);
                }
            }
        }
        const effectiveRowCount = isInternalViewPaste
            ? Math.min(filteredSource.length, destLeaderRows.length)
            : filteredSource.length;
        const columnCount = filteredSource[0].length;
        const changes: CellChange[] = [];
        for (let r = 0; r < effectiveRowCount; r++) {
            const destRow = isInternalViewPaste ? destLeaderRows[r] : anchor.row + r;
            if (destRow >= tableRowCount) break;
            for (let c = 0; c < columnCount; c++) {
                const destColumn = anchor.column + c;
                if (destColumn >= tableColumnCount) break;
                changes.push({ row: destRow, column: destColumn, oldValue: this.table.getCellValueAt(destRow, destColumn), newValue: filteredSource[r][c] });
            }
        }
        // ペースト範囲の終端行を算出
        const lastDestRow = isInternalViewPaste && destLeaderRows.length > 0
            ? destLeaderRows[Math.min(effectiveRowCount, destLeaderRows.length) - 1]
            : anchor.row + effectiveRowCount - 1;
        const pasteEndRow = Math.min(lastDestRow, tableRowCount - 1);
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
     * ペースト変更を適用する共通メソッド
     * applyViewAwareCellChangesの戻り値で選択範囲を更新する
     */
    private applyPasteChanges(changes: CellChange[], pasteRange: CellRange, copyRange: CellRange): void {
        const adjustedRange = this.applyViewAwareCellChanges(changes, pasteRange, copyRange);
        this.selection.setRange(adjustedRange.startRow, adjustedRange.startColumn, adjustedRange.endRow, adjustedRange.endColumn);
    }

    /**
     * セル値変更の共通入口メソッド
     * ビューコンテキストの有無に応じてFK再構築/JOIN列同期を自動判定し、
     * 適切な処理を実行する。selection.setRange()は呼ばない（呼び出し元の責任）。
     * @returns 調整済みのセル範囲（FK再構築による行数変化を反映）
     */
    private applyViewAwareCellChanges(changes: CellChange[], range: CellRange, copyRange: CellRange): CellRange {
        // ビューコンテキストがない場合: 単純にセル値を適用して履歴に追加
        if (!this.table.hasViewContext()) {
            for (const change of changes) this.table.setCellValueAt(change.row, change.column, change.newValue);
            this.history.push({ changes, range, copyRange });
            return range;
        }
        // FK再構築が必要な変更を事前判定（setCellValueAt前にoldValueを参照するため）
        const restructureRows = new Map<number, CellChange>();
        for (const change of changes) {
            if (this.table.needsViewRowRestructure(change.row, change.column, change.newValue)) {
                restructureRows.set(change.row, change);
            }
        }
        if (restructureRows.size === 0) {
            this.applyViewChangesWithSync(changes, range, copyRange);
            return range;
        }
        return this.applyViewChangesWithRestructure(changes, restructureRows, range, copyRange);
    }

    /**
     * ビュー内変更（FK再構築不要）
     * 各changeに対してJOIN列連動変更を収集し、主変更と合わせて適用・履歴に記録する。
     * selection.setRange()は呼ばない（呼び出し元の責任）。
     */
    private applyViewChangesWithSync(changes: CellChange[], range: CellRange, copyRange: CellRange): void {
        const allChanges: CellChange[] = [];
        for (const change of changes) {
            const linkedChanges = this.table.synchronizeJoinedColumnValues(change.row, change.column, change.newValue);
            allChanges.push(change);
            for (const lc of linkedChanges) allChanges.push(lc);
            this.table.setCellValueAt(change.row, change.column, change.newValue);
        }
        this.history.push({ changes: allChanges, range, copyRange });
    }

    /**
     * ビュー内変更（FK再構築あり）
     * selection.setRange()は呼ばない（呼び出し元の責任）。
     *
     * 処理順:
     * 0. メタデータ範囲外への変更時はダミーメタデータを事前追加
     * 1. 非再構築行の変更を適用（setCellValueAt + synchronize）
     * 2. 再構築行の非FK変更を適用（restructure時にDOM値として読まれる）
     * 3. FK再構築を下→上の順で実行（インデックスずれ防止）
     * 4. CompositeCommand(MetadataExpansion + CellChange + ViewRowRestructures)をhistoryに追加
     * @returns 調整済みのセル範囲（FK再構築による行数変化を反映）
     */
    private applyViewChangesWithRestructure(
        changes: CellChange[], restructureRows: Map<number, CellChange>,
        range: CellRange, copyRange: CellRange
    ): CellRange {
        // 0. 変更先の最大行がメタデータ範囲外ならダミーメタデータを追加
        //    FK再構築時にメタデータ配列とDOM行の1:1対応を保つために必要
        let maxDestRow = 0;
        for (const change of changes) {
            if (change.row > maxDestRow) maxDestRow = change.row;
        }
        const metadataExpansionCmd = this.table.hasViewContext()
            ? createMetadataExpansionCommand(this.table, maxDestRow)
            : false as const;
        if (metadataExpansionCmd) metadataExpansionCmd.execute();
        // 1. 非再構築行の変更を適用
        const nonRestructureChanges: CellChange[] = [];
        for (const change of changes) {
            if (restructureRows.has(change.row)) continue;
            const linkedChanges = this.table.synchronizeJoinedColumnValues(change.row, change.column, change.newValue);
            nonRestructureChanges.push(change);
            for (const lc of linkedChanges) nonRestructureChanges.push(lc);
            this.table.setCellValueAt(change.row, change.column, change.newValue);
        }
        // 2. 再構築行の非FK変更を先にDOMに書く（restructureがDOMから値を読むため）
        for (const change of changes) {
            if (!restructureRows.has(change.row)) continue;
            if (restructureRows.get(change.row) === change) continue;
            nonRestructureChanges.push(change);
            this.table.setCellValueAt(change.row, change.column, change.newValue);
        }
        // 3. FK再構築を行番号降順で実行（下から上へ処理しインデックスずれを防止）
        const rowCountBefore = this.table.getRowCount();
        const sortedFkChanges = Array.from(restructureRows.entries()).sort((a, b) => b[0] - a[0]);
        const restructureCommands: Command[] = [];
        for (const [row, fkChange] of sortedFkChanges) {
            restructureCommands.push(this.table.buildAndExecuteViewRowRestructure(row, fkChange.column, fkChange.newValue));
        }
        // VRRによる行数変化を範囲に反映（1:1→1:2展開で行が増える等）
        const rowDelta = this.table.getRowCount() - rowCountBefore;
        const adjustedEndRow = Math.max(range.startRow, range.endRow + rowDelta);
        const adjustedRange: CellRange = {
            startRow: range.startRow, startColumn: range.startColumn,
            endRow: adjustedEndRow, endColumn: range.endColumn,
        };
        // 4. CompositeCommandを構築してhistoryに追加
        // restructureCommandsは降順（行番号が大きい順）で実行済み
        // CompositeCommandのredo（正順）で降順のまま実行すれば、後の行から処理されるためインデックスずれが発生しない
        // undo（逆順）では昇順実行となり同様に安全
        const subCommands: Command[] = [];
        // MetadataExpansionCommandはCompositeの先頭（redo時に最初に実行、undo時に最後に実行）
        if (metadataExpansionCmd) subCommands.push(metadataExpansionCmd);
        const meaningfulChanges = nonRestructureChanges.filter(c => c.oldValue !== c.newValue);
        if (meaningfulChanges.length > 0) {
            subCommands.push(new CellChangeCommand(this.table, meaningfulChanges, range, copyRange));
        }
        for (const cmd of restructureCommands) subCommands.push(cmd);
        if (subCommands.length > 0) {
            this.history.pushCommand(new CompositeCommand(subCommands), adjustedRange, copyRange);
        }
        return adjustedRange;
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
        return this.resolveDynamicReferenceAsync(expr, focus.row);
    }

    /**
     * 動的参照を解決する
     * @param expr 動的参照式
     * @param rowIndex 現在の行インデックス
     * @returns 解決した参照情報、または解決できない場合は undefined
     */
    private async resolveDynamicReferenceAsync(expr: DynamicReference, rowIndex: number): Promise<ResolvedReference | undefined> {
        if (!this.tableData || !this.referenceDataCache) return undefined;

        // 1. 同一行の指定カラムの値を取得
        const valueColumnIndex = this.tableData.header.findIndex(col => col.name === expr.filter.valueColumn);
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

        // パディングセルへの編集を拒否
        const anchor = this.selection.getAnchor();
        if (this.table.isPaddingCell(anchor.row, anchor.column)) {
            this.table.showRejectionFeedback();
            return true;
        }

        // 参照を解決（動的参照対応）
        let resolvedReference = await this.resolveReferenceAsync();

        // 明示的な参照がない場合、
        // 逆参照されているPK列かチェック
        if (!resolvedReference && this.tableData) {
            const focus = this.selection.getFocus();
            const columnIndex = focus.column - 1;
            if (columnIndex >= 0
                && columnIndex
                    < this.tableData.header.length
                && this.tableData.header[columnIndex]
                    .name === config.primaryKeyColumnName
                && this.table
                    .hasReverseReferences()) {
                resolvedReference = {
                    tableName:
                        this.table.tableName,
                    columnName:
                        config.primaryKeyColumnName,
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
        this.applyViewAwareCellChanges(changes, range, this.selection.getCopyRange());
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
