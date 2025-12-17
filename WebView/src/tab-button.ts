import {Tab} from "./tab";
import {Editor} from "./editor";

export class TabButton {

    readonly tab: Tab;
    readonly editor: Editor;

    readonly element: HTMLLIElement;
    readonly name: string;

    constructor(editor: Editor, tab: Tab, name: string) {
        this.editor = editor;
        this.name = name;
        this.tab = tab;

        this.element = document.createElement('li');

        this.element.classList.add('tab-button');
        this.element.textContent = name;

        this.element.addEventListener('click', this.onClick.bind(this));

        const closeButton = document.createElement('button');
        closeButton.classList.add('tab-button-close');
        closeButton.addEventListener('click', this.onClickCloseButton.bind(this));

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

        // 自分自身がアクティブかどうかを確認
        const wasActive = this.element.classList.contains('tab-button-active');

        // 削除前に隣のタブを探しておく
        const prev = this.tab.findPrevTabButton(this.name);
        const next = this.tab.findNextTabButton(this.name);

        // 自分自身をタブから登録解除します。
        this.tab.removeTabButton(this.name);

        // 閉じるボタンが押されたので自分自身を削除します。
        this.element.remove();

        // 自分自身がアクティブじゃないなら、他の要素を自動アクティブにはしないです。
        if (!wasActive) {
            return;
        }

        // 自分がアクティブだった場合は、次にアクティブになるタブを探します。
        // 見つかればそのタブを有効状態にします。
        // 優先順位: 右隣 > 左隣 > Editor空にする (VSCodeと同じ挙動)

        // 自分の右隣が存在していれば右を有効にする。
        if (next) {
            this.tab.enableTabButton(next.name);
            return;
        }

        // 自分の左隣が存在していれば左を有効にする。
        if (prev) {
            this.tab.enableTabButton(prev.name);
            return;
        }

        // 自分自身の両隣がいない場合は、全てのタブが存在していないためEditor部分を空にします。
        this.editor.clear();
    }

    enable() {
        this.element.classList.add('tab-button-active');
    }

    disable() {
        this.element.classList.remove('tab-button-active')
    }
}
