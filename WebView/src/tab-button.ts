import {Tab} from "./tab";

export class TabButton {

    element: HTMLLIElement;

    name: string;

    tab: Tab;

    constructor(name: string, tab: Tab) {
        this.name = name;
        this.tab = tab;

        this.element = document.createElement('li');

        this.element.classList.add('tab-button');
        this.element.textContent = name;

        this.element.addEventListener('click', () => this.onClick());

        const closeButton = document.createElement('button');
        closeButton.classList.add('close-button');
        closeButton.addEventListener('click', (ev: MouseEvent) => this.onClickCloseButton(ev));

        this.element.appendChild(closeButton);
    }

    click() {
        this.element.click();
    }

    private onClick() {

        // 自分自身がクリックされた場合は自分を有効状態にします。
        this.tab.enableTabButton(this.name);
    }

    private onClickCloseButton(ev: MouseEvent) {

        // 閉じるボタンをliの上に置いていて、
        // liのclickイベントが呼び出されてしまうためイベントの伝播を止めておきます。
        ev.stopPropagation();

        // 閉じるボタンが押されたので自分自身を削除します。
        this.element.remove();

        // 自分自身を削除するときに、自分がアクティブだったときにはほかのタブにフォーカスを当てたいです。
        // 早期リターンで自分自身がアクティブじゃないなら、他の要素を自動アクティブにはしないです。
        if (!this.element.classList.contains('tab-button-active')) {
            return;
        }

        // 自分がアクティブだった場合は、次にアクティブになるタブを探します。
        // 見つかればそのタブを有効状態にします。

        // 自分の右隣が存在していれば右を有効にする。
        const next = this.tab.findNextTabButton(this.name);
        if (next?.element.textContent) {
            this.tab.enableTabButton(next.element.textContent);
            return;
        }

        // 自分の左隣が存在していれば左を有効にする。
        const prev = this.tab.findPrevTabButton(this.name);
        if (prev?.element.textContent) {
            this.tab.enableTabButton(prev.element.textContent);
            return;
        }

        // 自分自身の両隣がいない場合は、全てのタブが存在していないためそれをタブに報告します。
        // タブが全てない状態に戻します。
        this.tab.disableAll();
    }

    enable() {
        this.element.classList.add('tab-button-active');
    }

    disable() {
        this.element.classList.remove('tab-button-active')
    }
}
