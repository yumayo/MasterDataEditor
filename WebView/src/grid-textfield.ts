import Store from "./store";

export class GridTextField {

    element: HTMLElement;

    active: boolean;

    visible: boolean;

    constructor() {
        this.active = false;
        this.visible = false;

        const element = document.createElement('div');
        element.style.width = '0px';
        element.style.top = '-99999px';
        element.style.left = '-99999px';
        element.classList.add('table-text-field');
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

    show(rect: DOMRect) {
        if (this.visible) return;

        this.visible = true;
        this.element.classList.add('table-text-field-active');
        this.element.textContent = null;

        this.element.style.left = rect.left + 'px';
        this.element.style.top = rect.top + 'px';

        // これなんで空文字でリサイズしてるんだっけ
        Store.resizeTextField('');

        // カーソルを一番後ろに設定しています。
        // セルのテキストをそのまま使う
        // this.element.textContent = this.target.textContent;
        // const range = document.createRange();
        // range.setStart(this.element, 1);
        // range.collapse(true);
        // const selection = window.getSelection();
        // selection.removeAllRanges();
        // selection.addRange(range);
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

        Store.submitText(this.element.textContent ?? '');

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
                Store.submitText(this.element.textContent ?? '');
                Store.moveCell(0, 1);
            }
        } else {
            if (keyboardEvent.key === 'ArrowRight') {
                Store.moveCell(1, 0);
            } else if (keyboardEvent.key === 'ArrowLeft') {
                Store.moveCell(-1, 0);
            } else if (keyboardEvent.key === 'ArrowUp') {
                Store.moveCell(0, -1);
            } else if (keyboardEvent.key === 'ArrowDown') {
                Store.moveCell(0, 1);
            } else if (keyboardEvent.key === 'Enter') {
                if (keyboardEvent.shiftKey) {
                    Store.moveCell(1, 0);
                } else {
                    Store.moveCell(0, 1);
                }
            } else if (keyboardEvent.key === 'Backspace') {
                Store.submitText('');
            } else if (keyboardEvent.key === 'Delete') {
                Store.submitText('');
            }
            if (keyboardEvent.key?.match(/^\w$/g) || keyboardEvent.key === 'Process') {
                Store.enableCellEditMode();
            }
        }
    }

    onInput() {
        if (!this.active) return;
        Store.resizeTextField(this.element.textContent ?? '');
    }

    submitText() {
        if (!this.visible) return;

        Store.submitText(this.element.textContent ?? '');
    }

    hide() {
        this.visible = false;
        this.element.textContent = null;
        this.element.style.width = '0px';
        this.element.style.top = '-99999px';
        this.element.style.left = '-99999px';
        this.element.appendChild(document.createElement('br'));
        this.element.classList.remove('table-text-field-active');
    }

    resize(width: number) {
        this.element.style.width = width + 'px';
    }
}
