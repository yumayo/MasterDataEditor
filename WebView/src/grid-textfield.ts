import {EditorTable} from "./editor-table";
import {Utility} from "./utility";
import {getTarget, moveCell, submitText, enableCellEditMode} from "./editor-actions";
import {Selection} from "./selection";

export class GridTextField {

    element: HTMLElement;

    active: boolean;

    visible: boolean;

    readonly table: EditorTable;
    readonly selection: Selection;

    constructor(table: EditorTable, selection: Selection) {
        this.table = table;
        this.selection = selection;

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
    }

    enable() {
        if (this.active) return;

        this.active = true;
        this.element.focus();
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
        this.element.focus();

        // すでに非表示なら何もしないです。
        if (!this.visible) return;

        submitText(this.table, this, this.selection, this.element.textContent ?? '');

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
                submitText(this.table, this, this.selection, this.element.textContent ?? '');
                moveCell(this.table, this.selection, 0, 1);
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

            // Ctrl+V: ペースト
            if (keyboardEvent.ctrlKey && keyboardEvent.key === 'v') {
                keyboardEvent.preventDefault();
                this.pasteFromCopyRange();
                return;
            }

            // ESCキーでコピー範囲の点線表示を解除
            if (keyboardEvent.key === 'Escape') {
                keyboardEvent.preventDefault();
                this.selection.clearCopyRange();
                return;
            }

            if (keyboardEvent.key === 'ArrowRight') {
                moveCell(this.table, this.selection, 1, 0);
            } else if (keyboardEvent.key === 'ArrowLeft') {
                moveCell(this.table, this.selection, -1, 0);
            } else if (keyboardEvent.key === 'ArrowUp') {
                moveCell(this.table, this.selection, 0, -1);
            } else if (keyboardEvent.key === 'ArrowDown') {
                moveCell(this.table, this.selection, 0, 1);
            } else if (keyboardEvent.key === 'Enter') {
                if (keyboardEvent.shiftKey) {
                    moveCell(this.table, this.selection, 1, 0);
                } else {
                    moveCell(this.table, this.selection, 0, 1);
                }
            } else if (keyboardEvent.key === 'Backspace') {
                submitText(this.table, this, this.selection, '');
            } else if (keyboardEvent.key === 'Delete') {
                submitText(this.table, this, this.selection, '');
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

    submitText() {
        if (!this.visible) return;

        submitText(this.table, this, this.selection, this.element.textContent ?? '');
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

    pasteFromCopyRange() {
        if (!this.selection.hasCopyRange()) return;

        const copyRange = this.selection.getCopyRange();
        const anchor = this.selection.getAnchor();

        const copyRowCount = copyRange.endRow - copyRange.startRow + 1;
        const copyColumnCount = copyRange.endColumn - copyRange.startColumn + 1;

        const tableRowCount = this.table.element.children.length;
        const tableColumnCount = tableRowCount > 0
            ? (this.table.element.children[0] as HTMLElement).children.length
            : 0;

        // コピー範囲のセル内容をペースト先にコピー
        for (let r = 0; r < copyRowCount; r++) {
            const destRow = anchor.row + r;
            if (destRow >= tableRowCount) break;

            const srcRowElement = this.table.element.children[copyRange.startRow + r] as HTMLElement;
            const destRowElement = this.table.element.children[destRow] as HTMLElement;

            for (let c = 0; c < copyColumnCount; c++) {
                const destColumn = anchor.column + c;
                if (destColumn >= tableColumnCount) break;

                const srcCell = srcRowElement.children[copyRange.startColumn + c] as HTMLElement;
                const destCell = destRowElement.children[destColumn] as HTMLElement;

                destCell.textContent = srcCell.textContent;
            }
        }

        // コピー範囲をクリア
        this.selection.clearCopyRange();
    }
}
