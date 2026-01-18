import {EditorTable} from "./editor-table";
import {Utility} from "./utility";
import {getTarget, moveCell, submitText, enableCellEditMode, applyFillSeries, extendSelectionCell, clearSelectionRange, moveCellDownWithinSelection, moveCellUpWithinSelection, moveCellRightWithinSelection, moveCellLeftWithinSelection} from "./editor-actions";
import {Selection, CellRange} from "./selection";
import {History} from "./history";
import {CellChange} from "./command";

export class GridTextField {

    element: HTMLElement;

    active: boolean;

    visible: boolean;

    readonly table: EditorTable;
    readonly selection: Selection;
    readonly history: History;

    constructor(table: EditorTable, selection: Selection, history: History) {
        this.table = table;
        this.selection = selection;
        this.history = history;

        this.active = false;
        this.visible = false;

        const element = document.createElement('div');
        element.style.width = '0px';
        element.style.top = '-99999px';
        element.style.left = '-99999px';
        element.classList.add('grid-textfield');
        element.setAttribute('contenteditable', 'true');
        element.appendChild(document.createElement('br')); // 改行してキャレットをテキストボックス外にして非表示にしています。
        this.element = element;

        this.element.addEventListener('focusout', this.onFocusout.bind(this));
        this.element.addEventListener('keydown', this.onKeydown.bind(this));
        this.element.addEventListener('input', this.onInput.bind(this));
        this.element.addEventListener('paste', this.onPaste.bind(this));

        // フィルハンドルのイベント登録
        this.setupFillHandle();
    }

    private setupFillHandle(): void {
        const fillHandle = this.selection.getFillHandle();

        // フィルハンドルのドラッグ開始
        fillHandle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const anchor = this.selection.getAnchor();
            this.selection.startFill(anchor.row, anchor.column);
        });

        // フィルハンドルのダブルクリック
        fillHandle.addEventListener('dblclick', (e) => {
            e.preventDefault();
            e.stopPropagation();

            this.fillToMaxRow();
        });

        // テーブル上でのマウス移動（フィル中）
        this.table.element.addEventListener('mousemove', (e) => {
            if (!this.selection.isFilling()) return;

            const target = e.target as HTMLElement;
            if (target.classList.contains('editor-table-cell')) {
                const position = EditorTable.getCellPosition(target, this.table.element);
                if (position) {
                    this.selection.updateFill(position.row, position.column);
                }
            }
        });

        // マウスアップでフィル確定
        window.addEventListener('mouseup', () => {
            if (!this.selection.isFilling()) return;

            const fillInfo = this.selection.getFillInfo();
            this.selection.endFill();

            if (fillInfo) {
                applyFillSeries(
                    this.table,
                    this.selection,
                    this.history,
                    fillInfo.direction,
                    fillInfo.sourceRange.startRow,
                    fillInfo.sourceRange.startColumn,
                    fillInfo.sourceRange.endRow,
                    fillInfo.sourceRange.endColumn,
                    fillInfo.targetRange.startRow,
                    fillInfo.targetRange.startColumn,
                    fillInfo.targetRange.endRow,
                    fillInfo.targetRange.endColumn,
                    fillInfo.count
                );
            }
        });
    }

    /**
     * ダブルクリックでデータ領域の最大行までフィル
     */
    private fillToMaxRow(): void {
        const maxDataRow = this.selection.getMaxDataRow();
        const anchor = this.selection.getAnchor();
        const focus = this.selection.getFocus();

        const startRow = Math.min(anchor.row, focus.row);
        const endRow = Math.max(anchor.row, focus.row);
        const startColumn = Math.min(anchor.column, focus.column);
        const endColumn = Math.max(anchor.column, focus.column);

        // 現在の選択範囲の最下行よりも下にデータがある場合のみフィル
        if (maxDataRow > endRow) {
            const count = maxDataRow - endRow;

            applyFillSeries(
                this.table,
                this.selection,
                this.history,
                'down',
                startRow,
                startColumn,
                endRow,
                endColumn,
                endRow + 1,
                startColumn,
                maxDataRow,
                endColumn,
                count
            );
        }
    }

    enable() {
        if (this.active) return;

        this.active = true;
        this.element.focus({ preventScroll: true });
    }

    show(rect: DOMRect, cellText: string, preserveContent: boolean) {
        if (this.visible) return;

        this.visible = true;
        this.element.classList.add('grid-textfield-active');

        this.element.style.left = rect.left + 'px';
        this.element.style.top = rect.top + 'px';

        if (preserveContent) {
            // ダブルクリック時: セルのテキストをコピーする
            this.element.textContent = cellText;
            this.resizeTextField(cellText);

            // カーソルを一番後ろに設定する
            if (cellText.length > 0) {
                const range = document.createRange();
                range.selectNodeContents(this.element);
                range.collapse(false);
                const selection = window.getSelection();
                if (selection) {
                    selection.removeAllRanges();
                    selection.addRange(range);
                }
            }
        } else {
            // キーボード入力時: セルの内容をクリアして新規入力
            this.element.textContent = null;
            this.resizeTextField('');
        }
    }

    isActive() {
        return this.active;
    }

    isVisible() {
        return this.visible;
    }

    onFocusout() {
        if (!this.active) return;

        // アクティブ中はセルを常に有効にし続けます。
        // IMEを使用していてキー入力の一文字目から日本語を使用できるようになります。
        this.element.focus({ preventScroll: true });

        // すでに非表示なら何もしないです。
        if (!this.visible) return;

        submitText(this.table, this, this.selection, this.element.textContent ?? '', this.history);

        // 非表示にします。
        this.hide();
    }

    onKeydown(keyboardEvent: KeyboardEvent) {

        // テーブルのグローバルなキー入力が見たい場合はコメントアウトしてください。
        console.log(keyboardEvent);

        if (!this.active) return;

        if (this.visible) {

            // IMEの入力中であれば決定しないです。
            if (!keyboardEvent.isComposing && keyboardEvent.code === 'Enter') {
                submitText(this.table, this, this.selection, this.element.textContent ?? '', this.history);
                if (keyboardEvent.shiftKey) {
                    moveCellUpWithinSelection(this.table, this.selection);
                } else {
                    moveCellDownWithinSelection(this.table, this.selection);
                }
            }

            // Tabキーの処理（編集中）
            if (keyboardEvent.key === 'Tab') {
                keyboardEvent.preventDefault();
                submitText(this.table, this, this.selection, this.element.textContent ?? '', this.history);
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
        } else {
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
                this.selection.clearCopyRange();
                this.history.clearCopyRange();
                return;
            }

            if (keyboardEvent.key === 'ArrowRight') {
                if (keyboardEvent.shiftKey) {
                    extendSelectionCell(this.table, this.selection, 1, 0);
                } else {
                    moveCell(this.table, this.selection, 1, 0);
                }
            } else if (keyboardEvent.key === 'ArrowLeft') {
                if (keyboardEvent.shiftKey) {
                    extendSelectionCell(this.table, this.selection, -1, 0);
                } else {
                    moveCell(this.table, this.selection, -1, 0);
                }
            } else if (keyboardEvent.key === 'ArrowUp') {
                if (keyboardEvent.shiftKey) {
                    extendSelectionCell(this.table, this.selection, 0, -1);
                } else {
                    moveCell(this.table, this.selection, 0, -1);
                }
            } else if (keyboardEvent.key === 'ArrowDown') {
                if (keyboardEvent.shiftKey) {
                    extendSelectionCell(this.table, this.selection, 0, 1);
                } else {
                    moveCell(this.table, this.selection, 0, 1);
                }
            } else if (keyboardEvent.key === 'Enter') {
                if (keyboardEvent.shiftKey) {
                    moveCellUpWithinSelection(this.table, this.selection);
                } else {
                    moveCellDownWithinSelection(this.table, this.selection);
                }
            } else if (keyboardEvent.key === 'Tab') {
                keyboardEvent.preventDefault();
                if (keyboardEvent.shiftKey) {
                    moveCellLeftWithinSelection(this.table, this.selection);
                } else {
                    moveCellRightWithinSelection(this.table, this.selection);
                }
            } else if (keyboardEvent.key === 'Delete') {
                clearSelectionRange(this.table, this.selection, this.history);
            }
            if (keyboardEvent.key?.match(/^\w$/g) || keyboardEvent.key === 'Process') {
                enableCellEditMode(this.table, this, this.selection, false);
            }
        }
    }

    onInput() {
        if (!this.active) return;
        this.resizeTextField(this.element.textContent ?? '');
    }

    /**
     * システムクリップボードからのペーストイベントを処理する
     */
    onPaste(event: ClipboardEvent): void {
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
            const rowElement = this.table.element.children[r] as HTMLElement;
            const cells: string[] = [];
            for (let c = copyRange.startColumn; c <= copyRange.endColumn; c++) {
                const cell = rowElement.children[c] as HTMLElement;
                cells.push(cell.textContent ?? '');
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
        const anchor = this.selection.getAnchor();
        const copyRange = this.selection.getCopyRange();
        const copyRowCount = sourceData.length;
        const copyColumnCount = sourceData[0].length;

        const tableRowCount = this.table.element.children.length;
        const tableColumnCount = (this.table.element.children[0] as HTMLElement).children.length;

        const changes: CellChange[] = [];

        const pasteEndRow = Math.min(anchor.row + copyRowCount - 1, tableRowCount - 1);
        const pasteEndColumn = Math.min(anchor.column + copyColumnCount - 1, tableColumnCount - 1);

        for (let r = 0; r < copyRowCount; r++) {
            const destRow = anchor.row + r;
            if (destRow >= tableRowCount) break;

            const destRowElement = this.table.element.children[destRow] as HTMLElement;

            for (let c = 0; c < copyColumnCount; c++) {
                const destColumn = anchor.column + c;
                if (destColumn >= tableColumnCount) break;

                const destCell = destRowElement.children[destColumn] as HTMLElement;

                const oldValue = destCell.textContent ?? '';
                const newValue = sourceData[r][c];

                changes.push({
                    row: destRow,
                    column: destColumn,
                    oldValue: oldValue,
                    newValue: newValue
                });

                destCell.textContent = newValue;
            }
        }

        this.history.push({
            changes: changes,
            range: {
                startRow: anchor.row,
                startColumn: anchor.column,
                endRow: pasteEndRow,
                endColumn: pasteEndColumn
            },
            copyRange: copyRange
        });

        this.selection.setRange(anchor.row, anchor.column, pasteEndRow, pasteEndColumn);
    }

    submitText() {
        if (!this.visible) return;

        submitText(this.table, this, this.selection, this.element.textContent ?? '', this.history);
    }

    hide() {
        this.visible = false;
        this.element.textContent = null;
        this.element.style.width = '0px';
        this.element.style.top = '-99999px';
        this.element.style.left = '-99999px';
        this.element.appendChild(document.createElement('br'));
        this.element.classList.remove('grid-textfield-active');
    }

    resize(width: number) {
        this.element.style.width = width + 'px';
    }

    resizeTextField(textContent: string) {

        const target = getTarget(this.table, this.selection);
        if (!target) return;

        const textFieldWidth = Utility.getTextWidth(textContent, 'normal 13px sans-serif');

        // 自分自身を探す。
        let i = 0;
        for (; i < target.row.children.length; ++i) {
            if (target.cell === target.row.children[i]) {
                break;
            }
        }

        // 自分から右側にあるセルを結合する。
        let width = - 1 - 1 - 6 - 6; // borderの1pxとpaddingの6px
        width += 1; // ←なぜか必要な1px
        for (; i < target.row.children.length; ++i) {
            const elm = target.row.children[i];
            width += elm.getBoundingClientRect().width;
            if (textFieldWidth < width) {
                break;
            }
        }

        this.resize(width);
    }

    /**
     * コピー範囲からソースデータを取得する
     */
    private getSourceData(copyRange: CellRange): string[][] {
        const copyRowCount = copyRange.endRow - copyRange.startRow + 1;
        const copyColumnCount = copyRange.endColumn - copyRange.startColumn + 1;

        const sourceData: string[][] = [];
        for (let r = 0; r < copyRowCount; r++) {
            const srcRowElement = this.table.element.children[copyRange.startRow + r] as HTMLElement;
            const rowData: string[] = [];
            for (let c = 0; c < copyColumnCount; c++) {
                const srcCell = srcRowElement.children[copyRange.startColumn + c] as HTMLElement;
                rowData.push(srcCell.textContent ?? '');
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
        const copyRowCount = sourceData.length;
        const copyColumnCount = sourceData[0].length;

        const tableRowCount = this.table.element.children.length;
        const tableColumnCount = (this.table.element.children[0] as HTMLElement).children.length;

        const changes: CellChange[] = [];

        const pasteEndRow = Math.min(anchor.row + copyRowCount - 1, tableRowCount - 1);
        const pasteEndColumn = Math.min(anchor.column + copyColumnCount - 1, tableColumnCount - 1);

        for (let r = 0; r < copyRowCount; r++) {
            const destRow = anchor.row + r;
            if (destRow >= tableRowCount) break;

            const destRowElement = this.table.element.children[destRow] as HTMLElement;

            for (let c = 0; c < copyColumnCount; c++) {
                const destColumn = anchor.column + c;
                if (destColumn >= tableColumnCount) break;

                const destCell = destRowElement.children[destColumn] as HTMLElement;

                const oldValue = destCell.textContent ?? '';
                const newValue = sourceData[r][c];

                changes.push({
                    row: destRow,
                    column: destColumn,
                    oldValue: oldValue,
                    newValue: newValue
                });

                destCell.textContent = newValue;
            }
        }

        this.history.push({
            changes: changes,
            range: {
                startRow: anchor.row,
                startColumn: anchor.column,
                endRow: pasteEndRow,
                endColumn: pasteEndColumn
            },
            copyRange: copyRange
        });

        this.selection.setRange(anchor.row, anchor.column, pasteEndRow, pasteEndColumn);
    }

    /**
     * 倍数ペースト：選択範囲全体にコピーデータを繰り返しfill
     */
    private pasteWithFill(sourceData: string[][], selectionRange: CellRange, copyRange: CellRange): void {
        const copyRowCount = sourceData.length;
        const copyColumnCount = sourceData[0].length;

        const tableRowCount = this.table.element.children.length;
        const tableColumnCount = (this.table.element.children[0] as HTMLElement).children.length;

        const selectionRowCount = selectionRange.endRow - selectionRange.startRow + 1;
        const selectionColumnCount = selectionRange.endColumn - selectionRange.startColumn + 1;

        const changes: CellChange[] = [];

        for (let r = 0; r < selectionRowCount; r++) {
            const destRow = selectionRange.startRow + r;
            if (destRow >= tableRowCount) break;

            const destRowElement = this.table.element.children[destRow] as HTMLElement;
            const srcRowIndex = r % copyRowCount;

            for (let c = 0; c < selectionColumnCount; c++) {
                const destColumn = selectionRange.startColumn + c;
                if (destColumn >= tableColumnCount) break;

                const destCell = destRowElement.children[destColumn] as HTMLElement;
                const srcColumnIndex = c % copyColumnCount;

                const oldValue = destCell.textContent ?? '';
                const newValue = sourceData[srcRowIndex][srcColumnIndex];

                changes.push({
                    row: destRow,
                    column: destColumn,
                    oldValue: oldValue,
                    newValue: newValue
                });

                destCell.textContent = newValue;
            }
        }

        this.history.push({
            changes: changes,
            range: selectionRange,
            copyRange: copyRange
        });

        this.selection.setRange(
            selectionRange.startRow,
            selectionRange.startColumn,
            selectionRange.endRow,
            selectionRange.endColumn
        );
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

    pasteFromCopyRange(): void {
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
}
