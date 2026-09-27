/**
 * 設定・フィルターで共有するチェックボックス型トグル。
 * ラベルと配置は呼び出し側が所有し、適用・保存・履歴の方針は持たない。
 */
export class ToggleControl {
    private readonly input: HTMLInputElement;

    constructor(label: HTMLLabelElement, accessibleName: string, checked: boolean, inputClassNames: readonly string[]) {
        label.classList.add('toggle-control');
        this.input = document.createElement('input');
        this.input.type = 'checkbox';
        this.input.classList.add('toggle-control-input', ...inputClassNames);
        this.input.setAttribute('aria-label', accessibleName);
        this.input.checked = checked;
        const track = document.createElement('span');
        track.classList.add('toggle-control-track');
        track.setAttribute('aria-hidden', 'true');
        const thumb = document.createElement('span');
        thumb.classList.add('toggle-control-thumb');
        track.appendChild(thumb);
        label.append(this.input, track);
    }

    isChecked(): boolean { return this.input.checked; }

    updateChecked(checked: boolean): void { this.input.checked = checked; }

    onChange(listener: (checked: boolean) => void): void {
        this.input.addEventListener('change', () => listener(this.input.checked));
    }

    isInputTarget(target: EventTarget): boolean { return target === this.input; }
}
